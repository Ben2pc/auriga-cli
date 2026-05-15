# umbrella.md template (decomposition only)

Emit this file at `docs/specs/<topic>/umbrella.md` **only when** the A1.5 size gate trips and B0 decomposition runs. For non-decomposed specs, umbrella.md must not exist.

The `## Slicing axis` value MUST be one of the five axes in `SKILL.md` §Decomposition decision tree (Walking Skeleton / By risk / Horizontal sweep / Branch by Abstraction / Vertical slice). Spec stage's axis choice carries forward into `incremental-impl`'s Step 2 by the same name — do not invent new axis names here.

The umbrella alone should give a complete overview without opening any sub-spec. If a reader has to open a sub-spec to understand the overall scope, the umbrella is failing its job.

## Template

```markdown
# <feature> — umbrella

## Sub-specs
| Order | Sub-spec | Key VAL range | Status |
|---|---|---|---|
| 1 | `docs/specs/<feature-1>/` | VAL-X-001..NNN | spec / impl / merged |

## Slicing axis
<Walking Skeleton / By risk / Horizontal sweep / Branch by Abstraction / Vertical slice>. Why this axis fits.
```
