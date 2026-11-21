// TS3 UDP connection: handshake, per-packet encryption, reliability (packet
// ids, ACKs, retransmission, fragment reassembly, QuickLZ), command channel and
// event dispatch.
//
// Wire/flow facts are pinned by docs/protocol.md, docs/ghidra/* and the real
// client capture in test/capture/handshake-2026-11-21.log.

import { EventEmitter } from 'node:events';
import dgram from 'node:dgram';
import { randomBytes } from 'node:crypto';
import * as crypto from './crypto.js';
import {
  PacketType,
  PacketFlags,
  buildPacket,
  parsePacket,
  isInitPacket,
  bodyMtu,
  packetIdDiff,
  TAG_LENGTH,
  S2C_HEADER_LENGTH,
} from './packet.js';
import * as handshake from './handshake.js';
import { encodeCommand, parseCommand, splitRows, parseError } from './command.js';
import { buildVoicePayload, parseVoicePayload, voicePacketMeta } from './voice.js';

const SIGNAL = Symbol('signal');
const INIT_TYPES = new Set([PacketType.INIT1]);
const UNENCRYPTED_TYPES = new Set([
  PacketType.ACK,
  PacketType.ACK_LOW,
  PacketType.PING,
  PacketType.PONG,
  PacketType.VOICE,
  PacketType.VOICE_WHISPER,
]);

/** Resend intervals for unacknowledged command/init packets (ms). */
const RESEND_INTERVAL_MS = 600;
const MAX_RESENDS = 8;
const COMMAND_TIMEOUT_MS = 10000;
const HANDSHAKE_TIMEOUT_MS = 15000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Ts3Connection extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.host
   * @param {number} o.port
   * @param {object} o.identity        result of handshake.createIdentity()
   * @param {number} [o.voiceCodec]    4=Opus voice, 5=Opus music
   * @param {number} [o.voiceQuality]  0..10
   * @param {boolean} [o.verbose]
   */
  constructor({ host, port = 9987, identity, voiceCodec = 4, voiceQuality = 10, verbose = false }) {
    super();
    this.host = host;
    this.port = port;
    this.identity = identity ?? handshake.createIdentity();
    this.voiceCodec = voiceCodec;
    this.voiceQuality = voiceQuality;
    this.verbose = verbose;

    this.socket = null;
    this.connected = false;
    this.closing = false;

    /** @type {{iv: Buffer, mac: Buffer}|null} */
    this.session = null;
    this.clientId = 0;
    this.serverName = '';
    this.selfClid = 0;

    this.counters = new Map(); // type -> {id, gen}
    this.pendingAcks = new Map(); // `${type}:${id}` -> {datagram, timer, tries}
    this.seenCommands = new Map(); // type -> Set(id)
    this.ackQueue = [];
    this.reassembling = new Map(); // type -> {chunks, firstId, compressed}
    this.expectedIncoming = new Map(); // type -> id
    this.incomingQueue = new Map(); // type -> Map(id -> packet)

    /** handshake / control command inbox */
    this.controlQueue = [];
    this.controlWaiters = [];
    this.handshakeStep = { init1: null, command: null };

    /** single in-flight client command: replies arrive in order */
    this.commandChain = Promise.resolve();
    this.pendingReply = null;

    this.stats = {
      sentBytes: 0,
      recvBytes: 0,
      sentPackets: 0,
      recvPackets: 0,
      ping: 0,
      loss: 0,
      startedAt: 0,
    };
    this.pingSentAt = new Map();
    this.lastPing = 0;
    this.pingTimer = null;
    this.pingStats = { sent: 0, answered: 0 };
    /** Whisper targets recorded by setWhisperTargets, used by sendVoice. */
    this.whisper = { targets: null, active: false };
    this.voiceSeq = 0;
    this.connectedAt = 0;
    this.serverInfoRaw = {};
    this.neededPermissions = [];
  }

  log(level, text) {
    if (level === 'debug' && !this.verbose) return;
    this.emit('log', { level, text });
  }

  // ── socket & lifecycle ────────────────────────────────────────────────────

  async bind() {
    this.socket = dgram.createSocket('udp4');
    this.socket.on('message', (msg) => this.onDatagram(msg));
    this.socket.on('error', (err) => {
      this.log('error', `UDP socket error: ${err.message}`);
      this.emit('error', err);
    });
    await new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind(0, '0.0.0.0', () => {
        this.socket.removeListener('error', reject);
        resolve();
      });
    });
  }

  /**
   * Handshake, register the client and wait for initserver.
   * @param {string} nickname
   * @param {object} [options] {channelId, channelPassword, serverPassword, privilegeKey}
   */
  async connect(nickname, options = {}) {
    this.stats.startedAt = Date.now();
    await this.bind();
    this.emit('state', { phase: 'handshaking' });
    try {
      const session = await this.runInit1();
      this.session = { iv: session.iv, mac: session.mac };
      this.log('info', `crypto established (iv ${session.iv.length}B, mac ${session.mac.toString('hex')})`);
      this.emit('state', { phase: 'handshaking', detail: 'crypto established' });

      const clientInit = handshake.buildClientInit({
        nickname,
        identity: this.identity,
        channelId: options.channelId,
        channelPassword: options.channelPassword,
        serverPassword: options.serverPassword,
        privilegeKey: options.privilegeKey,
      });
      await this.sendCommandPacket(clientInit, { waitAck: false });

      const initServer = await this.waitControlCommand('initserver', HANDSHAKE_TIMEOUT_MS);
      const parsed = handshake.parseInitServer(initServer.params);
      this.clientId = parsed.clientId;
      this.selfClid = parsed.clientId;
      this.serverName = parsed.serverName;
      this.serverInfoRaw = parsed.raw;
      this.connectedAt = Date.now();
      this.connected = true;
      this.log('info', `initserver: clid=${this.clientId} name=${JSON.stringify(this.serverName)}`);
      this.emit('state', { phase: 'connected' });
      this.startPingLoop();
      await this.waitWelcome();
      return parsed;
    } catch (err) {
      this.emit('state', { phase: 'error', error: err.message });
      throw err;
    }
  }

  /**
   * Wait for the server's unprompted welcome sequence (it ends with
   * channellistfinished) so the first snapshot is complete.
   */
  async waitWelcome(timeoutMs = 3000) {
    if (this.welcomeComplete) return;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      const onEvent = ({ type }) => {
        if (type !== 'channellistfinished') return;
        clearTimeout(timer);
        this.off('event', onEvent);
        resolve();
      };
      this.on('event', onEvent);
    });
  }

  /**
   * Snapshot assembled from the welcome push and subsequent notifications; the
   * voice protocol keeps clients current through events rather than queries.
   */
  snapshot() {
    const channelRows = this.welcome?.channellist ?? [];
    const channels = channelRows.map((row) => ({
      cid: Number.parseInt(row.cid ?? '0', 10),
      pid: Number.parseInt(row.cpid ?? '0', 10),
      name: row.channel_name ?? '',
      order: Number.parseInt(row.channel_order ?? '0', 10),
      codec: Number.parseInt(row.channel_codec ?? '4', 10),
      codecQuality: Number.parseInt(row.channel_codec_quality ?? '0', 10),
      neededTalkPower: Number.parseInt(row.channel_needed_talk_power ?? '0', 10),
      maxClients: Number.parseInt(row.channel_maxclients ?? '-1', 10),
      totalClients: Number.parseInt(row.channel_total_clients ?? '-1', 10),
      hasPassword: row.channel_flag_password === '1',
      encrypted: row.channel_codec_is_unencrypted === '0',
      isDefault: row.channel_flag_default === '1',
    }));
    const clients = [];
    for (const client of (this.clientState ?? new Map()).values()) {
      clients.push({
        clid: client.clid,
        cid: client.cid,
        nickname: client.nickname,
        type: client.type,
        isSelf: client.clid === this.selfClid,
        muted: client.muted,
        deafened: client.deafened,
        away: client.away,
        recording: client.recording,
      });
    }
    return { serverName: this.serverName, channels, clients, self: this.selfInfo };
  }

  /** Tell the server we are leaving (it frees the slot at once) and close. */
  async disconnect() {
    if (this.connected && this.socket) {
      try {
        const buffer = encodeCommand('clientdisconnect', {});
        this.sendCommandFragments(buffer, false);
        await new Promise((resolve) => setTimeout(resolve, 120));
      } catch {
        // best effort: close anyway
      }
    }
    this.close();
  }

  close() {
    if (this.closing) return;
    this.closing = true;
    this.connected = false;
    if (this.pingTimer) clearInterval(this.pingTimer);
    for (const pending of this.pendingAcks.values()) clearTimeout(pending.timer);
    this.pendingAcks.clear();
    try {
      this.socket?.close();
    } catch {
      // already closed
    }
    this.emit('state', { phase: 'disconnected' });
  }

  // ── INIT1 handshake ───────────────────────────────────────────────────────

  async runInit1() {
    // step 0: version + timestamp + random0, exactly 34 bytes
    let response = await this.initExchange(handshake.buildInit1Start(), (payload) => {
      return payload.length >= 21 && payload[0] === 0x01;
    });
    const s2cInit1 = response;

    // step 2: echo random1/random0_r
    response = await this.initExchange(handshake.buildInit1Step2(s2cInit1), (payload) => {
      return payload.length >= 233 && payload[0] === 0x03;
    });
    const puzzle = handshake.parseInit1Step3(response);
    this.log(
      'info',
      `RSA puzzle: level=${puzzle.level} x=${puzzle.x.toString('hex').slice(0, 16)}…`,
    );

    // step 4: solve the puzzle and send clientinitiv
    const alpha = randomBytes(10);
    const step4 = handshake.buildInit1Step4({ puzzle, alpha, identity: this.identity });
    if (step4.payload.length <= 301) throw new Error('init4 payload too short');
    await this.sendInitPacket(step4.payload);

    // the server answers with either initivexpand2 (3.13+) or initivexpand
    const command = await this.waitControlCommand(null, HANDSHAKE_TIMEOUT_MS);
    let session;
    if (command.name === 'initivexpand2') {
      session = handshake.deriveInitivexpand2Session({ identity: this.identity, alpha, params: command.params });
      const clientEk = handshake.buildClientEk({
        identity: this.identity,
        beta: session.beta,
        ephemeralPublicKey: session.ephemeralPublicKey,
      });
      this.session = { iv: session.iv, mac: session.mac };
      await this.sendCommandPacket(clientEk, { waitAck: false, forceFake: true });
    } else if (command.name === 'initivexpand') {
      session = handshake.deriveLegacySession({ identity: this.identity, params: command.params });
      this.session = { iv: session.iv, mac: session.mac };
    } else {
      throw new Error(`unexpected handshake command ${JSON.stringify(command.name)}`);
    }
    return session;
  }

  /** Send one INIT1 payload and wait for the matching server step, resending. */
  async initExchange(payload, predicate) {
    const deadline = Date.now() + HANDSHAKE_TIMEOUT_MS;
    let resendAt = Date.now() + RESEND_INTERVAL_MS;
    await this.sendInitPacket(payload);
    for (;;) {
      const packet = await this.waitInit1(200);
      if (packet) return packet;
      if (Date.now() > deadline) throw new Error('INIT1 handshake timed out');
      if (Date.now() >= resendAt) {
        this.log('debug', 'resending INIT1 step');
        await this.sendInitPacket(payload);
        resendAt = Date.now() + RESEND_INTERVAL_MS;
      }
    }
  }

  async sendInitPacket(payload) {
    const datagram = buildPacket({
      direction: 'c2s',
      type: PacketType.INIT1,
      flags: PacketFlags.UNENCRYPTED,
      packetId: handshake.INIT1_PACKET_ID,
      clientId: 0,
      payload,
      mac: Buffer.from('TS3INIT1', 'ascii'),
    });
    this.sendRaw(datagram);
  }

  // ── packet encryption ─────────────────────────────────────────────────────

  nextPacketId(type) {
    let entry = this.counters.get(type);
    if (!entry) {
      const initial = type === PacketType.COMMAND || type === PacketType.COMMAND_LOW ? 1 : 0;
      entry = { id: initial, gen: 0 };
      this.counters.set(type, entry);
    }
    return { id: entry.id, gen: entry.gen };
  }

  advancePacketId(type) {
    const entry = this.counters.get(type);
    if (!entry) return;
    entry.id = (entry.id + 1) & 0xffff;
    if (entry.id === 0) entry.gen++;
  }

  /**
   * Encrypt and build one datagram.
   * @param {object} o
   */
  encryptPacket({ type, flags = 0, packetId, payload, forceFake = false }) {
    const session = this.session;
    const header = Buffer.alloc(5);
    header.writeUInt16BE(packetId & 0xffff, 0);
    header.writeUInt16BE(this.clientId & 0xffff, 2);
    header[4] = (type & 0x0f) | (flags & 0xf0);

    if (type === PacketType.INIT1) {
      return buildPacket({
        direction: 'c2s',
        type,
        flags,
        packetId,
        clientId: 0,
        payload,
        mac: Buffer.from('TS3INIT1', 'ascii'),
      });
    }

    if (
      type === PacketType.COMMAND ||
      type === PacketType.COMMAND_LOW ||
      type === PacketType.VOICE ||
      type === PacketType.VOICE_WHISPER
    ) {
      const useFake = forceFake || !session;
      const key = useFake ? crypto.FAKE_KEY : session.iv;
      let tag;
      if (useFake) {
        tag = crypto.eaxEncrypt({ key: crypto.FAKE_KEY, nonce: crypto.FAKE_NONCE, header, plaintext: payload });
      } else {
        const { key: k, nonce } = crypto.derivePacketKey({
          iv: session.iv,
          packetType: type,
          generationId: this.counters.get(type)?.gen ?? 0,
          fromServer: false,
          packetId,
        });
        tag = crypto.eaxEncrypt({ key: k, nonce, header, plaintext: payload });
      }
      const out = Buffer.concat([tag.subarray(0, TAG_LENGTH), header, tag.subarray(TAG_LENGTH)]);
      return out;
    }

    // ACK / PING / PONG: unencrypted payload with the shared MAC (or zeros
    // before the handshake), exactly like the real client.
    const mac = session ? session.mac : Buffer.alloc(TAG_LENGTH);
    return Buffer.concat([mac, header, payload]);
  }

  decryptPacket(datagram) {
    const parsed = parsePacket(datagram, 's2c');
    if (!parsed) return null;
    if (parsed.type === PacketType.INIT1) return { ...parsed, plaintext: parsed.payload };

    const header = datagram.subarray(TAG_LENGTH, TAG_LENGTH + S2C_HEADER_LENGTH);
    const tag = parsed.tag;
    const ciphertext = parsed.payload;
    const session = this.session;
    const unencrypted = (parsed.flags & PacketFlags.UNENCRYPTED) !== 0;

    if (unencrypted) {
      if (session && !tag.equals(session.mac)) {
        this.log('debug', `bad shared MAC on unencrypted packet type=${parsed.type}`);
        return null;
      }
      return { ...parsed, plaintext: ciphertext };
    }

    // Try the real keys first once the session exists, then the public dummy
    // key: the server's first ACK (of clientek) is still dummy-encrypted.
    if (session) {
      const { key, nonce } = crypto.derivePacketKey({
        iv: session.iv,
        packetType: parsed.type,
        generationId: 0,
        fromServer: true,
        packetId: parsed.packetId,
      });
      const plaintext = crypto.eaxDecrypt({ key, nonce, header, ciphertext, tag });
      if (plaintext) return { ...parsed, plaintext };
    }
    const plaintext = crypto.eaxDecrypt({
      key: crypto.FAKE_KEY,
      nonce: crypto.FAKE_NONCE,
      header,
      ciphertext,
      tag,
    });
    if (plaintext) return { ...parsed, plaintext };
    this.log('debug', `cannot decrypt packet type=${parsed.type} id=${parsed.packetId}`);
    return null;
  }

  // ── receive path ──────────────────────────────────────────────────────────

  onDatagram(datagram) {
    this.stats.recvBytes += datagram.length;
    this.stats.recvPackets++;
    if (this.verbose) {
      this.log(
        'debug',
        `<- raw ${datagram.length}B ${datagram.subarray(0, Math.min(16, datagram.length)).toString('hex')}`,
      );
    }

    if (isInitPacket(datagram)) {
      const headerLen = S2C_HEADER_LENGTH;
      const payload = datagram.subarray(TAG_LENGTH + headerLen);
      this.dispatchInit1(payload);
      return;
    }
    const packet = this.decryptPacket(datagram);
    if (!packet) return;

    switch (packet.type) {
      case PacketType.PING:
        this.sendPong(packet.packetId);
        return;
      case PacketType.PONG:
        this.onPong(packet);
        return;
      case PacketType.ACK:
      case PacketType.ACK_LOW:
        this.onAckPacket(packet);
        return;
      case PacketType.COMMAND:
      case PacketType.COMMAND_LOW:
        this.onCommandPacket(packet);
        return;
      case PacketType.VOICE:
      case PacketType.VOICE_WHISPER:
        this.onVoicePacket(packet);
        return;
      default:
        return;
    }
  }

  dispatchInit1(payload) {
    this.handshakeStep.init1 = payload;
    this.wakeInit1Waiters();
  }

  wakeInit1Waiters() {
    for (const waiter of [...this.init1Waiters ?? []]) waiter();
  }

  waitInit1(timeoutMs) {
    if (this.handshakeStep.init1) {
      const payload = this.handshakeStep.init1;
      this.handshakeStep.init1 = null;
      return Promise.resolve(payload);
    }
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        this.init1Waiters = (this.init1Waiters ?? []).filter((w) => w !== check);
        resolve(null);
      }, timeoutMs);
      const check = () => {
        if (done) return;
        if (this.handshakeStep.init1) {
          done = true;
          clearTimeout(timer);
          const payload = this.handshakeStep.init1;
          this.handshakeStep.init1 = null;
          this.init1Waiters = (this.init1Waiters ?? []).filter((w) => w !== check);
          resolve(payload);
        }
      };
      this.init1Waiters = [...(this.init1Waiters ?? []), check];
    });
  }

  onAckPacket(packet) {
    const ackedId = packet.plaintext.length >= 2 ? packet.plaintext.readUInt16BE(0) : -1;
    this.log('debug', `<- ack type=${packet.type} ackedId=${ackedId} pid=${packet.packetId}`);
    if (ackedId >= 0) this.clearPendingAck(packet.type === PacketType.ACK_LOW ? PacketType.COMMAND_LOW : PacketType.COMMAND, ackedId);
    this.emit('ack', { type: packet.type, id: ackedId });
  }

  onPong(packet) {
    const id = packet.plaintext.length >= 2 ? packet.plaintext.readUInt16BE(0) : -1;
    const sent = this.pingSentAt.get(id);
    if (sent) {
      this.stats.ping = Date.now() - sent;
      this.pingSentAt.delete(id);
      this.pingStats.answered++;
    }
  }

  onCommandPacket(packet) {
    // ACK every command packet, duplicates included (the server resends until
    // it sees the ack).
    this.sendAck(packet.type === PacketType.COMMAND ? PacketType.ACK : PacketType.ACK_LOW, packet.packetId);

    const payload = this.reassemble(packet);
    if (!payload) return;

    const text = payload.toString('utf8');
    if (this.verbose) this.log('debug', `<- ${text.slice(0, 200)}`);
    this.handleCommandText(text);
  }

  /** Reassemble fragmented command packets and decompress the result. */
  reassemble(packet) {
    const type = packet.type;
    const fragmented = (packet.flags & PacketFlags.FRAGMENTED) !== 0;
    let payload = packet.plaintext;

    const pending = this.reassembling.get(type);
    if (!pending) {
      if (!fragmented) {
        return this.maybeDecompress(packet.flags, payload);
      }
      this.reassembling.set(type, {
        chunks: [payload],
        ids: new Set([packet.packetId]),
        startedAt: Date.now(),
        compressed: (packet.flags & PacketFlags.COMPRESSED) !== 0,
      });
      return null;
    }
    if (Date.now() - pending.startedAt > 5000) {
      this.reassembling.delete(type);
      this.log('warn', 'dropping a stale fragment sequence');
      return null;
    }
    if (pending.ids.has(packet.packetId)) {
      // A retransmitted fragment: already collected in order, skip it.
      return null;
    }
    pending.ids.add(packet.packetId);
    pending.chunks.push(payload);
    if (fragmented) {
      // the last fragment carries the fragmented flag too
      const chunks = pending.chunks;
      this.reassembling.delete(type);
      payload = Buffer.concat(chunks);
      return this.maybeDecompress(pending.compressed ? PacketFlags.COMPRESSED : 0, payload);
    }
    return null;
  }

  maybeDecompress(flags, payload) {
    if ((flags & PacketFlags.COMPRESSED) === 0) return payload;
    try {
      return quicklzDecompress(payload);
    } catch (err) {
      this.log('warn', `QuickLZ decompression failed: ${err.message}`);
      return null;
    }
  }

  handleCommandText(text) {
    const { name, rows } = splitRows(text);
    if (name === '') {
      // data rows of the command in flight
      if (this.pendingReply) this.pendingReply.rows.push(...rows);
      return;
    }
    if (name === 'error') {
      const error = parseError(text);
      if (this.pendingReply) {
        const reply = this.pendingReply;
        this.pendingReply = null;
        clearTimeout(reply.timer);
        if (error && error.id !== 0) reply.reject(new Error(`server error ${error.id}: ${error.message}`));
        else reply.resolve({ rows: reply.rows, error });
      }
      return;
    }
    if (name.startsWith('notify')) {
      this.emitEvent(name, rows, text);
      return;
    }
    if (name === 'initserver' || name === 'initivexpand2' || name === 'initivexpand' || name === 'clientinitiv') {
      this.pushControl({ name, params: rows[0] ?? {} });
      return;
    }
    // Named rows (e.g. the welcome sequence's channellist) belong to the
    // command in flight; keep them as data.
    if (this.pendingReply) {
      this.pendingReply.rows.push(...rows);
      return;
    }
    // Unprompted data of the welcome sequence: keep the latest rows so callers
    // that lack the permission to ask again still get the snapshot.
    if (!name.startsWith('notify')) {
      this.welcome ??= {};
      this.welcome[name] = rows;
    }
    this.emitEvent(name, rows, text);
  }

  emitEvent(name, rows, text) {
    if (name === 'channellistfinished') {
      this.welcomeComplete = true;
      this.emit('event', { type: 'channellistfinished', data: {} });
      return;
    }
    if (name === 'channellist') {
      // A channel row batch of the welcome sequence, or a channel edit event.
      const type = 'channellist';
      this.emit('event', { type, data: { rows } });
      return;
    }
    const type = name.replace(/^notify/, '');
    for (const data of rows) {
      this.trackEvent(type, data);
      this.emit('event', { type, data });
    }
  }

  /** Keep the client roster current from notifications. */
  trackEvent(type, data) {
    this.clientState ??= new Map();
    const clid = Number.parseInt(data.clid ?? '0', 10);
    switch (type) {
      case 'cliententerview': {
        if (!clid) return;
        this.clientState.set(clid, {
          clid,
          cid: Number.parseInt(data.ctid ?? '0', 10),
          nickname: data.client_nickname ?? '',
          type: Number.parseInt(data.client_type ?? '0', 10),
          muted: data.client_input_muted === '1',
          deafened: data.client_outputonly_muted === '1',
          away: data.client_away === '1',
          recording: data.client_recording === '1',
        });
        if (clid === this.selfClid) this.selfInfo = this.clientState.get(clid);
        return;
      }
      case 'clientleftview': {
        if (clid) this.clientState.delete(clid);
        return;
      }
      case 'clientneededpermissions': {
        if (Object.keys(data).length > 0) this.neededPermissions.push(data);
        return;
      }
      case 'clientupdated': {
        const client = this.clientState.get(clid);
        if (!client) return;
        if (data.client_nickname !== undefined) client.nickname = data.client_nickname;
        if (data.cid !== undefined) client.cid = Number.parseInt(data.cid, 10);
        if (data.client_input_muted !== undefined) client.muted = data.client_input_muted === '1';
        if (data.client_outputonly_muted !== undefined) client.deafened = data.client_outputonly_muted === '1';
        if (data.client_away !== undefined) client.away = data.client_away === '1';
        if (clid === this.selfClid) this.selfInfo = client;
        return;
      }
      default:
        return;
    }
  }

  pushControl(command) {
    this.controlQueue.push(command);
    for (const waiter of [...this.controlWaiters]) waiter();
  }

  /** Wait for a control command (initivexpand2/initserver); name null matches any. */
  waitControlCommand(name, timeoutMs) {
    const take = () => {
      const index = this.controlQueue.findIndex((c) => name === null || c.name === name);
      if (index === -1) return null;
      return this.controlQueue.splice(index, 1)[0];
    };
    const immediate = take();
    if (immediate) return Promise.resolve(immediate);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.controlWaiters = this.controlWaiters.filter((w) => w !== check);
        reject(new Error(`timed out waiting for ${name ?? 'handshake command'}`));
      }, timeoutMs);
      const check = () => {
        const command = take();
        if (!command) return;
        clearTimeout(timer);
        this.controlWaiters = this.controlWaiters.filter((w) => w !== check);
        resolve(command);
      };
      this.controlWaiters.push(check);
    });
  }

  // ── send path ─────────────────────────────────────────────────────────────

  sendRaw(datagram) {
    if (!this.socket || this.closing) return;
    this.stats.sentBytes += datagram.length;
    this.stats.sentPackets++;
    this.socket.send(datagram, this.port, this.host);
  }

  sendAck(type, packetId) {
    // ACKs are not encrypted payloads: after the handshake they carry the
    // shared MAC with the unencrypted flag; before it they must be dummy-key
    // EAX like every other packet that is not flagged unencrypted, otherwise
    // the server cannot authenticate them and keeps resending its command
    // until it drops the connection ("15 resends").
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(packetId & 0xffff, 0);
    const { id } = this.nextPacketId(type);
    this.advancePacketId(type);
    this.sendRaw(this.buildUnencryptedOrFake(type, id, payload));
  }

  /**
   * Build a packet that carries no encrypted payload: dummy-key EAX before the
   * session exists, shared-MAC + unencrypted flag afterwards.
   */
  buildUnencryptedOrFake(type, packetId, payload) {
    const header = Buffer.alloc(5);
    header.writeUInt16BE(packetId & 0xffff, 0);
    header.writeUInt16BE(this.clientId & 0xffff, 2);
    if (this.session) {
      header[4] = (type & 0x0f) | PacketFlags.UNENCRYPTED;
      return Buffer.concat([this.session.mac, header, payload]);
    }
    header[4] = type & 0x0f;
    const sealed = crypto.eaxEncrypt({
      key: crypto.FAKE_KEY,
      nonce: crypto.FAKE_NONCE,
      header,
      plaintext: payload,
    });
    return Buffer.concat([sealed.subarray(0, TAG_LENGTH), header, sealed.subarray(TAG_LENGTH)]);
  }

  sendPong(pingPacketId) {
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(pingPacketId & 0xffff, 0);
    this.sendRaw(this.buildUnencryptedOrFake(PacketType.PONG, pingPacketId, payload));
  }

  /**
   * Build, send and track a command packet (possibly fragmented).
   * @returns {Promise<number>} the first packet id
   */
  async sendCommandPacket(buffer, { waitAck = true, forceFake = false } = {}) {
    const { id: firstId } = await this.sendCommandFragments(buffer, forceFake);
    if (waitAck) await this.waitForAck(PacketType.COMMAND, firstId, COMMAND_TIMEOUT_MS);
    return firstId;
  }

  sendCommandFragments(buffer, forceFake) {
    const maxBody = bodyMtu(false, 'c2s');
    const chunks = [];
    if (buffer.length <= maxBody) {
      chunks.push({ data: buffer, fragmented: false });
    } else {
      for (let pos = 0; pos < buffer.length; pos += maxBody) {
        const data = buffer.subarray(pos, Math.min(pos + maxBody, buffer.length));
        chunks.push({ data, index: chunks.length });
      }
      // TeamSpeak marks the first and the last fragment with FRAGMENTED; the
      // fragments in between carry no flag. The receiver ends the sequence at
      // the next flagged packet, so flagging every fragment would truncate the
      // command.
      chunks.forEach((chunk, index) => {
        chunk.fragmented = index === 0 || index === chunks.length - 1;
      });
    }
    const ids = [];
    for (let i = 0; i < chunks.length; i++) {
      const { id, gen } = this.nextPacketId(PacketType.COMMAND);
      const flags =
        PacketFlags.NEW_PROTOCOL | (chunks[i].fragmented ? PacketFlags.FRAGMENTED : 0);
      const datagram = this.encryptPacket({
        type: PacketType.COMMAND,
        flags,
        packetId: id,
        payload: chunks[i].data,
        forceFake,
      });
      this.advancePacketId(PacketType.COMMAND);
      if (i === 0) ids.push(id);
      this.trackPending({
        type: PacketType.COMMAND,
        packetId: id,
        gen,
        datagram,
      });
      this.sendRaw(datagram);
    }
    return { ids, firstId: ids[0] };
  }

  trackPending({ type, packetId, gen, datagram }) {
    const key = `${type}:${packetId}`;
    const timer = setTimeout(() => this.resendPending(key), RESEND_INTERVAL_MS);
    timer.unref?.();
    this.pendingAcks.set(key, { datagram, timer, tries: 0, type, packetId });
  }

  resendPending(key) {
    const pending = this.pendingAcks.get(key);
    if (!pending) return;
    pending.tries++;
    if (pending.tries > MAX_RESENDS) {
      this.pendingAcks.delete(key);
      this.log('warn', `giving up on packet ${key}`);
      return;
    }
    this.log('debug', `resending packet ${key} (try ${pending.tries})`);
    this.sendRaw(pending.datagram);
    pending.timer = setTimeout(() => this.resendPending(key), RESEND_INTERVAL_MS * (pending.tries + 1));
    pending.timer.unref?.();
  }

  clearPendingAck(type, packetId) {
    const key = `${type}:${packetId}`;
    const pending = this.pendingAcks.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingAcks.delete(key);
  }

  waitForAck(type, packetId, timeoutMs) {
    if (!this.pendingAcks.has(`${type}:${packetId}`)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const poll = () => {
        if (!this.pendingAcks.has(`${type}:${packetId}`)) return resolve();
        if (Date.now() > deadline) return reject(new Error(`no ACK for ${type}:${packetId}`));
        setTimeout(poll, 50);
      };
      poll();
    });
  }

  // ── client commands ───────────────────────────────────────────────────────

  /**
   * Send a command and collect its data rows until the error line.
   * @param {string} name
   * @param {object|Array} [params]
   * @returns {Promise<{rows: object[], error: object|null}>}
   */
  async command(name, params = {}) {
    const run = async () => {
      const buffer = encodeCommand(name, params);
      const result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingReply = null;
          reject(new Error(`timeout waiting for reply to ${name}`));
        }, COMMAND_TIMEOUT_MS);
        this.pendingReply = { name, rows: [], resolve, reject, timer };
      });
      try {
        await this.sendCommandPacket(buffer);
      } catch (err) {
        // An ACK that never comes does not mean the command failed: the reply
        // may still arrive, and voice-protocol servers do not ack every command.
        this.log('debug', `command ${name}: ${err.message}`);
      }
      return result;
    };
    const next = this.commandChain.then(run, run);
    this.commandChain = next.catch(() => {});
    return next;
  }

  /**
   * Send a command the server may not answer with an error line
   * (sendtextmessage is confirmed by its notify, not by an error).
   * @param {string} name
   * @param {object} params
   * @param {number} waitMs
   */
  async commandNoReply(name, params, waitMs = 1500) {
    const run = async () => {
      const buffer = encodeCommand(name, params);
      const result = new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (this.pendingReply?.name === name) this.pendingReply = null;
          resolve({ rows: [], error: null, answered: false });
        }, waitMs);
        this.pendingReply = {
          name,
          rows: [],
          resolve: (value) => {
            clearTimeout(timer);
            resolve({ ...value, answered: true });
          },
          reject: (err) => {
            clearTimeout(timer);
            resolve({ rows: [], error: { message: err.message }, answered: true, failed: true });
          },
          timer,
        };
      });
      try {
        await this.sendCommandPacket(buffer);
      } catch (err) {
        this.log('debug', `command ${name}: ${err.message}`);
      }
      return result;
    };
    const next = this.commandChain.then(run, run);
    this.commandChain = next.catch(() => {});
    return next;
  }

  async join(cid) {
    return this.command('clientmove', { clid: this.selfClid, cid });
  }

  async chat(text) {
    return this.commandNoReply('sendtextmessage', { targetmode: 2, msg: text });
  }

  async poke(clid, text) {
    return this.commandNoReply('clientpoke', { clid, msg: text });
  }

  async setSelf(params) {
    const mapped = {};
    if (params.muted !== undefined) mapped.client_input_muted = params.muted ? '1' : '0';
    if (params.inputMuted !== undefined) mapped.client_input_muted = params.inputMuted ? '1' : '0';
    if (params.outputMuted !== undefined) mapped.client_output_muted = params.outputMuted ? '1' : '0';
    if (params.deafened !== undefined) mapped.client_outputonly_muted = params.deafened ? '1' : '0';
    if (params.away !== undefined) mapped.client_away = params.away ? '1' : '0';
    if (params.nickname !== undefined) mapped.client_nickname = params.nickname;
    return this.command('clientupdate', mapped);
  }

  /**
   * Record the whisper target lists for later sendVoice calls.
   * @param {{channels?: Array<number|bigint>, clients?: number[]}|null} targets
   * @param {boolean} active
   */
  setWhisperTargets(targets, active = true) {
    if (!active || targets == null) {
      this.whisper = { targets: null, active: false };
      return this.whisper;
    }
    const channels = Array.isArray(targets.channels) ? targets.channels : [];
    const clients = Array.isArray(targets.clients) ? targets.clients : [];
    const total = channels.length + clients.length;
    if (total > 255) throw new Error(`setWhisperTargets: at most 255 targets, got ${total}`);
    this.whisper = { targets: { channels, clients }, active: true };
    return this.whisper;
  }

  /**
   * Build and send one voice packet (VOICE, or VOICE_WHISPER when targets are
   * present). Frames come from the caller's Opus encoder; `seq` is the voice
   * sequence number the caller advances every 20 ms (a counter is kept here
   * when it is omitted).
   *
   * @param {object} o
   * @param {number} [o.codec=4]
   * @param {number} [o.seq]
   * @param {Array<Buffer|Uint8Array>} o.frames
   * @param {{channels?: Array<number|bigint>, clients?: number[]}|null} [o.targets]
   * @returns {{type:number, packetId:number, seq:number, bytes:number}}
   */
  async sendVoice({ codec = 4, seq, frames, targets } = {}) {
    if (!this.session) throw new Error('sendVoice: the crypto handshake has not completed');
    const effectiveTargets = targets !== undefined ? targets : this.whisper.active ? this.whisper.targets : null;
    const voiceSeq = seq === undefined ? this.voiceSeq : seq;
    this.voiceSeq = (voiceSeq + 1) & 0xffff;

    const meta = voicePacketMeta({ frames, targets: effectiveTargets, includeCountByte: undefined });
    const payload = buildVoicePayload({
      codec,
      seq: voiceSeq & 0xffff,
      frames,
      targets: effectiveTargets,
    });
    const { id } = this.nextPacketId(meta.type);
    this.advancePacketId(meta.type);
    const datagram = this.encryptPacket({
      type: meta.type,
      flags: meta.flags,
      packetId: id,
      payload,
    });
    this.sendRaw(datagram);
    return { type: meta.type, packetId: id, seq: voiceSeq & 0xffff, bytes: datagram.length };
  }

  onVoicePacket(packet) {
    let parsed;
    try {
      parsed = parseVoicePayload(packet.plaintext, { flags: packet.typeFlagged });
    } catch (err) {
      this.log('debug', `dropping malformed voice packet: ${err.message}`);
      return;
    }
    this.lastVoice = parsed;
    this.emit('voice', {
      clid: parsed.senderClientId ?? 0,
      codec: parsed.codec,
      seq: parsed.seq,
      frames: parsed.frames,
      // Contract form: one Opus frame per entry; the first frame keeps the
      // HTTP/WS bridge simple (api.md `voice` event).
      data: parsed.frames[0] ?? Buffer.alloc(0),
      targets: parsed.targets,
      whisper: parsed.whisper,
    });
  }

  // ── keepalive ─────────────────────────────────────────────────────────────

  startPingLoop() {
    if (this.pingTimer) return;
    this.lastPing = Date.now();
    this.pingTimer = setInterval(() => this.sendPing(), 1000);
    this.pingTimer.unref?.();
  }

  sendPing() {
    if (!this.connected) return;
    const { id } = this.nextPacketId(PacketType.PING);
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(id, 0);
    const datagram = this.encryptPacket({
      type: PacketType.PING,
      flags: this.session ? PacketFlags.UNENCRYPTED : 0,
      packetId: id,
      payload,
    });
    this.advancePacketId(PacketType.PING);
    this.pingSentAt.set(id, Date.now());
    this.pingStats.sent++;
    this.sendRaw(datagram);
  }

  /** api.md stats shape; loss is derived from unanswered keepalives. */
  getStats() {
    const { sent, answered } = this.pingStats;
    return {
      ping: this.stats.ping,
      loss: sent > 0 ? Number(((sent - answered) / sent).toFixed(4)) : 0,
      sentBytes: this.stats.sentBytes,
      recvBytes: this.stats.recvBytes,
      sentPackets: this.stats.sentPackets,
      recvPackets: this.stats.recvPackets,
    };
  }

  get statsSnapshot() {
    return this.getStats();
  }

  /** serverinfo in the api.md shape, assembled from the initserver push. */
  serverInfo() {
    const raw = this.serverInfoRaw;
    const channels = this.snapshot().channels;
    const created = Number.parseInt(raw.virtualserver_created ?? '0', 10) || 0;
    const uptime =
      created > 0
        ? Math.max(0, Math.floor(Date.now() / 1000) - created)
        : this.connectedAt
          ? Math.floor((Date.now() - this.connectedAt) / 1000)
          : 0;
    return {
      name: raw.virtualserver_name ?? this.serverName,
      platform: raw.virtualserver_platform ?? '',
      version: raw.virtualserver_version ?? '',
      clientsOnline: this.clientState?.size ?? 0,
      maxClients: Number.parseInt(raw.virtualserver_maxclients ?? '0', 10) || 0,
      uptime,
      channelsOnline: channels.length,
      port: this.port,
      welcome: raw.virtualserver_welcomemessage ?? '',
      hostMessage: raw.virtualserver_hostmessage ?? '',
    };
  }

  /**
   * Convenience dispatch for the WS `request` op: returns the snapshot shapes
   * api.md documents.
   */
  async request(what) {
    switch (what) {
      case 'serverinfo':
        return this.serverInfo();
      case 'channels':
        return { list: this.snapshot().channels };
      case 'clients':
        return { list: this.snapshot().clients };
      case 'permissions':
        return { needed: this.neededPermissions };
      case 'stats':
        return this.getStats();
      default:
        throw new Error(`request: unknown target ${JSON.stringify(what)}`);
    }
  }
}

// ── QuickLZ level-1 decompression ───────────────────────────────────────────
// Ported from the reference client implementation (internal/transport/quicklz.go
// of the teamspeak-go client) and the QuickLZ 1.5.0 format TeamSpeak uses.

const QLZ_HASH_SIZE = 4096;
const QLZ_MAX_SIZE = 1 << 20;

export function quicklzDecompress(data) {
  if (data.length < 3) throw new Error('data too short');
  const flags = data[0];
  const level = (flags >> 2) & 0x03;
  if (level !== 1) throw new Error('only QuickLZ level 1 is supported');
  const headerLen = (flags & 0x02) !== 0 ? 9 : 3;
  if (data.length < headerLen) throw new Error('data too short for header');
  let size;
  if ((flags & 0x02) !== 0) size = data.readUInt32LE(5);
  else size = data[2];
  if (size > QLZ_MAX_SIZE) throw new Error('declared size too large');

  if ((flags & 0x01) === 0) {
    if (data.length - headerLen < size) throw new Error('truncated');
    return Buffer.from(data.subarray(headerLen, headerLen + size));
  }

  const dest = Buffer.alloc(size);
  const hashtable = new Int32Array(QLZ_HASH_SIZE);
  let control = 1;
  let sourcePos = headerLen;
  let destPos = 0;
  let nextHashed = 0;

  const ensureControl = () => {
    if (control !== 1) return true;
    if (sourcePos + 4 > data.length) return false;
    control = data.readUInt32LE(sourcePos);
    sourcePos += 4;
    return true;
  };

  const updateHashtable = (end) => {
    while (nextHashed < end) {
      if (nextHashed + 3 > dest.length) break;
      const v = dest[nextHashed] | (dest[nextHashed + 1] << 8) | (dest[nextHashed + 2] << 16);
      const hash = ((v >>> 12) ^ v) & 0xfff;
      hashtable[hash] = nextHashed;
      nextHashed++;
    }
  };

  for (;;) {
    if (!ensureControl()) throw new Error('truncated');
    if ((control & 1) !== 0) {
      control >>>= 1;
      if (sourcePos + 2 > data.length) throw new Error('truncated');
      const b1 = data[sourcePos];
      const b2 = data[sourcePos + 1];
      sourcePos += 2;
      const hash = (b1 >> 4) | (b2 << 4);
      let matchlen = b1 & 0x0f;
      if (matchlen !== 0) {
        matchlen += 2;
      } else {
        if (sourcePos >= data.length) throw new Error('truncated');
        matchlen = data[sourcePos];
        sourcePos++;
      }
      const offset = hashtable[hash];
      if (offset >= destPos || destPos + matchlen > dest.length) throw new Error('bad reference');
      for (let i = 0; i < matchlen; i++) dest[destPos++] = dest[offset + i];
      const end = destPos + 1 - matchlen;
      updateHashtable(end);
      nextHashed = destPos;
      continue;
    }
    // literal
    if (destPos >= Math.max(size, 10) - 10) {
      while (destPos < size) {
        if (control === 1) {
          sourcePos += 4;
          if (sourcePos > data.length) throw new Error('truncated');
          control = data.readUInt32LE(sourcePos - 4);
        }
        if (sourcePos >= data.length) throw new Error('truncated');
        dest[destPos++] = data[sourcePos++];
        control >>>= 1;
      }
      return dest;
    }
    if (sourcePos >= data.length) throw new Error('truncated');
    dest[destPos++] = data[sourcePos++];
    control >>>= 1;
    const end = Math.max(destPos - 2, 0);
    updateHashtable(end);
    if (nextHashed < end) nextHashed = end;
  }
}

export default Ts3Connection;