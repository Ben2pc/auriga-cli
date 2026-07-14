# Validation Contract — 删除完成前验证技能 (验收契约 — 删除完成前验证技能)

> 与 spec.md 配套：spec.md 描述 why+what；本文件描述“什么算通过”。
> 每条 VAL 只描述 Behavior + Tool + Evidence；一个断言可以按工具与风险展开为一个或多个验证用例。

## Coverage map (覆盖矩阵)

| Range (范围) | VAL ids |
|---|---|
| 技能资产 | VAL-ASSET-001 ~ 001 |
| 工作流规则 | VAL-RULE-001 ~ 001 |
| 相邻职责 | VAL-REF-001 ~ 001 |
| 发布同步 | VAL-REL-001 ~ 001 |
| 清理边界 | VAL-MIG-001 ~ 001 |
| 风险记录 | VAL-RISK-001 ~ 001 |
| 长期状态 | VAL-STATE-001 ~ 001 |

## Parent coverage map (父级验收覆盖映射)

| Parent VAL (父级验收项) | Child VAL (子验收项) | Status (状态) |
|---|---|---|
| VAL-REV-003 | VAL-RISK-001 | 已记录删除后的风险、观察信号与恢复条件 |
| VAL-MIG-001 | VAL-ASSET-001、VAL-REF-001 | 独立技能职责由常驻规则和现有流程承担，不形成重复入口 |
| VAL-MIG-002 | VAL-RULE-001、VAL-MIG-001 | 双运行时共享最小工作流规则，既有用户副本保持人工清理 |
| VAL-MIG-003 | VAL-REL-001 | 技能集合、安装说明与发布版本同步 |

`VAL-REV-001` 与 `VAL-REV-002` 仍等待后续目标模型评测；本次职责分析与用户确认不能替代目标模型证据。

## Toolchain (本仓库验证栈)

> 以下是调研所得的既成事实，不是本次功能的实现决策。

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| `repo-check` | `node:test` 驱动的技能清单、模板、引用和文件内容契约测试 |
| `e2e-cli` | `npm run test:e2e` 的真实安装包与命令行安装验证 |
| `manual` | 对照当前技能、工作流职责与用户确认方向的人工审查 |

## Assertions (断言)

### VAL-ASSET-001
- **Behavior (行为)**: Auriga 不再锁定、预设安装、单独列出或推荐 `verification-before-completion` 技能。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 外部技能锁、安装清单、生成目录、帮助和双语说明不存在该独立资产。

### VAL-RULE-001
- **Behavior (行为)**: 双语工作流要求完成、修复、通过或可评审判断必须使用最后一次相关修改之后、与该判断匹配的验证结果；证据不足时说明缺口。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 中文模板、英文模板和仓库安装结果表达完整且一致的单条规则，不依赖技能召回。

### VAL-REF-001
- **Behavior (行为)**: 测试驱动开发和增量实现保留各自验证职责，但不再引用已删除的技能或复制一套新的完成前验证流程。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 活动技能只引用常驻工作流规则或自身既有验证步骤，不存在悬空技能名。

### VAL-REL-001
- **Behavior (行为)**: 用户可见的技能集合变化同步反映在命令行版本、插件版本、技能目录、双语说明和长期评审状态中。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 版本、清单、目录、帮助、说明和状态矩阵对删除结论没有矛盾。

### VAL-MIG-001
- **Behavior (行为)**: 安装或升级 Auriga 不会扫描、修改或删除用户以前安装的外部技能副本。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: 真实安装流程成功且不包含旧副本迁移或清理行为；团队人工清理边界被保留。

### VAL-RISK-001
- **Behavior (行为)**: 删除技能后的兼容风险、观察信号与恢复条件具有长期记录。
- **Tool (工具)**: manual
- **Evidence (判据)**: 正式评审记录说明哪些场景可能出现无证据完成声明，以及何时加强工作流规则或确定性门禁。

### VAL-STATE-001
- **Behavior (行为)**: 长期总规范和评审索引记录该技能的唯一处置结论，并继续区分工程处置与未执行的模型评测。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 状态矩阵具有当前子项链接、删除结论和模型评测未执行说明。
