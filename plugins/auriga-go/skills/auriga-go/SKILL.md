---
name: auriga-go
description: Drives the project's CLAUDE.md development workflow forward one or many phases. Trigger when the user invokes `/auriga-go`, uses a phrase explicitly naming the workflow ("按照工作流继续", "按工作流走", "drive the workflow", "workflow autopilot", "where are we in the workflow", "我们的 workflow 走到哪了"), resumes after `/clear`, or workflow drift is visible (commits on main, no Draft PR, missing branch prefix). NOT for plain "继续" / "continue" / "next" / "下一步" / "what's next" (those mean the current task, not workflow navigation), single-question lookups, one-off git commands, or exploratory discussion.
argument-hint: "[step|auto]"
---

# auriga-go — Workflow Autopilot

Inspect state, identify the next workflow step, drive forward. Reminder-based: tells the main Agent which skill to invoke next; does not dispatch skills itself.

**`CLAUDE.md` is the authoritative workflow.** Re-read it at invocation time; this file does not encode the step list.

## When to Use

- `/auriga-go` invoked explicitly
- User phrasing clearly references the workflow itself: "按照工作流继续", "按工作流走", "drive the workflow", "workflow autopilot", "where are we in the workflow", "我们的 workflow 走到哪了"
- Session just resumed (`/clear` or compaction) AND the previous workflow step is unclear AND the user wants to navigate by workflow
- Workflow drift is evident: commits on `main`, no Draft PR, branch without `feat/`/`fix/`/`docs/` prefix, code before a spec

## Don't Use For

- Plain "继续" / "continue" / "next" / "下一步" / "what's next" — refer to the current task
- Single-question lookups, one-off commands (commit/push/open PR), exploratory discussion
- Tasks outside the auriga workflow

## Modes

| Mode | Behavior |
|---|---|
| `step` | One workflow step → return |
| `auto` (default) | Loop steps until a hard stop |

## Arguments

Invocation: `/auriga-go [mode]` or natural-language trigger.

Parse `$ARGUMENTS`:

- Empty → `auto`
- First token is `step` / `auto` → use as mode
- Natural-language text with no mode keyword → `auto`, text as task context

| User types | `$ARGUMENTS` | Resolved |
|---|---|---|
| `/auriga-go` | (empty) | auto |
| `/auriga-go step` | `step` | step |
| `按照工作流继续` | `按照工作流继续` | auto |

## Algorithm (step + auto)

```
loop:
  1. Read current state
  2. Identify next workflow step (check Stop Contract here)
  3. Record the step in your Agent's native task/todo tracker
  4. Recommend next action to main Agent
  5. step → return; auto → continue
```

### Read current state — probe in order; stop at first unambiguous answer

1. Main Agent context — native task tracker, in-flight task description, recent tool results
2. `task_plan.md` / `progress.md` (if `planning-with-files` is active)
3. Open Draft PR body TODOs (`gh pr view --json body`, scan for `- [ ]`)
4. Repo state heuristics — git branch prefix, `gh pr list --draft`, `git rev-list @{u}..HEAD`, `docs/specs/*.md` presence, recent test/verification commands

If sources 2–4 were needed → run the **Confirmation Contract** below before proceeding.

### Identify next workflow step

Match current state to a phase in `CLAUDE.md`; pick the earliest unfinished phase applicable to the current work. Apply `CLAUDE.md`'s Quick Development Flow exception when appropriate.

### Record the step

Use your Agent's native task/todo tool. If the Agent has none, announce in natural language ("Working on TDD phase — writing the failing test for X") before the first tool call. Never silently begin.

### Recommend next action

Name the phase (in `CLAUDE.md`'s own terms) + the action or skill to invoke. Examples: "requirement clarification phase → invoke `spec-design`", "TDD red phase → invoke `test-designer` with the validation contract", "formal review phase → invoke `deep-review`". The main Agent executes.

**Mandatory emissions before recommending green-phase code work** — at the TDD red phase + incremental-impl size gate named in CLAUDE.md. Both must be recorded in the task tracker as a single line each, *before* recommending any Write/Edit on production code:

1. Size estimate: `Size: <XS|S|M|L|XL> (AC=<n>, concerns=<n>, ~<n> lines)` — the input `incremental-impl`'s Step 1 size gate keys off of (three-axis judgment from CLAUDE.md's incremental implementation phase).
2. `test-designer` applicability: `Y/N — <one-line reason>` — the TDD-phase test-designer-applicability judgment (predicates a/b/c in the CLAUDE.md TDD phase).

These exist so the **skip** decisions at those two phases are auditable. CLAUDE.md's own escape hatches ("skip the skill only for trivial XS work and for pure documentation / configuration changes" for incremental-impl, the optional test-designer predicates for TDD) are legitimate; what is not legitimate is skipping silently. If either emission is missing when green-phase code lands, treat it as workflow drift on the next pass.

## Stop Contract

Hard-stop and return control to the user in exactly two situations:

1. **Ambiguity that needs a human answer** — requirement gap, design choice with equally-valid paths, missing info no probing can resolve
2. **Destructive / irreversible operations** — force-push to shared refs, main-branch writes, broad `rm -rf`, package publishes (`npm publish`, `gh release create`), CI/CD pipeline mutations, anything that affects other developers or production

In both cases, explain why you stopped and what you need. Never silently exit.

Push-forward otherwise:

- `AskUserQuestion`-style choices with a reasonable default → take the default
- Test failures → invoke `systematic-debugging` and continue
- Small structural decisions → pick one, note it in the tracker, move on

## Confirmation Contract (fallback path only)

When current-state inference came from sources 2–4, present findings and confirm **before proceeding**:

```
State inference (sources: [task_plan.md / Draft PR body / git heuristics]):
- <signal> → <inference>
- ...
Inferred position: <phase>. Next action: <action>. Proceed?
```

Skip if source 1 was sufficient.

## Anti-patterns

- ❌ Dispatching other skills from inside auriga-go — recommend only
- ❌ Silently starting work — always record the phase in the task tracker first
- ❌ Proceeding past a fallback inference without running the Confirmation Contract
- ❌ Bypassing the Stop Contract for "small" destructive ops
- ❌ Entering green phase without emitting the size estimate + `test-designer` applicability lines (the TDD + incremental-impl skip-or-go decisions must be auditable)

## Example invocations

### Resume after `/clear`

```
User: continue the workflow

Agent (auriga-go, auto):
  State inference (sources: git + Draft PR):
  - Current branch feat/X + Draft PR #N → branch + Draft PR created
  - docs/specs/X.md exists → requirement clarification done
  - No recent test run → verification not started
  Inferred position: TDD phase. Proceed?

User: yes

Agent (auriga-go, auto):
  [records "TDD phase — invoke test-designer on docs/specs/X.md"
   as a task in the native tracker, then invokes test-designer]
```

### Step mode

```
User: /auriga-go step

Agent (auriga-go, step):
  [records "PR readiness phase — push + update PR body" as a task]
  Suggested command: git push && gh pr edit --body-file <updated body>. Proceed?
```

### Hard stop on ambiguity

```
Agent (auriga-go, auto):
  [task tracker shows "review-findings phase — triage deep-review punch list"]

  Stop: deep-review returned 3 blocking findings. #2 requires an architectural
  refactor (src/skills.ts); convention is that high-risk architectural changes
  should be tracked as separate issues, not bundled into this PR. Need
  confirmation: fix inside this PR, or open a tracking issue?
```
