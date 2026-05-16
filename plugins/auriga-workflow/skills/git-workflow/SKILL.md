---
name: git-workflow
description: 指导 branch、commit、PR 和 git 历史整理的完整生命周期。当 agent 要创建 branch、编写 commit message、打开或更新 PR、处理 PR Ready 后反馈，或执行 rebase / squash / amend 时使用。
---

# git-workflow：git 生命周期工作流 / Git Lifecycle Workflow

这是 auriga workflow 对 git 生命周期要求的分阶段参考。每个阶段说明要做什么、精确命令，以及必须遵守的约束。同一 plugin 中的 hooks 会用机制强制执行其中一部分规则；这个 skill 覆盖 hooks 无法覆盖的部分。

## 何时使用 / When to Use

- 为新工作创建 branch（任何会产生代码或内容变更的任务）
- 判断现在是否应该 commit，还是继续工作
- 编写 commit message
- 在打开 PR 前清理 branch history
- 创建 PR（Draft 或 Ready）
- PR Ready 后处理 review 反馈

## 何时不要使用 / When NOT to Use

- 与 commit / branch / PR 语义无关的普通 shell 操作（文件操作、构建命令等）
- 只为调试检查 git history 时；直接使用 `git log` / `git bisect`

---

## 阶段 1：创建 branch（改代码前）/ Phase 1: Branch creation

- 不要直接 commit 到 `main`。所有工作都应放在 feature branch 上。
- 从 `origin/main` 当前 tip 创建 branch：

```bash
git fetch origin main --quiet
git switch -c <branch-name> origin/main
```

### 并行隔离：git worktree / Parallel isolation: git worktree

多个 agent 或任务并行运行时，给每个任务单独分配 worktree。始终传入显式 base ref（例如 `origin/main`）；如果不传，新 branch 会从当前 `HEAD` 切出，而当前 `HEAD` 可能已经在另一个 feature branch 上：

```bash
git worktree add -b <branch-name> ../<task-dir> origin/main
git worktree list
git worktree remove ../<task-dir>
```

---

## 阶段 2：开发中的 commits / Phase 2: Commits during development

### atomic commit 纪律 / Atomic commit discipline

每个 commit 必须：

- 表达一个逻辑变更
- 在该历史点能够 build，并通过 tests
- 不把 refactoring 和 feature work 混在一起
- 不把无关 modules 的变更混在一起

拆分示例（一个 feature，四个 commits）：

```
feat(auth): add RefreshToken domain model and repository interface
feat(auth): implement JWT refresh token issuance in AuthService
feat(auth): expose POST /auth/refresh endpoint
test(auth): add unit tests for refresh token rotation logic
```

### commit message 格式 / Commit message format

```
<type>(<scope>): <summary>

<body: motivation, key design decisions, known limitations>
```

- `type` 遵循 Conventional Commits；接受的类型包括：`feat` / `fix` / `docs` / `refactor` / `chore` / `test` / `perf` / `style` / `build` / `ci` / `revert`。`pr-create-guard` 会用同一列表检查 PR title（见阶段 5）
- `scope` 可选（括号内可以是任何非 `)` 字符，例如 `feat(api): ...` 或 `fix(deep/scope): ...`）
- 冒号前可选的 `!` 表示 breaking change：`feat!: ...` 或 `feat(api)!: ...`
- body 是自然语言段落；解释 **why**，不要复述 what（diff 已经展示 what）
- Task ID（Jira / Linear）可以写在 body 或 PR 描述里

### checkpoint commits / Checkpoint commits

按语义单元（semantic units）触发，而不是按时间触发。完成了一件可以用一句话描述的事情，就 commit。如果说不清“这个 commit 做了 X”，就继续推进或拆分。

补充的 **风险驱动** 触发条件：在高风险操作前 commit，让前一个状态能保留下来，例如大规模删除、跨模块 refactors、dependency upgrades、自动化批量 renames。

用可识别的 prefix（例如 `wip:`）标记 checkpoint commits，或使用 `git commit --fixup=<hash>`，让后续 squash 更容易。具体 prefix 不重要，关键是 rebase pass 时能识别出来。

### 永远不要 commit 的内容 / What never to commit

- API keys / tokens / passwords（使用 environment variables）
- Build artifacts、`node_modules`、`__pycache__`
- Local config（`.env`、`*.local`）
- Large binaries（必要时使用 Git LFS）

### `commit-reminder` hook（机制提醒）/ `commit-reminder` hook

当相对 `HEAD` 的未提交 diff 超过 200 行或 8 个文件，且上次提醒已经过去至少 5 分钟时，`commit-reminder` hook 会通过 `additionalContext` 注入一条信息提醒。它不会阻塞执行。它是防止 working tree 失控的安全网；但每个 commit 的边界仍由 agent 判断。

这个 hook 在 `Edit` / `Write` / `MultiEdit`（Claude Code 的 file-edit `tool_name`s）和 `apply_patch`（Codex 的标准 file-edit `tool_name`）的 `PostToolUse` 上触发，因此在两个 runtime 中行为一致。

---

## 阶段 3：PR 前自检与可选历史清理 / Phase 3: Pre-PR self-check, optional history cleanup

目标是让 **PR 上的每个 commit 都是 atomic、可独立 revert，并且通过 tests**。Cleanup 是手段，不是目的；是否 squash 取决于当前状态和 repo 的 merge strategy。

```bash
git log --oneline main..HEAD
```

| 当前状态 | 处理 |
|---|---|
| 每个 commit 已经 atomic，message 清楚 | 保持现状 |
| Branch 包含 `wip:` / `--fixup` checkpoints | 用 `git rebase -i --autosquash main` 折叠它们 |
| Commit 数量合适，但某条 message 不清楚 | 用 `git rebase -i main` 并对那条 commit 执行 `reword` |
| Repo merge strategy 是 squash-on-merge | 本地 cleanup 没有额外收益；保持现状 |

Interactive rebase verbs：

- `pick` — 保留
- `squash` / `s` — 折叠到前一个 commit，并合并 messages
- `fixup` / `f` — 折叠到前一个 commit，并丢弃当前 message
- `reword` / `r` — 只修改 message
- `drop` / `d` — 移除

约束：

- 不要为了表面整洁而 squash。大型项目（Linux kernel、Postgres）会刻意保留每个 atomic commit，以支持 `git bisect` 定位问题。
- 不要 force-push 已经共享到 remote 的 branch，除非团队已经明确同意。

---

## 阶段 4：创建 PR / Phase 4: PR creation

### PR 描述：五个元素 / PR description: five elements

PR 描述必须覆盖全部五个元素：

1. **Scope** — 做了什么，以及为什么做
2. **Acceptance Criteria** — 产品层面可验证的条件
3. **Design Decisions** — 为什么选 A 不选 B；考虑过哪些 trade-offs
4. **Risks** — 边界条件、已知限制、可能受影响的 modules
5. **Remaining TODOs** — 后续事项；没有时显式写 `None`

推荐 body 结构（保留 `##` heading level；`pr-create-guard` hook 会扫描 headings）：

```markdown
## Summary
<what was done + why (not a file list)>

## Acceptance Criteria
- [ ] verifiable item 1
- [ ] verifiable item 2

## Design Decisions
- Chose X over Y because ...
- Known trade-off: ...

## Risks
- Boundary conditions / known limits / modules potentially affected

## Test plan
- [ ] unit / integration tests
- [ ] manual / UI / browser verification: ...

## Remaining TODOs
- None | [ ] follow-up item
```

为什么采用这个结构：

- **`Acceptance Criteria` 与 `Test plan` 分开**：`Acceptance Criteria` 表示“什么必须成立”（产品视角）；`Test plan` 表示“如何确认它成立”（执行 checklist）。
- **`Design Decisions` 单独成节**，不要塞进 `Risks`。Agents 容易写“no risks identified”后跳过备选方案；单独成节会迫使两者都被填写。
- **`Summary` 必须包含 why**，不能只写“edited a/b/c three files”。diff 已经展示了 what。
- **空列表也要写 `None`**；缺失 section 在 `pr-create-guard` 的 heading scan 里会像遗漏。

### 以 Draft 打开 / Open as Draft

尽早以 Draft 打开 PR，让 CI 开始运行，也让增量反馈成为可能。只有在 verification 完成、body 覆盖五个元素之后，才标记 Ready。

```bash
gh pr create --draft --title "<type>: <subject>" --body-file <body.md>
```

`--draft` 要求由机制强制执行：`pr-ready-guard` 也会在 `gh pr create` 的 `PreToolUse` 触发；当缺少 `--draft` 时，它会运行 Ready PR 的结构性文档检查，例如 repo root 的 stray planning docs 和 `docs/specs/` 未收尾 active specs。`--draft` 和短写 `-d` 都会跳过这条路径；显式 `--draft=<value>` 形式中的 truthy 值（`=1` / `=t` / `=true`，大小写不敏感）也会跳过。Falsy 值（`=false` / `=0`）会被视为创建 Ready PR，并按同样的结构性文档检查阻塞。`gh pr ready` 还会额外检查当前 branch 是否有 unpushed commits；`gh pr create` 路径不会做这项检查。

---

## 阶段 5：创建 PR 后的自检 / Phase 5: Post-create reflection

`pr-create-guard` hook 会在 `gh pr create` 的 `PostToolUse` 触发。它会：

- 通过 `gh pr view --json body,title` 拉取刚创建的 PR body **和 title**
- 列出它找到的 `##` headings，以及 TODO checkbox 数量
- 用 Conventional Commits 格式检查 title（`<type>(<scope>)?(!)?: <subject>`；type 列表与阶段 2 相同）；如果 title 不匹配，会注入一行 `Title format: ⚠ ...`，建议使用 `gh pr edit --title "<type>: ..."` 修复。这只是软提醒
- 提醒你确认五个元素已经覆盖

它不会阻塞。如果缺少 heading 或 title 不符合 Conventional Commits，用 `gh pr edit --title "<type>: ..."` 和/或 `gh pr edit --body-file <new-body.md>` 修复。

注意：另一个 guard（`pr-ready-guard`，见阶段 4）也会在 `gh pr create` 的 `PreToolUse` 触发，用来在 PR 创建前**阻塞**结构性问题。阶段 5 只覆盖创建后的信息提醒；创建前的阻塞逻辑属于阶段 4。

---

## 阶段 6：PR Ready 后：跟踪 review 反馈 / Phase 6: After PR Ready — tracking review feedback

PR 标记 Ready 后，所有针对 review feedback 的改动（reviewer comments、`deep-review` findings、CI failures）都应该**按批次**回报到 PR conversation，让 reviewers 知道“这个 PR 可以再次查看了”。

### 批量状态评论 / Batch status comment

完成一批修复后：

```bash
gh pr comment <pr-number-or-url> --body-file <status.md>
```

推荐格式：

```markdown
Addressed N items in <sha-range>:

- ✅ <issue description> — fixed in <commit-sha>
- ✅ <issue description> — fixed in <commit-sha>
- ⏭️ <issue description> — deferred to follow-up: <issue link or rationale>
- ❌ <issue description> — won't fix: <rationale>
```

三种状态：

- `fixed` — 已完成；包含 commit SHA
- `deferred` — 移到 follow-up PR 或 issue；必须包含链接或清楚的理由
- `won't fix` — 明确原因（out of scope / disagree with reviewer / false positive）

### 不要做的事 / What NOT to do

- 不要逐条回复每个 review comment。`Resolve conversation` 是 reviewer 的动作，不是作者的工作。
- 不要用 batch comment 替代 commit-message rationale。每个 fix commit 的 message 仍然需要写清楚自己的 `why`。

### 更新 PR 描述 / PR description updates

当修复暴露出新的 risks、新 TODOs，或 revised design trade-offs 时，直接更新 PR 描述：

```bash
gh pr edit <pr> --body-file <updated-body.md>
```

Comment stream 记录“我们做了什么”；PR body 保持为这个 PR 的“当前状态”。不要混淆两者。

---

## 阶段 7：合并 / Phase 7: Merge

Merge 是最后一道闸门。`pr-merge-guard` hook 会在 `gh pr merge` 的 `PreToolUse` 触发；如果 PR body 的 `Acceptance Criteria` section 仍有未勾选的 `- [ ]` checklist item，它会**阻塞**合并。

- 只检查 `Acceptance Criteria` section；`Remaining TODOs`、`Test plan` 或其他 sections 里的未勾选项不阻塞，因为这些 sections 本来就可能记录延期工作。
- 已勾选项（`- [x]`）和普通非任务 bullets（`- ...`）不会阻塞。
- 如果某项确实不能在 merge 前验证（例如“下次 release 后确认”），它就不是这个 PR 的 acceptance criterion；merge 前把它移到 `Remaining TODOs`，并写成普通 bullet。

Guard 会 fail open：如果 `gh` 读不到 PR body，合并会继续，不会因为 guard 自己无法检查而阻塞。
