# Study Studio Agent Guide

## What this repository is

`StudyStudio` — an Obsidian flashcard plugin for Chinese-first learning.

- Hand-written source lives under `src/`. Root `main.js` and `styles.css` are generated from it — edit the source, never the artifact.
- Markdown notes are the authority for card content. Plugin data holds derived decks, learning state, settings, history, and continuity metadata.

## Working rules

- Reply in Chinese unless the user requests another language.
- Use Obsidian APIs for vault, view, settings, notices, secrets, requests, and Markdown rendering; do not replace them with browser-only assumptions.
- Use targeted searches or bounded reads for large generated and data artifacts such as `data.json` and `main.js`; never read them in full.
- Do not create a commit, bump a version, push, release, or deploy unless the user asks for that action.

## Task guides

Before changing behavior, read only the matching guides under `docs/agents/` for each affected area. Follow further references as needed.

- Lifecycle, ownership, cross-module changes → `architecture.md`; consult relevant `docs/adr/` decisions.
- Card syntax, parsing, source edits/deletion, persistence, migration, identity → `cards-data-and-identity.md`.
- Study, practice, spelling, scheduling, results, undo, answer transitions → `sessions.md`. The persistence guide loads on a matching Claude Read or a trusted Codex hook for a full, direct `cat src/features/flashcards/domain/sessions/sessionPersistence.ts` from the repo root. Use the guide directly for other reads.
- Pronunciation, autoplay, providers, secrets, audio cache → `pronunciation.md`.
- Listening practice, material editing, subtitles, transcription → `audio-practice.md`.
- Video playback, focus, shortcuts, floating player, queue → `video-player.md`.
- React UI, deck home, Obsidian views/settings, localization, modals, CSS → `ui-and-obsidian.md`.
- Desktop deck PDF export → `pdf-export.md`.
- Code changes, commands, validation, generated files, commits, releases, deployment → `testing-and-workflow.md`.
- Domain terms, architecture, debugging, TDD, ADR changes → `domain.md`, then root `GLOSSARY.md` and relevant ADRs.
- Dictionary lookup, local dictionaries, sources, sandbox rendering → `dictionary.md`.
- GitHub issues → `issue-tracker.md`; triage also uses `triage-labels.md`.

For library, framework, SDK, API (including Obsidian), CLI, or cloud-service questions, always consult Context7 first, including for syntax, configuration, migration, setup, usage, and debugging.
