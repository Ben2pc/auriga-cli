---
name: incremental-impl
description: Plan a non-trivial code change end-to-end — size triage (XS–XL), slicing strategy, optional parallel subagent dispatch, per-slice Implement → Test → Verify → Commit discipline. Use for any multi-file change, refactor across files, executing a planned task from any planning source, cross-cutting modification (analytics sweep / i18n / library migration), or when about to write more than ~100 lines. 也用于增量实现 / 切片落地 / 推进已规划任务 / 跨切面改动。Skip only for trivial XS edits and pure documentation / configuration changes.
---

# Incremental Implementation

Pairs with planning. **Plan** sets direction and constraints (what to build, acceptance criteria). **This skill** decides how to execute: size, slice, dispatch, verify.

## When to Use

Invoke for **any non-trivial implementation work**:

- Multi-file feature implementation
- Refactoring spanning multiple files
- About to write more than ~100 lines
- Executing a planned task (from any planning source — see Inputs)
- Cross-cutting changes (analytics sweep, i18n pass, library migration)

**Skip only for:**

- Single-file, single-function edits where slicing makes no sense
- Pure documentation / config changes with no code logic

## Inputs

- A task or spec from any planning source — built-in Plan, `planning-with-files`'s `task_plan.md`, a `brainstorming` spec under `docs/specs/`, or a task description from the user. The skill is agnostic to how the task was produced.
- Acceptance criteria — what "done" looks like for this slice of work

If acceptance criteria are missing or vague, return control to planning before continuing. Implementation needs a target.

## Step 1: Size Gate

Three axes, **take the higher size** when they disagree:

| Size | Acceptance criteria | Distinct concerns | Est. diff lines | Skill behavior |
|---|---|---|---|---|
| **XS** | 1 | 1 | <30 | Skip this skill; just write it |
| **S** | ≤2 | 1–2 | 30–100 | Apply execution discipline; do not slice |
| **M** | ≤3 | Multiple within 1 feature | 100–300 | Pick slicing strategy + single writer + execution discipline |
| **L** | 4–6 | Cross-component | 300–800 | Pick slicing strategy + **evaluate parallel dispatch** + execution discipline |
| **XL** | >6 | Spans independent subsystems | >800 | **Return to plan.** Too large to implement in one entry |

A "concern" is one cohesive responsibility unit — a component, module, or single behavior.

**Why take the higher size when axes disagree:** under-categorizing (treating a real L as M) causes mid-flight merge conflicts and broken intermediate states. Over-categorizing wastes some ceremony. The asymmetric cost favors caution.

**Examples:**

- "Add 12 analytics events, 2 lines each across 12 files" → AC=1, concerns=1 (analytics), <30 lines → **XS**
- "One SwiftUI View, 400 lines, 5 subviews + state" → AC=3, concerns=1, >300 lines → **M** (diff lines escalate)
- "Refactor auth middleware + update 3 callers + add tests" → AC=4, cross-component, ~400 lines → **L**

## Step 2: Pick Slicing Strategy

Run this decision tree top-to-bottom; first match wins.

**Q1: Is this a greenfield 0→1 first cut?**
→ **Walking Skeleton.** A single thin vertical path through every layer (data → service → UI → test), just enough to prove the architecture connects. Then thicken.

**Q2: Is this "modify the same thing across many places" (analytics sweep, i18n, lint pass, mass refactor, design system rollout)?**
→ **Horizontal sweep.** Single layer, many files, one cohesive change. One commit per logical group.

**Q3: Is this a large architectural migration (UIKit→SwiftUI, sync→async, framework swap)?**
→ **Branch by Abstraction.** Introduce a temporary abstraction layer, move implementations under it one at a time, retire the old path. Horizontal in shape but explicitly transitional.

**Q4: Adding a new self-contained feature or fixing a bug?**
→ **Vertical slice.** Model + business logic + view + tests in one cohesive change. Default for "add a new X" work in an existing codebase.

**Fallback:** Vertical slice.

**Common confusion:** "Vertical vs horizontal" is the slicing axis. "Serial vs parallel" is the writer count. They are orthogonal — vertical slices can be dispatched in parallel (three independent bug fixes across three files), and horizontal sweeps usually run serially.

## Step 3: Parallel Dispatch (Conditional — L size only)

Skip this section for XS / S / M sizes. They run as a single writer.

For L size, decide whether to dispatch slices to parallel subagents.

### The Iron Law

A slice plan is valid only when **every slice has independent inputs and independent outputs.** If two slices can collide — on the same file, on a shared data structure, or on shared mid-execution state — they are not parallel. Merge them into one writer, or serialize them.

### 3.1 Slice-ability check

Ask: can this task be cut into pieces whose inputs and outputs don't overlap?

- ✅ "Fix three independent bugs in three different files, each with its own test" — fully independent
- ✅ Greenfield: build store, service, ui as separate slices — only if no shared mid-execution state
- ❌ "Refactor utils.ts and update all callers" — cascading edits, serialize
- ❌ "Add retry to exec, then migrate callers to use it" — pipeline, not parallel

If no, **terminate parallel dispatch** and proceed as single writer.

### 3.2 Draft file assignments

For each candidate slice, list:

- Files it creates / modifies / deletes
- What it needs from other slices as input (paths, signatures, data shapes)
- What it produces as output (diff, new files, state change)

### 3.3 Collision check → merge

For every file that appears in more than one slice:

- Even append-only edits to the same file → merge to one writer (concurrent edits to adjacent lines produce conflicts)
- Edits that overlap semantically → merge

### 3.4 Size filter

For each remaining slice, estimate diff lines:

- **<50 lines** → drop from dispatch; main Agent handles inline. Dispatch overhead (worktree, context, merge) outweighs gain
- **50–150 lines** → dispatch candidate
- **>150 lines or architectural** → dispatch + note "stronger reasoning model at xhigh effort" on the slice

**Minimum-slices gate:** if fewer than 3 dispatchable slices remain after filtering, **terminate parallel** and serialize through the main Agent. Below 3 writers, ceremony cost > parallelism gain.

### 3.5 Output contract + verify command per slice

For every dispatched slice, decide:

- **Output format** the subagent must return (unified diff + rationale / full file + role / config section verbatim / test file + requirement map)
- **Verify command** the main Agent will run when the diff comes back (`npm test -- path`, `tsc --noEmit`, build for affected package, minimal smoke test)

Without an output format, the subagent dumps verbose context and cancels the dispatch benefit. Without a verify command, the main Agent accepts whatever the subagent claims and merges blind.

### 3.6 Emit the dispatch plan

| Slice | Writer | Model | Files | Depends on | Output format | Verify |
|---|---|---|---|---|---|---|
| 1 | subagent | inherit | `src/x.ts` | — | diff + rationale | `npm test -- x` |
| 2 | subagent | inherit | `src/y.ts` | slice 1 signature | diff + rationale | `npm test -- y` |
| 3 | main Agent | — | `src/z.ts` | slice 1 complete | (inline) | `npm test` |

**Model column contract:** default `inherit` — subagent uses the main Agent's current model. Override only when the caller has a reason: user named a specific model, slice is architectural and benefits from stronger reasoning at `xhigh` effort, or slice is mechanical and can drop to a cheaper model. Write overrides as neutral phrases (`stronger reasoning model, xhigh effort`) rather than specific model names unless the user named one.

The main Agent dispatches parallel slices in a single message with multiple `Agent` tool calls, each with `isolation: "worktree"`. Gated slices run after their deps complete.

## Step 4: Execution Discipline (Per Slice)

Applies to **every** slice that runs through the skill — single-writer or dispatched. (XS work bypasses the skill entirely per Step 1, so 4.1's cycle is reached only for S size and above.)

### 4.1 Increment Cycle

```
Implement → Test → Verify → Commit → Next slice
```

This is the core loop. Each slice runs the full cycle before moving on.

- **Implement** the smallest complete piece of functionality for this slice
- **Test** — run the relevant test suite, or write a failing test first per `test-driven-development`
- **Verify** — tests pass, build succeeds, type checks clean, manual check where applicable
- **Commit** — one atomic commit per slice (see `git-workflow` for commit message rules)
- **Next slice** — carry forward, don't restart

Each slice leaves the system in a working, testable state. No half-done slices.

### 4.2 Simplicity First

Before writing, ask **"what is the simplest thing that could work?"**

After writing, self-audit:

- Could this be fewer lines?
- Is each abstraction earning its complexity for *this* task, or for an imagined future?
- Three similar lines is better than a premature abstraction

Aligns with the root principle "如无必要勿增实体 / don't add features, refactor, or introduce abstractions beyond what the task requires".

### 4.3 Scope Discipline

Touch only what the task requires. Do not:

- "Clean up" code adjacent to your change
- Refactor imports in files you're not modifying
- Modernize syntax in files you're only reading
- Remove comments you don't fully understand

If you notice something worth improving outside the task scope, **record it but don't fix it**:

```
NOTICED BUT NOT TOUCHING:
- src/utils/format.ts has an unused import (unrelated to this task)
- Auth middleware could use better error messages (separate task)
```

Surface these to the user at the end of the slice; let them decide whether to spin off a task.

### 4.4 Keep Compilable Between Slices

After each slice's commit, the project must build and existing tests must pass. Do not leave the codebase broken between slices. If a slice naturally produces an intermediate broken state, the slice boundary is wrong — re-cut it.

### 4.5 Rollback-Friendly

Each slice's commit should be independently revertable.

- Additive changes (new files, new functions) revert easily
- Modifications stay minimal and focused
- DB migrations have rollback migrations
- **Never delete-and-replace in the same commit** — split into two commits

See `git-workflow` for atomic commit rules; this rule extends them with the delete-replace constraint.

### 4.6 Risk-First Execution Order

When multiple slices are non-blocking (no inter-slice dependency forcing order), do the most uncertain slice first. If the riskiest slice fails, you discover it before investing in dependents.

Examples:

- WebSocket integration before features that ride on it
- Third-party SDK adoption before features built on top
- Untested platform API before production logic using it

Risk-first is **execution order**, not slicing axis. It composes with both vertical and horizontal slicing.

### 4.7 Don't Repeat Useless Commands

If a command (build, test, type check) ran successfully and the code hasn't changed since, don't re-run it. Re-running on unchanged code adds no information and burns context. Re-run only after edits that could affect the command's result.

## Anti-patterns

- ❌ Starting implementation without checking size (Step 1) — leads to over-slicing trivial work or under-slicing L-sized features
- ❌ Forcing parallel dispatch on a task with cascading edits — Iron Law violation
- ❌ Picking horizontal sweep for "add a new feature" — sweep is for cross-cutting modifications, not greenfield additions
- ❌ Slicing too small to parallelize just to have more slices — Step 3.4 size filter is not optional
- ❌ Skipping verify between slices to move faster — bugs compound; a bug in slice 1 makes slices 2–5 wrong
- ❌ Mixing unrelated concerns in one commit — see `git-workflow`
- ❌ "Cleaning up adjacent code while I'm here" — scope discipline violation (4.3)
- ❌ Dispatched slice without anti-hardcoding guard — subagent in isolation may hardcode values or weaken tests to turn green. The main Agent's dispatch prompt should carry: "implement the general logic; do not hardcode values or weaken tests; if a test looks wrong, surface it instead of patching around it"
- ❌ Attempting to coordinate subagents mid-flight via shared state — no current CLI runtime (Claude Code, Codex CLI, etc.) has an agent-to-agent channel; serialize through the main Agent or merge into a single-writer slice

## Relationship to other skills

- Upstream planning sources (any of) — built-in Plan, `planning-with-files`, `brainstorming`, or a direct user-given task; this skill is agnostic to the source
- `test-driven-development` — governs the red→green cycle within Step 4.1
- `test-designer` — may produce the failing tests this skill's green phase satisfies
- `systematic-debugging` — runs if any slice's result breaks regression
- `verification-before-completion` — final gate after all slices merge
- `git-workflow` (auriga-git-guards plugin) — atomic commit rules referenced by 4.5
