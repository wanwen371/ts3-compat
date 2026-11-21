# 功能矩阵（“复现全部功能”的追踪表）

状态：`✅ 已实现` · `🚧 进行中` · `⬜ 未开始` · `⚠️ 需协议未确认项`
数据来源：`../ts3-mod/report/parts/04-voice-client.md` §8（逆向出的 25 项语音功能）+ TS3 客户端实测功能面 + 服务端 `serverquerydocs`（140 命令）。

## A. 连接与协议（P0，阻塞项）

| # | 功能 | 状态 | 负责人 | 说明 |
|---|---|---|---|---|
| A1 | UDP 传输 + 包头编解码 | ✅ | protocol-eng | 入站 13B / 出站 11B，9 种类型 |
| A2 | AES-128-EAX（tag 8B）+ SHA-256 KDF | ✅ | protocol-eng | 含 fake-key 预握手阶段 |
| A3 | INIT1 三变体握手（34/38/469） | ✅ | protocol-eng | 字节布局已由抓包+反编译确定（docs/ghidra/handshake-findings.md） |
| A4 | RSA puzzle 求解 | ✅ | protocol-eng | 服务端 `rsa_puzzle.cpp` |
| A5 | 可靠通道（ACK/重传/序号）+ 分片 | ✅ | protocol-eng | PING/PONG 窗口 20 |
| A6 | 命令语法（转义/参数/错误码） | ✅ | protocol-eng | 与 ServerQuery 同构 |
| A7 | 事件订阅与分发 | ✅ | protocol-eng | notifycliententerview / notifytextmessage 等 |
| A8 | 重连/心跳/超时 | ⬜ | protocol-eng | |

## B. 语音（P0–P1）

| # | 功能 | 状态 | 负责人 | 说明 |
|---|---|---|---|---|
| B1 | Opus Voice 编码（48k/20ms/单声道） | ✅ | media-eng | 浏览器 WebCodecs |
| B2 | Opus Music（立体声） | ⬜ | media-eng | codec=5 |
| B3 | CELT Mono 48k / Speex NB/WB/UWB | ⬜ | media-eng | codec 0–3（浏览器无内置，需 wasm 解码器） |
| B4 | 语音包封装/解析（序列号、多帧、whisper 目标） | ✅ | media-eng | 06 §4 |
| B5 | 抖动缓冲（jitter buffer） | ⬜ | media-eng | 客户端逆向为 speex_ts jitter |
| B6 | 多客户端混音 + 单客户端音量 | 🚧 | media-eng | |
| B7 | PTT 按键说话 | ✅ | ui-eng/media-eng | 含松开延迟 |
| B8 | VAD 自动检测（Automatic/Volume Gate/Hybrid） | ⬜ | media-eng | 浏览器侧能量门限起步 |
| B9 | 连续传输 | ⬜ | media-eng | |
| B10 | 回声消除 AEC | 🚧 | media-eng | 浏览器 `echoCancellation` 约束可映射 |
| B11 | 降噪 NS | 🚧 | media-eng | `noiseSuppression` 约束 |
| B12 | AGC 自动增益 | 🚧 | media-eng | `autoGainControl` 约束 |
| B13 | 打字声衰减 / 舒适噪声 / Ducking | ⬜ | media-eng | P2 |
| B14 | 3D 位置音效 | ⬜ | media-eng | P2（WebAudio PannerNode 可做） |
| B15 | 语音测试（自己听自己） | ⬜ | media-eng | |
| B16 | 录音（单轨） | ⬜ | media-eng | MediaRecorder |
| B17 | 语音数据加密开关（频道级） | ⬜ | protocol-eng | 服务端属性 `channel_codec*` |

## C. 文字与社交（P0–P1）

| # | 功能 | 状态 | 负责人 |
|---|---|---|---|
| C1 | 频道/服务器/私聊文本消息 | ✅ | protocol-eng + ui-eng |
| C2 | 聊天记录（本地持久化） | ⬜ | ui-eng |
| C3 | Poke 戳一戳 | ✅ | protocol-eng |
| C4 | 客户端信息查看（clientinfo） | ⬜ | ui-eng |
| C5 | 频道信息（topic/description/密码/加密） | ⬜ | ui-eng |
| C6 | 好友/屏蔽（contacts） | ⬜ | P2 |
| C7 | Whisper 私语（频道/客户端定向） | ⬜ | P1 |

## D. 频道与权限（P1）

| # | 功能 | 状态 | 说明 |
|---|---|---|---|
| D1 | 频道树（增删改、移动、排序） | ⬜ | 需 `channelcreate/channeledit/channelmove` 权限 |
| D2 | 加入/离开频道、密码频道 | ⬜ | |
| D3 | 频道组/服务器组查看 | ⬜ | |
| D4 | 权限查看（`permissionlist`） | ⬜ | 515 条权限名 |
| D5 | 说话权限（talk power）请求/授予 | ⬜ | |
| D6 | 踢人/封禁 | ⬜ | P2 |

## E. 服务器与文件（P1–P2）

| # | 功能 | 状态 |
|---|---|---|
| E1 | 服务器信息面板（serverinfo） | ⬜ |
| E2 | 文件传输（30033 TCP，filetransfer2） | ⬜ P2 |
| E3 | 服务器图标/欢迎语/主机消息 | ⬜ |
| E4 | 书签管理（bookmarks） | ⬜ P2 |
| E5 | 多服务器标签页 | ⬜ P1 |

## F. UI / 体验（P0）

| # | 功能 | 状态 | 负责人 |
|---|---|---|---|
| F1 | Fluent 设计系统（颜色/字体/圆角/阴影/焦点环/动效） | ✅ | ui-eng |
| F2 | 连接页 | ✅ | ui-eng |
| F3 | 主界面（频道树/客户端列表/聊天/工具栏/状态栏） | ✅ | ui-eng |
| F4 | 设置页（音频/播放/快捷键/关于） | ✅ | ui-eng |
| F5 | 右键菜单 / Toast / 空态 / 错误态 | ✅ | ui-eng |
| F6 | 响应式（1024/768 不溢出） | ✅ | ui-eng |
| F7 | 键盘可达 + prefers-reduced-motion | ✅ | ui-eng |
| F8 | 主题（浅色；深色 P2） | ⬜ | ui-eng |

## G. 明确不做 / 降级说明

| 项 | 原因 |
|---|---|
| 插件系统（116 个 `ts3plugin_*` ABI） | 需要加载 Windows DLL，Web 端无法复现 → P2 用「内置扩展」替代 |
| Qt 原生皮肤（QSS） | Web 端无意义，改用 Fluent 设计系统 |
| ServerQuery 管理端全量 | P2，先做只读查询 |
| Speex/CELT 浏览器解码 | 需 wasm 解码器，P2 视需要 |

---

**统计**：A 8 项 + B 17 项 + C 7 项 + D 6 项 + E 5 项 + F 8 项 = **51 项**。
P0 必须完成：A1–A7、B1、B4、B7、C1、F1–F5（约 16 项）。
---

## 已验证的端到端结果（2026-11-21 22:05，本机真实 ts3server 3.13.9）

| 链路 | 结果 | 证据 |
|---|---|---|
| Node 客户端直连 | ✅ 握手 33–40ms、clid 分配、serverinfo/channellist/clientlist、发文本收到回显、ping=1ms | `node test/client-cli.js ...` 输出 `[done] ok` |
| WS 桥接 | ✅ 11 类事件（state/serverinfo/channels/clients/self/chat/voice/stats/log）全部到达 | `node test/ws-smoke.mjs` |
| 语音（Node↔Node） | ✅ 两连接经真服务器转发，帧字节逐一相同 | `node test/voice.test.js` 47/47 pass（含 live） |
| 语音（WS 上行） | ✅ 10 帧 60B 经桥→协议→服务器→接收端 | `node test/voice-bridge.mjs` → `VOICE BRIDGE OK` |
| **浏览器 PTT 全链路** | ✅ 真实 headless Chrome + 假麦克风按住说话 3 秒 → 对端收到 **148 个 Opus 帧** | `node test/browser-voice-e2e.mjs`，截图 `docs/ui-e2e-voice.png` |
| 浏览器 UI 登录 | ✅ 真实数据渲染（服务器名/版本/uptime/频道树/客户端列表），零 console 错误 | `test/browser-e2e.mjs`，截图 `docs/ui-e2e-connected.png` |
