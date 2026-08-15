# auriga-workflow

The complete [auriga workflow](https://github.com/Ben2pc/auriga-cli) in one
plugin — every auriga-owned workflow skill plus the git lifecycle hooks that
enforce the workflow. Skills describe the workflow; hooks enforce it. Both
travel together so they share one distribution model and one install step.

## Skills

| Skill | What it does |
|---|---|
| `systematic-debugging` | Evidence-first diagnosis — establishes a repeatable verification path or a production evidence-collection path before permanent repair. |
| `incremental-impl` | Decomposes approved requirement changes into complete, verifiable implementation units, then coordinates incremental execution and integration. |
| `test-driven-development` | Minimal behavior-first TDD — requires risk-matched evidence and adds permanent tests only when stable contracts and reliable seams justify their maintenance cost. |
| `spec-design` | Requirement clarification — a confirmed conversational requirement can be authoritative for simple work; traceable, handed-off, public-contract, or cross-PR work is persisted under `docs/specs/<topic>/` or an explicitly approved `docs/long-running-specs/<topic>/`. |
| `arch-design` | Technical design clarification — domain models, module boundaries, dependency direction, human-reviewed design records, and migration constraints. |
| `code-simplify` | Authorized code-level simplification — protects behavior, targets concrete maintenance cost, and supports user-approved code-smell scans. |
| `session-compound` | Generates either a single-session retrospective or incremental 30-day usage insights as a self-contained HTML report. |
| `goalify` | Adds bounded autonomous execution to the selected Plan or `planning-with-files` carrier, defaulting Ready-time temporary artifacts to archival so unattended runs can continue. |
| `deep-review` | Local multi-dimensional PR review — required when no CI review exists and optional by user choice when CI review already covers the PR. |
| `reviewer-creator` | Scaffolds a project reviewer at `docs/rules/review/<name>.md`; `deep-review` hosts supplements in a built-in dimension or dispatches explicit standalone dimensions. |
| `git-workflow` | The Git lifecycle skill — worktree safety, semantic commits, bilingual PR body contracts, review feedback, and merge readiness. |
| `documentation-management` | Manages human and Agent documentation as distinct context assets, governs document lifecycle, and promotes durable decisions into `docs/architecture/`. |
| `docent` | Explicit-invocation code docent — a single dedicated subagent explains existing code, modules, or components through current-architecture maps, key relationships, and file:line evidence in a self-contained interactive HTML report. |

## Hooks

| Hook | Event | Fires on | Action |
|---|---|---|---|
| `commit-reminder` | `PostToolUse` | File-edit tools: `Edit` / `Write` / `MultiEdit` / `NotebookEdit` (Claude Code) · `apply_patch` (Codex) · `Write` / `StrReplace` / `Delete` / `EditNotebook` (Cursor) · `search_replace` (Grok Build) | When uncommitted diff vs `HEAD` exceeds 200 lines or 8 files **and** the last reminder was ≥ 5 minutes ago, injects `additionalContext` nudging the agent to commit at the next semantic boundary. Never blocks. Silent outside a git repo. |
| `pr-create-guard` | `PostToolUse` | `gh pr create` | Fetches the new PR's body + title via `gh pr view`, injects a snapshot (headings + TODO counts) so the agent can self-verify against the six-section PR description contract (scope / acceptance criteria / design decisions / risks / test plan / TODOs). Also flags titles that don't match Conventional Commits format with a soft nudge. Never blocks. |
| `pr-ready-guard` | `PreToolUse` | `gh pr ready` · `gh pr create` (when `--draft` / `-d` absent) | Hard-blocks (exit 2) on **structural** issues: the `.planning/.active_plan` pointer and files in the plan directory it names, unfinalized active specs under `docs/specs/`, scanner safety failures, or unpushed commits (`gh pr ready` only). On `gh pr ready` otherwise injects a body snapshot. |
| `pr-merge-guard` | `PreToolUse` | `gh pr merge` | Hard-blocks (exit 2) while the PR body's `Acceptance criteria` or `Test plan` section still has unchecked `- [ ]` checklist items. Scoped to those two sections — unchecked items elsewhere (Remaining TODOs) never block; fenced code blocks are skipped. Fails open if `gh` can't read the body. |

## Structure

- `skills/<name>/SKILL.md` — one skill per directory, autoloaded by description.
- `skills/deep-review/references/reviewers/<name>.md` — per-dimension reviewer
  reference files (checklist + Detection table + Output contract). The main
  agent reads only the YAML frontmatter for orchestration and hands the file's
  absolute path to the reviewer subagent, which reads the body itself.
- `hooks/hooks.json` — hook registry, `command` paths use `${CLAUDE_PLUGIN_ROOT}`.
- `scripts/*.mjs` — the four hook scripts.

## Install

Installed automatically by `npx auriga-cli` — this plugin is registered in the
auriga-cli marketplace. Manual install:

```bash
claude plugins marketplace add Ben2pc/auriga-cli
claude plugins install auriga-workflow@auriga-cli
```

For Codex, register the marketplace:

```bash
codex plugin marketplace add https://github.com/Ben2pc/auriga-cli.git
```

Then enable `auriga-workflow` from the Codex plugin directory. The Codex alpha
also accepts `codex plugin add auriga-workflow@auriga-cli` directly. Codex
requires the hook system feature flag in `~/.codex/config.toml`:

```toml
[features]
codex_hooks = true
```

## Behaviour parity between Claude Code and Codex

Both Agents share the same plugin payload and the same `${CLAUDE_PLUGIN_ROOT}`
substitution (Codex deliberately mirrors that name for OOTB compat with
Claude-Code-style plugins). The scripts produce identical outputs given
identical stdin payloads.

| Behaviour | Claude Code | Codex |
|---|---|---|
| `commit-reminder` → inject reminder (PostToolUse `additionalContext`) | ✅ | ✅ Codex reports file edits as `tool_name: "apply_patch"`. The matcher names that tool; the script keys off the working-tree diff, not `tool_name`. |
| `gh pr create` → inject body snapshot (PostToolUse `additionalContext`) | ✅ | ✅ |
| `gh pr ready` → block on structural issues (exit 2 + stderr) | ✅ | ✅ |
| `gh pr create` without `--draft` → block on structural issues (exit 2 + stderr) | ✅ | ✅ |
| `gh pr ready` → inject body snapshot when passing (PreToolUse `additionalContext`) | ✅ | ⚠️ Currently fail-open: Codex parses the field but does not surface it to the model yet. The block path is unaffected. |
| `gh pr merge` → block on unchecked Acceptance-criteria / Test-plan items (exit 2 + stderr) | ✅ | ✅ Block-path only — no `additionalContext`, so no fail-open gap. |

The remaining fail-open differs only in the **PreToolUse `additionalContext`
informational path** for `pr-ready-guard`: structural blocks fire identically,
and the two PostToolUse hooks (`commit-reminder`, `pr-create-guard`) are at full
parity.

Cursor and Grok Build load the same plugin hooks. Shell-tool matchers list
`Bash`, `Shell`, `PowerShell`, and Grok's `run_terminal_command`. The three
PR guards key off the command, not `tool_name`, and read both
`tool_input.command` and Grok's `toolInput.command`. `pr-create-guard` also
reads Cursor's `tool_output` and Grok's `toolResult`. `commit-reminder` is
invoked by the file-edit matcher (including Grok's `search_replace`) and
then keys off the working-tree diff, not `tool_name`.

Grok Build ignores `PostToolUse` stdout, so `commit-reminder` and
`pr-create-guard` cannot inject model context there. The two `PreToolUse`
block paths (`pr-ready-guard`, `pr-merge-guard`) still work via exit code 2.

## Block signals (pr-ready-guard)

The block list is conservative and based on filesystem / git state only — no
body-text regex. `pr-ready-guard` fires on two routes — both publish a Ready PR,
so both must enforce the same structural baseline:

- **Route A**: `gh pr ready` (Draft → Ready transition)
- **Route B**: `gh pr create` without `--draft` / `-d` (creates Ready directly,
  bypassing Route A). The explicit `--draft=<value>` form follows cobra
  `BoolVar` semantics — truthy values (`1` / `t` / `true`, case-insensitive) opt
  out of Route B; falsy and empty values trigger the same structural
  enforcement as no flag at all.

1. **Active temporary planning state under `.planning/`** (both routes): the
   `.planning/.active_plan` pointer and regular files, including optional
   attestations, under the plan directory named by that pointer. Inactive plan
   directories and legacy root `task_plan.md`, `findings.md`, and `progress.md`
   files are intentionally ignored. Archive reusable active-plan documents to
   `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/` via the
   `documentation-management` skill, then remove the pointer and active
   directory before ready.
2. **Unfinalized active specs under `docs/specs/`** (both routes): the dev-only
   temp workspace for `spec-design` / `arch-design` outputs; by PR Ready every
   spec must be promoted to `docs/architecture/`, archived to `docs/worklog/`,
   or deleted. Scanned recursively, so nested `docs/specs/<topic>/*.md` are
   caught.
3. **Unsafe or incomplete scan state** (both routes): symbolic-link scan roots,
   malformed or stale active-plan pointers, unreadable directories, or depth and
   entry limits block instead of failing open. Reported paths are escaped and
   bounded, and directory symbolic links are never followed.
4. **Unpushed commits on the current branch** (Route A only, and only when no PR
   ref is passed): the remote-side PR can't reflect what isn't pushed. Route B
   skips this — `gh pr create` pushes on demand.

On Route B, the block message also lists the `--draft` escape hatch as an
alternative remediation.

## Title format check (pr-create-guard)

After fetching the new PR's body, `pr-create-guard` reads the title and tests it
against Conventional Commits format `<type>(<scope>)?: <subject>`. Accepted
types: `feat` · `fix` · `docs` · `refactor` · `chore` · `test` · `perf` ·
`style` · `build` · `ci` · `revert`. When the title doesn't match, the injected
`additionalContext` adds a soft `Title format: ⚠ ...` nudge — PostToolUse never
blocks.

## Reminder thresholds (commit-reminder)

- **Lines**: uncommitted insertions + deletions > 200
- **Files**: uncommitted file count > 8
- **Rate limit**: ≥ 5 minutes since the last reminder (state in
  `.git/auriga-commit-reminder.last`)

Either threshold triggers the reminder. It is informational, never blocking.

## Test

```bash
node tests/commit-reminder.test.mjs    # smoke tests
node tests/pr-create-guard.test.mjs    # smoke tests
node tests/pr-ready-guard.test.mjs     # smoke tests
node tests/pr-merge-guard.test.mjs     # smoke tests
```

Tests live at the repo root `tests/` directory (shared with the rest of
auriga-cli) rather than inside the plugin folder, so plugin-only assets that
ship to users stay self-contained while dev-only smoke tests remain at the repo
level.

## Limits

- **Platform**: tested on macOS / Linux. Windows untested.
- **gh CLI required for PR hooks**: body snapshots use `gh pr view`. If `gh` is
  missing or unauthenticated, the PR hooks degrade gracefully, never crash.
- **commit-reminder requires git**: outside a git work tree, the hook is a
  silent no-op.
