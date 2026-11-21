# 逆向报告（本仓库协议实现的依据）

本目录是从官方 **TeamSpeak 3 Client 3.5.6** 与 **TeamSpeak 3 Server 3.13.9** 二进制中逆向得到的原始报告，
`server/ts3/*.js` 与 `web/audio.js` 的每一处协议行为都能在这里找到出处。

| 文件 | 内容 |
|---|---|
| [00-overview.md](00-overview.md) | 总报告：体系结构、语音链路、服务端模型、结论与遗留疑问 |
| [01-architecture.md](01-architecture.md) | 客户端整体架构：模块、线程、IPC、插件 ABI、音视频管线 |
| [02-theming.md](02-theming.md) | 主题/图标包系统（Fluent 前端配色的官方出处） |
| [02-iconpack-inventory.csv](02-iconpack-inventory.csv) | 图标包清单（名称、尺寸、用途） |
| [04-voice-client.md](04-voice-client.md) | 语音客户端分册：Opus 编码参数、抖动缓冲、3D 音效、设备选择 |
| [data/client-rtti.txt](data/client-rtti.txt) | 客户端 RTTI / 类清单（从二进制导出） |
| [data/server-classes.txt](data/server-classes.txt) | 服务端类清单 |
| [data/pseudo/*.c](data/pseudo/) | 关键函数的反编译伪代码（握手、语音包、命令解析） |

> 服务端分册（05）与语音协议分册（06）已并入本项目的
> [../server.md](../server.md) 与 [../protocol.md](../protocol.md)，避免重复维护。

## 方法

- 静态：**Ghidra 12.2**（反编译客户端与服务端），IDA 辅助交叉验证；RTTI 导出定位类层次。
- 动态：官方客户端跑在 Windows 侧，用 `test/udp-relay.js` 做 UDP 中继抓包，
  取得 INIT1 握手全流程 106 个包的真实字节（[capture](../../test/capture/handshake-2026-11-21.log)）。
- 双向确认：**抓包得到的字节布局** 与 **服务端 `IncomingPacket::isValid()` 反编译结果** 必须一致才写进代码。

## 法律与用途

报告仅用于**协议互操作性研究**：让第三方客户端能连接用户自己的服务器。
仓库不包含任何 TeamSpeak Systems GmbH 的二进制、图标或协议文本；
文中出现的文件名、字符串均为逆向分析的客观记录。