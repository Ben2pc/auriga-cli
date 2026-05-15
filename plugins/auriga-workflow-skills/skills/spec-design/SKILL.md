---
name: spec-design
description: Clarify requirements into a Validation-Contract-shaped spec — runs a 4-phase discovery → design → write → handoff loop that produces `spec.md` (why+what) and `validation-contract.md` (structured `VAL-XXX-NNN: behavior+tool+evidence` assertions) under `docs/specs/<topic>/`. Use at the requirement-clarification phase of the auriga workflow whenever a change introduces or modifies an external behavior contract — new feature, public API change, schema migration, CLI surface addition. 也用于澄清需求 / 写 spec / 拆需求 / 行为契约 / brainstorm a feature. Replaces the upstream `brainstorming` skill.
---

# Spec Design

Requirement-clarification orchestrator. Turns ambiguous asks (a sentence, an HTML mock, a PRD, a Figma link, even a user-supplied "spec") into two files the downstream pipeline can consume mechanically:

- `docs/specs/<topic>/spec.md` — Why + Findings + What + Out of scope + Open questions (+ References)
- `docs/specs/<topic>/validation-contract.md` — `VAL-XXX-NNN` assertions with `Behavior + Tool + Evidence`
- `docs/specs/<topic>/umbrella.md` — only when the size gate triggers decomposition

The Validation Contract is the load-bearing artifact. `test-designer` reads VAL as primary input; `deep-review`'s `spec-conformance` reviewer reads VAL to confirm a PR's diff satisfies every assertion.

## When to Use

- A new feature, public API change, schema migration, CLI subcommand, or user-visible behavior change is requested
- User says "let's spec this", "澄清需求", "write a spec for X", "brainstorm a feature"
- A user-supplied spec needs to be audited against the auriga standard before downstream phases consume it

**Don't use for:**

- Pure implementation strategy changes where the external behavior contract does not move (refactor, algorithm swap, library replacement) — go directly to plan
- Bug-fix-shaped tasks that already have a reproducer (the bug report *is* the requirement) — go to systematic-debugging
- Pure documentation / configuration tasks with no behavior surface

## The Iron Law (Spec / Plan boundary)

**spec = why + what; plan = how.**

If a change moves the external behavior contract — what a user, an external caller, an API consumer, or a downstream file format can observe — it goes through this skill before plan.

If a change is purely internal — different implementation strategy for the same observable behavior — skip this skill and go to plan.

`spec.md` documents external surface and motivation. The moment a section reads as "we'll use file X, function Y, with helper Z", it has crossed into how — surface that for the plan stage, do not commit it to `spec.md`.

## Must not (orchestrator scope)

- **Do not invoke this skill after implementation has started or been sketched.** The dispatched audit and Q+GUESS loop assume zero implementation context. Once you've discussed which files or functions will change, the clarification loop will rationalize the sketch instead of probing the user's intent.
- **Do not let `spec.md` accumulate How.** Module names, class names, exact API signatures, data structure choices, library names — all are out of scope. If the user volunteers them, write them into the eventual plan, not the spec.
- **Do not skip the Q+GUESS confidence stop.** Halting at 95% predicted confidence is the discipline; pushing for 100% over-narrows the conversation and turns the spec into a plan in disguise.
- **Do not invent VAL numbers.** Each VAL must come from a real distinct external behavior. Padding numbers to look thorough turns the contract into noise.

## Inputs (five modes)

| Mode | Form | A1 handling |
|---|---|---|
| 1. Text description | A sentence or paragraph | Q+GUESS direct after repo pre-research |
| 2. Static HTML prototype | User-supplied HTML file | Open, screenshot/list pages, extract interactive elements, infer user stories |
| 3. PRD | Notion / Markdown / PDF | Summarize key sections, mark ambiguous points, enter them into Q list |
| 4. Figma link | URL | Ask the user to attach key page screenshots or PNG exports; do **not** try to fetch Figma directly |
| 5. User-supplied spec | The user thinks it's done | **Must** audit per `## User-supplied spec audit` — never accept as-is |

All five share the same downstream contract: a `spec.md` + `validation-contract.md` pair under `docs/specs/<topic>/`.

## Process

```
A. Discover   →  B. Decide & Design  →  C. Write   →  D. Gate & Handoff
   (查清楚)        (定方向、定切分)       (落到文件)     (交付前自检)
```

### Phase A — Discover

**A1. Pre-research + ingest + audit.**
Before any clarification question:

- Read repo entry points in this priority order: `AGENTS.md` and `CLAUDE.md` first (agent-facing source of truth), then the relevant `docs/` subdirectories, then recent commits via `git log`. Read `README.md` only when neither `AGENTS.md` nor `CLAUDE.md` exists (README is human-oriented and may be promotional or out of date relative to the agent contract).
- If the user gave file paths / commits / issue numbers, *open them* — do not paraphrase
- If the input is one of modes 2–4 (HTML / PRD / Figma), extract the key visible elements into a draft `## Findings` section
- If the input is mode 5 (user-supplied spec), run the audit checklist below; any missing item becomes a Q in A2
- Exception: skip A1 only when the user's message explicitly contains both target file paths *and* the precise change surface. Even then, log "skipping Pre-research because user supplied X" so the decision is auditable.

**A1.5. Size check.**
Estimate whether this needs decomposition (see `## Size gate`). If any signal trips, route through B0 in Phase B.

**A2. Q+GUESS clarification loop.**
- One question per round via `AskUserQuestion`
- Each question carries a Hypothesis + Confidence (e.g., "I'm guessing X, ~60% confident")
- Stop at ~95% predicted confidence — do **not** push for 100%
- Cap at ~10 rounds; if confidence hasn't converged, fall back and ask the user whether to decompose (B0) or whether the requirement itself needs to be split into multiple sessions

**A3. 6-line restate.**
- Compress the clarified requirement into ≤ 6 lines
- Ask for Explicit-yes before Phase B; do not infer consent from silence or topic continuation

### Phase B — Decide & Design

**B0. Decomposition (only if A1.5 tripped).** Use the decision tree below to pick a slicing axis and emit a sub-spec list with an `umbrella.md`.

**B1. Propose 2–3 approaches.** State trade-offs and recommend one. Recommendation goes first; alternatives are for the user to redirect.

**B2. Present in sections.** Each major section of the design (architecture, user flows, validation surface, downstream impact) gets an interim user-approval beat. Do not dump the whole What at once.

### Phase C — Write

**C1.** Author `docs/specs/<topic>/spec.md` per the template below.

**C2.** Author `docs/specs/<topic>/validation-contract.md`. Anti-pattern check: each VAL must say *what* counts as a pass, not *how* to test it — the latter is `test-designer`'s job.

**C2.5.** If B0 triggered decomposition, author `docs/specs/<topic>/umbrella.md` (template below).

### Phase D — Gate & Handoff

**D1. Handoff review.** Apply the `## Handoff review checklist` from the consumer (test-designer / planner / future-you) perspective. Fix issues inline — do not redo phases.

**D1.5. Offer review aid (three-way).** Use `AskUserQuestion` to present:
- (c) **Skip** — go straight to D2. Default for small specs (≤ 5 VALs, single file).
- (a) **Playground** — dispatch `playground:playground` (Anthropic official plugin) with the `document-critique` template; pass spec.md + validation-contract.md (+ umbrella.md if present) as inputs. Hide this option if the playground plugin isn't installed.
- (b) **Static HTML** — generate a self-contained `docs/specs/<topic>/review.html` rendering both docs with anchors + a VAL table. Run `open <file>.html`. No interactivity, no playground dependency.

Option ordering must be `skip → playground → static HTML`. Skip is intentionally first; small specs shouldn't be pushed into tool ceremony.

If the user picks playground and provides reject/comment feedback prompts, parse them, apply edits inline, and re-run D1 once before D2.

**D2. Explicit-yes gate.** Print the spec file paths back to the user and wait for explicit approval. Do not start plan or Pre-coding on silence.

**D3. Handoff.** Apply the scope triage in `CLAUDE.md`:
- All three QDF predicates hold (single module, AC ≤ 5, no cross-boundary interface) → skip plan, go directly to Pre-coding / branch creation
- Otherwise → hand off to the user's chosen plan-stage tool (built-in Plan, `planning-with-files`, or any downstream planning skill the user picks). Do not hardcode a specific plan-stage skill name; the workflow CLAUDE.md owns that decision.

## User-supplied spec audit

When the user says "here's my spec", verify each item below. Anything missing becomes a Q in A2 — do not accept the spec as-is.

1. **Why is clear** — motivation expressible in one sentence; if absent, add 1–3 sentences in collaboration with the user
2. **Findings are grounded** — concrete evidence (file paths, commit SHAs, external URLs); if it's pure assertion, dig back into the repo or ask the user for sources
3. **Validation Contract exists** — structured `VAL-XXX-NNN` assertions or equivalent; if only prose, reframe into a VAL list
4. **Out of scope is annotated** — explicit "we are not doing this" list
5. **No How leakage** — module names, class names, signatures, library choices are absent; if present, mark out of bounds and move to plan

## Templates

The three Phase-C output templates each live in their own file beside this skill:

| Output file | Template | When to use |
|---|---|---|
| `docs/specs/<topic>/spec.md` | `references/spec-template.md` | Always (Phase C1) |
| `docs/specs/<topic>/validation-contract.md` | `references/validation-contract-template.md` | Always (Phase C2) |
| `docs/specs/<topic>/umbrella.md` | `references/umbrella-template.md` | Only when B0 decomposition triggered (Phase C2.5) |

Read the relevant template file before writing the corresponding Phase-C output. The skill body keeps the *intent* (what each section is for); the *shape* (exact headings, placeholders, table layouts, numbering conventions) is canonical in the template files. Copy the template block into `docs/specs/<topic>/<file>.md` and replace each `<placeholder>`.

VAL numbering convention applies wherever VALs are written: `VAL-<CATEGORY>-<NNN>`. `CATEGORY` is a 3–5 letter uppercase tag (`WORK` / `DEP` / `UI` / `CLI` / …). `NNN` is zero-padded. Reuse a category across many VALs when they share a domain; do not skip numbers (gaps imply deleted assertions and break grep-based traceability).

## Size gate for spec decomposition

Any one signal triggers B0:

- Estimated VAL count > 20
- Touched modules > 5
- Touched subsystems > 2 (e.g., CLI + Web UI + plugin manifest at once)
- UI components > 10
- User explicitly says "this is roughly > 3000 lines"

## Decomposition decision tree

Walk in order; first match wins. The axes match `incremental-impl`'s Step 2 vocabulary on purpose — once the spec picks an axis, downstream plan and impl reuse the same name without re-deciding.

1. **Greenfield (a brand-new subsystem)** → **Walking Skeleton**: thinnest end-to-end path first, thicken vertically after
2. **High-risk / high-unknown technical surface** → **By risk**: address the most uncertain sub-spec first, validate, expand
3. **Cross-module change with similar shape in each module** → **Horizontal sweep**: one sub-spec per module, serial
4. **In-place migration of an existing surface** → **Branch by Abstraction**: introduce abstraction first, swap implementations under it
5. **Fallback** → **Vertical slice**: cut by user story

## Tool vocabulary

VAL `Tool` field must pick one of the **categories** below — never name a specific tool (avoid locking implementation):

| Tool | Use for |
|---|---|
| `unit-test` | In-process logic |
| `integration-test` | Cross-module / cross-process within one runtime |
| `e2e-browser` | Browser end-to-end (Browser Use / Playwright / Chrome MCP at plan time) |
| `e2e-mobile` | Mobile / simulator end-to-end (Computer Use / XCUITest / Espresso at plan time) |
| `e2e-cli` | Subprocess black-box of a CLI |
| `http-probe` | HTTP request + response assertion |
| `repo-check` | File existence / content / permissions |
| `git-state` | Git branch / commit / tree state |
| `gh-state` | GitHub PR / Issue / Release state |
| `lint` | Static check (eslint / tsc --noEmit / shellcheck / etc.) |
| `build` | Build artifact correctness (tsc / npm pack / artifact shape) |
| `manual` | Human verification only; must state "what counts as a pass" |

## Handoff review checklist (D1)

Look from a downstream consumer's seat (test-designer, planner, you-in-a-month). Fix in place — do not redo.

- [ ] No TBD / TODO / placeholder
- [ ] Why is intelligible to a blank-context agent
- [ ] Each VAL's Behavior is single-meaning (two implementations cannot both rationalize a pass)
- [ ] No VAL says how to test, only what counts as a pass
- [ ] Out of scope covers everything that "looks like it should be in" but isn't
- [ ] No What ↔ VAL contradiction
- [ ] If decomposed, umbrella.md gives a complete overview without opening sub-specs

## Anti-patterns

- ❌ Asking multiple questions in one round — burns the user's patience and conflates dimensions
- ❌ Pushing past 95% confidence — the marginal question over-specifies
- ❌ Writing implementation hints into `spec.md` ("we'll add a function `validateX` in `utils.ts`")
- ❌ VALs that describe test mechanics ("call `assertEquals(parse(s), …)`") — those belong in test-designer
- ❌ Padding VAL count to look thorough — fewer well-formed VALs beat many vague ones
- ❌ Accepting a user-supplied spec without running the audit
- ❌ Skipping D1.5 silently — the option to review must be presented; the user may then skip
- ❌ Splitting a small spec into sub-specs to look organized — the size gate is the gate
- ❌ Treating Figma URL as readable; always ask for exported PNGs / screenshots

## Relationship to other skills

- `test-designer` — consumes `validation-contract.md` as primary input (with `spec.md` prose as fallback context); writes failing tests
- `incremental-impl` — picks up the same slicing-axis vocabulary chosen at B0; takes spec + plan into per-slice execution
- Plan-stage tooling (built-in Plan, `planning-with-files`, or any planning skill the workflow CLAUDE.md names) — downstream of D3 when scope triage says full plan path
- `deep-review`'s `spec-conformance` reviewer — validates PR diff against the VAL list; findings tag `VAL-XXX-NNN`
- `playground:playground` (Anthropic official, soft dependency) — D1.5 review aid via `document-critique` template
- `goalify` — once this skill's spec is settled, `goalify` consumes spec.md + validation-contract.md to package the long-running execution into a `/goal` script (autonomous continuous run, e.g. "drive this to PR Ready"). Out of band: not auto-invoked here; the user invokes it when they want unattended execution of an already-clarified requirement
