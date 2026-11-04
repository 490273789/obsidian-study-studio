---
target: 听说练习页面
total_score: 26
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 2
target_identity: "file:/Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/audio-practice/ui/AudioPracticeView.tsx"
target_fingerprint: "sha256:ef8cdb4f41c8f070e1dff34fe29f7a483de44fa1ddc706a86800976101659892"
target_path: /Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/audio-practice/ui/AudioPracticeView.tsx
timestamp: 2026-11-04T02-41-31Z
slug: s-audio-practice-ui-audiopracticeview-tsx-982a61d2
---

Method: dual-agent (A: 8521a40f-cb24-410b-b16e-967f8fab8234 · B: 52938d98-7af2-4fb6-bb1f-b0c0994aeb5b)

## Design Health Score

| #        | 启发式原则 (Heuristic)                         | 得分 (0-4) | 核心发现 (Key Issue)                                                           |
| -------- | ---------------------------------------------- | ---------- | ------------------------------------------------------------------------------ |
| 1        | 状态可见性 (Visibility of System Status)       | 3          | 播放与等宽时间码清晰，但缺少全局难句统计与完成度反馈，词级高亮回退无视觉解释   |
| 2        | 贴近现实与习惯 (Match System / Real World)     | 3          | 播控规范，“逐句跟读/盲听”符合语言学习常识；但“字幕偏移（秒）”为纯技术术语      |
| 3        | 用户控制与自由 (User Control & Freedom)        | 3          | 支持选句与进度跳转；但材料移除与字幕重生成缺乏撤销与确认保护                   |
| 4        | 一致性与标准 (Consistency & Standards)         | 3          | 遵循 Obsidian 与 Study Studio 设计令牌；但顶栏“校对字幕草稿”按钮视觉权重过重   |
| 5        | 防错机制 (Error Prevention)                    | 2          | 难句模式锁定很严谨；但“重新生成字幕”单次点击即全量覆盖且毁损难句标记，极其危险 |
| 6        | 识别胜于回忆 (Recognition Rather Than Recall)  | 3          | 快捷键常驻提示，时间信息完备；但缺乏生词查词释义辅助与难句总览                 |
| 7        | 灵活性与使用效率 (Flexibility & Efficiency)    | 2          | 播放速率调节灵活；但重听与标星缺失高频快捷键，列表产生 160 个 Tab 键位陷阱     |
| 8        | 美观与极简主义 (Aesthetic & Minimalist Design) | 2          | 配色克制；但桌面横向严重拉伸，控件堆叠繁多，未贯彻“让阅读内容优先”的极简承诺   |
| 9        | 错误恢复 (Error Recovery)                      | 3          | 失败有 Alert 提示与重试机制；但转写配置失败未提供直达语音设置的上下文跳转      |
| 10       | 帮助与文档 (Help & Documentation)              | 2          | 对话框有副标题说明；但缺乏针对“影子跟读法则”或“盲听练习法”的简明引导           |
| **总计** |                                                | **26/40**  | **Acceptable (尚可，基础扎实但有显著体验瓶颈)**                                |

---

## Design Specificity Verdict

**LLM 设计审查**：
Study Studio 定位为“安静的学习工作台”，面向以中文为母语的英语学习者。当前的听说练习界面成功融入了 Obsidian 的面板视觉语言（使用了插件的清透青 `#00b8c4`、中性表面色阶 `--fc-surface-section/card` 以及等宽数据字体）。然而在**学习交互与业务特定性**上，它目前更偏向通用的“播客字幕播放器（Transcript Player）”，而未充分激活“英语学习工作台”的独特价值。
当前界面展现的是高考/四六级/托福等典型备考听力材料，但在核心跟读界面中，缺乏词典查词联动、生词点击高亮、双语参考译文切换以及将难句沉淀为 Obsidian 闪卡笔记的通路。学习者在听到诸如 “I'm just burnt out” 产生理解障碍时，无法在当前闭环内获得支持，使该界面与通用的媒体转写工具产生了不应有的可替代性（Category Interchangeability）。

**确定性静态扫描 (Deterministic Scan)**：
CLI 检测器扫描 `src/features/audio-practice/ui/AudioPracticeView.tsx` 与 `src/features/audio-practice/ui/ReviewDialog.tsx`，静态退出状态码为 0，报告 0 项违规。
这表明代码结构规范：所有样式均严格委托给 `AudioPractice.module.scss` 与设计系统共享基元组件（`Button`、`FlashcardInput`、`FlashcardSelect`、`FlashcardCheckbox`、`FlashcardSlider`、`ModalSurface`），未混入内联 `style={{...}}`、硬编码 Hex 色值或常见 AI 模板反模式。
然而，静态正则扫描存在盲区：

1. `AudioPractice.module.scss` 中的 `.libraryCount` 和 `.countBadge` 使用了 `10px`（`--fc-font-2xs`），符合 `DESIGN.md` 中微型角标的紧凑例外，但在常规无障碍规则下属于临界尺寸；
2. 大量依赖 `color-mix()` 与宿主主题变量，其在极端暗色或高反差第三方主题下的实际对比度需运行时确认；
3. 桌面端星标按钮（`.cueStar`）触控区域较小，对低精度指针容错度有限。

**可视化覆盖层 (Visual Overlays)**：
Obsidian 桌面应用运行于未启用 `--remote-debugging-port=9222` 的宿主环境，且该视图与 Obsidian 内部工作区及 Vault 文件系统深度绑定，无法独立挂载外部浏览器进行脚本注入。因此跳过动态 CDP 注入，采用结合真实截图的静态结构与设计系统契约推演进行综合评估。

---

## Overall Impression

听说练习界面的音文同步底座与视口自适应居中追踪极其扎实，“逐句跟读”与“盲听遮蔽+揭示”精准契合外语听力训练的核心心流。但当前界面主要受制于**“宽屏下的横向撕裂”**、**“双手不离键盘的高频操作断层（缺重听与标星键）”**以及**“缺乏与 Obsidian 词典及闪卡生态的联动”**，导致其停留在播放器层面，未完全释放学习工作台的威力。

---

## What's Working

1. **极其平稳精准的音文同步与自适应居中滚动**：`practiceViewInteraction.ts` 结合 `useSyncExternalStore` 实现了极高精度的句级时间追踪，在句子切换时视口自动居中且尊重 `prefers-reduced-motion`，交互基础极其扎实。
2. **切中外语习得本质的双模式与盲听遮蔽**：“逐句跟读”与“盲听（隐藏原文）+ 揭示”的设计直接抓住听力训练的关键——迫使学习者依靠听觉输入而非视觉依赖，设计动机高度正确。
3. **克制沉静的 Obsidian 原生视觉质感**：严格遵循 Obsidian 的中性底色与变量体系，搭配清透青色强调与工整等宽时间码，排版节奏安静专注，完全没有粗糙外挂插件的塑料感。

---

## Priority Issues

### [P1] 键盘交互与学习心流断裂：缺失“重听”与“标星”快捷键，列表 Tab 键位过载

- **What**：影子跟读的核心高频动作（重听当前句、标记/取消难句）无全局快捷键；列表内每句包含 2 个原生 button，80 句产生 160 个 Tab Stops。
- **Why it matters**：跟读的核心在于“耳、口、手”的快速协同，强制挪动鼠标去点微型按钮直接打断学习心流；对于键盘依赖者或视障用户，160 个 Tab 焦点无法导航。
- **Fix**：
    1. 在 `practiceViewInteraction.ts` 中补全高频快捷键：`R`（重听当前句）、`S` 或 `D`（切换难句星标）、`H`（揭示/隐藏原文）；
    2. 采用 Roving Tabindex 模式（整个句子列表作为一个焦点容器，通过 ↑ / ↓ 键切句，Tab 键直接跳至底栏控制器）；
    3. 在顶栏显著位置标注快捷键指引。
- **Suggested command**：`/impeccable harden`

### [P1] 宽屏排版严重失衡：横向撕裂破坏格式塔接近律与阅读聚焦

- **What**：在桌面宽屏视口下，英文句子靠左，星标按钮孤悬在视口最右侧，中间横亘 600~1000px 的空白；当前正在播放的句子字号与周围一致，视觉权重不足。
- **Why it matters**：学习者眼球需频繁左右长距离巡视，极易产生视力疲劳；宽屏下视线涣散，未兑现“让阅读内容优先”的产品承诺。
- **Fix**：
    1. 为字幕内容区增加最佳阅读宽度限制（居中 `max-width: 760px` 或 `800px`）；
    2. 将难句星标贴近句子文本末尾或置于时间戳旁，形成紧密闭合的行内组块；
    3. 强化 Active Cue 的视觉表现：激活行采用更大字号（如 16px）、清晰的左侧轨道状态条（Left Accent Rail），构建明确的视觉锚点。
- **Suggested command**：`/impeccable layout`

### [P2] 生产级防错机制缺失：“重新生成字幕”与“材料删除”缺乏安全保护

- **What**：“重新生成字幕”为单次触发强制全量覆盖操作；材料库单项垃圾桶图标单点即删。
- **Why it matters**：学习者花费时间精细校对的时间戳、手工纠错内容及标注的难句会被瞬间覆盖抹除，属于高危破坏性体验。
- **Fix**：
    1. “重新生成字幕”必须弹出二次警示确认弹窗，明确提示已有修改和标记将被覆盖；
    2. 将高风险低频操作（重新生成）收纳至更多菜单（`...`）中；
    3. 材料移除增加二次确认或提供短暂的 Undo Toast 撤销通知。
- **Suggested command**：`/impeccable harden`

### [P2] 缺乏学习生态闭环：与 Obsidian 词典及闪卡系统脱节

- **What**：界面仅局限于媒体播放与字幕跟随，当前句不支持选词即时查词、无生词释义悬浮、无“将难句转为复习卡片”通路。
- **Why it matters**：作为 Study Studio 插件，未能兑现“在已有资料中理解、练习和复习英语”的产品宗旨，沦为孤立的播放器。
- **Fix**：
    1. 为字幕文本接入插件已有的选区划词查词与本地词典弹出层；
    2. 在难句标记旁或右键菜单增加“制作为闪卡”快捷动作；
    3. 播放结束时提供“练习小结”，支持一键导出本篇材料的难句复习卡片。
- **Suggested command**：`/impeccable clarify` 或 `/impeccable shape`

---

## Persona Red Flags

- **Alex (极客型深度练习者 / Power User)**：
    - _走查痛点_：双手悬空在键盘上练习影子跟读，空格暂停，听不清想要重按该句时，找不到重听快捷键；想把生僻难句按快捷键打星标无从下手；不得不频繁用触摸板/鼠标，极度烦躁。
- **Jordan (首次导入音频的新手 / First-Timer)**：
    - _走查痛点_：在“添加材料”对话框中面对“仓库音频 / 字幕（可选）/ 从文本文件读取 / 对应原文（可选）”四个并列字段产生认知负担；练习中看到闪闪发光的“重新生成字幕”随手一按，辛辛苦苦标注的难句直接被清空，造成严重受挫。
- **Sam (辅助技术与键盘依赖者 / Accessibility-Dependent)**：
    - _走查痛点_：使用 Tab 键导航时，遭遇 80 句 × 2 = 160 个交互元素的漫长遍历，无法快速到达底栏倍速与偏移设置；灰度提示文字在浅色主题下几乎隐形；删除按钮在无鼠标悬停时不明显，容易产生操作不可预测性。

---

## Minor Observations

1. **技术用语生硬**：底栏“字幕偏移（秒）”应改为更符合直觉的“字幕同步微调”，并增加 `±0.1s` 快捷微调步进按钮。
2. **提示文本对比度不足**：顶部“空格 播放/暂停 · ← → 切换句子”使用 `--fc-faint` 导致浅色主题下辨识度较差，应提升为 `--fc-muted`。
3. **材料库缺乏自动折叠策略**：在宽度介于 820px-1100px 的中等桌面分栏中，常驻的 232px 材料库显得拥挤，宜默认收起为图标导轨。
4. **进度条触控面积偏小**：14px 的滑块圆钮在触控板或触控屏上容易脱手，建议扩充透明点击热区（Touch Target >= 32px）。
5. **双语字幕扩展性**：目前结构仅支持单一 `cue.text`，未为常见的双语（英+中）字幕预留译文展示层槽位。

---

## Questions to Consider

1. _“为什么在逐句练习时，学习者必须面对一整张 80 句的密集列表，而不是采用‘卡片聚焦模式（Focus Card）’——将当前句置于舞台中央放大沉浸跟读，其余句子淡化为上下文轨道？”_
2. _“如果 Study Studio 的核心是‘闪卡与记忆连续性’，为什么听说练习里的难句标记（Star）只沉淀在当前插件状态，而不能直接作为标签 `#difficult` 自动生成一组 FSRS 听力跟读复习卡？”_
3. _“在盲听模式下，除了‘全句遮蔽 / 点击全句揭示’这种一刀切的交互，能否支持更符合认知梯度的‘挖空听写（Cloze）’或‘逐词点听揭示’？”_
