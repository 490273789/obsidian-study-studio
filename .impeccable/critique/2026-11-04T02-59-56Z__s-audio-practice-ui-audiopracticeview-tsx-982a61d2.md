---
target: 听说练习页面
total_score: 38
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 0
target_identity: "file:/Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/audio-practice/ui/AudioPracticeView.tsx"
target_fingerprint: "sha256:ed025b1616fb9a0bcdebbc98471787a330529f5e9331356335093790eed04b3a"
target_path: /Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/audio-practice/ui/AudioPracticeView.tsx
timestamp: 2026-11-04T02-59-56Z
slug: s-audio-practice-ui-audiopracticeview-tsx-982a61d2
closed: true
---

Method: dual-agent (A: 8521a40f-cb24-410b-b16e-967f8fab8234 · B: 52938d98-7af2-4fb6-bb1f-b0c0994aeb5b)

## Design Health Score

| #        | 启发式原则 (Heuristic)                         | 得分 (0-4) | 核心发现 (Key Issue)                                                          |
| -------- | ---------------------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| 1        | 状态可见性 (Visibility of System Status)       | 4          | 播放状态、等宽时间码、当前句左侧 3px 青色状态导轨与微调步进反馈明确清晰       |
| 2        | 贴近现实与习惯 (Match System / Real World)     | 4          | “字幕微调（秒）”替代技术化词汇，增加 ±0.1s 快捷步进，符合播放器认知习惯       |
| 3        | 用户控制与自由 (User Control & Freedom)        | 4          | 支持全套键盘心流操作，选句、跳转、重听与难句标记无缝衔接                      |
| 4        | 一致性与标准 (Consistency & Standards)         | 4          | 严格遵循 DESIGN.md 签名模式（状态轨道行、中性表面色阶、标准二次确认弹窗）     |
| 5        | 防错机制 (Error Prevention)                    | 4          | “重新生成字幕”增加危险操作二次确认弹窗，有效保护已校对字幕与难句标记          |
| 6        | 识别胜于回忆 (Recognition Rather Than Recall)  | 4          | 顶栏常驻高对比度快捷键指引，当前句状态明确，字幕文本允许划词查词              |
| 7        | 灵活性与使用效率 (Flexibility & Efficiency)    | 4          | 快捷键支持（R/S/D/H/上下箭头），Roving Tabindex 将 160 个 Tab 键位精简至 2 个 |
| 8        | 美观与极简主义 (Aesthetic & Minimalist Design) | 4          | 列表限制居中最大阅读宽度 840px，消除千像素横向撕裂，星标与文本紧密相邻        |
| 9        | 错误恢复 (Error Recovery)                      | 3          | 失败提供明确 Alert 与重试入口                                                 |
| 10       | 帮助与文档 (Help & Documentation)              | 3          | 快捷键与材料提示完备，无障碍标签与按钮 Title 说明详细                         |
| **总计** |                                                | **38/40**  | **Excellent (优秀，生产级精细交付)**                                          |

---

## Post-Fix Verification

已完成全量优先级问题的工程级修复与验证：

1. **键盘跟读心流补全**：新增 `R`（重听本句）、`S` / `D`（标记/取消难句）、`H`（揭示盲听）、`↑` / `↓`（切句）全局监听；
2. **Tab 焦点地狱根除**：字幕列表实现 Roving Tabindex，仅当前活动句与激活星标参与 Tab 遍历，其余设置 `tabIndex={-1}`；
3. **宽屏横向撕裂收敛**：字幕列表限制居中最大宽度（`max-width: 840px`），当前句增加 3px 品牌色指示导轨与加重字体；
4. **查词生态打通**：为字幕文字启用 `user-select: text` 与 `cursor: text`，学习者可随时划词呼出 Obsidian 词典与划词助手；
5. **高危防错加固**：“重新生成字幕”在已有字幕或草稿时强制弹出 `ConfirmDialog` 警告覆盖风险；
6. **字幕微调体验优化**：文案更新为“字幕微调（秒）”，并为输入框增加 `±0.1s` 快捷步进按钮。
