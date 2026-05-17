<!-- AURIGA:WORKFLOW:v1 START — Managed block, maintained by auriga-cli. Do not edit by hand; upgrades replace it wholesale. Put project-specific instructions after the END marker below. -->
# auriga Workflow (v1.9.0)

1. Requirement Clarification: Use `spec-design` to clarify requirements for new features. **Requirements should focus on "what to do" and acceptance criteria, not specific technical paths.** For product features, prioritize "Why" and let the implementation-stage Agent decide how. **spec = why + what; plan = how.** If a change does not move the external behavior contract (refactor, algorithm swap, library replacement with same observable behavior), skip spec and go directly to plan.

2. Planning: After clarification, run a **scope triage** before choosing a planning method. Apply the Quick Development Flow (see "Quick Development Flow" section below; skip planning) **only when all three predicates hold**: (a) the work fits within a single module; (b) acceptance criteria fit in ≤5 bullets; (c) no cross-boundary interface changes (public APIs, schemas, shared modules). If any predicate fails or you're unsure, take the full path. First decide explicitly — and state the verdict — whether the work is architecture-heavy (spans modules, restructures module boundaries, or the *how* is non-obvious); if so, run `arch-design` first — a precursor to execution tracking, not a replacement. Then use `AskUserQuestion` / `request_user_input` to pick an execution-tracking method, presenting the full menu: built-in Plan (medium complexity), `planning-with-files` (long-running, persistent tracking), or `goalify` (autonomous `/goal` run). Plans, design decisions, and tech debt should be versioned artifacts in the repo for subsequent Agent context.

3. After planning, create a branch: **Create a development branch from main before writing code.** All commits go on the branch — never commit directly to main. Branch naming: `feat/` (feature), `fix/` (bugfix), `docs/` (documentation), `refactor/` (refactoring), `chore/` (chores). Use the `git-workflow` skill for all git/gh operations (branch, commit, PR create/ready, post-review).

4. Commit early: After creating the development branch and making the first meaningful commit, create a Draft Pull Request early so CI, scope discussion, and incremental feedback can start before implementation is complete.

5. Before bugfixes, find the cause: When encountering bugs, test failures, or unexpected behavior, follow `systematic-debugging` to find root cause before fixing.

6. TDD: All code changes follow `test-driven-development` (sole exception defined in the Quick Development Flow section: pure docs / pure config). Write a failing test first, then minimal implementation, then regression verification. **Define testable acceptance criteria before each task** (specific features + acceptance conditions + edge cases) — don't check at the end. Before writing or updating tests, the main Agent or `test-designer` must first check the relevant rules under `docs/rules/test/` for the current module or test type; if the directory does not exist or no relevant file applies, record that there are no project-specific test rules. Invoke the `test-designer` skill when **any** of: (a) requirement spans ≥2 modules with non-obvious interactions; (b) edge cases would be hard for the implementation Agent to fairly self-test; (c) you'd otherwise skip TDD because "the implementation looks more obvious than the tests".

7. Incremental Implementation: During the green phase, invoke `incremental-impl` for any non-trivial implementation work — multi-file changes, refactors spanning files, executing a planned task (from any planning source: built-in Plan, `planning-with-files`, `spec-design` spec, `arch-design`'s arch_design.md, or direct user request), cross-cutting modifications, or when about to write more than ~100 lines. The skill owns size triage (XS–XL), slicing strategy, optional parallel subagent dispatch, and per-slice execution discipline — see the skill itself for the rules. Skip only when the skill's own size gate marks the work XS, or when the change is pure documentation / pure configuration.

8. Post-coding: Before any "done / fixed / ready to commit / ready for review" judgment, run and check full verification per `verification-before-completion`. Run the affected automated tests and any needed browser, UI, or mobile interaction checks; do not rely on implementation inspection alone.

9. PR Readiness: Keep the PR in Draft until verification is complete, the base branch is confirmed, and the PR description is updated with the five elements — scope, acceptance criteria, design decisions, risks, and remaining TODOs. Then mark the PR Ready for Review. If `spec-design`, `arch-design`, or `planning-with-files` produced design docs (`spec.md`, `arch_design.md`), findings.md, progress.md, task_plan.md, etc., use `AskUserQuestion` / `request_user_input` to ask the user: delete or archive to `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/` for traceability.

10. PR Review: Early feedback may happen on a Draft PR. After the PR is Ready for Review, formal review must use the `deep-review` skill (bundled in the `auriga-workflow` plugin). `/review` remains as a lightweight fallback. **Reviewer Agents must report every finding with severity + confidence, not pre-filter by importance** — let the human do the filtering.

11. Post-merge Compounding: Immediately after the PR is merged, proactively ask whether to run the `session-compound` skill. It compounds the current session into a self-contained HTML report so insights from this session land in the right place rather than evaporating.

## Quick Development Flow (bug fix / small refactor / small feature)

Triggered when the planning-phase scope triage finds all three predicates hold. Skips planning only — requirement clarification, branch, Draft PR, TDD, verification, and review rules still apply. Steps:

1. **Run baseline**: Run existing tests for affected modules to confirm current state (all green or pre-existing failures)
2. **Write/update tests** (red): Use `test-driven-development` to describe expected behavior. When changes touch shared modules, ensure all consumers' tests are in the baseline
3. **Implement** (green): Write minimal code to make tests pass
4. **Regression verification**: Run all affected tests, not just the new ones

The only exception to skip TDD: pure documentation or pure configuration changes (no code logic changes).

## Document Conventions

Repo documentation lives under `docs/`, directory-per-purpose, so Agents, the `pr-ready-guard` hook, and human reviewers all agree on where to place and find each document category.

| Directory | Purpose | Lifecycle |
|---|---|---|
| `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/` | Archived `spec-design`, planning, or `arch-design` artifacts. Archive before PR Ready. One subdirectory per PR; `docs/worklog/` is the single parent so listings stay grouped. | Permanent after PR merge |
| `docs/rules/` | Coding conventions, review checklists, naming / style decisions. | Long-lived, maintained |
| `docs/rules/review/` | Project-level custom reviewers; each file maps to one `deep-review` extension dimension, created by `reviewer-creator` and auto-discovered by `deep-review`. | Long-lived, maintained |
| `docs/rules/test/` | Project-level test rules, test-design constraints, and fixture conventions; `test-designer` or the main Agent must consult relevant files before writing or updating tests. | Long-lived, maintained |
| `docs/specs/` | **Default destination for `spec-design` and `arch-design` outputs.** Temporary working area for active specs / architecture designs / requirement clarifications during development. **Must be empty by PR Ready** — promote each spec to `docs/architecture/`, archive to `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/`, or delete. | Ephemeral during dev |
| `docs/architecture/` | Stable, long-lived design docs (module layouts, data flows, component responsibilities). | Long-lived |
| `docs/` (other categories) | Add one directory per new document category on demand: `CI/`, `onboarding/`, etc. One directory per category; don't mix. | Varies |

# Harness Principles

- **Enforce constraints via mechanisms, not prompts**: Core architectural rules should be enforced via linters / CI / type systems, not by relying on Agents to self-police.
- **The repo is the single source of truth**: What Agents can't access doesn't exist. External docs must be brought into the repo to count.
- **Independent Evaluation**: Test design for complex features and formal review must be done by independent agents; do not let an Agent evaluate its own work.
- **Continuously fight entropy**: Pay down tech debt incrementally — don't let it accumulate into painful cleanups.
- **Components are detachable**: Each workflow step encodes an assumption that "the model isn't good at this." Periodically reassess as model capabilities improve, changing one variable at a time.
- **Instruction files are directories, not encyclopedias**: Keep AGENTS.md / CLAUDE.md lean (~200 lines), serving as entry points and navigation. Detailed specs go in `docs/` topic files. Subsystems can have their own local instruction files. Use AGENTS.md as the primary file and create a `CLAUDE.md -> AGENTS.md` compatibility symlink (`ln -s AGENTS.md CLAUDE.md`) so different Agent frameworks read the same instructions.

# Agent Dispatch Principles

Choose the right level of delegation:

| Scenario | Approach |
|----------|----------|
| Single file fix, clear solution | Do it yourself |
| Parallel read tasks (search, analysis) | In-conversation subagents, no isolation needed |
| Multiple subagents write code | Invoke `incremental-impl` — it returns a slice plan when the dispatch gates pass |
| Need fresh perspective with zero context pollution | Independent Agent (e.g., Reviewer) |
| Cross-model blind spot coverage | Independent Agent (e.g., GPT reviews Claude's code) |

Key rules:

- **Isolate parallel writes**: Use an independent git worktree, or ensure changed file directories are fully independent.
- **Match model and effort to task**: Pick the model (Claude sonnet / opus, or Codex flagship / mini) and effort per task. Effort defaults: coding / agentic subagent tasks use `xhigh`; lightweight research can drop to `high`; translation, single-script execution, and other mechanical tasks can use `medium`.
- **Always specify completion criteria and output format** (shape + scope/length): the rule is "must be explicit" — the specific format is task-dependent (e.g., "summary ≤300 words", "punch list, one finding per line", "acceptance criteria", "structured JSON `{...}`", "one-paragraph verdict + one-line rationale"). Don't enumerate formats; pick the right one per task.
<!-- AURIGA:WORKFLOW:v1 END -->

<!-- Add your project-specific instructions below. The block above is managed by auriga-cli — it is replaced wholesale on upgrade, while anything here is preserved. -->
