---
name: test-designer
description: Design failing tests for complex features using Independent Evaluation — dispatches a context-free agent that sees only the requirement spec and code paths (not the implementation approach), then returns executable failing tests. Use when starting TDD for a non-trivial feature, when the requirement is ambiguous enough that biased tests are a risk, or when the user asks for independent test design.
---

# Test Designer

Independent test-design orchestrator. Encodes Independent Evaluation: the agent writing the tests must not be the agent implementing the feature, and must not inherit the implementation's assumptions.

## When to Use

- TDD red phase for a **complex / non-trivial** feature (multi-file, multi-branch logic, new subsystem)
- Requirement is ambiguous enough that the implementer's tests would likely rationalize the implementation instead of catching bugs
- User explicitly asks for "independent test design", "fresh-eyes tests", or runs `/test-designer`

**Don't use for:**
- Trivial changes (one-line fix, rename) — just write the test inline
- Bug reproduction tests — write directly from the bug report
- Non-code changes (pure docs, pure config, pure prompt)

## The Iron Law

**The agent designing the tests must not carry the implementation's context.** If you (the main Agent) are about to implement the feature, you are disqualified from designing its tests. Dispatch.

Violating this = tests that pass because they mirror the buggy implementation.

## Steps

### Step 1: Assemble the dispatch package

Collect **only these inputs** — nothing else:

1. **Requirement description** — "what to do" and acceptance criteria (not "how to do")
2. **Relevant code file paths** — read-only access to the code the feature will touch or integrate with
3. **Edge case prompts** — categories the dispatched agent should enumerate:
   - Boundary inputs (empty, max, min, off-by-one)
   - Concurrency / ordering (if applicable)
   - Resource lifecycle (cleanup on error, partial failure)
   - Invariants (data consistency, idempotency)
   - Adversarial inputs (malformed, oversized, mis-encoded)

**Explicitly exclude:**
- The implementation plan or design you've been developing
- Hints about which approach you've chosen
- Code excerpts from a work-in-progress branch
- Your own guesses about "the right way to test this"

### Step 2: Choose the executor

| Task shape | Executor | Reason |
|---|---|---|
| Complex, architectural implications | Independent Agent (e.g., `codex-agent` or `claude-code-agent` with fresh session) | True zero-context isolation; can use strongest model at highest effort |
| Medium complexity, current conversation clean | In-conversation subagent | Cheaper; still acceptable if main Agent hasn't yet proposed an implementation |
| Trivial | **Don't dispatch** — write tests inline |

**Default to Independent Agent** when the main Agent has already discussed or sketched implementation. Subagent isolation within the same conversation doesn't undo prior context pollution.

### Step 3: Dispatch with the strongest model and highest effort

Test design is a correctness-critical reasoning task, not a rote mechanical one. Use:

- **Model**: strongest reasoning model the runtime offers — inherit if the main Agent is already on that tier; otherwise override. Don't hardcode a specific brand name
- **Effort**: `xhigh` (the maximum level the runtime supports). Escalation ladder: `low` → `medium` → `high` → `xhigh`
- **Tools**: Read / Grep / Glob on code paths; Write on test files only
- **Permission**: read-only on non-test files; writable on test files

Dispatch prompt skeleton — the **Test quality constraints** section is the rubric the dispatched agent must satisfy and that Step 4 validates against; treat it as load-bearing, not boilerplate:

```
You are designing failing tests for a feature. You will NOT see or write the
implementation. Your job is to produce executable tests that fail today and
pass only when the feature is correctly implemented.

## Requirement
<paste requirement description + acceptance criteria>

## Code paths (read-only, for understanding context)
<list of file paths — public API surface, integration boundaries,
existing test conventions>

## Analyze first, write second
Before drafting any test:
1. Read the code paths; identify the public API / observable behavior surface.
2. Scan existing test files in the repo; match their framework, runner,
   fixture pattern, and naming style.
3. Enumerate behaviors to be tested across the 5 scenario categories
   (happy / empty / boundary / error / concurrency).

## Test quality constraints

Tests MUST satisfy these standards. Reject your own draft if any fail.

### 1. Test at the right level
- Pure logic, no I/O → unit test (small, milliseconds)
- Crosses a boundary (DB / network / filesystem / clock) → integration test
- End-to-end critical user flow only → E2E test
Default to the lowest level that captures the behavior.

### 2. Behavior, not implementation
- Assert on outcomes: return values, persisted state, observable side effects.
- Do NOT assert on internal method-call sequences, private helpers, or exact
  log strings.
- A test that asserts only on what it itself mocked is a tautology —
  disallowed.

### 3. Mock at boundaries only
Preference order: real implementation > in-memory fake > stub > mock.
Mock only:
- External APIs / network endpoints
- Time, randomness, other nondeterminism
- Operations that are slow or destructive in real form (real email, prod DB)
Do NOT mock the unit under test or pure internal dependencies.

### 4. Required scenario coverage
For each public behavior, include tests across these categories:

| Scenario | Example |
|---|---|
| Happy path | Valid input → expected output |
| Empty / null | "", [], null, undefined |
| Boundary | 0, 1, max, max+1, negative |
| Error path | Invalid input, timeout, permission denied |
| Concurrency / order | Rapid repeats, out-of-order responses, races |

Skip a category only when genuinely inapplicable (e.g., concurrency for a
pure function). State why in the test plan when you skip one.

### 5. Structural quality
- Arrange-Act-Assert: visibly separated blocks per test.
- One assertion concept per test. Name containing "and" → split into two.
- Test names read like specification sentences. Good:
  `it('rejects empty email with "Email required"')`. Bad: `it('test1')`,
  `it('works')`, `it('handles errors')`.
- DAMP > DRY in tests: each test self-contained. Don't hide what's being
  verified behind shared `beforeEach` / helpers.

### 6. Flake risk — forbidden patterns
- Time-dependent without fake timers (`setTimeout`, real `Date.now()`)
- Order-dependent (shared mutable state across tests, iteration-order asserts)
- Real network / live filesystem without isolation
- Snapshot tests of unreviewed output

### 7. Must actually fail
- A test that passes against an empty implementation tests nothing.
- A test that fails on `ImportError`, missing fixture, syntax error, or
  "module not found" is **fake red** — it doesn't exercise the behavior it
  claims to.
- Run each test against current code; confirm the failure message matches
  the rationale. Drop or fix any fake-red tests before returning.

### 8. Property over example
A test asserting on specific happy-path values (e.g., output equals exactly
`[1,2,3]` for one fixture) passes when input==fixture and breaks for any
valid variant. Use property assertions (sorted, idempotent,
contains-all-inputs) or pair the example with a variant-input test
exercising the same invariant.

## Produce

Return a single response with these four sections:

### Current state
- Existing test files covering this surface: `<file:line list>`, or "none"
- Test framework / runner / assertion library detected

### Coverage gaps
- Behaviors not yet tested: bullet list, grouped by 5-scenario category

### Recommended tests (with priority)
- **Critical** — tests that catch data loss, security regressions, or
  contract violations
- **High** — tests for core business logic / acceptance criteria
- **Medium** — tests for edge cases and error handling
- **Low** — tests for utility / formatting helpers

For each: one-line rationale stating the bug it would catch.

### Executable tests
- Test files, ready to run.
- Each test has a one-line rationale comment.
- Tests fail against current code, for the predicted reason (verified by
  running them).

## Process constraints
- Do NOT propose or sketch an implementation.
- Do NOT edit files outside the test directory.
- Use the project's existing test framework, runner, and fixture conventions.
- If you must assume something about the code that you couldn't verify from
  the read-only files, list each assumption at the top of the test file.
```

### Step 4: Validate the returned tests

Before handing the tests to the implementation phase, the main Agent runs these checks. Reject the deliverable and request a redo if any fail.

#### Run-the-tests checks
1. **Tests fail (red).** Every returned test fails against current code.
2. **Failure reason matches the rationale.** Not `ImportError`, not "module not found", not syntax error. The test fails because the asserted behavior is missing — the rationale comment predicts the failure message.

#### Standards-based checks
These cover Step 3's *Test quality constraints* §1–§6 + §8 (§7 "must actually fail" is enforced by the Run-the-tests checks above). Reject any test that violates them.

3. **Level appropriate** (§1) — unit-testable logic isn't wrapped in E2E; cross-boundary work isn't faked into a pure-unit test.
4. **Behavior, not implementation** (§2) — no `expect(spy).toHaveBeenCalled…` chains where state assertions would suffice; no assertions on private helpers or exact log strings.
5. **No tautological mock-only tests** (§2) — flag any test that asserts only on values it itself stubbed.
6. **Mock granularity** (§3) — mocks live at network / DB / clock / FS / random boundaries; the unit under test is real.
7. **5-scenario coverage** (§4) — happy / empty / boundary / error / concurrency all addressed or explicitly justified as inapplicable.
8. **Structural quality** (§5) — AAA visible, one concept per test, names read as specifications, no over-DRY'd setup.
9. **No flake patterns** (§6) — no real timers, no order-dependence, no real network, no unreviewed snapshots.
10. **Property over example** (§8) — no shape-to-fixture happy-path-only assertions; property assertions or variant-pair tests where applicable.

#### Coverage checks
11. **Distinct failure modes** — scan rationales; drop near-duplicates.
12. **Critical-path priority addressed** — every Critical and High item from the *Recommended tests* section has an executable counterpart.

### Step 5: Hand off to implementation

With the validated failing tests in place, implementation proceeds per `test-driven-development` skill: write minimal code to make them pass (green), then regression.

## Anti-patterns

These cover the **orchestration** of test design. Standards for individual tests live in Step 3's Constraints + Step 4's checks.

- ❌ Main Agent writes the tests after sketching the implementation — tests will mirror the implementation's assumptions
- ❌ Dispatching with medium effort / weaker model to save cost — test design quality compounds across the whole feature's lifetime
- ❌ Passing the work-in-progress branch contents to the dispatched agent — defeats Independent Evaluation
- ❌ Accepting tests that pass against an empty implementation — those tests don't constrain anything
- ❌ Skipping Step 4 validation — unvalidated tests get merged as fake green

## Relationship to other skills

- `brainstorming` → clarifies the requirement (upstream of `test-designer`)
- `test-driven-development` → governs the red-green-refactor loop (downstream; consumes the failing tests)
- `systematic-debugging` → kicks in if tests unexpectedly fail after implementation (downstream)
- `verification-before-completion` → runs the tests at the "done" gate (downstream)

The deep-review plugin's `test-quality` reviewer applies the same standards in §1–§8 above when reviewing tests in a PR — front (this skill, at design time) and back (reviewer, at PR time) carry the rubric independently but in echo.

## Example invocation

```
User: Starting work on the new plugin dependency resolver. Design tests first.
Assistant:
  1. Requirement: "Resolver takes a plugin manifest and returns install order
     respecting deps and detecting cycles. Must handle: transitive deps,
     diamond deps, self-references, missing deps, cycles."
  2. Code paths: src/plugins.ts, .claude/plugins.json schema, tests/ dir
  3. Dispatch to an independent-agent skill (fresh session) at `xhigh` effort,
     read-only on src/, writable on tests/
  4. Agent returns: Current state + Coverage gaps + Recommended tests
     (5 Critical, 8 High, 5 Medium) + tests/resolver.test.ts with rationale
     comments
  5. Main Agent runs tests → all red → validates against the 12-point Step 4
     checklist → hands off
```
