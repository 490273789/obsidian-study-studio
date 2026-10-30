---
name: Study Studio
description: 安静的学习工作台：克制、清晰、紧凑，让阅读内容优先。
colors:
    primary: "#00b8c4"
    primary-hover: "#00a0ab"
    primary-text: color-mix(in srgb, rgb(var(--fc-black-rgb)) 75%, var(--fc-primary))
    cyan: var(--interactive-accent)
    danger: var(--fc-red)
    lime: var(--color-green)
    amber: var(--color-yellow)
    text: var(--text-normal)
    muted: var(--text-muted)
    faint: var(--text-faint)
    surface-canvas: var(--background-secondary)
    surface-section: color-mix(in srgb, var(--fc-bg-panel) 94%, var(--text-normal) 6%)
    surface-card: color-mix(in srgb, var(--background-primary) 97%, var(--text-normal) 3%)
    surface-raised: color-mix(in srgb, var(--background-primary) 82%, var(--text-normal) 18%)
    surface-control: color-mix(in srgb, var(--fc-surface-card) 94%, var(--fc-text))
    surface-hover: var(--background-modifier-hover)
    surface-selected: var(--background-modifier-active-hover)
    line: color-mix(in srgb, var(--fc-surface-card) 88%, var(--fc-text))
    line-soft: color-mix(in srgb, var(--fc-surface-card) 92%, var(--fc-text))
    line-strong: color-mix(in srgb, var(--fc-surface-card) 82%, var(--fc-text))
    input-bg: color-mix( in srgb, var(--background-primary) 85%, var(--background-secondary) 15% )
typography:
    display:
        fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace'
        fontSize: 28px
        fontWeight: 600
        lineHeight: 1
        letterSpacing: -0.01em
        fontFeature: '"tnum"'
    headline:
        fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace'
        fontSize: 24px
        fontWeight: 600
        lineHeight: 1
    title:
        fontFamily: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
        fontSize: 15px
        fontWeight: 600
        lineHeight: 1.5
    body:
        fontFamily: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
        fontSize: 14px
        fontWeight: 400
        lineHeight: 1.5
    reading:
        fontFamily: '"Songti SC", STSong, "Noto Serif CJK SC", Georgia, serif'
        fontSize: 18px
        fontWeight: 400
        lineHeight: 1.6
    label:
        fontFamily: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
        fontSize: 13px
        fontWeight: 600
        lineHeight: 1.2
    caption:
        fontFamily: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
        fontSize: 11px
        fontWeight: 400
        lineHeight: 1.5
    micro:
        fontFamily: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
        fontSize: 10px
        fontWeight: 600
        lineHeight: 1.2
rounded:
    xs: 2px
    sm: 4px
    md: 6px
    lg: 8px
    pill: 999px
spacing:
    half: 2px
    "1": 4px
    "2": 6px
    "3": 8px
    "4": 12px
    "5": 14px
    "6": 16px
    "7": 20px
    "8": 24px
components:
    button-primary:
        backgroundColor: "{colors.primary}"
        textColor: "{colors.primary-text}"
        typography: "{typography.label}"
        rounded: "{rounded.md}"
        padding: 6px 12px
    button-primary-hover:
        backgroundColor: "{colors.primary-hover}"
    button-secondary:
        backgroundColor: color-mix(in srgb, var(--fc-primary) 12%, var(--fc-surface-card))
        textColor: var(--fc-button-ink)
        typography: "{typography.label}"
        rounded: "{rounded.md}"
        padding: 6px 12px
    button-neutral:
        backgroundColor: color-mix(in srgb, var(--fc-surface-card) 94%, var(--fc-text))
        textColor: "{colors.text}"
        typography: "{typography.label}"
        rounded: "{rounded.md}"
        padding: 6px 12px
    button-outline:
        backgroundColor: transparent
        textColor: "{colors.text}"
        typography: "{typography.label}"
        rounded: "{rounded.md}"
        padding: 6px 12px
    button-ghost:
        backgroundColor: transparent
        textColor: "{colors.muted}"
        typography: "{typography.label}"
        rounded: "{rounded.md}"
        padding: 6px 12px
    button-danger:
        backgroundColor: color-mix(in srgb, var(--fc-danger) 9%, var(--fc-surface-card))
        textColor: var(--fc-button-ink)
        typography: "{typography.label}"
        rounded: "{rounded.md}"
        padding: 6px 12px
    input:
        backgroundColor: "{colors.input-bg}"
        textColor: "{colors.text}"
        typography: "{typography.body}"
        rounded: "{rounded.sm}"
        padding: 6px 8px
    settings-navigation:
        textColor: "{colors.muted}"
        rounded: "{rounded.md}"
        padding: 6px 14px
    segmented-option:
        textColor: "{colors.muted}"
        rounded: "{rounded.sm}"
        padding: 0px 8px
    panel:
        backgroundColor: "{colors.surface-section}"
        textColor: "{colors.text}"
        rounded: "{rounded.md}"
---

# Design System: Study Studio

## Overview

**Creative North Star: "安静的学习工作台"**

克制、清晰、紧凑；通过文字层级、细边界和轻微表面差异组织信息，让学习内容优先。整体气质柔和而安静：弱化容器存在感，让阅读内容优先。

以细微的表面层次表达分组和交互关系。画布、区块、内容容器与浮层共享 Obsidian 的主题环境；清透青为主要操作建立明确落点。阴影主要帮助识别菜单和弹窗的位置，同时保留设置选中项、滑块和媒体区域中已存在的局部层次。

**Key Characteristics:**

- 内容和阅读优先，工具反馈轻微而明确。
- 中性表面随宿主主题变化，固定主色与宿主强调色各有用途。
- 系统无衬线组织界面，衬线呈现卡片 Markdown，等宽字体表达计数与输入练习。
- 按工作区分栏的实际宽度调整布局，保留紧凑的信息结构。

本文记录当前实现及本次确认的描述语言。YAML 保存可机器读取的设计值；源码仍是实现权威，改动令牌后应同步更新本记录。动态颜色保留 CSS 变量和混色表达式，必须在具备 Obsidian 主题及插件令牌作用域的环境内解析，不能据此生成一套固定亮暗色板。

来源：`src/core/styles/base.scss`、`layout.scss`、`patterns.scss`、`responsive.scss`、`settings.scss`、共享基元样式，以及卡片 Markdown、视频播放器等局部样式。本轮 Obsidian 屏幕采集失败，未完成实机视觉核对；仓库内未发现适合本轮验证的已提交界面截图。临时 PDF 截图不作为界面依据。

## Colors

中性底色随主题变化，清透青强调行动，完成、风险和等待等状态保留各自语义。

### Primary

- **清透青**（`colors.primary`）：固定主色，用于实色主按钮、状态轨道、进度及部分标题细节；悬停采用对应的更深主色。
- **主题强调色**（`colors.cyan`）：实际来自 Obsidian 的交互强调色，名称中的 cyan 不保证其最终色相。输入焦点、部分选中态及轻染背景沿用这一来源。
- **主操作墨色**（`colors.primary-text`）：深色与主色混合的按钮文字，不是固定白字。

### Secondary

- **完成绿**（`colors.lime`）：完成、成功及相应进度状态。
- **等待黄**（`colors.amber`）：等待、提醒等已有状态。
- **危险红**（`colors.danger`）：删除、错误与危险操作；来自宿主红色令牌。

这些是辅助状态色，不是第二套品牌配色。选中、错误和完成信息应保留文本或可访问语义，不能仅靠颜色解释。

### Neutral

- **画布 / 区块 / 卡片 / 浮层 / 控件**：对应 frontmatter 中的 `surface-*`，通过宿主背景与文字的轻微混色形成层次。
- **正文 / 次要 / 弱提示**：对应 `text`、`muted`、`faint`，分别承担主要内容、辅助说明和更弱提示。
- **细分隔 / 普通边界 / 强边界**：对应 `line-soft`、`line`、`line-strong`，区分区域及可操作轮廓。

**The Theme Boundary Rule.** 固定主色与宿主交互强调色是两个来源。保留二者的现有职责，不能把清透青替换为宿主强调色，也不能把所有宿主色冻结成固定色板。

## Typography

**Display Font:** 数据等宽字体栈，计数使用等宽数字。  
**Body Font:** 界面使用系统无衬线字体栈；卡片 Markdown 使用中文衬线字体栈。  
**Label/Mono Font:** 控件沿用界面字体；练习输入、时间及部分计数使用数据等宽字体。完整字体栈见 frontmatter。

### Hierarchy

| 角色     | 源码令牌或入口         | 用途                                                             |
| -------- | ---------------------- | ---------------------------------------------------------------- |
| display  | font-focus             | 页面主要数字；设置页等具体视图可降为 headline                    |
| headline | font-hero              | 较紧凑的主要计数                                                 |
| title    | font-lg                | 通用标题及分组名称                                               |
| body     | font-md                | 界面正文、表单文字                                               |
| reading  | font-xl + font-reading | 卡片 Markdown；手机规则降为 body 尺寸，保留阅读行距              |
| label    | font-sm                | 默认按钮和操作说明                                               |
| caption  | font-xs                | 辅助信息；小号按钮使用此字号但保留按钮字重                       |
| micro    | font-2xs               | 快捷键及微型标记；部分现有计数说明也使用它，不将此特例推广到正文 |

字号不是固定比例的放大序列。当前源码中没有独立的 font-display 令牌，也没有旧说明所提及的全局 20px / 32px 字号。frontmatter 的角色名用于记录已有用途，不要求重命名生产令牌。

**The Reading First Rule.** 通过字体、行距和字重建立阅读层级；不能为了收纳更多控件而普遍压缩正文。微型字号只用于已有的紧凑提示，不作为普通说明文字的默认值。

## Layout

页面外壳铺满 Obsidian 工作区分栏，标题栏横向铺开，正文在自身区域滚动并居中限宽。共享内容最大宽度为（1024px），视图可以局部覆盖；不能把某个媒体页面的宽度变成全局默认。

间距采用 frontmatter 的已有 scale，主刻度到 space-8 为止；不补造旧说明中的 space-9 / space-10。默认页面区块间距为 space-4，面板头尾使用较紧凑的间距，阅读与内容容器按所属组件配置。

共享宽度边界为手机（640px）和平板（1024px），同时有视口和具名容器查询：窄桌面分栏也会重排。平板重排行动作区，手机进一步堆叠主要信息区和收紧外边距；表单仍使用 body 字号，底部保留安全区域。

控件的桌面尺寸基准为 small（30px）、medium（36px）、large（42px）；手机视口规则对应（36px / 40px / 44px）。这些是最小高度或组件基准，文本按钮可按内容增高，图标按钮按所选尺寸保持方形。触摸目标至少（40 × 40px）是项目要求，当前粗指针规则分散在具体组件中，不能声称全部共享按钮已满足。

播放器当前存在独立的（1050px）并排布局容器边界及更大的页面宽度，属于局部实现记录，不是新增共享断点。

## Elevation & Depth

**The Quiet Depth Rule.** 常规内容先用表面差异、边界和留白组织；阴影沿用已有浮层与局部控件的用途，不扩散为每个容器的装饰。

主要层次来自中性表面的细微差异及边框。常规共享按钮、内容面板和列表保持轻量；菜单与弹窗使用已有 popover / overlay 阴影，亮色主题降低阴影浓度。

### Shadow Vocabulary

- **细微抬升**（shadow-sm）：设置选中导航、部分输入组合和控件的局部层次。
- **控件体积**（shadow-card）：当前主要见于滑块等控件，名称不等于所有内容卡片都应使用。
- **菜单浮层**（shadow-popover）：提示临时菜单离开内容流。
- **对话浮层**（shadow-overlay）：建立弹窗与背后工作区的层次关系。

准确阴影值及亮色变体保存在配套 sidecar 的 `extensions.shadows`；这些扩展不放入 frontmatter。播放器还存在宿主 shadow-s，保留其局部用途。

交互时长主要使用 quick / base / page，弹窗另有自身进入时长；准确值及缓动在 sidecar。按钮按下有轻微下移，列表行悬停有轻微上移。减少动态效果规则压缩或取消相关过渡；不把轻微反馈扩大成持续装饰动画。

## Shapes

整体使用轻柔的小圆角矩形，具体数值以 frontmatter 的 rounded scale 为准。默认按钮与普通面板采用 md，输入框和菜单外壳采用 sm，微型元素采用 xs；部分主要信息块使用 lg，胶囊仅用于已有进度或标记用途。

普通边界为（1px），列表状态轨道为（3px）。共享弹窗当前使用 md；不能根据旧说明把它记录为统一 lg。视频区域当前有（14px）圆角等局部尺寸，不进入共享圆角刻度。

## Components

### Buttons

柔和而安静，通过底色和边界明确操作关系。共享按钮默认 neutral，默认尺寸 medium；variant、size 和 preset 可组合。

| 变体      | 默认表现                     | 悬停与状态                         |
| --------- | ---------------------------- | ---------------------------------- |
| primary   | 清透青实色背景、深色混合文字 | 主色加深；选中态保留实色主操作关系 |
| secondary | 主色轻染底和描边             | 染色及边界增强                     |
| neutral   | 中性底色与清楚的细边界       | 表面和边界略增强                   |
| outline   | 透明底、中性描边             | 出现宿主悬停表面                   |
| ghost     | 透明底和边框、次要文字       | 出现表面与边界，文字变清楚         |
| danger    | 危险红轻染底和边界           | 危险色染色及边界增强               |

默认内边距与圆角见 frontmatter；small / large、图标、显示答案及评分等预设各有既有尺寸。选中态通过 `active` 以及 ARIA 状态对应的视觉规则表达；禁用透明度为（0.45），禁止按下位移。纯图标按钮需要可访问名称。

**实现差异：** 共享按钮的 focus-visible 描边规则目前被注释；全局规则主要改变焦点边框，焦点 mixin 本身移除 outline 和阴影。可见键盘焦点是项目要求，但现状不能描述为已有完整统一焦点环。此处记录差异，不在 document 流程中修改实现。

### Chips / Segmented Options

学习设置采用小圆角分段选项，外壳是卡片表面，轻内边距包裹各选项。未选中时以次要文字和透明底退后；选中时使用已有轻染表面和主色混合文字。按原有选项数量换行，窄容器可纵向重排设置说明和控件。不要套用不存在的独立胶囊组件体系。

### Cards / Containers

共享面板使用细边界、section 表面和 md 圆角；头尾通过边界及各自内边距分组，内容可在自身区域滚动。主要信息块、卡组行和阅读卡片各自复用对应模式，不给每个容器加同一种阴影。

### Inputs / Fields

中性混色输入底，sm 圆角；默认尺寸、排版和内边距见 frontmatter。悬停或焦点时边界转向宿主强调色。禁用时切换到 section 表面并降低透明度；错误基元提供危险边界及局部焦点色圈，但宿主归一规则还会影响最终外观，需在真实挂载环境核对。

保留 textarea、无外观输入和练习等宽输入等已有变体；不要用单一字段样式覆盖它们。

### Navigation

通用标题栏是粘性工具栏：浅主色渐变与细底边承托标题，标题截断，操作留在侧边。手机有独立返回入口及标题居中处理。

设置导航是独立横向滚动条，标签保持自然宽度，不能压缩文字使页面整体横向溢出。选中项使用轻染背景、较强文字及轻阴影；未选中项保持安静。

### Menus / Dialogs

菜单具有明确边界、小圆角和浮层阴影，菜单项的 hover / focus 共享强调反馈。弹窗使用受视口约束的宽高、分组的头尾和可滚动正文；当前背景遮罩为黑色透明层（0.72）并模糊（8px）。手机保留安全区，避免内容超出可用高度。

### Signature Patterns

- **状态轨道行**：一侧细轨道表达 active / fresh / done，结合标题、计数与操作区；完成状态降一级但仍可交互。
- **主要计数块**：同一页面共享模式至多一个主要数字，等宽计数与较小说明形成单一入口。
- **比率条**：用长度表达完成比例，数字承担说明，完成态使用完成绿。
- **卡片阅读**：衬线 Markdown 内容与界面无衬线控件分工，内容可选择，保留阅读行距。

配套 sidecar 收录六种按钮，以及输入、设置导航、分段选项和面板，共十项纯 HTML/CSS 视觉样例。它们从现有 SCSS 编译和筛选得到，不包含 React 行为。插件令牌并非声明在全局根上，样例会附带所需的作用域令牌；宿主变量缺失时，中性与强调角色使用浏览器系统色回退，红、绿、黄状态使用对应的 CSS 命名色回退，这只是独立预览条件，不是生产主题或亮暗主题的替代验证。

## Do's and Don'ts

### Do:

- **Do** 使用现有主题派生表面及共享令牌，按组件的实际尺寸和层级复用。
- **Do** 让学习文本先于容器、工具栏和辅助计数进入视线。
- **Do** 复用共享页面外壳、面板、按钮、输入框、菜单与弹窗，并在所属视图附近处理特例。
- **Do** 同时检查亮暗主题、窄桌面分栏、手机宽度、键盘操作及减少动态效果偏好。
- **Do** 区分实现快照与质量要求；普通文字对比度和触摸目标仍须按项目规范验证。

### Don't:

- **Don't** 根据旧说明补造源码中不存在的字号、间距或焦点环令牌。
- **Don't** 用无状态含义的彩色文字、厚重阴影或大面积强调色代替内容层级。
- **Don't** 将所有桌面按钮统一锁定到一个高度，或把媒体播放器的局部尺寸推广为全局规范。
- **Don't** 把预览环境的系统色回退或合成色阶写回生产色板。
- **Don't** 将源码扫描描述为已经完成的可访问性或实机视觉验证。

格式采用 [DESIGN.md 规范](https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md)；不扩展 frontmatter 的既定令牌组，阴影、动效和断点置于配套 sidecar。
