---
target_identity: "file:/Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/translation/ui/TranslatorView.tsx"
target_fingerprint: "sha256:4abd893655ffea693e4f40e400b82b964997df64dd54a30b7a46c1c09fcd56d5"
target_path: /Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/translation/ui/TranslatorView.tsx
timestamp: 2026-11-04T05-06-47Z
slug: src-features-translation-ui-translatorview-tsx
closed: true
---

Method: dual-agent (A: a3961585-5339-4ad8-8bc2-c0bdd5875382 · B: eb816436-6a4f-4893-9cb8-5a43e125e4d2)

## Design Health Score

| #         | Heuristic                       |   Score   | Key Issue                                                              |
| --------- | ------------------------------- | :-------: | ---------------------------------------------------------------------- |
| 1         | Visibility of System Status     |    2/4    | 缺乏单模型流式输出与独立请求耗时反馈；复制反馈与触发按钮空间脱节       |
| 2         | Match System / Real World       |    2/4    | 充斥“已启用 3 个方案”、“Token 消耗”等模型底层黑话，缺少语言学习语义    |
| 3         | User Control and Freedom        |    2/4    | 无法单独重新生成或中止单模型请求；清空动作无法撤销且无二次确认         |
| 4         | Consistency and Standards       |    1/4    | 强制覆盖青色描边违反项目自身 DESIGN.md；复制按钮缺少 aria-label 标签   |
| 5         | Error Prevention                |    2/4    | 破坏性清空按钮紧邻翻译主按钮，极易误触；模型报错缺乏原位诊断与重试     |
| 6         | Recognition Rather Than Recall  |    2/4    | 3 个模型译文无差异高亮（Diff），用户需在 120px 局促空间内纯靠记忆比对  |
| 7         | Flexibility and Efficiency      |    2/4    | 支持 Ctrl+Enter，但缺少结果快速制卡、回写笔记及单卡快捷键等高频操作    |
| 8         | Aesthetic and Minimalist Design |    1/4    | 空间严重失衡（左侧 50% 虚掷，右侧 3 卡过度压缩）；青色边框造成视觉噪音 |
| 9         | Help Users Recover from Errors  |    2/4    | 仅返回抽象错误码，未提供内联模型凭证检查或单项重新发起入口             |
| 10        | Help and Documentation          |    1/4    | 无内置说明、无对比意义指引、无笔记选区联动提示                         |
| **Total** |                                 | **17/40** | **Poor (需要实质性重构与体验优化)**                                    |

---

## Design Specificity Verdict

**LLM 设计总监评审**：
当前 AI 翻译页面存在极强的**品类平庸感与模板化痕迹（Category-Generic Sameness）**。界面仅仅是对 2018 年代典型网页翻译工具（左原文、右译文、中语言、底翻译）的机械复刻，且更像是一个用于调试多模型并发的工程测试台（Debug Harness）。
它彻底割裂了 **Study Studio** 作为一个“面向中文用户的英语学习工作台”的专属定位：无法对译文生词进行就地释义与收藏，无法一键生成 FSRS 闪卡，无法向当前 Obsidian 笔记插入 Markdown 引用块（Callout），结果完全停留于易失性内存，形成了严重的知识孤岛。

**静态规则扫描（Deterministic Scan）**：

- 自动化检测器检出 **1 项 Warning**（`side-tab` 反模式，位于 `Translator.module.scss:53`：`.notice` 容器使用 `border-left: 3px solid var(--fc-orange)`）。
    - **真阳性判定**：确认属实。在圆角面板上单贴粗色条是典型的 AI 生成 UI 俗套（Slop），既破坏视觉连贯，又与 Obsidian 原生 Callout 质感脱节。
- 深度代码取证额外捕获 3 处确定性缺陷：
    1. `TranslatorView.tsx:233-240` 复制按钮缺失 `aria-label`/`title`（违反 WCAG 4.1.2）。
    2. 复制反馈状态永久滞留（无定时器自动复原）。
    3. `!important` 青色边框覆盖破坏了 DESIGN.md 的安静工作台准则。

**视觉覆盖层（Visual Overlays）**：

- 宿主运行于 Obsidian Electron 桌面端，未开启 9222 远程调试端口，静态页面亦无可供自动化注入的 Web Dev Server。无动态视觉覆盖层，已降级为静态代码深度取证与实机截图视觉走查。

---

## Overall Impression

从“API 调用跑通”的工程视角看，双向翻译、快捷键支持与多方案并发的逻辑非常完整；但在“产品与用户体验”视角下，它目前既不是一个舒适的翻译器，更不是一个合格的 Obsidian 学习工具——它将用户困在左侧巨大空旷与右侧 3 个狭隘滚动条的机械比对中，且在翻译完成后无法将任何语言成果沉淀回笔记或闪卡。

---

## What's Working

1. **多模型横向对比的底层价值**：英语学习中“一词多译、多风格互证”能有效培养语感，该功能具备极佳的自学辅助潜力。
2. **移动端响应式降级考虑周全**：针对 `<=720px` 提供了垂直流式单栏布局，并通过 `min(40vh, 280px)` 防止长文本撑爆手机视口。
3. **交互基础与快捷键就绪**：原生支持 `Ctrl/Cmd + Enter` 快捷提交，状态驱动基于 `useSyncExternalStore`，响应式刷新无闪烁。

---

## Priority Issues

### 🚨 [P0] 知识孤岛：彻底缺乏与 Obsidian 学习与复习闭环的联动

- **Why it matters**：用户在 Obsidian 中查译是为了理解、记录与复习。当前译文只能手动 Ctrl+C，无法一键制卡、无法就地查生词、无法插入活动笔记。关掉页面即数据丢失，背离了插件核心价值。
- **Fix**：在译文卡片操作栏与底部扩展原生动作：
    1. `[制为闪卡]`：一键将原文与选中译文送入闪卡创建面板；
    2. `[插入笔记]`：以 Markdown 引用块格式（`> [!translation]`）写入当前激活的编辑器光标处；
    3. 支持划词直接唤起 Study Studio 内置词典查词。
- **Suggested command**：`/impeccable polish`

### 🚨 [P1] 空间失衡与比对人体工程学灾难（“左虚右挤”）

- **Why it matters**：左侧输入框独占 50% 视口，日常查句造成大量空白浪费；右侧 3 个模型卡片硬性垂直均分，单卡高度仅约 120px，稍长译文即产生独立滚动条，比对时需在 3 个狭窄视窗中上下划拉，认知负荷极高。
- **Fix**：
    1. 引入视图模式切换：支持“单模型精读（附带备选折叠）”与“双/多模型横向对比（Side-by-side）”；
    2. 废除固定垂直等分，允许卡片根据译文长度自适应高度，或采用标签页/分段器（Segmented Control）平滑切换主要展示模型。
- **Suggested command**：`/impeccable layout`

### 🚨 [P1] 滥用青色描边与 AI 风格俗套，违反 DESIGN.md 原则

- **Why it matters**：SCSS 中多处使用 `!important` 强塞青色描边，加上检出的 `.notice` 橙色单边粗线条，使界面泛着非语义的荧光描边（视觉耳鸣），破坏了 DESIGN.md 规定的“克制、清晰、让阅读内容优先”的安静学习质感。
- **Fix**：全面清理 `Translator.module.scss` 中的 `!important` 与自定义 `color-mix` 边框，回归 `var(--fc-surface-card)` 和 `var(--fc-line)` 标准令牌；将 `.notice` 重构为 Obsidian 质感的温和 Callout。
- **Suggested command**：`/impeccable harden`

### 🚨 [P2] 操作动线离散与交互就近原则破坏

- **Why it matters**：输入完成后，提交按钮远在视口左下角；卡片右上角点击复制，反馈文字却出现在卡片左下角；卡片标题机械拼接为 `DeepSeek DeepSeek · deepseek-v4-flash`，充斥工程黑话。
- **Fix**：
    1. 将“翻译”动作作为内联工具条吸附在输入框右下方或操作流自然终点；
    2. 复制反馈直接在按钮本身通过微动效体现（图标瞬时变勾并提供轻提示，2秒后恢复）；
    3. 清理厂商名称冗余拼接，精简为“主标题：方案名称，副标题：厂商与模型”。
- **Suggested command**：`/impeccable clarify`

---

## Persona Red Flags

- **Alex (高阶学术与笔记重度用户 / Power User)**：粘贴一段 300 词论文长句后，右侧 3 个卡片全部溢出，内部滚动条极窄，无法并排对比行文；挑选出满意译文后无法直接回写进文献笔记，必须手动切回文档粘贴并手写 Markdown 格式，效率极低，倾向于放弃使用。
- **Jordan (初级英语自学者 / Confused First-Timer)**：一进入页面就看到“已启用 3 个方案”，三个一模一样的卡片写着底层模型代号和“Token”，直接产生困惑与选择瘫痪；翻译后三个版本措辞不同但无重点生词解释，不知道该记哪个。
- **Sam (键盘与无障碍依赖用户 / Accessibility-Dependent)**：输入框输入完后按 Tab 试图提交，焦点必须横穿所有卡片标题、复制按钮及只读框（十余次 Tab）才能到底部翻译按钮；复制按钮缺少 `aria-label`，读屏器无法获知按钮意图。

---

## Minor Observations

1. **危险且不可逆的清空按钮**：带有垃圾桶图标的“清空”按钮紧靠“翻译”，点击立即清空原文与所有译文，无任何 Undo 撤销手段。
2. **大屏行长失控**：在 1400px 宽度容器下，单行文本宽度超出舒适阅读黄金宽度（60-75 字符）。
3. **复制状态长期滞留**：一旦点击复制，底部一直保留“已复制”字样，界面状态失真。
4. **Token 统计工程黑话**：卡片底部展示“输入 xx · 输出 xx”，对语言学习者无实质认知帮助，反而增加噪音。

---

## Questions to Consider

- 如果用户在 Obsidian 内翻译后无法把文本变成闪卡或笔记块，它与浏览器里的免费在线翻译相比核心竞争力是什么？
- 默认平铺 3 个微型卡片，究竟是学习者的真实比对需要，还是多模型并发接口的直接投射？
- 能否将“翻译”作为学习闭环的起点，翻译后自动高亮四六级/雅思核心词，让查译直接转化为记忆增量？
