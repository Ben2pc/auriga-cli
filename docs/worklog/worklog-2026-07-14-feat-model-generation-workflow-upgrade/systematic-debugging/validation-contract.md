# Validation Contract — 轻量系统化调试技能 (验收契约 — 轻量系统化调试技能)

> 与 spec.md 配套：spec.md 描述 why+what；本文件描述“什么算通过”。
> 每条 VAL 只描述 Behavior + Tool + Evidence；测试设计归后续测试驱动开发阶段。
> 本文件随 `systematic-debugging` 子 PR 于 2026-07-14 归档。

## Coverage map (覆盖矩阵)

| Range (范围) | VAL ids |
|---|---|
| 调试行为 | VAL-DIAG-001 ~ VAL-DIAG-003 |
| 线上问题 | VAL-PROD-001 ~ VAL-PROD-002 |
| 迁移与发布 | VAL-PUBL-001 ~ VAL-PUBL-002 |

## Parent coverage map (父级验收覆盖映射)

| Parent VAL (父级验收项) | Child VAL (子验收项) | Status (状态) |
|---|---|---|
| VAL-MIG-002 | VAL-PUBL-001..002 | 实现已合入 PR #177；PR #178 取消自动迁移并采用团队人工清理 |
| VAL-MIG-003 | VAL-PUBL-001 | PR #177 已同步技能清单和文档；PR #178 同步人工清理说明与 CLI 版本 |

`VAL-REV-001` 与 `VAL-REV-002` 仍等待后续模型评测与正式处置子规范覆盖；本子规范的调试行为验收不能替代目标模型证据，因此不把两项父级验收映射到 `VAL-DIAG-*` 或 `VAL-PROD-*`。

## Toolchain (本仓库验证栈)

> 以下是调研所得的既成事实，不是本次功能的实现决策。

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| `repo-check` | `node:test` 驱动的技能正文、清单与插件契约测试 |
| `e2e-cli` | `npm run test:e2e` 的真实安装包与双运行时安装验证 |
| `manual` | 对照规范审查技能正文的授权、生产事故与诊断深度边界 |

## Assertions (断言)

### VAL-DIAG-001
- **Behavior (行为)**: 永久修复前存在能够捕获用户真实症状的问题验证路径，或明确记录无法立即复现时的证据采集路径。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 技能正文同时定义可重复验证与无法复现两种分支，且没有要求用猜测填补证据缺口。

### VAL-DIAG-002
- **Behavior (行为)**: 最小复现和常见诊断方法按证据需要选择，不构成所有问题必须完成的固定检查清单。
- **Tool (工具)**: manual
- **Evidence (判据)**: 技能正文将诊断方法标记为可选工具箱，并允许简单问题在证据充分时跳过最小化。

### VAL-DIAG-003
- **Behavior (行为)**: 用户只要求诊断时不会实施永久修复，用户授权修复后才进入修复与验证。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 技能正文明确区分两种授权范围，没有把诊断请求自动扩大为代码修改。

### VAL-PROD-001
- **Behavior (行为)**: 无法立即复现的线上问题可以通过日志、指标、链路信息、监控或报警建立后续证据采集路径。
- **Tool (工具)**: manual
- **Evidence (判据)**: 技能正文要求说明待收集信号和后续判断条件，并在证据不足时标注根因尚未确认。

### VAL-PROD-002
- **Behavior (行为)**: 用户受影响的线上事故允许先采取可逆恢复措施，但临时缓解不会被表述为根因修复。
- **Tool (工具)**: manual
- **Evidence (判据)**: 技能正文同时包含先恢复服务的例外和事故恢复后继续诊断的要求。

### VAL-PUBL-001
- **Behavior (行为)**: `systematic-debugging` 只通过 Auriga 工作流插件发布，不再同时作为外部锁定技能安装。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: 安装预设后只能发现插件提供的同名技能，外部技能锁定清单和外部安装批次中不存在该名称。

### VAL-PUBL-002
- **Behavior (行为)**: 安装 Auriga 工作流插件不会擅自修改旧外部技能；团队升级说明明确要求确认插件生效后人工清理重复副本。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 安装回归测试证明旧技能正文与锁文件保持不变；双语说明给出 `npx skills remove <skill-name>` 的人工清理路径。
