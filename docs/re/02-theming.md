# 02 · 主题与图标包机制：QSS 皮肤系统 + gfx 图标包

> 对象：TeamSpeak 3 Client **3.5.6**（win64，2020-11-25 构建）解包目录 `/home/gaozikun/1017/ts3/extracted`（**只读**）。
> 目的：为 Material Design 3（MD3）皮肤改造提供事实基础。数字全部来自实测；每条结论后跟「证据」块。
> 推断结论标注「推断 + 置信度」；证据不足者集中在第 8 章。

## 0. 结论速览

1. **皮肤 = `styles/<stem>.qss`**；`<stem>` 来自设置项 `QtStyle`；资源目录 `styles/<stem>/`、聊天样式 `<stem>_chat.qss`、平台增量 `<stem>_vista.qss` / `_win` / `_linux` / `_mac`。磁盘上只有 `default` 这一套五件套。
2. **往 `styles/` 放 `md3.qss` 大概率会被识别**（下拉框提示原文 “Select stylesheet from "styles" directory”），置信度约 85%；枚举方式无法仅凭字符串 100% 断定，给出 3 条验证/兜底路径（§3.5）。
3. **exe 里的 `classic.qss` / `modern.qss` / `bluesky.qss` 都不存在于磁盘、也不是 3.5.6 内置皮肤**：`classic/modern` 是 3.1.5 已删除的旧皮肤残留字面量，`bluesky.qss` 是第三方示例皮肤名。
4. **`styles:default/xxx.png` 是自定义图片 provider scheme**，解析为 `<安装目录>/styles/default/xxx.png`；同类 scheme 还有 `gfx:`、`iconpath:`、`countries:`、`emoticons:`、Qt 资源 `:/`。这是 2010 年专门为“非标准工作目录启动”引入的。
5. **QSS 能改**：颜色、圆角、字体、渐变、边框、背景图、部分布局属性，以及 3.5.0 起的 `QPalette::ColorRole` 覆盖（exe 内有解析正则）。**不能改**：Windows 原生标题栏、QtWebEngine 页面（Addon Browser）、托盘图标、exe 内嵌 Qt 资源 logo、安装器/更新器。
6. **图标必须换 `gfx/*.zip`**：`default.zip`（230 真实文件 / 229 PNG，尺寸前缀式）已过时；`default_colored_2014.zip`（208 / 206 SVG）与 `default_mono_2014.zip`（207 / 205 SVG）用 `settings.ini [gfxfiles]` 213 条映射，**新包必须照抄这套**。
7. `countries.zip`（247 PNG，全部 16×11/16×12，全部 stored 未压缩）是国旗专用包；改国旗**不用动它** —— 放 `gfx/customCountries/` 即可覆盖（changelog 明文）。
8. **最容易出 MD3 效果的 3 个切入点**：① `styles/md3.qss` 全局换色 + `QPalette::Role`；② `md3_chat.qss` 的 57 个 class（聊天/信息面板）；③ SVG 图标包（复用 2014 包 settings.ini）。详见 §7.5。

## 1. 分析范围与方法

- `strings`（ASCII 与 `-e l` UTF-16LE 两遍，`-t x` 取文件偏移）；Python 3.12 标准库（`struct` 读 PE 节表把文件偏移换算 RVA、`zipfile` 取条目、`re` 解析 QSS）；`unzip -l/-t` 交叉校验；PNG 尺寸读 IHDR。
- 对象：`styles/`（5 qss + `default/` 子目录 9 文件）、`gfx/`（4 zip + 2 tile PNG）、`ts3client_win64.exe`（17,911,768 B）、`changelog.txt`（186,580 B / 3176 行）。
- 写盘只有本报告与 CSV；目标目录未改动。

**证据 E-01（exe 常量池位置；`.rdata` 文件偏移→RVA 为 +0xC00）**

```console
$ python3 -c "...parse PE sections..."
sections: 7 magic: 0x20b
.text   VA=0x00001000 VSize=0xb22f48 Raw=0x00000400 RawSize=0xb23000
.rdata  VA=0x00b24000 VSize=0x503b6c Raw=0x00b23400 RawSize=0x503c00
.data   VA=0x01028000 VSize=0x766c8  Raw=0x01027000 RawSize=0x54200
.pdata  VA=0x0109f000 VSize=0x67e3c  Raw=0x0107b200 RawSize=0x68000
_RDATA  VA=0x01107000 VSize=0x830    Raw=0x010e3200 RawSize=0xa00
.rsrc   VA=0x01108000 VSize=0x18740  Raw=0x010e3c00 RawSize=0x18800
.reloc  VA=0x01121000 VSize=0x1739c  Raw=0x010fc400 RawSize=0x17400
```

本文提到的所有皮肤/图标字面量都落在 `.rdata` 常量池 → 说明 **QSS 正文不在 exe 里，只能从磁盘读**。

**证据 E-02（exe 里没有内置 QSS 兜底文本）**

```console
$ strings -n 4 ts3client_win64.exe | grep -iE 'Default Qt StyleSheet|Channel Infoframe Template|InfoFrame_Title'
（仅一条无关的 HTML 锚点；无 QSS 正文）
```

→ `styles/default.qss` 丢失后没有“内置样式文本”可回退，只会退回默认 Qt 外观。

## 2. `styles/` 目录实测

### 2.1 文件清单

**证据 E-03**

```console
$ find styles -type f -printf '%s\t%p\n' | sort -k2
4231    styles/default.qss
9343    styles/default/chatlog-128x96.png
17253   styles/default/logo-128x128.png
15530   styles/default/splitter.png
201     styles/default/splitter_vertical.png
3478    styles/default/channelinfo.tpl
5283    styles/default/clientinfo.tpl
3375    styles/default/serverinfo.tpl
2469    styles/default/tree_tooltip_channel.tpl
1597    styles/default/tree_tooltip_client.tpl
6790    styles/default_chat.qss
176     styles/default_linux.qss
1206    styles/default_mac.qss
188     styles/default_vista.qss
137216  styles/qwindowsvistastyle.dll
```

- `styles/*.qss` 合计 **12,591 B**；`styles/default/` 合计 **58,529 B / 9 文件**。
- `qwindowsvistastyle.dll`（137,216 B，PE32+ DLL）是 **Qt 平台样式插件**（`QStyleFactory` 的 `windowsvista`），不是皮肤资源，却决定“没被 QSS 覆盖的原生控件怎么画”（§7.3）。
- 全部 `.qss`/`.tpl` 都是**纯 ASCII、LF、无 BOM**（`head -c 3 | xxd` + `file` 校验）→ 改皮肤别写成 BOM/CRLF。

### 2.2 体积 / 行数 / 规则数

**证据 E-04**

```console
$ wc -l styles/*.qss
  161 styles/default.qss        268 styles/default_chat.qss
    6 styles/default_linux.qss   68 styles/default_mac.qss
    6 styles/default_vista.qss
```

| 文件 | 字节 | `wc -l` | `{` 规则数 | 注释块 | 说明 |
|---|---:|---:|---:|---:|---|
| `default.qss` | 4,231 | 161 | 24 | 5 | 主样式表 |
| `default_chat.qss` | 6,790 | 268 | 30 | 13 | 聊天/信息面板 CSS |
| `default_mac.qss` | 1,206 | 68 | 11 | 2 | macOS 增量（Tab 外观） |
| `default_linux.qss` | 176 | 6 | **0** | 1 | 只有版权注释，零规则 |
| `default_vista.qss` | 188 | 6 | **0** | 1 | 只有版权注释，零规则 |

> 文件末行无换行，`wc -l` 比真实行数少 1。`default_linux/_vista.qss` 是**空壳占位**：机制会加载，但 3.5.6 没往里写规则 —— 这就是“换皮肤后 Linux/Vista 看不出变化”的原因。

### 2.3 `default.qss` 结构解剖

**证据 E-05**

```console
=== default.qss === selectors=36 unique=33
 IDs(25): AvailableServerIntegration, ChatLineEdit, ChatTab, ExistingServerIntegration,
  HeadlineLabel, InfoFrame, IntegrationBubbleEditableComboBox, IntegrationErrorIndicatorLabel,
  NewsLeftLabel, OptionsHeadlineDescriptionLabel, OptionsHeadlineTitleLabel, ServerTreeView,
  accountCreateBanner, accountLoginBanner, appNameLabel, banTableView, bookmarksBanner,
  bookmarksLocalRemoteSplitter, clientsTableView, identitiesBanner,
  identitiesLocalRemoteSplitter, localIconsListWidget, profilesLocalRemoteSplitter,
  remoteIconsListWidget, whisperListsLocalRemoteSplitter
 Qt types: QComboBox QLabel QListWidget QSplitter QStatusBar QTableView QTextEdit QTreeView QWidget
 url refs: styles:default/splitter.png / logo-128x128.png / chatlog-128x96.png
 palette roles: base, mid    qproperty: alternatingRowColors, minimumSize, rootIsDecorated
 渐变: 2 处 qlineargradient
```

1. **ID 选择器占主导**（25 个不同 `#id`，其中 4 个是 `QSplitter::handle#…Splitter`）：TS3 皮肤是“按对象名定制”而非按控件类。
2. **命名空间类选择器**：`com--teamspeak--ui--ServerIntegrationsWidget` 等（Qt 把 `com::teamspeak::ui` 写成 `com--teamspeak--ui`），可穿透 Designer 生成的嵌套控件。
3. **动态属性选择器**已用：`QTextEdit#ChatLineEdit[helpTextVisible="true"]` —— MD3 placeholder 色最省事的入口。
4. `qproperty-*` 已用 3 个（`minimumSize`、`rootIsDecorated`、`alternatingRowColors`）→ 该客户端支持 Qt 属性注入（有边界，§7.1）。
5. `palette(base)` / `palette(mid)` 与 QPalette 打通 —— MD3 换色最省力路线（§5）。
6. 只有 **24 条规则覆盖 25 个 ID**：按钮、滚动条、菜单、表头、复选框、进度条等**全都没人管**，由 `windowsvista` 原生样式绘制。既是限制也是 MD3 的机会。

### 2.4 `default.qss` 全文要点

```css
/* 头部注释即文档：QPalette 角色覆盖语法 + CustomColor 示例 */
/* QPalette::Link = #1c82cc;  CustomColor::ClientFriend = #008000; ... */

/* splitter 抓手：4 个 ID，垂直方向用 styles:default/splitter.png（80×20拉伸） */
QSplitter::handle#bookmarksLocalRemoteSplitter, ... { background-image: url('styles:default/splitter.png'); height: 2px; }
/* 横幅：4 段蓝灰 qlineargradient + qproperty-minimumSize: 0px 32px */
/* 聊天输入框 placeholder：QTextEdit#ChatLineEdit[helpTextVisible="true"] { color:#909090 } */
/* 信息面板/聊天页背景图：styles:default/logo-128x128.png、chatlog-128x96.png */
/* 树/表：qproperty-rootIsDecorated:false、qproperty-alternatingRowColors:true */
/* 字体：'TeamSpeak 2020'，18px 标题 / 32px appNameLabel，后者还用了 text-transform:lowercase */
/* 服务器集成面板：com--teamspeak--ui--* + border-radius:2px */
/* 被注释掉：QWidget { font-family:"Segoe UI"; font-size:9pt; } */
```

注意 `text-transform: lowercase`（Qt QSS **不支持**该属性）—— 官方皮肤自己踩过的坑，说明解析器就是 Qt 原生 QSS，不能指望 CSS3。

### 2.5 `default_chat.qss` 结构

**证据 E-06**：57 个选择器（全部 class，无 ID/类型），含 37 个 `TextMessage_*`
（UserLink/ChannelLink/ServerLink/OfflineLink/Time/Text/Normal/Welcome/HostMessage/Poke/
Connected/Disconnected/ClientConnected/ClientDisconnected/ClientJoined/ClientLeft/
ClientSwitched/ClientDropped/ClientKicked/ClientBanned/ChannelCreated/ChannelDeleted/
ChannelMoved/ChannelEdited/ServerEdited/ServerError/GroupAssigned/GroupRevoked/
TalkPowerAssigned/TalkPowerRevoked/TalkPowerRequested/BeginHistory/EndHistory/HostName），
以及 `.InfoFrame_Title/.InfoFrame_Table/.InfoFrame_CustomNick/.Highlight/.Important/.Active/.Inactive/.Badge/.Label/.List/.Space-Top/.Space-Bot`。

文件头 120 行注释即官方文档：**聊天只支持 HTML 4 极小子集**（指向 Qt `richtext-html-subset.html#css-properties`），并给出 class 组合范式 `.TextMessage_Message.Friend.Private { ... }`。

### 2.6 `styles/default/` 资源真实尺寸

**证据 E-07（读 PNG IHDR）**

```console
chatlog-128x96.png    IHDR 128x96   bitdepth=8 colortype=6  bytes=9343
logo-128x128.png      IHDR 128x190  bitdepth=8 colortype=6  bytes=17253   <-- 名字撒谎
splitter.png          IHDR 80x20    bitdepth=8 colortype=6  bytes=15530
splitter_vertical.png IHDR 20x80    bitdepth=8 colortype=6  bytes=201
```

`logo-128x128.png` 真实 **128×190**（MD3 重做必须按 190 高，否则 `background-position: top right` 出现留白）；`splitter_vertical.png` 只有 201 B 且对应规则被注释，实际未启用。

### 2.7 `.tpl` 是什么（Q3）：HTML 模板

**结论：是 HTML 模板**（不是 QSS/ini/Lua）：由 `%%VAR%%` 占位、`%%?VAR%%` 行级条件、头部 HTML 注释里的“预定义值”组成，C++ 替换后喂给 Qt 富文本控件。

**证据 E-08**

```console
$ file styles/default/*.tpl
channelinfo.tpl: HTML document, ASCII text, with very long lines (641)
clientinfo.tpl:  HTML document, ASCII text, with very long lines (560)
serverinfo.tpl:  HTML document, ASCII text, with very long lines (459)
tree_tooltip_channel.tpl / tree_tooltip_client.tpl: HTML document, ASCII text
```

| 模板 | 字节 | `wc -l` | `%%VAR%%` 次数 | 唯一变量 | `%%?X%%` | `<style>` | `<table>` |
|---|---:|---:|---:|---:|---:|---:|---:|
| channelinfo.tpl | 3,478 | 94 | 34 | 33 | 11 | 0 | 3 |
| clientinfo.tpl | 5,283 | 147 | 45 | 43 | 10 | 0 | 7 |
| serverinfo.tpl | 3,375 | 110 | 38 | 31 | 10 | 0 | 4 |
| tree_tooltip_channel.tpl | 2,469 | 75 | 25 | 24 | 11 | 1 | 1 |
| tree_tooltip_client.tpl | 1,597 | 63 | 11 | 10 | 5 | 1 | 2 |

**模板头部官方注释（一手证据）**：

```html
<!-- The replaceable variables are embedded in "%%" like %%CHANNEL_NAME%%. At this time you can also use
%%?CHANNEL_NAME%% (note the questionmark), which is a tiny "if"- query. Use it, to remove the whole
line, if a variable is empty or just "0".
Templates can be placed in "styles/" for default theme or in a sub folder named like an available
theme (e.g. "styles/bluesky/"). Be aware that this template will not automaticly be translated...
Options (remove the "#" to enable):
#%%IMAGES_MAX_WIDTH%%256
#%%IMAGES_MAX_HEIGHT%%256 -->
```

1. 模板按主题目录查找：`styles/<theme>/*.tpl`；`styles/` 根是 default theme 的旧位置（3.5.6 实际在 `styles/default/`）。
2. `%%?VAR%%` 是“行级 if”：变量为空/`"0"` 时**整行删除** → 可用于 MD3 留白控制。
3. 预定义值必须写在 HTML 注释里、替换前解析；`#` 是开关。
4. **`.tpl` 里的 `<style>` 自 3.3.0 起废弃**。changelog 3.3.0（2019-06-18）：
   `! The HTML style tag is no longer supported in infoframe templates. All addon authors should use the <stylename>_chat.qss file for CSS style definitions instead.`
   → MD3 改信息面板：**结构改 `.tpl`，颜色/字体必须写 `md3_chat.qss`**。
5. 翻译：3.1.5 起由 `lagos_xx.qm` + C++ 填充，`clientinfo_de.tpl` 这类语言模板优先（legacy）。

## 3. 皮肤选择机制（Q1）

### 3.1 设置项 key

**证据 E-09（Design 页字面量，文件偏移 0xCD6xxx）**

```console
$ strings -t x ts3client_win64.exe
cd6a24 Style                  cd6ab0 System default        cd6ac0 Select style of TeamSpeak
cd6adc Theme                  cd6d20 Select stylesheet from "styles" directory
cd6d50 Icon Pack              cd7060 styleSheetComboBox    cd7088 iconPackComboBox
cd7290 QtStyle                cd7298 IconPack              cd739c Design
cd73d0 Get more stylesheets & icons
cd7440 TeamSpeak will use the selected icon pack on the next restart.
cd74a0 Setting style to:      cd74b8 GUI_Setup
cd74c8 TeamSpeak will reset to the default style on the next restart.
cd7508 Loading stylesheet:
```

→ Options → **Design** 页有 3 个下拉框：

| 控件 objectName | 标签/提示 | 配置 key |
|---|---|---|
| `styleComboBox` | “Style” / “System default” / “Select style of TeamSpeak” | （Qt 平台样式，`QStyleFactory`） |
| `styleSheetComboBox` | “Theme” / “Select stylesheet from "styles" directory” | **`QtStyle`** |
| `iconPackComboBox` | “Icon Pack” | **`IconPack`** |

UTF-16 常量旁证：`0xc8d810 'QtStyleSheet'` + `0xc8d858 'Application'`（新旧键名成对）；
`0xca0b60 'IconPack'` 紧邻 `0xca0b38 'default_mono_2014'` → **IconPack 默认值很可能是裸词干**（加载时再拼 `.zip`）；
`0xc80d28 'styles'` 与 `0xc80d70 '.qss'` 同表，表内还有
`translations / group_addon / sound / plugins / styles / unspecified / .dll / .qss`
—— **addon 分类 → 安装子目录 → 扩展名 映射表**（插件进 plugins/、样式进 **styles/**、音效进 sound/、翻译进 translations/）。

### 3.2 exe 字面量地图

**证据 E-10**

```console
$ strings -t x -n 4 ts3client_win64.exe | grep -E ' (styles|\.qss|\.tpl|style|_chat|_mac|_linux|_vista|_win|default\.qss|bluesky\.qss)$'
 c81170 styles      c81178 .qss       c81180 .tpl        c81188 style
 c81770 bluesky.qss c81fc8 _chat      c81fd0 _mac        c81fd8 _linux
 c82100 default.qss c821ac _vista     c821b4 _win        c8d1f0 _vista.qss
```

| 文件偏移 | RVA | 字面量 | 间隔 | 含义 |
|---|---:|---|---:|---|
| 0xC81158 | 0xC81D58 | `translations/../styles` | — | addon 安装目标 = `<install>/styles` |
| 0xC81170 | 0xC81D70 | `styles` | +0x18 | 目录名 |
| 0xC81178 | 0xC81D78 | `.qss` | **+0x08** | 样式扩展名 |
| 0xC81180 | 0xC81D80 | `.tpl` | +0x08 | 模板扩展名 |
| 0xC81188 | 0xC81D88 | `style` | +0x08 | addon 分类名 |
| 0xC81770 | 0xC82370 | `bluesky.qss` | — | 第三方示例皮肤完整名 |
| 0xC81FC8 | 0xC82BC8 | `_chat` | — | 聊天后缀 |
| 0xC81FD0 | 0xC82BD0 | `_mac` | **+0x08** | macOS 后缀 |
| 0xC81FD8 | 0xC82BD8 | `_linux` | **+0x08** | Linux 后缀 |
| 0xC82100 | 0xC82D00 | `default.qss` | — | 默认样式完整名 |
| 0xC821AC | 0xC82DAC | `_vista` | — | Vista/7/8 后缀 |
| 0xC821B4 | 0xC82DB4 | `_win` | **+0x08** | Windows(XP) 后缀 |
| 0xC8D1F0 | 0xC8DDF0 | `_vista.qss` | — | **加载器内的完整平台后缀** |

“8 字节等差相邻”是 `char*` 常量数组（如 `{ "_chat","_mac","_linux" }`）被密集排布的典型特征；加上 `_vista.qss` 完整串 → **`<stem> + 后缀 + ".qss"` 是编译期写死的**，不来自配置。

### 3.3 拼接规则（推断，置信度高）与 changelog 佐证

```
<install>/styles/
├─ <stem>.qss              ← 主样式表（QtStyle 指向）
├─ <stem>_chat.qss         ← 聊天/信息面板（缺失回退 default_chat.qss）
├─ <stem>_vista.qss        ← Win Vista/7/8（存在才加载）
├─ <stem>_win.qss          ← 旧 Windows（存在才加载；3.5.6 未随包提供）
├─ <stem>_linux.qss / <stem>_mac.qss
└─ <stem>/                 ← 该主题资源目录：splitter.png(80×20) splitter_vertical.png(20×80)
                              logo-128x128.png(128×190) chatlog-128x96.png(128×96) + 5 个 .tpl
```

| 出处（官方 release notes） | 原文 | 证明 |
|---|---|---|
| 3.0.0-beta16（2010-02-24） | `* For Windows Vista + Win7, also load <stylesheet>_vista.qss if it exists` | 基名 + `_vista.qss`，“存在才加载” |
| 3.0.0-beta5（2009-12-22） | `* Added default_mac.qss and bluesky_mac.qss to overwrite special Mac app bundle paths to the styles directory.` | `<stem>_mac.qss` 约定，第三方也遵守 |
| 3.0.0-beta18（2010-03-30） | `* Moved some hardcoded stylesheets out to default.qss. Added default_linux.qss` | `default_linux.qss` 由来 |
| 3.0.11（2013-07-31） | `+ ... default_chat.qss in styles/ folder ... The default_chat.qss is also the fallback if <stylename>_chat.qss does not exist.` | **`<stylename>_chat.qss` + default 兜底** |
| 3.0.11（2013-07-31） | `* Added that info frame loads the <style>_chat.qss` | 信息面板同吃 chat qss |
| 3.3.0（2019-06-18） | `! The HTML style tag is no longer supported in infoframe templates...` | 3.5.6 模板内 CSS 废弃 |
| 3.1.5（2017-07-20） | `* Removed old default/modern/classic styles.` | classic/modern 已删除 |
| 3.1.1（2017-02-10） | `- When a style is uninstalled, the client now switches back to default.` | 对应 exe 日志 `Uninstalling current style sheet. Switching to default.` |
| 3.0.8（2012-07-16） | `* Package installer only autoactivates styles if a qss file is present.` | 安装器按“qss 文件存在”判定样式可用 |

### 3.4 classic.qss / modern.qss / bluesky.qss 的真相

**证据 E-11**

```console
strings -t x ts3client_win64.exe（按文件偏移顺序）
187261 default_mono_2014.zip   187262 default.zip      187263 modern.qss
187264 classic.qss             187265 default_speech    187266 default_male
187267 nosounds                187268 default_colored_2014.zip  187269 lagos_ja.qm
...
181363 Bluesky   181364 A light blue style.   181365 25ee5633-bd08-4496-af87-4df33d292d8a
181366 lagos_([a-z]{2})\.qm  181367 .zip  181368 default.qss  181369 _vista  181370 _win
```

1. `modern.qss` / `classic.qss` 夹在**内置 addon 注册表**中（`default_mono_2014.zip`、`default.zip`、`default_speech`、`nosounds`、`lagos_*.qm` 都是随客户端分发、首启注册的 addon）。该注册表是 3.1.5 之前的遗留数据：3.1.5 明说 “Removed old default/modern/classic styles”，但字符串没清理 → **3.5.6 的 exe 留着名字，磁盘上没有文件**。
2. `bluesky.qss` 位于 addons.cpp 安装/卸载区，旁边是内置样式描述 `Bluesky` / `A light blue style.` / UUID `25ee5633-…` → **第三方示例样式名**，官方自 2010 年起拿它当示例（`styles:bluesky/...`），并未随 3.5.6 分发。
3. 三个名字都**不在磁盘**（`find . -iname '*.qss'` 只有 5 个 `default*`）。
4. → “exe 有这些字符串” ≠ “会加载”。**MD3 皮肤不要叫 classic/modern/bluesky**：`TeamSpeak will reset to the default style on the next restart.` 这句日志很可能是“旧样式名 → 重置”的迁移逻辑。

### 3.5 明确回答：放 `md3.qss` 会被识别吗？

**会（置信度约 85%）。** 支持证据：

1. 官方 UI 文案就是“从 styles 目录选”：`Select stylesheet from "styles" directory`（0xCD6D20）。
2. addon 分类表把 `style` 落到 `styles/`，安装器按“**qss 文件存在**”激活（changelog 3.0.8 原文）→ 不依赖额外注册。
3. 加载只需 `<stem>.qss` + 可选派生文件（`_chat`/`_vista`… 都是“存在才加载”），无必需依赖文件。
4. exe 里**没有** `*.qss` 通配符字面量，但有 `.qss` 后缀字面量 → 与“遍历目录 + `endsWith(".qss")` 填下拉框”吻合。
5. 社区事实（旁证）：TS3 十余年第三方皮肤都是“丢 qss 进 styles/”分发。

不能 100% 断定的原因：无法排除“下拉框只显示 addon 库登记项”；字符串层看不到枚举函数（无符号表、未反编译）。

| 路径 | 做法 | 风险 |
|---|---|---|
| A. 直接放文件 | `styles/md3.qss`（+ `styles/md3/` 资源），启动后 Options→Design→Theme 找 `md3`/`md3.qss` | 若下拉框不显示，说明是 addon 库驱动（低概率） |
| B. 覆盖默认 | 直接改 `styles/default.qss` 内容（保留文件名），不动配置 | 100% 生效；失去切回原皮肤能力，升级会被覆盖 |
| C. 配置直写 | 在 `%APPDATA%\TS3Client\settings.db` 把 `QtStyle` 改为 `md3` / `md3.qss` | 动用户配置；两种值格式都需试（§3.2 未能唯一确定） |

**最小验证实验（3 分钟）**：`cp styles/default.qss styles/md3.qss` → 启动 → 看日志是否出现 `Loading stylesheet: md3` → 看 Design 下拉框。这一步把 85% 变成 100%。

## 4. 自定义 URL scheme 解析（Q2）

### 4.1 scheme 全集

**证据 E-12（图片 provider 常量池 0xC9A6xx–0xC9AAxx，全部 `.rdata`）**

```console
c9a848 /customCountries/   c9a860 /countries/     c9a870 PLAYER_CHAT
c9a880 :/application/teamspeak_logo_minimal        c9a8a8 /default/   c9a8b8 iconpath
c9a8c8 default/            c9a8d8 emoticons        c9a8e8 countries
c9a8f8 16x16_%1.png        c9a908 Unsupported image format for
c9a938 countries:          c9a944 gfx:             c9a950 24x24_%1.png
c9a960 32x32_%1.png        c9a970 \?size=(\d+)x(\d+)   c9a998 styles:
c9a9a0 emoticons:          c9a9b0 %1x%2_%3.png     c9a9c0 .png    c9a9c8 GROUP_
c9a9d0 .svg
```

| scheme / 前缀 | 解析结果 | 用途 |
|---|---|---|
| `styles:<theme>/<file>` | `<install>/styles/<theme>/<file>` | 皮肤资源（QSS 的 `url()`） |
| `gfx:<sub>/<file>` | `<install>/gfx/<sub>/<file>` | 例：`gfx:countries/fr.png`（changelog 原文） |
| `iconpath:<name>[?size=WxH]` | 当前图标包内按 `<W>x<H>_<name>.<ext>` 查 | QSS/HTML 取图标 |
| `countries:<cc>` | 国旗目录/包 | 国旗 |
| `emoticons:<file>` | 当前图标包 `emoticons/` | 表情 |
| `:/...` | **exe 内嵌 Qt 资源** | `:/application/teamspeak_logo_minimal`、`:/fonts/teamspeak2020.ttf`、`:/setup/addons_setup.js` |

另有路径片段 `/default/`、`default/`、`/countries/`、`/customCountries/`（兼容旧 `gfx/default/`、`gfx/countries/` 目录布局；changelog 3.0.14：“Old folders gfx/default and gfx/countries will be emptied on update”）。
尺寸正则 `\?size=(\d+)x(\d+)` 与 `16x16_%1.png`/`24x24_%1.png`/`32x32_%1.png`/`%1x%2_%3.png` 同池 → `iconpath:` 解析 = 取 size（缺省 16/24/32 三档）→ 拼 `<W>x<H>_<name>.<ext>` → 包内查。exe 里聊天 HTML 也这么用：

```console
<img src="iconpath:%1?size=16x12">%2
<img src="iconpath:%1?size=%2x%2" width="%2" height="%2">%3
```

### 4.2 `styles:default/splitter.png` → 磁盘路径

三步：`url('styles:default/splitter.png')` → Qt 作为相对 URL 交给自定义 scheme handler → 识别前缀 `styles:`，剥掉得 `default/splitter.png` → 拼到 `<install>/styles/` → `<install>/styles/default/splitter.png`。

**changelog 原文（beta23，2010-08-02）即是权威说明：**

> `! New mechanism to locate files from within qss files using the "url" command: Instead of "styles/<my_style>/<my_file>" use "styles:<my_style>/<my_file>". Check default.qss and bluesky.qss as example. This change is required so the images are found when starting the client using a non-standard working directory.`

→ 旧写法 `url('styles/default/x.png')` 相对**当前工作目录**，从快捷方式/别处启动就裂图；`styles:` 绝对定位到安装目录。

**证据 E-13（QSS 三处引用全部可在磁盘落地）**

| QSS 引用 | 磁盘文件 | 实测 |
|---|---|---|
| `styles:default/splitter.png` | `styles/default/splitter.png` | 80×20 RGBA，15,530 B |
| `styles:default/logo-128x128.png` | `styles/default/logo-128x128.png` | 128×**190** RGBA，17,253 B |
| `styles:default/chatlog-128x96.png` | `styles/default/chatlog-128x96.png` | 128×96 RGBA，9,343 B |

**对 MD3 的含义**：资源放 `styles/md3/`，QSS 一律写 `url('styles:md3/xxx.png')`（**不要**写旧式 `styles/md3/xxx.png`）；目录名必须等于 qss 词干。没有证据显示“目录级自动回退 default/”（只有 `<stem>_chat.qss` → `default_chat.qss` 这一条明确回退）→ **MD3 皮肤应把 4 张 PNG + 5 个 tpl 全量复制一份再改**。

## 5. QPalette 颜色角色：MD3 换色的隐藏高速公路

3.5.0（2020-03-19）changelog：`* Qt color roles can now be customized in themes (e.g. for hyperlinks).`

**证据 E-14（0xC8D1xx 区，就在 `_vista.qss` 旁）**

```console
c8d128 Dark      c8d134 Light     c8d140 Midlight  c8d14c Link
c8d158 LinkVisited  c8d168 Highlight  c8d178 HighlightedText
c8d188 ToolTipBase  c8d198 PlaceholderText  c8d1a8 Base  c8d1b0 AlternateBase
c8d1c0 ButtonText   c8d1d0 BrightText  c8d1dc Text  c8d1e4 Button
c8d1f0 _vista.qss   c8d200 QPalette::([A-Za-z]+)\s*=\s*([^;]+);
c8d22c linux  c8d238 WindowText  c8d248 Foreground  c8d254 Window  c8d260 Background
c8d290 windowsvista   c8d2a0 windowsxp
```

1. 存在 **QPalette::ColorRole 名字表**；
2. 存在**正则** `QPalette::([A-Za-z]+)\s*=\s*([^;]+);` → 加载器扫描 qss 文本里的 `QPalette::Role = value;` 并应用；
3. 同区还有平台判定字面量 `windowsvista`/`windowsxp`/`linux` 与 `_vista.qss` → 这是“样式加载 + 平台附加 + 调色板解析”同一函数的常量区。

**MD3 用法（最重要实操结论）**：在 `styles/md3.qss` 开头写

```css
QPalette::Window=#FFFBFE;   QPalette::WindowText=#1C1B1F;  QPalette::Base=#FFFBFE;
QPalette::AlternateBase=#F3EDF7; QPalette::Text=#1C1B1F;    QPalette::Button=#E8DEF8;
QPalette::ButtonText=#1D192B; QPalette::Highlight=#6750A4;  QPalette::HighlightedText=#FFFFFF;
QPalette::Link=#6750A4;     QPalette::LinkVisited=#7D5260;  QPalette::PlaceholderText=#49454F;
QPalette::ToolTipBase=#E8DEF8; QPalette::BrightText=#FFFFFF; QPalette::Light=#FFFFFF;
QPalette::Midlight=#E7E0EC;  QPalette::Dark=#79747E;
```

即可一次性改掉所有**用默认调色板绘制**的控件（未覆盖的原生控件、富文本默认色），不必逐个写 `color:`。`default.qss` 里 `palette(base)`/`palette(mid)` 已引用 → 链路是活的。
注意：3.5.6 角色表**不含** `ToolTipText`/`Mid`/`Shadow`（常量池未出现），写了大概率不生效。

## 6. `gfx/` 图标包机制（Q3/Q4）

### 6.1 四个 zip 总览

**证据 E-15（`unzip -l` 交叉校验）**

```console
$ for z in countries.zip default.zip default_colored_2014.zip default_mono_2014.zip; do
>   echo "== $z"; unzip -l "$z" | tail -2; done
== countries.zip            114175                     247 files
== default.zip              307719                     231 files
== default_colored_2014.zip 669557                     209 files
== default_mono_2014.zip    642174                     208 files
```

| zip | 磁盘字节 | `unzip -l` 行数* | **真实文件数** | 未压缩合计 | 构成 |
|---|---:|---:|---:|---:|---|
| `countries.zip` | 144,825 | 247 | **247** | 114,175 | 247 PNG，扁平，无目录项 |
| `default.zip` | 331,752 | 231 | **230** | 307,719 | 229 PNG + `emoticons/emoticons.txt`（+1 目录项 `emoticons/`） |
| `default_colored_2014.zip` | 293,648 | 209 | **208** | 669,557 | 206 SVG + `settings.ini` + `emoticons/emoticons.txt`（+1 目录项） |
| `default_mono_2014.zip` | 309,323 | 208 | **207** | 642,174 | 205 SVG + `settings.ini` + `emoticons/emoticons.txt`（+1 目录项） |
| 合计 | 1,079,548 | — | **892** | 1,733,625 | — |

\* `unzip -l` 把 `emoticons/` 目录条目也算 1 行（231/209/208），真实文件数是 230/208/207。CSV 按真实文件计，`default.zip` 恰好 **230 行**（229 PNG + 1 TXT），满足红线。`unzip -t` 四包全部无错（`zipfile.testzip()` 均 `None`）。
条目时间：`default.zip` 集中在 2011-08-25（个别 2012/2015）；colored 2017-05-15；mono 2017-04-26～27；countries 多为 2017-05-29。

### 6.2 三套命名体系

| 体系 | 包 | 目录结构 | 命名 | 尺寸 | 元数据 |
|---|---|---|---|---|---|
| A 旧式 PNG | `default.zip` | `emoticons/` | `16x16_add.png`（`<W>x<H>_<name>.png`） | 固定像素，多尺寸并存 | **无** `settings.ini` |
| B SVG+映射 | colored / mono 2014 | `emoticons/` | `add.svg`（无尺寸前缀） | SVG 声明尺寸（多数 128×128） | `settings.ini` + `[gfxfiles]` 213 条 |
| C 国旗 | `countries.zip` | 扁平 | `<cc>.png`（ISO alpha-2 小写） | 16×11（1 个 16×12） | 无 |

**`settings.ini` 原文（两个 2014 包完全一致，12,249 B）——官方留给你做图标包的说明书：**

```ini
[info]
# Every icon should at least have 32x32 for down scalability
[options]
# Try to load icons from default.zip if not found   [true|false]
FALLBACK=true
# For the case the icon cannot be found ... [0|1|2]
#   0 = no placeholder   1 = empty/transparent   2 = blue bordered placeholder
PLACEHOLDER=2
[gfxfiles]
# Overwrite icons from Qt style. Unused in default style, so Qt will fill these icons automatically.
#MSGBOX_QUESTION = x.svg    #MSGBOX_INFORMATION = x.svg   #MSGBOX_WARNING = x.svg
#MSGBOX_CRITICAL = x.svg    #SAVE = x.svg                 #ARROW_RIGHT = x.svg
#ARROW_LEFT = x.svg         #ARROW_UP = x.svg             #ARROW_DOWN = x.svg
#VERTICAL_EXTENSION_BUTTON = x.svg
3D_SOUND = 3d_sound.svg
ADD = add.svg
...
```

四条关键机制：

1. `FALLBACK=true` → 本包缺图标时**回退 `gfx/default.zip`**（exe 有 `Failed to load X, falling back to Y filename:`、`/default.zip`、`default.zip`、`zip open: default.zip error:`、`countries.zip not found`）。
2. `PLACEHOLDER=2` → 缺图时画**蓝框占位块**（很丑；MD3 包应补全名字或改 0/1）。
3. `[gfxfiles]` 是**逻辑名 → 文件名**映射：客户端按逻辑名（`ADD`、`PLAYER_CHAT`、`CHANNEL_GREEN`…）取图，不关心物理文件名。**这是唯一把逻辑名与文件解耦的机制。**
4. 表里有 **`MSGBOX_*` / `SAVE` / `ARROW_*` / `VERTICAL_EXTENSION_BUTTON` 共 10 个 Qt 原生图标覆盖键**（3.1.5：“Added possibility to overwrite Qt style icons with custom iconpacks”）。默认被 `#` 注释，所以运行时装的是系统风格图标 —— **MD3 包必须打开它们**，否则消息框图标、下拉箭头、树展开箭头还是 Windows 味。

### 6.3 `default.zip` 全量统计（230 文件）

**证据 E-16**

```console
files total 230
{'100x100':1,'16x16':134,'200x200':1,'20x20':2,'24x24':43,'32x32':35,'7x5':2,'8x7':1}
size-combo counts: {('16x16',):99, ('16x16','24x24'):17, ('16x16','24x24','32x32'):13,
  ('16x16','32x32'):5, ('24x24',):13, ('32x32',):16, ('20x20',):2, ('7x5',):2,
  ('8x7',):1, ('100x100','32x32'):1, ('200x200',):1}
non-conforming png: group_100/200/300/500/600.png, warning_external_link.png
170 个带尺寸前缀的逻辑名 + 6 个无前缀 + emoticons = 177 个身份
```

按**真实 IHDR 尺寸**分布（≠文件名前缀）：

| 真实尺寸 | 文件数 | 说明 |
|---|---:|---|
| 16×16 | 135 | 含 4 个表情 PNG；主力尺寸 |
| 24×24 | 41 | 次主力（文件名 `24x24_` 有 43 个，2 个实际 32×32） |
| 32×32 | 37 | 高分屏（文件名 `32x32_` 有 35 个 + 2 个误标 24） |
| 512×512 | 2 | `16x16_sync_enable.png`、`16x16_sync_disable.png`（名字 16，实际 512） |
| 20×20 | 2 | `3d_sound_me/user` |
| 7×5 / 8×7 | 2 / 1 | `up|down_arrow`、`tab_close_button` |
| 100×100 / 200×200 | 1 / 1 | `broken_image`、`loading_image` |
| 16×12 / 14×14 / 16×13 / 8×8 / 128×128 | 3/1/1/1/1 | `message_incoming|info|outgoing`、`moderated`、`music`、`on_whisperlist`、`warning_external_link` |
| 非 PNG | 1 | `emoticons/emoticons.txt`（70 B，4 行 `cool.png = "8)"` 式映射） |

**10 处“文件名尺寸 ≠ 真实尺寸”**（MD3 重绘必须核对）：

```console
16x16_message_incoming.png  16x12     16x16_message_info.png   16x12
16x16_message_outgoing.png  16x12     16x16_moderated.png      14x14
16x16_music.png             16x13     16x16_on_whisperlist.png 8x8
16x16_sync_disable.png      512x512   16x16_sync_enable.png    512x512
24x24_hardware_output_muted.png 32x32 24x24_input_muted_local.png 32x32
```

**三档尺寸覆盖极不均衡（高 DPI 最大障碍）**，170 个逻辑名：

| 尺寸组合 | 图标数 | 占比 |
|---|---:|---:|
| 只有 16×16 | **99** | 58.2% |
| 16+24 | 17 | 10.0% |
| **16+24+32 全有** | **13** | 7.6% |
| 16+32 | 5 | 2.9% |
| 只有 24×24 | 13 | 7.6% |
| 只有 32×32 | 16 | 9.4% |
| 专用尺寸（20/7×5/8×7/100+32/200） | 7 | 4.1% |

**99 个图标只有 16×16** → 200% 缩放下必然糊。官方 settings.ini 注释也承认：“Every icon should at least have 32x32 for down scalability”。**这就是 2014 包改 SVG 的原因，MD3 图标包必须走 SVG。**

### 6.4 2014 SVG 包解剖

**证据 E-17**

```console
default_colored_2014.zip files 208: ext {'svg':206,'txt':1,'ini':1}
  dims {(128,128,'viewBox'):205, ('','',''):2, (512,512,'viewBox'):1}
  emoticons: 11 个（angry/cool/laugh/sad/scream/skeptical/smile/stunned/tongue/twinkle.svg + txt）
default_mono_2014.zip files 207: ext {'svg':205,'txt':1,'ini':1}
  dims {(128,128,'w/h'):171, (112,112,'viewBox'):16, (512,512,'viewBox'):12,
        (128,128,'viewBox'):4, (497,496,'viewBox'):1, (220,220,'w/h'):1, ('','',''):2}
```

- SVG 为 Illustrator 导出的 **SVG Tiny 1.2**（changelog 3.1.5：支持 SVG Tiny 1.2 静态图标、不支持动画）；多数声明 `width="128px" height="128px" viewBox="0 0 128 128"`；12 个只有 `viewBox="0 0 512 512"`（新版重绘，如 `theme.svg`、`browse-addon-online.svg`）。
- `settings.ini` 两包**完全相同**（12,249 B，213 条 `[gfxfiles]`，键集合与值集合一致）。
- **官方自己埋的坑**：`SELECTFOLDER` 与 `STOP` 映射到 `selectfolder.svg`、`stop.svg`，但**两个包里都没有这两个文件** → 运行时靠 `FALLBACK=true` 回退 default.zip 的 PNG。MD3 包必须做“键→文件”一致性自检。
- **孤儿 SVG**（存在但无键引用）：colored 9 个（`channel_groups/channel_subscribed/clear/contact/favorite/select_all/send/subscribe_to_channel/warning_error.svg`），mono 8 个（少 `warning_error.svg`）。
- 表情从 4 个 PNG 扩到 **10 个 SVG**（多 angry/laugh/scream/skeptical/stunned/tongue）。

### 6.5 三包差集（按逻辑身份，不能按原始文件名）

**证据 E-18**

```console
default logical identities: 177   2014 keys: 213   in all three: 166
ONLY IN default.zip (11): 3D_SOUND_USER, ADDON_COLECTION, PERMISSION_CHANNELS,
  PERMISSION_CHANNEL_GROUP, PERMISSION_CLIENT, PERMISSION_SERVER_GROUP,
  REQUEST_TALK_POWER, REQUEST_TALK_POWER_CANCEL, REVOKE_TALKER, SETUP_WIZARD, emoticons
ONLY IN 2014 packs (47): 3D_SOUND_OTHER, ADD_FOLDER, APPLY, BOOKMARK_SET_FOR_ALL,
  CHANNEL_COLLAPSE_SUB, CHANNEL_CREATE_SPACER, CHANNEL_EXPAND_SUB, CLIENT_HIDE,
  CLIENT_SHOW, CLOSE_BUTTON, COMPLAINT_LIST, CONNECT_NEW_TAB, CONTACT, COPY_URL,
  DELETE_AVATAR_OTHER, DISCONNECT_ALL, DOWNLOAD, FILTER_CLEAR, FOLDER, ICONVIEWER,
  INVITE_BUDDY, MAKE_CURRENT_CHANNEL_DEFAULT, MESSAGES, MOVE_CLIENT_TO_OWN_CHANNEL,
  REFRESH, RENAME, SEARCH, SEARCH_CLEAR, SEARCH_HIDE, SORT_BY_NAME, SOUNDPACK,
  SUBSCRIBE_MODE, SUBSCRIBE_TO_CHANNEL_FAMILY, SWITCH_ADVANCED, SWITCH_STANDARD,
  TALK_POWER_CANCEL_REQUEST, TALK_POWER_GRANT, TALK_POWER_GRANT_NEXT,
  TALK_POWER_REQUEST, TALK_POWER_REVOKE, TALK_POWER_REVOKE_ALL_GRANT_NEXT, TOKEN_USE,
  UNSUBSCRIBE_FROM_CHANNEL_FAMILY, UNSUBSCRIBE_MODE, UPLOAD, WHISPER, WHISPERHISTORY
raw-name 交集：default vs colored = 1（229+207）；default vs mono = 1（229+206，仅 emoticons.txt）
```

这 52 个差异是**改名/拼写错误/语义迁移**，不是“多几个图标”：

| default.zip | 2014 包 | 性质 |
|---|---|---|
| `3D_SOUND_USER` | `3D_SOUND_OTHER` | 改名（自己/他人语义纠正） |
| `ADDON_COLECTION` | `ADDON_COLLECTION` | **default.zip 少 1 个 L（拼写错误）** |
| `PERMISSION_CHANNELS` | `PERMISSIONS_CHANNELS` | 单复数 |
| `PERMISSION_CHANNEL_GROUP` | `PERMISSIONS_CHANNEL_GROUPS` | 改名 |
| `PERMISSION_CLIENT` | `PERMISSIONS_CLIENTS` | 改名 |
| `PERMISSION_SERVER_GROUP` | `PERMISSIONS_SERVER_GROUPS` | 改名 |
| `REQUEST_TALK_POWER` | `TALK_POWER_REQUEST` | 改名 |
| `REQUEST_TALK_POWER_CANCEL` | `TALK_POWER_CANCEL_REQUEST` | 改名 |
| `REVOKE_TALKER` | `TALK_POWER_REVOKE`（及 `_ALL_GRANT_NEXT`） | 改名 |
| `SETUP_WIZARD` | `GUISETUP` | 改名 |

**结论：以 `default.zip` 文件名为蓝本做新包会踩坑** —— 11 个旧名在新体系不存在，47 个新逻辑名在旧包没有。**MD3 包必须以 2014 包 `settings.ini` 的 213 条键为权威清单**（这些键就是 QSS/tpl 引用的逻辑名，exe 里也有同名常量表：`PLAYER_CHAT`、`SORT_BY_NAME`、`GROUP_`、`WHISPER`、`BOOKMARK_MANAGER`…）。

### 6.6 `countries.zip` 的特殊性

**证据 E-19**

```console
count 247  dims Counter({(16,11):246, (16,12):1})
bytes min/max/avg: 175 633 462
all lowercase 2-3 letters? True
compress_type: {0: 247}      <-- 全部 stored，未压缩
countries odd one: me.png 16x12
```

1. **不是图标包**：无 `settings.ini`、无 `emoticons/`、无尺寸前缀，纯 ISO 国家码（247 个）。
2. **全部 stored**：客户端按国家码随机读单条目，压缩反而慢；目录 144,825 B ≈ 内容 114,175 B + 头。
3. 尺寸几乎统一 16×11（唯一例外 `me.png` 16×12）。
4. **可被目录覆盖、无需改 zip**。changelog 3.0.7（2012-06-21）：
   > `+ Added possibility to use custom country flag icons: If the folder gfx/customCountries exists, country icons will be loaded from this folder, otherwise as before from gfx/countries. gfx/customCountries won't be overwritten again from updater.`
   
   exe 常量池有 `/customCountries/` 与 `/countries/` 前缀。**MD3 想要圆形/单色国旗只需建 `gfx/customCountries/`** —— 这是唯一被官方承诺不被更新器覆盖的自定义目录。

### 6.7 图标解析与回退链（推断自字面量 + settings.ini，置信度高）

```
逻辑名 PLAYER_CHAT
 ├─ 读当前 IconPack 的 settings.ini [gfxfiles] → 命中取文件名 → zip 内读条目
 │    └─ 未命中 → 旧式规则 <W>x<H>_<lowername>.png / <lowername>.png
 ├─ 本包读不到 且 FALLBACK=true → 回退 gfx/default.zip
 └─ 仍失败 → 按 PLACEHOLDER 画占位（0 无 / 1 透明 / 2 蓝框）
```

**证据 E-20（0xD32Axx–0xD32Cxx，`ZipArchive` 单元）**

```console
d32ae8 ZipArchive            d32af8 /default
d32b18 zip entries from: default.zip filename: 
d32b48 countries.zip not found
d32b60 Failed to load        d32b70 , falling back to     d32b88  filename:
d32b98 settings.ini          d32ba8 gfxfiles   d32bb8 options/PLACEHOLDER  d32bd0 options/FALLBACK
d32be8 [gfxfiles]            d32bf8 [options]  d32c18  reading settings.ini error:
d32c38 100x100_broken_image.png                d32c58 zip open: default.zip error:
d32c78 /default.zip          d32c88 FALLBACK
```

另一套优先级（changelog 3.0.14）：
> `+ Iconpacks can now be provided as a zip file. See gfx/default.zip ... Custom iconpacks are still supported. Icons in extracted folders take priority over zip archives if both exist.`

→ **解压目录优先于 zip**。开发期可用 `gfx/md3/` 目录调试，最后再打 zip（两者并存时目录优先，容易造成“改了 zip 没生效”的幻觉）。

### 6.8 两个磁贴 PNG

```console
gfx/tile_70.png  (70,70)   colortype 2 (RGB 无 alpha)   6,742 B
gfx/tile_150.png (150,150) colortype 2 (RGB 无 alpha)  12,531 B
$ cat ts3client_win64.VisualElementsManifest.xml
<VisualElements ShowNameOnSquare150x150Logo='off' Square150x150Logo='gfx\tile_150.png'
  Square70x70Logo='gfx\tile_70.png' ForegroundText='light' BackgroundColor='#FFFFFF'/>
```

Windows 8/10 开始菜单磁贴，安装时由 manifest 引用；两文件名也在 UTF-16 常量表（`0xc97a30 tile_70.png` 相邻 `tile_150.png`）。MD3 想连磁贴一起换，改这两张 PNG + manifest 背景色即可（只影响安装时）。

### 6.9 CSV 说明

文件 `02-iconpack-inventory.csv`（41,725 B，893 行 = 1 表头 + 892 数据行）

| 字段 | 含义 | 来源 |
|---|---|---|
| `pack` | zip 文件名（含 `.zip`） | 目录清单 |
| `name` | zip 内条目路径（含 `emoticons/` 前缀） | `zipfile.namelist()` |
| `width`/`height` | PNG 读 IHDR；SVG 取根 `<svg>` 的 `width/height`，缺失则取 `viewBox`；txt/ini 留空 | `struct` / 正则 |
| `bytes` | **解压后**字节数（= `unzip -l` 的 Length 列口径） | `ZipInfo.file_size` |

覆盖：`default.zip` **230 行**（红线）、`default_colored_2014.zip` 208、`default_mono_2014.zip` 207、`countries.zip` 247。仅 5 行宽高为空（4 个 `emoticons.txt` + 2 个 `settings.ini`，其中 1 个 txt 在 default.zip）。

## 7. 改造边界与结论（Q5）

### 7.1 能靠 QSS 改的（Qt 5.12 QSS + 本机特性）

| 类别 | 能力 | 选择器示例 |
|---|---|---|
| 颜色 | `color`、`background(-color)`、`rgba()`、`palette(role)` | `QWidget{color:#1C1B1F}`、`QLabel#appNameLabel` |
| 背景图 | `background-image/position/repeat/attachment`、`image`、`border-image`（九宫格） | `QTextEdit#InfoFrame`、`QPushButton` |
| 圆角/边框 | `border`、`border-radius`、`border-width/style/color` | `QFrame{border-radius:16px}` |
| 渐变 | `qlineargradient`/`qradialgradient`/`qconicalgradient` | MD3 tonal 背景 |
| 字体 | `font-family/size/weight/style`、`font:` | `QWidget{font-family:"Roboto";font-size:10pt}` |
| 盒模型 | `padding`、`margin`、`width/height`、`min-*` | 32px 按钮高、16px 边距 |
| 子控件 | `::handle ::item ::tab ::pane ::branch ::indicator ::section ::drop-down ::up-arrow …` | 滚动条/复选框/表头/树箭头自绘 |
| 状态 | `:hover :pressed :checked :selected :disabled :focus :!enabled` | MD3 state layer 用颜色近似 |
| 动态属性 | `QTextEdit#ChatLineEdit[helpTextVisible="true"]` | 官方已在用 |
| 调色板 | `QPalette::Role = value;`（3.5.0） | §5 |
| Qt 属性注入 | `qproperty-<name>: value;` | `rootIsDecorated`、`alternatingRowColors`、`minimumSize`、`toolTip` 等 |

**TS3 专有、可被 QSS 控制的高价值目标**：`QTreeView#ServerTreeView`（服务器树）、`QTextEdit#InfoFrame`、`QTextEdit#ChatTab`、`QTextEdit#ChatLineEdit`、`QStatusBar QLabel`、`QListWidget#localIconsListWidget/#remoteIconsListWidget`、`QTableView#clientsTableView/#banTableView`、`QLabel#bookmarksBanner/#identitiesBanner/#accountLoginBanner/#accountCreateBanner`、`QSplitter::handle#bookmarksLocalRemoteSplitter/#identitiesLocalRemoteSplitter/#profilesLocalRemoteSplitter/#whisperListsLocalRemoteSplitter`、`QLabel#OptionsHeadlineTitleLabel/#OptionsHeadlineDescriptionLabel/#NewsLeftLabel`、`QWidget#HeadlineLabel`、`QLabel#appNameLabel`、自定义类 `ImprovedTabBar/ImprovedTabWidget/ImprovedTabBarCloseButton`（`default_mac.qss` 已在用）、`QToolBar#AddonBrowserToolBar`、`QLabel#directoryLabel`、命名空间类 `com--teamspeak--ui--ServerIntegrationsWidget/IntegrationBubble/ErrorIndicator`。

**改不到 / 受限（Qt QSS 规格，非本产物证据）**：无 `box-shadow`/`text-shadow`（MD3 elevation 只能用 border-image 九宫格或半透明描边伪造）；无 CSS 变量/`calc()`/嵌套/`::before/::after`；无 `transition`/`animation`/`transform`（**MD3 motion、ripple、状态过渡全做不到**）；无 `z-index`/`opacity`（只能 rgba 近似）/多背景叠加；伪状态集合固定（无 `:focus-visible/:active/:first-child`）；富文本侧可用属性更少（`color/font-*/text-decoration/margin/padding/border-*/vertical-align/background-color`），**无 flex/grid，只能 `<table>` 布局**（官方模板即如此）。

### 7.2 必须换图标包 zip 的

| 必须换 | 原因 | 落点 |
|---|---|---|
| 全部 UI 图标（176 逻辑名 / 229 PNG） | 图片资源，QSS 只能改 `image:` 路径不能改图形 | `gfx/md3_icons.zip` |
| Qt 原生对话框图标 `MSGBOX_QUESTION/INFORMATION/WARNING/CRITICAL` | 默认 Qt 风格画，只有 `[gfxfiles]` 覆盖键能替换 | 同上，打开 10 个注释键 |
| 箭头/展开指示 `ARROW_*`、`VERTICAL_EXTENSION_BUTTON` | 同上 | 同上 |
| 状态图标（muted/away/recording/badge/group…） | 运行时按逻辑名取图 | 同上 |
| 表情（`emoticons/`） | 聊天富文本 `<img src>` 取自图标包 | 同上（10 个 SVG） |
| 皮肤自带图（splitter/logo/chatlog） | **不在 gfx zip**，在 `styles/default/` | `styles/md3/` |
| 国旗（可选） | `countries.zip` 或 `gfx/customCountries/` | 建议 customCountries（免改 zip、不被更新覆盖） |
| Windows 磁贴（可选） | `gfx/tile_70/150.png` + manifest | 安装目录 |

### 7.3 完全做不到 / 极难做到

| 部分 | 原因 | 证据 |
|---|---|---|
| **Windows 原生标题栏、窗口边框、系统菜单** | 主窗口用原生 frame，非客户区由 DWM 绘制，QSS 不参与 | 实测 `styles/qwindowsvistastyle.dll`（PE32+ DLL 137,216 B）；exe 有 `windowsvista/windowsxp`；无 frameless 字面量 |
| **Qt 平台样式本身**（下拉箭头、滚动条槽、原生控件基线） | `windowsvista` 风格在 QSS 未覆盖处接管 | 同上 |
| **Addon Browser 整页** | QtWebEngine 页面（HTML/CSS/JS），不走 QSS | exe 有 `QWebEngineView/QWebChannel/:/setup/addons_setup.js/qwebchannel.js/Addons_Browser_Webengine_View/qtwebengine_cache`；磁盘有 `qtwebengine_resources*.pak`、`qtwebengine_locales/` |
| **`html/teamspeak5_intro/index.html`** | 独立 WebEngine 静态页（自带 bootstrap CSS） | 实测 1,769 B + css/js 目录 |
| **托盘/任务栏/Alt-Tab 图标** | 来自 exe `.rsrc` 图标资源（`IDI_ICON1`） | `.rsrc` 节 0x18740 B；UTF-16 串 `IDI_ICON1` |
| **exe 内嵌 Qt 资源** | `:/application/teamspeak_logo_minimal`（关于框 logo）、`:/fonts/teamspeak.ttf`、`:/fonts/teamspeak2020.ttf` | exe 字符串实测，磁盘无对应文件 |
| **安装器/更新器/错误上报器** | 独立 exe（`package_inst.exe`、`update.exe`、`error_report.exe`、`Uninstall.exe.nsis`） | 目录实测 |
| **安装向导/首次启动页** | 皮肤启动后才加载；向导页无专门钩子 | 推断（中置信度；`Loading stylesheet:` 在启动时打印） |
| **动效（ripple/过渡/动画）** | Qt QSS 无 animation/transition | Qt 5.12 QSS 规格 |
| **系统原生文件对话框** | Windows 上 `QFileDialog` 走原生 | Qt 默认行为（推断） |

**特别提醒**：`styles/qwindowsvistastyle.dll` 是可删除/替换的 Qt 样式插件。把 Options→Design→Style 从 “System default / windowsvista” 切到 **Fusion**（内建于 `Qt5Widgets.dll`）会让原生绘制变“干净”，QSS 圆角/颜色在更多控件生效 —— 这是 MD3 能否“彻底”的关键操作之一（建议，需实测截图）。

### 7.4 推荐的 MD3 皮肤包结构

```
<install>/
├─ styles/
│  ├─ md3.qss                     ← 从 default.qss 起手（加 QPalette 段 + 全局控件段）
│  ├─ md3_chat.qss                ← 从 default_chat.qss 起手（57 class 全改 MD3 色板）
│  └─ md3/
│     ├─ splitter.png             (80×20)
│     ├─ splitter_vertical.png    (20×80)   ← 官方未启用，可启用
│     ├─ logo-128x128.png         (**128×190**，注意真实高度)
│     ├─ chatlog-128x96.png       (128×96)
│     └─ channelinfo.tpl clientinfo.tpl serverinfo.tpl
│        tree_tooltip_channel.tpl tree_tooltip_client.tpl
├─ gfx/
│  ├─ md3_icons.zip               ← SVG 包（settings.ini 照抄 2014 包，213 键全填）
│  └─ customCountries/            ← 可选：MD3 风格国旗
└─ settings.db（用户配置）：QtStyle = md3 或 md3.qss（两种都试）；IconPack = md3_icons
```

### 7.5 最容易做出 MD3 效果的 3 个切入点

1. **`styles/md3.qss` + `QPalette::Role` 全局换色（改一个文件，观感变化最大）**
   复制 `default.qss` → `md3.qss`，开头加 §5 的 17 行 `QPalette::` 覆盖；再追加全局段：
   `QWidget{font-family:"Roboto";}`、`QPushButton{border-radius:20px;}`、
   `QLineEdit,QTextEdit{border-radius:12px;border:1px solid #79747E;}`、
   `QTabBar::tab{border-radius:12px 12px 0 0;}`、`QMenu{background:#F3EDF7;border-radius:12px;}`、
   `QScrollBar::handle{border-radius:4px;}`。
   为什么最容易：24 条原生规则 + 25 个 ID 已标好“该改哪”；QPalette 一动，连没写 QSS 的控件也变；完全不碰 exe/zip。
2. **`md3_chat.qss`（57 个 class，纯 CSS，自由度最高）**
   聊天/信息面板是 Qt 富文本 HTML，官方就是靠 `.TextMessage_*` 上色。改 `p{...}`、`.InfoFrame_Table td{...}`、`.TextMessage_UserLink`、`.TextMessage_Time` 就能把服务器信息面板和聊天区变成“卡片 + 柔和分隔 + 胶囊链接”；配合 `.tpl` 的 `<table>` 结构与 `%%?VAR%%` 条件行控制留白。**不依赖任何图标/二进制改动**。注意模板里不能再写 `<style>`（3.3.0 起废弃）。
3. **SVG 图标包（一次性去掉 Windows 味）**
   复制 `default_mono_2014.zip` 的 `settings.ini`（213 键）做骨架；Material Symbols 批量导出 24/32 SVG 并按 `[gfxfiles]` 键名命名；**打开 10 个被注释的 Qt 图标覆盖键**（官方专留的口子）；`PLACEHOLDER=0`；打 zip 丢 `gfx/`，Options→Design→Icon Pack 选中，重启。

### 7.6 风险清单

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | QSS 半失败/语法错（少 `}` 会让后续规则全丢） | 皮肤整体失效 | 改前备份；小步 diff；只用官方出现过的属性 |
| R2 | `md3.qss` 不被下拉框识别（若 addon 库驱动） | 无法选中 | §3.5 路径 B（覆盖 default.qss）或 C（写 settings.db） |
| R3 | 图标名漂移（照 default.zip 命名 → 11+47 个不匹配） | 大量占位蓝框/风格混杂 | 以 2014 包 213 键为权威；做“键→文件”自检 |
| R4 | `FALLBACK=true` 掩盖缺失 | 以为换了图标，实际仍是 16×16 PNG，高分屏糊 | 开发期设 `FALLBACK=false` 让缺失暴露 |
| R5 | 目录优先于 zip | 改了 zip 没生效（`gfx/md3/` 目录还在） | 发布只留 zip；调试期知晓优先级 |
| R6 | 升级/修复安装覆盖 `styles/`、`gfx/` | 皮肤被还原、图标包丢失 | 只有 `gfx/customCountries/` 承诺不被覆盖；其余需打包分发+更新后重装 |
| R7 | `logo-128x128.png` 实为 128×190（另有 10 个 PNG 名字谎报尺寸） | 拉伸/留白 | 按真实尺寸出图（CSV 有 IHDR 真值） |
| R8 | MD3 动效无法实现 | 观感“像 MD3 但不动” | 用静态 tonal 层级+圆角+字体层级；文档说明 |
| R9 | 原生标题栏不配合 | 顶部一圈 Windows 灰蓝边框 | 切 Qt 样式到 Fusion；不建议注入 frameless（破坏窗口/多屏/DPI） |
| R10 | 字体依赖：`'TeamSpeak 2020'` 是 exe 内嵌字体，QSS 不能内嵌字体 | Roboto 不生效则回退 | 随包提供字体安装说明或选系统字体 |
| R11 | `QPalette::` 写错角色名（`ToolTipText/Mid/Shadow` 不在本机表） | 静默失效 | 只用 §5 实测 16 个角色 |
| R12 | QtWebEngine 页面不跟随皮肤 | Addon Browser 明显“Web 味” | 接受或外部 CSS 注入（超范围） |
| R13 | `[gfxfiles]` 键大小写/空格敏感性未验证 | 映射失效 | 照抄官方写法（大写键+等号两侧空格），改完对比 |
| R14 | 改配置需重启（图标包明确 “next restart”） | 以为没生效 | 改完必须重启再验证 |

## 8. 证据不足 / 待实测清单

| # | 未确认事项 | 现状 | 建议验证 |
|---|---|---|---|
| U1 | `QtStyle` 存 `md3` 还是 `md3.qss` | exe 同时有带扩展名的 `default.qss/bluesky.qss` 与裸词干 `default`；IconPack 侧更倾向裸词干 | 改一次皮肤后 dump `settings.db` 看 `QtStyle` 行；两种都试 |
| U2 | 下拉框是扫描目录还是读 addon 库 | 无 `*.qss` 通配符；UI 文案支持“目录”说，addon 表支持“库”说 | §3.5 最小实验（放文件→看下拉框/日志） |
| U3 | `_win/_linux/_mac` 派生文件在 Windows 上是否加载 | 后缀字面量与磁盘文件都在；changelog 只明说 `_vista` | 造 3 个空派生文件，其中一个写显眼规则看是否生效 |
| U4 | `[gfxfiles]` 键大小写敏感性、值能否带子目录 | 官方值都是扁平小写文件名 | 做含 `sub/x.svg` 的测试包 |
| U5 | `.svgz` 是否真被接受（UTF-16 有 `svgz`） | 未实测 | 放一个 `.svgz` 图标测试 |
| U6 | 删除 `qwindowsvistastyle.dll` 的后果 | 未实测（Qt 会回退其它 QStyle） | 备份后重命名，观察是否崩溃/回退 Fusion |
| U7 | 皮肤切换是否必须重启 | 有 `Loading stylesheet:` 启动日志；图标包明确要求重启 | 改完直接看主窗口是否变化 |
| U8 | 启动时是否清理 `styles/` 未知文件 | addon 管理会写 addons.ini，未见清理逻辑字符串 | 放文件后重启两次，检查文件是否仍在 |

## 附录 A. 证据命令索引

```console
find styles -type f -printf '%s\t%p\n' | sort -k2
wc -l styles/*.qss styles/default/*.tpl
unzip -l gfx/default.zip | tail -2 ; unzip -t gfx/default.zip
python3 -c "import struct;d=open('styles/default/logo-128x128.png','rb').read(33);print(struct.unpack('>II',d[16:24]))"
strings -n 4 ts3client_win64.exe > exe.ascii.txt
strings -e l -n 4 ts3client_win64.exe > exe.utf16.txt
strings -t x -n 4 ts3client_win64.exe | grep -E ' (styles|\.qss|_chat|_vista|default\.qss)$'
# QSS 选择器统计 / 图标包全量+差集：Python 剥注释切规则、zipfile + IHDR + settings.ini 解析（脚本见 §2.3/§6.3/§6.5 证据块）
```

## 附录 B. 关键 exe 字面量速查（偏移/RVA 均实测，全部在 `.rdata`）

| 字符串 | 文件偏移 | RVA | 用途 |
|---|---:|---:|---|
| `translations/../styles` | 0xC81158 | 0xC81D58 | 样式安装根目录 |
| `styles` / `.qss` / `.tpl` / `style` | 0xC81170/78/80/88 | 0xC81D70… | 分类与扩展名 |
| `bluesky.qss` | 0xC81770 | 0xC82370 | 第三方示例皮肤名 |
| `_chat` / `_mac` / `_linux` | 0xC81FC8/D0/D8 | 0xC82BC8… | 派生样式后缀（8 字节等差） |
| `default.qss` | 0xC82100 | 0xC82D00 | 默认样式文件名 |
| `_vista` / `_win` | 0xC821AC/B4 | 0xC82DAC… | 平台派生后缀 |
| `_vista.qss` | 0xC8D1F0 | 0xC8DDF0 | 平台派生完整名（加载器） |
| `QPalette::([A-Za-z]+)\s*=\s*([^;]+);` | 0xC8D200 | 0xC8DE00 | 调色板覆盖解析 |
| `windowsvista`/`windowsxp`/`linux` | 0xC8D290/A0/2C | 0xC8DE90… | 平台判定 |
| `styles:`/`gfx:`/`countries:`/`emoticons:` | 0xC9A998/944/938/9A0 | 0xC9B598… | 图片 provider scheme |
| `iconpath`/`16x16_%1.png`/`%1x%2_%3.png`/`\?size=(\d+)x(\d+)` | 0xC9A8B8/8F8/9B0/970 | 0xC9B4B8… | 图标解析与缩放 |
| `settings.ini`/`[gfxfiles]`/`[options]`/`FALLBACK`/`PLACEHOLDER` | 0xD32B98/BE8/BF8/C88/BB8 | 0xD33798… | 图标包元数据 |
| `/default.zip`/`Failed to load `/`, falling back to ` | 0xD32C78/B60/B70 | 0xD33878… | 回退链 |
| `Loading stylesheet: `/`Setting style to: ` | 0xCD7508/74A0 | 0xCD8108/0xCD80A0 | 样式加载/切换日志 |
| `TeamSpeak will reset to the default style on the next restart.` | 0xCD74C8 | 0xCD80C8 | 无效样式重置提示 |
| `Select stylesheet from "styles" directory` | 0xCD6D20 | 0xCD7920 | 下拉框提示（目录说核心证据） |
| `QtStyle`/`IconPack`/`Design` | 0xCD7290/298/39C | 0xCD7E90… | 配置 key / 页面 |
| UTF-16 `default_mono_2014` + `IconPack` | 0xCA0B38 / 0xCA0B60 | 0xCA1738 / 0xCA1760 | IconPack 默认值 |
| UTF-16 `TeamSpeak Colored/Origin/Mono` + `*.zip` | 0xC81BE8…0xC82180 | 0xC827E8…0xC82D80 | 内置图标包显示名 |