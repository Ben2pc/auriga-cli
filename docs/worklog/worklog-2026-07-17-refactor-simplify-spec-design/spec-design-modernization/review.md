# Spec Design Modernization — Review（需求规格技能现代化 — 评审）

## Conclusion（结论）

主结论：**精简**。

`spec-design` 继续保留。需求价值、目标和用户可观察行为必须由人确认，文件化验收契约也具有跨会话和独立评审价值；但当前技能把这些职责包在固定置信度、固定交互仪式、强制候选和过重模板中，应收敛为价值门禁、事实调查、苏格拉底式对齐、持久契约与人工确认门禁。

## Failure Mode（失效模式）

- Agent 把模糊想法直接转成实现计划，在错误目标上运行数小时后用户才发现偏离。
- 因为代码生成便宜而建设价值不足的需求，增加产品和维护复杂度。
- Agent 询问本可从代码、文档或工具中查到的事实，把调查责任转嫁给用户。
- 多个相互依赖的产品决定被一次性提出或由 Agent 静默批准，用户无法逐项理解后果。
- 纯会话澄清没有留下可供后续实现和评审消费的权威契约。
- 固定追问轮数、置信度和规模阈值制造流程成本，却不能证明需求已经对齐。

## Model Generation Assessment（新模型判断）

GPT 5.6 Sol 与 Fable 5 能够调查仓库、形成候选、选择工具并组织规格，不再需要 95% 置信度、十轮上限、六行复述、固定候选数量或逐章节确认等弱模型软约束。

目标模型仍不能替人决定需求是否值得投入，也不能仅凭原生能力保证长程执行前已经与人的真实目标对齐。价值门禁、事实与决定的边界、用户确认以及跨会话验收契约仍是产品治理和持久上下文职责，不能删除。

本轮未执行模型行为评测；结论来自当前协议职责、现有技能文本、用户长期使用经验以及 Matt Pocock `grilling` 的公开实现与社区反馈。

## Retained Contracts（保留契约）

- 行为变化在进入架构和实现前先澄清为什么做、做什么以及什么算通过。
- 需求判断建立在实际仓库、产品资料和外部证据上。
- 产品目标、范围和语义决定由人确认，Agent 提供建议与后果。
- 文件化 `validation-contract.md` 继续供测试驱动开发和需求符合性评审消费。
- `spec-design`、`arch-design` 与计划阶段分别负责产品行为、系统结构和实施步骤。
- 当前拉取请求规格与跨拉取请求长期规范保持独立生命周期和父子 VAL 追溯。

## Removed Constraints（删除约束）

- `Q+GUESS`、主观置信度和固定追问轮数。
- 六行复述、强制 2–3 个候选和逐章节确认。
- Playground 与静态网页审查入口。
- 默认所有需求都生成规格文件。
- 验收契约中的强制具体工具链表。
- 固定规模门槛与需求阶段的实施切分策略。
- 实现开始后禁止返回规格澄清的绝对规则。
- Figma 永远无法直接访问的运行时假设。

## Cost and Recovery Signal（成本与恢复信号）

精简后会减少无价值需求的实现成本、固定问答轮次、重复测试设施调查和不必要文档，同时保留深度需求对齐能力。

出现以下信号时重新评估：价值门禁持续误拦安全、合规或严重故障；Agent 在事实充分时仍跳过关键产品决策；口头规格频繁造成跨会话或评审追溯缺口；较低档模型无法稳定区分事实与决定；语义停止条件导致追问明显过早结束。恢复时只针对真实失效增加更具体的触发、检查或持久化要求，不恢复全局固定轮数和数量配额。

## References（参考资料）

- [完成态总文档](../../../long-running-specs/model-generation-workflow-upgrade/spec.md)
- [当前技能](../../../../plugins/auriga-workflow/skills/spec-design/SKILL.md)
- [Matt Pocock `grilling`](https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md)
- [Matt Pocock `grill-me` 介绍](https://www.aihero.dev/my-grill-me-skill-has-gone-viral)
- [社区 Codex 使用讨论](https://www.reddit.com/r/codex/comments/1s8xlja/i_tried_the_grillme_skill_and_it_completely/)
