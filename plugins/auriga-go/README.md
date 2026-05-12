# auriga-go

Workflow autopilot for the [auriga workflow](https://github.com/Ben2pc/auriga-cli). Reminder-based navigation across the phases in `CLAUDE.md`.

## What it does

Invoke `/auriga-go` (or say "按照工作流继续" / "drive the workflow forward"). It inspects repo state, identifies the next workflow phase, records the step in your Agent's native task tracker, then either proceeds (`auto`, default) or proposes one step (`step`). It tells the main Agent which skill to invoke next — it does not dispatch skills itself.

For autonomous self-driven runs, the plugin also bundles a `/goalify` skill that plans a goal from the current spec or work-in-progress and dispatches it via Claude Code's built-in `/goal` command.

## Structure

- `skills/auriga-go/` — workflow-navigator skill (autoloaded by description + `/auriga-go` slash command).
- `skills/goalify/` — single-prompt skill that plans + sets a `/goal` for autonomous execution.

For the history of why this is a plugin rather than a pure skill (the underlying `${CLAUDE_SKILL_DIR}` substitution caveat and why the plugin form is kept even though auriga-go ships no hooks), see [`docs/architecture/auriga-go.md`](https://github.com/Ben2pc/auriga-cli/blob/main/docs/architecture/auriga-go.md).

## Install

Installed automatically by `npx auriga-cli` — this plugin is registered in the auriga-cli marketplace. Manual install:

```bash
claude plugins marketplace add Ben2pc/auriga-cli
claude plugins install auriga-go@auriga-cli
```
