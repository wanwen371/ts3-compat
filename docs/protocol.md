# 06 · 语音数据面协议与加密还原（客户端 / 服务端双向取证）

> 本文是 TeamSpeak 3 原生客户端（Windows x64）与 ts3server（Linux x86-64）**数据面（UDP 语音 + 控制）协议的静态还原**。
> 全部结论标注置信度：**[观测]** 直接来自反汇编立即数 / 字符串 / 常量表；**[推断]** 由多条观测交叉得出但缺一个环节；**[未确认]** 明确写出来源缺口。
> 严格纪律：字段宽度只在有反汇编立即数或字符串证据时写出；所有「未确认」项集中列在 §12，并给出可在运行时验证的抓包/插桩方案。

---

## 0. 元信息与取证环境

### 0.1 目标指纹

| 角色 | 路径 | 格式 | 大小 | 备注 |
|---|---|---|---|---|
| 客户端 | `/home/gaozikun/1017/ts3/extracted/ts3client_win64.exe` | PE32+ (pei-x86-64) | 17,911,768 B | ImageBase `0x140000000`，`.text` @ `0x140001000`，`.rdata` @ `0x140b24000` |
| 服务端 | `/home/gaozikun/1017/ts3-server/teamspeak3-server_linux_amd64/ts3server` | ELF64 EXEC x86-64，**已 strip** | 13,701,328 B | `.text` @ `0x40b4d0`（大小 `0x797b22`）、`.rodata` @ `0xba3000`、`.data.rel.ro` @ `0xfae470` |

服务端 sha256（REA provider 观测）：

```
9e37899d3cf2b81e449ba1b23cb78cec98e6ae3116f7bc05422e5160b6d60c5f
```

**证据** — REA/Ghidra 启动失败回执里的 `details.diagnostics.target_sha256` 字段（同时证明我们确实把该文件喂给了分析器）：

```json
"target_path": "/home/gaozikun/1017/ts3-server/teamspeak3-server_linux_amd64/ts3server",
"target_sha256": "9e37899d3cf2b81e449ba1b23cb78cec98e6ae3116f7bc05422e5160b6d60c5f"
```

服务端虽 strip，但残留两类可用符号信息（本文大量依赖）：

1. **`.gnu_debuglink`** → 外部调试文件 `ts3server.dbg`（**未随包分发**）：

```bash
$ readelf -x .gnu_debuglink ts3server
 0x00000000 7433 7365 7276 6572 2e64 6267 0000 0037  ts3server.dbg...7
```

2. **RTTI / 异常表里的 Itanium mangled 类型名**（`.rodata` 字符串），可反推类名与方法签名，例如
   `13PacketLimiter`、`26Pending_Connection_Limiter`、`19OutgoingVoicePacket`、`26OutgoingVoiceWhisperPacket`、
   `18OutgoingINITPacket`、`20OutgoingAckLowPacket`、`24OutgoingCommandLowPacket`、`26OutgoingConfirmationPacket`、
   `23OutgoingResendingPacket`、`19OutgoingQueryPacket`、`18PacketHandler_Base`、`13VoiceStreamer`。

### 0.2 方法（可复现）

本文的地址级结论全部用以下两条流水线得到，读者可逐条复跑：

```bash
# A. 字符串 → 代码引用点 → 所属函数（用 .eh_frame FDE 定界）
readelf -wf ts3server | grep -oE 'pc=[0-9a-f]+\.\.[0-9a-f]+' | sed 's/pc=//' > srv.fdes   # 17939 个函数
objdump -d --no-show-raw-insn ts3server > srv.dis
grep '# bb2176 ' srv.dis          # 断言字符串 VA → lea 站点
# B. 单函数精确定点反汇编（毫秒级，无需 Ghidra）
objdump -d --no-show-raw-insn --start-address=0x49b700 --stop-address=0x49b9ef -j .text ts3server
```

```bash
# C. 常量表解码（数据直接按 VA 读文件）
python3 - <<'PY'
d=open('ts3server','rb').read()
# .rodata: va 0xba3000 <- file 0x7a3000 ；.data.rel.ro: va 0xfae470 <- file 0x9ae470
va2off=lambda va: 0x7a3000+(va-0xba3000) if 0xba3000<=va<0xba3000+0x95268 else 0x9ae470+(va-0xfae470)
print(d[va2off(0xbb2150):va2off(0xbb2150)+18].hex(' '))   # 每类型最大包长表
PY
```

> 说明：本机 Ghidra 12.2 + JDK 25 最终可用，但在 7.8 GB 内存 / 三 agent 并发下，13.7 MB stripped ELF 的首次 `analyzeHeadless` 导入超过了 330 s 启动上限（见 0.3 回执）。因此**本文主体证据来自 objdump + FDE + 常量表解码**，Ghidra 仅作为补充；凡是用到反编译语义的地方都单独标注。

### 0.3 工具限制的如实记录（为什么没有伪代码引用）

```
Ghidra did not finish importing and analyzing the target within its configured 330000 ms
startup deadline (REA_GHIDRA_STARTUP_TIMEOUT_MS) ... Each invocation repeats import from
scratch; --snapshot reuses cached query results, not the analyzed Ghidra Program.
```

结论：在这台机器上「每次调用重新导入」这条路线成本极高。但**字段宽度并不依赖反编译**——它来自指令立即数与数据表，反而更硬。本文第 3/4/5/7 节的宽度结论均属此类。

**后续（同一次任务内）已完成 Ghidra 检查点复用**：改用

```bash
export REA_GHIDRA_CHECKPOINT_DIR=$HOME/.cache/rea/ckpt       # 已分析的 Program 会被保存
export REA_GHIDRA_STARTUP_TIMEOUT_MS=2400000                 # 首次导入给足 40 分钟
rea decompile <ts3server> <addr> --json                       # 之后每次约 14-15 秒
```

实际反编译成功的函数（本文用到的伪代码全部来自这些）：

| 地址 | 身份 | 在本文中的用途 |
|---|---|---|
| `0xa98000` | `parsePacket / sendPacket`（`packethandler_base.cpp`） | PacketID branding 调用链、MTU 分支、KDF 调用点（§3.6/§5.1/§7.6/§8.1） |
| `0x45e220` | `assignPacketID`（`connection.cpp`） | PacketID 的 16 位计数器 + 64 位 epoch（§8.1） |
| `0x49fce0` / `0x49fcf0` | `setPacketID` / `setPacketEpoch` | **PacketID 落盘位置 = `m_Data[8..9]` BE16**（§3.6） |
| `0x460ba0` | 每包 key/nonce KDF（`connection.cpp`） | SHA-256 → `key[16] \|\| nonce[16]`（§7.6） |
| `0x49b3e0` | `IncomingPacket::decrypt` 实现（EAX 封装） | 13 个实参的权威来源（§7.3） |
| `0x49be60` | `IncomingPacket::process` | 头长 13 / payload 起点 13 / flags 在 `+0xc`（§3.1/§3.6） |
| `0xa9e3f0` | `OutgoingResendingPacket` | 分片与 MTU 复用；确认其中**无超时常量**（§8.3/U9） |

> 方法学结论：**先花一次成本建 checkpoint，之后每条伪代码 ~15 秒**；本文前半部分用 objdump 得到的结论，在伪代码里逐条对上了（无一处需要推翻，仅 §5.1 从「推断」升级为「确认」）。

---

## 1. 传输层分工与端口

TeamSpeak 3 把「语音 + 控制」全部塞进**同一条 UDP 连接**（一个 5 元组），把「文件传输」和「ServerQuery」放在独立 TCP 端口上。三条链路在二进制里是三个完全不同的类族。

### 1.1 链路 → 类族映射

```
                    ┌──────────────────────────── UDP (voice port, 默认 9987) ────────────────────────────┐
                    │                                                                                      │
   语音帧  ─────────┤  OutgoingVoicePacket / OutgoingVoiceWhisperPacket   →  VOICE / VOICE_WHISPER         │
   控制帧  ─────────┤  OutgoingCommandPacket / OutgoingCommandLowPacket   →  COMMAND / COMMAND_LOW         │
   握手帧  ─────────┤  OutgoingINITPacket                                 →  INIT1                         │
   保活帧  ─────────┤  OutgoingPingPacket / OutgoingPongPacket            →  PING / PONG                   │
   确认帧  ─────────┤  OutgoingAckPacket / OutgoingAckLowPacket           →  ACK / ACK_LOW                 │
   重发帧  ─────────┤  OutgoingResendingPacket                            →  复用 COMMAND_LOW              │
   确认语义 ────────┤  OutgoingConfirmationPacket                         →  （内部语义，见 §9）           │
                    └──────────────────────────────────────────────────────────────────────────────────────┘
                    ┌──────────────── TCP (filetransfer port, 默认 30033) ─┐   ┌─ TCP 10011 / 10022 / 10080 ─┐
                    │  filetransfer/filetransfer2.cpp、ftkey 鉴权           │   │  ServerQuery 纯文本行协议    │
                    └──────────────────────────────────────────────────────┘   └──────────────────────────────┘
```

**证据** — 客户端 RTTI 完整类名（PE `.data` 里 MSVC 类型描述符 name 字段，`strings` 直接可见）：

```bash
$ strings -a ts3client_win64.exe | grep -oE '\.\?A[VU][A-Za-z0-9_@]+@@' | sort -u | grep -i packet
.?AVOutgoingAckLowPacket@@
.?AVOutgoingAckPacket@@
.?AVOutgoingCommandLowPacket@@
.?AVOutgoingCommandPacket@@
.?AVOutgoingConfirmationPacket@@
.?AVOutgoingINITPacket@@
.?AVOutgoingPacket@@
.?AVOutgoingPingPacket@@
.?AVOutgoingPongPacket@@
.?AVOutgoingResendingPacket@@
.?AVOutgoingVoicePacket@@
.?AVOutgoingVoiceWhisperPacket@@
.?AVPacketHandler@@
```

**证据** — 服务端同类（Itanium RTTI name，长度前缀 + 类名，故形如 `19OutgoingVoicePacket`）：

```bash
$ strings -a ts3server | grep -oE '[0-9]+Outgoing[A-Za-z]+' | sort -u
14OutgoingPacket
17OutgoingAckPacket
18OutgoingINITPacket
18OutgoingPingPacket
18OutgoingPongPacket
19OutgoingQueryPacket
19OutgoingVoicePacket
20OutgoingAckLowPacket
21OutgoingCommandPacket
23OutgoingResendingPacket
24OutgoingCommandLowPacket
26OutgoingConfirmationPacket
26OutgoingVoiceWhisperPacket
```

注意两端差异：服务端多出 `OutgoingQueryPacket`、`PacketHandler_Base`、`VoiceStreamer`、`13PacketLimiter`、`26Pending_Connection_Limiter`；
客户端多出 `PacketHandler`（无 `_Base` 后缀）。这符合「common_lib 共享 + 两端各自派生」的代码结构。

**证据** — 两端共享同一份 `teamspeak_common_lib` 源码树（断言文案里的绝对路径）：

```bash
$ strings -a ts3client_win64.exe | grep -m2 'teamspeak_common_lib..src..packet'
Assertion "getHeaderSize() <= it->m_DataSize" failed at c:\jenkins\workspace\client\clientwindows\deps\teamspeak_common_lib\src\packet\incomingpacket.cpp:
$ strings -a ts3server | grep -m2 'teamspeak_common_lib..src..packet'
Assertion "getHeaderSize() <= it->m_DataSize" failed at ../../../../deps/teamspeak_common_lib/src/packet/incomingpacket.cpp:
```

即：**同一份 `incomingpacket.cpp` 同时编进两端**，因此下文的协议结构对两端一致，差别只在调用侧的派生类。

### 1.2 端口：哪些是文档证据、哪些是代码证据

服务端随包分发 `doc/server_quickstart.md`，里面把默认端口写成**命令行参数默认值**，这是最强的一手证据（发布物自带文档，非第三方资料）：

**证据** — `doc/server_quickstart.md`（节选，原文）：

```
* default_voice_port (*9987*)
  UDP port open for clients to connect to. This port is used by the first virtual server,
  subsequently started virtual servers will open on increasing port numbers.
  Default: The default voice port is 9987.

* filetransfer_port (*30033*)
  TCP Port opened for file transfers.
  Default: The default file transfer port is 30033.

* query_port (*10011*)
  TCP Port opened for ServerQuery connections.
  Default: The default ServerQuery port is 10011.

* query_ssh_port (*10022*)
  TCP Port opened for ServerQuery connections using SSH.
  Default: The default ServerQuery over ssh port is 10022.

* query_http_port (*10080*)
  TCP Port opened for ServerQuery connections using http.
  Default: The default port is 10080.
```

同一文档第 121–129 行给出 ServerQuery 的三种承载：

```
* Raw (telnet) - this is the old default ... Default port 10011
* SSH - this has better terminal handling and is encrypted. Default port 10022
* Web - new to TeamSpeak 3.12.0+, ... over HTTP using JSON. Default port 10080
```

**代码侧交叉验证（部分端口）**：10080 在 `.text` 里有立即数，10011/30033/9987 在服务端二进制里**没有**以立即数形式出现（它们来自配置默认值/数据库，见下表注）。

```bash
$ grep -nE '\$0x2760' srv.dis          # 0x2760 = 10080
4334:  41058f:	mov    $0x2760,%r8d
```

10080 已由代码确认；其余端口仅文档确认（运行时未验证）。

| 端口 | 协议 | 用途 | 证据等级 |
|---|---|---|---|
| 9987/UDP（递增 9998…） | UDP | 语音 + 控制 + 握手（INIT1）/保活/ACK | **文档**（quickstart `default_voice_port`）；反汇编无 `$0x2703` 立即数、二进制无 ASCII `"9987"`（默认值来自命令行参数解析，非编译常量） |
| 30033/TCP | TCP | 文件传输数据面（`ftkey` 鉴权） | **文档 + 随包 SQL 默认值**（`sql/defaults.sql:3`：`serverinstance_filetransfer_port='30033'`）+ ServerQuery 应答字段 `port=30033` |
| 10011/TCP | TCP | ServerQuery raw 文本 | **文档**（quickstart） |
| 10022/TCP | TCP | ServerQuery over SSH | **文档**（quickstart）；服务端另有 `libts3_ssh.so`、`ssh_host_rsa_key` 字符串 |
| 10080/TCP | TCP | ServerQuery over HTTP/JSON（WebQuery） | **文档 + 代码立即数 `0x2760`**（见下） |
| 2010 | UDP | TS3 客户端「服务器查询列表」广播发现 | **未确认**（本次未取证） |

**证据（服务端 10080 默认值的硬证据）** — 配置注册点把 `"query_http_port"`（长度 15）与默认值 `0x2760` 一起传入：

```asm
  410562:	lea    0x79766a(%rip),%rcx        # ba7bd3  ← "query_http_port"
  410571:	movq   $0xf,0x398(%rsp)            ; 名称长度 15 = len("query_http_port")
  410585:	mov    $0x2c,%edx                  ; 44 = len("http_file_transfer_settings_file") 之类的下一项参数
  41058a:	mov    $0x1,%ecx
  41058f:	mov    $0x2760,%r8d                ; ★ 10080（query_http_port 默认值）
  410598:	call   498720
  41059d:	lea    0x79763f(%rip),%rcx        # ba7be3  ← "query_http_ip"
  4105ac:	movq   $0xd,0x388(%rsp)            ; 名称长度 13 = len("query_http_ip")
```

```bash
$ python3 -c "d=open('ts3server','rb').read();o=lambda v:0x7a3000+(v-0xba3000);\
print(d[o(0xba7bd3):o(0xba7bd3)+14], d[o(0xba7be3):o(0xba7be3)+12])"
b'query_http_port' b'query_http_ip'
```

**证据（文件传输端口 30033 的随包 SQL 默认值）**：

```bash
$ sed -n '1,4p' sql/defaults.sql
-- serverinstance properties
insert into instance_properties (server_id, string_id, id, ident, value) values
 ( 0, '', 0, 'serverinstance_filetransfer_port', '30033' ),
```

> 注意：语音端口 9987 **不是**编译期常量，也不是 SQL 默认值——它是「命令行参数 `default_voice_port` 的默认值」，
> 只在 `doc/server_quickstart.md` 里写明；每台虚拟服务器的实际端口存在 `virtualserver_port` 属性里（`serverquerydocs/servercreate.txt` 的 `virtualserver_port=9988` 示例即证）。

**证据** — 文件传输端口来自 ServerQuery 实际应答字段（`ftinitupload` 示例输出）：

```bash
$ sed -n '1,20p' serverquerydocs/ftinitupload.txt
...
Example:
  ftinitupload clientftfid=1 name=\/image.iso cid=5 cpw= size=673460224 overwrite=1 resume=0
  clientftfid=1 serverftfid=6 ftkey=itRNdsIOvcBiBg\/Xj4Ge51ZSrsShHuid port=30033 seekpos=0 proto=0
  error id=0 msg=ok
```

该行同时证明：文件传输**不在语音 UDP 通道内**，而是 ServerQuery 协商出 `ip`/`port`/`ftkey`/`seekpos`/`proto` 后，客户端另开 TCP 连接。

### 1.3 UDP 通道上一个 5 元组承载全部包类型

`packethandler_base.cpp` / `packethandler.cpp` 的断言证明「同一条 UDP socket 上按包类型分发」：

```bash
$ strings -a ts3server | grep -E 'packethandler_base.cpp' 
Assertion "packet->getType() == packetType" failed at .../packethandler_base.cpp:
Assertion "!skipPacketIDBranding || packet->getType()==INIT1 || isResendingPacketType(packetType)" failed at .../packethandler_base.cpp:
Assertion "packet->getPacketSize() <= get_packet_mtu(packet->getPeerAddr().is_v6()) || packet->getType() == VOICE_WHISPER" failed at .../packethandler_base.cpp:
Assertion "!isResendingPacketType(packetType)" failed at .../packethandler_base.cpp:
Assertion "packetType == COMMAND_LOW" failed at .../packethandler_base.cpp:
```

关键信息量：

1. `packet->getType() == packetType` → 分发表按 `PacketType` 索引（不是按端口）。
2. `skipPacketIDBranding` → **存在一个「给包打 PacketID」的后处理步骤**，且 INIT1 与「重发型包」可以跳过（因为它们的 ID 语义不同）。这解释了 §3 里「出站/入站头部长度差 2 字节」的疑点，见 §3.6。
3. `... <= get_packet_mtu(peer.is_v6()) || getType() == VOICE_WHISPER` → **whisper 包被豁免 MTU 上限**（因为它要携带 channel/client 目标列表）。
4. 服务端的 `packethandler_base` 断言站点与函数边界（本文多处引用）：

| 断言 | 字符串 VA | 站点 | 所属函数 |
|---|---|---|---|
| `packetType == COMMAND_LOW` | `0xc1d148` | `0xa979f2` | `0xa969d0–0xa96xxx` |
| `!skipPacketIDBranding \|\| ...INIT1...` | `0xc1cda7` | `0xa98118` | `0xa98000–0xa9....` |
| `packet->getType() == packetType` | `0xc1ce56` | `0xa98309` | `0xa98000` |
| `... <= get_packet_mtu(peer.is_v6()) \|\| VOICE_WHISPER` | `0xc1cf17` | `0xa9874b` | `0xa98000` |
| `!isResendingPacketType(packetType)` | `0xc1d00d` | `0xa989c4` | `0xa98000` |
| `... <= get_packet_mtu(endpoint.address().is_v6())` | `0xc1d0aa` | `0xa99dbd` | `0xa99c80` |

复跑方式：

```bash
python3 - <<'PY'
import re,sys
d=open('/home/gaozikun/1017/ts3-server/teamspeak3-server_linux_amd64/ts3server','rb').read()
for m in re.finditer(rb'Assertion "[^"]*" failed at ([^\x00]*)', d):
    t=d[m.start():m.end()].decode('latin1')
    if 'packethandler' in t: print(hex(0xba3000+(m.start()-0x7a3000)), t)
PY
```

---

## 2. 包类型（PacketType）枚举

### 2.1 服务端存在一张「类型 → 名称」指针表

在 `.data.rel.ro` 里找到**连续 10 个 `const char*`**，指向 `.rodata` 中紧邻的 9 个类型名字符串，第 10 槽为 `NULL`：

**证据** — 直接按 VA 读数据（`.data.rel.ro` 起点 `0xfae470` 对应文件 `0x9ae470`）：

```bash
$ python3 - <<'PY'
import struct
d=open('ts3server','rb').read()
base=0xfaf120                                # 数组起始 VA
def va2off(va):
    return 0x7a3000+(va-0xba3000) if 0xba3000<=va<0xba3000+0x95268 else 0x9ae470+(va-0xfae470)
for i in range(11):
    v=struct.unpack_from('<Q',d,va2off(base)+8*i)[0]
    print(i, hex(v), repr(d[va2off(v):va2off(v)+18]) if v else 'NULL')
PY
0 0xbb24da b'VOICE\x00VOICE_WHISPER'
1 0xbb24e0 b'VOICE_WHISPER\x00COMMAN'
2 0xbb24ee b'COMMAND\x00COMMAND_LOW\x00'
3 0xbb24f6 b'COMMAND_LOW\x00PING\x00PON'
4 0xbb2502 b'PING\x00PONG\x00ACK\x00ACK_LO'
5 0xbb2507 b'PONG\x00ACK\x00ACK_LOW\x00INI'
6 0xbb250c b'ACK\x00ACK_LOW\x00INIT1\x00UN'
7 0xbb2510 b'ACK_LOW\x00INIT1\x00UNKNOW'
8 0xbb2518 b'INIT1\x00UNKNOWN \x00GROUP'
9 0x0 NULL
10 0xbb2527 b'GROUPWHISPERTYPE_SER'
```

字符串在 `.rodata` 中物理相邻（一次 hexdump 就能看到全序列）：

```bash
$ python3 -c "d=open('ts3server','rb').read();i=d.find(b'VOICE_WHISPER');print(d[i-6:i+80])"
b'cpp:\x00VOICE\x00VOICE_WHISPER\x00COMMAND\x00COMMAND_LOW\x00PING\x00PONG\x00ACK\x00ACK_LOW\x00INIT1\x00UNKNOWN \x00GROUPWHISP'
```

由此得到**唯一的类型名称序列**（顺序即数组下标顺序）：

| 下标 | 名称 | 数组槽 VA |
|---|---|---|
| 0 | `VOICE` | `0xfaf120` |
| 1 | `VOICE_WHISPER` | `0xfaf128` |
| 2 | `COMMAND` | `0xfaf130` |
| 3 | `COMMAND_LOW` | `0xfaf138` |
| 4 | `PING` | `0xfaf140` |
| 5 | `PONG` | `0xfaf148` |
| 6 | `ACK` | `0xfaf150` |
| 7 | `ACK_LOW` | `0xfaf158` |
| 8 | `INIT1` | `0xfaf160` |
| 9 | `NULL`（终止/哨兵） | `0xfaf168` |

紧随其后的 5 个 `NULL`/指针是**另一张表**（`GROUPWHISPERTYPE_*` / `GROUPWHISPERTARGETMODE_*` 群组耳语目标枚举名称），与数据面包类型无关，但可作为「表边界」的旁证：

```bash
$ strings -a ts3server | grep -m12 GROUPWHISPER
GROUPWHISPERTYPE_SERVERGROUP
GROUPWHISPERTYPE_CHANNELGROUP
GROUPWHISPERTYPE_CHANNELCOMMANDER
GROUPWHISPERTYPE_ALLCLIENTS
GROUPWHISPERTYPE_UNKNOWN
GROUPWHISPERTARGETMODE_ALL
GROUPWHISPERTARGETMODE_CURRENTCHANNEL
GROUPWHISPERTARGETMODE_PARENTCHANNEL
GROUPWHISPERTARGETMODE_ALLPARENTCHANNELS
GROUPWHISPERTARGETMODE_CHANNELFAMILY
GROUPWHISPERTARGETMODE_ANCESTORCHANNELFAMILY
GROUPWHISPERTARGETMODE_SUBCHANNELS
```

> 这张 `GROUPWHISPERTYPE_*` 表本身就是 §4 的重要旁证：**whisper 包的目标选择模型确实是「组类型 × 目标模式」二维枚举**，而不是简单的 channel/client 列表。

### 2.2 类型数值：9 个类型，下标 0..8

两处独立证据指向「类型是 0..8 的小整数，且按 §2.1 的顺序编号」：

**证据 A** — `IncomingPacket::process` 里对类型做桶索引前先做 `> 12` 拒绝（服务端 `0x49c137`）：

```asm
  49c130:	mov    0x10(%r14),%rax
  49c134:	mov    0x10(%rax),%eax
  49c137:	cmp    $0xc,%eax          ; 类型/桶序号上限 12
  49c13a:	ja     49c30d             ; 越界即跳走（丢弃）
```

**证据 B** — `0x49b240` 的**按类型分派跳转表**共 **9 个 32 位相对项**（索引 0..8），越界（`flags&0xf > 8`）直接判无效：

```bash
$ python3 - <<'PY'
import struct
d=open('ts3server','rb').read()
va2off=lambda va: 0x7a3000+(va-0xba3000)
base=0xbb2110
for i in range(9):
    v=struct.unpack_from('<i',d,va2off(base)+4*i)[0]
    print('case',i,'->',hex(base+v))
PY
case 0 -> 0x49b2a2
case 1 -> 0x49b2aa
case 2 -> 0x49b297
case 3 -> 0x49b297
case 4 -> 0x49b2b2
case 5 -> 0x49b28f
case 6 -> 0x49b28f
case 7 -> 0x49b28f
case 8 -> 0x49b2ba
```

对应汇编：

```asm
  49b270:	mov    %ecx,%edx
  49b272:	and    $0xf,%dl           ; 取低 4 位
  49b275:	cmp    $0x8,%dl
  49b278:	ja     49b29f             ; >8 → return false
  49b27a:	mov    %ecx,%edx
  49b27c:	and    $0xf,%edx
  49b27f:	lea    0x716e8a(%rip),%rsi        # bb2110   ← 跳转表
  49b286:	movslq (%rsi,%rdx,4),%rdx
  49b28a:	add    %rsi,%rdx
  49b28d:	jmp    *%rdx
```

9 个 case 与 §2.1 的 9 个名称一一对应，且 case 2/3 共用同一实现（`COMMAND` 与 `COMMAND_LOW` 的合法性判据相同）、case 5/6/7 共用（`PONG`/`ACK`/`ACK_LOW` 同族）、case 0/1 共用（`VOICE`/`VOICE_WHISPER` 同族）、case 8 独占（`INIT1`）——这与类型语义完全自洽。

**结论（[观测] + [推断]）**

| 值 | 类型 | 置信度 |
|---|---|---|
| 0 | `VOICE` | [观测] 名称表下标 |
| 1 | `VOICE_WHISPER` | [观测] 名称表下标 |
| 2 | `COMMAND` | [观测] 名称表下标 |
| 3 | `COMMAND_LOW` | [观测] 名称表下标 |
| 4 | `PING` | [观测] 名称表下标 |
| 5 | `PONG` | [观测] 名称表下标 |
| 6 | `ACK` | [观测] 名称表下标 |
| 7 | `ACK_LOW` | [观测] 名称表下标 |
| 8 | `INIT1` | [观测] 名称表下标 + `TS3INIT1` 魔数专属校验 |
| 9 | `UNKNOWN`（仅字符串，非枚举成员） | [推断] 名称表末尾 `"UNKNOWN "` 用于越界/未知打印 |

「下标 = 枚举值」这一步是 [推断]：名称表按值索引是 C++ 里最常见的实现，但**没有抓到** `getName()` 体内 `mov (%rax,%rdi,8)` 形式的可见证据（该函数未被定位）。**待验证**：在运行时 `#define` 里把每个类型的字符串打印出来，或用下文 §13 的抓包法按首字节高/低半字节分类统计。

### 2.3 客户端同名类型（交叉验证）

客户端 RTTI 里每个 `Outgoing*Packet` 都能与服务端名称表对上，且客户端**没有**额外的包类型：

| 名称表项 | 客户端类 | 服务端类 |
|---|---|---|
| `VOICE` | `OutgoingVoicePacket` | `19OutgoingVoicePacket` |
| `VOICE_WHISPER` | `OutgoingVoiceWhisperPacket` | `26OutgoingVoiceWhisperPacket` |
| `COMMAND` | `OutgoingCommandPacket` | `21OutgoingCommandPacket` |
| `COMMAND_LOW` | `OutgoingCommandLowPacket` | `24OutgoingCommandLowPacket` |
| `PING` | `OutgoingPingPacket` | `18OutgoingPingPacket` |
| `PONG` | `OutgoingPongPacket` | `18OutgoingPongPacket` |
| `ACK` | `OutgoingAckPacket` | `17OutgoingAckPacket` |
| `ACK_LOW` | `OutgoingAckLowPacket` | `20OutgoingAckLowPacket` |
| `INIT1` | `OutgoingINITPacket` | `18OutgoingINITPacket` |
| （无独立类型） | `OutgoingResendingPacket` | `23OutgoingResendingPacket` |
| （无独立类型） | `OutgoingConfirmationPacket` | `26OutgoingConfirmationPacket` |
| （仅服务端） | — | `19OutgoingQueryPacket` |

`OutgoingResendingPacket` 与 `OutgoingConfirmationPacket` **没有独立类型名**，但断言里能看出它们复用别种类型：

```bash
$ strings -a ts3server | grep -E 'outgoingresendingpacket.cpp'
Assertion "needsSplitting(is_ipv6)" failed at .../packet/outgoingresendingpacket.cpp:
Assertion "getType() == COMMAND_LOW" failed at .../packet/outgoingresendingpacket.cpp:
Assertion "packet->getPacketSize() <= get_packet_mtu(is_ipv6)" failed at .../packet/outgoingresendingpacket.cpp:
Assertion "!hasFragmentFlag()" failed at .../packet/outgoingresendingpacket.cpp:
Assertion "original.getPacketSize() == getPacketSize()" failed at .../packet/outgoingresendingpacket.cpp:
```

→ **`RESENDING` 不是一种线缆类型，而是 `COMMAND_LOW` 的重发包装**（`getType() == COMMAND_LOW`）。这是 §9 的关键前提，也修正了任务书里「RESENDING 包类型」的假设。

---

## 3. 包头结构（核心结论）

### 3.1 加密包头部长度 = 13 字节（[观测]）

三处独立证据：

**证据 A** — `IncomingPacket` 构造/拷贝时，若数据长度不足 13 则强推到 13：

```asm
; 0x4a0c80 起（IncomingPacket 派生类的拷贝构造）
  4a0ceb:	mov    0x10(%rbx),%r14d      ; r14d = m_DataSize（源）
  4a0cef:	cmp    $0xc,%r14d
  4a0cf3:	ja     4a0d02
  4a0cf5:	movl   $0xd,0x10(%rbx)       ; 不足则 m_DataSize = 0xd = 13
  4a0cfc:	mov    $0xd,%r14d
  4a0d02:	movw   $0x0,0xac(%rbx)
  4a0d0b:	mov    %r14d,%r13d
  4a0d0e:	mov    %r13,%rdi
  4a0d11:	call   a5ae60 <_Znam@@Base>  ; operator new[](13)
  4a0d16:	lea    0x28(%rbx),%rcx
  4a0d1a:	mov    %rax,0x8(%rbx)        ; this->8 = m_Data
  4a0d1e:	movw   $0x0,0x8(%rax)        ; m_Data[8..9] = 0
  4a0d24:	movb   $0x0,0xa(%rax)        ; m_Data[10]   = 0
```

**证据 B** — 合法性检查先要求 `m_DataSize >= 13`（函数 `0x49b240`）：

```asm
  49b240:	mov    0x10(%rdi),%eax       ; eax = m_DataSize
  49b243:	cmp    $0xd,%eax             ; 13
  49b246:	jae    49b24b                ; size >= 13 才继续
  49b248:	xor    %eax,%eax              ; 否则 return false
  49b24a:	ret
```

**证据 C** — 解密调用直接把「13 字节之后」当密文，且 `inlen = m_DataSize - 13`：

```asm
; 0x49b3e0 起（IncomingPacket 解密实现）
  49b40e:	mov    0x8(%rbx),%rax         ; rax = m_Data
  49b412:	lea    0x8(%rax),%r9          ; r9  = m_Data + 8   （EAX 的 hdr/AD 指针）
  49b416:	mov    0x10(%rbx),%ebx        ; ebx = m_DataSize
  49b419:	add    $0xfffffff3,%ebx        ; ebx = size - 13
  ...
  49b437:	push   $0x8                 ; taglen = 8
  49b43a:	lea    0xd(%rax),%rax         ; rax = m_Data + 13
  49b43e:	push   %rax                 ; ct   = m_Data + 13
  49b43f:	push   %rbx                 ; ctlen= size - 13
  49b440:	push   %rax                 ; pt   = m_Data + 13（原地）
  49b441:	push   $0x5                 ; hdrlen = 5
  49b443:	call   749a00                ; eax_decrypt_verify_memory 包装
```

### 3.2 头部三段式布局（[观测]，字段语义部分 [未确认]）

把上面三处拼起来，**加密 UDP 包（入站形态）** 为：

```
 字节偏移  长度  内容（本文给到的证据）
 ──────── ───── ─────────────────────────────────────────────────────────────────────────
  +0      8     EAX 认证标签（tag）。taglen = 8 由 decrypt 的 push $0x8 与 encrypt 的
                TAG_LENGTH 检查共同确认（见 §7.4）。既参与认证也不加密。
  +8      5     EAX 关联数据（hdr/AD），decrypt 传 hdr = m_Data+8, hdrlen = 5。
                其中 +8..+9 是一对 16 位字段、+10 是「类型/flags 字节」（见 §3.3 证据）。
  +13     变长   EAX 密文（payload），长度 = m_DataSize - 13。
 ──────── ───── ─────────────────────────────────────────────────────────────────────────
```

**出站（明文）形态** 与之差 2 字节：

**证据** — `OutgoingPacket::buildPacket`（`0x49fd30–0x4a0844`）的加密调用：

```asm
; 0x49fd4c 入口参数：rdi=this, rsi=arg2(ptr), rdx=arg3(ptr), ecx=arg4(bool)
  49fd41:	mov    %ecx,%ebp              ; arg4 存入 ebp（后续 test %bpl 使用，语义应是 is_ipv6）
  49fd49:	mov    %rdi,%r15
  49fd4c:	cmpl   $0x0,0x20(%rdi)        ; m_State == READABLE(0) 检查（见 §3.5）
  ...
  4a0190:	mov    0xe7153a(%rip),%edi    # 13116d0 ← crypt_find_cipher("rijndael") 结果（cipher 描述符 id）
  4a0196:	lea    0x8(%rax),%r9          ; rax=m_Data → r9 = m_Data+8（hdr/AD）
  4a019a:	mov    0x10(%r15),%ebp        ; m_DataSize
  4a019e:	add    $0xfffffff5,%ebp        ; ebp = size - 11
  4a01a1:	lea    0x180(%rsp),%r10       ; &taglen（已预置 8）
  4a01a9:	mov    $0x10,%edx              ; keylen  = 16
  4a01ae:	mov    $0x10,%r8d              ; noncelen= 16
  4a01b4:	mov    %rbx,%rsi              ; key
  4a01b7:	mov    %r14,%rcx              ; nonce
  4a01ba:	push   %r10                    ; &taglen
  4a01bc:	push   %rax                    ; tag   = m_Data + 0
  4a01bd:	lea    0xb(%rax),%rax         ; rax = m_Data + 11
  4a01c1:	push   %rax                    ; ct    = m_Data + 11（原地）
  4a01c2:	push   %rbp                    ; ptlen = size - 11
  4a01c3:	push   %rax                    ; pt    = m_Data + 11
  4a01c4:	push   $0x3                    ; hdrlen = 3
  4a01c6:	call   749db0                 ; eax_encrypt_authenticate_memory 包装
```

因此**出站明文包**：

```
  +0      8     tag 占位（加密后写回 8 字节 EAX 标签）
  +8      3     待认证头（hdr），hdrlen = 3  → 覆盖 +8,+9,+10
  +11     变长  明文 payload（加密后原地变密文），长度 = m_DataSize - 11
```

也就是说：**线缆上（入站视角）头 = 8 字节标签 + 5 字节认证头 = 13 字节；发送侧构造时只认 3 字节认证头 + 11 字节总头**。
二者相差的 2 字节，与服务端断言里的 `skipPacketIDBranding`（§1.3）高度相关，但本文**未能定位到具体补写代码**，故 §3.6 明确列为未确认。

### 3.3 「类型 / flags」字节

**证据 A（出站写侧）** — 语音包构造函数里对 `m_Data[10]` 做按位或：

```asm
; 0xaa0ba0 起（OutgoingVoicePacket 语音数据装载）
  aa0bfe:	rol    $0x8,%bx                    ; 16 位大端转换（见 §4.1）
  aa0c02:	mov    0x8(%r13),%rbp              ; rbp = m_Data
  aa0c0d:	mov    %bx,0x0(%rbp,%rax,1)        ; m_Data[off .. off+1] = be16(arg6)
  aa0c1d:	mov    %r15b,0x4(%rbx,%rax,1)      ; m_Data[off+4] = (uint8)arg3
  aa0c22:	cmp    $0xff,%r14b
  aa0c26:	je     aa0c3f
  aa0c28:	mov    0x8(%r13),%rax
  aa0c2c:	orb    $0x40,0xa(%rax)             ; ★ m_Data[10] |= 0x40
  aa0c34:	mov    0x10(%r13),%ecx
  aa0c38:	add    $0xffffffff,%ecx              ; ecx = m_DataSize - 1
  aa0c3b:	mov    %r14b,(%rax,%rcx,1)           ; m_Data[size-1] = (uint8)arg7
  ...
  aa0c5f:	mov    0x8(%r13),%rax
  aa0c63:	orb    $0x10,0xa(%rax)             ; ★ m_Data[10] |= 0x10
```

**证据 B（出站写侧，INIT1 常量）** — 三个相邻函数对 `m_Data[10]` 直接写常量 `0x88`：

```bash
$ grep -nE 'movb +\$0x88,0xa\(' srv.dis
139306:  4a0ec1:	movb   $0x88,0xa(%r14)
139401:  4a1048:	movb   $0x88,0xa(%r12)
139483:  4a119f:	movb   $0x88,0xa(%rax)
```

`0x88 = 1000_1000b`。若「低半字节 = 类型」则 `0x8 = INIT1` ✓（与 §2.2 一致），高半字节 `0x8` 是 flags 位组合。

**证据 C（入站读侧）** — 合法性函数从 **`m_Data[12]`** 取低 4 位作为类型索引，并用另一张 `uint16[16]` 做「最大长度」闸门：

```asm
  49b252:	movzbl 0xc(%r8),%ecx        ; ecx = m_Data[12]      ← 注意：+12，不是 +10
  49b259:	mov    %ecx,%esi
  49b25b:	and    $0xf,%esi             ; esi = m_Data[12] & 0xf
  49b25e:	lea    0x716eeb(%rip),%rdi   # bb2150 ← uint16[16] 最大长度表
  49b265:	movzwl (%rdi,%rsi,2),%esi
  49b269:	cmp    %esi,%eax             ; 与 m_DataSize 比较
  49b26b:	jbe    49b270               ; size <= limit → 继续
  49b26d:	xor    %eax,%eax
  49b26f:	ret                         ; 否则 false
```

### 3.4 每类型最大包长表（uint16[9]，[观测]）

紧邻跳转表之后是 `uint16[16]`，前 9 项与类型语义**完全吻合**，后 7 项是相邻字符串字节（即表长只有 9）：

```bash
$ python3 - <<'PY'
import struct
d=open('ts3server','rb').read()
o=0x7a3000+(0xbb2150-0xba3000)
print([struct.unpack_from('<H',d,o+2*i)[0] for i in range(16)])
PY
[500, 9000, 1108, 1108, 50, 50, 50, 50, 1108, 25938, 25955, 30313, 25701, 17696, 29298, 29295]
```

| 下标 | 类型 | 表值 | 语义解释 | 交叉证据 |
|---|---|---|---|---|
| 0 | `VOICE` | **500** | 语音包上限，等于 IPv4 MTU 常量 `0x1f4` | §5.1 |
| 1 | `VOICE_WHISPER` | **9000** | whisper 被 MTU 豁免 → 用大上限 | 断言 `... \|\| getType()==VOICE_WHISPER` |
| 2 | `COMMAND` | **1108** | 控制包上限，等于另一 MTU 常量 `0x454` | §5.1 |
| 3 | `COMMAND_LOW` | **1108** | 同上 | — |
| 4 | `PING` | **50** | 保活包极小 | — |
| 5 | `PONG` | **50** | 同上 | — |
| 6 | `ACK` | **50** | 确认包极小 | — |
| 7 | `ACK_LOW` | **50** | 同上 | — |
| 8 | `INIT1` | **1108** | 握手包上限 | — |

`25938/25955/30313/...` 是 `.rodata` 中后续字符串（`"Received Error (1) "` 等）被误当作表项，恰好说明**表真实长度 = 9**。

### 3.5 合法性函数的完整判据（逐类型，[观测]）

`0x49b240` 的 9 个 case 各有不同的最小/最大尺寸判据，常量全部为立即数：

```asm
; case 0 (VOICE) / case 1 (VOICE_WHISPER)：要求 size >= 16
  49b2a2:	cmp    $0x10,%eax
  49b2a5:	jae    49b2d2             ; → return true
  49b2a7:	xor    %eax,%eax
  49b2a9:	ret

; case 2 / 3 (COMMAND, COMMAND_LOW)：size == 13 直接无效；否则看 (size-13)<=8 且 bit6
  49b297:	cmp    $0xd,%eax
  49b29a:	jne    49b2c2
  49b29c:	xor    %eax,%eax
  49b29e:	ret
  49b2c2:	add    $0xfffffff3,%eax     ; size - 13
  49b2c5:	cmp    $0x8,%eax
  49b2c8:	ja     49b2d2
  49b2ca:	and    $0x40,%cl            ; cl = m_Data[12]；测 bit6
  49b2cd:	je     49b2d2
  49b2cf:	xor    %eax,%eax
  49b2d1:	ret

; case 4 (PING)：size <= 15
  49b2b2:	cmp    $0xf,%eax
  49b2b5:	jbe    49b2d2
  49b2b7:	xor    %eax,%eax
  49b2b9:	ret

; case 5/6/7 (PONG/ACK/ACK_LOW)：size == 15
  49b28f:	cmp    $0xf,%eax
  49b292:	je     49b2d2
  49b294:	xor    %eax,%eax
  49b296:	ret

; case 8 (INIT1)：size >= 14，且前 8 字节 == "TS3INIT1"
  49b2ba:	cmp    $0xe,%eax
  49b2bd:	jae    49b2d5
  49b2bf:	xor    %eax,%eax
  49b2c1:	ret
  49b2d5:	mov    (%r8),%rcx
  49b2d8:	cmp    0xb3dec1(%rip),%rcx   # fd91a0 ← 常量 "TS3INIT1"
  49b2df:	je     49b2e4
  49b2e1:	xor    %eax,%eax
  49b2e3:	ret
  ...
  49b2e4:	mov    0x11(%r8),%cl         ; m_Data[17]
  49b2e8:	mov    %ecx,%edx
  49b2ea:	cmp    $0x7f,%cl
  49b2ed:	jne    49b309
```

由 case 4/5/6/7 可推出**保活/确认类包的最小尺寸就是 15 字节**；由 case 0/1 推出**语音类包最小 16 字节**（= 11 字节头 + 至少 5 字节语音数据？见 §4）；由 case 8 推出 INIT1 最小 14 字节。
> 这些「最小尺寸」是**判据**而非字段宽度，请勿混用。

### 3.6 出站/入站头部差 2 字节（现象已确认，机制仍未知）

| 观测 | 出站（`OutgoingPacket::buildPacket`） | 入站（`IncomingPacket` 解密 → `process`） |
|---|---|---|
| tag 起点 | `m_Data+0` | `m_Data+0` |
| PacketID 位置 | **`m_Data[8..9]`，大端 16 位** | 同（`+8..+9`） |
| hdr/AD 起点 | `m_Data+8` | `m_Data+8` |
| **hdr/AD 长度** | **3**（`push $0x3`） | **5**（`push $0x5`） |
| 类型/flags 字节 | 写 `m_Data[10]`（`orb $0x40` / `orb $0x10` / `movb $0x88`） | 读 `m_Data[12]`（`(*(byte*)(hdr+0xc) & 0x40)`） |
| payload 起点 | `m_Data+11` | `m_Data+13` |
| payload 长度 | `m_DataSize-11` | `m_DataSize-13` |
| 最小长度判据 | — | `if (size < 0xd) reject`（`IncomingPacket::process` 伪代码） |

**新增硬证据：PacketID 的写入位置与宽度（Ghidra 伪代码，`0x49fce0` / `0x49fcf0`）**

```c
/* OutgoingPacket::setPacketID(uint16) —— 0x49fce0 */
void FUN_0049fce0(long pkt, ushort v) {
  *(ushort *)(*(long *)(pkt + 8) + 8) = (v << 8) | (v >> 8);   /* ★ m_Data[8..9] = BE16(v) */
}
/* OutgoingPacket::setPacketEpoch(uint64) —— 0x49fcf0 */
void FUN_0049fcf0(long pkt, undefined8 v) {
  *(undefined8 *)(pkt + 0x18) = v;                             /* 存对象字段，不上线缆 */
}
```

调用点（`packethandler_base` 发送路径，`0xa98000` 伪代码）：

```c
if (param_7 != '\0') {                        /* param_7 = 是否执行 PacketID branding */
  uVar11 = FUN_0045e220(lVar19, uVar16);      /* assignPacketID(type) → 16B 结构 */
  if ((char)uVar11 == 0) { ... "Declaring client ... dead because we could not assign a packet ID." ... }
  FUN_0049fce0(param_4, uVar11 >> 0x10);      /* ★ 低 16 位 = PacketID → m_Data[8..9] */
  FUN_0049fcf0(param_4, extraout_RDX);        /* 64 位 epoch → 对象 +0x18 */
}
```

**因此可以确定**：
1. **PacketID 是 16 位、大端，位于 `m_Data[8..9]`**；两侧偏移一致（不是「插在 +11」）。
2. 与它一起分配的还有一个 64 位「epoch/代号」，只存于对象（`pkt+0x18`），用于区分 ID 回绕后的包（防重放）。
3. **出站构建期头部 11 字节**（`[0..7] tag`、`[8..9] pid`、`[10] type/flags`、payload 从 11 起）。
4. **入站解析期头部 13 字节**（`[0..7] tag`、`[8..9] pid`、`[10..11] ?`、`[12] type/flags`、payload 从 13 起）。

**仍未知**：第 4 条的 `[10..11]` 两字节在出站形态里并不存在（出站 +10 就是 type 字节）。也就是说
**同一个逻辑包头在发送侧是 11 字节、在接收侧按 13 字节解析**，而 `pid` 的位置两边都是 `+8..+9`。
两种可能都未被证实：

* (a) 两个方向的线缆格式本就不同（服务端发的是 11 字节头、客户端发的是 13 字节头）——但 `buildPacket`/`process` 都是 common_lib 的双向代码，不合理；
* (b) 存在一个「发送前把 2 字节插到 +10/+11 并整体后移」的步骤，而我们读到的 `buildPacket` 是该步骤**之前**的中间形态（`skipPacketIDBranding` 与 `(conn+0x400 != 2)` 的版本分支可能是开关）。

**最小验证**：在 `0x49fce0`（setPacketID）之后、`0x4a01c6`（EAX 加密调用）之前各 dump 一次 `m_Data[0..16]` 与 `m_DataSize`；
若两次之间 `m_DataSize` 增加 2 且 payload 整体后移 → 结论 (b) 成立。这一点**未做**，故本节保留「未知」。

### 3.7 其它与头长相关的常量（备查）

| 常量 | 出现位置 | 用途（[推断]） |
|---|---|---|
| `0xd` = 13 | `0x49b243`、`0x4a0cf5`、`0x49b419` | 加密包完整头长 |
| `0xb` = 11 | `0x4a019e`、`0x4a01bd` | 出站明文头长 |
| `0x3` / `0x5` | `0x4a01c4` / `0x49b441` | EAX 关联数据长度（出站/入站） |
| `0x8` = 8 | `0x49b437`、`0x49ff67`、`0x4a0372` | EAX 标签长度 `TAG_LENGTH` |
| `0x10` = 16 | `0x49b2a2`、`0x49b2a5` | 语音类包最小长度判据 |
| `0xf` = 15 | `0x49b2b2`、`0x49b28f` | 保活/确认类包长度判据 |
| `0xe` = 14 | `0x49b2ba` | INIT1 最小长度判据 |

---

## 4. 语音包（VOICE / VOICE_WHISPER）专门结构

语音包构造函数是 `0xaa0ba0`（FDE 边界 `0xaa0ba0–0xaa1006`，1126 B），其断言把源码位置钉死在 `packet/outgoingvoicepacket.cpp:120`；
whisper 目标列表在 `0xaa2480`（`0xaa2480–0xaa2b59`）。断言→站点映射：

| 断言 | 站点 | 行号立即数 |
|---|---|---|
| `numberVoicePackets < 256` | `0xaa0e1d` | `0x78` = 120 |
| `count <= 255 && count == channelListSize` | `0xaa2614` | — |
| `count <= 255 && count == clientListSize` | `0xaa28ed` | — |

### 4.1 序列号字段：16 位**大端**（[观测]）

```asm
  aa0bfe:	rol    $0x8,%bx              ; ★ 16 位字节序翻转 → 大端
  aa0c02:	mov    0x8(%r13),%rbp
  aa0c0d:	mov    %bx,0x0(%rbp,%rax,1)  ; 写入 m_Data[base .. base+1]
```

`rol $0x8` 对 16 位寄存器是标准的 `htons` 等价实现（这里是手写 byte-swap）。**因此语音包里至少有一个 16 位大端字段**。
它由 `arg6` 传入（入口 `mov %r9d,%ebx`），结合语音包语义最可能是 **voice sequence number / packet counter**。
基数 `base`：由 `mov 0x8(%rsp),%eax` 与 `mov %eax,0xb0(%r13)` 一起看，是本次写头的偏移参数（即 §3 的 `headerSize` 一类）。

### 4.2 每包语音帧数上限：`numberVoicePackets < 256`（[观测]）

```asm
  aa0d4d:	cmpl   $0x100,0x8(%rsp)      ; numberVoicePackets < 0x100
  aa0d55:	jb     aa0f1a               ; 小于则跳过断言
  ...
  aa0e1d:	lea    0x17caca(%rip),%rsi  # c1d8ee  ← "Assertion \"numberVoicePackets < 256\"..."
  aa0e24:	mov    $0x78,%edx            ; 行号 120
```

即**一个 UDP 语音包里最多打包 256 个编码帧**（实际远小于此，见 §4.5 的 31 上限）。
解码侧对应断言（`sound/decode.cpp`）：

```bash
$ strings -a ts3server | grep 'decode.cpp'
Assertion "numberVoicePackets > 0 && voiceDataSize % numberVoicePackets == 0" failed at .../sound/decode.cpp:
Assertion "status == 2" failed at .../sound/decode.cpp:
Assertion "channels == 1 || channels ==2" failed at .../sound/decode.cpp:
Assertion "m_Channels==1 || codec == CODEC_OPUS_MUSIC" failed at .../sound/decode.cpp:
Assertion "m_PeriodSizeInSamples == var" failed at .../sound/decode.cpp:
Assertion "m_SampleRate == 8000" failed at .../sound/decode.cpp:
Assertion "channels == 2" failed at .../sound/decode.cpp:
```

其中 `voiceDataSize % numberVoicePackets == 0` 说明语音 payload 是「等长帧的整数倍」——这是固定帧长语音编码（Opus/CELT 20 ms 帧）的直接体现。

### 4.3 编解码标识

客户端里能读到三个 `CODEC_*` 枚举字面量（服务端只有 `CODEC_OPUS_MUSIC`，其余被优化掉）：

```bash
$ strings -a ts3client_win64.exe | grep -oE 'CODEC_[A-Z_0-9]+' | sort | uniq -c
      2 CODEC_BITRATE
      1 CODEC_CELT_MONO
      2 CODEC_OPUS_MUSIC
      1 CODEC_OPUS_VOICE
      2 CODEC_QUALITY
$ strings -a ts3server | grep -oE 'CODEC_[A-Z_0-9]+' | sort | uniq -c
      1 CODEC_OPUS_MUSIC
```

服务端另有编码器/权限侧的强证据（同一套编码器家族 + 加密开关）：

```bash
$ strings -a ts3server | grep -E 'codec_(encryption_mode|quality|is_unencrypted|latency_factor)'
virtualserver_codec_encryption_mode
channel_codec_quality
channel_codec_latency_factor
channel_codec_is_unencrypted
```

**结论**：语音包内确实存在**编解码标识**（`CELT_MONO` / `OPUS_VOICE` / `OPUS_MUSIC` 三种可区分取值 → 至少 2 bit），
但它所在的**bit 位置未确认**。理由：语音包构造函数里对 `m_Data[10]` 的两个掩码是 `0x40` 与 `0x10`（§3.3 证据 A），
而 codec 字段没有在已读出的指令片段里出现为立即数；按 TS3 惯例它应在 `m_Data[off+4]` 那个 `mov %r15b,0x4(%rbx,%rax,1)`（`arg3` 是 codec/参数打包字节）里，但**未取得位域切分证据**。

### 4.4 whisper 的 channel/client 目标列表

`0xaa2480` 里两条断言把「两张列表各自最多 255 项」写死：

```asm
; （站点 0xaa2614）
  ...    cmpb/lea ...              ; 断言 "count <= 255 && count == channelListSize"
; （站点 0xaa28ed）
  ...    cmpb/lea ...              ; 断言 "count <= 255 && count == clientListSize"
```

`count <= 255` 的 255 与 §4.2 的 256 上限相互印证：**列表项数用 8 位编码**（长度前缀 1 字节，值域 0..255）。
配合 §2.1 的 `GROUPWHISPERTYPE_*` / `GROUPWHISPERTARGETMODE_*` 枚举字符串，whisper 目标模型为：

```
VOICE_WHISPER payload
  ├─ channel 目标列表：count(≤255) + 每项 channel id
  ├─ client  目标列表：count(≤255) + 每项 client id
  └─ 群组耳语：GROUPWHISPERTYPE_*（5 种） × GROUPWHISPERTARGETMODE_*（8 种）
```

> 每项 id 的宽度（16/32 bit）**未确认**；`m_PacketID` 容器「每元素 16 字节」（§9.1）提示可能存在 16 字节的对齐结构体，但这属于另一容器。

### 4.5 语音包的其它已知写入点（[观测]）

| 汇编 | 含义 | 置信度 |
|---|---|---|
| `rol $0x8,%bx` + `mov %bx,0x0(base+off)` | 16 位大端字段 | [观测] 宽度 2 B |
| `mov %r15b,0x4(base+off)` | 8 位字段，位于上者 +4 | [观测] 宽度 1 B |
| `orb $0x40,0xa(m_Data)` | flags 位 6（条件：`arg7 != 0xff`） | [观测] |
| `orb $0x10,0xa(m_Data)` | flags 位 4 | [观测] |
| `mov %r14b,(m_Data+m_DataSize-1)` | 包尾 1 字节（arg7） | [观测] |
| `lea 0x0(,%r12,8),%eax` + `cmp $0x1f,%r12` | 若 `arg4 ≤ 31` 则算 `arg4*8` | [观测] |
| `cmp $0x7,%eax; cmovbe %eax,%ebp` | `min(arg5, 7)` | [观测] |

`arg4 ≤ 31`、`arg4*8` 的组合很像**「帧数 × 每帧 8 字节」或「编码参数打包成 5 bit」**；`min(x,7)` 则像 3 bit 字段截断。
这两处**字段语义未确认**，但宽度线索（5 bit / 3 bit 截断）值得后续验证。

### 4.6 语音包最小长度自洽性检查

由 §3.5，`VOICE`/`VOICE_WHISPER` 最小长度 16 字节；而 §3.1 的加密头是 13 字节 →
**最小语音包只剩 3 字节 payload**。这不可能装下一帧（≥ 8 字节）。
因此 16 字节判据只可能作用于**未加密/解密后**的形态（11 字节头 + 5 字节 payload），
或作用于**「已解密的包」**（此时 tag 8 字节已被剥离，头变 5 字节 + …）。
这条内部矛盾本身是 §3.6「头部在生命周期内会变形」的又一间接证据。

---

## 5. MTU 与分片

### 5.1 `get_packet_mtu(bool is_ipv6)` 的两个返回值（[观测] 已闭环）

同一对常量 `0x1f4`(500) / `0x454`(1108) 在三处独立出现，全部紧邻 `get_packet_mtu` 的断言：

**位置 1** — `OutgoingPacket::buildPacket`（MTU 断言站点 `0x4a0070`）：

```asm
  49ff94:	test   %bpl,%bpl
  49ff97:	mov    $0x454,%ecx          ; 1108
  49ff9c:	mov    $0x1f4,%edx          ; 500
  49ffa1:	cmovne %ecx,%edx            ; arg4 != 0 → 1108，否则 500
  49ffa4:	cmp    %edx,0x10(%r15)      ; 比较 m_DataSize
  49ffa8:	jbe    4a0190               ; size <= mtu → 跳过断言
```

**位置 2** — `outgoingresendingpacket.cpp` 分片函数（`0xa9e3f0`，断言站点 `0xa9ea7f`）：

```asm
  a9e409:	mov    $0x454,%eax
  a9e40e:	mov    $0x1f4,%ecx
```

**位置 3** — `packethandler_base.cpp` 发送前检查（`0xa98000`）：

```asm
  a98659:	mov    $0x454,%eax
  a9865e:	mov    $0x1f4,%ecx
```

`0xa98000` 的**伪代码**（Ghidra，checkpoint 复用后 15 s）把这三处的语义一次讲清：

```c
/* packethandler_base.cpp::sendPacket 主体（节选，FUN_00a98000） */
uVar11 = FUN_0049fcb0(param_4);              // packet->getPacketSize()
FUN_0049fc80(&local_188, param_4);           // 取出 peer endpoint
cVar5 = FUN_004a5d90(&local_188);            // endpoint.is_v6()
uVar13 = 500;
if (cVar5 != '\0') { uVar13 = 0x454; }       // ★ IPv6 → 1108，IPv4 → 500
if (uVar13 < uVar11) {                       // 超 MTU
  cVar5 = FUN_0049fc60(param_4);             // packet->getType()
  if (cVar5 != '\x01') {                     // ★ 类型 1 = VOICE_WHISPER → 豁免
    ... 触发断言 "packet->getPacketSize() <= get_packet_mtu(...is_v6()) || packet->getType() == VOICE_WHISPER"
  }
}
```

而 `buildPacket` 的第 4 个实参由调用方算成「地址族 != 2」：

```c
/* 0xa98000 里的调用点 */
cVar5 = FUN_00460ba0(lVar19, 0, uVar7, uVar16, uVar12, &key16, &nonce16);   // KDF，见 §7.6
if (cVar5 != '\0') {
  FUN_0049fd30(param_4, key16, nonce16, *local_50 != 2);   // ← 第4实参 = (conn+0x400 的 short != 2)
}
```

`local_50 = (short *)(conn + 0x400)`。Linux 上 `AF_INET == 2`，所以 `*(conn+0x400) != 2` 正是 **`is_ipv6`**。

| 值 | 十六进制 | 语义 | 置信度 |
|---|---|---|---|
| **500** | `0x1f4` | **IPv4** MTU | **[观测]** 已闭环：`AF_INET(2)` 判定 + 断言表达式 `get_packet_mtu(is_ipv6)` |
| **1108** | `0x454` | **IPv6** MTU | **[观测]** 同上 |

> 早先「500 < 1108 与直觉相反」的疑虑已解除：这是 TS3 自己的取值（IPv6 留更大空间，因为 IPv4 侧怕分片）。
> 该结论同时被 §3.4 的每类型上限表印证：`VOICE=500`（IPv4 语音）、`COMMAND/COMMAND_LOW/INIT1=1108`（IPv6 控制/握手）。

### 5.2 分片判据与分片包

```bash
$ strings -a ts3server | grep -E 'outgoingresendingpacket.cpp|hasFragmentFlag|FRAGMENT'
Assertion "needsSplitting(is_ipv6)" failed at .../packet/outgoingresendingpacket.cpp:
Assertion "getType() == COMMAND_LOW" failed at .../packet/outgoingresendingpacket.cpp:
Assertion "packet->getPacketSize() <= get_packet_mtu(is_ipv6)" failed at .../packet/outgoingresendingpacket.cpp:
Assertion "!hasFragmentFlag()" failed at .../packet/outgoingresendingpacket.cpp:
Assertion "original.getPacketSize() == getPacketSize()" failed at .../packet/outgoingresendingpacket.cpp:
```

可确定的机制（[观测] 断言 + [推断] 因果）：

1. 只有 `COMMAND_LOW` 会被切分（`getType() == COMMAND_LOW`）。
2. 切分阈值就是 `get_packet_mtu(is_ipv6)`（500/1108）。
3. 分片包**不带** fragment flag（`!hasFragmentFlag()`），而重组侧的判据在 `connection.cpp`：`j->second->hasFragmentFlag()`。
   → 说明「fragment flag」标记的是**重组中的语义**（首片/中间片），不是每个分片都带。
4. 重组后总长必须一致（`original.getPacketSize() == getPacketSize()`）。

客户端侧对应断言（`packethandler.cpp`，注意客户端文件名少了 `_base`）：

```bash
$ strings -a ts3client_win64.exe | grep -E 'outgoingresendingpacket.cpp|packethandler.cpp'
Assertion "original.getPacketSize() == getPacketSize()" failed at ...\packet\outgoingresendingpacket.cpp:
Assertion "!hasFragmentFlag()" failed at ...\packet\outgoingresendingpacket.cpp:
Assertion "packet->getPacketSize() <= get_packet_mtu(is_ipv6)" failed at ...\packet\outgoingresendingpacket.cpp:
Assertion "getType() == COMMAND_LOW" failed at ...\packet\outgoingresendingpacket.cpp:
Assertion "needsSplitting(is_ipv6)" failed at ...\packet\outgoingresendingpacket.cpp:
Assertion "packetType == COMMAND_LOW" failed at ...\packethandler.cpp:
Assertion "!isResendingPacketType(packetType)" failed at ...\packethandler.cpp:
Assertion "packet->getPacketSize() <= get_packet_mtu(packet->getPeerAddr().is_v6()) || packet->getType() == VOICE_WHISPER" failed at ...\packethandler.cpp:
Assertion "packet->getType() == packetType" failed at ...\packethandler.cpp:
Assertion "!skipPacketIDBranding || packet->getType()==INIT1 || isResendingPacketType(packetType)" failed at ...\packethandler.cpp:
```

两端**逐字相同**（除路径分隔符），再次证明共享 `teamspeak_common_lib`。

### 5.3 whisper 的 MTU 豁免与「超包」后果

断言 `... <= get_packet_mtu(peer.is_v6()) || getType() == VOICE_WHISPER`（服务端 `0xa9874b` / 客户端同名）说明：
**唯一允许超过 MTU 的包型是 `VOICE_WHISPER`**（因为目标列表可能很长）。这与 §3.4 表里 whisper 的 9000 上限一致。
若绕过该断言，`OutgoingPacket::buildPacket` 的 MTU 断言会再拦一次（`0x4a0070`）——但那个检查里**没有 whisper 豁免**，
即 whisper 在 `buildPacket` 阶段会被判为「超 MTU」。这条张力说明 whisper 的目标列表很可能**不经过** `buildPacket` 的那条路径
（或 whisper 走 §3.6 的「重发型」通道跳过 PacketID 打标）。**未确认**，列入 §13。

### 5.4 未发现 FEC / 未发现 PLC 实现（[观测] 阴性）

在两端字符串里搜索 FEC / 前向纠错 / 丢包隐藏：

```bash
$ grep -icE '\bfec\b|forward_error|error_correct' srv.str cli.str
srv.str:0
cli.str:0
$ grep -inE 'conceal|plc\b|packet_?loss' srv.str | head
# 仅命中统计变量与 speex 抖动缓冲：
```

服务端唯一相关的是 **Speex 的抖动缓冲**（jitter buffer），这是接收侧排队而非 FEC：

```bash
$ strings -a ts3server | grep -iE 'jitter|speex_ts'
Bjitter_buffer_get(): packet too large to fit. Size is
jitter_buffer_get() discarding non-zero start_offset
jitter buffer sees negative buffering, your code might be broken. Value is 
Unknown jitter_buffer_ctl request: 
../../../../deps/speex_ts/libspeex/jitter.c
```

丢包统计变量（服务端，`instanceinfo`/`serverinfo` 字段名）证明系统**度量**丢包但无 FEC：

```bash
$ strings -a ts3server | grep -E 'packetloss'
2client_packetloss
2client_packetloss_control
2client_packetloss_keepalive
2client_packetloss_speech
2client_packetloss_total
2server_packetloss_control
2server_packetloss_keepalive
2server_packetloss_speech
2server_packetloss_total
```

（前缀 `2` 是 Itanium name 的长度字节，真实字段名是 `client_packetloss_speech` 等。）

结论：**FEC 不存在**；**PLC 仅有可能存在于客户端解码后端**（客户端还打包了 WebRTC audio processing，见下），服务端不做 PLC。
客户端侧 WebRTC 组件证据：

```bash
$ strings -a ts3client_win64.exe | grep -m6 -E 'WebRTC\.Audio|webrtc'
WebRTC.Audio.EchoCanceller.MaxRenderJitter
WebRTC.Audio.EchoCanceller.MinRenderJitter
WebRTC.Audio.EchoCanceller.MaxCaptureJitter
WebRTC.Audio.EchoCanceller.MinCaptureJitter
```

（这些是 AEC/AGC 参数，不等于 PLC；PLC 是否启用**未确认**。）

---

## 6. 握手与密钥协商（INIT1）

### 6.1 `TS3INIT1` 魔数：位于包**最开头 8 字节**

`.data` 里存在一个 8 字节常量，内容正是 ASCII `TS3INIT1`，并被合法性函数直接 `cmp` 到包前 8 字节：

```bash
$ python3 - <<'PY'
import struct
d=open('ts3server','rb').read()
# .data: va 0xfd6ac0 <- file 0x9d6ac0
print(d[0x9d6ac0+(0xfd91a0-0xfd6ac0):][:16])
PY
b'TS3INIT1@(\xbb\x00\x00\x00\x00\x00'
```

```asm
  49b2d5:	mov    (%r8),%rcx                 ; r8 = m_Data，取前 8 字节
  49b2d8:	cmp    0xb3dec1(%rip),%rcx        # fd91a0 <...>  ← "TS3INIT1"
  49b2df:	je     49b2e4
  49b2e1:	xor    %eax,%eax
  49b2e3:	ret                               ; 不等于魔数 → 判为非法包
  49b2e4:	mov    0x11(%r8),%cl              ; ★ m_Data[17]
  49b2e8:	mov    %ecx,%edx
  49b2ea:	cmp    $0x7f,%cl
  49b2ed:	jne    49b309
```

**这解释了 INIT1 为什么「不是普通包头」**：它的前 8 字节是协议标识符 `TS3INIT1`，而不是 §3 的 EAX 标签。
也解释了 §1.3 里 `skipPacketIDBranding` 对 INIT1 的豁免，以及 §3.4 表里 INIT1 的独立判据（最小 14 字节）。

客户端侧同一常量出现 **两次相邻**（发送端构造 + 校验端比较各一份，被字符串池合并成一条）：

```bash
$ strings -a ts3client_win64.exe | grep -n 'TS3INIT1'
58141:TS3INIT1TS3INIT1
```

### 6.2 INIT1 已知字段

| 偏移 | 宽度 | 内容 | 证据 |
|---|---|---|---|
| +0 | 8 B | ASCII `TS3INIT1` | [观测] `0x49b2d8` 立即数比较；常量 `0xfd91a0` |
| +8 .. +16 | 9 B（区间推断） | 未确认（时间戳 / 版本 / 随机数 三者之一或组合） | [未确认] |
| +17 | 1 B | 与 `0x7f` 比较的字节（上限 127 的计数器/长度） | [观测] `0x49b2e4` `mov 0x11(%r8),%cl` + `cmp $0x7f` |
| ≥14 | — | 最小总长 14 字节 | [观测] `0x49b2ba` `cmp $0xe` |
| — | — | 类型字节 `m_Data[10] = 0x88`（低半字节 8 = INIT1） | [观测] `0x4a0ec1/0x4a1048/0x4a119f` `movb $0x88,0xa(...)` |

`+17` 这个位置是在「+8 之后 9 字节」处，与 §3 的 13 字节头结构**不兼容**（13 字节头里 +13 已是 payload）。
这再次说明 INIT1 用的是**独立于常规头部的格式**（前 8 字节魔数取代 tag 字段）。

### 6.3 密钥 / Nonce 的来源与长度

**证据 A** — 解密/加密调用把 keylen 与 noncelen 都写成立即数 16：

```asm
; 解密（0x49b3e0）
  49b425:	mov    $0x10,%edx      ; keylen   = 16
  49b42a:	mov    $0x10,%r8d      ; noncelen = 16
; 加密（0x49fd30）
  4a01a9:	mov    $0x10,%edx      ; keylen   = 16
  4a01ae:	mov    $0x10,%r8d      ; noncelen = 16
```

**证据 B** — 存在一对「全局默认 key / nonce」，二者在内存中**紧邻**（`key` 16 字节 + `nonce` 16 字节 = 32 字节块），
`decrypt(key=null, nonce=null)` 时自动取默认值：

```asm
; 0x49b700 起（IncomingPacket::decrypt，断言 m_State == ENCRYPTED，行号 0x6f = 111）
  49b8f5:	lea    0xe75dcc(%rip),%rax   # 13116c8  ← 全局指针
  49b8fc:	mov    (%rax),%rax
  49b8ff:	test   %r15,%r15            ; r15 = 入参 key
  49b902:	cmove  %rax,%r15            ; key 为空 → 用全局 key
  49b906:	lea    0x10(%rax),%rax       ; ★ +0x10 = 16 → nonce 紧跟 key 之后
  49b90a:	cmove  %rax,%r12            ; nonce 为空 → 用 key+16
  49b90e:	mov    %r13,%rdi
  49b911:	mov    %r15,%rsi
  49b914:	mov    %r12,%rdx
  49b917:	call   49b3e0              ; → 真正的 EAX 解密
  49b91c:	test   %al,%al
  49b91e:	je     49b92c
  49b920:	movl   $0x2,0x0(%r13)       ; 解密成功 → m_State = 2 (READABLE)
  49b928:	mov    $0x1,%al
```

> `+0x10` 这个跨度是「key 长 16 字节」的**独立第二证据**（与 `$0x10` 立即数互相印证）。

**密钥协商的完整流程未确认**（INIT1 里到底怎么运送 RSA 加密的 `AES key` 与 `nonce` 没读到）。
可以确认的只有：**对称算法族是 AES-128（16 字节 key）+ 16 字节 nonce + EAX 模式 + 8 字节截断标签**。

### 6.4 加密算法选择 / 协商失败路径

服务端字符串给出「协商」的**存在性**与**候选集**：

```bash
$ strings -a ts3server | grep -E 'encryption_ciphers|no common encryption|codec_encryption_mode'
virtualserver_codec_encryption_mode
virtualserver_encryption_ciphers
AES-256,AES-128
client_encryption_ciphers
no common encryption algorithms
```

解读：

* `virtualserver_encryption_ciphers` / `client_encryption_ciphers` 是**可变配置项**（`serveredit` 参数），默认值字面量 `AES-256,AES-128`。
* `no common encryption algorithms` 是**协商失败**的错误文案 → 存在 capability 交换 + 交集选择。
* 但语音/控制的 **EAX 却固定用 16 字节 key（AES-128）**（§6.3 立即数）。
  这两者并不矛盾：`..._encryption_ciphers` 作用于**语音编码器级加密**（`channel_codec_is_unencrypted` / `codec_encryption_mode`），
  而 §7 的 EAX 是全通道传输层加密。**两套加密并存**是本报告的重要结论之一。

**`teamnative_crypto` 是第三套（与传输层无关）**。服务端 RTTI 里有完整的 AES 封装模板实例：

```bash
$ strings -a ts3server | grep -oE 'teamnative_crypto[0-9]+[A-Za-z_]+' | sort -u | head -20
teamnative_crypto10BaseHasherE
teamnative_crypto11Aes256_ImplE
teamnative_crypto13Pksc7_PaddingINS1_15Aes256_Impl_CBCEEE
teamnative_crypto13Pksc7_PaddingINS1_15Aes256_Impl_ECBEEE
teamnative_crypto15Aes256_Impl_CBCE
teamnative_crypto15Aes256_Impl_CTRE
teamnative_crypto15Aes256_Impl_ECBE
teamnative_crypto16Aes256_Impl_CFB8E
teamnative_crypto3ShaILm160EEE
...
teamnative_crypto8Ctr_ModeINS1_15Aes256_Impl_ECBEXadL_ZNS1_25little_endian_incrementerILm16EEEvRNSt3__15arrayIhXT_EEEEEEE
teamnative_crypto8Ofb_ModeINS1_15Aes256_Impl_ECBEEE
```

并用一个 16 字节常量数组作参数（许可证解密路径）：

```bash
$ strings -a ts3server | grep -oE 'get_latest_license_using_legacy[A-Za-z0-9_]*.{0,140}' | head -1
get_latest_license_using_legacyRN5boost4asio10io_contextERKN3com10teamspeak317teamnative_crypto8CryptlibEjRKNSt3__15arrayIhLm16EEEE4
```

尾部 `arrayIhLm16EE` 即 `std::array<unsigned char, 16>` —— **确认 16 字节常量**。
因此 `Aes256_Impl_*`（CBC/CTR/ECB/CFB8）、`Pksc7_Padding`、`Ofb_Mode`、`Ctr_Mode<...,little_endian_incrementer<16>>`
都是 `teamnative_crypto` 的**库内模板实例**，用于许可证/SSH 等，**不是语音通道**。这一点必须写清，否则极易误判「语音用 AES-256-CTR」。

### 6.5 「client connection encryption」是独立密钥槽

```bash
$ strings -a ts3server | grep -iE 'client connection encryption'
failed to get key from client connection encryption
```

即使拿到这条失败文案，其密钥槽的具体结构（谁的 key、如何填充）**未确认**。

### 6.6 RSA Puzzle（`PacketLimiter`）—— 防 DoS 的握手闸门

服务端 RTTI 与断言把 puzzle 的结构体名字都暴露了：

```bash
$ strings -a ts3server | grep -oE '[A-Za-z_0-9]*Rsa_Puzzle[A-Za-z_0-9]*' | sort -u
Rsa_Puzzle_Info
Rsa_Puzzle_Key_Struct
$ strings -a ts3server | grep -oE 'N5boost[0-9A-Za-z_]*Rsa_Puzzle[A-Za-z_0-9]*' | head -2
N5boost6detail11thread_dataINS_3_bi6bind_tIvPFvP10Prng_stateiiP21Rsa_Puzzle_Key_StructiiiP15Rsa_Puzzle_InfoENS2_5list8INS2_5valueIS5_EENSD_IiEESF_NSD_IS7_EESF_SF_SF_NSD_IS9_EEEEEEEE
```

反解该 mangled 名（`boost::bind_t<void (*)(Prng_state*, int, int, Rsa_Puzzle_Key_Struct*, int, int, int, Rsa_Puzzle_Info*)>`）可得**预计算线程签名**：

```
void f(Prng_state *prng, int, int, Rsa_Puzzle_Key_Struct *, int, int, int, Rsa_Puzzle_Info *)
```

即：**服务端用后台线程 + PRNG 批量预生成 puzzle 密钥**（结合 `Puzzle precompute time: ` 日志字符串）。

```bash
$ strings -a ts3server | grep -iE 'puzzle|prng' | head -12
puzzleGetCurrentPuzzleData failed with 
Assertion "x_len == static_cast<unsigned long>(PuzzleData::PUZZLE_DATA_SIZE_x) && X_len == static_cast<unsigned long>(PuzzleData::PUZZLE_DATA_SIZE_x)" failed at .../packetlimiter.cpp:
Assertion "info->n_len == static_cast<unsigned long>(PuzzleData::PUZZLE_DATA_SIZE_n)" failed at .../packetlimiter.cpp:
Assertion "m_PuzzleSource" failed at .../packetlimiter.cpp:
Assertion "prngIdx >=0" failed at .../packetlimiter.cpp:
Assertion "err==CRYPT_OK" failed at .../packetlimiter.cpp:
Puzzle precompute time: 
RSA_PUZZLE N too large 
Assertion "my_sz <= static_cast<unsigned int>(bytesNeeded)" failed at .../encryption/rsa_puzzle.cpp:
```

### 6.7 `PuzzleData` 的尺寸常量：64 字节（[观测]）

在断言 `x_len == PUZZLE_DATA_SIZE_x && X_len == PUZZLE_DATA_SIZE_x` 的同一函数（`0xadeff0–0xadf8c2`，`packetlimiter.cpp`）里，
对三个长度量做了与 `0x40` 的比较：

```bash
$ objdump -d --no-show-raw-insn --start-address=0xadeff0 --stop-address=0xadf8c2 \
    -j .text ts3server | grep -E 'cmpq +\$0x40'
  adf248:	cmpq   $0x40,0x78(%rsp)
  adf253:	cmpq   $0x40,0x70(%rsp)
  adf451:	cmpq   $0x40,0x38(%rax,%r12,8)
```

`0x40 = 64`。断言在 `0xadf332`（行号立即数 `0xe4` = 228）：

```asm
  adf32a:	lea    0x90(%rsp),%rdi
  adf332:	lea    0x140a5b(%rip),%rsi        # c1fd94 ← x_len/X_len 断言
  adf339:	mov    $0xe4,%edx                  ; 行号 228
  adf343:	mov    $0x18e,%esi
```

| 常量 | 值 | 对应 | 置信度 |
|---|---|---|---|
| `PUZZLE_DATA_SIZE_x` | **64 B** | puzzle 的 `x`（及校验用的 `X`，两者同长） | [观测] 两处 `cmpq $0x40` 直接对应断言的两个比较项 |
| `PUZZLE_DATA_SIZE_n` | **64 B（推定）** | RSA 模数 `n` | [推断] 第三处 `cmpq $0x40`（`0xadf451`）在 `n_len` 断言（`0xadf537`）之前的同一流程里；**但未能把该比较与 `n_len` 一一绑定** |

> 64 字节 = 512 bit。这与 `RSA_PUZZLE N too large` 文案、以及 `rsa_make_key`/`rand_prime` 的存在一致：
> puzzle 不是「算 SHA 前导零」而是**真的对一个 RSA-512 模数做模幂**（客户端 `COMMAND_SOLVE_PUZZLE`）。
> 客户端侧对应文案：
>
> ```bash
> $ strings -a ts3client_win64.exe | grep -iE 'puzzle'
> Puzzle solve time: 
> COMMAND_SOLVE_PUZZLE data too large 
> Error solving puzzle 
> ...\deps\teamspeak_common_lib\src\encryption\rsa_puzzle.cpp
> ```

### 6.8 PRNG 与「解不出 puzzle」的判定

```bash
$ strings -a ts3server | grep -E 'ts_tomcrypt.src.prngs|rand_prime'
../../../../deps/ts_tomcrypt/src/prngs/yarrow.c
../../../../deps/ts_tomcrypt/src/math/rand_prime.c
$ strings -a ts3client_win64.exe | grep -E 'yarrow'
yarrow
```

服务端 `randomnumber.cpp` 断言把 PRNG 描述符绑定到 **Yarrow**：

```bash
$ strings -a ts3server | grep 'randomnumber.cpp'
Assertion "buffer != __null" failed at .../randomnumber.cpp:
Assertion "len == static_cast<unsigned long>(yarrow_desc.export_size)" failed at .../randomnumber.cpp:
```

即随机源 = LibTomCrypt 的 **Yarrow**（`yarrow_desc`），导出状态长度必须等于 `yarrow_desc.export_size`（具体字节数**未确认**，在 `yarrow_desc` 结构体里）。

Puzzle 结果校验用 LibTomCrypt 错误码（`CRYPT_OK` / `err` 变量）：

```asm
; packetlimiter 0xadfe90 起，断言 "err==CRYPT_OK" 站点 0xae0194
```

## 7. 加密细节：EAX / AES / tomcrypt

### 7.1 两端都静态链入 `ts_tomcrypt`（定制版 LibTomCrypt）

服务端把整个库编进来（`deps/ts_tomcrypt`），客户端同样（`deps/ts_tomcrypt`，Windows 路径）。可枚举到的源文件：

```bash
$ strings -a ts3server | grep -oE 'ts_tomcrypt/src/[a-z0-9_/]+\.c' | sort -u
ts_tomcrypt/src/ciphers/aes/aes.c
ts_tomcrypt/src/encauth/eax/eax_decrypt.c
ts_tomcrypt/src/encauth/eax/eax_decrypt_verify_memory.c
ts_tomcrypt/src/encauth/eax/eax_done.c
ts_tomcrypt/src/encauth/eax/eax_encrypt.c
ts_tomcrypt/src/encauth/eax/eax_encrypt_authenticate_memory.c
ts_tomcrypt/src/encauth/eax/eax_init.c
ts_tomcrypt/src/hashes/sha1.c
ts_tomcrypt/src/hashes/helper/hash_memory.c
ts_tomcrypt/src/hashes/sha2/sha224.c
ts_tomcrypt/src/hashes/sha2/sha256.c
ts_tomcrypt/src/mac/omac/omac_done.c
ts_tomcrypt/src/mac/omac/omac_init.c
ts_tomcrypt/src/mac/omac/omac_process.c
ts_tomcrypt/src/math/rand_prime.c
ts_tomcrypt/src/math/tfm_desc.c
ts_tomcrypt/src/misc/zeromem.c
ts_tomcrypt/src/misc/crypt/crypt_find_cipher.c
ts_tomcrypt/src/misc/crypt/crypt_find_hash.c
ts_tomcrypt/src/misc/crypt/crypt_register_cipher.c
ts_tomcrypt/src/misc/crypt/crypt_register_hash.c
ts_tomcrypt/src/misc/crypt/crypt_register_prng.c
ts_tomcrypt/src/modes/ctr/ctr_done.c
ts_tomcrypt/src/modes/ctr/ctr_start.c
ts_tomcrypt/src/modes/ctr/ctr_encrypt.c
ts_tomcrypt/src/modes/ctr/ctr_decrypt.c
ts_tomcrypt/src/pk/rsa/rsa_exptmod.c
ts_tomcrypt/src/pk/rsa/rsa_make_key.c
ts_tomcrypt/src/pk/ecc/{ecc_free,ecc_import,ecc_verify_hash,ltc_ecc_map,ltc_ecc_mul2add,ltc_ecc_mulmod,ltc_ecc_projective_add_point,ltc_ecc_projective_dbl_point}.c
ts_tomcrypt/src/pk/asn1/der/... (sequence / short_integer / utctime / utf8 / bit / boolean ...)
ts_tomcrypt/src/prngs/yarrow.c
```

要点：

* **EAX 只有 `eax_init/eax_encrypt/eax_decrypt/eax_done` + 两个 one-shot 变体** → 语音通道用 EAX（AEAD）。
* **CTR 也有完整一套**（`ctr_start/encrypt/decrypt/done`），但它服务于 RSA 模幂/大数运算路径与 `teamnative_crypto`，**没有证据表明语音包用 CTR**。
* **没有 GCM 源文件**（`grep -c gcm` 对 `ts_tomcrypt` 路径为 0）→ 语音通道**不是 GCM**。
* RSA（`rsa_exptmod`/`rsa_make_key`/`rand_prime`）、ECC、ASN.1 DER、Yarrow PRNG 都在 → 握手/许可证/证书路径。

```bash
$ strings -a ts3server | grep -c 'ts_tomcrypt/src/encauth/gcm'
0
$ strings -a ts3server | grep -E 'Rijndael|register_cipher' | head -3
../../../../deps/ts_tomcrypt/src/misc/crypt/crypt_register_cipher.c
Error registering Rijndael cipher
Using hardware aes
```

`Error registering Rijndael cipher` / `Using hardware aes` 证明 AES 实现按 CPU 特性选择（AES-NI 优先）。

### 7.2 密码描述符按名字查找：`crypt_find_cipher("rijndael")`

`OutgoingPacket::buildPacket` 的首次调用会跑一个 `__cxa_guard` 保护的初始化：

```asm
  4a054a:	movl   $0x2,0x20(%rax)          ; m_State = 2（BUILT/DONE）
  ...
  4a0563:	lea    0xe7116e(%rip),%rdi       # 13116d8 ← guard 变量
  4a056a:	call   a77010 <__cxa_guard_acquire>
  4a0577:	mov    %rbx,%r12
  4a057a:	lea    0x771fd8(%rip),%rdi       # c12559 ← 字符串 "rijndael"
  4a0581:	call   74f3d0 <...>              ; crypt_find_cipher
  4a0586:	mov    %eax,0xe71144(%rip)       # 13116d0 ← 全局 cipher id
  4a058c:	lea    0xe71145(%rip),%rdi       # 13116d8
  4a0593:	call   a770c0 <__cxa_guard_release>
```

```bash
$ python3 -c "d=open('ts3server','rb').read();i=0x7a3000+(0xc12559-0xba3000);print(d[i:i+24])"
b'rijndael\x00unable to a'
```

→ **AES（Rijndael）由名字查表获得描述符**，密码实现细节（轮数）由 key 长度决定 → 16 字节 key = AES-128。

解密侧用另一个全局（`0x13116b0`），说明加/解密路径各自缓存了一份描述符 id：

```asm
  49b408:	mov    0xe762a2(%rip),%edi       # 13116b0
```

### 7.3 `eax_decrypt_verify_memory` 的 13 个实参（[观测] 逐项对应）

```asm
  49b408:	mov    0x13116b0,%edi           ; ① cipher        (int)
  49b40e:	mov    0x8(%rbx),%rax           ;    rax = m_Data
  49b412:	lea    0x8(%rax),%r9            ; ⑥ hdr           = m_Data + 8
  49b416:	mov    0x10(%rbx),%ebx          ;    ebx = m_DataSize
  49b419:	add    $0xfffffff3,%ebx          ; ⑨ ctlen         = m_DataSize - 13
  49b420:	lea    0x14(%rsp),%rbp          ; ⑬ stat          = &stat
  49b425:	mov    $0x10,%edx               ; ③ keylen        = 16
  49b42a:	mov    $0x10,%r8d               ; ⑤ noncelen      = 16
  49b430:	mov    %r15,%rsi               ; ② key
  49b433:	mov    %r14,%rcx               ; ④ nonce
  49b436:	push   %rbp                   ; ⑬ stat
  49b437:	push   $0x8                   ; ⑫ taglen        = 8
  49b439:	push   %rax                   ; ⑪ tag           = m_Data + 0
  49b43a:	lea    0xd(%rax),%rax
  49b43e:	push   %rax                   ; ⑩ pt            = m_Data + 13
  49b43f:	push   %rbx                   ; ⑨ ctlen
  49b440:	push   %rax                   ; ⑧ ct            = m_Data + 13
  49b441:	push   $0x5                   ; ⑦ hdrlen        = 5
  49b443:	call   749a00
```

映射到 LibTomCrypt 的

```c
int eax_decrypt_verify_memory(int cipher,
    const unsigned char *key,    unsigned long keylen,
    const unsigned char *nonce,  unsigned long noncelen,
    const unsigned char *hdr,    unsigned long hdrlen,
    const unsigned char *ct,     unsigned long ctlen,
          unsigned char *pt,
          unsigned char *tag,    unsigned long taglen,
          int *stat);
```

| # | 形参 | 实际值 |
|---|---|---|
| ① | `cipher` | 全局 `0x13116b0`（`crypt_find_cipher("rijndael")` 结果） |
| ② | `key` | 入参（空则用全局默认 key） |
| ③ | `keylen` | **16** |
| ④ | `nonce` | 入参（空则用全局 key+16） |
| ⑤ | `noncelen` | **16** |
| ⑥ | `hdr` | `m_Data + 8` |
| ⑦ | `hdrlen` | **5** |
| ⑧ | `ct` | `m_Data + 13` |
| ⑨ | `ctlen` | `m_DataSize - 13` |
| ⑩ | `pt` | `m_Data + 13`（**原地解密**） |
| ⑪ | `tag` | `m_Data + 0` |
| ⑫ | `taglen` | **8** |
| ⑬ | `stat` | 栈上 `int`，成功时 `0`/`1` |

外层包装 `0x749a00` 自己还会 `malloc` + `memcmp` + `free`，即 **TS 在 LibTomCrypt 外又包了一层做标签比较与多段 header 拼接**（`0x749a00` 里可见 `memcmp@plt`）：

```asm
  749a78:	call   40ad30 <malloc@plt>
  749a85:	call   40ad30 <malloc@plt>
  749abd:	call   749f40
  749ade:	call   755b20
  749b01:	call   749c30
  749b28:	call   40a3e0 <memcmp@plt>     ; ★ 标签比较
  749b42:	call   40b4b8 <free@plt>
```

**TS 侧包装函数本体**（Ghidra 伪代码 `0x49b3e0`，一行即完整参数表）：

```c
bool FUN_0049b3e0(long pkt, uint64 key, uint64 nonce)
{
  if (DAT_013116b8 == '\0') {                        /* __cxa_guard 保护的懒初始化 */
     ... DAT_013116b0 = FUN_0074f3d0("rijndael");     /* crypt_find_cipher */
  }
  lVar1 = *(long *)(pkt + 8);                        /* m_Data */
  iVar2 = FUN_00749a00(DAT_013116b0,                  /* ① cipher  */
                       key, 0x10,                     /* ②③ key, keylen=16   */
                       nonce, 0x10,                   /* ④⑤ nonce, noncelen=16 */
                       lVar1 + 8, 5,                  /* ⑥⑦ hdr=m_Data+8, hdrlen=5 */
                       lVar1 + 0xd, *(int*)(pkt+0x10) - 0xd,  /* ⑧⑨ ct=m_Data+13, ctlen=size-13 */
                       lVar1 + 0xd,                   /* ⑩ pt=m_Data+13（原地） */
                       lVar1, 8,                      /* ⑪⑫ tag=m_Data+0, taglen=8 */
                       &local_17c);                   /* ⑬ stat */
  if (iVar2 != 0) { ... "Received Error (2) " ... }   /* LibTomCrypt 返回码非 0 → 记日志 */
  return local_17c == 1;                              /* ★ stat==1 表示标签校验通过 */
}
```

这段伪代码是本报告 §3.2/§7.3 所有偏移与长度的**单一来源**：`+8 / 5 / +0xd / size-0xd / +0 / 8` 全部是字面量。
注意末行 `return stat == 1`：**校验失败不抛异常，只返回 false**，由上层丢弃包（与 `m_State == ENCRYPTED` 断言 + 状态机配合）。

### 7.4 `TAG_LENGTH = 8`（[观测]，三重确认）

| 证据 | 位置 | 内容 |
|---|---|---|
| 加密侧预置 | `0x49ff67` | `movq $0x8,0x180(%rsp)` —— 把 taglen 出参初值设为 8 |
| 加密后校验 | `0x4a0372` | `cmpq $0x8,0x180(%rsp)`；不等则触发 `taglen == TAG_LENGTH` 断言（行号 111） |
| 解密侧传入 | `0x49b437` | `push $0x8` —— 即 `taglen` 实参 |

```asm
; 0x4a0372 附近（`taglen == TAG_LENGTH` 断言分支，站点 0x4a043f）
  4a0372:	cmpq   $0x8,0x180(%rsp)
  4a037f:	mov    0x8(%rsp),%rax
  4a0384:	je     4a054a                    ; 相等 → 直接收尾
  ...
  4a0446:	mov    $0x6f,%edx                ; 行号 111
  4a044b:	call   427500
```

→ **EAX 标签被截断为 8 字节**（标准 EAX = 16 字节）。这是一个 TS3 私有取舍：省 8 字节/包的带宽，代价是 MAC 强度从 128 bit 降到 64 bit。

### 7.5 每包加密开销（可精确计算，[观测] 输入）

| 项 | 字节 |
|---|---|
| EAX 标签（`TAG_LENGTH`） | **8** |
| 待认证头 `hdr` | 出站 **3** / 入站 **5** |
| 头总计 | 出站 **11** / 入站 **13** |
| 密文膨胀 | **0**（EAX 是流式 AEAD，原地加解密，`pt == ct` 指针相同） |

即：**除了 8 字节标签与 3（或 5）字节头，AEAD 层不额外增加任何字节**。这一点由「⑧ `ct` 与 ⑩ `pt` 指向同一地址 `m_Data+13`」直接证明。

对 500 字节 MTU 的 IPv4 语音包，加密开销占 **8/500 = 1.6 %**。

### 7.6 Key / Nonce 构造：**每包 SHA-256 KDF 派生 16+16**（[观测] 已闭环）

这是本次分析最重要的单点收获：**AES key 与 EAX nonce 都不是握手产物直接用，而是每个包用 SHA-256 现算出来的**。

`packethandler_base.cpp` 的发送路径先算 KDF，再把结果喂给 `buildPacket`：

```c
/* FUN_00a98000（发送路径）*/
uVar7  = FUN_0049fc20(param_4);      // packet 的 16 位字段（undefined2）
cVar5  = FUN_0049fc50(param_4);      // packet 的「跳过加密」标志
if (cVar5 == '\0') {
  cVar5 = FUN_00460ba0(conn, 0, uVar7, packetType, uVar12, &key16, &nonce16);  // ★ KDF
  if (cVar5 != '\0') {
    FUN_0049fd30(param_4, key16, nonce16, is_ipv6);      // ★ OutgoingPacket::buildPacket
  }
}
```

KDF 本体（`FUN_00460ba0`，即含 `outputlen == SHA256LEN` 断言的函数）伪代码：

```c
ulong FUN_00460ba0(conn, uint type, undefined4 _, byte mode, long arg32,
                   undefined8 *out_key, long *out_nonce)
{
  local_190 = 0x20;                                  // ★ 输出长度 32 = SHA256LEN
  ...
  __n = 0x14;                                        // ★ 20 字节
  if (*(int *)(conn + 0x160) == 2) { __n = 0x40; }   // ★ 或 64 字节（由 conn+0x160 选择）
  uVar12 = __n + 6;                                  // ★ 哈希输入总长 = 6 + __n（26 或 70）
  __s = operator_new(uVar12); memset(__s, 0, uVar12);
  *__s        = (type == 1) | 0x30;                  // byte0 = 0x31（type==1）或 0x30
  __s[1]      = mode;                                // byte1 = mode
  *(uint *)(__s + 2) = bswap32((uint)arg32);         // byte2..5 = 32 位大端计数器
  memcpy(__s + 6, *(void **)(conn + 0x158), __n);    // byte6.. = 连接级密钥材料
  DAT_01311478 = crypt_find_hash("sha256");          // ★ 按名取 sha256 描述符
  hash(DAT_01311478, __s, uVar12, __src, &local_190);
  if (local_190 != 0x20) { ... assert "outputlen == SHA256LEN" ... }
  *out_key   = __src;             // ★ key   = 摘要[0..15]
  *out_nonce = __src + 0x10;      // ★ nonce = 摘要[16..31]
  uVar8 = *(ushort *)__src;
  *(ushort *)__src = uVar8 << 8 | uVar8 >> 8;        // ★ key 前 2 字节做 16 位字节序翻转
}
```

由此得到 **确定的构造规格**：

```
  H_input = [1B: 0x30 | (packetType==1 ? 1 : 0)]
          || [1B: mode]
          || [4B: BE32(counter)]
          || [20B 或 64B: connection secret]           (长度由 *(int*)(conn+0x160)==2 决定)
  ── SHA-256 ──► 32B
  AES key  = digest[0..15]        （随后 key[0]↔key[1] 交换）
  EAX nonce= digest[16..31]
```

| 项 | 值 / 来源 | 置信度 |
|---|---|---|
| 哈希算法 | `crypt_find_hash("sha256")`，LibTomCrypt | [观测] 字符串 + 调用 |
| 摘要长度 | 32（`local_190 = 0x20`，并有 `outputlen == SHA256LEN` 断言） | [观测] |
| key 长度 | 16（`out_nonce = out_key + 0x10`） | [观测] |
| nonce 长度 | 16（同上） | [观测] |
| key/nonce 切分 | 摘要前半→key，后半→nonce | [观测] |
| KDF 输入长度 | 26 或 70 字节（`(*(conn+0x160)==2) ? 64+6 : 20+6`） | [观测] |
| 连接密钥材料 | `conn + 0x158` 指向的缓冲 | [观测]（内容语义未确认） |
| key 前 2 字节翻转 | `u8<<8 | u8>>8` | [观测] |

**安全含义**：每个包都换 key 与 nonce（因为输入里含 32 位计数器），所以
**重放/重排会被 nonce 唯一性挡住**；同时也解释了为什么 §7.3 的 `eax_decrypt_verify_memory` 需要把 key 与 nonce 作为两个**入参**传入，而不是从某个静态上下文取。

> 待补：4 字节计数器的来源（`uVar12 = FUN_0049fc30(pkt)` 的 64 位值低半部？）以及 `mode` 的取值域（伪代码里出现 `mode == 2` 与 `mode == 6` 两个分支）。
> 另外 KDF 内部有「每类型 × 每 mode」的**预计算缓存**（`lVar4 + type*0x30 + mode*0x30` 形式的下标与 `lVar9 == 0` 判空），
> 说明存在「派生结果缓存/复用」逻辑，其有效条件**未确认**（若命中缓存则同参数包复用同一 key/nonce —— 这会削弱重放防护，值得运行时验证）。

### 7.7 `connection.cpp` 里的握手密钥材料线索

```bash
$ strings -a ts3server | grep -E 'connection.cpp' | head -20
Assertion "m_iClientID == 0 && clientID != 0" failed at .../connection.cpp:
Assertion "!m_handShakeConfirmedIP" failed at .../connection.cpp:
Assertion "packetType < m_PacketID.size()" failed at .../connection.cpp:
Assertion "type != Shared_Secret_Type::invalid" failed at .../connection.cpp:
Assertion "!m_cryptoInitComplete" failed at .../connection.cpp:
Assertion "outputlen == SHA256LEN" failed at .../connection.cpp:
Assertion "j == m_SortedPacketList[packetType].end()" failed at .../connection.cpp:
Assertion "j->second->hasFragmentFlag()" failed at .../connection.cpp:
Assertion "m_AckWaitIterList[packetType].find(pID) == m_AckWaitIterList[packetType].end()" failed at .../connection.cpp:
Assertion "isResendingPacketType(packetType)" failed at .../connection.cpp:
Assertion "m_PingData.size() == MAXPINGS + 1" failed at .../connection.cpp:
Assertion "m_PingDataSum >= elapsedPongTime" failed at .../connection.cpp:
```

从断言可反推 `Connection` 的状态机字段与握手阶段：

| 断言 | 推论 |
|---|---|
| `!m_cryptoInitComplete` | 存在「加密尚未初始化」的阶段 → 握手前半段是**明文** |
| `type != Shared_Secret_Type::invalid` | 存在 `Shared_Secret_Type` 枚举；握手要在**多种共享密钥类型**间选择 |
| `outputlen == SHA256LEN` | **SHA-256（32 字节）** 参与密钥派生/校验（`SHA256LEN` 是 LibTomCrypt 宏，=32） |
| `m_iClientID == 0 && clientID != 0` | 客户端 ID 由服务端在握手后段分配，只允许从 0 → 非 0 一次 |
| `!m_handShakeConfirmedIP` | 握手完成时会**记录并锁定对端 IP**（防迁移/防重放） |
| `m_PacketID.size()` | 每类型一个 PacketID 计数器容器（§9.1） |

`Shared_Secret_Type` 的具体成员值**未确认**（枚举名只出现在断言文本里，没有对应的字符串表）。

---

## 8. 包 ID / ACK / 重传 / 拥塞

### 8.1 每类型独立的容器（[观测]）

`Connection` 里对每个 `PacketType` 各有一组容器，索引前都做范围断言：

```bash
$ strings -a ts3server | grep -E 'm_PacketID|m_AckWaitIterList|m_SortedPacketList'
Assertion "packetType < m_PacketID.size()" failed at .../connection.cpp:
Assertion "m_AckWaitIterList[packetType].push_back failed for packet id 
Assertion "packetType < m_AckWaitIterList.size()" failed at .../connection.cpp:
Assertion "m_AckWaitIterList[packetType].find(pID) == m_AckWaitIterList[packetType].end()" failed at .../connection.cpp:
Assertion "j == m_SortedPacketList[packetType].end()" failed at .../connection.cpp:
```

| 容器 | 语义 |
|---|---|
| `m_PacketID[type]` | 该类型的**出站 PacketID 计数器状态**（16 字节结构，见下） |
| `m_AckWaitIterList[type]` | 该类型**等待 ACK 的未确认包**集合（断言显示它同时有 `find(pID)` 与 `push_back`；`push_back` 失败时有专门日志） |
| `m_SortedPacketList[type]` | 该类型**已收到但待重组/乱序缓存**的包（`hasFragmentFlag()` 判断） |

`m_PacketID` 是「每个 PacketType 一个 **16 字节结构**」的 `std::vector`（`(end-begin)>>4` 即个数，个数 == 类型数）：

```asm
; 0x45e220（assignPacketID）
  45e23a:	mov    0x268(%rdi),%rax      ; end
  45e241:	sub    0x260(%rdi),%rax      ; - begin
  45e248:	sar    $0x4,%rax              ; ★ /16 → 每元素 16 字节
  45e24c:	cmp    %r13,%rax
  45e24f:	ja     45e42e                 ; packetType < size 则跳过断言
```

结构布局与「分配」逻辑（Ghidra 伪代码 `0x45e220`）：

```c
undefined1 [16] FUN_0045e220(conn, uint type)   /* assignPacketID */
{
  ...
  base = *(long *)(conn + 0x260);              /* m_PacketID.begin() */
  slot = base + type * 0x10;                   /* ★ 每类型 16 字节 */
  *(short *)slot += 1;                         /* ★ +0: uint16 计数器自增 */
  if (*(short *)slot == 0) {                   /* 回绕 */
     *(long *)(slot + 8) += 1;                 /* ★ +8: uint64 epoch 进位 */
  }
  ...
  hi = *(uint64 *)(slot + 8);                  /* epoch */
  lo = (uint64)(*(ushort *)slot) << 16;        /* ★ 计数器放到 32 位的 bit16..31 */
  return { lo | 1, hi };                       /* 16 字节返回：bit0=成功标志 */
}
```

对应调用方（`0xa98000`）：

```c
uVar11 = FUN_0045e220(conn, packetType);        /* 16 字节结构 */
FUN_0049fce0(pkt, uVar11 >> 0x10);              /* ★ 取 bit16..31 = 16 位 PacketID → m_Data[8..9] BE */
FUN_0049fcf0(pkt, extraout_RDX);                /* 64 位 epoch → pkt+0x18（不上线缆） */
```

结论：**每类型独立的 uint16 PacketID 计数器 + uint64 epoch**；计数器回绕时 epoch 递增，接收侧可用 epoch 识别「回绕后的新包」而非重放。
另外 `0xa98000` 里还有两个 **per-type uint32 数组**，都带 `LOCK()` 前缀的原子自增：

```c
piVar2 = (int *)(conn + 0x78 + type * 4);  (*piVar2)++;              /* 每类型发包计数 */
piVar2 = (int *)(conn + 0xc0 + type * 4);  *piVar2 += getPacketSize(pkt) + other; /* 每类型字节计数（带宽统计） */
```

### 8.2 PING/PONG 窗口：21 项历史（`MAXPINGS = 20`）

```asm
; 0x460390 起（ping 统计函数；断言 m_PingData.size()==MAXPINGS+1 站点 0x4604f4）
  4603bb:	mov    0x130(%rbx),%rbp      ; 计数
  4603c2:	add    $0x1,%rbp
  4603c6:	mov    %rbp,0x130(%rbx)
  ...
  4603fb:	addq   $0x1,0x128(%rbx)      ; m_PingData.size() 的滚动计数
  460403:	mov    0x138(%rbx),%rax
  46040a:	add    %r15,%rax             ; Σ elapsed
  46040d:	mov    %rax,0x138(%rbx)      ; m_PingDataSum
  460414:	mov    %r15,%rcx
  460417:	imul   %r15,%rcx
  46041b:	add    0x140(%rbx),%rcx
  460422:	mov    %rcx,0x140(%rbx)      ; Σ elapsed²（算抖动用）
  460429:	cmp    $0x15,%rbp            ; ★ 21 = MAXPINGS + 1
  46042d:	jb     46084f
  460433:	je     46060f
```

结合断言 `m_PingData.size() == MAXPINGS + 1`，得 **`MAXPINGS = 20`**（[观测] 立即数 `0x15`，[推断] 减法一步）。
`m_PingDataSum` 与 `Σ elapsed²` 两项说明 RTT 统计用**滑动窗口 + 方差**（不是简单平均）。

### 8.3 重传：`RESENDING` 是 `COMMAND_LOW` 的包装

断言 `getType() == COMMAND_LOW` + `!hasFragmentFlag()` + `original.getPacketSize() == getPacketSize()`（§2.3 已引）说明：

```
                  ┌──────────── COMMAND_LOW（可靠、有序、会重传）─────────────┐
  OutgoingCommandLowPacket ──(需要分片时)──► OutgoingResendingPacket ──► 多个 COMMAND_LOW 分片
                  │  分片上限 = get_packet_mtu(is_ipv6) ∈ {500, 1108}                      │
                  └──────────────────────────────────────────────────────────────────────┘
  COMMAND（不可靠、单包）        VOICE / VOICE_WHISPER / PING / PONG / ACK / ACK_LOW（不可靠，不重传）
```

关键判据：`isResendingPacketType(packetType)` 在 `connection.cpp` 与 `packethandler` 里被反复断言 → **只有特定类型参与重传**，
而 `packethandler_base.cpp` 的 `packetType == COMMAND_LOW` 断言把范围收窄到 `COMMAND_LOW`。

超时/窗口的**数值仍未确认**——这一点有明确阴性证据：`OutgoingResendingPacket`（`0xa9e3f0`，14.5 KB 伪代码）里出现的数值常量只有
`0x454`(MTU 1108)、`0xb`(11)、`0x10`/`0x18`(16/24)、`0x40`、`0x88` 与一批断言行号，**没有任何毫秒级常量**，
说明重传定时器不在包类内部，而在 `Connection` 的定时器/异步回调层（未定位）。

能确认的只有行为与日志：

```bash
$ strings -a ts3server | grep -E 'Resending packet|ping timeout|missed'
Resending packet missed arrival window
 because of ping timeout 
```

`Resending packet missed arrival window` 表明重传有「允许到达的时间窗」，超窗即放弃；`because of ping timeout ` 用于踢人。

### 8.4 丢包率度量（三类分流）

```bash
$ strings -a ts3server | grep -E 'packetloss_(control|keepalive|speech|total)'
client_packetloss_control      client_packetloss_keepalive
client_packetloss_speech       client_packetloss_total
server_packetloss_control      server_packetloss_keepalive
server_packetloss_speech       server_packetloss_total
```

**三种流量类被分别统计丢包**（`control` / `keepalive` / `speech`）—— 这反过来证明协议实现**明确区分三类流量**，
与 §2 的类型划分一致（COMMAND=control，PING/PONG=keepalive，VOICE=speech）。

### 8.5 连接限流（防 DoS 的两道闸）

| 组件 | 证据 | 作用 |
|---|---|---|
| `13PacketLimiter` | 服务端 RTTI 名 | 按包速率/字节率限流（puzzle 与限流同在 `packet/packetlimiter.cpp`） |
| `26Pending_Connection_Limiter` | 服务端 RTTI 名 | 限制「握手未完成」的半开连接数 |
| `SCBody_Pending_Connection_Limiter` | 服务端 RTTI 名 | 上面那个的 `ServerChange` 变更体（配置项） |

```bash
$ strings -a ts3server | grep -oE '[0-9]+(PacketLimiter|Pending_Connection_Limiter)'
13PacketLimiter
26Pending_Connection_Limiter
```

`packetlimiter.cpp` 与 `rsa_puzzle.cpp` 同在一处，说明 **puzzle 是限流机制的一部分**：达到阈值 → 下发 RSA puzzle → 客户端必须消耗算力才算「付过费」。
`COMMAND_SOLVE_PUZZLE data too large`（客户端字符串）说明 puzzle 的应答也走 **COMMAND** 通道。

---

## 9. 压缩：只有 COMMAND 通道用 QLZ

```bash
$ strings -a ts3server | grep -E 'qlz|Command Packet size'
Command Packet size limit exceeded, discarding packet
Command Packet size decompression size mismatch, discarding packet
N5boost19thread_specific_ptrI20qlz_state_decompressE11delete_dataE
N5boost19thread_specific_ptrI18qlz_state_compressE11delete_dataE
```

| 观测 | 结论 |
|---|---|
| `thread_specific_ptr<qlz_state_compress / qlz_state_decompress>` | 用 **QLZ**（FastLZ 变种）压缩，状态**按线程隔离**（每线程一个压缩上下文，避免加锁） |
| `Command Packet size limit exceeded, discarding packet` | COMMAND 解压前有**上限检查**（防解压炸弹） |
| `Command Packet size decompression size mismatch, discarding packet` | 解压后长度必须与声明一致，否则丢包 |

`thread_specific_ptr` 属于 boost，而服务端其他部分是 libc++（`_ZNSt3__1...`），说明这段代码来自 common_lib 的 boost 依赖层。

**压缩由包头 flags 中的一个 bit 指示**（[推断]）——`0x49b240` case 2/3 里出现的 `and $0x40,%cl`（测 `m_Data[12]` 的 bit6）很可能就是
「compressed」或「fragment」标志，但**未能把 bit 与语义一一绑定**（见 §13）。

---

## 10. 语音编码与数据面时序

### 10.1 采样率与帧长（[观测] 断言）

```bash
$ strings -a ts3server | grep 'decode.cpp'
Assertion "numberVoicePackets > 0 && voiceDataSize % numberVoicePackets == 0" failed at .../sound/decode.cpp:
Assertion "status == 2" failed at .../sound/decode.cpp:
Assertion "channels == 1 || channels ==2" failed at .../sound/decode.cpp:
Assertion "m_Channels==1 || codec == CODEC_OPUS_MUSIC" failed at .../sound/decode.cpp:
Assertion "m_PeriodSizeInSamples == var" failed at .../sound/decode.cpp:
Assertion "m_SampleRate == 8000" failed at .../sound/decode.cpp:
Assertion "channels == 2" failed at .../sound/decode.cpp:
```

| 断言 | 含义 |
|---|---|
| `m_SampleRate == 8000` | 存在一条 **8 kHz** 窄带通路（Speex/CELT 窄带；Opus 全带另有 48 kHz 路径） |
| `m_PeriodSizeInSamples == var` | 帧长（period）必须与配置一致 → 固定帧长编码 |
| `m_Channels==1 \|\| codec == CODEC_OPUS_MUSIC` / `channels == 2` | 语音=单声道，音乐=立体声（`OPUS_MUSIC`） |
| `voiceDataSize % numberVoicePackets == 0` | 一个语音包里装的是**等长帧序列**，解码时按 `size / count` 切帧 |

### 10.2 编码器家族与演进

```bash
$ strings -a ts3server | grep -E 'Speex|CELT|Opus'
Channels with Speex or CELT codec have been updated to Opus.
```

→ 现役 `Opus`，历史 `Speex` / `CELT`。客户端还有 `CODEC_CELT_MONO` / `CODEC_OPUS_VOICE` / `CODEC_OPUS_MUSIC` 三个可区分取值（§4.3）。

### 10.3 语音编码器的**独立加密层**（与 EAX 不同）

```bash
$ strings -a ts3server | grep -E 'codec_is_unencrypted|codec_encryption_mode'
channel_codec_is_unencrypted=1
channel_codec_is_unencrypted=0
virtualserver_codec_encryption_mode
```

配合 `virtualserver_encryption_ciphers` 默认值 `AES-256,AES-128` 与 `no common encryption algorithms`，可确认**两层加密**：

```
   ┌── 层 1：传输层 AEAD（EAX / AES-128 / 16B nonce / 8B tag）—— 强制，所有 UDP 包
   └── 层 2：语音编码器级加密（codec_encryption_mode, AES-256/AES-128 协商）—— 可选，按频道/虚拟服务器配置
```

层 2 的报文格式**未确认**（它作用在 codec payload 内部，需要看 `sound/decode.cpp` 的解密路径）。

---

## 11. 与 ServerQuery 文本协议的关系

### 11.1 同构点：ServerQuery 复用 `Connection` + `Packet_Flags`

服务端 RTTI 里，ServerQuery 的终端类把 `Packet_Flags` 作为回调参数：

```bash
$ strings -a ts3server | grep -oE '[0-9]+(Query_[A-Za-z_]+|Packet_Flags)' | sort -u
10Connection
12Packet_Flags
13Query_Manager
18Query_Raw_Terminal
18Query_Ssh_Listener
18Query_Pty_Terminal
19Query_Http_Request
19Query_Http_Response
20Connection
21Connection
21Query_Api_Key_Manager
```

具体方法是：

```bash
$ strings -a ts3server | grep -oE 'Query_Raw_Terminal9read_line[A-Za-z0-9_]*' | head -2
Query_Raw_Terminal9read_lineENSt3__18functionIFvN5boost6system10error_codeENS0_12basic_stringIcNS0_11char_traitsIcEENS0_9allocatorIcEEEE12Packet_FlagsEEEE3
```

解析：`Query_Raw_Terminal::read_line(std::function<void(boost::system::error_code, std::string, Packet_Flags)>)`
→ **文本行被解析成携带 `Packet_Flags` 的单元**，与 UDP 包共用同一套 flag 语义/连接基类。

`Query_Pty_Terminal::continue_read_line(...)` 多了 `unsigned long` 参数（字节计数），与 PTY 终端一致。

### 11.2 差异点

| 维度 | UDP 语音/控制面 | ServerQuery 文本面 |
|---|---|---|
| 承载 | UDP，单包自包含 | TCP 流，`\n`/`\r\n` 分帧；另有 SSH(10022) 与 HTTP/JSON(10080) |
| 编码 | 二进制 + EAX | 纯文本 `cmd key=value key=value` |
| 分帧 | 每 datagram 一个包，13 字节头 | 按行；SSH 走 PTY；HTTP 走请求/响应 |
| 可靠性 | 自建 ACK/重传（§8） | 由 TCP 保证；无应用层 ACK 包 |
| 应答终结 | — | 每命令以 `error id=<n> msg=<text>` 收尾 |
| 加密 | EAX/AES-128（强制） | 明文（10011）/ SSH（10022）/ HTTP 或 HTTPS（10080/`query_https_port`） |
| 端口来源 | `default_voice_port` | `query_port` / `query_ssh_port` / `query_http_port` / `query_https_port` |

### 11.3 应答格式与错误码表（[观测] 文档 + 字符串表）

文档里 149 处一致的应答终结：

```bash
$ grep -rhoE 'error id=[0-9]+ msg=[a-z_]+' serverquerydocs/ | sort | uniq -c
    149 error id=0 msg=ok
```

非 0 错误码的**文本表**在服务端 `.rodata` 中连续排布（顺序即 id 递增；id 0 = `ok` 由文档确认）：

```bash
$ strings -a ts3server | sed -n '/^undefined error$/,/^convert error$/p' | head -20
undefined error
library time limit reached
out of memory
command not found
unable to bind network port
no network port available
port already in use
nickname is already in use
invalid error code
max clients protocol limit reached
invalid client type
already subscribed
not logged in
could not validate client identity
invalid loginname or password
too many clones already connected
client version outdated, please update
client is online
client is flooding
client is modified
...
```

> 该表给出的是**错误文本**，不是数值。数值映射（表内第 k 项 → id k+1）是 [推断]，需用 `serverquery` 触发若干错误码实测（§13.3）。

### 11.4 命令语法（[观测] 文档）

```bash
$ sed -n '1,12p' serverquerydocs/servernotifyregister.txt
Usage: servernotifyregister
       event={server|channel|textserver|textchannel|textprivate}
       [id={channelID}]
...
Example:
  servernotifyregister event=server
  error id=0 msg=ok
```

即：`<command> [key=value]*`，值的转义用反斜杠（文档里 `\/image.iso`、`itRNdsIOvcBiBg\/Xj4Ge51ZSrsShHuid`），
多个返回行按 `key=value key=value` 分字段，多行之间用 `|` 分隔（TS3 惯例；本文档未直接取证，标 [未确认]）。

### 11.5 事件推送（notify）

`servernotifyregister` 的五种 `event=` 取值 + `Query_Raw_Terminal` 的回调结构，
说明 ServerQuery 是**请求/应答 + 异步事件推送**混合模型：注册后服务端主动下行 `notify*` 行。

---

## 12. 未确认项清单 + 运行时验证方案

### 12.1 未确认项（按影响排序，含本轮 Ghidra 反编译后的状态更新）

| # | 内容 | 状态 | 说明 |
|---|---|---|---|
| U1 | 类型/flags 字节的**位分配** | **部分确认** | 「低 4 位 = 类型（0..8）」有两处独立支持：合法性函数用 `m_Data[12] & 0xf` 索引 9 项表与 9 项跳转表；INIT1 写死 `0x88`（低半字节 8 = INIT1）。**仍未确认**的是 flags 各位的具体语义（`0x40`、`0x10`、`0x08` 分别是什么） |
| U2 | 出站 11 字节 / 入站 13 字节头的**2 字节差** | **仍未知** | 已排除「PacketID 插在 +11」：伪代码证明 PacketID 是 **BE16 @ `m_Data[8..9]`**，两侧同偏移。差异落在 `[10..11]`，机制未定位（详见 §3.6 的两种假设与最小验证） |
| U3 | `get_packet_mtu` 与 IPv4/IPv6 对应 | **已确认** | 伪代码：`is_v6 = endpoint.is_v6()` → `500`（IPv4）/ `0x454=1108`（IPv6）；`is_ipv6` 由调用方算成 `*(conn+0x400) != AF_INET(2)` |
| U4 | `PUZZLE_DATA_SIZE_n` 是否 64 | **仍未知** | 只有三处 `cmpq $0x40`，第三处与 `n_len` 断言未一一绑定 |
| U5 | Nonce 是否随包变化 | **已确认（且强于预期）** | 每包 `SHA-256` 派生 `key[16] || nonce[16]`，输入含 4 字节 BE 计数器 → nonce 必然逐包变化（§7.6）。**残留**：KDF 内部「每类型 × 每 mode」缓存命中时是否复用派生结果，未确认 |
| U6 | INIT1 的 `+8..+16`(9B) 与 `+17`(1B) 字段语义 | **仍未知** | 只有 `m_Data[17]` 与 `0x7f` 比较、最少 14 字节这两个事实 |
| U7 | `Shared_Secret_Type` 枚举成员 | **仍未知** | 只有断言文本 `type != Shared_Secret_Type::invalid` |
| U8 | 语音包 codec 字段的 bit 位置 | **仍未知** | 只看到 `min(x,7)` 与 `x*8` 的截断/移位线索 |
| U9 | ACK/重传的**超时数值与窗口** | **仍未知** | `OutgoingResendingPacket`（`0xa9e3f0`）伪代码里只有 `0x454`(MTU)、`0xb`(11)、`0x10/0x18`(16/24) 等常量，**没有任何毫秒级超时常量** → 定时器在别的类（Timer/AsyncCallback）里 |
| U10 | 语音编码器级加密（层 2）报文格式 | **仍未知** | 未读 `sound/decode.cpp` 的解密分支 |
| U11 | whisper 目标 id 宽度 | **仍未知** | 只见 `count ≤ 255` |
| U12 | `Packet_Flags` 位定义 | **仍未知** | 只有类型名与它在 `read_line` 回调里的位置 |

**本轮（Ghidra 检查点复用后）新增确认的字段宽度**（可直接引用）：

| 字段 | 宽度 | 位置 | 证据 |
|---|---|---|---|
| PacketID | **16 位（大端）** | `m_Data[8..9]` | 0x49fce0 伪代码 `*(ushort*)(m_Data+8) = bswap16(v)` |
| PacketID epoch | 64 位（不上线缆） | `pkt+0x18` | 0x49fcf0 伪代码 |
| `m_PacketID[type]` 元素 | 16 字节 | `conn+0x260` 向量 | 0x45e220 `sar $0x4` + 结构 `{u16 ctr; u64 epoch}` |
| AES key | 16 字节 | KDF 摘要 `[0..15]` | §7.6 |
| EAX nonce | 16 字节 | KDF 摘要 `[16..31]` | §7.6 |
| EAX tag | 8 字节 | `m_Data[0..7]` | §7.4 |
| 头部（加密入站） | 13 字节 | `m_Data[0..12]` | §3.1/§7.3 |
| 头部（出站构建期） | 11 字节 | `m_Data[0..10]` | §3.6 |
| 每类型最大包长 | uint16 × 9 | 表 `0xbb2150` | §3.4 |
| MTU | 500 (IPv4) / 1108 (IPv6) | 立即数 ×3 处 | §5.1 |

### 12.2 抓包验证（Wireshark 思路）

**前提**：密钥是握手产物，静态不可得；但**结构**可完全验证，且**部分字段可无密钥读**。

1. **抓包点**：`tshark -i lo -f "udp port 9987"`；客户端连本机 `ts3server`。
2. **短包分类**（无需解密）：
   - 长度 15 字节的包 → 应为 PING/PONG/ACK/ACK_LOW（§3.5 case 4..7 判据）；
   - 长度 ≥ 16 且前 8 字节为 `TS3INIT1` → INIT1；
   - 长度 ≤ 500（IPv4）或 ≤ 1108（IPv6）→ 语音/控制。
3. **验证 §3.1/§3.2**：把每个 datagram 按 `[0:8]=tag, [8:13]=hdr, [13:]=ct` 切片；
   若 `hdr` 第 3 字节（即 datagram[10]）的低半字节稳定落在 `0x0,0x1,0x2,0x3,0x4,0x5,0x6,0x7,0x8` 且与 §2.1 顺序吻合 → **U1 部分的低半字节=类型假设成立**。
   `tshark -T fields -e data.data` 后用 20 行 Python 统计 `datagram[10] & 0x0f` 的直方图即可。
4. **验证 §3.6（U2）**：对比「客户端发出的 datagram 长度」与「服务端 `m_DataSize` 相关日志」；
   更好的办法：把 INIT1 之后第一个 `COMMAND_LOW` 的 datagram 长度与其内层声明长度对齐，看是否恒定多 2 字节。
5. **验证 U5（nonce 唯一性）**：用**同一明文**（例如连续两次 `clientupdate client_nickname=x`）触发两个包，
   比较 datagram[8:13]（认证头）与整体密文：若密文完全一致 → nonce 未变（重放风险）；若仅 tag 变化 → nonce 变了。
6. **验证 U3（MTU 方向）**：在纯 IPv4 与纯 IPv6 下各发一个最大尺寸 `COMMAND`，观察被拒阈值是 500 还是 1108。
7. **验证 U4（puzzle 尺寸）**：抓 INIT1 往返，量出 puzzle 段的字节长度（应为 64 的倍数）。
8. **验证 §9（QLZ）**：抓一个大 `COMMAND`，看 `datagram[10]` 的 bit6（压缩标志候选）是否置位、负载是否以 QLZ 头开始（`0x00/0x01` 版本字节 + 长度）。

### 12.3 动态插桩验证（若允许运行）

| 目标 | 方法 |
|---|---|
| U1/U2 一次性定位 | 在 `0x49b240`（合法性函数）下断点，dump `rdi` 指向的 `m_Data[0..20]`；再在 `0x4a01c6`（加密调用）前 dump 同一缓冲 → 两个视角的字节直接对齐，2 字节差异立刻明确 |
| U5 | 在 `0x49b443`（decrypt）断点，dump ②`key` 与 ④`nonce` 各 16 字节，连续两次比较 nonce 是否变化 |
| U6 | 在 `0x49b2e4` 断点，dump `m_Data[0..24]`，配合 `0x7f` 比较语义 |
| U8 | 在 `0xaa0c2c`（`orb $0x40`）与 `0xaa0c63`（`orb $0x10`）断点，同一时刻 dump `m_Data[10]` 与调用参数 → 得到 flags 位的因果 |
| U9 | 在 `0xa9e3f0`（分片/重传）与 `0x4631b0`（ACK 等待）断点，记录相邻两次调用的时间差 = 重传超时 |

### 12.4 可继续做的静态工作（低成本）

1. `0xa98000`（`packethandler_base` 发送路径，约 4 KB）：专找「往 `m_Data[11..12]` 写值」与「`memmove` 平移 payload」——直接终结 U1/U2。
2. `0x49be60`（`IncomingPacket::process`，3.7 KB）：`switch(packetType)` 后每个 case 的解析代码 → 每类型字段表。
3. `0xa9e3f0`（`OutgoingResendingPacket`，约 3.6 KB）：找超时常量与窗口大小 → U9。
4. `0xae6750`（`decode.cpp` 语音拆包）：`voiceDataSize / numberVoicePackets` 与 codec 位域 → U8。
5. `0x4631b0` / `0x462e40`（ACK 等待表）：ACK 包的字段与 `pid` 宽度。

---

## 13. 附录 A：断言 → 函数 地图（服务端，全部 VA 可复现）

用于把源码位置映射到二进制地址。生成方式见 §0.2。

| 源文件:行 | 断言 | 站点 | 函数区间 |
|---|---|---|---|
| `incomingpacket.cpp:111` | `m_State == ENCRYPTED` | `0x49b7e3` | `0x49b700–0x49b9ef` |
| `incomingpacket.cpp:110` | `!packetList.empty()` | `0x49bfcf` | `0x49be60–0x49ccff` |
| `incomingpacket.cpp:124` | `getHeaderSize() <= it->m_DataSize` | `0x49c1ef` | `0x49be60–0x49ccff` |
| `incomingpacket.cpp` | `getVoiceDataSize() == 0` | `0x49d666` | `0x49d510–0x49d817` |
| `incomingpacket.cpp` | `isChannelClientTarget()` | `0x49daa0` | `0x49d9c0–0x49dce2` |
| `incomingpacket.cpp` | `!isChannelClientTarget()` | `0x49e66a` | `0x49e590–0x49e829` |
| `outgoingpacket.cpp:110` | `m_State == READABLE` | `0x49fe27` | `0x49fd30–0x4a0844` |
| `outgoingpacket.cpp` | `m_DataSize <= get_packet_mtu(is_ipv6)` | `0x4a0070` | `0x49fd30–0x4a0844` |
| `outgoingpacket.cpp:111` | `taglen == TAG_LENGTH` | `0x4a043f` | `0x49fd30–0x4a0844` |
| `outgoingresendingpacket.cpp` | `needsSplitting(is_ipv6)` | `0xa9e4f3` | `0xa9e3f0–0xa9f1b9` |
| `outgoingresendingpacket.cpp` | `getType() == COMMAND_LOW` | `0xa9e820` | `0xa9e3f0–0xa9f1b9` |
| `outgoingresendingpacket.cpp` | `packet->getPacketSize() <= get_packet_mtu(is_ipv6)` | `0xa9ea7f` | `0xa9e3f0–0xa9f1b9` |
| `outgoingresendingpacket.cpp` | `!hasFragmentFlag()` | `0xa9eca0` | `0xa9e3f0–0xa9f1b9` |
| `outgoingresendingpacket.cpp` | `original.getPacketSize() == getPacketSize()` | `0xa9f94b` | `0xa9f830–0xa9fbda` |
| `outgoingvoicepacket.cpp:120` | `numberVoicePackets < 256` | `0xaa0e1d` | `0xaa0ba0–0xaa1006` |
| `outgoingvoicepacket.cpp` | `count <= 255 && count == channelListSize` | `0xaa2614` | `0xaa2480–0xaa2b59` |
| `outgoingvoicepacket.cpp` | `count <= 255 && count == clientListSize` | `0xaa28ed` | `0xaa2480–0xaa2b59` |
| `packetlimiter.cpp:228` | `x_len == PUZZLE_DATA_SIZE_x && X_len == ...` | `0xadf332` | `0xadeff0–0xadf8c2` |
| `packetlimiter.cpp` | `info->n_len == PUZZLE_DATA_SIZE_n` | `0xadf537` | `0xadeff0–0xadf8c2` |
| `packetlimiter.cpp` | `m_PuzzleSource` | `0xadfc43` | `0xadfb00–0xadfe8d` |
| `packetlimiter.cpp` | `prngIdx >=0` | `0xadff8b` | `0xadfe90–0xae0b7d` |
| `packetlimiter.cpp` | `err==CRYPT_OK` | `0xae0194` | `0xadfe90–0xae0b7d` |
| `rsa_puzzle.cpp` | `my_sz <= bytesNeeded` | `0xae3bef` | `0xae31f0–0xae4199` |
| `connection.cpp` | `m_iClientID == 0 && clientID != 0` | `0x45cd2a` | `0x45cc30–…` |
| `connection.cpp` | `!m_handShakeConfirmedIP` | `0x45d63f` | `0x45d540–…` |
| `connection.cpp` | `packetType < m_PacketID.size()` | `0x45e315` | `0x45e220–…` |
| `connection.cpp` | `type != Shared_Secret_Type::invalid` | `0x45eb6a` | `0x45ea90–…` |
| `connection.cpp` | `!m_cryptoInitComplete` | `0x45ee84` | `0x45ed80–…` |
| `connection.cpp` | `outputlen == SHA256LEN` | `0x461027` | `0x460ba0–…` |
| `connection.cpp` | `j == m_SortedPacketList[packetType].end()` | `0x461e8d` | `0x461910–…` |
| `connection.cpp` | `j->second->hasFragmentFlag()` | `0x4623e3` | `0x461910–…` |
| `connection.cpp` | `packetType < m_AckWaitIterList.size()` | `0x462f5b` | `0x462e40–…` |
| `connection.cpp` | `m_AckWaitIterList[...].find(pID) == end()` | `0x463542` | `0x4631b0–…` |
| `connection.cpp` | `isResendingPacketType(packetType)` | `0x463c86` | `0x463b80–…` |
| `connection.cpp` | `m_PingData.size() == MAXPINGS + 1` | `0x4604f4` | `0x460390–…` |
| `connection.cpp` | `m_PingDataSum >= elapsedPongTime` | `0x4606ce` | `0x460390–…` |
| `packethandler_base.cpp` | `packetType == COMMAND_LOW` | `0xa979f2` | `0xa969d0–…` |
| `packethandler_base.cpp` | `!skipPacketIDBranding \|\| ...INIT1...` | `0xa98118` | `0xa98000–…` |
| `packethandler_base.cpp` | `packet->getType() == packetType` | `0xa98309` | `0xa98000–…` |
| `packethandler_base.cpp` | `... <= get_packet_mtu(peer.is_v6()) \|\| VOICE_WHISPER` | `0xa9874b` | `0xa98000–…` |
| `packethandler_base.cpp` | `!isResendingPacketType(packetType)` | `0xa989c4` | `0xa98000–…` |
| `packethandler_base.cpp` | `... <= get_packet_mtu(endpoint.address().is_v6())` | `0xa99dbd` | `0xa99c80–…` |
| `sound/decode.cpp` | `numberVoicePackets > 0 && voiceDataSize % numberVoicePackets == 0` | `0xae6c54` | `0xae6750–…` |
| `sound/decode.cpp` | `status == 2` | `0xae78fe` | `0xae6750–…` |
| `sound/decode.cpp` | `channels == 1 \|\| channels ==2` | `0xae5936` | `0xae5850–…` |
| `sound/decode.cpp` | `m_Channels==1 \|\| codec == CODEC_OPUS_MUSIC` | `0xae5d6b` | `0xae5850–…` |
| `sound/decode.cpp` | `m_PeriodSizeInSamples == var` | `0xae87a5` | `0xae82c0–…` |
| `sound/decode.cpp` | `m_SampleRate == 8000` | `0xae91d6` | `0xae8d40–…` |
| `sound/decode.cpp` | `channels == 2` | `0xae8e90` | `0xae8d40–…` |
| `common_crypt_functions.cpp` | `outputlen == 20` | `0x91572c` | `0x915490–…` |
| `common_crypt_functions.cpp` | `memorySize >= memoryWriten` | `0x915e25` | `0x915d10–…` |
| `common_crypt_functions.cpp` | `error == ERROR_ok` | `0x916289` | `0x916170–…` |
| `common_crypt_functions.cpp` | `length <= 40` / `length > 0` | `0x916f23` / `0x916b6d` | `0x916a60–…` |
| `randomnumber.cpp` | `len == yarrow_desc.export_size` | `0x90f36e` | `0x90f270–…` |

> `…` 表示该函数 FDE 尾部未逐一记录；起点与站点地址是精确的。

## 14. 附录 B：常量速查表

| 常量 | 值 | 出现地址 | 含义 |
|---|---|---|---|
| 头部长度（入站加密） | 13 (`0xd`) | `0x49b243`, `0x4a0cf5`, `0x49b419` | `getHeaderSize()` |
| 头部长度（出站明文） | 11 (`0xb`) | `0x4a019e`, `0x4a01bd` | 加密调用时的 `size-11` |
| EAX 标签长度 | 8 (`TAG_LENGTH`) | `0x49ff67`, `0x4a0372`, `0x49b437` | MAC 截断到 64 bit |
| EAX 关联数据长度 | 3（出）/5（入） | `0x4a01c4` / `0x49b441` | `hdrlen` |
| AES key 长度 | 16 | `0x49b425`, `0x4a01a9` | AES-128 |
| nonce 长度 | 16 | `0x49b42a`, `0x4a01ae` | 与 key 同长 |
| 默认 key→nonce 偏移 | 16 (`0x10`) | `0x49b906` | key|nonce 连续布局 |
| MTU（IPv4 侧） | 500 (`0x1f4`) | `0x49ff9c`, `0xa9e40e`, `0xa9865e` | `get_packet_mtu` |
| MTU（IPv6 侧） | 1108 (`0x454`) | `0x49ff97`, `0xa9e409`, `0xa98659` | `get_packet_mtu` |
| 每类型最大包长 | `500,9000,1108,1108,50,50,50,50,1108` | 表 `0xbb2150` | 按 PacketType 索引的 `uint16[9]` |
| 类型分派跳转表 | 9 项 s32 | 表 `0xbb2110` | case 0..8 |
| 类型名称表 | 10 槽（9 名 + NULL） | 表 `0xfaf120` | 名称→`getName()` |
| `TS3INIT1` 魔数 | 8 B ASCII | 常量 `0xfd91a0`，比较 `0x49b2d8` | INIT1 前缀 |
| INIT1 类型字节 | `0x88` | `0x4a0ec1`, `0x4a1048`, `0x4a119f` | `m_Data[10] = 0x88` |
| INIT1 额外字节比较 | `0x7f` | `0x49b2ea` | `m_Data[17]` 上限 |
| 语音 16 位字段 | 大端（`rol $0x8`） | `0xaa0bfe` | 序列号类字段 |
| 语音 flags 位 | `0x40`, `0x10` @ `m_Data[10]` | `0xaa0c2c`, `0xaa0c63` | 两个独立 flag |
| 每包语音帧上限 | 256 (`0x100`) | `0xaa0d4d` | `numberVoicePackets` |
| whisper 列表项上限 | 255 | 断言文本 | channel/client 列表 |
| `MAXPINGS + 1` | 21 (`0x15`) | `0x460429` | ping 历史窗口 |
| `m_PacketID` 元素大小 | 16 B | `0x45e248` (`sar $0x4`) | 每类型计数器容器 |
| `SHA256LEN` | 32（LibTomCrypt 宏） | 断言 `outputlen == SHA256LEN` | 握手摘要 |
| puzzle `x`/`X` 长度 | 64 (`0x40`) | `0xadf248`, `0xadf253` | `PUZZLE_DATA_SIZE_x` |
| puzzle `n` 长度 | 64（[推断]） | `0xadf451` | `PUZZLE_DATA_SIZE_n` |
| 默认端口 9987/30033/10011/10022 | — | `doc/server_quickstart.md` | 文档默认值 |
| 默认端口 10080 | `0x2760` | `0x41058f` | `query_http_port` |
| 密码学库名 | `rijndael` | 字符串 `0xc12559`，使用 `0x4a0581` | `crypt_find_cipher` |
| 哈希库名 | `sha256` | 字符串，使用 `0x460ba0` 内 `FUN_0074f440` | `crypt_find_hash` |
| KDF 输出长度 | 32 (`0x20`) | `0x460ba0` 伪代码 `local_190 = 0x20` | SHA-256 摘要 → key+nonce |
| KDF 输入长度 | 26 或 70 (`__n+6`, `__n`=20 或 64) | `0x460ba0` 伪代码 | 见 §7.6 |
| KDF 首字节 | `0x30` / `0x31`（type==1 时 +1） | `0x460ba0` 伪代码 `*__s = (type==1) \| 0x30` | 域分隔符 + 类型标志 |
| 连接密钥材料 | `conn+0x158`，长度选择器 `*(int*)(conn+0x160)` | `0x460ba0` 伪代码 | 20 B / 64 B 两档 |
| PacketID | uint16 大端 | `0x49fce0` 伪代码（`m_Data+8`） | 线上字段 |
| PacketID epoch | uint64 | `0x49fcf0` 伪代码（`pkt+0x18`） | 仅本地，防回绕重放 |
| `m_PacketID[type]` | 16 B（`u16 ctr` + `u64 epoch`） | `0x45e220` 伪代码 | 每类型计数器 |
| 每类型发包/字节计数 | uint32 × 2 数组 | `conn+0x78+type*4`、`conn+0xc0+type*4` | 带宽统计（带 `LOCK`） |
| 语音编码器加密族 | `AES-256,AES-128` | 服务端字符串 | `virtualserver_encryption_ciphers` 默认值 |

---

## 15. 一页结论（TL;DR）

1. **所有语音与控制流量共用一个 UDP 5 元组（默认 9987）**；语音服务器侧的 TCP 只承载文件传输（30033，`ftkey` 鉴权），ServerQuery 另有 10011/10022/10080（含 `query_https_port`）。**语音服务器没有独立的 TCP 命令通道**（[推断]：客户端 RTTI 里没有任何面向语音服务器的 TCP 包类型）。
2. **9 种包类型**，顺序 `VOICE, VOICE_WHISPER, COMMAND, COMMAND_LOW, PING, PONG, ACK, ACK_LOW, INIT1`；**`RESENDING` 与 `CONFIRMATION` 不是线缆类型**，前者是 `COMMAND_LOW` 的分片/重发包装。
3. **包头 = 8 字节 EAX 标签 + 3/5 字节认证头 + 变长密文**；入站 `getHeaderSize() = 13` 由立即数 `0xd`、伪代码 `param_1[4] = 0xd`、`size < 0xd` 拒绝、`memcpy(dst, m_Data+0xd, ...)` 四重确认。**PacketID = 16 位大端，位于 `m_Data[8..9]`**（`setPacketID` 伪代码直接 `bswap16` 写入），另有 64 位 epoch 只存在于对象内。类型/flags 字节写侧 `+10`、读侧 `+12`，**这 2 字节差是唯一剩下的结构性未知**（§3.6）。
4. **语音通道加密 = AES-128（16 B key）+ 16 B nonce + EAX + 8 B 截断标签**；不是 CTR，不是 GCM。AEAD 层零膨胀（原地加解密），每包固定 +8 B。**更关键：key 与 nonce 是每包由 SHA-256 现算的**——`H(0x30|typeflag ‖ mode ‖ BE32(counter) ‖ 20/64B 连接密钥材料)` → 32 字节，前 16 作 key、后 16 作 nonce，key 首 2 字节再翻转（§7.6）。
5. **`get_packet_mtu()` 的两个返回值是 500 与 1108**（立即数 `0x1f4`/`0x454`）；`VOICE_WHISPER` 被 MTU 豁免（上限 9000），`COMMAND`/`COMMAND_LOW`/`INIT1` 上限 1108，`PING/PONG/ACK/ACK_LOW` 上限 50。
6. **INIT1 用独立的包格式**：以 ASCII `TS3INIT1` 开头 8 字节（非常规 EAX 标签），最小 14 字节，`m_Data[17]` 参与 `0x7f` 比较，类型字节写死 `0x88`。
7. **防 DoS = RSA puzzle（`PacketLimiter`）**：puzzle 的 `x`/`X` 各 64 字节、`n` 推定 64 字节（RSA-512 量级），服务端用 boost 线程 + Yarrow PRNG **预计算**；客户端 `COMMAND_SOLVE_PUZZLE` 回解。
8. **无 FEC**；服务端只做 Speex 抖动缓冲；丢包按 `control`/`keepalive`/`speech` 三类分别统计。PING 窗口 21 项（`MAXPINGS=20`）并统计 `Σt` 与 `Σt²`（含抖动）。
9. **COMMAND 通道有 QLZ 压缩**（线程局部状态 + 解压上限 + 解压长度校验），语音通道不压缩。
10. **存在两层加密**：传输层 EAX（强制）+ 语音编码器级加密（`codec_encryption_mode`，协商 `AES-256,AES-128`，按需）。`teamnative_crypto` 的 `Aes256_Impl_*`/CTR/OFB/PKCS7 属于**许可证与 SSH 路径**，与语音无关——这一点极易误判，需特别注意。