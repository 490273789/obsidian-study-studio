# Testing and Workflow Guide

Read this guide when changing code, choosing validation, touching generated/release files, deploying, or preparing a commit.

## Commands

Run commands from the repository root with pnpm — the only package manager this project uses, pinned through `packageManager` in `package.json`.

Use the Node.js version pinned in `.node-version`; CI and release builds read the same file. The local Vite Plus dependency supplies build, test, lint, and format tools, configured together in `vite.config.ts`. Keep the managed Vite alias/catalog entries in `pnpm-workspace.yaml` when updating Vite Plus.

```bash
pnpm install
pnpm run dev
pnpm test
pnpm run test:watch
pnpm run typecheck
pnpm run build
pnpm run lint
pnpm run lint:fix
pnpm run format:check
pnpm run format
pnpm run check
pnpm run check:all
pnpm run setup-hooks
```

- `pnpm run build` runs TypeScript checking and the production Vite bundle. It is the minimum validation after code changes.
- `pnpm run check` runs Vite Plus format, lint, and type checks without fixing files. `pnpm run check:all` adds independent `tsc` checking, module-boundary checks, the full Vitest suite, and commit-message tests.
- `pnpm run dev` runs `vp build --watch --mode development` for the Obsidian plugin. Use the pnpm scripts for composed workflows: bare `vp dev` starts a web server, and bare `vp build` or `vp test` omits the extra steps in the corresponding package script.
- `pnpm run deploy` builds and copies artifacts to the maintainer's configured iCloud vault. It is machine-specific; never run it unless the user explicitly asks to deploy.

## Editing and generated files

- Edit TypeScript/React under `src/` and CSS under `src/core/styles/`.
- Do not hand-edit generated root `main.js` or `styles.css`; regenerate them with `pnpm run build` when the task requires distributable artifacts.
- Change `manifest.json` and `versions.json` only for an intentional release/version task. Use `pnpm release:patch|minor|major` as documented; do not invoke the lifecycle script with `pnpm run version` directly.
- Preserve the local style: tabs in TypeScript, explicit interfaces/types, and named helpers where surrounding code uses them.
- Avoid dependency/lockfile churn unless dependency work is in scope.

## Validation matrix

Always run `pnpm run build` after code changes, then add checks based on risk:

| Change                                                                                                              | Required validation                                                       |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Parser, cards, identity, storage, sessions, scheduling, spelling, pronunciation, deck logic, or presentation models | Focused tests or `pnpm test`, plus `pnpm run build`                       |
| TypeScript/React patterns, Obsidian API usage, or shared modules                                                    | `pnpm run lint`                                                           |
| Broad edits or possible formatting changes                                                                          | `pnpm run format:check`                                                   |
| Pre-commit/full confidence pass                                                                                     | `pnpm run check:all` and `pnpm run build`                                 |
| Style-only                                                                                                          | `pnpm run build` plus visual inspection; no new test required             |
| Settings tab                                                                                                        | Build plus manual check that the pane is not blank when feasible          |
| Pronunciation                                                                                                       | Tests/build plus report the fallback path actually exercised              |
| PDF export                                                                                                          | Relevant tests/build plus report whether a real desktop PDF was inspected |

Keep focused tests in the affected module's `__tests__/` directory. Prefer pure logic tests and public deep-module interfaces. Add explicit mocks when React or Obsidian runtime behavior must be loaded.

Report every validation command run and any manual check that could not be performed.

## Commits and releases

Follow Conventional Commits and `docs/git-commit-guide.md`.

- Format: `<type>(<scope>): <subject>`.
- Keep commits atomic and subjects specific, imperative, and without a trailing period.
- Common types: `feat`, `fix`, `style`, `refactor`, `perf`, `test`, `docs`, `chore`, `revert`.
- Common scopes: `ui`, `styles`, `cards`, `parser`, `identity`, `session`, `pronunciation`, `deck`, `obsidian`, `settings`, `storage`, `history`, `word-list`, `i18n`, `deps`, `release`.
- Hooks configured by `scripts/setup-hooks.mjs` enforce pre-commit checks and commit-message format.
- `pnpm release:patch|minor|major` runs `scripts/version-bump.mjs` to keep `package.json`, `manifest.json`, and `versions.json` in sync, and creates the Conventional Commit-compatible release commit and tag. Do not add a redundant second release commit.
- Do not create a commit, bump a version, push, release, or deploy unless the user asks for that action.
