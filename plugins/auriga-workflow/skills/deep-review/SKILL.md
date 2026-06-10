---
name: deep-review
description: "当用户要求审查拉取请求、执行 /deep-review、将拉取请求标记为待审（Ready for Review），或请求正式 / 全面代码审查时触发。"
---

# Deep Review

多维度拉取请求审查调度器。每位审查者的检查清单、检测表、示例场景和输出契约保存在 `references/reviewers/<name>.md` 中。**主 agent 只读其 YAML frontmatter（文件头部 `---` 之间的元数据）做编排**，并把该文件的**绝对路径**交给子代理，由子代理在自身全新上下文中**自读**正文——避免正文经主 agent 上下文转发、空耗 token。

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

对每位分派的审查者，**只读 `references/reviewers/<name>.md` 的 YAML frontmatter** 决定编排：`reasoning` 档位（`flagship` → 平台顶级模型；`workhorse` → 次于顶级，如 Sonnet / GPT-5.5-mini）、`tools`，以及可选的 `effort`（未指定时默认为 `xhigh`——当前 Claude / Codex 推荐值；仅在向下覆盖为简单检查或向上覆盖为 `max` 时才指定）。**正文（检查清单、检测表、输出契约）不读进主 agent 上下文**——把该文件的绝对路径交给子代理，指示其自读并遵循。

**项目级自定义审查者**：同时检索 `docs/rules/review/*.md`（目录不存在则静默跳过）。目录以仓库根为锚：用 `git rev-parse --show-toplevel` 解析仓库根，检索 `<仓库根>/docs/rules/review/`；当 cwd 不在仓库根、且 cwd 到仓库根之间存在更近的 `docs/rules/review/`（monorepo 子包）时，两层都收集——子包级审查者视为对仓库级的补充/收窄，重名时以子包级为准；非 git 仓库时回退为相对 cwd 检索。对每个自定义文件，先做**范围重叠判定**，再决定分派方式。

**降级（旧版兼容）**：built-in reviewer 一律带 YAML frontmatter；但旧版项目自定义 reviewer 可能没有 YAML frontmatter（仍是正文的 `## Metadata` 项目列表）。读取编排字段（`name` / `best_for` / `trigger` / `reasoning` / `tools` / `extends`）时：优先读 frontmatter；文件没有 frontmatter 时回退读取正文的 `## Metadata` 段；两者都缺时按语义判断（见下方重叠判定），并把缺失记为「无项目专属元数据」。

- **重叠判定**：对照上述 11 位内置审查者，判断该自定义审查者的关切是否落在某位内置审查者的维度范围之内。判定优先级如下：
  - **显式 `extends` 字段优先**：若 frontmatter 写了 `extends: <内置审查者名>`，直接吸收进该 host，不再做语义猜测；若写了 `extends: standalone`，则**强制独立分派**——跳过重叠判定，即使语义上与某内置维度重叠也保持独立。`extends` 值既不是 11 位内置审查者之一、也不是 `standalone` 时忽略它，回退到下面的语义判断。
  - **缺省偏向吸收**：未写 `extends`（或值非法）时以**语义判断**为主——比较自定义文件的 `Best for`、`Scope` 段与 `Checklist` 跟各内置维度的覆盖面，并**默认偏向吸收**：只要能找到一个语义最接近的内置 host，就吸收进它；只有当它确实是任何内置维度都不覆盖的全新维度（哪个 host 都套不上）时，才独立分派。这样可以最小化子代理数量。
  - **重名即吸收**：与内置审查者**重名**视为必然重叠，host 即同名内置审查者。
- **重叠 → 吸收**：判定为与某位内置审查者（host）重叠时，不再为该自定义审查者分派独立子代理；改为把该自定义文件的绝对路径连同 host 内置文件的路径一起交给 host 子代理，指示其自读、把该文件的 `Checklist` 与 worked scenarios（示例场景）作为「项目专属补充」一并审查。若 host 内置审查者本次未被触发（例如自定义审查者重叠 `performance`，但本次 PR 无 `perf` 标签），被吸收的内容随 host 一并不运行——重叠自定义审查者自身的 `Trigger` 不再独立生效。
  - 吸收示例（自定义审查者 → host 内置维度）：可访问性类 `accessibility` / `a11y` → `ux`；`swiftui-performance` / `compose-performance` → `performance`；`security-privacy` → `security`；模块 / 分层 / 依赖方向类 `android-boundaries` → `architecture`；构建配置、SDK 接入边界等没有同名内置维度但落在既有维度内的，也并入语义最接近的 host。这些都是某个内置维度的项目专属收窄，吸收后由 host 一并审查，不额外占用子代理。
- **不重叠 → 独立分派**：判定为引入一个**全新维度**（不落在任何内置维度范围内）时，或显式声明了 `extends: standalone` 时，解析其 frontmatter 中的 `trigger` 字段，路由到对应的分派类别（A/B/C/D），作为独立审查者分派；其正文同样由该独立子代理按绝对路径自读。

使用 `reviewer-creator` 技能来创建新的审查者。

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

**全新上下文审查者隔离是强制要求。** 每位分派的审查者必须从全新的上下文开始，以便从对抗式、独立视角审查拉取请求。绝不要把上下文复制（继承）进审查者子代理，绝不传递当前会话记录，也绝不为新审查者复用之前的审查会话。在 Codex 原生子代理中，当工具支持时请明确设置 `fork_context: false`。在基于命令行的委派中，启动新会话而非 `resume` / `continue`。审查者提示词只能包含审查数据包：目标拉取请求元数据、差异、相关源文件/规范文件、必要的项目指令、审查者参考文件的**绝对路径**（子代理自读其检查清单、检测表与输出契约），以及下方的 Reviewer Must-Not Preamble。

**Output contract:** 由子代理从其自读的参考文件中获取 `Output contract` 章节并严格遵循——不要依赖默认值。`Reviewer Must-Not Preamble`（见下方章节）不在参考文件中，必须由主 agent 原文附在每个子代理提示词开头——这些角色级约束统一适用于所有维度，集中在此处以便单次修改即可传达至每位审查者。**路径兜底**：若 delegate 运行在无法解析仓库绝对路径的环境（如无仓库挂载的远程沙箱），改为把参考文件正文内联进提示词。

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

**被吸收内容的归属：** 由「项目专属补充」（重叠后吸收进 host 的自定义审查者内容）产生的发现，其 `(<reviewer>)` 一律按 host 内置审查者名标注（如 `(performance)`），不附加自定义审查者来源——它已是该维度审查的一部分。

## Reviewer Must-Not Preamble

这些角色级约束适用于每位分派的审查者（内置及 `docs/rules/review/` 下的项目级自定义审查者）。请将以下内容原文附在每位审查者子代理提示词的开头——不要在各审查者参考文件中重复。单次修改即可传达至每位审查者。

- **不要按严重度预先过滤。** 这一遍是为了全覆盖，不是为了筛选——综合步骤会在下游排序和筛除发现。报告所有在范围内的问题，包括低置信度和 non-blocking 的。强推理模型倾向于字面执行"只报告高严重度"此类表述，会漏掉综合步骤本会标记的真实缺陷。
- **不要提出替代实现方案。** 指出缺陷加上一句修复方向在范围之内。设计替代代码、重构周边模块或编写补丁是独立任务。
- **不要对已审查过的代码不加重新检查就直接放行。** 本次差异所涉及的代码均在范围之内，即使同一行代码曾通过之前的审查——上游契约变更可以悄悄使昨天的正确性结论失效。

## Follow-up

**在本拉取请求中修复 vs 创建跟踪 issue。** Blocking 发现必须在合并前修复，所有维度均无例外。其余情况：能够在当前拉取请求中就地修复且不破坏测试的发现，直接在本次合并——局部结构性修复（放错层、重复实现、孤立的浅层转手包装）或任何 non-blocking 的代码质量/可维护性问题。需要重新划定模块边界的发现，创建跟踪 issue 并路由到 `arch-design`，绝不捆绑进审查周期的拉取请求——上帝模块、发散式变化、霰弹式修改、跨多个模块的循环依赖。设计合规性偏差的处理方式相同：设计文档仍有效 → 将代码拉回正轨；实现证明设计有误 → 创建 issue 修订设计文档。

**`test-designer` 边界**：本技能的 `test-quality` 审查者是**事后**审查（审查已写的测试并标记遗漏）。独立的 `test-designer` 技能处于 **TDD 红灯阶段**（独立评估在实现之前产出会失败的测试）。不要混为一谈。

## Anti-patterns

- ❌ 分派子代理时未告知去哪取输出格式 → 上下文泛滥（参考文件中已含格式；交绝对路径让子代理自读，仅在路径不可解析时才内联）
- ❌ 主 agent 把参考文件正文整段读进自己上下文再原样转发 → 纯 pass-through 空耗 token；编排只需 frontmatter，正文交子代理自读
- ❌ 将上下文复制（继承）进审查者子代理、复用之前的审查者会话，或将会话历史作为审查输入——污染的上下文会削弱对抗式审查
- ❌ 串行化彼此独立的审查者 → 浪费时间
- ❌ 正式审查 Draft 拉取请求——Draft 用于非正式早期反馈；等到 Ready 后再审
- ❌ 将写代码的 Agent 自身的提交信息、拉取请求正文理由说明、"自主决策"内容输入规范合规性审查——会偏向确认写代码的 Agent 的解读
- ❌ 告诉审查者"只报告高严重度"、"保守一点"或"不要吹毛求疵"——较新的推理模型会静默丢弃真实发现；在综合阶段筛选，而非在每位审查者处筛选
- ❌ 拆分已合并的维度（代码质量的 Consistency+Maintainability、Robustness 的 Security+Edge-cases），除非 `auth-sensitive` 触发——合并是有意为之的令牌成本优化，保留了所有检查项
- ❌ 将 `test-quality` 合并回 `correctness`——拆分正是让"测试应该存在但不存在"的发现变得可见的关键
- ❌ 把范围重叠的自定义审查者当作又一个并行审查者分派——它会与 host 内置审查者对同一 `file:line` 重复报告、空耗 token，且两个审查者各自只看到一半上下文。重叠（含与内置重名）的自定义审查者吸收进 host；只有引入全新维度的自定义审查者才独立分派
