# 听说练习指南

读这个指南再改听说练习的材料编辑、文件目录、字幕草稿、播放、转写配置或失败文案。

## 材料编辑会话

`src/features/audio-practice/ui/materialEditSession.ts` 是一个 view 的深 module，拥有听说材料编辑的全部交互竞态：

- 每个 view 一个实例（`AudioPracticeView` 用 `useMemo` 创建并在卸载时 `dispose()`），两个 leaf 互不影响草稿。
- 快照：`open`、`mode`、打开时的 `expectedMaterial`、表单字段、候选文件、`readingText`、`readFailure`、`failure`、`busy`、`canSubmit`。intent：`openAdd` / `openEdit` / 字段 setter / `readTextFile` / `submit` / `cancel` / `dismissFailure`。
- `openEdit` 保存材料快照；`submit()` 把它作为 `editMaterial` 的 `expected`，材料在对话框打开后被外部替换会得到 `stale-material`，对话框保持打开。
- 文本文件读取用会话内 token：晚到结果不能覆盖新选择或用户手动输入；失败进入 `readFailure`，不写 runtime 状态。
- 只有成功提交才关闭；提交失败保留字段与错误供重试；`cancel` 在提交中忽略。
- 候选目录由 `AudioPracticeCatalog.list()` + `subscribe()` 驱动，并把当前 audio/subtitle 值并入候选。

视图只渲染快照并发送 intent；不要再在 view 里维护 `materialDialog`、`dialogOperationId`、字段 `useState` 或 `readVersion`。

失败可见性：发起视图用自己的 `failure` 显示对话框错误，并抑制重复的页面级 alert；其他视图继续显示 runtime `materialOperation.failure` 的页面 alert。归属由会话提交结果决定，不能用 operation id 反查。

## 文件目录 port

`AudioPracticeCatalog`（`domain/types.ts`）只负责 `list(): { audioPaths, subtitlePaths, textPaths }` 与路径变化订阅；`AudioPracticeFiles` 保持单文件读取/存在/媒体 URL/字幕写入的语义。两者由 `obsidian/vaultFiles.ts` 的同一个 vault adapter 构造；domain 代码不接触 `app.vault`。

## 不归编辑会话管的状态与模块边界

- 播放、材料切换/删除与字幕持久化归 `AudioPracticeRuntime`；字幕生成、对齐、草稿审核与编辑归 `SubtitleDraftEngine`。编辑会话只在提交时调用 `addMaterial` / `editMaterial`。
- `AudioPracticeRuntime` 与 `SubtitleDraftEngine` 已解耦浅层传递接缝：
    - `SubtitleDraftEngine` 是独立深模块，由 `feature.tsx` 的 feature lifetime 直接拥有，并通过回调接缝 `commitSubtitles: (id, cues, timings) => runtime.saveSubtitles(id, cues, timings)` 写回。
    - `AudioPracticeRuntime` 不再代理草稿方法（不再暴露 `generateSubtitles` / `cancelSubtitleGeneration` / `saveSubtitleDraft` / `actOnSubtitleDraft` 等），其快照也不再混入 `draft`。
    - 两者通过 `AudioPracticeMaterialObserver`（`onMaterialSelected` / `onMaterialDiscarded` / `onMaterialAudioChanged` / `isGenerating`）协同生命周期。
- 视图交互与审核：
    - `ReviewDialog`（`ui/ReviewDialog.tsx`）：独立审查对话框模块，直接与 `SubtitleDraftEngine` 交互。
    - `PracticeViewInteraction`（`ui/practiceViewInteraction.ts`）：纯适配器类，收敛播放视图的快捷键（空格、左右箭头）、文档可见性隐藏暂停与字幕平滑居中滚动。
- 生成中的禁用（`preparing` / `transcribing` / `aligning` / `saving` 时禁止 add/select/remove/edit）由 view 从 `draftEngine` 快照推导；不要把生成状态复制进编辑会话。

## 转写配置

`domain/transcriptionConfiguration.ts` 的 `TranscriptionConfiguration` 是设置解释的唯一 owner：
provider 选择、workspace 密钥引用优先级、字段归一化和生成前校验都留在这里。
选定的 workspace 密钥缺失或读取失败时不回退旧明文值。`AudioPracticeRuntime` 在读取音频前
取得已校验的不可变配置，文件与草稿流程继续由 runtime 和字幕草稿引擎拥有。

视频经 `features/index.ts` 借用同一个配置 module，在请求前匹配任务指纹并取得对应配置；
异步计算指纹后还会核对当前设置，不能按旧签名执行新设置。仅读取指纹不要求 API 密钥可用，
避免影响仅翻译导入字幕。指纹与旧草稿匹配仍使用 `core/media`，不另造版本或迁移规则。

## 测试

- `ui/__tests__/practiceViewInteraction.test.tsx`：快捷键（空格播放暂停、左右箭头切句）、可见性隐藏暂停与字幕平滑滚动的适配器断言。
- `ui/__tests__/materialEditSession.test.ts`：会话接口上的打开/字段/读取取消/提交失败/目录刷新/取消与 dispose。
- `ui/__tests__/MaterialEditView.test.tsx`：view 只断言渲染与 intent 转发，并保留“发起对话框失败、其他视图 alert”的可见行为。
- `domain/__tests__/subtitleDraftEngine.test.ts`：涵盖 Unicode 分词对齐、分块转写流水线、指纹校验及草稿单接缝编辑动作。
- runtime、转写 provider 与草稿引擎的测试继续在 `domain/__tests__/` 覆盖；编辑会话测试不 mock React。
- `domain/__tests__/transcriptionConfiguration.test.ts` 覆盖配置准备、密钥失败、任务匹配与异步变化；
  `src/__tests__/mediaComposition.test.ts` 验证真实组合路径将已接受的配置用于请求。
