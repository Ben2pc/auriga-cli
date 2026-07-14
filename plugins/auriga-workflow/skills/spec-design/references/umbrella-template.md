# umbrella.md 模板（仅拆分时使用）

仅在 A1.5 size gate 触发、B0 拆分实际发生时才生成。默认路径是 `docs/specs/<topic>/umbrella.md`；若用户明确批准跨多个 PR 的长期生命周期，则总览改放 `docs/long-running-specs/<topic>/umbrella.md`。未拆分则不应存在此文件。

**语言规则**：section 标题里的英文锚点（`## Sub-specs`、`## Slicing axis`）和轴名（`Walking Skeleton`、`By risk`、`Horizontal sweep`、`Branch by Abstraction`、`Vertical slice`）保持英文不动。**散文解释跟随用户的对话语言。**

`## Slicing axis` 的取值必须来自 `SKILL.md` §拆分决策树 五选一；spec 阶段定的轴名 `incremental-impl` Step 2 会直接沿用，不可自创新轴。

打开 umbrella 一个文件就应该看清总体范围；如果还得翻子 spec 才看得懂，说明 umbrella 失职。

## 模板

```markdown
# <feature> — umbrella (<功能> — 拆分总览)

## Sub-specs (子规范)
| Order (顺序) | Sub-spec (子规范) | Key VAL range (关键 VAL 区间) | Status (状态) |
|---|---|---|---|
| 1 | `docs/specs/<feature-1>/` | VAL-X-001..NNN | spec / impl / merged |

## Parent coverage map (父级验收覆盖映射)
| Parent VAL (父级验收项) | Child spec (子规范) | Child VAL (子验收项) | Status (状态) |
|---|---|---|---|
| VAL-PARENT-001 | `docs/specs/<feature-1>/validation-contract.md` | VAL-CHILD-001 | planned / passed / not run / out of scope |

## Slicing axis (拆分轴)
<Walking Skeleton / By risk / Horizontal sweep / Branch by Abstraction / Vertical slice>。<为何选这条轴。>
```
