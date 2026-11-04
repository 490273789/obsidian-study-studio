---
target: 听说练习页面
total_score: 36
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 2
target_identity: "file:/Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/audio-practice/ui/AudioPracticeView.tsx"
target_fingerprint: "sha256:a6ce9a91de4d8af0e5ba8f462f54004a8a814777beae12039262344d545451c7"
target_path: /Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/audio-practice/ui/AudioPracticeView.tsx
timestamp: 2026-11-04T03-59-03Z
slug: s-audio-practice-ui-audiopracticeview-tsx-982a61d2
---

Method: dual-agent (A: 11632df9-143f-43e0-bcb5-6ba8bc83e7f9 · B: 5b65baa2-eef5-4a47-86ea-44ebd1651ff3)

## Design Health Score

| #        | 启发式原则 (Heuristic)                         | 得分 (0-4) | 核心发现 (Key Issue)                                                               |
| -------- | ---------------------------------------------- | :--------: | ---------------------------------------------------------------------------------- |
| 1        | 状态可见性 (Visibility of System Status)       |     3      | 播放状态、当前句导轨与微调步进反馈明确清晰；缺少音频加载缓冲条与音量指示           |
| 2        | 贴合现实认知 (Match System / Real World)       |     4      | 精听与随身听习惯高度贴合，“字幕微调（秒）”直观；步进按钮可补充“快/慢”辅助说明      |
| 3        | 用户控制与自由 (User Control & Freedom)        |     4      | 全键盘流畅操作、选句跳转与微调一键重置；“只练难句”锁定连播建议补充说明             |
| 4        | 一致性与标准 (Consistency & Standards)         |     4      | 深度遵循 Study Studio 与 Obsidian 设计令牌，实心琥珀星标和状态轨道行规范严谨       |
| 5        | 防错机制 (Error Prevention)                    |     4      | “重新生成字幕”具备二次覆盖警告弹窗，数值微调具备严格边界防呆校验                   |
| 6        | 识别优于回忆 (Recognition Rather Than Recall)  |     3      | 顶栏常驻高对比度快捷键指引，控件注入 Tooltip；但快捷键对读屏软件可达性需进一步暴露 |
| 7        | 灵活性与高效性 (Flexibility & Efficiency)      |     4      | 全键盘无缝驱动（R/S/D/H/切句），Roving Tabindex 彻底解决 160 个 Tab 键位过载       |
| 8        | 审美与极简主义 (Aesthetic & Minimalist Design) |     4      | 840px 黄金阅读宽度居中，清透青导轨克制精致；同屏句数信息有轻微冗余                 |
| 9        | 错误恢复 (Error Recovery)                      |     3      | 微调具备一键撤销复位，草稿失败具备就地重试；音频源文件被移动时缺少重连指引         |
| 10       | 帮助与文档 (Help & Documentation)              |     3      | 表单引导与快捷键速查条完备；缺少初次使用的影子跟读法入门说明                       |
| **总计** |                                                | **36/40**  | **Excellent (优秀，生产级精细品质)**                                               |

---

## Design Specificity Verdict

**LLM 设计审查**：
Study Studio 作为面向中文母语英语学习者的 Obsidian 插件，在本次迭代后业务特异性显著强化：

1. **原生词典与划词闭环**：字幕行显式开放文本选择能力（`user-select: text; cursor: text`），用户在跟读停顿时可直接选中生词触发 Obsidian 划词助手与本地词典弹出层，真正落地了“在已有资料中理解、练习和复习英语”的产品原则；
2. **影子跟读工作台定位确立**：摆脱了通用播客播放器的平庸感，界面完全围绕“逐句精听与影子跟读（Shadowing）”展开——单句重听循环（`R`）、难句标记（`S`/`D`）、只练难句以及高精度 `±0.1s` 轴偏微调与一键复位，构成了高密度的专业语言学习心流；
3. **未竟生态机会**：虽然已打通划词查词，但在 UI 上尚未提供“将难句/生词一键制作为 FSRS 复习卡片”的显式动作；且当前仅支持单语字幕，未为中文释义提供对照展示插槽。

**确定性静态扫描 (Deterministic Scan)**：

- TSX 代码扫描：`AudioPracticeView.tsx` 与 `ReviewDialog.tsx` 报告 0 项违规，所有排版、状态与颜色严格采用基元与 CSS Modules 变量；
- SCSS 样式扫描：检出 1 项 Advisory 警告：
    - `AudioPractice.module.scss:548`: 未收录颜色 `#007a82`（`design-system-color`）。
    - **判定说明**：在浅色主题下，系统原品牌色 `#00b8c4` 在浅灰/白色底上的对比度低于 3:1，未达 WCAG AA 标准。代码在此处特意选用同色系加深的 `#007a82`，使文字对比度达到 4.5:1+。此项属于**出于无障碍考虑的有意设计**（A11y-driven choice），但建议将其收纳为正式的设计系统命名令牌（如 `--fc-primary-text-light`）。

**可视化覆盖层 (Visual Overlays)**：
Obsidian 桌面应用运行于未启用 `--remote-debugging-port=9222` 的宿主环境，且该视图与 Obsidian 内部工作区及 Vault 文件系统深度绑定，无法独立挂载外部浏览器进行脚本注入。因此跳过动态 CDP 注入，采用结合真实截图的静态结构与设计系统契约推演进行综合评估。

---

## Overall Impression

听说练习页面在经历了快捷键补全、Tab 焦点流重构、840px 黄金阅读宽度收拢与词级多主题高亮打磨后，已从一个“通用的宽屏字幕播放器”蜕变为一个“沉静、高效、高度适配精听训练的专业工作台”。全键盘驱动的跟读节奏令人愉悦，当前主要瓶颈已从“布局与基础交互缺陷”转移至“练习终点峰终激励”以及“长句内微退与快捷调速”等高级心流细节上。

---

## What's Working

1. **840px 黄金阅读宽度与极佳的阅读质感**：将字幕区域限制在黄金宽度并居中，配合左侧 3px 青色导轨与微染底色，彻底消除了宽屏视口下的眼球横向漂移，视觉重心清晰稳健。
2. **教科书级的全键盘心流与 Roving Tabindex**：`Space` 启停、`R` 重听、`S`/`D` 标星、`H` 破盲、`↑`/`↓` 切句构成了极其流畅的精听闭环；同时将 80+ 句子的 160 个 Tab 键位陷阱缩减为仅当前活跃句可 Tab 穿透，无障碍大幅跃升。
3. **微调步进与零位复位的优雅防呆**：底栏将生硬的“字幕偏移”重构为“字幕微调”，搭配 `±0.1s` 步进与自适应重置按钮，解决了视音频微不同步时的微调挫败感。

---

## Priority Issues

### [P1] 练习终点体验缺失 (End-of-Session Void)

- **What**：当听完第 80 句或练完难句列表时，音频停止，界面无任何完成状态反馈、总结面板或激励卡片，心流断崖式中断在最后一句。
- **Why it matters**：外语精听是一项高认知负荷的训练，缺乏峰终定律（Peak-End Rule）的正向强化与结果反馈，容易导致长期练习的动力衰减。
- **Fix**：当播放完成最后一句时，展示轻量级练习总结卡片（Session Summary Banner）：呈现本次用时、跟读句数、标记难句数，并提供“再练一次”、“复盘难句”、“返回材料库”入口。
- **Suggested command**：`/impeccable shape`

### [P1] 长句内微步进与倍速快捷调节断层 (Missing Rewind 3s & Rate Keys)

- **What**：当前 `←` 只能跳到上一句，`R` 只能从头重听。面对 15-20 秒的长难句，尾部连读没听清时无法“后退 3 秒微听”；且调节倍速必须移开键盘使用鼠标点击右下角下拉菜单。
- **Why it matters**：打断了高级精听者（Alex 画像）双手不离键盘的高频专注心流。
- **Fix**：
    1. 引入 `Shift + ←` / `Shift + →`（或 `J` / `L`）实现句内前进/后退 3 秒；
    2. 支持 `[` / `]` 快捷键调节播放倍速（0.75x~1.75x）；
    3. 在快捷键速查条中予以标注。
- **Suggested command**：`/impeccable polish`

### [P2] 屏幕朗读器快捷键可达性盲区 (A11y Hidden Shortcuts)

- **What**：顶栏快捷键提示条 `.shortcutHint` 设置了 `aria-hidden="true"`，导致使用屏幕朗读器的视障用户无法感知这套强大的快捷键。
- **Why it matters**：键盘依赖与视障用户最需要快捷键支持，但指引对辅助技术隐形。
- **Fix**：移除 `aria-hidden="true"`，或通过 `aria-keyshortcuts` / `aria-describedby` 规范关联至练习容器。
- **Suggested command**：`/impeccable harden`

### [P2] 界面信息冗余与操作重心微调 (Metadata Clutter)

- **What**：总句数信息在同屏重复出现了 3 次（材料元数据、实践工具栏右侧、底栏进度）；常态下顶栏“校对字幕草稿”按钮视觉权重略重。
- **Why it matters**：信息密度偏高，分散了对核心练习舞台的注意力。
- **Fix**：精简重复的总句数标签；将“校对草稿”弱化为普通幽灵按钮或次级入口，仅在草稿有待处理项时加重徽标。
- **Suggested command**：`/impeccable distill`

---

## Persona Red Flags

- **Alex (Power User / 极客型跟读者)**：
    - _走查痛点_：长难句尾音听不清时，按 `←` 想要微回退却直接切到了上一句，不得不反复按 `R` 从头听 15 秒；想要放慢到 0.8x 必须挪动手去抓鼠标点菜单，打断了极客的连贯跟读心流。
- **Jordan (First-Timer / 首次导入练习者)**：
    - _走查痛点_：导入材料后看到顶部醒目的“校对字幕草稿”按钮，困惑是否必须先校对才能开始练习；勾选“盲听”后全屏文字变成“原文已隐藏”，找不到一次性恢复全部原文的途径。
- **Sam (Accessibility-Dependent / 读屏与低视力用户)**：
    - _走查痛点_：依赖读屏器时，由于 `.shortcutHint` 被 `aria-hidden`，无法获知快捷键；列表未激活的星标透明度为 0.55，在低对比度屏幕上难以看清边界。

---

## Minor Observations

1. **难句快捷键文案完善**：代码支持 `S` 和 `D`，但界面文案仅写了 `S`，可补充为 `S / D 标记难句`，照顾习惯 `D` (Difficult) 的用户。
2. **移动端键盘快捷键适配**：当前在小屏或触摸模式下快捷键提示被隐藏，iPad 外接物理键盘用户无法查阅。
3. **音频加载缓冲指示**：Seek slider 目前仅显示当前时间，未显示已缓存进度（Buffered range）。

---

## Questions to Consider

1. _“当精听遇到生词时，能否在暂停状态下提供就地‘加入生词闪卡’悬浮按钮，让听说练习与 Study Studio 的 FSRS 题库瞬间形成双向飞轮？”_
2. _“盲听模式能否演变为认知脚手架（Scaffolding）——初次听全隐藏，按一次 H 提示词数与首字母，按第二次提示中文释义，按第三次揭示原文？”_
3. _“面对 80+ 句的长材料，能否在用户离开后记住‘断点位置’，下次进入自动滚动并高亮至上次停顿的那一句？”_
