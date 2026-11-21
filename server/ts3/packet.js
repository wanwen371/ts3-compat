// TS3 voice-protocol packet framing.
//
// On the wire every datagram is:
//   server -> client:  [8-byte EAX tag] [u16 packet id BE] [type|flags byte] [payload]
//   client -> server:  [8-byte EAX tag] [u16 packet id BE] [u16 client id BE] [type|flags] [payload]
// INIT1 replaces the tag with the literal "TS3INIT1" and is not encrypted.
// See docs/protocol.md §3 and docs/ghidra/handshake-findings.md.

export const PacketType = Object.freeze({
  VOICE: 0,
  VOICE_WHISPER: 1,
  COMMAND: 2,
  COMMAND_LOW: 3,
  PING: 4,
  PONG: 5,
  ACK: 6,
  ACK_LOW: 7,
  INIT1: 8,
});

export const PacketTypeName = Object.freeze(
  Object.fromEntries(Object.entries(PacketType).map(([k, v]) => [v, k])),
);

/** High nibble of the type byte. */
export const PacketFlags = Object.freeze({
  FRAGMENTED: 0x10,
  NEW_PROTOCOL: 0x20,
  COMPRESSED: 0x40,
  UNENCRYPTED: 0x80,
});

export const INIT1_MAC = Buffer.from('TS3INIT1', 'ascii');

/** Length of the EAX tag in front of every encrypted packet. */
export const TAG_LENGTH = 8;
export const S2C_HEADER_LENGTH = 3; // packet id (2) + type/flags (1)
export const C2S_HEADER_LENGTH = 5; // packet id (2) + client id (2) + type/flags (1)
export const MIN_PACKET_LENGTH = TAG_LENGTH + S2C_HEADER_LENGTH;

/** Maximum UDP payload per packet type (docs/protocol.md §3.4). */
export const MAX_PACKET_LENGTH = Object.freeze({
  [PacketType.VOICE]: 500,
  [PacketType.VOICE_WHISPER]: 9000,
  [PacketType.COMMAND]: 1108,
  [PacketType.COMMAND_LOW]: 1108,
  [PacketType.PING]: 50,
  [PacketType.PONG]: 50,
  [PacketType.ACK]: 50,
  [PacketType.ACK_LOW]: 50,
  [PacketType.INIT1]: 1108,
});

/**
 * Commands larger than one datagram are compressed with QuickLZ first and then
 * split; the body of a datagram is 500 - header - tag on IPv4.
 */
export function packetMtu(isIpv6 = false) {
  return isIpv6 ? 1108 : 500;
}

export function bodyMtu(isIpv6 = false, direction = 'c2s') {
  const header = direction === 'c2s' ? C2S_HEADER_LENGTH : S2C_HEADER_LENGTH;
  return packetMtu(isIpv6) - header - TAG_LENGTH;
}

/**
 * Build a plaintext packet (before encryption): header plus payload.
 * @param {object} o
 * @param {number} o.type            packet type 0..8
 * @param {number} [o.flags]         packet flags (high nibble bits)
 * @param {number} o.packetId        16-bit packet id
 * @param {number} [o.clientId]      client id; present for client -> server
 * @param {Buffer} [o.payload]
 * @param {Buffer} [o.mac]           8-byte placeholder/tag to put in front
 * @param {'c2s'|'s2c'} [o.direction]
 * @returns {Buffer}
 */
export function buildPacket({
  type,
  flags = 0,
  packetId = 0,
  clientId,
  payload = Buffer.alloc(0),
  mac = Buffer.alloc(TAG_LENGTH),
  direction,
}) {
  const dir = direction ?? (clientId === undefined ? 's2c' : 'c2s');
  const headerLen = dir === 'c2s' ? C2S_HEADER_LENGTH : S2C_HEADER_LENGTH;
  const out = Buffer.alloc(TAG_LENGTH + headerLen + payload.length);
  mac.copy(out, 0);
  let off = TAG_LENGTH;
  out.writeUInt16BE(packetId & 0xffff, off);
  off += 2;
  if (dir === 'c2s') {
    out.writeUInt16BE((clientId ?? 0) & 0xffff, off);
    off += 2;
  }
  out[off] = ((type & 0x0f) | (flags & 0xf0)) & 0xff;
  payload.copy(out, off + 1);
  return out;
}

/** The bytes that EAX authenticates as associated data (header without tag). */
export function packetHeader(buf, direction) {
  const headerLen = direction === 'c2s' ? C2S_HEADER_LENGTH : S2C_HEADER_LENGTH;
  return buf.subarray(TAG_LENGTH, TAG_LENGTH + headerLen);
}

/**
 * Parse a plaintext packet (tag + header + payload).
 * @returns {{type:number, flags:number, packetId:number, clientId:number|null,
 *            tag:Buffer, payload:Buffer}|null}
 */
export function parsePacket(buf, direction = 's2c') {
  if (!buf || buf.length < MIN_PACKET_LENGTH) return null;
  const headerLen = direction === 'c2s' ? C2S_HEADER_LENGTH : S2C_HEADER_LENGTH;
  if (buf.length < TAG_LENGTH + headerLen) return null;
  const typeFlagged = buf[TAG_LENGTH + headerLen - 1];
  return {
    direction,
    tag: buf.subarray(0, TAG_LENGTH),
    packetId: buf.readUInt16BE(TAG_LENGTH),
    clientId: direction === 'c2s' ? buf.readUInt16BE(TAG_LENGTH + 2) : null,
    typeFlagged,
    type: typeFlagged & 0x0f,
    flags: typeFlagged & 0xf0,
    payload: buf.subarray(TAG_LENGTH + headerLen),
  };
}

/** True when the packet is an INIT1 packet (the magic replaces the tag). */
export function isInitPacket(buf) {
  return buf.length >= TAG_LENGTH && buf.subarray(0, TAG_LENGTH).equals(INIT1_MAC);
}

/** Header of an INIT1 packet: server sends 3 bytes, client sends 5. */
export function initHeaderLength(buf) {
  // A client -> server INIT1 has 2 more bytes (the client id slot); we know the
  // direction from the type byte position: server packets carry the type byte
  // at offset 10, client packets at offset 12. The caller knows its direction,
  // so this helper is only used for parsing server packets; the handshake code
  // passes the direction explicitly.
  return S2C_HEADER_LENGTH;
}

/** Build an INIT1 packet: "TS3INIT1" + header + payload, unencrypted. */
export function buildInitPacket({ direction = 'c2s', packetId = 101, clientId = 0, type = 0x88, payload }) {
  return buildPacket({
    direction,
    type: type & 0x0f,
    flags: type & 0xf0,
    packetId,
    clientId,
    mac: INIT1_MAC,
    payload,
  });
}

/** Parse an INIT1 packet body (without the magic) for the given direction. */
export function parseInitPacket(buf, direction = 's2c') {
  const headerLen = direction === 'c2s' ? C2S_HEADER_LENGTH : S2C_HEADER_LENGTH;
  if (buf.length < TAG_LENGTH + headerLen) return null;
  if (!isInitPacket(buf)) return null;
  const typeFlagged = buf[TAG_LENGTH + headerLen - 1];
  return {
    direction,
    packetId: buf.readUInt16BE(TAG_LENGTH),
    clientId: direction === 'c2s' ? buf.readUInt16BE(TAG_LENGTH + 2) : null,
    typeFlagged,
    type: typeFlagged & 0x0f,
    flags: typeFlagged & 0xf0,
    payload: buf.subarray(TAG_LENGTH + headerLen),
  };
}

/** True for packet types that carry a command line (reliable, ack'd). */
export function isCommandType(type) {
  return type === PacketType.COMMAND || type === PacketType.COMMAND_LOW;
}

/** True for the two ack types. */
export function isAckType(type) {
  return type === PacketType.ACK || type === PacketType.ACK_LOW;
}

/** Compare 16-bit packet ids across a wrap. */
export function packetIdDiff(a, b) {
  const d = (a - b) & 0xffff;
  return d >= 0x8000 ? d - 0x10000 : d;
}

export default {
  PacketType,
  PacketFlags,
  buildPacket,
  parsePacket,
  packetMtu,
  bodyMtu,
  INIT1_MAC,
  TAG_LENGTH,
  S2C_HEADER_LENGTH,
  C2S_HEADER_LENGTH,
};