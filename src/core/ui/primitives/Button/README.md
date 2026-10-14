# Button

`FlashcardButton` 将视觉层级（`variant`）、尺寸（`size`）和形状（`preset`）独立组合。

| variant     | 视觉                 | 使用场景                           |
| ----------- | -------------------- | ---------------------------------- |
| `primary`   | 强调色淡底、清晰边框 | 开始学习、确认保存等主操作         |
| `secondary` | 强调色淡底、清晰描边 | 刷题、与主操作并列的次级入口       |
| `neutral`   | 中性表面、细边框     | 工具、弹窗辅助操作；普通按钮默认值 |
| `outline`   | 透明底、中性描边     | 更多、返回等低优先级入口           |
| `ghost`     | 透明底，悬停出现表面 | 工具栏；icon / prev 预设的默认值   |
| `danger`    | 危险色淡底及描边     | 删除、清空等破坏性操作             |

```tsx
<FlashcardButton variant="secondary" icon={Target}>刷题</FlashcardButton>
<FlashcardButton variant="neutral" preset="icon" size="md" icon={Keyboard} aria-label="拼写" />
```

尺寸为 `sm`（28px）、`md`（32px，默认）、`lg`（38px），图标按钮保持同尺寸正方形。触摸设备的点击区域至少为 44px。普通按钮允许多行文字。

所有按钮及其悬停、选中、按下状态均不使用阴影，通过底色与边框区分层级；键盘焦点使用 outline。

按钮默认 `type="button"`；表单提交需显式传 `type="submit"`。纯图标按钮应提供 `aria-label`。`active` 控制视觉选中态；切换按钮仍需传 `aria-pressed`，展开按钮传 `aria-expanded`。选中态、键盘焦点、按下态与禁用态由组件统一管理。

业务视图只处理布局；如需独有颜色，可以在视图的按钮类上设置局部 `--fc-button-*` 变量（例如 `--fc-button-bg` / `--fc-button-bg-hover` / `--fc-button-border` / `--fc-button-text`），避免再写一套宿主覆盖规则。
