---
name: git-workflow
description: Drives the auriga git lifecycle phase-by-phase — branch hygiene, atomic / checkpoint commits with --autosquash cleanup, and the five-element PR body (scope / acceptance criteria / design decisions / risks / remaining TODOs). Use whenever the agent is about to create a branch, author a commit message, open or update a PR, or restructure history (rebase / squash / amend). Pairs with the `commit-reminder`, `pr-create-guard`, and `pr-ready-guard` hooks shipped in the same plugin.
---

# git-workflow

Phase-organised reference for the git lifecycle the auriga workflow expects. Each phase lists what to do, the exact commands, and the constraints to respect. Hooks in this plugin enforce a subset mechanically; this skill covers everything the hooks can't.

## When to Use

- Creating a branch for new work (any task that will produce code or content changes)
- Deciding whether to commit now or keep working
- Authoring a commit message
- Cleaning up branch history before opening a PR
- Creating a PR (Draft or Ready)
- Responding to review feedback after PR Ready

## When NOT to Use

- Plain shell operations unrelated to commit / branch / PR semantics (file ops, build commands, etc.)
- Inspecting git history for debugging only — use `git log` / `git bisect` directly

---

## Phase 1: Branch creation (before any code change)

- Never commit directly to `main`. All work goes on a feature branch.
- Cut from the current tip of `origin/main`:

```bash
git fetch origin main --quiet
git switch -c <branch-name> origin/main
```

### Parallel isolation: git worktree

When multiple agents or tasks run in parallel, give each its own worktree. Always pass an explicit base ref (e.g. `origin/main`) — without it, the new branch is cut from the current `HEAD`, which may already be on another feature branch:

```bash
git worktree add -b <branch-name> ../<task-dir> origin/main
git worktree list
git worktree remove ../<task-dir>
```

---

## Phase 2: Commits during development

### Atomic commit discipline

Every commit must:

- Express one logical change
- Build and pass tests at that point in history
- Not mix refactoring with feature work
- Not mix changes across unrelated modules

Example split (a single feature, four commits):

```
feat(auth): add RefreshToken domain model and repository interface
feat(auth): implement JWT refresh token issuance in AuthService
feat(auth): expose POST /auth/refresh endpoint
test(auth): add unit tests for refresh token rotation logic
```

### Commit message format

```
<type>(<scope>): <summary>

<body: motivation, key design decisions, known limitations>
```

- `type` follows Conventional Commits — accepted types: `feat` / `fix` / `docs` / `refactor` / `chore` / `test` / `perf` / `style` / `build` / `ci` / `revert`. `pr-create-guard` enforces this same list against the PR title (see Phase 5)
- `scope` is optional (any non-`)` characters inside parens, e.g. `feat(api): …` or `fix(deep/scope): …`)
- Optional `!` before the colon marks a breaking change: `feat!: …` or `feat(api)!: …`
- The body is a natural-language paragraph — explain **why**, not what (the diff already shows what)
- Task IDs (Jira / Linear) can be mentioned in the body or in the PR description

### Checkpoint commits

Trigger on **semantic units**, not on time. Commit when you've completed something you can describe in one sentence. If you can't articulate "this commit did X", keep going or split.

Complementary **risk-driven** trigger: commit *before* a high-risk action so the previous state survives — mass deletions, cross-module refactors, dependency upgrades, automated bulk renames.

Mark checkpoint commits with a recognisable prefix (e.g. `wip:`) or use `git commit --fixup=<hash>` so they're easy to squash later. The exact prefix doesn't matter, only that it's recognisable for the rebase pass.

### What never to commit

- API keys / tokens / passwords (use environment variables)
- Build artifacts, `node_modules`, `__pycache__`
- Local config (`.env`, `*.local`)
- Large binaries (use Git LFS if necessary)

### `commit-reminder` hook (mechanical nudge)

When uncommitted diff vs `HEAD` exceeds 200 lines or 8 files **and** the last reminder was ≥ 5 minutes ago, the `commit-reminder` hook injects an informational reminder via `additionalContext`. Non-blocking. Acts as a safety net for runaway working trees — but the per-commit boundary decision still belongs to the agent.

The hook fires on `PostToolUse` for `Edit` / `Write` / `MultiEdit` (Claude Code's file-edit `tool_name`s) and `apply_patch` (Codex's canonical file-edit `tool_name`), so it works the same way in both runtimes.

---

## Phase 3: Pre-PR self-check, optional history cleanup

The goal is that **every commit on the PR is atomic, independently revertable, and passes tests**. Cleanup is the means, not the end — whether to squash depends on the current state and the repo's merge strategy.

```bash
git log --oneline main..HEAD
```

| Current state | Action |
|---|---|
| Each commit already atomic, messages clean | Leave it alone |
| Branch contains `wip:` / `--fixup` checkpoints | `git rebase -i --autosquash main` to fold them |
| Commit count fine but a message is unclear | `git rebase -i main` and `reword` that one |
| Repo merge strategy is squash-on-merge | Local cleanup adds nothing — leave it |

Interactive rebase verbs:

- `pick` — keep
- `squash` / `s` — fold into previous commit, combine messages
- `fixup` / `f` — fold into previous commit, discard this message
- `reword` / `r` — change message only
- `drop` / `d` — remove

Constraints:

- Don't squash for cosmetic tidiness. Large projects (Linux kernel, Postgres) intentionally preserve every atomic commit for `git bisect` resolution.
- Don't force-push branches that are already shared on the remote unless the team has explicitly agreed.

---

## Phase 4: PR creation

### Language choice

Before calling `gh pr create`, ask the user which language to use for the PR description: Chinese / English / match the repo's recent PRs. Use `AskUserQuestion` / `request_user_input` for this. Reuse the choice within the same task, but do **not** persist it to memory — language preference is per-project and per-team, not per-user.

### PR description: five elements

The PR description must cover all five:

1. **Scope** — what was done and why
2. **Acceptance Criteria** — verifiable product-level conditions
3. **Design Decisions** — why option A over option B; trade-offs considered
4. **Risks** — boundary conditions, known limits, modules potentially affected
5. **Remaining TODOs** — follow-ups; write `None` explicitly when there are none

Recommended body structure (keep `##` heading level — the `pr-create-guard` hook scans for it):

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

Why this shape:

- **`Acceptance Criteria` vs `Test plan`** are kept separate — `Acceptance Criteria` is "what must be true" (product view); `Test plan` is "how we confirm it" (action checklist).
- **`Design Decisions` is its own section**, not folded into `Risks`. Agents tend to write "no risks identified" and skip alternatives entirely; separating them forces both to be filled.
- **`Summary` must contain the why**, not just "edited a/b/c three files". The diff already shows what changed.
- **List sections written as `None` when empty** — missing sections look like oversights to the `pr-create-guard` heading scan.

### Open as Draft

Open the PR as Draft early so CI starts running and incremental feedback is possible. Mark Ready only after verification is complete and the body covers the five elements.

```bash
gh pr create --draft --title "<type>: <subject>" --body-file <body.md>
```

The `--draft` requirement is mechanically enforced: `pr-ready-guard` also fires `PreToolUse` on `gh pr create` and runs the same structural checks (stray planning docs, unfinalized active specs) when `--draft` is absent. Both `--draft` and the short form `-d` opt out of that path, as do truthy values for the explicit `--draft=<value>` form (`=1` / `=t` / `=true`, case-insensitive). Falsy values (`=false` / `=0`) are treated as Ready-PR creation and gated identically to `gh pr ready`.

---

## Phase 5: Post-create reflection

The `pr-create-guard` hook fires `PostToolUse` on `gh pr create`. It:

- Fetches the created PR's body **and title** via `gh pr view --json body,title`
- Lists the `##` headings it finds and the TODO checkbox counts
- Tests the title against Conventional Commits format (`<type>(<scope>)?(!)?: <subject>` — same type list as Phase 2); when the title doesn't match, injects a `Title format: ⚠ ...` line suggesting `gh pr edit --title "<type>: ..."`. Soft nudge only
- Reminds you to verify the five elements are covered and that the description language matches the team's convention

Non-blocking. If a heading is missing, the title is non-CC, or the language is inconsistent, fix it with `gh pr edit --title "<type>: ..."` and/or `gh pr edit --body-file <new-body.md>`.

Note: a separate guard (`pr-ready-guard`, see Phase 4) also fires `PreToolUse` on `gh pr create` to **block** structural problems before the PR is created. Phase 5 covers the informational post-create reflection; the pre-create blocking belongs to Phase 4.

---

## Phase 6: After PR Ready — tracking review feedback

After marking the PR Ready, every change in response to review feedback (reviewer comments, `deep-review` findings, CI failures) should be reported back to the PR conversation in **batches**, so reviewers know "this PR is ready to look at again".

### Batch status comment

After completing one batch of fixes:

```bash
gh pr comment <pr-number-or-url> --body-file <status.md>
```

Recommended format:

```markdown
Addressed N items in <sha-range>:

- ✅ <issue description> — fixed in <commit-sha>
- ✅ <issue description> — fixed in <commit-sha>
- ⏭️ <issue description> — deferred to follow-up: <issue link or rationale>
- ❌ <issue description> — won't fix: <rationale>
```

Three states:

- `fixed` — done; include the commit SHA
- `deferred` — moved to a follow-up PR or issue; must include a link or clear rationale
- `won't fix` — explicit reason (out of scope / disagree with reviewer / false positive)

### What NOT to do

- Don't reply to every individual review comment. `Resolve conversation` is the reviewer's action, not the author's job.
- Don't replace commit-message rationale with the batch comment. Each fix commit still needs its own `why` in its message.

### PR description updates

When fixes uncover new risks, new TODOs, or revised design trade-offs, edit the PR description directly:

```bash
gh pr edit <pr> --body-file <updated-body.md>
```

The comment stream records "what we did"; the PR body remains the "current state" of the PR. Don't conflate the two.
