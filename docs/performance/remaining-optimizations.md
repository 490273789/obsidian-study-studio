# 性能优化待办

日期：2026-10-13。基线：`defd05b`（性能审计与前三批改动均已合入 `main`）。

本文记录四份性能审计的结论、已经落地的部分，以及**尚未修改**的待办项。所有行号以基线
提交为准；改动后行号会漂移，重新定位时以函数名为准。

## 已落地（8 个 `perf` 提交）

| 提交      | 内容                                                   |
| --------- | ------------------------------------------------------ |
| `3fd7838` | 停止重复内联 WASM 引擎（`main.js` −872,790 B，−31.1%） |
| `4458ae1` | 生产构建压缩 CSS，修复失败的 `artifacts:check`         |
| `6b81702` | 视图渲染保持单一 translator 身份                       |
| `b5705ae` | 热力图复用日期 formatter                               |
| `ed5bd4e` | `getStudySetupPlan` 与兄弟 memo 对齐                   |
| `f0817cd` | deck 拖拽禁用上移到列表层                              |
| `bb30553` | 仅在存在 webview 时轮询选区                            |
| `defd05b` | 内存音频缓存改成真正的 LRU                             |

验证：`pnpm run build`、`pnpm test`（113 文件 / 1373 用例）、`pnpm run lint`、
`pnpm run artifacts:check` 均通过。lint 仅剩 4 条既有
`src/features/dictionary/obsidian/__tests__/lookupModal.test.ts` 警告（非本次引入）。

## 根因

审计从渲染、存储、计算热路径、打包四个角度独立进行，收敛到同一条：

> **同一份数据在一条交互路径上被反复物化。**

2413 张卡的 learning 状态（约 585 KB）被反复 `structuredClone`、反复全量
`JSON.stringify`；触发点是每次作答、每次开视图、每次改设置。因此 A 类改动收益最大，
但会触及持久化语义，风险也最高。

规模参考：`data.json` 912 KB（其中 `learning` 占 533 KB）、`cache/deck-index.json`
1.16 MB、2 个 deck / 2413 张卡。基线时仓库**没有任何性能埋点**（无 `performance.now()`），
所以下列收益仍需实测确认。

---

## 第 4 批：开视图的全量落盘

状态：已完成，提交 `55795e9`。以下位置与机制仍描述基线行为。

- 实现在 `FlashcardRepository` 的 continuity 提交边界：与最近成功读取或提交的 learning
  做结构比较，忽略对象字段顺序、保留数组顺序；相同则跳过 authority 提交及 `data.json` 写入。
- 保留同步后的内存 deck、可用标签、revision 通知和可重建的本地索引更新，因此仅修改卡面
  也能正常刷新。会话写入路径继续按原有语义提交。
- 比较基线随迁移、成功提交和外部同步更新；写入失败不推进基线。隔离历史条目和 continuity
  source condition 的嵌套引用，避免原地修改污染基线而漏写。
- 新增 `continuityPersistence.test.ts`，覆盖 2413 张卡连续三次首页刷新均为 **0 次 `saveData`**、
  重建仓库后的首次刷新、字段顺序变化、卡面和标签更新、卡片增删、journal、失败重试、
  冲突重试、会话提交、外部同步和比较基线引用隔离。此结果验证写入次数，尚未测量真实磁盘耗时。

验证：`pnpm run build`、`pnpm test`（114 文件 / 1386 用例）、`pnpm run lint`、
`pnpm run format:check`、`pnpm run architecture:check`、`pnpm run artifacts:check` 均通过。
独立代码复查通过；lint 仍只有前述 4 条既有警告。尚未在 Obsidian 中手动验证。

### A1 `synchronizeNow` 无条件提交

- 位置：`src/features/flashcards/domain/identity/cardIdentityContinuity.ts:427`
  （`synchronizeNow`），提交点在 `:624`。
- 路径：`src/features/flashcards/feature.tsx` 的 `onOpen` → `deckHome.act({kind:"refresh"})`
  → `synchronizeNow` → **无条件** `this.options.state.commit(...)`
  → `flashcardRepository.ts:443` → `workbenchFlashcardAuthority.ts:86`
  `savePartition("learning", structuredClone(commit.learning))`
  → `workbenchStore.ts:136`/`:144` 全量 `saveData`。
- 机制：没有「内容相等则跳过」的判断，无论同步结果是否变化都会提交一次。
- 影响：打开一次闪卡视图 = 一次 ≥540 KB 序列化 + 磁盘写。
- 改法：提交前比对新建的 learning 与已持久化的 learning 是否结构相等，相等则整段跳过。
  过渡期可先沿用 `sessionLifecycle.ts:861` 已有的 `JSON.stringify` 比对写法。
- 风险：中。必须保证比对正确。
- 验证：`deckHome.test.ts`、`flashcardRepository.test.ts` 已存在，新增「open 后无变化不产生写」断言。

---

## 第 5 批：单次操作内的重复遍历

状态：已完成，提交 `7267c16`。以下位置与机制仍描述基线行为。

- A3：`getSpellingProgress()` 按内部记录对象身份惰性构建共享快照，冻结记录及每条进度；
  重复读取复用身份，成功提交、删除清理、迁移和外部同步替换记录后重新构建，失败提交保持原快照。
  仓库、首页和会话规划接口统一为嵌套只读类型。
- A4：`challengeCards()` 按仓库 revision 缓存 Map。2413 张卡连续重校验三次不读取全量 decks，
  单次作答只在提交产生新 revision 后重建一次。
- 挑战进度采用独立内存版本，按结构变化递增；重校验仅比较版本，不再克隆/序列化整轮进度。
  外部恢复同值进度不改变版本，替换进度会终止旧会话。仓库在提交通知前捕获版本回执，避免
  await 恢复时把紧随其后的其他写入版本误认成本次版本；写入时的内容前置校验仍保留。
- 新增 6 个回归用例，覆盖快照复用/冻结/失败及外部恢复、challenge 全库读取次数、同值外部
  恢复、外部轮次替换和提交回执竞态；既有删除/移动/停用/失败/冲突测试继续验证缓存失效。
  本批只验证操作次数与行为，尚未测量 Obsidian 内实际耗时。

验证：定向测试 83 用例通过；`pnpm run build`、`pnpm run check:all`（114 文件 / 1392 用例）、
`pnpm run artifacts:check` 均通过。独立代码审查通过；lint 仍只有前述 4 条既有警告。
尚未在 Obsidian 中手动验证。

### A3 `getSpellingProgress` 每次调用深拷贝整个记录

- 位置：`src/features/flashcards/domain/storage/flashcardRepository.ts:271`。
- 调用方：`sessionLifecycle.ts:1081`（每次开会话）、`FlashcardApp.tsx:277`/`:474`（memo 路径）、
  `deckHome.ts:443`。
- 机制：`Object.fromEntries(Object.entries(...).map(([id, p]) => [id, {...p}]))` 全量克隆。
- 影响：每次调用 O(条目数) 分配，而用途是只读。
- 改法：返回冻结的共享快照，或像 `deckDueTimes` 那样按写失效。`deckHome.ts:443` 的同名方法
  签名已返回 `Readonly<...>`，支持只读契约。
- 风险：中低（需确认无调用方依赖可变更性）。
- 验证：`flashcardRepository.test.ts`。

### A4 challenge 单次作答重建全卡 Map

- 位置：`src/features/flashcards/domain/sessions/sessionLifecycle.ts:768`（`challengeCards`）。
- 调用点：`:795`、`:865`、`:921`、`:962`、`:984` —— **单次作答内多达 4 次**；入口还有
  `revalidateActiveChallenge`（`feature.tsx:564` 挂在每次 repository revision 上）。
- 机制：每次调用都 `getAllDecks()` → `selectEligibleChallengeCards`（对全库卡跑
  `extractSpellingWord` 的 Unicode 正则 + `NFC` + `replace`）→ 建 `Set` → 为 2413 张卡建 `Map`。
- 相关：`sessionLifecycle.ts:861` 还对整轮 `JSON.stringify(persisted) !== JSON.stringify(state.progress)`。
- 改法：按 `getRevision()` 缓存该 Map，revision 变化才重建；progress 比对改用 revision/hash。
- 风险：中。
- 验证：`challengeSessionEngine.test.ts`、`sessionLifecycle.test.ts` 已存在。

---

## 第 6 批：启动与设置页

状态：已完成，按存储与设置页拆分提交。C1 提交为 `e330fb6`，C3 随本节进度更新提交。
以下位置与机制仍描述基线行为。

- C1：启动 `load()` 只恢复 learning，不读取 `deck-index.json`。首次 continuity 同步（包括
  开视图的首页刷新）或需要索引的写操作经 `loadDeckIndex()` 惰性加载；并发请求只读一次。
  未请求索引前的外部同步仍不读缓存，已请求后的外部同步继续重建内存索引并叠加最新 learning。
- 缺失缓存时保留真实牌组的学习次数与最后学习时间，通过 Markdown 重建关联卡片；
  FSRS 状态按稳定身份恢复，临时 `__markdown-rebuild__` 牌组不会落盘。legacy 迁移已有
  完整卡面，不额外读取缓存；dispose 后不安装未完成的首次缓存读取结果。
- C3：`refresh(sectionId?)` 标明独立刷新来源。当前已安装页面、语言和导航均未变化时，
  其他页面刷新跳过 DOM 重建和滚动容器查找；当前页、无参数刷新、语言/导航/选择变化仍
  替换 presentation generation，使旧控件失效。
- 闪卡、翻译、AI 与选区助手的局部更新已标注来源。词典来源变化还会影响选区助手的字典
  选项，因此词典回调保留全页刷新；AI 对翻译和词典的依赖仍由各自 editor 的订阅刷新。
- 新增 16 个回归用例，覆盖惰性读取/并发/外部同步/迁移/缺缓存写入/销毁、无缓存重建
  保 FSRS 与牌组统计、跨页刷新保 DOM/滚动/有效 action、当前页失效和共享上下文刷新。

验证：存储与设置页定向测试通过；`pnpm run build`、`pnpm run check:all`
（115 文件 / 1408 用例）、`pnpm run artifacts:check` 均通过。独立代码复查通过；
lint 仍只有前述 4 条既有警告。尚未在 Obsidian 中手动验证或测量实际耗时。

### C1 `deck-index.json` 解析在启动关键路径上

- 位置：`flashcardRepository.ts:562`（`restoreLearningState`，函数起于 `:553`）。
- 机制：`await this.deckIndexCache?.load()` 解析 1.16 MB JSON，而该文件自述是「可丢弃的派生数据」
  （`src/core/storage/deckIndexCache.ts` 头部注释）。
- 影响：约 2 MB JSON（`data.json` + `deck-index.json`）在 UI 可用前完成解析与分配。
- 改法：惰性化 —— 首次展示 deck 列表时再读；缺失时按既有逻辑重建。
- 风险：中（须保证「未加载」状态下 `restoreLearningPlaceholders` 路径仍然正确）。
- 验证：`deckIndexCache.test.ts`、`flashcardRepository.test.ts`。

### C3 设置页每次写入全量重建 DOM

- 位置：`src/core/host/settingsTab.ts:161`（`containerEl.empty()`）、`:126`（`renderSettings`）、
  `src/core/host/settingsControlRenderer.ts:520` 起逐字段重渲染。
- 关联：12 处 `host.settingsTab.refresh()` 调用点（`selectionHelper/module.ts`、
  `flashcards/feature.tsx`、`dictionary/feature.tsx`、`translation/feature.tsx`、`main.ts`）。
  `settingsTab.ts:70` 的 `getScrollContainer()` 每级祖先链调 `window.getComputedStyle`，
  每次渲染最多调用 3 次。
- 改法：控制渲染器做 diff；或 `refresh()` 前判断变更是否落在当前 `activeSectionId`。
- 风险：中。
- 验证：`settingsTab.test.ts`、`settingsControlRenderer.test.ts` 已存在。

---

## 第 7 批：作答路径的全量落盘（风险最高，放最后）

状态：已完成，分两次提交。存储合并提交 `57a5587`；增量构建随本节更新提交。

- 第一层调整为保持耐久语义的合并：相邻且尚未启动、修改不同 key 的
  设置/分区写共享一次 `saveData`。带版本校验的写入开启新批次，仅后续无版本前置条件的
  独立写入可合并；重叠 key、整文档变更和读取均隔开批次；
  落盘成功后才安装内存并按顺序发布各自 revision/source，失败则整批回滚并拒绝。
- 同值设置及同值原始类型分区跳过磁盘写入，保留 revision/source 回执语义。
- 不采用原建议的 300–500 ms 乐观 trailing debounce：现有会话要求先耐久提交再发布下一题，
  提前发布会引入崩溃丢失已确认作答的窗口，等待防抖则会增加每题延迟。串行作答仍各自
  落盘，本层收益限于并发、可独立合并的写入，不宣称减少串行作答的磁盘写次数。

- 第二层：作答从已对齐的持久化卡状态记录复制并仅更新实际命中的卡片；无卡片变化的
  会话和单词表历史提交直接复用整个记录。WeakMap 继续缓存单张卡的序列化结果。
- 基线仅在成功构建并安装完整牌组快照后可复用。continuity 继续全量对齐增删与移动；
  首次恢复、缓存重新加载、外部同步和冲突重试重新建立基线，失败不推进基线。
- 2413 张卡连续作答三次，无关卡片身份读取为 **0 次**；新增回归同时覆盖记录复用、
  失败重试、外部新卡/学习状态、continuity 增删移动、缓存包含未持久化身份。
- 本批没有改存储格式，也没有移除 authority 的隔离克隆或 `saveData` 的整文档序列化。
  有卡片变化时仍需浅拷贝 `cards` 的全部键，收益来自避免全库卡对象遍历与重复映射；
  尚未测量 Obsidian 内实际耗时。

第一层验证：存储定向测试 19 用例、`pnpm run build`、`pnpm run check:all`
（115 文件 / 1417 用例）、`pnpm run artifacts:check` 均通过。独立代码复查通过，
lint 仅有 4 条既有词典测试警告；尚未在 Obsidian 中手动验证。

第二层验证：新增增量持久化定向测试 6 用例，既有仓库/连续性/会话定向测试 52 用例；
`pnpm run build`、`pnpm run check:all`（116 文件 / 1423 用例）、
`pnpm run artifacts:check` 均通过。独立代码复查通过，lint 仍仅有上述 4 条既有警告；
尚未在 Obsidian 中手动验证或测量实际耗时。

### A2 每次作答走完整持久化链路

- 路径：`sessionLifecycle.ts:1212`（`this.commit`）→ `flashcardRepository.ts:344`
  （`commitSessionTransition`）→ `:631`（`buildLearningState`，遍历全部 deck 的每一张卡重建
  `cards` 记录）→ `workbenchFlashcardAuthority.ts:88` `structuredClone`（约 585 KB）
  → `workbenchStore.ts:136`/`:144` 全量 `saveData`。
- 机制补充：三条写路径（`saveSettings` `:106`、`savePartition` `:136`、`mutateDocument` `:157`）
  全部直通 `backend.saveData(完整 document)`，`src/core/storage/` 下**没有任何
  debounce / throttle / setTimeout**。`buildLearningState` 重建整个 `cards` 对象，
  架空了已有的 `persistedCardStateCache` WeakMap。
- 建议分两层、两次提交、各自独立可回滚：
    1. **合并提交**：在 `workbenchStore.ts:228`（`enqueueWrite`）前加 trailing debounce
       （300–500 ms）+ dirty 判断，把同一事件循环内的多次写并成一次。
       注意这会引入「崩溃时丢失最后若干毫秒写入」的语义，需要明确接受。
    2. **增量构建**：`buildLearningState` 只 diff 变化的卡片，让其与 WeakMap 缓存协同。
- 风险：**高**。动 `WorkbenchStore` 与持久化不变量。
- 前置：必须先读 `docs/agents/cards-data-and-identity.md` 与 `docs/agents/sessions.md`。
- 验证：`workbenchStore.test.ts`、`flashcardRepository.test.ts`、`sessionLifecycle.test.ts`。

---

## 第 8 批：结构性项（建议先加基准再动）

状态：本轮测量、筛选与实施已完成（2026-10-14），随本节更新提交。
基准与复跑命令见 [第 8 批性能基准](batch-8-benchmark.md)，原始结果见
[JSON 数据](batch-8-benchmark.json)。以下原表保留审计时的候选描述，处理结论以本节为准。

- 首页：按 deck 对象与启用标志缓存挑战数量，计数不再创建全部 question refs；不可变活动
  对象按本地日/时区 offset 复用深冻结热力图，首页用 WeakSet 跳过已验证快照的重复冻结。
- 词典：结果接收时冻结一次，稳定结果子树 props 并 memo；选区会话配置只克隆一次。
- 发音：有界 LRU 复用 descriptor hash 与并发 Promise，不缓存可用性、密钥或缓存存在性。
- 播放器：owner window 上按帧合并移动，保留最大位移点与最后点，避免丢失折返的阈值语义。
- 翻译：每个视图通过 acquire 持有独立释放函数，feature stop 回收所有残留引用。

其余候选逐项结论：

| 候选                                       | 本轮结论                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| compiled-source 的 DOMParser / 净化 / 样式 | 保留。独立文档需要当前 storage、随机文档身份与 URL 生命周期；缺少浏览器测量，暂不扩大安全缓存边界      |
| 查询历史逐次落盘                           | 保留。延迟/合并会改变失败、退出和排序语义，尚无收益证据支持改变耐久约定                                |
| 在线 source 与 secret 重建                 | 保留即时读取，防止密钥修改后沿用旧值；仅削减配置重复克隆                                               |
| 播放器顶层 memo / 队列拆分                 | 顶层本身订阅 external store，memo 无法阻止坐标更新；先减少回调，队列拆分留待大队列测量                 |
| WordList 挂载 Set setter                   | 确有固定成本的冗余更新；缺少挂载耗时证据，本轮保留                                                     |
| Challenge key                              | reference.key 是会话 key；phase 改变时输入正好隐藏，卡面变化的重置有既有语义；未复现输入丢失故障，保留 |
| 生产 StrictMode                            | 撤销性能疑点。额外 render/effect 检查仅开发环境执行，生产 NODE_ENV 已由构建替换                        |
| outboundPort abort listener                | 撤销疑点。finish/finally 已清理监听器                                                                  |
| getCard 全库 fallback                      | 未发现合法已存在身份的索引缺失正常路径；未知/已删除身份仍可触达兼容 fallback，缺少热路径收益证据，保留 |

这些结构性项的收益依赖规模；未实施项继续按上述证据和边界评估。

验证：相关模块定向测试、`pnpm run typecheck`、`pnpm run build`、`pnpm run check:all`
（119 文件 / 1448 用例）、`pnpm run artifacts:check` 和 `pnpm run format:check` 均通过。
独立复查发现并修复同帧折返丢失阈值的回归，最终复查通过；lint 仍只有 4 条既有词典测试
警告。尚未在 Obsidian 中手动验证或测量真实磁盘/UI 耗时。

| 位置                                                            | 问题                                                                                                                                                                                                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deckHome.ts:824` / `:841`                                      | 每次 publish 重建快照：`:892` 的 `selectEligibleChallengeCards(...).length` 为取长度建整个数组；`:914` 的 `getLearningFootprint` 重建 371 个 day 对象。两者都不在 `deckStatsCache`/`deckEligibilityCache` 覆盖内 |
| `deckHome.ts` `freezeDeckHomeSnapshot`                          | 对 371 个 day 对象逐个 `Object.freeze`                                                                                                                                                                           |
| `src/features/dictionary/ui/DictionaryView.tsx:493`             | 每次按键重渲染**全部** source（含 `<article hidden>` 隐藏的）；`SectionContent`（`:192`）与 `AiSense`（`:128`）无 `memo`，整个结果树重建                                                                         |
| `src/features/dictionary/domain/compiled-source.ts:112`、`:145` | 每个可见 section 重新 `DOMParser` 解析 + 重新净化；`safeStylesheet` 对模块常量样式表每次重跑 `matchAll`/`replace`                                                                                                |
| `src/features/dictionary/domain/querySession.ts:194`            | 每次查询经 `updateDictionarySettings` 克隆设置切片并重写整个 `data.json`（仅历史数组变化）                                                                                                                       |
| `src/features/dictionary/domain/dictionaryRuntime.ts:131-132`   | 每次选中都 `structuredClone` 字典配置与 sources，并重建在线 source、重读 secret                                                                                                                                  |
| `pronunciationRuntime.ts:217`（`canSpeak`）                     | 每个发音按钮渲染都走 SHA-256 digest 计算缓存键，通常只用于决定图标是否显示                                                                                                                                       |
| `src/features/video-player/ui/PlayerViewInteraction`            | 拖动浮窗每次 `pointermove` 触发 `publish()`（`playerViewInteraction.ts:305` → `:267`），无 rAF 合并；`VideoPlayerView.tsx:55` 无 `memo`，`:228` 的队列一并重渲染                                                 |
| `WordListView.tsx:265`                                          | `queueMicrotask` 里用新的 `Set` 身份调 setter，挂载时必定二次渲染                                                                                                                                                |
| `ChallengeView.tsx:28`                                          | 用 5 元素 `JSON.stringify` 做 React key，phase 或卡面变化时整棵子树重挂载（会丢失输入状态，属正确性隐患）                                                                                                        |
| `src/core/host/reactItemView.tsx:217`、`:235`                   | 生产构建仍包裹 `React.StrictMode`                                                                                                                                                                                |
| `src/features/translation/feature.tsx:140`                      | `detachOpenView` 只有一个槽位，开两个翻译视图会泄漏第一个的 refcount                                                                                                                                             |
| `src/core/net/outboundPort.ts:104`                              | 长生命周期 `AbortController` 复用时会累积 `abort` 监听器（SUSPECTED，未证实复用路径）                                                                                                                            |
| `flashcardRepository.ts:246`（`getCard`）                       | `cardIndex` 未命中时回退到遍历全部 deck 的线性查找（SUSPECTED，实际难以触达）                                                                                                                                    |

---

## 第 9 批：作答/同步/设置热路径（2026-10-17）

状态：实施完成。第一部分已提交 `4622526`；DeckHome 懒发布与设置滑杆缓存、UI 行缓存、
Practice 结算分批、发音探测共享与同词单飞为工作区改动（未提交）。

- **作答**：移除 `workbenchFlashcardAuthority.ts` 对整份 learning 的防御性
  `structuredClone`；契约改为「提交后的 learning 文档不可变」，由仓库 copy-on-write 和
  新增回归测试守护。2,413 卡 5.26 → 2.6–2.8 ms；10k 24.4 → 10.6 ms。
- **同步**：源内容未变时复用已有 `Deck`/`FlashCard` 对象并复用已持久化卡片基线；仅在
  deck/tag 变化时重写 `deck-index.json`。无变化刷新 0 次缓存写、0 次 `data.json` 写。
  开视图 7.1 → 1.0–1.1 ms（10k 28.6 → 3.7 ms）。
- **设置**：`FlashcardAuthority.readSettings()` + 变更类型分发，设置-only 变更不再整仓
  反序列化。9.9 → 1.5–1.6 ms（10k 37.4 → 6.0 ms）。`docs/agents/architecture.md` 的
  不变量描述同步更新。
- **challenge**：`challengeCards` 缓存改按新增的 `getDeckStructureRevision()`；active
  challenge 记录已 reconcile 的结构 revision，自身提交不再触发第二次 revalidate；
  无卡片移除时不再深克隆整个剩余 round。
- **其他**：`getCard` 先查 `cardIndex`；DeckHome 无订阅者时延迟构建快照（关闭的视图不再
  因仓库 revision 重建读模型或重启到期定时器）；设置滑杆复用 `getDeckEligibilityCached`；
  DeckCard 行模型按 `deck.id` + 逐字段内容缓存，未变化行引用稳定；Practice 结算页首屏
  只挂载 10 条错题、其余按需展开；`canSpeak`/`speak` 共享一次音频缓存探测（含失效策略），
  同一单词并发播放共享 in-flight 请求。

仍保留：A2 的「每次作答整份 `data.json` 序列化 + 写盘」未改（耐久语义；未采用 debounce
的理由见第 7 批）；发音 `lastAccess` touch 仍重写整条音频记录（IndexedDB 记录结构约束）；
`cards` 键浅拷贝、每次作答的 due 时间重排、冷启动 placeholder 等小项未动。

验证：`pnpm run check:all`（150 文件 / 1709 用例）、`pnpm run build`、`pnpm run lint`
通过。基准与操作量回归见 [第 9 批性能基准](batch-9-benchmark.md)。

## 不要动的地方

以下实现经两轮独立审计确认是正确的，改动前请先说明理由：

- `useSyncExternalStore` 接缝：各 store 返回缓存的 `Object.freeze` 快照字段，无
  getSnapshot 返回新身份的问题。
- WordList 虚拟滚动：二分可见区间 + `ResizeObserver` 行测量 + rAF 合并 + 引用相同则早退。
- 四个 WeakMap 序列化缓存、`deckDueTimes` + 二分查找（`findFirstDueAfter`）。
- `getDeckStatsCached` / `getDeckEligibilityCached`：按 deck 对象身份缓存，**确实有效**
  ——`cloneDecksForTransition` 对未触及的 deck 复用引用。
- 网络层：deadline 竞争、`AbortSignal`、`readBoundedBody` 限流、**零重试**、provider 冷却。
- 字典引擎复用、`CompiledPackageReader`、`ByteLru`、`inflightFiles` 去重。
- 历史裁剪到 20 天、`sourceSyntax` 缓存上限（32 MB / 2048 条）。
- CSS：`codeSplitting: false` 对 Obsidian 的单文件 CJS 约束是正确选择。

## 死代码陷阱

以下函数**零生产调用方**（仅测试引用），现在无害，但若日后用作「刷新/重建索引」入口
就是全库重解析：

- `src/features/flashcards/domain/cards/parser.ts:170`（`scanFilesWithTag`）
- `src/features/flashcards/domain/cards/parser.ts:202`（`findAllFlashcardTags`）
- `src/core/storage/deckIndexCache.ts:67`（`invalidateSource`）

## 最小基准：已补齐

第 8 批新增 `performancePaths.test.ts` 并纳入 `pnpm test`，测量作答、开视图、改设置和首页
局部发布四条路径。夹具与真实运行的区别、观测值、操作量回归与复跑命令见
[第 8 批性能基准](batch-8-benchmark.md)。没有引入耗时阈值或生产埋点；Obsidian 内实际磁盘
及 UI 耗时仍需另测。
