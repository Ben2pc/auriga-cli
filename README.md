English | [中文](README.zh-CN.md)

# auriga-cli

A modular Claude Code harness — install only the parts you need.

This repo itself is a fully configured harness project. You can clone it to see the full setup, or use the CLI to install individual modules into your own project.

## What's Included

| Module | Description |
|---|---|
| **Workflow** | `CLAUDE.md` auriga workflow: requirement clarification -> TDD -> Review, Harness principles, Subagent usage guide |
| **Skills** | External development process skills — systematic-debugging, TDD, verification, planning, playwright (spec authoring and architecture design ship as the `spec-design` and `arch-design` skills inside the `auriga-workflow` plugin) |
| **Recommended Skills** | Optional utility skills (e.g. `codex-agent`, `claude-code-agent`) you can add on top of the workflow skills |
| **Plugins** | Recommended Claude Code and Codex plugins — skill-creator, claude-md-management, playground, codex, auriga-workflow, auriga-notify, session-instructions-loader |

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

This prints a 5-step SOP (prerequisite check → `install --preset` → optional recommended skills → session reload → verify). Follow it top-to-bottom and the Agent can install the full harness without any human prompt.

The leading `-y` belongs to `npx` (it auto-confirms package installation), **not** to `auriga-cli`.

Non-interactive install commands:

```bash
npx -y auriga-cli install --preset           # curated workflow core: CLAUDE.md/AGENTS.md
                                             #   + workflow skills + auriga-workflow plugin
                                             #   (defaults: scope user, agent both, lang en)
npx -y auriga-cli install --all              # everything: workflow + skills + recommended + plugins
npx -y auriga-cli install recommended        # just the opt-in utility skills
npx -y auriga-cli install plugins --agent codex --plugin session-instructions-loader
npx -y auriga-cli install <type> [--flags]   # one of: workflow | skills | recommended | plugins
npx -y auriga-cli --help                     # full catalog + flags
```

`--preset` is atomic — it cannot be combined with a `<type>` or any filter flag, but it accepts `--scope`, `--agent`, and `--lang` (preset defaults: `user` / `both` / `en`, which differ from the per-category defaults).

Exit codes: `0` success, `1` fatal (precheck / parse / fetch), `2` partial success — `stderr` lists per-category `[OK]/[FAIL]` and a `Retry:` hint. After install, reload the Claude Code or Codex session so the new `CLAUDE.md` / skills / plugins / hook-plugin registrations are picked up.

### Web UI (opt-in)

For a browser-based view of what's installed and one-click apply, run:

```bash
npx auriga-cli web-ui
```

This boots a local server on `127.0.0.1`, opens your default browser, and serves a dashboard that scans the current project, shows each module's status (installed / not-installed / partial-install), and applies install / uninstall in a queue with live SSE progress. Re-running install is the update path — every installer is idempotent and overwrites in place. The server shuts down on its own ~15 s after the browser closes.

The UI is opt-in — `npx auriga-cli` still launches the TTY menu below.

### Interactive menu

```bash
npx auriga-cli
```

Interactive menu — select what to install:

```
? Select what to install:
  ◉ Recommended preset — CLAUDE.md/AGENTS.md + workflow skills + auriga-workflow plugin
  ◯ Optional skills — opt-in utility skills (claude-code-agent, codex-agent...)
  ◯ Other plugins — everything except auriga-workflow (auriga-notify, skill-creator, codex...)
```

The **Recommended preset** is checked by default and installs silently with the preset defaults (scope `user`, agent `both`, language `en`) — to fine-tune those, use the non-interactive `install --preset` flags. The other two items drill down into a per-item sub-selection. Plugin installation also asks which runtime to target: Claude Code, Codex, or both.

## Module Details

### Workflow

Installs `CLAUDE.md` into the target project and creates an `AGENTS.md` symlink for compatibility with different Agent frameworks. Supports English and Chinese — you choose during installation.

- **Extensible and upgradable**: the auriga workflow ships inside a managed block delimited by `<!-- AURIGA:WORKFLOW:v1 START/END -->` markers. Add your project-specific instructions *after* the END marker — re-running install upgrades the managed block in place and leaves your section untouched.
- A pre-marker `CLAUDE.md` (installed by an older version) is migrated to the marked format on the next install, with the old file backed up to `CLAUDE.md.bak`. A foreign `CLAUDE.md` from another tool is kept as your user section below a fresh managed block.
- Covers: requirement clarification, TDD, code review, branch workflow, subagent orchestration

### Skills

Installs selected skills via `npx skills add`, targeting both Claude Code and Codex.

| Skill | Source | Description |
|---|---|---|
| systematic-debugging | [obra/superpowers](https://github.com/obra/superpowers) | Systematic debugging — find root cause before fixing |
| test-driven-development | [obra/superpowers](https://github.com/obra/superpowers) | Test-driven development workflow |
| verification-before-completion | [obra/superpowers](https://github.com/obra/superpowers) | Pre-completion verification — evidence before assertions |
| planning-with-files | [OthmanAdi/planning-with-files](https://github.com/OthmanAdi/planning-with-files) | File-based task planning and progress tracking |
| playwright-cli | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) | Browser automation and testing |

**Recommended Skills (opt-in utility skills — installed by `--all`, not by `--preset`):**

| Skill | Source | Description |
|---|---|---|
| claude-code-agent | [Ben2pc/g-claude-code-plugins](https://github.com/Ben2pc/g-claude-code-plugins) | Delegate coding, review, diagnosis, and planning to standalone Claude Code sessions |
| codex-agent | [Ben2pc/g-claude-code-plugins](https://github.com/Ben2pc/g-claude-code-plugins) | Delegate to Codex sessions for cross-model coverage |
| deprecation-and-migration | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | Sunset, replace, or migrate legacy code — deprecation discipline |
| design-taste-frontend | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | Senior UI/UX engineer with metric-based design rules and strict component architecture |
| documentation-and-adrs | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | Record architectural decisions and the *why* — context for future engineers / agents |
| frontend-design | [anthropics/skills](https://github.com/anthropics/skills) | Distinctive, production-grade frontend UI generation that avoids generic AI aesthetics |
| make-interfaces-feel-better | [jakubkrehel/make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better) | Polish principles — animations, surfaces, typography, performance |

Supports both project and global installation scopes.

### Plugins

Installs selected plugins for Claude Code, Codex, or both. Claude Code uses `claude plugins install` and honors `--scope project|user`; Codex uses `codex plugin marketplace add/upgrade` (the right one is picked by reading `~/.codex/config.toml`) and enables selected plugins in `~/.codex/config.toml`.

Examples:

```bash
npx -y auriga-cli install plugins --agent both --plugin auriga-workflow
npx -y auriga-cli install plugins --plugin auriga-notify
npx -y auriga-cli install plugins --agent codex --plugin session-instructions-loader
```

| Plugin | Runtime | Description |
|---|---|---|
| skill-creator | Claude Code | Create and manage custom skills |
| claude-md-management | Claude Code / Codex | Audit and improve CLAUDE.md |
| playground | Claude Code / Codex | Build interactive HTML playgrounds |
| codex | Claude Code | Codex cross-model collaboration |
| auriga-workflow | Claude Code / Codex | The auriga workflow plugin — workflow skills plus the git lifecycle hooks that enforce them. Skills: `incremental-impl`, `test-designer`, `spec-design`, `arch-design`, `code-simplify`, `session-compound`, `goalify` (plans an autonomous goal and dispatches it via the built-in `/goal` command), `deep-review` (multi-dimensional PR review orchestrator — parallel per-dimension reviewers synthesized into an actionable punch list), `reviewer-creator` (scaffolds project-level custom reviewers under `docs/rules/review/`), and `git-workflow` (git lifecycle skill). Hooks: `commit-reminder` (PostToolUse on file edits — `Edit` / `Write` / `MultiEdit` in Claude Code, `apply_patch` in Codex — nudges to commit at the next semantic boundary when uncommitted diff vs `HEAD` exceeds 200 lines or 8 files), `pr-create-guard` (PostToolUse on `gh pr create` → injects a PR-body snapshot for five-element self-verification and flags non-Conventional-Commits titles), `pr-ready-guard` (PreToolUse on `gh pr ready` and non-draft `gh pr create` → blocks on stray planning docs, unfinalized active specs under `docs/specs/`, or unpushed commits), and `pr-merge-guard` (PreToolUse on `gh pr merge` → blocks while the PR body's Acceptance criteria section still has unchecked checklist items). The two PostToolUse hooks reach full Claude Code / Codex parity; Codex currently fails open on `pr-ready-guard`'s PreToolUse `additionalContext` informational path (block path identical). Installed by default through the plugin path. |
| auriga-notify *(opt-in)* | Claude Code | macOS native notification plugin for Claude Code `Notification` events. Focus-aware sound-only mode, click-to-activate, per-project notification grouping, and migrated `config.json` / `icon.png` support. Not installed by `install --all`; install explicitly with `install plugins --plugin auriga-notify`. |
| session-instructions-loader | Codex | Codex-only SessionStart plugin that injects ancestor `AGENTS.md` files plus repo-configured extra instruction files. |

## Requirements

- Node.js >= 18
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (required for the Plugins module)
- Codex CLI (required only for `install plugins --agent codex|both`)
- [Homebrew](https://brew.sh) (recommended for the `auriga-notify` plugin to use `alerter`)

## Development

- `npm test` — unit/integration tests (sub-second)
- `npm run test:e2e` — full tarball install e2e suite (~90-120s). Packs the actual npm tarball, installs it into a scratch project, and runs `auriga-cli install` against GitHub content pinned to the current HEAD SHA. The preflight uses `git branch -r --contains HEAD` — purely local, no network — so **HEAD must be reachable from a local remote ref** (a successful `git push` updates local remote refs synchronously; if someone else pushed, run `git fetch` first). The `plugins` and `--all` scenarios additionally require the `claude` CLI on PATH; they skip gracefully otherwise.

## License

MIT
