---
target: 学习/练习/拼写统一设置页 (SetupPage)
total_score: 21
max_score: 40
na_heuristics:
p0_count: 1
p1_count: 2
target_identity: "file:/Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/flashcards/ui/primitives/SetupPage/SetupPage.tsx"
target_fingerprint: "sha256:eb0ebc7322f0c02c85108c39a5a0338b5e2e90ebb2fa7627e42b8d627a7eb316"
target_path: /Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/flashcards/ui/primitives/SetupPage/SetupPage.tsx
timestamp: 2026-10-31T08-38-30Z
slug: src-features-flashcards-ui-primitives-setuppage-setuppage-tsx
closed: true
---

### Design Health Score

| #         | Heuristic                                        |   Score   | Key Issue                                                                                                            |
| --------- | ------------------------------------------------ | :-------: | -------------------------------------------------------------------------------------------------------------------- |
| 1         | Visibility of System Status (系统状态可见性)     |     2     | 学习模式 Hero 大数字 62 与下方计划“第 3 天 7/20”产生认知矛盾；拼写模式缺乏题库掌握状态预览。                         |
| 2         | Match System / Real World (贴合现实与环境)       |     2     | 学习顺序使用音频波形图标（`AudioWaveform`）形成严重隐喻漂移；选择练习方式使用通用系统滑块图标。                      |
| 3         | User Control and Freedom (用户控制与自由度)      |     2     | 拼写模式缺失自定义数量输入能力；范围输入框 `onChange` 立即强行 Clamp 导致无法自然退格编辑。                          |
| 4         | Consistency and Standards (一致性与行业标准)     |     1     | **严重缺陷**：宿主粉红强调色与固定清透青在设置图标上产生刺眼冲突；三页面主按钮格式（括号 vs 间隔号）与模式术语分裂。 |
| 5         | Error Prevention (防错机制)                      |     3     | 卡片为 0 时禁用开始按钮；练习模式 blur 时平滑纠偏。但输入中途缺乏即时越界提示。                                      |
| 6         | Recognition Rather Than Recall (识别优于回忆)    |     3     | 底部摘要胶囊（如 `乱序学习 · 正常模式`）实时沉淀选项状态，但分段选择器缺乏方向键巡检。                               |
| 7         | Flexibility and Efficiency (灵活性与效率)        |     2     | 支持全局 Space 发车，但焦点落入按钮或输入控件后快捷键被拦截失效；缺少键盘方向键切换分段选项。                        |
| 8         | Aesthetic and Minimalist Design (审美与极简设计) |     2     | 练习与拼写页面 70% 荒漠化空场，内容堆积在顶部，与底部悬浮按钮严重脱节；异色背景形成视觉噪音。                        |
| 9         | Error Recovery (帮助识别与恢复错误)              |     2     | 今日无卡片可学时按钮单纯置灰并禁用，缺乏直接的后续动作指引（如跳转复习或新建卡片）。                                 |
| 10        | Help and Documentation (帮助与文档)              |     2     | 拼写模式切换到“范围乱序”后说明文案仍显示“智能模式...”；学习顺序注记“适合复习易错卡片”指意不明。                      |
| **Total** |                                                  | **21/40** | **可接受 (Acceptable，亟需规范化统一)**                                                                              |

---

### Design Specificity Verdict (设计特异性评定)

**LLM 设计评审结论**：
当前的三个设置界面虽然基于共享的 `SetupPage` 模版，但未能兑现 [`DESIGN.md`](file:///Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/DESIGN.md) 中“**安静的学习工作台**”的承诺，而是呈现出一种机械、生硬的“通用后台配置表单”质感。

- **工作台心流阻断**：作为学习者进入高专注度练习的“准备舱”，界面充斥着标准表单的容器包裹、大面积苍白的空场（尤其是拼写和练习模式下超过 70% 的面积被闲置），丢失了工具型工作台应有的致密、严谨与期待感。
- **主题边界击穿**：实机运行下，宿主主题强调色（粉红）渗透进插件私有的 `--fc-primary-bg`，与固定清透青（`#00b8c4`）激烈碰撞，产生刺眼的“粉底配青标”视觉冲突。
- **模版复用不彻底**：三大模式在细节交互（自定义输入、平滑校验、微文案格式）上各自为政，拼写模式功能严重缩水。

**确定性静态扫描与代码证据 (Deterministic scan & Code Evidence)**：

- 沙盒环境中 CLI 检测器受权限限制未能直接执行，全面降级为深度的静态源码与 DOM/CSS 审计。
- **可访问性关键缺陷**：`Button.scss` 中 `focus-visible` 描边被整段注释，导致键盘 Tab 巡检失去视觉焦点；整页缺少任何 `<h1>-<h6>` 标题标签。
- **CSS 架构与死代码**：`SetupSelector.scss` 遗留无效的 `grid-template-columns: 1fr` 死代码；边框分割线错误写入 `@media` 导致桌面窄分栏状态下样式缺失。
- **规范违规**：`SetupPage.tsx` 使用模板字符串而非仓库强制的 `cls(...)`；`SetupPage.module.scss` 存在大量未经系统收敛的私有 `color-mix` 比例。

---

### Priority Issues (优先改进问题清单 P0–P3)

- **[P0] 宿主强调色与固定主色冲突 (Host-Plugin Color Boundary Clash)**
    - **Why it matters**: 严重违背 `DESIGN.md` “The Theme Boundary Rule”，破坏安静学习的视觉沉浸感，导致刺眼的“粉底配青标”与视觉廉价感。
    - **Fix**: 在 `base.scss` 中将 `--fc-primary-bg` 修正为与清透青同源的轻染混色（`color-mix(in srgb, var(--fc-primary) 12%, var(--fc-surface-card))`），宿主强调色严格限制在宿主级别。
    - **Suggested command**: `/impeccable colorize`

- **[P1] 页面荒漠化与 Sticky Footer 撕裂 (Layout Imbalance & Severed Action Stream)**
    - **Why it matters**: 拼写与练习模式下内容不足 25%，大面积留白导致用户视线必须跨越 500px 空白寻找右下角开始按钮，违背格式塔亲密性与费茨法则。
    - **Fix**: 优化 SetupPage 布局节奏，采用紧凑流与弹性空间管理；在空白区引入题库就绪洞察（词库掌握度/预估耗时卡片），消除冷场。
    - **Suggested command**: `/impeccable layout`

- **[P1] 三大模式能力与文案规范分裂 (Inconsistent Capabilities & Copy Bug)**
    - **Why it matters**: 拼写模式无法自定数量且输入退格即被重置为 1；切换模式后注记文案未联动；主按钮文案三种格式割裂。
    - **Fix**: 统一主按钮格式为 `开始 · {count} {单位}`；拼写模式补齐自定义题量输入与平滑退格编辑；修复拼写动态注记 Bug；统一模式术语。
    - **Suggested command**: `/impeccable clarify`

- **[P2] 学习模式核心数字认知冲突 (Conflicting Core Numbers in Study Mode)**
    - **Why it matters**: “今日学习卡片 62” 与 “第 3 天 7/20” 缺乏因果解释，给初学者造成强烈算术心智负担与焦虑。
    - **Fix**: 用明确的数学逻辑或标签分解呈现：`今日 62 张 = 第 3 天新卡 (20) + 到期复习 (42)`。
    - **Suggested command**: `/impeccable distill`

---

### Persona Red Flags (用户画像危险信号)

- **Alex (效率极客)**: 拼写模式无法输入自定义数量（如想突击 35 词被封死）；Tab 或点击修改选项后全局 Space 快捷键被截获失效；分段按钮无法用方向键切换。
- **Jordan (新手用户)**: 看到 62 与 7/20 冲突数字担心一口气跳出 62 张卡片被淹没；看到音频波形图标误以为要开麦测试，产生心理抗拒。
- **Sam (无障碍用户)**: 按钮 `focus-visible` 被注释导致键盘操作无法定位焦点；整页缺乏标题层级标签，读屏软件无法进行结构化巡航；粉底青标对比度跌破 WCAG AA。

---

### Minor Observations (次要细节观察)

1. `SetupSelector.scss` 中包含 `grid-template-columns: 1fr` 死代码，且容器查询与媒体查询职责断层。
2. 快捷键徽标文字仅 10px（`--fc-font-2xs`），浅色主题下对比度偏低。
3. Header 关闭按钮 `X` 未达到 44×44px 的理想触摸靶区。
4. `SetupPage.tsx` 存在多处未遵循 `cls(...)` 规范的字符串拼接。

---

### Questions to Consider (激发性思考)

1. 是否应当将学习、练习、拼写收敛为一个统一的“卡组就绪工作台（Learning Launchpad）”，通过顶部 Tab 快速切换，而不是三个割裂的模态路由？
2. 能否在中间空白区域呈现 FSRS 记忆曲线预测或预计练习耗时（如“预计用时 8-10 分钟”），让准备页具备真正的专注心理暗示？
3. 底部操作条是否可以在内容紧凑时自然跟随在卡片下方，内容超长时再浮动吸底？
