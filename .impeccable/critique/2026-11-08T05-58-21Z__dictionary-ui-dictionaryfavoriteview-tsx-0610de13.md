---
target: 收藏单词界面
total_score: 17
max_score: 40
na_heuristics:
p0_count: 1
p1_count: 1
target_identity: "file:/Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/dictionary/ui/DictionaryFavoriteView.tsx"
target_fingerprint: "sha256:7de108b4cb3f169b029f57e14cf789c9a64c7fc8b55d7897faf118f921f1caf3"
target_path: /Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/dictionary/ui/DictionaryFavoriteView.tsx
timestamp: 2026-11-08T05-58-21Z
slug: dictionary-ui-dictionaryfavoriteview-tsx-0610de13
---

# 收藏单词界面 UX 设计评审 (Design Critique)

### Design Health Score

| #         | Heuristic                                               |   Score   | Key Issue                                                                                              |
| --------- | ------------------------------------------------------- | :-------: | ------------------------------------------------------------------------------------------------------ |
| 1         | Visibility of System Status                             |     2     | 保存成功缺乏显著反馈；AI 生成中仅按钮文字微变，文本框无骨架/流式动画；保存目标文件无直观路径提示。     |
| 2         | Match Between System and Real World                     |     2     | 偏向生硬的数据库记录录入，缺乏音标、读音试听、例句高亮等真实语言学习实体的自然表达。                   |
| 3         | User Control and Freedom                                |     2     | 「清空表单」为一键毁灭性操作，没有撤销（Undo/Cmd+Z）支持，也没有二次确认弹窗。                         |
| 4         | Consistency and Standards                               |     2     | 外部链接图标（ExternalLink）用于打开内部 Markdown 文件造成认知混淆；保存主按钮被夹在两个次级按钮中间。 |
| 5         | Error Prevention                                        |     1     | 高危清空按钮无防误触保护；未配置 AI 引擎时点击直接在底部抛红字，缺乏前置校验与跳转设置引导。           |
| 6         | Recognition Rather Than Recall                          |     1     | 用户需自行回忆或查找单词音标与释义；快捷键（Ctrl+Enter/Enter）完全隐藏在代码中，依赖用户盲猜。         |
| 7         | Flexibility and Efficiency                              |     3     | 内部支持 Enter 触发 AI、Ctrl/Cmd+Enter 跨控件极速保存，底层快捷键闭环优秀，但未在界面暴露。            |
| 8         | Aesthetic and Minimalist Design                         |     1     | 435px 的固定死高（115px + 320px）产生大片冰冷空白，元素比例失衡，缺少卡片容器节奏。                    |
| 9         | Help Users Recognize, Diagnose, and Recover from Errors |     2     | 错误信息只在底部以红字形式单行展示，表单控件自身没有内联错误高亮与修复建议。                           |
| 10        | Help and Documentation                                  |     1     | 缺少关于“如何利用 Markdown 笔记组织生词库”的帮助提示，缺少 AI 引擎配置的就近跳转指引。                 |
| **Total** |                                                         | **17/40** | **Poor (差 · 亟需重构)**                                                                               |

---

### Design Specificity Verdict

**LLM assessment**:
当前「收藏单词」界面严重缺乏特定于语言学习工作台的产品独特性，高度同质化为一套千篇一律的通用 CRUD 数据录入表单。界面自上而下机械平铺 4 个全宽控件，既没有发音/音标、词性胶囊标签、例句高亮等英语学习的核心实体表征，也完全看不到写入 Markdown 闪卡库后的卡片效果预览。未能落实 `DESIGN.md` 所倡导的“安静的学习工作台：克制、清晰、紧凑”原则，反而因大面积固定高度的文本域产生了空洞与心理压迫。

**Deterministic scan**:

- `DictionaryFavoriteView.tsx`: 0 项语法规则违规。全面使用了规范的 UI 原语组件（`FlashcardInput`, `FlashcardSelect`, `FlashcardButton`, `FlashcardTextarea`），无直接内联样式或生硬的渐变光晕反模式。
- `Dictionary.module.scss`: 检出 1 项 Advisory 警告（Line 369 未文档化颜色 `#10b981`），经代码上下文归因，该类名为查词结果复制专属样式，收藏单词界面未引用，定性为**伪阳性**。但人工审查发现样式中硬编码了固定像素高度（`115px` 和 `320px`）。

**Visual overlays**:
未检测到开启远程调试端口（`--remote-debugging-port=9222`）的 Obsidian 实例，且环境中无直接浏览器自动化测试工具，已跳过 DOM 实时覆盖层注入。

---

### Overall Impression

底层架构（生命周期、并发锁、快捷键支持）设计非常扎实，但视觉交互呈现完全停留在“数据库后台数据录入框”阶段。大面积空白文本域制造了严重的认知负荷与空白恐慌，AI 生成动线严重折返，且毁灭性操作“清空表单”与“保存收藏”紧挨，极易引发学习过程中的挫败感。将表单转变为“生词卡片实时锻造与预览”是实现质变的最大契机。

---

### What's Working

1. **底层快捷键与效率闭环完整**：组件深度监听了键盘事件，在单词框按 `Enter` 触发 AI 生成、任意位置 `Ctrl/Cmd + Enter` 极速保存，为高频录入提供了扎实的底层效率支撑。
2. **状态机与会话并发控制严密**：`DictionaryFavoriteSession` 具备严格的互斥锁（`runExclusive`）、会话版本号校验（`lookupRevision`）以及跨 Modal/Sidebar 双宿主表面的解耦同步机制。
3. **忠实贯彻 Markdown 内容权威**：直接以 Obsidian 库内具体的 Markdown 文档为归档目标，支持查看源文件，符合产品数据完整性承诺。

---

### Priority Issues

- **[P0] 毁灭性操作「清空表单」与主操作「保存收藏」紧挨且无确认**
    - **Why it matters**: 用户输入长笔记或等待 AI 生成后，极易发生误触，导致辛苦记录的内容瞬间蒸发且无法撤销。
    - **Fix**: 从底部主操作栏移除「清空表单」，将其降级为右上角小尺寸幽灵图标，或增加二次确认与撤销（Undo）机制；让「保存收藏」独占主操作视觉焦点。
    - **Suggested command**: `/impeccable harden`

- **[P1] 固定像素死高（115px + 320px）引发「空白巨洞」与视口挤压**
    - **Why it matters**: 两个输入框固定占据 435px 像素高度，初次进入时宛如荒漠，制造强烈的空白焦虑，并在侧边栏狭窄分栏中强行产生双重滚动条。
    - **Fix**: 改造为自适应伸缩文本域（Auto-expanding Textarea）；「中文意思」初始高度设定为 2-3 行，「笔记」采用渐进式披露（默认紧凑收起，需要时展开）。
    - **Suggested command**: `/impeccable layout`

- **[P2] 语言学习领域特征缺失（Domain Blindness），缺乏生词实体感**
    - **Why it matters**: 界面除了“单词”两个字外，没有任何音标、词性胶囊、发音按钮或闪卡外观感知，用户无法确认学习质量。
    - **Fix**: 引入「生词卡片 Hero」结构：输入单词后自动联动展示音标与发音，释义区域支持快速词性标注，底部提供实时微缩卡片预览。
    - **Suggested command**: `/impeccable shape`

- **[P3] AI 生成操作与输入源、产出物空间割裂，交互动线反复折返**
    - **Why it matters**: AI 按钮被丢在最底部左侧，与输入源（顶部的单词）和填充目标（中部的释义与笔记）距离过远，违背格式塔邻近原则。
    - **Fix**: 将 AI 触发融合到单词输入框内部右侧（内置魔法棒按钮或快捷键徽章），输入完成后可一键触发就地补全。
    - **Suggested command**: `/impeccable clarify`

---

### Persona Red Flags

- **Alex (追求效率的高阶学习者)**: 打开表单后必须把视线从顶部单词跳到最底部寻找 AI 按钮，点击生成后再折返看释义；保存完成后 Modal 弹窗直接消失，没有任何存入提示，打断阅读与制卡心流。
- **Jordan (初用 Obsidian 的新手小白)**: 面对 320px 的巨大空白笔记框感到迷茫不知所措；看到「保存分类」下的下拉项与外部链接图标误以为会跳到网页；AI 未配置时点击直接弹出一行突兀红字，没有提供一键跳转至设置页面的链接。
- **Sam (键盘与无障碍依赖者)**: Tab 键遍历路径长且需穿过大片空白的多行输入框；`ExternalLink` 图标语义不明确；误触清空表单时缺乏防护屏障。

---

### Minor Observations

1. **色彩层级分散**：标题紫、聚焦青框、实色青按钮、灰色次级按钮混搭，缺乏统一的调色板统合。
2. **新建分类入口隐蔽**：新建分类选项作为 `__new__` 混在下拉列表最后，可发现性低。
3. **外链图标指向不透明**：外链图标打开的是内部 Markdown 笔记，但界面未向用户展示具体保存的目标文件路径。
4. **字数与容量无反馈**：代码设置了 8000 和 16000 字符限制，但界面无任何字数计数器或进度指示。
5. **成功反馈位置处于视觉盲区**：底部单行 `<output>` 提示字体偏小，操作成功后缺乏情感激励。

---

### Questions to Consider

1. **「收藏单词」到底是一项繁琐的「数据填报任务」，还是一次让人愉悦的「生词卡片锻造」？** 如果直接展现一张双面微缩卡片，正面打字、背面由 AI 流式浮现释义与例句，体验会有多大提升？
2. **AI 在这里应该是一个「被动等待点击的遥远按钮」，还是「如影随形的主动副驾驶 (Copilot)」？** 是否可以在单词输入完成或失焦时，就地提供建议胶囊一键采纳？
3. **「清空表单」在现代生产力界面中是否还有任何保留价值？** 既然弹窗可以随时关闭，为什么不彻底移除这个危险的误触炸弹？
