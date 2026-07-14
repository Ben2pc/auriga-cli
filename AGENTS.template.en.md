<!-- AURIGA:WORKFLOW:v1 START — Managed block, maintained by auriga-cli. Do not edit by hand; upgrades replace it wholesale. Put project-specific instructions after the END marker below. -->
# auriga Workflow (v1.13.0)

1. Requirement Clarification: Clarify new requirements with `spec-design` first. **spec = why + what; plan = how** — requirements state "what to do" and acceptance criteria, not technical paths; for product features, lead with the "Why". Skip spec and go straight to plan when a change doesn't move the external behavior contract.

2. Planning: Run scope triage first — when all three predicates hold (see "Quick Development Flow"), take the quick flow; otherwise take the full path: if the work is architecture-heavy (spans modules, redraws boundaries, or the *how* is non-obvious), run `arch-design` first; then use `AskUserQuestion` / `request_user_input` to present the full execution-tracking menu — built-in Plan (medium complexity), `planning-with-files` (long-running, persistent tracking), `goalify` (autonomous `/goal`).

3. Branch first: Create a branch from main before writing code; never commit directly to main. Prefixes: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/`. All git/gh operations go through `git-workflow`.

4. Commit early: Open a Draft PR right after the first meaningful commit.

5. Root-cause before bugfixes: Follow `systematic-debugging` before deciding on a fix.

6. TDD: All code changes follow `test-driven-development` (sole exception: pure docs / pure config). Define testable acceptance criteria before each task. Check `docs/rules/test/` for relevant rules before writing tests; record explicitly if none apply. Invoke `test-designer` when a requirement spans modules with non-obvious interactions, edge cases are hard to self-test fairly, or you're tempted to skip TDD.

7. Incremental implementation: Invoke `incremental-impl` for non-trivial work (multi-file changes, cross-file refactors, executing a planned task, ~100+ lines expected) — size triage, slicing, and dispatch belong to the skill; skip when it rates the work XS or the change is pure docs/config.

8. Verify before claiming done: Before any "done / fixed / ready for review" judgment, run full verification per `verification-before-completion` (automated tests plus any needed UI interaction checks); don't judge by reading the implementation alone.

9. PR readiness: Mark Ready only after verification passes, the base branch is confirmed, and the PR body covers the five elements (scope / acceptance criteria / design decisions / risks / TODOs — see `git-workflow`). For design artifacts scoped to the current PR (spec.md, task_plan.md, etc.), use `AskUserQuestion` / `request_user_input` to ask the user: delete or archive to `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/`. A program spec spanning multiple PRs may remain under `docs/long-running-specs/` and does not participate in the Ready cleanup gate; a human decides when to archive it after all child PRs finish.

10. PR Review: After Ready, formal review must go through `deep-review` (`/review` remains a lightweight fallback). **Reviewer Agents report every finding with severity + confidence, no pre-filtering** — humans do the filtering.

11. Post-merge Compounding: After the PR merges, proactively ask whether to run `session-compound` to compound the session.

## Quick Development Flow (bug fix / small refactor / small feature)

Triggered only when all three predicates hold: (a) single module; (b) acceptance criteria ≤5 bullets; (c) no cross-boundary interface changes (public APIs, schemas, shared modules). If any fails or you're unsure, take the full path. When it applies, skip planning only — clarification, branch, Draft PR, TDD, verification, and review rules stay; run the standard TDD loop: baseline → red → green → full regression.

## Document Conventions

Repo documentation lives under `docs/`, one directory per purpose:

| Directory | Purpose | Lifecycle |
|---|---|---|
| `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/` | Archived spec / planning / architecture artifacts; one subdirectory per PR | Permanent |
| `docs/rules/` | Coding conventions, review checklists, naming decisions | Long-lived |
| `docs/rules/review/` | Project custom reviewers; created by `reviewer-creator`, auto-discovered by `deep-review` | Long-lived |
| `docs/rules/test/` | Project test rules; `test-designer` or the main Agent must consult before writing tests | Long-lived |
| `docs/rules/spec/` | Project spec rules; `spec-design` must consult during research | Long-lived |
| `docs/rules/arch/` | Project architecture rules; `arch-design` treats them as hard constraints | Long-lived |
| `docs/specs/` | Default destination for `spec-design` / `arch-design` outputs; ephemeral dev workspace. **Must be empty by PR Ready**: promote to `docs/architecture/`, archive to worklog, or delete | Dev-only |
| `docs/long-running-specs/` | Program specs, shared constraints, slice order, and status matrices spanning multiple PRs; acceptance contracts unique to the current PR still belong in `docs/specs/` | Cross-PR; archived manually after all child PRs finish |
| `docs/architecture/` | Stable design docs + ADRs (`ADR-<n>-<title>.md`) | Long-lived |
| `docs/` (other) | One directory per new category on demand; don't mix | Varies |

# Harness Principles

- **Enforce constraints via mechanisms, not prompts**: core rules belong in linters / CI / type systems / hooks.
- **The repo is the single source of truth**: what Agents can't access doesn't exist; plans, design decisions, and tech debt live in the repo as versioned artifacts.
- **Independent Evaluation**: test design for complex features and formal review are done by independent agents — never let an Agent grade its own work.
- **Continuously fight entropy**: pay down tech debt in small, steady increments.
- **Components are detachable**: each workflow step encodes a "the model isn't good at this" assumption; reassess as models improve, one variable at a time.
- **Instruction files are directories, not encyclopedias**: keep AGENTS.md lean (~200 lines) as entry and navigation; details go to `docs/`. Use AGENTS.md as the primary file with a `CLAUDE.md -> AGENTS.md` compatibility symlink (`ln -s AGENTS.md CLAUDE.md`).

# Agent Dispatch Principles

| Scenario | Approach |
|----------|----------|
| Single-file fix, clear solution | Do it yourself |
| Parallel read-only tasks (search, analysis) | In-conversation subagents, no isolation |
| Multiple subagents writing code | `incremental-impl` — returns a slice plan when gates pass |
| Fresh zero-pollution perspective / cross-model blind-spot coverage | Independent Agent (Reviewer, GPT reviewing Claude, etc.) |

- **Isolate parallel writes**: independent git worktrees, or fully disjoint directories.
- **Pick model tier, never hardcode model names**: flagship for architectural judgment / complex coding; workhorse for routine mechanical work. Effort: coding / agentic subtasks `xhigh`, light research `high`, mechanical tasks `medium`.
- **Dispatch must state explicit acceptance criteria and output format** (shape + scope/length), chosen per task.
<!-- AURIGA:WORKFLOW:v1 END -->

<!-- Add your project-specific instructions below. The block above is managed by auriga-cli — it is replaced wholesale on upgrade, while anything here is preserved. -->
