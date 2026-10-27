# Dictionary Guide

Read this guide before changing anything under `src/features/dictionary/domain/**`, the dictionary views/settings, or the compiled-v2 package contract. This is a security- and data-boundary-sensitive area; when the change touches packages, sources, or sandboxing.

## Source and boundary invariants

- Online sources (Youdao, Cambridge, Hujiang, AI) send only the explicit query. Each keeps its own timeout, size bound, and failure; Youdao official and free modes are explicit and must never silently fall back to one another.
- Official Youdao requests cross `src/core/net/youdaoTransport.ts` for endpoint/credential validation, v3 signing, JSON parsing and provider errorCode classification; the dictionary maps those shared failures into `DictionaryError` and keeps its own dicts/langType selection and payload parsing. Free mode stays on its own GET endpoint.
- AI definitions are opt-in per query and use the shared AI engine configuration selected by `settings.dictionary.ai.configId`. Ordinary lookups must not trigger an AI request.
- Single-word favourites write only after an explicit save to the selected favorite category's Markdown file. Category selection persists immediately; creating a category creates an empty file unless the selected Markdown file already exists. Editing a category path moves its file, while deleting a category keeps its file. Path suggestions may inspect vault folders and existing Markdown paths but must not become a general content scan.
- Batch favorites are a separate explicit action in the main dictionary search bar. They read one selected vault `.txt`/`.md` word list, generate with the existing favorite AI configuration, and write only to an existing category file. Empty lines are ignored; duplicate and already saved words are skipped. The batch holds the category file lease throughout, checks the destination before any AI request, and uses a fresh-content save-if-absent operation for each word. Word-level failures continue; target-file failures stop; stopping keeps accepted writes. Reruns skip saved entries. See ADR 0011.
- Desktop import may read user-selected MDX/MDD/CSS/JS/EUDIC files outside the vault. It compiles a package under the plugin's `dictionaries/{id}/compiled-v2/` directory and never copies the originals into the plugin folder. Mobile may only query fully synchronized compiled packages; it never compiles originals.
- The Eudic image loader uses the outbound port's single host-pinned request mode. Keep its fixed host and no-prefetch/no-persistent-cache behaviour in the feature; `credentials: 'omit'`, `redirect: 'error'`, MIME/size/timeout checks belong to the port implementation because `requestUrl` cannot express the redirect policy.
- Every untrusted definition, HTML, CSS, script, URL, audio, image, resource path, and `dic://`/`eures://` navigation goes through `sandbox-document/`. Keep the opaque-origin iframe without `allow-same-origin`, the versioned postMessage protocol, the random document identity, and the `event.source` checks.
- The sandbox host owns navigation and seeds the current theme plus `color-scheme` into `srcdoc` before each entry loads. Theme changes update the existing document over the validated message channel; do not rely on a post-load message for the initial theme (it causes a white flash in dark mode).
- Keep lazy worker/WASM initialization, bounded response and memory sizes, checksum verification, path containment, decompression limits, concurrent-read coalescing, and LRU budgets.
- `CompiledDictionaryResources` owns a compiled source's resource requests, URL/text cache, bounded local-miss cache, and URL release. Share in-flight reads across consumers; remote results remain in-flight only and failures remain retryable. Closing the source closes this module, rejects pending consumers, and prevents late reads from creating resources or posting back to the terminated worker. Keep sandbox validation and compiled-package verification in their existing modules.

## Compiled package architecture

- `src/features/dictionary/domain/compiled-package/` is the sole authority for compiled-v2 format/version, manifests, limits, checksums, safe paths, publication, compatibility, and verified reads. Compilers produce its required candidates; workers receive opaque plans and verified bytes; sources must not reimplement manifest parsing or package caches.
- The local dictionary catalog is authoritative for source identity, membership, order, and whole-dictionary transactions, and must agree with package facts. Never silently repair conflicts from disk; import, cancellation, failure, and settings-save rollback must leave existing sources intact and clean staging output.
- On mobile, `LocalDictionaryAdministrationModule` owns the settings page's compiled-v2 sync inspection state and checks packages through the existing `compiled-package/` reader with an injected Obsidian file adapter. A settings-page lease rechecks on each opening; catalog identity changes restart checks after catalog transactions settle, and late results cannot replace newer or removed entries. The settings editor only subscribes; the view model translates typed statuses using the current language.
- `domain/local-catalog-transaction.ts` owns the single post-stage transaction for both import and removal: persist the catalog, then commit the staged sources. Both staged commits are awaited and may fail; any failure unwinds through rollback and the previous catalog, and an incomplete unwind reports recovery-incomplete so the module latches degraded state. Import and removal differ only in staging, validation, progress and result shape.
- `DictionaryImportRecovery` (`domain/import-recovery.ts`) owns the desktop import batch's exclusively created directories and package receipts. Both failed preparation and settings-save rollback use its cleanup, which waits for every directory attempt before returning. Cancellation must not mask `recovery-incomplete`. The catalog commits receipts only after settings persist; the package publisher still owns single-package verification/publication. These are in-process compensations, not a startup disk-repair protocol.
- `formatVersion` is `2` and `engineVersion` must equal `2.0.6` exactly; older packages are incompatible and the catalog requests a re-import. Never downgrade or best-effort read an unknown format.
- Sandbox storage is a bounded compatibility object (`sandbox-storage.json`, at most 128 keys, 16,384 characters per value, 256 KiB of JSON). It is adjacent to, but not part of, the deterministic package.

## Layering rules

- Domain code under `src/features/dictionary/domain/**` may depend on Obsidian APIs only where the boundary requires it. Pure parsing, normalization, and planning helpers must stay free of React and vault I/O.
- The Obsidian boundary for this feature is `src/features/dictionary.ts` (workbench registration, runtime, chrome, settings section) together with `DictionaryView.tsx`, `DictionaryFavoriteView.tsx`, `dictionaryModals.ts`, and `dictionarySettingsEditor.ts`. It owns views, commands, notices, secrets, and persistence ordering, and writes its settings slice only through `host.updateSettings({ dictionary })`. React renders snapshots and calls semantic actions; it must not coordinate persistence or reach into raw engine state.
- Settings flow through `src/features/dictionary/settings/viewModel.ts` and the `reorderableList` control; the domain reads a settings store interface instead of `DataStore`.
- Secret values live only in Obsidian `SecretStorage`. Persist `appKeySecretId`/`appSecretSecretId` only; never put secret values in data, logs, notices, fixtures, or source.
- UI copy comes from `src/features/dictionary/strings/dictionary.ts` (`dictionaryStrings(language)`, Chinese-first with English overrides). Add keys there, not as literals in components.
- Dictionary styles are appended to `src/core/styles/index.scss` before the motion/responsive layers and use `flashcard-dictionary-*` classes plus `--fc-*` and Obsidian theme variables.

## Lookup assistant result presentation

`src/features/dictionary/ui/resultPresentation/DictionarySectionContent.tsx` owns the shared AI sense, list, and sandbox document markup. Both `DictionaryView` and `SelectionDictionaryResultContent` render through it, so definition fields and section visibility cannot drift between surfaces.

The selection adapter hands the 选区助手 one opaque `DictionarySelectionResultHandle` per successful source (the whole `DictionaryResult`, the active section index, and the looked-up word) as `result`. `SelectionHelper` owns the query lifetime and every lookup action: its snapshot is a pure read model (`lookup`, no live session), and `lookup` / `selectSource` / `selectSection` / `retryActiveSource` / `generateAi` translate into `SelectionLookupIntent`s sent through the adapter's narrow handle. The adapter is the one translation point to `DictionaryQueryIntent`; the popup card only renders the snapshot and forwards callbacks. The helper keeps the “AI source retry means generate” rule, while the success body still comes from the renderer injected by `src/features/index.ts`. Do not narrow the result mirror in core, leak `DictionaryQueryIntent` into core, or reimplement AI sense markup in the helper.

## Favorite presentation

`src/features/dictionary/obsidian/favoritePresentation.ts` owns the shared
`DictionaryFavoritePresentation` module. `feature.tsx` registers its lifetime and
connects the modal and sidebar adapters. Opening requests, sidebar close signals,
and settings refreshes cross this module's interface; adapters own mounting,
focus, and host operations. `DictionaryFavoriteController` remains the sole draft,
AI generation, and save authority.

- Modal and sidebar share one draft. Reopening the same word preserves edits;
  opening another word loads that word's favorite. The last opening request wins,
  including when sidebar activations finish out of order.
- Opening mode is read for each request. Settings refresh updates an open modal's
  language without moving the form. A sidebar must open successfully before the
  module closes the existing modal; failure preserves that modal and draft.
- Each sidebar registers a lease through the view's acquisition hook and releases
  it during teardown. Host leaf membership may still include an already closing
  view; the leases are the presentation authority. A modal reports dismissal when
  close starts; native animation completion only cleans its React root.
- Closing one surface preserves the draft while another remains. Closing the last
  surface resets the draft and cancels AI generation. Accepted saves finish, and
  their results and delayed native cleanup cannot affect a new draft.
- Successful saves close the modal, including saves initiated in a shared
  sidebar. Sidebars retain the result. Failed saves preserve the form for retry;
  existing-favorite loads and AI generation success keep the modal open.
- Test these sequences through the presentation interface with the real
  controller and controllable host/file adapters. Keep modal mounting and feature
  wiring tests separate from these shared behavior tests.

## Validation

```bash
pnpm test
pnpm run build
pnpm dictionary:engine   # only after changing crates/dictionary-engine/** or the WASM binding
```

- `pnpm run build` is the minimum validation after any code change.
- Keep focused pure-logic tests beside the module under `src/features/dictionary/domain/__tests__/`; the Vitest environment is `node`.
- Worker, WASM, sandbox, network, and import behaviour is not covered by unit tests: verify it manually and report what was actually exercised.
- After `pnpm dictionary:engine`, confirm the four committed artifacts under `src/features/dictionary/domain/engine/` changed as expected; a stale artifact is only caught by rebuilding and comparing, because the build stays Node-only.
- Read the migration design before changing formats, limits, source order, or the manual data-migration contract.
