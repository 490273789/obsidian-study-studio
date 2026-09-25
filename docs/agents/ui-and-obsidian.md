# UI and Obsidian Guide

Read this guide before changing React UI, deck home behavior, the Obsidian view/settings adapters, localization, modals, or CSS.

## React and Obsidian boundaries

- Keep React components functional and organized by layer: UI primitives live under `src/core/ui/primitives/` (with colocated `.scss` styles), business feature views live under `src/core/ui/views/` (with colocated `.scss` styles). There is no barrel: import the leaf module (`../../primitives/Button`), because a maintained re-export list drifts as soon as a feature is added.
- Obsidian views are declared through `createReactItemView` in the owning feature module (`src/features/*.tsx`). The seam owns container, React root, `I18nProvider`, the render error boundary, theme opt-in, settings-push re-render, and teardown; a view definition only supplies `type`, `icon`, `title`, `readSettings`, `renderErrorMessage`, `render`, optional classes, and open/close hooks. Do not add an `ItemView` subclass.
- `FlashcardApp` (`src/features/flashcards/ui/FlashcardApp.tsx`) adapts shared service snapshots and renders one view-local `FlashcardNavigation` snapshot. `FlashcardNavigation` owns routes, initial setup options in `ViewState`, and root confirmations; React retains setup/card-editor drafts. Neither is a second authority for deck, session, identity, or pronunciation state.
- Send exit/result actions with the reference of the presented lifecycle snapshot. Navigation cancels stale exit confirmations and ignores obsolete async UI results. Confirmation responses carry their rendered ID. Mount cleanup releases confirmations and deck-home ownership without ending the shared session.
- `DeckHome` provides read and recording facades (such as `getDeck`, `getStudyHistory`, and `recordWordListVisit`) to prevent UI components from piercing through to the low-level `FlashcardRepository`.
- `DeckSettingsModal` is isolated from `DeckList` to manage deck-level configuration, reusing pure definitions from `src/features/flashcards/settings/studyMeta.ts`.
- Render card Markdown with Obsidian `MarkdownRenderer`, never raw HTML injection.
- Use the shared modal primitives under `src/core/ui/primitives/Modal/` and the existing confirmation/card-editor components before creating a new overlay system. Imperative contexts that have no React host (the settings tab, command callbacks) use an Obsidian `Modal` subclass instead, as in `src/features/flashcards/obsidian/continuityModals.ts` and `src/core/host/dictionaryModals.ts`.
- Use `lucide-react` for new React icon buttons. Keep controls keyboard-friendly and preserve existing shortcuts.
- Push a catalog entry with `host.catalog(...)` so the host generates the feature's open command. Flashcards is the plugin landing page and owns the single plugin ribbon; its header exposes sibling feature shortcuts through `host.openFeature(...)`. Other features do not add ribbon icons.
- Keep copy Chinese-first and route user-visible strings through `src/core/i18n/`.

## Deck home

`src/features/flashcards/domain/decks/deckHome.ts` is one shared plugin-lifetime module used by every open flashcard view.

- It owns home totals, per-deck study/spelling readiness, migration summary, one settings draft, refresh/migration/save activity, reorder persistence, PDF export activity, word list visit recording, deck read facades, and navigation revalidation.
- React owns rendering, menus, settings-modal visibility, and drag interaction. `FlashcardNavigation` owns root confirmations and the final navigation handoff after deck-home revalidation.
- Mutating operations are mutually exclusive; PDF export is a separate single-flight read-only activity.
- Do not derive competing readiness rules or raw deck-home statistics inside components.
- Reorder through the semantic `reorder` action so the saved `deckOrder` and shared snapshot stay aligned.

## Word list

`WordListViewport` in `src/features/flashcards/ui/views/WordList/` owns one view's
measurements, frame batching, width/content invalidation, and visible-row snapshot.
React connects elements, supplies the displayed items, and renders the snapshot;
masking, shuffling, explanations, and visit recording remain view interactions.
Keep geometry internal to this module and test observable snapshots through its
interface. Its internal DOM adapter uses the element's owning window; mount cleanup
releases all observers and frames and supports setup/cleanup/setup replay.

## Settings compatibility

`src/core/settings/presentation.ts` is the shared renderer-neutral settings presentation seam. Each registered `WorkbenchSettingsSection` builds one immutable snapshot with the keyed composer and exposes actions only as opaque references. `src/core/host/settingsTab.ts` is the production Obsidian adapter; it renders the snapshot and sends interactions back through `invoke`.

- The tab renders through the imperative `display()` → `renderSettings()` path only; keep that single path working.
- `refreshDefinitions()` always creates a new presentation generation through `renderSettings()`, installs it atomically, and disposes the old generation so detached controls cannot mutate current state.
- Feature and host settings editors retain drafts, persistence, notices, subscriptions, and activate/hide lifecycle. Do not move those effects into the presentation module.
- Add common renderer-neutral recipes to the closed composer catalog only when multiple settings sections need them. Keep feature-specific shapes out of the shared module.
- Preserve async tag discovery/refresh and runtime subscription cleanup; both live behind the section assembled in `src/features/flashcards/feature.tsx`.
- Pronunciation controls derive values and busy/cache state from `PronunciationRuntime`; do not duplicate transient state in the settings adapter.
- After settings changes, explicitly verify that the settings tab is not blank when manual Obsidian testing is feasible.

## Styling

- Edit SCSS under `src/core/styles/` (for globals) and beside components under `src/core/ui/primitives/` and `src/core/ui/views/`. `src/core/styles/index.scss` is the sole entry imported by `src/core/host/main.ts`; Vite generates root `styles.css`.
- Preserve the cascade import order in `src/core/styles/index.scss`: base tokens & mixins, settings, primitives, views, motion, and responsive.
- Take the page shell, panel surface, and header/footer semantics from the layout module (`src/core/styles/layout.scss`, classes `fc-page*` / `fc-panel*`); add the classes next to the view's own and keep only view-specific rules in its stylesheet. Do not restate the page recipe or the panel recipe.
- Reuse existing `--fc-*` tokens and Obsidian theme tokens. Avoid inline-style proliferation, new parallel token systems, or fixed light/dark palettes.
- Keep touch targets, keyboard focus, reduced-motion behavior, responsive layouts, and light/dark contrast intact.
- For a visible regression, make the smallest effective repair before considering broader redesign.
- Style-only changes need no new unit tests, but require `pnpm run build` and visual inspection in Obsidian when feasible.

Component or Obsidian API tests need explicit mocks/setup; do not rely accidentally on browser globals in the Vitest environment.
