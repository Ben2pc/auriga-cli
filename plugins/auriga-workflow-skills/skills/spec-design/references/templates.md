# spec-design — File Templates

Pulled out of `SKILL.md` per progressive-disclosure: large reference content lives beside the skill, not inline. The skill reads / cites these templates when entering Phase C.

VAL numbering convention applies across all VAL files: `VAL-<CATEGORY>-<NNN>`. `CATEGORY` is a 3–5 letter uppercase tag (`WORK` / `DEP` / `UI` / `CLI` / …). `NNN` is zero-padded. Reuse a category across many VALs when they share a domain.

---

## spec.md template

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

---

## validation-contract.md template

```markdown
# Validation Contract — <feature>

> Pairs with spec.md. spec.md = why+what; this file = how-to-judge-pass.
> Each VAL describes Behavior + Tool + Evidence only. Test design (function organization, fixtures, mocks) is `test-designer`'s job.

## Coverage map
| Range | VAL ids |
|---|---|
| <subject> | VAL-<CAT>-NNN ~ NNN |

## Assertions

### VAL-CAT-001
- **Behavior**: <one sentence; external-observable, single-meaning>
- **Tool**: <one entry from the tool vocabulary in SKILL.md §Tool vocabulary>
- **Evidence**: <what counts as a pass — exit code / regex / file existence / screenshot diff>
```

---

## umbrella.md template (decomposition only)

```markdown
# <feature> — umbrella

## Sub-specs
| Order | Sub-spec | Key VAL range | Status |
|---|---|---|---|
| 1 | `docs/specs/<feature-1>/` | VAL-X-001..NNN | spec / impl / merged |

## Slicing axis
<Walking Skeleton / By risk / Horizontal sweep / Branch by Abstraction / Vertical slice>. Why this axis fits.
```

---

## Notes on use

- Copy the relevant template into `docs/specs/<topic>/<file>.md` and replace each `<placeholder>`.
- Do not strip optional sections (`References`, `Findings` when sparse) — leave a one-line "none" if genuinely absent so future readers don't wonder whether the section was simply forgotten.
- For VAL ids in `validation-contract.md`, do not skip numbers (`VAL-WORK-001`, `VAL-WORK-002`, `VAL-WORK-004` is a bug — gaps imply deleted assertions and break grep-based traceability).
