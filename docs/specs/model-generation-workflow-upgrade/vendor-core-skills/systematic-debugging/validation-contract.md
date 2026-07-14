# Validation Contract — 轻量系统化调试技能 (验收契约 — 轻量系统化调试技能)

> 与 spec.md 配套：spec.md 描述 why+what；本文件描述“什么算通过”。
> 每条 VAL 只描述 Behavior + Tool + Evidence；测试设计归后续测试驱动开发阶段。

## Coverage map (覆盖矩阵)

| Range (范围) | VAL ids |
|---|---|
| 调试行为 | VAL-DIAG-001 ~ VAL-DIAG-003 |
| 线上问题 | VAL-PROD-001 ~ VAL-PROD-002 |
| 迁移与发布 | VAL-MIG-001 ~ VAL-MIG-002 |

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

### VAL-MIG-001
- **Behavior (行为)**: `systematic-debugging` 只通过 Auriga 工作流插件发布，不再同时作为外部锁定技能安装。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: 安装预设后只能发现插件提供的同名技能，外部技能锁定清单和外部安装批次中不存在该名称。

### VAL-MIG-002
- **Behavior (行为)**: 已安装旧外部版本的项目在安装 Auriga 工作流插件后不会保留重复或遮蔽插件技能的旧副本。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 迁移契约测试证明旧的项目级和用户级技能副本会按既有迁移策略清理。
