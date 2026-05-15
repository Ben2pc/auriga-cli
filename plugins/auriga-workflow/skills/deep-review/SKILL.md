---
name: deep-review
description: "对拉取请求执行正式的多维度代码审查。分派并行审查者（spec-conformance、correctness、test-quality、docs-sync、robustness、security、ux、performance、architecture、code-quality、skill-plugin-quality），并将发现综合为问题清单。当用户要求审查拉取请求、执行 /deep-review、将拉取请求标记为待审、或请求正式/全面代码审查时触发。"
---

# Deep Review

多维度拉取请求审查调度器。每位审查者的检查清单、检测表、示例场景和输出契约保存在 `references/reviewers/<name>.md` 中——分派时请读取对应文件，并将其内容传入子代理提示词。

## When to use

调用 `/deep-review`、使用"正式审查"/"全面审查"/"深度审查"等表述、Draft 转 Ready 时、需要独立验证的高风险变更。**跳过情形：** 拼写错误修复、单行调整、快速健全性检查。

## Prerequisites

`gh auth status` 正常，已确定目标拉取请求，具有仓库读取权限。

## Steps

### 1. Fetch + classify

运行 `gh pr view --json number,title,body,baseRefName,headRefName` 和 `gh pr diff`。然后打标签（可多选）：

- **`logic`** — 代码逻辑变更（函数、控制流、数据处理）
- **`auth-sensitive`** — `logic` 的子标签；认证 / 加密 / 密钥 / 支付
- **`ui`** — 命令行 / 终端界面 / Web / 移动端界面
- **`perf`** — 前端 / 移动端 / 后端性能敏感变更
- **`arch`** — 新增文件、模块重组、依赖图变更，或包含 `arch-design` 设计文档（`arch_design.md`）的差异

同时判断是否为 **trivial**（单行、纯配置/文档）还是 **non-trivial**（任何代码逻辑变更）。

### 2. Dispatch reviewers (4 categories, all in parallel)

对每位分派的审查者，读取 `references/reviewers/<name>.md`，将其检查清单、检测表和输出契约传入子代理。元数据块指定 `Reasoning` 档位（`flagship` → 平台顶级模型；`workhorse` → 次于顶级，如 Sonnet / GPT-5.5-mini）、`Tools`，以及可选的 `Effort`（未指定时默认为 `xhigh`——当前 Claude / Codex 推荐值；仅在向下覆盖为简单检查或向上覆盖为 `max` 时才指定）。

**项目级自定义审查者**：同时检索 `docs/rules/review/*.md`（目录不存在则静默跳过）。对每个自定义文件，解析其元数据中的 `Trigger` 字段，并路由到对应的分派类别（A/B/C/D）。若自定义审查者名称与内置审查者重名，则跳过并给出警告——绝不覆盖内置审查者。使用 `reviewer-creator` 技能来创建新的审查者。

**A. Required (always fire):** `spec-conformance`、`correctness`、`docs-sync`

**B. Conditional by tag:**

| Tag | Reviewer |
|---|---|
| `logic` | `robustness` |
| `logic` + `auth-sensitive` | `security`（Robustness 仅保留边缘用例视角） |
| `ui` | `ux` |
| `perf` | `performance` |
| `arch` | `architecture` |

**C. Non-trivial conditional (any non-trivial change):** `test-quality`、`code-quality`

**D. Detection-driven conditional:** `skill-plugin-quality`——当差异中包含以下任意内容时触发：`.claude-plugin/` 或 `.codex-plugin/` 路径、`**/marketplace.json`、`**/SKILL.md`、`**/agents/*.md`（含 YAML 前置元数据）、`**/hooks/hooks.json` / `**/hooks.toml`、`.mcp.json` 或 `mcpServers`、`CLAUDE.md`、`AGENTS.md`。

规范合规性的输入必须排除写代码的 Agent 自身的提交信息、拉取请求正文的理由说明、"自主决策"备注——这些内容会使审查偏向确认写代码的 Agent 的解读。只输入规范源文件和差异内容。

**全新上下文审查者隔离是强制要求。** 每位分派的审查者必须从全新的上下文开始，以便从对抗式、独立视角审查拉取请求。绝不要把上下文复制（继承）进审查者子代理，绝不传递当前会话记录，也绝不为新审查者复用之前的审查会话。在 Codex 原生子代理中，当工具支持时请明确设置 `fork_context: false`。在基于命令行的委派中，启动新会话而非 `resume` / `continue`。审查者提示词只能包含审查数据包：目标拉取请求元数据、差异、相关源文件/规范文件、必要的项目指令、审查者参考文件，以及输出契约。

**Output contract:** 将每个参考文件的 `Output contract` 章节原文传入子代理提示词——不要依赖默认值。每个审查者提示词（内置或 `docs/rules/review/` 自定义的）还必须在开头原文附上 **Reviewer Must-Not Preamble**（见下方章节）——这些角色级约束统一适用于所有维度，集中在此处以便单次修改即可传达至每位审查者。

**运行时：** 并行分派只读审查者，但每位审查者必须使用全新上下文。在平台支持的情况下使用独立代理；若使用会话内子代理，它们仍必须接收全新的提示词数据包，且不得把上下文复制（继承）进来。在需要 xhigh 投入的权衡场景或高风险拉取请求时，优先采用跨模型覆盖（Codex ↔ Claude）。

### 3. Synthesize into a punch list

```
## Deep Review: PR #<n> — <title>
**Tags**: <...>  |  **Reviewers**: <list>
### Blocking issues
- [ ] <file:line> — <finding> — [confidence: high|med|low] (<reviewer>)
### Non-blocking suggestions
- [ ] <file:line> — <finding> — [confidence: high|med|low] (<reviewer>)
### Architectural observations
- <observation and recommended tracking action>
### Strengths (≤2 bullets)
- <one-line credit, e.g. "ACs #1–13 fully traced to file:line by spec-conformance">
```

**分类：** Blocking = 正确性缺陷 / 安全问题 / 测试或契约损坏 / 未满足的规范验收条件 / 无正当理由的范围蔓延 / 对仍有效设计文档的未记录偏差。Non-blocking = 可维护性 / 风格 / 轻微性能问题 / 已记录的歧义 / 通过更新设计文档解决的设计偏差。Architectural = 值得单独跟踪的腐化问题——关于在本拉取请求中修复还是创建跟踪 issue 的分析，请见后续章节。

**置信度：** 在相同 `file:line` 处去重（保留置信度更高的表述）。在各类别内按置信度（high → low）再按严重度排序。低置信度条目保留在报告中——这是给人工审查者的信号；若过于推测性，移入 Architectural 而非删除。

**输出语言：** 以当前会话的语言撰写综合报告（例如，中文会话输出中文报告）。`file:line` 引用、标识符和代码片段保持原文不变。

## Reviewer Must-Not Preamble

这些角色级约束适用于每位分派的审查者（内置及 `docs/rules/review/` 下的项目级自定义审查者）。请将以下内容原文附在每位审查者子代理提示词的开头——不要在各审查者参考文件中重复。单次修改即可传达至每位审查者。

- **不要按严重度预先过滤。** 这一遍是为了全覆盖，不是为了筛选——综合步骤会在下游排序和筛除发现。报告所有在范围内的问题，包括低置信度和 non-blocking 的。强推理模型倾向于字面执行"只报告高严重度"此类表述，会漏掉综合步骤本会标记的真实缺陷。
- **不要提出替代实现方案。** 指出缺陷加上一句修复方向在范围之内。设计替代代码、重构周边模块或编写补丁是独立任务。
- **不要对已审查过的代码不加重新检查就直接放行。** 本次差异所涉及的代码均在范围之内，即使同一行代码曾通过之前的审查——上游契约变更可以悄悄使昨天的正确性结论失效。

## Follow-up

**在本拉取请求中修复 vs 创建跟踪 issue。** Blocking 发现必须在合并前修复，所有维度均无例外。其余情况：能够在当前拉取请求中就地修复且不破坏测试的发现，直接在本次合并——局部结构性修复（放错层、重复实现、孤立的浅层转手包装）或任何 non-blocking 的代码质量/可维护性问题。需要重新划定模块边界的发现，创建跟踪 issue 并路由到 `arch-design`，绝不捆绑进审查周期的拉取请求——上帝模块、发散式变化、霰弹式修改、跨多个模块的循环依赖。设计合规性偏差的处理方式相同：设计文档仍有效 → 将代码拉回正轨；实现证明设计有误 → 创建 issue 修订设计文档。

**`test-designer` 边界**：本技能的 `test-quality` 审查者是**事后**审查（审查已写的测试并标记遗漏）。独立的 `test-designer` 技能处于 **TDD 红灯阶段**（独立评估在实现之前产出会失败的测试）。不要混为一谈。

## Anti-patterns

- ❌ 分派子代理时未指定输出格式 → 上下文泛滥（参考文件中已包含格式；原文传入）
- ❌ 将上下文复制（继承）进审查者子代理、复用之前的审查者会话，或将会话历史作为审查输入——污染的上下文会削弱对抗式审查
- ❌ 串行化彼此独立的审查者 → 浪费时间
- ❌ 正式审查 Draft 拉取请求——Draft 用于非正式早期反馈；等到 Ready 后再审
- ❌ 将写代码的 Agent 自身的提交信息、拉取请求正文理由说明、"自主决策"内容输入规范合规性审查——会偏向确认写代码的 Agent 的解读
- ❌ 告诉审查者"只报告高严重度"、"保守一点"或"不要吹毛求疵"——较新的推理模型会静默丢弃真实发现；在综合阶段筛选，而非在每位审查者处筛选
- ❌ 拆分已合并的维度（代码质量的 Consistency+Maintainability、Robustness 的 Security+Edge-cases），除非 `auth-sensitive` 触发——合并是有意为之的令牌成本优化，保留了所有检查项
- ❌ 将 `test-quality` 合并回 `correctness`——拆分正是让"测试应该存在但不存在"的发现变得可见的关键
- ❌ 允许 `docs/rules/review/` 中的自定义审查者通过重名覆盖内置审查者——跳过并给出警告。内置审查者是规范的安全网；项目新增审查者是扩展，而非替换
