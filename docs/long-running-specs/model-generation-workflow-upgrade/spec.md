# 新一代模型工作流升级（完成态摘要）

> 面向 GPT 5.6 Sol 与 Fable 5 的工作流重构已经完成。本文件只保留仍需跨会话查询的共同结论和证据入口；每个子项目的规格、验收契约与评审过程以对应 `docs/worklog/` 为准。

## 当前状态

- 13 个 Auriga 核心工作流技能已逐项处理，组合工作流已在 PR #195 收敛。
- `quality-gate-scaffolder` 及其 5 个脚手架技能、其他插件和可选能力不在本轮范围。
- 本轮没有执行 GPT 5.6 Sol 或 Fable 5 的统一模型评测。处置结论来自实际使用反馈、代码与机制边界、产物价值和维护成本，不能引用为模型能力基准。
- 用户已选择压缩而非归档本总规范；后续复核只更新本文件，不恢复完成态验收矩阵。

## 共同结论

1. 工作流只保留产品语义、人工确认、持久契约、独立评估和确定性机制无法稳定替代的职责，不用固定仪式补偿旧模型能力。
2. 默认安装不等于默认执行。显式工具型技能可以保留，但不能变成每个任务的强制步骤。
3. 需求规格、架构设计、实施单元、测试证据、正式评审和 Git 生命周期各自负责一个边界，避免重复触发与循环派遣。
4. Claude Code 与 Codex 共用行为契约；运行时差异使用最小适配，不扩散成所有运行时的负担。
5. 当前事实留在技能、工作流模板和确定性机制中；本目录不复制已经落地的规则正文。

## Auriga 核心技能处置索引

| 技能 | 结论与实现 | 详细证据 |
|---|---|---|
| `arch-design` | 精简；强化架构与领域模型触发、人工评审和技术质量目标（PR #183） | [评审记录](../../worklog/worklog-2026-07-14-refactor-simplify-arch-design/arch-design-modernization/review.md) |
| `code-simplify` | 精简；保留授权边界、行为保护和维护成本判断（PR #184） | [评审记录](../../worklog/worklog-2026-07-15-refactor-simplify-code-simplify-skill/code-simplify-modernization/review.md) |
| `deep-review` | 精简；保留独立审查维度与扩展协议（PR #185） | [评审记录](../../worklog/worklog-2026-07-15-refactor-deep-review-for-new-models/deep-review-modernization/review.md) |
| `docent` | 精简；保留显式调用、上下文隔离和可视化离线制品（PR #186）；当前分支再次复核 | [评审记录](../../worklog/worklog-2026-07-15-refactor-simplify-docent-skill/docent-modernization/review.md) · [验收契约](../../worklog/worklog-2026-07-15-refactor-simplify-docent-skill/docent-modernization/validation-contract.md) |
| `documentation-management` | 由 `documentation-and-adrs` 重命名并精简为文档资产与长期上下文治理（PR #188） | [评审记录](../../worklog/worklog-2026-07-16-refactor-documentation-management/documentation-management/review.md) |
| `git-workflow` | 精简；保留团队交付契约，删除通用 Git 教学（PR #189） | [评审记录](../../worklog/worklog-2026-07-16-refactor-simplify-git-workflow/git-workflow-modernization/review.md) |
| `goalify` | 精简；保留显式自主运行、架构人工门禁和评审收敛（PR #190） | [评审记录](../../worklog/worklog-2026-07-16-refactor-goalify-simplify/goalify-modernization/review.md) |
| `incremental-impl` | 精简为完整实施单元的拆分与增量落地，派发降为可选方式（PR #191） | [评审记录](../../worklog/worklog-2026-07-16-refactor-simplify-incremental-impl/review.md) · [验收契约](../../worklog/worklog-2026-07-16-refactor-simplify-incremental-impl/validation-contract.md) |
| `reviewer-creator` | 精简；保留项目审查者协议，删除固定检查项和重复注册表（PR #192） | [评审记录](../../worklog/worklog-2026-07-16-refactor-simplify-reviewer-creator/reviewer-creator-modernization/review.md) |
| `session-compound` | 精简；保留单会话与近期洞察模式、增量证据缓存和确定性报告（PR #193） | [评审记录](../../worklog/worklog-2026-07-17-refactor-modernize-session-compound/review.md) |
| `spec-design` | 精简；保留价值判断、事实调查、目标对齐和验收契约（PR #194） | [评审记录](../../worklog/worklog-2026-07-17-refactor-simplify-spec-design/spec-design-modernization/review.md) |
| `systematic-debugging` | 内化；PR #177 落地，PR #178 取消自动迁移并改为团队人工清理 | [评审记录](../../worklog/worklog-2026-07-14-feat-model-generation-workflow-upgrade/systematic-debugging/review.md) |
| `test-driven-development` | 精简并内化，合并原 `test-designer`，按证据生命周期决定是否新增永久测试（PR #179） | [评审记录](../../worklog/worklog-2026-07-14-refactor-simplify-tdd-skill/unified-tdd-skill/review.md) |

## 其他资产处置

| 资产 | 处置 |
|---|---|
| `verification-before-completion` | 删除（PR #181）；完成声明由常驻工作流规则与确定性机制承担。[评审记录](../../worklog/worklog-2026-07-14-refactor-remove-verification-skill/verification-before-completion/review.md) |
| `planning-with-files`、`playwright-cli` | 保留为按场景显式使用的外部能力；默认安装不等于默认执行。 |
| 6 个外部推荐技能 | 保留为主工作流外的选装能力，未做目标模型深入评审。 |
| 所有插件与 `quality-gate-scaffolder` | 本轮范围外；保持独立发布与升级边界。 |

## 后续复核条件

只有出现以下情况才重新打开对应技能的设计，而不是恢复整套旧流程：

- 技能开始自动触发、成为每个任务的强制步骤，或明显增加无关上下文与交互成本。
- 精简后持续遗漏同一类重要风险、人工确认或可追溯证据。
- Claude Code、Codex 或目标模型的工具、子代理、插件和校验能力发生实质变化。
- 外部资产职责或维护权变化，导致核心路径重新依赖不可控行为。

具体恢复条件与历史决定以表格链接的评审记录为准。本摘要不维护父子验收编号、逐项测试结果或发布补丁版本，避免与归档证据和当前代码形成多份事实源。
