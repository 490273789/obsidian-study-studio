---
target: 英语字典的设置页面
total_score: 20
max_score: 40
na_heuristics:
p0_count: 1
p1_count: 2
target_identity: "file:/Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/dictionary/settings/viewModel.ts"
target_fingerprint: "sha256:301854ba3c06d836d723ceab94cc2480a98e4d397c50e385da9e535918201c9e"
target_path: /Users/ethan/workspace/develop-obsidian/.obsidian/plugins/obsidian-study-studio/src/features/dictionary/settings/viewModel.ts
timestamp: 2026-11-05T05-02-45Z
slug: src-features-dictionary-settings-viewmodel-ts
---

# 英语字典设置页面（English Dictionary Settings）设计评估报告

## Design Health Score

| #         | Heuristic                       | Score     | Key Issue                                                                              |
| --------- | ------------------------------- | --------- | -------------------------------------------------------------------------------------- |
| 1         | Visibility of System Status     | 3         | 具备启用开关与测试中状态反馈，但本地词典同步状态缺少显式进度提示                       |
| 2         | Match System / Real World       | 3         | 词典排序与分类概念清晰，但在设置中暴露了内部完整路径（如 `1-English/Word/Phrase/...`） |
| 3         | User Control and Freedom        | 1         | **核心缺陷**：长列表无法折叠收起，分类无法拖拽重排，用户被动承受巨大垂直滚动           |
| 4         | Consistency and Standards       | 2         | 与插件内闪卡、翻译设置的多分组结构脱节；将集合数据直接铺成独立 Setting 行              |
| 5         | Error Prevention                | 2         | 每个分类行末尾直接暴露高对比红色删除按钮，紧邻编辑按钮，极易误触                       |
| 6         | Recognition Rather Than Recall  | 2         | 分类深层文件路径难以心智解析，缺少紧凑标签或别名显示                                   |
| 7         | Flexibility and Efficiency      | 1         | 缺乏折叠、搜索或批量管理，多分类/多词典用户每次均需大距离翻页                          |
| 8         | Aesthetic and Minimalist Design | 1         | **严重失分**：空间利用率低，红色警示按钮横行，说明文案 100% 重复，缺乏克制美感         |
| 9         | Error Recovery                  | 3         | 删除具备二次确认弹窗，且最后一项分类有保护禁用                                         |
| 10        | Help and Documentation          | 2         | 有道接入模式与测试连接文案逐字重复；AI 引擎与词典配置关系缺乏直观解释                  |
| **Total** |                                 | **20/40** | **Acceptable (Marginal / 亟待系统性重组与折叠改造)**                                   |

## Design Specificity Verdict

- **LLM assessment**: 整体呈现“未完成的数据库表单堆叠”状态。Study Studio 的卡片与阅读视图追求安静与紧凑，但字典设置页却仅用了一个单一的 `page.group("dictionary")`，将保存分类、在线接口、本地词典和 AI 引擎混在一起。动态增长的分类项被直接展开为大行高设置项，完全背离了插件其它模块的结构化秩序。
- **Deterministic scan**: 扫描 18 个相关文件，0 个阻断反模式，1 个建议项（`Dictionary.module.scss:364` 中使用了 `#10b981` 作为回退色，该文件为查词视图样式，不直接影响设置页）。代码本身架构规整、测试覆盖全面，核心问题集中在声明式 Presentation 层的信息架构与空间编排上。
- **Visual overlays**: Obsidian 运行于桌面私有沙箱中，未暴露 9222 CDP 调试端口且无外部独立 URL，已跳过浏览器动态注入覆盖层，基于静态模型与实际 UI 渲染截图综合评估。

## Overall Impression

当前页面功能逻辑完整且健壮，但**视觉空间管理严重失衡**。用户敏锐指出的“有一些占地方的内容可以折叠”正是该页面的致命痛点——动态膨胀的“保存分类”直接吞噬了首屏 60% 以上的垂直高度，大面积红色删除按钮制造了不必要的焦虑。只需要合理的信息分组与折叠/紧凑化设计，就能让页面体验从“粗糙表单”跃升为“专业工作台”。

## What's Working

1. **核心查词与排序架构扎实**：支持多源并行查询，且词典排序组件支持直观的拖拽重排与启停开关，底层机制完备。
2. **底层安全防护到位**：保留最后一项分类不可删除的底线限制，删除带有二次弹窗拦截，避免误操作导致生词归档系统损坏。
3. **清晰的双模式鉴权设计**：有道词典在“官方 API 密钥管理”与“免配置免费接口”之间切换干净，表单联动顺畅。

## Priority Issues

- **[P0] 架构重构：拆解单一巨石组为 4 个清晰职能区**
    - **Why it matters**: 现状将所有配置全塞在单一 group 中，导致 15+ 项配置同级平铺，破坏心智模型与查找效率。
    - **Fix**: 切分为“基础设置”、“生词收藏与归档”、“在线词典与顺序”、“本地词典 (MDX / EUDIC)”四个标准 Group。
    - **Suggested command**: `/impeccable shape`

- **[P1] 空间治理：生词分类采用折叠展开（Progressive Disclosure）或紧凑视图**
    - **Why it matters**: 6 个分类占用超 400px 高度，遮蔽了下方的核心词典配置，直接印证了用户的折叠诉求。
    - **Fix**: 引入折叠容器（默认展示摘要如“已配置 6 个分类”，可一键展开/收起）；或改用紧凑卡片/Tag 列表布局。
    - **Suggested command**: `/impeccable distill` 或 `/impeccable layout`

- **[P2] 降噪降压：清理满屏红色警示删除按钮**
    - **Why it matters**: 每一行分类末尾裸露高对比度红底/红字删除按钮，引发强烈的误删焦虑与视觉疲劳。
    - **Fix**: 将“编辑”与“删除”收敛为行尾微型幽灵图标按钮（✏️ / 🗑️），红色危险色仅留在确认弹窗与 hover 状态。
    - **Suggested command**: `/impeccable quieter`

- **[P3] 文案去重：消除有道接口与测试连接说明的逐字复读**
    - **Why it matters**: 35 字的长说明文案在相邻两行 100% 逐字重复，显得界面粗糙且浪费纵向空间。
    - **Fix**: 接入方式保留免责说明；测试按钮改用明确的动作说明：“向有道接口发起单次词条探测，验证当前网络连通性”。
    - **Suggested command**: `/impeccable clarify`

- **[P4] 本地词典管理：同步收敛为紧凑卡片/折叠列表**
    - **Why it matters**: 多本 MDX/EUDIC 词典导入后同样会无限延长页面底部，且文件长路径容易造成折行杂乱。
    - **Fix**: 采用统一的紧凑折叠列表或 Card 容器，收拢条目数、体积与状态标签。
    - **Suggested command**: `/impeccable distill`

## Persona Red Flags

- **Alex (Power User)**: 配置了 10+ 个分类与多本本地词典，每次调整词典顺序或导入文件都需要反复大距离滚屏，没有折叠或搜索，操作效率极低。
- **Jordan (First-Timer)**: 刚打开英语字典设置，首屏被满眼的红色“删除分类”按钮和底层复杂文件路径阻断，误以为触发了故障或警告，产生严重心理压力。
- **Sam (Accessibility-Dependent)**: 使用键盘导航时必须连续按数十次 Tab 穿过每一个分类的编辑与删除按钮才能到达词典源设置，遍历成本过高。

## Minor Observations

1. “新建分类”按钮位于标题右侧且带长说明，与下方列表缺乏视觉锚定，亲和性较弱。
2. 两个 AI 引擎配置（生词释义 AI 与在线词典 AI）在视觉流中被拆散在不同位置，心智认知容易混淆。
3. 本地词典状态信息用纯字符 `·` 拼接，可读性较低，缺乏标签化（Chips）视觉节奏。

## Questions to Consider

- 为什么“保存分类”必须常驻在插件设置的主页面，而不是作为生词收藏界面的次级管理抽屉或弹窗？
- 能否利用 Obsidian 原生 `<details>` 折叠能力或 Study Studio 现有的紧凑列表组件，将动态数据条目一键收缩为一行？
- 是否可以将生词 AI 配置与查词 AI 配置归入同一个“智能引擎”子分组中统一管理？
