# 第 3 章 TeamSpeak 3 客户端（3.5.6 win64）静态架构分析

> 分析对象：`/home/gaozikun/1017/ts3/extracted`（NSIS 安装包 7z 解包后的 301 个文件）。
> 方式：**只读**静态分析；未修改/移动目标文件，未安装软件、未联网、未运行 GUI。
> 工具：`7z`、`strings`（含 `-el`）、`objdump -p/-h`、`python3.12`（标准库解析）、`find/awk/grep`。本节命令均在目标目录下实际执行，输出为真实片段。

## 3.0 结论摘要

1. 技术栈为 **Qt 5.12.3（MSVC 2017 x64）+ QtWebEngine（Chromium 69）+ OpenSSL 1.0.2k + QuaZip**；主程序 `ts3client_win64.exe` 17,911,768 字节，把 TS3 协议栈、Speex/Opus 编解码、libtomcrypt 加密、Boost.Asio、c-ares、gRPC/protobuf/BoringSSL（myTeamSpeak）**静态链接**进单 exe。
2. 进程拓扑＝1 个主程序 + 4 个按需辅助 exe（update/package_inst/error_report/createfileassoc）+ QtWebEngine 自带的 `QtWebEngineProcess.exe`；主程序不直接导入 `CreateProcessW`，进程创建走 `Qt5Core.dll`（QProcess）。
3. 扩展点三类：**插件 DLL ABI（116 个 `ts3plugin_*` 入口，Plugin API 25）**、**声音后端 DLL ABI（15 个 `ts3soundbackend_*` 导出 ×2 后端）**、**数据型扩展包**（gfx zip、styles、translations、sound 包、html/WebEngine 页面、addon 包）。

## 3.1 文件清单与职责分组

### 3.1.1 总体数字

| 指标 | 数值 |
|---|---:|
| 文件总数 | 301 |
| 总字节 | 224,837,812（约 214.4 MiB） |
| PE 文件 | 44（9 个 exe + 35 个 dll） |
| 最大文件 | `Qt5WebEngineCore.dll` 79,989,760 |
| 主程序 | `ts3client_win64.exe` 17,911,768 |
| 第三大 | `opengl32sw.dll` 17,599,640 |

**证据**
```
$ find . -type f | wc -l                    → 301
$ find . -type f -printf '%s\n' | awk '{s+=$1} END{print s}'   → 224837812
$ find . -type f \( -iname '*.exe' -o -iname '*.dll' \) | wc -l → 44
$ find . -type f -printf '%s\t%p\n' | sort -rn | head -3
79989760 ./Qt5WebEngineCore.dll / 17911768 ./ts3client_win64.exe / 17599640 ./opengl32sw.dll
```

### 3.1.2 按角色分组（15 组，覆盖全部 301 个文件）

| 组别 | 文件数 | 字节 | 判定依据 |
|---|---:|---:|---|
| 主程序 | 1 | 17,911,768 | PE + 版本资源 `3, 5, 6, 0` + 37 个导入 DLL |
| 辅助/工具 exe | 4 | 3,325,128 | update/package_inst/error_report/createfileassoc |
| Qt 核心运行时 | 5 | 19,701,760 | Qt5Core/Gui/Widgets/Network/Sql（版本资源 5.12.3.0） |
| Qt/Web 扩展库 | 8 | 9,161,216 | Svg/PrintSupport/Positioning/Qml/Quick/QuickWidgets/WebEngineWidgets/WebChannel |
| WebEngine 引擎与数据 | 15 | 95,209,771 | Qt5WebEngineCore + QtWebEngineProcess + icudtl.dat + 4 pak + 9 locale pak |
| Qt 平台/格式插件 | 7 | 3,232,256 | platforms/imageformats×3/iconengines/sqldrivers/styles 的 Qt 插件 |
| 声音后端 | 2 | 298,928 | 2 个 DLL 各导出 15 个 `ts3soundbackend_*` |
| GPU/图形兼容 | 5 | 25,368,726 | libEGL/libGLESv2/d3dcompiler_47/opengl32sw/openglblacklist.json |
| 加密/压缩库 | 3 | 2,626,056 | libeay32/ssleay32/quazip |
| 图标/样式/图形资源 | 20 | 1,169,941 | gfx zip 与 tile、styles qss、styles/default 模板位图 |
| 声音资源 | 155 | 21,334,664 | 151 wav + 4 settings.ini |
| 翻译 | 52 | 5,595,667 | translations/*.qm（7 组） |
| HTML/WebEngine 页面 | 9 | 2,021,704 | html/teamspeak5_intro |
| 安装器残留 | 12 | 17,093,694 | `$PLUGINSDIR` 11 个 + Uninstall.exe.nsis |
| 其他数据/清单 | 3 | 786,533 | changelog.txt / usb.ids / VisualElementsManifest.xml |
| **合计** | **301** | **224,837,812** | 与总量一致 |

**证据**
```
$ python3 分组脚本（os.path.getsize 逐文件累加）
主程序 1 17,911,768 / 辅助/工具 exe 4 3,325,128 / Qt 核心运行时 5 19,701,760 / Qt/Web 扩展库 8 9,161,216
WebEngine 引擎 15 95,209,771 / Qt 平台/格式插件 7 3,232,256 / 声音后端 2 298,928 / GPU/图形兼容 5 25,368,726
加密/压缩库 3 2,626,056 / 图标/样式/图形资源 20 1,169,941 / 声音资源 155 21,334,664 / 翻译 52 5,595,667
HTML/WebEngine 页面 9 2,021,704 / 安装器残留 12 17,093,694 / 其他数据/清单 3 786,533
TOTAL grouped: 301 files 224,837,812 bytes  ==  ALL files: 301  bytes 224,837,812；UNGROUPED: 0
```

### 3.1.3 顶层 36 个文件（按大小降序）

| 字节 | 文件 | 角色 |
|---:|---|---|
| 79,989,760 | `Qt5WebEngineCore.dll` | Chromium 内核（QtWebEngine 5.12.3） |
| 17,911,768 | `ts3client_win64.exe` | 主程序（内部 PDB 名 `ts3clientui.exe`） |
| 17,599,640 | `opengl32sw.dll` | Mesa 10.0.1 软件 OpenGL 回退 |
| 10,218,000 | `icudtl.dat` | ICU 62 数据（`icudt62l`） |
| 6,470,656 | `Qt5Gui.dll` | Qt GUI |
| 6,130,176 | `Qt5Core.dll` | Qt 核心（7916 个导出，含 zlib `z_*`） |
| 5,580,800 | `Qt5Widgets.dll` | Qt Widgets |
| 4,173,928 | `d3dcompiler_47.dll` | D3D 着色器编译器（ANGLE/WebEngine） |
| 4,001,792 | `Qt5Qml.dll` | Qt QML |
| 3,776,000 | `Qt5Quick.dll` | Qt Quick |
| 3,572,224 | `libGLESv2.dll` | ANGLE GLES（导入 d3d9.dll） |
| 2,100,504 | `libeay32.dll` | OpenSSL 1.0.2k libcrypto |
| 1,970,648 | `update.exe` | 客户端更新器 |
| 1,628,193 | `qtwebengine_resources.pak` | WebEngine 资源包 |
| 1,314,816 | `Qt5Network.dll` | Qt 网络（动态加载 libeay32/ssleay32） |
| 690,371 | `qtwebengine_resources_200p.pak` | 2x 资源包 |
| 644,056 | `package_inst.exe` | 插件/Addon 包安装器 |
| 630,140 | `qtwebengine_resources_100p.pak` | 1x 资源包 |
| 599,668 | `usb.ids` | USB ID 数据库（2017.02.12，消费者未确认） |
| 565,208 | `error_report.exe` | 崩溃上报器 |
| 360,216 | `ssleay32.dll` | OpenSSL 1.0.2k libssl |
| 332,288 | `Qt5Svg.dll` | SVG |
| 318,464 | `Qt5PrintSupport.dll` | 打印支持（WebEngine 依赖） |
| 317,440 | `Qt5Positioning.dll` | 定位（WebEngine 依赖） |
| 228,864 | `Qt5WebEngineWidgets.dll` | QWebEngineView 控件 |
| 205,312 | `Qt5Sql.dll` | SQL（QSQLITE） |
| 186,580 | `changelog.txt` | 变更说明（3.5.6 – 25 Nov 2020） |
| 165,336 | `quazip.dll` | ZIP 读写（minizip 1.01） |
| 145,216 | `createfileassoc.exe` | 文件关联辅助（NSIS 2.47 形态） |
| 113,664 | `Qt5WebChannel.dll` | Qt↔JS 桥 |
| 72,704 | `Qt5QuickWidgets.dll` | QQuickWidget |
| 22,448 | `Uninstall.exe.nsis` | NSIS 卸载脚本数据（非 PE） |
| 19,456 | `QtWebEngineProcess.exe` | Chromium 子进程宿主 |
| 18,432 | `libEGL.dll` | ANGLE EGL |
| 4,502 | `openglblacklist.json` | Qt 内置 GPU 黑名单（version 5.6） |
| 285 | `ts3client_win64.VisualElementsManifest.xml` | Windows 磁贴清单（gfx/tile_150.png、tile_70.png） |

### 3.1.4 子目录结构与字节数

| 目录 | 文件数 | 字节 | 内容说明 |
|---|---:|---:|---|
| `$PLUGINSDIR/` | 11 | 17,071,246 | inetc.dll、nsDialogs.dll、System.dll、UserInfo.dll、ScrollLicense.dll、vcredist_x64.exe、Overwolf×2、3 个 bmp |
| `gfx/` | 6 | 1,098,821 | countries.zip 247 项、default.zip 231、default_colored_2014.zip 209、default_mono_2014.zip 208、tile_150/70.png |
| `html/teamspeak5_intro/` | 9 | 2,021,704 | index.html（1,769 B）+ bootstrap/jquery + 3 张 779×615 jpg |
| `iconengines/` | 1 | 35,328 | qsvgicon.dll |
| `imageformats/` | 3 | 454,656 | qgif/qjpeg/qsvg.dll |
| `platforms/` | 1 | 1,453,568 | qwindows.dll |
| `qtwebengine_locales/` | 9 | 2,033,851 | de/en-GB/en-US/es/fr/ja/pl/pt-BR/ru.pak |
| `sound/default/` | 80 | 10,143,473 | 79 wav + settings.ini |
| `sound/default_male/` | 73 | 11,181,532 | 72 wav + settings.ini |
| `sound/default_speech/` | 1 | 9,562 | settings.ini（TTS） |
| `sound/nosounds/` | 1 | 97 | settings.ini |
| `soundbackends/` | 2 | 298,928 | directsound_win64.dll、windowsaudiosession_win64.dll |
| `sqldrivers/` | 1 | 1,151,488 | qsqlite.dll |
| `styles/` | 6 | 149,807 | 5 个 qss + qwindowsvistastyle.dll |
| `styles/default/` | 9 | 58,529 | 5 个 .tpl + 4 个 png |
| `translations/` | 52 | 5,595,667 | 7 组 .qm |

**证据**
```
$ for d in ...; do n=$(find "$d" -maxdepth 1 -type f|wc -l); b=$(find "$d" -maxdepth 1 -type f -printf '%s\n'|awk '{s+=$1}END{print s+0}'); printf '%-32s %4d %12d\n' "$d" "$n" "$b"; done
$PLUGINSDIR 11 17071246 / gfx 6 1098821 / html/teamspeak5_intro 9 2021704 / iconengines 1 35328 /
imageformats 3 454656 / platforms 1 1453568 / qtwebengine_locales 9 2033851 / soundbackends 2 298928 /
sqldrivers 1 1151488 / styles 6 149807 / styles/default 9 58529 / translations 52 5595667
$ for z in gfx/*.zip; do echo "$z $(7z l -ba "$z" | wc -l) entries"; done
gfx/countries.zip 247 / gfx/default.zip 231 / gfx/default_colored_2014.zip 209 / gfx/default_mono_2014.zip 208
```

### 3.1.5 翻译文件（52 个 .qm）

| 前缀 | 数量 | 语言 | 归属组件 |
|---|---:|---|---|
| `lagos` | 8 | 基准 + de/es/fr/ja/pl/pt/ru | 客户端主 UI（主程序含正则 `lagos_([a-z]{2})\.qm`） |
| `permissions` | 8 | 基准 + 7 语言 | 权限描述 |
| `ts_core_errors` | 8 | 基准 + 7 语言 | 核心错误码 |
| `qt` | 7 | 7 语言 | Qt 内建字符串 |
| `update` | 7 | 7 语言 | update.exe |
| `package_installer` | 7 | 7 语言 | package_inst.exe |
| `error_report` | 7 | 7 语言 | error_report.exe |
| **合计** | **52** | | |

**证据**
```
$ ls translations | sed -E 's/_[a-z]{2}(-[A-Z]{2})?\.qm$//; s/\.qm$//' | sort | uniq -c
7 error_report / 8 lagos / 7 package_installer / 8 permissions / 7 qt / 8 ts_core_errors / 7 update
$ grep -F 'lagos_([a-z]{2})' /tmp/main.strings → lagos_([a-z]{2})\.qm
```

> 全部 301 个文件的逐文件字节数见 **附录 A**。

## 3.2 技术栈证据

### 3.2.1 Qt 5.12.3（官方 Windows MSVC 2017 x64 动态版）

| 判定点 | 取值 | 证据来源 |
|---|---|---|
| Qt 版本 | 5.12.3 | 每个 Qt DLL 的版本资源 `FileVersion=5.12.3.0` |
| 构建 | msvc2017_64、共享动态库、MSVC 2017 | `qt_prfxpath` + 构建串 |
| 主程序编译头路径 | `c:\qt\qt5.12.3\5.12.3\msvc2017_64\...` | 主程序 strings |
| 主程序依赖 Qt 模块 | Core/Gui/Widgets/Network/Sql/WebEngineWidgets/WebChannel/Svg | 导入表（37 DLL 中的 8 个 Qt） |
| Qt5Core 导出 | 7916 个符号（含 zlib） | `objdump -p` 导出表 |

**证据**
```
$ strings -el Qt5Core.dll | grep -A1 -m1 '^FileVersion$' → FileVersion / 5.12.3.0
$ strings -n 6 Qt5Core.dll | grep -m1 'Qt 5.12.3 (' → Qt 5.12.3 (x86_64-little_endian-llp64 shared (dynamic) release build; by MSVC 2017)
$ strings -n 6 Qt5Core.dll | grep -m1 'qt_prfxpath' → qt_prfxpath=C:\Qt\Qt5.12.3\5.12.3\msvc2017_64
$ grep -m1 'c:\\qt\\qt5.12.3' /tmp/main.strings → c:\qt\qt5.12.3\5.12.3\msvc2017_64\include\qtcore\qhash.h
$ objdump -p Qt5Core.dll | sed -n '/Ordinal\/Name Pointer/,/^$/p' | grep -cE '^\s+\[' → 7916
```

### 3.2.2 QtWebEngine / Chromium 69 / ICU 62 / ANGLE / Mesa

| 组件 | 取值 | 证据 |
|---|---|---|
| QtWebEngine | 5.12.3 / Chrome 69.0.3497.128 | `QtWebEngine/5.12.3 Chrome/69.0.3497.128` |
| ICU | 62（`icudt62l`） | icudtl.dat 内字符串 |
| ANGLE | libEGL + libGLESv2（导入 d3d9.dll） | 导入表 + FileVer 5.12.3.0 |
| D3D 编译器 | 6.3.9600.16384 | d3dcompiler_47 版本资源 |
| 软件 OpenGL | Mesa 10.0.1 | opengl32sw strings |
| GPU 黑名单 | version 5.6 | openglblacklist.json |
| Chromium 子进程 | QtWebEngineProcess.exe（19,456 B） | 独立 exe |

**证据**
```
$ strings -n 8 Qt5WebEngineCore.dll | grep -m1 'QtWebEngine/' → QtWebEngine/5.12.3 Chrome/69.0.3497.128
$ grep -aoE 'icudt[0-9]+l' icudtl.dat | sort -u → icudt62l
$ objdump -p libGLESv2.dll | grep 'DLL Name:' | head -3 → USER32.dll / d3d9.dll / MSVCP140.dll
$ strings -n 8 opengl32sw.dll | grep -m2 'Mesa 10.0.1' → Mesa 10.0.1 及 %s%u.%u%s Mesa 10.0.1
$ head -2 openglblacklist.json → { "name": "Qt built-in GPU driver blacklist", "version": "5.6",
```

### 3.2.3 OpenSSL 1.0.2k（随包 DLL）

| 项 | 值 | 证据 |
|---|---|---|
| 库文件 | libeay32.dll 2,100,504；ssleay32.dll 360,216 | `ls -l` |
| 版本 | 1.0.2k（2017-01-26） | 两 DLL 版本资源 + 模块串 |
| 构建 | `cl /MD /Ox ... -DOPENSSL_NO_WEAK_SSL_CIPHERS`；无 SSL2/RC5/MD2/KRB5/JPAKE | libeay32 内 `compiler:` 行 |
| 使用者 | Qt5Network 动态加载 `libeay32/ssleay32/libssl-7/8/10/libcrypto-7/8/10` | Qt5Network 内字符串 |
| 主程序 | 导入表无 libeay32/ssleay32 | 37 DLL 清单 |

**证据**
```
$ strings -el libeay32.dll | grep -A1 -m1 '^FileVersion$' → FileVersion / 1.0.2k
$ strings -n 6 libeay32.dll | grep -m1 'OpenSSL 1.0.2k' → MD4 part of OpenSSL 1.0.2k  26 Jan 2017
$ strings -n 6 libeay32.dll | grep -m1 'compiler: cl' | cut -c1-140 → compiler: cl  /MD /Ox -DOPENSSL_THREADS  -DDSO_WIN32 -W3 -Gs0 -Gy -nologo -DOPENSSL_SYSNAME_WIN32 -DWIN32_LEAN_AND_MEAN -DL_ENDIAN -DUNICODE -D_UNICODE -D_CRT_S
$ strings -n 4 Qt5Network.dll | grep -E '^(libeay32|ssleay32|libssl-[0-9]+|libcrypto-[0-9]+)$' | sort -u
libcrypto-10 / libcrypto-7 / libcrypto-8 / libeay32 / libssl-10 / libssl-7 / libssl-8 / ssleay32
$ objdump -p ts3client_win64.exe | grep -E 'DLL Name: (libeay32|ssleay32)' → （无输出）
```

### 3.2.4 QuaZip（无版本资源，内含 minizip 1.01）

| 项 | 值 | 证据 |
|---|---|---|
| 文件 | quazip.dll 165,336 B，无版本资源 | `strings -el quazip.dll | grep -c FileVersion` → 0 |
| 导出 | 226 个导出名（152 个含 QuaZip） | objdump 导出表 |
| 压缩实现 | `unzip 1.01 Copyright 1998-2004 Gilles Vollant` | strings |
| zlib 来源 | 从 Qt5Core.dll 导入 17 个 `z_*` | 导入解析；Qt5Core 导出含 `z_*` |
| 使用者 | 主程序导入 16 个 QuaZip 函数；error_report 导入 12 个 | 导入表 |

**证据**
```
$ strings -el quazip.dll | grep -c 'FileVersion' → 0
$ strings -n 6 quazip.dll | grep -m1 'unzip 1.01' →  unzip 1.01 Copyright 1998-2004 Gilles Vollant - http://www.winimage.com/zLibDll
$ python3 导入解析 → z_* from Qt5Core: 17
$ objdump -p quazip.dll | sed -n '/Ordinal\/Name Pointer/,/^$/p' | grep -cE '^\s+\[' → 226
```

### 3.2.5 MSVC 运行库：VC++ 2015 Redistributable 14.0.24215（x64）

| 项 | 值 | 证据 |
|---|---|---|
| 安装包内 redist | `$PLUGINSDIR/vcredist_x64.exe` 15,301,888 B | 版本资源 |
| 产品名/版本 | Microsoft Visual C++ 2015 Redistributable (x64) - 14.0.24215 / 14.0.24215.1 | `strings -el` |
| 运行时依赖 | 主程序与全部 Qt 库导入 MSVCP140.dll、VCRUNTIME140.dll、api-ms-win-crt-* | 导入表 |
| 安装目录 | 无 MSVCP140.dll / VCRUNTIME140.dll 本地副本 | 文件清单 |

**证据**
```
$ strings -el '$PLUGINSDIR/vcredist_x64.exe' | grep -A1 -m1 '^ProductName$' → ProductName / Microsoft Visual C++ 2015 Redistributable (x64) - 14.0.24215
$ find . -iname 'msvcp140.dll' -o -iname 'vcruntime140.dll' → （无输出）
$ objdump -p ts3client_win64.exe | grep -E 'DLL Name: (MSVCP140|VCRUNTIME140)' →  MSVCP140.dll / VCRUNTIME140.dll
```

## 3.3 进程与模块拓扑

### 3.3.1 各 exe 的职责

| exe | 字节 | 导入/形态特征 | 职责判定与证据 |
|---|---:|---|---|
| `ts3client_win64.exe` | 17,911,768 | 37 DLL：Qt5×8、quazip、WS2_32、Secur32、bcrypt、CRYPT32、dbghelp、WTSAPI32、IPHLPAPI、PSAPI、WINMM | 主 GUI 客户端；版本资源 3.5.6.0 / ProductName `TeamSpeak 3 Client`；PDB `ts3clientui.exe.pdb` |
| `QtWebEngineProcess.exe` | 19,456 | Qt5Core、Qt5WebEngineCore、SHELL32 | QtWebEngine Chromium 子进程宿主 |
| `update.exe` | 1,970,648 | Qt5Core/Gui/Network/Widgets、SHLWAPI、OLEAUT32 | 更新器：`versions.teamspeak.com/ts3-client-2`、`files.teamspeak-services.com/updater-images/client/`、`update.ini`、`--clientupdate`、`CLIENTUPDATE`、`/ts3_update_log`、`courgette`、`ProcessTools::startClientUpdater` |
| `package_inst.exe` | 644,056 | Qt5Core/Gui/Widgets、ADVAPI32 | 插件/Addon 安装器：`Usage is: package_inst [-silent] <package>`、`/package.ini`、`addons.ini`、`/plugins`、`addons.teamspeak.com` |
| `error_report.exe` | 565,208 | Qt5Core/Gui/Network/Widgets、quazip | 崩溃报告器：`TeamSpeak3-Crash-Reporter-1.0`、`/ts3dump_%1.zip`、`multipart/form-data; boundary=`、`client-crashdump-postinfo.ini` |
| `createfileassoc.exe` | 145,216 | 无 Qt；KERNEL32/USER32/GDI32/SHELL32/ADVAPI32/COMCTL32/ole32；清单 `Nullsoft Install System v2.47` | 文件关联辅助；导入 `RegOpenKeyExA`/`OpenProcessToken`/`ShellExecuteA`；对应主程序提示文案与 `HKEY_CLASSES_ROOT\.ts3_plugin` |
| `$PLUGINSDIR/vcredist_x64.exe` | 15,301,888 | — | VC++ 2015 redist 安装器（安装期） |
| `$PLUGINSDIR/OverwolfInstallerDownloader.exe` | 325,440 | FileVer 1.0.0.4 | 合作方 Overwolf 下载器 |
| `$PLUGINSDIR/OverwolfTeamSpeakInstaller.exe` | 914,864 | FileVer 1.50.0.0 | 合作方 Overwolf/TS 安装器 |

**证据**
```
$ strings -el ts3client_win64.exe | grep -A1 -m1 '^FileVersion$' → FileVersion / 3, 5, 6, 0
$ grep -oE '[A-Za-z0-9_]+\.exe\.pdb' /tmp/{main,update,package_inst,error_report}.strings | sort -u
error_report.exe.pdb / ts3clientui.exe.pdb / package_inst.exe.pdb / update.exe.pdb
$ grep -E '^(--clientupdate|CLIENTUPDATE|/ts3_update_log|update\.ini)$' /tmp/update.strings → --clientupdate / CLIENTUPDATE / /ts3_update_log / update.ini
$ grep -E '^(/plugins|addons\.ini|/package\.ini)$' /tmp/package_inst.strings → /plugins / addons.ini / /package.ini
$ grep -E '^(/ts3dump_%1\.zip|TeamSpeak3-Crash-Reporter-1\.0)$' /tmp/error_report.strings → /ts3dump_%1.zip / TeamSpeak3-Crash-Reporter-1.0
```

### 3.3.2 启动入口与单实例

| 结论 | 证据 |
|---|---|
| 唯一正常入口是 `ts3client_win64.exe` | 仅它导入 Qt Widgets/WebEngine 全家桶 |
| 以普通用户权限启动（asInvoker），`uiAccess="true"` | 内嵌 manifest 字符串 |
| 单实例可被 `-nosingleinstance` 关闭 | 主程序开关 |
| 配置位置可用 `-homeconfig` / `-localconfig` 切换 | 主程序开关 |

**证据**
```
$ grep -m1 'requestedExecutionLevel' /tmp/main.strings → <requestedExecutionLevel level="asInvoker" uiAccess="true"></requestedExecutionLevel>
$ grep -E '^-(homeconfig|localconfig|nocpucheck|nosingleinstance|showqueryclients|mytsid|newtab|details|names|count|uid)$' /tmp/main.strings | sort -u
-count / -details / -homeconfig / -localconfig / -mytsid / -names / -newtab / -nocpucheck / -nosingleinstance / -showqueryclients / -uid
$ grep -E '^--(force-opengl-angle|force-opengl-desktop|force-opengl-soft|nouser)$' /tmp/main.strings → --force-opengl-angle / --force-opengl-desktop / --force-opengl-soft / --nouser
```

### 3.3.3 进程拉起关系

| 从 | 到 | 触发场景 | 证据 |
|---|---|---|---|
| ts3client | update.exe | 检查到新版本/确认更新 | 主程序 `update.exe`、`Failed to start updater.`、`Updater`、`update.ini`、`clientupdate`、`Error during processClientUpdate` |
| ts3client | error_report.exe | 崩溃后生成 minidump | 主程序导入 `dbghelp!MiniDumpWriteDump`；`Crashdump written (handled) !`、`crashdumps/`、`error_report.exe` |
| ts3client | createfileassoc.exe | 首次运行/需更新文件关联 | 主程序提示“needs to update file associations in the Windows registry … run this utility”；`HKEY_CLASSES_ROOT\.ts3_plugin` |
| ts3client（QtWebEngine） | QtWebEngineProcess.exe | 打开内嵌 WebEngine 页面 | 主程序导入 Qt5WebEngineWidgets 61 函数；`html/teamspeak5_intro/index.html`；独立子进程 exe |
| 安装程序 | package_inst.exe | 安装 `.ts3_plugin` / addon 包 | `.ts3_plugin` 关联；`/plugins`、`/package.ini`、`addons.ini` |
| update.exe | ts3client.exe | 更新完成后重启客户端 | `ProcessTools::startClientUpdater`、`Running clientupdate, get ts3Dir from update.ini` |

> 进程创建方式：主程序 KERNEL32 导入表**没有** `CreateProcessW`，而 `Qt5Core.dll` 导入了 `CreateProcessW`；因此拉起子进程由 Qt `QProcess`/`startDetached` 完成。

**证据**
```
$ python3 -c "import json; k=json.load(open('/tmp/imports.json'))['ts3client_win64.exe']['KERNEL32.dll']; print('CreateProcessW?','CreateProcessW' in k)"
CreateProcessW? False
$ python3 -c "... Qt5Core KERNEL32 ..." → ['GetExitCodeProcess', 'CreateProcessW', 'GetProcessId', 'OpenProcess', 'GetCurrentProcessId', 'TerminateProcess', 'GetCurrentProcess']
$ grep -iE '^(update|error_report|createfileassoc)\.exe$' /tmp/main.strings | sort -u → createfileassoc.exe / error_report.exe / update.exe
$ grep -iE 'MiniDump|Crashdump written' /tmp/main.strings | sort -u → MiniDumpWriteDump / Crashdump written (handled) ! / Crashdump written (unhandled) !
```

### 3.3.4 主程序静态链接的核心组件（源码路径/断言判定）

| 组件 | 出现次数 | 源码路径样例 |
|---|---:|---|
| grpc | 584 | `deps\grpc\grpc\src\core\lib\iomgr`、`ext\transport\chttp2\transport` |
| protobuf | 233 | `deps\protobuf\protobuf\src\google\protobuf` |
| boringssl | 138 | `../src/third_party/boringssl/src/crypto/...`、`ssl/ssl_cipher.cc` |
| ts_tomcrypt | 89 | `deps\ts_tomcrypt\src\pk\ecc`、`encauth\eax`、`encauth\gcm`、`modes\ctr`、`pk\rsa` |
| teamspeak_client_lib | 88 | `deps\teamspeak_client_lib\src\sound\encode_speex.cpp`、`encode_opus.cpp`、`sounddevicemanager.cpp` |
| teamspeak_common_lib | 81 | `deps\teamspeak_common_lib\src\packet\outgoingresendingpacket.cpp`、`packethandler.cpp`、`sound\decode.cpp` |
| teamcloud_sync_client_lib | 16 | `deps\teamcloud_sync_client_lib\src\lib` |
| teamspeak_tsdns | 3 | `deps\teamspeak_tsdns\src\client\impl\resolver_impl_cares.cpp`（c-ares） |
| teamprotobufrpc | 3 | `deps\teamprotobufrpc` |
| speex_ts / ts_boost | 2 / 2 | 主程序含 `?AVEncodeSpeex`、`?AVPreProcessSpeex@audio@teamspeak@com@@`；asio `win_iocp_socket_service` 类型串 14 处 |
| teamlog / teamspeak_accounting / teamspeak_weblist | 各 1 | `LogFile`、`TCPConnectionBase@TeamSpeak3Accounting`、`WebServerListWrapper@TeamSpeak3WebList` |

**证据**
```
$ for lib in teamspeak_client_lib teamspeak_common_lib teamspeak_tsdns teamspeak_weblist ts_tomcrypt speex_ts teamlog teamspeak_accounting teamcloud_sync_client_lib teamprotobufrpc ts_boost grpc protobuf boringssl; do echo "$lib: $(grep -c "$lib" /tmp/main.strings)"; done
teamspeak_client_lib: 88 / teamspeak_common_lib: 81 / teamspeak_tsdns: 3 / teamspeak_weblist: 1 / ts_tomcrypt: 89
speex_ts: 2 / teamlog: 1 / teamspeak_accounting: 1 / teamcloud_sync_client_lib: 16 / teamprotobufrpc: 3
ts_boost: 2 / grpc: 584 / protobuf: 233 / boringssl: 138
$ grep -oE 'workspace/client/clientwindows/deps/[a-z0-9_]+' /tmp/main.strings | sort -u
grpc / protobuf / speex_ts / teamcloud_sync_client_lib / teamlog / teamprotobufrpc / teamspeak_accounting / teamspeak_client_lib / teamspeak_common_lib / teamspeak_tsdns / teamspeak_weblist / ts_boost / ts_tomcrypt
$ grep -m1 'encode_opus.cpp' /tmp/main.strings → Assertion "codecSelection == CODEC_OPUS_VOICE || CODEC_OPUS_MUSIC" failed at c:\jenkins\workspace\client\clientwindows\deps\teamspeak_client_lib\src\sound\encode_opus.cpp:
```

### 3.3.5 构建路径（PDB/Build 字符串）

| 二进制 | PDB / 构建输出 |
|---|---|
| ts3client_win64.exe | `C:\jenkins\workspace\Client\ClientWindows\build\64\out\Release_x64\ts3clientui.exe.pdb` |
| update.exe | `C:\jenkins\workspace\Client\UpdaterWindows\build\64\out\Release_x64\update.exe.pdb` |
| package_inst.exe | `C:\jenkins\workspace\Client\PackageInstWindows\build\64\out\Release_x64\package_inst.exe.pdb` |
| error_report.exe | `C:\jenkins\workspace\Client\ErrorReportWindows\build\64\out\Release_x64\error_report.exe.pdb` |
| directsound_win64.dll | `C:\jenkins\workspace\Client\ClientWindows\build\64\out\Release_x64\directsound_win64.dll.pdb` |
| 主程序源码树 | `c:\jenkins\workspace\client\clientwindows\src\ui_qt\...`（570 条源码路径） |

**证据**
```
$ grep -m1 'ts3clientui.exe.pdb' /tmp/main.strings → C:\jenkins\workspace\Client\ClientWindows\build\64\out\Release_x64\ts3clientui.exe.pdb
$ objdump -p soundbackends/directsound_win64.dll | grep -m1 'pdb' → (format RSDS signature ... pdb C:\jenkins\workspace\Client\ClientWindows\build\64\out\Release_x64\directsound_win64.dll.pdb)
$ python3 路径统计：570 条唯一下载源码路径；目录计数 Top：ui_qt\tools 61 / qtgen 61 / ui_qt 58 / grpc iomgr 22 / protobuf 20
```

## 3.4 网络机制

### 3.4.1 传输层：UDP（数据报）+ TCP（流）

| 层 | 证据 | 结论 |
|---|---|---|
| Winsock（主程序 WS2_32，15 函数） | `WSASendTo`、`WSARecvFrom`、`WSASend`、`WSARecv`、`WSASocketW`、`WSAIoctl`、`WSAGetOverlappedResult`、`WSAEnumProtocolsW`、`getaddrinfo`、`freeaddrinfo`、`getnameinfo`、`inet_ntop`、`inet_pton`、`WSAAddressToStringW`、`WSAStringToAddressW` | 同时使用 UDP 与 TCP，全部 overlapped I/O |
| Boost.Asio（静态） | `basic_datagram_socket<udp>`、`basic_stream_socket<tcp>`、`win_iocp_socket_service<tcp/udp>`、`resolver_service<tcp/udp>` | Windows IOCP 封装 |
| 自有网络封装 | `TS3ANetwork::Connect failed error: `、`TS3ANetwork::Recv failed error: `、`TS3ANetwork::ResolveHostName failed error: `、`UDPSocketData`、`TCPConnectionBase@TeamSpeak3Accounting`、`HttpProtocol@http@teamspeak@com` | 独立 TS3ANetwork 层 |
| Qt 网络（仅辅助） | 主程序导入 Qt5Network 62 函数：`QNetworkAccessManager`7、`QNetworkRequest`12、`QNetworkReply`11、`QUdpSocket`3、`QHostInfo`7、QSsl 0 | Qt 负责 HTTP(S) 与主机解析；TS3 主通道不走 Qt Socket |
| DNS | `teamspeak_tsdns` + `resolver_impl_cares.cpp`；另有 `QHostInfo` 与 `getaddrinfo` | c-ares 与系统解析双路径 |

**证据**
```
$ python3 /tmp/parse_imports.py ts3client_win64.exe | grep 'WS2_32'
  WS2_32.dll: 15 :: WSAAddressToStringW WSAEnumProtocolsW WSAGetOverlappedResult WSAIoctl WSARecv WSARecvFrom WSASend WSASendTo WSASocketW WSAStringToAddressW freeaddrinfo getaddrinfo getnameinfo inet_ntop inet_pton
$ grep -cE 'win_iocp_socket_service|basic_datagram_socket@Vudp|resolver_service@V(udp|tcp)' /tmp/main.strings → 14
$ python3 统计 Qt5Network 导入 → QNetworkAccessManager:7 / QNetworkRequest:12 / QNetworkReply:11 / QUdpSocket:3 / QHostInfo:7 / QSsl:0
$ grep -iE 'TS3ANetwork::' /tmp/main.strings | sort -u | head -3 → TS3ANetwork::BinaryIpToIPNumber called with IpNone / TS3ANetwork::Connect failed error:  / TS3ANetwork::Recv failed error:
```

### 3.4.2 TS3 协议命令面（字符串证据）

| 类别 | 观测到的名字 | 数量 |
|---|---|---:|
| 服务端通知事件 | `notifybanlist`、`notifychannelcreated`、`notifychanneledited`、`notifyclientmoved`、`notifytextmessage`、`notifytalkstatuschange`… | 72 个 `^notify[a-z]+$` |
| 握手/初始化 | `initivexpand2`、`clientinitiv`、`clientinit`、`initivexpand` | 4 |
| 文件传输 | `ftinitdownload`、`ftinitupload`、`ftgetfilelist`、`ftgetfileinfo`、`ftcreatedir`、`ftdeletefile`、`ftrenamefile`、`ftstop`、`ftlist`、`ftkey`、`notifychannelfilehttptoken` | 11 |
| 插件命令 | `notifyplugincmd` | 1 |
| 版本/错误 | `CE_INVALID_PROTOCOL_VERSION`、`onServerProtocolVersion(int)`、`Error in ts3client_startConnection: ` | — |

**证据**
```
$ grep -cE '^notify[a-z]+$' /tmp/main.strings → 72
$ grep -E '^(initivexpand2|clientinitiv|ftinitupload|ftinitdownload|ftgetfilelist|ftcreatedir|ftdeletefile|ftrenamefile)$' /tmp/main.strings | sort -u
clientinitiv / ftcreatedir / ftdeletefile / ftgetfilelist / ftinitdownload / ftinitupload / ftrenamefile / initivexpand2
$ grep -m1 'notifychannelfilehttptoken' /tmp/main.strings → notifychannelfilehttptoken
```

### 3.4.3 加密/证书相关导入与库

| 机制 | 证据 | 推断用途（证据支持范围内） |
|---|---|---|
| libtomcrypt（`ts_tomcrypt` 静态） | `eax_encrypt`、`eax_decrypt`、`gcm_add_aad`、`ctr_encrypt`、`ecc_make_key`、`ecc_mul`、`ecc_import`、`ecc_export`、`rsa_*`；源码路径 `pk\ecc`、`encauth\eax`、`encauth\gcm`、`modes\ctr`、`pk\rsa` | TS3 协议/身份的对称加密（EAX/GCM/CTR）、ECC、RSA、ASN.1 |
| CryptoAPI（ADVAPI32） | `CryptAcquireContextA`、`CryptGenRandom`、`CryptCreateHash`、`CryptHashData`、`CryptGetHashParam`、`SystemFunction036` | 随机数/哈希等辅助 |
| CNG（bcrypt） | `BCryptOpenAlgorithmProvider`、`BCryptGenRandom`、`BCryptCloseAlgorithmProvider` | 随机数 |
| 证书/编码（CRYPT32） | `CryptBinaryToStringA`、`CryptStringToBinaryA` | Base64 编解码 |
| SSPI（Secur32） | `InitSecurityInterfaceW` | Windows 安全接口 |
| BoringSSL（静态，经 gRPC） | 138 个 `third_party/boringssl` 路径；`OPENSSL_internal` 错误串 | myTeamSpeak gRPC 的 TLS |
| OpenSSL 1.0.2k（DLL） | 见 3.2.3；由 Qt5Network 动态加载 | Qt 侧 HTTPS |

**证据**
```
$ python3 /tmp/parse_imports.py ts3client_win64.exe | grep -E 'Secur32|bcrypt|CRYPT32|ADVAPI32'
  Secur32.dll: 1 :: InitSecurityInterfaceW
  bcrypt.dll: 3 :: BCryptCloseAlgorithmProvider BCryptGenRandom BCryptOpenAlgorithmProvider
  CRYPT32.dll: 2 :: CryptBinaryToStringA CryptStringToBinaryA
  ADVAPI32.dll: 13 :: CryptHashData RegOpenKeyExW RegCloseKey RegEnumKeyExA CryptAcquireContextA ... SystemFunction036 RegQueryValueExA
$ grep -oE '(eax_encrypt|eax_decrypt|ecc_make_key|ecc_mul|ctr_encrypt|gcm_add_aad)' /tmp/main.strings | sort -u → ctr_encrypt / eax_decrypt / eax_encrypt / ecc_make_key / ecc_mul / gcm_add_aad
$ grep -m1 'OPENSSL_internal' /tmp/main.strings → error:%08x:%s:OPENSSL_internal:%s
```

### 3.4.4 客户端连接的域名与端点

| 域名 | 次数 | 观测到的 URL / 用途线索 |
|---|---:|---|
| `clientapi.myteamspeak.com` | 7 | `https://clientapi.myteamspeak.com/{authentication,session,integration,user,addon,messenger,synchronization}`（gRPC/protobuf） |
| `www.teamspeak.com` | 6 | http(s)://www.teamspeak.com 与支持/赞助链接 |
| `ts3services.teamspeak.com` | 3 | `/revocation-certificates`、`/revocation-myteamspeakid`、`/static_integration_info` |
| `voice.teamspeak.com` | 2 | 域名串（用途未确认） |
| `community.teamspeak.com` | 2 | `http://community.teamspeak.com` |
| `www.myteamspeak.com` | 1 | `https://www.myteamspeak.com/` |
| `weblist.teamspeak.com` | 1 | 服务器列表 Web 服务（lib `teamspeak_weblist`） |
| `versions.teamspeak.com` | 1 | `http://versions.teamspeak.com/ts3-client-2`（更新检查） |
| `statistics.teamspeak.com` | 1 | 匿名统计上报 |
| `push.myteamspeak.com` | 1 | 推送 |
| `news.teamspeak.com` | 1 | `http://news.teamspeak.com/`（新闻 ticker） |
| `named.myteamspeak.com` | 1 | `https://named.myteamspeak.com/` |
| `invite.teamspeak.com` | 1 | `https://invite.teamspeak.com/` |
| `blacklist2.teamspeak.com` | 1 | `https://blacklist2.teamspeak.com/check` |
| `badges-content.teamspeak.com` | 1 | `https://badges-content.teamspeak.com/list` |
| `addons.teamspeak.com` | — | package_inst 内 `http://addons.teamspeak.com` |
| `files.teamspeak-services.com` | — | `updater-images/client/`、`service-data/client-crashdump-postinfo.ini` |

**证据**
```
$ grep -oE '([a-z0-9-]+\.)+(teamspeak3?\.com|teamspeak\.services|myteamspeak\.com|teamspeak\.com)' /tmp/main.strings | sort | uniq -c | sort -rn
7 clientapi.myteamspeak.com / 6 www.teamspeak.com / 3 ts3services.teamspeak.com / 2 voice.teamspeak.com / 2 community.teamspeak.com
1 www.myteamspeak.com / 1 weblist.teamspeak.com / 1 versions.teamspeak.com / 1 statistics.teamspeak.com / 1 push.myteamspeak.com
1 news.teamspeak.com / 1 named.myteamspeak.com / 1 invite.teamspeak.com / 1 blacklist2.teamspeak.com / 1 badges-content.teamspeak.com
$ grep -m1 'versions.teamspeak.com' /tmp/update.strings → http://versions.teamspeak.com/ts3-client-2
$ grep -m1 'updater-images' /tmp/update.strings → http://files.teamspeak-services.com/updater-images/client/
$ grep -m1 'client-crashdump-postinfo.ini' /tmp/error_report.strings → http://files.teamspeak-services.com/service-data/client-crashdump-postinfo.ini
```

### 3.4.5 文件传输与统计上报

| 结论 | 证据 |
|---|---|
| 文件传输为独立命令族 + TCP/HTTP 混合 | `ft*` 命令；`TCPConnectionBase@TeamSpeak3Accounting`；`HttpProtocol@http@teamspeak@com`；`notifychannelfilehttptoken`；URL 模板 `%1?port=%2&serverUID=%3&channel=%4&path=%5&filename=%6&isDir=%7&size=%8` |
| 传输组管理/重传 | `FileTransferGroup::Resend: Active transfer not found`、`Filetransfer in progress`、`Filetransfer Queue` |
| 崩溃报告 multipart 上传 | `multipart/form-data; boundary=`、`Content-Disposition: form-data; name="`、`FormPost`/`FormGet` |
| 匿名统计 | 文案“collect some statistics about your operating system and hardware. The data is sent anonymously.”；`SystemInfo@proto@systemstats@teamspeak@com`；`statistics.teamspeak.com` |

**证据**
```
$ grep -m1 '?port=%2&serverUID=%3' /tmp/main.strings → %1?port=%2&serverUID=%3&channel=%4&path=%5&filename=%6&isDir=%7&size=%8
$ grep -m1 'Anonymous Statistics' /tmp/main.strings → Anonymous Statistics
$ grep -E '^(multipart/form-data; boundary=)$' /tmp/error_report.strings → multipart/form-data; boundary=
```

### 3.4.6 端口与协议映射（未确认）

主程序 digits-only 字符串集合中**不含** 9987/10011/30033，故端口分配无法由本节静态证据确认，见 3.7 第 1 条。

**证据**
```
$ grep -E '^(9987|10011|30033)$' /tmp/main.strings → （无输出）
$ grep -E '^[0-9]{4,5}$' /tmp/main.strings | sort -u | head -8 → 0119 1111 2000 2222 2727 2765 2767 3265
```

## 3.5 本地数据与配置

### 3.5.1 配置根目录

| 结论 | 证据 |
|---|---|
| 配置根为 `%APPDATA%\TS3Client\` | `TS3Client\`、`Failed to get APPDATA path`、`WinHelpers::getAppDataConfigDir(void)` |
| 配置根可用开关切换 | `-homeconfig`、`-localconfig` |
| WebEngine 缓存/持久化路径可配 | 主程序导入 `QWebEngineProfile::setPersistentStoragePath/setCachePath`（Qt5WebEngineWidgets 61 项中） |

**证据**
```
$ grep -E '^(TS3Client\\)$' /tmp/main.strings → TS3Client\
$ grep -m2 -iE 'getAppDataConfigDir|Failed to get APPDATA path' /tmp/main.strings → Failed to get APPDATA path / class QString __cdecl WinHelpers::getAppDataConfigDir(void)
```

### 3.5.2 本地文件与目录（主程序字符串）

| 路径/文件 | 角色 | 证据字符串 |
|---|---|---|
| `settings.db` | 主配置数据库 | `settings.db` |
| `settings.ini` | 旧/辅助配置 | `settings.ini`、` reading settings.ini error: ` |
| `urls.db` | 书签/地址库 | `urls.db`、`Your urls.dat has been successfully imported into urls.db` |
| `addons.ini` | Addon/插件登记 | `addons.ini`、`Addon Category not found in addons.ini` |
| `package.ini` | Addon 包描述 | `package.ini`、`package_inst_temp.ini` |
| `update.ini` | 更新器配置/状态 | `update.ini` |
| `logs/` | 日志目录 | `logs/`、`ts3client_*__*.log` |
| `cache/`、`cache/remote/`、`cache/remote/temp` | 远程缓存 | 三个字符串均出现 |
| `crashdumps/` | minidump 目录 | `crashdumps/`、`Crashdump ENABLED,  directory is: ` |
| `Bookmarks/` | 书签目录 | `Bookmarks/` |
| `soundbackends/` | 声音后端目录 | `soundbackends`、`Error getting soundbackends dir: ` |
| `ts3clientui_qt.secrets.conf` | 疑似 secrets 配置（用途未确认） | 字符串原文 |
| `translations/../styles` | 样式目录解析 | 字符串原文 |
| `html/teamspeak5_intro/index.html` | 内嵌 WebEngine 页面 | 字符串原文 |

**证据**
```
$ grep -E '^(TS3Client\\|settings\.db|settings\.ini|urls\.db|addons\.ini|package\.ini|update\.ini|crashdumps/|logs/|cache/|cache/remote|Bookmarks/|soundbackends|ts3clientui_qt\.secrets\.conf)$' /tmp/main.strings | sort -u
Bookmarks/ / TS3Client\ / addons.ini / cache/ / cache/remote / crashdumps/ / logs/ / package.ini / settings.db / settings.ini / soundbackends / ts3clientui_qt.secrets.conf / update.ini / urls.db
$ grep -m1 'ts3client_\*__\*\.log' /tmp/main.strings → ts3client_*__*.log
```

### 3.5.3 SQLite

| 结论 | 证据 |
|---|---|
| Qt SQL + QSQLITE 驱动 | 主程序 `QSQLITE`；导入 Qt5Sql 24 函数（QSqlDatabase/QSqlQuery） |
| 驱动为随包 Qt 插件 | `sqldrivers/qsqlite.dll` 1,151,488 B，FileVer 5.12.3.0 |
| 数据库为本地文件 | `settings.db`、`urls.db` 与 `QSqlDatabase::setDatabaseName` 组合 |

**证据**
```
$ grep -E '^QSQLITE$' /tmp/main.strings → QSQLITE
$ strings -el sqldrivers/qsqlite.dll | grep -A1 -m1 '^FileVersion$' → FileVersion / 5.12.3.0
$ python3 /tmp/parse_imports.py ts3client_win64.exe | grep 'Qt5Sql' → Qt5Sql.dll: 24 :: ?addDatabase@QSqlDatabase@@SA?AV1@AEBVQString@@0@Z ...
```

### 3.5.4 注册表使用

| 键/用途 | 证据 |
|---|---|
| `HKEY_CLASSES_ROOT\.ts3_plugin` | 主程序 strings（插件包文件关联） |
| `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` | 主程序 strings（开机自启） |
| `HKLM\Software\Wow6432Node\Overwolf` | 主程序 strings（Overwolf 检测） |
| `SOFTWARE\Microsoft\Windows NT\CurrentVersion` | 主程序 strings（OS 版本） |
| 注册表 API | 主程序导入 `RegOpenKeyExA/W`、`RegQueryValueExA`、`RegEnumKeyExA`、`RegCloseKey` |
| 文件关联写入 | createfileassoc.exe 导入 `RegOpenKeyExA`/`ShellExecuteA`/`OpenProcessToken` |

**证据**
```
$ grep -F 'HKEY_CLASSES_ROOT' /tmp/main.strings → HKEY_CLASSES_ROOT\.ts3_plugin
$ grep -E '^HKEY_(CURRENT_USER|LOCAL_MACHINE)' /tmp/main.strings | sort -u → HKEY_CURRENT_USER / HKEY_CURRENT_USER\Software / HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run / HKEY_LOCAL_MACHINE / HKEY_LOCAL_MACHINE\Software\Wow6432Node\Overwolf
$ grep -m1 'ShellExecuteA' /tmp/createfileassoc.strings → ShellExecuteA
```

## 3.6 插件与扩展点

### 3.6.1 插件 ABI：116 个入口，Plugin API 25

| 类别 | 数量 | 入口点 |
|---|---:|---|
| 元数据 | 10 | name、version、apiVersion、author、description、commandKeyword、infoTitle、infoData、offersConfigure、configure |
| 生命周期 | 6 | init、shutdown、setFunctionPointers、setFunctionPointersExtra、registerPluginID、freeMemory |
| UI/热键/命令 | 7 | initMenus、initHotkeys、displayKeyText、keyDeviceName、keyPrefix、currentServerConnectionChanged、processCommand |
| 事件回调 `on*` | 93 | 频道/客户端/服务器/文件传输/热键/语音处理等（如 onEditCapturedVoiceDataEvent、onTalkStatusChangeEvent） |
| **唯一合计** | **116** | `grep -E '^ts3plugin_[a-zA-Z]+$'` 去重 |

| 加载器行为 | 证据字符串 |
|---|---|
| 按名取函数地址、校验必备导出 | `Required plugin function name(), version(), apiVersion(), author() or description() not found in plugin: ` |
| API 版本校验 | `Api version is not compatible for plugin: ` |
| 必须完整路径 | `Plugin path error: not a full path.` |
| 动态加载 | `Loading plugin: `、`Failed to load plugin: `、`Plugin failed to load:`、`LoadLibrary error: `；导入 `LoadLibraryW`/`GetProcAddress` |
| 安全模式 | `Plugins safemode parameter detected, not loading any plugins`（参数名未确认） |
| Addon 关联 | `Couldn't find addon info for plugin: `、`addons.ini` |

**证据**
```
$ grep -E '^ts3plugin_[a-zA-Z]+$' /tmp/main.strings | sort -u | wc -l → 116
$ grep -E '^ts3plugin_on[a-zA-Z]+$' /tmp/main.strings | sort -u | wc -l → 93
$ grep -iF -e 'Loading plugin' -e 'LoadLibrary error' -e 'Failed to load plugin' /tmp/main.strings | sort -u → Failed to load plugin:  / LoadLibrary error:  / Loading plugin:
$ grep -F 'Updated Plugin API version to 25' changelog.txt → ! Updated Plugin API version to 25.
```

### 3.6.2 插件安装目录与包机制

| 结论 | 证据 |
|---|---|
| 插件安装到客户端安装目录 `plugins` 子目录 | package_inst 字符串 `/plugins`；`No TeamSpeak 3 Client installation directory found.` |
| 安装以 package（`package.ini`）为单位并写入 `addons.ini` | `/package.ini`、`addons.ini`、`Failed to write data in addons.ini`、`Couldn't get addon name from package.ini` |
| 插件包文件关联 `.ts3_plugin` | 主程序 `HKEY_CLASSES_ROOT\.ts3_plugin` |
| 安装器含恶意插件风险提示 | “Plugins should only be installed from trusted sources, as it is possible to inject malicious code into the TeamSpeak client with a plugin…” |
| 支持静默安装 | `Usage is: package_inst [-silent] <package>`、`silentInstall` |

**证据**
```
$ grep -E '^(/plugins|/package\.ini|addons\.ini|Usage is: package_inst \[-silent\] <package>)$' /tmp/package_inst.strings → /plugins / addons.ini / /package.ini / Usage is: package_inst [-silent] <package>
$ grep -m1 'about to install a Plugin' /tmp/package_inst.strings | cut -c1-120 → <p>You are about to install a Plugin for your TeamSpeak Client.</p><p>Plugins should only be installed from trusted sources, as it is possible to inject malicio
```

### 3.6.3 内建插件（字符串证据，加载方式未确认）

| 内建插件 | 证据 |
|---|---|
| Lua 插件 | `Lua Plugin`、`Plugin providing Lua scripting support for the TeamSpeak 3 Client`、`lua_plugin` |
| ClientQuery 远程控制 | `ClientQuery`、`Activated ClientQuery plugin`、`System plugin providing remote control features`、`ts3plugin_onIncomingClientQueryEvent` |
| Gamepad/Joystick | `GAMEPAD`、`GAMEPAD_JOYSTICK`、`JOYSTICK`、`Gamepad and Joystick Hotkey Support` |

> 安装目录内没有任何插件 DLL；上述字符串在主程序内，且宿主侧存在 `onCreatePluginMenu`/`onPluginCommand` 等逻辑 → 很可能是**内建插件**，但“内建 vs 运行时释放 DLL”静态不能确认（见 3.7 第 5 条）。

**证据**
```
$ grep -iE 'lua_plugin|Gamepad and Joystick|System plugin providing remote control' /tmp/main.strings | sort -u
Gamepad and Joystick Hotkey Support / Lua Plugin / Plugin providing Lua scripting support for the TeamSpeak 3 Client / System plugin providing remote control features / lua_plugin
$ find . -name '*.dll' | grep -iE 'lua|clientquery|gamepad|joystick' → （无输出）
```

### 3.6.4 声音后端 ABI（独立 DLL，15 个导出）

| 结论 | 证据 |
|---|---|
| 两后端导出同一组 15 个 `ts3soundbackend_*` | associateAECDevice、closeDevice、enumDevices、finalize、getDefaultDevice、getErrorString、getInfo、initialize、isSupported、lockDSP、openDevice、startDevice、stopDevice、unlockDSP、waitForClosedDevices |
| 主程序按目录动态加载 | `soundbackends`、`Could not find soundbackends folder `、`Error getting soundbackends` + `LoadLibraryW`/`GetProcAddress` |
| DirectSound 后端 | 导入 `DSOUND.dll` + ole32（CoInitializeEx/StringFromCLSID） |
| WASAPI 后端 | 导入 `AVRT.dll` + ole32（CoCreateInstance/PropVariantClear） |

**证据**
```
$ objdump -p soundbackends/directsound_win64.dll | grep 'ts3soundbackend'
	[   0] ts3soundbackend_associateAECDevice ... [  14] ts3soundbackend_waitForClosedDevices（15 项）
$ objdump -p soundbackends/windowsaudiosession_win64.dll | grep -c 'ts3soundbackend' → 15
$ objdump -p soundbackends/directsound_win64.dll | grep 'DLL Name:' | head -6 → DSOUND.dll / KERNEL32.dll / MSVCP140.dll / USER32.dll / VCRUNTIME140.dll / WINMM.dll
$ objdump -p soundbackends/windowsaudiosession_win64.dll | grep 'DLL Name:' | head -4 → AVRT.dll / KERNEL32.dll / MSVCP140.dll / VCRUNTIME140.dll
```

### 3.6.5 数据型扩展点

| 扩展点 | 形式 | 证据 |
|---|---|---|
| 图标包 | `gfx/*.zip`（countries 247、default 231、colored 209、mono 208 项） | `7z l` 计数 |
| 样式 | `styles/*.qss` + `styles/default/*.tpl` + `qwindowsvistastyle.dll` | 文件清单；`translations/../styles` |
| 翻译 | `translations/*.qm`（7 组） | 3.1.5 |
| 声音包 | `sound/<pack>/settings.ini`（`readonly = 1`、`[soundfiles]`）+ wav | `cat sound/nosounds/settings.ini`；`CONNECTION_CONNECTED = say("Connected to ${servername}")` |
| Web 页面 | `html/teamspeak5_intro/index.html` + QWebChannel 双向桥 | `qwebchannel.js`、`ts-continue-button` 注入脚本、导入 `QWebChannel::registerObject` |
| Addon / myTeamSpeak | gRPC + protobuf（`com.teamspeak.myteamspeak.proto.*`、`Addon_Service`、`Webengine_Comm/View/Page`） | 主程序 strings 与源码路径 |
| 语音处理回调 | `ts3plugin_onEditCapturedVoiceDataEvent`、`onEditMixedPlaybackVoiceDataEvent`、`onEditPostProcessVoiceDataEvent` | 3.6.1 |

**证据**
```
$ grep -m2 -E 'html/teamspeak5_intro/index\.html|qwebchannel\.js|ts_continue_button' /tmp/main.strings | cut -c1-100
html/teamspeak5_intro/index.html / qwebchannel.js / new QWebChannel(qt.webChannelTransport, (channel) => {
$ cat sound/nosounds/settings.ini → [info] name = Sounds deactivated / version = 1.0 / author = TeamSpeak Systems GmbH / readonly = 1
$ head -8 sound/default_speech/settings.ini → [info] / name = Default Text To Speech / version = 1.0 / author = TeamSpeak Systems GmbH / readonly = 1 / [soundfiles] / CONNECTION_CONNECTED = say("Connected to ${servername}")
```

## 3.7 未确认 / 不可由此静态分析确定的条目

| # | 条目 | 边界说明 |
|---:|---|---|
| 1 | 默认端口（9987/10011/30033）与协议映射 | 主程序 strings 无端口常量；需抓包/配置样本 |
| 2 | 主程序是否运行时动态加载 libeay32/ssleay32 | 主程序导入表与 strings 均无这两个名字；只有 Qt5Network 有加载名 |
| 3 | TS3 协议加密完整调用链 | 只见 libtomcrypt 函数名/类名，未做反汇编调用图 |
| 4 | createfileassoc.exe 写入的注册表键值 | NSIS 2.47 压缩脚本形态，脚本明文未出现；只能确认 RegOpenKeyExA 与提示文案 |
| 5 | 插件加载目录优先级与“内建插件”机制 | package_inst 明确安装目录 `/plugins`；主程序只有 `Plugin path error: not a full path.` |
| 6 | 插件安全模式参数名 | 仅 `Plugins safemode parameter detected...` |
| 7 | `usb.ids`（2017.02.12，20,663 行）的消费者 | 安装树内无引用该文件名的字符串 |
| 8 | `ts3clientui_qt.secrets.conf` 字段与用途 | 只有文件名字符串 |
| 9 | error_report 实际上传 URL | 运行时从 `client-crashdump-postinfo.ini` 获取；静态只有获取 ini 的地址 |
| 10 | update.exe 差分/替换算法细节（courgette） | 仅命中 courgette 断言路径与 pdb 串 |
| 11 | WebEngine sandbox/多进程启动参数 | 只有子进程 exe 与 Qt 内部 CreateProcessW |
| 12 | 匿名统计完整字段与开关条件 | 有 StatisticsHelper 文案与 systemstats.proto 类名，字段级不足 |
| 13 | myTeamSpeak gRPC 的 TLS 证书校验策略 | BoringSSL 静态链接，未见自定义校验点 |
| 14 | UDP/TCP 各自承载的业务边界 | 只能证明两种 socket 均被使用 |
| 15 | `voice.teamspeak.com` 的用途 | 仅出现域名 |
| 16 | Overwolf 组件是否默认勾选安装 | `$PLUGINSDIR` 有 Overwolf exe/bmp，安装脚本非明文 |
| 17 | 文件 mtime 是否可作发布证据 | 部分保留打包时间（2018–2020），`$PLUGINSDIR/*.dll` 为解包时间，不可统一用作发布证据 |
| 18 | 二进制哈希/签名链 | 本次未计算；如需取证应补 SHA-256 与 Authenticode |

> 以上“未确认”均写明当前静态证据边界，可在后续动态分析或反汇编阶段转化为确定结论。

## 附录 A：301 个文件完整清单（按目录分组，文件名=字节）

> 数据来源：`find . -type f -printf '%s\t%p\n'` 实测（301 个文件），按目录分组、每行 4 个文件，每个文件均给出真实字节数。

```text
总计 301 个文件 / 224,837,812 字节；格式：文件名=字节（每行 4 项，按目录分组）
[./] 36 files, 172,079,555 B
  Qt5Core.dll=6130176  Qt5Gui.dll=6470656  Qt5Network.dll=1314816  Qt5Positioning.dll=317440
  Qt5PrintSupport.dll=318464  Qt5Qml.dll=4001792  Qt5Quick.dll=3776000  Qt5QuickWidgets.dll=72704
  Qt5Sql.dll=205312  Qt5Svg.dll=332288  Qt5WebChannel.dll=113664  Qt5WebEngineCore.dll=79989760
  Qt5WebEngineWidgets.dll=228864  Qt5Widgets.dll=5580800  QtWebEngineProcess.exe=19456  Uninstall.exe.nsis=22448
  changelog.txt=186580  createfileassoc.exe=145216  d3dcompiler_47.dll=4173928  error_report.exe=565208
  icudtl.dat=10218000  libEGL.dll=18432  libGLESv2.dll=3572224  libeay32.dll=2100504
  opengl32sw.dll=17599640  openglblacklist.json=4502  package_inst.exe=644056  qtwebengine_resources.pak=1628193
  qtwebengine_resources_100p.pak=630140  qtwebengine_resources_200p.pak=690371  quazip.dll=165336  ssleay32.dll=360216
  ts3client_win64.VisualElementsManifest.xml=285  ts3client_win64.exe=17911768  update.exe=1970648  usb.ids=599668
[$PLUGINSDIR/] 11 files, 17,071,246 B
  OverwolfInstallerDownloader.exe=325440  OverwolfTeamSpeakInstaller.exe=914864  ScrollLicense.dll=5120  System.dll=11264
  UserInfo.dll=4096  inetc.dll=20992  modern-header.bmp=25818  modern-wizard.bmp=154542
  nsDialogs.dll=9728  overwolf.bmp=297494  vcredist_x64.exe=15301888
[gfx/] 6 files, 1,098,821 B
  countries.zip=144825  default.zip=331752  default_colored_2014.zip=293648  default_mono_2014.zip=309323
  tile_150.png=12531  tile_70.png=6742
[html/teamspeak5_intro/] 1 files, 1,769 B
  index.html=1769
[html/teamspeak5_intro/css/] 2 files, 31,371 B
  bootstrap.min.css=30692  overview.css=679
[html/teamspeak5_intro/fonts/] 1 files, 18,028 B
  glyphicons-halflings-regular.woff2=18028
[html/teamspeak5_intro/img/] 3 files, 1,895,924 B
  slide_1.jpg=630838  slide_2.jpg=742167  slide_3.jpg=522919
[html/teamspeak5_intro/js/] 2 files, 74,612 B
  bootstrap.min.js=5299  jquery.slim.min.js=69313
[iconengines/] 1 files, 35,328 B
  qsvgicon.dll=35328
[imageformats/] 3 files, 454,656 B
  qgif.dll=31744  qjpeg.dll=397312  qsvg.dll=25600
[platforms/] 1 files, 1,453,568 B
  qwindows.dll=1453568
[qtwebengine_locales/] 9 files, 2,033,851 B
  de.pak=214708  en-GB.pak=177359  en-US.pak=179001  es.pak=216169
  fr.pak=230632  ja.pak=258992  pl.pak=214867  pt-BR.pak=209612
  ru.pak=332511
[sound/default/] 80 files, 10,143,473 B
  3d_test.wav=153942  away_activated.wav=67190  away_deactivated.wav=67034  blocked_user_banned_server_currentchannel.wav=233098
  blocked_user_connection_connected_currentchannel.wav=166562  blocked_user_connection_connectionlost_currentchannel.wav=199874  blocked_user_connection_disconnected_currentchannel.wav=203530  blocked_user_kicked_channel_awayfromcurrentchannel.wav=180794
  blocked_user_kicked_channel_tocurrentchannel.wav=173818  blocked_user_kicked_server_currentchannel.wav=229304  blocked_user_moved_awayfromcurrentchannel.wav=190004  blocked_user_moved_tocurrentchannel.wav=171108
  blocked_user_switched_awayfromcurrentchannel.wav=145952  blocked_user_switched_tocurrentchannel.wav=147008  channel_created.wav=94194  channel_deleted.wav=90882
  channel_edited.wav=88898  channel_moved.wav=81144  channel_switched.wav=87998  channelgroup_changed.wav=114698
  chat_message_inbound.wav=88244  chat_message_outbound.wav=4148  connected.wav=55262  connection_lost.wav=87394
  disconnected.wav=84018  error.wav=41870  filetransfer_complete.wav=122026  filetransfer_failed.wav=106982
  friend_banned_server_currentchannel.wav=211382  friend_connection_connected_currentchannel.wav=122982  friend_connection_connectionlost_currentchannel.wav=161014  friend_connection_disconnected_currentchannel.wav=160938
  friend_kicked_channel_awayfromcurrentchannel.wav=155838  friend_kicked_channel_tocurrentchannel.wav=153482  friend_kicked_server_currentchannel.wav=208762  friend_moved_awayfromcurrentchannel.wav=156818
  friend_moved_tocurrentchannel.wav=147848  friend_switched_awayfromcurrentchannel.wav=112878  friend_switched_tocurrentchannel.wav=116498  greeting.wav=120666
  insufficient_permissions.wav=121066  mic_activated.wav=106982  mic_click_off.wav=6220  mic_click_on.wav=2968
  mic_muted.wav=89936  neutral_banned_server_currentchannel.wav=218768  neutral_connection_connected_currentchannel.wav=127760  neutral_connection_connectionlost_currentchannel.wav=161498
  neutral_connection_disconnected_currentchannel.wav=167834  neutral_kicked_channel_awayfromcurrentchannel.wav=178416  neutral_kicked_channel_tocurrentchannel.wav=163914  neutral_kicked_server_currentchannel.wav=223686
  neutral_moved_awayfromcurrentchannel.wav=155802  neutral_moved_tocurrentchannel.wav=153818  neutral_recording_active_currentchannel.wav=160290  neutral_recording_started_currentchannel.wav=185978
  neutral_recording_stopped_currentchannel.wav=185126  neutral_switched_awayfromcurrentchannel.wav=117182  neutral_switched_tocurrentchannel.wav=118682  no_whisper_target_found.wav=133786
  servergroup_assigned.wav=117248  servergroup_revoked.wav=130438  settings.ini=7963  sound_muted.wav=89424
  sound_resumed.wav=89978  stop_talking.wav=45742  talkpower_granted.wav=111962  talkpower_requested.wav=151946
  talkpower_revoked.wav=132770  testsound.wav=141950  too_many_whisper_targets.wav=118994  whisper_notify.wav=16648
  whisperlist_is_empty.wav=124054  you_edited_server.wav=108638  you_kicked_channel.wav=126418  you_kicked_server.wav=128804
  you_were_banned.wav=132570  you_were_moved.wav=77390  you_were_poked.wav=82766  your_channel_was_edited.wav=121976
[sound/default_male/] 73 files, 11,181,532 B
  away_activated.wav=89818  away_deactivated.wav=94938  blocked_user_banned_server_currentchannel.wav=252198  blocked_user_connection_connected_currentchannel.wav=186074
  blocked_user_connection_connectionlost_currentchannel.wav=186246  blocked_user_connection_disconnected_currentchannel.wav=208346  blocked_user_kicked_channel_awayfromcurrentchannel.wav=213722  blocked_user_kicked_channel_tocurrentchannel.wav=202874
  blocked_user_kicked_server_currentchannel.wav=248758  blocked_user_moved_awayfromcurrentchannel.wav=203738  blocked_user_moved_tocurrentchannel.wav=198362  blocked_user_switched_awayfromcurrentchannel.wav=173786
  blocked_user_switched_tocurrentchannel.wav=176858  channel_created.wav=110042  channel_deleted.wav=110042  channel_edited.wav=110810
  channel_moved.wav=106970  channel_switched.wav=104666  channelgroup_changed.wav=144090  connected.wav=75994
  connection_lost.wav=111322  disconnected.wav=98010  error.wav=59098  filetransfer_complete.wav=133338
  filetransfer_failed.wav=133850  friend_banned_server_currentchannel.wav=220634  friend_connection_connected_currentchannel.wav=142298  friend_connection_connectionlost_currentchannel.wav=183002
  friend_connection_disconnected_currentchannel.wav=174818  friend_kicked_channel_awayfromcurrentchannel.wav=183770  friend_kicked_channel_tocurrentchannel.wav=174554  friend_kicked_server_currentchannel.wav=222206
  friend_moved_awayfromcurrentchannel.wav=175358  friend_moved_tocurrentchannel.wav=177626  friend_switched_awayfromcurrentchannel.wav=141482  friend_switched_tocurrentchannel.wav=168410
  greeting.wav=154970  insufficient_permissions.wav=127706  mic_activated.wav=127706  mic_muted.wav=115930
  neutral_banned_server_currentchannel.wav=208346  neutral_connection_connected_currentchannel.wav=140762  neutral_connection_connectionlost_currentchannel.wav=163802  neutral_connection_disconnected_currentchannel.wav=169178
  neutral_kicked_channel_awayfromcurrentchannel.wav=178394  neutral_kicked_channel_tocurrentchannel.wav=181466  neutral_kicked_server_currentchannel.wav=212186  neutral_moved_awayfromcurrentchannel.wav=196826
  neutral_moved_tocurrentchannel.wav=195290  neutral_recording_active_currentchannel.wav=180954  neutral_recording_started_currentchannel.wav=204506  neutral_recording_stopped_currentchannel.wav=203994
  neutral_switched_awayfromcurrentchannel.wav=148442  neutral_switched_tocurrentchannel.wav=143834  no_whisper_target_found.wav=135898  servergroup_assigned.wav=134874
  servergroup_revoked.wav=124634  settings.ini=8102  sound_muted.wav=102618  sound_resumed.wav=114084
  talkpower_granted.wav=114394  talkpower_requested.wav=165594  talkpower_revoked.wav=129334  testsound.wav=168410
  too_many_whisper_targets.wav=129242  whisperlist_is_empty.wav=129754  you_edited_server.wav=143858  you_kicked_channel.wav=151514
  you_kicked_server.wav=143834  you_were_banned.wav=163802  you_were_moved.wav=104558  you_were_poked.wav=113882
  your_channel_was_edited.wav=150746
[sound/default_speech/] 1 files, 9,562 B
  settings.ini=9562
[sound/nosounds/] 1 files, 97 B
  settings.ini=97
[soundbackends/] 2 files, 298,928 B
  directsound_win64.dll=128984  windowsaudiosession_win64.dll=169944
[sqldrivers/] 1 files, 1,151,488 B
  qsqlite.dll=1151488
[styles/] 6 files, 149,807 B
  default.qss=4231  default_chat.qss=6790  default_linux.qss=176  default_mac.qss=1206
  default_vista.qss=188  qwindowsvistastyle.dll=137216
[styles/default/] 9 files, 58,529 B
  channelinfo.tpl=3478  chatlog-128x96.png=9343  clientinfo.tpl=5283  logo-128x128.png=17253
  serverinfo.tpl=3375  splitter.png=15530  splitter_vertical.png=201  tree_tooltip_channel.tpl=2469
  tree_tooltip_client.tpl=1597
[translations/] 52 files, 5,595,667 B
  error_report_de.qm=1182  error_report_es.qm=1802  error_report_fr.qm=1918  error_report_ja.qm=1253
  error_report_pl.qm=1710  error_report_pt.qm=1694  error_report_ru.qm=1779  lagos.qm=6774
  lagos_de.qm=437784  lagos_es.qm=471297  lagos_fr.qm=481725  lagos_ja.qm=361071
  lagos_pl.qm=457006  lagos_pt.qm=455069  lagos_ru.qm=467825  package_installer_de.qm=4215
  package_installer_es.qm=4439  package_installer_fr.qm=4519  package_installer_ja.qm=3386  package_installer_pl.qm=4405
  package_installer_pt.qm=4235  package_installer_ru.qm=4194  permissions.qm=120710  permissions_de.qm=132594
  permissions_es.qm=136418  permissions_fr.qm=141800  permissions_ja.qm=85887  permissions_pl.qm=133316
  permissions_pt.qm=130956  permissions_ru.qm=134143  qt_de.qm=200848  qt_es.qm=15737
  qt_fr.qm=256377  qt_ja.qm=129904  qt_pl.qm=317367  qt_pt.qm=71525
  qt_ru.qm=183686  ts_core_errors.qm=22400  ts_core_errors_de.qm=23940  ts_core_errors_es.qm=25543
  ts_core_errors_fr.qm=25399  ts_core_errors_ja.qm=18586  ts_core_errors_pl.qm=24235  ts_core_errors_pt.qm=24175
  ts_core_errors_ru.qm=24468  update_de.qm=4513  update_es.qm=5608  update_fr.qm=5776
  update_ja.qm=4047  update_pl.qm=5580  update_pt.qm=5404  update_ru.qm=5443
```
