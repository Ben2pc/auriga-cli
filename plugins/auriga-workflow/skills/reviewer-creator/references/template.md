# <TITLE>

## Scope

The checklist below is a **starting point, not a fence**. It covers common <DOMAIN> patterns — but report any concern in this dimension that you would raise to a thoughtful colleague reviewing this PR, including categories not enumerated here. The patterns are training wheels for completeness; the goal is judgment.

## Metadata

- **Best for**: <BEST_FOR>
- **Trigger**: <TRIGGER>
- **Reasoning**: <REASONING>
- **Tools**: Read, Grep, Glob (read-only)
- **Value**: <TODO: one-line value statement — what does this reviewer prevent that built-ins miss?>

## Checklist

<TODO: Replace this section with 5–10 specific, actionable review questions.

Look at the built-in reviewers under
plugins/deep-review/skills/deep-review/references/reviewers/ for examples
of the right level of specificity. Good checklists name concrete things to
look for; bad checklists are abstract ("Is the code well-designed?").

Group items under sub-headings if your reviewer has multiple lenses (see
robustness.md for a 2-lens example: Security + Edge cases).>

1. **<Category>**: <specific check — what to look for>
2. **<Category>**: <specific check>
3. ...

## When to invoke

Fires per the `Trigger` field above. The Detection table below indicates which signal(s) to focus on once dispatched.

| Recommend focus on | Detection |
|---|---|
<DETECTION_ROWS>

Worked scenarios:

1. **<WORKED_SCENARIO_1>**
2. <TODO: add a 2nd worked scenario — concrete file:line-style example of what the reviewer flags and why>
3. <TODO: add a 3rd worked scenario — preferably an edge case or a near-miss>

## Output contract

Treat this pass as a **coverage stage, not a filtering stage**. Report every issue you find, including ones you are uncertain about or consider low-severity — synthesis ranks or drops them later. It is better to surface a finding that gets filtered than to silently drop a real concern.

Return:

- Summary of **at most 300 words**
- Followed by a bullet list, each: `<file>:<line> — <one-line description> — [severity: blocking | non-blocking] — [confidence: high | medium | low]`

<TODO: if your reviewer has multiple lenses or sub-categories, add an extra tag to each finding (see robustness.md `[lens: security | edge-cases]` for an example, or security.md `[category: auth | authz | secret | crypto | injection | other]`). Otherwise leave this paragraph as-is.>

Do not include code excerpts longer than 5 lines. Do not restate the diff. Return `"No findings."` only when you genuinely found nothing.
