# UI and Obsidian Guide

Read this guide before changing React UI, deck home behavior, the Obsidian view/settings adapters, localization, modals, or CSS.

## React and Obsidian boundaries

- Keep React components functional and organized by layer: UI primitives live under `src/core/ui/primitives/` (with colocated `.scss` styles), business feature views live under `src/core/ui/views/` (with colocated `.scss` styles). There is no barrel: import the leaf module (`../../primitives/Button`), because a maintained re-export list drifts as soon as a feature is added.
- Obsidian views are declared through `createReactItemView` in the owning feature module (`src/features/*.tsx`). The seam owns container, React root, `I18nProvider`, the render error boundary, theme opt-in, settings-push re-render, and teardown; a view definition only supplies `type`, `icon`, `title`, `readSettings`, `renderErrorMessage`, `render`, optional classes, and open/close hooks. Do not add an `ItemView` subclass.
- `FlashcardApp` (`src/features/flashcards/ui/FlashcardApp.tsx`) adapts shared service snapshots and renders one view-local `FlashcardNavigation` snapshot. `FlashcardNavigation` owns routes, initial setup options in `ViewState`, and root confirmations; React retains setup/card-editor drafts. Neither is a second authority for deck, session, identity, or pronunciation state.
- Card encounters belong to `answerPresentationTransition`: the shell passes its `presentedCard` to the active view, and `ui/presentation/CardSurface.tsx` is the only assembly of question/answer/explanation plus mode children. Views must key their local state (spelling input, challenge input/feedback) from `presentedCard.presentationKey` and must not derive their own encounter or presentation keys.
- Page transitions belong to the `FlashcardApp` shell. `ui/pageTransition.ts` decides the page key, hierarchy depth, and entrance direction (`forward`/`backward`/`replace`); the shell keys one wrapper by that page and animates its entrance in `FlashcardApp.module.scss`. The wrapper sets `--fc-motion-page-enter: none` so fill pages do not animate twice. A page key must only change when the page on screen changes, never for card progress, settings, or the challenge setup overlay, and the entrance must honor `prefers-reduced-motion`.
- Send exit/result actions with the reference of the presented lifecycle snapshot. Navigation cancels stale exit confirmations and ignores obsolete async UI results. Confirmation responses carry their rendered ID. Mount cleanup releases confirmations and deck-home ownership without ending the shared session.
- `DeckHome` publishes the home snapshot, one required by-id deck read (`getDeck`), and the recording facade (`recordWordListVisit`), so UI components never pierce through to the persistence composition behind `createFlashcardPersistence`.
- `DeckSettingsModal` is isolated from `DeckList` to manage deck-level configuration, reusing pure definitions from `src/features/flashcards/settings/studyMeta.ts`.
- Render card Markdown with Obsidian `MarkdownRenderer`, never raw HTML injection.
- Use the shared modal primitives under `src/core/ui/primitives/Modal/` and the existing confirmation/card-editor components before creating a new overlay system. Imperative contexts that have no React host (the settings tab, command callbacks) use an Obsidian `Modal` subclass instead, as in `src/features/flashcards/obsidian/continuityModals.ts` and `src/core/host/dictionaryModals.ts`.
- Use `lucide-react` for new React icon buttons. Keep controls keyboard-friendly and preserve existing shortcuts.
- Push a catalog entry with `host.catalog(...)` so the host generates the feature's open command. Flashcards is the plugin landing page and owns the single plugin ribbon; its header renders the host catalog projection (`host.featureShortcuts()`) instead of naming sibling features. Other features do not add ribbon icons.
- Keep copy Chinese-first and route user-visible strings through `src/core/i18n/`.

For card shortcut mapping, focus ownership, event filtering, or dialog interaction,
read [Card presentation shortcuts](sessions.md#card-presentation-shortcuts).

## Card editing

`CardEditingInteraction` in `src/features/flashcards/ui/cardEditingInteraction.ts`
owns one view's preparation, migration prompts, save/delete outcomes, busy/error
snapshot, and interaction lifetime. React retains draft text and keys the editor
by its interaction ID; save and close callbacks carry that rendered ID.
Replacement, route changes, and unmount invalidate old presentation results while
accepted source writes finish through `CardIdentityContinuity`. Migration prompts
use `FlashcardNavigation` with the interaction's cancellation signal; navigation
releases the exact pending continuation. Migration completion leaves retry to the
learner. Test these sequences through the interaction interface.

## Selection helper sources

`SelectionHelper` in `src/core/selectionHelper/domain/selectionHelper.ts` owns
source registration, window ownership, capture validity, and the single visible
assistant/query lifetime. DOM and webview adapters acquire one source lease per
document or page through `openSource(owner)`; navigation replaces the lease.

- Capture a read token before starting asynchronous work or a touch delay. A token
  submits once and is rejected after its source closes, another selection wins,
  or a user interaction fences pending captures. Never capture a fresh token after
  an old operation returns. Source disposal removes its registration; retain no
  global tombstone or numeric-generation map in adapters.
- `dismiss()` closes the assistant and fences old captures. Owner-scoped dismissal
  fences pending captures globally but closes only that window's visible assistant.
  `interrupt()` fences pending work without closing the visible query. Automatic
  source disposal and `lease.dismiss()` affect only the exact source.
- The target retains captured text, not a live Range or input offset. Copying,
  assistant interaction, and edits within the same node preserve that snapshot;
  removal of its origin node, page navigation, and window closure expire it.
  A removed selection can be replaced by a fresh capture from the same document.
- The DOM adapter owns origin-node checks, native selection gestures, coordinates,
  and document/frame cleanup. The webview adapter owns guest-data validation,
  page-specific collector cleanup, single-flight reads, and sequence deduplication.
  Consume guest sequence numbers even when a read token rejects a late result.
  An old page's completion or cleanup must not modify a replacement page's state.
- Expiry releases the assistant lookup. Translation, main-dictionary, and favorite
  handoffs already accepted by their owning modules continue. Dictionary sandbox
  rendering remains dictionary-owned under ADR 0002; web compatibility follows
  ADR 0004.
- Test source and capture ordering through the real helper interface; adapter tests
  cover native event wiring, iframe/window replacement, and the guest protocol.

## Dictionary favorites

Modal and sidebar adapters render the shared `DictionaryFavoriteController`.
Route presentation decisions through `DictionaryFavoritePresentation`; read
[Favorite presentation](dictionary.md#favorite-presentation) before changing
opening, closing, or save-completion behavior.

## Deck home

`src/features/flashcards/domain/decks/deckHome.ts` is one shared plugin-lifetime module used by every open flashcard view.

- It publishes the home read model: totals, per-deck study/spelling readiness, per-deck effective study settings, study history, spelling progress, migration summary, one settings draft, refresh/migration/save activity, reorder persistence, PDF export activity, and navigation revalidation.
- The snapshot is the read model. Read totals, history, progress and effective settings from it instead of calling repository getters; `getDeck(deckId)` is the one required by-id read for full card data. Setup pages select their plan from the snapshot through `src/features/flashcards/ui/deckHomeSetupPlans.ts`.
- Each deck row is rendered by `src/features/flashcards/ui/views/Home/DeckCard/` from one stable snapshot row. `DeckHome` reuses a row reference while its content holds, so `DeckList` derives grouping and `DeckCard` derives visual state and progress on render through `src/features/flashcards/ui/homePresentation.ts`; never add a second row cache or a field-by-field mirror. The same module selects the resume target (`selectContinueDeck`) from the shared snapshot. Secondary row actions use the shared `FlashcardMenu`; the row reports menu open/close so the list can disable sorting while a menu is open.
- React owns rendering, menus, settings-modal visibility, and drag interaction. `FlashcardNavigation` owns root confirmations and the final navigation handoff after deck-home revalidation.
- Mutating operations are mutually exclusive; PDF export is a separate single-flight read-only activity.
- Do not derive competing readiness rules or raw deck-home statistics inside components.
- Reorder through the semantic `reorder` action so the saved `deckOrder` and shared snapshot stay aligned.

## Sorting interactions

`SortableInteraction` in `src/core/ui/primitives/Sortable/sortableInteraction.ts`
owns a displayed list's drag validity, immediate submission lock, optional preview,
and stale-completion rejection. React acquires it with `useSortableInteraction`;
imperative settings controls own its mount cleanup and pass it to their React sorting adapter.

- Drag gestures and move buttons use the same interaction and stable item IDs.
  Ordered-ID changes or disabling invalidate an unfinished gesture; same-content
  array replacements preserve it. `ReorderableList` connects sensors and releases
  unfinished gestures when its surface closes.
- Owners retain authoritative order, ordering rules, persistence and error feedback.
  Completion means the owner callback settled; video queue acceptance still precedes
  background persistence. A new authoritative order replaces any local preview
  without unlocking an accepted submission early.
- Unmount releases presentation work while accepted owner writes continue. Old
  completions cannot affect a replacement mount. Locks belong to each displayed list.
- Test these sequences through the real interaction interface. Adapter tests cover
  grid strategy and completed-deck grouping, native move buttons, and queue wiring.

## Question input visibility

`InputVisibility` in `src/features/flashcards/ui/inputVisibility.ts` owns the
flashcard view's window-scroll compatibility and registered question input's
keyboard inset, local scrolling, conditional focus, and scheduled-work cleanup.
`InputVisibilityProvider` owns its document/window lifetime; `useSessionInputVisibility`
registers only committed elements and question keys.

- Capture an `InputReturn` before awaiting an answer. Apply draft changes only
  while it is current, then request conditional focus. Pointer/focus transfers,
  dialogs and window blur revoke old focus permission even if the learner returns.
- Mark submission, unknown-answer and continue buttons with
  `data-session-input-action` so they retain input ownership. Other controls keep
  their own focus. View/root tabindex does not make ordinary content a control.
- Question keys survive ordinary revisions and retrieval-to-correction changes;
  a new encounter, including single-card correction-to-retrieval, resets drafts
  and leases. Input replacement and unmount release old work while accepted
  answer transactions remain owned by `AnswerPresentationTransition`.
- Preserve the existing root-scroll and keyboard geometry policies. Test real
  module behavior with local document/window doubles, adapter wiring separately,
  and real React mounting for effect ordering; report mobile verification separately.

## Word list

`WordListViewport` in `src/features/flashcards/ui/views/WordList/` owns one view's
measurements, frame batching, width/content invalidation, and visible-row snapshot.
React connects elements, supplies the displayed items, and renders the snapshot;
masking, shuffling, explanations, and visit recording remain view interactions.
Keep geometry internal to this module and test observable snapshots through its
interface. Its internal DOM adapter uses the element's owning window; mount cleanup
releases all observers and frames and supports setup/cleanup/setup replay.

## Settings compatibility

`src/core/settings/presentation.ts` is the shared renderer-neutral settings presentation seam. Each registered `WorkbenchSettingsSection` builds one immutable snapshot with the keyed composer and exposes actions only as opaque references. `src/core/host/settingsTab.ts` owns section navigation, scroll positions, and presentation generations. It delegates groups, rows, controls, and their `invoke` bindings to `renderSettingsControls` in `src/core/host/settingsControlRenderer.ts`.

- The tab renders through the imperative `display()` → `renderSettings()` path only; keep that single path working.
- `refreshDefinitions()` always creates a new presentation generation through `renderSettings()`, installs it atomically, and disposes the old generation so detached controls cannot mutate current state.
- Feature and host settings editors retain drafts, persistence, notices, subscriptions, and activate/hide lifecycle. Do not move those effects into the presentation module.
- Keep all control kinds in the renderer's exhaustive dispatch, including primitive controls nested in cards. Rich descriptions use the target container's document. Renderer tests exercise real presentation actions through Obsidian/DOM test doubles; tab tests cover generation replacement and page lifecycle.
- Add common renderer-neutral recipes to the closed composer catalog only when multiple settings sections need them. Keep feature-specific shapes out of the shared module.
- Preserve async tag discovery/refresh and runtime subscription cleanup; both live behind the section assembled in `src/features/flashcards/feature.tsx`.
- Pronunciation controls derive values and busy/cache state from `PronunciationRuntime`; do not duplicate transient state in the settings adapter.
- After settings changes, explicitly verify that the settings tab is not blank when manual Obsidian testing is feasible.

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
