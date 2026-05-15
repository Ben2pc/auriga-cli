---
name: deep-review
description: Run a formal, multi-dimensional code review of a pull request. Dispatches parallel reviewers (spec-conformance, correctness, test-quality, docs-sync, robustness, security, ux, performance, arch-review, code-quality, skill-plugin-quality) and synthesizes findings into a punch list. Use when the user asks to review a PR, run /deep-review, mark a PR as ready for review, or requests a formal/thorough code review.
---

# Deep Review

Multi-dimensional PR review orchestrator. Each reviewer's checklist, Detection table, worked scenarios, and output contract live in `references/reviewers/<name>.md` — read the matching file when dispatching and pass its content into the subagent prompt.

## When to use

`/deep-review` invocation, "formal review" / "thorough review" / "deep review" phrasing, Draft → Ready transitions, high-risk changes needing independent verification. **Skip for:** typo fixes, single-line tweaks, quick sanity checks.

## Prerequisites

`gh auth status` clean, target PR identified, read access to repo.

## Steps

### 1. Fetch + classify

Run `gh pr view --json number,title,body,baseRefName,headRefName` and `gh pr diff`. Then apply tags (multi-select):

- **`logic`** — code logic changes (functions, control flow, data handling)
- **`auth-sensitive`** — sub-tag to `logic`; auth / crypto / secret / payment
- **`ui`** — CLI / TUI / web / mobile UI surface
- **`perf`** — frontend / mobile / backend performance-sensitive changes
- **`arch`** — new files, module reorganization, dependency graph changes

Also judge **trivial** (single-line, pure config/doc) vs **non-trivial** (any code logic change).

### 2. Dispatch reviewers (4 categories, all in parallel)

For each dispatched reviewer, read `references/reviewers/<name>.md` and pass its checklist + Detection table + output contract into the subagent. The Metadata block specifies `Reasoning` tier (`flagship` → platform top model, e.g. Opus / GPT-5.5; `workhorse` → just-below-flagship, e.g. Sonnet / GPT-5.5-mini), `Tools`, and optional `Effort` (defaults to `xhigh` when unspecified — current Claude / Codex recommendation; specify only when overriding down for cheap checks or up to `max` for cases where `xhigh` under-thinks).

**Project-level custom reviewers**: also discover `docs/rules/review/*.md` (silent if the directory is absent). For each custom file, parse its Metadata `Trigger` field and route into the matching dispatch category (A/B/C/D). If a custom reviewer's name collides with a built-in, skip + warn — never override built-ins. Use the `reviewer-creator` skill to scaffold new ones.

**A. Required (always fire):** `spec-conformance`, `correctness`, `docs-sync`

**B. Conditional by tag:**

| Tag | Reviewer |
|---|---|
| `logic` | `robustness` |
| `logic` + `auth-sensitive` | `security` (Robustness narrows to Edge-cases lens only) |
| `ui` | `ux` |
| `perf` | `performance` |
| `arch` | `arch-review` |

**C. Non-trivial conditional (any non-trivial change):** `test-quality`, `code-quality`

**D. Detection-driven conditional:** `skill-plugin-quality` — fires when diff contains any of: `.claude-plugin/` or `.codex-plugin/` paths, `**/marketplace.json`, `**/SKILL.md`, `**/agents/*.md` (with YAML frontmatter), `**/hooks/hooks.json` / `**/hooks.toml`, `.mcp.json` or `mcpServers`, `CLAUDE.md`, `AGENTS.md`.

Spec Conformance inputs must EXCLUDE the writer Agent's own commit messages, PR body rationale, "autonomous decisions" notes — those bias toward confirming the writer's reading. Spec source + diff only.

**Fresh-context reviewer isolation is mandatory.** Every dispatched reviewer must start from a clean context so it can inspect the PR from an adversarial, independent perspective. Never fork the orchestrator's current context into reviewer subagents, never pass the live conversation transcript, and never resume a prior review session for a new reviewer. In Codex native subagents, set `fork_context: false` explicitly when the tool exposes it. In CLI-based delegation, start a new session rather than `resume` / `continue`. The reviewer prompt may contain only the review packet: target PR metadata, diff, relevant source/spec files, essential project instructions, the reviewer reference file, and the output contract.

**Output contract:** pass each reference file's `Output contract` section verbatim into the subagent prompt — do not rely on defaults. Every reviewer prompt (built-in or `docs/rules/review/`-custom) must also begin with the **Reviewer Must-Not Preamble** verbatim (see section below) — role-level constraints that apply uniformly across all dimensions, centralized here so a single edit reaches every reviewer.

**Runtime:** dispatch read-only reviewers in parallel, but always with fresh context per reviewer. Use independent Agents when the platform supports them; if using in-conversation subagents, they still must receive a fresh prompt packet and must not fork the parent context. Prefer cross-model coverage (Codex ↔ Claude) when trade-offs need xhigh effort or when the PR is high risk.

### 3. Synthesize into a punch list

```
## Deep Review: PR #<n> — <title>
**Tags**: <...>  |  **Reviewers**: <list>
### Blocking issues
- [ ] <file:line> — <finding> — [confidence: high|med|low] (<reviewer>)
### Non-blocking suggestions
- [ ] <file:line> — <finding> — [confidence: high|med|low] (<reviewer>)
### Architectural observations
- <observation and recommended tracking action>
### Strengths (≤2 bullets)
- <one-line credit, e.g. "ACs #1–13 fully traced to file:line by spec-conformance">
```

**Classification:** Blocking = correctness bug / security / broken tests-or-contracts / unsatisfied spec AC / unjustified scope creep. Non-blocking = maintainability / style / minor perf / documented ambiguity. Architectural = decay worth tracking separately.

**Confidence:** dedupe at same `file:line` (keep higher-confidence wording). Sort within each category by confidence (high → low) then severity. Low-confidence stays in the report — it's signal for the human reviewer; if too speculative, move to Architectural rather than dropping.

**Output language:** write the synthesized report in the language of the current conversation (e.g. a Chinese conversation gets a Chinese report). Keep `file:line` references, identifiers, and code verbatim.

## Reviewer Must-Not Preamble

These role-level constraints apply to every dispatched reviewer (built-in and project-level custom under `docs/rules/review/`). Prepend this block verbatim to every reviewer's subagent prompt — do not duplicate it inside reviewer reference files. A single edit here propagates to every reviewer.

- **Do not pre-filter by severity.** This pass is a coverage stage, not a filtering stage — synthesis ranks and drops findings downstream. Report every concern in scope, including low-confidence and non-blocking ones. Strong reasoning models tend to follow "only report high-severity" type framing literally and drop real bugs that synthesis would have flagged.
- **Do not propose alternative implementations.** Naming the bug + a one-line direction for the fix is in scope. Designing the replacement code, refactoring the surrounding module, or writing the patch is a separate task.
- **Do not pass through previously-reviewed code without re-checking for regressions.** Code touched by this diff is in scope even when the same lines passed a prior review — an upstream contract change can silently invalidate yesterday's correctness verdict.

## Follow-up

Small architectural-decay fixes can land in the current PR if they don't break tests. High-risk issues should become tracking issues, not bundled into a review-cycle PR. **`test-designer` boundary**: this skill's `test-quality` reviewer is **post-hoc** (reviews tests written + flags missing). Standalone `test-designer` skill is **TDD red-phase** (Independent Evaluation produces failing tests *before* implementation). Don't conflate.

## Anti-patterns

- ❌ Dispatching subagents without specifying output format → context flood (reference files contain it; pass it verbatim)
- ❌ Forking the orchestrator's context into reviewer subagents, resuming prior reviewer sessions, or passing conversation history as review input — polluted context weakens adversarial review
- ❌ Serializing reviewers that are independent → wastes time
- ❌ Reviewing Draft PRs formally — Draft is for informal early feedback; wait for Ready
- ❌ Feeding Spec Conformance the writer Agent's own commit messages, PR body rationale, "autonomous decisions" — biases toward confirming the writer's reading
- ❌ Telling reviewers "only report high-severity", "be conservative", or "don't nitpick" — newer reasoning models silently drop real findings; filter at synthesis, not per-reviewer
- ❌ Splitting already-merged dimensions (Code Quality's Consistency+Maintainability, Robustness's Security+Edge-cases) unless `auth-sensitive` fires — merges are deliberate token-cost optimizations that preserve every checklist item
- ❌ Merging `test-quality` back into `correctness` — splitting is what makes "tests should exist but don't" findings visible
- ❌ Letting a custom reviewer in `docs/rules/review/` override a built-in by sharing its name — skip + warn instead. Built-ins are the canonical safety net; project additions extend, never replace
