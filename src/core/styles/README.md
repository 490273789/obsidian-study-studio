# 闪卡 UI 规范

插件保留当前低饱和、舒适紧凑的风格。界面直接继承 Obsidian 的系统主题与强调色；颜色用于表达操作层级和状态，不用于装饰无语义的数据。普通层级依靠背景、边框和留白建立，阴影只用于菜单、弹窗等真正离开文档流的浮层。

`index.scss` 是 `src/core/host/main.ts` 引入的唯一样式入口。Vite 会跟随它的导入并通过 Sass 预处理器编译生成 Obsidian 使用的根目录 `styles.css`。不要手工编辑根目录 `styles.css`，应运行 `pnpm run build` 重新生成。

## 文件结构与组件就近样式（Colocation）

项目样式采用“**全局基础令牌 + 基础组件就近样式 + 业务视图就近样式**”的清晰分层架构：

### 1. 全局样式体系 (`src/core/styles/`)

- `mixins.scss`：高频 SCSS 混入（如 `fc-focus-ring`、`fc-flex-center`、`fc-truncate`、`fc-scrollbar` 等）。
- `layout.scss`：**布局模块**，页面外壳、面板与视图容器的唯一实现（见下）。
- `patterns.scss`：**通用 UI 模式**，跨视图复用的结构配方（hero 主区、状态行、比率条、折叠组，见下）。
- `base.scss`：设计 token（唯一来源，`--fc-*`）、根容器框架（`.flashcard-root` 的定义与表面归一）。
- `settings.scss`：Obsidian 设置面板与设置弹窗相关的样式。
- `motion.scss`：全局动画与关键帧（尊重 `prefers-reduced-motion`）。
- `responsive.scss`：全局小屏幕和移动端粗指针媒体查询适配。
- `index.scss`：主样式入口，负责按序汇入全局层及尚未模块化的存量样式。

### 2. 混合架构：全局 CSS 与 CSS Modules (`*.module.scss`)

本项目采用 **“全局基础基础设施 + 局部 CSS Modules”** 的混合架构：

- **保留全局 SCSS 的部分**：
    - 设计 Token（`--fc-*`，`base.scss`）
    - 全局布局骨架（`.fc-page`、`.fc-panel` 等，`layout.scss`）
    - Obsidian 宿主与设置界面集成（`settings.scss`、`.modal.mod-flashcard`）
    - 富文本渲染（`Markdown.scss` 内部由 Obsidian 运行时动态插入的 HTML 标签）
    - 全局重置与响应式媒体查询
- **采用 CSS Modules 的部分**：
    - 业务功能视图（`src/features/**/ui/*.module.scss`）与复杂业务组件。
    - 样式文件以 `[Name].module.scss` 命名，与 TSX 同目录就近存放。
    - 不再汇入 `src/core/styles/index.scss`，而是直接由对应的 `.tsx` 引入：`import styles from "./[Name].module.scss"`。

#### CSS Modules 编写与使用规范

1. **作用域与类名命名**：
    - 内部选择器直接使用清晰简练的语义名（如 `.workspace`、`.notice`、`.results`、`.footer`），不再需要堆叠冗长的人工命名空间前缀（如 `flashcard-translator-*`）。
    - Vite 会自动生成带 `fc-` 命名空间前缀的类名：`fc-[name]__[local]_[hash:base64:5]`，确保在 Obsidian 全局 DOM 中绝对安全隔离。
2. **TSX 引用与驼峰映射**：
    - Vite 开启了 `localsConvention: "camelCase"`，在 SCSS 中书写 `.resultTitle` 或 `.result-title` 均可在 TSX 中通过 `styles.resultTitle` 访问。
3. **类名组合工具 (`cls`)**：
    - 组合全局布局类（如 `fc-page`、`fc-panel`）与模块化局部类时，统一使用 `src/core/shared/classNames.ts` 导出的 `cls(...)`：
        ```tsx
        import { cls } from "../../../core/shared/classNames";
        import styles from "./Translator.module.scss";

        <article className={cls("fc-panel", styles.panel)}>
        	<p className={cls(styles.status, isError && styles.isError)}>{text}</p>
        </article>;
        ```
4. **子级与第三方全局类**：
    - 若模块内需定制无源码控制的子组件或 Obsidian 注入节点，使用 `:global(.className)` 选择器。

### 3. 基础 UI 组件样式 (`src/core/ui/primitives/**/`)

每个基础控件拥有独立目录，TSX 与对应 SCSS 样式同目录存放并导出：

- `Button/` (`Button.scss`)、`Input/` (`Input.scss`)、`Select/` (`Select.scss`)、`Checkbox/` (`Checkbox.scss`)、`Slider/` (`Slider.scss`)
- `Menu/` (`Menu.scss`)、`Modal/` (`Modal.scss`)、`ConfirmDialog/` (`ConfirmDialog.scss`)
- `Header/` (`FlashcardHeader.scss`)、`SessionTimer/` (`SessionTimer.scss`)、`SessionToolbar/` (`SessionToolbar.scss`)、`SetupSelector/` (`SetupSelector.scss`)
- `Markdown/` (`Markdown.scss`)、`PronunciationButton/` (`PronunciationButton.scss`)

只被闪卡使用的基元（`SessionToolbar`、`PronunciationButton`、`Markdown`）随功能放在 `src/features/flashcards/ui/primitives/`，规则同上。

### 4. 业务视图组件样式（按功能切片，全部采用 CSS Modules）

每个独立视图模块遵循 Colocation 模式：

- `src/features/translation/ui/`：`Translator.module.scss`
- `src/core/selectionHelper/ui/`：`SelectionPopup.module.scss`
- `src/features/dictionary/ui/`：`Dictionary.module.scss`
- `src/features/video-player/ui/`：`VideoPlayer.module.scss`
- `src/features/flashcards/ui/views/**`：
    - `Home/`：`DeckList.module.scss`、`LearningFootprint.module.scss`
    - `Study/`：`StudySetup.module.scss`、`StudySummary.module.scss`
    - `Card/`：`CardView.module.scss`、`CardEditorModal.module.scss`
    - `Practice/`：`Practice.module.scss`
    - `Spelling/`：`Spelling.module.scss`
    - `WordList/`：`WordList.module.scss`
    - `Stats/`：`Stats.module.scss`
    - `DeckSettings/`：`DeckSettingsModal.module.scss`
    - `Challenge/`：`Challenge.module.scss`

视图样式只写该视图特有的规则；页面外壳、面板与 header/footer 语义一律来自布局模块。**切勿在 `src/core/styles/index.scss` 中 `@use` 业务视图的 `*.module.scss`，必须由对应 TSX 就近导入**。

### Token 唯一来源

- `--fc-*` 设计 token（含阴影、焦点环、辉光与动效的最终值）只能在 `base.scss` 的 `.flashcard-root, .flashcard-settings-tab` 中定义一次；其他文件禁止再定义或覆盖同名单词。本文件只说明用法与取值口径，具体数值一律以 `base.scss` 为准。
- 不再维护独立的亮色主题文件。`.theme-light` 前缀仅用于极少量光学修正（见 `Home/DeckList.scss`、`Spelling/Spelling.scss`、`Stats/Stats.scss`），所有配色都从 Obsidian token 派生。
- 组件作用域内的临时变量（如 `--fc-rating-color`、`--fc-confirm-rgb`）允许就地定义，但不得以 `--fc-` 前缀模仿全局设计 token 的命名体系。

## 布局模块 (`layout.scss`)

页面外壳、面板与视图容器只在这里实现一次。视图在自己的类名旁叠加布局类，不重写配方：

- `.fc-page`：页面根（flex 纵向、区块间距、`--fc-text`）。
- `.fc-page--column`：居中限宽（`min(1280px, 100%)`）并带页面内边距，滚动由视图自己决定。
- `.fc-page--fill`：填满 leaf、内部滚动、带 `--fc-motion-page-enter` 进入动效。
- `.fc-page__body` / `.fc-page__body--narrow`：可滚动正文区；`--narrow` 为 850px 阅读列。
- `.fc-panel` + `.fc-panel > header|footer` + `.fc-panel__body` / `.fc-panel--scroll`：带边框的面板与其头/尾/正文语义。
- `.workspace-leaf-content .flashcard-container`：挂载接缝为每个视图添加的唯一容器类。

布局模块自带 720px / 640px / `pointer: coarse` 三组媒体查询，因此新视图无需再写外壳级响应式。功能样式在布局层之后加载，可以覆盖个别数值（例如统计页保留自己的内边距）。

## 通用 UI 模式 (`patterns.scss`)

`layout.scss` 管的是"页面怎么摆"，`patterns.scss` 管的是"页面里的内容长什么样"。后者收录跨视图重复出现的结构配方；视图在自己的类名旁叠加这些类名消费，不重写配方。**新增页面时优先复用这里的模式**，只有确实不复用时才在视图样式里新写。

**每个模式只负责结构，不负责内容。** 视图决定放几个按钮、显示哪些字段；模式决定它们如何排列、间距多大、状态如何表达。

### 页面主区（Hero）

一个页面**最多一个** hero，它承载该页唯一的 headline 数字。

| 类名                | 作用                                    |
| ------------------- | --------------------------------------- |
| `.fc-hero`          | 网格容器；左侧文本列 + 右侧动作列       |
| `.fc-hero__label`   | 数字上方的小标签（eyebrow）             |
| `.fc-hero__num`     | 数字本体，`--fc-font-focus`（32px）等宽 |
| `.fc-hero__summary` | 数字下方的说明句                        |
| `.fc-hero__side`    | 右侧列，放连续天数一类的状态与主按钮    |

关键约束：**一个页面只允许一个大号数字**。hero 之外的所有数值保持 `xs`–`sm`，否则页面失去入口。hero 不使用阴影，层级由 tinted 表面与强调边框建立。

```tsx
<section className={cls("fc-hero", styles.hero)}>
	<div>
		<div className="fc-hero__label">{t("home.heroLabel")}</div>
		<div className="fc-hero__num">
			<b>{total}</b>
			<span>{t("home.heroUnit")}</span>
		</div>
		<div className="fc-hero__summary">{summary}</div>
	</div>
	<div className="fc-hero__side">{action}</div>
</section>
```

### 状态行（Rail row）

列表中"状态先于文字被读懂"的行。状态通过 `data-state` 表达，**不额外加类名**，这样组合类名时语义不会丢失。

| `data-state` | 含义           | 轨道色         | 处理                   |
| ------------ | -------------- | -------------- | ---------------------- |
| `active`     | 进行中，工作集 | `--fc-primary` | 最高权重               |
| `fresh`      | 未开始         | muted 55%      | 数字降为 muted         |
| `done`       | 已完成         | `--fc-lime`    | 整体降一级，但仍可交互 |

```tsx
<article className={cls("fc-rail-row", styles.deckItem)} data-state="active">
	<div className="fc-rail-row__main">
		<span className="fc-rail-row__title">{name}</span>
		<div className="fc-meta">…</div>
	</div>
	<div className="fc-rail-row__count">
		<b>{pending}</b>
		<span>{t("home.deckPending")}</span>
	</div>
	<div className="fc-rail-row__actions">{/* 阻止冒泡的动作区 */}</div>
</article>
```

`.fc-rail-row__actions` 已带 `z-index` 与 `align-self`，但**不自动阻止冒泡** —— 行本身可点击时，视图需在动作区自行 `stopPropagation`。

行的堆叠重排由 `fc-rail-row-stacked` 混入统一处理，已在 768px 容器与视口断点自动生效。

### 比率条（Meter）

用长度表达比例，取代 `a / b` 这类分数写法。裸分数会让两侧数字权重相同，读起来既不像进度也不像计数。

```tsx
<span className="fc-meter" aria-hidden="true">
	<i style={{ width: `${percent}%` }} />
</span>
```

宽度通过 `--meter-width`（默认 88px）调整；完成态加 `data-tone="done"` 切换为绿色。

### 元信息行（Meta）

行内元信息与点分隔符，替代手写的 `·` 文本与独立 `::before` 伪元素。

```tsx
<div className="fc-meta">
	<span className="fc-meta__text">{progress}</span>
	<span className="fc-meta__dot" aria-hidden="true" />
	<span className="fc-meta__text">{count}</span>
</div>
```

### 折叠组（Disclosure / Group）

列表下方的次级分组（如"已学完的卡组"），默认收起。

- `.fc-group`：分隔线与上边距
- `.fc-disclosure`：可点击的组标题（已含按钮重置与焦点环），配合 `aria-expanded`
- `.fc-group__body`：展开后的内容容器

### 何时不该复用

模式是**结构**契约，不是外观契约。若某个视图的行需要三列以上的独立信息、或状态多于三种，说明它有自己的信息密度，应当在视图样式里单独实现，而不是往模式里加特例。

## Token 使用规则

### 字体

- 字号只使用 `--fc-font-2xs/xs/sm/md/lg/xl/display/hero/focus`，分别为 10、11、13、14、15、18、20、24、32px。
- 控件默认使用 `--fc-font-sm`，正文使用 `--fc-font-md`，桌面卡片阅读内容使用 `--fc-font-lg`。
- `--fc-font-2xs`（10px）专用于键盘热键徽章（kbd / shortcut pill）、微型状态徽章与紧凑角标；常规辅助文字不得小于 `--fc-font-xs`（11px）；窄屏阅读内容可降为 `--fc-font-md`，不得继续缩小。
- 字重只使用 `--fc-weight-regular/medium/semibold/bold`（400/500/600/700）。
- 紧凑标签使用 `--fc-line-tight`，普通正文使用 `--fc-line-body`，长文和 Markdown 内容使用 `--fc-line-reading`。

### 间距与尺寸

- 间距只使用 `--fc-space-half` 和 `--fc-space-1` 至 `--fc-space-10`，对应 2、4、6、8、12、14、16、20、24、28、40px。
- 内联元素间距使用 4–8px，控件内边距默认 8px × 12px，卡片内边距使用 12–16px，区块间距使用 16px，弹窗大区块使用 20px。
- 标准桌面控件高度为 `--fc-control-md`（32px）；`--fc-control-sm`（28px）仅用于紧凑的图标或嵌入式控件。

### 圆角、边框与层级

- 标签：`--fc-radius-xs`（2px）。
- 控件和列表项：`--fc-radius-sm`（4px）。
- 卡片和面板：`--fc-radius-md`（6px）。
- 大型弹窗：`--fc-radius-lg`（8px）。
- 胶囊：`--fc-radius-pill`。
- 普通边框统一为 1px；当前项、问答卡等状态强调边可使用 3px。
- 分隔线使用 `--fc-line`（普通）、`--fc-line-soft`（弱分隔）与 `--fc-line-faint`（更弱分隔），强调边框使用 `--fc-line-strong`；组件不得再使用硬编码的分隔线颜色（如 `rgba(139,159,181,α)`）。
- 自定义精细滚动条使用混入 `@include fc-scrollbar`，滑块颜色通过设计 token `--fc-scrollbar-thumb` 与 `--fc-scrollbar-thumb-hover` 控制，自动继承系统正文透明度混合并适配亮暗主题。
- 遮罩（backdrop scrim）使用 `--fc-overlay`（普通弹窗）与 `--fc-overlay-heavy`（重确认弹窗），两者都从固定的 `--fc-black-rgb` 派生。
- `--fc-surface-canvas`：页面画布，继承 `--background-secondary`。
- `--fc-surface-section`：页面内的大区块，位于画布与卡片之间。
- `--fc-surface-card`：主要内容卡片，继承 `--background-primary`。
- `--fc-surface-raised`：菜单等悬浮表面，仅与 `--fc-shadow-popover` 配套使用。
- `--fc-surface-control`：按钮等可交互控件表面，继承 `--interactive-normal`。
- 静态卡片和普通按钮不使用阴影；菜单使用 `--fc-shadow-popover`，大型弹窗使用 `--fc-shadow-overlay`，键盘焦点使用 `--fc-focus-ring`。组件不得重新发明同层级阴影或焦点环。

### 颜色

- 表面必须从 `--fc-surface-canvas/section/card/raised/control` 派生。
- 语义色：状态类使用 `--fc-primary`（青）与 `--fc-danger`（红）；其余颜色直接使用调色 token（`--fc-cyan/blue/magenta/violet/lime/amber/red/orange`）。组件不使用语义色区分无状态含义的数据。
- 普通文字使用 `--fc-text`，次要信息使用 `--fc-muted`，弱提示使用 `--fc-faint`。不得通过随机彩色文字区分无状态含义的数据。
- 首页学习与刷题主操作分别使用 `--fc-action-study-*` 和 `--fc-action-practice-*`；其他按钮默认保持中性，仅在激活、危险或明确状态时使用语义色。
- 暗色和亮色主题的普通文字对背景需达到 WCAG AA 4.5:1；新增配色时应保持对比度达标，并在 Obsidian 中检查亮/暗主题。

### 交互状态与遮罩

- hover 表面统一使用 `--fc-surface-hover`，选中态使用 `--fc-surface-selected`；控件边框 hover 使用 `--fc-control-border-hover`，选中边框使用 `--fc-control-border-selected`。
- 禁用态统一用 `--fc-opacity-disabled`（0.45）表达，不单独定义禁用表面色或边框色。
- 按下（`:active`）态通过轻微缩放与辉光表达，不改变背景色；键盘焦点统一使用 `--fc-focus-ring`。
- `--fc-black-rgb` 固定为纯黑（用于阴影与遮罩），`--fc-white-rgb` 固定为纯白（用于高光 sheen 与顶部高光），两者不随主题翻转；其余带 `-rgb` 后缀的通道 token 仅用于 `rgba()` 半透明 tint。

## 组件规则

- 按钮、输入框、选择框统一继承共享控件高度、字号、圆角和焦点样式。
- 标题栏、统计条、列表行和设置项使用中性表面；状态信息可通过单一语义色的文字、图标或 3px 强调边表达。
- 卡片阅读内容保持 `--fc-font-lg` / `--fc-line-reading`（15px / 1.6）；工具栏、计数和快捷键信息不得抢过正文层级。
- 单词列表工具栏未激活时必须为中性，激活后才显示洗牌、正面或背面的状态色。
- 弹窗使用 `--fc-radius-lg`（8px）圆角、`--fc-space-7`（20px）大区块间距和统一遮罩/阴影；确认、卡片编辑和解释弹窗不得各自定义一套密度。
- 动效时长从 `--fc-motion-*` 和 `--fc-transition-*` 取值，并尊重 `prefers-reduced-motion`。

## 响应式与主题

- 900px 以下允许折叠栏位和重排工具栏，但不缩小基础字号。
- 640px 以下阅读内容降为 `--fc-font-md`（14px）；布局可以堆叠，信息层级保持不变。
- 亮色与暗色主题默认都直接继承 Obsidian token。只有透明度或对比度确实无法自动适配时，才在对应组件文件里添加极少量 `.theme-light` 光学修正，禁止维护一套固定色值的独立亮色主题文件。

## 允许的例外与验证

- 1px 普通边框、3px 状态强调边、绝对定位、图标绘制、阴影和背景纹理可使用必要的像素值；它们不参与内容密度刻度。
- 独立沉浸式媒体/视频播放器视图（如 `VideoPlayer`）统一采用深色高对比度控制台（底色为暗夜黑，文字与按钮图标在亮/暗主题下均保持高清晰度浅色，辅以强调色焦点与进度），不强制跟随 Obsidian 亮色主题翻转，以保障音视频画面的专业观感与播放控制清晰度。
- 旧版兼容选择器可以保留，但不能引入新的字号、间距、圆角或颜色体系。
- 组件重构后要及时删除不再渲染的 CSS 类（死类）与未被引用的 token。
- 修改样式不需要添加测试用例；完成后运行 `pnpm run build` 并在 Obsidian 中实际查看受影响的视图，较大范围修改还应运行 `pnpm run lint` 与 `pnpm run format:check`。
