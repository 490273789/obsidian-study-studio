# Deck PDF Export Guide

Read this guide before changing deck PDF content, rendering, file naming, Electron integration, progress, or cleanup.

- Keep printable-DOM assembly, print styling, and row/content/file-name derivation in `src/features/flashcards/domain/decks/deckPdfViewModel.ts`.
- Keep Electron capability detection, background-window creation, save dialogs, and temp-directory plumbing in `src/features/flashcards/domain/decks/deckPdfDesktopRuntime.ts`. `src/features/flashcards/domain/decks/deckPdfExporter.ts` orchestrates through the injected `DesktopPdfRuntime` and keeps Obsidian Markdown rendering, progress reporting, and temporary-file cleanup.
- PDF export is desktop-only even though the plugin itself supports mobile. Preserve runtime capability checks and user-facing rejection on mobile.
- Avoid top-level Electron or Node imports that could break plugin loading on mobile.
- Render card content with Obsidian `MarkdownRenderer`; do not inject raw card HTML.
- Preserve batched rendering and progress callbacks for large decks.
- `DeckHome` owns single-flight export activity and captures an immutable deck snapshot at export start. Do not move export activity back into React-local state.
- Preserve save cancellation semantics and cleanup for success, cancellation, and failure.

Add or update focused tests under `src/features/flashcards/domain/decks/__tests__/`, especially for the pure view model and capability/error behavior. Run the relevant tests and `pnpm run build`, and state whether a real desktop PDF was manually exported and inspected.
