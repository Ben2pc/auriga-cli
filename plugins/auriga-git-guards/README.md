# auriga-git-guards

Three hooks plus a bundled skill that guard the auriga workflow across the git lifecycle: commit boundaries, PR creation, and PR-ready.

| Hook | Event | Fires on | Action |
|---|---|---|---|
| `commit-reminder` | `PostToolUse` | `Edit` / `Write` / `MultiEdit` (Claude Code) · `apply_patch` (Codex's canonical file-edit tool) | When uncommitted diff vs `HEAD` exceeds 200 lines or 8 files **and** the last reminder was ≥ 60 s ago, injects `additionalContext` nudging the agent to commit at the next semantic boundary. Never blocks. Silent outside a git repo. |
| `pr-create-guard` | `PostToolUse` | `gh pr create` | Fetches the new PR's body via `gh pr view`, injects a snapshot (headings + TODO counts) so the agent can self-verify against the five-element PR description contract (scope / acceptance criteria / design decisions / risks / TODOs). Never blocks. |
| `pr-ready-guard` | `PreToolUse` | `gh pr ready` | Hard-blocks (exit 2) on **structural** issues: stray `findings.md` / `progress.md` / `task_plan.md` at repo root, unarchived specs under `docs/superpowers/specs/`, unfinalized active specs under `docs/specs/`, or unpushed commits. Otherwise injects a body snapshot. |

The bundled `git-workflow` skill describes the matching workflow (branch → atomic / checkpoint commits → optional rebase cleanup → PR body five-element structure → batch comment update after Ready). Designed for the auriga workflow in [auriga-cli](https://github.com/Ben2pc/auriga-cli).

## Install

### Claude Code

```bash
/plugin marketplace add Ben2pc/auriga-cli
/plugin install auriga-git-guards@auriga-cli
```

The plugin's hooks and skill activate automatically after install.

### Codex

```bash
codex plugin marketplace add Ben2pc/auriga-cli
```

Then enable `auriga-git-guards` from the Codex plugin directory.

Codex requires the hook system feature flag in `~/.codex/config.toml`:

```toml
[features]
codex_hooks = true
```

## Behaviour parity between Claude Code and Codex

Both Agents share the same plugin payload and the same `${CLAUDE_PLUGIN_ROOT}` substitution (Codex deliberately mirrors that name for OOTB compat with Claude-Code-style plugins). The scripts produce identical outputs given identical stdin payloads.

| Behaviour | Claude Code | Codex |
|---|---|---|
| `commit-reminder` → inject reminder (PostToolUse `additionalContext`) | ✅ | ✅ Codex reports file edits as `tool_name: "apply_patch"`; the hook's allowlist accepts both naming schemes, and `PostToolUse` `additionalContext` is surfaced. |
| `gh pr create` → inject body snapshot (PostToolUse `additionalContext`) | ✅ | ✅ |
| `gh pr ready` → block on structural issues (exit 2 + stderr) | ✅ | ✅ |
| `gh pr ready` → inject body snapshot when passing (PreToolUse `additionalContext`) | ✅ | ⚠️ Currently fail-open: Codex parses the field but does not surface it to the model yet. The block path is unaffected. |

The remaining fail-open differs only in the **PreToolUse `additionalContext` informational path** for `pr-ready-guard`: structural blocks fire identically, and the two PostToolUse hooks (`commit-reminder`, `pr-create-guard`) are at full parity.

## Block signals (pr-ready-guard)

The block list is conservative and based on filesystem / git state only — no body-text regex.

1. **Stray planning docs at repo root**: `findings.md`, `progress.md`, `task_plan.md`. These are session-ephemeral artifacts (e.g., from `planning-with-files` or `brainstorming`) and must be archived to `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/` (or deleted) before marking ready.
2. **Stray spec docs under `docs/superpowers/specs/`**: same lifecycle as above.
3. **Unfinalized active specs under `docs/specs/`**: that directory is the dev-only temp workspace for `brainstorming` outputs; by PR Ready every spec must be either promoted to `docs/architecture/`, archived to `docs/worklog/`, or deleted.
4. **Unpushed commits on the current branch** (only when no PR ref is passed): the remote-side PR can't reflect what isn't pushed yet.

## Reminder thresholds (commit-reminder)

- **Lines**: uncommitted insertions + deletions > 200
- **Files**: uncommitted file count > 8
- **Rate limit**: ≥ 5 minutes since the last reminder (state stored in `.git/auriga-commit-reminder.last`)

Either threshold triggers the reminder. The hook reads `git diff --shortstat HEAD` so both staged and unstaged work counts. It is informational, never blocking — atomic-commit granularity is a design judgment best left to the agent.

## Test

```bash
node tests/commit-reminder.test.mjs    # smoke tests
node tests/pr-create-guard.test.mjs    # smoke tests
node tests/pr-ready-guard.test.mjs     # smoke tests
```

Tests live at the repo root `tests/` directory (shared with the rest of auriga-cli) rather than inside the plugin folder, matching the convention used by `tests/ship-loop.test.sh` for the `auriga-go` plugin.

## Limits

- **Platform**: tested on macOS / Linux. Windows untested.
- **gh CLI required for PR hooks**: body snapshots use `gh pr view`. If `gh` is missing or unauthenticated, the PR hooks degrade gracefully (passive nudge or silent pass), never crash.
- **PR URL detection**: `pr-create-guard` extracts `github.com/.../pull/N` from the tool's response. Configurations that suppress URL output fall back to a passive nudge.
- **commit-reminder requires git**: outside a git work tree, the hook is a silent no-op.
