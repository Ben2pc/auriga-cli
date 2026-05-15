# validation-contract.md 模板 (validation-contract.md template)

Copy this template into `docs/specs/<topic>/validation-contract.md` and replace each `<placeholder>`. Pairs with `spec-template.md`.
将本模板复制到 `docs/specs/<topic>/validation-contract.md` 并填充每个 `<占位>`。与 `spec-template.md` 配套使用。

**Language rule / 语言规则**: structural keywords (`VAL-XXX-NNN`, `Behavior`, `Tool`, `Evidence`, the Tool category names) are global anchors and must stay in English — `test-designer` and `deep-review`'s `spec-conformance` reviewer grep them as-is. **The Behavior description and Evidence prose follow the user's conversation language.** Chinese conversation → write Behavior / Evidence in Chinese; English conversation → English. Do not mix.

## Conventions / 约定

- VAL numbering / VAL 编号: `VAL-<CATEGORY>-<NNN>`. `CATEGORY` is a 3–5 letter uppercase tag (`WORK` / `DEP` / `UI` / `CLI` / …). `NNN` is zero-padded.
  `CATEGORY` 用 3–5 字母大写词；`NNN` 三位零填充。
- Reuse a category across many VALs when they share a domain. / 多条 VAL 共享同一领域时复用同一 `CATEGORY`。
- Do not skip numbers (`VAL-WORK-001`, `VAL-WORK-002`, `VAL-WORK-004` is a bug — gaps imply deleted assertions and break grep-based traceability).
  编号不可跳号——跳号意味着删除过 VAL，会破坏 grep 追溯。
- Each VAL says only **what counts as a pass** (Behavior / Tool / Evidence) — never **how to test it** (fixture organization, mocks, test-function structure are `test-designer`'s job).
  每条 VAL 只说"什么算通过" (Behavior / Tool / Evidence)，不说"怎么测" (fixture / mock / 测试函数结构是 `test-designer` 的活)。
- `Tool` field must come from the category vocabulary in `SKILL.md` §Tool vocabulary (`unit-test` / `integration-test` / `e2e-browser` / `e2e-mobile` / `e2e-cli` / `http-probe` / `repo-check` / `git-state` / `gh-state` / `lint` / `build` / `manual`). Do not name a specific tool in the per-VAL `Tool` field — that keeps each VAL grep-able and implementation-agnostic.
  `Tool` 字段必须来自 `SKILL.md` §Tool vocabulary 的类别词表；单条 VAL 的 `Tool` 字段不写具体工具名，以保持可 grep、不锁实现。
- The repo's **concrete** tool per category — gathered during A1 research — is recorded **once** in the `## Toolchain` table below, never repeated per VAL. This carries the A1 toolchain finding forward so `test-designer` does not re-discover the stack. Only fill rows for categories this contract's VALs actually use.
  每个类别对应的**具体**工具（A1 调研所得）只在下方 `## Toolchain` 表里记**一次**，不在每条 VAL 重复。它把 A1 的验证栈调研结论带给下游，`test-designer` 无需重新调研。只填本契约 VAL 实际用到的类别。

## Template / 模板

```markdown
# Validation Contract — <feature> (验收契约 — <功能>)

> Pairs with spec.md. spec.md = why+what; this file = how-to-judge-pass.
> 与 spec.md 配套：spec.md 描述 why+what；本文件描述 "什么算通过"。
> Each VAL describes Behavior + Tool + Evidence only. Test design (function organization, fixtures, mocks) is `test-designer`'s job.
> 每条 VAL 只描述 Behavior + Tool + Evidence；测试设计 (函数组织 / fixture / mock) 是 `test-designer` 的活。

## Coverage map (覆盖矩阵)
| Range (范围) | VAL ids |
|---|---|
| <subject / 主题> | VAL-<CAT>-NNN ~ NNN |

## Toolchain (本仓库验证栈)
> A1 调研所得的既成事实，不是本次功能的实现决策。只填本契约 VAL 实际用到的类别；test-designer 据此免去重新调研测试栈。
> Facts gathered in A1 — the repo's existing harness, not a design decision for this feature. List only the categories this contract's VALs use; `test-designer` reads this instead of re-discovering the stack.

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| <a category used by the VALs below / 下方 VAL 用到的某个类别> | <e.g. `node:test` / `Playwright` / `npm run build` + `tsc --noEmit`> |

## Assertions (断言)

### VAL-CAT-001
- **Behavior (行为)**: <one sentence; external-observable, single-meaning / 一句话；外部可观察；单一含义>
- **Tool (工具)**: <one entry from the tool vocabulary in SKILL.md §Tool vocabulary / 从 SKILL.md 工具词表选一项>
- **Evidence (判据)**: <what counts as a pass — exit code / regex / file existence / screenshot diff / 什么算通过——退出码 / 正则 / 文件存在 / 截图差分>
```
