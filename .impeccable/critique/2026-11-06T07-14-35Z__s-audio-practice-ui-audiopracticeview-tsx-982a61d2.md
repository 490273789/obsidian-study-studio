---
target: 听说练习页面
total_score: 28
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 2
target_identity: "file:/Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/audio-practice/ui/AudioPracticeView.tsx"
target_fingerprint: "sha256:eb7f72abac7ca665db6b2a3e4ee5316894bc727fee8df4d80bef2e1332ca5b59"
target_path: /Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/audio-practice/ui/AudioPracticeView.tsx
timestamp: 2026-11-06T07-14-35Z
slug: s-audio-practice-ui-audiopracticeview-tsx-982a61d2
closed: true
---

Method: dual-agent (A: d8117704-3d64-416c-aed4-0f414e795e31 · B: 34628dcd-f3c9-4652-bff2-3ac4f1e2fdcc)

### Design Health Score

| #         | Heuristic                                               |   Score   | Key Issue                                                                        |
| --------- | ------------------------------------------------------- | :-------: | -------------------------------------------------------------------------------- |
| 1         | Visibility of System Status                             |     3     | 播放进度、词级卡拉OK变色、进度指示（11/80）清晰；音频初次缓冲缺少微观反馈。      |
| 2         | Match System / Real World                               |     3     | “逐句跟读”、“盲听”、“难句”符合学习心智；但“字幕微调/偏移”偏工程技术语。          |
| 3         | User Control and Freedom                                |     3     | 支持任意句点击、重听、随时取消转写；误触取消“只练难句”易丢失上下文。             |
| 4         | Consistency and Standards                               |     3     | 遵循 Obsidian 规范；工具栏混用了分段按钮、图标按钮、复选框三种交互形态。         |
| 5         | Error Prevention                                        |     3     | 重新生成与删除均有防破坏弹窗；但高风险“重新生成”与“编辑材料”紧邻，易误触。       |
| 6         | Recognition Rather Than Recall                          |     2     | 严重依赖键盘记忆；顶栏平铺长达 60 字纯文本快捷键说明，缺乏场景化按键微徽标。     |
| 7         | Flexibility and Efficiency                              |     4     | 极佳的键盘加速体系（空格、方向键、J/L、R、S/D、H、括号调速），滚动焦点极其平滑。 |
| 8         | Aesthetic and Minimalist Design                         |     2     | 视觉信息过载：顶栏三层叠加，常驻字幕微调步进器，快捷键平铺，宽屏下星标横向失联。 |
| 9         | Help Users Recognize, Diagnose, and Recover from Errors |     3     | 错误具名化（密钥缺失、文件不存在），表单失败保留草稿，具备明确重试机制。         |
| 10        | Help and Documentation                                  |     2     | 缺乏体系化帮助与就地快捷键面板弹层，新手对于音字幕匹配与用法缺乏渐进引导。       |
| **Total** |                                                         | **28/40** | **Good (良好)**                                                                  |

---

### Design Specificity Verdict

- **LLM Assessment**: **半特异性（偏向通用音频工具，英语学习者特异性不足）**。整体视觉契合 Obsidian 桌面端暗亮环境，具备“逐句跟读”、“盲听”、“难句标记”等切片概念。但信息架构与视觉组织仍锚定于通用型“音频播放器 + 字幕校对编辑器”。面向中文母语者的英语学习场景，句子中的生词无法即时查词（未打通插件在线/本地词典能力），无法划词收藏闪卡，缺乏学习闭环。
- **Deterministic Scan**: CLI 扫描完成，基于正则的静态扫描报告 0 错误 0 警告；深入技术代码审查发现：
    1. `AudioPractice.module.scss:847` 中 `.offsetStepButton` 为 22×22px，违反 WCAG 2.5.8 最小触控区域 24px 规范。
    2. 3 处计数徽章使用 10px 微型字体（`--fc-font-2xs`），非 Retina 屏上存在可读性折损。
    3. `.statusStrip` busy 态在亮色模式下缺少专门的高对比度 token 适配。
- **Visual Overlays**: 运行时界面审查基于用户提供的实机截图（`uploaded_media_1793948846390.jpg`）。CDP 动态挂载因 Obsidian 实例未携带 `--remote-debugging-port=9222`（端口 9222 连接被拒）而跳过。

---

### Overall Impression

整体交互架构扎实，尤其是“快捷键 + 自动居中对齐滚动”形成的跟读节奏感非常优秀；先前版本存在的“删除材料无确认”、“空格劫持按钮原生点击”等致命缺陷均已完全闭环修复。当前最突出的矛盾在于**“过度工程化与信息堆砌”**：顶栏三层堆叠、60 字符快捷键硬编码平铺、常驻展开的字幕微调步进器，使界面充斥着剪辑台的杂乱感，而语言学习真正需要的查词与闪卡联动却尚未落地。

---

### What's Working

1. **流畅自如的键盘跟读飞轮**:
   `PracticeViewInteraction` 精密缝合了空格播放/暂停、R 快速重听、S/D 标难、方向键切句与无感居中平滑滚动（`syncCueScroll`），双手留在键盘上即可一气呵成完成整组听读训练。
2. **克制温和的结课峰终体验 (Peak-End Rule)**:
   完成全部 80 句后，`PracticeSummary` 自然展开于底栏上方，总结时长与难句，提供“再练一次”与“只练难句”明确下一步，毫无弹窗式粗暴打断。
3. **健全的数据安全感与状态隔离**:
   删除材料明确声明不删 Vault 原始文件，重新生成字幕具备严格破坏性二次警示，会话草稿与运行态解耦完备。

---

### Priority Issues

#### [P1] 顶栏视觉过度拥挤与快捷键纯文本堆砌

- **What**: 页面顶部垂直叠加了三层横向工具条；练习栏右侧硬编码平铺了长达 60 字符的快捷键说明（`空格 播放/暂停 · ← → / ↑ ↓ 切句 · Shift+← → 后退/前进 3 秒 · R 重听 · S / D 标记难句 · H 揭示 · [ ] 调速`），字号微小密集。
- **Why**: 极度分散注意力，破坏“安静的学习工作台”视觉基调，且在较窄窗口下极易发生折行冲突。
- **Fix**: 彻底移除整段常驻纯文本。在对应控件的 Tooltip 或角落渐进展示精致键帽（如播放键标注 `Space`，重听标注 `R`）；在工具栏右侧提供独立的键盘图标按钮呼出规范排版的快捷键浮层 (Popover)。
- **Suggested command**: `/impeccable distill`

#### [P1] 高风险/低频 AI 动作过度喧宾夺主

- **What**: “重新生成字幕”（带 Sparkles 图标）与“校对字幕草稿”常驻在材料标题栏最显眼右侧。
- **Why**: 字幕生成与校对在材料生命周期中只发生 1 次，日常练习发生 99 次。高破坏性与消耗 Token 的动作常驻容易造成心理焦虑和误触风险。
- **Fix**: 将“重新生成字幕”收纳进“更多选项（...）”或编辑弹窗；仅在“无字幕”的空状态下在主视区提供醒目引导。
- **Suggested command**: `/impeccable quieter`

#### [P2] 宽屏下难句收藏星标横向失联

- **What**: 字幕行的星标按钮（Star）固定在容器最右侧边缘，与短句子（如 `0:13.4 Text one.`）之间存在大面积视觉空白。
- **Why**: 视线扫描断裂，鼠标横向移动过长，极易看错行。
- **Fix**: 将星标收拢到时间戳右侧或紧随句子末尾，缩短视线与点击距离。
- **Suggested command**: `/impeccable polish`

#### [P2] 底栏低频“字幕微调”步进器常驻占位且触控热区违规

- **What**: `字幕微调 (秒)` 的 `- [ 0 ] +` 调节器在桌面端始终常驻展开，且 `.offsetStepButton` 仅 22×22px（违反 WCAG 2.5.8 24px 最低触控尺寸限制）。
- **Why**: 90% 匹配良好的音频无需调偏移，常驻充斥着音频剪辑软件的工程感，且小按钮点击易点空。
- **Fix**: 将微调控件收纳至“播放选项”面板；步进按钮加大至至少 28px；仅在 offset ≠ 0 时在底栏保留微小的已调偏移提示。
- **Suggested command**: `/impeccable distill`

#### [P2] 缺失面向英语学习者的单词即时查词与生词卡片联动

- **What**: 字幕虽然支持选中文本，但点击单词无法即时查词，未打通 Study Studio 内置词典与闪卡系统。
- **Why**: 听力练习中遇到生词（如截图中的 "burnt out"）无法即时获取中文释义并加入复习，切断了 Obsidian 笔记与卡片学习闭环。
- **Fix**: 支持点击字幕单词唤起轻量词典卡片并一键收藏至生词库/闪卡。
- **Suggested command**: `/impeccable clarify`

---

### Persona Red Flags

- **Alex (极客流 / 效率型资深用户)**:
    - 🚩 **红旗**: 已经烂熟快捷键的 Alex 无法隐藏顶栏冗长的小字快捷键提示，感到界面冗余；且练习中标记了难句后，无法通过快捷键一键批量导出为 Obsidian 闪卡卡片包进行 Anki 模式复习。
- **Jordan (新手流 / 初次使用插件的英语学习者)**:
    - 🚩 **红旗**: 看到顶部的“重新生成字幕”感到十分恐慌：“点这个会消耗我的 AI 额度吗？会把现有的字幕覆盖丢失吗？”；底部的“字幕微调 (秒)”让其不知所措；顶栏灰字快捷键太小被当作无关版权信息忽略，依然全程用鼠标去点小小的播放按钮。
- **Sam (无障碍流 / 键盘与高对比度依赖者)**:
    - 🚩 **红旗**: 微调按钮 22px 低于 WCAG 2.5.8 规定的 24px 触控底线；在亮色模式下，部分高亮字词与 busy spinner 对比度边缘偏弱；使用 Tab 键在字幕列表遍历时，焦点在 `cueSelect` 和 `cueStar` 之间跳转，Tab 序列冗长。

---

### Minor Observations

1. **音频文件名截断**: 当音频文件名过长时，`fileName(material.audioPath)` 的省略号处理可能会掩盖关键版本号（如 `Chapter1_Lesson2_v2.mp3`）。
2. **盲听揭示的一致性反馈**: 在盲听模式按下 `H` 揭示后，当前句展开，但缺乏明确的“已揭示”视觉反馈状态，切到下一句时又瞬间隐藏，节奏较快时容易产生眩晕感。
3. **右侧材料库折叠指示**: 折叠后仅留出 48px 的狭长竖条，缺乏明显的悬浮 Tooltip 告知如何重新展开材料库。

---

### Questions to Consider

1. _“如果把顶栏整行密密麻麻的 60 字快捷键文本彻底删掉，改为在对应按钮角落显示精致的轻量键帽（如播放键角落的 ␣，重听键角落的 R），界面会显得多从容、多自信？”_
2. _“‘重新生成字幕’这种几个月才点一次、成本高昂的 AI 重操作，真的配得上常驻在学习者每天都要看几十次的标题栏最右侧吗？”_
3. _“既然这是专门为中文用户打造的英语学习工具，为什么学生听到一个不会的单词时，却无法直接点击查看中文释义并加入生词本？”_
4. _“‘字幕微调 -0.1s’ 是一个只在刚导入不对齐时调试的工程属性，把它搬到底栏常驻，是不是把开发者的调试便利凌驾于学生的学习沉浸感之上了？”_
