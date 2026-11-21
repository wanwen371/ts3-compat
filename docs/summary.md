# TeamSpeak 3 语音系统与服务端 —— 逆向总报告

> 目标版本
> * 客户端：TeamSpeak 3 Client **3.5.6** win64（`ts3client_win64.exe`，PE32+ x86-64，17,911,768 B，SHA-256 `282de0fa71f61428c255216359100e5f6493320811324a215376c2c802b035f9`）
> * 服务端：TeamSpeak 3 Server **3.13.9** Linux x86-64（`ts3server`，ELF EXEC，stripped，13,701,328 B，SHA-256 `9e37899d3cf2b81e449ba1b23cb78cec98e6ae3116f7bc05422e5160b6d60c5f`）
>
> 本报告由四份分册综合而成，**每条结论都能回溯到分册里的证据块**：
> `01-architecture.md`（客户端架构，800 行）· `04-voice-client.md`（语音链路与功能，900 行）· `05-server.md`（服务端，1223 行）· `06-voice-protocol.md`（协议与加密，2000+ 行）

---

## 0. 一页结论

| # | 结论 | 依据 |
|---|---|---|
| 1 | **服务端对语音只做透明转发**，不编码、不解码。编码器在整个服务端二进制里不存在；解码栈虽被链入，但被常量桩接管且调用图为空 | 05 §9.2–§9.4（三条独立证据） |
| 2 | **语音全链路在客户端**：48 kHz 采集 → WebRTC 前处理 → Opus/CELT/Speex 编码 → 逐包 AES-EAX 加密 → UDP → 服务端按 `(numberVoicePackets, voiceDataSize)` 原样搬运 → 各接收端解码 → jitter → 混音 → 播放 | 04 §3–§7、06 §10 |
| 3 | **每个语音包独立加密**：`AES-128-EAX`，`tag = 8 B`，key/nonce 各 16 B **由 SHA-256 每包派生**；入站包头 **13 字节**，出站头 11 字节（差 2 字节见 06 §3.6） | 06 §3.1、§7.3–§7.6 |
| 4 | **UDP 通道承载全部包类型**（9 种）：VOICE / VOICE_WHISPER / COMMAND / COMMAND_LOW / PING / PONG / ACK / ACK_LOW / INIT1；每类型有独立最大包长（VOICE 500 B、whisper 9000 B、命令类 1108 B） | 06 §2、§3.4 |
| 5 | **服务端 6 个端口**：9987/udp（语音）、30033/tcp（文件传输）、10011/tcp（ServerQuery）、10022/tcp（SSH Query）、10080/tcp（WebQuery）、10443/tcp（WebQuery TLS）；`threads_voice_udp` 默认 5 | 05 §1.4（配置注册函数 `FUN_40f870` 常量原文） |
| 6 | **加密库是自研 LibTomCrypt 分支 + mbedtls + libts3_ssh 三套并存**，无 OpenSSL（客户端才带 OpenSSL 1.0.2k 供 Qt TLS 用） | 05 §4.1–§4.2；01 §3.2.3 |
| 7 | **语音功能共 25 项**（PTT/VAD 三模式/Whisper/3D/录音/CNG/Ducking/AGC/打字衰减/舒适噪声/权限门控编解码等），全部在客户端实现 | 04 §8（逐项证据表） |

---

## 1. 取证环境与方法

| 项 | 值 |
|---|---|
| 分析引擎 | REA 6.10.1（MCP + CLI）+ **Ghidra 12.2** + **JDK 25.0.5**（Ghidra 12.2 强制要求 JDK ≥ 25，JDK 21 会被拒） |
| 复用机制 | `REA_GHIDRA_CHECKPOINT_DIR`：首次导入 = 服务端 5 分 24 秒 / 客户端 8 分 06 秒；之后每次反编译 **~14 秒** |
| 关键陷阱 | `--snapshot` 只缓存查询结果，**不缓存已分析的 Program**；数据段地址必须写 `ram:0x…`，否则被当文件偏移解析 |
| 证据等级 | **A** = 反编译/汇编立即数直接读到；**B** = 字符串/源码路径/RTTI 强证据；**C** = 由 A/B 组合推断 |
| 全程只读 | 两个目标文件的 SHA-256 前后一致，未修改、未运行服务端本体、未联网 |

标准查询流水线（可复现）：

```bash
export PATH="$HOME/.local/bin:$PATH"
export GHIDRA_INSTALL_DIR=$HOME/.local/opt/ghidra/ghidra_12.2_PUBLIC
export JAVA_HOME=$HOME/.local/opt/jdk25
export REA_GHIDRA_CHECKPOINT_DIR=$HOME/.cache/rea/ckpt
export REA_GHIDRA_STARTUP_TIMEOUT_MS=2400000

rea search    ts3server "clientListSize" --json   # → {"address":"0xc1d9f0", ...}
rea xrefs     ts3server 0xc1d9f0        --json    # → ["0xaa28ed","0xaa2fb3"]
rea decompile ts3server 0xaa28ed        --json    # → normalized_result = 伪代码
```

本报告用到的反编译产物已落盘：`report/data/pseudo/{49be60,a98000,a9e3f0,49b443}.c`。

---

## 2. 系统总览

```
                       ┌──────────────── 客户端 ts3client_win64.exe（Qt 5.12.3）────────────────┐
 麦克风 ─▶ 声音后端 ABI ─▶ 重采样 ─▶ WebRTC APM 前处理 ─▶ 编码器 ─▶ 语音包加密封装 ─┐
           (15 个导出)              (AEC3/NS/VAD/AGC/打字衰减)  (Opus/CELT/Speex)      │
                                                                                     ▼
                                                                     UDP 通道（9987，全部包类型）
                                                                                     │
        ┌────────────────────────────────────────────────────────────────────────────┘
        ▼
 ┌──────────────── 服务端 ts3server 3.13.9（17,939 函数 / 64 vtable）────────────────┐
 │ UDPServer → UDPSocket → PacketHandler_Base → 权限/频道校验 → VoiceStreamer(24 槽)  │
 │                        （透明转发：不编解码）        → 按目标列表重打包 → 广播      │
 │ PacketLimiter（RSA puzzle, 64 B，连接前 DoS 闸门）· 会话加密（EAX）· 统计 *_speech │
 └───────────────────────────────────────────────────────────────────────────────────┘
        │
        ▼ 各接收客户端：解密 → jitter buffer（speex_ts）→ 解码 → 混音（音量/3D）→ 播放
```

---

## 3. 客户端语音数据流（七段）

| 段 | 实现（A/B 证据） | 关键参数 |
|---|---|---|
| ① 采集 | 可插拔声音后端：`directsound_win64.dll`（DirectSound）与 `windowsaudiosession_win64.dll`（WASAPI/AVRT），两者导出**同一套 15 个 `ts3soundbackend_*`** 函数（`initialize/finalize/isSupported/enumDevices/getDefaultDevice/getInfo/openDevice/closeDevice/startDevice/stopDevice/associateAECDevice/lockDSP/unlockDSP/waitForClosedDevices/getErrorString`） | 上下文对象：DS 0xA0 B、WASAPI 0x170 B；`lockDSP/unlockDSP` 是跨调用的设备锁 + 事件握手 |
| ② 重采样 | `speex_resampler`（同时用作设备侧重采样） | 统一到 48 kHz |
| ③ 前处理 | 内嵌 **WebRTC Audio Processing**（18 个源文件，含 `AudioProcessingImpl`、`ResidualEchoDetector`、`PushResampler`），AEC3 默认启用（多处 `WebRTC-Aec3*KillSwitch` 串） | 配置键表见 §5 |
| ④ 编码 | 三族五档：Speex NB/WB/UWB（8/16/32 kHz）、CELT Mono 48k、**Opus Voice**（单声道 + `application=VOIP` + `OPUS_SIGNAL_VOICE`）、**Opus Music**（立体声 + `AUDIO` + `SIGNAL_MUSIC`） | Opus `Fs=48000`、帧长 `960` 采样 = **20 ms**；比特率 = Voice `(q+1)×4096 bps`、Music `(q+1)×7200 bps`，`q∈[0,10]`；**全 exe 只有 3 处 `opus_encoder_ctl`（SET_SIGNAL/RESET_STATE/SET_BITRATE），无带内 FEC、无 VBR、无 DTX、无 complexity（=libopus 默认）** |
| ⑤ 加密 | `crypt_find_cipher("rijndael")` + `eax_decrypt_verify_memory/eax_encrypt_authenticate_memory` | key 16 B、nonce 16 B（每包 SHA-256 派生）、tag **8 B**；入站头 13 B |
| ⑥ 传输 | UDP，包类型 9 种；MTU 500 B（IPv4/IPv6 各一档），whisper 豁免到 9000 B；`numberVoicePackets < 256` | 序列号 16 位**大端** |
| ⑦ 接收/播放 | 解密 → **speex_ts jitter buffer**（`jitter.c`）→ 解码 → 混音（`boost::bind` 回调，签名可从修饰名完整解出）→ 播放 DSP（音量、CNG 舒适噪声、Ducking、自动音量均衡、3D 定位） | 每客户端可独立音量；3D 走 `Sound3DManager` |

---

## 4. 全部语音功能清单（25 项）

> 完整证据表见 `04-voice-client.md` §8。下表为归类摘要。

**采集与触发**：①PTT 按键说话（含 `b_client_force_push_to_talk` 服务器强制）②VAD 自动检测（**三模式：Automatic / Volume Gate / Hybrid**）③VAD over PTT ④连续传输 ⑤语音测试

**编解码与信道**：⑥频道编解码权限门控（`b_channel_create_modify_with_codec_{speex8,16,32,celtmono48,opusvoice,opusmusic}`）⑦Opus Voice / Opus Music / CELT Mono / Speex×3 ⑧编码质量 0–10 滑条 ⑨**语音数据加密开关**（频道级 + 服务器级，`virtualserver_codec_encryption_mode`）

**说话目标**：⑩Whisper 私语（频道/客户端定向，单包目标 ≤255）⑪频道语音广播（默认目标）⑫说话目标状态机（`m_talkTarget`，含 `WHISPER_GROUP`）

**前处理**：⑬AEC 回声消除（后端 `associateAECDevice` 关联 AEC 参考设备）⑭NS 降噪（`denoise`/`denoiser_level`）⑮AGC 自动增益（3.5 起从采集迁到播放侧）⑯打字声衰减（`typing_suppression`）

**播放与混音**：⑰舒适噪声 CNG ⑱Ducking 回声抑制（`echo_reduction_db`）⑲自动音量均衡 ⑳3D 位置音效（`Sound3DManager`/`3d_test.wav`）㉑主音量 + 单客户端音量（`VolumeModifier`，-50…+20 dB）㉒静音/硬件静音/本地静音

**其它**：㉓本地录音（单轨/多轨，`CLIENT_FLAG_RECORDING`）㉔声音包（`sound/<pack>/settings.ini` + 73 个 wav，含 `SPECIAL_MIC_CLICK_*` 等事件）㉕通话统计（丢包率/带宽/ping，与服务端 `*_speech` 统计口径对应）

---

## 5. 前处理配置键（客户端唯一权威表）

`PreProcessorConfigValues` 由 `0x1406D7100–0x1406D7932` 生成，键名与默认可从旧版 ini 默认值表读出：

| 键 | 含义 | 默认 |
|---|---|---|
| `aec` / `echo_canceling` | 回声消除 | false |
| `denoise` / `denoiser_level` | 降噪 | false |
| `vad` / `vad_rnn` / `vad_mode` / `vad_likelihood` / `vad_extrabuffersize` | 语音活动检测 | `vad_mode=0`、`voiceactivation_level=-40` |
| `agc` / `agc_extra_saturation_margin_db` | 自动增益 | false |
| `typing_suppression` | 打字声衰减 | false |

---

## 6. 服务端机制

| 层 | 结论 | 依据 |
|---|---|---|
| 进程/线程 | 单进程、epoll 事件驱动 + 线程（`threads_voice_udp`=5）；17,939 个函数、64 个 vtable | 05 §1.2、§0 |
| 端口 | 9987/udp、30033/tcp、10011/tcp、10022/tcp、10080/tcp、10443/tcp | 05 §1.4（`FUN_40f870` 注册常量） |
| 包层 | 9 种包类型；13 个 `Outgoing*` 类；`PacketHandler_Base` 为唯一分派器；ACK/重传/排序/分片（`OutgoingResendingPacket`）；`PacketLimiter` 用 **RSA puzzle（64 B）** 做连接前 DoS 防护 | 05 §3、06 §6.6–§6.8 |
| 加密 | `ts_tomcrypt` 私有分支（EAX/GCM/CTR + RSA/ECC + Yarrow/Fortuna，104 个源文件）+ mbedtls（TLS）+ `libts3_ssh`（SSH Query）；启动只注册 Rijndael/SHA-1/SHA-256/Fortuna | 05 §4 |
| 语音转发 | 每 VirtualServer 一套 `VoiceStreamer`（24 个虚函数）+ `DecodeManagerServer`；收到语音包后按 `(numberVoicePackets, voiceDataSize)` 原样搬运并广播；whisper 按目标列表定向投递 | 05 §5、§9 |
| 权限 | 515 条权限名，其中 **41 条与语音相关**（talk power、`b_channel_create_modify_with_codec_*`、`b_client_force_push_to_talk` 等）；五张 perm 表 | 05 §6 |
| 数据库 | schema **34**、**27 张表**；语音参数在 `channel_properties` EAV 行（`channel_codec*`、`channel_needed_talk_power`、`channel_security_salt`）；统计单列 `*_speech` | 05 §7 |
| 管理接口 | ServerQuery **140 个命令**（Raw/Telnet 10011、SSH 10022、HTTP 10080、HTTPS 10443），WebQuery + API Key 认证 | 05 §8 |

**「服务端到底做不做编解码」的三条独立证据**（这是本次最关键的定性）：
1. 全量搜索 `encod` 只命中 base64/DER/HTTP，**没有任何音频编码器**；
2. `DecodeManagerServer` 唯一新增虚函数是 7 条指令的常量桩（写 `volume=1.0f/100/0` 后 `ret`）；
3. 批量解码函数 `FUN_ae6750`（`decode.cpp`）**直接调用者为空**，唯一引用是 `Decode` vtable 槽，从入口/初始化的调用图不可达。

---

## 7. 协议与加密要点

| 项 | 值 | 依据 |
|---|---|---|
| 包类型 | 9 种：VOICE、VOICE_WHISPER、COMMAND、COMMAND_LOW、PING、PONG、ACK、ACK_LOW、INIT1（`0xfaf120` 名字表 + `0xbb2110` 跳转表，>8 判非法） | 06 §2 |
| 最大包长 | `uint16[9]` @`0xbb2150` = [500, 9000, 1108, 1108, 50, 50, 50, 50, 1108] | 06 §3.4 |
| MTU | 500 B / 1108 B（`get_packet_mtu(is_ipv6)` 两个返回值，三处独立立即数） | 06 §5.1 |
| 头长 | 入站 **13 B**（伪代码 `param_1[4]=0xd`、`len<0xd` 拒绝、payload 从 `+0xd` 拷） | 06 §3.1 + 本次 Ghidra 复核 |
| 加密 | AES-128-EAX，`key=16B`、`nonce=16B`、`tag=8B`；key/nonce 每包由 **SHA-256 KDF** 现算：`[1B 0x30‖(type==1)] ‖ [1B mode] ‖ [4B BE32(counter)] ‖ [20B/64B 连接密钥材料]` → 32B 摘要取前 16/后 16 | 06 §7.3–§7.6（伪代码已闭环） |
| 包 ID | `m_Data[8..9]` = **16 位大端**（`setPacketID` 伪代码 `*(ushort*)(m_Data+8)=bswap16(v)`）；计数器 32 位高位 + 64 位 epoch，回绕靠 epoch 进位区分 | 06 §3.6、§8.1 |
| 握手 | `TS3INIT1` 8 字节魔数位于包首；INIT1 最小 14 B；类型字节 `0x88` | 06 §6.1–§6.2 |
| DoS 防护 | `PacketLimiter` + `rsa_puzzle.cpp`，`PuzzleData` 64 B | 06 §6.6–§6.7 |
| 压缩 | 仅 COMMAND 通道使用 QLZ | 06 §9 |
| 重传 | `RESENDING` 是 `COMMAND_LOW` 的包装；PING/PONG 历史窗口 20 | 06 §8.2–§8.3 |

---

## 8. 关键数字速查

| 数字 | 含义 | 出处 |
|---|---|---|
| 48000 / 960 | Opus 采样率 / 帧长（20 ms） | 04 §5.2 |
| 0..10 | 编码质量档（Opus Voice `(q+1)×4096`，Music `(q+1)×7200` bps） | 04 §5.2 |
| 13 | 入站包头字节数 | 06 §3.1 |
| 500 / 1108 / 9000 | VOICE / COMMAND / WHISPER 最大包长 | 06 §3.4 |
| 8 | EAX tag 长度 | 06 §7.4 |
| 16 | key / nonce 长度 | 06 §7.5 |
| 255 | 单包 whisper 目标上限 | 05 §5、06 §4.4 |
| 9987 / 30033 / 10011 / 10022 / 10080 / 10443 | 服务端端口 | 05 §1.4 |
| 34 / 27 | DB schema 版本 / 表数 | 05 §7 |

---

## 9. 若要自己复刻 / 验证

1. **协议验证**：起一个本地 `ts3server`（`TS3SERVER_LICENSE=accept ./ts3server inifile=…`），用本报告 §7 的字段布局解包 UDP；语音包是每包 EAX，需先从 INIT1 握手取会话密钥（06 §6.3–§6.5 给了密钥来源与长度）。
2. **编解码复刻**：Opus（libopus，Voice=VOIP/单声道，Music=AUDIO/立体声，20 ms 帧）+ CELT Mono 48k + Speex 三档；服务端不需要任何编码器。
3. **加密复刻**：LibTomCrypt 的 EAX 模式 + 每包 SHA-256 KDF；注意 tag 只有 8 B，与常见 16 B 不同。
4. **Whisper**：目标列表编码在语音包内，单包 ≤255 个目标，超过分片。

---

## 10. 未确认清单（汇总，勿当结论引用）

| # | 未确认项 | 当前状态 | 建议验证方式 |
|---|---|---|---|
| 1 | 出站 11 B 与入站 13 B 的差值机制 | **部分排除**：`setPacketID` 伪代码证明 PacketID 在 `m_Data[8..9]` 大端、两侧同偏移，所以「PacketID 插在 +11」不成立；差值落在 `[10..11]`（出站 type@+10/payload@+11，入站 flags@+12/payload@+13） | 在 `0x49fce0` 之后、`0x4a01c6` 之前各 dump 一次 `m_Data[0..16]` 与 `m_DataSize`，看长度是否 +2 |
| 2 | 重放防护强度 | **KDF 已闭环**：nonce 每包由 SHA-256 现算，必然逐包变化；残留问题是 KDF 内「每类型 × 每 mode」的派生缓存命中条件未确认 | 运行时观察连续两包的 nonce 是否变化 + 同参数复用是否触发缓存 |
| 3 | 每个包类型的字段解析表 | 未完成（`IncomingPacket::process` 15.6 KB，只取了头/载荷/flag 三段） | 再补 3–4 条 decompile 遍历各 case |
| 4 | Opus 是否启用 in-band FEC | 未确认 | 在客户端查 `opus_encoder_ctl(4012)` 调用点 |
| 5 | `PUZZLE_DATA_SIZE_n`、INIT1 `+8..+17`、whisper 目标 id 宽度、`Packet_Flags` 位定义 | 未确认（06 已列 U4/U6/U11/U12） | 反编译 `rsa_puzzle.cpp` 对应函数与 INIT1 构造点 |
| 6 | 重传超时/窗口毫秒值 | 阴性：`OutgoingResendingPacket`（0xa9e3f0）内无毫秒常量，应在 Connection 定时器层 | 定位 Connection 定时器回调 |
| 7 | `vad_mode` 三值到 WebRTC 参数的精确映射 | 未确认（UI 是 `comboBoxVadMode`，标签只有 Automatic / Volume Gate，Hybrid 仅见 changelog；0/1/2 归属无判定代码） | 客户端反编译 `updateCaptureProfile` 附近 |
| 8 | 客户端另有一条 **SHA-1（20 B）包级摘要** 路径（`common_crypt_functions.cpp`，`FUN_14096f7e0`，断言 `outputlen==20`），与 06 的「每包 SHA-256 KDF 派生 16 B key + 16 B nonce」不是同一条链 | **新发现，待对齐**（可能是「握手/摘要」与「语音包密钥」两条不同机制） | 反编译两条路径的调用者，确认各自服务哪个阶段 |
| 9 | Opus 编码器参数现已是伪代码直读：`Fs=48000`、声道 1/2、`application` 2048/2049、signal 3001/3002；但 **FEC/VBR/DTX/complexity 全部未设置** | 已确认（阴性结论） | — |

各分册的完整未确认表：04 §11、05 §10、06 §12.1（带状态列）。

---

## 11. 交付物索引

| 文件 | 内容 |
|---|---|
| `00-语音与服务端-总报告.md` | 本文件（综合） |
| `01-architecture.md` | 客户端架构：模块清单、Qt/OpenSSL/WebEngine 版本、进程拓扑、插件 ABI（116 个 `ts3plugin_*`）、本地数据 |
| `04-voice-client.md` | 客户端语音全链路 + 25 项功能 + 设置项 + 关键地址速查 |
| `05-server.md` | 服务端：线程/端口/包层/加密/转发/权限/数据库/ServerQuery + 「是否编解码」证据链 |
| `06-voice-protocol.md` | 协议与加密：包类型表、头结构、MTU/分片、INIT1 握手、RSA puzzle、EAX 细节、ACK/重传、QLZ |
| `data/server-classes.txt` · `data/client-rtti.txt` | 服务端 74 个 RTTI 类名 / 客户端 2623 个 RTTI 类名 |
| `data/pseudo/*.c` | Ghidra 反编译产物（入站包处理、发送路径、重传包、EAX 封装） |
| `02-theming.md`、`02-iconpack-inventory.csv` | 上一轮 UI 皮肤任务的归档（与语音无关，保留备查） |

---

*本报告所有结论均可由报告中给出的命令复现；标注「未确认」的项目不得作为结论引用。*