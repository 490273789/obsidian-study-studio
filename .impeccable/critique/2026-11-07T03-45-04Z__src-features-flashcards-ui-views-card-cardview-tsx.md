---
target: 闪卡答题页面
total_score: 23
max_score: 40
na_heuristics:
p0_count: 1
p1_count: 2
target_identity: "file:/Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/flashcards/ui/views/Card/CardView.tsx"
target_fingerprint: "sha256:043baa668063d5b3ec036c275d30df17705ee0efa27cca3b7cb91ac6d0d31b5e"
target_path: /Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/flashcards/ui/views/Card/CardView.tsx
timestamp: 2026-11-07T03-45-04Z
slug: src-features-flashcards-ui-views-card-cardview-tsx
closed: true
---

### Design Health Score

| #         | Heuristic                                        |   Score   | Key Issue                                                                                                                 |
| --------- | ------------------------------------------------ | :-------: | ------------------------------------------------------------------------------------------------------------------------- |
| 1         | Visibility of System Status (系统状态可见性)     |     2     | 计时器秒表跳动制造焦虑，进度条细弱；自动发音图标状态与行为二义；翻卡切换位移动画过弱。                                    |
| 2         | Match System / Real World (贴合现实世界)         |     2     | 顶部卡片与底栏被 300~400px 巨大空白死区切断，违背物理卡片完形；发音图标独立悬挂于单词上方，打碎词典阅读动线。             |
| 3         | User Control and Freedom (用户控制与自由度)      |     3     | 支持快捷键 6 与撤销按钮，底层状态机完善；但撤销缺少即时反馈，关闭退出缺少保存确定感。                                     |
| 4         | Consistency and Standards (一致性与行业标准)     |     2     | **严重色彩冲突**：评分 3（记得）与评分 5（熟练）共用相同的高亮青色，破坏渐进色阶；评分 3 快捷键为 `3/空格` 导致宽度变形。 |
| 5         | Error Prevention (防错机制)                      |     3     | 翻卡期间具备 `isTransitioning` 禁用保护；但 5 颗紧凑排列且时间跨度极大（1分钟到21天）的按键容易手滑误判。                 |
| 6         | Recognition Rather Than Recall (识别优于回忆)    |     3     | 评分按钮明确标明 FSRS 间隔（1分钟、1天、3天、10天、21天）；但卡片解释区内未对“音标、词性、词根、例句”做特征化排版。       |
| 7         | Flexibility and Efficiency (灵活性与效率)        |     2     | 全键盘流（空格翻卡、1-5评分、6撤销）顺畅；但桌面鼠标操作由于上下割裂导致菲茨定律（Fitts' Law）移动距离过长。              |
| 8         | Aesthetic and Minimalist Design (审美与极简设计) |     2     | 视觉层级扁平，核心目标词仅 18px 毫无重心；屏幕中央横亘巨大虚无荒地；底栏 5 颗按钮挤压 15 项文字标签，密噪失衡。           |
| 9         | Error Recovery (帮助识别与恢复错误)              |     3     | 撤销功能可用；但没有恢复后的微动效或轻 Toast 确认；发音遇网络或离线故障缺少降级表达。                                     |
| 10        | Help and Documentation (帮助与文档)              |     1     | 缺乏首次学习引导、FSRS 间隔算法机制说明与快捷键浮层（如 `?` 帮助快捷键）。                                                |
| **Total** |                                                  | **23/40** | **Acceptable (及格边缘 / 亟待系统性改良)**                                                                                |

---

### Design Specificity Verdict (设计特异性评定)

**LLM 设计评审结论**：
当前答题页面呈现为 **Generic / Interchangeable (通用模板感严重，缺乏产品专属质感)**。

- **违背设计定位**：`PRODUCT.md` 明确受众为“以中文为主要语言、使用 Obsidian 管理学习资料的英语学习者”；`DESIGN.md` 定位为“安静的学习工作台：克制、清晰、紧凑，让阅读内容优先”。但当前界面像早期简易 Web 工具粗暴拉伸到宽屏桌面视口，既无专业词典的文字考究，也无 Obsidian 沉浸专注的纸质笔记质感。
- **桌面视口割裂与空间失衡**：卡片死贴视口顶部，打分栏沉底，中间横亘 300~400px 巨大空白。短内容在 1024px+ 宽容器中极度空洞，完全丧失了实体抽认卡“握在手中”的聚焦感。
- **英汉词汇动线破碎**：核心词汇（"volunteer"）采用与正文同级的 18px 细字体；发音按钮因换行被单独顶在单词上方，打破了“看词 → 看音标 → 听发音”的标准眼动路径；词根、词缀、例句全挤在一个灰底框内，缺乏词典级排版分块。

**确定性静态扫描 (Deterministic scan)**：

- 静态 AST 规则扫描：**0 rules triggered / 0 findings**（退出码 0）。
- 代码规范度极佳：严格使用 `--fc-*` 语义变量与 `color-mix`，前期指出的 4px `side-tab` 侧边装饰条、空格键错位映射及冗余 `flashcard-label` 已彻底重构修复。
- 扫描边界说明：静态模式下无法动态探测 Obsidian 亮暗主题切换下的对比度（Low Contrast）及极端视口宽度下的文字截断。

**可视化覆盖层 (Visual overlays)**：

- 目标运行于 macOS Electron 架构下的 Obsidian 桌面端宿主，未开放远程调试 CDP 端口（9222）。依据规范跳过 CDP 蒙层注入，基于代码溯源与实机截图提供完整证据链。

---

### Overall Impression (总体印象)

答题页面的核心状态机、FSRS 算法调度与全键盘交互坚实可靠，前期结构性硬伤（如 side-tab、空格键错位）已彻底修复。但当前**视觉呈现与空间布局严重脱节**：宽屏下顶部卡片与底端按钮割裂、核心单词仅 18px 缺乏统治力、发音按钮孤立换行、底栏 5 颗按钮文字噪点过密、顶栏秒表制造无谓焦虑。它亟需从“分散的工具控件”升华为一个“克制、凝聚、居中专注的现代语言学习工作台”。

---

### What's Working (突出亮点)

1. **响应丝滑的全键盘流与状态机解耦**：空格翻卡、1-5 键评分、6 键撤销流畅无卡顿，底层 `AnswerPresentationTransition` 逻辑严谨，防重击保护健全。
2. **直观前瞻的 FSRS 间隔透出**：下一次复习时间（1分钟、1天、3天、10天、21天）直接标注在评分按钮上，学习者对记忆负荷与复习进度具备高度掌控感。
3. **尊重 Markdown 权威与纯净单卡容器**：相比早期三段式生硬方块，重构后的卡片收敛为统一阅读表面，忠实支持 Markdown 富文本渲染与二语笔记内容。

---

### Priority Issues (核心缺陷与优先级)

#### [P0] 桌面视口空间断层与排版重心失衡 (Desktop Spatial Disconnect)

- **Why it matters**：卡片贴顶、操作栏沉底，中间横亘 300~400px 空白死区，不仅破坏抽认卡的完形心理，还导致桌面鼠标移动路径过长，宽屏下极为松散空洞。
- **Fix**：
    1. 重构 `SessionLayout`：将卡片容器垂直方向置于**黄金比例居中**（视口垂直约 40%~45% 位置）；
    2. 收紧卡片最大阅读宽度至 `680px ~ 720px`；
    3. 将底部打分操作栏上移，紧跟在卡片下方或融合为卡片托底，重塑卡片实体凝聚感。
- **Suggested command**：`/impeccable layout`

#### [P1] 核心词汇视觉层级扁平与英汉排版失格 (Flat Hierarchy & Broken Lexical Typesetting)

- **Why it matters**：单词（"volunteer"）仅 18px，缺乏视觉锚点；发音按钮因 `flex-direction: column` 孤立悬挂在词汇上方，打碎了音形结合的自然阅读顺序；解释区堆砌无分级。
- **Fix**：
    1. 将正面单词字号提升至 `32px ~ 36px`（Semibold，加大字距），确立绝对视觉重心；
    2. 重构发音组件为**行内胶囊徽标**，紧随在单词/音标右侧：`volunteer [🔊] /ˌvɒlənˈtɪə(r)/`；
    3. 结构化解释框：词性采用胶囊小标（如 `[n.]`），词根词缀使用小字号次弱色，双语例句中英分行且英文加深，呈现词典级精致感。
- **Suggested command**：`/impeccable typeset`

#### [P1] 评分控件视觉语义冲突与信息过载 (Chromatic Conflict & Rating Clutter)

- **Why it matters**：评分 3（记得）与评分 5（熟练）共用青色主色（`--fc-primary`），破坏难度递进心智；Badge 显示为 `"3/空格"` 导致宽度畸形；5 个按钮同时展示 15 个细小文本，信息密度过载。
- **Fix**：
    1. 纠正色阶：建立严格递进的色彩序列（1忘: 红, 2困: 橙, 3记: 蓝, 4轻: 绿, 5熟: 紫）；
    2. 规范徽标：统一 Badge 尺寸仅显示数字 `3`，将空格提示弱化置于底部说明；
    3. 降噪：弱化时间标签的对比度，突出“掌握状态”这一核心决策维度。
- **Suggested command**：`/impeccable polish`

#### [P2] 顶栏信息杂乱与无效焦虑计时器 (Cluttered Chrome & Anxiety Stopwatch)

- **Why it matters**：顶栏堆积 7 个微小元素，精确到秒的秒表持续跳动制造考试焦虑，违背“安静学习”原则；进度条细如发丝；`VolumeX` 存在状态/动作二义性。
- **Fix**：
    1. 默认隐藏学习模式下的答题秒表（仅在限时挑战模式展示）；
    2. 合并进度数字与进度条为紧凑胶囊（如 `1/49 ━ 2%`）；
    3. 明确发音切换按钮的激活状态背景色与悬浮 Tooltip。
- **Suggested command**：`/impeccable quieter`

---

### Persona Red Flags (典型用户走查红线)

- **Alex (高频刷词备考党)**：每天过 150 张考研/雅思词汇。痛点：发音图标悬在词上方，视线上下折返；盲打时眼角余光看到评分 3 和 5 都是青色高亮，无法通过色块确认是否误按；误按后按 6 撤销，由于缺乏即时 Toast 提示，不确定是否撤回成功，心流被打断。
- **Jordan (首次使用新手)**：刚从生词本开启复习。痛点：一进界面看到右上角秒表一秒一秒跳动，误以为有答题时限而恐慌；翻卡后看到 5 个按钮密密麻麻排着“1分钟、1天、3天、10天、21天”，大脑瞬间陷入不知道该按记忆牢固度还是按复习间隔打分的分析瘫痪。
- **Sam (低视力 / 弱光学习用户)**：在笔记本高分屏或夜晚弱光下学习。痛点：英文单词只有 18px 且是细笔画衬线体，辨识极费力；解释框内的灰底配弱灰文字（`--fc-muted`）对比度严重不足；底部按钮 11px 彩色小字在弱光下无法看清。

---

### Minor Observations (次要观察项)

1. **题库名称缺少包装**：顶栏 `SeniorHeighSchool`（包含原笔记拼写错误）直白裸露，缺乏图书/分类小图标修饰，长文本缺少截断。
2. **撤销按钮视觉孤立**：左下角的方形纯图标按钮在 5 颗大评分块旁显单薄孤立，两端缺乏视觉平衡。
3. **词性标注未分化**：`n. 志愿者` 中 `n.` 与释义粘合在一起，缺少斜体或微胶囊衬托。

---

### Questions to Consider (深度设计追问)

1. **桌面闪卡的大屏形态究竟是什么？** 是否应当摒弃“拉满通栏”的网页思维，将卡片重塑为一个物理感强烈、内容与操作高度自洽的**黄金比例居中专注卡片（Centered Focus Card）**？
2. **声音是否应当成为词汇卡片的第一公民？** 对于中国英语学习者，听觉是激活记忆的第一通道。能否探索“单词与音标发音联动、点击词汇即刻发声”的自然交互，彻底终结孤立发音小图标？
3. **五档评分是否真的优于三档？** 在现代 FSRS 实践中，过多的评级往往带来认知内耗。是否应该在设置中提供“极简三档（忘记 / 记得 / 熟练）”，彻底解放决策疲劳？
