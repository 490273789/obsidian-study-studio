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

## 不归编辑会话管的状态

- 播放、材料选择/删除、字幕生成与草稿保存仍归 `AudioPracticeRuntime` 与 `SubtitleDraftEngine`；编辑会话只在提交时调用 `addMaterial` / `editMaterial`。
- 生成中的禁用（`preparing` / `transcribing` / `aligning` / `saving` 时禁止 add/select/remove/edit）继续由 view 从 runtime 快照推导；不要把生成状态复制进编辑会话。
- 字幕草稿 review 对话框与播放器控件不在编辑会话范围内。

## 测试

- `ui/__tests__/materialEditSession.test.ts`：会话接口上的打开/字段/读取取消/提交失败/目录刷新/取消与 dispose。
- `ui/__tests__/MaterialEditView.test.tsx`：view 只断言渲染与 intent 转发，并保留“发起对话框失败、其他视图 alert”的可见行为。
- runtime、转写 provider 与草稿引擎的测试继续在 `domain/__tests__/` 覆盖；编辑会话测试不 mock React。
