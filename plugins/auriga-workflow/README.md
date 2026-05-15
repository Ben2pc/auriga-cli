# auriga-workflow

The skill bundle for the [auriga workflow](https://github.com/Ben2pc/auriga-cli) —
every auriga-owned workflow skill travels in this one plugin so they share the
same distribution model as the rest of the auriga-owned runtime.

## Skills

| Skill | What it does |
|---|---|
| `incremental-impl` | Size triage (XS–XL), slicing strategy, optional parallel subagent dispatch, per-slice Implement → Test → Verify → Commit discipline. |
| `test-designer` | Independent test design — dispatches a context-free agent that sees only the requirement and code paths, returns executable failing tests. |
| `spec-design` | Requirement clarification — produces `spec.md` + `validation-contract.md` under `docs/specs/<topic>/`. |
| `session-compound` | Compounds a session into a self-contained interactive HTML report. |
| `goalify` | Plans an autonomous goal from a spec or work-in-progress and dispatches it via Claude Code's built-in `/goal` command. |
| `deep-review` | Multi-dimensional PR review orchestrator — dispatches parallel fresh-context reviewers per dimension and synthesizes findings into a Blocking / Non-blocking / Architectural punch list. |
| `reviewer-creator` | Scaffolds a project-level custom reviewer at `docs/rules/review/<name>.md`; `deep-review` auto-discovers and dispatches it alongside the built-ins. |

## Structure

- `skills/<name>/SKILL.md` — one skill per directory, autoloaded by description.
- `skills/deep-review/references/reviewers/<name>.md` — per-dimension reviewer
  reference files (checklist + Detection table + Output contract), read on
  dispatch and passed verbatim into the subagent prompt.

No hooks — this plugin is pure skill orchestration.

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
also accepts `codex plugin add auriga-workflow@auriga-cli` directly.
