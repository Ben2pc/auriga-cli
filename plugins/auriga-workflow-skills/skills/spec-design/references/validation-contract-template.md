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
- `Tool` field must come from the category vocabulary in `SKILL.md` §Tool vocabulary (`unit-test` / `integration-test` / `e2e-browser` / `e2e-mobile` / `e2e-cli` / `http-probe` / `repo-check` / `git-state` / `gh-state` / `lint` / `build` / `manual`). Do not name specific tools.
  `Tool` 字段必须来自 `SKILL.md` §Tool vocabulary 的类别词表；不写具体工具名。

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

## Assertions (断言)

### VAL-CAT-001
- **Behavior (行为)**: <one sentence; external-observable, single-meaning / 一句话；外部可观察；单一含义>
- **Tool (工具)**: <one entry from the tool vocabulary in SKILL.md §Tool vocabulary / 从 SKILL.md 工具词表选一项>
- **Evidence (判据)**: <what counts as a pass — exit code / regex / file existence / screenshot diff / 什么算通过——退出码 / 正则 / 文件存在 / 截图差分>
```
