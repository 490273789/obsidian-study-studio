---
target: 练习模式的设置页面
total_score: 25
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 2
target_identity: "file:/Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/flashcards/ui/views/Practice/PracticeSetup.tsx"
target_fingerprint: "sha256:cfb850b3650238dff3b3997b48b7d203f2f8e2c0e8fc9d91b8746707d3e36acd"
target_path: /Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/flashcards/ui/views/Practice/PracticeSetup.tsx
timestamp: 2026-11-10T01-46-21Z
slug: cards-ui-views-practice-practicesetup-tsx-62e7d320
---

## Method: dual-agent (A: dd7a5b11-dfd6-428d-9754-fa4dd8073d6d · B: 8ee81ac3-f9d6-422a-ae6b-37131d3d417b)

### Design Health Score

| #         | Heuristic                       |   Score   | Key Issue                                                                              |
| --------- | ------------------------------- | :-------: | -------------------------------------------------------------------------------------- |
| 1         | Visibility of System Status     |     3     | 题库总数、当前题量与摘要联动即时；但缺乏**练习耗时预估**与抽样内容可见度               |
| 2         | Match System / Real World       |     2     | **核心缺陷**：“正常模式/反转模式”是数据库与 Markdown 数据层外溢，非语言学习者心智      |
| 3         | User Control and Freedom        |     3     | 具备 Esc/关闭与归一化防护；但缺少“恢复默认配置”的轻量重置机制                          |
| 4         | Consistency and Standards       |     2     | 控件规范分裂（分段选择器与数量芯片风格不一）；`Target` 图标滥用 3 次产生语义撞车       |
| 5         | Error Prevention                |     3     | `onBlur` 会自动纠正负数或超上限数值，题量为 0 时禁用开始按钮；输入中未阻止非法字符     |
| 6         | Recognition Rather Than Recall  |     2     | 强迫用户在大脑中回忆卡片正反面笔记内容，缺乏微型卡片正反面预览                         |
| 7         | Flexibility and Efficiency      |     3     | 支持 `<kbd>Space</kbd>` 快捷键极速启动并记忆上次模式；但页面内设置项无法纯键盘流畅切换 |
| 8         | Aesthetic and Minimalist Design |     2     | 预设数量多达 6 个芯片；数字“50”在同一屏重复出现 4 次；左右分栏留白失衡                 |
| 9         | Error Recovery                  |     3     | 边界数值静默纠正（1–2384）温和不打扰；但静默修改可能让超出范围的用户产生困惑           |
| 10        | Help and Documentation          |     2     | 辅助说明文案（如“可随机抽取或限定单词表范围指定题量”）几乎是标题的同义反复             |
| **Total** |                                 | **25/40** | **Acceptable (及格可用，但在学习心智与认知负荷上有重塑空间)**                          |

### Design Specificity Verdict

**LLM 设计审查**：
当前页面呈现出一种**面目模糊的通用后台配置表单（Category-Interchangeable Form）**倾向。抽离标题后，它几乎可以置换为驾照题库自测或服务器压测配置界面。最核心的症结在于**领域抽象泄漏（Leaky Abstraction）**：“出题方向：正常模式 vs 反转模式（正面作为问题，背面作为答案）”是站在闪卡存储结构（Front/Back）而非英语学习者心智（“英译中辨义”还是“中译英提取”）说话。此外，面对 2384 张卡片，界面未提供任何抽样预览或难度感知，错失了“学习工作台”的专属质感。

**确定性机械检测 (Deterministic scan)**：
扫描了 5 个核心组件及样式文件，检测退出码为 `0`（Clean Exit，0 findings）。代码完全杜绝了常见的 AI Slop 陋习（无非法字体、无硬编码非标色值、无弹性微动效、无多重嵌套卡片）；严格复用了 `--fc-space-*`、`--fc-radius-*`、`--fc-surface-card` 等设计令牌；容器查询与响应式适配严密。这证明底层工程质量与设计系统遵从度极高，问题集中在顶层信息架构与交互心智。

**视觉与浏览器实证 (Visual & Browser)**：
目标运行于 Obsidian 桌面宿主进程（PID 816/849），未开启 `--remote-debugging-port=9222` 且无独立 Web dev server，因此确定性跳过 CDP 动态运行时注入（对比度、微小字号等），采用静态源码审查与真实运行截图比对完成验证。

### Overall Impression

工程实现非常克制工整，底部吸底操作栏带有实时摘要与 `<kbd>Space</kbd>` 快捷键徽章，启动心流收尾有力；但配置区域过于偏向“工程师眼中的数据过滤器”，6 个数量预设与自定义输入争夺注意力，且出题方向术语技术化，增加了用户启动练习前的犹豫与认知阻力。

### What's Working

1. **闭环坚实的底部行动栏 (Sticky Action Footer)**：左侧清晰反馈当前配置白话摘要（“随机题量 · 正常模式”），右侧高亮操作按钮并外显 `<kbd>Space</kbd>` 快捷键，给用户带来极强的笃定感与桌面级顺滑体验。
2. **零缺陷的底层代码与 Token 规范**：严守 `DESIGN.md` 规范，无任意魔数，使用 `useId` 与 `fieldset` 保证基础结构语义，边界数值防呆机制（`Math.min`, `onBlur` 纠正）完备。
3. **针对题库的独立记忆机制**：自动记录当前题库上次使用的练习类型（翻卡 vs 拼写），避免重复配置疲劳。

### Priority Issues

- **[P1] 领域语言技术外溢，违背英语学习心智**
    - **Why it matters**: “正常模式/反转模式（正面作为问题，背面作为答案）”迫使学习者去在大脑中逆向回忆 Markdown 笔记结构，而非直接思考“我是要看英文想中文，还是要看中文想英文”。
    - **Fix**: 重构出题方向文案为学习心智直觉表达（例如：“英 ➔ 中（看词识义）”与“中 ➔ 英（回忆拼写/表达）”）；并在右侧或下方增加 1 张微缩卡片的正反面流动预览。
    - **Suggested command**: `/impeccable clarify`

- **[P1] 题量选择区认知过载与控件双重实体冲突**
    - **Why it matters**: 预设 6 个芯片（20, 50, 100, 150, 200, 全部）击穿了 Cowan ≤4 工作记忆极限，且与紧随其后的“自定义数量：50”同时激活争夺焦点，导致数字“50”单屏重复出现 4 次。
    - **Fix**: 精简预设为 3 个黄金档位并附带时间心理预期（如 `20 题 (约3分钟)`、`50 题 (约8分钟)`、`全部 (2384)`），“自定义数量”作为第 4 个选项平级收拢，点击时再原位展开数字输入框。
    - **Suggested command**: `/impeccable distill`

- **[P2] 表单两列排版失衡，垂直高度下坠且宽屏扫描疲劳**
    - **Why it matters**: 40%/60% 左右分栏导致第 1、3 行极度空旷（各仅有 2 个小按钮），而第 2 行垂直堆叠 3 层，产生严重的视觉重心下坠；宽屏下视线横向大幅跳跃。
    - **Fix**: 优化控件行内排布，去除“可随机抽取或限定单词表范围指定题量”等无增量信息的冗余副标题，使各配置卡片紧凑均匀。
    - **Suggested command**: `/impeccable layout`

- **[P2] 图标语义撞车与浅色主题选中态对比度偏弱**
    - **Why it matters**: `Target` 图标在顶栏标题、练习类型、正常模式中被重复使用 3 次，丧失辨识度；浅色下激活态淡青底色在低对比度屏幕上不够笃定。
    - **Fix**: 出题方向改用 `ArrowRightLeft` 或 `Languages`，练习类型改用 `Layers` 或 `BookOpen`；增强选中态外边框或微妙阴影，提升选中反馈的质感。
    - **Suggested command**: `/impeccable polish`

### Persona Red Flags

- **👤 Alex (效率优先的高阶用户)**: 每天早晨想快速刷 20 词，虽有 `<kbd>Space</kbd>` 启动，但选项无法通过纯键盘 `1/2/3` 快速切档或方向键切换，必须伸手摸鼠标点击芯片，打断了纯键盘流。
- **👤 Jordan (初学/犹豫型学习者)**: 看到“正常模式”卡住，心想“我的笔记第一行记的是单词还是中文来着？”，在 6 个数字芯片和“自定义数量”之间犹豫选哪个才生效。
- **👤 Sam (无障碍与读屏依赖者)**: 6 个连续纯数字芯片缺乏量词与上下文修饰（读出“20，按钮”而非“20 张卡片”）；浅色主题下淡青色激活背景视觉边界较弱。

### Minor Observations

1. **题库名称与标签重复**：Hero 区域显示 `SeniorHeighSchool` 与 `#SeniorHeighSchool`，标签缺乏 Badge 胶囊造型，显得像机械回显。
2. **范围模式缺少即时题量计算**：切换到“单词范围”填入起始和结束序号后，输入框附近未即时显示“已选 N 题”，必须看底部按钮才能确认。
3. **偏好记忆仅存于内存**：`lastPracticeKindByDeck` 保存在内存 Map，Obsidian 重载即失效，应持久化到配置。

### Questions to Consider

- _“如果我们不再显示抽象的卡片张数，而是显示‘约 5 分钟 · 50 题’，学习者的心理进入门槛会降低多少？”_
- _“对于在 Obsidian 中自己做笔记的用户，如果设置页面有一处微型的‘卡片正反面效果预览’，是否会瞬间消除‘正常/反转’的理解成本？”_
- _“‘随机题量’和‘单词范围’真的需要平起平坐吗？‘范围指定’是否更适合收敛为高级展开项，让 90% 的普通练习更加纯粹？”_
