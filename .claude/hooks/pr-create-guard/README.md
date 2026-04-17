# pr-create-guard

**PreToolUse** hook that intercepts `gh pr create` and enforces body-source hygiene.

## What it does

When the Agent tries to run `gh pr create`, this hook inspects the command **before** it executes:

### Hard block (exit 2) on structural problems

These are file-system / command-line facts that can't be reasonably debated — no regex of PR content is involved:

- **No body source flag** — neither `--body`, `-b`, `--body-file`, nor `--template` is present
- **Empty `--body ""` / `-b ""`** — literal empty string
- **`--body-file <path>`** — points to a non-existent file

In all three cases, the hook exits 2 with a reason on stderr; Claude Code shows the reason to the Agent and the `gh pr create` call does not run.

### Filter (additionalContext) otherwise

The hook best-effort extracts the body content:

- `--body-file <path>` → read the file
- `--body "..."` / `-b "..."` → parsed from the command tokens (simple-quote cases)
- `--template <name>` → acknowledged, no content scan
- Heredoc / `$(...)` / other dynamic body sources → fallback message acknowledging the hook couldn't statically parse

It then scans for `^##` and `^###` markdown headings and injects a one-message context block for the Agent — listing the headings found, **without diagnosing what's missing**. The Agent holds the "scope / acceptance / risks / TODO" contract in its own context and compares for itself. (The hook never does text regex of PR content for blocking.)

## Why this shape

Design principles from the workflow-guard-hooks PR:

1. **Filter-first, block on structural signals only.** Text-content interpretation belongs to the Agent, not to a regex in a hook.
2. **"Mechanism, not prompt."** The Agent can't escape seeing the injected context, so the reminder is mechanized even when no action is blocked.
3. **No false positives on exotic phrasing.** A body titled `## 变更范围` (instead of `## Summary`) is never blocked — the hook just reports what it found.

## Test

```bash
node .claude/hooks/pr-create-guard/test.mjs
```

Covers 10 cases: pass-through for non-matching commands, all three block signals, successful heading scan for `--body` and `--body-file`, heredoc fallback, and template acknowledgment.

## Limits

- **Simple-quote parser.** The tokenizer handles `"..."` and `'...'` with backslash escapes; heredocs and `$(...)` substitutions fall back to the "not statically parseable" filter message instead of reading the resolved body.
- **`--template` content is not resolved.** v1 acknowledges the flag was passed and skips the heading scan.
- **Platform:** `darwin`, `linux`. Windows untested.
