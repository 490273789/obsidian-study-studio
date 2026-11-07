---
target: spelling page
total_score: 25
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 2
target_identity: "file:/Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/flashcards/ui/views/Spelling/SpellingView.tsx"
target_fingerprint: "sha256:9cc74dcf8357b24b62863665401d283e5298976a49a8d127ee57bad5ccd6c1d7"
target_path: /Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/flashcards/ui/views/Spelling/SpellingView.tsx
timestamp: 2026-11-07T04-52-01Z
slug: hcards-ui-views-spelling-spellingview-tsx-ec56a0a5
---

## 设计健康度评分 (Design Health Score)

| #        | 启发式原则 (Heuristic)                           |   得分    | 关键问题 (Key Issue)                                                                                                            |
| -------- | ------------------------------------------------ | :-------: | ------------------------------------------------------------------------------------------------------------------------------- |
| 1        | 系统状态可见性 (Visibility of System Status)     |     3     | 顶部已具备 `1/20` 进度条与状态标题，但订正状态下的焦点指引与错误定位层级较弱                                                    |
| 2        | 系统与真实世界匹配 (Match System / Real World)   |     3     | 词根拆解（`root: calli = beautiful`）符合中国学习者认知；但字符级格子 Diff 布局极易让用户误解为填字游戏或可交互输入块           |
| 3        | 用户控制与自由 (User Control and Freedom)        |     2     | 订正阶段锁定必须全词重输，缺少跳过、直接发音、或复制提示等退避手段                                                              |
| 4        | 一致性与标准 (Consistency and Standards)         |     2     | 顶部工具栏沿用 Obsidian 习惯，但反馈区与输入区大量滥用非标准的 3px 单侧边框（side-tab），底栏“确认订正”按钮饱和度与圆角也显突兀 |
| 5        | 防错原则 (Error Prevention)                      |     3     | 空输入禁用（`input.trim().length === 0`）有效，但订正再次拼错时只有死循环报错，缺少渐进式提示防挫败                             |
| 6        | 识别胜过回忆 (Recognition Rather Than Recall)    |     2     | 标准答案分散出现在反馈区与释义区，而 Diff 视觉割裂使得用户难以整体识别单词外形轮廓                                              |
| 7        | 灵活性与使用效率 (Flexibility and Efficiency)    |     2     | 支持键盘 `Enter`，但缺少快捷发音（无音频重放按钮）、一键填充或快速跳过机制                                                      |
| 8        | 美观与简约设计 (Aesthetic and Minimalist Design) |     2     | 容器多层嵌套（卡片套反馈框套 Diff 框套释义框套输入框），视觉岛屿碎片化，红色警示与波浪线压迫感过重                              |
| 9        | 帮助用户识别、诊断与恢复错误 (Error Recovery)    |     3     | 能够精确指出错位字符（如 `new` vs `phy`），但恢复成本过高（11个字母必须从头完整重打）                                           |
| 10       | 帮助与文档 (Help and Documentation)              |     3     | 音标与词根词缀注释是非常好的就地辅助，但缺少即时发音听觉辅助                                                                    |
| **总分** |                                                  | **25/40** | **可接受 (Acceptable，亟需显著改进)**                                                                                           |

## 设计专属性评估 (Design Specificity Verdict)

- **专家评估 (LLM Assessment)**：
    - **产品特征落地良好**：针对中国学习者的英语词汇拼写场景，在订正界面直接引入音标、词根词缀拆解（`calli = beautiful`, `graph = write`）与中英双语例句，这非常精准地切中了“通过结构化理解记忆单词”的定位，避免了纯机械重复。
    - **结构碎片化与模板感严重**：当前界面退化为“多层边框岛屿堆叠”（反馈框、释义框、重输框各自为政，浮在大量空白中）。字符级 Diff 将字母分割为一个个带描边的矩形格子，破坏了英文单词固有的连续外形轮廓（Word Contour），且与通用填字格视觉产生混淆。整体缺乏《DESIGN.md》所强调的“安静的学习工作台：克制、清晰、紧凑”的气质。
- **确定性扫描 (Deterministic Scan)**：
    - 检测器在 `src/features/flashcards/ui/views/Spelling/` 命中 **2 项 warning 违规**：
        - [Spelling.module.scss#L16](file:///Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/flashcards/ui/views/Spelling/Spelling.module.scss#L16)：`.inputGroup` 包含 `border-inline-start-width: 3px;`（违反 `side-tab` 规则）。
        - [Spelling.module.scss#L28](file:///Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/flashcards/ui/views/Spelling/Spelling.module.scss#L28)：`.feedback` 包含 `border-inline-start-width: 3px;`（违反 `side-tab` 规则）。
    - **无误报判定**：这两处 3px 单侧边框未赋予任何状态颜色（依旧是 `--fc-line-soft`），却搭配 6px 圆角，属于典型的模板化不对称边框残余，加剧了界面容器的厚重与拼贴感。
- **视觉图层 (Visual Overlays)**：
    - 因 Obsidian 桌面端运行且未暴露 `--remote-debugging-port=9222`，动态脚本注入 overlay 自动跳过；评估直接依托用户提供的实机界面截图与源代码静态证据。

## 整体印象 (Overall Impression)

功能逻辑闭环且教研意图明确（通过词根释义引导订正），但视觉呈现显得紧绷、碎片化且带有惩罚感。多层嵌套边框与字符拼贴打破了沉浸感，把一次学习转机变成了充满红色警告的“填表受罚现场”。最大的机会在于将“多框岛屿”收拢为单一流畅的信息流，把冷冰冰的报错转化为优雅的跟读订正工作台。

## 做得好的地方 (What's Working)

1. **词根词缀与例句就地脚手架**：在错误订正阶段提供词根（`calli`、`graph`、`-y`）与双语例句，直接在认知挫折处补强记忆支点。
2. **细致的字符级 Diff 算法支撑**：底层引擎能够准确分辨正确、替换、多余与缺失字符，具备精准引导的潜力。
3. **顶栏轻量连续性**：保留了词库归属（`SeniorHeighSchool`）、答题进度（`1/20`）与优雅的退出入口，未破坏全局节奏。

## 重点问题 (Priority Issues)

### [P1] 边框岛屿堆叠与三层容器嵌套，破坏视觉流

- **问题 (What)**：反馈区、词根释义区、重新输入区被拆分成 3 个各自带边框与背景的独立卡片，且使用了检测器告警的 3px `side-tab` 粗边框，内部 Diff 框又再套一层背景边框。
- **影响 (Why)**：视线在多个封闭矩形之间来回跳跃，产生严重的表单疲劳感，破坏了学习专注度。
- **修复 (Fix)**：打破独立卡片边界，将反馈、词根释义与输入统一整合在主卡片表面内；移除所有 3px `side-tab`，改用统一的 1px 细线或纵向间距自然排版。
- **建议命令**：`/impeccable layout`

### [P1] 字符级独立线框 Diff 割裂单词轮廓并产生假可交互暗示

- **问题 (What)**：Diff 将每个字母包裹在带有底边或虚线描边的 `<span>` 方块中，看起来像填字游戏或可点击选取的字母牌。
- **影响 (Why)**：阻碍英文整体词形（Word Silhouette）的自然识读，且诱导用户进行无效点击。
- **修复 (Fix)**：保持单词整体连续排版，通过字符下方的温和标线或颜色变化指示差异，而非给每个字母加框。
- **建议命令**：`/impeccable polish`

### [P2] 惩罚性视觉语汇过重，违背“安静工作台”原则

- **问题 (What)**：醒目的红色 `✕` 图标、红色边框、淡粉红背景混色（`color-mix 3% red`）及红色波浪线，视觉压迫感过强。
- **影响 (Why)**：拼错是学习的正常过程，高烈度报错容易引发学习焦虑与疲劳。
- **修复 (Fix)**：弱化警示烈度，移除大面积粉红背景混色；使用克制的柔和提示（如中性灰/低饱和琥珀色）表达“订正复习”状态。
- **建议命令**：`/impeccable quieter`

### [P2] 全词重复输入的认知损耗与信息重复

- **问题 (What)**：输入错误后必须从第 1 个字母重新完整打出整词（如 11 位的 `calligraphy`），且界面上分散出现多处重复的标准答案。
- **影响 (Why)**：即使只是最后 1 个字母拼错，也会带来极高的机械打字摩擦力，打断思考。
- **修复 (Fix)**：将标准答案与输入框紧密结合（如在输入框内提供幽灵字符 ghost text 或就地对齐），并在长词纠错时允许渐进补全。
- **建议命令**：`/impeccable distill`

### [P3] 订正阶段缺失发音听觉辅助

- **问题 (What)**：界面展示了音标 `/kəˈlɪɡrəfi/`，但订正状态下发音被静音，且无音频重播按钮。
- **影响 (Why)**：英语拼写与读音强绑定，缺少听觉反馈削弱了多感官记忆效果。
- **修复 (Fix)**：在音标旁边提供发音喇叭按钮及快捷键（如 `Ctrl/Cmd+P` 或双击发音）。
- **建议命令**：`/impeccable clarify`

## 用户角色红线 (Persona Red Flags)

- **Alex (追求效率的高级用户 / Power User)**：
    - 拼写只错了一个尾缀却被迫把 11 个字符重新从头敲一遍，没有任何跳过或一键采纳快捷键，极易产生烦躁感并直接关闭插件。
    - 提交按钮标注了回车图标，但没有任何键盘快捷提示徽标（Key badge），全键盘操作时反馈不够明确。
- **Jordan (初次使用的学习者 / First-Timer)**：
    - 看到中间彩色的字母方块，下意识以为可以拖拽或点击字母进行修改，多次点击无反应后感到困惑。
    - 界面上同时出现两个像输入框的区域（上面的 Diff 浅灰框与下方的粉边输入框），搞不清应该在哪里输入。
- **Sam (无障碍与键盘依赖用户 / Accessibility-Dependent)**：
    - `.diffMissing` 使用 `--fc-amber` 颜色与虚线，在浅色主题下对比度不满足 WCAG AA 4.5:1 要求。
    - 输入框在订正模式下默认带有 `aria-invalid` 导致的粉红轮廓，与系统标准的焦点环形成冲突。

## 次要观察 (Minor Observations)

- 底部“确认订正”按钮使用了浅蓝/青色药丸按钮，与整体沉稳的书卷风格略有脱节，且在宽屏桌面端距离上方输入区过远。
- 释义标题 `n. 书法；书法艺术` 为衬线字体，而下方的词根解析为无衬线字体，虽然符合内容/UI分层规范，但垂直间距过大导致排版不够紧凑。

## 启发性思考 (Questions to Consider)

1. _如果订正不是“重新填写一个表单框”，而是直接在原单词上方进行“内联渐进式敲击覆盖”，会不会更自然、更有成就感？_
2. _对于长单词（如 10+ 字母），当用户拼对 80% 时，系统是否可以提供首字母/音节锚点，避免机械式完全重打？_
3. _如何让音标与发音音频成为订正界面的主角，而不仅仅是一行静态文字？_
