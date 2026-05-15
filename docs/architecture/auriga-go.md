# auriga-go — Workflow Autopilot Skill

**Status**: stable · promoted from `docs/specs/` on 2026-04-19
**Workflow version anchor**: auriga Workflow v1.7.0 (`CLAUDE.md`)

> This document captures the **decisions and rationale** behind auriga-go. The **live runtime contract** — modes, algorithm, Stop / Confirmation contracts — lives in `plugins/auriga-go/skills/auriga-go/SKILL.md`. When this doc disagrees with the skill files, the skill files win.

## Purpose

A workflow skill that drives the Agent forward along the auriga workflow (`CLAUDE.md`) with minimum prompting. When invoked, it inspects state, determines the next action, and executes (auto mode) or proposes one step (step mode). It stops only at two classes of hard stops:

1. Ambiguity that requires a human answer (requirement / design choice, two or more equally-valid paths).
2. Destructive or irreversible operations (force push, main-branch writes, file deletion, `--no-verify` or other safety bypass, package publish, CI/CD mutation).

## Name

`auriga-go` — continues the Latin *auriga* ("charioteer") motif of the project with *go* indicating forward motion. The charioteer keeps driving.

## Placement

- **Source in this repo**: `plugins/auriga-go/` (plugin root). Contains `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `skills/auriga-go/SKILL.md`, and `skills/goalify/SKILL.md`. Both skills are bundled inside the plugin so their description-based NL triggers (`/auriga-go`, "按照工作流继续", "set a goal and go", etc.) are preserved.
- **Installed to user project**: materialized by `claude plugins install auriga-go@auriga-cli` under the Claude Code plugin directory. Claude Code auto-discovers `skills/` subdirectories inside installed plugins.
- **Install mechanism**: Claude Code plugin system.
  - Repo-root `.claude-plugin/marketplace.json` lists the plugin (`"source": "./plugins/auriga-go"`).
  - `.agents/plugins/marketplace.json` lists the Codex side of the same repo-owned plugin.
  - `extra_plugin_configs.json` is reserved for external plugins and `defaultOn` overrides; `auriga-go` needs no extra entry because both marketplace manifests already advertise it.
  - User-facing install: `claude plugins marketplace add Ben2pc/auriga-cli` + `claude plugins install auriga-go@auriga-cli`, or just `npx auriga-cli`.
- **Tier**: plugin — first-party, shipped as a default-offered option.

> **Why a plugin (not a skill)?** Originally this *was* a skill with a `hooks:` block in its SKILL.md frontmatter. Claude Code's `${CLAUDE_SKILL_DIR}` substitution does not currently expand inside skill-bundled hook commands (empirically verified in both `claude -p` and interactive mode), and the hook's cwd is the project root (not the skill dir) so the documented `./scripts/...` form also fails. Plugins use `${CLAUDE_PLUGIN_ROOT}`, which expands reliably. That asymmetry drove the original promotion to a plugin. Even after the ship-mode Stop hook was removed (see below), the plugin form is kept so multiple skills can be bundled under one install + so future hooks remain an option without re-promoting.

## Decisions locked in

| Area | Decision |
|---|---|
| Scenario | **E** — unified "workflow state machine" entry: covers session resume (`/clear` / compact), handoff of half-done work, workflow correction, and generic "what's next" compass. |
| Output type | **③ Autonomous driving** — detect state → take action → loop until a hard stop. |
| Hard stops | Exactly two classes: (a) ambiguity that needs a human answer; (b) destructive / irreversible operations. Everything else: push forward. |
| Primary data source | **Agent context** — whatever the main Agent already sees (its native task/todo tracker, in-flight tasks, recent tool results). |
| Fallback data sources (probed on miss) | **A**: `planning-with-files` artifacts (`task_plan.md`, `progress.md`). **C**: open Draft PR body TODO checkboxes. **D**: git / filesystem / GitHub state evaluated against the workflow heuristic. |
| Fallback protocol | When context is insufficient → probe A/C/D → present findings → confirm with user → write todos → proceed. |
| Architecture | **Approach 3** — two modes: `mode=step` (single action + return, conservative); `mode=auto` (default, internal loop, stops at any human-decision gate). For autonomous spec-to-PR runs, route through the sibling `/goalify` skill which dispatches Claude Code's built-in `/goal` command. |

## Resolved clarifications (rationale archive)

| Area | Decision + rationale |
|---|---|
| Invocation | `/auriga-go` slash command **OR** natural-language trigger (e.g., "按照工作流继续", "continue the workflow"). Both paths enter the same skill. |
| Relationship with other workflow skills | **Reminder-based, not orchestrating.** auriga-go inspects state and tells the main Agent which skill to invoke next (`spec-design`, `planning-with-files`, `test-designer`, `deep-review`, etc.); it never dispatches those skills itself. Keeps the skill thin and lets the main Agent own tool choice. |
| CLAUDE.md integration | **Independent meta-tool** — not embedded in any numbered step. Referenced from the workflow as a compass/autopilot available at any point. |
| Hard-stop enumeration | **No explicit whitelist.** The two contract classes (ambiguity / destructive-or-irreversible) stay as-is; rely on the model to recognize concrete commands in context. Rationale: destructive operations are low-frequency and context-sensitive — an enumeration would both miss cases and add maintenance drag. |
| Fallback D state signals | **No fixed signal → workflow-step mapping table.** SKILL.md describes the fallback *intent* (probe git / filesystem / GitHub state → present findings → confirm with user → write todos → proceed); the model derives the concrete signals per situation. |
| Progress visibility | **No prescribed echo format.** Each Agent has its own task tracker; auriga-go's job is to tell the Agent to record the current workflow step through that native tracker. No mid-run echo prescribed. |
| Acceptance criteria | `deep-review` passes on the PR + human-partner dogfooding. No pre-specified smoke/integration test matrix — real usage is the test. |

## Why the Experimental `ship` mode was removed

`ship` (introduced 2026-04 alongside auriga-go's plugin promotion) was a Stop-hook-backed mode that drove a spec to PR Ready autonomously: a `${CLAUDE_PLUGIN_ROOT}/scripts/ship-loop.sh` Stop hook, a `.claude/auriga-go-ship.local.md` state file, `<ship-done>Ready|Blocked</ship-done>` markers, iteration budget + grace turn, and Ready/Blocked PR-comment templates.

Claude Code 2.1 shipped a built-in `/goal` slash command (session-scoped Stop hook + transcript-persisted state + cross-`/clear` restore) that subsumes ~90% of ship's loop mechanics — for free, in the harness, with telemetry. Maintaining a parallel implementation no longer earned its keep. The replacement is a sibling skill `/goalify` (single-prompt: plan a goal from spec/work-in-progress and dispatch `/goal`), keeping the user-facing affordance intact while the loop dynamics, persistence, and termination judgment move into the harness.

> **Audit trail for two in-conversation decisions** (PR #72 deep-review surfaced these as silent resolutions worth recording): (a) the user instructed "全部删掉" for ship, then explicitly approved keeping this postmortem section so the rationale isn't lost — the runtime SKILL.md stays silent, the architecture doc keeps the memory; (b) the user framed the replacement as "用内置的 /goal", so `/goal` as the dispatch target is explicitly chosen, not a silent reading of the spec.

What ship had that `/goal` does not, and what we chose to drop:

- **Iteration budget + grace turn** — `/goal` has no hard cap. The replacement relies on `/goal clear` (manual) or `/goal`'s own model-judged "achieved" termination.
- **`<ship-done>` exit markers** — `/goal` evaluates a natural-language condition; no marker scanning.
- **Strict-defaults table + Ready/Blocked PR-comment templates** — these were ship-specific contract surface. If they re-emerge as patterns, they'll live in `/goalify`'s SKILL.md, not in the plugin's hook layer.

## Risks

- **Autonomy tension** with CLAUDE.md's "Automation ladder — start low" principle. Mitigations: two-class hard-stop contract, Confirmation Contract on fallback inference, recording every workflow step through the Agent's native task tracker, `mode=step` escape hatch.
- **State-detection misreads** in fallback path D. Mitigation: fallback-path results must be confirmed with the user before todos are written.
- **Version skew** with CLAUDE.md workflow — if the workflow evolves, `auriga-go`'s encoded view drifts. Mitigation: pin the workflow version in this doc's header; treat workflow rewrites as a trigger to bump the skill.

## Built artifacts

- `plugins/auriga-go/.claude-plugin/plugin.json` — Claude Code plugin metadata (name, description, author)
- `plugins/auriga-go/.codex-plugin/plugin.json` — Codex plugin manifest (mirrors metadata + richer interface block; bumps version independently)
- `plugins/auriga-go/skills/auriga-go/SKILL.md` — frontmatter (`argument-hint`), algorithm, Stop/Confirmation contracts, two-mode table, examples
- `plugins/auriga-go/skills/goalify/SKILL.md` — single-paragraph prompt: plan a goal from spec or work-in-progress, ask the user if ambiguous, then dispatch `/goal`
- `plugins/auriga-go/README.md` — plugin overview and manual install instructions
- Repo-root `.claude-plugin/marketplace.json` — Claude Code marketplace manifest listing auriga-go
- `.agents/plugins/marketplace.json` — Codex marketplace manifest listing auriga-go
- `extra_plugin_configs.json` — no auriga-go entry required; only external plugins and default-policy overrides live there
- Root `CLAUDE.md` / `CLAUDE.zh-CN.md` do **not** reference auriga-go — the dedicated "Workflow Autopilot" section was removed in the CLAUDE.md slim pass (PR #46) to keep the workflow spec minimal. auriga-go is now surfaced only via the Plugins table in `README.md` / `README.zh-CN.md` and the marketplace manifests.
- `.claude/CLAUDE.md` dev-guide documents the plugin-owned authoring convention and the `${CLAUDE_SKILL_DIR}` bug workaround.
