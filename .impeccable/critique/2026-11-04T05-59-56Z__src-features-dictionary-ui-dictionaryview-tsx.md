---
target: 英语字典页面
total_score: 25
max_score: 40
na_heuristics:
p0_count: 1
p1_count: 2
target_identity: "file:/Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/dictionary/ui/DictionaryView.tsx"
target_fingerprint: "sha256:3b74f478c6998133eb8afa23700fb10572e55ae525620aed3c3bf93fc8c2f800"
target_path: /Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/dictionary/ui/DictionaryView.tsx
timestamp: 2026-11-04T05-59-56Z
slug: src-features-dictionary-ui-dictionaryview-tsx
---

Method: dual-agent (A: 280a2527-5edc-4b5e-a730-9243e5c2b975 · B: ea3c797b-c488-45f1-bd26-da3ada0bfdcd)

## 设计健康度评分 (Design Health Score)

| #        | 启发式准则 (Heuristic)                           | 得分 (0-4) | 核心发现与扣分关键点                                                                                                     |
| -------- | ------------------------------------------------ | :--------: | ------------------------------------------------------------------------------------------------------------------------ |
| 1        | 系统状态可见性 (Visibility of System Status)     |     3      | 各词典源具备加载/成功/空/错误状态，但常态下 6 个青色实心圆点产生“交通灯效应”造成视觉噪点；复制成功状态引起布局垂直抖动。 |
| 2        | 系统与现实世界匹配 (Match System / Real World)   |     2      | 搜索输入框内硬塞“批量生词本”与“设置”按钮违背用户搜索直觉；视口内词头出现 4 次机械重复。                                  |
| 3        | 用户控制与自由 (User Control and Freedom)        |     3      | 提供一键清空与多源自由切换；但历史条目删除无撤销（Undo）机制，单词收藏采用全屏模态弹窗打断阅读心流。                     |
| 4        | 一致性与标准 (Consistency and Standards)         |     2      | 顶部词典源选项卡与下方二级详情折叠卡片视觉风格分裂；选区浮层与词典主页混用不同设计变量体系。                             |
| 5        | 防错设计 (Error Prevention)                      |     3      | 输入为空时禁用查询；但历史胶囊上的 18px 删除小叉与单词点击区域间距极小，极易误触。                                       |
| 6        | 识别优于回忆 (Recognition Rather Than Recall)    |     2      | 搜索框内为纯图标按钮，缺乏文字辅助；状态点依赖颜色感知；未提供可视化的全局键盘快捷键提示。                               |
| 7        | 灵活性与使用效率 (Flexibility and Efficiency)    |     3      | 具备 WAI-ARIA 标准的键盘 Roving Tabindex 导航与 Enter 快速查词；但缺少即时加入生词本的静默快捷链路。                     |
| 8        | 审美与极简设计 (Aesthetic and Minimalist Design) |     2      | 顶部 4 层控件严重挤压黄金首屏阅读高度；视觉容器层层嵌套，违背 DESIGN.md 规定的“克制紧凑、阅读优先”。                     |
| 9        | 容错与恢复 (Error Recovery)                      |     3      | 单源失败支持原位重试（RotateCcw）；错误提示清晰但无错误单词拼写模糊纠错推荐（如 "Did you mean"）。                       |
| 10       | 帮助与文档 (Help and Documentation)              |     2      | 无任何首次查词空状态引导，未说明本地 MDX 词典导入或 AI 引擎配置前提。                                                    |
| **总分** |                                                  | **25/40**  | **Acceptable (需要系统性重构与打磨)**                                                                                    |

---

## 设计特异性判定 (Design Specificity Verdict)

- **综合评估 (LLM Assessment)**:  
  当前词典页面呈现出**“通用聚合查词工具”与“Obsidian 深度学习伴侣”之间的身份割裂**。虽然整体依托了 Obsidian 中性色板与 `fc-*` 基础令牌，但交互骨架更接近于传统的独立多源查词客户端。Study Studio 最核心的“Markdown 笔记权威 + 闪卡记忆闭环”优势在主视图被边缘化为角落的一个小书签图标；而在查词这一专注性极强的阅读路径上，被塞入了不相干的系统设置、批量处理与冗余的 4 重词头重复，缺乏为 Markdown 学习者量身定制的克制与专注。
- **确定性扫描与代码取证 (Deterministic Scan & Code Evidence)**:
    1. 正则扫描未发现 AI 模板残差，合法排除了高权重覆盖 `!important` 与非模态 `<dialog>` 的伪阳性。
    2. 深度代码取证揭示了 7 项核心问题：
        - **EV-01 (Accessibility)**: `Dictionary.module.scss` 历史删除小叉仅 18×18px，严重低于 40px 最小触控规范。
        - **EV-02 (Interaction)**: AI 例句复制按钮仅 24px 且默认 `opacity: 0` (hover 显现)，移动端无法使用。
        - **EV-03 (Semantics)**: 标题层级跳跃，从 `h2` 直接跳入 `h4`，破坏无障碍大纲。
        - **EV-04 & EV-05 (Tokens & Consistency)**: 存在 `6px`、`12px 14px` 硬编码间距，且混杂了原生 Obsidian 变量。
        - **EV-06 (Motion A11y)**: 选区浮层动效未适配 `prefers-reduced-motion`。
        - **EV-07 (Accessibility)**: `SandboxDocumentFrame` iframe 存在空 `title` 回退。
- **视觉图层 (Visual Overlays)**:  
  Obsidian 为 Electron 桌面环境，未暴露 9222 远程调试端口，且无独立 HTTP 服务；已结合用户提供的真实界面渲染截图完成全要素视觉对齐与代码深度交叉取证。

---

## 总体印象 (Overall Impression)

**扎实的内容承载，拥挤的外壳设计。**  
页面最出彩的是牛津词典（OALD）原版高质量释义、例句与音标的呈现，安全沙箱与深浅色主题同步严谨优雅；然而，外层包裹的交互框架却背负了太多不属于单次查词流程的“工具债务”：搜索栏臃肿、词头四重重复、状态圆点躁动，首屏近 35% 的高度被无谓消耗，把学习者从“专注研读”生生拉回到了“操作工具”。

---

## 核心优势 (What's Working)

1. **原汁原味的权威词典排版与发音集成**：从截图可清晰看到，本地 OALD 的词性、英美双音标、发音按钮、核心义项与可折叠搭配栏层级严谨，忠实还原了顶级学习型词典的排版质感。
2. **严密受控的安全沙箱与主题通道**：通过 `SandboxDocumentFrame` 隔离第三方复杂 HTML/CSS，杜绝样式污染，且实现了 Obsidian 亮暗模式的平滑同步。
3. **符合 WAI-ARIA 规范的键盘导航**：选项卡完整实现了 Roving Tabindex 逻辑（支持左右方向键与 Home/End 切换焦点），对键盘流用户非常友好。

---

## 优先改进问题清单 (Priority Issues)

### [P0] 搜索栏动作超载与语义错位 (Search Bar Action Bloat)

- **现象**: 搜索框内部右侧一次性塞入了【批量生词本】、【词典设置】、【清空】、【查询】4 个按钮。
- **危害**: 严重挤压单词输入视野；将全局配置/批量任务与单次查词混为一谈，决策点过多（>4），破坏心流。
- **整改方案**:
    1. 将【词典设置】与【批量生词本】移出输入框，收纳至视图右上角的次要操作区或 Obsidian 的 View Header Actions 中。
    2. 搜索框内仅保留纯粹的文本输入与条件出现的【清空 (✕)】图标。
    3. 支持回车即查，弱化或紧凑化【查询】主按钮。
- **建议执行命令**: `/impeccable layout`

---

### [P1] 词头四重冗余与黄金首屏垂直挤压 (Quadruple Headword Redundancy)

- **现象**: 视口自上而下连续出现 4 次 `diagnose`（输入框 -> 历史第一项 -> 独立的 H2 标题行 -> 词典正文大标题），H2 行突兀夹在历史记录与选项卡之间。
- **危害**: 浪费了首屏超过 100px 的黄金垂直阅读空间，在 Obsidian 侧边栏或笔记双栏分屏下，首屏甚至看不到第一个义项。
- **整改方案**:
    1. 彻底移除独立的 H2 `queryActions` 孤岛行。
    2. 将【收藏生词】与【复制词条】快捷操作收拢合并到词典源 Tab 栏的右侧尾端，或者自然融入正文词头右侧。
    3. 压缩历史记录条的纵向间距，或改为下拉历史建议。
- **建议执行命令**: `/impeccable distill`

---

### [P1] 双重滚动条与沙箱滚动冲突 (Nested Scrollbar & Iframe Scroll Trap)

- **现象**: 外层容器 `.sourceBody` 具备 `overflow-y: auto`，而内部 iframe `SandboxDocumentFrame` 未传 `fitContent`，自成独立滚动区。
- **危害**: 产生双滚动条，鼠标移入正文滑动时容易陷入 iframe 滚动陷阱（Scroll Hijacking），破坏平滑研读体验。
- **整改方案**:
    1. 对单文档词典源启用 `fitContent={true}`，让沙箱高度根据内容自适应。
    2. 统一由外层 `.sourceBody` 提供平滑、单一的宿主滚动条（应用统一的 `fc-scrollbar`）。
- **建议执行命令**: `/impeccable layout`

---

### [P2] 触控目标过小与交互微跳动 (Sub-40px Touch Targets & Janky Layout Shifts)

- **现象**:
    1. 历史标签内置的小叉图标仅 18×18px（EV-01），AI 例句复制按钮仅 24px 且 hover 显现（EV-02）。
    2. 复制反馈通过在 DOM 中动态插入 `<p className={styles.copyStatus}>`，推挤下方内容下移 20px 发生明显跳动 (CLS)。
- **危害**: 移动端无法操作 hover 功能，历史删除极易误触且无法撤销；动态跳动带来视觉焦虑。
- **整改方案**:
    1. 历史标签移除独立小叉，改为长按/右键删除，或在列表末尾提供统一“清空历史”。
    2. 移动端取消 hover 显示机制，触控热区补齐至 40×40px。
    3. 复制反馈改为在按钮图标上停留 1.5 秒绿色对勾 (Checkmark)，零高度变动。
- **建议执行命令**: `/impeccable polish`

---

### [P2] 选项卡状态圆点的“交通灯效应”与设计令牌偏差 (Status Dot Noise & Token Drift)

- **现象**:
    1. 6 个词典源全部就绪时，每一个标签前均挂着一个亮色青圆点（`.tabStatus`）。
    2. 样式中存在 `6px`、`12px 14px` 硬编码间距（EV-04），且混杂使用原生 Obsidian 变量与插件令牌（EV-05）。
- **危害**: 视觉噪点喧宾夺主，分散对当前激活标签的专注力；变量混杂增加维护与主题适配风险。
- **整改方案**:
    1. 遵循“无警报即平静 (Silent by Default)”准则：就绪（Success）状态下**完全隐藏**圆点，仅在加载中（微旋转）或网络/解析错误（红色）时显现状态点。
    2. 样式全局收敛至统一的 `--fc-*` 设计令牌。
- **建议执行命令**: `/impeccable polish`

---

## 角色红线警示 (Persona Red Flags)

- **Alex (键盘流 / 高阶笔记研读型用户)**:  
  Alex 一边阅读英文文献一边在右侧窄分栏查词，习惯全键盘操作。查完词想直接把生词加入 Markdown 生词本，结果必须拿鼠标去点那个小书签；一点书签立即弹出一个侵入式的全屏大模态框，键盘焦点被迫转移，原本阅读文献的思路彻底被打断。
- **Jordan (初次使用的英语学习者)**:  
  初次打开 Study Studio 查词页面，看到搜索框里塞着好几个神秘图标（带加号的列表、齿轮滑块、垃圾桶），下面还有一排带实心圆点的标签。不知道该点哪个查，不知道 `IMG` 和 `词根词缀` 是什么，被繁琐的工程参数与状态吓退，感觉这像一个“开发者调试工具”而非“清爽的学习卡片”。
- **Sam (无障碍 / 触控与高对比度依赖者)**:  
  历史标签的删除小叉不仅尺寸仅 18px（违背 WCAG 44×44px 规范），而且透明度被降为 0.5，在浅色主题下色彩对比度严重低于 3:1，几乎难以分辨，极易引发误删；此外，标题层级跳跃（`h2` 直接到 `h4`）导致屏幕阅读器无法建立清晰的大纲导航。

---

## 细微观察与次要问题 (Minor Observations)

1. **二级 Tab 风格不统一**: 词典源 Tab 为药丸小卡片（`border-radius: var(--fc-radius-sm)`），而 `details` 的二级 Tab 却是传统文件夹边框标签，一个页面内出现两套 Tab 视觉隐喻。
2. **底部来源归属（Attribution）孤悬**: `本地词典 · OALD` 孤零零贴在底部左侧，与右侧 MDX 内置的悬浮圆钮发生视觉脱节。
3. **无结果态表现简陋**: 当输入拼写错误的单词时（如截图中历史记录里的 `dignose`），页面仅展示干瘪的文字提示，缺少智能模糊推荐（如 "Did you mean: diagnose?"）。
4. **标题大纲不合规 (EV-03)**: 查询词直接使用 `<h2>`，且容器缺失隐藏的 `<h1>`，各源内部标题直接使用 `<h4>`。

---

## 供团队深思的核心设问 (Questions to Consider)

1. **为什么在 Obsidian 环境下查词还需要一个显式的“查询”大按钮？**  
   _作为桌面笔记软件，输入后防抖即查（Debounced Instant Search）或者直接响应 Enter 键才是最自然的用户预期，那个常驻的“查询”按钮是否只是传统网页思维的残留？_
2. **生词收藏为什么必须是“阻塞式弹窗”？**  
   _能否像主流阅读器一样，点击即加入“默认生词本/默认标签”，并在角落浮现一个带“修改分类”链接的轻提示 (Toast)，实现 0 摩擦收集？_
3. **词头、音标与音频按钮是否应该由 Study Studio 统一接管？**  
   _现在每个本地词典（OALD、朗文、有道、AI）都各画各的音标和发音按钮。Study Studio 能否提供一个统一、优雅、安静的外壳词头区，而仅将详细义项交由词典内容呈现？_
