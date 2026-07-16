# Task Plan: Simplify Git Workflow Skill

## Goal
将 `git-workflow` 精简为面向最新模型的 Git 生命周期契约，保留团队安全边界与 PR 协议，并把 PR 模板改为中英文标题、中文正文示例。

## Current Phase
Phase 6

## Phases

### Phase 1: Requirements & Discovery
- [x] Understand user intent
- [x] Identify guard and test contracts affected by bilingual headings
- [x] Document in findings.md
- **Status:** complete

### Phase 2: Planning & Structure
- [x] Define the minimal retained workflow
- [x] Map required test and documentation updates
- **Status:** complete

### Phase 3: Implementation
- [x] Simplify `git-workflow/SKILL.md`
- [x] Update affected contracts and long-running review state
- **Status:** complete

### Phase 4: Testing & Verification
- [x] Run targeted guard and skill tests
- [x] Run official skill validators and relevant repository checks
- **Status:** complete

### Phase 5: Delivery
- [x] Commit, push, and open Draft PR
- [x] Present the change for user review
- **Status:** complete

### Phase 6: Align Ready Guard with Isolated Planning Paths
- [x] Add a failing regression test for `.planning/<plan-id>/` artifacts
- [x] Replace legacy root-file detection with recursive `.planning/` detection
- [x] Update plugin documentation and version contracts
- [x] Run targeted and repository verification, then update PR #189
- **Status:** complete

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Keep this as one serial implementation slice | The skill, hooks, tests, and review record are tightly coupled; parallel writers would collide semantically. |
| Do not create a child spec unless requested | The user directly approved the design direction and asked to implement; acceptance is recorded here and in the PR. |
| Persist a minimal child spec after checking the long-running review rule | The long-running review contract requires a child spec by default; the user's direct approval satisfies the implementation gate but was not an explicit lifecycle waiver. |
| Treat every regular file under `.planning/` as a temporary Ready blocker | The current isolated workflow stores plans, the active pointer, and optional attestations there; checking only the three Markdown names would leave stale planning state behind. |

## Errors Encountered
| Error | Resolution |
|-------|------------|
| First plan update patch used an out-of-order context anchor and did not apply | Re-read the generated plan and applied a narrower patch against exact lines. |
| Browser skill catalog path pointed to an older cached plugin build that no longer existed | Located the currently installed browser plugin build and read its skill before browser interaction. |
| Three local Web UI servers exited after the documented 120-second inactivity timeout before navigation | Restart the servers and navigate immediately using the existing browser connection. |
| First PR body update passed Markdown backticks through a double-quoted shell argument, so the shell attempted command substitution | Reissued the update with a single-quoted argument and verified the remote body contains the literal `git-workflow` name. |
