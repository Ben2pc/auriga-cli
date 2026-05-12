# auriga-cli Development Guide

> The root `CLAUDE.md` is the **product** (installed to user projects). This file guides development of auriga-cli itself.

## What This Is

Interactive CLI (`npx auriga-cli`) that modularly installs Claude Code harness components: Workflow, Skills, Recommended Skills, Plugins, Hooks.

## Architecture

```
src/
  cli.ts        — Entry point. parseArgs (non-interactive) + legacy TTY menu + graded exit (0/1/2)
  guide.ts      — `npx auriga-cli guide` SOP output (Agent bootstrap)
  help.ts       — `--help` renderer, reads the build-time catalog
  catalog.ts    — Catalog type + loadCatalog() (reads dist/catalog.json)
  types.ts      — Shared leaf types (CategoryName, CATEGORY_NAMES); kept out of cli.ts so help.ts doesn't reverse-import the entrypoint
  build/
    generate-catalog.ts — Build-time: parses SKILL.md + plugin/hook configs → dist/catalog.json
  codex-plugin-config.ts — Codex plugin manifest/config validators + safe local-path helpers
  utils.ts      — Constants, remote fetch, exec, logging, InstallOpts, getPackageRoot
  workflow.ts   — CLAUDE.md + AGENTS.md installation (throws on failure in non-interactive). Also exports `uninstallWorkflow({force, cwd})` for the Web UI's /api/apply route.
  skills.ts     — Workflow + recommended skills installation; exports WORKFLOW_SKILLS and `uninstallSkill(name, opts)`
  plugins.ts    — Plugin + marketplace installation; exports `uninstallPlugin(id, agent, opts)`
  hooks.ts      — Per-hook directory copy + idempotent settings merge; exports `uninstallHook(name, opts)`
  api-types.ts  — Shared TS types between src/server.ts and ui/ (StateReport, ApplyRequest, ProgressEvent…)
  state.ts      — `scanState(projectRoot, catalog)` — per-category three-state scanner for /api/state
  scan-catalog.ts — Build-time catalog → runtime ScanCatalog adapter (consumes baked workflow version + plugin agent map + plugin external flag + plugin expectedVersion from dist/catalog.json; skill expectedHash is always "" since v1.18.4 — drift moved to `npx skills update`; hooks still read .claude/hooks/hooks.json at runtime as a TODO follow-up)
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

.claude/hooks/
  hooks.json    — Hook registry (parallels .claude/plugins.json)
  notify/       — Self-contained notify hook (shipped to user projects)
                  index.mjs / config.json / icon.png / test.mjs / README.md

plugins/
  auriga-go/    — Repo-owned dual-Agent plugin source. Structure:
                    .claude-plugin/plugin.json  (plugin metadata)
                    .codex-plugin/plugin.json   (Codex manifest)
                    skills/auriga-go/SKILL.md   (workflow-navigator skill)
                    skills/goalify/SKILL.md     (single-prompt skill that
                                                 plans a goal and dispatches
                                                 it via Claude Code's built-in
                                                 /goal command)
                  Two skills are bundled inside the plugin so their
                  description-based NL triggers are preserved.
  auriga-git-guards/ — Repo-owned dual-Agent plugin (Claude Code + Codex).
                    .claude-plugin/plugin.json  (Claude Code manifest)
                    .codex-plugin/plugin.json   (Codex manifest)
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
                    scripts/pr-ready-guard.mjs  (PreToolUse:  gh pr ready)
                    skills/git-workflow/SKILL.md (bundled skill — the same
                                                 plugin-embedded pattern as
                                                 auriga-go)
                  Codex currently fail-opens on PreToolUse `additionalContext`
                  (parses but does not surface yet); block path is identical.
                  PostToolUse `additionalContext` is supported, so both
                  `commit-reminder` and `pr-create-guard` work at full parity.
  session-instructions-loader/
                  Codex-only plugin.
                    .codex-plugin/plugin.json   (Codex manifest)
                    hooks/hooks.json            (SessionStart)
                    scripts/session-start.mjs   (injects ancestor AGENTS.md
                                                 files plus repo-configured
                                                 extra instruction files)
  deep-review/  — Repo-owned dual-Agent plugin (Claude Code + Codex).
                    .claude-plugin/plugin.json  (Claude Code manifest)
                    .codex-plugin/plugin.json   (Codex manifest)
                    skills/deep-review/         (orchestrator skill +
                                                 references/reviewers/<name>.md
                                                 per-dimension reviewer files)
                    skills/reviewer-creator/    (scaffolds project-level
                                                 custom reviewers under
                                                 docs/rules/review/)
                  Owned in-tree. Originally vendored from
                  Ben2pc/g-claude-code-plugins at v0.3.0; upstream has
                  since deleted its copy (the 70fe9cf "migrated to
                  auriga-cli" commit), so this repo is now the canonical
                  source — edit plugins/deep-review/ directly and bump
                  the plugin.json version when the contract changes.
                  No hooks — pure orchestration.

.claude-plugin/
  marketplace.json — Marketplace manifest for this repo; lists auriga-go +
                     auriga-git-guards + deep-review for Claude Code.

.agents/plugins/
  marketplace.json — Codex-native marketplace manifest for this repo; lists
                     auriga-go + auriga-git-guards + session-instructions-loader
                     + deep-review.
                     Codex prefers this repo-scoped file when present instead
                     of falling back to the Claude-style marketplace.
  install.json     — auriga-cli's Codex plugin install list. Marketplace
                     entries are discoverable, but only install-list entries
                     are selected by default through `install plugins`.

tests/
  hooks.test.ts         — hook installer unit + integration
  skills.test.ts        — skill planner unit tests
  catalog.test.ts       — build-time catalog shape + description overrides
  cli-parse.test.ts     — parseArgs matrix (spec §3.5 / §5.2)
  install-nontty.test.ts — non-interactive install dispatch + graded exit
  guide.test.ts         — renderGuide snapshot + ANSI branch
  validators.test.ts    — validateSkillsLock / validatePluginsConfig
  entrypoint.test.ts    — dist/cli.js symlinked-bin guard regression
  e2e-install.test.ts   — tarball → npm install → auriga-cli install (network + local, runs via npm run test:e2e, not `npm test`)
  commit-reminder.test.mjs — smoke tests for plugins/auriga-git-guards/scripts/commit-reminder.mjs
  pr-create-guard.test.mjs — smoke tests for plugins/auriga-git-guards/scripts/pr-create-guard.mjs
  pr-ready-guard.test.mjs  — smoke tests for plugins/auriga-git-guards/scripts/pr-ready-guard.mjs
```

- No CLI framework — hand-rolled `parseArgs` in `cli.ts` for the non-interactive path; `@inquirer/prompts` (lazy-loaded) for the TTY menu
- Content fetched from GitHub at runtime (`fetchContentRoot()`)
- `withEsc()` wraps all prompts for ESC cancellation support
- Installers (`workflow.ts` / `skills.ts` / `plugins.ts` / `hooks.ts`) **throw** on failure when `opts.interactive === false`; the interactive path keeps the log-and-continue behavior so the TTY menu surfaces errors inline without aborting the whole menu

## Key Conventions

- **Skill categorization**: `WORKFLOW_SKILLS` in `skills.ts` is the curated default-on set (skills the workflow in `CLAUDE.md` directly references). Everything else in `skills-lock.json` is "recommended" (opt-in utilities).
  - **Adding a workflow skill from an external repo**: author `SKILL.md` upstream and PR-merge → `npx skills add <repo> --skill <name> --agent claude-code codex --yes` to update `skills-lock.json` and populate `.agents/skills/` → add name to the `WORKFLOW_SKILLS` array in `src/skills.ts` → add a row to both README skills tables → reference it from the relevant `CLAUDE.md` step if the skill replaces prose there. **Do not edit `.agents/skills/<name>/SKILL.md` directly** — it is generated by `npx skills add` and silently clobbered on re-sync. To refresh an external skill after an upstream merge, **re-run `npx skills add <repo> --skill <name>` per skill** (not `npx skills update --project`). The bulk variant also re-fetches the auriga-cli-owned 3 (whose `.agents/skills/<name>` are symlinks to `skills/<name>/`), which would write GitHub HEAD content back through the symlink and clobber any unpushed local source edits — narrow the blast radius by only touching the skill you actually want to update.
  - **Editing an auriga-cli-owned workflow skill** (e.g. `incremental-impl`, `session-compound`, `test-designer` — `skills-lock.json` source = `Ben2pc/auriga-cli`): edit the source file at `skills/<name>/` directly. **Both `.claude/skills/<name>` AND `.agents/skills/<name>` are symlinks to `../../skills/<name>`** so edits propagate everywhere immediately — Claude Code agents read through `.claude/skills/`, Codex / other Agent frameworks read through `.agents/skills/`, and the build-time catalog generator (`src/build/generate-catalog.ts`) also reads `.agents/skills/<name>/SKILL.md` and follows the symlink transparently. No `npx skills update --project` round-trip needed for content changes.
    - **When content changes**: recompute `computedHash` in `skills-lock.json`. The algorithm is sha256 over `(relativePath + content)` for every file in the skill dir, sorted by relative path (see `tests/skills.test.ts` for the exact contract). Compute it locally — **do not** run `npx skills update --project` or `npx skills add Ben2pc/auriga-cli --skill <name>` to "refresh" an owned skill. Both fetch from GitHub HEAD and write back through the `.agents/skills/<name>` symlink into `skills/<name>/`, which would clobber unpushed local source edits. Owned skills are authored locally; the lock hash is the only field that needs syncing after a content edit.
    - **Adding a new owned workflow skill** (vs. editing one): create `skills/<new-name>/SKILL.md` (+ optional sibling files) → add `skills-lock.json` entry with `source: "Ben2pc/auriga-cli"`, `skillPath: "skills/<new-name>/SKILL.md"`, and the computed hash → `ln -s ../../skills/<new-name> .claude/skills/<new-name>` AND `ln -s ../../skills/<new-name> .agents/skills/<new-name>` → add to `WORKFLOW_SKILLS` in `src/skills.ts` → README rows in both languages → reference from root `CLAUDE.md` if the skill replaces prose there.
  - **Adding a recommended skill**: `npx skills add <repo> --skill <name>` is enough — the skill's `SKILL.md` frontmatter description is picked up at build time by `src/build/generate-catalog.ts` and embedded into `dist/catalog.json`, which drives both `--help` output and the interactive menu. **Do not** hand-maintain a description list anywhere in code.
- **Adding an auriga-cli-owned plugin** (e.g. `auriga-go` — skills only — or `auriga-git-guards` — skills + hooks): author at repo root `plugins/<name>/` — this repo *is* the source of truth. Required layout: `.claude-plugin/plugin.json` (metadata), optional `hooks/hooks.json` + hook scripts (see `plugins/auriga-git-guards/` for the canonical hook example), optional `skills/<skill-name>/SKILL.md` (+ optional `references/`). **Everything under `plugins/<name>/` ships to users** — keep dev-only assets (tests, generators) at repo-root `tests/`. Then: register in `.claude-plugin/marketplace.json` (listing `"source": "./plugins/<name>"`) + add an entry to `.claude/plugins.json` with `marketplace: { name: "auriga-cli", source: "Ben2pc/auriga-cli" }`. Users install via `npx auriga-cli` → Plugins.
  - **Dual-Agent variant (Claude Code + Codex)**: Codex's hook system is schema-compatible with Claude Code (nested `hooks.<Event>[].matcher + hooks[]` shape, `${CLAUDE_PLUGIN_ROOT}` deliberately mirrored by Codex for OOTB compat, stdin/stdout contract identical). Register the plugin in both marketplaces: `.claude-plugin/marketplace.json` for Claude Code, and `.agents/plugins/marketplace.json` for Codex. Add a second manifest at `.codex-plugin/plugin.json` with the Codex-specific richer schema (`version`, `homepage`, `repository`, `license`, `keywords`, `interface` block with `displayName` / `category` / etc.); keep `.claude-plugin/plugin.json` minimal but mirror `version` for upgrade comparators. Same `hooks/hooks.json` payload, same `scripts/`, same README — see `plugins/auriga-git-guards/` as the canonical example. Caveat: Codex currently fail-opens on `hookSpecificOutput.additionalContext` for `PreToolUse` (parsed but not surfaced to the model); the block path (`exit 2 + stderr`, or `permissionDecision: "deny"`) works identically. Document this asymmetry in the plugin's README. Claude-Code-specific `if: "Bash(...)"` filtering inside `hooks/hooks.json` is kept (Codex docs don't reject unknown fields per general JSON registry behavior); if a future Codex version strictly validates and rejects `if`, drop it and rely on script-internal substring checks (no behavioral regression — scripts already validate their own command match).
- **Adding an external-marketplace plugin** (a plugin authored in another GitHub repo that this CLI merely registers): no plugin source authored in this repo — the plugin lives upstream and we just register it. Required edits: (1) add an entry to `.claude/plugins.json` with `package: "<plugin>@<marketplace>"` and `marketplace: { name: "<marketplace>", source: "<owner>/<repo>" }` (Claude Code resolves via the upstream `.claude-plugin/marketplace.json`); (2) add an entry to `.agents/plugins/install.json` with the same `marketplace: { name, source }` field — Codex calls `codex plugin marketplace add https://github.com/<source>.git`, which falls back to the upstream's Claude-style marketplace.json when no `.agents/plugins/marketplace.json` is present upstream. The `marketplace.{name, source}` shape is shared between Claude and Codex sides via `validateMarketplaceField` in `src/marketplace.ts`. **Skip `.codex-plugin/plugin.json` fetch at build time** — `src/build/generate-catalog.ts` deliberately reads description from install.json for external entries (the upstream manifest may not even exist; Codex CLI fetches it at install time). Test gotcha: `tests/plugins.test.ts` exercises this path with a stubbed `exec` and a fixture `install.json` keyed on fictitious plugin / marketplace names (so future plugin migrations don't churn the tests); do not add `.agents/plugins/marketplace.json` entries for externals — they're install.json-only.
- **Plugin-bundled hooks (preferred over skill-bundled hooks)**: register via `hooks/hooks.json` at the plugin root with `command: "${CLAUDE_PLUGIN_ROOT}/..."`. This substitution expands reliably in both `claude -p` and interactive mode (empirically verified). Skill-bundled hooks via `SKILL.md` frontmatter `hooks:` field can *also* register hooks, but `${CLAUDE_SKILL_DIR}` does NOT currently expand in the hook command string (Claude Code bug), and the hook's cwd is the project root rather than the skill dir, so the `./scripts/...` doc example also fails. Workaround when a skill needs a hook: bundle the skill inside a plugin and lift the hook to the plugin root (see `plugins/auriga-git-guards/` as the canonical dual-Agent example). Orthogonal to `.claude/hooks/` — that registry is for auriga-cli-installed hooks in user projects; plugin hooks travel with the plugin itself.
- **Plugin config**: `.claude/plugins.json` defines available plugins. Marketplace sources auto-install.
- **Hook config**: `.claude/hooks/hooks.json` defines available hooks. Each hook is a self-contained directory under `.claude/hooks/<name>/`; the canonical entrypoint is `index.mjs` and the registry's `files[]` is the source of truth for what gets shipped (defaults: runtime + config + assets + README + an optional `test.mjs` smoke test). Adding a new hook: drop a new directory + add an entry to `hooks.json`. Any dev-only assets a hook needs (icon source files, generators, fonts) should live OUTSIDE `.claude/hooks/<name>/` so the installer can copy `.claude/hooks/<name>/` wholesale to user projects. Every value in `hooks.json` flows through `validateHookEntry` in `hooks.ts` at load time — `hook.name`, `hook.files[]`, `hook.preserveFiles[]`, `dep.name`, `settingsEvents.{event,matcher,if}`, `command`, and `marker` are all path/identifier-validated before any filesystem touch, because the registry is fetched from raw GitHub at runtime and must be treated as untrusted input.
- **Hook payload fetch**: `hooks.json` is the only hook-related file in `CONTENT_FILES` (preloaded at startup). Each hook's individual files (`index.mjs`, `icon.png`, etc.) are lazy-fetched into the same `packageRoot` temp dir on demand by `ensureHookFilesFetched` — only when a user actually selects that hook. `installHooks` then copies from `packageRoot` into the user's target directory. In DEV mode `packageRoot` is the live repo, so the lazy fetch is a no-op.
- **Settings merge**: `addHookToSettings` (and its inverse `removeHookFromSettings`) in `hooks.ts` are the only places that mutate a settings JSON object. They are pure, idempotent (primary by `_marker` sentinel, secondary by command-string equality), throw on shape corruption rather than silently overwriting user data, and do not touch sibling keys. When a marker already exists but its `matcher` or `if` drifts from the desired values (registry upgrade), the two fields are updated in place; the action's `command` and sibling entries stay untouched. `addHookToSettings` also defense-in-depth revalidates its `options.matcher` / `options.ifRule` against `EVENT_NAME_RE` / `IF_RE`, so a direct library caller can't bypass the registry validator. The atomic write helper uses a random tmp suffix + `O_CREAT | O_EXCL` to be safe against TOCTOU symlink races. All hook installs go through these primitives.
- **Subprocess calls**: Use `exec()` wrapper, `{ inherit: true }` for streaming output.
- **User-facing output**: Use `log.ok/warn/error/skip` for consistent colored output.

## Commands

```bash
npm run build    # tsc → dist/, then node dist/build/generate-catalog.js → dist/catalog.json
npm run dev      # tsc --watch
npm start        # node dist/cli.js
DEV=1 npm start  # use local files instead of fetching from GitHub

npm test         # tsc -p tsconfig.test.json → dist-test/, then node --test
                 #   Hook installer unit + integration tests live in tests/.
                 #   Run before opening any PR that touches src/hooks.ts,
                 #   src/utils.ts, or .claude/hooks/.

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
                 # Smoke tests for plugins/auriga-git-guards/scripts/*.mjs
                 # (commit-reminder + pr-create-guard + pr-ready-guard).
                 # Plain Node, not the node:test framework, so they run as a
                 # separate npm script rather than being wired into `npm test`
                 # alongside the TS suite. Run before any PR that touches
                 # plugins/auriga-git-guards/scripts/ or the plugin's
                 # hooks/hooks.json.

npm run test:session-instructions-loader
                 # Smoke tests for plugins/session-instructions-loader/scripts/session-start.mjs.
                 # Run before any PR that touches that plugin's SessionStart
                 # hook or Codex marketplace metadata.

npx skills update --project
                 # Refresh every vendored skill from its upstream source
                 # (writes skills-lock.json + .agents/skills/<name>/SKILL.md).
                 # Run after upstream PR-merges. Does not commit or push.
```

## Web UI manual verification

Before PR Ready (and again before merging) any change touching `src/state.ts`, `src/scan-catalog.ts`, `src/server.ts`, `src/api-types.ts`, `src/build/generate-catalog.ts`, `ui/`, or any input flowing into `dist/catalog.json` (CLAUDE.md, `.claude/plugins.json`, `.agents/plugins/install.json`, `skills-lock.json`, `plugins/<name>/.claude-plugin/plugin.json`, `.claude/hooks/hooks.json`), spin up the installed `web-ui` from three project roots and eyeball every row. Automated `tests/tarball-shape.test.ts` covers the build-time tarball-shape contract; this manual step covers runtime behavior against real install state, which can't be unit-tested without a hermetic fixture for every project shape.

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

Per-row checks: workflow `status` reflects on-disk reality (CLAUDE.md exists ⊕ auriga header present — "exists but no header" must not silently become `installed`), plugin `agents` map correct, `external: true` on upstream-owned plugins (skill-creator / claude-md-management / codex), dual-Agent partial installs don't surface as confusing `vX → vX` upgrades, no spurious `update-available` rows, top-level `warnings[]` populated when CLAUDE.md / settings.json are present-but-foreign.

For unreleased work (no published version yet), swap `npx auriga-cli@<version>` for a locally-packed tarball (`npm pack --pack-destination /tmp` → install to a scratch prefix → run `auriga-cli web-ui` from that bin). Do NOT run `node dist/cli.js web-ui` from the repo — it bypasses the tarball boundary and hides the entire `runtime-reads-non-shipped-paths` bug class (the v1.18.x regression series).

## Data Sources

| File | Maintained by | Purpose |
|------|--------------|---------|
| `skills-lock.json` | `npx skills` CLI | Skill registry (do NOT edit structure manually). The synced copies under `.agents/skills/<name>/SKILL.md` are generated — do **not** edit them directly. Bulk-refresh with `npx skills update --project` after upstream PR-merges |
| `plugins/<name>/` | Manual | auriga-cli-owned plugin source (e.g. `plugins/auriga-go/`). Distributed via the repo-root `.claude-plugin/marketplace.json`. Everything inside the dir ships to users — keep dev-only assets (tests) at repo-root `tests/` |
| `.claude-plugin/marketplace.json` | Manual | Claude Code marketplace manifest for plugins shipped from this repo |
| `.agents/plugins/marketplace.json` | Manual | Codex marketplace manifest for plugins shipped from this repo |
| `.agents/plugins/install.json` | Manual | auriga-cli's Codex plugin install list. Marketplace entries are discoverable; this file controls which Codex plugins the CLI offers/installs by default |
| `.claude/plugins.json` | Manual | Plugin definitions surfaced by the CLI Plugins picker |
| `.claude/hooks/hooks.json` | Manual | Hook definitions (one entry per hook directory) |
| `dist/catalog.json` | `npm run build` (via `src/build/generate-catalog.ts`) | Build-time catalog of workflow skills / recommended skills / plugins / hooks — name + description. Source of truth for `--help` output and the non-interactive filter-name validator. Ships inside the npm tarball. Regenerate after changing any `SKILL.md` frontmatter, `.claude/plugins.json`, or `.claude/hooks/hooks.json`. |
| `CLAUDE.md` / `CLAUDE.zh-CN.md` | Manual | Workflow templates (the product). **Must be edited in tandem** — both languages must stay in sync |
| `README.md` / `README.zh-CN.md` | Manual | Public docs. **Must be edited in tandem** — both languages must stay in sync |

## Versioning & Release

- Version in `package.json` follows semver: patch for bugfixes, minor for new features, major for breaking changes.
- **Bump rule**: bump CLI version (`package.json`) before merging any PR that changes **user-visible state**.
  - **Bump triggers** (any of these touched):
    - `src/` — rebuilt into `dist/`, ships in tarball
    - `skills-lock.json`, `.claude/plugins.json`, `.claude/hooks/hooks.json`, `.agents/plugins/install.json` — CONTENT_FILES fetched at runtime AND inputs to `dist/catalog.json` / install behavior
    - `.claude/hooks/<name>/*` (hook payloads) — lazy-fetched at runtime by `ensureHookFilesFetched`
    - `.agents/skills/<name>/*` (vendored skill content) — build-time input to `src/build/generate-catalog.ts`, baked into `dist/catalog.json` (NOT runtime-fetched; users install via `npx skills add` against the skill's own upstream repo, not against auriga-cli)
    - `CLAUDE.md` / `CLAUDE.zh-CN.md` — workflow template, fetched at runtime
    - `README.md` / `README.zh-CN.md` — ship in tarball (always-included by npm); README.md drives the npmjs.com landing page
  - **Exempt** (no bump needed):
    - `.claude/CLAUDE.md` (this dev guide — not shipped, not fetched)
    - `.claude/skills/<name>` symlinks (dev-only, used by Agents in this repo; never shipped, never fetched)
    - `tests/`, `tsconfig*.json`, CI configs (`.github/`)
    - `docs/`
    - `plugins/<name>/*`, `.claude-plugin/marketplace.json`, and `.agents/plugins/marketplace.json` — fetched by the Agent plugin marketplaces directly, not via auriga-cli's tag pin, so changes propagate without a CLI bump
  - **Why**: the runtime pins content fetch to `v<package.version>` AND `dist/catalog.json` is frozen in the tarball. Without a version bump + tag, merged content changes are invisible to `npx auriga-cli` users (PR #57 was the breaking case). Releases are cheap (CI auto-publishes on tag push); spend the version number rather than the user confusion.
- **Release flow (tag push triggers CI publish)**: `fetchContentRoot` in `src/utils.ts` pins to the git tag `v<package.version>`, so the tag must exist on GitHub BEFORE users can `npx auriga-cli@<version>`. `.github/workflows/release.yml` enforces this: triggered on `push: tags: ['v*']`, it checks out the tag, verifies `tag == package.json version` (fail-loud if mismatched), runs unit → git-guards → e2e tests (each step's `pretest*` hook rebuilds `dist/`), `npm publish --provenance` (OIDC + explicit provenance attestation; Node 24 required — Node ≤ 22 bundles npm 10.x which doesn't support OIDC handshake), then `gh release create --generate-notes` to publish a GitHub Release alongside the npm artifact (auto-categorizes commits by Conventional Commits prefix; tags like `v1.2.3-rc.1` are auto-flagged as prerelease). Publish + Release only run if all gates pass. Canonical sequence: bump version in a PR → merge → `git tag v<version> && git push origin v<version>` → CI takes over. Manual `npm publish` / release creation is no longer part of the flow. Auth: **npm Trusted Publishing (OIDC)** — zero secrets to rotate; the workflow uses a short-lived GitHub-issued OIDC token. One-time setup on npmjs.com → package page → Settings → Publishing → Add trusted publisher, bound to this repo + exact workflow filename `release.yml`. Renaming the workflow file breaks publish until the npm config is updated. Set `AURIGA_CONTENT_REF=main` to bypass the tag pin in development. Manual `workflow_dispatch` with `dry_run=true` exercises the pipeline without publishing — useful when iterating on the workflow itself.
- **Two versions track independently**: `package.json` is the **CLI tool** version (bumps per the rule above whenever shipped state changes). The `CLAUDE.md` workflow header (e.g. `# auriga Workflow (v1.5.0)`) is the **workflow content** version — bumps independently when the workflow template's contract changes (steps reorganized, principles renamed). A typo fix or wording polish in the workflow template still bumps the CLI version (it's user-visible) but does not bump the workflow header. The two version numbers exist for different audiences: CLI version answers "what tarball am I running?"; workflow header answers "what workflow contract am I following?".

## Principles

- Keep it simple — no abstractions for one-time operations.
- Main menu order = execution order: Workflow -> Skills -> Recommended Skills -> Plugins -> Hooks.
- ESM throughout (`"type": "module"`, `.js` extensions in imports).
- **Runtime reads must hit shipped paths only.** `package.json` `files` allowlists exactly `dist/*.js`, `dist/*.d.ts`, `dist/catalog.json` (plus the npm-default `README*` / `LICENSE` / `package.json`). Everything else in this repo — `plugins/<name>/`, `.claude/`, `.agents/`, `skills/`, `src/` source TS — **does not exist** in the installed npm tarball. If `src/*.ts` resolves a path inside `packageRoot/<something-not-in-the-allowlist>/` at runtime, that read will silently fail for npm-installed users (`fs.readFile` → ENOENT → caught → degraded behavior). The dev environment hides the bug because `packageRoot === repoRoot` and the repo files exist there. Anything a runtime module needs from a non-shipped location must be **baked into `dist/catalog.json` at build time** (extend `CatalogEntry` if needed) or **fetched from GitHub at runtime** via `CONTENT_FILES` (pinned to the `v<package.version>` tag by `fetchContentRoot`). Verify by extracting `npm pack`'s tarball and grepping for whatever you expect to read at runtime — *runtime correctness is a tarball-shape question, not a source-tree question*.
  - Concrete example: plugin upgrade detection in the Web UI scanner needs each owned plugin's current version (e.g. `plugins/deep-review/.claude-plugin/plugin.json` → `0.3.1`). v1.18.2 read it at runtime from `packageRoot/plugins/<name>/...` and worked in dev but reported nothing for installed users (root cause of the v1.18.2 → v1.18.3 hotfix). The correct path: `src/build/generate-catalog.ts` reads it at build time and bakes `expectedVersion` into each plugin's `CatalogEntry`; `src/scan-catalog.ts` consumes the baked field. Catalog regression tests in `tests/catalog.test.ts` pin the contract for both owned and external-marketplace plugins.
