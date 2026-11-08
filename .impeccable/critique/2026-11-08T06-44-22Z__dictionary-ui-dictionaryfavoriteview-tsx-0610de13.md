---
target: 收藏单词界面
total_score: 34
max_score: 40
na_heuristics:
p0_count: 1
p1_count: 2
target_identity: "file:/Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/dictionary/ui/DictionaryFavoriteView.tsx"
target_fingerprint: "sha256:ac7c59f6d647bddd0973dcdd32fe10205b3931ceef04684df8417bb3b91692b8"
target_path: /Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/dictionary/ui/DictionaryFavoriteView.tsx
timestamp: 2026-11-08T06-44-22Z
slug: dictionary-ui-dictionaryfavoriteview-tsx-0610de13
---

# 收藏单词界面第二轮细节 UX 设计评审 (Design Critique Round 2)

### Design Health Score

| #         | Heuristic                                               |   Score   | Key Issue                                                                                         |
| --------- | ------------------------------------------------------- | :-------: | ------------------------------------------------------------------------------------------------- |
| 1         | Visibility of System Status                             |     4     | 生成与保存均有清晰状态反馈，目标 Markdown 文件路径透明，正反面卡片标记分明。                      |
| 2         | Match Between System and Real World                     |     4     | “卡片正面/背面”双面闪卡隐喻契合度极高，摆脱了单纯数据库表单的冷硬感。                             |
| 3         | User Control and Freedom                                |     3     | 清空按钮已安全隔离至表头右侧且仅在有内容时出现，但 AI 生成过程中缺少显式取消动作。                |
| 4         | Consistency and Standards                               |     3     | 保存分类采用 1px 虚线边框破坏了卡片统一感；保存按钮内部的 `Ctrl+↵` 徽标纯白底色在青底上过于刺眼。 |
| 5         | Error Prevention                                        |     4     | 危险清空按钮已彻底脱离主保存区，空值保存校验完备。                                                |
| 6         | Recognition Rather Than Recall                          |     3     | 卡片 Header 右侧的 `↵ AI` 与输入框内动作按钮的 `↵` 存在双重线索冗余。                             |
| 7         | Flexibility and Efficiency                              |     3     | AI 生成完成后焦点丢失（未自动转移至中文意思输入框），键盘流用户需伸手摸鼠标。                     |
| 8         | Aesthetic and Minimalist Design                         |     3     | 输入框内嵌按钮带有显式外边框（框中套框）；虚线边框带来草稿感；文本域默认高度略显充斥。            |
| 9         | Help Users Recognize, Diagnose, and Recover from Errors |     4     | 底部状态栏提供清晰图标与错误原因反馈。                                                            |
| 10        | Help and Documentation                                  |     3     | 快捷键基本完备，但建议收敛冗余提示。                                                              |
| **Total** |                                                         | **34/40** | **Good (良好 · 需打磨细节)**                                                                      |

---

### Design Specificity Verdict

- **LLM assessment**:
  经过卡片化改造后，界面整体骨架已成功升级为符合产品“双面生词闪卡”特性的学习容器。然而对照用户实机截图，多处**视觉噪点与微交互断层**削弱了“安静工作台”的精致度：分类卡片的虚线边框带来了“拖拽上传区/草稿”的不稳定隐喻；实色青按钮内的快捷键白块像贴上去的补丁；输入框内按钮存在“框中套框”的机械感；尤为关键的是，**AI 生成完成回填数据后光标丢失**，用户无法一气呵成检查释义并按快捷键保存。
- **Deterministic scan**:
    - `DictionaryFavoriteView.tsx`: 0 项违规。
    - `Dictionary.module.scss`: 0 项违规。

---

### Priority Issues

- **[P0] AI 生成完成后焦点丢失，键盘流被强行中断**
    - **Why it matters**: 用户按 Enter 触发 AI 生成后，焦点随 disable 被浏览器抛弃。数据生成完毕后光标未自动聚焦到“中文意思”文本域，导致用户必须抬手拿鼠标点击框内才能检查与编辑，极客与高频学习心流瞬间断裂。
    - **Fix**: 在 `DictionaryFavoriteView.tsx` 中为中文意思 Textarea 增加 ref，监听 `state.status` 从 `"generating"` 到 `"success"` 的状态跃迁，自动将焦点移动至中文意思输入框并将光标置于文本末尾。
    - **Suggested command**: `/impeccable polish`

- **[P1] 保存分类 `metaSection` 虚线边框带来“文件拖拽上传区”的错误隐喻**
    - **Why it matters**: 虚线边框在 UI 规范中主要代表临时草稿或可拖入文件的 Dropzone，在此处显得松散且产生认知误导。
    - **Fix**: 改为实线边框 `border: 1px solid var(--fc-line-soft)`，保持稳重统一的次级卡片容器感。
    - **Suggested command**: `/impeccable layout`

- **[P1] 保存主按钮中的 `Ctrl+↵` 徽标白底过于扎眼，破坏调色板和谐**
    - **Why it matters**: 通用 `.shortcutKbd` 的纯白底色在清透青主按钮内部形成了高对比度补丁感，割裂了主按钮整体质感。
    - **Fix**: 在主按钮内部将 `.shortcutKbd` 定制为半透明叠加底色（`background: color-mix(in srgb, var(--fc-primary-text) 16%, transparent); border-color: transparent;`），柔和且内敛。
    - **Suggested command**: `/impeccable polish`

- **[P2] 输入框内嵌「AI 生成」按钮存在“框中套框”与双重快捷键冗余**
    - **Why it matters**: 单词卡片 Header 已经标了 `↵ AI`，输入框内按钮又挂了 `↵`，且按钮带有自己的边框和底色，在输入框内部显得层级繁杂。
    - **Fix**: 移除 Header 上的冗余 `↵ AI`；内嵌按钮改为无默认边框、透明背景的优雅浮动动作，仅在 hover 时轻微高亮。
    - **Suggested command**: `/impeccable clarify`

- **[P2] 释义与笔记文本域高度占满视口，产生压迫感**
    - **Why it matters**: 初始状态下双文本域占据过大垂直空间，将分类和操作区挤至底沿。
    - **Fix**: 适度微调 `min-height`（3.6rem 约两至三行起始高度），保持轻盈同时支持拖拽拉伸。
    - **Suggested command**: `/impeccable layout`
