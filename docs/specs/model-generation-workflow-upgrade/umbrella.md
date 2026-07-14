# 新一代模型工作流升级 — umbrella (新一代模型工作流升级 — 拆分总览)

## Sub-specs (子规范)

| Order (顺序) | Sub-spec (子规范) | Key VAL range (关键 VAL 区间) | Status (状态) |
|---|---|---|---|
| 1 | `model-evaluation-baseline/` | VAL-EVAL-001..005 | 待创建 |
| 2 | `auriga-owned-skills/` | VAL-AURI-001..017 | 待逐项评审 |
| 3 | `vendor-core-skills/systematic-debugging/` | VAL-DIAG-001..VAL-MIG-002 | 实现中 |
| 4 | `vendor-core-skills/` 其余技能 | VAL-CORE-001..003 | 待逐项评审 |
| 5 | `vendor-recommended-skills/` | VAL-RECO-001..008 | 待逐项评审 |
| 6 | `external-plugins/` | VAL-PLUG-001..005 | 待逐项评审 |
| 7 | `workflow-consolidation/` | VAL-MIG-001..005 | 等待前序结论 |

## Slicing axis (拆分轴)

By risk。先确定目标模型的评审证据标准，再优先处理最可能造成过度规划、重复验证和代理递归的核心技能；待高风险假设得到证据后，再评审可选技能与插件，最后处理组合迁移。
