# 接口契约（后端 ↔ 前端 ↔ 协议层）

本文件是并行开发的唯一契约。任何一方改动都先改这里。

## 1. WebSocket 协议（`server/app.js` ↔ `web/app.js`）

地址：`ws://127.0.0.1:8787/ws`。文本帧 = JSON；所有 `op` 由前端发起，`ev` 由后端推送。

### 前端 → 后端

| op | 参数 | 说明 |
|---|---|---|
| `connect` | `{host, port, nickname, serverPassword?, channelPassword?, defaultChannel?}` | 建立到 TS3 服务端的会话 |
| `disconnect` | `{}` | 断开 |
| `join` | `{cid}` | 切换到频道 |
| `chat` | `{text}` | 向当前频道发文本 |
| `poke` | `{clid, text}` | 戳一戳 |
| `setSelf` | `{muted?, deafened?, away?, nickname?, inputMuted?, outputMuted?}` | 自身状态 |
| `whisper` | `{targets:{channels?:number[], clients?:number[]}, active:boolean}` | 私语目标开关（语音） |
| `request` | `{what:"serverinfo"\|"channels"\|"clients"\|"permissions"\|"stats"}` | 主动拉取快照 |

### 后端 → 前端

| ev | 结构 | 说明 |
|---|---|---|
| `state` | `{phase:"disconnected"\|"connecting"\|"handshaking"\|"connected"\|"error", error?}` | 连接状态机 |
| `serverinfo` | `{name, platform, version, clientsOnline, maxClients, uptime, channelsOnline, port, welcome, hostMessage}` | 服务器信息 |
| `channels` | `{list: Channel[]}` | 全量频道树快照 |
| `clients` | `{list: Client[]}` | 全量客户端快照 |
| `self` | `{clid, nickname, cid, muted, deafened, away, inputMuted, outputMuted}` | 自身信息变化 |
| `chat` | `{from:{clid,nickname}, text, ts, mode:"channel"\|"server"\|"private", target?}` | 收到的文本消息 |
| `poked` | `{from:{clid,nickname}, text}` | 被戳 |
| `voice` | `{from:clid, codec, seq, data:base64}` | 一个解码前的 Opus 帧（前端自行解码播放） |
| `stats` | `{ping, loss, sentBytes, recvBytes, sentPackets, recvPackets}` | 统计（1 Hz） |
| `error` | `{code, message}` | 错误 |
| `log` | `{level, text}` | 诊断日志 |

### 数据模型

```ts
type Channel = {
  cid: number; pid: number; name: string; order: number;
  codec: number;              // 0=Speex NB,1=Speex WB,2=Speex UWB,3=CELT Mono 48k,4=Opus Voice,5=Opus Music
  codecQuality: number;       // 0..10
  neededTalkPower: number; maxClients: number; totalClients: number;
  hasPassword: boolean; encrypted: boolean; isDefault: boolean; isCurrent: boolean;
  description?: string;
};

type Client = {
  clid: number; cid: number; nickname: string; type: 0|1;   // 1=query
  isSelf: boolean; isTalking: boolean; muted: boolean; deafened: boolean;
  away: boolean; recording: boolean; channelGroupId?: number; serverGroups?: number[];
};
```

## 2. 协议层模块契约（`server/ts3/*.js`）

```js
// crypto.js
export function aesCmac(key, data): Buffer;
export function eaxEncrypt({key, nonce, header, plaintext}): Buffer; // -> tag(8) 拼在前面由上层决定
export function eaxDecrypt({key, nonce, header, ciphertext, tag}): Buffer | null; // null = 认证失败
export function deriveVoiceKeys(material: Buffer, counter: number, mode: number, type: number): {key, nonce};
export function sha256(...parts): Buffer;

// packet.js
export const PacketType = { VOICE:0, VOICE_WHISPER:1, COMMAND:2, COMMAND_LOW:3,
                            PING:4, PONG:5, ACK:6, ACK_LOW:7, INIT1:8 };
export function buildPacket({type, packetId, flags, payload}): Buffer;      // 明文 11/13 字节头 + payload
export function parsePacket(buf): {type, packetId, flags, payload} | null;
export function packetMtu(isIpv6): number;

// handshake.js
export async function handshake({socket, host, port, identity}): Promise<Session>;
// Session = { serverKey: Buffer, clientIdIn: number, clientIdOut: number, connectionKey: Buffer, … }

// command.js
export function encodeCommand(name, params): Buffer;
export function parseCommand(buf): {name, params, flags};

// connection.js
export class Ts3Connection extends EventEmitter {
  constructor({host, port, identity, voiceCodec, voiceQuality});
  async connect(nickname);         // 握手 + 注册客户端 + 事件订阅
  async command(name, params);     // 可靠发送并等回复
  async join(cid); async chat(text); async poke(clid, text); async setSelf(params);
  async sendVoice({codec, seq, frames, targets});
  on('event', ({type, data}) => …); on('voice', ({clid, codec, seq, data}) => …);
  close();
}

// voice.js
export function buildVoicePayload({codec, seq, frames, targets}): Buffer;
export function parseVoicePayload(buf): {codec, seq, frames, targets};
```

## 3. 约束

- 后端不得把大型二进制（>64 KB 单帧）塞进 WS；语音帧每帧 ≤ 200 B base64。
- 所有时间戳统一毫秒（`Date.now()`）；协议内时间戳按 TS3 字段宽度转换。
- 任何协议层失败必须 `emit('error')` 且带可读原因，不允许静默丢弃。
- UI 必须能在「无后端（mock 模式）」下渲染，便于并行开发。
### 语音上行（补充）

| op | 参数 | 说明 |
|---|---|---|
| `voiceFrame` | `{codec, data:base64}` | 浏览器 Opus 帧上行；后端加密封装成 VOICE 包 |
| `ptt` | `{active:boolean}` | 按下/松开说话键 |
