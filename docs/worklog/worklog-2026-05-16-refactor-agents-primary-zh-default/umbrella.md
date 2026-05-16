# AGENTS.md 主文件与中文默认安装 — umbrella (AGENTS.md 主文件与中文默认安装 — 拆分总览)

## Sub-specs (子规范)
| Order (顺序) | Sub-spec (子规范) | Key VAL range (关键 VAL 区间) | Status (状态) |
|---|---|---|---|
| 1 | `docs/specs/agents-primary-zh-default/` 文件形态与迁移 | VAL-FILE-001..008 | spec |
| 2 | `docs/specs/agents-primary-zh-default/` 默认语言 | VAL-LANG-001..006 | spec |
| 3 | `docs/specs/agents-primary-zh-default/` 扫描、文案与发布包 | VAL-SCAN-001..002, VAL-DOC-001..003, VAL-PACK-001..002 | spec |

## Slicing axis (拆分轴)
Horizontal sweep。这个需求不是一个全新子系统,而是对同一工作流契约在多个既有表面上的横向迁移:安装文件形态、语言默认值、状态扫描、网页安装、文档和端到端发布验证都要对齐同一个新规则。按横向表面拆分,可以让后续计划阶段分别锁住每个表面的回归测试,同时保持所有切片都回到同一份 `spec.md` 与 `validation-contract.md`。
