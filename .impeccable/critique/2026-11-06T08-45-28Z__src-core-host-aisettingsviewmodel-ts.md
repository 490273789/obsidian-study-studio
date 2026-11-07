---
target: src/core/host/aiSettingsViewModel.ts
total_score: 18
max_score: 40
na_heuristics:
p0_count: 1
p1_count: 1
target_identity: "file:/Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/core/host/aiSettingsViewModel.ts"
target_fingerprint: "sha256:c8d3071689153e0982afac14f7acd04ac6c29c1eee1bd95f1131a0ab1169fa1f"
target_path: /Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/core/host/aiSettingsViewModel.ts
timestamp: 2026-11-06T08-45-28Z
slug: src-core-host-aisettingsviewmodel-ts
---

# Impeccable 设计审查报告：AI 引擎设置界面

Method: dual-agent (A: 2389ca3a-d8f9-4bec-a6e1-9f26ce8ca205 · B: 3afb9740-7885-4cec-a00b-ab7daa1dd0be)

> **评估目标**：`src/core/host/aiSettingsViewModel.ts` 及 Obsidian Study Studio 插件中的 **AI 引擎设置**（AI Engine Settings）交互界面  
> **审查依据**：实机渲染截图、`aiSettingsViewModel.ts`、`aiSettingsEditor.ts`、`settingsControlRenderer.ts`、`settings.scss`、PRODUCT.md 与 DESIGN.md。

---

## 1. 设计健康度评分 (Design Health Score)

| #        | 启发式原则 (Heuristic)                                         |    得分     | 关键问题诊断 (Key Issue)                                                                                                       |
| -------- | -------------------------------------------------------------- | :---------: | ------------------------------------------------------------------------------------------------------------------------------ |
| 1        | **系统状态可见性** _(Visibility of System Status)_             |  **1 / 4**  | 列表态完全无法感知各引擎的连通状态与密钥有效性。测试连通性必须深入到二级编辑表单中，无就近状态指示。                           |
| 2        | **系统与现实世界匹配** _(Match Between System and Real World)_ |  **2 / 4**  | 采用后端开发者的基础设施架构分类（LLM vs ASR vs 文本翻译），而非学习者的任务心智（查词释义助手、听力跟读转写、文章双语翻译）。 |
| 3        | **用户控制与自由度** _(User Control and Freedom)_              |  **2 / 4**  | 当前默认引擎（如 `DS (默认)`）的删除按钮毫无阻拦地直接暴露在外层列表，点击后直接物理删除，无确认弹窗。                         |
| 4        | **一致性与标准化** _(Consistency and Standards)_               |  **2 / 4**  | 严重的标题口吃与标签重复：每个分组大标题与其下第一个控件项名称机械重复（“服务类型”、“默认引擎”、“已配置的引擎”）。             |
| 5        | **防错机制** _(Error Prevention)_                              |  **1 / 4**  | 高危操作（删除配置）与高频安全操作（编辑）并排紧邻放置；误删默认引擎后无兜底与即时守护。                                       |
| 6        | **识别胜过回忆** _(Recognition Rather Than Recall)_            |  **2 / 4**  | 默认引擎下拉选单仅显示简写代号 `DS`；用户需要在大脑中维持代号与真实服务商、模型的跨模块对应关系。                              |
| 7        | **使用灵活性与效率** _(Flexibility and Efficiency)_            |  **2 / 4**  | 缺少列表快捷操作：不支持在列表项上一键“设为默认”或“快速连通性测试（Ping）”，微调必进深层表单。                                 |
| 8        | **美学与极简主义设计** _(Aesthetic and Minimalist Design)_     |  **2 / 4**  | 信息层级扁平，粉红色的“删除”边框喧宾夺主成为视觉焦点，颠倒了沉浸安静学习的视觉重心。                                           |
| 9        | **错误识别、诊断与恢复** _(Error Recovery)_                    |  **2 / 4**  | 错误依赖短暂自动消失的 Notice 浮层提示，列表中没有任何持久化的错误标记或就近修复建议。                                         |
| 10       | **帮助与文档** _(Help and Documentation)_                      |  **2 / 4**  | 帮助文案偏技术参数配置说明，缺乏面向中文英语学习者获取 API Key、选择高性价比模型的操作指引。                                   |
| **总分** |                                                                | **18 / 40** | **较差 (Poor)**                                                                                                                |

---

## 2. 产品专属性判定 (Design Specificity Verdict)

**LLM 设计评审**：**严重通用化与工具异化**。PRODUCT.md 明确 Study Studio 的核心价值是“面向以中文为主要语言的英语学习者，在 Obsidian 内围绕 Markdown 笔记、词汇和音视频材料开展闪卡记忆、查词翻译与听说练习”，DESIGN.md 确立的北极星是“安静的学习工作台：克制、清晰、紧凑，让阅读内容优先”。但当前的“AI 引擎设置”页面是一个脱离学习语境的通用型云服务代理配置台：充斥着“Base URL”、“Workspace ID”、“同构模型”等底层开发术语，学习者无法感知这些模型与闪卡、选区查词或听力跟读的具体关联。

**确定性检测扫描**：对 `src/core/host/aiSettingsViewModel.ts` 及渲染链路共 7 个源码文件执行静态扫描，命中 0 项阻断性设计系统违规或 AI 生成特征代码，SCSS 样式严格遵循 `--fc-*` 语义 Token 规范，代码架构保持了清晰的单向数据流契约。

**视觉覆盖层 (Visual Overlays)**：插件运行于桌面端 Electron 环境，当前未挂载远程调试端口（CDP 9222），覆盖层动态注入依法跳过，评审依据实机静态渲染快照与单元测试基线展开。

---

## 3. 整体印象 (Overall Impression)

架构底层非常干净且安全规范（严格遵守 Obsidian SecretComponent），但用户界面直接将数据模型裸露为平铺列表，存在严重的“标题口吃”、高危操作毫无防护、视觉重心被危险红框绑架的问题。最核心的突破点在于：**将“云资源配置台”转变为“学习助手管理卡片”**，消除重复标题，并为列表赋予状态与安全屏障。

---

## 4. 表现良好的亮点 (What's Working)

1. **响应式架构与数据契约解耦**：`aiSettingsViewModel.ts` 严格基于快照驱动，与底层 `AiService` 完全解耦，这为后续直接升级卡片式 UI 提供了零技术债务的基础。
2. **遵守 Obsidian 宿主凭证安全体系**：使用 Secret 管理 API Key，不向明文配置暴露用户密钥。
3. **精准契合国内英语学习者的大模型生态**：预置了 DeepSeek、阿里云百炼、有道智云及 OpenAI 兼容协议。

---

## 5. 核心优先级缺陷 (Priority Issues)

- **[P0] 危险操作零防护与破坏性按钮常态暴露**
    - **危害**：每个引擎项（包括生效中的默认引擎）右侧直接并列粉红色“删除”按钮，点击后立即物理删除且无二次确认。极易误触并直接导致查词与闪卡功能瘫痪。
    - **修复建议**：默认引擎禁用外层删除；删除操作收敛至编辑页底部或二级菜单，并增加二次确认防护；降低删除按钮常态视觉权重。
    - **推荐命令**：`/impeccable harden`

- **[P1] 致命视觉口吃与分组标签多重重复渲染**
    - **危害**：“服务类型”、“默认引擎”、“已配置的引擎”每个分组大标题紧接着在第一行重复渲染完全同名的设置项标签，严重破坏阅读节奏与无障碍体验。
    - **修复建议**：重构分组与控件层级，分组有明确大标题时，内部首项直接承载说明与控制件（如将新增按钮作为分组头部操作或卡片列表底部的虚线添加位）。
    - **推荐命令**：`/impeccable clarify`

- **[P2] 连通性感知与运行状态在列表态完全黑盒**
    - **危害**：列表项仅展示裸文本 `名称 · 厂商 · 模型`，无法感知 API Key 是否有效、是否欠费或连通正常，必须点进编辑表单深处才能测连通性。
    - **修复建议**：采用 DESIGN.md 规范的状态轨道（Status Rail）或状态徽章，并在列表提供轻量级的“测试连通性”操作。
    - **推荐命令**：`/impeccable polish`

- **[P3] 基础设施视角与英语学习心智割裂**
    - **危害**：下拉选单仅显示简写代号 `DS`，且服务类型按技术分类（LLM vs 文本翻译）导致学习者困惑“查词和翻译到底该配哪一个”。
    - **修复建议**：下拉选单与列表卡片展示全名并附带学习场景标签（如 `[闪卡 AI 释义]`、`[听力跟读转写]`），强化场景代入感。
    - **推荐命令**：`/impeccable adapt`

---

## 6. 典型角色红旗警报 (Persona Red Flags)

- 🔴 **Alex（高阶效率用户 / Power User）**：默认引擎下拉框只显示晦涩的简写 `DS`；无法在列表项上一键设为默认或快速测试延迟，微调效率低下。
- 🔴 **Jordan（初次使用新手 / First-Timer）**：被“ASR”、“有道大模型网关 vs 文本翻译”弄糊涂；配置完成后列表没有任何绿色的“已连接”提示，充斥着怕配错扣费的心理焦虑。
- 🔴 **Sam（辅助功能依赖者 / Accessibility-Dependent）**：屏幕阅读器读到“服务类型 服务类型”、“默认引擎 默认引擎”产生严重的重复信息困扰；触控屏上编辑与删除按钮间距过近，极易手抖误删。
- 🔴 **Riley（极端压力测试者 / Stress Tester）**：直接点击默认引擎的“删除”按钮，系统没有任何拦截直接删除，随后的查词功能陷入未捕获的级联报错。

---

## 7. 次要观察细节 (Minor Observations)

1. “已配置的引擎”描述文案死板硬编码为“管理 DeepSeek、阿里云百炼和有道大模型网关”，未包含用户可能添加的自定义 OpenAI-compatible 或 Ollama 引擎。
2. “新增引擎”按钮作为一个核心正向操作，被挤压在单行右侧，视觉引导力不足。
3. 表单编辑视图中，顶部有“返回列表”，底部又有“保存”与“取消”，操作出口语义重叠。

---

## 8. 启发性反思问题 (Questions to Consider)

1. **我们真的需要把“大模型管理”做成一个独立的基础设施池吗？**
   _能否将引擎配置有机融入首次查词或闪卡释义的引导流程中，让用户按需激活？_
2. **为什么不可逆的“删除”操作在屏幕上拥有比正向的“新增”和“就绪状态”更高的色彩饱和度？**
   _我们是否在用视觉警报色恐吓用户，而非用沉稳的中性色让用户感到安全？_
3. **“默认引擎”是否真的有存在的必要？**
   _如果每个学习功能（闪卡、听力、词典）都能按自身需求明确绑定引擎，是否可以彻底消灭这个单点崩溃的“全局默认引擎”概念？_
