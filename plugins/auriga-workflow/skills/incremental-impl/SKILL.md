---
name: incremental-impl
description: 规划并执行有一定复杂度的代码改动：规模判断（XS–XL）、slicing strategy、可选并行 subagent 派发，以及每个 slice 的 Implement → Test → Verify → Commit 纪律。适用于多文件改动、跨文件重构、执行来自任意 planning source 的任务、跨切面修改（analytics sweep / i18n / library migration），或预计要写超过约 100 行代码的工作。也用于增量实现、切片落地、推进已规划任务和跨切面改动。仅在规模门判定为 XS，或纯 documentation / configuration 改动时跳过。
---

# 增量实现 / Incremental Implementation

与 planning 配套使用。**Plan** 决定方向和约束（要构建什么、Acceptance criteria）。**这个 skill** 决定如何执行：规模、slice、派发和验证。

## 使用时机 / When to Use

遇到**任何需要拆分、验证或协调的实现工作**时调用：

- 多文件功能实现
- 跨多个文件的重构
- 即将写超过约 100 行代码
- 执行已规划任务（来自任意 planning source，见 Inputs）
- 跨切面改动（analytics sweep、i18n pass、library migration）

**仅在以下情况跳过：**

- 规模门判定为 XS 的极小 edit（1 个 Acceptance criterion、1 个 concern、diff <30 行）
- 不涉及代码逻辑的纯 documentation / config 改动

## 输入 / Inputs

- 来自任意 planning source 的 task 或 spec：内置 Plan、`planning-with-files` 的 `task_plan.md`、`docs/specs/<topic>/` 下的 `spec-design` spec，或用户直接给出的任务描述。这个 skill 不关心任务最初如何产生。
- Acceptance criteria：这个 work slice 达到“完成”的判定标准。

如果 Acceptance criteria 缺失或含糊，先回到 planning，再继续实现。实现必须有明确目标。

## 步骤 1：规模门 / Step 1: Size Gate

按三个维度判断；当维度结论不一致时，**取更高的规模**：

| Size | Acceptance criteria | Distinct concerns | Est. diff lines | Skill behavior |
|---|---|---|---|---|
| **XS** | 1 | 1 | <30 | 跳过这个 skill，直接写 |
| **S** | ≤2 | 1–2 | 30–100 | 套用执行纪律，不拆 slice |
| **M** | ≤3 | 单个 feature 内的多个 concern | 100–300 | 选择 slicing strategy + 单 writer + 执行纪律 |
| **L** | 4–6 | Cross-component | 300–800 | 选择 slicing strategy + **评估 parallel dispatch** + 执行纪律 |
| **XL** | >6 | 跨独立 subsystems | >800 | **回到 plan。** 太大，不能一次入口内完成 |

这里的 "concern" 指一个内聚的责任单元：一个 component、module，或一个独立行为。

**为什么维度不一致时取更高规模：**低估规模（把真实的 L 当成 M）会在中途制造 merge conflict 和破碎的中间状态。高估规模只是多一点流程成本。两者代价不对称，所以偏保守。

**示例：**

- “跨 12 个文件添加 12 个 analytics events，每处 2 行” → AC=1，concerns=1（analytics），<30 行 → **XS**
- “一个 SwiftUI View，400 行，5 个 subviews + state” → AC=3，concerns=1，>300 行 → **M**（diff lines 抬高规模）
- “重构 auth middleware + 更新 3 个 callers + 加 tests” → AC=4，cross-component，约 400 行 → **L**

## 步骤 2：选择切片策略 / Step 2: Pick Slicing Strategy

从上到下运行这个判定树；第一个命中的分支即为结果。

**Q1：这是 greenfield 的 0→1 首次落地吗？**
→ **Walking Skeleton**：一条穿过所有层的极薄 Vertical path（data → service → UI → test），刚好足以证明架构连得起来。之后再加厚。

**Q2：这是“在很多地方修改同一类事情”吗（analytics sweep、i18n、lint pass、mass refactor、design system rollout）？**
→ **Horizontal sweep**：同一层、多个文件、一个内聚改动。按逻辑组一组一个 commit。

**Q3：这是大型架构迁移吗（UIKit→SwiftUI、sync→async、framework swap）？**
→ **Branch by Abstraction**：先引入临时抽象层，把实现逐个迁到抽象之下，再移除旧路径。形态上偏 Horizontal，但明确是过渡型。

**Q4：是在添加新的自包含功能，或修一个 bug 吗？**
→ **Vertical slice**：把 model + business logic + view + tests 放在一个内聚改动里。它是既有代码库中“添加一个新的 X”工作的默认选择。

**Fallback**：Vertical slice

**常见混淆：** "Vertical vs horizontal" 是切片轴；"serial vs parallel" 是 writer 数量。两者正交：Vertical slices 可以并行派发（三个独立 bug 分别在三个文件中修复），Horizontal sweeps 通常串行执行。

## 步骤 3：并行派发 / Step 3: Parallel Dispatch（仅 L 规模）

XS / S / M 跳过本节，它们由单 writer 执行。

对于 L 规模，判断是否把 slices 派发给并行 subagents。

### 铁律 / The Iron Law

只有当**每个 slice 都有独立输入和独立输出**时，slice plan 才有效。如果两个 slices 可能碰撞：同一文件、共享数据结构、或共享执行中状态，它们就不能并行。把它们合并给一个 writer，或串行执行。

### 3.1 可切分性检查 / Slice-ability Check

问：这个任务能否切成输入和输出都不重叠的几块？

- ✅ “修三个不同文件里的三个独立 bug，每个 bug 都有自己的 test” → 完全独立
- ✅ Greenfield：把 store、service、ui 分成不同 slices → 仅当不存在共享的执行中状态时成立
- ❌ “重构 utils.ts 并更新所有 callers” → 级联编辑，串行
- ❌ “给 exec 加 retry，然后迁移 callers 使用它” → pipeline，不是并行

如果不能，**终止 parallel dispatch**，按单 writer 继续。

### 3.2 草拟文件分配 / Draft File Assignments

对每个候选 slice，列出：

- 它创建 / 修改 / 删除的文件
- 它需要其他 slices 提供什么输入（paths、signatures、data shapes）
- 它产出什么输出（diff、new files、state change）

### 3.3 碰撞检查并合并 / Collision Check → Merge

对每个出现在多个 slice 中的文件：

- 即使只是 append-only 编辑同一文件，也合并给一个 writer（相邻行并发编辑会产生 conflict）
- 语义上重叠的编辑，也合并

### 3.4 规模过滤 / Size Filter

估算每个剩余 slice 的 diff lines：

- **<50 行** → 从派发中移除；main Agent inline 处理。派发成本（worktree、context、merge）高于收益
- **50–150 行** → dispatch candidate
- **>150 行或 architectural** → dispatch，并在该 slice 上标注 "stronger reasoning model at xhigh effort"

**Minimum-slices gate：**过滤后如果少于 3 个可派发 slices，**终止 parallel**，由 main Agent 串行处理。少于 3 个 writers 时，流程成本高于并行收益。

### 3.5 每个 slice 的输出契约和验证命令 / Output Contract + Verify Command Per Slice

对每个派发出去的 slice，决定：

- **Output format**：subagent 必须返回什么格式（unified diff + rationale / full file + role / config section verbatim / test file + requirement map）
- **Verify command**：main Agent 在 diff 返回后要运行什么（`npm test -- path`、`tsc --noEmit`、受影响 package 的 build、最小 smoke test）
- **Handoff block**（强制）：每个派发出去的 subagent 都必须在其回复的**绝对最后**输出第 4.8 节的结构化 handoff block，放在该 slice 专属输出之后。下一个 slice 读取这个 block，而不是读取之前的过程轨迹。

没有 output format，subagent 会倾倒冗长上下文，抵消派发收益。没有 verify command，main Agent 就是在盲信 subagent 的结论并合并。没有 handoff block，下一个 slice 除了文件 diff 之外没有任何可承接信息；发现的问题、跑过的命令和流程偏差都会丢失。

### 3.6 输出派发计划 / Emit the Dispatch Plan

| Slice | Writer | Model | Files | Depends on | Output format | Verify |
|---|---|---|---|---|---|---|
| 1 | subagent | inherit | `src/x.ts` | — | diff + rationale | `npm test -- x` |
| 2 | subagent | inherit | `src/y.ts` | slice 1 signature | diff + rationale | `npm test -- y` |
| 3 | main Agent | — | `src/z.ts` | slice 1 complete | (inline) | `npm test` |

**Model column contract：**默认写 `inherit`，表示 subagent 使用 main Agent 当前模型。只有调用方有明确理由时才覆盖：用户指定了某个模型、slice 带 architecture 属性且需要更强推理和 `xhigh` effort，或 slice 很机械、可降到更便宜模型。除非用户点名具体模型，否则用中性短语写覆盖项（如 `stronger reasoning model, xhigh effort`）。

main Agent 在一条消息里把并行 slices 派发给 subagents：每个 slice 一次派发，每个 writer 隔离在自己的 git worktree 中。有依赖的 slices 等依赖完成后再执行。

## 步骤 4：执行纪律 / Step 4: Execution Discipline（每个 Slice）

适用于**每个**通过这个 skill 执行的 slice：单 writer 或派发出去的 writer 都一样。（XS 工作会按 Step 1 绕过此 skill，所以 4.1 的循环只覆盖 S 及以上规模。）

### 4.1 增量循环 / Increment Cycle

```
Implement → Test → Verify → Commit → Handoff → Next slice
```

这是核心循环。每个 slice 都必须完整跑完循环，才能进入下一步。

- **Implement**：实现这个 slice 中最小但完整的功能片段
- **Test**：运行相关测试套件，或按 `test-driven-development` 先写 failing test
- **Verify**：tests 通过、build 成功、type checks 干净，需要时完成 manual check
- **Commit**：每个 slice 一个 atomic commit（commit message 规则见 `git-workflow`）
- **Handoff**：输出结构化 handoff block（第 4.8 节）。派发出去的 subagent slice 把它作为返回回复的最后部分；inline slice 由 main Agent 在进入下一 slice 前写入对话记录
- **Next slice**：承接 handoff block，而不是承接过程轨迹

每个 slice 结束后，系统都必须处于可工作、可测试状态。不要留下半成品 slice。

### 4.2 简单优先 / Simplicity First

写代码前先问：**“最简单能工作的东西是什么？”**

写完后自审：

- 这些代码能不能更少？
- 每个抽象是在为**这个**任务承担复杂度，还是在为想象中的未来承担复杂度？
- 三行相似代码好过过早抽象

这与根原则“如无必要勿增实体 / don't add features, refactor, or introduce abstractions beyond what the task requires”一致。

### 4.3 范围纪律 / Scope Discipline

只碰任务需要的内容。不要：

- “顺手清理”改动旁边的代码
- 重构你没有修改的文件里的 imports
- 在只是阅读的文件里现代化语法
- 删除你没有完全理解的 comments

如果发现任务范围外值得改进的东西，**记录下来，但不要修**：

```
NOTICED BUT NOT TOUCHING:
- src/utils/format.ts has an unused import (unrelated to this task)
- Auth middleware could use better error messages (separate task)
```

在 slice 结束时告诉用户，让用户决定是否单独开任务。

### 4.4 Slice 之间保持可编译 / Keep Compilable Between Slices

每个 slice commit 后，项目必须能 build，已有 tests 必须通过。不要在 slices 之间留下坏掉的代码库。如果某个 slice 天然会产出破碎的中间状态，说明 slice 边界切错了，需要重切。

### 4.5 易回滚 / Rollback-Friendly

每个 slice 的 commit 都应能独立 revert。

- Additive changes（新文件、新函数）容易 revert
- 修改保持最小且聚焦
- DB migrations 要有 rollback migrations
- **Never delete-and-replace in the same commit**：拆成两个 commits

Atomic commit 规则见 `git-workflow`；本规则在其基础上增加 delete-replace 约束。

### 4.6 风险优先执行顺序 / Risk-First Execution Order

当多个 slices 互不阻塞（没有 inter-slice dependency 强制顺序）时，先做最不确定的 slice。风险最高的 slice 如果失败，就能在投入依赖工作前发现。

示例：

- 先做 WebSocket integration，再做依赖它的功能
- 先接 Third-party SDK，再做其上层功能
- 先试未验证的平台 API，再写依赖它的生产逻辑

Risk-first 是**执行顺序**，不是 slicing axis。它可以和 Vertical slice 或 Horizontal sweep 组合。

### 4.7 不重复无效命令 / Don't Repeat Useless Commands

如果一个命令（build、test、type check）已经成功跑过，且之后代码没有变化，不要重跑。对未变化代码重复执行不会增加信息，只会消耗上下文。只有在编辑可能影响命令结果后才重跑。

### 4.8 每个 Slice 的交接 Schema / Per-Slice Handoff Schema

每个 slice，无论是派发出去的 subagent 还是 inline，都以一个结构化 handoff block 结束。下一个 slice 读取这个 block，而不是读取之前的过程轨迹。把 slice state 外化为固定形状的文档，用可解析的承接信息替代“agent 记得刚发生了什么”。

**Schema**（markdown，原样复制这个形状）：

```markdown
## Handoff: <slice-name>
**completed**:
  - <bullets — what landed, name files where useful>
**not_completed**:
  - <bullets — attempted but didn't finish, each with one-line reason>
**commands_executed**:
  - `<cmd>` → exit <code> [<one-line outcome>]
**issues_found**: <bullets, or `none`>
**procedure_compliance**: <`followed` | `deviated: <reason>`>
```

**填写示例**（worked example：validation-contract feature 的假想 slice 1）：

```markdown
## Handoff: validation-contract-frontmatter
**completed**:
  - Added optional `validationContract:` field to `SpecMeta` in `src/types.ts`
  - Updated `src/build/generate-catalog.ts` to surface the field into `dist/catalog.json`
  - Added presence + absence cases to `tests/catalog.test.ts`
**not_completed**:
  - Web UI rendering of the field — out of slice scope; next slice owner
**commands_executed**:
  - `npm test -- catalog` → exit 0 [3 tests pass]
  - `npm run build` → exit 0 [dist/catalog.json regenerated]
**issues_found**:
  - `tests/fixtures/` naming convention isn't documented in the test file (surface only; not fixing here)
**procedure_compliance**: followed
```

**为什么是这个形状：**

- 下一个 slice 的 subagent 读取 block，而不是读取之前的对话；没有 agent 需要“记住”
- `commands_executed` 带 exit codes，是审计轨迹；只说“tests pass”但没有记录命令不够
- `procedure_compliance` 让偏差显式出现，而不是埋在上下文里；例如 `deviated: created tests/fixtures/foo.json without prior approval because the fixture didn't exist` 这种信息，下一个 slice owner 需要直接看到，而不是推断
- `not_completed` 即使为空也必须存在；有事情被暂缓时把它留空，是纪律失败
- 五个字段是在模型切换后仍能保住信息的最小集合；扩展这个 schema 应要求同步修改 dispatch prompt templates

**角色**（writer / broker / reader）：

```
   slice N                       slice N+1
   (Writer)       ╳ no direct    (Reader)
      │                             ▲
      │ handoff at                  │ handoff in
      │ end of response             │ dispatch prompt
      │                             │
      └──────▶ Main Agent ──────────┘
               (Broker — sees every
                handoff, pastes into
                next slice's prompt)
```

对于 inline slices，main Agent 同时扮演三个角色：写 block 到 transcript，然后在开始下一 slice 时读回它。

**Slice 间流转：**

当 main Agent 派发 slice N+1 时，它把 slice N 的 handoff block(s) 原样复制进 N+1 subagent 的 dispatch prompt，和 slice N+1 spec、verify command 放在一起。subagent 把 handoff 当数据接收；不改写，不摘要。

对于 inline（main-Agent-writes）slices，main Agent 在进入下一 slice 前，把同样的 block 写入对话 transcript。同样纪律，只是不需要派发流程。

**顺序纪律：**handoff 必须在 Verify 成功完成后填写。Handoff 记录的是已经通过的内容，不是尝试过的内容。如果 verify 失败，这个 slice 还没完成；先修复或回退，再写 handoff。

## 禁止事项 / Must Not（每个 Slice Worker 的范围）

上面的执行纪律从正面描述规则。这里是每个 worker（subagent 或 main-Agent inline）执行单个 slice 时对应的负面规则。

- **Worker 不能宣称“feature done”。** Slice 级别的“done”只表示这个 slice 的 diff 能编译、tests 通过、handoff 填好了。整个 feature 是否满足 Acceptance criteria，由 `verification-before-completion` 判断；PR Ready 之后还要由 `deep-review` 判断，而不是由 worker 自我认证。worker 自己宣布“done”会触发这个 workflow 要避免的 Self-Evaluation Bias。
- **Worker 不能重构 assigned slice 范围外的相邻代码。** 即使相邻代码明显可改，也要通过 Scope Discipline 里的 `NOTICED BUT NOT TOUCHING` pattern 暴露出来，不要静默扩大 slice。slice 内 scope creep 会同时破坏 Rollback-Friendly 契约（同一个 commit 里的 delete-and-replace 会难以 revert）和 Parallel Dispatch Iron Law（一个 slice 改了声明范围外的文件，就可能与并行 slice 碰撞）。

## 反模式 / Anti-patterns

- ❌ 没有检查规模（Step 1）就开始实现 -> 会把简单工作过度切片，或把 L-sized features 切得不够
- ❌ 对存在级联编辑的任务强行 parallel dispatch -> 违反 Iron Law
- ❌ 给“新增功能”选择 Horizontal sweep -> sweep 用于 cross-cutting modifications，不用于 greenfield additions
- ❌ 为了更多 slices 而把 slice 切得太小，试图并行化 -> Step 3.4 size filter 不是可选项
- ❌ 为了更快而跳过 slices 之间的 verify -> bug 会叠加；slice 1 的 bug 会让 slices 2-5 都错
- ❌ 在一个 commit 里混入无关 concerns -> 见 `git-workflow`
- ❌ “顺手清理旁边代码” -> 违反 scope discipline（4.3）
- ❌ 派发 slice 时没有 anti-hardcoding guard -> 隔离中的 subagent 可能为了转绿而硬编码值或削弱 tests。main Agent 的 dispatch prompt 应携带：“implement the general logic; do not hardcode values or weaken tests; if a test looks wrong, surface it instead of patching around it”
- ❌ 试图通过 shared state 在执行中协调 subagents -> 当前 CLI runtime（Claude Code、Codex CLI 等）没有 agent-to-agent channel；通过 main Agent 串行化，或合并成单 writer slice
- ❌ 跳过 handoff block（第 4.8 节）-> 下一个 slice 会丢失审计轨迹（commands + exit codes）、issues-found list 和 procedure-compliance flag。单靠 diff 不是 handoff
- ❌ Verify 通过前就写 handoff -> handoff 记录的是通过的内容，不是尝试过的内容；提前 handoff 会把失败藏在一个看起来干净的 block 后面

## 与其他 Skills 的关系 / Relationship to Other Skills

- 上游 planning sources（任意一种）：内置 Plan、`planning-with-files`、`spec-design`，或用户直接给出的任务；本 skill 不依赖来源
- `test-driven-development`：管理 Step 4.1 中的 red→green cycle
- `test-designer`：可能产出本 skill green phase 要满足的 failing tests
- `systematic-debugging`：当任意 slice 的结果破坏 regression 时运行
- `verification-before-completion`：所有 slices 合并后的最终 gate
- `git-workflow`（auriga-workflow plugin）：4.5 引用的 atomic commit rules
