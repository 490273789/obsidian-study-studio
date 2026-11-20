# UI and Obsidian Guide

Read this guide before changing React UI, deck home behavior, the Obsidian view/settings adapters, localization, modals, or CSS.

## React and Obsidian boundaries

- Keep React components functional and organized by layer: UI primitives live under `src/core/ui/primitives/` (with colocated `.scss` styles), business feature views live under `src/features/flashcards/ui/views/` (with colocated `.scss` styles). There is no barrel: import the leaf module (`../../primitives/Button`), because a maintained re-export list drifts as soon as a feature is added.
- Obsidian views are declared through `createReactItemView` in the owning feature module (`src/features/*.tsx`). The seam owns container, React root, `I18nProvider`, the render error boundary, theme opt-in, settings-push re-render, and teardown; a view definition only supplies `type`, `icon`, `title`, `readSettings`, `renderErrorMessage`, `render`, optional classes, and open/close hooks. Do not add an `ItemView` subclass.
- `FlashcardApp` (`src/features/flashcards/ui/FlashcardApp.tsx`) adapts shared service snapshots and renders one view-local `FlashcardNavigation` snapshot. `FlashcardNavigation` owns routes, initial setup options in `ViewState`, and root confirmations; React retains setup/card-editor drafts. Neither is a second authority for deck, session, identity, or pronunciation state.
- Card encounters belong to `answerPresentationTransition`: the shell passes its `presentedCard` to the active view, and `ui/presentation/CardSurface.tsx` is the only assembly of question/answer/explanation plus mode children. Views must key their local state (spelling input, challenge input/feedback) from `presentedCard.presentationKey` and must not derive their own encounter or presentation keys.
- `ui/routes.tsx` is the single route/page authority: it owns `ViewState` constructors (frozen), the row table for resting routes plus active/result session surfaces, and `resolvePage(...)`, which returns the page key, depth, and render closure. Missing deck/plan/presented-card resolves to the home row before rendering, so key and content cannot diverge; `challenge-setup` resolves to the landing page plus its overlay. Do not add route template strings or page switches back to the shell.
- Page transitions belong to the `FlashcardApp` shell: `ui/pageTransition.ts` only compares the resolved page against the previous one to choose `forward`/`backward`/`replace`; the shell keys one wrapper by that page and animates its entrance in `FlashcardApp.module.scss`. The wrapper sets `--fc-motion-page-enter: none` so fill pages do not animate twice. A page key must only change when the page on screen changes, never for card progress, settings, or the challenge setup overlay, and the entrance must honor `prefers-reduced-motion`.
- Send exit/result actions with the reference of the presented lifecycle snapshot. Navigation cancels stale exit confirmations and ignores obsolete async UI results. Confirmation responses carry their rendered ID. Mount cleanup releases confirmations and deck-home ownership without ending the shared session.
- `DeckHome` publishes the home snapshot, one required by-id deck read (`getDeck`), and the `record-word-list-visit` action (resolved through `DeckHomeRepository.recordWordListVisit`), so UI components never see or pierce through to the persistence composition behind `createFlashcardPersistence`.
- `DeckSettingsModal` is isolated from `DeckList` to manage deck-level configuration, reusing pure definitions from `src/features/flashcards/settings/studyMeta.ts`.
- Render card Markdown with Obsidian `MarkdownRenderer`, never raw HTML injection.
- Use the shared modal primitives under `src/core/ui/primitives/Modal/` and the existing confirmation/card-editor components before creating a new overlay system. Imperative contexts that have no React host (the settings tab, command callbacks) use an Obsidian `Modal` subclass instead, as in `src/features/flashcards/obsidian/continuityModals.ts` and `src/features/dictionary/obsidian/modals.ts`.
- Use `lucide-react` for new React icon buttons. Keep controls keyboard-friendly and preserve existing shortcuts.
- Push a catalog entry with `host.catalog(...)` so the host generates the feature's open command. Flashcards is the plugin landing page and owns the single plugin ribbon; its header renders the host catalog projection (`host.featureShortcuts()`) instead of naming sibling features. Other features do not add ribbon icons.
- Keep copy Chinese-first and route user-visible strings through `src/core/i18n/`.

For card shortcut mapping, focus ownership, event filtering, or dialog interaction,
read [Card presentation shortcuts](sessions.md#card-presentation-shortcuts).

## Styling

- Styling follows a hybrid architecture: global SCSS under `src/core/styles/`, UI primitives under `src/core/ui/primitives/`, and feature views as CSS Modules under `src/features/**/ui/*.module.scss`. `src/core/styles/index.scss` is the sole global entry imported by `src/core/host/main.ts`; Vite generates root `styles.css`. Feature views import their `.module.scss` directly; never `@use` them in `index.scss`.
- Preserve the cascade import order in `src/core/styles/index.scss`: base tokens & mixins, settings, layout, primitives, motion, and responsive.
- Take the page shell, panel surface, and header/footer semantics from the layout module (`src/core/styles/layout.scss`, classes `fc-page*` / `fc-panel*`); add the classes next to the view's own and keep only view-specific rules in its stylesheet. Do not restate the page recipe or the panel recipe.
- Reuse existing `--fc-*` tokens and Obsidian theme tokens. Use `--fc-font-2xs` (10px) only for keyboard shortcuts (kbd) and micro badges; avoid inline-style proliferation, new parallel token systems, or fixed light/dark palettes (except for dedicated immersive players like `VideoPlayer` where high-contrast dark consoles are required).
- Follow the [control sizing standard](../../src/core/styles/README.md#间距与尺寸) for every button, input, select, and local size override: desktop heights follow component content and density, with no universal 38px constraint; coarse-pointer targets remain at least 40 × 40px. Reuse size tokens and preserve component size choices instead of locking all page controls to one height.
- Keep touch targets, keyboard focus (`fc-focus-ring`), reduced-motion behavior, responsive layouts, and light/dark contrast intact.
- For a visible regression, make the smallest effective repair before considering broader redesign.
- Style-only changes need no new unit tests, but require `pnpm run build` and visual inspection in Obsidian when feasible.

Component or Obsidian API tests need explicit mocks/setup; do not rely accidentally on browser globals in the Vitest environment.
