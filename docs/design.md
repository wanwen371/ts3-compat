# 流利设计 — 风格参考

> 光、深度、动效、材质、尺度：五个元素叠出一套跨平台的界面语汇。

**Theme:** light

Fluent 是微软那套「材质 + 光」的系统：界面不是平的，而是由亚克力面板、极小的圆角与一层极轻的深度构成。它只用一支主蓝（#0078d4），其余颜色只在状态里出现（黄、红、绿）。圆角刻意做得克制——按钮 2px、卡片 8px、输入 2px，这是它与圆角化风格的区分点。每个可交互元素都必须有 2px 的焦点环并带 offset，这是无障碍底线而非装饰。动效 150ms 到 250ms，强调「响应」而非「表演」。

## Colors

| Name | Value | Token | Role |
|---|---|---|---|
| Fluent Blue | `#0078d4` | `--color-fluent-blue` | 主行动、链接与焦点环。微软体系里唯一的品牌色，不做渐变。 |
| Deep Blue | `#106ebe` | `--color-deep-blue` | hover 态与按下态。同色相压暗一档，保持体积感。 |
| Acrylic White | `rgba(255,255,255,0.70)` | `--color-acrylic` | 卡片与面板填充。必须配 20px 模糊，否则失去亚克力质感。 |
| Caution Yellow | `#ffb900` | `--color-caution` | 警告与需要注意的状态，只用于图标与徽标。 |
| Error Red | `#e81123` | `--color-error` | 错误与删除。出现即表示不可撤销。 |
| Success Green | `#00cc6a` | `--color-success` | 成功与完成，多用于对勾与状态条。 |

## Typography

### Segoe UI Variable — 全站唯一字体，字重只用 400 与 600。层级靠字号与留白，不靠字重堆叠。

- **Substitute:** -apple-system, 'Segoe UI', system-ui, sans-serif
- **Weights:** 400, 600, 700
- **Sizes:** 12, 14, 16, 20, 28, 40, 68
- **Line height:** 1.1 (display), 1.25 (headings), 1.55 (body)
- **Letter spacing:** -0.01em on display, 0.02em on uppercase labels

### Type Scale

| Role | Family | Weight | Size | Line Height | Letter Spacing | Token |
|---|---|---|---|---|---|---|
| display | — | 600 | 68px | 1.1 | -0.01em | `--text-display` |
| heading-lg | — | 600 | 40px | 1.15 | — | `--text-heading-lg` |
| heading | — | 600 | 28px | 1.2 | — | `--text-heading` |
| subheading | — | 600 | 20px | 1.35 | — | `--text-subheading` |
| body-lg | — | 400 | 16px | 1.55 | — | `--text-body-lg` |
| body | — | 400 | 14px | 1.55 | — | `--text-body` |
| label | — | 600 | 12px | 1.4 | 0.02em | `--text-label` |

## Spacing & Layout

**Base unit:** 4px
**Density:** comfortable

### Spacing Scale

| Name | Value | Token |
|---|---|---|
| 4 | 4px | `--spacing-4` |
| 8 | 8px | `--spacing-8` |
| 12 | 12px | `--spacing-12` |
| 16 | 16px | `--spacing-16` |
| 24 | 24px | `--spacing-24` |
| 32 | 32px | `--spacing-32` |
| 48 | 48px | `--spacing-48` |
| 64 | 64px | `--spacing-64` |
| 96 | 96px | `--spacing-96` |

### Border Radius

| Element | Value |
|---|---|
| cards | 8px |
| buttons | 2px |
| inputs | 2px |
| pills | 999px |

- **Page max-width:** 1200px
- **Section gap:** 96px
- **Card padding:** 24px
- **Element gap:** 12px

## Components

### Fluent Button

**Role:** 主行动按钮

Fluent 蓝填充、白字、2px 圆角、1px 同色描边。字级 14px、字重 600、padding 10px 24px，阴影 0 2px 4px 蓝 30%。hover 时填充转深蓝、上浮 2px、阴影扩到 0 4px 8px 蓝 40%；按下缩放 0.97、位移归零、阴影移除。焦点环为 2px 蓝加 2px offset。过渡 150ms ease-out。

- **Sizes:** padding 10px 24px; label 14px
- **States:** hover: lift 2px, deeper fill; active: scale 0.97, no shadow; focus: 2px ring + offset

### Acrylic Card

**Role:** 内容卡与设置面板

70% 白填充、20px 模糊、1px 白 30% 描边、8px 圆角、内边距 24px，双层阴影（0 2px 4px 4% 与 0 8px 16px 8%）。图标块 48px 见方、主蓝填充、8px 圆角。hover 时填充升到 85%、描边到 50%、上浮 4px、阴影升到 16px 32px 档。过渡 200ms ease-out。

- **States:** hover: fill 70%→85%, lift 4px

### Fluent Input

**Role:** 表单与搜索

白底、1px #d1d1d1 描边、2px 圆角、padding 8px 12px、14px 字。下方始终预留 1px 的强调线空间。聚焦时描边转 Fluent 蓝、强调线变 2px 并加 2px offset 焦点环，不改变盒子尺寸。

### Acrylic Flyout

**Role:** 下拉、菜单与通知浮层

85% 白填充、30px 模糊、1px 白 40% 描边、8px 圆角、内边距 8px，阴影 0 8px 24px 12%。菜单项高 36px、圆角 4px、hover 白 50% 填充并加左侧 3px 主蓝指示条。

## Do's and Don'ts

### Do

- 只用一支主蓝，其余颜色只作为状态
- 圆角克制：按钮 2px、卡片 8px
- 焦点环必须 2px 且带 offset
- 卡片用亚克力填充加模糊与描边
- 动效 150ms 到 250ms，强调响应
- 所有间距对齐 4px 网格

### Don't

- 不要用大圆角，会失去 Fluent 的硬朗
- 不要把黄红绿当成装饰色
- 不要省掉焦点环
- 不要用玻璃卡片却不加模糊
- 不要用超过 250ms 的动效
- 不要用纯黑文字，用深灰

## Surfaces

| Level | Name | Value | Purpose |
|---|---|---|---|
| 0 | Page | `#f3f2f1` | 页面底色 |
| 1 | Acrylic | `rgba(255,255,255,0.70)` | 卡片与面板 |
| 2 | Solid White | `#ffffff` | 弹层与对话框 |

## Elevation

- **Card:** `0 2px 4px rgba(0,0,0,0.04), 0 8px 16px rgba(0,0,0,0.08)`
- **Card hover:** `0 4px 8px rgba(0,0,0,0.06), 0 16px 32px rgba(0,0,0,0.14)`
- **Focus ring:** `0 0 0 2px #ffffff, 0 0 0 4px #0078d4`

## Imagery

产品截图、系统图标与抽象几何。允许大面积的柔和光斑作为 hero 背景。图标必须是线性 1.5px 描边，与界面同一套几何语言。不使用写实摄影与装饰插画。

## Layout

上限 1200px、12 栏、容器内边距 24px，区块间距 96px。hero 可居中或左文右图。设置类页面用左侧 280px 导航栏加右侧单栏表单，表单宽度不超过 640px。所有元素对齐 4px 基线网格。

## Agent Prompt Guide

### Implementation Contract

- 以用户请求中的页面、用户任务和真实内容为依据，只实施指定范围；标明缺失的业务信息，不编造数据或能力。
- 先检查现有项目、技术栈与组件；沿用项目结构、路由和依赖，复用已有组件，不重建未要求的页面或功能。
- 沿用项目断点，调整窄屏与桌面的网格和留白；保留信息层级，避免意外横向溢出。
- 对本次涉及的交互，处理键盘焦点与减少动态效果；补齐适用的禁用、加载、空内容与错误状态。
- 完成后按项目现有脚本检查，仅报告实际运行的测试与视觉检查，并列出未验证项。

QUICK COLOR REFERENCE:

- text: `#201f1e`
- background: `#f3f2f1`
- card: `rgba(255,255,255,0.70)`
- primary: `#0078d4`
- muted: `#605e5c`
- border: `#d1d1d1`

EXAMPLE COMPONENT PROMPTS:

1. 做一个 Fluent 卡片：背景 rgba(255,255,255,0.7)、backdrop-filter blur(20px)、1px rgba(255,255,255,0.3) 描边、8px 圆角、内边距 24px，阴影 0 2px 4px rgba(0,0,0,0.04) 与 0 8px 16px rgba(0,0,0,0.08)。左上 48px 主蓝图标块（8px 圆角），标题 20px/600 #201f1e。hover 时背景升到 85%、上浮 4px、阴影升到 0 16px 32px。页面底色 #f3f2f1。

## Similar Brands

- **macOS Vibrancy** — 同样用系统材质分层，但那边是暗色与衬线标题
- **Corporate Clean** — 同为企业级，但 Fluent 有明确材质与焦点纪律

## Quick Start

```css

:root {
  /* Colors */
  --color-fluent-blue: #0078d4;
  --color-deep-blue: #106ebe;
  --color-acrylic: rgba(255,255,255,0.70);
  --color-caution: #ffb900;
  --color-error: #e81123;
  --color-success: #00cc6a;

  /* Typography — Font Families */
  --font-sans: 'Segoe UI Variable', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-display: 68px;
  --leading-display: 1.1;
  --tracking-display: -0.01em;
  --text-heading-lg: 40px;
  --leading-heading-lg: 1.15;
  --text-heading: 28px;
  --leading-heading: 1.2;
  --text-subheading: 20px;
  --leading-subheading: 1.35;
  --text-body-lg: 16px;
  --leading-body-lg: 1.55;
  --text-body: 14px;
  --leading-body: 1.55;
  --text-label: 12px;
  --leading-label: 1.4;
  --tracking-label: 0.02em;

  /* Typography — Weights */
  --font-weight-regular: 400;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* Spacing */
  --spacing-unit: 4px;
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-24: 24px;
  --spacing-32: 32px;
  --spacing-48: 48px;
  --spacing-64: 64px;
  --spacing-96: 96px;

  /* Layout */
  --page-max-width: 1200px;
  --section-gap: 96px;
  --card-padding: 24px;
  --element-gap: 12px;
  --density: comfortable;

  /* Border Radius */
  --radius-cards: 8px;
  --radius-buttons: 2px;
  --radius-inputs: 2px;
  --radius-pills: 999px;

  /* Surfaces */
  --surface-page: #f3f2f1;
  --surface-acrylic: rgba(255,255,255,0.70);
  --surface-solid-white: #ffffff;
}

```
