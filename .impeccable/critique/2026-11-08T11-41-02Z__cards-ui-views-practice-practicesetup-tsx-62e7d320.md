---
target: src/features/flashcards/ui/views/Practice/PracticeSetup.tsx
total_score: 27
max_score: 40
na_heuristics:
p0_count: 1
p1_count: 1
target_identity: "file:/Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/flashcards/ui/views/Practice/PracticeSetup.tsx"
target_fingerprint: "sha256:7f19d50d1f443d723376372fd04a62861b4bca46c61030e656ec7cf18327d516"
target_path: /Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/flashcards/ui/views/Practice/PracticeSetup.tsx
timestamp: 2026-11-08T11-41-02Z
slug: cards-ui-views-practice-practicesetup-tsx-62e7d320
---

# Critique Report: 练习与拼写模式融合架构及设置页重构

Method: dual-agent (A: b0990471-dc26-4c19-ac23-4339e65ed5c4 · B: d988a36f-2ec1-4629-923e-9421aeb21b2c)

## Design Health Score

| #         | Heuristic                                               |   Score   | Key Issue                                                                            |
| --------- | ------------------------------------------------------- | :-------: | ------------------------------------------------------------------------------------ |
| 1         | Visibility of System Status                             |     3     | Hero 数据与底部摘要即时联动优秀；但未启用拼写的卡片缺乏状态说明                      |
| 2         | Match System / Real World                               |     3     | 语言学习中“打字拼写”与“翻卡自测”均为自由练习的分支，此前割裂为独立功能与真实心智脱节 |
| 3         | User Control and Freedom                                |     3     | 退出与启动流畅；但在独立页面体系下，用户无法直接在练习中切入拼写，需退回首页重进     |
| 4         | Consistency and Standards                               |     2     | **严重破损**：首页卡片上学习与练习为带文字按钮，拼写为纯图标且非拼写卡包留有空白占位 |
| 5         | Error Prevention                                        |     3     | 数量输入框具备失焦纠错与上下限钳位；融合后需在不支持拼写的卡包中提供合理的禁用保护   |
| 6         | Recognition Rather Than Recall                          |     2     | 首页纯键盘图标缺乏文字标识，用户难以直观理解其功能；融合后通过模式选项卡明确文字认知 |
| 7         | Flexibility and Efficiency                              |     3     | 支持 `Space` 快捷键启动；但若缺乏模式记忆，用户每次练习均需重复切换 Tab              |
| 8         | Aesthetic and Minimalist Design                         |     3     | 原拼写设置页内容过于单薄，原练习卡片操作区存在占位破洞；融合后整页信息密度更均匀舒适 |
| 9         | Help Users Recognize, Diagnose, and Recover from Errors |     2     | 词条未准备好时（缺少 stable ID 或格式异常）报错提示较为隐蔽，缺乏直观引导            |
| 10        | Help and Documentation                                  |     3     | 辅助说明文案（note）清晰解释了智能选词与方向概念，但缺少拼写格式规范说明             |
| **Total** |                                                         | **27/40** | **Acceptable (可接受，有明确重构价值)**                                              |

## Design Specificity Verdict

- **LLM 主观评估**：
  现有界面的视觉基因（清透青重点色、SFMono 等宽数字、卡片边框与圆角）非常贴合 Study Studio “安静学习工作台”的定位。但当前架构存在典型的“功能孤岛”设计问题：`PracticeSetup` 与 `SpellingSetup` 布局重合度超 90%，却在首页卡片和路由层面强行切分出两个平行顶层入口。这种生硬切分不仅造成 `DeckCard` 右侧出现空 `span` 占位符破洞与无文字图标，还让用户在选择学习形态时产生了不必要的认知摩擦。
- **机械检测结果 (Deterministic scan)**：
  对 `PracticeSetup.tsx`、`SpellingSetup.tsx` 和 `DeckCard.tsx` 的静态规则检测为 **0 项违规**。组件严格依托 SCSS Module 与 Obsidian CSS 变量体系，未发现内联 AI 渐变、未授权字体注入等通病代码。
- **可视化叠加层 (Visual overlays)**：
  由于本地 Obsidian 未通过 `--remote-debugging-port=9222` 开放 CDP 调试端口，浏览器/Electron 动态渲染测量与叠加层注入已安全跳过。

## Overall Impression

用户的直觉非常敏锐且完全正确：**拼写模式本质上就是练习的一种交互载体**。将拼写作为“练习”的子模式合并，不仅让学习者的心智从“零散的功能工具”回归到“规划复习 vs 自由练习”的两大核心支柱，更是一举消除了 `DeckCard` 首页卡片上的幽灵占位符和无文字键盘图标，让界面逻辑更加纯粹、一致。

## What's Working

1. **统一的设置页容器规范 (`SetupPage`)**：
   Hero 计数字体清晰，底部固定工具条结合 Space 快捷键启动，操作动线非常干脆。
2. **沉浸克制的设计语言**：
   严格遵循 Obsidian 宿主中性色与 Study Studio 状态色，无过度装饰，阅读与操作呼吸感良好。
3. **分段控制器的交互基底 (`SetupSelector`)**：
   内置的 `SetupControlGroup` 与 `SetupSelector` 已经具备极佳的键盘可访问性与状态表达能力，天然支持模式切换。

## Priority Issues

### [P0] 清理 DeckCard 操作区，消除空白占位符与图标不一致

- **现象**：`DeckCard.tsx` 中 `学习` 与 `练习` 是完整的带文字按钮，而 `拼写` 却挤在旁边作为纯键盘图标存在；不支持拼写的卡包还用 `<span className="flashcard-deck-action-spelling-placeholder" />` 硬撑宽度。
- **为什么重要**：严重破坏首页卡片网格的一致性，未启用拼写的题库出现空白破洞，用户难以理解该空白与键盘图标的意图。
- **修复方案**：彻底移除卡片上的独立拼写按钮与空白占位。卡片右侧收敛为纯粹的标准操作集：`[ 学习 ]` + `[ 练习 ]` + `[ ⋯ 更多 ]`。
- **建议命令**：`/impeccable distill src/features/flashcards/ui/views/Home/DeckCard/DeckCard.tsx`

### [P1] 在练习设置页顶部建立「练习模式」一级切换

- **现象**：两个设置页面 90% 结构雷同却分道扬镳，用户无法在一个入口内决定练习方式。
- **为什么重要**：增加了概念复杂度，打破了学习者的心理预期。
- **修复方案**：在 `PracticeSetup` 顶部引入第一级选项卡：`[ 🎯 翻卡练习 ]` 与 `[ ⌨️ 单词拼写 ]`。若卡包不支持拼写，保持拼写项可见但置灰并展示引导提示。
- **建议命令**：`/impeccable shape src/features/flashcards/ui/views/Practice/PracticeSetup.tsx`

### [P2] 模式切换时的表单动态演变 (Morphing) 与渐进披露

- **现象**：翻卡练习拥有“出题方向”（正常/反转）与随机题量梯度 `[20, 50, 全部]`；拼写练习拥有“智能选词”（优先错词）与打字词量梯度 `[10, 20, 全部]`，且无反向拼写概念。
- **为什么重要**：若简单拼接会导致无效表单控件（例如“反转拼写”）暴露给用户，带来理解混乱。
- **修复方案**：
    - 切到翻卡：展示出题方向、随机题量 / 单词范围控制；
    - 切到拼写：隐藏出题方向、展示智能选词（优先错弱词）/ 乱序范围控制，快捷词量采用较小梯度；
    - 顶部 Hero 统计与底部启动文案自适应联动（`开始 · 39 题` vs `开始 · 20 个词条`）。
- **建议命令**：`/impeccable layout src/features/flashcards/ui/views/Practice/PracticeSetup.tsx`

### [P3] 模式偏好记忆 (State Continuity)

- **现象**：若用户专注于拼写练习，每次进入均需重新手动切换模式。
- **为什么重要**：增加重复操作税 (Interaction Tax)，削弱键盘流用户的启动效率。
- **修复方案**：卡包级记住用户的上次练习模式选择（`lastPracticeKind: "flip" | "spelling"`），若该卡包拼写就绪且上次为拼写，下次点击练习默认停留在拼写。
- **建议命令**：`/impeccable polish src/features/flashcards/ui/views/Practice/PracticeSetup.tsx`

## Persona Red Flags

- **Alex (高频键盘流极客)**：
  Alex 习惯进入设置页后秒按 Space 启动。如果每次都默认翻卡，需要手动切到拼写再按空格，会打断心流。**必须支持模式记忆与键盘快捷键切换（如 Tab/左右键切模式）**。
- **Jordan (初次使用小白)**：
  如果一个题库没有规范的英文单词，Jordan 看到“单词拼写”变灰可能会困惑。**必须提供轻量 Tooltip/引导解释，例如“词库中未检测到可拼写的单词字段”**。
- **Sam (无障碍与读屏依赖者)**：
  模式切换导致下方表单项动态增删时，若 DOM 结构剧烈变动会导致焦点丢失。**必须使用语义化 `radiogroup`，平稳过渡表单控件**。

## Minor Observations

- 原拼写设置界面的说明文案（`智能模式会优先安排错词条、新词条和掌握较弱的词条`）非常优秀，融合后应完整保留在智能选词的注释中。
- 当从“单词列表 (WordList)”页面通过选中特定词条跳转进入练习时，可以直接自动将模式锁定为“拼写”，体验更加智能。

## Questions to Consider

- “当卡包既有常规问答卡又有词汇卡时，翻卡练习是否包含词汇卡？还是翻卡练习包含全部，而拼写练习仅提取词汇卡？”
- “在卡片首页的练习按钮上，是否需要给支持拼写的卡包增加一个微型徽标或提示，以便用户感知该卡包支持拼写？”
