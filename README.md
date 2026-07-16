English | [中文](README.zh-CN.md)

# auriga-cli

A modular Claude Code harness — install only the parts you need.

This repo itself is a fully configured harness project. You can clone it to see the full setup, or use the CLI to install individual modules into your own project.

Auriga's harness design is inspired by several open-source skill and agent-workflow projects:

- [obra/superpowers skills](https://github.com/obra/superpowers/tree/main/skills)
- [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
- [mattpocock/skills](https://github.com/mattpocock/skills/tree/main)

## What's Included

| Module | Description |
|---|---|
| **Workflow** | `AGENTS.md` auriga workflow: requirement clarification -> TDD -> Review, Harness principles, Subagent usage guide |
| **Skills** | External development process skills — planning and playwright (`systematic-debugging`, TDD, spec authoring, architecture design, and completion-evidence discipline ship inside the workflow or `auriga-workflow` plugin) |
| **Recommended Skills** | Optional utility skills (e.g. `codex-agent`, `claude-code-agent`) you can add on top of the workflow skills |
| **Plugins** | Recommended Claude Code and Codex plugins — skill-creator, claude-md-management, playground, codex, auriga-workflow, auriga-notify, session-instructions-loader |

## Quick Start

### Install

There are two recommended ways to install:

1. Run the installer yourself:

```bash
npx -y auriga-cli
```

2. In an interactive Agent session, ask the Agent:

> Run `npx -y auriga-cli guide`, read the guide, then install the Auriga harness into this repository by following the steps it prints.

The guide command is intentionally non-interactive so an Agent can read the prerequisite checks, catalog inspection commands, install commands, reload step, and verification checklist in one place.

The leading `-y` belongs to `npx` (it auto-confirms package installation), **not** to `auriga-cli`.

Non-interactive install commands:

```bash
npx -y auriga-cli install --preset           # curated workflow core: AGENTS.md/CLAUDE.md
                                             #   + workflow skills + auriga-workflow plugin
                                             #   (defaults: scope user, agent both, lang zh-CN)
npx -y auriga-cli install --preset-plugins-skills
                                             # skip AGENTS.md/CLAUDE.md; install preset skills + auriga-workflow plugin
                                             #   (defaults: scope user, agent both)
npx -y auriga-cli install --all              # everything: workflow + skills + recommended + plugins
npx -y auriga-cli install recommended        # just the opt-in utility skills
npx -y auriga-cli install plugins --agent codex --plugin session-instructions-loader
npx -y auriga-cli install <type> [--flags]   # one of: workflow | skills | recommended | plugins
npx -y auriga-cli --help                     # full catalog + flags
```

`--preset` is atomic — it cannot be combined with a `<type>` or any filter flag, but it accepts `--scope`, `--agent`, and `--lang` (preset defaults: `user` / `both` / `zh-CN`, which differ from the per-category defaults). If the project already has its own `AGENTS.md / CLAUDE.md`, use `--preset-plugins-skills` to install the same preset skills and `auriga-workflow` plugin without touching workflow docs.

Exit codes: `0` success, `1` fatal (precheck / parse / fetch), `2` partial success — `stderr` lists per-category `[OK]/[FAIL]` and a `Retry:` hint. After install, reload the Agent session so the new `AGENTS.md` / skills / plugins / hook-plugin registrations are picked up.

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
  ◉ Recommended preset — AGENTS.md/CLAUDE.md + workflow skills + auriga-workflow plugin
  ◯ Optional skills — opt-in utility skills (claude-code-agent, codex-agent...)
  ◯ Other plugins — everything except auriga-workflow (auriga-notify, skill-creator, codex...)
```

The **Recommended preset** is checked by default and installs silently with the preset defaults (scope `user`, agent `both`, language `zh-CN`) — to fine-tune those, use the non-interactive `install --preset` flags. The other two items drill down into a per-item sub-selection. Plugin installation also asks which runtime to target: Claude Code, Codex, or both.

## Module Details

### Workflow

Installs `AGENTS.md` into the target project and creates a `CLAUDE.md` symlink for Claude Code compatibility. Chinese is the default; English remains available with `--lang en`.

- **Extensible and upgradable**: the auriga workflow ships inside a managed block delimited by `<!-- AURIGA:WORKFLOW:v1 START/END -->` markers. Add your project-specific instructions *after* the END marker — re-running install upgrades the managed block in place and leaves your section untouched.
- A pre-marker `CLAUDE.md` (installed by an older version) is safely migrated into the new `AGENTS.md` primary shape on the next install, with the old file backed up to `CLAUDE.md.bak`. A foreign `AGENTS.md` or `CLAUDE.md` from another tool is kept as your user section below a fresh managed block.
- Covers: requirement clarification, TDD, code review, branch workflow, subagent orchestration

### Skills

Installs selected skills via `npx skills add`, targeting both Claude Code and Codex.

| Skill | Source | Description |
|---|---|---|
| planning-with-files | [OthmanAdi/planning-with-files](https://github.com/OthmanAdi/planning-with-files) | File-based task planning and progress tracking |
| playwright-cli | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) | Browser automation and testing |

**Recommended Skills (opt-in utility skills — installed by `--all`, not by `--preset`):**

| Skill | Source | Description |
|---|---|---|
| claude-code-agent | [Ben2pc/g-claude-code-plugins](https://github.com/Ben2pc/g-claude-code-plugins) | Delegate coding, review, diagnosis, and planning to standalone Claude Code sessions |
| codex-agent | [Ben2pc/g-claude-code-plugins](https://github.com/Ben2pc/g-claude-code-plugins) | Delegate to Codex sessions for cross-model coverage |
| deprecation-and-migration | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | Sunset, replace, or migrate legacy code — deprecation discipline |
| design-taste-frontend | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | Senior UI/UX engineer with metric-based design rules and strict component architecture |
| frontend-design | [anthropics/skills](https://github.com/anthropics/skills) | Distinctive, production-grade frontend UI generation that avoids generic AI aesthetics |
| make-interfaces-feel-better | [jakubkrehel/make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better) | Polish principles — animations, surfaces, typography, performance |

Supports both project and global installation scopes.

### Plugins

Installs selected plugins for Claude Code, Codex, or both. Claude Code uses `claude plugins install` and honors `--scope project|user`; Codex registers the marketplace via `codex plugin marketplace add/upgrade` (the right one is picked by reading `~/.codex/config.toml`), then installs each selected plugin with the native `codex plugin add <plugin>@<marketplace>` command. The Codex path requires a Codex CLI new enough to expose `codex plugin add`; on older versions the Codex-side install aborts with an upgrade hint.

`auriga-workflow` only provides plugin-bundled skills; it never scans, modifies, or deletes same-name skills installed previously as standalone copies. After a team upgrade, verify the plugin skill first, then remove obsolete copies and lock entries with `npx skills remove <skill-name>` or by hand. This small-team transition is coordinated directly instead of maintaining an automatic cleanup state machine in the installer.

Examples:

```bash
npx -y auriga-cli install plugins --agent both --plugin auriga-workflow
npx -y auriga-cli install plugins --plugin auriga-notify
npx -y auriga-cli install plugins --agent codex --plugin session-instructions-loader
```

| Plugin | Runtime | Description |
|---|---|---|
| skill-creator | Claude Code | Create and manage custom skills |
| claude-md-management | Claude Code / Codex | Audit and improve AGENTS.md / CLAUDE.md |
| playground | Claude Code / Codex | Build interactive HTML playgrounds |
| codex | Claude Code | Codex cross-model collaboration |
| auriga-workflow | Claude Code / Codex | The auriga workflow plugin — workflow skills plus the git lifecycle hooks that enforce them. Skills: `systematic-debugging` (evidence-first diagnosis with production evidence collection), `test-driven-development` (minimal behavior-first TDD), `incremental-impl`, `spec-design`, `arch-design`, `code-simplify`, `session-compound`, `goalify` (turns a clarified objective into structured `/goal` text and starts it directly when the runtime supports that), `deep-review` (multi-dimensional PR review orchestrator — parallel per-dimension reviewers synthesized into an actionable punch list), `reviewer-creator` (scaffolds project-level custom reviewers under `docs/rules/review/` at the git repo root), `git-workflow` (git lifecycle skill), `documentation-management` (engineering-document lifecycle and distinct human/Agent context management), and `docent` (explicit-invocation code-comprehension reports generated by one dedicated subagent). Hooks: `commit-reminder` (PostToolUse on file edits — `Edit` / `Write` / `MultiEdit` in Claude Code, `apply_patch` in Codex — nudges to commit at the next semantic boundary when uncommitted diff vs `HEAD` exceeds 200 lines or 8 files), `pr-create-guard` (PostToolUse on `gh pr create` → injects a PR-body snapshot for six-section self-verification and flags non-Conventional-Commits titles), `pr-ready-guard` (PreToolUse on `gh pr ready` and non-draft `gh pr create` → blocks on the active `.planning` pointer and named plan directory, unfinalized active specs under `docs/specs/`, unsafe scanner state, or unpushed commits; inactive plan directories and legacy root planning files are ignored), and `pr-merge-guard` (PreToolUse on `gh pr merge` → blocks while the PR body's Acceptance criteria or Test plan section still has unchecked checklist items). The two PostToolUse hooks reach full Claude Code / Codex parity; Codex currently fails open on `pr-ready-guard`'s PreToolUse `additionalContext` informational path (block path identical). Installed by default through the plugin path. Existing standalone Superpowers TDD copies are not migrated automatically; this small team removes them manually after confirming the plugin skill is active. |
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
