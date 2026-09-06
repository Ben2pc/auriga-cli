<!-- AURIGA:WORKFLOW:v1 START — Managed block, maintained by auriga-cli. Do not edit by hand; upgrades replace it wholesale. Put project-specific instructions after the END marker below. -->
# auriga Workflow (v1.25.1)

Persist to the requested endpoint: research delivers evidence and recommendations, design a reviewable proposal, and implementation includes fixes and verification. Ready, merge, and deployment require authorization. Continue after status questions or corrections unless explicitly stopped.

Confirmed decisions and authorization persist within the task; phase changes, skill calls, and compaction do not require repeated approval. Confirm new product semantics, substantive architecture choices, or unauthorized operations before proceeding; silence is not approval.

1. Requirement clarification: For new or changed externally observable behavior, use `spec-design` first to judge value and align the goal from actual code and product evidence. **spec = why + observable what; arch design = structural how; plan = implementation steps**. A change that preserves the external behavior contract may skip the spec but can still need architecture clarification.

2. Architecture and planning: Use `arch-design` for substantive technical, domain model, or boundary decisions and confirm the design before implementation. Reuse an existing planning carrier; otherwise use `planning-with-files` for durable handoff and built-in Plan for other work. Ask only when unresolved preferences affect delivery. `goalify` can combine with either carrier and activates only when explicitly selected.

3. Git lifecycle: Use `git-workflow` when changing branches, commits, remotes, or pull-request state; run read-only queries directly as needed. Before coding, create a task branch from the agreed base, or reuse an existing correct task branch; never commit directly to the base branch. Prefixes: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/`. Within authorization, open a Draft PR after the first meaningful commit.

4. Tests and defects: New behavior, defect fixes, and refactors use `test-driven-development` to establish meaningful failing evidence or a behavior-protection net. For defects, use `systematic-debugging` to establish evidence and confirm the root cause before fix implementation.

5. Incremental implementation: For non-trivial implementation, use `incremental-impl` to first decompose the work into complete implementation units that are verifiable and integrable, then deliver them in dependency order.

6. Verify before claiming done: Completion claims require valid evidence after the last relevant change. Once applicable verification and required project checks pass, broaden or repeat checks only for new changes, failures, or concrete doubts. With file-based specs, follow `spec-design` to record delivery evidence in `validation-results.md`, excluding trial runs; otherwise report results and gaps in the conversation.

7. PR readiness: Mark Ready after verification and preparation through `git-workflow`. Reuse the agreed destination for temporary artifacts; otherwise the normal flow asks delete or archive via `AskUserQuestion` / `request_user_input`, while autonomous goals default to archiving through `goalify`. Use `documentation-management` for disposition and retain delivery evidence. A human decides when to archive cross-PR specs after all child PRs finish.

8. PR review: After Ready, projects without CI review must run a local `deep-review`; with CI review, let the user decide whether local review is also needed. “Run until Ready” includes the applicable first review and its handoff, without an automatic fix loop; an explicit state-only request ends at the state change. The skill owns routing, output, and rerun authorization.

## Quick Development Flow (bug fix / small refactor / small feature)

A task with one single clear outcome, no unresolved product or architecture decision, no cross-session tracking, and no need for multiple complete implementation units can proceed to coding preparation; otherwise select a planning carrier using the rules above. The quick flow still follows applicable requirement, architecture, testing, verification, and review requirements.

## Document Conventions

Repo documentation lives under `docs/`, one directory per purpose:

| Directory | Purpose | Lifecycle |
|---|---|---|
| `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/` | Design and delivery evidence archived by PR | Permanent |
| `docs/rules/` | Coding conventions, review checklists, naming decisions | Long-lived |
| `docs/rules/review/` | Project custom reviewers; created by `reviewer-creator`, auto-discovered by `deep-review` | Long-lived |
| `docs/rules/test/` | Project test rules; `test-driven-development` reads them before tests are written | Long-lived |
| `docs/rules/spec/` | Project spec rules; `spec-design` must consult during research | Long-lived |
| `docs/rules/arch/` | Project architecture rules; `arch-design` treats them as hard constraints | Long-lived |
| `docs/specs/` | Default destination for `spec-design` / `arch-design` outputs; ephemeral dev workspace. **Must be empty by PR Ready**: promote to `docs/architecture/`, archive to worklog, or delete | Dev-only |
| `docs/long-running-specs/` | Specs and design inputs still referenced across PRs; exempt from individual PR cleanup | Human disposition after all child PRs finish |
| `docs/architecture/` | Stable design docs + ADRs (`ADR-<n>-<title>.md`) | Long-lived |

## Harness Principles

- **Enforce constraints via mechanisms, not prompts**: core rules belong in linters / CI / type systems / hooks.
- **Keep durable facts in the repository**: current facts, plans, and design decisions needed across sessions must live in versioned assets that Agents can access.
- **Keep durable references self-contained**: Code comments and instructions describe the underlying requirement concisely instead of citing spec identifiers that may be archived or deleted.
- **Continuously fight entropy**: when handling review findings, allow directly necessary, behavior-preserving local cleanup with known, low risk. Independent refactoring requires separate authorization.
- **Layer context, load on demand**: The root `AGENTS.md` holds global rules and an index; each independent subpackage maintains its own `AGENTS.md` and `CLAUDE.md -> AGENTS.md`. Runtimes differ in loading scope, so the parent must provide a one-line index. Read `documentation-management` for layering and artifact disposition.

## Agent Dispatch Principles

- The current Agent handles simple tasks, shared state, and sequential decisions; delegate independent work only when it saves time or improves quality.
- For multiple writers, use `incremental-impl` to define file ownership, dependencies, integration order, and isolation. Parallel writers use separate worktrees or fully disjoint directories.
- Default to internal Agent tools. Invoking an external command-line Agent requires explicit user authorization, even when internal models or capabilities are insufficient.
- Specify inputs, scope, outputs, and completion criteria when delegating; the primary Agent verifies key evidence and coverage. Select models and reasoning effort by task risk and runtime capabilities.

## Communication

Lead with conclusions and impact, then necessary evidence; match technical explanations to the user’s background. When a skill causes a pause, identify the file and rule, explain applicability, and distinguish explicit requirements from your own judgment.

<!-- AURIGA:WORKFLOW:v1 END -->

<!-- Add your project-specific instructions below. The block above is managed by auriga-cli — it is replaced wholesale on upgrade, while anything here is preserved. -->
