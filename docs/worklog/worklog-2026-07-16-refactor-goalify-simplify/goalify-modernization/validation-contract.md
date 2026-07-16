# Goalify 技能验证契约

| ID | 行为契约 | 验证证据 |
|---|---|---|
| VAL-GOAL-001 | 技能只在用户明确要求或选择自主运行时触发。 | frontmatter 与 `tests/goalify.test.ts` 触发边界断言。 |
| VAL-GOAL-002 | 正式规格是优先来源但不是前置条件，并能引用对话、问题单、分支或拉取请求事实。 | `tests/goalify.test.ts` 事实来源断言。 |
| VAL-GOAL-003 | 自主运行不能批准架构设计；运行中遇到新的产品范围或实质性架构决定时停止。 | `tests/goalify.test.ts` 架构门禁与停止断言。 |
| VAL-GOAL-004 | 目标结构只包含目标、权威事实与约束、终点与停止条件、交接四部分。 | `tests/goalify.test.ts` 完整标签与顺序断言。 |
| VAL-GOAL-005 | 用户已明确终点时不重复询问；终点缺失或自定义终点不可验证时必须询问。 | `tests/goalify.test.ts` 两条终点选择路径断言。 |
| VAL-GOAL-006 | 深度评审收敛保留，并明确三项收敛证据与重复评审授权。 | `tests/goalify.test.ts` 收敛终点断言。 |
| VAL-GOAL-007 | 合并终点只在用户明确授权时采用。 | `tests/goalify.test.ts` 合并授权断言。 |
| VAL-GOAL-008 | 技能不固定默认分支、实现切片或预期评审发现。 | `tests/goalify.test.ts` 正向边界与冲突模式负面断言。 |
| VAL-GOAL-009 | Codex 与 Claude Code 的启动方式保持可移植，双运行时插件版本一致。 | `tests/goalify.test.ts`、`tests/auriga-workflow-skills.test.ts` 与两套官方技能校验器。 |
