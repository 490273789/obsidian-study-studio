# 第 9 批性能基准

日期：2026-10-17。基线为第 8 批后的 `d7be849`，对比提交 `4622526`（本批第一部分已提交；
其余改动工作区未提交）。运行环境：Node.js v26.11.1、arm64。原始数据见
[batch-9-benchmark.json](batch-9-benchmark.json)。

## 可复跑路径

```bash
pnpm exec vp test run src/features/flashcards/domain/storage/__tests__/performancePaths.test.ts
```

测试纳入 `pnpm test`，每条路径预热 3 次、记录 20 次并输出 median/p95。夹具为两个牌组、
2413 张稳定身份的已学习卡片，运行真实 `SessionLifecycle`、`DeckHome`、
`CardIdentityContinuity`、`FlashcardRepository`、生产 authority adapter 和 `WorkbenchStore`；
后端用内存 JSON 字符串模拟序列化，**不包含真实磁盘、Obsidian 视图挂载、Markdown DOM
渲染、IndexedDB 或网络耗时**。10k 卡数字来自同形状的临时夹具（未纳入常驻测试）。

| 路径                                           | 2,413 卡 改前 → 改后（ms） | 10,000 卡 改前 → 改后（ms） |
| ---------------------------------------------- | -------------------------- | --------------------------- |
| 作答：study rating 5 → 提交 → 首页订阅更新     | 5.26 → **2.6–2.8**         | 24.4 → **10.6**             |
| 开视图：首页无变更 refresh / continuity 同步   | 7.1 → **1.0–1.1**          | 28.6 → **3.7**              |
| 改设置：saveSettings → 仓库同步 → 首页订阅更新 | 9.9 → **1.5–1.6**          | 37.4 → **6.0**              |

收益来源：作答路径去掉整份 learning 文档的防御性 `structuredClone`；同步路径在源内容未变时
复用已有 Deck/FlashCard 对象并复用持久化卡片基线，同时只在 deck/tag 真正变化时重写
deck-index 缓存；设置变更不再重建整个仓库快照；challenge 的 eligible 索引改按 deck 结构
revision 缓存。剩余的主要成本是每次作答仍要序列化并写入整份 `data.json`（耐久语义不变）。

## 操作量回归

- 作答：仍为每次作答 1 次 `saveData`（耐久语义未改），单次答题的 learning 深拷贝为 0。
- 开视图：无变化的 continuity 同步 **0 次** deck-index 缓存写、**0 次** `data.json` 写；
  未变化的 deck 对象身份保持不变。
- 设置：闪卡设置变更 **0 次** 学习状态重载（`authority.read` 不再调用），只应用
  settings + scheduler，并 bump deck 结构 revision 以使 challenge 资格缓存失效。
- challenge：一次作答后 eligible 索引读取 `getAllDecks` **0 次**；自身提交的 revision
  回声不再触发第二次 revalidate；无卡片移除时不再深克隆整个剩余 round。
- DeckHome：无订阅者时拒绝构建快照（延迟到下次 `getSnapshot`/订阅），关闭的视图不再因
  仓库 revision 重建读模型或重启到期定时器；设置滑杆输入复用按 deck 对象身份缓存的
  拼写资格扫描。
- UI：DeckHome 每次 publish 重建 deck 包装对象，因此牌组行缓存按 `deck.id` + 逐字段内容
  比较，未变化行的行模型引用保持稳定（`DeckCard` 的 `memo` 可命中）；Practice 结算页
  首屏只挂载 10 条错题，其余按需展开。
- 发音：同一张卡的 `canSpeak` → `speak` 共享一次 `cache.get`（含负缓存，put/clear/configure/
  dispose 失效）；同一单词并发播放共享一个 in-flight 请求，不再中止后重复请求 provider。

上述操作量由各模块聚焦测试验证；尚未在 Obsidian 中人工验证真实磁盘/Sync、视图观感、
多牌组列表和多视图发音路径。

## 验证

`pnpm run check:all`（150 文件 / 1709 用例）、`pnpm run build`、`pnpm run lint` 均通过。
