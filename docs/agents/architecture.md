# Architecture Guide

Read this guide for plugin lifecycle, dependency ownership, or changes spanning more than one feature module. Read relevant accepted ADRs in `docs/adr/` before changing their decisions.

## Runtime composition

`src/core/host/main.ts` is the composition root and nothing else. `StudyStudioPlugin.onload()`:

1. Creates `WorkbenchStore` and loads persisted settings/data.
2. Creates the plugin-lifetime `AiService`.
3. Creates the `Workbench` (`src/core/host/workbench.ts`) with the module list from
   `src/features/index.ts`, adds the host-owned AI engine settings section, registers
   the settings tab, and calls `workbench.refresh()`.

The settings document itself is composed from the feature-owned slices registered in
`src/core/host/settingsSlices.ts` (ADR-0019). The same registry groups slices by owner and
projects owner-scoped settings capabilities at the workbench seam (ADR-0028), so the
composition root never enumerates a slice and features never receive the global document.

`Workbench.refresh()` performs the initial full render. After a local or externally synchronized
commit, `Workbench.settingsChanged(previous, next)` re-renders only the owners whose slices changed
and pushes a signal to their open views; the shared `language` context fans out to every owner.
The composition root owns only the settings document, its write queue (`commitSettings(patch)`),
the shared `AiService` and `WorkbenchStore`, and the plugin lifecycle; it never names a feature's
views, chrome, commands, or settings slice.

Each feature owns everything else it needs. `src/features/flashcards/feature.tsx` constructs
`SessionLifecycle`, `CardIdentityContinuity`, `DeckHome`, `FlashcardRepository`, and `PronunciationRuntime` on first
render and disposes them in `stop()`, because no other feature uses them. `FlashcardRepository`
crosses persistence only through its feature-owned `FlashcardAuthority` adapter: it owns migration,
learning-state choreography, external reload reconciliation, cache ordering, and its own revision;
the production adapter alone knows WorkbenchStore's generic document mechanics (ADR-0029). `AI 翻译`
and `词典` own their runtimes the same way. Shared services reach a feature through its factory in
`features/index.ts`, never through the host.

`src/core/selectionHelper/` is the 工作台-owned 选区助手 interaction module (ADR-0025), not a 工作台功能. It runs through the same `WorkbenchModule` lifecycle without contributing a catalog entry. 词典 and AI 翻译 each provide a narrow adapter; the composition module connects them without reading either feature's runtime.

`src/core/host/reactItemView.tsx` mounts every view's React tree (ADR-0020) and injects the flashcard services into `FlashcardApp`. Closing a view unmounts its React adapter and stops current pronunciation, but it does not itself end an active session. Plugin unload calls `workbench.dispose()`, which stops every feature before the shared `AiService` is disposed.

## Source layout

The tree is sliced by 工作台功能, not by implementation layer (ADR-0021). A feature's domain, settings, strings, Obsidian adapters, and React views all live under one directory:

```text
src/
|-- core/                    # everything that is not one feature
|   |-- host/                # composition root (main.ts), workbench seam, view mount seam, settings tab, AI section, settings-slice registry
|   |-- settings/            # the SettingsSlice contract and the host slice
|   |-- selectionHelper/     # 工作台-owned selection interaction, settings, DOM adapter, and UI
|   |-- storage/             # WorkbenchStore: the single atomic writer of Sync-tracked data.json
|   |-- ai/                  # shared AI engine service
|   |-- i18n/                # translator framework, shared strings, AI error strings
|   |-- shared/              # the settings document type plus generic helpers
|   |-- styles/              # SCSS entry and global layers
|   `-- ui/                  # primitives, i18n context, hooks shared by several features
|-- features/
|   |-- index.ts             # the only module that lists every feature
|   |-- flashcards/
|   |   |-- feature.tsx      # the slice's WorkbenchModule implementation
|   |   |-- domain/          # cards, decks, history, identity, pronunciation, sessions, wordList
|   |   |-- settings/        # slice descriptor, settings view model, study metadata
|   |   |-- strings/         # dictionary, typed useFlashcardI18n, practice-message defaults
|   |   |-- obsidian/        # continuity adapters and modals
|   |   `-- ui/              # FlashcardApp, its views, and its flashcard-only primitives
|   |-- translation/         # same layers: domain / settings / strings / obsidian / ui
|   `-- dictionary/          # same layers, plus the compiled-engine assets under domain/engine
`-- core/styles/index.scss   # the SCSS entry; feature styles are listed with feature paths
```

Read the layering inside a slice the same way as before: `domain/` and `settings/` are pure (`domain/**` never imports React or performs Obsidian I/O), `ui/` is React, `obsidian/` is the Obsidian adapter, and `feature.tsx` is the composition for that slice. Cross-slice imports are forbidden; a primitive shared by two features belongs in `src/core/`.

## Module ownership

| Area                | Primary modules                                                                                                            | Owns                                                                                                                                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workbench host      | `src/core/host/workbench.ts`                                                                                               | Feature registration, view registration and owner-targeted settings signals, owner-scoped settings capabilities, chrome lifetime, view activation, settings-patch commits, the settings-section registry                                                 |
| Workbench features  | `src/features/`                                                                                                            | Per-feature runtime construction and disposal, views, ribbon/commands, settings sections, and feature-owned settings patches                                                                                                                             |
| Obsidian boundary   | `src/core/host/`                                                                                                           | Plugin/view lifecycle, vault adapters, notices, settings rendering, identity modals                                                                                                                                                                      |
| Shared UI           | `src/core/ui/`                                                                                                             | UI primitives, the i18n context, and hooks used by more than one feature                                                                                                                                                                                 |
| Deck home           | `src/features/flashcards/domain/decks/deckHome.ts`                                                                         | Shared home snapshot, deck readiness, settings draft, refresh/migration/save/export activity, navigation revalidation, reorder persistence, word list visit recording, and read facades for deck data                                                    |
| Sessions            | `src/features/flashcards/domain/sessions/sessionLifecycle.ts`                                                              | The single idle/active/result lifecycle and durable transitions for study/practice/spelling                                                                                                                                                              |
| Card continuity     | `src/features/flashcards/domain/identity/cardIdentityContinuity.ts`                                                        | Synchronization, migration, repair, source changes, stable card identity continuity                                                                                                                                                                      |
| Persistence         | `src/core/storage/workbenchStore.ts`, `src/features/flashcards/domain/storage/flashcardRepository.ts`                      | Atomic document serialization, opaque source tokens, and revision-checked writes in `data.json` via `WorkbenchStore`; migration, FSRS learning state, external reconciliation, local deck-index cache, and semantic transitions in `FlashcardRepository` |
| Settings document   | `src/core/host/settingsSlices.ts`, `src/core/settings/slice.ts`                                                            | The slice registry and the composed settings document: defaults, normalization, and cloning for every owner                                                                                                                                              |
| Outbound port       | `src/core/net/`                                                                                                            | Request execution, status classification, deadline and cancellation, credential reads, and the single host-pinned exception (ADR-0024)                                                                                                                   |
| AI engines          | `src/core/ai/`                                                                                                             | Named provider/model configurations, model discovery, text/image requests, credentials through an injected reader, and per-request timeout/cancellation                                                                                                  |
| Pronunciation       | `src/features/flashcards/domain/pronunciation/`                                                                            | Shared configuration snapshot, playback, providers, cancellation, cache and management activity                                                                                                                                                          |
| Pure card logic     | `src/features/flashcards/domain/cards/`                                                                                    | Parsing, formatting, source mutation, spelling extraction/comparison                                                                                                                                                                                     |
| Presentation models | `src/features/flashcards/domain/history/`, `src/features/flashcards/domain/wordList/`, `src/features/flashcards/settings/` | Pure display definitions, derived presentation state, and history retention pruning                                                                                                                                                                      |
| Flashcard strings   | `src/features/flashcards/strings/`                                                                                         | The 闪卡 dictionary (shared workbench strings merged with its own), the practice-message defaults, and the duration/rating formatters                                                                                                                    |
| Dictionary          | `src/features/dictionary/domain/`                                                                                          | Dictionary lookup, local compiled dictionaries, sandbox rendering, and the compiled-v2 package authority                                                                                                                                                 |
| Dictionary query    | `src/features/dictionary/domain/querySession.ts`                                                                           | Independent query input/state, history ordering, source concurrency, superseded-work cancellation, retries, explicit AI definitions, and immutable presentation snapshots                                                                                |

## Boundary rules

- Register Obsidian-facing commands and services in `src/core/host/main.ts`; keep feature behavior in its domain module.
- 工作台 modules run through the workbench seam (`WorkbenchModule.render(host)`). 工作台功能 reach Obsidian chrome only through `WorkbenchHost` and declare identity through the catalog; the 选区助手 uses the lifecycle without becoming a 工作台功能. `main.ts` and `settingsTab.ts` must not name a feature's views, ribbon, commands, or settings slice: add composition in `src/features/index.ts` instead.
- A feature declares its identity with `host.catalog(entry)` (title, icon, open command id, settings section, availability, how to open) and never adds its own ribbon: the workbench owns the entry point and the home list (ADR-0022). `host.chrome(...)` is only for commands specific to that feature.
- `Workbench.ring(build)` is the only place host-owned chrome is declared; it is rebuilt with every refresh so it relabels with the interface language.
- A feature reads settings through `host.settings.read()`, which returns only shared `language` plus the slices assigned to its owner in `SETTINGS_SLICES_BY_OWNER`. It writes only through `host.settings.update(patch)`; unauthorized own keys reject the whole patch before persistence. Only flashcards may change the shared language through `host.settings.setLanguage(language)` (ADR-0028).
- The host applies an authorized patch to the settings committed at write time, so a queued write never resurrects a stale slice. Owner changes notify only that module and its views; language changes notify all owners. A notification failure never rolls back a durable commit.
- A settings slice is the single authority for the keys it owns (ADR-0019). To add or change a slice, edit its owner's `SettingsSlice` descriptor and register it in `src/core/host/settingsSlices.ts`; never add a branch to `WorkbenchStore`, and never read `DEFAULT_SETTINGS` from a normalizer. Slices must return exactly the keys they declare and must not overlap.
- 工作台功能 must not import one another. A primitive shared by two features belongs in `src/core/`, not inside one feature's directory (ADR-0021).
- Keep a feature's files inside its slice: domain, settings, strings, Obsidian adapters, and views all live under `src/features/<id>/`. Only cross-feature infrastructure belongs in `src/core/`.
- Views are declared with `createReactItemView` (ADR-0020), never as hand-written `ItemView` subclasses: the seam owns the mount lifecycle and the error boundary, and always renders the committed settings. `updateSettings` is the host's push signal, not a settings source.
- React renders immutable snapshots and calls semantic actions. It must not coordinate persistence ordering or reach into raw engine state.
- `DeckHome`, `SessionLifecycle`, `CardIdentityContinuity`, and `PronunciationRuntime` are deep shared interfaces. Extend their semantic actions/snapshots instead of adding parallel state managers or pass-through wrappers.
- Pure engines, planners, builders, and presentation models must not import React or perform Obsidian I/O.
- `WorkbenchStore` publishes a monotonic revision after committed changes. Consumers subscribe rather than inventing manual refresh counters.
- Flashcard learning state crosses a feature-owned `FlashcardAuthority` seam. `FlashcardRepository` must not read generic documents, partition keys, or global settings; it accepts only flashcard study settings and semantic session, continuity, or word-list transitions. A source-token revision echo is not a repository revision; external or flashcard-settings replacement atomically rebuilds its full snapshot (ADR-0029).
- `data.json` is the cross-device authority for settings and learner state. Markdown-derived card text belongs only in `cache/deck-index.json`; missing or corrupt cache data must be rebuilt rather than treated as user-data loss.
- Outbound work goes through the outbound port: do not call `requestUrl`, `fetch`, or `secretStorage.getSecret` from a feature. A raw host-pinned fetch is the single sanctioned exception and lives behind `requestHostPinned` (ADR-0024).
- Use `import type` for Obsidian-only or boundary-only types in pure modules and tests whenever runtime loading is unnecessary.

For new features that call AI, read [the internal AI service guide](../design/ai-engine-usage.md) for configuration selection, image input, and cancellation semantics.

## Architecture records

Use ADR status, not filename order, to decide what is current. Notable current decisions:

- ADR-0028: project owner-scoped settings capabilities at the workbench seam and route committed settings changes only to affected owners.
- ADR-0029: deepen the flashcard persistence seam around a versioned authority adapter; `FlashcardRepository` owns learning-state choreography and cache reconciliation.

When implementation and an accepted ADR disagree, surface the conflict rather than silently introducing a third model.
