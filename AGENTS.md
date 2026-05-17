# auriga-cli Development Guide

This is the repository instruction entrypoint for Codex and Claude Code (`CLAUDE.md -> AGENTS.md`). Keep it short enough for default instruction budgets. The full developer guide lives in `docs/architecture/auriga-cli-dev-guide.md`.

auriga-cli is an Interactive CLI for installing workflow docs, skills, recommended skills, and plugins.

Product workflow templates are separate root files:

- `AGENTS.template.zh-CN.md`
- `AGENTS.template.en.md`

They are installed into user projects as `AGENTS.md` plus `CLAUDE.md -> AGENTS.md`; do not confuse template source names with install target names.

## Core Workflow

- Work on a branch, never commit directly to `main`.
- Use `git-workflow` for branch, commit, PR create, PR Ready, and review-feedback handling.
- For new behavior, use TDD: baseline, failing test, minimal implementation, regression verification.
- For bugs or unexpected failures, use `systematic-debugging` before fixing.
- For multi-file or non-trivial implementation work, use `incremental-impl` to decide size, slicing, and verification discipline.
- Before claiming completion, committing, or moving a PR forward, run fresh verification per `verification-before-completion`.
- PRs start as Draft. Mark Ready only after verification is complete, PR body has scope, acceptance criteria, design decisions, risks, test plan, and remaining TODOs, and `docs/specs/` has been cleared.
- After Ready, run formal `deep-review`; fix blocking findings. Non-blocking findings may be fixed or explicitly deferred with rationale.

## Repository Shape

Important runtime files:

- `src/utils.ts` owns `DEFAULT_WORKFLOW_TEMPLATE_FILE`, `LANGUAGES`, and `CONTENT_FILES`.
- `src/workflow.ts` reads template source files and writes user-project `AGENTS.md`.
- `src/workflow-docs.ts` owns user-project instruction filenames.
- `src/workflow-markers.ts` owns the managed block marker contract.
- `plugins/auriga-workflow/` owns workflow skills and git lifecycle hooks.
- `plugins/session-instructions-loader/` owns Codex SessionStart ancestor instruction injection.
- `.agents/plugins/session-instructions-loader.json` is intentionally `{}` in this repo; do not re-add `.claude/CLAUDE.md` extra injection.
- `.claude/` keeps local settings and external skill symlinks only. Do not reintroduce `.claude/AGENTS.md` or `.claude/CLAUDE.md` compatibility entries.

Key tests for this area:

- `tests/content-fetch.test.ts` checks runtime content fetch inputs and legacy template fallback.
- `tests/workflow-install.test.ts` checks template source files still install as user-project `AGENTS.md`.
- `tests/spec-design.test.ts` includes repo-checks for workflow template and instruction-entrypoint contracts.
- `tests/session-instructions-loader.test.mjs` checks SessionStart behavior.
- `tests/tarball-shape.test.ts` checks runtime reads do not rely on non-shipped tarball paths.

## Versioning

`package.json` is the CLI version. It must be bumped before releasing user-visible shipped state, normally in the same PR that changes:

- `src/`
- `.claude-plugin/marketplace.json`
- `.agents/plugins/marketplace.json`
- `extra_plugin_configs.json`
- structural `skills-lock.json` changes
- `.agents/skills/<name>/SKILL.md` frontmatter `description:`
- `AGENTS.template.zh-CN.md` / `AGENTS.template.en.md`
- `README.md` / `README.zh-CN.md`

No bump is needed for:

- root `AGENTS.md` / `CLAUDE.md` dev instructions
- `.claude/skills/<name>` symlinks
- `tests/`, `docs/`, `tsconfig*.json`, `.github/`
- plugin payload-only changes under `plugins/<name>/*` when the plugin's own marketplace/version path handles freshness
- external skill body/hash refreshes without structural lock or frontmatter-description changes

Release flow: merge the version-bump PR, tag `v<package.version>`, push the tag, and let release CI publish. `fetchContentRoot()` pins runtime content to `v<package.version>` unless `AURIGA_CONTENT_REF` overrides it.

If the user explicitly batches a version bump into a follow-up pre-release PR, document that in the PR risk section and keep runtime compatibility in place. This PR intentionally includes such a temporary legacy content fallback for old tags: if a new template source path 404s, `fetchContentRoot()` may fetch the pre-rename `AGENTS.md` / `AGENTS.en.md` and write it into the new template filename in its temp content root. Keep that fallback until the next release tag that contains `AGENTS.template.*` has shipped.

## Verification Commands

Run the narrowest meaningful set first, then broaden before PR Ready:

```bash
npm test
npm run test:session-instructions-loader
npm run test:git-guards
npm run test:e2e
```

`npm run test:e2e` is slow and network-bound. It requires the current HEAD to be pushed because it installs the tarball and fetches GitHub content pinned to the branch HEAD.

Before PR Ready, any change touching Web UI state/catalog inputs should also follow the manual Web UI check in `docs/architecture/auriga-cli-dev-guide.md`.

## Documentation Rules

- Active planning/design artifacts live in `docs/specs/` only during development.
- PR Ready requires `docs/specs/` to be empty: promote to `docs/architecture/`, archive to `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/`, or delete.
- Stable module and process docs live under `docs/architecture/`, `docs/rules/`, `docs/runbooks/`, or another purpose-specific directory.
- `docs/rules/review/` is for project custom reviewers consumed by `deep-review`.
- `docs/rules/test/` is for project test rules; `test-designer` or the main agent must check relevant files before writing tests.

## Editing Guidance

- Prefer existing repo patterns and helpers over new abstractions.
- Keep template source edits in both languages unless explicitly scoped otherwise.
- Do not add plugin payloads to `CONTENT_FILES`; plugin freshness belongs to plugin marketplaces.
- Do not add auriga-owned workflow skills back to `skills-lock.json` or `.agents/skills/`; they ship through the `auriga-workflow` plugin.
- When editing plugin or skill assets, keep Claude Code and Codex portability in mind. The portability checklist is `docs/rules/agent-portability.md`.
- Use concise comments only when they explain non-obvious constraints or history.

## Communication

Use Chinese by default with the user. Keep routine updates concise, but explain tradeoffs when the work touches unfamiliar domains, testing strategy, release behavior, or cross-module contracts.
