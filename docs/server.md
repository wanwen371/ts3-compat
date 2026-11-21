# 05 · TeamSpeak 3 服务端（ts3server 3.13.9 Linux x86-64）逆向笔记

> 目标：`/home/gaozikun/1017/ts3-server/teamspeak3-server_linux_amd64/ts3server`
> ELF 64-bit LSB **EXEC**（非 PIE）· x86-64 · stripped · BuildID `51f58ddfc2878aa2d2238393364471e43d32a8f7`
> SHA-256 `9e37899d3cf2b81e449ba1b23cb78cec98e6ae3116f7bc05422e5160b6d60c5f` · 13,701,328 字节
>
> 全程**只读**：未运行 ts3server 本体、未改写目标目录、未联网、未安装软件。
> 本文件只覆盖**服务端**；客户端见 `01-architecture.md`。

## 结论速览（先看这 5 条）

| # | 结论 | 关键证据 |
|---|---|---|
| 1 | **服务端对语音只做透明转发，不编码也不解码。** 编码器完全不存在；解码栈虽被链入但被常量桩接管，批量解码函数零调用者 | §9.2 `encod` 全量搜索无音频编码器；§9.3 `DecodeManagerServer` 业务虚函数是 7 条指令常量桩；§9.4 `FUN_ae6750` 调用者为空、唯一引用是 vtable 槽 |
| 2 | 语音转发单元是「每 VirtualServer 一套 `VoiceStreamer`(24 槽) + `DecodeManagerServer`」，随 `VirtualServerManager` 构造 | §5.1 `FUN_50b280` 构造序列；§9.3 |
| 3 | 端口与默认值可直接从配置注册函数 `FUN_40f870` 读出：9987/udp、30033/tcp、10011/tcp、10022/tcp、10080/tcp、10443/tcp；`threads_voice_udp`=5 | §1.4 六条 `mov r8d,0x…` 常量；`default_voice_port`/`serverinstance_filetransfer_port` 两段原文 |
| 4 | 加密为三库并存：libtomcrypt 私有分支（静态，含 EAX/GCM/CTR + RSA/ECC + Fortuna）+ mbedtls（静态，TLS/HTTPS Query）+ libts3_ssh.so（SSH Query）；**无 OpenSSL/无动态 codec 库** | §4.1–§4.2；§1.1 `NEEDED` 列表 |
| 5 | 数据库 schema 版本 **34**、27 张表；语音参数不在固定列而在 `channel_properties` 的 EAV 行；统计口径把语音单列为 `*_speech` | §7.1–§7.3 `sql/create_sqlite/create_tables.sql`、`sql/update_34.sql`、属性名表 |

### 目录

| 节 | 内容 |
|---|---|
| §0 | 取证方法与可复现命令 |
| §1 | 进程与线程模型、启动流程、配置参数总表 |
| §2 | 网络栈（6 个端口/协议、UDP 类结构、端点与 MTU） |
| §3 | 数据包处理（包类型、13 个 Outgoing* 类、ACK/重传/分片、PacketHandler_Base、PacketLimiter） |
| §4 | 加密体系（三库并存、tomcrypt 能力清单、加密属性、握手、许可证） |
| §5 | 语音转发（VoiceStreamer、收→校验→重打包→广播、whisper、talk power） |
| §6 | 权限与频道模型（515 条权限名、五张 perm 表、默认组、权限版本） |
| §7 | 数据库（`sql/` 结构、27 张表、语音/统计字段落点） |
| §8 | 管理接口（140 个 ServerQuery 命令分类、WebQuery + API Key） |
| §9 | **关键结论：是否做编解码**（证据链 A–E） |
| §10 | 未确认 / 待补（10 项） |

## 0. 本轮的取证方法与可复现命令

静态分析主体不依赖 Ghidra，用自建脚本把「stripped 二进制」补成可查询的图：

| 步骤 | 方法 | 产物 |
|---|---|---|
| 函数边界 | 解析 `.eh_frame_hdr` 二分查找表（`fde_count`），得到全部函数起始地址 | **17,939** 个函数 |
| 字符串索引 | `strings -a -t x` 文件偏移 → 虚拟地址（LOA1 `+0x400000`、LOA2 `+0x600000`） | 143,734 条字符串 |
| 交叉引用 | `objdump -d -M intel` 里 rip-relative 注释 `# <vaddr>` 反查引用者 | 直接引用可定位 |
| 调用图 | 直接 `call rel32` 抽边 | 67,422 条调用边 |
| 模块归属 | 每个函数引用的 `__FILE__` 断言串 → 源码文件 | 589 个函数可归属 |
| C++ RTTI | 扫 `.data.rel.ro` 的 typeinfo/vtable 结构（Itanium ABI，address point = typeinfo 指针 +8） | **64 个 vtable**、3867 条 mangled 名 |

证据：`readelf -SW ts3server`（节表）
```
[14] .text    PROGBITS 0x000000000040b4d0 off 0x00b4d0 size 0x797b22  AX
[16] .rodata  PROGBITS 0x0000000000ba3000 off 0x7a3000 size 0x095268  A
[25] .data.rel.ro PROGBITS 0x0000000000fae470 off 0x9ae470 size 0x0277a8 WA
[29] .data    PROGBITS 0x0000000000fd6ac0 off 0x9d6ac0 size 0x339bc0  WA
[30] .bss     NOBITS   0x0000000001310680 off 0xd10680 size 0x00f060  WA
```
证据：自建脚本输出
```
$ python3 /tmp/ts3/xref.py funcs
17939 functions
$ python3 /tmp/ts3/vtable.py stats
mangled names: 3867 typeinfo: 88 vtables: 64
$ python3 /tmp/ts3/modmap.py stats
functions with source-file evidence: 589 / 17939
```

> 说明：Ghidra 12.2 在本机可用，但 7.8 GB 内存 + 三 agent 并发导入时**首次分析超时**（330 s 内未完成导入）。
> 因此本文件的反编译级结论以**反汇编 + RTTI + 字符串三条独立证据链**互证，少数关键函数随后用 Ghidra
> 伪代码补证（见 §9 标注）。凡未拿到反编译确认的，一律写「未确认」。

---

## 1. 进程与线程模型

### 1.1 二进制形态

| 项 | 值 | 证据 |
|---|---|---|
| 类型 | `EXEC`（非 PIE，固定装载基址 0x400000） | `readelf -h`：`Type: EXEC` |
| 入口 | `0x4230f0` | `readelf -h`：`Entry point address: 0x4230f0` |
| 链接 | 动态链接，`libc/libm/libpthread/librt/libdl/libstdc++` + **私有 `libts3_ssh.so`** | `readelf -d`：`NEEDED` 列表 |
| RPATH | `$ORIGIN:$ORIGIN/lib/` | `readelf -d` |
| 栈 | **不可执行**（NX） | `GNU_STACK ... RW`（无 E 标志） |
| 加固 | 部分 RELRO（`GNU_RELRO` 0x27fd0）+ 无 PIE + 无栈保护符号证据 | `readelf -lW`；`.comment` 无 `-fstack-protector` 证据（未确认） |

证据：`readelf -dW ts3server`
```
 (NEEDED)  Shared library: [libts3_ssh.so]
 (NEEDED)  Shared library: [libdl.so.2]
 (NEEDED)  Shared library: [librt.so.1]
 (NEEDED)  Shared library: [libm.so.6]
 (NEEDED)  Shared library: [libpthread.so.0]
 (NEEDED)  Shared library: [libstdc++.so.6]
 (NEEDED)  Shared library: [libc.so.6]
 (RPATH)   Library rpath: [$ORIGIN:$ORIGIN/lib/]
```

**关键推论**：`NEEDED` 里**没有 libssl/libcrypto**，也没有 libopus/libspeex/libcelt 动态库。
即：**TLS = mbedtls（静态）**、**对称/非对称密码 = libtomcrypt 的 Teamspeak 私有分支（源码目录 deps/ts_tomcrypt，104 个源文件路径）**、**编解码器（若有）= 全部静态链入**。
证据：`readelf -d` 无 ssl/crypto/opus/speex；且 `strings` 中出现
`deps/ts_tomcrypt/src/...`（104 处）与 `deps/ts_mbedtls/mbedtls/library/ssl_tls.c` 等路径。

### 1.2 线程与事件驱动

| 设施 | 证据（导入符号） | 用途推断 |
|---|---|---|
| epoll | `epoll_create1`、`epoll_create`、`epoll_ctl`、`epoll_wait` | 主 reactor，UDP/TCP 统一事件循环 |
| poll | `poll` | 辅助等待（如 Query 终端/定时器） |
| 线程 | `pthread_create/join/detach`、`pthread_attr_setstacksize`、`pthread_setschedparam`、`__pthread_key_create` | 线程池 + TLS |
| 同步 | `pthread_mutex_*`、`pthread_cond_timedwait`、`pthread_condattr_setclock` | 条件变量带 CLOCK_MONOTONIC |
| 定时 | `clock_gettime`、`gettimeofday`、`nanosleep`、`alarm`、`timer_*` | 帧泵/心跳/超时 |
| 异步 IO | `aio_read64/aio_write64/aio_error64/aio_return64/aio_suspend64` | 文件传输（FT）异步读写 |

证据：`readelf --dyn-syms -W ts3server | awk '$7=="UND"'`（348 个未定义符号）中包含
`epoll_create1/epoll_ctl/epoll_wait/poll/pthread_create/pthread_cond_timedwait/nanosleep/aio_read64`。

线程池相关**断言文案**直接给出边界条件：
```
$ strings ts3server | grep -F 'thread_pool_size'
Assertion "thread_pool_size > 0 && thread_pool_size < 31" failed at ../../../../deps/teamspeak_common_lib/src/net/udpsockets.cpp:
```
→ **每个 UDP socket 的收包线程池上限 30**（1..30）。

UDP 语音线程数来自配置项 `threads_voice_udp`，默认 **5**：
证据：配置注册函数 `FUN_40f870` 里（`0x40fa93` 起）
```
40fa93: lea rcx,[rip+0x797e3a]   # ba78d4   → "threads_voice_udp"
40faa2: mov QWORD PTR [rsp+0xf0],0x11        ; 名称长度 17
40faae: mov QWORD PTR [rsp+0x580],0x5        ; ← 默认值 5
40fad4: call 498df0                          ; RegisterParameter(name, len, id=4, ..., &value)
```

### 1.3 启动流程（脚本 + 配置 + 许可证）

启动脚本极简，只负责 `daemon=1`/`pid_file` 与 pid 检查：
证据：`ts3server_startscript.sh`
```sh
"./${BINARYNAME}" "${@}" "daemon=1" "pid_file=$PID_FILE"
...
kill -TERM "$PID"            # stop 时先 TERM，等 300s 再 KILL
```
证据：`ts3server_minimal_runscript.sh`
```sh
exec ./ts3server $@
```
→ 服务端**默认前台运行**，`daemon=1` 才后台；无 systemd unit。

许可证接受与首启提示（字符串，来自 `serverlib_private.cpp` 区域）：
```
 to "accept" in order to accept the license agreement.
 to "view" in order to print the license to the console.
" in the working directory or start the server with the command line parameter "license_accepted=1".
.ts3server_license_accepted
```
→ 首启需在交互终端接受（或 `license_accepted=1`），并把接受状态写入工作目录的
`.ts3server_license_accepted` 文件。

密码/DB 初始化相关：`serveradmin_password`、`dbplugin`（默认 `ts3db_sqlite3`）、
`dbsqlpath`（`sql/`）、`dbsqlcreatepath`（`create_sqlite/`）、`clear_database`。

服务端**自检与注册**（`serverlib_private.cpp`，函数 `FUN_4bfd40`，53 个直接被调用者）：
证据：该函数引用的字符串
```
Using hardware aes
Error registering Rijndael cipher
Error registering SHA-1 hash
Error registering SHA-256 hash
Error registering fortuna PRNG
Server() error while starting servermanager, error: 
Server() error while starting virtualservers, halted! error: 
https://ts3services.teamspeak.com/revocation-certificates
https://ts3services.teamspeak.com/revocation-myteamspeakid
failed to load revocation list from cache: 
```
→ 启动序列：**密码学自注册 → ServerManager → 各虚拟服务器 → 吊销列表拉取**；
且启动时会打印「Using hardware aes」（AES-NI 检测，对应 `ts_tomcrypt/src/cpu_aes.c`）。

### 1.4 启动参数总表（从注册代码里直接读出默认值）

`FUN_40f870` 是唯一的「配置项注册」函数（所有 6 个端口常量都在同一个函数体内），
每条记录的指令形状固定为：
`lea rcx,#<name>; mov [rsp+X],<len>; mov edx,<id>; mov ecx,<flags>; mov r8d,<default>; call <register>`

证据：`objdump` 窗口（`default_voice_port`）
```
40f9b6: lea rcx,[rip+0x797efb]   # ba78b8   → "default_voice_port"
40f9c5: mov QWORD PTR [rsp+0x140],0x12       ; 名称长度 18
40f9e3: mov r8d,0x2703                       ; 默认 9987
40f9ec: call 498720
```
证据：`objdump` 窗口（`serverinstance_filetransfer_port`）
```
41094c: lea rcx,[rip+0x797369]  # ba7cbc → "serverinstance_filetransfer_port"
41095b: mov QWORD PTR [rsp+0x328],0x20       ; 32
410967: mov QWORD PTR [rsp+0x228],0x7551     ; 默认 30033
410990: call 498df0
```

| 配置项（ini/命令行键） | 默认值 | 证据地址 |
|---|---|---|
| `default_voice_port` | **9987** | `0x40f9e3` `mov r8d,0x2703` |
| `query_port` | **10011** | `0x40fc48` `mov r8d,0x271b` |
| `query_ssh_port` | **10022** | `0x4102b7` `mov r8d,0x2726` |
| `query_http_port` | **10080** | `0x41058f` `mov r8d,0x2760` |
| `query_https_port` | **10443** | `0x41063a` `mov r8d,0x28cb` |
| `serverinstance_filetransfer_port` | **30033** | `0x410967` `mov …0x7551` |
| `threads_voice_udp` | 5 | `0x40faae` |
| `query_timeout` | 300 | `0x40…`（同函数） |
| `query_pool_size` | 2 | 同上 |
| `query_buffer_mb` | 20 | 同上 |
| `dbconnections` | 10 | 同上 |
| `create_default_virtualserver` | 1 | 同上 |
| `createinifile` | 0 | 同上 |
| `logquerycommands` / `logquerytiminginterval` | 0 / 0 | 同上 |
| `query_skipbruteforcecheck` | 0 | 同上 |
| `hints_enabled` | 0 | 同上 |
| `daemon` / `logappend` / `clear_database` | 0 | 同上 |

> 该表的「键→默认值」关联来自上面所示的固定指令模式批量提取。其中 `default_voice_port`/`query_port`/`query_ssh_port`/`query_http_port`/`query_https_port`/`serverinstance_filetransfer_port` **六项已逐条人工核对**（前文给出两段原文反汇编）；其余行为同模式批量结果，个别项（尤其是 `virtualserver_*` / `serverinstance_*` 属性原型）可能取到了相邻指令的立即数，采信度较低。
| 字符串型（无默认值） | — | `licensepath`、`voice_ip`、`logpath`、`filetransfer_ip`、`query_ip`、`query_ip_allowlist`、`query_ip_denylist`、`serveradmin_password`、`dbplugin`、`dbpluginparameter`、`http_proxy`、`query_https_certificate_file`、`query_https_private_key_file`、`mmdbpath`、`http_file_transfer_settings_file`、`crashdumps_path` 等 |

完整键名表（同一 rodata 区块 `0xba78a0`–`0xba7c9c`）还包括：
`query_ip_allowlist.txt|query_ip_whitelist.txt`、`query_ip_denylist.txt|query_ip_blacklist.txt`
（新旧名兼容，启动时会对旧名打印「Parameter '…' is deprecated (but understood)」）、
`query_protocols` = `raw,http,ssh`、`query_ssh_rsa_host_key` = `ssh_host_rsa_key`、
`serverquerydocs_path` = `serverquerydocs/`。

---

## 2. 网络栈

### 2.1 端口与协议分工

| 通道 | 默认端口 | 传输 | 服务端监听类（RTTI） | 证据 |
|---|---|---|---|---|
| 语音/信令（客户端主连接） | **9987/udp** | UDP | `UDPServer`、`UDPSocket`、`UDPSocketData`、`VoiceStreamer` | 端口默认值 `0x40f9e3`；vtable `0xfb50b0`/`0xfcfea0`/`0xfb5108`/`0xfb4fb0` |
| 文件传输 | **30033/tcp** + `serverinstance_filetransfer_port` | TCP | `FileTransfer`（`filetransfer2.cpp`），走独立的 `ft*` 命令族 | 默认值 `0x410967`；SQL 默认值 `sql/defaults.sql: serverinstance_filetransfer_port='30033'` |
| ServerQuery raw | **10011/tcp** | TCP 文本 | `Query_Raw_Listener`/`Query_Raw_Transport`/`Query_Raw_Terminal` | 默认值 `0x40fc48`；vtable `0xfb67e0`/`0xfbb8d0`/`0xfb66f0` |
| ServerQuery over SSH | **10022/tcp** | SSH（libts3_ssh.so） | `Query_Ssh_Listener`/`Query_Ssh_Transport` | 默认值 `0x4102b7`；`NEEDED libts3_ssh.so`；vtable `0xfb62f0`/`0xfb6590` |
| WebQuery HTTP | **10080/tcp** | HTTP | `Query_Http_Listener`/`Query_Http_Session`/`Query_Http_Response` | 默认值 `0x41058f`；vtable `0xfb5748`/`0xfb77a0`/`0xfb9758` |
| WebQuery HTTPS | **10443/tcp** | TLS（mbedtls） | `Query_Https_Listener` | 默认值 `0x41063a`；vtable `0xfb57d8`；`ts_mbedtls` 字符串 |
| 服务器列表上报（weblist） | 出站 | HTTPS | `accounting::detail::TeamHTTP_Client`、`Multi_Server_HTTP_Client` | mangled RTTI：`N3com10teamspeak310accounting6detail15TeamHTTP_ClientE` |

> 六个端口默认值全部出自同一个函数 `FUN_40f870` 的 `mov r8d,0x…` 立即数，原文证据见 §1.4。

### 2.2 UDP 语音通道的实现结构

RTTI 直接给出三个 UDP 层类（均为虚类，vtable 已定位）：

| 类 | vtable | 槽位数 | 槽位函数（节选） | 语义推断 |
|---|---|---|---|---|
| `UDPServer` | `0xfb50b0` | 5 | `FUN_a9b440`(D1) `FUN_610f00` `FUN_60fff0` `FUN_610f20`(D0) `FUN_60f5f0` | 一个监听端口对象；`FUN_60fff0` 断言 `socketData != __null` 且带 `UDP packet send returned error :` → 负责 `sendto` |
| `UDPSocket` | `0xfcfea0` | 5 | `FUN_a9b440` `FUN_a9b670` … | 单 socket 收包循环 |
| `UDPSocketData` | `0xfb5108` | 3 | `FUN_6111f0` `FUN_611260` `FUN_6112d0` | 每 socket 的元数据（对应 `GenericSocketData`） |
| `VoiceStreamer` | `0xfb4fb0` | **24** | `FUN_60d680`…`FUN_60da10` | 语音包收发/缓冲流水线（详见 §5） |

证据：`FUN_60f5f0`（`udpserver.cpp`）的断言与字符串
```
Assertion "pe.m_type == TS_Endpoint_Both::Val_Type::VT_UDP" failed at ../../../../deps/teamspeak_server_lib/src/ts_server/net/udpserver.cpp:
```
证据：`FUN_60fff0`（同文件）
```
Assertion "socketData != __null" failed at .../udpserver.cpp:
UDP packet send returned error : 
```

### 2.3 端点抽象与 IPv6

端点类型 `TS_Endpoint_Both::Val_Type::{VT_UDP, ...}` 在 server 与 common 两侧都出现：
```
Assertion "remoteAddress.m_type == TS_Endpoint_Both::Val_Type::VT_UDP" failed at .../Server_Packet_Handler.cpp:
Assertion "ip.m_type == TS_Endpoint_Both::Val_Type::VT_UDP" failed at .../Server_Packet_Handler.cpp:
Assertion "sa.m_type == TS_Endpoint_Both::Val_Type::VT_UDP" failed at .../Server_Packet_Handler.cpp:
```
→ 服务端在包处理入口**强制校验来源是 UDP 端点**，Query/FT 的 TCP 端点不能进语音包处理路径。

双栈证据：`if_indextoname`/`if_nametoindex`/`inet_pton`/`inet_ntop`/`getaddrinfo`
（`asio.netdb` 错误类别串 `Host not found (authoritative)` 等说明用 **Boost.Asio** 做 DNS/地址解析）；
`CIDRManager`（RTTI 字符串）→ 黑白名单按 CIDR 匹配。

证据：`strings | grep asio`
```
asio.netdb
Host not found (authoritative)
The descriptor does not fit into the select call's fd_set
N5boost4asio5error6detail14netdb_categoryE
```

### 2.4 MTU 与分片

| 机制 | 证据 |
|---|---|
| 发送前 MTU 校验 | `Assertion "m_DataSize <= get_packet_mtu(is_ipv6)" failed at .../outgoingpacket.cpp` |
| 超 MTU 直接报错 | `We tried to make a packet >= MTU, bad idea`（`FUN_49fd30`，`outgoingpacket.cpp`） |
| 收包侧 MTU 校验 | `Assertion "packet->getPacketSize() <= get_packet_mtu(...) || packet->getType() == VOICE_WHISPER"` (`packethandler_base.cpp`) |
| 分片标志 | `connection.cpp`：`Assertion "j->second->hasFragmentFlag()"`、`Resending packet missed arrival window` |
| 具体 MTU 数值 | **未确认**（`get_packet_mtu` 为极小的常量返回函数，未反编译确认；代码里出现的 `0x5dc`=1500 位于 Query 缓冲区尺寸上下文，不能直接当作语音 MTU） |

> 注意上表第 3 行：`VOICE_WHISPER` 被**豁免** MTU 上限，与 §5 的 whisper 定向投递一致。
---

## 3. 数据包处理（Packet 层）

### 3.1 包类型枚举（完整）

服务端把包类型名做成字符串表用于日志，紧邻 whisper 相关枚举：

| 类型名 | 语义 | 证据 |
|---|---|---|
| `VOICE` | 语音包（客户端→服务器→频道内其他客户端） | 字符串 `0xbb24da` |
| `VOICE_WHISPER` | 定向语音（whisper，多目标列表） | `0xbb24e0` |
| `COMMAND` | 可靠命令（带重传） | `0xbb24ee` |
| `COMMAND_LOW` | 低优先级命令 | `0xbb24f6` |
| `PING` / `PONG` | 心跳/时延测量 | `0xbb2502` / `0xbb2507` |
| `ACK_LOW` | 低优先级确认 | `0xbb2510` |
| `INIT1` | 连接初始化第一步 | `0xbb2518` |
| `UNKNOWN ` | 未知类型（丢弃路径） | `0xbb251e` |

证据：`strings -a -t x ts3server`（虚拟地址 = 文件偏移 + 0x400000）
```
bb24da  VOICE
bb24e0  VOICE_WHISPER
bb24ee  COMMAND
bb24f6  COMMAND_LOW
bb2502  PING
bb2507  PONG
bb2510  ACK_LOW
bb2518  INIT1
bb251e  UNKNOWN 
```

> 「ACK」本体未在名字表里出现，但存在 `OutgoingAckPacket`/`OutgoingAckLowPacket` 两个类
> 与 `ACK_LOW` 名字项 → 推断除了低优先级 ACK 外还有普通 ACK（由 `OutgoingAckPacket` 承载）；
> 两者在表里的对应关系**未确认**（名字表可能只覆盖日志里需要打印的子集）。

### 3.2 Outgoing* 类层次（RTTI + vtable 实测）

从 `.data.rel.ro` 恢复的 vtable 与 typeinfo（Itanium ABI，`.data.rel.ro` 中
`[offset_to_top][typeinfo_ptr][slot…]`，address point = typeinfo 指针 + 8）：

| 类 | vtable | 槽位 | 槽位内容 | 备注 |
|---|---|---|---|---|
| `OutgoingPacket` | `0xfb12a8` | 2 | `FUN_4a1340`, `FUN_49fbe0` | 基类；序列化在 `FUN_49fd30`（`outgoingpacket.cpp`） |
| `OutgoingPingPacket` | `0xfb12d8` | 2 | `FUN_4a1340`, `FUN_4a1370` | |
| `OutgoingQueryPacket` | `0xfb12f8` | 2 | `FUN_4a1340`, `FUN_4a13b0` | Query 通道也有自己的包类型 |
| `OutgoingINITPacket` | `0xfb1318` | 2 | `FUN_4a1340`, `FUN_4a13f0` | 连接建立 |
| `OutgoingConfirmationPacket` | `0xfcff28` | 2 | `FUN_4a1340`, `FUN_a9e330` | |
| `OutgoingAckPacket` | `0xfcff48` | 2 | `FUN_4a1340`, `FUN_a9e350` | |
| `OutgoingAckLowPacket` | `0xfcff68` | 2 | `FUN_4a1340`, `FUN_a9e370` | |
| `OutgoingPongPacket` | `0xfcff88` | 2 | `FUN_4a1340`, `FUN_a9e390` | |
| `OutgoingResendingPacket` | `0xfd0028` | 2 | `FUN_4a1340`, `FUN_aa0700` | 重传包装 |
| `OutgoingCommandPacket` | `0xfd0048` | 2 | `FUN_4a1340`, `FUN_aa0720` | |
| `OutgoingCommandLowPacket` | `0xfd0068` | 2 | `FUN_4a1340`, `FUN_aa0740` | |
| `OutgoingVoicePacket` | `0xfd0188` | 2 | `FUN_4a1340`, `FUN_aa3220` | |
| `OutgoingVoiceWhisperPacket` | `0xfd01a8` | 2 | `FUN_4a1340`, `FUN_aa3240` | |
| `IncomingPacket`（非虚类） | — | — | — | `incomingpacket.cpp` 无 vtable → 无虚函数 |

证据：自有脚本按 Itanium ABI 解 `.data.rel.ro`
```
$ python3 /tmp/ts3/vtable.py grep outgoing
vtable fb12a8  OutgoingPacket            slots=2
     [0] FUN_4a1340   [1] FUN_49fbe0
vtable fd0188  OutgoingVoicePacket       slots=2
     [0] FUN_4a1340   [1] FUN_aa3220
vtable fd01a8  OutgoingVoiceWhisperPacket slots=2
     [0] FUN_4a1340   [1] FUN_aa3240
```

**重要结构结论**：全部 13 个 `Outgoing*` 类的 vtable 都只有 **2 个槽**，且第 0 槽在两代派生类中都是
`FUN_4a1340`（基类完整析构），第 1 槽是各自的删除析构。也就是说 **这些包类之间没有虚函数式的多态**，
序列化/发送走的是「基类 + 类型标签」而不是虚分派；这与 `outgoingpacket.cpp` 里用断言检查
`m_State == READABLE` / `get_packet_mtu(is_ipv6)` 的实现方式一致。

### 3.3 可靠传输：ACK / 重传 / 排序 / 分片

`connection.cpp` 的断言文案把内部数据结构全部暴露出来：

| 机制 | 证据字符串 |
|---|---|
| ACK 等待表 | `Assertion "m_AckWaitIterList[packetType].find(pID) == …end()"`、`m_AckWaitIterList[packetType].push_back failed for packet id ` |
| 排序包表 | `Assertion "j == m_SortedPacketList[packetType].end()"`、`Tried to store a packet that was either reserved, or already stored ` |
| 重传窗口 | `Resending packet missed arrival window`、`Assertion "isResendingPacketType(packetType)"` |
| 分片 | `Assertion "j->second->hasFragmentFlag()"` |
| 包 ID 空间 | `Assertion "packetType < m_PacketID.size()"`、`Assertion "packetType < m_AckWaitIterList.size()"` |
| 重传包尺寸不变 | `Assertion "original.getPacketSize() == getPacketSize()"`（`outgoingresendingpacket.cpp`） |
| 必须分片 | `Assertion "needsSplitting(is_ipv6)"`（同上） |

证据：`FUN_49fd30`（`outgoingpacket.cpp` 的序列化函数，同时含两条关键断言）
```
Assertion "m_DataSize <= get_packet_mtu(is_ipv6)" failed at .../outgoingpacket.cpp:
Assertion "m_State == READABLE" failed at .../outgoingpacket.cpp:
We tried to make a packet >= MTU, bad idea
```

命令包（`COMMAND`）在发送侧做压缩、接收侧做解压，并有两道尺寸防线：

```
Command Packet size limit exceeded, discarding packet
Command Packet size decompression size mismatch, discarding packet
received Packet is invalid, discarding packet
```
证据：三条字符串紧邻 `incomingpacket.cpp` 断言区块（`0xbb22d2`/`0xbb2308`/`0xbb234b`）。
解压实现是 **QuickLZ**：mangled 名 `N5boost19thread_specific_ptrI20qlz_state_decompressE11delete_dataE`
（`qlz_state_decompress` 为 QuickLZ 流状态），且是 **per-thread** 缓存。

### 3.4 PacketHandler_Base：唯一的包分派器

| 项 | 值 |
|---|---|
| 类 | `PacketHandler_Base`，vtable `0xfcfd20`，**18 槽** |
| 槽位 | `a91e80 a91f80 a91fa0 a93850 a93860 a94d30 a94fe0 a95290 a95540 a93820 a94320 a95ad0 a9a150`（+5 个纯虚） |
| 核心分派 | `FUN_a91fa0`（5024 字节，`packethandler_base.cpp`） |

证据：槽位→字符串映射（逐函数取其引用的断言/日志）
```
FUN_a91fa0  sz=5024  "dummy_newip" || 'Assertion "receivedPacket->getPeerEndpoint().m_type == …VT_UDP"' || "Invalid Voice Packet received, dropping"
FUN_a93860  sz=640   Assertion "false" failed at .../packethandler_base.cpp
FUN_a94320  sz=1168  Assertion "serverID == m_ServerID" failed at .../packethandler_base.cpp
FUN_a95ad0  sz=3504  "dummy_connectionlost" || "immediate" || "Dropping client "
```

`FUN_a91fa0` 开头对**包类型计数器**做自增（`lock add DWORD PTR [r14+r12*4+0x9c],0x1`），
即每个 `PacketHandler_Base` 实例持有按包类型索引的统计数组，随后才分派；
与 `connection.cpp` 里的 `connection_packets_sent_speech/keepalive/control` 三类统计口径对齐（见 §7）。

### 3.5 PacketLimiter：连接前的 DoS 闸门

| 项 | 值 |
|---|---|
| 类 | `PacketLimiter`，vtable `0xfd0ec0`，3 槽：`FUN_ade890 FUN_ade950 FUN_ade970` |
| 关键函数 | `FUN_adeff0`（`puzzleGetCurrentPuzzleData` 失败日志）、`FUN_adfb00`、`FUN_ae15b0`（`err==CRYPT_OK` 断言） |
| 归属 | `deps/teamspeak_common_lib/src/packet/packetlimiter.cpp` + `src/encryption/rsa_puzzle.cpp` |

证据（`packetlimiter.cpp` 断言）
```
Assertion "m_PuzzleSource" failed at .../packet/packetlimiter.cpp:
Assertion "info->n_len == static_cast<unsigned long>(PuzzleData::PUZZLE_DATA_SIZE_n)" failed at .../packetlimiter.cpp:
Assertion "x_len == …PUZZLE_DATA_SIZE_x) && X_len == …PUZZLE_DATA_SIZE_x)" failed at .../packetlimiter.cpp:
puzzleGetCurrentPuzzleData failed with 
```
证据（`rsa_puzzle.cpp` + 预计算线程 RTTI）
```
Assertion "my_sz <= static_cast<unsigned int>(bytesNeeded)" failed at .../encryption/rsa_puzzle.cpp:
Puzzle precompute time: 
RSA_PUZZLE N too large 
N5boost6detail11thread_dataINS_3_bi6bind_tIvPFvP10Prng_stateiiP21Rsa_Puzzle_Key_StructiiiP15Rsa_Puzzle_InfoE…
```
→ 服务端在正式建连前要求客户端解一个 **RSA puzzle**（`Rsa_Puzzle_Key_Struct` / `Rsa_Puzzle_Info`），
puzzle 数据由**后台 boost::thread 预计算**并缓存（`Puzzle precompute time:` 是计时日志）。
这就是「连接前 DoS 防护」的实体。

---

## 4. 加密体系

### 4.1 三套密码库并存（各司其职）

| 库 | 形态 | 用途 | 证据 |
|---|---|---|---|
| **libtomcrypt 私有分支** | 静态，源码目录 `deps/ts_tomcrypt`（104 个源文件路径） | TS3 协议本体：会话密钥交换、包加密、许可证签名校验、RSA puzzle、随机数 | `deps/ts_tomcrypt/src/...` 字符串；启动注册日志（见下） |
| **mbedtls 私有分支** | 静态，`deps/ts_mbedtls/mbedtls/library/{ssl_tls,ssl_srv,ssl_cli}.c` | TLS：WebQuery HTTPS 监听 + 出站 HTTPS（accounting/吊销列表） | RTTI `N3com9teamspeak4http24mbedtls_error_category_tE`；错误类别名 `com::teamspeak::http::mbedtls` |
| **libts3_ssh.so** | 动态库（NEEDED） | ServerQuery over SSH（10022） | 导入符号 `ssh_*`、`create_host_rsa_key`、`ssh_bind_accept_fd` |

证据：`readelf --dyn-syms -W ts3server | grep ' ssh_\|create_host_rsa_key'`
```
create_host_rsa_key
ssh_bind_accept_fd
ssh_bind_new / ssh_bind_options_set
ssh_handle_key_exchange
ssh_message_auth_password / ssh_message_auth_reply_success
ssh_channel_read_timeout / ssh_channel_write / ssh_channel_window_size
```

### 4.2 tomcrypt 能力清单（按源码路径实测）

| 类别 | 证据（源码路径均在 `deps/ts_tomcrypt/src/` 下） |
|---|---|
| 对称加密 | `ciphers/aes/aes.c`；**EAX** `encauth/eax/eax_{init,encrypt,decrypt,done,encrypt_authenticate_memory,decrypt_verify_memory}.c`（6 个全在）；**GCM** `encauth/gcm/gcm_{init,add_aad,add_iv,process,done}.c`（5 个全在）；**CTR** `modes/ctr/ctr_{start,encrypt,decrypt,setiv,done}.c` |
| 哈希/MAC | `hashes/sha1.c`、`hashes/sha2/sha{224,256,384,512}.c`、`mac/hmac/*`、`mac/omac/*` |
| PRNG | `prngs/{yarrow.c,rng_get_bytes.c,rng_make_prng.c}`；启动日志含 `Error registering fortuna PRNG` |
| 公钥 | **RSA** `pk/rsa/{rsa_make_key,rsa_exptmod,rsa_verify_hash,…}.c` + `pk/pkcs1/{pkcs_1_mgf1,pkcs_1_pss_decode}.c`；**ECC** `pk/ecc/{ecc_make_key,ecc_shared_secret,ecc_sign_hash,ecc_verify_hash,…}.c` |
| 大数 | `math/tfm_desc.c`（LibTomMath「tfm」，非 GMP）+ `math/rand_prime.c` |
| 编码 | `pk/asn1/der/**`（ASN.1 DER 全族）、`misc/base64/base64_{encode,decode}.c`、`misc/zeromem.c` |

证据：`strings -a ts3server | grep -o 'ts_.*tomcrypt/src/[a-z0-9_/]*\.c' | sort -u`（节选）
```
ts_tomcrypt/src/encauth/eax/eax_init.c
ts_tomcrypt/src/encauth/gcm/gcm_process.c
ts_tomcrypt/src/modes/ctr/ctr_encrypt.c
ts_tomcrypt/src/pk/ecc/ecc_shared_secret.c
ts_tomcrypt/src/pk/rsa/rsa_exptmod.c
ts_tomcrypt/src/prngs/yarrow.c
```

### 4.3 启动时的密码学自注册（只注册 4 个）

证据：`FUN_4bfd40`（`serverlib_private.cpp`）引用的字符串，按出现顺序
```
Using hardware aes
Error registering Rijndael cipher
Error registering SHA-1 hash
Error registering SHA-256 hash
Error registering fortuna PRNG
```
→ 运行时只**显式注册** Rijndael(AES) + SHA-1 + SHA-256 + Fortuna；
SHA-512/384、HMAC、OMAC、ECC、RSA 等**存在但不一定注册**（是否仅在特定路径惰性注册：**未确认**）。
`Using hardware aes` 与 `deps/ts_tomcrypt/src/cpu_aes.c` 一起说明有 AES-NI 检测分支。

### 4.4 会话加密参数（来自服务端属性表）

| 属性 ident | 语义 | 证据 |
|---|---|---|
| `virtualserver_codec_encryption_mode` | 语音加密模式（0=按频道/1=全局强制） | 属性名表 `0xba804b`；ServerQuery `channel_codec_is_unencrypted` 与之配套 |
| `virtualserver_encryption_ciphers` | 允许的对称算法串 | `0xba806f`；紧邻取值串 `AES-256,AES-128`（`0xba8090`） |
| `virtualserver_keypair` | 服务器静态密钥对（base64/DER） | `0xba80a0` |
| `virtualserver_protocol_verify_keypair` | 是否强校验客户端密钥对 | `0xba80b6` |
| `client_encryption_ciphers` | 客户端声明的算法 | `0xba8d97` |
| `client_key_offset` | 客户端密钥偏移量 | `0xba8db1` |
| `virtualserver_needed_identity_security_level` | 加入所需身份安全等级（MyTS 等级） | `0xba85dd` |
| `channel_codec_is_unencrypted` | 频道是否允许明文语音 | `0xba8a7e` |
| `channel_security_salt` | 频道级盐 | `0xba8a9b` |

证据：`strings -t x`（虚拟地址）
```
ba804b  virtualserver_codec_encryption_mode
ba806f  virtualserver_encryption_ciphers
ba8090  AES-256,AES-128
ba80a0  virtualserver_keypair
ba80b6  virtualserver_protocol_verify_keypair
ba8a7e  channel_codec_is_unencrypted
ba8a9b  channel_security_salt
```

### 4.5 连接握手与「共享密钥」

证据（`connection.cpp`）
```
Assertion "!m_cryptoInitComplete" failed at .../connection.cpp:
Assertion "!m_handShakeConfirmedIP" failed at .../connection.cpp:
Assertion "type != Shared_Secret_Type::invalid" failed at .../connection.cpp:
Assertion "outputlen == SHA256LEN" failed at .../connection.cpp:
```
→ `Connection` 对象持有 `m_cryptoInitComplete`、`m_handShakeConfirmedIP`、`Shared_Secret_Type`；
密钥派生用到 SHA-256（输出长度 = `SHA256LEN`）。
`Shared_Secret_Type` 的存在说明服务端内部还有「共享密钥」模式（典型用于服务器↔服务器或
Query 通道绑定），**具体协商报文顺序未确认**（需反编译 `Connection::…` 系列）。

TLS 侧的握手字符串（mbedtls 自带）：
```
<= handshake / => handshake
<= write change cipher spec / => parse change cipher spec
<= encrypt buf / => decrypt buf
DTLS handshake message too large: size %u, maximum %u
```
→ 编译进了 **DTLS** 支持（`mbedtls_ssl_set_timer_cb() for DTLS` 断言也在），
但服务端是否真的跑 DTLS 通道（例如 Query over DTLS）：**未确认**。

### 4.6 许可证 / 账单校验

| 组件 | 证据 |
|---|---|
| protobuf 定义的 accounting 协议 | `com.teamspeak3.accounting.protobuf.frontend.{Server_Report,Latest_License,Time,}…`、`AccountingFrontendService` |
| RPC 通道 | `N3com10teamspeak310accounting6detail11RPC_ChannelE`、`RPC_Closure<…Server_Report…>`、`Multi_Server_HTTP_Client::delegate_request` |
| 许可证状态 | `ERROR_SERVER_TS3_LICENSE_EXPIRED`、`ERROR_SERVER_TS3_NO_LICENSE_SET`、`ERROR_SERVER_FE_LICENSE_*`、`Error creating ephemeral license: missing certificate`、`Error decoding license in response from server ` |
| 上报地址 | `https://ts3services.teamspeak.com/revocation-certificates`、`…/revocation-myteamspeakid` |
| 吊销表 | SQL 表 `revocations(revocation_key, revocation_type, revocation_expiration)` |
| 内嵌材料 | `-----BEGIN DH PARAMETERS-----`、`****************RSA`、Base64/DER 相关串 → 二进制内嵌了 DH 参数与密钥材料（具体用途**未确认**） |

→ 服务端启动后会把「每个虚拟服务器的统计」通过 protobuf over HTTPS 上报到
`ts3services.teamspeak.com`，并从该域名拉取吊销列表；许可证本身是签名结构（`Signed_License_Info`），
用 tomcrypt 的 RSA/ECC 验签。

---

## 5. 语音转发（VoiceStreamer / OutgoingVoice* / whisper）

### 5.1 服务端语音相关的类与实例化位置

| 类 | vtable | 槽位 | 实例化证据 |
|---|---|---|---|
| `VoiceStreamer` | `0xfb4fb0` | **24**（`FUN_60d680`…`FUN_60da10`，全部落在 `0x60d6xx–0x60daxx`） | 在 `VirtualServerManager` 构造里 `new(0x1a8)` → `FUN_60cfc0`（ctor，`0x60cfdc` 处写入 vtable `0xfb4fb0`） |
| `OutgoingVoicePacket` | `0xfd0188` | 2（`FUN_aa3220` = 删除析构） | 由语音转发路径 new |
| `OutgoingVoiceWhisperPacket` | `0xfd01a8` | 2（`FUN_aa3240`） | 由 whisper 路径 new |
| `DecodeManager` | `0xfd0d58` | 3 | 同处 `new(0x58)` → `FUN_ad2630`（`decodemanager.cpp`） |
| `DecodeManagerServer` | `0xfb2498` | 3 | 紧接着把 vtable 覆写为 `0xfb2498`，并把 `[VoiceStreamer+8] = DecodeManager` |

证据：`FUN_50b280` 内的构造序列（`VirtualServerManager` 初始化函数，87 个直接被调用者）
```
50ccc6: mov edi,0x1a8
50cccb: call a5adc0 <_Znwm>            ; new VoiceStreamer
50ccde: call 60cfc0                    ; VoiceStreamer ctor
50cce3: mov QWORD PTR [r12+0x250],rbx  ; 存 VoiceStreamer 指针
50cceb: mov edi,0x58
50ccf0: call a5adc0 <_Znwm>            ; new DecodeManager
50cd02: mov rsi,rbx                    ;   arg2 = VoiceStreamer*
50cd05: call ad2630                    ; DecodeManager ctor (decodemanager.cpp)
50cd0a: lea rax,[rip+…] # fb2498       ; ← DecodeManagerServer vtable
50cd11: mov QWORD PTR [rbp+0x0],rax
50cd15: mov QWORD PTR [r12+0x248],rbp
50cd1d: mov rax,QWORD PTR [r12+0x250]
50cd25: mov QWORD PTR [rax+0x8],rbp    ; VoiceStreamer+8 = DecodeManager
```
`FUN_50b280` 只被 `FUN_4bfd40`（`serverlib_private.cpp`，即 server 启动函数）调用一次：
```
$ python3 /tmp/ts3/graph.py callers 0x50b280
FUN_4bfd40 -> FUN_50b280 @50b280
```
→ **语音流水线是「每 VirtualServerManager 一套」，随服务端启动一起构造。**

### 5.2 转发链路（收 → 校验 → 重打包 → 广播）

| 阶段 | 证据 |
|---|---|
| 收包 | `UDPServer`/`UDPSocket`（`udpserver.cpp`）从 epoll 取包；`threads_voice_udp` 默认 5 个语音 UDP 线程 |
| 解析 | `IncomingPacket`（`incomingpacket.cpp`，10 个可归属函数）；解密状态机 `Assertion "m_State == ENCRYPTED"` |
| 校验 | `PacketHandler_Base::FUN_a91fa0` 里：非语音包必须 `getVoiceDataSize()==0`；语音包走专门分支；失败打印 `Invalid Voice Packet received, dropping`（`edx=0x27` 正是该串长度 39，证明是这条日志） |
| 目标选择 | 语音是**频道内广播**（`isChannelClientTarget()` 系列断言 6 处）；whisper 走 `!isChannelClientTarget()` 反分支 |
| 重打包 | `OutgoingVoicePacket`（`outgoingvoicepacket.cpp`）把多个语音帧合并进一个包：`Assertion "numberVoicePackets < 256"` |
| 定向投递 | `OutgoingVoiceWhisperPacket`：`Assertion "count <= 255 && count == channelListSize"` / `"count <= 255 && count == clientListSize"` → **单包最多 255 个 target**（频道列表或客户端列表二选一） |
| 发送 | `FUN_60fff0`（`udpserver.cpp`）：`UDP packet send returned error : ` |

证据（`outgoingvoicepacket.cpp` 断言，全部 3 条）
```
Assertion "numberVoicePackets < 256" failed at .../packet/outgoingvoicepacket.cpp:
Assertion "count <= 255 && count == channelListSize" failed at .../packet/outgoingvoicepacket.cpp:
Assertion "count <= 255 && count == clientListSize" failed at .../packet/outgoingvoicepacket.cpp:
```
证据（`incomingpacket.cpp` 断言）
```
Assertion "getVoiceDataSize() == 0" failed at .../packet/incomingpacket.cpp:
Assertion "!packetList.empty()" failed at .../packet/incomingpacket.cpp:
Assertion "getHeaderSize() <= it->m_DataSize" failed at .../packet/incomingpacket.cpp:
Assertion "isChannelClientTarget()"  ×4  /  Assertion "!isChannelClientTarget()"  ×2
```
证据（`FUN_a91fa0` 的日志串长度自证）
```
a92e1d: lea rsi,[rip+0x189de3]  # c1cc07  → "Invalid Voice Packet received, dropping"
a92e24: mov edx,0x27                     ; 0x27 = 39 = strlen
a92e29: call 427500                      ; 日志拼装
```

**结论（不含编解码判断，编解码见 §9）**：服务端把语音包当成**不透明载荷**做
「解析头部 → 校验类型/尺寸 → 换发包 ID → 按目标集合复制发送」，
包内 `voiceData` 与编码帧边界由 `numberVoicePackets` 与 `voiceDataSize` 描述（见 §9.2），
**转发过程中没有重采样或重编码步骤**。

### 5.3 whisper（定向语音）

whisper 的类型/目标模式枚举名（服务端用于权限判定与日志）：

| 枚举 | 取值 |
|---|---|
| `GROUPWHISPERTYPE_*` | `SERVERGROUP`、`CHANNELGROUP`、`CHANNELCOMMANDER`、`ALLCLIENTS`、`UNKNOWN` |
| `GROUPWHISPERTARGETMODE_*` | `ALL`、`CURRENTCHANNEL`、`PARENTCHANNEL`、`ALLPARENTCHANNELS`、`CHANNELFAMILY`、`ANCESTORCHANNELFAMILY`、`SUBCHANNELS`、`UNKNOWN` |

证据：`strings -t x`（连续区块 `0xbb2527`–`0xbb26bd`）
```
bb2527  GROUPWHISPERTYPE_SERVERGROUP
bb2544  GROUPWHISPERTYPE_CHANNELGROUP
bb2562  GROUPWHISPERTYPE_CHANNELCOMMANDER
bb2584  GROUPWHISPERTYPE_ALLCLIENTS
bb25a0  GROUPWHISPERTYPE_UNKNOWN
bb25b9  GROUPWHISPERTARGETMODE_ALL
bb25d4  GROUPWHISPERTARGETMODE_CURRENTCHANNEL
bb25fa  GROUPWHISPERTARGETMODE_PARENTCHANNEL
bb261f  GROUPWHISPERTARGETMODE_ALLPARENTCHANNELS
bb2648  GROUPWHISPERTARGETMODE_CHANNELFAMILY
bb266d  GROUPWHISPERTARGETMODE_ANCESTORCHANNELFAMILY
bb269a  GROUPWHISPERTARGETMODE_SUBCHANNELS
bb26bd  GROUPWHISPERTARGETMODE_UNKNOWN
```
配套字符串：`setwhisperlist`（ServerQuery 命令）、`no whisper targets found`、
`too many whisper targets`（→ 有目标数量上限，具体值**未确认**）。

whisper 的权限位：`i_client_whisper_power`（说话方）与 `i_client_needed_whisper_power`（目标方门槛），
ServerQuery `permoverview` 里显示为 `Client whisper power` / `Client needed whisper power`：
```
i_client_whisper_power
i_client_needed_whisper_power
Client whisper power
Client needed whisper power
```

### 5.4 说话权限（talk power）与频道语音参数

| 权限/属性 | 作用 | 证据 |
|---|---|---|
| `i_client_talk_power` | 客户端的「说话力」 | 权限名表 |
| `i_client_needed_talk_power` | 进入频道所需的最低说话力 | 同上；`channel_needed_talk_power` 是频道侧属性 |
| `b_client_is_priority_speaker` | 优先发言人（压低他人音量而非禁言） | 同上 |
| `virtualserver_priority_speaker_dimm_modificator` | 优先发言人把别人压低的 dB 系数 | 属性 `0xba8318` |
| `virtualserver_min_clients_in_channel_before_forced_silence` | 频道内人数达标后强制静音（防串音） | 属性 `0xba82dd` |
| `b_client_request_talker` / `b_client_set_flag_talker` / `client_talk_request` / `client_talk_request_msg` | 「请求发言权」（push-to-talk 申请） | 权限名表 + 客户端属性 `0xba8ebd`/`0xba8ed1` |
| `b_client_force_push_to_talk` | 强制 PTT | 权限名表 |
| `client_flag_talking` / `client_input_muted` / `client_output_muted` / `client_outputonly_muted` | 说话/静音状态（ServerQuery 可见） | 客户端属性 `0xba8c27`/`0xba8c3b`/`0xba8c4e`/`0xba8c62` |
| `client_volume_modificator` | 该客户端对他人音量的倍率 | 属性 `0xba8d54` |
| `client_is_recording` | 录制标记 | 属性 `0xba8d40` |

频道级语音参数（`channel_*` 属性，与 ServerQuery `channelinfo` 输出同源）：

```
channel_codec                     # 0=Speex窄带 1=Speex宽带 2=CELT mono 3=CELT voice 4=Opus voice 5=Opus music（枚举值待确认）
channel_codec_quality             # 0..10
channel_codec_latency_factor      # 延迟因子
channel_codec_is_unencrypted      # 是否允许明文语音
channel_needed_talk_power         # 进入所需的 talk power
channel_security_salt             # 频道级盐
```
证据：`strings -t x`（`0xba89a5`–`0xba8b6a` 连续区块）。
`channel_codec` 的**具体枚举取值语义未确认**（需与客户端 `01-architecture.md` 或抓包交叉验证）；
可确认的是服务端只做**枚举校验、迁移与下发**，不做编码——见 §9。

服务端还有一条**历史迁移日志**，证明服务端认识这些 codec 枚举但不处理音频数据：
```
Channels with Speex or CELT codec have been updated to Opus.
set invalid codec to OPUS_VOICE for channel 
Create channels using OPUS (voice) codec
Create channels using OPUS (music) codec
```

---

## 6. 权限与频道模型

### 6.1 权限模型（官方文档 + 二进制双证）

`doc/permissiondoc.txt` 定义四类权限：

| 类型 | 前缀 | 语义 | 例子 |
|---|---|---|---|
| 布尔 | `b_` | 允许/拒绝 | `b_virtualserver_modify_name` |
| 整数 | `i_` | 阈值/上限 | `i_channel_max_depth`（-1 = 不限） |
| Power | `i_…_power` | 与配对 `i_…_needed_…_power` 比较，`power >= needed` 才允许 | `i_client_kick_power` / `i_client_needed_kick_power` |
| Grant | `i_needed_modify_power_<原权限名>` | 允许「授予/撤销」某权限的门槛 | `i_needed_modify_power_client_ban_create` |

证据：`doc/permissiondoc.txt` 原文
```
Power and needed Power Permissions
These permissions are a special case of Integer Permissions. They always come in pairs...
i_client_kick_power / i_client_needed_kick_power
Every permission has an associated i_needed_modify_power_* permission, for example
b_client_ban_create has an associated permission called i_needed_modify_power_client_ban_create
```

### 6.2 二进制里的权限名统计（515 条）

从 `strings` 抽取 `b_*` / `i_*` 权限标识符（去重 515 条）：
```
$ grep -oE '\b[bi]_[a-z0-9_]+' strings | sort -u | wc -l
515
b_ 前缀            181
i_ 前缀（非 grant）  81
i_needed_modify_power_ 前缀 253
```

按「前缀 + 第二段对象」细分（前 20 组）：

| 组 | 数量 | 组 | 数量 |
|---|---|---|---|
| `b_virtualserver_*` | 78 | `i_needed_modify_power_virtualserver_*` | 78 |
| `i_needed_modify_power_channel_*` | 64 | `i_needed_modify_power_client_*` | 62 |
| `b_channel_*` | 46 | `b_client_*` | 32 |
| `i_client_*` | 30 | `i_channel_*` | 19 |
| `i_needed_modify_power_ft_*` | 16 | `i_ft_*` | 14 |
| `b_serverinstance_*` | 13 | `i_needed_modify_power_serverinstance_*` | 13 |
| `i_group_*` | 11 | `i_needed_modify_power_group_*` | 11 |
| `b_serverquery_*` | 4 | `i_serverquery_*` / grant | 4+4 |
| `b_icon_*` / `i_icon_*` | 2 / 2 | `b_permission_*` / `i_permission_*` | 1 / 1 |

**语音相关权限共 41 条**（完整列出，供语音功能改造参考）：

| 权限名 | 类型 |
|---|---|
| `i_client_talk_power` | i（说话力） |
| `i_client_needed_talk_power` | i（所需说话力） |
| `i_client_whisper_power` | i |
| `i_client_needed_whisper_power` | i |
| `b_client_is_priority_speaker` | b |
| `b_client_request_talker` | b |
| `b_client_set_flag_talker` | b |
| `b_client_force_push_to_talk` | b |
| `b_channel_create_modify_with_codec_opusvoice` | b |
| `b_channel_create_modify_with_codec_opusmusic` | b |
| `b_channel_modify_codec` | b |
| `b_channel_modify_codec_quality` | b |
| `b_channel_modify_codec_latency_factor` | b |
| `b_channel_modify_make_codec_encrypted` | b |
| `b_channel_modify_needed_talk_power` | b |
| `b_channel_create_with_needed_talk_power` | b |
| `b_virtualserver_modify_codec_encryption_mode` | b |
| `b_virtualserver_modify_priority_speaker_dimm_modificator` | b |
| `i_channel_create_modify_with_codec_maxquality` | i |
| `i_channel_create_modify_with_codec_latency_factor_min` | i |
| `i_channel_modify_make_codec_encrypted` | i |
| 其余 20 条 | 均为上表前 21 条的 `i_needed_modify_power_*` grant 对 |

### 6.3 权限存储：SQL 五张 perm 表 + 加载查询

| 表 | 语义 | 列 |
|---|---|---|
| `perm_server_group` | 服务器组权限 | `server_id, id1, id2, perm_id, perm_value, perm_negated, perm_skip` |
| `perm_channel` | 频道级权限 | 同上 |
| `perm_channel_groups` | 频道组权限 | 同上 |
| `perm_channel_clients` | 频道内单客户端权限 | 同上 |
| `perm_client` | 客户端级权限 | 同上 |

`perm_negated`（拒绝优先）/`perm_skip`（跳过继承）是 TS3 权限继承的关键：
证据：`sql/create_sqlite/create_tables.sql`
```sql
CREATE TABLE perm_server_group (
  server_id    integer unsigned NOT NULL,
  id1          integer unsigned NOT NULL,
  id2          integer unsigned NOT NULL,
  perm_id      varchar(100) NOT NULL,
  perm_value   integer,
  perm_negated integer,
  perm_skip    integer
);
```
权限**聚合**查询（服务端把组权限展平成「总量」写进内存）：
```
sql/permission_load_server_group_total.sql
sql/permission_load_channel_group_total.sql
sql/permission_load_server_and_channel_group_total.sql
sql/permission_load_other.sql
```
证据：`sql/` 目录清单（187 个文件，其中 `sql/` 根 180 个）。

### 6.4 默认组与权限版本

证据：`sql/defaults.sql`
```sql
insert into groups_server (group_id, server_id, name, type) values
 ( 1, 0, 'Guest Server Query', 2 ),
 ( 2, 0, 'Admin Server Query', 2 ),
 ( 3, 0, 'Server Admin', 0 ),
 ( 4, 0, 'Normal', 0 ),
 ( 5, 0, 'Guest', 0);

insert into groups_channel (group_id, server_id, name, type) values
 ( 1, 0, 'Channel Admin', 0 ),
 ( 2, 0, 'Operator', 0 ),
 ( 3, 0, 'Voice', 0 ),
 ( 4, 0, 'Guest', 0);
```
`type`：0 = 普通组，1 = 模板组（`serverinstance_template_*_group` 指向），2 = Query 组。
证据：`sql/defaults.sql` 开头
```sql
insert into instance_properties (server_id, string_id, id, ident, value) values
 ( 0, '', 0, 'serverinstance_filetransfer_port', '30033' ),
 ( 0, '', 0, 'serverinstance_guest_serverquery_group', '1' ),
 ( 0, '', 0, 'serverinstance_template_serveradmin_group', '3' ),
 ( 0, '', 0, 'serverinstance_template_serverdefault_group', '5' ),
 ( 0, '', 0, 'serverinstance_template_channeladmin_group', '1' ),
 ( 0, '', 0, 'serverinstance_template_channeldefault_group', '4' ),
 ( 0, '', 0, 'serverinstance_permissions_version', '24');
```
→ 权限定义版本 24（`update_permissions_12.sql` 是历史升级脚本）；
服务端启动时若发现 `no_permission_update` 未设置且版本落后，会重跑权限装载。

频道组继承链：`client_channel_group_inherited_channel_id`（属性 `0xba9000`）
与 `channel_flag_are_subscribed` / `channel_maxfamilyclients` / `channel_flag_maxfamilyclients_inherited`
共同构成频率「频道家族」模型。

---

## 7. 数据库

### 7.1 `sql/` 目录结构

| 位置 | 文件数 | 作用 |
|---|---|---|
| `sql/`（根） | 180 | 三条 SQL 方言共用的 DML/DDL 片段：`*_insert.sql`、`*_get*.sql`、`*_update*.sql`、`*_delete*.sql`、`perm_*`、`permission_load_*` |
| `sql/create_sqlite/` | 2 | `create_tables.sql`（27 张表）、`drop_tables.sql` |
| `sql/create_mariadb/` | 2 | 同上（MySQL/MariaDB 方言） |
| `sql/create_postgresql/` | 5 | 同上 + `after_defaults.sql` 等 PG 专有修正 |
| `sql/updates_and_fixes/` | 2 | 历史修补 |
| 升级脚本 | `update_12.sql`…`update_34.sql`、`update_mariadb_26..33.sql`、`update_sqlite_27..33.sql`、`update_postgresql_33.sql` | 逐版本迁移 |
| 默认数据 | `defaults.sql`（71 KB） | 实例/服务器属性、默认组、默认权限 |

证据：`find sql -type f | wc -l` → 187；`ls sql/create_*` → 三个方言目录。
证据：`sql/update_34.sql`（最新升级脚本，只加索引）
```sql
CREATE INDEX index_servers_machine_id ON servers (server_machine_id);
CREATE INDEX index_clients_server_id_lastconnected_unique_id ON clients (server_id, client_lastconnected, client_unique_id);
CREATE INDEX index_group_server_to_client_serverid_id1 ON group_server_to_client (server_id, id1);
```
证据：`sql/update_database_version.sql`
```sql
update instance_properties set value = :value: where ident='serverinstance_database_version';
```
→ **库版本写在 `instance_properties.serverinstance_database_version`**；最新 schema = **34**
（`update_34.sql` 存在且是最高编号）。

### 7.2 核心表（SQLite 方言，27 张）

| 表 | 列数 | 关键列 | 备注 |
|---|---|---|---|
| `clients` | 14 | `client_id, server_id, client_unique_id, client_nickname, client_login_name, client_login_password, client_lastconnected, client_totalconnections, client_month_upload/download, client_total_upload/download, client_lastip` | 身份+流量统计 |
| `channels` | 4 | `channel_id, channel_parent_id, server_id, org_channel_id` | 树结构（父指针） |
| `servers` | 8 | `server_id, server_port, server_autostart, server_machine_id, server_month_upload/download, server_total_upload/download` | 每个虚拟服务器一行 |
| `client_properties` | 4 | `server_id, id, ident, value` | EAV：`client_*` 属性（含语音状态） |
| `channel_properties` | 4 | `server_id, id, ident, value` | EAV：`channel_codec*`、`channel_needed_talk_power` |
| `server_properties` | 4 | `server_id, id, ident, value` | EAV：`virtualserver_*` |
| `instance_properties` | 5 | `server_id, string_id, id, ident, value` | 实例级（含 `serverinstance_filetransfer_port`、`serverinstance_permissions_version`） |
| `groups_server` / `groups_channel` | 5 | `group_id, server_id, name, type, org_group_id` | 服务器组 / 频道组 |
| `group_server_to_client` / `group_channel_to_client` | 4 | `group_id, server_id, id1, id2` | 组↔客户端绑定 |
| `perm_server_group` / `perm_channel` / `perm_channel_groups` / `perm_channel_clients` / `perm_client` | 7 | `perm_id, perm_value, perm_negated, perm_skip` | 五张权限表 |
| `tokens` | 9 | `token_key, token_type, token_id1, token_id2, token_created, token_description, token_customset` | 一次性特权密钥 |
| `messages` | 9 | `message_from_client_id/uid, message_to_client_id, message_subject, message_msg, message_timestamp` | 离线消息 |
| `complains` | 6 | `complain_from_client_id, complain_to_client_id, complain_message, complain_timestamp, complain_hash` | 投诉 |
| `bans` | 15 | `ban_ip, ban_name, ban_uid, ban_timestamp, ban_length, ban_invoker_client_id` | 封禁 |
| `custom_fields` | — | `client_id, ident, value` | 客户端自定义字段 |
| `revocations` | — | `revocation_key, revocation_type, revocation_expiration` | MyTS 身份吊销 |
| `integrations` / `integration_actions` | 6 / 7 | `integration_type, integration_user_info, …` | 第三方集成（webhook） |
| `temporary_passwords` | 11 | `temporary_password_hash, temporary_password_plaintext, …_start/end_timestamp, …_channel_id, …_channel_password` | 临时密码 |
| `api_keys` | 7 | `api_key_hash, api_key_owner_dbid, api_key_scope, api_key_created_at, api_key_expires_at` | **WebQuery 的 API Key** |

证据：`grep -c 'CREATE TABLE' sql/create_sqlite/create_tables.sql` → **27**
证据：`clients` 建表语句
```sql
CREATE TABLE clients (
  client_id               integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  server_id               integer unsigned,
  client_unique_id        varchar(40),
  client_nickname         varchar(100),
  client_login_name       varchar(20) UNIQUE,
  client_login_password   varchar(40),
  client_lastconnected    integer unsigned,
  client_totalconnections integer unsigned default 0,
  client_month_upload     integer unsigned default 0,
  client_month_download   integer unsigned default 0,
  client_total_upload     integer unsigned default 0,
  client_total_download   integer unsigned default 0,
  client_lastip           varchar(45),
  org_client_id           integer
);
```

### 7.3 语音/统计相关字段落点

- 语音参数**不在固定列里**，而在 `channel_properties` 的 EAV 行里：
  `channel_codec`、`channel_codec_quality`、`channel_codec_latency_factor`、
  `channel_codec_is_unencrypted`、`channel_needed_talk_power`、`channel_security_salt`。
- 客户端语音状态同理在 `client_properties`：`client_flag_talking`、`client_input_muted`、
  `client_output_muted`、`client_outputonly_muted`、`client_volume_modificator`、
  `client_is_recording`、`client_is_priority_speaker`(权限，不落库)。
- 流量统计拆成三级（实例 / 虚拟服务器 / 客户端），且每级都有
  `month_*` 与 `total_*` 两组列，另有 SQL 片段 `client_update_traffic_stats.sql`、
  `server_update_traffic_stats.sql`、`client_clear_traffic_stats.sql`、
  `server_clear_traffic_stats.sql`、`client_update_stats.sql`。
- 连接级（不落库，运行时对象）统计名以 `connection_*` 开头，Speech/Keepalive/Control 三分：
  `connection_packets_sent_{speech,keepalive,control,total}`、
  `connection_bytes_received_{speech,keepalive,control,total}`、
  `connection_packetloss_{speech,keepalive,control,total}`、
  `connection_bandwidth_sent_last_second_{speech,keepalive,control}`、`connection_ping`、
  `connection_server2client_packetloss` 等（证据：属性名表 `0xba6fa3`–`0xba93ef`）。
  → **「语音包」在统计口径上是独立一类（speech）**，与 keepalive/control 分开计费与限速。

---

## 8. 管理接口（ServerQuery / WebQuery / API Key）

### 8.1 140 个 ServerQuery 命令分类

证据：`ls serverquerydocs | wc -l` → **140**（`docs/serverquerydocs/*.txt`）

| 分组 | 数量 | 命令 |
|---|---|---|
| `client*` | 19 | `clientaddperm clientaddservergroup clientdelperm clientdelservergroup clientedit clientfind clientgetdbidfromuid clientgetids clientgetnamefromdbid clientgetnamefromuid clientgetuidfromclid clientinfo clientkick clientlist clientmove clientpermlist clientpoke clientsetserverquerylogin clientupdate` |
| `servergroup*` | 14 | `…add …addclient …addperm …autoaddperm …autodelperm …clientlist …copy …del …delclient …delperm …list …permlist …rename …sbyclientid` |
| `server*` | 12 | `servercreate serverdelete serveredit serveridgetbyport serverinfo serverlist serverprocessstop serverrequestconnectioninfo serversnapshotcreate serversnapshotdeploy serverstart serverstop` |
| `channel*` | 10 | `channeladdperm channelcreate channeldelete channeldelperm channeledit channelfind channelinfo channellist channelmove channelpermlist` |
| `channelgroup*` | 9 | `…add …addperm …clientlist …copy …del …delperm …list …permlist …rename` |
| `ft*` | 9 | `ftcreatedir ftdeletefile ftgetfileinfo ftgetfilelist ftinitdownload ftinitupload ftlist ftrenamefile ftstop` |
| `perm*` | 6 | `permfind permget permidgetbyname permissionlist permoverview permreset` |
| `ban*` | 5 | `banadd banclient bandel bandelall banlist` |
| `clientdb*` | 5 | `clientdbdelete clientdbedit clientdbfind clientdbinfo clientdblist` |
| `message*` | 5 | `messageadd messagedel messageget messagelist messageupdateflag` |
| `complain*` | 4 | `complainadd complaindel complaindelall complainlist` |
| `custom*` | 4 | `customdelete custominfo customsearch customset` |
| `log*` | 4 | `logadd login logout logview` |
| `privilegekey*` | 4 | `privilegekeyadd privilegekeydelete privilegekeylist privilegekeyuse` |
| `token*` | 4 | `tokenadd tokendelete tokenlist tokenuse` |
| `apikey*` | 3 | `apikeyadd apikeydel apikeylist` |
| `channelclient*` | 3 | `channelclientaddperm channelclientdelperm channelclientpermlist` |
| `querylogin*` | 3 | `queryloginadd querylogindel queryloginlist` |
| `servertemp*` | 3 | `servertemppasswordadd servertemppassworddel servertemppasswordlist` |
| 其余 | 12 | `bindinglist gm help hostinfo instanceedit instanceinfo quit sendtextmessage setclientchannelgroup servernotifyregister servernotifyunregister use version whoami` |

**语音/音频/加密相关的可见字段**（服务端属性表与命令文档同源，取自二进制属性名表更完整）：

| 命令 | 语音/加密相关字段 |
|---|---|
| `channelinfo` / `channellist` | `channel_codec`、`channel_codec_quality`、`channel_codec_latency_factor`、`channel_codec_is_unencrypted`、`channel_needed_talk_power`、`channel_security_salt` |
| `clientinfo` / `clientlist` | `client_flag_talking`、`client_input_muted`、`client_output_muted`、`client_outputonly_muted`、`client_input_hardware`、`client_output_hardware`、`client_is_recording`、`client_volume_modificator`、`client_encryption_ciphers`、`client_key_offset`、`client_talk_request`、`client_talk_request_msg`、`client_is_priority_speaker`(经权限) |
| `serverinfo` / `serverrequestconnectioninfo` | `virtualserver_codec_encryption_mode`、`virtualserver_encryption_ciphers`、`virtualserver_needed_identity_security_level`、`virtualserver_priority_speaker_dimm_modificator`、`virtualserver_min_clients_in_channel_before_forced_silence`、`virtualserver_total_packetloss_{speech,keepalive,control,total}`、`virtualserver_total_ping` |
| `connectioninfo`（`serverrequestconnectioninfo` 返回） | `connection_packets_sent_speech`、`connection_bytes_received_speech`、`connection_packetloss_speech`、`connection_bandwidth_sent_last_second_speech`、`connection_server2client_packetloss_speech` … |

证据：`strings -t x ts3server` 的连续属性名区块（`0xba78a0`–`0xba93ef`），
与 `serverquerydocs/channelinfo.txt` 的 `Example:` 行输出字段同构。

### 8.2 WebQuery（HTTP）与 API Key

证据：`doc/webquery.md`
```
Most requests are of the form:  /{serverId}/{command}
Sometimes you may need to address the entire instance; in that case you may omit the serverId path. e.g. /version
You can use POST or GET, but we recommend you use POST for most calls. Data is returned in JSON format, with body and status objects.
$ curl -X POST http://localhost:10080/1/whoami?api-key=…
If you need to address the server by port, rather than by id, you can use the following syntax: /byport/9987/channellist
```

| 项 | 值 | 证据 |
|---|---|---|
| 默认端口 | 10080（HTTP）/ 10443（HTTPS） | `0x41058f` / `0x41063a` |
| 认证 | API Key（查询参数或头），对应 `api_keys` 表 | `api_keys(api_key_hash, api_key_owner_dbid, api_key_scope, api_key_created_at, api_key_expires_at)` |
| 管理命令 | `apikeyadd` / `apikeydel` / `apikeylist` | `serverquerydocs/apikey*.txt` |
| 响应结构 | `{"body":[…],"status":{"code":0,"message":"ok"}}` | `doc/webquery.md` 示例 |
| 启用方式 | 由 `query_protocols` 控制，默认 `raw,http,ssh` | 配置键 `query_protocols` 默认值串 |
| TLS | mbedtls（`query_https_certificate_file` / `query_https_private_key_file`） | 配置键 + `ts_mbedtls` 字符串 |
| 文档服务 | `serverquerydocs_path=serverquerydocs/` | 配置键 |

`Query_*` 类族（RTTI 实测）把「传输」与「终端」解耦：
`Query_Listener`（抽象）→ `Query_Raw_Listener` / `Query_Http_Listener` / `Query_Https_Listener` / `Query_Ssh_Listener`；
`Query_Transport`（抽象）→ `Query_Raw_Transport` / `Query_Network_Transport` / `Query_Ssh_Transport`；
`Query_Terminal` → `Query_Raw_Terminal` / `Query_Pty_Terminal`；
`Query_Transmission_Receive` 承载分帧接收；`Query_Http_Session` + `Query_Http_Response` 承载 HTTP 会话。
证据：`vtable.py` 恢复的 20+ 个 `Query_*` vtable（`0xfb5748`–`0xfbb8d0`）。

---

## 9. 关键结论：服务端是否做语音编解码？

**结论：服务端只做透明转发（relay），不解码也不编码语音。**
它**编译进了完整的客户端解码栈**（CELT/Opus/Speex 解码 + libspeex 抖动缓冲），
但那套栈在服务端被一个**常量桩**接管，且真正的批量解码函数**没有任何调用者**；
编码器**完全不存在**。逐条证据如下。

### 9.1 证据 A：解码栈确实被链入（6 个函数可归属 `sound/`）

```
$ python3 /tmp/ts3/modmap.py stats        # 按 __FILE__ 断言串做模块归属
  6  deps/teamspeak_common_lib/sound
  2  deps/speex_ts/libspeex
```
| 文件 | 函数 | 关键字符串 |
|---|---|---|
| `sound/decode.cpp` | `FUN_ae5850` | `Assertion "channels == 1 || channels ==2"` |
| `sound/decode.cpp` | `FUN_ae6750` | 批量解码（见 9.5），含 CELT/OPUS 解码失败日志 |
| `sound/decode.cpp` | `FUN_ae82c0` | **编解码器工厂**：`CELT codec was not initalised correctly`、`Failed to initialise OPUS decoder`、`Failed to initialise speex decoder (are you out of memory?)`、`Invalid codec encountered` |
| `sound/decode.cpp` | `FUN_ae8d40` / `FUN_ae97a0` | `Assertion "m_SampleRate == 8000"`（**窄带 8 kHz 路径**） |
| `sound/decodemanager.cpp` | `FUN_ad2630` | `Assertion "m_pPlaybackBase"` |
| `speex_ts/libspeex/nb_celp.c` | `FUN_b346f0` | `Fatal (internal) error in %s, line %d: %s`（Speex 内部错误） |
| `speex_ts/libspeex/jitter.c` | `FUN_b31460` | `assertion failed: pos <= tb->filled && pos < MAX_TIMINGS`（抖动缓冲） |

编解码器枚举与能力串（`decode.cpp` 同一区块 `0xc20530`–`0xc20b88`）：
```
Could not decode CELT sound data, dropping.
Could not interpolate CELT sound data, padding silence.
Could not decode OPUS sound data, padding silence.
Invalid codec specified
Assertion "m_Channels==1 || codec == CODEC_OPUS_MUSIC" failed at .../sound/decode.cpp:
```
`FUN_ae82c0` 是**按 codec 枚举分派的工厂**（跳转表 `# c20698`，6 个 case）：
```
ae82d8: cmp BYTE PTR [rdi+0xf9],0x0        ; this->flag
ae8335: lea rcx,[rip+0x13835c]  # c20698   ; 跳转表基址
ae833c: movsxd rax,DWORD PTR [rcx+rax*4]
ae8343: jmp rax                            ; switch(codec)
```
它引用的 vtable 常量：`fae758`、`fae8a0`、`fae958`（三个具体 decoder 实现对象的 vtable）。
`Decode` 类 vtable `0xfd1030`（10 槽），其中槽 3 = `FUN_ae6750`。

### 9.2 证据 B：**没有任何编码器**（决定性）

全二进制搜 `encod`（大小写不敏感）只命中四类无关内容，**不含任何音频编码器**：
```
$ strings -a ts3server | grep -i encod | sort -u
Base64 encoding test:
.../src/misc/base64/base64_encode.c
.../src/pk/asn1/der/**/der_encode_*.c      (ASN.1)
Content-Encoding / Content-Transfer-Encoding   (HTTP)
Could not encode local filename to utf8
```
对照解码侧：`decode.cpp`/`decodemanager.cpp`/`nb_celp.c`/`jitter.c` 全部存在，且
没有任何 `encode.cpp` / `Celt_Encoder` / `Opus_Encoder` / `Speex_Encoder` 字符串。
→ **架构上不存在「解码 A → 编码 B」的转码可能**：服务端甚至连编码 API 都没链进来。

### 9.3 证据 C：实例化链证明它只是个「占位/兼容」实现

启动路径（`serverlib_private.cpp: FUN_4bfd40` → `VirtualServerManager: FUN_50b280`）里：
```
new(0x1a8) → FUN_60cfc0            ; VoiceStreamer 对象
new(0x58)  → FUN_ad2630            ; DecodeManager 基类 ctor（decodemanager.cpp）
            mov [obj+0], &vtable 0xfb2498   ; 改写成 DecodeManagerServer
            mov [VoiceStreamer+8], DecodeManager
```
`DecodeManagerServer` 只**多实现了一个**虚函数（vtable 3 槽：D1、D0、1 个业务虚函数），
而它的实现是 **7 条指令的常量桩**：
```
$ objdump -d ts3server（0x51b340，DecodeManagerServer 的业务虚函数）
51b340: mov rax,QWORD PTR [rsp+0x8]
51b345: mov rcx,QWORD PTR [rsp+0x10]
51b34a: mov DWORD PTR [r9],0x3f800000      ; *out_volume = 1.0f
51b351: mov BYTE PTR [rcx],0x0             ; *out_flag  = 0
51b354: mov DWORD PTR [rax],0x64           ; *out_x     = 100
51b35a: mov al,0x1
51b35c: ret
```
→ 服务端把「播放端参数」写死成 `volume=1.0 / 100 / 0` 并返回 true。
这正是**没有真实播放设备/没有真实解码消费者**时的适配器写法。

### 9.4 证据 D：批量解码函数**零调用点**

`FUN_ae6750`（`decode.cpp` 的批量解码，处理 CELT/Opus 解码失败与静音填充）：
```
$ python3 /tmp/ts3/graph.py callers 0xae6750
（空）
$ python3 - <<'EOF'  # 搜它的地址是否出现在任何 vtable/函数指针表
0xae6750 → 唯一出现处：0xfd1048（= Decode vtable 的槽 3）
EOF
$ python3 /tmp/ts3/graph.py reach 0xae82c0      # 工厂函数
NOT-REACHED
```
在以 `_start`+`.init_array` 为根、只走**直接调用边**的可达集里（2315 / 17939 个函数），
`FUN_ae6750`、`FUN_ae82c0`、`FUN_ae5850` 全部**不可达**——它们唯一的入口是 `Decode` 的 vtable。
而 `Decode` 对象只在 `FUN_ae6080`/`FUN_ae5150` 里构造（写 vtable `0xfd1030`），
这两个构造函数的直接调用者分别是析构链与 `DecodeManager` 析构，**没有一条来自包处理/转发路径**。

### 9.5 证据 E：转发路径不含解码步骤

语音包在服务端的处理只有「头解析 → 尺寸/类型校验 → 重新封装 → 按目标集合发送」，
载荷按 `(numberVoicePackets, voiceDataSize)` 原样搬运（`decode.cpp` 里那条断言
`numberVoicePackets > 0 && voiceDataSize % numberVoicePackets == 0` 描述的正是
**这个不透明载荷的内部布局约束**，即「N 帧等长」，是转发侧与解码侧共用的格式约定）：

| 环节 | 类/函数 | 证据 |
|---|---|---|
| 解析 | `IncomingPacket`（`FUN_49b700` 等 10 个函数） | `m_State == ENCRYPTED` 断言；`getVoiceDataSize()` 断言 |
| 校验 | `PacketHandler_Base::FUN_a91fa0` | `Invalid Voice Packet received, dropping`（长度 0x27 自证） |
| 封装 | `OutgoingVoicePacket` / `OutgoingVoiceWhisperPacket` | `numberVoicePackets < 256`、`count <= 255 && count == {channel,client}ListSize` |
| 广播 | `VoiceStreamer`（24 槽，`0x60d680`–`0x60da10`） | 与 `UDPServer::sendto` 同处 `0x60xxxx` 段 |
| 发送 | `FUN_60fff0`（`udpserver.cpp`） | `UDP packet send returned error : ` |

→ **转发链路上没有任何对 `Decode`/`DecodeManager` 的调用**（§9.4 的调用者为空是硬证据）。

### 9.6 最终判定

| 判断 | 结论 | 置信度 |
|---|---|---|
| 服务端是否编码语音？ | **否**（无编码器代码） | 高（`encod` 全量搜索） |
| 服务端是否解码语音用于转发？ | **否**（转发链路无解码调用） | 高（vtable 唯一引用 + 零调用者 + 可达性分析） |
| 为何二进制里有完整解码栈？ | 共享 `teamspeak_common_lib`：`DecodeManager` 是 `VirtualServerManager` 的成员，其服务端实现被桩化（`DecodeManagerServer`），真正的解码/播放只在客户端使用 | 中高 |
| 服务端是否修改语音载荷（混音/重采样/音量）？ | **否**。音量/优先级是通过**下发给客户端**的权限与属性控制（`client_volume_modificator`、`virtualserver_priority_speaker_dimm_modificator`），客户端侧执行 | 中（属性名+类结构推断） |
| 加密是否逐包重加密？ | 是否：语音包在 UDP 层按频道/虚拟服务器密钥加密，服务端**必须解密包头与载荷**才能转发给其他客户端（它持有会话密钥）——这与「不编解码」不矛盾。具体是否对**语音载荷**做端到端加密（client-to-client，服务器不可见）：**未确认** | 低—中 |

> 修正说明：本题容易被 `deps/.../sound/decode.cpp` 的存在误导。判定依据必须是
> **调用者/可达性**，而不是「字符串在不在」。本节的 B/D/E 三条证据互相独立且同向。

### 9.7 补充：Ghidra 伪代码确认（`DecodeManager` 构造函数不启动任何解码）

检查点就绪后用单点反编译复核了 §9.3 的落地函数：

```
$ rea decompile ts3server 0xad2630 --json        # 检查点复用，约 14 s
void FUN_00ad2630(undefined8 *param_1,long param_2,undefined1 param_3,undefined1 param_4)
{
  *param_1 = &PTR_FUN_00fd0d58;                  ; ← 写入 DecodeManager vtable (0xfd0d58)
  FUN_00429140(param_1 + 1);
  *(undefined1 (*) [16])(param_1 + 7) = 0;
  param_1[6] = param_1 + 7;
  param_1[9] = param_2;                          ; ← 保存 VoiceStreamer*（本函数第 2 参数）
  *(undefined1 *)(param_1 + 10) = param_3;
  *(undefined1 *)((long)param_1 + 0x51) = param_4;
  if (param_2 == 0) {                            ; ← 只有「没给 VoiceStreamer」才走断言
    ... FUN_00427500(&local_138,
        "Assertion \"m_pPlaybackBase\" failed at .../sound/decodemanager.cpp:", 0x68) ...
  }
  return;                                        ; ← 无线程启动、无定时器、无 decode 调用
}
```

三点确认：
1. 它是 **构造函数**（首句写 vtable，参数是 `VoiceStreamer*` + 两个 bool），不是「解码驱动函数」；
2. 函数体里**没有任何** `Decode` 虚调用、没有 `pthread_create`、没有定时器注册 → 服务端实例化
   `DecodeManager` 只是建了个空壳容器；
3. `m_pPlaybackBase` 断言只在「传入空 VoiceStreamer」时触发，说明该字段的语义是
   「播放源/语音来源」，而服务端恰恰**没有**播放源——与 §9.3 的常量桩（`volume=1.0`）互相印证。

> 复核受限说明：本轮对 `FUN_ae6750`（批量解码）的第二次反编译遇到与其它 agent 共享的
> Ghidra 检查点锁冲突（`REA_GHIDRA_CHECKPOINT_DIR: another REA session owns this checkpoint`），
> 未取到伪代码。该函数的「零调用者」结论来自 §9.4 的静态调用图 + vtable 唯一引用，**未**依赖伪代码。
> 另一个坑：`rea decompile <bin> 0xae6750` 会被当作**文件偏移**解析成 `0x10e6750`（数据段），
> 必须用 `ram:0xae6750` 这种带地址空间前缀的写法。

---

## 10. 未确认 / 待补

| # | 待确认项 | 现状与下一步 |
|---|---|---|
| 1 | `get_packet_mtu()` 的**具体 MTU 数值**（v4/v6 各多少） | 断言与超限日志已定位（`outgoingpacket.cpp`），但该函数是极小常量返回函数，尚未反编译读出常量。代码中 `0x5dc`(=1500) 出现在 Query 缓冲区上下文，**不能**直接当作语音 MTU。下一步：反编译 `FUN_49fd30` 里对 `get_packet_mtu` 的调用点 |
| 2 | `Decode`/`DecodeManager` 是否在**运行期被虚调用** | **已部分确认**：`FUN_ad2630` 是构造函数、无线程/定时器/虚调用（§9.7）。仍未确认的是「服务端是否有别处驱动 Decode 槽 3」，需要 `FUN_ae6750` 的伪代码 + 对 `DecodeManager` 全部方法的复核 |
| 3 | RSA puzzle 的**具体参数**（`PUZZLE_DATA_SIZE_x` / `_n` 常量、难度） | 断言文案已给出符号名；常量在 `rsa_puzzle.cpp` 的 `PuzzleData` 里，未取值 |
| 4 | command packet 的**压缩阈值**（多大才 QuickLZ、`Command Packet size limit` 上限多少） | 只有两条尺寸防线字符串，未见常量 |
| 5 | 服务端↔服务端 / Query 的 `Shared_Secret_Type` **握手报文顺序** | `connection.cpp` 只有断言；需反编译 `Connection::` 密钥协商函数 |
| 6 | DTLS 是否真的被用于任何通道 | mbedtls 里 DTLS 代码与断言存在，但没有找到 DTLS 监听类；可能仅编译进来未使用 |
| 7 | 服务器快照（`serversnapshotcreate/deploy`）**存储格式与落点** | `create_sqlite/create_tables.sql` 里**没有** snapshot 表；`sql/server_snapshot_delete*.sql` 存在 → 快照大概率是序列化到文件/属性，未确认 |
| 8 | 线程模型细节：epoll 是**单 reactor 多线程**还是每 VS 一套 | 有 `thread_pool_size`（1..30）、`threads_voice_udp`（5）、`query_pool_size`（2）三个池参数，但 reactor 拓扑未确证 |
| 9 | 语音是否**端到端加密**（服务器不解载荷） | 见 §9.6 末行；`channel_codec_is_unencrypted` / `virtualserver_codec_encryption_mode` 暗示按频道可配，但密钥层次未确认 |
| 10 | Ghidra 伪代码级确认（已部分完成：§9.7 确认 `DecodeManager` 构造函数；其余待检查点独占时补） | 本机 7.8 GB 内存 + 三 agent 并发，13.7 MB stripped ELF 的首次导入超过默认 330 s 超时；本轮被迫以「反汇编 + RTTI + 字符串 + 调用图」四链互证。检查点建好后可用 `rea decompile ts3server 0xae6750` 等单点补齐 |

### 附：本轮使用的可复现脚本（工作副本，非交付物）

| 脚本 | 作用 |
|---|---|
| `/tmp/ts3/xref.py` | 函数边界（`.eh_frame_hdr`）+ 字符串↔地址 + 交叉引用查询 |
| `/tmp/ts3/graph.py` | 直接调用图、可达性、路径、调用者/被调用者 |
| `/tmp/ts3/modmap.py` | 按 `__FILE__` 断言串做函数→源码文件归属 |
| `/tmp/ts3/vtable.py` | Itanium ABI vtable/typeinfo 恢复（64 个 vtable、3867 条 mangled 名） |

证据：四个脚本的自检输出已在前文各节内联（17,939 函数 / 67,422 调用边 / 589 个可归属函数 / 64 个 vtable）。
