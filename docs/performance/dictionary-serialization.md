# 词典导入重复序列化测量

日期：2026-09-27。基线：`d39d2badd5a0cfbccd4fd488e7a50736e10e83ff`。

## 结论与实施范围

先对临时原型测量，再仅落地收益已验证的词条帧优化。每条 `RecordValue` 的 JSON
编码结果用于大小估算和最终帧拼接，避免整帧再次序列化；只保留当前帧的编码字节和
建立索引所需的 key，不缓存全词典 JSON。超过 128 KiB 的帧缓冲区在 flush 后释放，
避免一条超大释义让大容量常驻整个导入过程。

继续使用既有 JSON 字段顺序、帧大小估算规则、压缩策略、索引位置与包校验。
没有更改 compiled-v2 格式、引擎版本、发布流程、磁盘回读验证或 Worker 写入背压。
词条索引和资源索引也有估算后再次序列化的路径，但本轮没有测量其独立收益，因此未修改。

## 方法与边界

- Apple M2 Pro / arm64，macOS 27.0，Rust 1.95.0；使用项目原有 release 配置
  （`opt-level = 's'`、LTO、单 codegen unit）。依赖使用现有 Cargo.lock。
- 运行真实 `compile_archive`，包括词条分帧、压缩、FST/postings、SHA-256 和 manifest。
  夹具构造、测量用输出摘要和析构位于计时区间外。
- 基线和最终实现使用独立 Cargo target 目录，避免同名 crate 的构建产物互相覆盖。
- 每个二进制每次预热 2 次、测量 7 次。按旧→新、新→旧运行两组，表中使用全部
  14 个样本的中位数。基准期间不并行运行构建或测试。
- `html`：包含中文、Unicode、HTML、换行、引号和反斜线，主体重复、容易压缩。
  `varied`：固定种子生成变化文本，压缩难度更高。
  `duplicates`：大量重复 key，覆盖重复词条截断路径。
- “目标释义长度”不是精确字节数：HTML 模板按完整片段填充，另有词条编号和 key。
- 这是 **native 包编译基准**，不是 Obsidian 导入耗时：不含 MDX/MDD/EUDIC 解码、
  WASM 执行、Worker 传输、资源文件、源指纹、磁盘写入及发布回读。
- RSS 来自 macOS `/usr/bin/time -l`，包含完整内存夹具、输出和分配器保留容量；
  不等于生产流式编译器的内存占用，也不能据此宣称 WASM 内存下降。

## 最终实现复测

| 场景       |  词条数 | 目标释义长度 | 旧实现 ms | 新实现 ms |  减少 | 峰值 RSS MiB（旧 / 新）   |
| ---------- | ------: | -----------: | --------: | --------: | ----: | ------------------------- |
| html       |  10,000 |       1024 B |      53.1 |      41.6 | 21.7% | 20.1–20.3 / 22.0–22.6     |
| html       | 100,000 |       1024 B |     530.7 |     410.9 | 22.6% | 167.6–176.0 / 174.6–174.8 |
| html       | 500,000 |        256 B |    1170.5 |     981.3 | 16.2% | 341.0–342.9 / 342.7–343.0 |
| html       |  40,000 |       4096 B |     666.4 |     494.4 | 25.8% | 223.2–224.9 / 220.7–222.0 |
| varied     |  30,000 |       1024 B |     500.8 |     490.8 |  2.0% | 73.2–73.4 / 70.0–72.9     |
| duplicates | 100,000 |       1024 B |     484.1 |     365.8 | 24.4% | 145.9–147.1 / 144.5–147.1 |

RSS 未呈现稳定的下降趋势；本轮的主要收益是减少 CPU 重复编码。

原始测量证据见 [dictionary-serialization-results.json](dictionary-serialization-results.json)。

结果依赖内容的可压缩性。低可压缩性样本中减少重复序列化带来的收益较小，不能把
HTML 合成样本的改善百分比外推为真实词典的端到端导入加速。

## 兼容性与验证

跨二进制脚本断言每个场景的全部文件摘要、输出字节数、帧数与输入字节数相等。
摘要包含有序路径、路径长度、文件长度和完整内容（含 manifest）。另外直接导出并
逐字节比较边界语料产物，覆盖空 key、空白 key、Unicode、控制字符、重复 key、
64 KiB 前后和 1 MiB 单条记录。

Rust 回归测试保留旧 writer 作为只读兼容性参考，比较帧、定位表、索引、文件和描述符，
并验证超大帧不会保留异常缓冲区容量。该参考不要跟随新 writer 同步重构，否则会失去
验证历史产物的作用。

已完成：

- `cargo test -p dictionary-engine`：23 项通过（新增 3 项兼容性/内存回归测试）。
- `pnpm run dictionary:engine`：重建成功；四个引擎产物中仅 `.wasm` 字节改变，JS 和两份类型声明未变。
- `pnpm run build`：成功。
- `pnpm run check:all`：格式、类型、模块依赖、901 项 Vitest 测试和提交消息测试通过。
  保留未修改 WordList/video 文件中的 7 条既有 lint 警告。
- `pnpm run artifacts:check`：通过；`main.js` 2,711,033 B，`styles.css` 229,296 B。
- `git diff --check`：通过；独立代码审查无阻断问题。
- 正式实现的跨二进制基准和边界语料逐字节比较：通过。

尚未进行 Obsidian 内真实大型 MDX/MDD/EUDIC 的 Worker/WASM 导入、磁盘发布与端到端计时。
重建 WASM 成功不代表已经验证上述运行时流程。

## 复现

在仓库根目录执行以下命令。只将历史源码展开到临时目录，不改变当前工作区或分支。

```sh
experiment=$(mktemp -d)
git archive d39d2badd5a0cfbccd4fd488e7a50736e10e83ff Cargo.toml Cargo.lock crates/dictionary-engine | tar -x -C "$experiment"
mkdir -p "$experiment/crates/dictionary-engine/examples"
cp crates/dictionary-engine/examples/package-benchmark.rs "$experiment/crates/dictionary-engine/examples/"
cargo build --locked --release --manifest-path "$experiment/Cargo.toml" --target-dir "$experiment/baseline-build" -p dictionary-engine --example package-benchmark
cargo build --locked --release --target-dir "$experiment/candidate-build" -p dictionary-engine --example package-benchmark
python3 scripts/measure-dictionary-serialization.py "$experiment/baseline-build/release/examples/package-benchmark" "$experiment/candidate-build/release/examples/package-benchmark" "$experiment/results"
```

脚本保存每轮样本、峰值 RSS、二进制摘要、汇总与边界语料的实际文件。
如需单独调整规模：

```sh
cargo run --locked --release -p dictionary-engine --example package-benchmark -- 100000 1024 7 html
```
