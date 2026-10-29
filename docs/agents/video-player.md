# 本地视频播放器指南

读这个指南再改本地视频的播放控件、快捷键、播放焦点、浮动窗口、拖拽/缩放、队列或持久化。

## Surface ownership

`src/features/video-player/ui/playerViewInteraction.ts` 的 `PlayerViewInteraction` 是 player surface 的唯一交互 owner：

- **DOM 行为**：通过 `PlayerViewRefs.focusSurface` 取得 focus surface 后，设置 `role="application"` 与 `tabIndex=0`，挂 `keydown` / `pointerdown`；view 只渲染结构、类名和本地化 `aria-label`。
- **快捷键**：每次 keydown 读取注入的 `readSettings().shortcuts`（`Space` / `ArrowLeft` / `ArrowRight` 默认值），映射到 `runtime.togglePlayback()` / `runtime.seekBy(±skipInterval)`；重复键只阻止默认行为、不重复执行。
- **交互目标**：只有一份 `isInteractiveTarget`，取并集 `button, input, select, textarea, summary, a, [contenteditable='true'], [role='button']`；它同时用于聚焦、快捷键、拖拽/双击，控件优先于 surface。
- **其他 surface 行为**：pointer 聚焦、双击 media/floating header 最大化、`Escape` 退出浮动最大化、media 元素在 docked/floating 之间搬移、presenter/waiting 角色、拖拽与缩放都留在这里。
- **命令面**：view 通过 `PlayerViewMount.act` 发送 `enter-floating / dock-and-pause / toggle-maximized / set-queue-expanded`；不要新增第二套键盘命令入口。

`VideoPlayerRuntime` 明确不持有 DOM；它只负责播放、队列、持久化与跨 view 的 presenter 竞争。`VideoPlayerView` 只读取 interaction/runtime snapshot、渲染结构与控件、提供 refs。

## 影子跟读

`VideoSubtitleJobs` 是插件生命周期的字幕任务 owner，字幕文档存在资料库，外部视频路径与任务检查点存在设备本地。`ShadowStorageRouter` 将 source ID 固定到第一次选定的资料库目录；`ShadowPracticeRecords` 管理难段和用户保留的录音。字幕冲突后通过 `reloadSource` 丢弃当前未保存草稿并重新读取资料库版本，不要让视图直接改 store。字幕、跟读和录音的边界记录在 [ADR 0009](../adr/0009-local-video-shadowing.md)。

`src/features/video-player/obsidian/videoShadowingDesktopAdapter.ts`（`VideoShadowingDesktopAdapter`）是桌面环境的宿主适配器：

- 拥有桌面状态持久化：`SHADOW_ENABLED_KEY` 启用列表与 `FFMPEG_PATH_KEY`；稳定视频源身份映射收敛在 `VideoPlayerRuntime` 与 `ObsidianVideoSourceIdentityStore`；
- 拥有桌面环境生命周期：通过 `bindPresenterWindow` 接管活动 presenter 窗口引用，平滑维护 Electron `require` 探测与麦克风录音器单例；
- 文件选取与稳定身份分配收敛为运行时的单一原子意图（`pickAndAddSources` / `pickAndReplaceSource`），经由平台 `VideoFilePickerPort` 完成，视图只渲染快照；
- 装配并管理 `VideoSubtitleJobs` 与 `ShadowingWorkspaceSession`，向 `feature.tsx` 暴露紧凑高杠杆接口。

`ShadowingSession` 拥有范围播放、停顿、录音、回听和失败保存队列；`VideoPlayerRuntime.playRange` 只实现有界播放。`ShadowingBridge` 发布视图所需的快照和意图，主视图与浮动视图共用同一实例。Presenter 交接时停止活动会话，关闭 view 不销毁插件生命周期的字幕任务。配置的跨功能借用只在 `src/features/index.ts`；`video-player` 不导入听说练习或翻译功能的内部模块。

字幕和跟读按当前视频单独启用，默认关闭；启用列表只保存在设备本地。关闭时隐藏主视图的字幕侧栏及浮动字幕控件，并取消当前跟读会话。队列是顶部紧凑栏，展开列表浮在内容上方，不改变视频宽度。

字幕任务的翻译签名和执行规则由翻译功能的 `TranslationExecution` 拥有，经组合 module 注入；
video-player 只传递已接受的签名。每条排队字幕在发请求前重新核对完整执行配置，配置变化后
保留已有译文并显示失败，重新选择配置后才继续补译。旧版不完整签名不能安全还原执行配置，
因此续跑会要求重新生成；已保存字幕不会删除。

转写配置由听说练习的 `TranscriptionConfiguration` 拥有，经同一组合 module 注入；
视频传递任务已接受的转写指纹，由 owner 完成匹配并返回固定配置后再发请求。
视频不解释百炼 workspace 密钥优先级，也不在指纹检查之后重新拼装当前设置。

## Presentation 状态

- 持久化值（`queueExpanded`、`floatingRect`）属于 runtime/store；interaction 的 snapshot 直接读 runtime 的当前值。
- interaction 只持有临时呈现：`presentation.kind`、`maximized` 与当前手势期间的 rect。拖拽/缩放期间不写 runtime，手势结束才 `setFloatingRect`；这样每帧不触发落盘。
- 浮动 rect 只在 `enter-floating` 时从 runtime 取初值；viewport resize 时重夹并在需要时持久化。
- 队列折叠通过 `set-queue-expanded` → `runtime.setQueueExpanded`；snapshot 由 runtime 变更驱动。

## 测试

- `ui/__tests__/playerViewInteraction.test.ts` 是 surface 行为的接口测试：focus 属性、快捷键、交互目标、重复键、Escape/双击、dock/floating、拖拽持久化、presenter 交接。
- `ui/__tests__/VideoPlayerView.test.tsx` 只断言结构与 intent/refs 接线，不再重复快捷键或焦点策略。
- runtime 的播放/持久化测试继续在 `domain/__tests__/videoPlayerRuntime.test.ts`；不要用 React hook mock 替代 surface 的 DOM fake。
