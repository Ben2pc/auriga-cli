# 评估 subagent 派遣协议（步骤 4.5 详版）

session-compound 的「评估」tab 由一个**独立 subagent** 产出 `eval-findings`。本文件是步骤 4.5 的完整协议。SKILL.md 只保留不可省的硬约束；落地细节看这里。

## 为什么必须独立

被评估的会话正是主 Agent 自己跑的。让它评自己的指令遵循度、skill 召回与执行表现，有系统性偏差（会为自己的选择找理由）。所以这一步**必须零上下文继承**——纪律与 `deep-review` 一致:

- 起新会话 / 新子代理，**不要** resume、**不要**把当前对话历史复制进去。
- 子代理只拿下面列出的「派遣输入」，不拿主 Agent 的推理过程。
- 平台支持时显式设 `fork_context: false`。

## 派遣输入（只给这些）

机械层（analyzer）已经把判断需要的**结构化事实**提取好了，子代理不必从原始日志重挖:

| 输入 | 来自 | 用途 |
|---|---|---|
| `health.skill_catalog` | analyzer | 全部已安装 skill 的 `name` + 触发条件 `description` + `editable`。召回分析的对照表 |
| `health.workflow_rules` | analyzer | 仓库 AGENTS.md 受管区块的工作流规则 `{n, text}`。指令遵循的对照表 |
| `health.workflow_signals` | analyzer | **中性事实**:`{git_branch, on_main, had_code_edit, first_edit_ts, prs_count, skills_invoked_count}`。子代理据此下判断（如 `on_main:true` + `had_code_edit:true` → 可能"在 main 上编辑了"） |
| `health.skills` | analyzer | 本会话**真正调用过**的 skill（逐 skill 执行 eval 的范围） |
| `narrative.human_turns` | analyzer | 逐 turn 摘要 + 工具序列 |
| transcript 文件路径 | **主 Agent 在步骤 1 已算出** | 子代理按需读原始片段。主 Agent 把步骤 1 解析出的那个绝对路径（`~/.claude/projects/.../<id>.jsonl` 或 `~/.codex/sessions/.../rollout-*.jsonl`）原样传给子代理——不要让子代理自己重推 |

## 评估范围（两条界定，必须都写进派遣提示词）

- **召回 / 指令遵循分析**:覆盖 `skill_catalog` 里**全部已安装 skill** 与全部 `workflow_rules`。找两类:
  - 缺口——"本该召回某 skill / 本该触发某规则却没有"（用 `workflow_signals` + turn 时间线佐证，例如有代码改动却 `skills_invoked_count:0`，或 `on_main:true` 下发生编辑）。
  - 正向——被正确遵循的项（也报告，给读者全貌）。
- **逐 skill 执行 eval**:**仅覆盖本会话真正调用过 / 跑过的 skill**（`health.skills` 里的）。没跑过的 skill 无法评其执行表现，只进召回分析、不进执行 eval。从每个跑过的 skill 的**设计目标**出发判断:这次有没有兑现、哪里欠佳、问题是不是出在 skill body 本身（而不是缺规则）。

## 输出契约

一个 finding 数组，原样注入 `<script id="eval-findings">`:

```json
[
  { "kind": "recall|compliance|skill-eval",
    "polarity": "positive|gap",
    "severity": "high|med|low",
    "confidence": "high|med|low",
    "text": "一句话事实性描述",
    "skill": "相关 skill 名（可选）" }
]
```

- `kind`:`recall`（召回）/ `compliance`（指令遵循）/ `skill-eval`（逐 skill 执行）——维度。
- `polarity`:`positive`（被正确遵循 / 执行兑现）或 `gap`（缺口 / 欠佳）——结论方向。
- `severity` **仅 `gap` 必填**:缺口的影响程度（high = 工作流保证被实质削弱 / med = 局部削弱 / low = 形式偏差，实质无损）。`positive` finding **省略 severity**——没有问题就没有严重度,强行标注只会误读成"这条正向不重要"。
- `confidence` 是**证据强度**,不是主观把握:high = transcript 可直接佐证（时间戳 / 原文引用）；med = 间接推断（多个信号合并得出）；low = 可辩护的解读（合理但存在另一种读法）。
- **不按重要性预过滤**——全部 in-scope finding 都报告（含 low severity / low confidence），过滤交给人（与 deep-review 同纪律）。正向项同样报告（`polarity: positive`），给读者全貌。

## skill-body 优化候选（finding → 步骤 5d candidates）

`kind: skill-eval` 的 finding（某 skill 执行欠佳）是 skill-body 优化候选的来源。落点规则:

- finding 指向 `skill_catalog` 里 `editable: true` 的 skill（源在本仓库内）、且问题是 body 写得不到位 → 产一个 `agent-md` 候选，**target 指向那份 in-repo SKILL.md 就地优化**。这是"对抗一味叠加内容"的入口:先判断是不是 body 本身没写好，而不是默认加规则。
- finding 指向 `editable: false` 的外部 / cached skill → **不要产出编辑候选**（源在插件缓存里，改了下次更新即被覆盖）；只在「评估」tab 里报告它的表现。

## 备注

- 机械层（analyzer）只**提取事实**，不下任何判决。`workflow_signals` 是中性的——所有"对 / 错 / 该不该"都由这个 subagent 判。这条边界是有意的:机械可判的留给确定性脚本（快、可单测），需要语义判断的留给独立 subagent（且必须独立）。
- 如果 `skill_catalog` 很大（几十个已安装 skill），单 subagent 仍可胜任（description 都是短触发句）；若实测召回质量不足，再考虑拆成召回 / 执行两个子代理。
