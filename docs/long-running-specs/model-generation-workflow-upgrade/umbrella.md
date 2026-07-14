# 新一代模型工作流升级 — umbrella (新一代模型工作流升级 — 拆分总览)

## Sub-specs (子规范)

| Order (顺序) | Sub-spec (子规范) | Key VAL range (关键 VAL 区间) | Status (状态) |
|---|---|---|---|
| 1 | `model-evaluation-baseline/` | VAL-EVAL-001..005 | 待创建 |
| 2 | `auriga-owned-skills/` | VAL-AURI-001..017 | 待逐项评审 |
| 3 | [`systematic-debugging`](../../worklog/worklog-2026-07-14-feat-model-generation-workflow-upgrade/systematic-debugging/) | VAL-DIAG-001..VAL-PUBL-002 | 实现已合入 PR #177；PR #178 取消自动迁移并改为团队人工清理；模型评测未执行且不在 PR #178 范围内 |
| 4 | [取消自动技能迁移](../../worklog/worklog-2026-07-14-fix-migrated-skill-cleanup/) | VAL-REMOVE-001..VAL-LIFE-001 | PR #178 删除高复杂度自动迁移状态机，等待合并；不包含模型评测 |
| 5 | `vendor-core-skills/` 其余技能 | VAL-CORE-001..003 | 待逐项评审 |
| 6 | `vendor-recommended-skills/` | VAL-RECO-001..008 | 待逐项评审 |
| 7 | `external-plugins/` | VAL-PLUG-001..005 | 待逐项评审 |
| 8 | `workflow-consolidation/` | VAL-MIG-001..005 | 等待前序结论 |

## Parent coverage map (父级验收覆盖映射)

| Parent VAL (父级验收项) | Child spec (子规范) | Child VAL (子验收项) | Status (状态) |
|---|---|---|---|
| VAL-INV-001 | 待定 | 待定 | 等待后续资产清单子规范覆盖 |
| VAL-INV-002 | 待定 | 待定 | 等待后续资产清单子规范覆盖 |
| VAL-REV-001 | 待定 | 待定 | 等待模型评测基线与后续正式处置子规范覆盖；当前结论仅为暂定 |
| VAL-REV-002 | 待定 | 待定 | 等待模型评测基线验证目标模型原生能力边界；当前工程证据不能替代模型证据 |
| VAL-REV-003 | 待定 | 待定 | 等待后续删除或精简约束的子规范覆盖 |
| VAL-MIG-001 | 待定 | 待定 | 等待 workflow-consolidation 子规范覆盖 |
| VAL-MIG-002 | [`systematic-debugging`](../../worklog/worklog-2026-07-14-feat-model-generation-workflow-upgrade/systematic-debugging/validation-contract.md)、[取消自动技能迁移](../../worklog/worklog-2026-07-14-fix-migrated-skill-cleanup/validation-contract.md) | VAL-PUBL-001..002、VAL-REMOVE-001、VAL-NOMUTATE-001 | 插件技能已发布；PR #178 删除自动清理，旧副本由团队人工处理 |
| VAL-MIG-003 | [`systematic-debugging`](../../worklog/worklog-2026-07-14-feat-model-generation-workflow-upgrade/systematic-debugging/validation-contract.md)、[取消自动技能迁移](../../worklog/worklog-2026-07-14-fix-migrated-skill-cleanup/validation-contract.md) | VAL-PUBL-001、VAL-MANUAL-001、VAL-RELEASE-001 | 双语说明和 CLI 版本同步人工清理决策 |
| VAL-DOC-001 | [取消自动技能迁移](../../worklog/worklog-2026-07-14-fix-migrated-skill-cleanup/validation-contract.md) | VAL-LIFE-001 | 长期总规范继续保留；PR #178 子规范已归档到 worklog |
| VAL-DOC-002 | [取消自动技能迁移](../../worklog/worklog-2026-07-14-fix-migrated-skill-cleanup/validation-contract.md) | VAL-LIFE-001 | 子 PR 使用独立验收契约；长期总规范最终归档仍由人工决定 |

## Slicing axis (拆分轴)

By risk。先确定目标模型的评审证据标准，再优先处理最可能造成过度规划、重复验证和代理递归的核心技能；待高风险假设得到证据后，再评审可选技能与插件，最后处理组合迁移。
