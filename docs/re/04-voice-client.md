# 04 · 客户端语音全链路逆向（TeamSpeak 3 Client 3.5.6 / Win x64）

> 覆盖：采集 → 前处理 → 编码 → 加密/发送 → 接收 → jitter → 解码 → 混音 → 播放，以及全部语音功能与设置项。
> 目标文件全程只读。证据等级：**A**=机器码/PE 结构实测，**B**=编译期字符串/RTTI/断言，**C**=随包资源/changelog，**D**=推断。

## 0. 目标与方法

### 0.1 目标身份

| 项 | 值 |
|---|---|
| 主程序 | `/home/gaozikun/1017/ts3/extracted/ts3client_win64.exe`，17,911,768 B，PE32+ x86-64，ImageBase `0x140000000` |
| SHA-256 | `282de0fa71f61428c255216359100e5f6493320811324a215376c2c802b035f9` |
| 版本 | TeamSpeak 3 Client **3.5.6（2020-11-25）**，Plugin API 25，Qt 5.12.3 `msvc2017_64` |
| 后端 1 | `soundbackends/directsound_win64.dll` 128,984 B，sha256 `436416997df04096d8a05e4627418810528997e4e20a2ec7c40f945fe9e7f941` |
| 后端 2 | `soundbackends/windowsaudiosession_win64.dll` 169,944 B，sha256 `751a28393caa66f03681801ee746b05855a66bb392d0205576cc47f98cf16c0a` |

**证据（A）**
```bash
$ sha256sum ts3client_win64.exe soundbackends/*.dll
282de0fa71f61428c255216359100e5f6493320811324a215376c2c802b035f9  ts3client_win64.exe
436416997df04096d8a05e4627418810528997e4e20a2ec7c40f945fe9e7f941  soundbackends/directsound_win64.dll
751a28393caa66f03681801ee746b05855a66bb392d0205576cc47f98cf16c0a  soundbackends/windowsaudiosession_win64.dll
$ objdump -f ts3client_win64.exe   # file format pei-x86-64; architecture i386:x86-64
$ head -14 changelog.txt           # === Client Release 3.5.6 - 25 Nov 2020 / Plugin API 25
```

### 0.2 方法、工具与已知限制

| 手段 | 用途 | 产出 |
|---|---|---|
| `strings -n 4 exe > /tmp/c.strings`（210,491 行） | RTTI / 源码路径 / 断言 / UI 文案 / 设置键 | B 级证据主体 |
| `objdump -d/-p/-h`（pe-x86-64） | 导出表、IAT、反汇编关键函数 | A 级证据 |
| 自写 PE 工具（`/tmp/pe.py`、`ext.py`/`exp.py`、`iat.py`、`xref.py`、`funcstr.py`、`batch.py`） | 节表/RVA↔文件偏移、字符串→RVA、rip-relative 交叉引用、`.pdata` 函数边界、函数内字符串常量表、IAT 名字解析 | A 级证据（本报告全部地址来源） |
| 随包文件只读 | `changelog.txt`、`sound/*/settings.ini`、`translations/*.qm` | C 级证据 |

> **反编译限制（必须注明）**：Ghidra 12.2 + JDK 25 已就绪，但 17.9 MB PE 首轮导入在默认
> `REA_GHIDRA_STARTUP_TIMEOUT_MS=330000` 处超时（`provider_timeout`），本机内存紧张未重跑。
> **本报告不含任何 Ghidra 反编译结果**；所有结论由 A/B/C 证据支撑，函数语义凡未取得 A 级者标「推断」或列入 §11。

### 0.3 PE 布局（地址换算基准）

| 节 | RVA | 文件偏移 | 虚拟大小 |
|---|---|---|---|
| `.text` | `0x1000` | `0x400` | `0xB23FC8`（11,677,512） |
| `.rdata` | `0xB24000` | `0xB24000` | `0x503E6C`（5,258,092） |
| `.data` | `0x1028000` | `0x1025000` | `0x766C8`（485,064） |
| `.pdata` | `0x109F000` | `0x107B000` | `0x67EBC`（425,532 = 35,461 条 RUNTIME_FUNCTION） |

VA = `0x140000000 + RVA`；`.text` 内 RVA 与文件偏移相差 `0xC00`（例：RVA `0x6D3D10` ↔ off `0x6D3110`）。

**证据（A）**：`python3 /tmp/pe.py ts3client_win64.exe info` → 上表四节 `vaddr/vsize/rawptr/rawsize` 实测值。

## 1. 总体数据流与模块清单

```
采集：后端DLL ─> SoundDeviceManager(采集) ─> SoundBufferConverter(位深/声道) ─> CaptureManager
      ─> GenericCapture ─> 线程 "TeamSpeak Audio Capture Preprocessor"
      ─> Team_Apm_Impl(WebRTC APM) 或 PreProcessSpeex ─> [Recorder 分流录音]
      ─> EncodeOPUS / EncodeCELT / EncodeSpeex（48 kHz / 960 采样 / 20 ms）
      ─> OutgoingVoicePacket / OutgoingVoiceWhisperPacket（加密 + MTU 约束）
      ─> Connection / OutgoingResendingPacket（包 ID、ACK、重传）─> UDP
接收：UDP ─> IncomingPacket(解密校验) ─> PacketHandler ─> DecodeManager ─> Decode(Opus/CELT/Speex)
      ─> speex_ts jitter buffer ─> PlaybackManager ─> Playback_Server_Connection_Data
      ─> Sender_Data(每客户端音量/3D) ─> GenericSoundChannelMixer/Wave_Play_Data(混音+AGC+CNG+重采样)
      ─> 后端DLL
```

### 1.1 语音相关类（B：MSVC RTTI `.?AV` 实测）

| 层 | 类 | 说明 |
|---|---|---|
| 后端接口 | `SoundBckndIntf`、`SoundBackendNotifyInterface` | 后端函数表 / 设备热插拔通知 |
| 设备 | `SoundDeviceManager`、`SoundDeviceManagerInfo`、`Sound3DManager` | 设备·模式·3D |
| 采集 | `CaptureBase`、`CaptureManager`、`GenericCapture` | 采集链 |
| 前处理 | `I_Team_Apm`、`Team_Apm_Impl`、`PreProcessBase`、`PreProcessSpeex` | WebRTC APM / Speex 前处理 |
| 编码 | `EncodeBase`、`EncodeOPUS`、`EncodeCELT`、`EncodeSpeex` | 见 §5 |
| 封包 | `OutgoingPacket`、`OutgoingResendingPacket`、`OutgoingVoicePacket`、`OutgoingVoiceWhisperPacket`、`OutgoingAck{,Low}Packet`、`OutgoingCommand{,Low}Packet`、`OutgoingINITPacket`、`OutgoingPing/Pong/ConfirmationPacket` | 见 §6 |
| 解码 | `DecodeBase`、`Decode`、`DecodeManager`、`DecodeManagerClient` | 每客户端解码状态 |
| 播放 | `PlaybackBase`、`PlaybackManager`、`GenericPlayback`、`GenericSoundChannel{,Mixer}`、`GenericComplexSoundChannelContent` | 混音图 |
| `audio` ns | `Audio_Buffer`、`I_Audio_Buffer`、`Sample_Rate_Converter<short>`、`I_Dsp`、`I_Playback_Client_Dsp`、`Agc`、`Cng`、`Recorder` | 采集/播放 DSP |
| `audio::playback` ns | `Wave_Play_Data`、`Sender_Data`、`SoundRender3DInfo`、`SpeakerChannelInfo` | 混音回调载体 |
| 加密 | `teamnative_crypto::Cryptlib::Impl`、`Sha<..>`、`Hasher<..>`、`ClientEncryption`、`Encryption_Impl_V1/V2` | 语音包 + 本地同步 |
| UI/模型 | `CodecComBoxItemModel`、`TemplateVoice`、`VADControl`、`VADDisplay`、`Sound3DWidget`、`RecorderLabel` | Qt 侧 |

**证据（B）**
```bash
$ grep -oE '\.\?AV[A-Za-z0-9_]+@@' c.strings | sed 's/\.?AV//;s/@@//' | sort -u | grep -iE 'sound|voice|audio|codec|encode|decode|packet|capture|playback|speex|opus|celt'
CaptureBase CaptureManager Decode DecodeBase DecodeManager EncodeBase EncodeCELT EncodeOPUS EncodeSpeex
GenericPlayback GenericSoundChannel GenericSoundChannelMixer OutgoingVoicePacket PlaybackManager Sound3DManager ...
$ grep -oE '\.\?AV[A-Za-z0-9_@?$]+@audio@teamspeak@com@@' c.strings | sort -u   # Cng/Agc/I_Team_Apm/Team_Apm_Impl/PreProcess* 均在，见上表
```

### 1.2 编译期源文件（B：`__FILE__` 与 Qt 生成头给出）

| 目录 | 文件 |
|---|---|
| `teamspeak_client_lib\src\sound\` | `capturemanager.cpp`、`genericcapture.cpp`、`sounddevicemanager.cpp`、`sound_device_manager_info.cpp`、`soundbufferconverter.cpp`、`genericchannelconverter.cpp`、`genericsoundchannel.cpp`、`encode_opus.cpp`、`encode_celt.cpp`、`encode_speex.cpp`、`playbackmanager.cpp`、`genericplayback.cpp`、`playback_sender_data.cpp`、`playback_server_connection_data.cpp`、`playback_sample_buffer_data.cpp`、`playback_wave_file_data.cpp`、`wavereader.cpp` |
| `teamspeak_common_lib\src\` | `sound\decode.cpp`、`sound\decodemanager.cpp`、`sound\speakerchannelinfo.cpp`、`packet\outgoingvoicepacket.cpp`、`packet\outgoingpacket.cpp`、`packet\outgoingresendingpacket.cpp`、`packet\incomingpacket.cpp`、`packet\packethandler.cpp`、`connection.cpp`、`bandwidthcalculator.cpp` |
| 第三方 | `speex_ts\libspeex\jitter.c`、`speex_ts\libspeex\nb_celp.c`、`../src/modules/audio_processing/…`（18 个，§4.4）、`ts_tomcrypt\src\{ciphers\aes, encauth\eax, encauth\gcm, modes\ctr, hashes, mac\hmac, misc\base64}` |

**证据（B）**
```bash
$ grep -oE 'c:\\jenkins\\workspace\\client\\clientwindows\\deps\\[A-Za-z0-9_\\]+\.(cpp|cc)' c.strings | sed 's#.*deps\\##' | sort -u | grep -cE 'sound|packet|speex'   # 27
$ grep -oE 'c:\\jenkins\\workspace\\[^ ]*speex_ts[^ ]*\.(c|h)' c.strings | sort -u
speex_ts\libspeex\jitter.c
speex_ts\libspeex\nb_celp.c
```

## 2. 声音后端 ABI（15 个 `ts3soundbackend_*` 导出）

模型：**C 导出 + 不透明 `DeviceContext*` 首参**；客户端 `LoadLibrary` 后用 `GetProcAddress` 取全部 15 个函数并填入固定布局函数表。

### 2.1 导出表（A：两份 DLL 名字与顺序完全一致）

| # | 导出名 | DirectSound RVA/VA | WASAPI RVA/VA | 语义（A 级依据） |
|---|---|---|---|---|
| 1 | `isSupported` | `0x2F50` / `0x180002F50` | `0x1A150` | 系统是否支持该后端 |
| 2 | `getInfo` | `0x3410` / `0x180003410` | `0x1A610` | 返回静态描述块指针（零参：`lea rax,[imm]; ret`） |
| 3 | `lockDSP` | `0x3420` / `0x180003420` | `0x1A620` | 加设备/DSP 锁 + 复位事件 |
| 4 | `unlockDSP` | `0x3460` / `0x180003460` | `0x1A690` | 解设备/DSP 锁 + 置位事件 |
| 5 | `initialize` | `0x3490` / `0x180003490` | `0x1A700` | 分配+构造后端上下文 |
| 6 | `finalize` | `0x3500` / `0x180003500` | `0x1A770` | 析构+释放上下文 |
| 7 | `enumDevices` | `0x3530` / `0x180003530` | `0x1A7A0` | 枚举设备（第二参只接受 1/2） |
| 8 | `getDefaultDevice` | `0x36B0` / `0x1800036B0` | `0x1A7B0` | 取默认设备 |
| 9 | `openDevice` | `0x3830` / `0x180003830` | `0x1A7C0` | 打开设备 |
| 10 | `closeDevice` | `0x3840` / `0x180003840` | `0x1A7D0` | 关闭设备 |
| 11 | `startDevice` | `0x3850` / `0x180003850` | `0x1A7E0` | 启动流 |
| 12 | `stopDevice` | `0x3860` / `0x180003860` | `0x1A7F0` | 停止流 |
| 13 | `associateAECDevice` | `0x3A10` / `0x180003A10` | `0x1A800` | 关联 AEC 参考（回放）设备 |
| 14 | `waitForClosedDevices` | `0x3C30` / `0x180003C30` | `0x1A810` | 等待设备线程退出 |
| 15 | `getErrorString` | `0x3CD0` / `0x180003CD0` | `0x1A830` | 错误码→文本 |

**证据（A）**
```bash
$ objdump -p soundbackends/directsound_win64.dll | sed -n '/Ordinal\/Name Pointer/,+17p'
	[   0] associateAECDevice   [   1] closeDevice    [   2] enumDevices    [   3] finalize
	[   4] getDefaultDevice     [   5] getErrorString [   6] getInfo        [   7] initialize
	[   8] isSupported          [   9] lockDSP        [  10] openDevice     [  11] startDevice
	[  12] stopDevice           [  13] unlockDSP      [  14] waitForClosedDevices     # 均带 ts3soundbackend_ 前缀
$ python3 exp.py soundbackends/windowsaudiosession_win64.dll   # 名字→RVA 全表 15 行，与上表逐项一致
rva=0x1a610 va=0x18001a610 ts3soundbackend_getInfo
$ objdump -d --start-address=0x180003410 --stop-address=0x180003420 directsound_win64.dll
  180003410: lea 0x1ac21(%rip),%rax  # 0x18001e038 ; 180003417: ret   <-- getInfo = 6 字节返回静态块
```

### 2.2 客户端侧函数表布局（A：15 次 `GetProcAddress` 的 `mov %rax,off(%rbx)`）

加载器 `0x1406CB440–0x1406CBC8F`（`[rbx+0]` = `HMODULE`）：

| 偏移 | 成员 | 偏移 | 成员 |
|---|---|---|---|
| `+0x00` | `HMODULE` | `+0x40` | getDefaultDevice |
| `+0x08` | isSupported | `+0x48` | openDevice |
| `+0x10` | getInfo | `+0x50` | closeDevice |
| `+0x18` | lockDSP | `+0x58` | startDevice |
| `+0x20` | unlockDSP | `+0x60` | stopDevice |
| `+0x28` | initialize | `+0x68` | associateAECDevice |
| `+0x30` | finalize | `+0x70` | waitForClosedDevices |
| `+0x38` | enumDevices | `+0x78` | **getErrorString**（唯一乱序项） |

失败文案：`Could not load "<导出名>" from backend dynamic library`（`0x140D462D0` / `0x140D46288`）。

**证据（A）**
```bash
$ objdump -d --start-address=0x1406cb829 --stop-address=0x1406cb8e0 ts3client_win64.exe
  1406cb829: lea 0x67ac30(%rip),%rdx  # "ts3soundbackend_isSupported" ; 1406cb830: call GetProcAddress
  1406cb836: mov %rax,0x8(%rbx)       1406cb85f: mov %rax,0x10(%rbx)   1406cb888: mov %rax,0x18(%rbx)
  1406cb8b1: mov %rax,0x20(%rbx)      1406cb8da: mov %rax,0x28(%rbx)   1406cb903: mov %rax,0x30(%rbx)
  1406cb92c: mov %rax,0x38(%rbx)      1406cb955: mov %rax,0x40(%rbx)   1406cb97e: mov %rax,0x78(%rbx)
  1406cb9a7: mov %rax,0x48(%rbx)      1406cb9d0: mov %rax,0x50(%rbx)   1406cb9f9: mov %rax,0x58(%rbx)
  1406cba1f: mov %rax,0x60(%rbx)      1406cba45: mov %rax,0x68(%rbx)   1406cba6b: mov %rax,0x70(%rbx)
```

### 2.3 上下文对象（`DeviceContext`）布局与生命周期（A）

| 项 | DirectSound | WASAPI |
|---|---|---|
| 上下文大小 | **0xA0 = 160 B**（`mov $0xa0,%ecx`） | **0x170 = 368 B**（`mov $0x170,%ecx`） |
| 设备/流句柄字段 | `+0x90`（构造后必须非 0） | `+0x00`（构造后必须非 0） |
| 设备级临界区 | `+0x50` | `+0x70` |
| DSP 计数临界区 | — | `+0x98` |
| DSP 锁计数（int） | `+0x78` | `+0xC0` |
| 事件对象 `HANDLE` | `+0x80` | `+0xC8` |
| `initialize` 失败返回 | `0xFFFFFFF8`（-8） | `0xFFFFFFFD`（-3） |

`lockDSP` / `unlockDSP` 的真实语义（**跨调用「设备锁 + 事件握手」**，不是简单互斥对）：

| 函数 | DirectSound | WASAPI |
|---|---|---|
| `lockDSP` | `EnterCS(+0x50)`；若 `[+0x78]==0` 则 `ResetEvent(+0x80)`；`++[+0x78]` | `EnterCS(+0x70)`；`EnterCS(+0x98)`；若 `[+0xC0]==0` 则 `ResetEvent(+0xC8)`；`++[+0xC0]`；`LeaveCS(+0x98)` |
| `unlockDSP` | `--[+0x78]`；`LeaveCS(+0x50)`；`SetEvent(+0x80)` | `EnterCS(+0x98)`；若计数>0 则 `--[+0xC0]`、`LeaveCS(+0x70)`；计数归 0 时 `SetEvent(+0xC8)`；`LeaveCS(+0x98)` |

**证据（A）**
```bash
$ python3 iat.py directsound_win64.dll 0x170c0 0x170e0 0x17108 0x17120   # ResetEvent/SetEvent/LeaveCS/EnterCS
$ objdump -d --start-address=0x180003420 --stop-address=0x180003490 directsound_win64.dll
  180003429: add $0x50,%rcx ; call EnterCriticalSection ; 180003433: mov 0x78(%rbx),%eax ; test ; jne +0x17
  18000343a: mov 0x80(%rbx),%rcx ; call ResetEvent ; 18000344a: inc %eax ; mov %eax,0x78(%rbx) ; ret
  180003466: decl 0x78(%rcx) ; call LeaveCriticalSection ; 180003476: mov 0x80(%rbx),%rcx ; call SetEvent
$ objdump -d --start-address=0x18001a700 --stop-address=0x18001a76a windowsaudiosession_win64.dll
  18001a714: mov $0x170,%ecx # sizeof(DeviceContext) ; 18001a72f cmpq $0x0,(%rax) ; 18001a74a: mov $0xfffffffd,%eax
```

### 2.4 `getInfo` 描述块（A）

`getInfo` = `lea rax,[静态对象]; ret`，返回 `0x18001E038`（DS）与 `0x180028038`（WASAPI）：

| 偏移 | DS | WASAPI | 说明 |
|---|---|---|---|
| `+0x00` | `1` | `1` | 后端 ABI 版本 = 1（推断：用于兼容判定） |
| `+0x08` | → `"Direct Sound"`（`0x180017C00`） | → `"Windows Audio Session"`（`0x180020D28`） | 后端显示名（与 UI 下拉项同名） |
| `+0x10` | `0xC8` = 200 | `0x64` = 100 | **未确认**（疑为默认缓冲/延迟 ms）；仅记录实测 |
| `+0x18` 起 | 相邻全局数据 | 同上 | 不属于描述块 |

**证据（A/B）**
```bash
$ python3 -    # 读 WASAPI 0x180028038
+0x00: 0x1 ; +0x08: 0x180020d28 [.rdata] -> 'Windows Audio Session' ; +0x10: 0x64
# 同法读 DS：+0x08 -> 'Direct Sound'（0x180017C00），+0x10 -> 0xc8
$ strings -n 6 soundbackends/*.dll | grep -E '^(Direct Sound|Windows Audio Session)$'
Direct Sound
Windows Audio Session
```

### 2.5 两份后端的实现差异（A/B）

| 维度 | DirectSound | WASAPI |
|---|---|---|
| 导入 DLL | `DSOUND.dll`（**无名序号 3**）、`WINMM.dll`、MSVCP140/VCRUNTIME140 | `AVRT.dll`、`ole32.dll`、MSVCP140/VCRUNTIME140 |
| 关键 API | `waveIn/OutGetNumDevs`、`waveIn/OutGetDevCapsW`、`waveIn/OutMessage`、`timeBeginPeriod/timeGetTime` | `CoCreateInstance`、`AvSetMmThreadCharacteristicsA`（MMCSS 实时线程）、`CreateWaitableTimerW/SetWaitableTimer` |
| 上下文 RTTI | `DeviceContext`、`CaptureDeviceContext`、`RenderDeviceContext` | 同左 + **`EchoDeviceContext`**、`CMMNotificationClient`、`Com_Ref_Count_Base<IMMNotificationClient>` |
| 设备热插拔 | 无（轮询枚举） | `IMMNotificationClient` 通知 |
| 内部调试命令名 | `GET_SPEAKER_CONFIG`、`GET_CAPS`、`SETCOOPERATIVELEVEL`、`DIRECTSOUNDCREATE8`、`CREATEPRIMARYBUFFER`、`CREATEBUFFER`、`GET_STATUS`、`RESTORE`、`CAPTURE_START/STOP`、`PLAYBACK_START/STOP`、`GET_FORMAT_5` | 无（该命名仅 DS 自带） |
| 错误码文本 | `PERMISSIONS`、`DEVICE_BUSY`、`INVALID_PARAM`、`BUFFER_TOO_SMALL`、`UNKNOWN_DEVICETYPE`、`NOTSUPPORTED`、`INIT_WAS_IMPL`、`COINITIALIZEEX`、`CALL_OUT_OF_ORDER`、`CAPTURE_FORMAT_NOT_SUPPORTED`、全套 `AUDCLNT_E_*` | 同左（共用错误码表） |
| AEC 支持 | 无专用对象 | **`EchoDeviceContext`** = AEC 参考流用的独立设备上下文 |

**证据（A/B）**
```bash
$ python3 iat.py soundbackends/directsound_win64.dll
0x17020 -> DSOUND.dll!DSOUND.dll#ord3
$ strings -n 6 windowsaudiosession_win64.dll | grep '^\.\?AV'
.?AV?$Com_Ref_Count_Base@UIMMNotificationClient@@@@
.?AVCMMNotificationClient@@
.?AVCaptureDeviceContext@@
.?AVDeviceContext@@
.?AVEchoDeviceContext@@
.?AVRenderDeviceContext@@
```

### 2.6 设备类型与加载流程（A/B）

- `enumDevices` 第二参只接受 **1 / 2**：`0x18000354e: lea -0x1(%rdx),%ebx` → `0x18000355a: cmp $0x1,%bl` → `0x18000355d: ja 失败`。
  与客户端常量 `DEVICETYPE_CAPTURE` / `DEVICETYPE_PLAYBACK`（字符串池存在）及
  `SoundDeviceManager::MODE_CAPTURE/MODE_PLAYBACK`（断言原文）对应；**1↔采集、2↔回放的具体方向为推断**。

加载流程（B/A）：定位 `soundbackends/` 子目录（`Could not find soundbackends folder `、`Error getting soundbackends dir: `）
→ 读配置节 `[SoundBckndIntf]`（该键在加载器内出现 3 次）→ `LoadLibrary`（`Load Library failed with errorno `）
→ 15×`GetProcAddress` 填表 → 用 `SoundBackendNotifyInterface` 接收设备变更。

## 3. 采集链路

### 3.1 采样率 / 位深 / 声道

| 项 | 值 | 依据 |
|---|---|---|
| 内部采样率 | **48000 Hz** | 编码器虚函数 `0x1406D3A70: mov $0xbb80,%eax; ret`（A） |
| 内部帧周期 | **960 采样 = 20 ms @48 kHz** | 虚函数 `0x1406D3A80: mov $0x3c0,%eax; ret`（A） |
| 内部位深 | **16 bit** | B：断言 `mode_info_instance->m_bit_depth == 16`（`sound_device_manager_info.cpp`） |
| 后端可给位深 | 8/16/24/32 | B：断言 `in_bit_depth == 8 \|\| 16 \|\| 24 \|\| 32`（`soundbufferconverter.cpp`） |
| 声道 | 1 或 2 为主，支持 5.1→立体声下混 | B：断言 `in_channels == 1 \|\| out_channels == 1 \|\| …`；`genericchannelconverter.cpp` 的 `m_lfe_idx`/`m_center_channel_index`/`m_left_channel_index`/`m_right_channel_index` |
| 后端线程 | WASAPI 用 MMCSS；DS 用 `timeBeginPeriod` | A：IAT |

**证据（A）**
```bash
$ objdump -d --start-address=0x1406d3a70 --stop-address=0x1406d3a86 ts3client_win64.exe
  1406d3a70: mov $0xbb80,%eax ; ret   # 48000   ;   1406d3a80: mov $0x3c0,%eax ; ret   # 960 = 20 ms
```

### 3.2 设备标识模型（A：断言原文）

设备是 **(mode_id, device_id)** 二元组，而非单一字符串：

```
Assertion "!(mode_id.empty() || capture_device_id.empty())" failed at ...\sounddevicemanager.cpp:
Assertion "Invalid captureDevice in Config File, (profile, captureDevice) = (" failed at ...
Assertion "Invalid playbackDevice in Config File, (profile, playbackDevice) = (" failed at ...
Assertion "old_device_id == item->m_device_ident.second" failed at ...\capturemanager.cpp:
Assertion "old_device_id == it->second->m_device_ident.second" failed at ...\playbackmanager.cpp:
```
→ 解释了 UI 上同时存在 **Capture Mode / Capture Device** 与 **Playback Mode / Playback Device** 两组下拉框。

### 3.3 采集线程与异常处理

| 项 | 内容 | 证据 |
|---|---|---|
| 采集线程名 | **`TeamSpeak Audio Capture Preprocessor`** | B：字符串 RVA `0xD474E0`，经 `.rdata` 槽 `0xC4A600` 由 `0x1406D78F8` 引用 |
| 线程函数 | `0x1406D7100–0x1406D7932`（2,098 B） | A：`.pdata` 边界；该函数即前处理配置构造器（§4.2） |
| 出错文案 | `Error closing capture device`、`Failed to close capture device when updating capture system: `、`Failed to open capture device when updating capture system: `、`Could not reactivate capture device after VAD voice test: `、`Error setting input deactivation status.` | B |
| 设备回退 | `The configured capture device was not found. Instead using: %1` | B |
| 模式选择 | `Automatically use best mode`、`Failed to query default capture mode`、`Failed to get capture mode list` | B |
| 服务器强制 PTT | `Force Push-To-Talk capture mode`、`Enforcing push-to-talk`、权限 `b_client_force_push_to_talk` | B |

### 3.4 重采样（A：函数定位）

| 函数 | VA 范围 | 依据字符串 |
|---|---|---|
| `Wave_Play_Data::initCallback` | `0x1406DD3B0–0x1406DD9DE` | `speex_resampler_init in Wave_Play_Data::initCallback failed with ` |
| 播放重采样处理 | `0x1406DD9E0–0x1406DE85D` | `Error during speex_resampler_process(_interleaved)(_int) in ::Wave_Play_Data::buffer_read_callback` |
| 另一处重采样 | `0x1406FA230–0x1406FA58C` | `Error during speex_resampler_process` |
| 设备缓冲初始化 | — | `speex_resampler_init in SoundDeviceManagerInfo::initPlaybackBuffers failed with ` |

**证据（A）**
```bash
$ python3 batch.py ts3client_win64.exe 'Error during speex_resampler_process' 'speex_resampler_init in Wave_Play_Data::initCallback failed with '
  str=0xd47bc0 lea@0x6de0b0 func=0x6dd9e0-0x6de85d va=0x1406dd9e0
  str=0xd47b40 lea@0x6dd5d3 func=0x6dd3b0-0x6dd9de va=0x1406dd3b0
  str=0xd49ef8 lea@0x6fa302 func=0x6fa230-0x6fa58c va=0x1406fa230
```

## 4. 前处理（WebRTC APM / Speex）

### 4.1 三种实现（B）

| 类 | 实现 | 使用条件 |
|---|---|---|
| `I_Team_Apm` / `Team_Apm_Impl` | 内置 WebRTC APM | 默认路径（3.3.0 起 “New improved echo cancellation implementation”） |
| `PreProcessBase` / `PreProcessSpeex` | Speex `speex_preprocess_*` | legacy 前处理；字符串 `internal preprocessor`、`preprocessor disabled` |
| `I_Dsp@playback` + `Agc@playback` + `Cng@playback` | 播放侧 DSP（AGC/舒适噪声） | §7.4 |

**证据（B）**
```bash
$ grep -iE 'preprocessor' c.strings | sort -u
.?AVPreProcessBase@audio@teamspeak@com@@     .?AVPreProcessSpeex@audio@teamspeak@com@@
/PreProcessing   PreProcessing   PreProcessor   internal preprocessor   preprocessor disabled
Error setting PreProcessorConfigValues:      Error setting PreProcessorConfigValues when updating capture system:
TeamSpeak Audio Capture Preprocessor         Unknown speex_preprocess_ctl request:
SPEEX_PREPROCESS_SET_DENOISE …（GET_*/SET_* 全套 ctl 请求名）
$ python3 batch.py ts3client_win64.exe 'Unknown speex_preprocess_ctl request: '
  str=0xd5d8c8 lea@0x85f1f0 func=0x85ebf0-0x85f2dc va=0x14085ebf0   # speex_preprocess_ctl 本体
```

### 4.2 `PreProcessorConfigValues` 键表（**核心证据**）

客户端把前处理参数打包为 `key→value` 表下发给采集系统，并用 `name` 键命名采集线程。
生成该表的函数 **`0x1406D7100–0x1406D7932`**（对每个键做长度+内容比较）。

| 键 | 值类型 | 语义 | 关联 UI |
|---|---|---|---|
| `aec` | `"true"/"false"` | 回声消除开关 | `echoCancellationCheckBox`、`verticalLayout_AEC` |
| `echo_canceling` | `"true"/"false"` | AEC 运行态 | — |
| `vad` | `"true"/"false"` | VAD 开关 | `vadControl`、`VADDisplay` |
| `vad_rnn` | `"true"/"false"` | RNN VAD | — |
| `vad_mode` | 整数（`%d`） | VAD 模式（默认 **0**；0/1/2↔Automatic/Volume Gate/Hybrid 为推断） | 采集页 Activation |
| `vad_likelihood` | 整数 | VAD 判定阈值档 | — |
| `voiceactivation_level` | 整数（默认 **-40**） | 音量门限 dB | VAD 滑条 |
| `vad_extrabuffersize` | 整数 | VAD 额外缓冲 | — |
| `denoise` | `"true"/"false"` | 降噪开关 | `denoisecheckBox` |
| `denoiser_level` | 整数 | 降噪强度 | `denoisehorizontalSlider`（label_soft/hard） |
| `agc` | `"true"/"false"` | 采集侧 AGC | `agccheckBox`（3.5.0 起仅播放侧 AGC） |
| `agc_extra_saturation_margin_db` | 数值 | AGC 饱和保护余量 | — |
| `typing_suppression` | `"true"/"false"` | 打字声抑制 | `typingsuppressioncheckBox` |
| `name` | 字符串 `"TeamSpeak Audio Capture Preprocessor"` | 采集线程名 | — |

**证据（A：函数内字符串常量表）**
```bash
$ python3 funcstr.py ts3client_win64.exe 0x6d7100 0x6d7932
'[->aec]'0xd44b28@0x6d7158  '[->echo_canceling]'0xd44b18  '[->true]'/'[->false]'0xc4a590/0xc4a5f0  '[->vad]'0xc4a580
'[->vad_rnn]'0xc4a5e0  '[->vad_mode]'0xc4a5d0  '[->vad_likelihood]'0xc4a5a0  '[->voiceactivation_level]'0xc4a620
'[->vad_extrabuffersize]'0xc4a630  '[->denoise]'0xc4a550  '[->denoiser_level]'0xc4a570  '%d'0xd3ea40
'[->agc]'0xc4a540  '[->agc_extra_saturation_margin_db]'0xc4a530  '[->typing_suppression]'0xc4a560
'[->name]'0xc4a5b0  '[->TeamSpeak Audio Capture Preprocessor]'0xc4a600@0x6d78f8
```

### 4.3 下发路径 `updateCaptureProfile`（A）

函数 `0x1402F95A0–0x1402FA734`（字符串池含 `updateCaptureProfile() `）把 profile 值写入同一套键后下发：

| 字符串（数据地址） | 引用点 | 含义 |
|---|---|---|
| `Error setting PreProcessorConfigValues: `（`0xCB7F90`） | `0x2FA116` | 下发失败 |
| `Error setting PreProcessorConfigValues when updating capture system: `（`0xCB7E98`） | 同函数 | 更新采集系统时下发失败 |
| `Enforcing push-to-talk`（`0xCB7EF0`） | `0x2F9DFF` | 服务器强制 PTT |
| `b_client_force_push_to_talk`（`0xCAFA48`） | `0x2F9AFB` | 对应权限名 |
| `denoise`/`denoiser_level`/`vad_rnn`/`vad_mode`/`voiceactivation_level`/`vad_extrabuffersize`/`typing_suppression`/`agc`/`aec`/`vad` | `0x2F9ED0`–`0x2FA35F` | 键名（与 §4.2 一致） |

**证据（A）**
```bash
$ python3 funcstr.py ts3client_win64.exe 0x2f95a0 0x2fa734
'Error closing capture device'0xcb7e90  'Failed to query default capture mode'0xcb7e68  'b_client_force_push_to_talk'0xcafa48
'Enforcing push-to-talk'0xcb7ef0  'true'/'false'0xc8d550/0xc8d548  'denoise'@0x2f9ed0  'denoiser_level'@0x2f9f1a
'vad_mode'@0x2f9f99  'voiceactivation_level'@0x2fa000  'aec'@0x2fa2b7  'vad'@0x2fa30b
'Error setting PreProcessorConfigValues: '0xcb7f90@0x2fa116   'updateCaptureProfile() '0xcb7fe0@0x2fa48e
```

### 4.4 内置 WebRTC APM 的实际组成（B：18 个 `__FILE__`）

| 子模块 | 源文件 |
|---|---|
| 顶层/运行时配置 | `audio_processing_impl.cc` |
| AEC3 | `aec3/block_processor.cc`、`aec3/echo_remover.cc`、`aec3/matched_filter.cc`、`aec3/render_delay_buffer.cc`、`aec3/stationarity_estimator.cc` |
| AEC（旧）/AECM/接口 | `aec/aec_core.cc`、`echo_control_mobile_impl.cc`、`echo_cancellation_impl.cc` |
| NS | `noise_suppression.cc` |
| VAD | `voice_detection.cc`、`vad/voice_activity_detector.cc` |
| AGC1 | `gain_control_impl.cc`、`agc/agc_manager_direct.cc` |
| 瞬态抑制 | `transient/transient_suppressor.cc` |
| 残余回声 | `residual_echo_detector.cc` |
| 滤波器组 | `splitting_filter.cc`、`three_band_filter_bank.cc` |

`AudioProcessing::Config` 的字段/枚举串在 `.rdata` 连续排列，证明同一 `ToString()` 带全部子模块配置项：

```
AudioProcessing::Config{ pipeline: { maximum_internal_processing_rate: , experimental_multi_channel:
 pre_amplifier: { enabled: , fixed_gain_factor:  }, high_pass_filter: { enabled:
 echo_canceller: { enabled: , mobile_mode: , legacy_moderate_suppression_level: , use_legacy_aec:
 noise_suppression: { enabled: , level:  }, voice_detection: { enabled:
 gain_controller1: { enabled: , mode: , target_level_dbfs: , compression_gain_db: , enable_limiter: , analog_level_minimum: , analog_level_maximum:
 }, gain_controller2: { enabled: , fixed_digital: { gain_db:  }, adaptive_digital: { enabled: , level_estimator: , use_saturation_protector: , extra_saturation_margin_db:  }
 }, residual_echo_detector: { enabled:  }, level_estimation: { enabled:
Moderate / VeryHigh / AdaptiveAnalog / AdaptiveDigital / FixedDigital
```

> ⚠️ 该串是 **WebRTC 自己的调试打印**，只证明「这些参数存在且可配」，**不能**证明 TS3 的取值；TS3 实际取值见 §4.2/§4.6。

### 4.5 字段试验开关（B：证明 AEC3 为默认）

| 字符串（节选） | 含义 |
|---|---|
| `WebRTC-Aec3ShortHeadroomKillSwitch`、`WebRTC-Aec3ClampInstQualityToOneKillSwitch`、`…ToZeroKillSwitch`、`WebRTC-Aec3MinErleDuringOnsetsKillSwitch` | AEC3 行为开关 → **AEC3 默认启用** |
| `Legacy AEC;`、`Legacy AEC;RefinedAdaptiveFilter;` | 试验名（旧 AEC + 精化自适应滤波） |
| `<WebRTC.Audio.EchoCanceller.EchoPathDelay`、`…Erl.*`、`…Erle.*` | AEC 指标（ERL/ERLE/延迟） |
| `WebRTC.Audio.Agc2.EstimatedNoiseLevel`、`WebRTC-Audio-Agc2ForceInitialSaturationMargin`、`…ForceExtraSaturationMargin` | AGC2 指标/开关 |
| `WebRTC-ApmExperimentalMultiChannel{Capture,Render}KillSwitch` | 多声道 APM 试验开关（默认关） |
| `WebRTC.Audio.ApmCaptureInputLevel{Average,Peak}Rms` 等 | 电平指标名 |

**证据（B）**
```bash
$ grep -E '^WebRTC|^<WebRTC|^>WebRTC|^Legacy AEC' c.strings | sort -u | head -8
<WebRTC.Audio.AgcClippingAdjustmentAllowed      <WebRTC.Audio.EchoCanceller.EchoPathDelay
>WebRTC-Aec3MinErleDuringOnsetsKillSwitch        Legacy AEC;
Legacy AEC;RefinedAdaptiveFilter;                WebRTC-Aec3ClampInstQualityToOneKillSwitch
WebRTC-Aec3ClampInstQualityToZeroKillSwitch      WebRTC-Aec3ShortHeadroomKillSwitch
WebRTC-ApmExperimentalMultiChannelCaptureKillSwitch   WebRTC-Audio-Agc2ForceExtraSaturationMargin
```

### 4.6 前处理默认值（A/B：旧版 ini 键→默认值表）

函数 `0x1403FEFF0–0x1403FFCC0`（设置迁移/兼容层）逐字面量写出 `键=默认值`：

| 键 | 默认值 | 数据地址 |
|---|---|---|
| `vad_mode` | `0` | `0xCE59A8` |
| `voiceactivation_level` | `-40` | `0xCE59D0` |
| `vad_over_ptt` | 空（false） | `0xCE59B8` |
| `continous_transmission` | 空（false；**原始拼写少一个 u**） | `0xCE59F8` |
| `denoise` | 空（false） | `0xCE5A10` |
| `vad` | 空（false） | `0xCE59EC` |
| `agc` | 空（false） | `0xCE59C8` |

同函数写出采集 profile 的 INI 结构：`[Profiles]`、`[Capture]`、`PreProcessing`、`Capture/`、
`Mode=`、`Device=`、`DeviceDisplayName=`、`/PreProcessing`。

**证据（A）**
```bash
$ python3 funcstr.py ts3client_win64.exe 0x3feff0 0x3ffcc0
'Profiles' 0xca93c8  'Capture' 0xc7fae8  'PreProcessing' 0xce0ae8  'Capture/' 0xcd4548  '/PreProcessing' 0xcd4538
'Mode=' 0xca93f8  'Device=' 0xca93f0  'DeviceDisplayName=' 0xca93d8
'denoise='@0x3ff59d  'continous_transmission='@0x3ff5f8  'vad='@0x3ff656  'voiceactivation_level=-40'@0x3ff691
'agc='@0x3ff6d4  'vad_over_ptt='@0x3ff732  'vad_mode=0'@0x3ff76d
```

## 5. 编码（Opus / CELT / Speex）

### 5.1 编解码器枚举（A：立即数比较）

| 值 | 名称 | 证据 |
|---|---|---|
| **3** | `CODEC_CELT_MONO`（CELT Mono 48 kHz） | `0x1406D3372: cmp $0x3,%r12d`（`encode_celt.cpp` 断言函数内）；`0x1406D3040: cmp $0xbb80,%r9d`（强制 48 kHz） |
| **4** | `CODEC_OPUS_VOICE` | `0x1406D3F2B: cmp $0x4,%ebx; setne`；`0x1406D4110: cmp $0x4,%r14d` → Signal 选择 |
| **5** | `CODEC_OPUS_MUSIC` | `0x1406D3D96 / 0x1406D3DA0: cmp $0x4 / cmp $0x5` 同跳转目标 |
| 0/1/2 | Speex NB/WB/UWB（**推断**） | 权限名 `..._codec_speex8/16/32`；名称串 `Speex Narrowband/Wideband/Ultra-Wideband`；断言 `m_SampleRate == 8000` |

### 5.2 Opus 参数（A：全部来自立即数）

| 参数 | Opus Voice (4) | Opus Music (5) | 证据 |
|---|---|---|---|
| Fs | **48000** | **48000** | `0x1406D3F79: mov $0xbb80,%edx`（其后即 `call 0x14087F230`） |
| 声道 | **1**（单声道） | **2**（立体声） | `0x1406D3F75: lea 0x1(%r15),%r8d`，`r15b = (codec != 4)` |
| application | **2048 (0x800) = OPUS_APPLICATION_VOIP** | **2049 (0x801) = OPUS_APPLICATION_AUDIO** | `0x1406D3F6E: lea 0x800(%rsi),%r9d`，`sil = (codec != 4)` |
| `OPUS_SET_SIGNAL`(4024=`0xFB8`) | **3001 (`0xBB9`) = SIGNAL_VOICE** | **3002 (`0xBBA`) = SIGNAL_MUSIC** | `0x1406D4118: add $0xbb9,%r8d`；`0x1406D411F: mov $0xfb8,%edx`；`0x1406D4127: call 0x140883E10` |
| 帧长 | **960 采样 = 20 ms** | 同 | `0x1406D3A80: mov $0x3c0,%eax; ret`（虚函数 `[8]`） |
| 其它 ctl | `OPUS_RESET_STATE`(4028) | 同 | `0x1406D4240: mov $0xfbc,%edx` + `call 0x140883E10`（编码器 reset 方法） |

> `call 0x14087F230(st, Fs, ch, app)` 与 `call 0x140883E10(st, request, value)` 的 4 参/3 参签名分别与
> `opus_encoder_init` / `opus_encoder_ctl` 一致 —— 符号名本身未保留，属**推断**（用户态 opus 静态链接）。
> **Ghidra 反编译确认**（伪代码原文）：`iVar8 = FUN_14087f230(pvVar6,48000,(iVar8 != 4) + '\x01',(iVar8 != 4) + 0x800);`
> 与 `FUN_140883e10(pvVar6,0xfb8,(param_3 != 4) + 0xbb9);` —— 参数表达式与上表逐项吻合；**全部 ctl 仅 3 处**（SET_SIGNAL / SET_BITRATE / RESET_STATE）。

**比特率映射（A：`EncodeOPUS::setQuality(int)` @ `0x1406D4530`）**

```
edi = min(quality, 10)                        ; 0x1406D4547 mov $0xa,%edi ; 0x1406D454E cmovbe
if (codec == 4) bytes_per_sec = (edi+1) << 9   ; 0x1406D4569 cmpl $0x4,0x38(%rbx) ; 0x1406D456F/0x1406D4573
else           bytes_per_sec = (edi+1) * 900   ; 0x1406D4579 lea 0x1(%rdi),%eax ; 0x1406D457C imul $0x384
this->+0x3C = bytes_per_sec ; this->+0x10 = quality   ; 0x1406D4583 / 0x1406D4587
bits = bytes_per_sec * 8                       ; 0x1406D458A lea 0x0(,%r8,8),%r8d
opus_encoder_ctl(enc, 4002 /*OPUS_SET_BITRATE*/, bits)  ; 0x1406D4592 mov $0xfa2,%edx ; 0x1406D459B call
```

| 质量档（0–10，上限截断到 10） | Opus Voice | Opus Music |
|---|---|---|
| 0 | 4.096 kbps | 7.2 kbps |
| 5 | 24.576 kbps | 43.2 kbps |
| 10 | **45.056 kbps** | **79.2 kbps** |

（`+0x10` 初值被写 `0xFF`：`0x1406D3D60: movl $0xff,0x10(%rcx)`，即“质量未设置”。）

**证据（A）**
```bash
$ objdump -d --start-address=0x1406d3f20 --stop-address=0x1406d3f90 ts3client_win64.exe
  1406d3f2b: cmp $0x4,%ebx ; setne %sil ; setne %r15b ; 1406d3f6e: lea 0x800(%rsi),%r9d  # app
  1406d3f75: lea 0x1(%r15),%r8d  # channels ; 1406d3f79: mov $0xbb80,%edx  # Fs=48000
  1406d3f81: call 0x14087f230    # opus_encoder_init(st,Fs,ch,app) ; 0x1406d3fa3 "Failed to initialise opus encoder"
$ objdump -d --start-address=0x1406d410d --stop-address=0x1406d4137 ts3client_win64.exe
  1406d4118: add $0xbb9,%r8d ; 1406d411f: mov $0xfb8,%edx ; 1406d4127: call 0x140883e10  # SET_SIGNAL
$ objdump -d --start-address=0x1406d4547 --stop-address=0x1406d45a0 ts3client_win64.exe
  1406d4547: mov $0xa,%edi ; cmovbe %edx,%edi ; 1406d4569: cmpl $0x4,0x38(%rbx)
  1406d456f: lea 0x1(%rdi),%r8d ; shl $0x9,%r8d ; 1406d457c: imul $0x384,%eax,%r8d
  1406d458a: lea 0x0(,%r8,8),%r8d ; 1406d4592: mov $0xfa2,%edx ; call 0x140883e10  # SET_BITRATE
$ objdump -d --start-address=0x1406d3a70 --stop-address=0x1406d3a86 ts3client_win64.exe
  1406d3a70: mov $0xbb80,%eax ; ret      1406d3a80: mov $0x3c0,%eax ; ret
```

### 5.3 编码器虚接口（A：vtable + 偏移）

| vtable 索引（字节偏移） | EncodeOPUS `0x140D47128` | EncodeCELT `0x140D46FB0` | EncodeSpeex `0x140D47450` | 语义 |
|---|---|---|---|---|
| `[0]/[1]` | `0x6D4170`/`0x6D41E0` | `0x6D3680`/`0x6D36E0` | `0x6D5E70`/`0x6D5F00` | 析构/删除 |
| `[2]` | `0x6D4500` | `0x6D39C0` | `0x6D6380` | 参数/前处理入口（推断） |
| `[7]` = `+0x38` | `0x6D3A70` → **48000** | `0x6D3A70` → 48000 | `0x6D6440` → `[this+0x44]` | `getSampleRate()`（推断名） |
| `[8]` = `+0x40` | `0x6D3A80` → **960** | `0x6D3A80` → 960 | `0x6082F0` | `getPeriodSizeInSamples()`（推断名） |

**证据（A）**
```bash
$ python3 -    # 读三个 vtable（每项 8 字节指针，VA = ImageBase + RVA）
rva=0xd47128 → [0]0x6d4170 [1]0x6d41e0 [2]0x6d4500 [7]0x6d3a70 [8]0x6d3a80
rva=0xd46fb0 → [0]0x6d3680 [1]0x6d36e0 [2]0x6d39c0 [7]0x6d3a70 [8]0x6d3a80
rva=0xd47450 → [0]0x6d5e70 [1]0x6d5f00 [2]0x6d6380 [7]0x6d6440 [8]0x6082f0
```

### 5.4 CELT / Speex 编码器（A/B）

| 项 | CELT Mono | Speex |
|---|---|---|
| 构造/初始化函数 | `0x1406D2FA0–0x1406D3671` | `0x1406D5B20–0x1406D5E6F` |
| 采样率约束 | 构造时校验 `0xBB80`（48000） | 由 `[this+0x44]` 动态给出（8k/16k/32k） |
| 帧长 | `0x1406D3052: mov $0x3c0,%eax`（960 采样） | 编码调用处见立即数 `0x1E0`（480，**语义未确认**） |
| 名称/错误串 | `CELT Mono`、`CELT Mono 48kHz`、`CELT bitstream version: 0x`、`CELT codec was not initalised correctly` | `Speex Narrowband/Wideband/Ultra-Wideband`、`Tried to initialised SpeexEncoder with invalid Speex Codec: ` |
| 断言 | `codecSelection == CODEC_CELT_MONO` | `m_period_frames * m_Channels * sizeof(short) >= sizeOfEncodedData` |
| 解码错误 | `Could not decode CELT sound data, dropping.` / `Could not interpolate CELT…padding silence.` | `Failed to initialise speex decoder (are you out of memory?)` |

**Speex 的真实用途（结论）**——不止 jitter/PLC，共四重角色：①**编码器**（`EncodeSpeex`，权限 `…_codec_speex8/16/32`）；
②**jitter buffer**（`speex_ts\libspeex\jitter.c` 编译进 exe，`jitter_buffer_get()` 定位 `0x140A8D65E–0x140A8D801`）；
③**重采样器**（`speex_resampler_*`，§3.4）；④**legacy 前处理**（`PreProcessSpeex` + 全套 `SPEEX_PREPROCESS_SET_*`）。

### 5.5 解码侧断言（B，`teamspeak_common_lib\src\sound\decode.cpp`）

| 断言 | 结论 |
|---|---|
| `m_Channels==1 \|\| codec == CODEC_OPUS_MUSIC` | **只有 Opus Music 允许立体声** |
| `channels == 1 \|\| channels == 2` / `channels == 2` | 输出声道 1 或 2 |
| `m_SampleRate == 8000` | Speex Narrowband 解码固定 8 kHz |
| `m_PeriodSizeInSamples == var` | 解码周期与全局一致（960 采样） |
| `numberVoicePackets > 0 && voiceDataSize % numberVoicePackets == 0` | **一个 UDP 包可含多个语音帧** |
| `status == 2` | 解码状态机取值（语义未确认） |

### 5.6 音乐模式跳过前处理（C）

`changelog.txt`（3.4.0）：`+ Added Opus voice and music codecs… no preprocessing is done when opus music is used. This means that AGC, noise suppression, echo cancellation etc. do not work when using Opus music.`
（实现层面的“跳过”分支未定位 → §11）

## 6. 发送链路（封包 / 加密 / 私语 / 重传）

### 6.1 语音包约束（A：断言原文，`teamspeak_common_lib\src\packet\*`）

| 断言 | 文件 | 结论 |
|---|---|---|
| `count <= 255 && count == channelListSize` | `outgoingvoicepacket.cpp` | 私语**频道列表 ≤255**，1 字节计数必须等于列表长度 |
| `count <= 255 && count == clientListSize` | `outgoingvoicepacket.cpp` | 私语**定向客户端 ≤255** |
| `m_DataSize <= get_packet_mtu(is_ipv6)` | `outgoingpacket.cpp` | 包体受 **MTU** 限制（v4/v6 分别计算） |
| `packet->getPacketSize() <= get_packet_mtu(...) \|\| getType() == VOICE_WHISPER` | `packethandler.cpp` | **`VOICE_WHISPER` 是 MTU 检查唯一豁免**（携带目标列表） |
| `taglen == TAG_LENGTH` | `outgoingpacket.cpp` | 加密认证标签长度固定为 `TAG_LENGTH` |
| `m_State == READABLE` / `m_State == ENCRYPTED` | `outgoingpacket.cpp` / `incomingpacket.cpp` | 包对象状态机：明文 ↔ 加密 |
| `getVoiceDataSize() == 0`、`getHeaderSize() <= it->m_DataSize` | `incomingpacket.cpp` | 空语音数据/头部长度下界校验 |
| `m_SortedPacketList[packetType]`、`m_PacketID.size()`、`m_AckWaitIterList[packetType]` | `connection.cpp` | **每连接按包类型维护包 ID 计数与 ACK 等待队列** |
| `!hasFragmentFlag()`、`needsSplitting(is_ipv6)`、`original.getPacketSize() == getPacketSize()` | `outgoingresendingpacket.cpp` | 重传包不得再分片 |
| `MTU_TOO_SMALL` / `We tried to make a packet >= MTU, bad idea` | 字符串池 | MTU 不足的错误码/内部日志 |

**证据（B）**
```bash
$ grep -oE 'Assertion "[^"]*" failed at [^ ]*(outgoingvoicepacket|outgoingpacket|packethandler|incomingpacket|connection)\.cpp' c.strings | sed -E 's/Assertion "([^"]*)".*packet\\/\1/' | sort -u
count <= 255 && count == channelListSize    count <= 255 && count == clientListSize   (outgoingvoicepacket.cpp)
m_DataSize <= get_packet_mtu(is_ipv6)   taglen == TAG_LENGTH   m_State == READABLE    (outgoingpacket.cpp)
packet->getPacketSize() <= get_packet_mtu(...) || packet->getType() == VOICE_WHISPER   (packethandler.cpp)
m_State == ENCRYPTED / getVoiceDataSize() == 0                                        (incomingpacket.cpp)
$ grep -iE '\bMTU\b' c.strings | sort -u   # MTU_TOO_SMALL / We tried to make a packet >= MTU, bad idea
```

### 6.2 加密位置与语料（A/B）

| 事实 | 证据 |
|---|---|
| 加密在 `OutgoingPacket`/`IncomingPacket` 层（组包后发送前） | `taglen == TAG_LENGTH`、`m_State == ENCRYPTED` |
| 失败码 | `DECRYPTION_FAILED`、`DECRYPTION_FAILED_OR_BAD_RECORD_MAC`、`BAD_FIXED_HEADER_DECRYPT`、`WRONG_ENCRYPTION_LEVEL_RECEIVED` |
| 频道级开关 | `CHANNEL_VOICE_DATA_ENCRYPTED`、`CHANNEL_VOICE_DATA_ENCRYPTED_FLAG` + UI `encryptedVoiceDataCheckBox` |
| 服务器级 | `voiceDataEncryptionComboBox`、`voiceDataEncryptionLabel`、`onCheckVoiceDataEncryptedCheckBox()`、`Make channel codec encrypted`、`Modify codec encryption mode`、`Voice data in this channel will be encrypted.`、`Failed to set virtual server voice data encryption mode` |
| 加密原语（编进 exe） | `ts_tomcrypt`：`aes.c`、`eax_*`、`gcm_*`、`ctr_*`、`sha1/sha256/sha512`、`hmac_*`、`base64_*` |
| 自有封装 | RTTI `teamnative_crypto::Cryptlib::Impl`、`Sha<..>`、`Hasher<..>`、`BaseHasher` |
| 其它 | `srtp license`（SRTP 许可文案存在）；`common_crypt_functions.cpp` 的 `outputlen == 20` 断言对应 **SHA-1(20B)** 摘要路径（hash 名表 `DAT_140d54d18 = "sha1"`） |

> **Ghidra 反编译确认**：语音包加密走 libtomcrypt 分支（目录名在工具输出中被脱敏为 `ts_{{PASSWORD_*}}`；其子目录
> `ciphers/aes`、`encauth/eax`、`modes/ctr`、`hashes/sha2`、`mac/hmac`、`misc/base64` 与 libtomcrypt 布局逐一对应）的 **EAX** 模式
> （`FUN_140a7ac90`→`eax_encrypt_authenticate_memory(key,pt,ct,tag,taglen)`，`eax_encrypt.c`/`eax_init`，状态 malloc `0x3798`），
> **`TAG_LENGTH == 8`**（`if (local_2a8[0] != 8) assert "taglen == TAG_LENGTH"`），包级状态机 `[this+0x18]`：`0=READABLE / 2=ENCRYPTED`。
> **仍未知**：密钥派生（客户端侧未定位到 16B key + 16B nonce 的 SHA-256 派生点）。

**证据（B）**
```bash
$ grep -E 'ts_tomcrypt\\src\\(ciphers|encauth|modes|hashes|mac)' c.strings | sort -u | head -6
ts_tomcrypt\src\ciphers\aes\aes.c            ts_tomcrypt\src\encauth\eax\eax_decrypt.c
ts_tomcrypt\src\encauth\gcm\gcm_add_aad.c    ts_tomcrypt\src\modes\ctr\ctr_setiv.c
ts_tomcrypt\src\hashes\sha2\sha256.c        ts_tomcrypt\src\mac\hmac\hmac_init.c
$ grep -oE '\.\?AV[A-Za-z0-9_$@]+@teamnative_crypto[^ ]*' c.strings | sort -u | head -4
.?AV?$Hasher@$0BE@@teamnative_crypto@teamspeak3@com@@      .?AV?$Sha@$0BAA@@teamnative_crypto@teamspeak3@com@@
.?AVImpl@?$Hasher@$0BE@@teamnative_crypto@teamspeak3@com@@ .?AVImpl@Cryptlib@teamnative_crypto@teamspeak3@com@@
```

### 6.3 说话目标状态机（A：断言原文，`serverconnectionhandler.cpp`）

```
Assertion "m_CurrentTalkSettings.m_talkTarget == WHISPER_GROUP" failed at ...
Assertion "iter->second.m_Whispering != 0 || iter->second.m_TalkingNormally != 0" failed at ...
Assertion "oldTalkStatus < 25" failed at ...
Assertion "m_pDecodeManager" / "m_pPlayBack" / "m_pChanClients" failed at ...
```
| 成员 | 含义 |
|---|---|
| `m_CurrentTalkSettings.m_talkTarget` | 说话目标枚举（至少含 `WHISPER_GROUP`；全集未确认） |
| `m_Whispering` / `m_TalkingNormally` | 每客户端「正在私语 / 正常说话」标记 |
| `m_pDecodeManager` / `m_pPlayBack` / `m_pChanClients` | **接收链三大成员**：解码管理器 / 播放管理器 / 频道客户端表（`oldTalkStatus < 25` 为上界） |

## 7. 接收与播放

### 7.1 jitter buffer（A/B）

| 项 | 内容 |
|---|---|
| 实现 | **Speex jitter buffer**（`speex_ts\libspeex\jitter.c`，TS3 定制分支） |
| 函数 | `jitter_buffer_get()` 相关代码 `0x140A8D65E–0x140A8D801` |
| 内部日志 | `jitter_buffer_get() discarding non-zero start_offset`、`jitter_buffer_get(): packet too large to fit. Size is`、`jitter buffer sees negative buffering, your code might be broken. Value is ` |
| 衔接 | `DecodeManager`（断言 `m_pPlaybackBase`）/ `DecodeManagerClient`（每客户端） |

**证据（A/B）**
```bash
$ python3 batch.py ts3client_win64.exe 'jitter_buffer_get() discarding non-zero start_offset' 'jitter_buffer_get(): packet too large to fit. Size is'
  str=0xd98460 lea@0xa8d733 func=0xa8d65e-0xa8d801 va=0x140a8d65e
  str=0xd98530 lea@0xa8d6c3 func=0xa8d65e-0xa8d801 va=0x140a8d65e
$ grep -i jitter c.strings | sort -u     # 另有：c:\...\deps\speex_ts\libspeex\jitter.c / jitter buffer sees negative buffering...
```

### 7.2 丢包补偿（PLC/FEC）证据现状

| 线索 | 等级 | 说明 |
|---|---|---|
| `Could not decode OPUS sound data, padding silence.` | B | 解码失败→**填充静音**（最朴素 PLC） |
| `Could not interpolate CELT sound data, padding silence.` | B | CELT 有「插值 + 静音填充」分支 → 插值型 PLC |
| `Could not decode CELT sound data, dropping.` | B | 另一分支直接丢帧 |
| Opus 带内 FEC（`OPUS_SET_INBAND_FEC`=4018 / `OPUS_SET_PACKET_LOSS_PERC`=4014） | — | **未检出**相应立即数 → 是否启用**未确认** |
| Speex PLC | — | `nb_celp.c` 被编译，Speex 解码器自带 PLC（**推断**） |

### 7.3 混音图与回调签名（A：`boost::bind` RTTI 修饰名可完整解出）

| 类 | 解出的签名 |
|---|---|
| `GenericSoundChannelMixer` | `X (short*, int, int, const unsigned int*, unsigned int*, const SoundRender3DInfo*, const SpeakerChannelInfo*, boost::optional<boost::unique_lock<boost::recursive_mutex>&>)` |
| `Sender_Data`（`audio::playback`） | 同上 8 参 |
| `Wave_Play_Data` | 7 参：`(short*, int, int, const unsigned int*, unsigned int*, const SoundRender3DInfo*, const SpeakerChannelInfo*)` |
| `PlaybackManager` | 7 参：`(short*, int, int, const unsigned int*, unsigned int*, const SpeakerChannelInfo*, ServerConnectionHandler*)` |
| `Wave_Play_Data` 另两成员 | `unsigned (uint32_t)`；`unsigned (boost::shared_ptr<IAsyncBuffer>, int, bool)` |

推断调用约定：`mix(short* out, int frames, int channels, const uint32_t*, uint32_t*, const SoundRender3DInfo*, const SpeakerChannelInfo*, optional<unique_lock<recursive_mutex>&>)`
→ 16-bit 交错 PCM 输出；`SoundRender3DInfo` 携带 3D 位置/衰减/滚降；`SpeakerChannelInfo` 携带扬声器布局；
`optional<unique_lock<recursive_mutex>&>` 说明**混音可递归加锁**（同线程可重入）。

**证据（A：修饰名原文）**
```bash
$ grep -F 'SoundRender3DInfo' c.strings | head -3
.?AV?$bind_t@XV?$mf8@XUSender_Data@playback@audio@teamspeak@com@@PEAFHHPEBIPEAIPEBUSoundRender3DInfo@@PEBUSpeakerChannelInfo@@V?$optional@AEAV?$unique_lock@Vrecursive_mutex@boost@@@boost@@@boost@@@_mfi@boost@@…
.?AV?$bind_t@XV?$mf8@XVGenericSoundChannelMixer@@PEAFHHPEBIPEAIPEBUSoundRender3DInfo@@PEBUSpeakerChannelInfo@@V?$optional@…
.?AV?$bind_t@XV?$mf7@XVWave_Play_Data@playback@audio@teamspeak@com@@…PEBUSoundRender3DInfo@@PEBUSpeakerChannelInfo@@@_mfi@boost@@…
```

### 7.4 播放侧 DSP

| 组件 | 类/证据 |
|---|---|
| 单客户端音量 | `ClientVolumeModifiers`、`HaveVolumeModifier`、`client_volume_modificator`、`CLIENT_VOLUME_MODIFIER`；插件事件 `onVolumeModifierOfProfileChanged(uint64,float)` |
| 音量范围 | **-50.0 … +20.0 dB**（changelog：`setClientVolumeModifier … Min/Max volume is -50.0 to +20.0`） |
| 主音量/工具箱 | `MasterVolumeWidget`、`UserVolumeWidget`、`voiceVolumeInMainToolbar`、`Voice Volume Adjustment` |
| 播放 AGC | `Agc@playback`、`I_Dsp@playback`、`I_Playback_Client_Dsp@playback`；changelog `- Removed AGC from audio capture settings in favour of playback AGC` |
| 舒适噪声 | `Cng@playback`、`Comfort noise`、`checkBoxComfortNoise`、`doubleSpinBoxComfortNoise`、`horizontalSliderComfortNoise` |
| 单声道扩展 | `monoToStereoRadioButton`/`monoToSurroundRadioButton`/`monoToCenterRadioButton`、`groupBoxMonoSounds`、`PlaybackMonoOverCenterSpeaker=` |
| 麦克风点击音 | `playbackMicOwnCheckBox`/`playbackMicOthersCheckBox`、`PlayMicClicksOnOwn=`/`PlayMicClicksOnOthers=`、`mic_click_on/off.wav` |
| 设备兼容修补 | `G35MonoFixApplied2`、`G35 mono fix applied` |
| 语音音量均衡 | UI `Automatic voice volume leveling`；changelog 3.5.0 新增 |

### 7.5 3D 音效

| 项 | 内容 |
|---|---|
| 类/UI | `Sound3DManager`、`Sound3DWidget`、`Sound3DGraphicsView`、`ui_sound3dwidget.h` |
| 设置键/开关 | `3DSoundEnabled`、UI `Always set clients 3D positions when available` |
| 渲染参数 | `SoundRender3DInfo`（混音回调参数，§7.3） |
| 插件 API | `ts3plugin_onCustom3dRolloffCalculationClientEvent`（changelog 提及改名） |
| 测试音 | `SPECIAL_3D_TEST = play("../default/3d_test.wav")`（`sound/default/settings.ini`） |

### 7.6 扬声器布局（A：断言原文）

```
Assertion "(int)speakerChannelInfo->m_Channels.size() == channelCount"（genericsoundchannel.cpp）
Assertion "i < 32"（speakerchannelinfo.cpp）
Assertion "m_center_channel_index >= 0" / "m_left_channel_index >= 0 && m_right_channel_index >= 0" / "m_lfe_idx >= 0"（genericchannelconverter.cpp）
```
→ `SpeakerChannelInfo` 含最多 **32** 个通道的映射表，并保留 center/LFE/L/R 索引（典型 5.1→立体声下混）。

## 8. 功能清单

| # | 功能 | 关键证据 | 模块 |
|---|---|---|---|
| 1 | **PTT 按键说话** | `hotkeyPushButton`、`No Hotkey Assigned`、`delay_ptt`/`delay_ptt_msecs`、`Release Delay`、帮助文本 `Push-To-Talk will only enable your microphone…`、`PTTWarningDialog`、`Force Push-To-Talk capture mode`、权限 `b_client_force_push_to_talk` | UI + CaptureManager |
| 2 | **VAD 自动检测（3 模式）** | `VADControl`/`VADDisplay`/`vad_control.cpp`、键 `vad/vad_mode/vad_likelihood/voiceactivation_level/vad_extrabuffersize/vad_rnn`、UI `Automatic`/`Volume Gate`、changelog `+ Added new voice activity detection modes (Automatic, Volume Gate, Hybrid).` | APM VoiceDetection + UI |
| 3 | **VAD over PTT** | 键 `vad_over_ptt`、`checkBoxVadOverPtt`、帮助 `Enabled Voice Activity Detection even when Push-To-Talk is used.` | 采集页 |
| 4 | **连续传输** | `radioButtonContinous`、键 `continous_transmission`、帮助 `With Continuous Transmission voice data is constantly transmitted…` | 采集页 |
| 5 | **语音测试** | `VoiceTestLabel`、`playTestSoundButton`/`Stop &Test Sound`、`Error opening playback device to play test sound`、`Could not reactivate capture device after VAD voice test: `、`Voice Test is still active...`、`Error spawning new server connection handler to play test sound` | 采集+播放 UI |
| 6 | **Whisper 私语** | 类 `OutgoingVoiceWhisperPacket`、`WhisperManager`、`WhisperReceiveManager`、`WhisperDialog`、`WhisperListView`、`ActiveWhispers`、`WhisperHistoryWidget`、`WhisperSetup`；键 `WhisperAllow=`、`IgnoreWhisper`、`TOGGLE_BLOCK_INCOMING_WHISPERS`、`AllowWhisperMode`；断言 `count <= 255 && count == channelListSize/clientListSize`；proto `Whisper_list_data` | serverconnectionhandler + 包层 |
| 7 | **频道语音广播** | 默认说话目标=当前频道；`m_talkTarget` 枚举（含 `WHISPER_GROUP`）；频道属性 `CHANNEL_VOICE_DATA_ENCRYPTED_FLAG` | ServerConnectionHandler |
| 8 | **本地录音（含多轨）** | 类 `Recorder`/`RecorderThread`/`RecorderLabel`、`Recorder::storeCaptureData`、`CLIENT_FLAG_RECORDING`、`CLIENT_RECORDING_START/STOP`、`CLIENT_RECORDING_IN_CHANNEL`、插件事件 `onEditMixedPlaybackVoiceDataEvent (recorder)`、changelog `+ Implemented multi-track recording feature` | audio::Recorder + 混音输出 |
| 9 | **设备选择（设备+模式+自定义）** | `captureDeviceComboBox`/`playbackDeviceComboBox`、`captureModeComboBox`/`playbackModeComboBox`、`customCaptureDeviceLineEdit`/`customPlaybackDeviceLineEdit`、`Automatically use best mode`、断言 `!(mode_id.empty() \|\| capture_device_id.empty())` | SoundDeviceManager |
| 10 | **音量/增益** | `MasterVolumeWidget`、`UserVolumeWidget`、`CLIENT_VOLUME_MODIFIER`、`VolumeModifier=`、`VolumeFactorWave`、`playbackVolumeFactorDbWaveSlider`、`voiceVolumeInMainToolbar`、changelog -50.0…+20.0 | 播放 DSP + UI |
| 11 | **声音包** | `ADDON_SOUNDPACK`、`SoundPack`、`PlaySoundSet`、`sound/<pack>/settings.ini`+73 个 wav、`SPECIAL_*` 系列（`SPECIAL_SOUND_TEST`/`SPECIAL_3D_TEST`/`SPECIAL_WHISPER_NOTIFY`/`SPECIAL_MIC_CLICK_*`/`SPECIAL_TALKING_WHILE_MUTED`） | wavereader + playback_sample_buffer_data |
| 12 | **通话统计** | `ServerConnectionInfoDialog`：`packetlossLabel`、`packetsSentTotalLabel`、`packetsReceivedTotalLabel`、`bytesSent/ReceivedTotalLabel`、`bandwidthSent/ReceivedLastSec/MinLabel`、`Average ping`、`Average packetloss`、`filetransfer*` | UI + Connection |
| 13 | **语音数据加密开关** | 频道级 `encryptedVoiceDataCheckBox`/`CHANNEL_VOICE_DATA_ENCRYPTED`；服务器级 `voiceDataEncryptionComboBox`、`Make channel codec encrypted`、`Modify codec encryption mode` | 包层加密 + 权限 |
| 14 | **AEC 回声消除** | `I_Team_Apm`/`Team_Apm_Impl`、后端 `associateAECDevice`、WASAPI `EchoDeviceContext`、键 `aec`/`echo_canceling`、UI `echoCancellationCheckBox`+`verticalLayout_AEC` | 前处理 + 后端 |
| 15 | **NS 降噪** | 键 `denoise`/`denoiser_level`、UI `denoisecheckBox`/`denoisehorizontalSlider`、帮助 `Attempt to filter out background noises` | 前处理 |
| 16 | **AGC（采集→播放迁移）** | 键 `agc`、`agc_extra_saturation_margin_db`、采集 UI `agccheckBox`、播放 UI `agcCheckBox`、changelog `- Removed AGC from audio capture settings in favour of playback AGC` | 前处理/播放 DSP |
| 17 | **舒适噪声 CNG** | 类 `Cng@playback`、UI `Comfort noise`/`checkBoxComfortNoise`、changelog `+ Added comfort noise feature` | 播放 DSP |
| 18 | **Ducking 回声抑制** | 键 `echo_reduction`/`echo_reduction_db`、UI `echoReductionCheckBox`/`echoReductionSpinBox`、`Reduce playback volume by:` | 播放侧 |
| 19 | **打字声衰减** | 键 `typing_suppression`、UI `typingsuppressioncheckBox`、帮助 `Typing attenuation tries to detect and reduce the sounds made by typing.` | transient suppressor |
| 20 | **语音音量自动均衡** | UI `Automatic voice volume leveling`；changelog 3.5.0 `+ Added automatic voice volume leveling option in playback settings.` | 播放 DSP |
| 21 | **3D 位置音效** | `Sound3DManager/Widget`、`SoundRender3DInfo`、`3DSoundEnabled`、`3d_test.wav` | 播放混音 |
| 22 | **音量工具箱** | changelog 3.5.0 `+ Added volume toolbox widget for quick access to microphone volume gate, overall and individual client volume levels.` | UI |
| 23 | **静音/禁用** | `SOUND_CAPTURE_MUTED/UNMUTED`、`SOUND_PLAYBACK_MUTED/UNMUTED`、`INPUT_MUTED`、`HARDWARE_INPUT_MUTED`、`CLIENT_FLAG_INPUT_MUTED`、`EnableLocalMute`、`WarnTalkMuted` | 采集/播放 + UI |
| 24 | **状态提示音** | `StatusWhisperDisplay`、`SpeakerMuteButton`、`WarnWhenMutedInfoDialog`、`SPECIAL_TALKING_WHILE_MUTED` | UI |
| 25 | **编解码权限门控** | `b_channel_create_modify_with_codec_{speex8,16,32,celtmono48,opusvoice,opusmusic}`(+`_long`、`i_needed_modify_power_*`)；创建频道对话框 `codecVoiceDesktop/MobileRadioButton`、`codecMusicRadioButton`、`codecCustomRadioButton`、`codecQualitySlider`、`codecQualityDisplayLabel` | 权限 + 频道编辑 UI |

**声音包事件（`sound/default/settings.ini` 实测节选）**
```ini
SPECIAL_TALKING_WHILE_MUTED = say("Talking while muted")   SPECIAL_SOUND_TEST = say("Testing your playback sound system")
SPECIAL_WHISPER_NOTIFY = play("../default/whisper_notify.wav")   SPECIAL_3D_TEST = play("../default/3d_test.wav")
SPECIAL_MIC_CLICK_OTHER_ON/SELF_OFF = play("../default/mic_click_on.wav" / "mic_click_off.wav")
SOUND_CAPTURE_MUTED = say("Microphone muted")   OTHER_WHISPERTARGET_TOO_MANY = say("Too many whisper targets")
```

## 9. 设置项与配置

### 9.1 前处理键（唯一权威表见 §4.2）

共 13 个功能键 + `name`：`aec`、`echo_canceling`、`vad`、`vad_rnn`、`vad_mode`(默认0)、`vad_likelihood`、
`voiceactivation_level`(默认-40)、`vad_extrabuffersize`、`denoise`、`denoiser_level`、`agc`、
`agc_extra_saturation_margin_db`、`typing_suppression`。全部由 `0x1406D7100–0x1406D7932` 的字符串常量表（A）确认，详见 §4.2。

### 9.2 采集/播放 profile 键（B：INI/DB 层）

| 键 | 默认 | 说明 |
|---|---|---|
| `Mode=` | 未确认 | 采集/播放模式（对应 `mode_id`） |
| `Device=` | 未确认 | 设备 ID |
| `DeviceDisplayName=` | 未确认 | 设备显示名 |
| `continous_transmission` | 空(false) | 连续传输（原始拼写） |
| `echo_reduction` / `echo_reduction_db` | 未确认 | Ducking 开关 / 降低量 dB |
| `echo_cancellation` | 未确认 | AEC 开关（UI 层键名） |
| `delay_ptt` / `delay_ptt_msecs` | 未确认 | PTT 释放延迟开关 / 毫秒 |
| `vad_over_ptt` | 空(false) | PTT 下仍启用 VAD |
| `captureDevice` / `playbackDevice` | 未确认 | 设备（错误信息里以此名出现） |
| `3DSoundEnabled` / `PlaySoundSet` / `VolumeFactorWave` | `default`(仅 PlaySoundSet) | 3D 音效 / 声音包名 / 波形音量系数 |
| `VolumeModifier=` | `0` | 音量修正 dB |
| `PlayMicClicksOnOwn=` / `PlayMicClicksOnOthers=` / `PlaybackMonoOverCenterSpeaker=` | 空 | 麦克风点击音 / 单声道走中置 |
| `G35MonoFixApplied2` | 未确认 | G35 单声道修补标记 |
| `LocalAudioSettings` / `PreProcessing` / `Capture/` / `Playback/` / `/PreProcessing` | — | 配置节名 |
| `ts3profile` | — | profile 标识 |

### 9.3 profile 同步层（proto `Config_data`）

字段 `capture_profile`、`playback_profile`（`grep -i 'capture_profile\|playback_profile' c.strings` 实测）。
UI 文案：`Capture Profile:`、`Playback Profile:`、`Select capture profile for this server`、
`Capture profile used for this server`、`Activate/Deactivate Capture Profile`、
`Create channels using OPUS (voice|music) codec`、`Capture Profile "%1" has been deleted.`

### 9.4 频道编解码与权限

| 权限名 `b_channel_create_modify_with_codec_*` | 编解码器 | 比特率 |
|---|---|---|
| `speex8` / `speex16` / `speex32` | Speex NB / WB / UWB | 8 / 16 / 32 kbps（**推断**自命名） |
| `celtmono48` | CELT Mono 48 kHz | 未确认 |
| `opusvoice` / `opusmusic` | Opus Voice / Music | 质量 0–10 → **4.096–45.056 / 7.2–79.2 kbps**（§5.2） |

另有 `TR_CHANNEL_CODEC`/`TR_CHANNEL_CODEC_BITRATE`/`TR_CHANNEL_CODEC_QUALITY`（翻译键）与
`CHANNEL_CODEC`/`CHANNEL_CODEC_BITRATE`/`CHANNEL_CODEC_QUALITY`（属性/事件键）。

### 9.5 命令行参数（B）

`-capture=`/`-playback=`（设备）、`-maxvadlevel=`/`-minvadlevel=`（VAD 电平上下限，调试）、`-hotkeys`（含 PTT 绑定）、
`-localconfig`/`-configname=`/`-homeconfig`（配置位置与名）、`-locksettings`+`settings.lock`（企业锁定，3.5.6）；
其余通用项：`-nosingleinstance`、`-nocpucheck`、`-connect=`、`-channel=`、`-channelid=`、`-channelpw=`、`-nickname=`、`-privilegekey=`、`-showqueryclients`、`-details`、`-infinity`。

### 9.6 持久化文件

`settings.db`（主设置库，SQLite，随包 `sqldrivers/`）、`settings.ini`（兼容/旧版，` reading settings.ini error: `）、
`settings.lock`（企业锁定）、配置节 `[SoundBckndIntf]`（声音后端选择）、`sound/<pack>/settings.ini`（声音包事件→wav）。

## 10. 关键地址速查

| 对象 | VA / RVA |
|---|---|
| 后端加载器（15×GetProcAddress） | `0x1406CB440–0x1406CBC8F` |
| 前处理配置表构造（`PreProcessorConfigValues`+线程名） | `0x1406D7100–0x1406D7932` |
| `updateCaptureProfile`（下发前处理参数/强制 PTT） | `0x1402F95A0–0x1402FA734` |
| 旧版 ini 键/默认值迁移 | `0x1403FEFF0–0x1403FFCC0` |
| `EncodeOPUS` 构造/初始化；vtable | `0x1406D3D10–0x1406D4169`；`0x140D47128` |
| `EncodeOPUS::setQuality`（比特率映射） | `0x1406D4530–0x1406D45F6` |
| `EncodeCELT` 构造/初始化；vtable | `0x1406D2FA0–0x1406D3671`；`0x140D46FB0` |
| `EncodeSpeex` 构造/初始化；vtable | `0x1406D5B20–0x1406D5E6F`；`0x140D47450` |
| `getSampleRate()`=48000 / `getPeriodSizeInSamples()`=960 | `0x1406D3A70` / `0x1406D3A80` |
| Opus `opus_encoder_init` / `opus_encoder_ctl` 调用点 | `0x1406D3F81`(callee `0x14087F230`) / `0x1406D4127`,`0x1406D459B`(callee `0x140883E10`) |
| Opus/CELT 解码器初始化 / 解码数据路径 | `0x140A66D00–0x140A674DC` / `0x140A65260–0x140A665EA` |
| `jitter_buffer_get` 相关 | `0x140A8D65E–0x140A8D801` |
| `speex_preprocess_ctl` | `0x14085EBF0–0x14085F2DC` |
| 播放重采样：`initCallback` / 处理 | `0x1406DD3B0–0x1406DD9DE` / `0x1406DD9E0–0x1406DE85D` |
| DS / WASAPI `getInfo` 块；上下文大小 | `0x18001E038`（名 `0x180017C00`）/ `0x180028038`（名 `0x180020D28`）；`0xA0` / `0x170` |
| Opus 常量 | `SET_BITRATE`=4002(`0xFA2`)、`SET_SIGNAL`=4024(`0xFB8`)、`SIGNAL_VOICE`=3001(`0xBB9`)、`SIGNAL_MUSIC`=3002(`0xBBA`)、`APP_VOIP`=2048(`0x800`)、`APP_AUDIO`=2049(`0x801`) |

## 11. 未确认清单（不得当作结论引用）

| # | 未确认项 | 现有线索 | 需要什么 |
|---|---|---|---|
| 1 | `getInfo` `+0x10` 字段语义（DS=200 / WASAPI=100） | 实测两值固定 | 反编译使用方 / 动态观测缓冲长度 |
| 2 | 设备类型 1/2 与 capture/playback 的对应方向 | 断言只允许 1、2 | 反编译 `enumDevices` 调用点 |
| 3 | Speex 编解码枚举值（是否 0/1/2） | 权限名 + 名称串 | 反编译 `decode.cpp` codec switch |
| 4 | Speex 编码帧长（立即数 `0x1E0`=480 的语义） | `0x1406D551B` | 反编译 Speex 编码调用点 |
| 5 | 语音包密码与模式、`TAG_LENGTH` 字节数 | **已确认**：EAX + TAG=8（见 §11.1） | — |
| 5b | 密钥派生（16B key + 16B nonce 的 SHA-256 KDF） | 仅知加密调用链与 EAX 用法 | 反编译 `Crypto`/`Crypt` 的密钥派生点 |
| 6 | 语音包发送节拍（是否严格 20 ms 一包、一包多帧策略） | 编码周期 20 ms；解码侧支持多帧 | 动态抓包 / 反编译发送调度 |
| 7 | Opus 带内 FEC / 复杂度 / VBR / DTX | **已确认：全部未设置**（仅 3 处 ctl，见 §11.1） | — |
| 8 | `vad_mode` 0/1/2 ↔ Automatic/Volume Gate/Hybrid 对应 | **仍未知**（仅确认 UI 组合框 `comboBoxVadMode` 与标签顺序，见 §11.1） | 反编译 VAD 判定/APM 配置 |
| 9 | `vad_likelihood`、`vad_extrabuffersize`、`denoiser_level`、`agc_extra_saturation_margin_db`、`typing_suppression` 默认值 | 仅知键名与类型 | 反编译 `PreProcessorConfigValues` 填充处 |
| 10 | `m_talkTarget` 枚举全集（除 `WHISPER_GROUP`）；`oldTalkStatus < 25` 语义 | 仅一个值与上界 | 反编译 `setTalkTarget` / 协议文档 |
| 12 | 播放侧 `Agc`/`Cng` 具体算法与参数 | 仅类名 + UI 滑条 | 反编译 `audio::playback::Agc/Cng` |
| 13 | `SoundRender3DInfo` 字段布局 | 仅知结构名与作为混音参数 | 反编译 `speakerchannelinfo.cpp` / 混音回调 |
| 14 | 音乐模式“跳过前处理”的实现分支位置 | changelog 明确行为 | 反编译 `updateCaptureProfile` 的 codec 判断 |
| 15 | Ghidra 反编译细节（本报告全部函数语义） | 首轮导入 330 s 超时 | 提高 `REA_GHIDRA_STARTUP_TIMEOUT_MS` + `REA_GHIDRA_CHECKPOINT_DIR` 后重跑 |

### 11.1 Ghidra 反编译增量确认（检查点建成后补测）

| §11 条目 | 结论 | 证据（`rea decompile` 伪代码 / 字节扫描） |
|---|---|---|
| #7 Opus FEC/复杂度/VBR/DTX | **已确认：全部未设置**。全 exe 仅 3 处 `opus_encoder_ctl`：`SET_SIGNAL(4024)`、`SET_BITRATE(4002)`、`RESET_STATE(4028)`；无 `INBAND_FEC(4012)`/`PACKET_LOSS_PERC(4014)`/`COMPLEXITY(4010)`/`VBR(4006)`/`DTX(4016)` | ctl 调用点仅 `0x6D4127`/`0x6D4249`/`0x6D459B`；字节级 `mov edx,0xfb2` 与 `mov edx,0xfb6` 命中 **0 次** |
| #5 语音包加密 | **已确认：EAX 模式 + `TAG_LENGTH=8`**；包状态 `0=READABLE/2=ENCRYPTED` | `eax_encrypt_authenticate_memory`（`eax_encrypt.c`）；`if (local_2a8[0] != 8) assert "taglen == TAG_LENGTH"` |
| #5b 密钥派生 | **仍未知**（客户端侧未定位 16B key + 16B nonce 的派生点）。新增线索：`common_crypt_functions.cpp` 另有一条 **SHA-1(20B)** 摘要路径（`hash_memory("sha1")`），与服务端 06 的 SHA-256 KDF 结论**不一致**，需两边对齐 | `FUN_14096f7e0`：`local_178[0]=0x14` + 表项 `DAT_140d54d18="sha1"` |
| #8 `vad_mode` 语义 | **仍未知**；新增：UI 为 `comboBoxVadMode`，相邻标签 `"Automatic"`/`"Volume Gate"`（"Hybrid" 仅 changelog），`vad_rnn` 是独立布尔键 | `setupUi`@`0x140384C60` 引用 `comboBoxVadMode`/`label_VadMode`；`.rdata` 相邻串 |
| §5.2 Opus 参数（原推断） | **已确认**：48000 / 声道 1-2 / application 0x800-0x801 / signal 0xBB9-0xBBA | 伪代码表达式逐项吻合（见 §5.2 引文） |

**证据（A：伪代码节选 + 字节扫描）**
```bash
$ rea decompile ts3client_win64.exe ram:0x1406d3d10 --json   # normalized_result
  iVar8 = FUN_14087f230(pvVar6,48000,(iVar8 != 4) + '\x01',(iVar8 != 4) + 0x800);
  FUN_140883e10(pvVar6,0xfb8,(param_3 != 4) + 0xbb9);
$ rea decompile ts3client_win64.exe ram:0x140a628f0 --json
  iVar3 = FUN_140a7ac90(DAT_14109e3e4,param_2,local_2d0,param_3);
  if (local_2a8[0] != 8) { … "Assertion \"taglen == TAG_LENGTH\" failed at …outgoingpacket.cpp:" }  ; *(param_1 + 0x18) = 2;
$ python3 -   # 字节级命中：0xfb2 → 0 次，0xfb6 → 0 次；0xfa2 → 7 次，0xfb8 → 1 次，0xfaa → 2 次（均不在上述 3 个 ctl 调用点）
```

## 12. 结论

> 语音链路 = **后端 DLL（15 个 C 导出 + 0xA0/0x170 B 上下文，`lockDSP/unlockDSP` 为跨调用「设备锁+事件握手」）→ 16-bit/48 kHz 采集
> → WebRTC APM（AEC3+NS+VAD+AGC1/2+瞬态抑制）或 Speex 前处理 → 48 kHz/960 采样（20 ms）编码（Opus Voice 单声道 VOIP
> 4.096–45.056 kbps、Opus Music 立体声 AUDIO 7.2–79.2 kbps、CELT Mono 48 k、Speex 8/16/32 k）→ 受 MTU 约束且带
> `TAG_LENGTH` 认证标签的语音/私语包（私语目标 ≤255）→ Speex jitter buffer → 每客户端 `Sender_Data` 音量/3D →
> `GenericSoundChannelMixer` 混音（+播放 AGC/CNG/单声道扩展）→ 后端输出**；前处理开关收敛为一份
> **`PreProcessorConfigValues` 键表**（13 个功能键 + `name`），是复刻语音功能的最小完备接口面；可确证默认值有
> `voiceactivation_level=-40`、`vad_mode=0`，其余布尔键默认 false（空串）。