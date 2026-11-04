---
target: 英语字典页面
total_score: 21
max_score: 40
na_heuristics:
p0_count: 2
p1_count: 2
target_identity: "file:/Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/dictionary/ui/DictionaryView.tsx"
target_fingerprint: "sha256:0e72e7743f15a76da8a19806b56f45b8f7b27a8297b81c171fea5887efc0d9e1"
target_path: /Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/dictionary/ui/DictionaryView.tsx
timestamp: 2026-11-04T05-11-33Z
slug: src-features-dictionary-ui-dictionaryview-tsx
---

### Design Health Score

| #         | Heuristic                                               | Score     | Key Issue                                                                                                           |
| --------- | ------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| 1         | Visibility of System Status                             | 2         | 书签按钮未指示当前词“是否已在生词本/卡片库中”；非激活 Tab 成功状态点被强制置灰；发音无播放中状态反馈                |
| 2         | Match System / Real World                               | 3         | 音标与释义排版符合词典惯例，但将错词（如 `dignose`）当正常历史实体陈列，缺少真实查词场景的拼写容错                  |
| 3         | User Control and Freedom                                | 2         | 历史记录无法单项删除（仅有一个全局清空垃圾桶）；无法快速排布词典源优先度；键盘 roving focus 在多词典源下错乱        |
| 4         | Consistency and Standards                               | 2         | 将全局“设置”与“批量导入”塞在单词搜索框内违背标准模式；MDX 沙箱残留外源草绿边框与老旧渐变；断点用 720px 偏离设计规范 |
| 5         | Error Prevention                                        | 2         | 清空垃圾桶紧贴设置与搜索框易误触；缺少拼写纠错提示（Did you mean）                                                  |
| 6         | Recognition Rather Than Recall                          | 2         | 无法在释义流中直接勾选例句入卡，必须凭记忆手动复制粘贴；标题栏 Bookmark / Copy 按钮完全缺失可访问名称与提示         |
| 7         | Flexibility and Efficiency                              | 2         | 缺少快速切源快捷键；无法从单词释义一键生成 FSRS 填空卡/双语闪卡，割裂 Study Studio 核心价值闭环                     |
| 8         | Aesthetic and Minimalist Design                         | 2         | 顶部堆叠 5 层横向控件过度蚕食垂直视口；高饱和青色搜索按钮过于喧宾夺主；CSS 存在 `side-tab` 单边粗红边框的 AI 坏味道 |
| 9         | Help Users Recognize, Diagnose, and Recover from Errors | 2         | 查词失败只有生硬的空结果，不提供拼写纠错推荐与近音词检索建议                                                        |
| 10        | Help and Documentation                                  | 2         | 空状态极度单薄，无快捷键说明、无划词助手唤起指南、无生词本入口指引                                                  |
| **Total** |                                                         | **21/40** | **Acceptable (临近 Poor 边缘)**                                                                                     |

---

### Design Specificity Verdict

**本页面目前呈现为“通用的多源网页词典聚合器”，严重偏离了 Study Studio 作为“沉浸式英语学习与 FSRS 闪卡工作台”的核心产品特异性。**

- **LLM assessment**:
    - 核心领域价值流割裂：Study Studio 的护城河是将阅读查词转化为记忆卡片。然而当前界面中，制作卡片的动作仅被边缘化为一个毫无状态感的小书签图标，具体的词义项、例句、搭配短语均无法直接提炼为填空卡。
    - 信息架构与宿主工作流脱节：搜索框内部混杂了“批量管理”与“全局设置”；顶部平铺了搜索框、12 个历史查询芯片、单词标题栏、6 个词典 Tab 乃至二级 Detail Tab，共多达 5 层横向 Chrome。在 Obsidian 常见 300~400px 的侧边栏分栏中，这直接吃掉了 40% 以上的垂直阅读黄金区域。
    - 外源内容未经统一“排版策展”：本地 MDX 词典（如 OALD）生硬地内嵌了草绿色外边框、古早水印图片和浮动菜单，未与 Study Studio 的中性、宁静、清透青的设计语言完成融合。
- **Deterministic scan**:
    - `src/features/dictionary/ui/DictionaryView.tsx` 单文件扫描无直接命中规则；
    - 目录级扫描命中 **3 项设计异味**：
        1. `Dictionary.module.scss:349` 触发 `side-tab` (Warning / Slop)：`.error` 使用了 `border-left: 3px solid var(--fc-danger)` 这种单边粗边框的典型 AI 生成界面反模式。
        2. `LookupAssistantCard.module.scss:115` 与 `258` 触发 `design-system-radius` (Advisory)：使用了非设计令牌数值 `border-radius: 3px`（规范阶梯为 `xs: 2px, sm: 4px`）。
- **Deterministic Code & A11y Findings**:
    - **严重无障碍违规 (WCAG 4.1.2)**：`DictionaryView.tsx:251-263` 的 Bookmark 与 Copy 按钮缺失 `title` 与 `aria-label`，读屏器直接识别为无名空按钮。
    - **键盘焦点逻辑 Bug**：`sectionTablistRef` 为全局单 Ref，在 `state.sources.map` 中被覆盖为最后一个词典源的 DOM，导致前面词典源的二级 Tab 无法通过方向键 Roving 导航。
    - **点击靶区严重过小**：历史搜索项（`.savedItem`）高度仅约 25px，建议项（`.suggestionItem`）高度仅约 23px，远低于项目规范的桌面 30px / 触摸 40×40px 要求。
- **Visual overlays**:
    - 当前运行环境为 macOS 独立打包的 Obsidian 桌面客户端 (PID 22520)，未携带 `--remote-debugging-port=9222` 参数启动，CDP 端口连接被拒绝（Connection refused）。故本次无法进行无头浏览器注入与可视叠加层展示，回退至静态代码级分析与实机视觉截屏多维综合审计。

---

### Overall Impression

底层多源异步 Session 架构非常扎实，能够丝滑聚合本地 MDX、在线有道和 AI 释义，并且在 iframe 加载上做了很好的防白屏主题预注入。然而，界面的表现层把所有控制项和辅助信息一次性铺在台面上，使得原本应当“安静阅读、高效采撷”的查词过程变得压抑、拥挤，且丧失了与闪卡系统的深度联动。最立竿见影的突破点是：**净化顶部 Chrome 归位设置与历史，释放阅读面积，并打通释义例句“一键采录为闪卡”的闭环。**

---

### What's Working

1. **扎实的多源异步调度与防白屏机制**：底层通过状态机统一调度 MDX 本地索引、在线网络词典和 AI 模块；`SandboxDocumentFrame` 在 iframe 加载前利用 `srcdoc` 预先同步注入 Obsidian 宿主 CSS 变量，彻底杜绝了暗色模式下查词时的白屏刺眼问题。
2. **AI 释义模块的高品质排版设计**：`DictionarySectionContent.tsx` 中对 AI 释义核心生词自动注入 `<mark>` 高亮，配合词性胶囊徽章与中英对照行距，层级分明，具备优秀的可读性。
3. **完善的键盘可访问性基建**：主流 Tab 列表实现了标准 `roving-tabindex` 与 ArrowRight / ArrowLeft / Home / End 循环导航，展示了良好的键盘操作意识。

---

### Priority Issues

#### [P0] 词条与例句缺乏一键制卡闭环，且标题栏关键按钮缺失无障碍名称

- **What**: 标题右侧仅有一个无文字、无无障碍属性（缺失 `aria-label`/`title`）的线框书签图标，且无法反映该词是否已收藏；释义区的大量例句完全无法快捷交互制卡。
- **Why it matters**: 严重违背 WCAG 4.1.2 可访问性规范；直接切断了 Study Studio 作为“闪卡沉淀中心”的核心用户旅程，用户必须打断心流手动复制粘贴制作卡片。
- **Fix**: 为 Bookmark 和 Copy 补齐 `aria-label` 与 `title`；让书签图标支持“已在卡片库中”的实体激活高亮；在每个例句行末提供悬浮轻量级“+ 录为例句闪卡”动作。
- **Suggested command**: `/impeccable harden`

#### [P0] 多词典源键盘 Roving Focus 焦点绑定 Bug

- **What**: `DictionaryView.tsx:107` 定义的 `sectionTablistRef` 在多源循环渲染时被覆盖，永远绑定到列表中最后一个（通常是隐藏的）词典 DOM 节点上。
- **Why it matters**: 键盘用户在前序词典（如 OALD 或有道）的二级扩展 Tab 上按下左右方向键时，焦点无法正常跳转或跳跃至不可见容器，破坏键盘导航。
- **Fix**: 重构 Tablist Ref 传递机制，直接通过事件代理或按 `source.id` 隔离存储 Ref。
- **Suggested command**: `/impeccable harden`

#### [P1] 顶部控件过度堆叠，搜索框职责错位

- **What**: 输入框内硬塞了“批量管理”与“全局设置”；垂直方向同时平铺了输入框、12 个历史查询芯片、单词标题栏、词典 Tab 栏。
- **Why it matters**: 在 Obsidian 侧边栏（320px~450px）中，Chrome 控件侵占近半垂直视口，阅读内容被逼至折叠线以下；搜索框内控件杂乱，误触率高。
- **Fix**: 将“设置”与“批量导入”移入 Obsidian View 标头菜单或右上角；历史查询默认收起或采用下拉悬浮展示；弱化刺眼的纯青色查询大按钮。
- **Suggested command**: `/impeccable layout`

#### [P1] 交互控件点击靶区（Touch Target）严重不达标

- **What**: 历史记录 chips（`.savedItem`）高度仅约 25px，输入联想项（`.suggestionItem`）高度仅约 23px。
- **Why it matters**: 远低于项目规范的桌面 30px 与移动触控 40×40px 要求，在鼠标点选和触摸屏上极其容易出现指尖误触或滑脱。
- **Fix**: 增大上下内边距与行高，为历史项与补全项设定 `min-height: 32px`（触屏下 `min-height: 40px`），并在历史项上增加单个悬浮移除按钮。
- **Suggested command**: `/impeccable adapt`

#### [P2] 移除 CSS 设计异味，清理本地 MDX 词典杂质

- **What**: `Dictionary.module.scss:349` 的 `.error` 呈现单边 3px 红色粗边框（`side-tab` 反模式）；本地 OALD 渲染带有原始网页陈旧的绿色边框与浮动按钮。
- **Why it matters**: 破坏了“安静、精致的学习工作台”的视觉调性，带给用户拼凑内嵌网页的粗糙感。
- **Fix**: 将错误提示改为 1px 细微边界全包围卡片配合警示微图标；在 `SandboxDocumentFrame` 中注入用户定制样式表，隐藏外源第三方浮动杂质，字体变量映射至 `--fc-*` 规范。
- **Suggested command**: `/impeccable polish`

---

### Persona Red Flags

- **Jordan (初涉英语原版阅读的中文学习者)**:
    - 查词时手滑输错拼写（如实机截图中出现的 `dignose` 与 `dimesion`），系统直接返回生硬的“没有找到这个单词”，没有任何“您是不是想查 diagnose”的模糊纠错建议；
    - 错词永久原样展示在顶部的“最近查询”横栏中，无法单独删除，Jordan 每次查词都会看到自己的拼写失误；
    - 默认展开的 OALD 词典内充斥着全英文的语法学学术折叠项，带有中文释义的有道词典被静默藏在第二选项卡，挫败感强烈。
- **Alex (追求极致效率的 Obsidian 知识管理极客)**:
    - 将 DictionaryView 拖入宽 320px 的副侧边栏，发现顶部 5 层控件死死锁住视口，每次只能看到一两行释义，必须频繁滑动滚轮；
    - 读到了绝佳的造句例句，想即刻做成 FSRS 间隔重复卡片，却找不到任何轻量摘录按钮，必须退回“复制-打开模态框-粘贴-选择题库-保存”的笨重传统流程，心流严重受损。
- **Sam (依赖键盘操作与读屏器的无障碍用户)**:
    - 标题栏右侧的 Bookmark 和 Copy 按钮没有 `aria-label` 与 `title`，读屏器通报为空白无名按键；
    - 切换至其它词典源后，二级分类 Tab 的键盘方向键跳转彻底失灵；
    - 点击 Copy 按钮后，“已复制”提示无 ARIA 实时通告区（`aria-live`），且导致页面产生未被宣告的抖动。

---

### Minor Observations

- **横向滚动缺乏渐隐提示**：最近查询超出视口宽度时直接被硬性截断，无边缘渐隐遮罩（Fade Mask）或翻页指示，用户难以直观感知右侧还有更多历史词。
- **发音按钮缺乏瞬态动效**：点击音标旁的小喇叭后，网络加载期间无任何 Loading 微状态，容易引发用户在未出声前连续暴力点击。
- **状态点语义降级过度**：词典 Tab 在后台查询成功时点亮绿色，但一旦切走，点状态立刻被强制熄灭为灰色（`--fc-faint`），导致用户无法扫视确认哪些后台词典已经准备好内容。

---

### Questions to Consider

1. **“这是一台词典浏览器，还是一座闪卡收割机？”**
   如果 Study Studio 的灵魂是 FSRS 记忆沉淀，为什么释义与例句不能成为“一键摘录”的第一公民？
2. **“批量管理与全局设置，是否应该彻底搬出单次查询的输入框？”**
   如果把搜索框彻底还给“纯粹的输入”，将管理功能归位至 Obsidian 标准窗格菜单，侧边栏能够释放多少宁静与纵深？
3. **“我们对本地词典（MDX）的责任，是仅仅当一个沙箱渲染器，还是做一个懂排版的策展人？”**
   针对第三方历史遗留的突兀配色与浮动水印，Study Studio 是否应该用一套优雅的覆盖样式将其驯服进统一的审美规范中？
