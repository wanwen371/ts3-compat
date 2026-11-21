# 握手 ground truth（真客户端抓包 + 服务端反编译对照）

> 抓包文件：`test/capture/handshake-2026-11-21.log`（UDP relay 记录，432 行/106 包）
> 方法：`node test/udp-relay.js 9999 9987`，用真 TeamSpeak 3.5.6 客户端连 `ts3server://127.0.0.1:9999`
> 目标服务端：本机 ts3server 3.13.9（127.0.0.1:9987）

## 1. 握手包序列（实测）

| # | 方向 | 长度 | 内容 |
|---|---|---|---|
| 1 | C→S | 34 B | INIT1 **variant 0**（`m_Data[17]==0`，校验器要求 size==0x22） |
| 2 | C→S | 168 B | 加密包（tag 在 0..7，`[12]=0x22` → COMMAND，pktid=0）※ 见 §4 |
| 3 | S→C | 32 B | INIT1 server（`[10]=0x88`，`[11]=0x01`） |
| 4 | C→S | 38 B | INIT1 **variant 2**（`[17]==2`，size==0x26，尾部回显服务端 4 字节 `aa dd 15 96`） |
| 5 | S→C | 244 B | INIT1 server（`[10]=0x88`，`[11]=0x03`） |
| 6 | C→S | 469 B | INIT1 **variant 4**（`[17]==4`，校验器要求 size>0x13a=314） |
| 7 | S→C | 488 B | 首个加密包（会话建立） |
| 8+ | 双向 | — | 加密命令/ACK 流 |

## 2. 客户端 → 服务端 INIT1 明文布局（由抓包确定）

```
off  0..7   "TS3INIT1"            (8B 魔数，与服务端 DAT_00fd91a0 一致)
off  8..9   00 65                 (常量)
off 10..11  00 00                 (常量；正是服务端出站 INIT 里 type 所在位置的 +2 偏移来源)
off 12      0x88                  (flags<<4 | type；type=8=INIT1，flags=8)
off 13      0x0e                  (常量)
off 14..16  dc 3a e6              (3B，疑似版本/魔数，抓包固定)
off 17      variant               (0 / 2 / 4，决定整包长度)
off 18..    变体载荷
```

**变体长度（服务端 `FUN_0049b240` 校验器原文）**：

| variant | 要求长度 | 说明 |
|---|---|---|
| 0 | `size == 0x22` (34) | 首包：18..25 为 8B 随机（抓包 `6b 01 86 9d 96 15 dd aa`），26..33 为 8B 零 |
| 2 | `size == 0x26` (38) | 尾部 4B 回显服务端 32B 包的末 4B（抓包 `aa dd 15 96`） |
| 4 | `size > 0x13a` (314) | 大包（密钥交换载荷），抓包 469 B |

其余变体（1/3/5/0x7f/其他）在服务端一律判非法返回 0。

## 3. 服务端 → 客户端 INIT 明文布局（反编译 `FUN_004a0f90` + 抓包）

```
off 0..7    "TS3INIT1"
off 8..9    00 65
off 10      0x88                 (flags<<4|type)
off 11      step                 (抓包见到 0x01 与 0x03)
off 12..    载荷
```
构造器原文：`*(u8*)(m_Data+10)=0x88; *(u16*)(m_Data+8)=0x6500; *(u8*)(m_Data+11)=param_4; memcpy(m_Data+12,payload,n);`
`FUN_004a10f0` 是变体：size 固定 0x10，`[12..15]=bswap32(param_5)`，并把 `m_Data[10] |= 0x40`。

> 注意：**客户端出站比服务端出站多 2 字节**（客户端 type 在 +12，服务端 type 在 +10）——这就是 06 §3.6 猜了很久的 2 字节差，现在有实证。

## 4. 待解（交给协议工程师）

- 抓包第 2 个包（168 B，加密形态）在收到服务端 INIT 之前就发出：需要解释（可能是客户端并行的 INIT1 variant 0 重发/或另一种"带标签"的初始化包）。
- 会话密钥从 variant 4 大包里如何导出（服务端 `rsa_puzzle.cpp` / `crypto` 路径）；KDF 的 20B/64B 材料来源（06 §7.6）。
- 加密包头部确认：`[0..7]=tag`、`[8..9]=packetID(BE16)`、`[12]=type|flags`，`[10..11]` 语义待定（抓包里多为 0）。

## 5. 服务端反编译产物

`docs/ghidra/` 下：
- `init_0x4a0f90.c` — OutgoingINITPacket 构造器（写魔数/0x65/0x88/step/payload）
- `hs_0x4a10f0.c` — INIT 变体构造器（16B，bswap32 字段，`[10]|=0x40`）
- `hs_0x49b2d8.c` — **`IncomingPacket::isValid()`**：9 种包类型的长度/标志/魔数/变体判据（核心）
- `hs_0x49b3e0.c` — EAX 解密封装（13 实参，tag=8）