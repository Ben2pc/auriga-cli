English | [中文](README.zh-CN.md)

# auriga-cli

A modular Claude Code harness — install only the parts you need.

This repo itself is a fully configured harness project. You can clone it to see the full setup, or use the CLI to install individual modules into your own project.

## What's Included

| Module | Description |
|---|---|
| **Workflow** | `CLAUDE.md` auriga workflow: requirement clarification -> TDD -> Review, Harness principles, Subagent usage guide |
| **Skills** | Development process + orchestration skills — brainstorming, systematic-debugging, TDD, verification, planning, playwright, test-designer, parallel-implementation |
| **Recommended Skills** | Optional utility skills (e.g. `codex-agent`, `claude-code-agent`) you can add on top of the workflow skills |
| **Plugins** | Recommended Claude Code and Codex plugins — skill-creator, claude-md-management, codex, auriga-go, auriga-git-guards, session-instructions-loader, deep-review |
| **Hooks** | Claude Code hooks: `notify` (macOS notification, focus-aware sound-only when terminal is frontmost — **opt-in**: not installed by `install --all`, requires `install hooks --hook notify`) |

## Quick Start

### Ask your Agent to install

The easiest path is to let your current Agent read the install guide and follow it:

> Run `npx -y auriga-cli guide`, read the guide, then install the Auriga harness into this repository by following the steps it prints.

The guide command is intentionally non-interactive. It gives the Agent the prerequisite checks, catalog inspection commands, install commands, reload step, and verification checklist in one place.

### Agent Bootstrap (non-TTY)

Running inside `claude -p`, `claude -p --worktree`, or any non-interactive Agent session? Start here:

```bash
npx -y auriga-cli guide
```

This prints a 5-step SOP (prerequisite check → `install --all` → optional recommended skills → session reload → verify). Follow it top-to-bottom and the Agent can install the full harness without any human prompt.

The leading `-y` belongs to `npx` (it auto-confirms package installation), **not** to `auriga-cli`.

Non-interactive install commands:

```bash
npx -y auriga-cli install --all              # workflow + skills + plugins + hooks (atomic)
npx -y auriga-cli install recommended        # opt-in utility skills (not in --all)
npx -y auriga-cli install plugins --agent codex --plugin session-instructions-loader
npx -y auriga-cli install <type> [--flags]   # one of: workflow | skills | recommended | plugins | hooks
npx -y auriga-cli --help                     # full catalog + flags
```

Exit codes: `0` success, `1` fatal (precheck / parse / fetch), `2` partial success — `stderr` lists per-category `[OK]/[FAIL]` and a `Retry:` hint. After install, reload the Claude Code or Codex session so the new `CLAUDE.md` / skills / plugins / hook registrations are picked up.

### Interactive menu

```bash
npx auriga-cli
```

Interactive menu — select what to install:

```
? Select module types to install:
  ◉ Workflow — CLAUDE.md + AGENTS.md
  ◉ Skills — Development process skills
  ◉ Recommended Skills — Extra utility skills
  ◉ Plugins — Claude Code / Codex plugins
  ◉ Hooks — Claude Code hooks
```

Each module supports scope selection where applicable (Skills: project/global, Claude Code Plugins: user/project, Hooks: project local / project / user). Plugin installation also asks which runtime to target: Claude Code, Codex, or both.

## Module Details

### Workflow

Copies `CLAUDE.md` to the target project and creates an `AGENTS.md` symlink for compatibility with different Agent frameworks. Supports English and Chinese — you choose during installation.

- Backs up existing `CLAUDE.md` before overwriting
- Covers: requirement clarification, TDD, code review, branch workflow, subagent orchestration

### Skills

Installs selected skills via `npx skills add`, targeting both Claude Code and Codex.

| Skill | Source | Description |
|---|---|---|
| brainstorming | [obra/superpowers](https://github.com/obra/superpowers) | Requirement clarification and design exploration |
| systematic-debugging | [obra/superpowers](https://github.com/obra/superpowers) | Systematic debugging — find root cause before fixing |
| test-driven-development | [obra/superpowers](https://github.com/obra/superpowers) | Test-driven development workflow |
| verification-before-completion | [obra/superpowers](https://github.com/obra/superpowers) | Pre-completion verification — evidence before assertions |
| planning-with-files | [OthmanAdi/planning-with-files](https://github.com/OthmanAdi/planning-with-files) | File-based task planning and progress tracking |
| playwright-cli | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) | Browser automation and testing |
| test-designer | [Ben2pc/auriga-cli](https://github.com/Ben2pc/auriga-cli) | Independent-Evaluation test designer for TDD red phase |
| parallel-implementation | [Ben2pc/auriga-cli](https://github.com/Ben2pc/auriga-cli) | Slice planner for parallel multi-subagent code writing |
| session-compound | [Ben2pc/auriga-cli](https://github.com/Ben2pc/auriga-cli) | Post-merge session compounder — distills the session into an interactive HTML report (timeline + token / cache / tool health + playground for skill installs / AGENTS.md edits / new-skill gaps) |

**Recommended Skills (opt-in, not installed by `--all`):**

| Skill | Source | Description |
|---|---|---|
| claude-code-agent | [Ben2pc/g-claude-code-plugins](https://github.com/Ben2pc/g-claude-code-plugins) | Delegate coding, review, diagnosis, and planning to standalone Claude Code sessions |
| codex-agent | [Ben2pc/g-claude-code-plugins](https://github.com/Ben2pc/g-claude-code-plugins) | Delegate to Codex sessions for cross-model coverage |
| design-taste-frontend | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | Senior UI/UX engineer with metric-based design rules and strict component architecture |
| frontend-design | [anthropics/skills](https://github.com/anthropics/skills) | Distinctive, production-grade frontend UI generation that avoids generic AI aesthetics |
| incremental-implementation | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | Thin vertical slices — implement one piece, test it, verify, then expand |
| make-interfaces-feel-better | [jakubkrehel/make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better) | Polish principles — animations, surfaces, typography, performance |

Supports both project and global installation scopes.

### Plugins

Installs selected plugins for Claude Code, Codex, or both. Claude Code uses `claude plugins install` and honors `--scope project|user`; Codex uses `codex plugin marketplace add` and enables selected plugins in `~/.codex/config.toml`.

Examples:

```bash
npx -y auriga-cli install plugins --plugin auriga-go
npx -y auriga-cli install plugins --agent codex --plugin session-instructions-loader
npx -y auriga-cli install plugins --agent both --plugin auriga-git-guards
```

| Plugin | Runtime | Description |
|---|---|---|
| skill-creator | Claude Code | Create and manage custom skills |
| claude-md-management | Claude Code | Audit and improve CLAUDE.md |
| codex | Claude Code | Codex cross-model collaboration |
| auriga-go | Claude Code / Codex | Workflow autopilot for the auriga workflow. Reminder-based navigation across the `CLAUDE.md` phases. Bundles two skills: `auriga-go` (description-based NL trigger + `/auriga-go`) and `/goalify` (plans an autonomous goal from a spec or work-in-progress and dispatches it via Claude Code's built-in `/goal` command). |
| auriga-git-guards | Claude Code / Codex | Three git-lifecycle guardrails plus the bundled `git-workflow` skill. Hooks: `commit-reminder` (PostToolUse on `Edit` / `Write` / `MultiEdit` in Claude Code and on `apply_patch` — Codex's canonical file-edit `tool_name` — so it fires in both runtimes → when uncommitted diff vs `HEAD` exceeds 200 lines or 8 files and the last reminder was ≥ 60 s ago, inject a nudge to commit at the next semantic boundary), `pr-create-guard` (PostToolUse on `gh pr create` → fetch the new PR's body via `gh pr view` and inject headings + TODO counts as `additionalContext` so the Agent can self-verify the five-element PR description: scope / acceptance criteria / design decisions / risks / remaining TODOs), and `pr-ready-guard` (PreToolUse on `gh pr ready` → block on stray planning docs at `findings.md` / `progress.md` / `task_plan.md` / `docs/superpowers/specs/*.md`, unfinalized active specs in `docs/specs/*.md`, or unpushed commits; otherwise inject the body snapshot). The two PostToolUse hooks reach full Claude Code / Codex parity; Codex currently fails open on `pr-ready-guard`'s PreToolUse `additionalContext` informational path (block path identical). |
| session-instructions-loader | Codex | Codex-only SessionStart plugin that injects ancestor `AGENTS.md` files plus repo-configured extra instruction files. |
| deep-review | Claude Code / Codex | Multi-dimensional PR review orchestrator — dispatches parallel reviewers (spec-conformance, correctness, test-quality, docs-sync, plus conditional robustness/UX/performance/structure/code-quality/skill-plugin-quality) and synthesizes findings into an actionable punch list. Bundles a companion `reviewer-creator` skill for scaffolding project-level custom reviewers under `docs/rules/review/`. Drives the formal-review phase in `CLAUDE.md`. |

### Hooks

Installs Claude Code hooks into a chosen scope. Each hook is self-contained under `.claude/hooks/<name>/` and can be customized without editing code.

| Hook | Description |
|---|---|
| notify *(opt-in)* | Native macOS notification when Claude needs your attention. Shows the brand mark in the small app-icon position; click brings the originating terminal back to focus. **Focus-aware**: when the launching terminal is already frontmost, drops the banner and plays the sound only (toggle via `soundOnlyWhenFocused` in `config.json`). **Per-project group ID**: new notifications cleanly replace older ones in Notification Center, no process accumulation, no cross-project interference. Auto-installs `alerter` via Homebrew (`vjeantet/tap/alerter`). Customize sound and icon by editing `.claude/hooks/notify/config.json` and `.claude/hooks/notify/icon.png`. macOS-only at runtime; silent no-op on other platforms. |

Scope choices:

- **Project local** (recommended for cross-platform teams): files under `./.claude/hooks/`, registered in `./.claude/settings.local.json` — per-developer, not committed.
- **Project**: same files, registered in `./.claude/settings.json` — shared with the team via git.
- **User**: files under `~/.claude/hooks/`, registered in `~/.claude/settings.json` — global across all your projects.

Re-running the installer preserves your customized `config.json` and `icon.png`, overwrites the runtime, and never produces duplicate hook entries (idempotent merge by sentinel marker).

## Requirements

- Node.js >= 18
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (required for Claude Code Plugins and Hooks modules)
- Codex CLI (required only for `install plugins --agent codex|both`)
- [Homebrew](https://brew.sh) (recommended for the `notify` hook to install `alerter`)

## Development

- `npm test` — unit/integration tests (sub-second)
- `npm run test:e2e` — full tarball install e2e suite (~90-120s). Packs the actual npm tarball, installs it into a scratch project, and runs `auriga-cli install` against GitHub content pinned to the current HEAD SHA. The preflight uses `git branch -r --contains HEAD` — purely local, no network — so **HEAD must be reachable from a local remote ref** (a successful `git push` updates local remote refs synchronously; if someone else pushed, run `git fetch` first). The `plugins` and `--all` scenarios additionally require the `claude` CLI on PATH; they skip gracefully otherwise.

## License

MIT
