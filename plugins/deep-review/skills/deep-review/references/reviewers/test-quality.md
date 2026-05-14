# Test Quality Reviewer

## Scope

The checklist below is a **starting point, not a fence**. It covers the most common test-quality patterns — but report any concern in this dimension that you would raise to a thoughtful colleague reviewing this PR, including categories not enumerated here. The patterns are training wheels for completeness; the goal is judgment.

This reviewer covers **two scenarios**: tests-present (quality review) and tests-missing (coverage-gap analysis). The split is what makes "tests should exist but don't" findings visible — do not narrow this reviewer to only the tests-present case.

The §1–§8 rubric in Scenario A mirrors the `test-designer` skill's Step 3 *Test quality constraints* — front (design time) and back (review time) carry the same standards independently. Concept names align so findings from one inform the other; wording lives in each component's own file because they ship through different distribution channels (auriga-cli skills vs this plugin).

## Metadata

- **Best for**: Both reviewing test quality and surfacing missing coverage on new production behavior
- **Trigger**: non-trivial
- **Reasoning**: flagship
- **Tools**: Read, Grep, Glob (read-only)
- **Value**: Catches over-mocked / brittle / flaky / behavior-blind tests, AND catches "diff added behavior with no tests"

## Checklist

### Scenario A — Tests present in diff

#### §1. Test at the right level
Pure logic with no I/O wrapped in an integration / E2E test, or cross-boundary work faked into a pure-unit test that doesn't exercise the boundary. Test should sit at the lowest level that captures the behavior.

#### §2. Behavior, not implementation
Assertions on internal method-call sequences (`expect(spy).toHaveBeenCalledWith(...)`, mock invocation counts), private helpers, or exact log strings. Implementation-coupled tests fail on harmless refactors and pass on real bugs. **Sub-rule: mocked-only tautologies** — tests that assert only on values they themselves stubbed (e.g., mock `jwt.verify` to return `{userId: 1}`, then assert the function returns `1`) prove nothing about production behavior.

#### §3. Mock at boundaries only
Mocks belong at network / DB / clock / filesystem / randomness boundaries. Preference order: real implementation > in-memory fake > stub > mock. Flag when the unit under test itself is mocked, when pure internal dependencies are replaced unnecessarily, or when mocks replace logic that could be exercised with real code.

#### §4. 5-scenario coverage
For each public behavior introduced or modified, expect tests across these categories — flag a category as missing unless the diff explicitly justifies inapplicability (e.g., concurrency for a pure function):

| Scenario | Example |
|---|---|
| Happy path | Valid input → expected output |
| Empty / null | "", [], null, undefined |
| Boundary | 0, 1, max, max+1, negative |
| Error path | Invalid input, timeout, permission denied |
| Concurrency / order | Rapid repeats, out-of-order responses, races |

Validation logic without negative tests is half-tested — flag as Error-path gap.

#### §5. Structural quality
Arrange-Act-Assert visibly separated. One assertion concept per test (test name containing "and" → flag for split). Test names read like specification sentences (good: `it('rejects empty email with "Email required"')`; bad: `it('test1')`, `it('works')`, `it('handles errors')`). DAMP > DRY: over-DRY'd shared setup hides what each test actually verifies.

#### §6. Flake risk
Time-dependent without fake timers (real `setTimeout`, `Date.now()`), order-dependent (shared mutable state across tests, iteration-order assertions), network-dependent (real HTTP without fixture), filesystem-dependent (uses `/tmp` without cleanup), snapshot tests of unreviewed output (flag overuse as a quality concern).

#### §7. Test must actually fail
A test that never fails is as useless as one that always fails. Flag suspicious always-green patterns: assertions that tautologize (`expect(x).toBe(x)`), tests that wrap the entire body in a try/catch that swallows failures, or tests where the asserted condition is logically implied by setup (e.g., `expect(array.length).toBeGreaterThan(-1)`). Snapshot tests without periodic review fall in this bucket — they pass automatically when content changes.

#### §8. Property over example
Tests that assert on specific happy-path values from the requirement's example data (e.g., "output equals exactly `[1, 2, 3]` for this fixture") pass whenever input==fixture and break for any valid variant. Flag and recommend property assertions (sorted, idempotent, contains-all-inputs) or a paired variant-input test exercising the same invariant.

### Scenario B — Tests missing for new production behavior

1. **Map new branches → tests**: list each new conditional / new public method / new code path introduced by the diff. For each, identify whether a test exercises it. List uncovered ones with file:line.
2. **Map changed branches → tests**: for changed logic, find existing tests that *used to* cover it; check whether they still cover the new behavior or have silently degraded into "still passes but no longer asserts the new contract".
3. **Severity**: missing test on critical path → blocking; missing test on edge case → non-blocking with a recommendation.
4. **Don't insist on 100% coverage**: trivial getters/setters, pure pass-through code, and code already covered transitively by integration tests do not need dedicated unit tests.

## When to invoke

Fires for any non-trivial change (same bar as `code-quality`). Detection signals tell which scenario applies.

| Recommend focus on | Detection |
|---|---|
| Tests present (Scenario A) | Diff includes `**/*test*.{py,ts,tsx,js,go,kt,swift}`, `**/*_test.go`, `**/*.test.ts`, `__tests__/`, `spec/`, `tests/` |
| Mock-heavy diff | `mock` / `stub` / `spy` / `jest.fn` / `unittest.mock` / `gomock` / `Mockito` |
| Tests missing (Scenario B) | Production diff present (>0 lines) with **zero or near-zero** lines under test paths above |
| Async / concurrency tests needing care | `async` / `await` / `goroutine` / `setTimeout` / `setInterval` in test files |
| Snapshot tests | `toMatchSnapshot` / `__snapshots__/` — flag as quality concern when overused |

Worked scenarios:

1. **A§2: Over-mocked auth test.** Diff adds `verifyToken()` and a test that mocks `jwt.verify` to always return `{userId: 1}`, then asserts `verifyToken()` returns `1`. Reviewer flags `<test>:<line> — test asserts only on what it mocked (§2 sub-rule); verify against a real (or canonical fixture) JWT — [severity: blocking] — [confidence: high]`.
2. **A§6: Flaky setTimeout test.** Test uses `setTimeout(..., 50)` then `await sleep(100)` to assert. Reviewer flags timing-dependent flake risk and recommends fake timers.
3. **B: New parser, no test.** Diff adds `parseV2(input)` with three branches (valid / partial / malformed). No test file changed. Reviewer flags 3 missing test cases as separate findings, each at the new function's file:line.
4. **A§4 + A§8: Example-only test for sorter.** Diff adds `sortByPriority(items)` with one test asserting output equals exactly `[A, B, C]` for one fixture input. Reviewer flags §4 (no boundary / empty / error tests) and §8 (shape-to-example assertion, no property-style or variant-input pairing).

## Output contract

Treat this pass as a **coverage stage, not a filtering stage**. Report every issue you find. It is better to surface a finding that synthesis filters than to silently drop a real coverage gap.

Return:

- Summary of **at most 300 words**, with sub-headings `Scenario A — quality` and `Scenario B — missing` if both apply
- Followed by a bullet list, each: `<file>:<line> — <one-line description> — [severity: blocking | non-blocking] — [confidence: high | medium | low]`

For Scenario A findings, prefix the description with the rubric section that fired (`§1` through `§8`) so synthesis can group by standard and so test-designer's matching front-of-loop rubric is discoverable. For Scenario B findings, point at the **production** file:line where the untested branch lives, not at a test file (the test doesn't exist yet). Return `"No findings."` only when you genuinely found nothing.
