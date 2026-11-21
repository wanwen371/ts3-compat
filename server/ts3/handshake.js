// TS3 INIT1 handshake: RSA proof-of-work, the clientinitiv / initivexpand2 key
// exchange, and the session keys that follow.
//
// Wire layouts are pinned by the real-client capture in
// test/capture/handshake-2026-11-21.log and docs/ghidra/handshake-findings.md:
//
//   client -> server INIT1 (13-byte header): "TS3INIT1" pid(2) clientid(2) 0x88 payload
//   server -> client INIT1 (11-byte header): "TS3INIT1" pid(2) 0x88 payload
//
//   C2S init0: [u32 version][0x00][u32 timestamp][4B random0]                       (34B packet)
//   S2C init1: [0x01][16B random1][4B random0_r]
//   C2S init2: [u32 version][0x02][16B random1][4B random0_r]                       (38B packet)
//   S2C init3: [0x03][64B x][64B n][u32 level][100B random2]                        (244B packet)
//   C2S init4: [u32 version][0x04][64B x][64B n][u32 level][100B random2]
//              [64B y, y = x^(2^level) mod n][clientinitiv command]                  (>=314B)
//
// The connection secret then comes from initivexpand2 (TeamSpeak 3.13+):
//   * the server sends the license chain `l`, `omega` (server ephemeral key),
//     `beta` (54 bytes), `proof` and `ot=1`,
//   * the client answers with `clientek ek=<its ephemeral key> proof=<signature>`,
//   * the shared point is (-license-derived server key) * client private key,
//     SHA-512 of it is the connection secret, the IV is that secret XOR
//     (alpha || beta) and the "fake signature" is SHA-1(IV)[0..8].
// The old initivexpand exchange (P-256 ECDH) is implemented as a fallback.

import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import * as crypto from './crypto.js';
import { encodeCommand, parseCommand } from './command.js';
import {
  PacketType,
  PacketFlags,
  buildPacket,
  parsePacket,
  isInitPacket,
  isCommandType,
  INIT1_MAC,
  TAG_LENGTH,
  S2C_HEADER_LENGTH,
} from './packet.js';

/** Version timestamp claimed in INIT1: the real 3.5.6 client's value. */
export const INIT1_VERSION = 0x0edc3ae6;
/** Packet id the real clients use for every INIT1 packet. */
export const INIT1_PACKET_ID = 101;
/** Identity security levels are counted in trailing zero bits of a SHA-1. */
export const MAX_SECURITY_LEVEL = 160;
/** Level the server demands by default; 8 costs ~256 SHA-1 rounds. */
export const DEFAULT_SECURITY_LEVEL = 8;

// ── identity ────────────────────────────────────────────────────────────────

/**
 * Create a TeamSpeak identity: a P-256 key pair plus the hash-cash offset that
 * gives it a security level.
 * @param {number} level trailing zero bits wanted in SHA-1(publicKey + offset)
 * @returns {{privateKey: import('node:crypto').KeyObject, publicKey: string,
 *            publicKeyDer: Buffer, offset: number, level: number}}
 */
export function createIdentity(level = DEFAULT_SECURITY_LEVEL) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  const der = encodeTsPublicKey(x, y);
  const publicKeyB64 = der.toString('base64');

  let offset = 0;
  const prefix = Buffer.from(publicKeyB64, 'utf8');
  for (;;) {
    const h = createHash('sha1').update(prefix).update(String(offset)).digest();
    if (countTrailingZeroBits(h) >= level) break;
    offset++;
  }
  return { privateKey, publicKey: publicKeyB64, publicKeyDer: der, offset, level };
}

/** Number of trailing zero bits in a buffer, TeamSpeak's security level. */
export function countTrailingZeroBits(buf) {
  let zeros = 0;
  for (const byte of buf) {
    if (byte === 0) {
      zeros += 8;
      continue;
    }
    for (let i = 0; i < 8; i++) {
      if (byte & (1 << i)) return zeros;
      zeros++;
    }
  }
  return zeros;
}

/** ASN.1 DER SEQUENCE { BitString{0}, INTEGER size, INTEGER x, INTEGER y }. */
export function encodeTsPublicKey(xBytes, yBytes) {
  // ASN.1 BIT STRING with bit-length 1 and a zero bit: DER puts the unused-bit
  // count (7) in the first content byte. TeamSpeak's parser rejects any other
  // length, so this byte matters.
  const bitString = derElement(0x03, Buffer.from([0x07, 0x00]));
  const size = derInteger(Buffer.from([0x20]));
  const x = derInteger(xBytes);
  const y = derInteger(yBytes);
  return derElement(0x30, Buffer.concat([bitString, size, x, y]));
}

function derInteger(bytes) {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0 && (bytes[i + 1] & 0x80) === 0) i++;
  let body = bytes.subarray(i);
  if (body.length === 0) body = Buffer.from([0]);
  if (body[0] & 0x80) body = Buffer.concat([Buffer.from([0]), body]);
  return derElement(0x02, body);
}

function derLength(len) {
  if (len < 0x80) return Buffer.from([len]);
  const bytes = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derElement(tag, body) {
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

/** UID the server shows for an identity: SHA-1 of the base64 public key. */
export function identityUid(identity) {
  return createHash('sha1').update(identity.publicKey, 'utf8').digest('base64');
}

/** `hwid` field of clientinit: SHA-1 over the base64 public key. */
export function identityHwid(identity) {
  return createHash('sha1').update(identity.publicKey, 'utf8').digest('base64');
}

// ── INIT1 packet payloads ───────────────────────────────────────────────────

export function buildInit1Start() {
  // The server's validator requires variant 0 to be exactly 34 bytes, i.e. a
  // 21-byte payload: version, step 0, 8 bytes (timestamp + random0), then 8
  // zero bytes (the real 3.5.6 client sends zeros there too).
  const payload = Buffer.alloc(21);
  payload.writeUInt32BE(INIT1_VERSION, 0);
  payload[4] = 0x00;
  payload.writeUInt32BE(Math.floor(Date.now() / 1000) >>> 0, 5);
  randomBytes(4).copy(payload, 9);
  return payload;
}

/** Answer S2C init1: echo random1 (16B) and random0_r (4B). */
export function buildInit1Step2(s2cInit1) {
  if (!s2cInit1 || s2cInit1.length < 21 || s2cInit1[0] !== 0x01) {
    throw new Error('unexpected INIT1 step 1 payload');
  }
  const payload = Buffer.alloc(25);
  payload.writeUInt32BE(INIT1_VERSION, 0);
  payload[4] = 0x02;
  s2cInit1.copy(payload, 5, 1, 21);
  return payload;
}

/** Pull the RSA puzzle out of an S2C init3 payload. */
export function parseInit1Step3(s2cInit3) {
  if (!s2cInit3 || s2cInit3.length < 233 || s2cInit3[0] !== 0x03) {
    throw new Error('unexpected INIT1 step 3 payload');
  }
  return {
    x: Buffer.from(s2cInit3.subarray(1, 65)),
    n: Buffer.from(s2cInit3.subarray(65, 129)),
    level: s2cInit3.readUInt32BE(129),
    random2: Buffer.from(s2cInit3.subarray(133, 233)),
  };
}

/**
 * Build the clientinitiv command carried by init4 and the init4 payload.
 * @param {object} o
 * @param {{x:Buffer,n:Buffer,level:number,random2:Buffer}} o.puzzle
 * @param {Buffer} o.alpha          10 random bytes
 * @param {object} o.identity
 * @param {Buffer} [o.ip]           public IP hint, empty for loopback
 */
export function buildInit1Step4({ puzzle, alpha, identity, ip = '' }) {
  const y = crypto.solveRsaPuzzle(puzzle.x, puzzle.n, puzzle.level);
  const command = encodeCommand('clientinitiv', {
    alpha: alpha.toString('base64'),
    omega: identity.publicKey,
    ot: 1,
    ip: ip ?? '',
  });
  const payload = Buffer.alloc(5 + 64 + 64 + 4 + 100 + 64 + command.length);
  payload.writeUInt32BE(INIT1_VERSION, 0);
  payload[4] = 0x04;
  puzzle.x.copy(payload, 5);
  puzzle.n.copy(payload, 69);
  payload.writeUInt32BE(puzzle.level, 133);
  puzzle.random2.copy(payload, 137);
  y.copy(payload, 237);
  command.copy(payload, 301);
  return { payload, y, command };
}

// ── initivexpand2 (TeamSpeak 3.13+) ─────────────────────────────────────────

/**
 * Turn the initivexpand2 parameters into the connection's IV and MAC.
 * @param {object} o
 * @param {object} o.identity
 * @param {Buffer} o.alpha        the alpha this client sent in clientinitiv
 * @param {Record<string,string>} o.params  parsed initivexpand2 parameters
 * @returns {{iv: Buffer, mac: Buffer, beta: Buffer, serverKey: Buffer,
 *            ephemeralPublicKey: Buffer, ephemeralPrivateKey: Buffer}}
 */
export function deriveInitivexpand2Session({ identity, alpha, params }) {
  const license = Buffer.from(params.l ?? '', 'base64');
  const beta = Buffer.from(params.beta ?? '', 'base64');
  if (beta.length !== 54) throw new Error(`initivexpand2 beta must be 54 bytes, got ${beta.length}`);
  const serverKeyDer = Buffer.from(params.omega ?? '', 'base64');

  // The license chain folds out the server's ephemeral public key.
  const serverEphemeral = crypto.deriveLicenseKey(license);
  const ephemeral = crypto.generateEphemeralKey();
  const shared = crypto.ed25519SharedSecret(ephemeral.privateKey, serverEphemeral);
  const iv = Buffer.from(shared);
  for (let i = 0; i < 10; i++) iv[i] ^= alpha[i];
  for (let i = 0; i < 54; i++) iv[10 + i] ^= beta[i];
  const mac = createHash('sha1').update(iv).digest().subarray(0, 8);
  return {
    iv,
    mac,
    beta,
    serverKey: serverKeyDer,
    ephemeralPublicKey: ephemeral.publicKey,
    ephemeralPrivateKey: ephemeral.privateKey,
  };
}

/** Build the clientek command that answers initivexpand2. */
export function buildClientEk({ identity, beta, ephemeralPublicKey }) {
  const toSign = Buffer.concat([ephemeralPublicKey, beta.subarray(0, 54)]);
  const proof = sign('sha256', toSign, identity.privateKey);
  return encodeCommand('clientek', {
    ek: ephemeralPublicKey.toString('base64'),
    proof: proof.toString('base64'),
  });
}

// ── legacy initivexpand (P-256 ECDH) ────────────────────────────────────────

/**
 * Legacy key exchange, used by servers that answer clientinitiv with an
 * `initivexpand` command instead of `initivexpand2`.
 */
export function deriveLegacySession({ identity, params }) {
  const alpha = Buffer.from(params.alpha ?? '', 'base64');
  const beta = Buffer.from(params.beta ?? '', 'base64');
  const omega = Buffer.from(params.omega ?? '', 'base64');
  const serverPoint = decodeTsPublicKey(omega);
  if (!serverPoint) throw new Error('initivexpand: invalid server omega key');
  const ecdh = createEcdh(identity.privateKey, serverPoint);
  const shared = createHash('sha1').update(ecdh).digest();
  const iv = Buffer.alloc(10 + beta.length);
  for (let i = 0; i < 10; i++) iv[i] = shared[i] ^ alpha[i];
  for (let i = 0; i < beta.length; i++) iv[10 + i] = shared[10 + i] ^ beta[i];
  const mac = createHash('sha1').update(iv).digest().subarray(0, 8);
  return { iv, mac, beta };
}

function createEcdh(privateKey, serverPoint) {
  const { createECDH } = cryptoNode();
  const ecdh = createECDH('prime256v1');
  const jwk = privateKey.export({ format: 'jwk' });
  ecdh.setPrivateKey(Buffer.from(jwk.d, 'base64url'));
  return ecdh.computeSecret(serverPoint.uncompressed);
}

function cryptoNode() {
  return nodeCrypto;
}

const nodeCrypto = await import('node:crypto');

/** Decode a TeamSpeak ASN.1 public key: {BitString, Size, X, Y} or legacy order. */
export function decodeTsPublicKey(der) {
  try {
    const { x, y } = parseTsPublicKeyDer(der);
    const uncompressed = Buffer.alloc(65);
    uncompressed[0] = 0x04;
    x.copy(uncompressed, 1 + (32 - x.length));
    y.copy(uncompressed, 33 + (32 - y.length));
    return { x, y, uncompressed };
  } catch {
    return null;
  }
}

function parseTsPublicKeyDer(buf) {
  let pos = 0;
  function readTlv() {
    const tag = buf[pos];
    let len = buf[pos + 1];
    pos += 2;
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = (len << 8) | buf[pos++];
    }
    const body = buf.subarray(pos, pos + len);
    pos += len;
    return { tag, body };
  }
  const seq = readTlv();
  if (seq.tag !== 0x30) throw new Error('not a sequence');
  let p = 0;
  const elements = [];
  while (p < seq.body.length) {
    const tag = seq.body[p];
    let len = seq.body[p + 1];
    let start = p + 2;
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = (len << 8) | seq.body[start + i];
      start += n;
    }
    elements.push({ tag, body: seq.body.subarray(start, start + len) });
    p = start + len;
  }
  // Canonical layout is {BitString, size, X, Y}; the legacy layout drops the
  // size integer and puts the bit string last, so the two coordinate integers
  // are the last two of the sequence either way.
  const integers = elements.filter((e) => e.tag === 0x02).map((e) => e.body);
  if (integers.length < 2) throw new Error('missing integers');
  const x = integers[integers.length - 2];
  const y = integers[integers.length - 1];
  return { x: stripLeadingZeros(x), y: stripLeadingZeros(y) };
}

function stripLeadingZeros(b) {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  return b.subarray(i);
}

// ── clientinit / initserver ─────────────────────────────────────────────────

/** Default client version fields (a real client's signed version). */
export const DEFAULT_CLIENT_VERSION = Object.freeze({
  platform: 'Windows',
  version: '3.?.? [Build: 5680278000]',
  sign: 'DX5NIYLvfJEUjuIbCidnoeozxIDRRkpq3I9vVMBmE9L2qnekOoBzSenkzsg2lC9CMv8K5hkEzhr2TYUYSwUXCg==',
});

/**
 * Build the clientinit command, in the field order the real client uses.
 * @param {object} o
 * @param {string} o.nickname
 * @param {object} o.identity
 * @param {number} [o.channelId]     default channel to join
 * @param {string} [o.channelPassword]
 * @param {string} [o.serverPassword]
 * @param {string} [o.privilegeKey]  client_default_token
 * @param {{platform:string, version:string, sign:string}} [o.clientVersion]
 */
export function buildClientInit({
  nickname,
  identity,
  channelId,
  channelPassword = '',
  serverPassword = '',
  privilegeKey = '',
  clientVersion = DEFAULT_CLIENT_VERSION,
}) {
  return encodeCommand('clientinit', [
    ['client_nickname', nickname],
    ['client_version', clientVersion.version],
    ['client_platform', clientVersion.platform],
    ['client_input_hardware', '1'],
    ['client_output_hardware', '1'],
    ['client_default_channel', channelId === undefined ? '' : String(channelId)],
    ['client_default_channel_password', channelPassword],
    ['client_server_password', serverPassword],
    ['client_meta_data', ''],
    ['client_version_sign', clientVersion.sign],
    ['client_key_offset', String(identity.offset)],
    ['client_nickname_phonetic', ''],
    ['client_default_token', privilegeKey],
    ['hwid', identityHwid(identity)],
  ]);
}

/** Parse the initserver command's parameters. */
export function parseInitServer(params) {
  const clid = Number.parseInt(params.aclid ?? params.clid ?? '0', 10);
  return {
    clientId: Number.isFinite(clid) ? clid : 0,
    serverName: params.virtualserver_name ?? '',
    raw: params,
  };
}

// ── small helpers shared with connection.js ─────────────────────────────────

export const HANDSHAKE_CONSTANTS = Object.freeze({
  INIT1_VERSION,
  INIT1_PACKET_ID,
  DEFAULT_SECURITY_LEVEL,
});

export default {
  createIdentity,
  buildInit1Start,
  buildInit1Step2,
  parseInit1Step3,
  buildInit1Step4,
  deriveInitivexpand2Session,
  buildClientEk,
  deriveLegacySession,
  buildClientInit,
  parseInitServer,
};
// ── standalone handshake driver (api.md entry point) ───────────────────────

/**
 * Run the INIT1 + initivexpand2 key exchange over a caller-provided UDP socket
 * and return the resulting Session. It stops after clientek: no
 * clientinit/registration is sent, so the caller owns the command channel.
 * Ts3Connection uses the same steps and adds acks, fragmentation and events.
 *
 * @param {object} o
 * @param {import('node:dgram').Socket} o.socket  bound dgram socket
 * @param {string} o.host
 * @param {number} o.port
 * @param {object} [o.identity]
 * @param {number} [o.timeoutMs]
 * @returns {Promise<{iv: Buffer, mac: Buffer, connectionKey: Buffer,
 *                    serverKey: Buffer, clientIdIn: number,
 *                    clientIdOut: number, alpha: Buffer, identity: object}>}
 */
export async function handshake({ socket, host, port, identity = createIdentity(), timeoutMs = 15000 }) {
  const initInbox = [];
  const commandInbox = [];
  const waiters = new Set();
  let session = null;
  const wake = () => {
    for (const waiter of [...waiters]) waiter();
  };
  const sendRaw = (datagram) => socket.send(datagram, port, host);

  const sendInit = (payload) => {
    sendRaw(
      buildPacket({
        direction: 'c2s',
        type: PacketType.INIT1,
        flags: PacketFlags.UNENCRYPTED,
        packetId: INIT1_PACKET_ID,
        clientId: 0,
        payload,
        mac: INIT1_MAC,
      }),
    );
  };

  const sendAck = (packetId) => {
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(packetId & 0xffff, 0);
    const header = Buffer.alloc(5);
    header.writeUInt16BE(0, 0);
    header.writeUInt16BE(0, 2);
    if (session) {
      header[4] = PacketType.ACK | PacketFlags.UNENCRYPTED;
      sendRaw(Buffer.concat([session.mac, header, payload]));
      return;
    }
    header[4] = PacketType.ACK;
    const sealed = crypto.eaxEncrypt({
      key: crypto.FAKE_KEY,
      nonce: crypto.FAKE_NONCE,
      header,
      plaintext: payload,
    });
    sendRaw(Buffer.concat([sealed.subarray(0, TAG_LENGTH), header, sealed.subarray(TAG_LENGTH)]));
  };

  const decryptServerPacket = (datagram) => {
    const parsed = parsePacket(datagram, 's2c');
    if (!parsed) return null;
    const header = datagram.subarray(TAG_LENGTH, TAG_LENGTH + S2C_HEADER_LENGTH);
    const tag = datagram.subarray(0, TAG_LENGTH);
    const ciphertext = datagram.subarray(TAG_LENGTH + S2C_HEADER_LENGTH);
    if (session) {
      const { key, nonce } = crypto.derivePacketKey({
        iv: session.iv,
        packetType: parsed.type,
        generationId: 0,
        fromServer: true,
        packetId: parsed.packetId,
      });
      const plaintext = crypto.eaxDecrypt({ key, nonce, header, ciphertext, tag });
      if (plaintext) return { parsed, plaintext };
    }
    const plaintext = crypto.eaxDecrypt({
      key: crypto.FAKE_KEY,
      nonce: crypto.FAKE_NONCE,
      header,
      ciphertext,
      tag,
    });
    return plaintext ? { parsed, plaintext } : null;
  };

  const onMessage = (datagram) => {
    if (isInitPacket(datagram)) {
      initInbox.push(datagram.subarray(TAG_LENGTH + S2C_HEADER_LENGTH));
      wake();
      return;
    }
    const decrypted = decryptServerPacket(datagram);
    if (!decrypted || !isCommandType(decrypted.parsed.type)) return;
    sendAck(decrypted.parsed.packetId);
    commandInbox.push(decrypted.plaintext.toString('utf8'));
    wake();
  };
  socket.on('message', onMessage);
  const deadline = Date.now() + timeoutMs;

  const waitFor = async (queue, predicate, what) => {
    for (;;) {
      const index = queue.findIndex(predicate);
      if (index >= 0) return queue.splice(index, 1)[0];
      if (Date.now() > deadline) throw new Error(`handshake: timeout waiting for ${what}`);
      await new Promise((resolve) => {
        const waiter = () => {
          waiters.delete(waiter);
          resolve();
        };
        waiters.add(waiter);
        const timer = setTimeout(() => {
          if (waiters.delete(waiter)) resolve();
        }, 100);
        timer.unref?.();
      });
    }
  };

  try {
    sendInit(buildInit1Start());
    const s2cInit1 = await waitFor(initInbox, (p) => p.length >= 21 && p[0] === 0x01, 'INIT1 step 1');
    sendInit(buildInit1Step2(s2cInit1));
    const s2cInit3 = await waitFor(initInbox, (p) => p.length >= 233 && p[0] === 0x03, 'INIT1 step 3');
    const puzzle = parseInit1Step3(s2cInit3);
    const alpha = randomBytes(10);
    sendInit(buildInit1Step4({ puzzle, alpha, identity }).payload);
    const expandText = await waitFor(commandInbox, (text) => text.startsWith('initivexpand2'), 'initivexpand2');
    const expand = parseCommand(expandText);
    const derived = deriveInitivexpand2Session({ identity, alpha, params: expand.params });
    session = { iv: derived.iv, mac: derived.mac };

    // clientek carries our ephemeral key; it is dummy-encrypted because the
    // server only derives the shared secret when it receives it.
    const clientEk = buildClientEk({
      identity,
      beta: derived.beta,
      ephemeralPublicKey: derived.ephemeralPublicKey,
    });
    const header = Buffer.alloc(5);
    header.writeUInt16BE(1, 0);
    header.writeUInt16BE(0, 2);
    header[4] = PacketType.COMMAND | PacketFlags.NEW_PROTOCOL;
    const sealed = crypto.eaxEncrypt({
      key: crypto.FAKE_KEY,
      nonce: crypto.FAKE_NONCE,
      header,
      plaintext: clientEk,
    });
    sendRaw(Buffer.concat([sealed.subarray(0, TAG_LENGTH), header, sealed.subarray(TAG_LENGTH)]));
    // Give the server a moment to derive its keys before the caller sends the
    // first encrypted command (raw clientinit is the caller's job).
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      iv: derived.iv,
      mac: derived.mac,
      connectionKey: derived.iv,
      serverKey: derived.serverKey,
      clientIdIn: 0,
      clientIdOut: 0,
      alpha,
      identity,
      beta: derived.beta,
    };
  } finally {
    socket.off('message', onMessage);
  }
}
