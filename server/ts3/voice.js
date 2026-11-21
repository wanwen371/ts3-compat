// TS3 voice payload (plaintext) build/parse.
//
// Scope of this module: **only the voice payload that sits inside a
// VOICE / VOICE_WHISPER UDP packet**, i.e. the bytes after the packet header
// and before/after the packet layer's AES-128-EAX encryption. Packet framing,
// PacketID branding, EAX encryption, MTU enforcement and re-assembly live in
// packet.js / crypto.js / connection.js and are intentionally not duplicated.
//
//   browser  --Opus 20 ms frame over WS-->  connection.js
//            buildVoicePayload({codec,seq,frames,targets}) -> packet.js -> UDP
//   ...real TeamSpeak 3 server 127.0.0.1:9987 forwards it...
//            connection.js decrypts -> parseVoicePayload(payload)
//            app.js -> WS {"ev":"voice", from, codec, seq, data:base64}
//            browser -> AudioDecoder('opus') -> WebAudio
//
// ---------------------------------------------------------------------------
// DIRECTION MATTERS. The TS3 voice payload has two layouts, because the sender
// client id is carried in a different place in each direction:
//
//   client -> server packet header is 13 B:  tag(8) | packetId BE16 | clientId BE16 | type/flags(1)
//   server -> client packet header is 11 B:  tag(8) | packetId BE16 | type/flags(1)
//
// Evidence: real-client handshake capture (docs/ghidra/handshake-findings.md §2/§3:
// client type byte at +12, server type byte at +10) and the server's own
// constants: EAX AD length 3 / payload at +11 on send (0x4a01c4..0x4a01c6) vs
// AD length 5 / payload at +13 on receive (0x49b441, IncomingPacket::decrypt).
//
// Because the clientId is already in the c2s header, the client's voice payload
// is COMPACT; the server has no room for it in the s2c header, so it prepends
// the sender client id to the payload (VoiceStreamer copies the incoming
// header's clientId at m_Data[10..11] into the new packet's payload[2..3]).
//
//   layout "client" (c2s, what our backend SENDS):
//     seq BE16 | codec u8 | [count u8] | frames... | [extra u8]
//   layout "server" (s2c, what our backend RECEIVES):
//     seq BE16 | senderClientId BE16 | codec u8 | [count u8] | frames... | [extra u8]
//
// Whisper packets put the target lists right after the codec / count byte:
//     u8 channelCount, u8 clientCount,
//     channelCount x BE64 channel id, clientCount x BE16 client id,
//     then the frames.
//
// ---------------------------------------------------------------------------
// Field evidence (docs/protocol.md §4, §10 + this session's re-verification of
// the stripped server binary ts3server 3.13.9,
// sha256 9e37899d3cf2b81e449ba1b23cb78cec98e6ae3116f7bc05422e5160b6d60c5f):
//
//   field                                    evidence
//   ---------------------------------------- ---------------------------------------------------
//   seq BE16                                 [A] 0xaa0bf3 `rol $8,%bx`; written at m_Data+11
//                                                (0xaa0c0d). Server receive getter 0x49d410 reads
//                                                it back as BE16 at m_Data+13 (= payload[0..1]).
//   sender client id BE16 (s2c only)         [A] 0xaa1010 (full voice ctor, with audio) writes
//                                                BE16 at m_Data+13 = payload[2..3]; VoiceStreamer
//                                                0x4e2210 feeds it from 0x49b130 = BE16 at the
//                                                incoming header's [10..11], which the 13-byte c2s
//                                                header defines as the sender client id.
//   codec u8                                 [A] 0xaa0c1d `mov %r15b,0x4(%rbx,%rax,1)`
//                                                (server send: payload[4]); server receive getters
//                                                0x49bb50 = m_Data[15] & 7 (payload[2]).
//   numberVoicePackets u8                    [A] 0xaa0f53 writes count at m_Data+16
//   (only when packet flags bit4 = 0x10)         (server send: payload[5]); receive getter
//                                                0x49bb60 = m_Data[16] (payload[3]); assertion
//                                                outgoingvoicepacket.cpp:120 "numberVoicePackets < 256";
//                                                omitted when count == 1 (adjust logic 0xaa0c57).
//   whisper channelCount / clientCount u8     [A] 0xaa2480 writes counts at m_Data[17-adj]/[18-adj],
//                                                channel ids as BE64 (8 B stride, bswap64),
//                                                client ids as BE16 (2 B stride, bswap16).
//   frames = count equal-sized frames         [A] decode.cpp assertion
//                                                "voiceDataSize % numberVoicePackets == 0"
//                                                (docs §4.2/§10.1) -> no per-frame lengths.
//   optional trailing byte (flags bit6=0x40)  [A] 0xaa0c28..0xaa0c3b: written at m_Data[size-1]
//                                                only when the extra arg != 0xff.
//
// Packet size budget (docs §3.4/§5.1, [A]):
//   VOICE          packet <= 500 B  -> payload <= 500 - 11 = 489 B
//   VOICE_WHISPER  packet <= 9000 B -> payload <= 9000 - 11 = 8989 B
//
// TODO(unknowns, see docs/protocol.md §12.1):
//   * The count byte / trailing byte are announced by flags in the *packet*
//     header (bit4 0x10 and bit6 0x40), not by the payload. buildVoicePayload
//     cannot write those flags, so use voicePacketMeta() to get them and OR
//     them into the packet header. parseVoicePayload() accepts {flags} so the
//     packet layer can tell it the same fact; without flags it assumes the
//     single-frame form (count byte absent), which is the common 20 ms case.
//   * The "extra" trailing byte's meaning is unknown (probably talk/target
//     metadata); it is preserved verbatim when flagged and otherwise absent.
//   * The client-side c2s layout is inferred from the server's receive getters
//     (the client binary's own send path was not decompiled). The server-side
//     s2c layout is read directly from OutgoingVoicePacket's constructor.
//   * Opus Music (codec 5) carries stereo frames; frame length is not encoded
//     here — the decoder must be configured from channel codec 5.

/** Codec ids used by the TS3 server/command channel (`channel_codec` property). */
export const CODEC = Object.freeze({
  SPEEX_NB: 0, // Speex Narrowband, 8 kHz
  SPEEX_WB: 1, // Speex Wideband, 16 kHz
  SPEEX_UWB: 2, // Speex Ultra-wideband, 32 kHz
  CELT_MONO_48K: 3, // CELT Mono, 48 kHz (legacy)
  OPUS_VOICE: 4, // Opus, mono, application=VOIP  <-- P0 default
  OPUS_MUSIC: 5, // Opus, stereo, application=AUDIO
});

/** UDP packet types that carry voice (docs §2.2). */
export const PACKET_TYPE = Object.freeze({ VOICE: 0, VOICE_WHISPER: 1 });

/** Encoded voice parameters (docs §10.1, [A]): 48 kHz, 960 samples = 20 ms. */
export const SAMPLE_RATE = 48000;
export const FRAME_SAMPLES = 960;
export const FRAME_MS = 20;

/** Packet size limits (docs §3.4 / §5.1, [A]); the values are whole UDP datagrams. */
export const MTU_VOICE = 500;
export const MTU_WHISPER = 9000;
/** EAX tag length (docs §7.4). */
export const TAG_LENGTH = 8;
/** Plaintext header size of the server -> client form (3 B) / client -> server form (5 B). */
export const S2C_HEADER_LENGTH = 3;
export const C2S_HEADER_LENGTH = 5;
/** Whole-datagram overhead: 8 B tag + direction-dependent header. */
export const S2C_OVERHEAD = TAG_LENGTH + S2C_HEADER_LENGTH; // 11
export const C2S_OVERHEAD = TAG_LENGTH + C2S_HEADER_LENGTH; // 13
/**
 * Maximum voice payload size per layout so the whole datagram stays within the
 * type limit (500 B for VOICE, 9000 B for VOICE_WHISPER, docs §3.4).
 */
export const MAX_VOICE_PAYLOAD = MTU_VOICE - C2S_OVERHEAD; // 487  (client -> server)
export const MAX_S2C_VOICE_PAYLOAD = MTU_VOICE - S2C_OVERHEAD; // 489 (server -> client)
export const MAX_WHISPER_PAYLOAD = MTU_WHISPER - C2S_OVERHEAD; // 8987 (client -> server)
export const MAX_S2C_WHISPER_PAYLOAD = MTU_WHISPER - S2C_OVERHEAD; // 8989 (server -> client)

/** `numberVoicePackets < 256` (docs §4.2, assert outgoingvoicepacket.cpp:120). */
export const MAX_FRAMES_PER_PACKET = 255;
/** Each whisper target list holds at most 255 entries (asserts, docs §4.4). */
export const MAX_WHISPER_TARGETS = 255;

/** Packet header flags that travel *outside* this payload (docs §3.3, [A]). */
export const VOICE_FLAG_COUNT_BYTE = 0x10; // bit4: payload has the u8 frame count
export const VOICE_FLAG_EXTRA_BYTE = 0x40; // bit6: payload has the trailing byte

/** Payload layout selectors. */
export const LAYOUT = Object.freeze({
  /** client -> server: compact payload (sender id lives in the 13 B header) */
  CLIENT: 'client',
  /** server -> client: payload starts with the sender client id */
  SERVER: 'server',
});

/** Fixed header fields before the frame data. */
const CLIENT_HEADER_FIELDS = 3; // seq(2) + codec(1)
const SERVER_HEADER_FIELDS = 5; // seq(2) + senderClientId(2) + codec(1)

function headerFields(layout) {
  if (layout === LAYOUT.CLIENT) return CLIENT_HEADER_FIELDS;
  if (layout === LAYOUT.SERVER) return SERVER_HEADER_FIELDS;
  throw fail('voice.bad_layout', `layout must be "${LAYOUT.CLIENT}" or "${LAYOUT.SERVER}"`);
}

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return null;
}

function assertInteger(value, name, min, max) {
  if (!Number.isInteger(value)) throw fail('voice.bad_argument', `${name} must be an integer`);
  if (value < min || value > max) {
    throw fail('voice.bad_argument', `${name} must be in [${min}, ${max}], got ${value}`);
  }
}

function normaliseTargets(targets) {
  if (targets == null) return null;
  const channels = targets.channels ?? targets.channelIds ?? [];
  const clients = targets.clients ?? targets.clientIds ?? [];
  if (!Array.isArray(channels) || !Array.isArray(clients)) {
    throw fail('voice.bad_targets', 'targets.channels / targets.clients must be arrays');
  }
  if (channels.length > MAX_WHISPER_TARGETS) {
    throw fail('voice.too_many_targets', `at most ${MAX_WHISPER_TARGETS} channel targets per packet`);
  }
  if (clients.length > MAX_WHISPER_TARGETS) {
    throw fail('voice.too_many_targets', `at most ${MAX_WHISPER_TARGETS} client targets per packet`);
  }
  for (const cid of channels) {
    if ((typeof cid !== 'bigint' && !Number.isSafeInteger(cid)) || cid < 0) {
      throw fail('voice.bad_targets', 'channel ids are unsigned 64-bit integers');
    }
  }
  for (const clid of clients) assertInteger(clid, 'client id', 0, 0xffff);
  return { channels: channels.slice(), clients: clients.slice() };
}

/**
 * Compute the packet-level metadata that belongs to a voice payload.
 *
 * The count byte and the optional trailing byte are announced by flags in the
 * plaintext packet header (docs §3.3); buildVoicePayload cannot put that byte
 * there, so the packet layer must OR these flags into the header byte it builds:
 *
 *   const { type, flags } = voicePacketMeta({ frames, targets });
 *   const payload = buildVoicePayload({ codec, seq, frames, targets });
 *   buildPacket({ type, flags, payload, ... });
 *
 * @returns {{type:number, flags:number, whisper:boolean, countBytePresent:boolean,
 *            extraBytePresent:boolean, packetType:number}}
 */
export function voicePacketMeta({ frames, targets, extra = null, includeCountByte } = {}) {
  const list = Array.isArray(frames) ? frames : [];
  const whisper = targets != null;
  const count = list.length;
  const countBytePresent = includeCountByte ?? count > 1;
  const extraBytePresent = extra != null;
  return {
    type: whisper ? PACKET_TYPE.VOICE_WHISPER : PACKET_TYPE.VOICE,
    packetType: whisper ? PACKET_TYPE.VOICE_WHISPER : PACKET_TYPE.VOICE,
    whisper,
    flags: (countBytePresent ? VOICE_FLAG_COUNT_BYTE : 0) | (extraBytePresent ? VOICE_FLAG_EXTRA_BYTE : 0),
    countBytePresent,
    extraBytePresent,
  };
}

/**
 * Build the plaintext voice payload for one VOICE or VOICE_WHISPER packet.
 *
 * Default `layout: "client"` because this backend is a TS3 *client*: the packet
 * header is then 13 B (tag + packetId + clientId + type/flags) and the payload
 * is the compact form the real server parses. Pass `layout: "server"` (or a
 * `senderClientId`) to build the server -> client form, e.g. for tests/replay.
 *
 * @param {object} opts
 * @param {number} opts.codec            CODEC id (0..5)
 * @param {number} opts.seq              voice sequence number (0..65535, BE16 on wire)
 * @param {Array<Uint8Array|Buffer>} opts.frames  encoded frames; with more than
 *        one frame all frames must have the same byte length unless
 *        `allowUnequalFrames` is set (server asserts voiceDataSize % count == 0)
 * @param {object|null} [opts.targets]   whisper targets `{channels, clients}`;
 *        presence of this argument selects VOICE_WHISPER
 * @param {number} [opts.senderClientId] sender clid, only for layout "server"
 * @param {'client'|'server'} [opts.layout='client']
 * @param {Uint8Array|Buffer|null} [opts.extra] optional 1-byte trailing field (flags bit6)
 * @param {boolean} [opts.includeCountByte] force/omit the u8 frame-count byte;
 *        default: present iff frames.length > 1
 * @param {boolean} [opts.allowUnequalFrames] skip the equal-frame-size check
 * @param {boolean} [opts.ignoreMtu] skip the type size limit (tests only)
 * @returns {Buffer} plaintext payload (without the packet header)
 */
export function buildVoicePayload({
  codec,
  seq,
  frames,
  targets = null,
  senderClientId = null,
  layout = senderClientId != null ? LAYOUT.SERVER : LAYOUT.CLIENT,
  extra = null,
  includeCountByte,
  allowUnequalFrames = false,
  ignoreMtu = false,
} = {}) {
  assertInteger(codec, 'codec', 0, 5);
  assertInteger(seq, 'seq', 0, 0xffff);
  const fields = headerFields(layout);
  if (layout === LAYOUT.SERVER) {
    assertInteger(senderClientId, 'senderClientId', 0, 0xffff);
  } else if (senderClientId != null) {
    throw fail('voice.bad_argument', 'senderClientId is only valid for layout "server"');
  }

  if (!Array.isArray(frames) || frames.length === 0) {
    throw fail('voice.empty_frames', 'frames must be a non-empty array of encoded audio frames');
  }
  if (frames.length > MAX_FRAMES_PER_PACKET) {
    throw fail('voice.too_many_frames', `at most ${MAX_FRAMES_PER_PACKET} frames per packet (server asserts < 256)`);
  }

  const buffers = [];
  for (let i = 0; i < frames.length; i += 1) {
    const buf = toBuffer(frames[i]);
    if (!buf) throw fail('voice.bad_frame', `frame ${i} must be a Buffer/Uint8Array/ArrayBuffer`);
    if (buf.length === 0) throw fail('voice.empty_frame', `frame ${i} is empty`);
    buffers.push(buf);
  }

  if (!allowUnequalFrames && buffers.length > 1) {
    const size = buffers[0].length;
    const uneven = buffers.findIndex((b) => b.length !== size);
    if (uneven >= 0) {
      throw fail(
        'voice.unequal_frames',
        `frames must be equal-sized (frame 0 is ${size} B, frame ${uneven} is ${buffers[uneven].length} B); ` +
          'the server asserts voiceDataSize % numberOfVoicePackets == 0 (docs §4.2)',
      );
    }
  }

  const whisperTargets = normaliseTargets(targets);
  const count = buffers.length;
  const countBytePresent = includeCountByte ?? count > 1;
  let extraBuf = null;
  if (extra != null) {
    extraBuf = toBuffer(extra);
    if (!extraBuf || extraBuf.length !== 1) {
      throw fail('voice.bad_extra', 'extra must be exactly one byte');
    }
  }

  let framesSize = 0;
  for (const b of buffers) framesSize += b.length;

  let whisperSize = 0;
  if (whisperTargets) {
    whisperSize = 2 + whisperTargets.channels.length * 8 + whisperTargets.clients.length * 2;
  }

  const headerSize = fields + (countBytePresent ? 1 : 0);
  const payloadSize = headerSize + whisperSize + framesSize + (extraBuf ? 1 : 0);
  const overhead = layout === LAYOUT.SERVER ? S2C_OVERHEAD : C2S_OVERHEAD;
  const limit = whisperTargets
    ? (layout === LAYOUT.SERVER ? MAX_S2C_WHISPER_PAYLOAD : MAX_WHISPER_PAYLOAD)
    : (layout === LAYOUT.SERVER ? MAX_S2C_VOICE_PAYLOAD : MAX_VOICE_PAYLOAD);
  if (!ignoreMtu && payloadSize > limit) {
    throw fail(
      'voice.payload_too_large',
      `voice payload is ${payloadSize} B, exceeds ${limit} B ` +
        `(${whisperTargets ? 'VOICE_WHISPER' : 'VOICE'} datagram limit ` +
        `${whisperTargets ? MTU_WHISPER : MTU_VOICE} B - ${overhead} B packet framing); split frames into more packets`,
    );
  }

  const out = Buffer.allocUnsafe(payloadSize);
  let off = 0;
  out.writeUInt16BE(seq, off); // voice sequence number, big endian (docs §4.1)
  off += 2;
  if (layout === LAYOUT.SERVER) {
    out.writeUInt16BE(senderClientId, off); // sender client id, s2c payload only
    off += 2;
  }
  out[off] = codec; // codec id
  off += 1;
  // Frame-count byte: present only when the packet header's flags bit4 (0x10)
  // is set; omitted for the single-frame 20 ms packet (ctor adjust logic).
  if (countBytePresent) {
    out[off] = count;
    off += 1;
  }
  if (whisperTargets) {
    out[off] = whisperTargets.channels.length;
    out[off + 1] = whisperTargets.clients.length;
    off += 2;
    for (const cid of whisperTargets.channels) {
      out.writeBigUInt64BE(BigInt(cid), off); // channel ids: 64-bit big endian
      off += 8;
    }
    for (const clid of whisperTargets.clients) {
      out.writeUInt16BE(clid, off); // client ids: 16-bit big endian
      off += 2;
    }
  }
  for (const b of buffers) {
    b.copy ? b.copy(out, off) : out.set(b, off);
    off += b.length;
  }
  if (extraBuf) {
    out[off] = extraBuf[0];
    off += 1;
  }
  return out;
}

/**
 * Parse a plaintext voice payload back into fields.
 *
 * Default `layout: "server"` because this backend receives server -> client
 * packets whose payload begins with the sender's client id.
 *
 * @param {Uint8Array|Buffer|ArrayBuffer} input
 * @param {object} [opts]
 * @param {'client'|'server'} [opts.layout='server']
 * @param {number} [opts.flags]      packet header flags: bit4/0x10 => count byte
 *        present, bit6/0x40 => trailing byte present, low nibble 1 => whisper
 *        (docs §3.3)
 * @param {number} [opts.packetType] explicit packet type (0=VOICE, 1=WHISPER)
 * @param {boolean} [opts.countBytePresent] explicit override when flags are unavailable
 * @param {boolean} [opts.extraBytePresent] explicit override when flags are unavailable
 * @param {boolean} [opts.whisper]   explicit override when flags are unavailable
 * @param {number} [opts.payloadOffset=0] skip N bytes (e.g. if the caller hands
 *        over a slice with a prefix) before the voice payload starts
 * @returns {{codec:number, seq:number, senderClientId:number|null,
 *            frames:Buffer[], targets:{channels:Array<number|bigint>, clients:number[]}|null,
 *            count:number, countBytePresent:boolean, extra:number|null,
 *            extraBytePresent:boolean, whisper:boolean, packetType:number,
 *            layout:string, flags:number}}
 */
export function parseVoicePayload(input, opts = {}) {
  const buf = toBuffer(input);
  if (!buf) throw fail('voice.bad_input', 'payload must be a Buffer/Uint8Array/ArrayBuffer');

  const layout = opts.layout ?? LAYOUT.SERVER;
  const fields = headerFields(layout);
  const flags = Number.isInteger(opts.flags) ? opts.flags : null;
  const packetType =
    Number.isInteger(opts.packetType) ? opts.packetType : flags != null ? flags & 0x0f : PACKET_TYPE.VOICE;
  const whisper = opts.whisper ?? packetType === PACKET_TYPE.VOICE_WHISPER;
  const countBytePresent = opts.countBytePresent ?? (flags != null ? (flags & VOICE_FLAG_COUNT_BYTE) !== 0 : false);
  const extraBytePresent = opts.extraBytePresent ?? (flags != null ? (flags & VOICE_FLAG_EXTRA_BYTE) !== 0 : false);

  const off = opts.payloadOffset ?? 0;
  if (!Number.isInteger(off) || off < 0) throw fail('voice.bad_input', 'payloadOffset must be a non-negative integer');
  if (buf.length < off + fields) {
    throw fail('voice.truncated', `payload is ${buf.length - off} B, need at least ${fields} B for the voice header`);
  }

  let p = off;
  const seq = buf.readUInt16BE(p); // big endian, docs §4.1
  p += 2;
  let senderClientId = null;
  if (layout === LAYOUT.SERVER) {
    senderClientId = buf.readUInt16BE(p); // s2c payload only
    p += 2;
  }
  const codec = buf[p];
  p += 1;
  if (codec > 5) {
    throw fail('voice.bad_codec', `codec byte ${codec} is outside the known range 0..5 (layout/flags mismatch?)`);
  }

  let count = 1;
  if (countBytePresent) {
    if (p >= buf.length) throw fail('voice.truncated', 'frame-count byte announced by flags is missing');
    count = buf[p];
    p += 1;
    if (count === 0) throw fail('voice.bad_count', 'numberVoicePackets must be > 0');
  }

  let targets = null;
  if (whisper) {
    if (p + 2 > buf.length) throw fail('voice.truncated', 'whisper target-list header is truncated');
    const channelCount = buf[p];
    const clientCount = buf[p + 1];
    p += 2;
    const need = channelCount * 8 + clientCount * 2;
    if (p + need > buf.length) throw fail('voice.truncated', 'whisper target lists are truncated');
    const channels = [];
    for (let i = 0; i < channelCount; i += 1) {
      const cid = buf.readBigUInt64BE(p);
      p += 8;
      channels.push(cid <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cid) : cid);
    }
    const clients = [];
    for (let i = 0; i < clientCount; i += 1) {
      clients.push(buf.readUInt16BE(p));
      p += 2;
    }
    targets = { channels, clients };
  }

  let extra = null;
  let dataEnd = buf.length;
  if (extraBytePresent) {
    if (dataEnd <= p) throw fail('voice.truncated', 'trailing byte announced by flags is missing');
    dataEnd -= 1;
    extra = buf[dataEnd];
  }

  const dataSize = dataEnd - p;
  if (dataSize < 0) throw fail('voice.truncated', 'voice data size is negative');
  if (count > 1 && dataSize % count !== 0) {
    throw fail(
      'voice.uneven_frames',
      `voice data is ${dataSize} B for ${count} frames (server asserts voiceDataSize % numberVoicePackets == 0); ` +
        'the frame-count byte or the packet flags are out of sync',
    );
  }
  const frameSize = dataSize === 0 ? 0 : Math.floor(dataSize / count);
  const frames = [];
  if (dataSize > 0) {
    for (let i = 0; i < count; i += 1) {
      const start = p + i * frameSize;
      frames.push(buf.subarray(start, start + frameSize));
    }
  }

  return {
    codec,
    seq,
    senderClientId,
    // Backwards-compatible alias: offset 2..3 of the s2c payload.
    secondary: senderClientId,
    frames,
    targets,
    count,
    countBytePresent,
    extra,
    extraBytePresent,
    whisper,
    packetType,
    layout,
    flags: flags ?? 0,
  };
}

/**
 * Split a list of encoded frames into MTU-safe frame groups.
 *
 * Opus frames are variable length, so packet boundaries have to be computed
 * from the *actual* encoded sizes. Returns arrays of frames suitable for
 * buildVoicePayload().
 *
 * @param {Array<Uint8Array|Buffer>} frames
 * @param {{whisper?:boolean, layout?:'client'|'server', maxPayload?:number}} [opts]
 * @returns {Array<Array<Buffer>>}
 */
export function groupFramesByMtu(frames, { whisper = false, layout = LAYOUT.CLIENT, maxPayload } = {}) {
  if (!Array.isArray(frames)) throw fail('voice.bad_argument', 'frames must be an array');
  const limit =
    maxPayload ??
    (whisper
      ? layout === LAYOUT.SERVER
        ? MAX_S2C_WHISPER_PAYLOAD
        : MAX_WHISPER_PAYLOAD
      : layout === LAYOUT.SERVER
        ? MAX_S2C_VOICE_PAYLOAD
        : MAX_VOICE_PAYLOAD);
  const baseHeader = headerFields(layout) + 1; // worst case: fields + count byte
  const groups = [];
  let current = [];
  let size = baseHeader;
  for (const frame of frames) {
    const buf = toBuffer(frame);
    if (!buf || buf.length === 0) throw fail('voice.bad_frame', 'every frame must be a non-empty Buffer');
    if (current.length >= MAX_FRAMES_PER_PACKET || size + buf.length > limit) {
      if (current.length === 0) {
        throw fail('voice.payload_too_large', `a single ${buf.length} B frame does not fit into ${limit} B`);
      }
      groups.push(current);
      current = [];
      size = baseHeader;
    }
    current.push(buf);
    size += buf.length;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}