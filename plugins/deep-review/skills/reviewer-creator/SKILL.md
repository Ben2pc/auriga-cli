---
name: reviewer-creator
description: Scaffold a new project-level custom reviewer for the deep-review skill. Creates a properly-structured reviewer file at `docs/rules/review/<name>.md` that the deep-review orchestrator will discover and dispatch automatically. Use when the user asks to "create a custom reviewer", "add a project-specific reviewer", "扩展 deep-review", or invokes `/reviewer-creator`.
---

# Reviewer Creator

Scaffolds a project-level custom reviewer file for the `deep-review` skill. The generated file lives under `docs/rules/review/<name>.md` and is auto-discovered by the orchestrator at dispatch time (per `deep-review/SKILL.md`'s Step 2 discovery rule).

## When to use

- User wants to add a project-specific review concern that isn't covered by the 11 built-in reviewers (e.g., "migration safety", "feature-flag cleanup", "i18n key consistency", "schema-version compatibility", "telemetry naming")
- User invokes `/reviewer-creator`
- Team is onboarding a new convention they want enforced at PR time

**Skip for:** generic concerns already covered by built-ins. Custom reviewers add **new dimensions**, not project-specific narrowings of an existing dimension.

## Prerequisites

- `deep-review` plugin installed (this skill ships alongside it)
- `docs/rules/review/` will be created on demand if absent
- `references/template.md` (in this skill's directory) is the canonical template

## Steps

### 1. Gather metadata via `AskUserQuestion`

Collect in order:

1. **Name** — kebab-case (e.g., `migration-safety`, `i18n-keys`). Validate:
   - lowercase / hyphenated / no spaces or special chars
   - **Reject names that match a built-in**: `spec-conformance`, `correctness`, `test-quality`, `docs-sync`, `robustness`, `security`, `ux`, `performance`, `structure`, `code-quality`, `skill-plugin-quality` — built-in collisions are blocked by the orchestrator anyway, but catch it here for clarity
2. **One-line "Best for"** — short job description (12–25 words)
3. **Domain** — one phrase used in the Scope preamble (e.g., "migration safety", "feature-flag cleanup")
4. **Trigger category** — exactly one of:
   - `always` — fires on every PR (use sparingly; cost adds up)
   - `tag:<name>` — fires only when an existing tag is set (`logic` / `auth-sensitive` / `ui` / `perf` / `structure`)
   - `non-trivial` — fires for any non-trivial change
   - `detection-driven` — fires only when Detection signals match (recommended default for narrow concerns)
5. **Detection signals** — ≥3 grep-able rows (path globs / import patterns / API call patterns). Required for `detection-driven`; useful as focus hints for other categories
6. **Reasoning tier** — `flagship` (deep multi-hop reasoning required — e.g., bug hunting, architectural judgment) or `workhorse` (pattern matching / checklist verification). Each platform maps these to its own model class: Claude flagship → Opus, workhorse → Sonnet; Codex flagship → GPT-5.5, workhorse → GPT-5.5-mini. Default to `workhorse` unless the reviewer needs cross-cutting reasoning over the diff
7. **One worked scenario** — concrete file:line-style example of a problem this reviewer would catch (seeds the Worked scenarios section; ≥2 more become TODOs)

### 2. Generate the file

```bash
mkdir -p docs/rules/review/
```

Read `references/template.md` from this skill. Substitute:

| Placeholder | Source |
|---|---|
| `<TITLE>` | name → human-readable (e.g., `migration-safety` → "Migration Safety") |
| `<DOMAIN>` | domain phrase from Step 1 |
| `<BEST_FOR>` | "Best for" line from Step 1 |
| `<TRIGGER>` | Trigger category from Step 1 |
| `<REASONING>` | Reasoning tier from Step 1 |
| `<DETECTION_ROWS>` | Markdown table rows assembled from Detection signals |
| `<WORKED_SCENARIO_1>` | the one scenario provided in Step 1 |

Write the substituted content to `docs/rules/review/<name>.md`.

The remaining `<TODO: ...>` placeholders (Value line, Checklist body, scenarios 2 and 3, output-contract specifics) are left for the user to fill in — they require domain expertise the skill cannot synthesize.

### 3. Tell the user what to do next

Print a short summary:

1. File created at `docs/rules/review/<name>.md`
2. **Required edits before use:**
   - Fill in the `**Value**:` line in Metadata
   - Replace `<TODO: ...>` placeholders in Checklist with 5–10 specific, actionable review questions
   - Add 2 more Worked scenarios (concrete file:line-style examples)
   - Optionally adjust the Output contract if the reviewer needs special lens/category tags
3. **Verification:**
   - Run `/deep-review` on a PR that should trigger your new reviewer
   - Check that the dispatched-reviewer list includes `<name>`
   - Confirm synthesis output includes findings from the custom reviewer
4. **If the Trigger was wrong:** edit the `**Trigger**:` field in the file and re-run; no other change needed

## Anti-patterns

- ❌ Using a built-in's name — orchestrator skips collisions and warns
- ❌ Trigger `always` for narrow concerns — every PR pays the dispatch cost; prefer `detection-driven` with specific signals
- ❌ Skipping the Detection signals — required for `detection-driven`; valuable as focus hints elsewhere
- ❌ Removing the "starting point, not a fence" Scope preamble — reviewers without it tend to miss findings outside the listed checklist (Opus 4.7+ behavior)
- ❌ Re-implementing a built-in dimension with project-specific narrowing (e.g., a "correctness for our payment module" reviewer) — instead, document the project-specific rules in `docs/rules/` (without `review/`) and let `correctness` reviewer pick them up via the codebase. Custom reviewers are for *new dimensions*

## Example session

```
User: /reviewer-creator
Assistant: [walks through 7 questions; user provides:
            name=migration-safety, best_for="catches unsafe DB migrations",
            domain="migration safety", trigger=detection-driven, signals=
            (*.sql files, ALTER TABLE patterns, drop_column calls,
            migrations/ directory), reasoning=workhorse, 1 scenario]
Assistant: [generates docs/rules/review/migration-safety.md]
Assistant: "File created. Next: fill in Checklist (5–10 specific safety
            checks like 'NOT NULL added without backfill?', 'concurrent
            index creation?'), add 2 worked scenarios, then run /deep-review
            on a PR with a migration to verify dispatch."
```
