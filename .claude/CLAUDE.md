# auriga-cli Development Guide

> The root `CLAUDE.md` is the **product** (installed to user projects). This file guides development of auriga-cli itself.

## What This Is

Interactive CLI (`npx auriga-cli`) that modularly installs Claude Code harness components: Workflow, Skills, Recommended Skills, Plugins. `install --preset` is the one-shot "workflow core" entry point (workflow doc + workflow skills + the auriga-workflow plugin).

## Architecture

```
src/
  cli.ts        — Entry point. parseArgs (non-interactive) + legacy TTY menu + graded exit (0/1/2)
  guide.ts      — `npx auriga-cli guide` SOP output (Agent bootstrap)
  help.ts       — `--help` renderer, reads the build-time catalog
  catalog.ts    — Catalog type + loadCatalog() (reads dist/catalog.json)
  types.ts      — Shared leaf types (CategoryName, CATEGORY_NAMES); kept out of cli.ts so help.ts doesn't reverse-import the entrypoint
  build/
    generate-catalog.ts — Build-time: parses SKILL.md + plugin configs → dist/catalog.json
  codex-plugin-config.ts — Codex plugin manifest/config validators + safe local-path helpers
  utils.ts      — Constants, remote fetch, exec, logging, InstallOpts, getPackageRoot
  workflow.ts   — CLAUDE.md + AGENTS.md installation (throws on failure in non-interactive). Also exports `uninstallWorkflow({force, cwd})` for the Web UI's /api/apply route.
  skills.ts     — Workflow + recommended skills installation; exports WORKFLOW_SKILLS and `uninstallSkill(name, opts)`
  plugins.ts    — Plugin + marketplace installation; exports `uninstallPlugin(id, agent, opts)` and `excludeByName` (TUI「其他插件」filter)
  preset.ts     — `installPreset(packageRoot, opts)` — orchestrates the curated preset (workflow doc + workflow skills + auriga-workflow plugin); shared by CLI `--preset`, the TUI, and the Web UI apply handler
  api-types.ts  — Shared TS types between src/server.ts and ui/ (StateReport, ApplyRequest, ProgressEvent…)
  state.ts      — `scanState(projectRoot, catalog)` — per-category presence-only scanner for /api/state (3 states: installed / not-installed / partial-install; v1.19.0 dropped update-available — re-install is the update path)
  scan-catalog.ts — Build-time catalog → runtime ScanCatalog adapter (consumes baked plugin agent map + plugin external flag from dist/catalog.json; no version / hash / event fields since v1.19.0)
  server.ts     — Local HTTP server (token + Origin auth, SSE /api/progress, static asset serve from uiDir). Boots via `npx auriga-cli web-ui`
  apply-handlers.ts — `buildDefaultApplyHandlers(ctx)` wires the bulk installers as per-item ApplyHandlers via `selected: [name]`. Web UI's CLI mode uses this; tests inject their own mocks
  ui-fetch.ts   — Downloads `ui-bundle.tar.gz` + `.sha256` for the current CLI version from GitHub Releases, SHA256-verifies, extracts to `~/.cache/auriga-cli/ui-v<version>/`. LRU eviction keeps last 3 versions.

ui/             — Vite + React 19 + Tailwind v4 subproject. Built artifacts ship as a GitHub Release asset (ui-bundle.tar.gz) — release.yml builds + uploads on tag push. CLI lazy-fetches via ui-fetch.ts.
                    src/components/  TopBar / Layout / StateCard / LogPanel
                    src/pages/Dashboard.tsx
                    src/styles/tokens.css     Anthropic visual tokens (see docs/design/anthropic-style-reference.md)
                    src/styles/index.css      Tailwind v4 @theme + base
                    src/lib/api.ts            fetch wrapper (token from URL ?token=)
                    vite.config.ts            dev proxy /api → http://127.0.0.1:4747 (changeOrigin: false)

tests/web-ui-e2e.test.ts — Hermetic end-to-end harness for `npx auriga-cli web-ui`. Spawns the real CLI in a HOME-redirected scratch dir, hits /api/state + /api/apply, asserts filesystem side effects in scratch and verifies the real $HOME stays untouched (canary). Not part of `npm test` — invoke via `npm run test:web-ui-e2e`.

plugins/
  auriga-workflow/
                  Repo-owned dual-Agent plugin (Claude Code + Codex)
                  bundling every auriga-owned workflow skill plus the git
                  lifecycle hooks that enforce the workflow.
                    .claude-plugin/plugin.json  (Claude Code manifest)
                    .codex-plugin/plugin.json   (Codex manifest)
                    skills/incremental-impl/SKILL.md
                    skills/test-designer/SKILL.md
                    skills/spec-design/SKILL.md  (+ references/)
                    skills/session-compound/
                    skills/arch-design/SKILL.md  (+ references/)
                    skills/code-simplify/SKILL.md (+ references/)
                    skills/goalify/SKILL.md      (plans a goal and dispatches
                                                 it via Claude Code's built-in
                                                 /goal command)
                    skills/deep-review/          (PR review orchestrator +
                                                 references/reviewers/<name>.md
                                                 per-dimension reviewer files)
                    skills/reviewer-creator/     (scaffolds project-level
                                                 custom reviewers under
                                                 docs/rules/review/)
                    skills/git-workflow/SKILL.md (git lifecycle skill)
                    hooks/hooks.json            (PreToolUse + PostToolUse,
                                                 shared shape; uses
                                                 ${CLAUDE_PLUGIN_ROOT} which
                                                 Codex deliberately mirrors
                                                 for OOTB compat)
                    scripts/commit-reminder.mjs (PostToolUse:
                                                 Edit|Write|MultiEdit|apply_patch
                                                 — covers Claude Code's tool
                                                 names plus Codex's canonical
                                                 file-edit name `apply_patch`)
                    scripts/pr-create-guard.mjs (PostToolUse: gh pr create)
                    scripts/pr-ready-guard.mjs  (PreToolUse: gh pr ready +
                                                 non-draft gh pr create)
                  Formed by merging the former auriga-go (goalify only),
                  deep-review, and auriga-git-guards plugins. Codex
                  currently fail-opens on PreToolUse `additionalContext`
                  (parses but does not surface yet); block path is
                  identical. PostToolUse `additionalContext` is supported,
                  so commit-reminder and pr-create-guard work at full
                  parity. Owned skills carry NO `.agents/skills/<name>` or
                  `.claude/skills/<name>` symlinks — plugin-bundled skills
                  are discovered via the plugin's marketplace + `skills:`
                  manifest field.
  auriga-notify/ Claude Code-only opt-in plugin for Notification events.
                    .claude-plugin/plugin.json
                    hooks/hooks.json
                    scripts/notify.mjs
                    scripts/test-notify.mjs
                    defaults/config.json
                    assets/icon.png
                  Legacy `.claude/hooks/notify/` installs are migrated by
                  plugins.ts when this plugin installs successfully.
  session-instructions-loader/
                  Codex-only plugin.
                    .codex-plugin/plugin.json   (Codex manifest)
                    hooks/hooks.json            (SessionStart)
                    scripts/session-start.mjs   (injects ancestor AGENTS.md
                                                 files plus repo-configured
                                                 extra instruction files)
.claude-plugin/
  marketplace.json — Marketplace manifest for this repo; lists
                     auriga-workflow + auriga-notify for Claude Code.

.agents/plugins/
  marketplace.json — Codex-native marketplace manifest for this repo; lists
                     auriga-workflow + session-instructions-loader.
                     Codex prefers this repo-scoped file when present instead
                     of falling back to the Claude-style marketplace.

extra_plugin_configs.json
  Auriga CLI plugin overlay for external plugins and local default-policy
  overrides. Local repo plugins come from the standard marketplaces above.
  Add entries here only for upstream-owned plugins or fields like `defaultOn`.

tests/
  skills.test.ts        — skill planner unit tests
  catalog.test.ts       — build-time catalog shape + description overrides
  cli-parse.test.ts     — parseArgs matrix (spec §3.5 / §5.2)
  install-nontty.test.ts — non-interactive install dispatch + graded exit
  preset.test.ts        — `--preset` parse / dispatch / graded exit; `--all` includes recommended
  legacy-menu.test.ts   — TUI 3-item menu contract + excludeByName filter
  guide.test.ts         — renderGuide snapshot + ANSI branch
  validators.test.ts    — validateSkillsLock / validateExtraPluginConfigs
  entrypoint.test.ts    — dist/cli.js symlinked-bin guard regression
  e2e-install.test.ts   — tarball → npm install → auriga-cli install (network + local, runs via npm run test:e2e, not `npm test`)
  commit-reminder.test.mjs — smoke tests for plugins/auriga-workflow/scripts/commit-reminder.mjs
  pr-create-guard.test.mjs — smoke tests for plugins/auriga-workflow/scripts/pr-create-guard.mjs
  pr-ready-guard.test.mjs  — smoke tests for plugins/auriga-workflow/scripts/pr-ready-guard.mjs
```

- No CLI framework — hand-rolled `parseArgs` in `cli.ts` for the non-interactive path; `@inquirer/prompts` (lazy-loaded) for the TTY menu
- Content fetched from GitHub at runtime (`fetchContentRoot()`)
- `withEsc()` wraps all prompts for ESC cancellation support
- Installers (`workflow.ts` / `skills.ts` / `plugins.ts`) **throw** on failure when `opts.interactive === false`; the interactive path keeps the log-and-continue behavior so the TTY menu surfaces errors inline without aborting the whole menu

## Key Conventions

- **Skill categorization**: `WORKFLOW_SKILLS` in `skills.ts` is the curated default-on set for external workflow skills installed via `npx skills add`. Everything else in `skills-lock.json` is "recommended" (opt-in utilities). auriga-cli-owned workflow skills now live in `plugins/auriga-workflow/` and install through the plugin path.
  - **Adding a workflow skill from an external repo**: author `SKILL.md` upstream and PR-merge → `npx skills add <repo> --skill <name> --agent claude-code codex --yes` to update `skills-lock.json` and populate `.agents/skills/` → add name to the `WORKFLOW_SKILLS` array in `src/skills.ts` → add a row to both README skills tables → reference it from the relevant `CLAUDE.md` step if the skill replaces prose there. **Do not edit `.agents/skills/<name>/SKILL.md` directly** — it is generated by `npx skills add` and silently clobbered on re-sync. To refresh an external skill after an upstream merge, **re-run `npx skills add <repo> --skill <name>` per skill** (not `npx skills update --project`) so the blast radius stays limited to the skill you actually want to update.
  - **Editing an auriga-cli-owned workflow skill** (`incremental-impl`, `session-compound`, `test-designer`, `spec-design`, `arch-design`, `code-simplify`): edit the source under `plugins/auriga-workflow/skills/<name>/`. Owned skills carry **no `.claude/skills/<name>` or `.agents/skills/<name>` symlinks** — plugin-bundled skills are discovered through the plugin's marketplace + `skills:` manifest field. Do not add owned-skill names back to `skills-lock.json` or `WORKFLOW_SKILLS`; the user-facing install surface is the `auriga-workflow` plugin. When an edit changes a skill's **output contract** (the files / fields / content it produces for downstream skills to consume), update its consumer skills in the same change — owned skills form a pipeline (`spec-design` → `test-designer` / `deep-review` → `incremental-impl`), and a contract change that isn't propagated becomes cross-skill drift (PR #119: a new `## Toolchain` table in `validation-contract.md` nearly shipped with `test-designer`'s SKILL.md still telling the agent to scan the test stack from scratch — caught only by deep-review).
  - **Adding a new owned workflow skill**: add it under `plugins/auriga-workflow/skills/<new-name>/` with its own `SKILL.md` (+ `references/` for progressive disclosure if the body would otherwise exceed ~500 lines). **Do NOT** create symlinks under `.claude/skills/` or `.agents/skills/` — the plugin manifest is the canonical discovery path. Bump the auriga-workflow plugin manifests (both Claude + Codex) and the `auriga-workflow` description in `.claude-plugin/marketplace.json` so the new skill propagates into `dist/catalog.json`. Update the root workflow only if the skill becomes part of the workflow contract.
  - **Adding a recommended skill**: `npx skills add <repo> --skill <name>` is enough — the skill's `SKILL.md` frontmatter description is picked up at build time by `src/build/generate-catalog.ts` and embedded into `dist/catalog.json`, which drives both `--help` output and the interactive menu. **Do not** hand-maintain a description list anywhere in code.
- **Adding an auriga-cli-owned plugin** (e.g. `auriga-workflow` — skills + hooks — or `auriga-notify` — hooks only): author at repo root `plugins/<name>/` — this repo *is* the source of truth. Required layout: `.claude-plugin/plugin.json` (metadata), optional `hooks/hooks.json` + hook scripts (see `plugins/auriga-workflow/` for the canonical hook example), optional `skills/<skill-name>/SKILL.md` (+ optional `references/`). **Everything under `plugins/<name>/` ships to users** — keep dev-only assets (tests, generators) at repo-root `tests/`. Then: register in `.claude-plugin/marketplace.json` (listing `"source": "./plugins/<name>"`). If the plugin should also target Codex, register it in `.agents/plugins/marketplace.json` and add `.codex-plugin/plugin.json`. Use `extra_plugin_configs.json` only for policy overrides such as `defaultOn`, not as the local plugin source of truth. Users install via `npx auriga-cli` → Plugins.
  - **Dual-Agent variant (Claude Code + Codex)**: Codex's hook system is schema-compatible with Claude Code (nested `hooks.<Event>[].matcher + hooks[]` shape, `${CLAUDE_PLUGIN_ROOT}` deliberately mirrored by Codex for OOTB compat, stdin/stdout contract identical). Register the plugin in both marketplaces: `.claude-plugin/marketplace.json` for Claude Code, and `.agents/plugins/marketplace.json` for Codex. Add a second manifest at `.codex-plugin/plugin.json` with the Codex-specific richer schema (`version`, `homepage`, `repository`, `license`, `keywords`, `interface` block with `displayName` / `category` / etc.); keep `.claude-plugin/plugin.json` minimal but mirror `version` for upgrade comparators. Same `hooks/hooks.json` payload, same `scripts/`, same README — see `plugins/auriga-workflow/` as the canonical example. Caveat: Codex currently fail-opens on `hookSpecificOutput.additionalContext` for `PreToolUse` (parsed but not surfaced to the model); the block path (`exit 2 + stderr`, or `permissionDecision: "deny"`) works identically. Document this asymmetry in the plugin's README. Claude-Code-specific `if: "Bash(...)"` filtering inside `hooks/hooks.json` is kept (Codex docs don't reject unknown fields per general JSON registry behavior); if a future Codex version strictly validates and rejects `if`, drop it and rely on script-internal substring checks (no behavioral regression — scripts already validate their own command match).
- **Adding an external-marketplace plugin** (a plugin authored in another GitHub repo that this CLI merely registers): no plugin source authored in this repo — the plugin lives upstream and we just register it in `extra_plugin_configs.json`. For Claude Code, set `claude.package` and, when the marketplace is not already known, `claude.marketplace`. For Codex, set `codex.marketplace`; auriga-cli runs `codex plugin marketplace add https://github.com/<source>.git` and then installs from Codex's marketplace cache. The `marketplace.{name, source}` shape is shared through `validateMarketplaceField` in `src/marketplace.ts`. **Skip upstream manifest fetch at build time** — `src/build/generate-catalog.ts` uses the extra config description for external entries because the upstream Codex manifest may not exist or may be resolved by the downstream CLI.
- **Plugin-bundled hooks**: register hooks via `plugins/<name>/hooks/hooks.json` with `command: "${CLAUDE_PLUGIN_ROOT}/..."`. This substitution expands reliably in both `claude -p` and interactive mode (empirically verified). Skill-bundled hooks via `SKILL.md` frontmatter `hooks:` field can *also* register hooks, but `${CLAUDE_SKILL_DIR}` does NOT currently expand in the hook command string (Claude Code bug), and the hook's cwd is the project root rather than the skill dir, so the `./scripts/...` doc example also fails. Workaround when a skill needs a hook: bundle the skill inside a plugin and lift the hook to the plugin root (see `plugins/auriga-workflow/` as the canonical dual-Agent example). Do not reintroduce a root `.claude/hooks/hooks.json` for new hooks; future hooks should distribute with plugins.
- **Plugin config**: `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json` define the local plugin surface. `extra_plugin_configs.json` defines external plugins and local default-policy overrides.
- **Hook config**: repo-owned hooks are plugin-bundled via `plugins/<name>/hooks/hooks.json`; there is no longer a CLI-installable `hooks` category. The `auriga-notify` migration is the reference shape for a Claude Code-only hook plugin with user config migration.
- **Agent portability**: skills and plugins serve teammates on different coding agents (Claude Code / Codex / Gemini) — the `auriga-workflow` plugin is explicitly dual-Agent. When authoring or editing anything under `plugins/<name>/`, don't let prose or tooling silently assume the agent is Claude Code: generic-agent prose using "Claude", Claude-only tool names without the Codex equivalent, shared features misattributed to one agent, or `CLAUDE.md` referenced without `AGENTS.md`. Full checklist: [`docs/rules/agent-portability.md`](../docs/rules/agent-portability.md).
- **Subprocess calls**: Use `exec()` wrapper, `{ inherit: true }` for streaming output.
- **User-facing output**: Use `log.ok/warn/error/skip` for consistent colored output.

## Commands

```bash
npm run build    # tsc → dist/, then node dist/build/generate-catalog.js → dist/catalog.json
npm run dev      # tsc --watch
npm start        # node dist/cli.js
DEV=1 npm start  # use local files instead of fetching from GitHub

npm test         # tsc -p tsconfig.test.json → dist-test/, then node --test
                 #   Unit + integration tests live in tests/. The test
                 #   file whitelist is hand-maintained in package.json's
                 #   `test` / `test:watch` scripts — add new test files there.

npm run test:e2e # Full tarball install e2e (~90-120s). Packs the actual npm
                 # tarball, installs into a scratch project, runs
                 # `auriga-cli install` against GitHub content pinned to
                 # HEAD SHA. Pretest hook runs `npm run build` so the
                 # tarball always reflects current src/. Requires HEAD to be
                 # pushed (preflight skips otherwise); `plugins` and `--all`
                 # scenarios additionally require `claude` CLI on PATH.
                 # Not in `npm test` — network-bound and slow. Run before
                 # cutting a release tag.

npm run test:git-guards
                 # Smoke tests for plugins/auriga-workflow/scripts/*.mjs
                 # (commit-reminder + pr-create-guard + pr-ready-guard).
                 # Plain Node, not the node:test framework, so they run as a
                 # separate npm script rather than being wired into `npm test`
                 # alongside the TS suite. Run before any PR that touches
                 # plugins/auriga-workflow/scripts/ or the plugin's
                 # hooks/hooks.json.

npm run test:session-instructions-loader
                 # Smoke tests for plugins/session-instructions-loader/scripts/session-start.mjs.
                 # Run before any PR that touches that plugin's SessionStart
                 # hook or Codex marketplace metadata.

npx skills update --project
                 # Refresh every external vendored skill from its upstream source
                 # (writes skills-lock.json + .agents/skills/<name>/SKILL.md).
                 # Run after upstream PR-merges. Does not commit or push.
```

## Web UI manual verification

Before PR Ready (and again before merging) any change touching `src/state.ts`, `src/scan-catalog.ts`, `src/server.ts`, `src/api-types.ts`, `src/build/generate-catalog.ts`, `ui/`, or any input flowing into `dist/catalog.json` (CLAUDE.md, `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`, `extra_plugin_configs.json`, `skills-lock.json`, `plugins/<name>/.claude-plugin/plugin.json`, `plugins/<name>/.codex-plugin/plugin.json`, plugin `hooks/hooks.json`), spin up the installed `web-ui` from three project roots and eyeball every row. Automated `tests/tarball-shape.test.ts` covers the build-time tarball-shape contract; this manual step covers runtime behavior against real install state, which can't be unit-tested without a hermetic fixture for every project shape.

1. `~/` — exposes scope-boundary corner cases (e.g. `<proj>/.claude/CLAUDE.md` collapsing onto `$HOME/.claude/CLAUDE.md`)
2. `~/Workspace/` (or any non-auriga-cli parent dir) — baseline "nothing installed" state
3. The current repo dir — fully-installed dev state

Recipe per root:

```bash
cd <test-root>
nohup npx -y auriga-cli@<version> web-ui --no-open > /tmp/auriga-web-ui.log 2>&1 &
sleep 6
TOKEN=$(grep -oE 'token=[a-f0-9]+' /tmp/auriga-web-ui.log | head -1 | cut -d= -f2)
curl -s "http://127.0.0.1:4747/api/state?token=$TOKEN&projectRoot=$PWD" | python3 -m json.tool
# UI view: http://127.0.0.1:4747/?token=$TOKEN
pkill -f 'auriga-cli web-ui'
```

Per-row checks: workflow `status` reflects on-disk reality (CLAUDE.md exists ⊕ auriga header present — "exists but no header" must not silently become `installed`), plugin `agents` map correct, `external: true` on upstream-owned plugins (skill-creator / claude-md-management / codex), dual-Agent partial installs surface as `partial-install` with `missingAgents`, top-level `warnings[]` populated when CLAUDE.md / settings.json are present-but-foreign. Cards show no version strings since v1.19.0 (re-install is the update path).

For unreleased work (no published version yet), swap `npx auriga-cli@<version>` for a locally-packed tarball (`npm pack --pack-destination /tmp` → install to a scratch prefix → run `auriga-cli web-ui` from that bin). Do NOT run `node dist/cli.js web-ui` from the repo — it bypasses the tarball boundary and hides the entire `runtime-reads-non-shipped-paths` bug class (the v1.18.x regression series).

## Data Sources

| File | Maintained by | Purpose |
|------|--------------|---------|
| `skills-lock.json` | `npx skills` CLI | External skill registry (do NOT edit structure manually). The synced copies under `.agents/skills/<name>/SKILL.md` are generated — do **not** edit them directly. auriga-cli-owned workflow skills live under `plugins/auriga-workflow/` and must not be added back to the lock |
| `plugins/<name>/` | Manual | auriga-cli-owned plugin source (e.g. `plugins/auriga-workflow/`). Distributed via the repo-root `.claude-plugin/marketplace.json`. Everything inside the dir ships to users — keep dev-only assets (tests) at repo-root `tests/` |
| `.claude-plugin/marketplace.json` | Manual | Claude Code marketplace manifest for plugins shipped from this repo |
| `.agents/plugins/marketplace.json` | Manual | Codex marketplace manifest for plugins shipped from this repo |
| `extra_plugin_configs.json` | Manual | External plugin registry and default-policy overlay for marketplace plugins |
| `dist/catalog.json` | `npm run build` (via `src/build/generate-catalog.ts`) | Build-time catalog of workflow skills / recommended skills / plugins — name + description. Source of truth for `--help` output and the non-interactive filter-name validator. Ships inside the npm tarball. Regenerate after changing any `SKILL.md` frontmatter, plugin marketplace/config, plugin manifest, or plugin `hooks/hooks.json`. |
| `CLAUDE.md` / `CLAUDE.zh-CN.md` | Manual | Workflow templates (the product). **Must be edited in tandem** — both languages must stay in sync |
| `README.md` / `README.zh-CN.md` | Manual | Public docs. **Must be edited in tandem** — both languages must stay in sync |

## Versioning & Release

- Version in `package.json` follows semver: patch for bugfixes, minor for new features, major for breaking changes.
- **Bump rule**: bump CLI version (`package.json`) before merging any PR that changes **user-visible state**.
  - **Bump triggers** (any of these touched):
    - `src/` — rebuilt into `dist/`, ships in tarball
    - `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`, `extra_plugin_configs.json` — CONTENT_FILES fetched at runtime AND inputs to `dist/catalog.json` / install behavior
    - Plugin install surface changes in marketplace manifests or `extra_plugin_configs.json` — these decide which plugins auriga-cli offers or installs by default
    - **`skills-lock.json` *structural* changes** — adding/removing an entry, or editing `source` / `skillPath`. These change which skills auriga-cli offers (`dist/catalog.json`) or where the install pulls from. **`computedHash` drift alone is NOT a bump trigger** (see Exempt below).
    - **`.agents/skills/<name>/SKILL.md` frontmatter `description:` changes** — baked into `dist/catalog.json` at build time, drives `--help` output and the interactive menu. Body / scripts / hooks changes are NOT (see Exempt below).
    - `CLAUDE.md` / `CLAUDE.zh-CN.md` — workflow template, fetched at runtime
    - `README.md` / `README.zh-CN.md` — ship in tarball (always-included by npm); README.md drives the npmjs.com landing page
  - **Exempt** (no bump needed):
    - `.claude/CLAUDE.md` (this dev guide — not shipped, not fetched)
    - `.claude/skills/<name>` symlinks (dev-only, used by Agents in this repo; never shipped, never fetched)
    - `tests/`, `tsconfig*.json`, CI configs (`.github/`)
    - `docs/`
    - `plugins/<name>/*` payload-only changes — fetched by the Agent plugin marketplaces directly. Claude Code uses `claude plugins marketplace update` + `claude plugins update`; Codex uses `codex plugin marketplace add/upgrade`, then auriga-cli materializes Codex plugin cache from `~/.codex/.tmp/marketplaces/<marketplace>` when present. Plugin payload-only changes therefore propagate without a CLI bump; bump the plugin's own manifest version when the plugin contract/content changes.
    - **External skill refresh — `skills-lock.json` `computedHash` drift and `.agents/skills/<name>/*` body/hooks/scripts changes** when no structural lock fields and no SKILL.md frontmatter `description:` change. The install path `src/skills.ts` emits `npx -y skills add <source> --skill <name>`, which **resolves from upstream HEAD at install time** — auriga-cli does not pin users to the lock's `computedHash`. External skill content freshness belongs to the upstream repo (same boundary model as `plugins/<name>/*`); bump the external skill's own version upstream when its contract changes.
  - **Why**: the runtime pins auriga-cli-owned install inputs to `v<package.version>` AND `dist/catalog.json` is frozen in the tarball. Without a version bump + tag, changes to workflow templates, marketplace install surfaces, extra plugin config, or CLI behavior are invisible to `npx auriga-cli` users (PR #57 was the breaking case). Plugin payload updates AND external skill body/script updates are the two exceptions — both have upstream freshness channels (plugin marketplaces / `npx skills add` to upstream HEAD) that propagate without a CLI bump.
- **Release flow (tag push triggers CI publish)**: `fetchContentRoot` in `src/utils.ts` pins to the git tag `v<package.version>`, so the tag must exist on GitHub BEFORE users can `npx auriga-cli@<version>`. `.github/workflows/release.yml` enforces this: triggered on `push: tags: ['v*']`, it checks out the tag, verifies `tag == package.json version` (fail-loud if mismatched), runs unit → git-guards → e2e tests (each step's `pretest*` hook rebuilds `dist/`), `npm publish --provenance` (OIDC + explicit provenance attestation; Node 24 required — Node ≤ 22 bundles npm 10.x which doesn't support OIDC handshake), then `gh release create --generate-notes` to publish a GitHub Release alongside the npm artifact (auto-categorizes commits by Conventional Commits prefix; tags like `v1.2.3-rc.1` are auto-flagged as prerelease). Publish + Release only run if all gates pass. Canonical sequence: bump version in a PR → merge → `git tag v<version> && git push origin v<version>` → CI takes over. Manual `npm publish` / release creation is no longer part of the flow. Auth: **npm Trusted Publishing (OIDC)** — zero secrets to rotate; the workflow uses a short-lived GitHub-issued OIDC token. One-time setup on npmjs.com → package page → Settings → Publishing → Add trusted publisher, bound to this repo + exact workflow filename `release.yml`. Renaming the workflow file breaks publish until the npm config is updated. Set `AURIGA_CONTENT_REF=main` to bypass the tag pin in development. Manual `workflow_dispatch` with `dry_run=true` exercises the pipeline without publishing — useful when iterating on the workflow itself.
- **Two versions track independently**: `package.json` is the **CLI tool** version (bumps per the rule above whenever shipped state changes). The `CLAUDE.md` workflow header (e.g. `# auriga Workflow (v1.5.0)`) is the **workflow content** version — bumps independently when the workflow template's contract changes (steps reorganized, principles renamed). A typo fix or wording polish in the workflow template still bumps the CLI version (it's user-visible) but does not bump the workflow header. The two version numbers exist for different audiences: CLI version answers "what tarball am I running?"; workflow header answers "what workflow contract am I following?".

## Principles

- Keep it simple — no abstractions for one-time operations.
- Main menu order = execution order: Workflow -> Skills -> Recommended Skills -> Plugins. The TUI surfaces these as 3 items (Recommended preset / Optional skills / Other plugins); non-interactive `install <type>` still addresses the four categories individually.
- ESM throughout (`"type": "module"`, `.js` extensions in imports).
- **Runtime reads must hit shipped paths only.** `package.json` `files` allowlists exactly `dist/*.js`, `dist/*.d.ts`, `dist/catalog.json` (plus the npm-default `README*` / `LICENSE` / `package.json`). Everything else in this repo — `plugins/<name>/`, `.claude/`, `.agents/`, `skills/`, `src/` source TS — **does not exist** in the installed npm tarball. If `src/*.ts` resolves a path inside `packageRoot/<something-not-in-the-allowlist>/` at runtime, that read will silently fail for npm-installed users (`fs.readFile` → ENOENT → caught → degraded behavior). The dev environment hides the bug because `packageRoot === repoRoot` and the repo files exist there. Anything a runtime module needs from a non-shipped location must be **baked into `dist/catalog.json` at build time** (extend `CatalogEntry` if needed), **fetched from GitHub at runtime** via `CONTENT_FILES` when it is an auriga-cli install input (pinned to the `v<package.version>` tag by `fetchContentRoot`), or resolved from the Agent plugin marketplace cache when it is plugin payload (`claude plugins marketplace update` / `claude plugins update`; `codex plugin marketplace add/upgrade` then `~/.codex/.tmp/marketplaces/<marketplace>`). Do not add plugin payload files to `CONTENT_FILES`; plugin freshness belongs to the plugin marketplace, not the CLI tarball. Verify by extracting `npm pack`'s tarball and grepping for whatever you expect to read at runtime — *runtime correctness is a tarball-shape question, not a source-tree question*.
  - Concrete example: plugin agents map (e.g. `auriga-workflow` targets both Claude and Codex) is derived from `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`, and `extra_plugin_configs.json` — all outside the tarball allowlist. `src/build/generate-catalog.ts` reads them at build time and bakes `agents` into each plugin's `CatalogEntry`; `src/scan-catalog.ts` consumes the baked field. Catalog regression in `tests/catalog.test.ts` + `tests/tarball-shape.test.ts` pin the contract. Historical note: v1.18.x also baked an `expectedVersion` field for update-available detection; v1.19.0 deprecated that surface and removed the field — see [`docs/worklog/worklog-2026-05-13-refactor-drop-update-status/web-ui-history.md`](../docs/worklog/worklog-2026-05-13-refactor-drop-update-status/web-ui-history.md) for the rollback story.
