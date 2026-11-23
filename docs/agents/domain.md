# Domain docs

## Layout

This is a multi-context repository:

- `GLOSSARY-MAP.md` at the root maps concepts to workspace glossaries.
- API: `apps/api/GLOSSARY.md`; context ADRs: `apps/api/docs/adr/`.
- Web: `apps/web/GLOSSARY.md`; context ADRs: `apps/web/docs/adr/`.
- Shared types: `packages/types/GLOSSARY.md`; context ADRs: `packages/types/docs/adr/`.
- System-wide ADRs: `docs/adr/`.

## Before exploring

Read `GLOSSARY-MAP.md`, then the glossary for the affected context. Read relevant system-wide and context ADRs. If a file or directory does not exist, proceed without treating its absence as a blocker; domain docs can be added when terminology or decisions are resolved.

## Vocabulary and decisions

Use glossary terms in issues, proposals, and tests. If a change conflicts with an ADR, surface the conflict rather than silently overriding it.
