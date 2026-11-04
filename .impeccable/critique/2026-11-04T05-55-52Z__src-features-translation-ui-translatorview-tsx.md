---
target: src/features/translation/ui/TranslatorView.tsx
total_score: 19
max_score: 40
na_heuristics:
p0_count: 1
p1_count: 1
target_identity: "file:/Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/translation/ui/TranslatorView.tsx"
target_fingerprint: "sha256:6b4deb538741501bfdcb93c61a9067363daad06fb189861ce481fca3e9767019"
target_path: /Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/translation/ui/TranslatorView.tsx
timestamp: 2026-11-04T05-55-52Z
slug: src-features-translation-ui-translatorview-tsx
---

Method: dual-agent (A: 8d45bd8b-d00b-4bcd-9bae-d4e6e224b37c · B: 819fd767-ea11-4d21-a535-77db17fbae8c)

## Design Health Score

| #         | Heuristic                       |   Score   | Key Issue                                                                                         |
| --------- | ------------------------------- | :-------: | ------------------------------------------------------------------------------------------------- |
| 1         | Visibility of System Status     |     2     | 缺乏单模型独立加载/流式状态；操作成功反馈在底部 1.8 秒后消失且与顶部按钮脱节                      |
| 2         | Match System / Real World       |     2     | 底栏常驻技术黑话“Token 消耗”；“制为闪卡”使用图层(Layers)图标且不建卡；“有道智云 有道智云”文本重复 |
| 3         | User Control and Freedom        |     2     | 垃圾桶清空无确认与撤销；翻译请求无法单独中止；译文文本框设为只读无法就地微调                      |
| 4         | Consistency and Standards       |     2     | 语言切换器悬浮脱节；3 列对比卡片标题严重截断（Deep.../百..）；卡片容器缺失 role="tabpanel" 关联   |
| 5         | Error Prevention                |     1     | 一键清空极易误触；翻译视图作为主标签激活时“插入笔记”必报无活动笔记错误；无超长文本截断警告        |
| 6         | Recognition Rather Than Recall  |     2     | 卡片顶栏纯图标无文字；多模型无高亮差异比对(Diff)需人眼硬记；历史记录纯内存暂存无持久化            |
| 7         | Flexibility and Efficiency      |     2     | 仅支持基础 Cmd+Enter，缺少高频单键选择方案、快捷反转、快捷采纳插入与单方案重跑                    |
| 8         | Aesthetic and Minimalist Design |     2     | 58% 容器强行三等分造成“拉面条”排版；Token 等机械指标干扰视线；居中方向栏造成大量无效留白          |
| 9         | Error Recovery                  |     2     | 单个模型报错仅显示抽象错误文本，缺乏针对 API Key、网络诊断或一键重试的原位修复路径                |
| 10        | Help and Documentation          |     2     | 缺乏多模型配置定位说明及 Obsidian 闪卡/笔记生态联动指引，快捷键提示微弱                           |
| **Total** |                                 | **19/40** | **Poor (较差，亟需结构性与体验重构)**                                                             |

---

## Design Specificity Verdict

**LLM 设计总监评审**：  
**判定：Category-Interchangeable（高度泛化、缺乏产品特异性的通用 AI 套壳界面）**  
Study Studio 的核心定位是“以中文为主要语言的英语学习者在 Obsidian 笔记与题库生态中理解、练习和复习英语”。然而，当前的 AI 翻译视图在视觉组织、交互心智和信息流上，仍然是一个通用的 Web 翻译框与多模型聚合 Playground 的粗糙拼接：

1. **缺失“英语学习”专属心智**：界面没有任何音标、分词释义、词性语法剖析或发音朗读（尽管底层具备 TTS 能力），也没有模型间的词汇差异高亮。它只把 AI 当成黑盒文本翻译器，而不是辅助语言学习的“翻译研读工坊”。
2. **割裂的宿主联动（假闭环）**：最体现 Obsidian 特色的两个核心操作——“制为闪卡”和“插入笔记”，在底层并未真正打通（`onCreateCard` 未传递，直接降级为向剪贴板写入纯文本；`onInsertNote` 在主视图激活时因找不到活动 Markdown 视图而 100% 触发回退报错）。这种“看似有插件生态按钮，实则全是剪贴板降级”的体验，严重背离了 Obsidian 深度集成工作台的承诺。

**静态规则扫描（Deterministic Scan）**：

- 机械检测器对 `src/features/translation/` 核心组件及样式表执行全量静态扫描，检出 **0 项违规（Exit Code: 0）**。
- **背景说明**：上轮评审检出的 `side-tab` 反模式（`.notice` 容器左侧粗橙色边框）及 `!important` 强调色覆盖已在 commit `78b3878` 中修复，移除了明显的 AI slop 机械特征，符合 `DESIGN.md` 的令牌规范。
- **深度代码取证补充发现**：
    - WAI-ARIA 结构残缺：声明了 `role="tablist"` 与 `role="tab"`，但下游输出容器（`.compareGrid` / `article.resultPanel`）缺失 `role="tabpanel"` 及对应的 `aria-controls` / `aria-labelledby` 关联。
    - 全局单一 Feedback 状态竞态：所有结果卡片共享同一个 `ActionFeedback` state，连续点击多个卡片的不同操作会互相覆盖打断。
    - 弱对比度潜在风险：底栏字号 `var(--fc-font-xs)` 配合 `var(--fc-faint)`，在部分 Obsidian 动态主题下难以达到 WCAG 4.5:1 对比度标准。

**视觉覆盖层（Visual Overlays）**：

- 宿主运行于 Obsidian Electron 桌面端（未挂载 `--remote-debugging-port=9222`），无自动化浏览器注入环境，已依规范基于实机截图与源码完成深度走查。

---

## Overall Impression

视觉整洁度相比最初有所规范（去除了刺眼的蓝绿色覆盖边框与粗橙色左条），但在真实渲染视图中暴露出严重的**空间布局失调**与**核心功能假闭环**：右侧 58% 容器强塞 3 列造成灾难性的文字“拉面条”与标题截断；“制卡”与“插入笔记”退化为剪贴板纯文本；垃圾桶一键清除缺乏保护。当前界面更像是一个多模型 API 调试脚手架，而不是一个能帮学习者研读英语、沉淀闪卡与笔记的成熟工作台。

---

## What's Working

1. **扎实的多引擎并行领域模型架构**：底层运行时优雅统一了传统 NMT（有道智云）与大语言模型（DeepSeek、通义百炼等），支持单次请求多通道并发，具备真正的对比分析数据底座。
2. **严谨的主题中性色继承**：严格贯彻 `DESIGN.md` 中“安静的学习工作台”原则，使用 `var(--fc-surface-card)`、`var(--fc-surface-section)` 等变量混色，在 Obsidian 亮暗模式下均具备良好的背景融合度与精致边框质感。
3. **沉浸式快捷键输入基石**：配备了 `Ctrl/Cmd + Enter` 触发、字符动态统计，以及外置的 `focusController` 自动聚焦与全选机制，具备开发优秀键盘流体验的良好底子。

---

## Priority Issues

### [P0] 核心学习闭环虚假失效（制卡与插入笔记退化为剪贴板纯文本）

- **Why it matters**: 用户使用 Study Studio 翻译的核心目的不是当剪贴板跳板，而是沉淀学习资料。`onCreateCard` 完全未接入真实卡片创建流程，`onInsertNote` 在主视图场景下由于获取活动 Leaf 失败必然报错，彻底摧毁了产品的核心价值主张。
- **Fix**: 在 `feature.tsx` 中接入真实卡片创建弹窗/抽屉；优化 `onInsertNote`，追踪“最后激活的 Markdown 编辑器 Leaf”，并在无法直接插入时提供笔记选择器，而非直接剪贴板降级。
- **Suggested command**: `/impeccable harden`

### [P1] 毁灭性的无确认/无撤销一键清空机制

- **Why it matters**: 垃圾桶按钮直接无状态清除 input 和全部内存结果。由于当前结果没有本地持久化与历史回溯，一旦误触，高成本（API 费用与等待时间）生成的长篇对比结果彻底灭失。
- **Fix**: 增加 Undo 恢复条（Toast 带“撤销”操作），或在有内容且未报错时限制一键清除必须长按/二次确认；保留最近一次翻译的内存草稿缓存。
- **Suggested command**: `/impeccable harden`

### [P2] 灾难性的三列畸形卡片布局与标题截断

- **Why it matters**: 58% 宽度容器强行三等分，每列仅 180-260px，导致标题变为 `Deep...`、`百..`，英文句子每行只能容纳 2-3 个词，完全丧失研读与对比价值；同时出现 `有道智云 有道智云` 的文本格式化 Bug。
- **Fix**: 重构对比模式：默认提供上下两栏或主从双列对比，或基于宽度的自适应分栏（单列宽度 < 320px 时自动转为垂直折叠/Tab 对比）；重构卡片 Header 布局，保证模型全名可读；修复 `cleanProfileSubtitle` 去重逻辑。
- **Suggested command**: `/impeccable layout`

### [P3] 孤立游离的翻译方向切换器

- **Why it matters**: `[ 英文 | ⇄ | 中文 ]` 悬浮在页面中央，脱离了左侧“原文”与右侧“译文”的物理排布，违背费茨定律与格式塔亲密性原则，视觉焦点分散。
- **Fix**: 将源语言标签内嵌到左侧输入框 Header（如“原文 · 英文”），目标语言内嵌到右侧 Header（如“译文 · 中文”），将反转切换按钮放置在两栏中间的分割线上或全局工具栏内。
- **Suggested command**: `/impeccable layout`

### [P3] 缺乏语言学习维度辅助（通用套壳感）

- **Why it matters**: 与网页版 Google Translate 毫无差异，浪费了 Study Studio 强大的发音与词库基建。
- **Fix**: 在译文与原文卡片中增加发音朗读按钮（TTS）、生词高亮查词悬浮浮层，并在多模型间提供“词汇差异高亮模式”（Diff Mode）。
- **Suggested command**: `/impeccable delight`

---

## Persona Red Flags

### 👤 Alex（效率型 Power User / Obsidian 重度笔记与 Anki 学习者）

- **走查路径**：在文献中选中文本 → 按快捷键唤起翻译 → 查看译文 → 期望快速把佳句制成 Anki 闪卡并插入当前笔记。
- 🚩 **Red Flags**:
    1. 无法键盘盲操：没有单键选择方案 1/2/3（如 `Cmd+1` 插入 DeepSeek，`Cmd+2` 插入百炼）。
    2. 点击“插入笔记”，因翻译视图抢占了 Active Leaf，提示“未检测到可编辑的 Markdown 笔记”，操作链中断。
    3. 想要微调一下译文中的一个单词再存入闪卡，发现译文输入框是 `readOnly`，被迫复制到外部编辑器修改。

### 👤 Jordan（新手初学者 / 英语考研或四六级备考者）

- **走查路径**：粘贴一段看不懂的长难句 → 点击翻译 → 试图理解不同模型的翻译差异并跟读。
- 🚩 **Red Flags**:
    1. 面对并排 3 个挤成细长拉面的文本框，眼睛来回扫视极度疲惫，不知道哪个译本更好。
    2. 看到卡片底部显示 `输入 34 · 输出 28 Token`，误以为自己超额消费或触发了某种技术限额，产生焦虑。
    3. 看到卡片右上角三个纯图标（`Layers`, `FileText`, `Copy`），看不懂“图层”图标到底会触发什么后果，不敢点击。
    4. 想要听一下英文原文和地道译文的标准发音，整个页面找不到任何扬声器图标。

### 👤 Sam（无障碍与低视力依赖用户）

- **走查路径**：使用屏幕阅读器或纯键盘 Tab 键进行翻译。
- 🚩 **Red Flags**:
    1. 卡片操作反馈（`feedbackTag`）出现于卡片底部且只有 1.8 秒，既没有 `aria-live` 区域播报，也脱离焦点元素，读屏器完全感知不到“已复制”或“已插入”。
    2. 顶部方向指示器结构混杂，使用 `strong` 结合纯图标按钮，屏幕阅读器无法清晰获知当前是“从英译中”还是“从中译英”。

---

## Minor Observations

1. **副标题冗余展示 Bug**：有道智云无 model 字段时，副标题回退为提供商名，界面显示 `<strong>有道智云</strong> <span>有道智云</span>`。
2. **空状态冷清无趣**：未输入时，右侧硬生生展示 3 个带大面积空白灰色边框的死卡片，占满半屏，缺乏有温度的引导或样例。
3. **禁用状态对比度**：清空与翻译按钮在禁用时对比度过低，清空图标几乎与背景融为一体。
4. **Token 统计文字层级倒错**：使用 `var(--fc-faint)` 贴在右下角，但由于紧挨操作反馈，视觉重心分散。
5. **Notice 样式脱节**：未配置方案时的提示条采用 `var(--fc-orange)` 混色，与整体“清透青”的宁静工作台品牌感略有冲突。

---

## Questions to Consider

1. **“如果把 Study Studio 的 Logo 拿掉，这个页面和市面上任意一个开源的 Web AI 翻译 Demo 有什么本质区别？”**  
   ——我们究竟在为 Obsidian 语言学习者提供什么不可替代的价值？
2. **“并排对比（Compare All）真的必须是 3 个并立的垂直拉面条吗？”**  
   ——能否采用类似专业翻译软件的“对照表格模式”或“智能高亮融合模式”，以词句级 Diff 呈现多模型差异？
3. **“为什么‘制为闪卡’不能直接唤起一张所见即所得的卡片预览抽屉，允许用户挑选牌组、高亮填空（Cloze），再一键归档？”**
