# 新一代模型工作流升级 — umbrella (新一代模型工作流升级 — 拆分总览)

## Sub-specs (子规范)

| Order (顺序) | Sub-spec (子规范) | Key VAL range (关键 VAL 区间) | Status (状态) |
|---|---|---|---|
| 1 | `model-evaluation-baseline/` | VAL-EVAL-001..005 | 待创建 |
| 2 | `auriga-owned-skills/` | VAL-AURI-001..017 | 待逐项评审 |
| 3 | [`systematic-debugging`](../../worklog/worklog-2026-07-14-feat-model-generation-workflow-upgrade/systematic-debugging/) | VAL-DIAG-001..VAL-PUBL-002 | 实现已合入 PR #177；PR #178 取消自动迁移并改为团队人工清理；模型评测未执行且不在 PR #178 范围内 |
| 4 | [取消自动技能迁移](../../worklog/worklog-2026-07-14-fix-migrated-skill-cleanup/) | VAL-REMOVE-001..VAL-LIFE-001 | PR #178 已合并：删除高复杂度自动迁移状态机；不包含模型评测 |
| 5 | [统一测试驱动开发](../../worklog/worklog-2026-07-14-refactor-simplify-tdd-skill/unified-tdd-skill/) | VAL-ASSET-001..VAL-STATE-001 | PR #179 精简并内化外部 TDD、合并原 test-designer；模型评测未执行 |
| 6 | [删除完成前验证技能](../../worklog/worklog-2026-07-14-refactor-remove-verification-skill/verification-before-completion/) | VAL-VAST-001..VAL-VSTA-001 | PR #181 已完成实现并归档子规范；主结论为删除，完成声明职责由常驻规则与现有机制承担；模型评测未执行 |
| 7 | [外部核心技能保留决定](reviews/README.md#外部核心技能) | — | `planning-with-files` 与 `playwright-cli` 保留；两者默认安装但非默认执行，跳过深入评审，不构成模型能力结论 |
| 8 | [外部推荐技能保留决定](reviews/README.md#外部推荐技能) | — | 6 项推荐技能全部保留；均为选装能力且不进入主工作流，跳过深入评审，不构成模型能力结论 |
| 9 | `external-plugins/` | — | 本轮范围外；保持现状 |
| 10 | [`arch-design` 精简](../../worklog/worklog-2026-07-14-refactor-simplify-arch-design/arch-design-modernization/) | VAL-ARCH-001..007 | PR #183 已完成实现并归档子规范；强化架构与领域模型触发、人工评审门禁、视觉对照、技术质量目标和条件式工具箱；模型评测未执行 |
| 11 | [`code-simplify` 精简](../../worklog/worklog-2026-07-15-refactor-simplify-code-simplify-skill/code-simplify-modernization/) | VAL-CS-001..008 | PR #184 首次深入评审无阻塞问题，文档同步意见已处理；删除语言示例与弱模型软约束，保留授权边界、行为保护、维护成本判断、用户确认的普查模式和按需手法提醒；模型评测未执行 |
| 12 | [`deep-review` 现代化](../../worklog/worklog-2026-07-15-refactor-deep-review-for-new-models/deep-review-modernization/) | VAL-IND-001..VAL-REL-002 | PR #185 已完成实现并归档子规范；内置维度从 11 个收敛为 10 个，以风险表面路由，保留干净上下文独立评估与弱模型所需细节；模型评测未执行 |
| 13 | `workflow-consolidation/` | VAL-MIG-001..005 | 等待前序结论 |

## Parent coverage map (父级验收覆盖映射)

| Parent VAL (父级验收项) | Child spec (子规范) | Child VAL (子验收项) | Status (状态) |
|---|---|---|---|
| VAL-INV-001 | 待定 | 待定 | 等待后续资产清单子规范覆盖 |
| VAL-INV-002 | 待定 | 待定 | 等待后续资产清单子规范覆盖 |
| VAL-REV-001 | 待定 | 待定 | 等待仍需深入评审的技能与模型评测基线覆盖；第 7–8 项是用户确认的范围处置，不属于暂定模型结论 |
| VAL-REV-002 | 待定 | 待定 | 等待仍需深入评审的强制约束验证目标模型原生能力边界；工具型技能的范围处置不替代模型证据 |
| VAL-REV-003 | [统一测试驱动开发](../../worklog/worklog-2026-07-14-refactor-simplify-tdd-skill/unified-tdd-skill/validation-contract.md)、[删除完成前验证技能](../../worklog/worklog-2026-07-14-refactor-remove-verification-skill/verification-before-completion/validation-contract.md) | VAL-RISK-001、VAL-VRSK-001 | 已记录精简、合并与删除后的兼容风险和恢复条件；`arch-design` 的恢复条件保留在其正式评审记录中，待父级契约新增对应验收项后再映射 |
| VAL-MIG-001 | [统一测试驱动开发](../../worklog/worklog-2026-07-14-refactor-simplify-tdd-skill/unified-tdd-skill/validation-contract.md)、[删除完成前验证技能](../../worklog/worklog-2026-07-14-refactor-remove-verification-skill/verification-before-completion/validation-contract.md)、[`deep-review` 现代化](../../worklog/worklog-2026-07-15-refactor-deep-review-for-new-models/deep-review-modernization/validation-contract.md) | VAL-ASSET-001、VAL-FLOW-002、VAL-VAST-001、VAL-VREF-001、VAL-ROUT-001..003、VAL-CUST-002 | 重复测试入口与独立完成验证入口已收敛；正式审查删除重复鲁棒性维度，并为项目扩展设置有界宿主协议 |
| VAL-MIG-002 | [`systematic-debugging`](../../worklog/worklog-2026-07-14-feat-model-generation-workflow-upgrade/systematic-debugging/validation-contract.md)、[取消自动技能迁移](../../worklog/worklog-2026-07-14-fix-migrated-skill-cleanup/validation-contract.md)、[统一测试驱动开发](../../worklog/worklog-2026-07-14-refactor-simplify-tdd-skill/unified-tdd-skill/validation-contract.md)、[删除完成前验证技能](../../worklog/worklog-2026-07-14-refactor-remove-verification-skill/verification-before-completion/validation-contract.md)、[`deep-review` 现代化](../../worklog/worklog-2026-07-15-refactor-deep-review-for-new-models/deep-review-modernization/validation-contract.md) | VAL-PUBL-001..002、VAL-REMOVE-001、VAL-NOMUTATE-001、VAL-FLOW-002、VAL-REL-002、VAL-VRUL-001、VAL-VMIG-001、VAL-PORT-001..002 | 工程边界、双运行时规则、官方技能验证与人工清理已统一；父级真实双运行时安装证据仍待后续补全 |
| VAL-MIG-003 | [`systematic-debugging`](../../worklog/worklog-2026-07-14-feat-model-generation-workflow-upgrade/systematic-debugging/validation-contract.md)、[取消自动技能迁移](../../worklog/worklog-2026-07-14-fix-migrated-skill-cleanup/validation-contract.md)、[统一测试驱动开发](../../worklog/worklog-2026-07-14-refactor-simplify-tdd-skill/unified-tdd-skill/validation-contract.md)、[删除完成前验证技能](../../worklog/worklog-2026-07-14-refactor-remove-verification-skill/verification-before-completion/validation-contract.md)、[`deep-review` 现代化](../../worklog/worklog-2026-07-15-refactor-deep-review-for-new-models/deep-review-modernization/validation-contract.md) | VAL-PUBL-001、VAL-MANUAL-001、VAL-RELEASE-001、VAL-REL-001、VAL-VREL-001、VAL-REL-001 | 双语说明、技能清单与发布版本同步当前处置；`deep-review` 插件清单版本已同步为 4.0.5 |
| VAL-DOC-001 | [取消自动技能迁移](../../worklog/worklog-2026-07-14-fix-migrated-skill-cleanup/validation-contract.md) | VAL-LIFE-001 | 长期总规范继续保留；PR #178 子规范已归档到 worklog |
| VAL-DOC-002 | [取消自动技能迁移](../../worklog/worklog-2026-07-14-fix-migrated-skill-cleanup/validation-contract.md)、[`deep-review` 现代化](../../worklog/worklog-2026-07-15-refactor-deep-review-for-new-models/deep-review-modernization/validation-contract.md) | VAL-LIFE-001、VAL-REL-002 | 子 PR 使用独立验收契约并在 Ready 前归档；长期总规范最终归档仍由人工决定 |

## Slicing axis (拆分轴)

By risk。先确定目标模型的评审证据标准，再优先处理最可能造成过度规划、重复验证和代理递归的 Auriga 自有核心技能与质量门禁技能；工具型外部技能已按范围决定保留，插件不在本轮范围；最后处理组合收敛。
