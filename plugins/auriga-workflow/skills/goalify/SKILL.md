---
name: goalify
description: 当用户要求 set goal、run autonomously、autopilot、跑到 Ready、自动跑完、自驱执行、goalify it，或明确想把当前 spec / work-in-progress 规划成 `/goal` 任务并派发时使用。
---

根据 spec 或者当前的工作进展，先 plan 出 goal，再与用户确认 goal 要跑到哪个阶段为止，然后按当前 Agent 的能力启动 `/goal`，或输出可粘贴的 `/goal` 文本交用户启动。如果有疑问或者目标难以明确，在 set goal 前询问用户。

## 定位

goalify 是**需求已经明确之后**用来驱动长程任务的工具——把"做什么、从哪里读取上下文、跑到哪里停"翻译成一段可被 `/goal` 驱动、连续自驱的任务说明。

**适用**：
- spec / validation contract 已完成（或者用户已经在对话里把目标说清楚），现在需要"跑一段"才能拿到结果
- 改动跨多个步骤 / 多个文件 / 多轮 verify，希望 agent 不停在每一步打断用户
- 用户明说"自动跑完 / 跑到 Ready / autopilot / 自驱"

**不适用**：
- 需求还在澄清阶段（Q+GUESS 还没收敛、用户还在 reframe 范围）→ 先走 `spec-design`
- 一次性单步任务（一个 grep、一条命令、一行修改）→ 直接做，goalify 的 plan + /goal 开销不划算
- 改动方向尚未定（plan 阶段未完成）→ 先完成规划或架构设计，再视情况包成 goal

**与 `incremental-impl` 的边界**：`incremental-impl` 管实现阶段的规模判定、切分轴、切片粒度和切片内纪律；goalify 管把已明确目标包装成连续执行任务。`/goal` 文本应指向 spec 包或当前工作进展，要求运行期按 auriga workflow 推进，并在真正进入实现阶段时按需调用 `incremental-impl`，不要在 goalify 阶段预先硬编切片计划。

## 选了 goalify 不等于跳过 plan

用户在规划阶段选择 goalify，不代表跳过 plan。goalify 只是把工作交给自驱的 `/goal` 运行，那段运行中没有交互提示可用——所以**规划方式由 agent 自己定**：agent 自行判断该用内置 Plan、`planning-with-files`，还是先跑 `arch-design` 出架构设计，并把这个规划责任写进 `/goal` 文本。换句话说，选 goalify 是把"怎么 plan、怎么往下推进"的决定权交给 agent 自驱完成，而不是取消这个决定。

## 输入来源

优先从 `spec-design` 产出的 spec 包里取信息，两份文件都要看：

- `docs/specs/<topic>/spec.md` — 取 Why / What / Out of scope 段，作为 goal 的目的与边界
- `docs/specs/<topic>/validation-contract.md` — 作为 goal 的完成判据来源；`/goal` 文本只需指向这份文件并要求运行期逐项验证，不要把 VAL 列表展开复制进输入框

没有 spec 包时，从用户对话里的目标描述 + 当前分支 / commit 历史 / PR 描述提炼。

## 确定终点阶段

set goal 之前必须和用户确认这个 goal 的终点——它要把 auriga workflow 推进到哪个阶段就停下。用 `AskUserQuestion` / `request_user_input` 给出选项，常见终点：

- **跑到 Draft PR** — 建分支、首个有意义的 commit、开好 Draft PR 就停，留给用户审范围
- **跑到验证完成** — 实现 + 测试全绿，PR 仍保持 Draft
- **跑到 PR Ready** — 验证完成 + 补全 PR 描述五要素 + 标记 Ready for Review
- **跑到 deep-review 完成** — 标记 Ready 后运行正式 `deep-review`；修复 blocking findings；non-blocking findings 由 agent 按严重度、置信度和改动风险判断是否修；最后把处理结果同步到 PR
- **跑到 deep-review 收敛** — 「跑到 deep-review 完成」的循环版本：deep-review → 修 blocking findings → 提交 → 再次 deep-review，直到三条同时满足：(1) 最近一轮 `deep-review` 报 0 blocking findings；(2) 所有 PR Check 通过；(3) PR 上没有未解决（unresolved）的 blocking review comment。non-blocking findings 仍按严重度、置信度和改动风险判断。不设循环上限，`/goal` 文本不要硬编轮数
- **跑到合并** — 含评审与合并

把用户选定的终点作为**显式终止条件**写进 `/goal` 文本：goal 跑到该阶段即停，不要越界继续推进。终点之后的阶段（评审、合并等）若不在范围内，goal 文本里要写明"到此为止，交回用户"。

若 goal 终点为 PR Ready 或更后阶段，`spec-design` / `arch-design` / `planning-with-files` 产出的设计文档（`spec.md`、`arch_design.md`、`findings.md`、`progress.md`、`task_plan.md` 等）默认归档到 `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/`——自驱运行中没有交互提示，不要为了询问处置方式而停下来。若你判断删除或其他处置更合适，不要擅自执行，在 handoff 里说明理由交回用户定夺。

指定的 goal 最后必须给用户一段 handoff：说明这次做了什么、用户怎么验收、用户下一步可以做什么。若 goal 范围包含 review，还要补充 review 发现、处理结果以及未处理项的保留原因。

## 启动方式

`/goal` 是目标运行机制，不要把某一个 Agent 的交互方式写成通用规则：

- **Claude Code**：通常产出 `/goal` 文本，由用户粘贴到 Claude Code 的 `/goal` 命令启动；技能层不要假装自己能直接派发 Claude Code 界面命令。
- **Codex**：如果当前 Codex 环境暴露 goal 启动能力，Agent 可以自行设置并启动 goal；如果没有暴露，就退化为输出 `/goal` 文本交用户启动。

## Must Not

- Must not 在 `/goal` 文本里硬编切片计划。切片、规模判定、切分轴和粒度属于 `incremental-impl` 的实现阶段职责。
- Must not 把 `spec.md`、`validation-contract.md` 或 PR 描述里的已有内容大段复制进 `/goal`。仓库是事实来源，`/goal` 只需要指向这些文件并声明执行约束。
- Must not 预判 `deep-review` 会发现哪些问题或提前写修复方案。`/goal` 只能写处理策略：修复 blocking findings，non-blocking findings 按严重度、置信度和改动风险判断。

## Examples

Good `/goal` 文本示例：

```text
修复 GitHub issue #139。上下文以 docs/specs/<topic>/spec.md、docs/specs/<topic>/validation-contract.md 和 issue 正文为准；不要重复抄写这些文件。

按 auriga workflow 推进：从 main 建分支，测试先行，必要时在实现阶段调用 incremental-impl 决定切片。终点是 deep-review 完成：PR Ready 后运行 deep-review，修复 blocking findings；non-blocking findings 按严重度、置信度和改动风险判断是否修；把处理结果同步到 PR。最后给用户 handoff，说明做了什么、验收方式、下一步建议；因为本 goal 包含 review，也要说明 review 发现、处理结果和未处理项的保留原因，然后停止。
```

Bad `/goal` 文本示例：

```text
先做 slice 1 改 goalify 文档，再做 slice 2 改测试，再做 slice 3 开 PR。下面复制完整 spec、所有 VAL 表格和预估的 deep-review 问题清单……
```

坏例子的两个问题：它在 goalify 阶段提前规定切片，并把仓库已有内容搬进输入框，既抢了 `incremental-impl` 的职责，也浪费 `/goal` 的有限输入空间。

## 其他规则

- 如果可能，按照 auriga workflow 来推进
