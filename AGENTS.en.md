<!-- AURIGA:WORKFLOW:v1 START — Managed block, maintained by auriga-cli. Do not edit by hand; upgrades replace it wholesale. Put project-specific instructions after the END marker below. -->
# auriga Workflow (v1.9.0)

1. Requirement Clarification: Use `spec-design` to clarify requirements for new features. **Requirements should focus on "what to do" and acceptance criteria, not specific technical paths.** For product features, prioritize "Why" and let the implementation-stage Agent decide how. **spec = why + what; plan = how.** If a change does not move the external behavior contract (refactor, algorithm swap, library replacement with same observable behavior), skip spec and go directly to plan.

2. Planning: After clarification, run a **scope triage** before choosing a planning method. Apply the Quick Development Flow (see "Quick Development Flow" section below; skip planning and continue at the pre-coding / branch-creation phase) **only when all three predicates hold**: (a) the work fits within a single module or one cohesive concept; (b) acceptance criteria fit in ≤5 bullets; (c) no cross-boundary interface changes (public APIs, schemas, shared modules). Record the triage verdict in the task tracker (e.g., "scope triage → QDF: single module, 3 acceptance bullets, no interface change"). If any predicate fails or you're unsure, take the full path. First decide explicitly — and state the verdict — whether the work is architecture-heavy (spans modules, restructures module boundaries, or the *how* is non-obvious); if so, run `arch-design` first — a precursor to execution tracking, not a replacement, and the entry point for standalone architecture refactors that skip spec. Then use `AskUserQuestion` to pick an execution-tracking method, presenting the full menu rather than a default pair: built-in Plan (medium complexity), `planning-with-files` (long-running, persistent tracking), or `goalify` (autonomous `/goal` run). Plans, design decisions, and tech debt should be versioned artifacts in the repo for subsequent Agent context.

3. Pre-coding 1: **Create a development branch from main before writing code.** All commits go on the branch — never commit directly to main. Branch naming: `feat/` (feature), `fix/` (bugfix), `docs/` (documentation), `refactor/` (refactoring), `chore/` (chores). Use the `git-workflow` skill (bundled with the `auriga-workflow` plugin) for all git/gh operations (branch, commit, PR create/ready, post-review).

4. Pre-coding 2: After creating the development branch and making the first meaningful commit, create a Draft Pull Request early so CI, scope discussion, and incremental feedback can start before implementation is complete.

5. Pre-coding 3: When encountering bugs, test failures, or unexpected behavior, follow `systematic-debugging` to find root cause before fixing.

6. TDD: All code changes follow `test-driven-development` (sole exception defined in the Quick Development Flow section: pure docs / pure config). Write a failing test first, then minimal implementation, then regression verification. **Define testable acceptance criteria before each task** (specific features + acceptance conditions + edge cases) — don't check at the end. Invoke the `test-designer` skill when **any** of: (a) requirement spans ≥2 modules with non-obvious interactions; (b) edge cases would be hard for the implementation Agent to fairly self-test; (c) you'd otherwise skip TDD because "the implementation looks more obvious than the tests". The skill encodes **Independent Evaluation**, dispatching a context-free agent that sees only the requirement and code paths (not the implementation approach) and returns executable failing tests at highest reasoning effort.

7. Incremental Implementation: During the green phase, invoke `incremental-impl` for any non-trivial implementation work — multi-file changes, refactors spanning files, executing a planned task (from any planning source: built-in Plan, `planning-with-files`, `spec-design` spec, `arch-design`'s arch_design.md, or direct user request), cross-cutting modifications, or when about to write more than ~100 lines. The skill owns size triage (XS–XL), slicing strategy, optional parallel subagent dispatch, and per-slice execution discipline — see the skill itself for the rules. Skip only when the skill's own size gate marks the work XS, or when the change is pure documentation / pure configuration.

8. Post-coding: Before any "done / fixed / ready to commit / ready for review" judgment, run and check full verification per `verification-before-completion`. Run the affected automated tests and any needed browser, UI, or mobile interaction checks; do not rely on implementation inspection alone.

9. PR Readiness: Keep the PR in Draft until verification is complete, the base branch is confirmed, and the PR description is updated with the five elements — scope, acceptance criteria, design decisions, risks, and remaining TODOs. Then mark the PR Ready for Review. If `spec-design`, `arch-design`, or `planning-with-files` produced design docs (`spec.md`, `arch_design.md`), findings.md, progress.md, task_plan.md, etc., use `AskUserQuestion` to ask the user: delete or archive to `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/` for traceability.

10. PR Review: Early feedback may happen on a Draft PR. After the PR is Ready for Review, formal review must use the `deep-review` skill (bundled in the `auriga-workflow` plugin). `/review` remains as a lightweight fallback. **Reviewer Agents must report every finding with severity + confidence, not pre-filter by importance** — strong reasoning models follow "only report high-severity" type instructions literally, which lowers recall on real bugs; let the human do the filtering.

11. Post-merge Compounding: Immediately after the PR is merged, use `AskUserQuestion` to proactively ask whether to run the `session-compound` skill. It compounds the current session into a self-contained HTML report (narrative timeline + token / cache / tool health + a playground panel with checkable candidate items for ecosystem-skill installs / AGENTS.md edits / new-skill gaps) so insights from this session land in the right place rather than evaporating. Ask once per merge; don't run silently, and don't re-prompt if the user declines.

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
| `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/` | Archived session-ephemeral planning artifacts (`findings.md`, `progress.md`, `task_plan.md`, design specs). Created at the PR-readiness phase when the PR is marked Ready for Review. One subdirectory per PR; `docs/worklog/` is the single parent so listings stay grouped. | Permanent after PR merge |
| `docs/rules/` | Coding conventions, review checklists, naming / style decisions. | Long-lived, maintained |
| `docs/specs/` | **Default destination for `spec-design` and `arch-design` outputs.** Temporary working area for active specs / architecture designs / requirement clarifications during development. **Must be empty by PR Ready** — promote each spec to `docs/architecture/` (long-lived reference), archive to `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/` (historical trace), or delete. Enforced by `pr-ready-guard` on both `gh pr ready` and `gh pr create` without `--draft`. | Ephemeral during dev |
| `docs/architecture/` | Stable, long-lived design docs (module layouts, data flows, component responsibilities). New entries usually arrive by promotion from `docs/specs/`. | Long-lived |
| `docs/` (other categories) | Add one directory per new document category on demand: `runbooks/` (ops procedures), `adr/` (architecture decision records), `onboarding/`, etc. One directory per category; don't mix. | Varies |

# Harness Principles

- **Enforce constraints via mechanisms, not prompts**: Core architectural rules should be enforced via linters / CI / type systems, not by relying on Agents to self-police.
- **The repo is the single source of truth**: What Agents can't access doesn't exist. External docs must be brought into the repo to count.
- **Independent Evaluation**: Test design for complex features and formal review must be done by independent agents; do not let an Agent evaluate its own work.
- **Browser workflows are not only post-coding verification**: When a task needs opening or navigating pages, inspecting local web UI, reproducing browser bugs, checking interactions, capturing screenshots, or designing and running browser end-to-end scenarios, prefer `Browser Use`. Use `playwright-cli` when the value is a repeatable scripted browser regression suited for CI. Use `Computer Use` for mobile simulator or native app UI automation.
- **Continuously fight entropy**: Pay down tech debt incrementally — don't let it accumulate into painful cleanups.
- **Components are detachable**: Each workflow step encodes an assumption that "the model isn't good at this." Periodically reassess as model capabilities improve, changing one variable at a time.
- **Instruction files are directories, not encyclopedias**: Keep AGENTS.md / CLAUDE.md lean (~100 lines), serving as entry points and navigation. Detailed specs go in `docs/` topic files. Subsystems can have their own local instruction files. When everything is important, nothing is — information overload causes Agents to pattern-match locally rather than understand globally. Use AGENTS.md as the primary file and create a `CLAUDE.md -> AGENTS.md` compatibility symlink (`ln -s AGENTS.md CLAUDE.md`) so different Agent frameworks read the same instructions.

# Agent Dispatch Principles

Choose the right level of delegation:

| Scenario | Approach |
|----------|----------|
| Single file fix, clear solution | Do it yourself — no subagent overhead |
| Parallel read tasks (review, search, analysis) | In-conversation subagents, no isolation needed |
| Single subagent writes code | In-conversation subagent, no isolation needed |
| Multiple subagents write code | Invoke `incremental-impl` — it returns a slice plan when the parallel-dispatch gates pass, then dispatch with `isolation: "worktree"` per plan |
| Need fresh perspective with zero context pollution | Independent Agent (e.g., test design at the TDD red phase) |
| Cross-model blind spot coverage | Independent Agent (e.g., GPT reviews Claude's code) |
| Unsure which approach fits | `AskUserQuestion` — present options with your recommendation |

In-conversation subagents share the main Agent's working directory. Key rules:

- **Isolate parallel writes**: Parallel code writing **must** use `isolation: "worktree"`; single writer needs no isolation. Slicing decisions (axis, granularity, parallel-or-not, collision merging, size filtering) live in the `incremental-impl` skill. When its dispatch gates aren't met the skill terminates the parallel path and the main Agent writes inline.
- **Match model and effort to task**: Pick the model (Claude sonnet/opus, or Codex flagship/mini) and effort per task. **Effort defaults: `xhigh` for coding / agentic subagent writes; `high` for design + formal review; `medium` only for short scoped lookups; `max` only when `xhigh` under-thinks.** Strong reasoning models strictly respect `low`/`medium` — under-thinking risk on complex tasks at those levels.
  - ✅ "Add input validation to `parseArgs()` in cli.ts" → sonnet @ xhigh
  - ✅ "Design the plugin dependency resolution strategy" → opus @ xhigh
  - ✅ Complex review with many architectural trade-offs → Codex flagship @ high for cross-model blind spot coverage
- **Always specify the output format** (shape + scope/length): a subagent without a format contract will dump verbose context back, cancelling the context benefit of dispatching. The rule is "must be explicit" — the specific format is task-dependent (e.g., "summary ≤300 words", "punch list, one finding per line", "diff + one-line rationale each", "structured JSON `{...}`", "one-paragraph verdict + one-line rationale"). Don't enumerate formats; pick the right one per task.
<!-- AURIGA:WORKFLOW:v1 END -->

<!-- Add your project-specific instructions below. The block above is managed by auriga-cli — it is replaced wholesale on upgrade, while anything here is preserved. -->
