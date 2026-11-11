# Domain Docs

Configured layout: **single-context**.

Engineering skills should read this repo's domain documentation before architecture, debugging, or TDD work when it is relevant.

## Before exploring, read these

- `GLOSSARY.md` at the repo root
- `docs/adr/` for architectural decisions that touch the area being changed

`GLOSSARY.md` is the single source of domain terminology. Keep module ownership and implementation details in the relevant area guide; use ADRs for architectural decisions and their rationale.

## File structure

```text
/
|-- GLOSSARY.md
|-- docs/adr/
`-- src/
```

## Use the glossary's vocabulary

When output names a domain concept, use the term as defined in `GLOSSARY.md`.

If the concept is missing, either reconsider the wording or note the gap for `/domain-modeling`.

## Flag ADR conflicts

If output contradicts an existing ADR, surface that explicitly instead of silently overriding it.
