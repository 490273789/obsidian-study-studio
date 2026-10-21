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

## Presentation 状态

- 持久化值（`queueExpanded`、`floatingRect`）属于 runtime/store；interaction 的 snapshot 直接读 runtime 的当前值。
- interaction 只持有临时呈现：`presentation.kind`、`maximized` 与当前手势期间的 rect。拖拽/缩放期间不写 runtime，手势结束才 `setFloatingRect`；这样每帧不触发落盘。
- 浮动 rect 只在 `enter-floating` 时从 runtime 取初值；viewport resize 时重夹并在需要时持久化。
- 队列折叠通过 `set-queue-expanded` → `runtime.setQueueExpanded`；snapshot 由 runtime 变更驱动。

## 测试

- `ui/__tests__/playerViewInteraction.test.ts` 是 surface 行为的接口测试：focus 属性、快捷键、交互目标、重复键、Escape/双击、dock/floating、拖拽持久化、presenter 交接。
- `ui/__tests__/VideoPlayerView.test.tsx` 只断言结构与 intent/refs 接线，不再重复快捷键或焦点策略。
- runtime 的播放/持久化测试继续在 `domain/__tests__/videoPlayerRuntime.test.ts`；不要用 React hook mock 替代 surface 的 DOM fake。
