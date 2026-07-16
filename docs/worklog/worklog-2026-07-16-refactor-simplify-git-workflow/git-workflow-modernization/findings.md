# Findings & Decisions

## Requirements
- Retain `git-workflow` as a team-specific lifecycle skill, but remove generic Git teaching and duplicated hook implementation details.
- Add repository/worktree preflight and user-change protection.
- Preserve atomic commits, early Draft PR, five-element PR body, Ready feedback batches, and merge checks.
- Use bilingual PR template headings and Chinese example body text.

## Research Findings
- The current skill is 260 lines and repeats policy already present in the managed `AGENTS.md` plus mechanism details already maintained in hook scripts/tests and the plugin README.
- Bilingual headings must remain compatible with `pr-create-guard` and `pr-merge-guard`; inspect their heading normalization before editing.
- `pr-create-guard` and `pr-ready-guard` display headings without enforcing exact names, so bilingual headings require no code change there.
- `pr-merge-guard` recognizes headings anchored by English `Acceptance Criteria` and `Test Plan`, followed by arbitrary bilingual suffixes. The planned English-first headings remain compatible; add a regression fixture for the exact template shape.
- The merge guard already recognizes Chinese-only `验收标准` and `测试计划`; existing PR bodies remain compatible.
- The release surface requires updating the skill, its content contract, the exact bilingual merge-guard fixture, both plugin manifests, the plugin README, and the long-running review record/status.
- Draft PR #189 successfully rendered all six bilingual headings; `pr-create-guard` reported the expected heading list and pending verification checkboxes.
- The packed package remains version 1.37.2 while the plugin payload advertises 4.0.9; this matches the repository rule that plugin-only payload changes do not bump the CLI package version.
- `pr-ready-guard` still checks legacy root-level `task_plan.md`, `findings.md`, and `progress.md`, while the active plan for this PR lives under `.planning/2026-07-16-simplify-git-workflow-skill/` with `.planning/.active_plan` as its pointer.
- The current `planning-with-files` isolated workflow may also create `.attestation`; all regular files under `.planning/` are session planning state and should be archived or deleted before Ready.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Target roughly 100–130 lines | Enough space for non-obvious team contracts without retaining Git tutorials. |
| Keep hook behavior as a compact table | The skill should explain the contract, while scripts/tests remain the implementation source of truth. |
| Use English-first bilingual headings | `## Acceptance Criteria / 验收标准` and `## Test Plan / 验证计划` remain compatible with current anchored guard regexes. |
| Create a minimal child spec and validation contract | The long-running review index defaults to per-PR child contracts; no explicit waiver was given for this skill. |
| Recursively block regular files under `.planning/`, not only three basenames | This covers isolated plan directories, the active pointer, and attestation metadata without coupling the guard to one plan identifier. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Initial planning-file patch failed because an expected line appeared before the matched hunk | No file changed; re-read the plan and applied exact hunks. |

## Resources
-
