# 单会话独立评估协议

仅在“单会话复盘”模式读取。评估者必须是内置 Agent 创建的全新上下文：不续接当前会话，不继承主 Agent 的推理过程；平台支持时显式关闭上下文继承。

## 输入

- `health.skill_catalog`：当前全部已安装技能的名称、触发描述和可编辑性。
- `health.workflow_rules`：当前仓库工作流规则。
- `health.workflow_signals`：分支、编辑、拉取请求和技能使用等中性事实。
- `health.skills`：本会话显式或推断使用过的技能及证据类型。
- `narrative.human_turns`、`feedback_moments`：逐轮摘要和用户信号。
- `raw_for_compound.skill_usage_events`、`skill_timeline`、`review_syntheses`。
- 本次分析器实际读取的原始会话文件绝对路径，供评估者按需核对。

`skill_catalog` 和 `workflow_rules` 是评估时的当前状态，不一定是会话发生时快照。没有历史快照时，相关结论必须写明“按当前状态回看”。

## 范围

- 技能召回覆盖**全部已安装 skill**。判断是否存在该调用未调用或正确未调用的能力。
- 指令遵循覆盖全部适用工作流规则，但没有会话时证据时保持未知。
- 逐技能执行评估只覆盖本会话实际调用过或跑过的技能。`health.skills` 中仅有 `inferred` 证据的技能也在范围内，但不得冒充显式调用。
- 原始工具失败的 `classification: unknown` 只是待分析事实。只有 transcript 能证明其为意外失败并造成返工时，才允许写成缺口。

正向发现和缺口都要报告，不按重要性预过滤；这一步也不把每条 finding 自动转成长期候选。

## 输出

只返回 JSON 数组：

```json
[
  {
    "kind": "recall|compliance|skill-eval",
    "polarity": "positive|gap",
    "severity": "high|med|low",
    "confidence": "high|med|low",
    "evidence_nature": "historical-snapshot|current-state-lookback|explicit-user-signal|model-analysis",
    "evidence_refs": ["turn:2", "skill-event:3"],
    "text": "一句事实性描述",
    "skill": "可选技能名"
  }
]
```

- `severity` 只在 `polarity: gap` 时填写；正向发现省略。
- `confidence` 表示证据强度：`high` 为会话原文或结构化事件直接支持，`med` 为多个间接信号共同支持，`low` 为存在其他合理解释的模型分析。
- `evidence_nature` 必须如实区分历史快照、按当前状态回看、明确用户信号和模型分析。
- `evidence_refs` 至少一项；无法给出引用的判断不要输出。

可编辑的 in-repo 技能确有正文缺陷时，finding 可以成为后续就地优化候选的原料。外部或缓存技能不可直接编辑，只报告其表现。
