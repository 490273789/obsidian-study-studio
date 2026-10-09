---
description: "Use when editing StudyStudio styles: SCSS under src/core/styles/, UI primitives under src/core/ui/primitives/, and CSS Modules under src/features/**/ui/, design tokens, spacing, surfaces, motion, and Obsidian theme compatibility. Covers the current token system and the generated styles.css artifact."
name: "Flashcard Styles"
applyTo: "src/**/*.scss"
---

# Flashcard stylesheet guidelines

- Edit global SCSS under `src/core/styles/`, UI primitives under `src/core/ui/primitives/` (and `src/features/flashcards/ui/primitives/`), and business views as CSS Modules (`src/features/**/ui/*.module.scss`). `src/core/styles/index.scss` is the single global entry imported by `src/core/host/main.ts`; Vite bundles it into root `styles.css`, which is never hand-edited.
- Business feature views must use `*.module.scss` and be imported directly in their TSX (`import styles from "./[Name].module.scss"`). Never `@use` feature view `*.module.scss` inside `src/core/styles/index.scss`.
- Keep the import order in `src/core/styles/index.scss`: base tokens and mixins, settings, layout, primitives, motion, then responsive overrides.
- Extend the current unified stylesheet instead of reviving removed legacy override blocks or parallel styling systems. Tokens are declared on `.flashcard-root`, `.flashcard-settings-tab`, and modal backdrops, scoping plugin styles away from the rest of Obsidian.
- Reuse the existing token hierarchy before adding new values: semantic surface tokens first (`--fc-surface-*`, `--fc-bg-*`, `--fc-text`, `--fc-muted`, `--fc-faint`), semantic action tokens second (`--fc-action-*`, `--fc-control-*`, `--fc-primary`, `--fc-danger`), and elevation/motion presets third (`--fc-shadow*`, `--fc-motion-*`, `--fc-ease-*`, `--fc-transition-*`).
- Keep new values on the existing scales: `--fc-font-2xs` (10px, kbd/micro badge), `--fc-font-xs/sm/md/lg/xl/display/hero/focus`, `--fc-weight-*`, `--fc-line-*`, `--fc-space-*`, `--fc-radius-*`, and `--fc-control-*`, instead of scattering raw values.
- Keep the Obsidian theme as the color source: prefer theme variables such as `--text-normal`, `--text-muted`, `--background-primary`, `--background-secondary`, and `--interactive-accent` over fixed light/dark palettes.
- Keep touch targets, keyboard focus (`fc-focus-ring`), reduced-motion behavior, responsive layouts, and light/dark contrast intact. Style-only changes need no new unit tests, but require `pnpm run build` and visual inspection in Obsidian when feasible.
