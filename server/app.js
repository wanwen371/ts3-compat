// TS3-compat backend: static web app + WebSocket bridge to the TS3 protocol layer.
//
// The bridge translates the protocol layer's raw rows/events (see
// server/ts3/connection.js) into the UI contract documented in docs/api.md.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const WEB_ROOT = resolve(__dirname, '..', 'web');
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';

// Deployment config surfaced to the browser via GET /api/config. On a server
// deployment the TS3 voice server lives next to this web app, so the page can
// connect without asking the user for host/port.
const AUTO_CONNECT = (process.env.AUTO_CONNECT ?? '1') !== '0';
const TS3_HOST = process.env.TS3_HOST ?? '127.0.0.1';
const TS3_PORT = Number(process.env.TS3_PORT ?? 9987);
const NICK_PREFIX = process.env.NICK_PREFIX ?? '玩家';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const staticServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? HOST}`);
    let path = decodeURIComponent(url.pathname);

    // Browser bootstrap config: lets the page auto-connect to the co-located
    // TeamSpeak server (see docs/api.md "GET /api/config").
    if (path === '/api/config' || path === '/api/config.json') {
      const config = {
        autoConnect: AUTO_CONNECT,
        host: TS3_HOST,
        port: TS3_PORT,
        nicknamePrefix: NICK_PREFIX,
        serverName: process.env.SERVER_NAME ?? '',
      };
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(config));
      return;
    }

    if (path === '/' || path === '') path = '/index.html';
    const target = normalize(join(WEB_ROOT, path));
    if (!target.startsWith(WEB_ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    try {
      const shell = await readFile(join(WEB_ROOT, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(shell);
    } catch {
      res.writeHead(404).end('not found');
    }
  }
});

/** Load the protocol layer lazily so this server starts before it exists. */
let protocolModule;
async function loadProtocol() {
  if (protocolModule !== undefined) return protocolModule;
  try {
    protocolModule = await import('./ts3/connection.js');
  } catch (error) {
    protocolModule = null;
    console.warn('[app] protocol layer unavailable:', error.message);
  }
  return protocolModule;
}

const int = (value, fallback = 0) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

/** virtualserver_* row -> api.md ServerInfo. */
function mapServerInfo(row = {}) {
  const clients = int(row.virtualserver_clientsonline, 0);
  const query = int(row.virtualserver_queryclientsonline, 0);
  return {
    name: row.virtualserver_name ?? 'TeamSpeak Server',
    platform: row.virtualserver_platform ?? '',
    version: row.virtualserver_version ?? '',
    clientsOnline: Math.max(0, clients - query),
    maxClients: int(row.virtualserver_maxclients, 0),
    uptime: int(row.virtualserver_uptime, 0),
    channelsOnline: int(row.virtualserver_channelsonline, 0),
    port: int(row.virtualserver_port, 9987),
    welcome: row.virtualserver_welcomemessage ?? '',
    hostMessage: row.virtualserver_hostmessage ?? '',
    hostMessageMode: int(row.virtualserver_hostmessage_mode, 0),
  };
}

/** API channel model from connection.snapshot().channels (already normalised). */
function mapChannel(channel, currentCid) {
  return {
    cid: channel.cid,
    pid: channel.pid,
    name: channel.name || `channel ${channel.cid}`,
    order: channel.order ?? 0,
    codec: channel.codec ?? 4,
    codecQuality: channel.codecQuality ?? 0,
    neededTalkPower: channel.neededTalkPower ?? 0,
    maxClients: channel.maxClients ?? -1,
    totalClients: channel.totalClients ?? -1,
    hasPassword: Boolean(channel.hasPassword),
    encrypted: Boolean(channel.encrypted),
    isDefault: Boolean(channel.isDefault),
    isCurrent: channel.cid === currentCid,
  };
}

function mapClient(client, selfClid) {
  return {
    clid: client.clid,
    cid: client.cid,
    nickname: client.nickname || `client ${client.clid}`,
    type: client.type ?? 0,
    isSelf: client.clid === selfClid,
    isTalking: false,
    muted: Boolean(client.muted),
    deafened: Boolean(client.deafened),
    away: Boolean(client.away),
    recording: Boolean(client.recording),
  };
}

/** One WS client ↔ one TS3 session. */
class Bridge {
  constructor(socket) {
    this.ws = socket;
    this.conn = null;
    this.statsTimer = null;
    this.refreshTimers = { channels: null, clients: null };
    this.knownTalking = new Map();
    socket.on('message', (raw) => this.#onMessage(raw));
    socket.on('close', () => this.#teardown());
  }

  #send(ev, payload = {}) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify({ ev, ...payload }));
  }

  #log(text, level = 'info') {
    this.#send('log', { level, text });
  }

  async #onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      this.#send('error', { code: 'bad_json', message: 'expected a JSON text frame' });
      return;
    }
    try {
      await this.#dispatch(msg);
    } catch (error) {
      this.#send('error', { code: error.code ?? 'internal', message: error.message });
    }
  }

  async #dispatch(msg) {
    switch (msg.op) {
      case 'connect':
        return this.#connect(msg);
      case 'disconnect':
        return this.#disconnect();
      case 'join':
        return this.#join(msg.cid);
      case 'chat':
        return this.#chat(msg.text);
      case 'poke':
        return this.#poke(msg.clid, msg.text);
      case 'setSelf':
        return this.#setSelf(msg);
      case 'whisper':
        return this.conn?.setWhisperTargets?.(msg.targets, msg.active);
      case 'voiceFrame':
        return this.#sendVoice(msg);
      case 'request':
        return this.#request(msg.what);
      case 'ptt':
        return this.conn?.setPTT?.(msg.active);
      default:
        this.#send('error', { code: 'unknown_op', message: `unknown op ${msg.op}` });
    }
  }

  async #connect({ host, port = 9987, nickname = 'webclient', serverPassword, channelPassword }) {
    const protocol = await loadProtocol();
    if (!protocol?.Ts3Connection) {
      this.#send('state', { phase: 'error', error: '协议层尚未就绪（server/ts3/connection.js 未实现）' });
      return;
    }
    this.#send('state', { phase: 'connecting' });
    this.conn = new protocol.Ts3Connection({
      host,
      port,
      nickname,
      serverPassword,
      channelPassword,
      voiceCodec: 4,
      voiceQuality: 6,
    });
    this.conn.on?.('state', (state) => this.#send('state', state));
    this.conn.on?.('event', (event) => this.#forwardEvent(event));
    this.conn.on?.('log', (entry) => this.#send('log', typeof entry === 'string' ? { level: 'info', text: entry } : entry));
    this.conn.on?.('error', (error) => this.#send('error', { code: error.code ?? 'protocol', message: error.message }));
    this.conn.on?.('voice', (frame) => {
      if (frame?.data) {
        this.#send('voice', {
          from: frame.clid ?? frame.from ?? 0,
          codec: frame.codec ?? 4,
          seq: frame.seq ?? 0,
          data: Buffer.from(frame.data).toString('base64'),
        });
      }
      this.#markTalking(frame?.clid ?? frame?.from ?? 0);
    });
    this.conn.on?.('voice-error', (error) => this.#send('error', { code: 'voice', message: error.message }));
    try {
      await this.conn.connect(nickname);
      await this.conn.waitWelcome?.(3000).catch(() => {});
      // The Guest server group has no permission for the explicit
      // serverinfo/channellist/clientlist commands (2568), so read the
      // server-side state the protocol layer already tracks.
      let serverInfo = {};
      try {
        serverInfo = (await this.conn.request('serverinfo')) ?? {};
      } catch (error) {
        this.#log(`serverinfo 不可用：${error.message}`, 'warn');
      }
      this.#send('serverinfo', { ...mapServerInfo(serverInfo), ...serverInfo });
      await this.#pushSnapshot();
      this.#send('state', { phase: 'connected' });
      this.#startStats();
    } catch (error) {
      this.#send('state', { phase: 'error', error: error.message });
    }
  }

  /** Push channels + clients + self from the protocol layer snapshot. */
  async #pushSnapshot({ channels = true, clients = true } = {}) {
    if (!this.conn?.snapshot) return;
    let snapshot;
    try {
      snapshot = this.conn.snapshot();
    } catch {
      return;
    }
    const currentCid = snapshot.self?.cid ?? 0;
    if (channels) {
      this.#send('channels', { list: (snapshot.channels ?? []).map((c) => mapChannel(c, currentCid)) });
    }
    if (clients) {
      this.#send('clients', { list: (snapshot.clients ?? []).map((c) => mapClient(c, this.conn.selfClid)) });
    }
    if (snapshot.self) {
      this.#send('self', {
        clid: snapshot.self.clid,
        nickname: snapshot.self.nickname,
        cid: snapshot.self.cid,
        muted: Boolean(snapshot.self.muted),
        deafened: Boolean(snapshot.self.deafened),
        away: Boolean(snapshot.self.away),
      });
    }
  }

  #scheduleRefresh(kind) {
    const key = kind === 'channellist' || kind.startsWith('channel') ? 'channels' : 'clients';
    clearTimeout(this.refreshTimers[key]);
    this.refreshTimers[key] = setTimeout(() => {
      this.refreshTimers[key] = null;
      this.#pushSnapshot(key === 'channels' ? { channels: true, clients: false } : { channels: false, clients: true });
    }, key === 'channels' ? 300 : 150);
  }

  #markTalking(clid) {
    if (!clid) return;
    this.knownTalking.set(clid, Date.now());
  }

  /** Map protocol-layer events onto the docs/api.md contract. */
  #forwardEvent(event) {
    const type = event?.type ?? '';
    const data = event?.data ?? {};
    switch (type) {
      case 'textmessage': {
        this.#send('chat', {
          from: {
            clid: int(data.invokerid, 0),
            nickname: data.invokername ?? 'unknown',
          },
          text: data.msg ?? '',
          ts: Date.now(),
          mode: int(data.targetmode, 2) === 2 ? 'channel' : int(data.targetmode, 2) === 3 ? 'server' : 'private',
        });
        return;
      }
      case 'poked':
      case 'poke': {
        this.#send('poked', { from: { clid: int(data.invokerid, 0), nickname: data.invokername ?? 'unknown' }, text: data.msg ?? '' });
        return;
      }
      case 'cliententerview':
      case 'clientleftview':
      case 'clientupdated':
      case 'clientmoved':
        this.#scheduleRefresh('clients');
        return;
      case 'channellist':
      case 'channelcreated':
      case 'channeledited':
      case 'channeldeleted':
      case 'channelmoved':
        this.#scheduleRefresh('channels');
        return;
      case 'serveredited': {
        this.conn?.request?.('serverinfo').then((info) => {
          this.#send('serverinfo', { ...mapServerInfo({}), ...info });
        }).catch(() => {});
        return;
      }
      case 'channellistfinished':
        return;
      default:
        if (type.startsWith('client') || type.startsWith('channel')) this.#scheduleRefresh(type);
        return;
    }
  }

  async #join(cid) {
    if (!this.conn) return;
    try {
      await this.conn.join(Number(cid));
      await this.#pushSnapshot();
    } catch (error) {
      // 770 = already member of channel; treat as success.
      if (!/770/.test(error.message)) this.#send('error', { code: 'join', message: error.message });
      await this.#pushSnapshot();
    }
  }

  async #chat(text) {
    if (!this.conn) return;
    try {
      const reply = await this.conn.chat(String(text));
      if (reply?.error?.id && reply.error.id !== 0) {
        this.#send('error', { code: 'chat', message: reply.error.message ?? `error ${reply.error.id}` });
      }
    } catch (error) {
      this.#send('error', { code: 'chat', message: error.message });
    }
  }

  async #poke(clid, text) {
    if (!this.conn) return;
    try {
      await this.conn.poke(Number(clid), String(text ?? ''));
    } catch (error) {
      this.#send('error', { code: 'poke', message: error.message });
    }
  }

  async #setSelf(params) {
    if (!this.conn) return;
    const update = {};
    if (params.nickname !== undefined) update.client_nickname = String(params.nickname);
    if (params.away !== undefined) update.client_away = params.away ? '1' : '0';
    if (params.inputMuted !== undefined) update.client_input_muted = params.inputMuted ? '1' : '0';
    if (params.outputMuted !== undefined) update.client_output_muted = params.outputMuted ? '1' : '0';
    if (Object.keys(update).length === 0) return;
    try {
      await this.conn.command('clientupdate', update);
      await this.#pushSnapshot({ channels: false, clients: true });
    } catch (error) {
      this.#send('error', { code: 'setSelf', message: error.message });
    }
  }

  async #sendVoice({ codec = 4, data }) {
    if (!this.conn) return;
    if (typeof this.conn.sendVoice !== 'function') {
      this.#send('error', { code: 'voice', message: '协议层未实现 sendVoice' });
      return;
    }
    const frame = Buffer.from(String(data ?? ''), 'base64');
    if (!frame.length) return;
    this.voiceSeq = ((this.voiceSeq ?? 0) + 1) & 0xffff;
    try {
      await this.conn.sendVoice({ codec: Number(codec) || 4, seq: this.voiceSeq, frames: [frame], targets: null });
    } catch (error) {
      this.#send('error', { code: 'voice', message: error.message });
    }
  }

  async #request(what) {
    if (!this.conn) return;
    try {
      if (what === 'serverinfo') {
        this.#send('serverinfo', { ...mapServerInfo({}), ...(await this.conn.request('serverinfo')) });
      } else if (what === 'channels') {
        this.#scheduleRefresh('channels');
      } else if (what === 'clients') {
        this.#scheduleRefresh('clients');
      } else if (what === 'stats') {
        this.#send('stats', this.#stats());
      } else {
        await this.#pushSnapshot();
      }
    } catch (error) {
      this.#send('error', { code: 'request', message: error.message });
    }
  }

  #stats() {
    const conn = this.conn;
    const raw = conn?.getStats?.() ?? conn?.stats ?? {};
    return {
      ping: raw.ping ?? conn?.lastPing ?? 0,
      loss: raw.loss ?? 0,
      sentBytes: raw.sentBytes ?? 0,
      recvBytes: raw.recvBytes ?? 0,
      sentPackets: raw.sentPackets ?? 0,
      recvPackets: raw.recvPackets ?? 0,
    };
  }

  #startStats() {
    clearInterval(this.statsTimer);
    this.statsTimer = setInterval(() => this.#send('stats', this.#stats()), 1000);
  }

  async #disconnect() {
    this.#teardown();
    this.#send('state', { phase: 'disconnected' });
  }

  #teardown() {
    clearInterval(this.statsTimer);
    clearTimeout(this.refreshTimers.channels);
    clearTimeout(this.refreshTimers.clients);
    this.statsTimer = null;
    try {
      this.conn?.disconnect?.() ?? this.conn?.close?.();
    } catch {
      /* ignore */
    }
    this.conn = null;
  }
}

const wss = new WebSocketServer({ server: staticServer, path: '/ws' });
wss.on('connection', (socket) => new Bridge(socket));

staticServer.listen(PORT, HOST, () => {
  console.log(`[app] http://${HOST}:${PORT}  (ws://${HOST}:${PORT}/ws)`);
  console.log(`[app] UI mock preview: http://${HOST}:${PORT}/?mock=1`);
});

export { staticServer };