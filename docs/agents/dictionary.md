# Dictionary Guide

Read this guide before changing anything under `src/features/dictionary/domain/**`, the dictionary views/settings, or the compiled-v2 package contract. This is a security- and data-boundary-sensitive area; when the change touches packages, sources, or sandboxing.

## Source and boundary invariants

- Online sources (Youdao, Cambridge, Hujiang, AI) send only the explicit query. Each keeps its own timeout, size bound, and failure; Youdao official and free modes are explicit and must never silently fall back to one another.
- AI definitions are opt-in per query and use the shared AI engine configuration selected by `settings.dictionary.ai.configId`. Ordinary lookups must not trigger an AI request.
- Favourites write to the Markdown file at `settings.dictionary.favoritePath` only after an explicit save. Persist the path setting first, then write the file; path suggestions may inspect existing Markdown paths but must not become a general content scan.
- Desktop import may read user-selected MDX/MDD/CSS/JS/EUDIC files outside the vault. It compiles a package under the plugin's `dictionaries/{id}/compiled-v2/` directory and never copies the originals into the plugin folder. Mobile may only query fully synchronized compiled packages; it never compiles originals.
- The Eudic image loader uses the outbound port's single host-pinned request mode. Keep its fixed host and no-prefetch/no-persistent-cache behaviour in the feature; `credentials: 'omit'`, `redirect: 'error'`, MIME/size/timeout checks belong to the port implementation because `requestUrl` cannot express the redirect policy.
- Every untrusted definition, HTML, CSS, script, URL, audio, image, resource path, and `dic://`/`eures://` navigation goes through `sandbox-document/`. Keep the opaque-origin iframe without `allow-same-origin`, the versioned postMessage protocol, the random document identity, and the `event.source` checks.
- The sandbox host owns navigation and seeds the current theme plus `color-scheme` into `srcdoc` before each entry loads. Theme changes update the existing document over the validated message channel; do not rely on a post-load message for the initial theme (it causes a white flash in dark mode).
- Keep lazy worker/WASM initialization, bounded response and memory sizes, checksum verification, path containment, decompression limits, concurrent-read coalescing, and LRU budgets.

## Compiled package architecture

- `src/features/dictionary/domain/compiled-package/` is the sole authority for compiled-v2 format/version, manifests, limits, checksums, safe paths, publication, compatibility, and verified reads. Compilers produce its required candidates; workers receive opaque plans and verified bytes; sources must not reimplement manifest parsing or package caches.
- The local dictionary catalog is authoritative for source identity, membership, order, and whole-dictionary transactions, and must agree with package facts. Never silently repair conflicts from disk; import, cancellation, failure, and settings-save rollback must leave existing sources intact and clean staging output.
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
