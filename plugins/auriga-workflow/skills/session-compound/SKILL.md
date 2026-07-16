---
name: session-compound
description: 当用户要求复盘、总结、沉淀当前会话，分析最近一段时间的 Claude Code 或 Codex 使用方式，wrap up this session、extract takeaways、recent usage insights，或从会话中提取可复用经验时使用；先让用户选择单会话复盘或最近 30 天洞察，再生成对应的离线 HTML 报告。
---

# Session Compound

把会话记录转成可追溯的洞察，而不是机械地寻找更多规则。每次调用只生成一种报告：

- **单会话复盘**：叙事、执行健康度、独立评估和长期沉淀候选。
- **最近 30 天洞察**：跨会话的有效模式、反复摩擦、值得尝试的改进和长期沉淀候选。

两种模式分别分析当前运行时，不合并 Claude Code 与 Codex 的记录。报告写入系统临时目录，不进入项目仓库。

## 入口门禁

每次调用都用 `AskUserQuestion` 或 `request_user_input` 让用户明确二选一：

1. 单会话复盘
2. 最近 30 天洞察

未选择前不进入任一模式；不根据用户措辞猜默认值，也不在一次调用中生成两份报告。

先确认当前运行时：`CLAUDE_CODE_SESSION_ID` 表示 Claude Code，`CODEX_THREAD_ID` 表示 Codex。用户指定会话文件时，以指定文件和对应运行时为准。

## 共同证据边界

- 分析器只提取事实。非零退出保留在 `health.tool_failures`，`classification` 默认为 `unknown`；没有语义证据时不写成浪费。
- `health.skills` 同时保留显式与推断使用：`explicit_count`、`inferred_count`、`evidence_types`。同一用户轮次对同一 `SKILL.md` 的重复读取只算一个使用单元。
- `health.skill_catalog`、`health.workflow_rules`、`health.workflow_signals` 是当前能力、当前规则与中性事实。用它们回看历史时必须标记“按当前状态回看”，不能伪装成会话发生时的快照。
- `raw_for_compound.skill_usage_events`、`skill_timeline`、`review_syntheses` 和证据引用用于追溯，不直接等于结论。
- 缺失证据写成未知或合法空态，不用数字零冒充已确认事实。

## 模式一：单会话复盘

### 1. 生成会话证据

```sh
# Claude Code
node <skill-dir>/analyzers/claude-code.mjs > /tmp/session-compound-evidence.json

# Codex
node <skill-dir>/analyzers/codex.mjs > /tmp/session-compound-evidence.json
```

用户指定其他会话时，在对应命令中加入 `--file <绝对路径>`。没有显式 `--file` 时，分析器从当前运行时的会话标识定位日志。非零退出时根据错误修正路径后重跑；拿不到有效 JSON 就停止，不生成伪报告。

### 2. 做独立评估

读取 `references/eval-dispatch.md`，用内置 Agent 新建一个**零上下文继承**的独立评估上下文。召回分析覆盖全部已安装 skill，逐技能执行评估只覆盖本会话实际使用的技能，包括仅有推断证据的技能。

评估发现保留 `polarity`、`severity`、`confidence`、证据性质和证据引用；不按重要性预过滤。评估失败不阻塞事实报告，评估区明确显示未完成。

### 3. 形成三层结果

主 Agent 基于证据和独立评估形成：

1. **洞察**：不要求行动的事实解释或单次观察。
2. **值得尝试**：可低成本验证的新用法、工作方式或提示词，不修改长期资产。
3. **长期沉淀候选**：只有用户明确要求长期保持某种行为，或同类纠正、约束、流程在至少两个独立会话出现时才允许提出。单会话通常只能依赖前一种门禁。

长期候选默认 `default_selected: false`。以下情况直接否决：

- 一次性问题、没有行动权的外部问题，或 `session-compound` 自身缺陷。
- 反馈已被现有规则、技能、测试、类型系统、静态检查或审查机制完整吸收。
- 仅因为工具返回非零状态，就推断应该新增规则。
- 外部或缓存技能不可编辑，却提出修改其 `SKILL.md`。

本仓库可编辑技能确有正文缺口时，可以提出指向 in-repo `SKILL.md` 的就地优化候选；外部或缓存技能更新时会被覆盖，不产出编辑候选。能用工程机制更早拦截的问题，优先指向符合技术栈的类型、静态检查、测试或持续集成机制，不增加长期上下文租金。

只有在已经确认存在“新增或安装技能”的真实候选后，才按需运行生态搜索。搜索只能验证或路由既有候选，不能反向制造建议。已经安装或频繁使用的能力只能写成“新的使用方式”，不能包装成尚未尝试的新功能。

### 4. 确定性生成报告

将结构化结果写入 `/tmp/session-compound-single-data.json`：

```json
{
  "mode": "single",
  "report_data": {},
  "narrative_summary": "不超过三句话的事实性摘要",
  "anomalies": [{ "tone": "good|warn|bad|info", "figure": "短标记", "text": "解释" }],
  "eval_findings": [],
  "observations": [],
  "experiments": [],
  "durable_candidates": []
}
```

再运行：

```sh
node <skill-dir>/scripts/render-report.mjs \
  --mode single \
  --template <skill-dir>/templates/single-session.html \
  --data /tmp/session-compound-single-data.json \
  --output /tmp/session-compound-single-<timestamp>.html
```

模型不编辑模板、HTML、JavaScript 或样式。

## 模式二：最近 30 天洞察

### 1. 建立会话清单与增量队列

```sh
node <skill-dir>/scripts/insights-pipeline.mjs prepare \
  --runtime <claude-code|codex> \
  --days 30 \
  --facet-schema-version 1 \
  --prompt-version 1 \
  > /tmp/session-compound-prepared.json
```

默认缓存位于 `~/.cache/auriga-cli/session-compound/facets/<runtime>/`。目录权限为 `0700`，文件为 `0600`；缓存只保存短切面和失效元数据，不复制完整会话。缓存可随时删除，下次从原始日志重建。

命中要求 `runtime + session_id + content_fingerprint + facet_schema_version + analysis_prompt_version` 全部一致。单次默认最多排入 50 个未缓存会话；更多会话进入 `deferred`，报告必须披露，后续运行从未完成部分继续。

### 2. 提取并保存逐会话切面

仅处理 `analysis_queue`。对每个描述符先用对应分析器的 `--file` 生成精简证据，再读取 `references/facet-dispatch.md`，用内置 Agent 分批生成严格的 `SessionFacet` JSON。一个会话或一个批次失败不丢弃其他成功结果。

每个有效切面通过确定性入口保存：

```sh
node <skill-dir>/scripts/insights-pipeline.mjs store \
  --descriptor <descriptor.json> \
  --facet <facet.json> \
  --facet-schema-version 1 \
  --prompt-version 1
```

结构不合法的切面不进缓存。保存完成后重新运行 `prepare`，获得包含本轮缓存命中的最新清单。

### 3. 构建有界汇总输入

```sh
node <skill-dir>/scripts/insights-pipeline.mjs aggregate \
  --prepared /tmp/session-compound-prepared-latest.json \
  --max-facets 80 \
  > /tmp/session-compound-aggregate.json
```

全部有效切面参与机械计数；只有有界的代表性切面进入最终语义汇总。报告同时显示发现数、时间窗内数量、成功分析数、缓存命中、排除、延后和未纳入语义分析的数量。

### 4. 生成近期洞察

读取 `references/insights-dispatch.md`，用内置 Agent 从汇总输入生成严格的 `InsightReportData`。跨会话的“反复”结论至少引用两个独立会话；单次事实只能写成单次观察。Agent 侧阻碍、用户侧摩擦和环境问题分开陈述，同时保留有效模式。

如果近期只有一个有效会话或覆盖不足，报告事实摘要和证据限制，不声称存在趋势。允许零条值得尝试和零条长期候选。

将结果写入 `/tmp/session-compound-insights-data.json`，再运行：

```sh
node <skill-dir>/scripts/render-report.mjs \
  --mode insights \
  --template <skill-dir>/templates/recent-insights.html \
  --data /tmp/session-compound-insights-data.json \
  --output /tmp/session-compound-insights-<timestamp>.html
```

## 交付与人工确认

- 打开所选报告，并返回 `/tmp` 下的绝对路径；没有浏览器工具时使用系统默认打开命令。
- 报告生成即为合法完成；零建议、零候选不是错误。
- 不自动安装技能，不修改 `AGENTS.md`、项目规则、技能或其他工程资产。
- 洞察与值得尝试默认只留在报告里。只有用户明确选择长期候选后，才交给相应能力：工程文档与 Agent 上下文交给 `documentation-management`，技能交给 `skill-creator`，新审查者交给 `reviewer-creator`。
- 候选应用属于新的实现动作，继续遵循当前仓库的需求、分支、验证和评审规则。
