---
target: spelling page
total_score: 22
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
target_identity: "file:/Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/flashcards/ui/views/Spelling/SpellingView.tsx"
target_fingerprint: "sha256:9cc74dcf8357b24b62863665401d283e5298976a49a8d127ee57bad5ccd6c1d7"
target_path: /Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/flashcards/ui/views/Spelling/SpellingView.tsx
timestamp: 2026-11-07T04-54-14Z
slug: hcards-ui-views-spelling-spellingview-tsx-ec56a0a5
---

## 设计健康度评分 (Design Health Score)

| #        | 启发式原则 (Heuristic)                            |    得分     | 关键问题诊断 (Key Issues)                                                                   |
| -------- | ------------------------------------------------- | :---------: | ------------------------------------------------------------------------------------------- |
| 1        | 系统状态可见性 (Visibility of System Status)      |      3      | 顶部工具栏进度 `1/20` 清晰；但订正成功后的跳转过快生硬，缺乏自然状态过渡。                  |
| 2        | 系统与现实世界匹配 (Match System / Real World)    |      2      | **算法思维凌驾于认知规律**：字符级 Diff 拼出了 `calligranew` 畸形词，破坏正字法与音形映射。 |
| 3        | 用户控制度与自由 (User Control and Freedom)       |      2      | 订正阶段强制闭环，移除了“不知道/跳过”入口，生僻词或歧义输入时极易陷入死锁。                 |
| 4        | 一致性与标准 (Consistency and Standards)          |      2      | 反馈区与输入区使用了非标准的 3px 单侧边框（side-tab），且底部“确认订正”按钮视觉孤立。       |
| 5        | 防错原则 (Error Prevention)                       |      2      | 缺乏输入预处理容错（如首尾多余空格、大小写提示），订正状态下输入框过早染红报错。            |
| 6        | 识别胜过回忆 (Recognition Rather Than Recall)     |      3      | 显示了标准答案供参考，但被埋在醒目的错误 Diff 之下，有效词形识别效率较低。                  |
| 7        | 灵活性与使用效率 (Flexibility and Efficiency)     |      2      | 全程无音频发音快捷键，缺少一键填充或音节分段提示，长词错误重试成本极高。                    |
| 8        | 优美而简约的设计 (Aesthetic & Minimalist Design)  |      1      | **多达 5 层卡片/线框嵌套**，红黄青灰色彩杂乱，字符方块林立，视觉噪音严重超标。              |
| 9        | 帮助识别、诊断与恢复错误 (Help Users with Errors) |      2      | 能够定位差异，但机器对齐生成的拼合词不仅无法辅助诊断，反而误导记忆；全词重输恢复成本高。    |
| 10       | 帮助与文档 (Help and Documentation)               |      3      | 音标与词根词缀是极佳的就地脚手架，但虚线框与波浪线等图例含义缺乏直观解读。                  |
| **总分** |                                                   | **22 / 40** | **可接受 (Acceptable，亟需结构性升级)**                                                     |

## 设计专属性评估 (Design Specificity Verdict)

- **专家评估 (LLM Assessment)**：
    - **产品核心定位脱节（发音缺席）**：Study Studio 定位为“面向中文用户的英语学习工作台”，而拼写记忆的核心纽带是**自然拼读与音形对应 (Phonics)**。代码中在订正阶段展示了音标 `/kə'lɪɡrəfi/`，却完全没有发音按钮，强迫学习者进行“静音默写”，剥离了最重要的多模态记忆通路。
    - **程序员算法思维泛滥（畸形杂交 Diff）**：Diff 逻辑直接沿用字符串最小编辑距离。当用户输入 `new`、标准答案为 `calligraphy` 时，系统居然呈现为 `calligranew`（前半段黄色虚线框 + 后半段红色波浪线），而真正的正确尾缀 `p h y` 被挤入 HTML `title` 属性中看不见了！这种违背二语习得规律的“代码 Diff 怪物”严重污染了学习者的正字法轮廓记忆。
    - **背离 Obsidian“安静工作台”底色**：界面充斥着 5 层嵌套线框、大面积淡粉红背景与刺眼的红黄警告色，显得浮躁紧绷，更像机械考试判卷器而非优雅的笔记学习环境。
- **确定性扫描 (Deterministic Scan)**：
    - CLI 检测器扫描命中 **2 项 warning 违规**：
        - [Spelling.module.scss#L16](file:///Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/flashcards/ui/views/Spelling/Spelling.module.scss#L16)：`.inputGroup` 包含 `border-inline-start-width: 3px;`（规则：`side-tab`）。
        - [Spelling.module.scss#L28](file:///Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/flashcards/ui/views/Spelling/Spelling.module.scss#L28)：`.feedback` 包含 `border-inline-start-width: 3px;`（规则：`side-tab`）。
    - **无误报判定**：这两处 3px 单侧边框未赋予任何状态颜色（均继承 `--fc-line-soft`），却搭配 6px 圆角，属于典型的模板化装饰残余，加剧了界面容器的厚重与拼贴感。
- **视觉图层 (Visual Overlays)**：
    - 因 Obsidian 桌面端运行且未暴露 `--remote-debugging-port=9222`，动态脚本注入 overlay 自动跳过；评估直接依托实机界面截图与源代码静态证据。

## 整体印象 (Overall Impression)

教研初心极佳（通过词根词缀启发记忆，坚持主动召回重写），但被生硬的算法逻辑和繁复的嵌套线框拖累。一次本应充满顿悟感的纠错学习，变成了充斥着“畸形拼接词”、“大红叉报错”与“静音重敲”的受挫现场。最大机会在于：**重构正误对比布局、引入即时发音支持、扁平化收拢多层容器**，让纠错从“判罚”蜕变为“优雅的跟写进阶”。

## 做得好的地方 (What's Working)

1. **坚持主动生成的二阶段学习闭环 (Retrieval → Active Retyping)**：错误后强制主动拼写而非仅凭空格扫过，符合认知心理学中的“产生效应”骨架。
2. **高质量词源助记 (Etymology Integration)**：订正时自动提取词根（`calli = beautiful`, `graph = write`）与中英例句，搭建了理解性记忆的脚手架。
3. **全键盘操作流与顶栏轻量连续性**：支持 Enter 键极速推进并处理了移动端键盘高度适配，顶栏进度清晰克制。

## 重点问题 (Priority Issues)

### [P1] 消除“畸形杂交 Diff”，重构为清晰的正误上下对照与音节提示

- **问题 (What)**：最小编辑距离算法将用户输入与答案强行混排为单行，生成了形如 `calligranew` 的畸形拼接词，真正应补全的 `phy` 反而被隐藏。
- **影响 (Why)**：严重误导学习者的字形正字法记忆，造成认知混乱。
- **修复 (Fix)**：废弃单行字符拼合框，采用清晰的**上下对比排版**（上行红显错误输入，下行绿显标准答案并高亮核心差异），或按音节自然分段。
- **建议命令**：`/impeccable shape`

### [P1] 补全拼写界面的发音 (Pronunciation Audio) 核心能力

- **问题 (What)**：`SpellingView` 全流程静音，订正面板展示了音标 `/kə'lɪɡrəfi/` 却没有音频播放按钮与发音快捷键。
- **影响 (Why)**：拼写是发音的字符投射，失去听觉多感官通道使拼写记忆事倍功半。
- **修复 (Fix)**：在音标旁增加发音喇叭按钮与快捷键（如 `Ctrl/Cmd+P`），并在进入订正时支持可选自动发音。
- **建议命令**：`/impeccable clarify`

### [P1] 扁平化容器架构，消除“卡片套套乐”与 side-tab 违规

- **问题 (What)**：主卡片内嵌套反馈框、Diff 框、释义框、输入框共 5 层线框；且反馈框与输入框使用了检测器警告的 3px 单侧粗边框。
- **影响 (Why)**：违反 `DESIGN.md` 中“弱化容器存在感”原则，视觉碎片化严重，加剧界面疲劳。
- **修复 (Fix)**：将反馈、释义与输入融合在单一主卡片表面内；移除 3px `side-tab`，改用统一的 1px 细线与自然纵向字阶排版。
- **建议命令**：`/impeccable layout`

### [P2] 降温惩罚性色彩，消除输入框“未写先报错”

- **问题 (What)**：大红叉、淡粉红背景混色（`color-mix 3% red`）、以及刚进入订正状态就因 `aria-invalid` 变红的空输入框。
- **影响 (Why)**：持续传递居高临下的负面审判感，造成学习焦虑。
- **修复 (Fix)**：弱化警示烈度，移除粉红底色与输入框初始报错态，改用低饱和温和状态标识，聚焦于“学习与跟写”。
- **建议命令**：`/impeccable quieter`

### [P2] 提供订正状态下的防卡死逃生通道 (Safe Exit)

- **问题 (What)**：订正时“不知道”按钮被强制隐藏，遇到生僻符号或输入歧义时用户被完全卡死。
- **影响 (Why)**：打断日常复习心流，可能迫使用户直接强制退出插件。
- **修复 (Fix)**：保留副操作按钮（如“填入并跟写”或“跳过此词”），确保流程安全可控。
- **建议命令**：`/impeccable harden`

## 用户角色红线 (Persona Red Flags)

- **Alex (追求极致效率的 Power User)**：拼错一个尾缀却被锁死在卡片里，没有发音快捷键，没有快速填充快捷键，必须全键盘重新打 11 个字符，肌肉记忆流被打断，极易直接关闭工作台。
- **Jordan (初次使用的学习者 / First-Timer)**：看到中间的彩色方块误以为是可拖拽或可点选的字母牌；看到 `calligranew` 困惑自己为什么把系统搞乱了；音标无法点击发音，加剧挫败感。
- **Sam (无障碍与键盘依赖用户 / Accessibility-Dependent)**：缺失字符的黄色虚线框在浅色卡片上对比度严重不足（低于 4.5:1）；输入框默认带 `aria-invalid` 导致焦点指示不清；Diff 缺乏分段语义朗读。

## 次要观察 (Minor Observations)

- 底部“确认订正”按钮与中部输入框垂直距离过大，视线跨度长，缺乏内联动作的紧凑感。
- 题目释义 `n. 书法；书法艺术` 权重偏弱，建议将 `n.` 等词性做成胶囊 Badge 增强专业感。

## 启发性思考 (Questions to Consider)

1. _“拼写订正界面的主角究竟是谁？”_ —— 现在的视觉主角是“用户的错误”，而真正的标准词形与发音却沦为配角。如果反转层级，以标准词形与发音为主体、纠错为辅助，学习体验会有何提升？
2. _“机器对齐与人类拼读的鸿沟该如何跨越？”_ —— 既然编辑距离算法会产生拼合畸形词，我们是否应该彻底转向“音节拼读块 (Syllables)”或上下对照？
3. _“无声的拼写还有灵魂吗？”_ —— 在 Obsidian 的静态文本世界中，声音是极其珍贵的多模态认知杠杆。把发音深度融入拼写的每一次交互，是否是质变的关键？
