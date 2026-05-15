# spec.md template

Copy this template into `docs/specs/<topic>/spec.md` and replace each `<placeholder>`. Pairs with `validation-contract-template.md` (and `umbrella-template.md` when decomposition triggers).

Do not strip optional sections (`References`, `Findings` when sparse) — leave a one-line "none" if genuinely absent so future readers don't wonder whether the section was simply forgotten.

```markdown
# <feature> — Spec

> One-sentence elevator pitch (optional but recommended).

## Why
<1–4 paragraphs: motivation, pain we're addressing, the inspiration / prior art if any.>

## Findings
<Bulleted past-facing observations from A1 research. Each bullet anchors to a specific source: file path, commit, doc, external URL.>

## What
<The external behavior contract. May be multiple subsections (### 1. …, ### 2. …) when the surface is broader than one cohesive concept. Stay above the implementation line.>

## Out of scope
<Explicit "this spec is not doing X / Y" list, with brief reason where useful.>

## Open questions
<What this spec leaves for plan / impl phase to resolve. Numbered list.>

## References  (optional — required when any URL was supplied during clarification)
<Bulleted external links + when they were supplied + their relevance to the design.>
```
