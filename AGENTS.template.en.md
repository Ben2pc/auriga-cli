<!-- AURIGA:WORKFLOW:v1 START — Managed block, maintained by auriga-cli. Do not edit by hand; upgrades replace it wholesale. Put project-specific instructions after the END marker below. -->
# auriga Workflow (v1.21.0)

1. Requirement clarification: For new or changed externally observable behavior, use `spec-design` first to judge value and align the goal from actual code and product evidence. **spec = why + observable what; arch design = structural how; plan = implementation steps**. A change that preserves the external behavior contract may skip the spec but can still need architecture clarification.

2. Architecture and planning: Use `arch-design` when the technical approach is non-obvious, boundaries must change, an existing architecture is being improved, or a domain model needs clarification; substantive designs require user approval before implementation. When planning is needed, ask the user to choose either built-in Plan or `planning-with-files` before implementation. `goalify` is an autonomous execution mode that can combine with either planning carrier and activates only when the user explicitly selects it.

3. Git lifecycle: Create a task branch from the repository's agreed base branch before writing code; never commit directly to the base branch. Prefixes: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/`. Route all git/gh operations through `git-workflow`, and open a Draft PR after the first meaningful commit.

4. Tests and defects: New behavior, defect fixes, and refactors use `test-driven-development` to establish meaningful failing evidence or a behavior-protection net. For defects, use `systematic-debugging` to establish evidence and confirm the root cause before fix implementation.

5. Incremental implementation: For non-trivial implementation, use `incremental-impl` to first decompose the work into complete implementation units that are verifiable and integrable, then deliver them in dependency order.

6. Verify before claiming done: Any "done, fixed, passing, or ready for review" judgment must be based on verification results that match the claim and were obtained after the last relevant change; when evidence is insufficient, state the gap.

7. PR readiness: Mark Ready only after completing verification and PR preparation through `git-workflow`. For design artifacts scoped to the current PR (spec.md, task_plan.md, etc.), use `AskUserQuestion` / `request_user_input` to ask the user: delete or archive to `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/`. A program spec spanning multiple PRs may remain under `docs/long-running-specs/` and does not participate in the Ready cleanup gate; a human decides when to archive it after all child PRs finish.

8. PR review: After Ready, projects without CI review must run a local `deep-review`; with CI review, let the user decide whether local review is also needed. The skill owns routing, output, and rerun authorization.

## Quick Development Flow (bug fix / small refactor / small feature)

When a task has one single clear outcome, no unresolved product or architecture decision, no need for cross-session tracking, and no need to split into multiple complete implementation units, it may skip planning-carrier selection and proceed directly to implementation. Otherwise choose built-in Plan or `planning-with-files` before implementation. The quick flow never bypasses applicable requirement clarification, architecture approval, testing, verification, or review.

## Document Conventions

Repo documentation lives under `docs/`, one directory per purpose:

| Directory | Purpose | Lifecycle |
|---|---|---|
| `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/` | Archived spec / planning / architecture artifacts; one subdirectory per PR | Permanent |
| `docs/rules/` | Coding conventions, review checklists, naming decisions | Long-lived |
| `docs/rules/review/` | Project custom reviewers; created by `reviewer-creator`, auto-discovered by `deep-review` | Long-lived |
| `docs/rules/test/` | Project test rules; `test-driven-development` reads them before tests are written | Long-lived |
| `docs/rules/spec/` | Project spec rules; `spec-design` must consult during research | Long-lived |
| `docs/rules/arch/` | Project architecture rules; `arch-design` treats them as hard constraints | Long-lived |
| `docs/specs/` | Default destination for `spec-design` / `arch-design` outputs; ephemeral dev workspace. **Must be empty by PR Ready**: promote to `docs/architecture/`, archive to worklog, or delete | Dev-only |
| `docs/long-running-specs/` | Program specs, shared constraints, slice order, and status matrices spanning multiple PRs; acceptance contracts unique to the current PR still belong in `docs/specs/` | Cross-PR; archived manually after all child PRs finish |
| `docs/architecture/` | Stable design docs + ADRs (`ADR-<n>-<title>.md`) | Long-lived |

## Harness Principles

- **Enforce constraints via mechanisms, not prompts**: core rules belong in linters / CI / type systems / hooks.
- **Keep durable facts in the repository**: current facts, plans, and design decisions needed across sessions must live in versioned assets that Agents can access.
- **Continuously fight entropy**: when deciding how to handle review findings, pay down small, certain, low-risk technical debt without expanding the current change's scope.
- **Layer context, load on demand**: a rule belongs to the scope it actually governs; keep the root `AGENTS.md` to global rules and an index. A subpackage, or a directory with its own toolchain and conventions, maintains its own `AGENTS.md` plus a `CLAUDE.md -> AGENTS.md` compatibility symlink. Runtimes differ in how much of a sub-scope they auto-load, so anything pushed down must also be pointed at by a one-line index in the parent `AGENTS.md` — never assume it will be read automatically. See `documentation-management` for the layering criteria.

## Agent Dispatch Principles

- The current Agent handles simple, clear work; prefer runtime-native subagents for independent read-only tasks.
- For multiple writers, use `incremental-impl` to define file ownership, dependencies, integration order, and isolation. Parallel writers use separate worktrees or fully disjoint directories.
- Use an external Agent only when the user explicitly requests a separate process or the task genuinely needs a cross-model, context-clean perspective.
- Dispatch with an explicit result, scope, verification method, and output contract. Choose model and reasoning effort by task risk, overriding them only when the runtime supports it.

<!-- AURIGA:WORKFLOW:v1 END -->

<!-- Add your project-specific instructions below. The block above is managed by auriga-cli — it is replaced wholesale on upgrade, while anything here is preserved. -->
