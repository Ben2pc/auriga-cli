# `umbrella.md` 模板

仅当需求确实拆成多个可独立确认、独立验收且不会误导总体目标的完整用户结果时使用。模块数、文件数、代码行数和实施手法不是创建本文件的理由。

默认写入 `docs/specs/<topic>/umbrella.md`。只有用户明确确认工作跨多个 PR 并采用长期生命周期时，总览才写入 `docs/long-running-specs/<topic>/umbrella.md`；当前子 PR 仍维护自己的 `docs/specs/<child-topic>/` 契约。

`incremental-impl` 消费已确认的子规范与依赖，再把每项需求改动拆成完整实施单元；本模板不预先规定实施切片。

```markdown
# <主题> — Umbrella（<主题> — 总规范）

## Goal and Scope (目标与总体范围)

<说明共同目标、整体用户结果和不能被子规范分别改变的约束。>

## Sub-specs (子规范)

| Order (顺序) | User outcome (完整用户结果) | Sub-spec (子规范) | Key VAL range (关键 VAL) | Status (状态) |
|---|---|---|---|---|
| 1 | <可独立确认和验收的结果> | `docs/specs/<child-topic>/` | VAL-CHILD-001..NNN | spec / impl / merged |

## Parent coverage map (父级验收覆盖映射)

| Parent VAL (父级验收项) | Child spec (子规范) | Child VAL (子验收项) | Status (状态) |
|---|---|---|---|
| VAL-PARENT-001 | `docs/specs/<child-topic>/validation-contract.md` | VAL-CHILD-001 | planned / passed / not run / out of scope |

子 PR Ready 时，如果子规范归档到 `docs/worklog/` 或晋升为稳定文档，必须同步更新本表链接，不能保留失效的开发期路径。

## Dependencies and Boundaries (依赖与边界)

<只写用户结果之间真实存在的依赖、共享约束和各子规范明确不负责的范围；不写实施步骤或 Agent 分发。>
```
