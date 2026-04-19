# auriga-go ship mode (Experimental)

> ⚠️ **Experimental.** Opt in explicitly. Read this file before invoking.

ship drives an existing spec to a PR Ready candidate without per-step user prompts. Use for small-scope feature development or prototyping for non-technical collaborators.

## How the loop runs

ship is **hook-backed**, not self-policed. A Stop hook bundled with this skill (`scripts/ship-loop.sh`, registered via SKILL.md frontmatter) intercepts Claude Code's session-end attempts and decides whether to re-feed the ship prompt or let it exit.

Two termination conditions — whichever fires first:

**Completion signal** — emit this as the final assistant text to exit the loop:

```
<ship-done>Ready</ship-done>     (success terminal state met)
<ship-done>Blocked</ship-done>   (hard stop, budget exhausted, or ambiguity)
```

The hook scans the last assistant text block for these exact tags. Emit **exactly one**. Missing the marker → hook blocks exit and re-feeds the ship prompt as iteration N+1.

**Iteration budget** — hard cap via `max_iterations` in the state file (default 30). When `iteration ≥ max_iterations`, the hook forces a `Blocked` exit regardless of marker.

## Entering ship mode

When ship is invoked (`/auriga-go ship` or confirmed NL trigger):

1. Print the opt-in warning (once, as iter 1 begins):
   ```
   ⚠️ ship mode (Experimental, max-iter N). Strictest defaults + in-Draft deep-review.
      Hard stops still apply. /clear-safe (loop auto-resumes).
      Cancel anytime: rm .claude/auriga-go-ship.local.md
   ```
2. Write the state file at `.claude/auriga-go-ship.local.md` (template below).
3. Begin iteration 1.

**State file template** (ralph-loop-style: YAML frontmatter + re-entry prompt body):

```markdown
---
active: true
iteration: 1
max_iterations: 30
session_id: <current Claude Code session ID>
started_at: <ISO 8601 UTC timestamp>
---

Continue auriga-go ship mode. Read skills/auriga-go/SKILL.md and
skills/auriga-go/references/ship.md for the contract. Your job:

1. Inspect current state (git log, docs/specs/, gh pr view) to find
   where the previous iteration left off in the CLAUDE.md auriga
   workflow.
2. Pick up the next workflow step per ship's strict defaults.
3. On test/verification failure: systematic-debugging → fix → retry.
4. When all three Ready terminal conditions hold (tests pass AND
   in-Draft deep-review empty AND PR flipped Draft → Ready), emit
   <ship-done>Ready</ship-done>.
5. On hard stop (ambiguity / destructive op) or if you want to exit
   before conditions are met, post the blocker comment on the PR and
   emit <ship-done>Blocked</ship-done>.

Record each workflow step you take through your host Agent's task
tracker — that's your primary in-session audit trail. The <ship-done>
marker is the only format ship itself mandates (the Stop hook scans
for nothing else).
```

The prompt body is the **same every iteration** — that's the "self-referential" loop property from ralph-loop. Re-invariance matters: after `/clear` or compaction, a fresh Agent must be able to read it cold and continue.

**Iteration count** lives in the state file's `iteration:` field, incremented atomically by the hook on each re-feed. To see the current count: `grep '^iteration:' .claude/auriga-go-ship.local.md`. This is the cross-`/clear` audit surface — the hook does not rely on any echo format in the transcript.

## Auto-resume across `/clear`

Skill-scoped hooks and the on-disk state file **survive `/clear` and compaction** (verified in Claude Code source — hooks are session-level, only cleaned up at `SessionEnd`). If you `/clear` mid-ship:

1. Model loses skill content from context
2. Next Stop event still fires the Stop hook
3. Hook re-feeds the prompt body as a fresh user turn
4. The body instructs the Agent to re-read SKILL.md + ship.md and inspect git/PR state → back in loop

No manual resume needed.

## Ready terminal conditions

All three must hold before emitting `<ship-done>Ready</ship-done>`:

1. Tests pass (full `verification-before-completion`)
2. In-Draft `deep-review` returns an empty blocking-list
3. PR flipped Draft → Ready

If any fails mid-iteration, continue the main loop: invoke `systematic-debugging`, apply the fix, re-run, iterate. Iterations count against the same `max_iterations` — no private counters.

## Strict defaults per workflow decision

At each decision point in the iteration, pick the most rigorous option:

| Decision | ship default |
|---|---|
| Planning (step 2) | `planning-with-files` — persistent state survives `/clear` and iterations |
| Test design (step 7) | `test-designer` — Independent Evaluation |
| Parallel impl (step 8) | dispatch when threshold met; don't skip "to save complexity" |
| Spec lifecycle (step 10) | **promote** to `docs/architecture/` first; archive only if no clear architectural home |
| Review (step 11) | `deep-review` **mandatory on Draft** — deliberate exception to "only after Ready", justified because ship is producing the Ready candidate |
| Flip Draft → Ready | automatic once all three Ready terminal conditions hold |

Decisions not in this table and not pre-decided by the spec → ambiguity → hard stop → `Blocked` exit. **Don't invent a ship default not listed here.**

## Blocked exit

Before emitting `<ship-done>Blocked</ship-done>`:

1. Post a PR comment titled `🚫 ship mode: blocked at iter <N>/<max-iter>` containing:
   - Last known workflow step and what's blocking
   - The last 3 fix attempts (if any) and why each failed
   - Suggestion: bump `max-iter` and resume, OR take over manually
2. Leave PR as Draft (do **not** flip Ready)
3. Emit `<ship-done>Blocked</ship-done>` — hook deletes state file, allows exit

No silent give-up.

## Manual cancel

```bash
rm .claude/auriga-go-ship.local.md
```

Next Stop event fires the hook → no state file → immediate no-op → normal exit. The skill's Stop hook stays registered for the session but is a no-op without the state file.

## When NOT to use ship

- Production data, secrets, or shared infrastructure in scope
- Security-sensitive or regulatory work where "almost right" is unacceptable
- Shaky spec — ship can only execute work that's well-defined upfront
- Customer-visible repos where a bad PR comment thread has real cost

## Invocation

- `/auriga-go ship` — 30 iterations
- `/auriga-go ship 50` — 50 iterations
- `ship 模式跑到 PR Ready` — natural language, **requires confirmation** before entering
