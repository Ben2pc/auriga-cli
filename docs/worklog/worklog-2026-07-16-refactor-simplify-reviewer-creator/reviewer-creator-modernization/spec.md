# Reviewer Creator Modernization — Spec (项目审查者创建技能现代化 — 规范)

> 保留项目审查者的机械协议，同时减少不必要的交互、固定数量配额和重复维护。

## Why (为什么做)

`reviewer-creator` 仍承担 `deep-review` 无法由模型原生能力替代的持久契约：项目审查者必须能被发现、校验和正确调度。但当前技能把面向较弱模型的固定数量要求、强制提问和重复注册表一起放进主流程，增加上下文与维护成本。

## Findings (调研发现)

- `plugins/auriga-workflow/skills/reviewer-creator/SKILL.md` 重复列出了 `deep-review` 已经维护的内置审查者和触发标签。
- 同一文件强制要求固定数量的检查问题、场景以及预先提问，即使仓库证据已经足够明确。
- `plugins/auriga-workflow/skills/reviewer-creator/references/template.md` 同样固定了检查项与示例数量。
- `plugins/auriga-workflow/skills/deep-review/SKILL.md` 已经是审查者注册、路由、元数据校验和输出契约的权威来源。
- 无项目专属 spec 规则。

## What (做什么)

- 保留项目审查者必须显式声明的机械元数据、`extends` 定位、权限边界、输出契约继承和验证要求。
- 当仓库规则与风险归属已经足够明确时，直接判断审查者定位和触发条件；只有存在会改变调度结果的真实歧义时才询问用户。
- 检查问题和示例按项目规则复杂度决定，不规定固定数量；边界容易混淆时仍提供应报告和不应报告的场景。
- 以内置 `deep-review` 当前协议作为内置审查者和触发条件的信息源，不在创建技能中维护第二份完整清单。

## Out of scope (本次不做)

- 不改变 `deep-review` 的内置审查维度、路由语义或代理执行方式。
- 不改变项目审查者现有 frontmatter 字段及 `extends` 的语义。
- 不引入新的运行时校验器或新的审查者文件格式。
- 不执行 GPT 5.6 Sol 或 Fable 5 的模型评测。

## Open questions (悬而未决)

无。

## References (参考资料 — 可选；澄清期间用户给过任何外链时必填)

无。
