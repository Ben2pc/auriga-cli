# validation-contract.md template

Copy this template into `docs/specs/<topic>/validation-contract.md` and replace each `<placeholder>`. Pairs with `spec-template.md`.

## Conventions

- VAL numbering: `VAL-<CATEGORY>-<NNN>`. `CATEGORY` is a 3–5 letter uppercase tag (`WORK` / `DEP` / `UI` / `CLI` / …). `NNN` is zero-padded.
- Reuse a category across many VALs when they share a domain.
- Do not skip numbers (`VAL-WORK-001`, `VAL-WORK-002`, `VAL-WORK-004` is a bug — gaps imply deleted assertions and break grep-based traceability).
- Each VAL says only **what counts as a pass** (Behavior / Tool / Evidence) — never **how to test it** (fixture organization, mocks, test-function structure are `test-designer`'s job).
- `Tool` field must come from the category vocabulary in `SKILL.md` §Tool vocabulary (`unit-test` / `integration-test` / `e2e-browser` / `e2e-mobile` / `e2e-cli` / `http-probe` / `repo-check` / `git-state` / `gh-state` / `lint` / `build` / `manual`). Do not name specific tools.

## Template

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
