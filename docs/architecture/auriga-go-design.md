# auriga-go — Workflow Autopilot Skill (Design)

**Status**: DRAFT · brainstorming in progress · 2026-04-17
**Branch**: `claude/start-new-feature-kfyky`
**Workflow version anchor**: General Workflow v1.3.0 (`CLAUDE.md`)

## Purpose

A workflow skill that drives the Agent forward along the CLAUDE.md 12-step workflow with minimum prompting. When invoked, it inspects state, determines the next action, and executes (auto mode) or proposes one step (step mode). It stops only at two classes of hard stops:

1. Ambiguity that requires a human answer (requirement / design choice, two or more equally-valid paths).
2. Destructive or irreversible operations (force push, main-branch writes, file deletion, `--no-verify` or other safety bypass, package publish, CI/CD mutation).

## Name

`auriga-go` — continues the Latin *auriga* ("charioteer") motif of the project with *go* indicating forward motion. The charioteer keeps driving.

## Placement

- **Source in this repo**: `.claude/skills/auriga-go/SKILL.md` — a **real directory**, sibling to the existing symlinks in `.claude/skills/`. Its real-directory status (vs. the symlinks that `npx skills add` manages from external sources) is the visual cue: "repo-owned, not externally synced".
- **Installed to user project**: `.claude/skills/auriga-go/` — standard location.
- **Install mechanism**: a new repo-local copy path in `src/skills.ts`, modeled on the directory-copy pattern in `src/hooks.ts`. Maintained list: `LOCAL_WORKFLOW_SKILLS = ["auriga-go"]`. Does **not** go through `skills-lock.json` or `npx skills add`.
- **Tier**: workflow skill (default-on), not a recommended/opt-in utility.

## Decisions locked in (brainstorming §1)

| Area | Decision |
|---|---|
| Scenario | **E** — unified "workflow state machine" entry: covers session resume (`/clear` / compact), handoff of half-done work, workflow correction, and generic "what's next" compass. |
| Output type | **③ Autonomous driving** — detect state → take action → loop until a hard stop. |
| Hard stops | Exactly two classes: (a) ambiguity that needs a human answer; (b) destructive / irreversible operations. Everything else: push forward. |
| Primary data source | **Agent context** — whatever the main Agent already sees (especially `TodoWrite` state and in-flight tasks). |
| Fallback data sources (probed on miss) | **A**: `planning-with-files` artifacts (`task_plan.md`, `progress.md`). **C**: open Draft PR body TODO checkboxes. **D**: git / filesystem / GitHub state evaluated against the 12-step workflow heuristic. |
| Fallback protocol | When context is insufficient → probe A/C/D → present findings → confirm with user → write todos → proceed. |
| Architecture | **Approach 3** — two modes: `mode=auto` (default, internal loop) honours the "reduce prompts" goal; `mode=step` (single action + return) preserves the conservative fallback. |

## Open questions (to resolve in next session)

- **§2 Mode semantics** — precise loop contract; per-iteration "next-step intent" echo for visibility; max-iteration / loop-budget cap to prevent runaway.
- **§3 Hard-stop whitelist** — enumerate concrete commands / patterns that trigger auto→stop (destructive git, main-branch writes, `rm -rf`, `npm publish`, `gh release create`, CI/CD file mutations, etc.).
- **§4 State detection signals** — the exact git / filesystem / GitHub / test signals probed in fallback path D, and how they map to the 12-step workflow position.
- **§5 SKILL.md content structure** — the instruction block the Agent follows when the skill is invoked (algorithm, echo contract, stop contract, confirmation contract).
- **§6 Installer integration** — concrete `src/skills.ts` changes; the directory-copy helper; interaction with the existing scope selection (project vs. global); tests.
- **§7 CLAUDE.md workflow integration** — which step(s) reference `auriga-go` explicitly; dual-language update (`CLAUDE.md` + `CLAUDE.zh-CN.md`).
- **§8 README docs, final acceptance criteria, and test plan** — README skills-table entry (both languages); acceptance checklist; smoke / unit / integration test matrix.

## Risks (preliminary)

- **Autonomy tension** with CLAUDE.md's "Automation ladder — start low" principle. Mitigations planned: hard-stop whitelist, per-iteration intent echo, loop-budget cap, `mode=step` escape hatch.
- **State-detection misreads** in fallback path D — a wrong inference could push the Agent toward the wrong next action. Mitigation: fallback-path results must be confirmed with the user before todos are written.
- **Loop runaway** in `mode=auto` without an iteration cap. Mitigation: enforce a max-iterations budget in §2.
- **Version skew** with CLAUDE.md workflow — if the 12-step workflow evolves, `auriga-go`'s encoded view drifts. Mitigation: pin the workflow version in SKILL.md; treat workflow rewrites as a trigger to bump the skill.

## Next session

Resume brainstorming at §2 (mode semantics and hard-stop whitelist detail). After §2–§8 are closed, finalize this spec, invoke the `writing-plans` skill, and start TDD implementation.
