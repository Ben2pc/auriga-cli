# 报告结果契约

仅在形成单会话或近期洞察的结构化结果时读取。可执行校验以 `scripts/contracts.mjs` 为准；本文说明模型必须输出的语义结构。

## 共同条目

- `Observation`：`{ title, text, evidence_refs[] }`
- `Experiment`：`{ title, text, trial, success_signal, evidence_refs[] }`
- `DurableCandidate`：`{ name, type, text, why_durable, default_selected: false, evidence_refs[] }`
- 候选 `type` 只能是 `agent-context | existing-skill | new-skill | reviewer | mechanism`。
- 所有证据引用数组至少包含一项；不确定就不输出该条目。

## SingleReportData

```json
{
  "mode": "single",
  "report_data": {
    "schema_version": 2,
    "cli": "claude-code|codex",
    "session": {},
    "narrative": {},
    "health": {},
    "raw_for_compound": {}
  },
  "narrative_summary": "事实性摘要",
  "anomalies": [
    { "tone": "good|warn|bad|info", "figure": "短标记", "text": "解释" }
  ],
  "eval_findings": [
    {
      "kind": "recall|compliance|skill-eval",
      "polarity": "positive|gap",
      "severity": "high|med|low，仅 gap 必填",
      "confidence": "high|med|low",
      "evidence_nature": "historical-snapshot|current-state-lookback|explicit-user-signal|model-analysis",
      "evidence_refs": ["turn:2"],
      "text": "事实性发现",
      "skill": "可选技能名"
    }
  ],
  "observations": [],
  "experiments": [],
  "durable_candidates": []
}
```

`report_data` 必须直接使用分析器输出，不重写机械事实。正向评估省略 `severity`；缺口评估必须填写。

## InsightReportData

顶层必须包含：

- `mode: insights`、`generated_at`。
- `window`：`days`、`started_at`、`ended_at`，从聚合输入原样复制。
- `coverage`：`discovered`、`in_window`、`eligible`、`analyzed`、`cache_hits`、`newly_analyzed`、`failed`、`queued`、`excluded`、`excluded_subagents`、`excluded_damaged`、`invalid_cache`、`deferred`、`representative_count`、`semantic_budget_deferred`、`not_semantically_analyzed`，从聚合输入原样复制。
- `at_a_glance`：`working`、`hindering`、`quick_wins`、`ambitious`。
- `project_areas[]`：`{ area, text, evidence_refs[] }`。
- `interaction_style`。
- `wins[]`：`{ title, text, evidence_refs[] }`。
- `frictions[]`：`{ title, owner: agent|user|environment, text, evidence_refs[] }`。
- `observations[]`、`experiments[]`、`durable_candidates[]` 使用共同条目结构。
- `evidence_limitations[]`：简短字符串列表。

不要补零、漏字段或改写覆盖统计。没有内容的列表使用 `[]`。
