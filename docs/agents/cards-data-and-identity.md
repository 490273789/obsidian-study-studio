# Cards, Data, and Identity Guide

Read this guide before changing Markdown card syntax, parsing, indexing, card source edits, persistence, migrations, or stable identities.

## Source and persistence authority

- The user's Markdown notes are authoritative for card content.
- `WorkbenchStore` owns atomic disk serialization for `data.json` and settings slices, while `FlashcardRepository` owns persisted learning state and the local deck-index cache. `data.json` contains settings, FSRS state keyed by stable card identity, study history, spelling progress, deck statistics, and card-identity continuity state. It must not contain card front/back/explanation text, parsed tags, or a full derived deck index.
- `cache/deck-index.json` is local-only and may contain parsed card text, tags, source locations, and source snapshots. It is not Sync-tracked and must always be recoverable by scanning Markdown sources.
- Persist settings through `WorkbenchStore.saveSettings()`, and learning state through `FlashcardRepository` session/continuity adapters. `FlashcardRepository` owns the semantic persistence choreography through its `FlashcardAuthority` seam: callers never name the `learning` partition, raw document variants, or cache ordering. Do not add independent plugin-data writes; WorkbenchStore's write queue still owns disk serialization and external Sync reloads.
- Preserve backward-compatible normalization in `loadSettings()`, including legacy `flashcardTag` to `flashcardTags` migration.
- Preserve FSRS card state when reparsing or rebuilding a deck index.

## Card format and indexing

`src/features/flashcards/domain/cards/parser.ts` and `src/features/flashcards/domain/cards/cardFormat.ts` define the format:

- The first hashtag in a Markdown file identifies its deck tag; matching supports Chinese characters and is case-insensitive against configured tags.
- `??` on its own line separates front and back.
- Optional explanation begins after `::` on its own line.
- `;;` on its own line ends a card.
- A stable identity marker immediately before the front is `<!-- wsr-card-id: <uuid> -->`.
- Legacy cards without a marker may still parse with `${filePath}::${index}`, but continuity workflows must not treat that positional ID as a stable migrated identity.

Vault scanning reads file snapshots in the Obsidian adapter and delegates synchronization, tag discovery, and deck index construction to `src/features/flashcards/domain/identity/cardIdentityContinuity.ts`. Keep file I/O out of the pure parser. Per-file failures must not prevent unaffected sources from being indexed.

## Stable identity and source edits

- A vault-wide UUID carries card identity and learning state across content edits, reorder, and moves between decks.
- Never copy marker syntax into feature code. Use `src/features/flashcards/domain/cards/cardFormat.ts` and `src/features/flashcards/domain/cards/deckSourceEditor.ts`.
- Route plugin-initiated card add/edit/delete actions through `CardIdentityContinuity.change()` and pre-check editability via `CardIdentityContinuity.prepareEdit()`; card syntax and reserved-marker validations belong authoritatively to the domain layer. Do not mutate Markdown and then patch persisted cards separately.
- Synchronization, explicit legacy migration, duplicate repair, ambiguous successor resolution, resumable journals, and session reconciliation belong to `src/features/flashcards/domain/identity/cardIdentityContinuity.ts`.
- Do not guess identity successors from content similarity or position. Conflicts and ambiguities require the existing explicit repair workflow.
- Affected sources retain their last-known-good deck state until repair completes. Preserve fresh-content checks, per-source atomic writes, single-writer behavior, and resumable recovery.
- Pronunciation secret values never belong in persisted plugin data. Only `SecretStorage` IDs may appear in settings.

## High-risk files and tests

Treat these files as compatibility boundaries:

- `src/core/storage/dataStore.ts`
- `src/features/flashcards/domain/cards/parser.ts`
- `src/features/flashcards/domain/cards/cardFormat.ts`
- `src/features/flashcards/domain/cards/deckSourceEditor.ts`
- `src/features/flashcards/domain/identity/cardIdentityContinuity.ts`
- `src/features/flashcards/obsidian/continuityAdapters.ts`

Add or update focused tests under `src/features/flashcards/domain/cards/__tests__/`, `src/core/storage/__tests__/`, `src/features/flashcards/domain/identity/__tests__/`, and `src/core/host/__tests__/` as applicable. Test final Markdown, identity/state preservation, recovery behavior, and unaffected-source behavior—not only helper return values.
