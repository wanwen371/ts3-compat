/* ==========================================================================
   TeamSpeak 3 兼容客户端 · 前端应用
   原生 ES Module，无构建步骤、无第三方库、无 CDN。
   交互契约：docs/api.md；视觉规范：docs/design.md

   结构：
     1. 工具与常量
     2. 全局状态 / 元素缓存
     3. 设置与持久化
     4. 音频桥（web/audio.js 可选，缺失时降级）
     5. WebSocket 桥接
     6. 渲染（服务器条 / 工具栏 / 频道 / 客户端 / 聊天 / 状态栏）
     7. 交互（连接 / 频道 / 客户端 / 聊天 / PTT / 语音目标）
     8. 设置页
     9. Acrylic 菜单 / Toast / 对话框
    10. 演示模式与启动
   ========================================================================== */

/* ============================== 1. 工具与常量 ============================== */

const STORAGE_KEY = 'ts3-compat.settings.v1';
const MAX_MESSAGES = 300;
const MAX_ERRORS = 20;
const MAX_LOGS = 50;
const CONNECT_TIMEOUT_MS = 20000;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const icon = (name, cls = 'icon') =>
  `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char],
  );

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function iconNode(name, cls = 'icon') {
  const wrap = document.createElement('span');
  wrap.innerHTML = icon(name, cls);
  return wrap.firstElementChild;
}

function debounce(fn, wait = 150) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
}

function formatTime(ts) {
  const date = new Date(Number(ts) || Date.now());
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

function formatUptime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分`;
}

function initials(name) {
  const text = String(name ?? '').trim();
  if (!text) return '?';
  const chars = Array.from(text);
  return chars[0].toUpperCase();
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(data) {
  const binary = atob(String(data ?? ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const KEY_LABELS = {
  Space: '空格',
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: '左 Shift',
  ShiftRight: '右 Shift',
  ControlLeft: '左 Ctrl',
  ControlRight: '右 Ctrl',
  AltLeft: '左 Alt',
  AltRight: '右 Alt',
  MetaLeft: '左 Win',
  MetaRight: '右 Win',
};

function keyLabel(code) {
  if (!code) return '未设置';
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  return String(code)
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Numpad/, '小键盘 ')
    .replace(/^F(\d+)$/, 'F$1');
}

function matchesShortcut(event, code) {
  if (!code) return false;
  return event.code === code || event.key === code;
}

function isTypingTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function isHotkeyBlockedTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  return Boolean(
    target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="menu"], [role="dialog"]'),
  );
}

/* ============================== 2. 全局状态 / 元素缓存 ============================== */

const DEFAULT_SETTINGS = {
  inputDevice: '',
  outputDevice: '',
  codec: 'voice',
  quality: 6,
  aec: true,
  noiseSuppression: true,
  vad: true,
  agc: false,
  typingSuppression: false,
  masterVolume: 80,
  clientVolume: 100,
  clientVolumes: {},
  comfortNoise: true,
  ducking: true,
  duckingAmount: 40,
  pttKey: 'Space',
  muteKey: '',
  deafenKey: '',
};

const state = {
  mode: 'live', // 'live' | 'mock'
  phase: 'disconnected', // disconnected | connecting | handshaking | connected | error
  view: 'connect', // connect | main | settings
  mock: false,
  server: null,
  channels: [],
  clients: [],
  self: null,
  messages: [],
  selectedCid: null,
  treeFocusCid: null,
  expanded: new Set(),
  expansionInitialized: false,
  stats: { ping: null, loss: 0, sentBytes: 0, recvBytes: 0, sentPackets: 0, recvPackets: 0 },
  whisper: { channels: [], clients: [], active: false },
  loading: { channels: false, clients: false },
  failed: { channels: false, clients: false },
  pttActive: false,
  audioStatus: 'idle', // idle | loading | ready | unavailable
  audioMessage: '',
  settings: loadSettings(),
  settingsSection: 'audio',
  settingsReturn: 'main',
  selectedClientId: null,
  errors: [],
  logs: [],
  chatStick: true,
  connectError: '',
  pendingJoinCid: null,
  menu: { open: false, items: [], anchor: null },
  modal: { open: false, restoreFocus: null, onClose: null },
};

const els = {};

function cacheElements() {
  const ids = [
    // views
    'view-connect', 'view-main', 'view-settings',
    // connect
    'connect-form', 'connect-host', 'connect-port', 'connect-nickname', 'connect-password',
    'btn-password-toggle', 'connect-status', 'connect-status-text', 'btn-connect', 'btn-demo',
    // serverbar
    'server-name', 'server-meta', 'server-badges', 'server-mode-badge',
    'btn-open-settings', 'btn-disconnect', 'btn-disconnect-toolbar',
    // toolbar
    'btn-connect-toolbar', 'btn-join', 'toolbar-selected', 'btn-mute', 'btn-mute-label',
    'btn-deafen', 'btn-deafen-label', 'btn-ptt', 'btn-ptt-label', 'btn-voice-target',
    'voice-target-label',
    // channels
    'channel-tree', 'channels-state', 'channels-count', 'btn-collapse-channels',
    // clients
    'client-list', 'clients-state', 'clients-count',
    // chat
    'chat-log', 'chat-channel-name', 'chat-lock-badge', 'chat-form', 'chat-input',
    'chat-hint', 'btn-send',
    // statusbar
    'status-dot', 'status-text', 'stat-ping', 'stat-loss', 'stat-sent', 'stat-recv',
    'audio-status', 'mock-badge', 'status-host',
    // settings
    'btn-settings-back', 'settings-title', 'settings-tabs', 'settings-mock-badge',
    'section-audio', 'section-playback', 'section-shortcuts', 'section-about',
    'set-input-device', 'input-device-hint', 'set-output-device', 'btn-refresh-devices',
    'set-quality', 'quality-output', 'quality-hint',
    'set-master-volume', 'master-volume-output',
    'set-client-select', 'set-client-volume', 'client-volume-output', 'client-volume-target',
    'set-ducking-amount', 'ducking-output', 'ducking-amount-field',
    'set-ptt-key', 'set-mute-key', 'set-deafen-key', 'btn-reset-shortcuts',
    'btn-clear-settings', 'btn-back-to-connect',
    'about-endpoint', 'about-mode', 'about-audio', 'about-viewport', 'about-overflow',
    'about-errors',
    // overlays
    'menu-layer', 'menu',
    'modal-layer', 'modal', 'modal-title', 'modal-body', 'modal-actions', 'modal-close',
    'modal-backdrop', 'toast-region',
  ];
  for (const id of ids) {
    els[id.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = document.getElementById(id);
  }
}

/* ============================== 3. 设置与持久化 ============================== */

function loadSettings() {
  const defaults = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults;
    for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
      const value = parsed[key];
      if (value == null) continue;
      if (typeof fallback === 'object') {
        if (typeof value === 'object' && !Array.isArray(value)) defaults[key] = value;
      } else if (typeof value === typeof fallback) {
        defaults[key] = value;
      }
    }
    return defaults;
  } catch {
    return defaults;
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
  } catch {
    /* 隐私模式 / 禁用存储时静默降级 */
  }
}

function audioPayload() {
  const s = state.settings;
  return {
    inputDevice: s.inputDevice || null,
    outputDevice: s.outputDevice || null,
    codec: s.codec === 'music' ? 5 : 4,
    codecName: s.codec === 'music' ? 'Opus Music' : 'Opus Voice',
    quality: s.quality,
    aec: s.aec,
    noiseSuppression: s.noiseSuppression,
    vad: s.vad,
    agc: s.agc,
    typingSuppression: s.typingSuppression,
    masterVolume: s.masterVolume / 100,
    comfortNoise: s.comfortNoise,
    ducking: s.ducking,
    duckingAmount: s.duckingAmount / 100,
    clientVolumes: { ...s.clientVolumes },
  };
}

/* ============================== 4. 音频桥（可选依赖） ============================== */

let audioEngine = null;
let audioInitPromise = null;

async function ensureAudio({ silent = false } = {}) {
  if (audioEngine && state.audioStatus === 'ready') return audioEngine;
  if (audioInitPromise) return audioInitPromise;

  state.audioStatus = 'loading';
  state.audioMessage = '正在加载 web/audio.js…';
  updateAudioStatusUi();
  updateDiagnostics();

  audioInitPromise = (async () => {
    try {
      // audio.js 由另一个 agent 提供；未就绪时动态导入失败，界面继续运行。
      const mod = await import('./audio.js');
      const factory = mod?.createAudioEngine;
      if (typeof factory !== 'function') {
        throw new Error('audio.js 未导出 createAudioEngine()');
      }
      audioEngine = await factory({
        settings: audioPayload(),
        autoCapture: false,
        onFrame: (frame) => onAudioFrame(frame),
        onLevel: (level) => {
          state.localLevel = Number(level) || 0;
        },
        onError: (error) => {
          state.audioMessage = error?.message ?? String(error);
          updateAudioStatusUi();
          updateDiagnostics();
        },
      });
      if (!audioEngine) audioEngine = {};

      const methods = [
        ['init', [audioPayload()]],
        ['applySettings', [audioPayload()]],
        ['setMuted', [Boolean(state.self?.muted)]],
        ['setDeafened', [Boolean(state.self?.deafened)]],
      ];
      for (const [method, args] of methods) {
        if (typeof audioEngine[method] !== 'function') continue;
        try {
          await audioEngine[method](...args);
        } catch (error) {
          state.audioMessage = `${method} 调用失败：${error?.message ?? error}`;
        }
      }

      const engineState = typeof audioEngine.getState === 'function' ? audioEngine.getState() : null;
      if (engineState && (engineState.supported?.media === false || engineState.supported?.encode === false)) {
        state.audioStatus = 'unavailable';
        state.audioMessage =
          engineState.lastError?.message ?? '浏览器无法采集语音（仅可收听）；界面与聊天保持可用。';
      } else {
        state.audioStatus = 'ready';
        state.audioMessage = '音频引擎已就绪';
      }
    } catch (error) {
      state.audioStatus = 'unavailable';
      state.audioMessage = error?.message ?? '无法加载 audio.js';
      if (!silent) {
        toast('warn', '音频引擎未就绪', '界面与聊天仍可使用，语音功能自动降级。');
      }
    } finally {
      audioInitPromise = null;
      updateAudioStatusUi();
      updateDiagnostics();
    }
    return audioEngine;
  })();

  return audioInitPromise;
}

function ensureAudioForVoice() {
  // 演示模式没有真实服务器，语音帧无处可去；避免无意义的 audio.js 请求与控制台报错。
  if (state.mode !== 'live') {
    state.audioMessage = '演示模式不会加载音频引擎；连接真实服务器后自动启用。';
    updateAudioStatusUi();
    return null;
  }
  return ensureAudio({ silent: true });
}

function callAudio(method, ...args) {
  if (!audioEngine || typeof audioEngine[method] !== 'function') return;
  try {
    audioEngine[method](...args);
  } catch (error) {
    state.audioMessage = `${method} 调用失败：${error?.message ?? error}`;
    updateAudioStatusUi();
  }
}

function applyAudioSettings() {
  callAudio('applySettings', audioPayload());
}

function onAudioFrame(frame) {
  if (!frame) return;
  let bytes = null;
  if (frame instanceof Uint8Array) bytes = frame;
  else if (frame?.data instanceof Uint8Array) bytes = frame.data;
  else if (frame instanceof ArrayBuffer) bytes = new Uint8Array(frame);
  if (!bytes || bytes.length === 0) return;
  const codec = Number(frame.codec) || (state.settings.codec === 'music' ? 5 : 4);
  sendOp('voiceFrame', { codec, data: bytesToBase64(bytes) });
}

const talkingTimers = new Map();

/** 后端未推送 isTalking 时，用收到的语音帧推断「正在发言」（1.2s 衰减）。 */
function markClientTalking(clid) {
  const id = Number(clid);
  if (!id) return;
  const client = state.clients.find((entry) => entry.clid === id);
  if (!client || client.isSelf) return;
  if (!client.isTalking) {
    client.isTalking = true;
    renderClients();
  }
  clearTimeout(talkingTimers.get(id));
  talkingTimers.set(
    id,
    setTimeout(() => {
      talkingTimers.delete(id);
      const current = state.clients.find((entry) => entry.clid === id);
      if (current) {
        current.isTalking = false;
        renderClients();
      }
    }, 1200),
  );
}

function clearTalkingTimers() {
  for (const timer of talkingTimers.values()) clearTimeout(timer);
  talkingTimers.clear();
}

function handleIncomingVoice(msg) {
  if (!msg || msg.data == null) return;
  markClientTalking(msg.from);
  if (state.self?.deafened) return;
  if (!audioEngine) {
    ensureAudio({ silent: true });
    return;
  }
  try {
    const bytes = base64ToBytes(msg.data);
    callAudio('playFrame', {
      from: msg.from,
      codec: msg.codec,
      seq: msg.seq,
      data: bytes,
    });
  } catch (error) {
    recordRuntimeError('audio', `语音帧解码失败：${error?.message ?? error}`);
  }
}

function updateAudioStatusUi() {
  if (!els.audioStatus) return;
  const labels = {
    idle: '未初始化',
    loading: '正在初始化…',
    ready: '就绪',
    unavailable: '不可用 · 降级运行',
  };
  const mockIdle = state.mode === 'mock' && state.audioStatus === 'idle';
  els.audioStatus.textContent = mockIdle ? '音频 演示模式' : `音频 ${labels[state.audioStatus] ?? '未初始化'}`;
  els.audioStatus.title = mockIdle
    ? '演示模式不会加载音频引擎；连接真实服务器后自动启用'
    : state.audioMessage || '打开音频设置';
}

/* ============================== 5. WebSocket 桥接 ============================== */

let socket = null;
let connectTimer = null;
let connectPayload = null;
let intentionalClose = false;

function wsUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

function sendOp(op, payload = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify({ op, ...payload }));
    return true;
  } catch (error) {
    recordRuntimeError('bridge', `发送 ${op} 失败：${error?.message ?? error}`);
    return false;
  }
}

function clearConnectTimer() {
  if (connectTimer) {
    clearTimeout(connectTimer);
    connectTimer = null;
  }
}

function openSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    if (socket.readyState === WebSocket.OPEN && connectPayload) {
      sendOp('connect', connectPayload);
    }
    return;
  }
  try {
    socket = new WebSocket(wsUrl());
  } catch (error) {
    failConnect(`无法创建 WebSocket：${error?.message ?? error}`);
    return;
  }
  socket.addEventListener('open', () => {
    if (connectPayload) sendOp('connect', connectPayload);
  });
  socket.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      recordRuntimeError('bridge', '收到无法解析的 WebSocket 消息');
      return;
    }
    handleBridgeEvent(msg);
  });
  socket.addEventListener('close', () => {
    const wasIntentional = intentionalClose;
    intentionalClose = false;
    socket = null;
    if (wasIntentional) return;
    if (['connecting', 'handshaking', 'connected'].includes(state.phase)) {
      state.phase = 'error';
      state.connectError = '与本地桥接服务的 WebSocket 连接已关闭。';
      setConnectLoading(false);
      setConnectStatus('error', state.connectError);
      showView('connect');
      renderAll();
      toast('error', '连接已断开', state.connectError);
    }
  });
  socket.addEventListener('error', () => {
    /* close 事件会随后触发，统一处理 */
  });
}

function handleBridgeEvent(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.ev) {
    case 'state':
      handleStateEvent(msg);
      break;
    case 'serverinfo':
      state.server = normalizeServerInfo(msg);
      renderServer();
      break;
    case 'channels':
      state.channels = Array.isArray(msg.list) ? msg.list.map(normalizeChannel) : [];
      state.loading.channels = false;
      state.failed.channels = false;
      ensureExpansion();
      if (state.selectedCid == null && state.self?.cid != null) state.selectedCid = state.self.cid;
      renderChannels();
      renderToolbar();
      renderChatHeader();
      updateDocumentTitle();
      break;
    case 'clients':
      state.clients = Array.isArray(msg.list) ? msg.list.map(normalizeClient) : [];
      state.loading.clients = false;
      state.failed.clients = false;
      syncSelfClient();
      renderClients();
      renderSettingsClientOptions();
      renderServer();
      break;
    case 'self':
      handleSelfEvent(msg);
      break;
    case 'chat':
      handleChatEvent(msg);
      break;
    case 'poked':
      handlePokedEvent(msg);
      break;
    case 'voice':
      handleIncomingVoice(msg);
      break;
    case 'stats':
      Object.assign(state.stats, {
        ping: Number(msg.ping) || 0,
        loss: Number(msg.loss) || 0,
        sentBytes: Number(msg.sentBytes) || 0,
        recvBytes: Number(msg.recvBytes) || 0,
        sentPackets: Number(msg.sentPackets) || 0,
        recvPackets: Number(msg.recvPackets) || 0,
      });
      renderStats();
      break;
    case 'error':
      handleErrorEvent(msg);
      break;
    case 'log':
      pushLog(msg.level ?? 'info', msg.text ?? '');
      break;
    default:
      break;
  }
}

function handleStateEvent(msg) {
  const phase = String(msg.phase ?? 'disconnected');
  state.phase = phase;
  if (phase === 'connecting') {
    setConnectStatus('loading', 'WebSocket 已连接，正在建立 TeamSpeak 会话…', { spinner: true });
  } else if (phase === 'handshaking') {
    setConnectStatus('loading', '正在握手、协商加密与身份…', { spinner: true });
  } else if (phase === 'connected') {
    clearConnectTimer();
    state.connectError = '';
    setConnectLoading(false);
    setConnectStatus('success', '已连接');
    enterMain();
  } else if (phase === 'error') {
    clearConnectTimer();
    setConnectLoading(false);
    failConnect(msg.error || '连接失败');
  } else if (phase === 'disconnected') {
    clearConnectTimer();
    setConnectLoading(false);
    if (state.mode === 'mock') return;
    resetSessionState();
    showView('connect');
    setConnectStatus('idle', '连接已断开');
    renderAll();
  }
}

function handleErrorEvent(msg) {
  const message = String(msg.message ?? '未知错误');
  pushLog('error', message);
  if (['connecting', 'handshaking'].includes(state.phase)) {
    failConnect(message);
    return;
  }
  toast('error', '服务器错误', message);
}

function failConnect(message) {
  state.phase = 'error';
  state.connectError = message;
  clearConnectTimer();
  setConnectLoading(false);
  setConnectStatus('error', message);
  showView('connect');
  renderAll();
  toast('error', '连接失败', message);
}

function connectLive(payload) {
  state.mode = 'live';
  state.mock = false;
  connectPayload = payload;
  state.phase = 'connecting';
  state.connectError = '';
  setConnectLoading(true);
  setConnectStatus('loading', '正在连接本地 WebSocket 桥接…', { spinner: true });
  clearConnectTimer();
  connectTimer = setTimeout(() => {
    if (state.phase !== 'connected') {
      failConnect('连接超时：本地桥接服务没有在 20 秒内响应。');
      intentionalClose = true;
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      socket = null;
      intentionalClose = false;
    }
  }, CONNECT_TIMEOUT_MS);
  openSocket();
}

function enterMain() {
  state.loading.channels = state.channels.length === 0;
  state.loading.clients = state.clients.length === 0;
  state.failed.channels = false;
  state.failed.clients = false;
  showView('main');
  renderAll();
  sendOp('request', { what: 'serverinfo' });
  sendOp('request', { what: 'channels' });
  sendOp('request', { what: 'clients' });
  // 连接成功通常来自用户点击（合法手势），此时再加载音频引擎。
  ensureAudio({ silent: true });
}

function resetSessionState() {
  state.server = null;
  state.channels = [];
  state.clients = [];
  state.self = null;
  state.messages = [];
  state.selectedCid = null;
  state.treeFocusCid = null;
  state.expanded = new Set();
  state.expansionInitialized = false;
  state.stats = { ping: null, loss: 0, sentBytes: 0, recvBytes: 0, sentPackets: 0, recvPackets: 0 };
  state.whisper = { channels: [], clients: [], active: false };
  state.loading = { channels: false, clients: false };
  state.failed = { channels: false, clients: false };
  state.pendingJoinCid = null;
  clearTalkingTimers();
  stopPtt();
  updateDocumentTitle();
}

function disconnectLive() {
  intentionalClose = true;
  clearConnectTimer();
  try {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: 'disconnect' }));
  } catch {
    /* ignore */
  }
  try {
    socket?.close();
  } catch {
    /* ignore */
  }
  socket = null;
  connectPayload = null;
  resetSessionState();
  state.phase = 'disconnected';
  setConnectLoading(false);
  showView('connect');
  setConnectStatus('idle', '已断开连接');
  renderAll();
  toast('info', '已断开连接', '可以随时重新连接服务器。');
}

/* ============================== 6. 渲染 ============================== */

function renderAll() {
  renderServer();
  renderToolbar();
  renderChannels();
  renderClients();
  renderChat();
  renderChatHeader();
  renderStats();
  renderSettingsClientOptions();
  updateAudioStatusUi();
  updateDocumentTitle();
  scheduleLayoutCheck();
}

function updateDocumentTitle() {
  const channel = currentChannel();
  const serverName = state.server?.name;
  if (state.view === 'main' && channel && serverName) {
    document.title = `${channel.name} · ${serverName} · TeamSpeak 3`;
  } else {
    document.title = 'TeamSpeak 3 兼容客户端 · Fluent';
  }
}

/* ---- 数据归一化 ---- */
function normalizeChannel(raw) {
  const channel = {
    cid: Number(raw?.cid) || 0,
    pid: Number(raw?.pid) || 0,
    name: String(raw?.name ?? '未命名频道'),
    order: Number(raw?.order) || 0,
    codec: Number(raw?.codec ?? 4),
    codecQuality: clamp(Number(raw?.codecQuality ?? 6) || 0, 0, 10),
    neededTalkPower: Number(raw?.neededTalkPower) || 0,
    maxClients: Math.max(0, Number(raw?.maxClients) || 0),
    totalClients: Math.max(0, Number(raw?.totalClients) || 0),
    hasPassword: Boolean(raw?.hasPassword),
    encrypted: Boolean(raw?.encrypted),
    isDefault: Boolean(raw?.isDefault),
    isCurrent: Boolean(raw?.isCurrent),
    description: raw?.description != null ? String(raw.description) : '',
  };
  return channel;
}

function normalizeClient(raw) {
  return {
    clid: Number(raw?.clid) || 0,
    cid: Number(raw?.cid) || 0,
    nickname: String(raw?.nickname ?? '未知客户端'),
    type: Number(raw?.type) === 1 ? 1 : 0,
    isSelf: Boolean(raw?.isSelf),
    isTalking: Boolean(raw?.isTalking),
    muted: Boolean(raw?.muted),
    deafened: Boolean(raw?.deafened),
    away: Boolean(raw?.away),
    recording: Boolean(raw?.recording),
  };
}

function normalizeServerInfo(raw) {
  return {
    name: String(raw?.name ?? 'TeamSpeak 3 服务器'),
    platform: raw?.platform != null ? String(raw.platform) : '',
    version: raw?.version != null ? String(raw.version) : '',
    clientsOnline: Number(raw?.clientsOnline) || 0,
    maxClients: Number(raw?.maxClients) || 0,
    uptime: Number(raw?.uptime) || 0,
    channelsOnline: Number(raw?.channelsOnline) || 0,
    port: Number(raw?.port) || 0,
    welcome: raw?.welcome != null ? String(raw.welcome) : '',
    hostMessage: raw?.hostMessage != null ? String(raw.hostMessage) : '',
  };
}

function currentChannel() {
  const cid = state.self?.cid ?? state.channels.find((channel) => channel.isCurrent)?.cid ?? null;
  if (cid == null) return null;
  return state.channels.find((channel) => channel.cid === cid) ?? null;
}

function isCurrentChannel(channel) {
  const current = currentChannel();
  return Boolean(current && channel.cid === current.cid);
}

function selectedChannel() {
  if (state.selectedCid == null) return null;
  return state.channels.find((channel) => channel.cid === state.selectedCid) ?? null;
}

function syncSelfClient() {
  if (!state.self) return;
  const selfClient = state.clients.find((client) => client.clid === state.self.clid || client.isSelf);
  if (!selfClient) return;
  selfClient.isSelf = true;
  state.self.clid = selfClient.clid;
  state.self.cid = selfClient.cid;
  state.self.nickname = selfClient.nickname;
  state.self.muted = selfClient.muted;
  state.self.deafened = selfClient.deafened;
  state.self.away = selfClient.away;
}
/* ---- 服务器信息条 ---- */
function renderServer() {
  const info = state.server;
  const connected = state.phase === 'connected';
  els.serverName.textContent = info?.name || (connected ? 'TeamSpeak 3 服务器' : '未连接');

  const metaParts = [];
  if (info?.platform) metaParts.push(info.platform);
  if (info?.version) metaParts.push(`TS3 ${info.version}`);
  if (info?.uptime) metaParts.push(`已运行 ${formatUptime(info.uptime)}`);
  if (info?.port) metaParts.push(`语音端口 ${info.port}`);
  els.serverMeta.textContent = metaParts.length ? metaParts.join(' · ') : '等待服务器信息…';
  els.serverMeta.title = [info?.welcome, info?.hostMessage].filter(Boolean).join('\n');

  const badgeParts = [];
  const online = Math.max(info?.clientsOnline ?? 0, state.clients.length);
  const max = info?.maxClients ?? 0;
  badgeParts.push(`<span class="badge badge--neutral">${icon('users', 'icon icon--sm')}在线 ${online}${max ? ` / ${max}` : ''}</span>`);
  const channelsOnline = info?.channelsOnline ?? state.channels.length;
  badgeParts.push(`<span class="badge badge--neutral">${icon('hash', 'icon icon--sm')}频道 ${channelsOnline}</span>`);
  els.serverBadges.innerHTML = badgeParts.join('');

  const showMock = state.mode === 'mock';
  els.serverModeBadge.hidden = !showMock;
  els.mockBadge.hidden = !showMock;
  els.settingsMockBadge.hidden = !showMock;
}

/* ---- 工具栏 ---- */
function renderToolbar() {
  const self = state.self ?? {};
  const connected = state.phase === 'connected';
  const selfClientMuted = Boolean(self.muted);
  const selfClientDeafened = Boolean(self.deafened);

  els.btnDisconnect.disabled = !connected;
  els.btnDisconnectToolbar.disabled = !connected;
  els.btnConnectToolbar.disabled = true;

  els.btnMute.setAttribute('aria-pressed', String(selfClientMuted));
  els.btnMute.classList.toggle('is-on', selfClientMuted);
  els.btnMuteLabel.textContent = selfClientMuted ? '取消静音' : '静音';
  const micIcon = els.btnMute.querySelector('use');
  if (micIcon) micIcon.setAttribute('href', selfClientMuted ? '#i-mic-off' : '#i-mic');
  els.btnMute.title = selfClientMuted ? '当前麦克风已静音' : '切换麦克风静音';

  els.btnDeafen.setAttribute('aria-pressed', String(selfClientDeafened));
  els.btnDeafen.classList.toggle('is-on', selfClientDeafened);
  els.btnDeafenLabel.textContent = selfClientDeafened ? '取消耳聋' : '耳聋';
  const deafIcon = els.btnDeafen.querySelector('use');
  if (deafIcon) deafIcon.setAttribute('href', selfClientDeafened ? '#i-headphones-off' : '#i-headphones');
  els.btnDeafen.title = selfClientDeafened ? '当前已耳聋' : '切换耳机静音（耳聋）';

  els.btnPtt.setAttribute('aria-pressed', String(state.pttActive));
  els.btnPtt.classList.toggle('is-active', state.pttActive);
  els.btnPttLabel.textContent = state.pttActive ? '正在说话…' : '按住说话';

  const selected = selectedChannel();
  const current = currentChannel();
  const canJoin = connected && selected && (!current || selected.cid !== current.cid);
  els.btnJoin.disabled = !canJoin;
  els.btnJoin.title = !connected
    ? '未连接服务器'
    : !selected
      ? '先选择一个频道'
      : selected.cid === current?.cid
        ? '已经在当前频道中'
        : `加入「${selected.name}」`;

  if (selected) {
    els.toolbarSelected.textContent =
      selected.cid === current?.cid ? `当前：${selected.name}` : `已选：${selected.name}`;
  } else {
    els.toolbarSelected.textContent = '未选择频道';
  }

  updateVoiceTargetLabel();

  const muteHotkey = state.settings.muteKey ? `（${keyLabel(state.settings.muteKey)}）` : '';
  const deafenHotkey = state.settings.deafenKey ? `（${keyLabel(state.settings.deafenKey)}）` : '';
  els.btnMute.title = `${selfClientMuted ? '取消静音' : '静音'}${muteHotkey}`;
  els.btnDeafen.title = `${selfClientDeafened ? '取消耳聋' : '耳聋'}${deafenHotkey}`;
  els.btnPtt.title = `按住说话（${keyLabel(state.settings.pttKey)}）`;
}

function updateVoiceTargetLabel() {
  const count = state.whisper.clients.length;
  const channel = currentChannel();
  if (count > 0) {
    els.voiceTargetLabel.textContent = `语音目标 · 私聊 ${count} 人`;
    els.btnVoiceTarget.title = '当前语音只发送给私聊目标';
  } else {
    els.voiceTargetLabel.textContent = channel ? `语音目标 · ${channel.name}` : '语音目标 · 当前频道';
    els.btnVoiceTarget.title = '语音发送到当前频道';
  }
}

/* ---- 频道树 ---- */
function renderChannels() {
  els.channelsCount.textContent = state.loading.channels ? '…' : String(state.channels.length);
  const tree = els.channelTree;
  const stateBox = els.channelsState;

  if (state.loading.channels) {
    tree.hidden = true;
    tree.setAttribute('aria-busy', 'true');
    stateBox.hidden = false;
    stateBox.replaceChildren(skeletonList(4));
    return;
  }
  tree.setAttribute('aria-busy', 'false');

  if (state.failed.channels) {
    tree.hidden = true;
    stateBox.hidden = false;
    stateBox.replaceChildren(
      errorState('频道列表加载失败', '本地桥接没有返回频道快照。', () => retrySnapshot('channels'), '重新拉取'),
    );
    return;
  }

  if (state.channels.length === 0) {
    tree.hidden = true;
    stateBox.hidden = false;
    stateBox.replaceChildren(
      emptyState('hash', '还没有频道', '服务器返回的频道列表为空，或尚未加入服务器。', {
        actionLabel: '重新拉取',
        onAction: () => retrySnapshot('channels'),
      }),
    );
    return;
  }

  tree.hidden = false;
  stateBox.hidden = true;
  stateBox.replaceChildren();
  const rows = visibleChannelRows();
  const fragment = document.createDocumentFragment();
  rows.forEach((row) => fragment.append(buildChannelRow(row)));
  tree.replaceChildren(fragment);
}

function visibleChannelRows() {
  const byParent = new Map();
  for (const channel of state.channels) {
    const key = channel.pid || 0;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(channel);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.order - b.order || a.cid - b.cid);
  }
  const rows = [];
  const known = new Set(state.channels.map((channel) => channel.cid));
  const visited = new Set();

  const walk = (pid, depth) => {
    for (const channel of byParent.get(pid) ?? []) {
      if (visited.has(channel.cid)) continue;
      visited.add(channel.cid);
      const children = byParent.get(channel.cid) ?? [];
      const expanded = state.expanded.has(channel.cid);
      rows.push({ channel, depth, hasChildren: children.length > 0, expanded });
      if (children.length > 0 && expanded) walk(channel.cid, depth + 1);
    }
  };
  walk(0, 0);

  // 父频道不在快照里的孤儿频道也要显示，避免数据丢失。
  for (const channel of state.channels) {
    if (visited.has(channel.cid)) continue;
    const parentKnown = known.has(channel.pid) || !channel.pid;
    if (!parentKnown) rows.push({ channel, depth: 0, hasChildren: false, expanded: false });
  }
  return rows;
}

/** 频道当前人数：clients 快照比频道行里的 totalClients 更实时。 */
function channelLiveCount(channel) {
  if (state.clients.length === 0) return channel.totalClients;
  // 频道内包括 ServerQuery 频道客户端；查询连接本身没有频道（cid=0），自然不会被匹配。
  return state.clients.filter((client) => client.cid === channel.cid).length;
}

function buildChannelRow({ channel, depth, hasChildren, expanded }) {
  const liveCount = channelLiveCount(channel);
  const row = document.createElement('div');
  row.className = 'tree__row';
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-level', String(depth + 1));
  row.dataset.cid = String(channel.cid);
  row.style.setProperty('--depth', String(depth));
  row.tabIndex = state.treeFocusCid === channel.cid || (state.treeFocusCid == null && depth === 0) ? 0 : -1;
  if (state.selectedCid === channel.cid) row.classList.add('is-selected');
  if (isCurrentChannel(channel)) {
    row.classList.add('is-current');
    row.setAttribute('aria-current', 'true');
  }
  row.setAttribute('aria-selected', String(state.selectedCid === channel.cid));
  if (hasChildren) row.setAttribute('aria-expanded', String(expanded));

  const chevron = document.createElement('span');
  chevron.className = 'tree__chevron';
  chevron.innerHTML = icon('chevron-right', 'icon icon--sm');
  if (hasChildren) {
    chevron.dataset.toggle = 'true';
  } else {
    chevron.classList.add('tree__chevron--spacer');
  }
  row.append(chevron);

  const hash = document.createElement('span');
  hash.className = 'tree__icon';
  hash.innerHTML = icon('hash', 'icon icon--sm');
  row.append(hash);

  const name = el('span', 'tree__name', channel.name);
  name.title = channel.name;
  row.append(name);

  const meta = el('span', 'tree__meta');
  const metaIcon = (name, title) => {
    const iconEl = iconNode(name, 'icon icon--sm');
    iconEl.setAttribute('title', title);
    return iconEl;
  };
  if (channel.hasPassword) meta.append(metaIcon('lock', '需要频道密码'));
  if (channel.encrypted) meta.append(metaIcon('shield', '频道已加密'));
  if (channel.isDefault) meta.append(metaIcon('star', '默认频道'));
  const countText = channel.maxClients > 0 ? `${liveCount}/${channel.maxClients}` : String(liveCount);
  const count = el('span', 'tree__count', countText);
  count.title = `${liveCount} 人${channel.maxClients ? ` / 上限 ${channel.maxClients}` : ''}`;
  meta.append(count);
  row.append(meta);

  row.title = [
    channel.name,
    `${liveCount}${channel.maxClients ? `/${channel.maxClients}` : ''} 人`,
    channel.hasPassword ? '需要密码' : '',
    channel.encrypted ? '已加密' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return row;
}

function toggleExpanded(cid) {
  if (state.expanded.has(cid)) state.expanded.delete(cid);
  else state.expanded.add(cid);
  renderChannels();
}

function ensureExpansion() {
  if (state.expansionInitialized) {
    expandParents(state.self?.cid);
    return;
  }
  for (const channel of state.channels) {
    if (state.channels.some((candidate) => candidate.pid === channel.cid)) {
      state.expanded.add(channel.cid);
    }
  }
  expandParents(state.self?.cid);
  state.expansionInitialized = true;
}

function expandParents(cid) {
  if (cid == null) return;
  const guard = new Set();
  let channel = state.channels.find((entry) => entry.cid === cid);
  while (channel && channel.pid && !guard.has(channel.pid)) {
    guard.add(channel.pid);
    state.expanded.add(channel.pid);
    channel = state.channels.find((entry) => entry.cid === channel.pid);
  }
}

function focusTreeRow(cid) {
  state.treeFocusCid = cid;
  const rows = $$('.tree__row', els.channelTree);
  for (const row of rows) {
    row.tabIndex = Number(row.dataset.cid) === cid ? 0 : -1;
  }
  const target = rows.find((row) => Number(row.dataset.cid) === cid);
  target?.focus({ preventScroll: true });
  target?.scrollIntoView({ block: 'nearest' });
}

function selectChannel(cid) {
  if (cid == null) return;
  state.selectedCid = cid;
  state.treeFocusCid = cid;
  renderChannels();
  renderToolbar();
}

/* ---- 客户端列表 ---- */
function renderClients() {
  els.clientsCount.textContent = state.loading.clients ? '…' : String(state.clients.length);
  const list = els.clientList;
  const stateBox = els.clientsState;

  if (state.loading.clients) {
    list.hidden = true;
    list.setAttribute('aria-busy', 'true');
    stateBox.hidden = false;
    stateBox.replaceChildren(skeletonList(3));
    return;
  }
  list.setAttribute('aria-busy', 'false');

  if (state.failed.clients) {
    list.hidden = true;
    stateBox.hidden = false;
    stateBox.replaceChildren(
      errorState('客户端列表加载失败', '本地桥接没有返回客户端快照。', () => retrySnapshot('clients'), '重新拉取'),
    );
    return;
  }

  if (state.clients.length === 0) {
    list.hidden = true;
    stateBox.hidden = false;
    stateBox.replaceChildren(
      emptyState('users', '当前没有在线客户端', '连接成功后服务器会推送客户端快照。', {
        actionLabel: '重新拉取',
        onAction: () => retrySnapshot('clients'),
      }),
    );
    return;
  }

  list.hidden = false;
  stateBox.hidden = true;
  stateBox.replaceChildren();

  const sorted = [...state.clients].sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    if (a.type !== b.type) return a.type - b.type;
    return a.nickname.localeCompare(b.nickname, 'zh-CN');
  });

  const fragment = document.createDocumentFragment();
  for (const client of sorted) fragment.append(buildClientTile(client));
  list.replaceChildren(fragment);
}

function buildClientTile(client) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'client';
  button.dataset.clid = String(client.clid);
  processClientClasses(button, client);
  button.title = describeClient(client);
  button.setAttribute('aria-label', describeClient(client));

  const avatar = el('span', 'client__avatar', initials(client.nickname));
  avatar.setAttribute('aria-hidden', 'true');
  button.append(avatar);

  const identity = el('span', 'client__identity');
  const nameRow = el('span', 'client__name-row');
  const name = el('span', 'client__name', client.nickname);
  name.title = client.nickname;
  nameRow.append(name);
  if (client.isSelf) {
    const tag = el('span', 'client__self-tag', '我');
    nameRow.append(tag);
  }
  identity.append(nameRow);

  const statusText = describeClientStatus(client);
  identity.append(el('span', `client__sub${client.isTalking ? ' client__sub--talking' : ''}`, statusText));
  button.append(identity);

  const states = el('span', 'client__states');
  if (client.muted) {
    const muted = iconNode('mic-off', 'icon icon--sm state-icon--mute');
    muted.setAttribute('title', '麦克风静音');
    states.append(muted);
  }
  if (client.deafened) {
    const deafened = iconNode('headphones-off', 'icon icon--sm state-icon--deaf');
    deafened.setAttribute('title', '已耳聋');
    states.append(deafened);
  }
  if (client.away) {
    const away = iconNode('clock', 'icon icon--sm state-icon--away');
    away.setAttribute('title', '暂离');
    states.append(away);
  }
  if (client.recording) {
    const dot = el('span', 'recording-dot');
    dot.title = '正在录音';
    states.append(dot);
  }
  if (client.type === 1) {
    const query = iconNode('server', 'icon icon--sm');
    query.setAttribute('title', 'ServerQuery 客户端');
    states.append(query);
  }
  button.append(states);
  return button;
}

function processClientClasses(node, client) {
  node.classList.toggle('is-self', Boolean(client.isSelf));
  node.classList.toggle('is-talking', Boolean(client.isTalking));
  node.classList.toggle('is-query', client.type === 1);
}

function describeClientStatus(client) {
  if (client.isTalking) return '正在发言';
  if (client.deafened) return '已耳聋';
  if (client.muted) return '麦克风静音';
  if (client.away) return '暂时离开';
  if (client.type === 1) return '服务器查询客户端';
  return '在线';
}

function describeClient(client) {
  const parts = [client.nickname];
  if (client.isSelf) parts.push('我');
  parts.push(describeClientStatus(client));
  const channel = state.channels.find((entry) => entry.cid === client.cid);
  if (channel) parts.push(`频道：${channel.name}`);
  return parts.join('，');
}

/* ---- 聊天 ---- */
function renderChat() {
  const log = els.chatLog;
  const stick = state.chatStick !== false;
  if (state.messages.length === 0) {
    log.replaceChildren(emptyState('hash', '还没有消息', '发送第一条消息开始聊天。'));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const message of state.messages) fragment.append(buildMessageNode(message));
  log.replaceChildren(fragment);
  if (stick) log.scrollTop = log.scrollHeight;
}

function buildMessageNode(message) {
  if (message.mode === 'system') {
    const wrapper = el('div', 'msg msg--system');
    const bubble = el('span', 'msg__system');
    bubble.append(iconNode('info', 'icon icon--sm'));
    const text = el('span', null, message.text);
    text.title = formatTime(message.ts);
    bubble.append(text);
    wrapper.append(bubble);
    return wrapper;
  }

  const isSelf = Boolean(state.self && message.from?.clid === state.self.clid) || message.self;
  const wrapper = el('div', `msg${isSelf ? ' msg--self' : ''}${message.pending ? ' msg--pending' : ''}`);
  const avatar = el('span', 'msg__avatar', initials(message.from?.nickname));
  avatar.setAttribute('aria-hidden', 'true');
  wrapper.append(avatar);

  const body = el('div', 'msg__body');
  const meta = el('div', 'msg__meta');
  const authorName = String(message.from?.nickname ?? (isSelf ? '我' : '未知'));
  const author = el('span', 'msg__author', authorName);
  author.title = authorName;
  meta.append(author);
  if (message.mode === 'private') {
    const tag = el('span', 'client__self-tag', '私聊');
    meta.append(tag);
  }
  const time = el('time', 'msg__time', formatTime(message.ts));
  time.dateTime = new Date(Number(message.ts) || Date.now()).toISOString();
  meta.append(time);
  body.append(meta);

  const bubble = el('div', 'msg__bubble', message.text);
  body.append(bubble);
  wrapper.append(body);
  return wrapper;
}

function addMessage(message) {
  state.messages.push({ id: (state.messages.at(-1)?.id ?? 0) + 1, ts: Date.now(), ...message });
  if (state.messages.length > MAX_MESSAGES) state.messages.splice(0, state.messages.length - MAX_MESSAGES);
  if (state.view === 'main') renderChat();
}

function addSystemMessage(text) {
  addMessage({ from: { clid: 0, nickname: '系统' }, text, mode: 'system' });
}

function renderChatHeader() {
  const channel = currentChannel();
  els.chatChannelName.textContent = channel ? `# ${channel.name}` : '未加入频道';
  els.chatLockBadge.hidden = !channel?.encrypted;
  const connected = state.phase === 'connected';
  const canChat = connected && Boolean(channel);
  els.chatInput.disabled = !canChat;
  els.chatInput.placeholder = canChat ? `发送消息到 #${channel.name}` : '选择频道后开始聊天';
  els.chatHint.textContent = canChat ? 'Enter 发送' : '未连接';
  updateSendButton();
}

function updateSendButton() {
  const hasText = els.chatInput.value.trim().length > 0;
  const canChat = state.phase === 'connected' && Boolean(currentChannel());
  els.btnSend.disabled = !hasText || !canChat;
}

/* ---- 状态栏 ---- */
function renderStats() {
  const phase = state.phase;
  const dotState = phase === 'connected' ? 'connected' : phase;
  els.statusDot.dataset.state = dotState;
  const labels = {
    connected: state.mode === 'mock' ? '已连接 · 演示' : '已连接',
    connecting: '正在连接',
    handshaking: '正在握手',
    error: '连接失败',
    disconnected: '未连接',
  };
  els.statusText.textContent = labels[phase] ?? '未连接';
  els.statPing.textContent = state.stats.ping == null ? '—' : String(Math.round(state.stats.ping));
  const lossRaw = Number(state.stats.loss) || 0;
  els.statLoss.textContent = `${(lossRaw <= 1 ? lossRaw * 100 : lossRaw).toFixed(1)}%`;
  els.statSent.textContent = formatBytes(state.stats.sentBytes);
  els.statRecv.textContent = formatBytes(state.stats.recvBytes);
  els.statusHost.textContent = state.mode === 'mock' ? '演示模式 · 无网络请求' : wsUrl();
  els.statusHost.title = els.statusHost.textContent;
  updateAudioStatusUi();
}

/* ---- 面板状态构件 ---- */
function skeletonList(rows = 3) {
  const wrap = el('div', 'skeleton-list');
  for (let i = 0; i < rows; i += 1) {
    const row = el('div', 'skeleton-row');
    row.append(el('span', 'skeleton skeleton--avatar'));
    row.append(el('span', 'skeleton skeleton--flex'));
    row.append(el('span', 'skeleton skeleton--short'));
    wrap.append(row);
  }
  return wrap;
}

function emptyState(iconName, title, hint, { actionLabel, onAction } = {}) {
  const wrap = el('div', 'empty-state');
  const iconBox = el('div', 'empty-state__icon');
  iconBox.innerHTML = icon(iconName, 'icon icon--lg');
  wrap.append(iconBox);
  wrap.append(el('p', 'empty-state__title', title));
  if (hint) wrap.append(el('p', 'empty-state__hint', hint));
  if (actionLabel && onAction) {
    const button = el('button', 'btn btn--secondary btn--small', actionLabel);
    button.type = 'button';
    button.addEventListener('click', onAction);
    wrap.append(button);
  }
  return wrap;
}

function errorState(title, hint, onRetry, actionLabel = '重试') {
  const wrap = el('div', 'state-error');
  const iconBox = el('div', 'state-error__icon');
  iconBox.innerHTML = icon('alert', 'icon icon--lg');
  wrap.append(iconBox);
  wrap.append(el('p', 'state-error__title', title));
  if (hint) wrap.append(el('p', 'state-error__hint', hint));
  const button = el('button', 'btn btn--secondary btn--small', actionLabel);
  button.type = 'button';
  button.addEventListener('click', onRetry);
  wrap.append(button);
  return wrap;
}

function retrySnapshot(what) {
  if (state.mode === 'mock') {
    state.failed[what] = false;
    state.loading[what] = false;
    renderAll();
    return;
  }
  if (!sendOp('request', { what })) {
    toast('error', '无法拉取', 'WebSocket 尚未连接。');
    return;
  }
  state.loading[what] = true;
  state.failed[what] = false;
  if (what === 'channels') renderChannels();
  if (what === 'clients') renderClients();
}

/* ============================== 7. 交互 ============================== */

/* ---- 连接页 ---- */
function setConnectStatus(tone, text, { spinner = false } = {}) {
  if (!els.connectStatus) return;
  els.connectStatus.dataset.tone = tone;
  els.connectStatusText.textContent = text;
  const existing = els.connectStatus.querySelector('.spinner');
  if (spinner && !existing) {
    const node = el('span', 'spinner');
    els.connectStatus.insertBefore(node, els.connectStatusText);
  } else if (!spinner && existing) {
    existing.remove();
  }
}

function setConnectLoading(loading) {
  if (!els.btnConnect) return;
  els.btnConnect.disabled = loading;
  els.btnConnect.innerHTML = loading
    ? '<span class="spinner"></span><span id="btn-connect-label">正在连接…</span>'
    : `${icon('plug')}<span id="btn-connect-label">连接</span>`;
}

function readConnectPayload() {
  const host = els.connectHost.value.trim();
  const portText = els.connectPort.value.trim();
  const nickname = els.connectNickname.value.trim();
  const password = els.connectPassword.value;

  els.connectHost.removeAttribute('aria-invalid');
  els.connectPort.removeAttribute('aria-invalid');
  els.connectNickname.removeAttribute('aria-invalid');

  if (!host) {
    els.connectHost.setAttribute('aria-invalid', 'true');
    els.connectHost.focus();
    setConnectStatus('error', '请输入服务器地址。');
    return null;
  }
  if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
    els.connectPort.setAttribute('aria-invalid', 'true');
    els.connectPort.focus();
    setConnectStatus('error', '端口必须是 1–65535 之间的整数。');
    return null;
  }
  if (!nickname) {
    els.connectNickname.setAttribute('aria-invalid', 'true');
    els.connectNickname.focus();
    setConnectStatus('error', '请输入昵称。');
    return null;
  }
  return {
    host,
    port: Number(portText),
    nickname,
    serverPassword: password ? password : undefined,
  };
}

function handleConnectSubmit(event) {
  event.preventDefault();
  if (state.phase === 'connecting' || state.phase === 'handshaking') return;
  const payload = readConnectPayload();
  if (!payload) return;
  connectLive(payload);
}

function bindConnect() {
  els.connectForm.addEventListener('submit', handleConnectSubmit);

  els.btnDemo.addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.set('mock', '1');
    url.searchParams.delete('view');
    url.searchParams.delete('demo');
    history.replaceState(null, '', `${url.pathname}${url.search}`);
    startMock(new URLSearchParams(location.search));
  });

  els.btnPasswordToggle.addEventListener('click', () => {
    const shown = els.connectPassword.type === 'text';
    els.connectPassword.type = shown ? 'password' : 'text';
    els.btnPasswordToggle.setAttribute('aria-pressed', String(!shown));
    els.btnPasswordToggle.setAttribute('aria-label', shown ? '显示密码' : '隐藏密码');
    els.btnPasswordToggle.title = shown ? '显示密码' : '隐藏密码';
    const use = els.btnPasswordToggle.querySelector('use');
    if (use) use.setAttribute('href', shown ? '#i-eye' : '#i-eye-off');
  });

  for (const input of [els.connectHost, els.connectPort, els.connectNickname, els.connectPassword]) {
    input.addEventListener('input', () => {
      input.removeAttribute('aria-invalid');
      if (els.connectStatus.dataset.tone === 'error') setConnectStatus('idle', '等待连接');
    });
  }
}

/* ---- 音视频与自身状态 ---- */
function setSelfState(patch, { announce = true } = {}) {
  if (!state.self) return;
  Object.assign(state.self, patch);
  const selfClient = state.clients.find((client) => client.clid === state.self.clid || client.isSelf);
  if (selfClient) Object.assign(selfClient, patch);
  if (state.phase === 'connected' && state.mode === 'live') {
    // docs/api.md 用 muted/deafened；当前后端实现读取 inputMuted/outputMuted。
    // 两套字段一起发，任一实现对都能生效。
    sendOp('setSelf', {
      ...patch,
      inputMuted: Boolean(state.self.muted),
      outputMuted: Boolean(state.self.deafened),
    });
  }
  if ('muted' in patch) callAudio('setMuted', Boolean(state.self.muted));
  if ('deafened' in patch) callAudio('setDeafened', Boolean(state.self.deafened));
  renderToolbar();
  renderClients();
  if (announce) {
    if ('muted' in patch) {
      toast('info', state.self.muted ? '麦克风已静音' : '麦克风已开启');
    }
    if ('deafened' in patch) {
      toast('info', state.self.deafened ? '已耳聋' : '已取消耳聋');
    }
  }
}

function toggleMute() {
  if (!state.self) {
    toast('warn', '未连接', '连接服务器后才能切换静音。');
    return;
  }
  const muted = !state.self.muted;
  const patch = { muted };
  if (!muted && state.self.deafened) patch.deafened = false;
  setSelfState(patch);
}

function toggleDeafen() {
  if (!state.self) {
    toast('warn', '未连接', '连接服务器后才能切换耳聋。');
    return;
  }
  const deafened = !state.self.deafened;
  const patch = { deafened };
  if (deafened) patch.muted = true;
  setSelfState(patch);
}

function setSelfTalking(talking) {
  const selfClient = state.clients.find((client) => client.isSelf);
  if (selfClient) {
    selfClient.isTalking = Boolean(talking);
    renderClients();
  }
}

/* ---- 频道 ---- */
function joinChannel(cid) {
  const channel = state.channels.find((entry) => entry.cid === cid);
  if (!channel) return;
  if (state.phase !== 'connected') {
    toast('warn', '未连接', '连接服务器后才能加入频道。');
    return;
  }
  if (isCurrentChannel(channel)) {
    toast('info', '已在当前频道', channel.name);
    return;
  }
  if (state.mode === 'mock') {
    mockJoinChannel(cid);
    return;
  }
  state.pendingJoinCid = cid;
  if (!sendOp('join', { cid })) {
    toast('error', '加入失败', 'WebSocket 尚未连接。');
    return;
  }
  selectChannel(cid);
  toast('info', '正在加入频道', channel.name);
}

function mockJoinChannel(cid) {
  const target = state.channels.find((channel) => channel.cid === cid);
  if (!target) return;
  const previous = currentChannel();
  if (previous && previous.cid !== cid) {
    previous.totalClients = Math.max(0, previous.totalClients - 1);
    previous.isCurrent = false;
  }
  target.totalClients += 1;
  target.isCurrent = true;
  state.channels.forEach((channel) => {
    if (channel.cid !== cid) channel.isCurrent = false;
  });
  if (state.self) {
    state.self.cid = cid;
  }
  const selfClient = state.clients.find((client) => client.isSelf);
  if (selfClient) selfClient.cid = cid;
  state.selectedCid = cid;
  state.treeFocusCid = cid;
  expandParents(cid);
  addSystemMessage(`你已加入频道「${target.name}」。`);
  renderAll();
  renderChatHeader();
  toast('success', '已加入频道', target.name);
}

/* ---- 工具栏 ---- */
function bindToolbar() {
  els.btnDisconnect.addEventListener('click', requestDisconnect);
  els.btnDisconnectToolbar.addEventListener('click', requestDisconnect);
  els.btnMute.addEventListener('click', toggleMute);
  els.btnDeafen.addEventListener('click', toggleDeafen);
  els.btnJoin.addEventListener('click', () => {
    const selected = selectedChannel();
    if (selected) joinChannel(selected.cid);
  });
  els.btnOpenSettings.addEventListener('click', () => openSettings());
  els.btnCollapseChannels.addEventListener('click', () => {
    state.expanded.clear();
    renderChannels();
  });

  els.btnVoiceTarget.addEventListener('click', () => {
    if (state.menu.open) {
      closeMenu();
      return;
    }
    openVoiceTargetMenu(els.btnVoiceTarget);
  });

  // PTT：指针按住 / 键盘按住
  const startPttButton = (event) => {
    if (event.button != null && event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    try {
      els.btnPtt.setPointerCapture?.(event.pointerId);
    } catch {
      /* ignore */
    }
    startPtt('button');
  };
  els.btnPtt.addEventListener('pointerdown', startPttButton);
  els.btnPtt.addEventListener('pointerup', stopPtt);
  els.btnPtt.addEventListener('pointercancel', stopPtt);
  els.btnPtt.addEventListener('lostpointercapture', stopPtt);
  els.btnPtt.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' && event.code !== 'Enter') return;
    event.preventDefault();
    if (!event.repeat) startPtt('keyboard');
  });
  els.btnPtt.addEventListener('keyup', (event) => {
    if (event.code !== 'Space' && event.code !== 'Enter') return;
    event.preventDefault();
    stopPtt();
  });
  els.btnPtt.addEventListener('blur', stopPtt);

  els.audioStatus.addEventListener('click', () => {
    openSettings('audio');
    ensureAudioForVoice();
  });
}

function startPtt(source = 'button') {
  if (state.pttActive) return;
  if (state.phase !== 'connected') {
    toast('warn', '未连接', '连接服务器后才能说话。');
    return;
  }
  if (state.self?.muted) {
    toast('warn', '麦克风已静音', '请先取消静音再使用按住说话。');
    return;
  }
  if (state.self?.deafened) {
    toast('warn', '耳聋中', '取消耳聋后才能说话。');
    return;
  }
  state.pttActive = true;
  ensureAudioForVoice();
  sendOp('ptt', { active: true });
  callAudio('setPTT', true);
  if (state.mode === 'mock') setSelfTalking(true);
  renderToolbar();
  if (source === 'hotkey') {
    state.pttHotkeySource = 'hotkey';
  }
}

function stopPtt() {
  if (!state.pttActive) return;
  state.pttActive = false;
  if (state.phase === 'connected') sendOp('ptt', { active: false });
  callAudio('setPTT', false);
  if (state.mode === 'mock') setSelfTalking(false);
  renderToolbar();
}

/* ---- 频道树 / 客户端事件 ---- */
function bindChannels() {
  els.channelTree.addEventListener('click', (event) => {
    const row = event.target.closest('.tree__row');
    if (!row) return;
    const cid = Number(row.dataset.cid);
    if (event.target.closest('[data-toggle]')) {
      toggleExpanded(cid);
      return;
    }
    selectChannel(cid);
  });

  els.channelTree.addEventListener('dblclick', (event) => {
    const row = event.target.closest('.tree__row');
    if (!row) return;
    const cid = Number(row.dataset.cid);
    selectChannel(cid);
    joinChannel(cid);
  });

  els.channelTree.addEventListener('contextmenu', (event) => {
    const row = event.target.closest('.tree__row');
    if (!row) return;
    event.preventDefault();
    const cid = Number(row.dataset.cid);
    selectChannel(cid);
    openChannelMenu(cid, { x: event.clientX, y: event.clientY, anchor: row });
  });

  els.channelTree.addEventListener('keydown', (event) => {
    const row = event.target.closest('.tree__row');
    if (!row) return;
    const rows = $$('.tree__row', els.channelTree);
    const index = rows.indexOf(row);
    const cid = Number(row.dataset.cid);
    const channel = state.channels.find((entry) => entry.cid === cid);
    if (!channel) return;
    const hasChildren = state.channels.some((entry) => entry.pid === cid);

    const focusAt = (nextIndex) => {
      const target = rows[clamp(nextIndex, 0, rows.length - 1)];
      if (target) focusTreeRow(Number(target.dataset.cid));
    };

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusAt(rows.length - 1);
        break;
      case 'ArrowRight':
        if (hasChildren && !state.expanded.has(cid)) {
          event.preventDefault();
          state.expanded.add(cid);
          renderChannels();
          focusTreeRow(cid);
        }
        break;
      case 'ArrowLeft':
        if (hasChildren && state.expanded.has(cid)) {
          event.preventDefault();
          state.expanded.delete(cid);
          renderChannels();
          focusTreeRow(cid);
        } else if (channel.pid) {
          event.preventDefault();
          focusTreeRow(channel.pid);
        }
        break;
      case 'Enter':
        event.preventDefault();
        selectChannel(cid);
        joinChannel(cid);
        requestAnimationFrame(() => focusTreeRow(Number(row.dataset.cid)));
        break;
      case ' ':
        event.preventDefault();
        selectChannel(cid);
        requestAnimationFrame(() => focusTreeRow(Number(row.dataset.cid)));
        break;
      case 'ContextMenu':
        event.preventDefault();
        selectChannel(cid);
        {
          const rect = row.getBoundingClientRect();
          openChannelMenu(cid, { x: rect.left + 24, y: rect.top + rect.height });
        }
        break;
      default:
        break;
    }
  });

  els.clientList.addEventListener('click', (event) => {
    const button = event.target.closest('.client');
    if (!button) return;
    openClientMenu(Number(button.dataset.clid), anchorPosition(button), button);
  });

  els.clientList.addEventListener('contextmenu', (event) => {
    const button = event.target.closest('.client');
    if (!button) return;
    event.preventDefault();
    openClientMenu(Number(button.dataset.clid), { x: event.clientX, y: event.clientY, anchor: button });
  });
}

function anchorPosition(element) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + Math.min(rect.width, 24), y: rect.bottom + 4, anchor: element };
}

/* ---- 聊天事件 ---- */
function bindChat() {
  els.chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    sendChatMessage();
  });
  els.chatInput.addEventListener('input', updateSendButton);
  els.chatLog.addEventListener(
    'scroll',
    () => {
      const log = els.chatLog;
      state.chatStick = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
    },
    { passive: true },
  );
}

function sendChatMessage() {
  const text = els.chatInput.value.trim();
  if (!text) return;
  if (state.phase !== 'connected') {
    toast('warn', '未连接', '连接服务器后才能发送消息。');
    return;
  }
  if (!currentChannel()) {
    toast('warn', '未加入频道', '请先加入一个频道再发送消息。');
    return;
  }
  state.chatStick = true;
  if (state.mode === 'mock') {
    addMessage({
      from: { clid: state.self.clid, nickname: state.self.nickname },
      text,
      mode: 'channel',
    });
  } else {
    if (!sendOp('chat', { text })) {
      toast('error', '发送失败', 'WebSocket 尚未连接。');
      return;
    }
    addMessage({
      from: { clid: state.self.clid, nickname: state.self.nickname },
      text,
      mode: 'channel',
      pending: true,
    });
  }
  els.chatInput.value = '';
  updateSendButton();
}

function handleSelfEvent(msg) {
  const previousCid = state.self?.cid ?? null;
  state.self = {
    clid: Number(msg.clid) || state.self?.clid || state.clients.find((c) => c.isSelf)?.clid || 0,
    nickname: msg.nickname != null ? String(msg.nickname) : state.self?.nickname ?? '我',
    cid: msg.cid != null ? Number(msg.cid) : previousCid,
    muted: msg.muted != null ? Boolean(msg.muted) : Boolean(state.self?.muted),
    deafened: msg.deafened != null ? Boolean(msg.deafened) : Boolean(state.self?.deafened),
    away: msg.away != null ? Boolean(msg.away) : Boolean(state.self?.away),
  };
  const selfClient = state.clients.find((client) => client.clid === state.self.clid || client.isSelf);
  if (selfClient) {
    selfClient.isSelf = true;
    selfClient.nickname = state.self.nickname;
    selfClient.cid = state.self.cid;
    selfClient.muted = state.self.muted;
    selfClient.deafened = state.self.deafened;
    selfClient.away = state.self.away;
  }
  const newCid = state.self.cid;
  if (newCid != null && newCid !== previousCid) {
    const target = state.channels.find((channel) => channel.cid === newCid);
    state.channels.forEach((channel) => {
      channel.isCurrent = channel.cid === newCid;
    });
    if (target) {
      state.selectedCid = newCid;
      state.treeFocusCid = newCid;
      expandParents(newCid);
      // 初次连接时服务器只是报告所在频道；真正的换频道才提示。
      if (previousCid != null) {
        addSystemMessage(`你已加入频道「${target.name}」。`);
        toast('success', '已加入频道', target.name);
      }
    }
    state.pendingJoinCid = null;
  } else if (newCid != null && state.selectedCid == null) {
    state.selectedCid = newCid;
    state.treeFocusCid = newCid;
    expandParents(newCid);
  }
  callAudio('setMuted', state.self.muted);
  callAudio('setDeafened', state.self.deafened);
  renderAll();
  renderChatHeader();
  updateDocumentTitle();
}

function handleChatEvent(msg) {
  const from = msg.from && typeof msg.from === 'object' ? msg.from : { clid: 0, nickname: '未知' };
  const text = String(msg.text ?? '');
  const ts = Number(msg.ts) || Date.now();
  if (msg.mode === 'system') {
    addMessage({ from, text, ts, mode: 'system' });
    return;
  }
  if (state.self && Number(from.clid) === state.self.clid) {
    const pending = [...state.messages].reverse().find((message) => message.pending && message.text === text);
    if (pending) {
      pending.ts = ts;
      pending.pending = false;
      renderChat();
      return;
    }
  }
  state.chatStick = true;
  addMessage({
    from,
    text,
    ts,
    mode: msg.mode === 'private' ? 'private' : 'channel',
    target: msg.target,
  });
}

function handlePokedEvent(msg) {
  const from = msg.from ?? { clid: 0, nickname: '某人' };
  const text = String(msg.text ?? '');
  addSystemMessage(`${from.nickname} 戳了你${text ? `：${text}` : ''}。`);
  toast('info', `${from.nickname} 戳了你`, text);
}

/* ============================== 8. 设置页 ============================== */

const CODEC_NAMES = {
  0: 'Speex Narrowband',
  1: 'Speex Wideband',
  2: 'Speex Ultra-Wideband',
  3: 'CELT Mono 48kHz',
  4: 'Opus Voice',
  5: 'Opus Music',
};

function bindSettings() {
  // 范围滑条与下拉框
  for (const control of $$('[data-setting]', els.viewSettings)) {
    const key = control.dataset.setting;
    if (control.matches('input[type="range"]')) {
      control.addEventListener('input', () => {
        const value = Number(control.value);
        state.settings[key] = value;
        saveSettings();
        renderSettingDependents();
        applyAudioSettings();
      });
    } else if (control.matches('select')) {
      control.addEventListener('change', () => {
        state.settings[key] = control.value;
        saveSettings();
        applyAudioSettings();
      });
    }
  }

  // 开关（role=switch）
  for (const toggle of $$('[data-toggle-setting]', els.viewSettings)) {
    const key = toggle.dataset.toggleSetting;
    toggle.addEventListener('click', () => {
      const next = toggle.getAttribute('aria-checked') !== 'true';
      toggle.setAttribute('aria-checked', String(next));
      state.settings[key] = next;
      saveSettings();
      renderSettingDependents();
      applyAudioSettings();
    });
  }

  // 编码格式分段控件
  for (const item of $$('[data-choice-setting]', els.viewSettings)) {
    item.addEventListener('click', () => {
      const key = item.dataset.choiceSetting;
      const value = item.dataset.value;
      state.settings[key] = value;
      saveSettings();
      renderSettingDependents();
      applyAudioSettings();
    });
  }

  // 设置分类导航
  for (const tab of $$('.settings-nav__item', els.settingsTabs)) {
    tab.addEventListener('click', () => activateSettingsSection(tab.dataset.section));
  }
  els.settingsTabs.addEventListener('keydown', (event) => {
    const tabs = $$('.settings-nav__item', els.settingsTabs);
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    let nextIndex = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    activateSettingsSection(tabs[nextIndex].dataset.section);
    tabs[nextIndex].focus();
  });

  els.btnSettingsBack.addEventListener('click', leaveSettings);
  els.btnRefreshDevices.addEventListener('click', () => refreshDevices({ requestPermission: true }));
  els.setClientSelect.addEventListener('change', () => {
    const value = els.setClientSelect.value;
    state.selectedClientId = value ? Number(value) : null;
    renderSettingDependents();
  });
  els.setClientVolume.addEventListener('input', () => {
    const clid = state.selectedClientId;
    if (clid == null) return;
    const volume = Number(els.setClientVolume.value);
    state.settings.clientVolumes[clid] = volume;
    saveSettings();
    renderSettingDependents();
    callAudio('setClientVolume', clid, volume / 100);
  });

  // 快捷键捕获
  for (const button of $$('[data-shortcut]', els.viewSettings)) {
    button.addEventListener('click', () => beginShortcutCapture(button, button.dataset.shortcut));
  }
  els.btnResetShortcuts.addEventListener('click', () => {
    state.settings.pttKey = DEFAULT_SETTINGS.pttKey;
    state.settings.muteKey = DEFAULT_SETTINGS.muteKey;
    state.settings.deafenKey = DEFAULT_SETTINGS.deafenKey;
    saveSettings();
    renderSettingDependents();
    renderToolbar();
    toast('success', '快捷键已恢复默认');
  });

  els.btnClearSettings.addEventListener('click', () => {
    openModal({
      title: '清除本地设置？',
      body: '<p>将删除本机保存的音频、播放与快捷键设置，并恢复默认值。此操作不可撤销。</p>',
      actions: [
        { label: '取消', onClick: () => closeModal() },
        {
          label: '清除',
          kind: 'primary',
          onClick: () => {
            try {
              localStorage.removeItem(STORAGE_KEY);
            } catch {
              /* ignore */
            }
            state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
            state.selectedClientId = null;
            renderSettings();
            applyAudioSettings();
            renderToolbar();
            closeModal();
            toast('success', '本地设置已清除');
          },
        },
      ],
    });
  });

  els.btnBackToConnect.addEventListener('click', () => {
    closeModal();
    if (state.phase === 'connected') requestDisconnect();
    else {
      showView(state.mode === 'mock' ? 'main' : 'connect');
      if (state.mode === 'mock') openSettings('about');
    }
  });
}

function activateSettingsSection(section) {
  if (!section) return;
  state.settingsSection = section;
  for (const tab of $$('.settings-nav__item', els.settingsTabs)) {
    const active = tab.dataset.section === section;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  for (const panel of $$('.settings-section', els.viewSettings)) {
    panel.hidden = panel.dataset.section !== section;
  }
  renderSettings();
}

function openSettings(section) {
  if (state.view !== 'settings') state.settingsReturn = state.view;
  activateSettingsSection(section || state.settingsSection || 'audio');
  showView('settings');
  refreshDevices().catch(() => {});
}

function leaveSettings() {
  const returnView = state.settingsReturn === 'main' && state.phase === 'connected' ? 'main' : state.view === 'settings' && state.phase === 'connected' ? 'main' : 'connect';
  showView(returnView);
  if (returnView === 'main') els.btnOpenSettings.focus({ preventScroll: true });
}

function renderSettingDependents() {
  const s = state.settings;

  // 范围滑条与数值
  els.setQuality.value = String(s.quality);
  els.qualityOutput.textContent = String(s.quality);
  fillRange(els.setQuality);
  els.qualityHint.textContent =
    s.quality <= 3 ? '低带宽：弱网优先。' : s.quality <= 6 ? '平衡：适合大多数网络环境。' : '高音质：需要稳定带宽。';

  els.setMasterVolume.value = String(s.masterVolume);
  els.masterVolumeOutput.textContent = `${s.masterVolume}%`;
  fillRange(els.setMasterVolume);

  const clientVolume = state.selectedClientId != null ? Number(s.clientVolumes[state.selectedClientId] ?? 100) : 100;
  els.setClientVolume.value = String(clientVolume);
  els.setClientVolume.disabled = state.selectedClientId == null;
  els.clientVolumeOutput.textContent = `${clientVolume}%`;
  els.clientVolumeTarget.textContent =
    state.selectedClientId == null
      ? '未选择客户端'
      : state.clients.find((client) => client.clid === state.selectedClientId)?.nickname ?? '未知客户端';
  fillRange(els.setClientVolume);

  els.setDuckingAmount.value = String(s.duckingAmount);
  els.duckingOutput.textContent = `${s.duckingAmount}%`;
  els.setDuckingAmount.disabled = !s.ducking;
  els.duckingAmountField.style.opacity = s.ducking ? '' : '0.5';
  fillRange(els.setDuckingAmount);

  // 开关
  for (const toggle of $$('[data-toggle-setting]', els.viewSettings)) {
    const key = toggle.dataset.toggleSetting;
    toggle.setAttribute('aria-checked', String(Boolean(s[key])));
  }

  // 编码格式
  for (const item of $$('[data-choice-setting]', els.viewSettings)) {
    const active = item.dataset.choiceSetting === 'codec' && s.codec === item.dataset.value;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-checked', String(active));
    item.tabIndex = active ? 0 : -1;
  }

  // 设备选择（保留已保存值）
  if (state.devices) {
    applyDeviceSelection(els.setInputDevice, state.devices.inputs, s.inputDevice, '系统默认麦克风');
    applyDeviceSelection(els.setOutputDevice, state.devices.outputs, s.outputDevice, '系统默认扬声器');
  }

  // 快捷键
  els.setPttKey.textContent = keyLabel(s.pttKey);
  els.setMuteKey.textContent = keyLabel(s.muteKey);
  els.setDeafenKey.textContent = keyLabel(s.deafenKey);
}

function fillRange(input) {
  if (!input) return;
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const value = Number(input.value) || 0;
  const percent = ((value - min) / (max - min || 1)) * 100;
  input.style.setProperty('--fill', `${clamp(percent, 0, 100)}%`);
}

function renderSettings() {
  renderSettingDependents();
  renderSettingsClientOptions();
  updateDiagnostics();
  if (els.aboutEndpoint) els.aboutEndpoint.textContent = wsUrl();
  if (els.aboutMode) {
    els.aboutMode.textContent = state.mode === 'mock' ? '演示数据（?mock=1）' : state.phase === 'connected' ? '连接真实服务器' : '未连接';
  }
  if (els.aboutAudio) {
    els.aboutAudio.textContent = `${state.audioStatus === 'ready' ? '已就绪' : state.audioStatus === 'loading' ? '正在初始化' : state.audioStatus === 'unavailable' ? '不可用（降级运行）' : '未初始化'}${state.audioMessage ? ` · ${state.audioMessage}` : ''}`;
  }
}

function renderSettingsClientOptions() {
  if (!els.setClientSelect) return;
  const previous = state.selectedClientId != null ? String(state.selectedClientId) : els.setClientSelect.value;
  const clients = state.clients.filter((client) => client.type !== 1 && !client.isSelf);
  els.setClientSelect.replaceChildren(new Option('选择客户端后调整', ''));
  for (const client of clients) {
    els.setClientSelect.append(new Option(client.nickname, String(client.clid)));
  }
  if (previous && clients.some((client) => String(client.clid) === previous)) {
    els.setClientSelect.value = previous;
    state.selectedClientId = Number(previous);
  } else {
    els.setClientSelect.value = '';
    state.selectedClientId = null;
  }
  renderSettingDependents();
}

async function refreshDevices({ requestPermission = false } = {}) {
  if (!navigator.mediaDevices?.enumerateDevices) {
    els.inputDeviceHint.textContent = '当前浏览器不支持枚举音频设备，将使用系统默认设备。';
    return;
  }
  try {
    if (requestPermission && navigator.mediaDevices.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((device) => device.kind === 'audioinput');
    const outputs = devices.filter((device) => device.kind === 'audiooutput');
    state.devices = { inputs, outputs };
    applyDeviceSelection(els.setInputDevice, inputs, state.settings.inputDevice, '系统默认麦克风');
    applyDeviceSelection(els.setOutputDevice, outputs, state.settings.outputDevice, '系统默认扬声器');
    const named = [...inputs, ...outputs].some((device) => device.label);
    els.inputDeviceHint.textContent = named
      ? `已发现 ${inputs.length} 个输入设备、${outputs.length} 个输出设备。`
      : '设备名称需要麦克风权限后才会显示；可点击「刷新设备」授权。';
  } catch (error) {
    els.inputDeviceHint.textContent = `无法读取音频设备：${error?.message ?? '权限被拒绝'}`;
  }
}

function applyDeviceSelection(select, devices, selectedId, defaultLabel) {
  if (!select) return;
  select.replaceChildren(new Option(defaultLabel, ''));
  devices.forEach((device, index) => {
    const label = device.label || `${device.kind === 'audioinput' ? '麦克风' : '扬声器'} ${index + 1}`;
    select.append(new Option(label, device.deviceId));
  });
  if (selectedId && devices.some((device) => device.deviceId === selectedId)) {
    select.value = selectedId;
  } else {
    select.value = '';
  }
}

let shortcutCapture = null;

function beginShortcutCapture(button, settingKey) {
  if (shortcutCapture) cancelShortcutCapture();
  shortcutCapture = { button, settingKey, originalText: button.textContent };
  button.classList.add('is-listening');
  button.textContent = '请按下按键…';
  window.addEventListener('keydown', onShortcutCapture, true);
}

function onShortcutCapture(event) {
  if (!shortcutCapture) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') {
    cancelShortcutCapture();
    return;
  }
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
  const code = event.code || event.key;
  const { settingKey, button } = shortcutCapture;
  for (const otherKey of ['pttKey', 'muteKey', 'deafenKey']) {
    if (otherKey !== settingKey && state.settings[otherKey] === code) {
      state.settings[otherKey] = '';
    }
  }
  state.settings[settingKey] = code;
  saveSettings();
  button.classList.remove('is-listening');
  shortcutCapture = null;
  window.removeEventListener('keydown', onShortcutCapture, true);
  renderSettingDependents();
  renderToolbar();
  toast('success', '快捷键已更新', keyLabel(code));
}

function cancelShortcutCapture() {
  if (!shortcutCapture) return;
  const { button, originalText } = shortcutCapture;
  button.classList.remove('is-listening');
  button.textContent = originalText;
  shortcutCapture = null;
  window.removeEventListener('keydown', onShortcutCapture, true);
}

/* ---- 诊断 ---- */
function updateDiagnostics() {
  const viewport = `${window.innerWidth} × ${window.innerHeight}`;
  const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
  document.documentElement.dataset.overflowX = overflow ? '1' : '0';
  document.documentElement.dataset.uiErrors = String(state.errors.length);
  if (els.aboutViewport) els.aboutViewport.textContent = viewport;
  if (els.aboutOverflow) {
    els.aboutOverflow.textContent = overflow
      ? `检测到横向溢出（${document.documentElement.scrollWidth}px > ${document.documentElement.clientWidth}px）`
      : '无横向溢出';
  }
  if (els.aboutErrors) {
    const latest = state.errors[0];
    els.aboutErrors.textContent = state.errors.length === 0
      ? '0 个'
      : `${state.errors.length} 个 · 最近：${latest?.message ?? ''}`;
  }
  if (els.aboutAudio) {
    const labels = { idle: '未初始化', loading: '正在初始化', ready: '已就绪', unavailable: '不可用（降级运行）' };
    els.aboutAudio.textContent = `${labels[state.audioStatus] ?? '未初始化'}${state.audioMessage ? ` · ${state.audioMessage}` : ''}`;
  }
  if (els.aboutMode) {
    els.aboutMode.textContent = state.mode === 'mock' ? '演示数据（?mock=1）' : state.phase === 'connected' ? '连接真实服务器' : '未连接';
  }
}

function recordRuntimeError(scope, message) {
  const text = String(message ?? '').trim();
  if (!text) return;
  state.errors.unshift({ scope, message: text, ts: Date.now() });
  if (state.errors.length > MAX_ERRORS) state.errors.length = MAX_ERRORS;
  document.documentElement.dataset.uiErrors = String(state.errors.length);
  updateDiagnostics();
}

function pushLog(level, text) {
  state.logs.unshift({ level, text, ts: Date.now() });
  if (state.logs.length > MAX_LOGS) state.logs.length = MAX_LOGS;
}

let layoutCheckScheduled = false;
function scheduleLayoutCheck() {
  if (layoutCheckScheduled) return;
  layoutCheckScheduled = true;
  requestAnimationFrame(() => {
    layoutCheckScheduled = false;
    updateDiagnostics();
  });
}

/* ============================== 9. 浮层：菜单 / Toast / 对话框 ============================== */

let menuKeyHandler = null;
let menuPointerHandler = null;

function openMenu(items, position = {}, anchor = null, menuLabel = '上下文菜单') {
  closeMenu({ restoreFocus: false, silent: true });
  state.menu.open = true;
  state.menu.items = items;
  state.menu.anchor = anchor ?? document.activeElement;

  els.menu.replaceChildren();
  els.menu.setAttribute('aria-label', menuLabel);
  items.forEach((item, index) => {
    if (item.separator) {
      const sep = el('div', 'menu__sep');
      sep.setAttribute('role', 'separator');
      els.menu.append(sep);
      return;
    }
    const button = el('button', `menu__item${item.danger ? ' menu__item--danger' : ''}`);
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.dataset.index = String(index);
    if (item.checked != null) button.setAttribute('aria-checked', String(Boolean(item.checked)));
    if (item.disabled) {
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
    }
    button.innerHTML = [
      item.icon ? icon(item.icon, 'icon icon--sm menu__icon') : '<span class="menu__icon"></span>',
      `<span class="menu__label">${escapeHtml(item.label)}</span>`,
      item.shortcut ? `<span class="menu__shortcut">${escapeHtml(item.shortcut)}</span>` : '',
      item.checked != null ? icon('check-circle', 'icon icon--sm menu__check') : '',
    ].join('');
    button.addEventListener('click', () => activateMenuItem(item));
    els.menu.append(button);
  });

  els.menuLayer.hidden = false;
  els.menu.style.left = '0px';
  els.menu.style.top = '0px';

  requestAnimationFrame(() => positionMenu(position));
  if (anchor) anchor.setAttribute('aria-expanded', 'true');

  menuKeyHandler = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (event.key === 'Tab') {
      closeMenu({ restoreFocus: false });
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
    const buttons = $$('.menu__item:not(:disabled)', els.menu);
    if (buttons.length === 0) return;
    const currentIndex = buttons.indexOf(document.activeElement);
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (currentIndex >= 0) buttons[currentIndex].click();
      return;
    }
    event.preventDefault();
    let nextIndex = currentIndex + (event.key === 'ArrowDown' ? 1 : -1);
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = buttons.length - 1;
    if (currentIndex < 0) nextIndex = 0;
    nextIndex = (nextIndex + buttons.length) % buttons.length;
    buttons[nextIndex].focus({ preventScroll: true });
  };
  document.addEventListener('keydown', menuKeyHandler, true);

  menuPointerHandler = (event) => {
    if (event.target.closest('.menu')) return;
    closeMenu({ restoreFocus: false });
  };
  els.menuLayer.addEventListener('pointerdown', menuPointerHandler);
  els.menu.addEventListener('contextmenu', (event) => event.preventDefault());

  requestAnimationFrame(() => {
    const first = els.menu.querySelector('.menu__item:not(:disabled)');
    first?.focus({ preventScroll: true });
  });
}

function positionMenu(position) {
  const rect = els.menu.getBoundingClientRect();
  const pad = 8;
  let x = Number(position.x);
  let y = Number(position.y);
  if (!Number.isFinite(x)) x = window.innerWidth / 2 - rect.width / 2;
  if (!Number.isFinite(y)) y = window.innerHeight / 2 - rect.height / 2;
  if (x + rect.width > window.innerWidth - pad) x = Math.max(pad, x - rect.width);
  if (y + rect.height > window.innerHeight - pad) y = Math.max(pad, y - rect.height);
  x = clamp(x, pad, Math.max(pad, window.innerWidth - rect.width - pad));
  y = clamp(y, pad, Math.max(pad, window.innerHeight - rect.height - pad));
  els.menu.style.left = `${x}px`;
  els.menu.style.top = `${y}px`;
}

function activateMenuItem(item) {
  if (!item || item.disabled) return;
  const anchor = state.menu.anchor;
  closeMenu({ restoreFocus: false });
  if (anchor && typeof anchor.focus === 'function') anchor.focus({ preventScroll: true });
  try {
    item.onSelect?.();
  } catch (error) {
    recordRuntimeError('ui', `菜单动作失败：${error?.message ?? error}`);
  }
}

function closeMenu({ restoreFocus = true, silent = false } = {}) {
  const wasOpen = state.menu.open;
  state.menu.open = false;
  state.menu.items = [];
  els.menuLayer.hidden = true;
  els.menu.replaceChildren();
  if (menuKeyHandler) document.removeEventListener('keydown', menuKeyHandler, true);
  if (menuPointerHandler) els.menuLayer.removeEventListener('pointerdown', menuPointerHandler);
  menuKeyHandler = null;
  menuPointerHandler = null;
  const anchor = state.menu.anchor;
  state.menu.anchor = null;
  if (anchor && anchor.setAttribute) anchor.setAttribute('aria-expanded', 'false');
  if (wasOpen && restoreFocus && anchor && typeof anchor.focus === 'function') {
    anchor.focus({ preventScroll: true });
  }
  if (!silent) scheduleLayoutCheck();
}

function openChannelMenu(cid, { x, y, anchor } = {}) {
  const channel = state.channels.find((entry) => entry.cid === cid);
  if (!channel) return;
  selectChannel(cid);
  const hasChildren = state.channels.some((entry) => entry.pid === cid);
  const expanded = state.expanded.has(cid);
  openMenu(
    [
      {
        label: '加入频道',
        icon: 'login',
        disabled: isCurrentChannel(channel),
        onSelect: () => joinChannel(cid),
      },
      {
        label: '频道信息',
        icon: 'info',
        onSelect: () => showChannelInfo(cid),
      },
      {
        label: '复制频道名称',
        icon: 'copy',
        onSelect: () => copyText(channel.name),
      },
      { separator: true },
      {
        label: expanded ? '折叠子频道' : '展开子频道',
        icon: 'chevron-right',
        disabled: !hasChildren,
        onSelect: () => toggleExpanded(cid),
      },
    ],
    { x, y },
    anchor,
    '频道操作',
  );
}

function openClientMenu(clid, { x, y, anchor } = {}) {
  const client = state.clients.find((entry) => entry.clid === clid);
  if (!client) return;
  const items = [];
  if (!client.isSelf) {
    items.push(
      { label: '戳一戳', icon: 'bell', onSelect: () => showPokeDialog(client) },
      {
        label: state.whisper.clients.includes(clid) ? '移出私语目标' : '加入私语目标',
        icon: 'target',
        checked:
          state.whisper.clients.includes(clid) ? true : state.whisper.clients.length === 0 ? false : undefined,
        onSelect: () => toggleWhisperClient(clid),
      },
      { separator: true },
    );
  }
  items.push(
    { label: '复制昵称', icon: 'copy', onSelect: () => copyText(client.nickname) },
    { label: '客户端信息', icon: 'info', onSelect: () => showClientInfo(clid) },
  );
  openMenu(items, { x, y }, anchor, '客户端操作');
}

function openVoiceTargetMenu(anchor) {
  const selfCid = state.self?.clid;
  const clients = state.clients.filter((client) => !client.isSelf && client.clid !== selfCid && client.type !== 1);
  const items = [
    {
      label: '频道语音（当前频道）',
      icon: 'hash',
      checked: state.whisper.clients.length === 0,
      onSelect: () => clearWhisperTargets(),
    },
    { separator: true },
  ];
  if (clients.length === 0) {
    items.push({ label: '暂无可私聊的客户端', icon: 'users', disabled: true });
  } else {
    for (const client of clients) {
      items.push({
        label: `私聊 · ${client.nickname}`,
        icon: 'user',
        checked: state.whisper.clients.includes(client.clid),
        onSelect: () => toggleWhisperClient(client.clid),
      });
    }
  }
  const rect = anchor.getBoundingClientRect();
  const y = rect.bottom + 4;
  const x = rect.right;
  openMenu(items, { x: x - 240, y }, anchor, '选择语音目标');
  anchor.setAttribute('aria-expanded', 'true');
}

function toggleWhisperClient(clid) {
  const client = state.clients.find((entry) => entry.clid === clid);
  if (!client) return;
  const index = state.whisper.clients.indexOf(clid);
  let added;
  if (index >= 0) {
    state.whisper.clients.splice(index, 1);
    added = false;
  } else {
    state.whisper.clients.push(clid);
    added = true;
  }
  state.whisper.active = state.whisper.clients.length > 0;
  if (state.mode === 'live' && state.phase === 'connected') {
    sendOp('whisper', {
      targets: { channels: [], clients: [...state.whisper.clients] },
      active: state.whisper.active,
    });
  }
  updateVoiceTargetLabel();
  toast(added ? 'success' : 'info', added ? '已加入私语目标' : '已移出私语目标', client.nickname);
}

function clearWhisperTargets() {
  if (state.whisper.clients.length === 0) {
    toast('info', '当前为频道语音');
    return;
  }
  state.whisper.clients = [];
  state.whisper.active = false;
  if (state.mode === 'live' && state.phase === 'connected') {
    sendOp('whisper', { targets: { channels: [], clients: [] }, active: false });
  }
  updateVoiceTargetLabel();
  toast('info', '已切换为频道语音');
}

async function copyText(text) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const helper = document.createElement('textarea');
      helper.value = value;
      helper.setAttribute('readonly', '');
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.append(helper);
      helper.select();
      document.execCommand('copy');
      helper.remove();
    }
    toast('success', '已复制', value.length > 40 ? `${value.slice(0, 40)}…` : value);
  } catch {
    toast('error', '复制失败', '浏览器阻止了剪贴板访问。');
  }
}

/* ---- Toast ---- */
let toastSeq = 0;

function toast(kind, title, text, { timeout = 4200 } = {}) {
  if (!els.toastRegion) return;
  const type = ['success', 'error', 'warn', 'info'].includes(kind) ? kind : 'info';
  const icons = { success: 'check-circle', error: 'alert', warn: 'alert', info: 'info' };
  const node = el('div', `toast toast--${type}`);
  node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  node.dataset.toastId = String(++toastSeq);
  node.innerHTML = [
    `<span class="toast__icon">${icon(icons[type], 'icon')}</span>`,
    '<div class="toast__text">',
    '<p class="toast__title"></p>',
    text ? '<p class="toast__desc"></p>' : '',
    '</div>',
    `<button type="button" class="toast__close" aria-label="关闭通知">${icon('x', 'icon icon--sm')}</button>`,
  ].join('');
  node.querySelector('.toast__title').textContent = title;
  if (text) node.querySelector('.toast__desc').textContent = text;

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 180);
  };
  node.querySelector('.toast__close').addEventListener('click', dismiss);
  els.toastRegion.append(node);

  const existing = $$('.toast', els.toastRegion);
  while (existing.length > 4) existing.shift()?.remove();
  setTimeout(dismiss, timeout);
}

/* ---- 对话框 ---- */
let modalKeyHandler = null;

function openModal({ title, body, actions = [], onClose = null }) {
  closeModal({ restoreFocus: false, silent: true });
  state.modal.open = true;
  state.modal.restoreFocus = document.activeElement;
  state.modal.onClose = onClose;
  els.modalTitle.textContent = title;
  els.modalBody.replaceChildren();
  if (typeof body === 'string') els.modalBody.innerHTML = body;
  else if (body instanceof Node) els.modalBody.append(body);
  els.modalActions.replaceChildren();

  actions.forEach((action) => {
    const button = el('button', `btn ${action.kind === 'primary' ? 'btn--primary' : 'btn--secondary'}`, action.label);
    button.type = 'button';
    button.addEventListener('click', () => action.onClick?.());
    els.modalActions.append(button);
  });

  els.modalLayer.hidden = false;

  modalKeyHandler = (event) => {
    if (!state.modal.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = $$('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])', els.modal).filter(
      (node) => !node.disabled && node.offsetParent !== null,
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', modalKeyHandler, true);

  requestAnimationFrame(() => {
    const auto = els.modal.querySelector('[data-autofocus]') ?? els.modalActions.querySelector('.btn--primary') ?? els.modalClose;
    auto?.focus({ preventScroll: true });
  });
}

function closeModal({ restoreFocus = true, silent = false } = {}) {
  const wasOpen = state.modal.open;
  state.modal.open = false;
  els.modalLayer.hidden = true;
  els.modalBody.replaceChildren();
  els.modalActions.replaceChildren();
  if (modalKeyHandler) document.removeEventListener('keydown', modalKeyHandler, true);
  modalKeyHandler = null;
  const restore = state.modal.restoreFocus;
  state.modal.restoreFocus = null;
  const onClose = state.modal.onClose;
  state.modal.onClose = null;
  if (wasOpen && restoreFocus && restore && typeof restore.focus === 'function') {
    restore.focus({ preventScroll: true });
  }
  if (!silent) {
    onClose?.();
    scheduleLayoutCheck();
  }
}

function showChannelInfo(cid) {
  const channel = state.channels.find((entry) => entry.cid === cid);
  if (!channel) return;
  const rows = [
    ['频道名称', channel.name],
    ['频道 ID', String(channel.cid)],
    ['父频道', String(channel.pid || '—')],
    ['编码格式', `${CODEC_NAMES[channel.codec] ?? `未知（${channel.codec}）`} · 质量 ${channel.codecQuality}`],
    ['人数', `${channel.totalClients}${channel.maxClients ? ` / ${channel.maxClients}` : ''}`],
    ['需要权限', channel.neededTalkPower ? `发言需要权限 ${channel.neededTalkPower}` : '无特殊要求'],
    ['密码保护', channel.hasPassword ? '需要频道密码' : '无'],
    ['加密', channel.encrypted ? '已加密' : '未加密'],
    ['默认频道', channel.isDefault ? '是' : '否'],
  ];
  if (channel.description) rows.push(['描述', channel.description]);
  const dl = el('dl', 'about-grid');
  for (const [term, value] of rows) {
    dl.append(el('dt', null, term), el('dd', null, value));
  }
  openModal({
    title: '频道信息',
    body: dl,
    actions: [{ label: '关闭', onClick: () => closeModal() }],
  });
}

function showClientInfo(clid) {
  const client = state.clients.find((entry) => entry.clid === clid);
  if (!client) return;
  const channel = state.channels.find((entry) => entry.cid === client.cid);
  const rows = [
    ['昵称', client.nickname],
    ['客户端 ID', String(client.clid)],
    ['所在频道', channel ? channel.name : '未知'],
    ['客户端类型', client.type === 1 ? 'ServerQuery' : '普通客户端'],
    ['麦克风', client.muted ? '已静音' : '开启'],
    ['耳机', client.deafened ? '已耳聋' : '开启'],
    ['状态', client.away ? '暂时离开' : '在线'],
    ['录音', client.recording ? '正在录音' : '否'],
  ];
  const dl = el('dl', 'about-grid');
  for (const [term, value] of rows) {
    dl.append(el('dt', null, term), el('dd', null, value));
  }
  openModal({
    title: '客户端信息',
    body: dl,
    actions: [{ label: '关闭', onClick: () => closeModal() }],
  });
}

function showPokeDialog(client) {
  const container = document.createElement('div');
  container.className = 'field';
  container.innerHTML = `
    <label class="field__label" for="poke-text">消息内容</label>
    <div class="input-shell">
      <input class="input" id="poke-text" data-autofocus type="text" value="戳一戳" maxlength="120">
    </div>
    <p class="field__hint">通过服务器向 ${escapeHtml(client.nickname)} 发送一条戳一戳通知。</p>
  `;
  const send = () => {
    const input = container.querySelector('#poke-text');
    const text = input.value.trim() || '戳一戳';
    if (state.phase !== 'connected') {
      toast('warn', '未连接', '连接服务器后才能戳一戳。');
      return;
    }
    if (state.mode === 'mock') {
      addSystemMessage(`你戳了 ${client.nickname}：${text}`);
      toast('success', '已戳一戳', client.nickname);
    } else if (sendOp('poke', { clid: client.clid, text })) {
      addSystemMessage(`你戳了 ${client.nickname}：${text}`);
      toast('success', '已发送戳一戳', client.nickname);
    } else {
      toast('error', '发送失败', 'WebSocket 尚未连接。');
      return;
    }
    closeModal();
  };
  inputKeySubmit(container, send);
  openModal({
    title: `戳一戳 · ${client.nickname}`,
    body: container,
    actions: [
      { label: '取消', onClick: () => closeModal() },
      { label: '戳一戳', kind: 'primary', onClick: send },
    ],
  });
}

function inputKeySubmit(container, callback) {
  container.querySelectorAll('input').forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        callback();
      }
    });
  });
}

function bindModals() {
  els.modalBackdrop.addEventListener('click', () => closeModal());
  els.modalClose.addEventListener('click', () => closeModal());
}

/* ---- 断开 ---- */
function requestDisconnect() {
  if (state.phase !== 'connected') {
    showView('connect');
    return;
  }
  if (state.mode === 'mock') {
    openModal({
      title: '退出演示模式？',
      body: '<p>将清除演示数据、停止演示计时，并返回连接页。连接页仍可用 <code>?mock=1</code> 或「演示」按钮重新进入。</p>',
      actions: [
        { label: '取消', onClick: () => closeModal() },
        { label: '退出演示', kind: 'primary', onClick: () => exitMockMode() },
      ],
    });
    return;
  }
  openModal({
    title: '断开连接？',
    body: '<p>断开后需要重新连接服务器才能继续聊天与语音。设置会保留在本机。</p>',
    actions: [
      { label: '取消', onClick: () => closeModal() },
      {
        label: '断开',
        kind: 'primary',
        onClick: () => {
          closeModal();
          disconnectLive();
        },
      },
    ],
  });
}

/* ============================== 10. 演示模式与启动 ============================== */

let mockStatsTimer = null;

function mockServerInfo() {
  return {
    name: 'Fluent 语音服务器',
    platform: 'Linux x64',
    version: '3.13.9',
    clientsOnline: 6,
    maxClients: 32,
    uptime: 3 * 86400 + 4 * 3600 + 12 * 60,
    channelsOnline: 3,
    port: 9987,
    welcome: '欢迎来到 Fluent 语音服务器！',
    hostMessage: '此实例用于前端联调与演示。',
  };
}

function mockChannels() {
  return [
    {
      cid: 1, pid: 0, name: '大厅', order: 0, codec: 4, codecQuality: 6,
      neededTalkPower: 0, maxClients: 0, totalClients: 2,
      hasPassword: false, encrypted: true, isDefault: true, isCurrent: false,
      description: '公共接待大厅',
    },
    {
      cid: 2, pid: 1, name: '游戏开黑', order: 0, codec: 4, codecQuality: 6,
      neededTalkPower: 0, maxClients: 8, totalClients: 3,
      hasPassword: true, encrypted: true, isDefault: false, isCurrent: true,
      description: '开黑小队频道',
    },
    {
      cid: 3, pid: 1, name: '音乐房间', order: 1, codec: 5, codecQuality: 8,
      neededTalkPower: 0, maxClients: 0, totalClients: 1,
      hasPassword: false, encrypted: false, isDefault: false, isCurrent: false,
      description: 'Opus Music · 音乐欣赏',
    },
  ];
}

function mockClients() {
  return [
    { clid: 1, cid: 2, nickname: '夜风', type: 0, isSelf: true, isTalking: false, muted: false, deafened: false, away: false, recording: false },
    { clid: 2, cid: 2, nickname: '小林', type: 0, isSelf: false, isTalking: true, muted: false, deafened: false, away: false, recording: false },
    { clid: 3, cid: 2, nickname: 'Aurora', type: 0, isSelf: false, isTalking: false, muted: true, deafened: false, away: false, recording: false },
    { clid: 4, cid: 1, nickname: '老王', type: 0, isSelf: false, isTalking: false, muted: false, deafened: false, away: true, recording: false },
    { clid: 5, cid: 1, nickname: '喵喵', type: 0, isSelf: false, isTalking: false, muted: false, deafened: false, away: false, recording: false },
    { clid: 6, cid: 3, nickname: 'ServerQuery', type: 1, isSelf: false, isTalking: false, muted: false, deafened: false, away: false, recording: false },
  ];
}

function mockMessages() {
  const now = Date.now();
  return [
    { from: { clid: 0, nickname: '系统' }, text: '欢迎来到「Fluent 语音服务器」！', ts: now - 18 * 60000, mode: 'system' },
    { from: { clid: 2, nickname: '小林' }, text: '晚上好，麦克风测试一下？', ts: now - 9 * 60000, mode: 'channel' },
    { from: { clid: 1, nickname: '夜风' }, text: '收到，声音很清楚。这行只是演示数据，不需要真实麦克风。', ts: now - 8 * 60000, mode: 'channel' },
    { from: { clid: 3, nickname: 'Aurora' }, text: '我在听，歌单已经放到共享频道了。', ts: now - 5 * 60000, mode: 'channel' },
    { from: { clid: 0, nickname: '系统' }, text: '老王 加入了频道「大厅」', ts: now - 3 * 60000, mode: 'system' },
  ];
}

function startMock(params = new URLSearchParams()) {
  stopMockStats();
  state.mode = 'mock';
  state.mock = true;
  state.phase = 'connected';
  state.server = mockServerInfo();
  state.channels = mockChannels();
  state.clients = mockClients();
  state.self = {
    clid: 1,
    nickname: '夜风',
    cid: 2,
    muted: false,
    deafened: false,
    away: false,
    inputMuted: false,
    outputMuted: false,
  };
  state.messages = mockMessages().map((message, index) => ({ id: index + 1, ...message }));
  state.selectedCid = 2;
  state.treeFocusCid = 2;
  state.expanded = new Set([1]);
  state.expansionInitialized = true;
  state.stats = {
    ping: 24,
    loss: 0,
    sentBytes: 18240,
    recvBytes: 36112,
    sentPackets: 214,
    recvPackets: 388,
  };
  state.whisper = { channels: [], clients: [], active: false };
  state.loading = { channels: false, clients: false };
  state.failed = { channels: false, clients: false };
  state.chatStick = true;
  state.connectError = '';
  state.audioStatus = 'idle';
  state.audioMessage = '演示模式不会加载音频引擎；连接真实服务器后自动启用。';
  document.documentElement.dataset.mode = 'mock';
  showView('main');
  renderAll();
  renderChatHeader();
  updateDocumentTitle();
  startMockStats();

  const view = params.get('view');
  const demo = params.get('demo');
  if (view === 'settings' || demo === 'settings') {
    setTimeout(() => openSettings('audio'), 30);
  }
  if (demo) {
    setTimeout(() => runDemo(demo), 420);
  }
}

function startMockStats() {
  stopMockStats();
  mockStatsTimer = setInterval(() => {
    state.stats.ping = 20 + Math.round(Math.random() * 9);
    state.stats.sentBytes += 1200 + Math.round(Math.random() * 600);
    state.stats.recvBytes += 2300 + Math.round(Math.random() * 900);
    state.stats.sentPackets += 2;
    state.stats.recvPackets += 3;
    renderStats();
  }, 1000);
}

function stopMockStats() {
  if (mockStatsTimer) {
    clearInterval(mockStatsTimer);
    mockStatsTimer = null;
  }
}

function exitMockMode() {
  stopMockStats();
  closeModal();
  state.mock = false;
  state.mode = 'live';
  delete document.documentElement.dataset.mode;
  state.phase = 'disconnected';
  resetSessionState();
  try {
    const url = new URL(location.href);
    url.searchParams.delete('mock');
    url.searchParams.delete('view');
    url.searchParams.delete('demo');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* ignore */
  }
  showView('connect');
  setConnectStatus('idle', '已退出演示模式，可连接真实服务器。');
  renderAll();
  toast('info', '已退出演示模式');
}

function runDemo(demo) {
  switch (demo) {
    case 'channel-menu': {
      const row = els.channelTree.querySelector('.tree__row.is-current') ?? els.channelTree.querySelector('.tree__row');
      if (row) {
        const rect = row.getBoundingClientRect();
        openChannelMenu(Number(row.dataset.cid), { x: rect.left + 120, y: rect.top + 24, anchor: row });
      }
      break;
    }
    case 'client-menu': {
      const client = state.clients.find((entry) => !entry.isSelf);
      const tile = client ? els.clientList.querySelector(`[data-clid="${client.clid}"]`) : null;
      if (client && tile) {
        openClientMenu(client.clid, anchorPosition(tile), tile);
      }
      break;
    }
    case 'voice-menu':
      openVoiceTargetMenu(els.btnVoiceTarget);
      break;
    case 'toast':
      toast('info', 'Acrylic Flyout', 'Toast 使用 85% 白 + 30px 模糊与 3px 状态条。');
      toast('success', '已加入频道', '游戏开黑');
      toast('warn', '音频引擎未加载', '演示模式不请求 web/audio.js；连接真实服务器后自动启用。');
      break;
    case 'modal':
      showChannelInfo(2);
      break;
    case 'loading': {
      state.loading.channels = true;
      state.loading.clients = true;
      renderChannels();
      renderClients();
      break;
    }
    case 'error': {
      const error = errorState('频道列表加载失败', '本地桥接没有返回频道快照。', () => runDemo('error'), '重新拉取');
      els.channelTree.hidden = true;
      els.channelsState.hidden = false;
      els.channelsState.replaceChildren(error);
      break;
    }
    case 'empty': {
      els.channelTree.hidden = true;
      els.channelsState.hidden = false;
      els.channelsState.replaceChildren(
        emptyState('hash', '还没有频道', '服务器返回的频道列表为空，或尚未加入服务器。', {
          actionLabel: '重新拉取',
          onAction: () => startMock(),
        }),
      );
      break;
    }
    default:
      break;
  }
}

/* ---- 视图切换 ---- */
function showView(name) {
  if (!['connect', 'main', 'settings'].includes(name)) return;
  const previous = state.view;
  state.view = name;
  els.viewConnect.hidden = name !== 'connect';
  els.viewMain.hidden = name !== 'main';
  els.viewSettings.hidden = name !== 'settings';
  scheduleLayoutCheck();
  updateDocumentTitle();
  if (name === 'settings' && previous !== 'settings') {
    requestAnimationFrame(() => els.settingsTitle?.focus({ preventScroll: true }));
  }
}

/* ---- 全局快捷键 ---- */
function bindGlobalKeys() {
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      if (state.menu.open) {
        closeMenu();
        event.preventDefault();
        return;
      }
      if (state.modal.open) {
        closeModal();
        event.preventDefault();
        return;
      }
      if (state.view === 'settings') {
        event.preventDefault();
        leaveSettings();
        return;
      }
      if (shortcutCapture) {
        cancelShortcutCapture();
        return;
      }
    }
    if (state.view !== 'main' || isTypingTarget(event.target) || isHotkeyBlockedTarget(event.target)) return;
    if (state.phase !== 'connected') return;
    if (state.settings.pttKey && matchesShortcut(event, state.settings.pttKey)) {
      if (!event.repeat && !state.pttActive) {
        event.preventDefault();
        startPtt('hotkey');
      }
      return;
    }
    if (!event.repeat && state.settings.muteKey && matchesShortcut(event, state.settings.muteKey)) {
      event.preventDefault();
      toggleMute();
      return;
    }
    if (!event.repeat && state.settings.deafenKey && matchesShortcut(event, state.settings.deafenKey)) {
      event.preventDefault();
      toggleDeafen();
    }
  });

  document.addEventListener('keyup', (event) => {
    if (event.defaultPrevented) return;
    if (state.view !== 'main' || isTypingTarget(event.target)) return;
    if (state.settings.pttKey && matchesShortcut(event, state.settings.pttKey)) {
      event.preventDefault();
      stopPtt();
    }
  });

  window.addEventListener('blur', () => stopPtt());
}

/* ---- 启动 ---- */
function boot() {
  cacheElements();
  bindConnect();
  bindToolbar();
  bindChannels();
  bindChat();
  bindSettings();
  bindModals();
  bindGlobalKeys();
  renderSettingDependents();
  renderSettings();
  setConnectLoading(false);
  setConnectStatus('idle', '等待连接');
  updateAudioStatusUi();

  const params = new URLSearchParams(location.search);
  state.mock = params.get('mock') === '1' && params.get('mock') !== '0';
  if (state.mock) {
    startMock(params);
  } else {
    showView('connect');
    renderAll();
    if (params.get('view') === 'settings') {
      // 无后端时也可以预览设置页：直接进入演示数据再切设置。
      startMock(params);
    }
  }

  window.addEventListener('resize', debounce(updateDiagnostics, 150));
  updateDiagnostics();
  scheduleLayoutCheck();
}

// 尽早记录脚本错误与未处理的 Promise 拒绝（即使启动失败也能在诊断里看到）。
window.addEventListener('error', (event) => {
  if (typeof recordRuntimeError === 'function') {
    recordRuntimeError('runtime', event.message ?? '未知运行时错误');
  }
});

window.addEventListener('unhandledrejection', (event) => {
  if (typeof recordRuntimeError !== 'function') return;
  const reason = event.reason;
  recordRuntimeError('promise', reason?.message ?? String(reason ?? '未处理的 Promise 拒绝'));
});

document.addEventListener('DOMContentLoaded', boot);