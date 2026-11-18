---
description: "Use when editing the Obsidian flashcard plugin source, including TypeScript, TSX, React components, data store logic, parser, scheduler, settings tab, or plugin lifecycle code under src/. Covers repo-specific structure and validation expectations."
name: "Obsidian Plugin Source"
applyTo: "src/**"
---

# Obsidian plugin source guidelines

- Keep `src/core/host/main.ts` focused on plugin lifecycle, shared services, and settings wiring. Register feature views and commands through the workbench host. Move feature logic into focused modules under `src/` instead of growing the composition root.
- Edit source files under `src/` and do not hand-edit generated release artifacts such as `main.js`.
- Preserve Obsidian plugin conventions: keep command IDs stable, use the provided lifecycle registration helpers for anything that needs cleanup, and keep startup work in `onload` lightweight.
- Prefer small, module-local changes that fit the existing boundaries: persistence ownership as documented in `docs/agents/module-ownership.md`, parsing in `src/features/flashcards/domain/cards/parser.ts`, scheduling in `src/features/flashcards/domain/sessions/scheduler.ts`, and UI behavior in the React and view files.
- When changing persisted data or plugin compatibility, keep `manifest.json` and `versions.json` aligned with the actual minimum Obsidian version required by the code.
- Validate code changes with `pnpm run lint` and `pnpm run build`. If sandboxed terminal runs cannot find `node`, rerun those validations unsandboxed.
