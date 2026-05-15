# umbrella.md 模板 (umbrella.md template — decomposition only / 仅拆分时使用)

Emit this file at `docs/specs/<topic>/umbrella.md` **only when** the A1.5 size gate trips and B0 decomposition runs. For non-decomposed specs, umbrella.md must not exist.
仅在 A1.5 size gate 触发、B0 拆分实际发生时，才生成 `docs/specs/<topic>/umbrella.md`。未拆分则不应存在此文件。

**Language rule / 语言规则**: section headers (`## Sub-specs`, `## Slicing axis`) and the axis names (`Walking Skeleton`, `By risk`, `Horizontal sweep`, `Branch by Abstraction`, `Vertical slice`) are global anchors and stay in English. **Prose explanations follow the user's conversation language.**

The `## Slicing axis` value MUST be one of the five axes in `SKILL.md` §Decomposition decision tree (Walking Skeleton / By risk / Horizontal sweep / Branch by Abstraction / Vertical slice). Spec stage's axis choice carries forward into `incremental-impl`'s Step 2 by the same name — do not invent new axis names here.
`## Slicing axis` 的取值必须来自 `SKILL.md` §Decomposition decision tree 五选一；spec 阶段定的轴名 `incremental-impl` Step 2 会直接沿用，不可自创新轴。

The umbrella alone should give a complete overview without opening any sub-spec. If a reader has to open a sub-spec to understand the overall scope, the umbrella is failing its job.
打开 umbrella 一个文件就应该看清总体范围；如果还得翻子 spec 才看得懂，说明 umbrella 失职。

## Template / 模板

```markdown
# <feature> — umbrella (<功能> — 拆分总览)

## Sub-specs (子规范)
| Order (顺序) | Sub-spec (子规范) | Key VAL range (关键 VAL 区间) | Status (状态) |
|---|---|---|---|
| 1 | `docs/specs/<feature-1>/` | VAL-X-001..NNN | spec / impl / merged |

## Slicing axis (拆分轴)
<Walking Skeleton / By risk / Horizontal sweep / Branch by Abstraction / Vertical slice>. Why this axis fits.
<为何选这条轴。>
```
