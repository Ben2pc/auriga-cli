# validation-contract.md 模板

默认将本模板复制到 `docs/specs/<topic>/validation-contract.md`。仅当用户明确批准跨多个 PR 的长期生命周期时，总规范的全局验收契约才复制到 `docs/long-running-specs/<topic>/validation-contract.md`；当前子 PR 的独立验收契约仍使用 `docs/specs/`。填充每个 `<占位>`，并与 `spec-template.md` 配套使用。

**语言规则**：结构关键字（`VAL-XXX-NNN`、`Behavior`、`Tool`、`Evidence`、Tool 类别名）是全局锚点，必须保持英文——下游技能和 `deep-review` 的 `spec-conformance` 审查者会原样 grep 它们。**Behavior 描述和 Evidence 散文跟随用户的对话语言。** 中文对话→Behavior / Evidence 写中文；英文对话→英文。不要混写。

## 约定

- VAL 编号：`VAL-<CATEGORY>-<NNN>`。`CATEGORY` 用 3–5 个字母的大写词；`NNN` 三位零填充。
- 多条 VAL 共享同一领域时，复用同一 `CATEGORY`。
- 不要跳号（`VAL-WORK-001`、`VAL-WORK-002`、`VAL-WORK-004` 是 bug——跳号意味着删除过 VAL，会破坏基于 grep 的可追溯性）。
- 每条 VAL 只说"什么算通过"（Behavior / Tool / Evidence），不说"怎么测"（fixture / mock / 测试函数结构由测试驱动开发阶段决定）。
- `Tool` 字段必须来自 `SKILL.md` §工具词汇表 的类别词表（`unit-test` / `integration-test` / `e2e-browser` / `e2e-mobile` / `e2e-cli` / `http-probe` / `repo-check` / `git-state` / `gh-state` / `lint` / `build` / `manual`）。单条 VAL 的 `Tool` 字段不写具体工具名，以保持可 grep、不锁实现。
- 每个类别对应的**具体**工具（A1 调研所得）只在下方 `## Toolchain` 表里记**一次**，不在每条 VAL 重复。它把 A1 的验证栈调研结论带给下游，避免重新推断该用哪个测试运行器 / 驱动。只填本契约 VAL 实际用到的类别。
- 若某类别在仓库中尚无现成工具，那是一个真正的 plan 阶段决策——记入 `spec.md` 的 Open questions 一节，不要在此猜测。

## 模板

```markdown
# Validation Contract — <feature> (验收契约 — <功能>)

> 与 spec.md 配套：spec.md 描述 why+what；本文件描述"什么算通过"。
> 每条 VAL 只描述 Behavior + Tool + Evidence；测试设计 (函数组织 / fixture / mock) 由测试驱动开发阶段决定。

## Coverage map (覆盖矩阵)
| Range (范围) | VAL ids |
|---|---|
| <主题> | VAL-<CAT>-NNN ~ NNN |

## Toolchain (本仓库验证栈)
> A1 调研所得的既成事实，不是本次功能的实现决策。只填本契约 VAL 实际用到的类别，避免后续阶段重新推断该用哪个运行器 / 驱动。

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| <某个 Tool 类别，例 `unit-test`> | <本仓库对应的工具，例 `node:test`> |
| <例 `e2e-browser`> | <例 `Playwright`> |

## Assertions (断言)

### VAL-CAT-001
- **Behavior (行为)**: <一句话；外部可观察；单一含义>
- **Tool (工具)**: <从 SKILL.md §工具词汇表 选一项>
- **Evidence (判据)**: <什么算通过——退出码 / 正则 / 文件存在 / 截图差分>
```
