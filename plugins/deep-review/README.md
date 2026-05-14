# deep-review

Multi-dimensional PR review orchestrator for the [auriga workflow](https://github.com/Ben2pc/auriga-cli). Dispatches parallel reviewers per dimension and synthesizes findings into an actionable punch list.

## What it does

Invoke `/deep-review <PR#>` (or say "run a formal review on PR N" / "deep review this PR"). The orchestrator:

1. Classifies the PR by tags (`logic`, `auth-sensitive`, `ui`, `perf`, `structure`) and triviality.
2. Dispatches fresh-context reviewers in parallel: 3 always-fire reviewers (`spec-conformance`, `correctness`, `docs-sync`), tag-conditional reviewers (`robustness` / `security` / `ux` / `performance` / `structure`), non-trivial reviewers (`test-quality`, `code-quality`), and the detection-driven `skill-plugin-quality` reviewer when the diff touches plugin / skill / agent files.
3. Synthesizes findings into Blocking / Non-blocking / Architectural categories with severity + confidence.

Drives the formal-review phase of `CLAUDE.md` in projects that adopt the auriga workflow.

## Structure

- `skills/deep-review/` — orchestrator skill (autoloaded by description + `/deep-review` slash command).
  - `references/reviewers/<name>.md` — per-dimension reviewer reference files (checklist + Detection table + Output contract). Read on dispatch and passed verbatim into the subagent prompt.
- `skills/reviewer-creator/` — scaffold a project-level custom reviewer at `docs/rules/review/<name>.md`. The orchestrator auto-discovers custom reviewers and dispatches them alongside the built-ins.

No hooks — this plugin is pure orchestration.

## Install

Installed automatically by `npx auriga-cli` — this plugin is registered in the auriga-cli marketplace. Manual install:

```bash
claude plugins marketplace add Ben2pc/auriga-cli
claude plugins install deep-review@auriga-cli
```

For Codex:

```bash
codex plugin marketplace add https://github.com/Ben2pc/auriga-cli.git
codex plugin install deep-review@auriga-cli
```
