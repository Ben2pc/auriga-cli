# Validation Contract — 新一代模型工作流升级 (验收契约 — 新一代模型工作流升级)

> 与 spec.md 配套：spec.md 描述 why+what；本文件描述“什么算通过”。
> 每条 VAL 只描述 Behavior + Tool + Evidence；测试设计归后续独立测试设计阶段。

## Coverage map (覆盖矩阵)

| Range (范围) | VAL ids |
|---|---|
| 资产覆盖 | VAL-INV-001 ~ VAL-INV-002 |
| 单项评审 | VAL-REV-001 ~ VAL-REV-003 |
| 组合与迁移 | VAL-MIG-001 ~ VAL-MIG-003 |

## Toolchain (本仓库验证栈)

> 以下是调研所得的既成事实，不是本次功能的实现决策。

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| `repo-check` | `node:test` 驱动的仓库契约测试与文件内容断言 |
| `e2e-cli` | `npm run test:e2e` 的真实安装包与命令行安装验证 |
| `manual` | 对照评审记录、模型运行证据与双运行时行为的人工审查 |

## Assertions (断言)

### VAL-INV-001
- **Behavior (行为)**: 所有 Auriga 自有技能、锁定的外部技能和外部插件都能在评审索引中找到唯一记录。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 评审索引与仓库清单双向比对后不存在遗漏项或无来源项。

### VAL-INV-002
- **Behavior (行为)**: 每项资产都明确标注维护权、安装路径、更新路径和目标运行时。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 任一资产记录都能独立回答四项归属信息，且与仓库清单一致。

### VAL-REV-001
- **Behavior (行为)**: 每项资产都具有唯一的主处置结论，并附有针对目标模型的证据。
- **Tool (工具)**: manual
- **Evidence (判据)**: 每份完成的评审记录包含结论、证据、风险和重新评估触发条件，没有仅凭偏好的结论。

### VAL-REV-002
- **Behavior (行为)**: 被保留或内化的约束都能证明其职责不能稳定地交给目标模型原生完成。
- **Tool (工具)**: manual
- **Evidence (判据)**: 评审记录展示可复现失效模式，或证明该约束属于确定性机制、持久契约、独立评估或跨运行时适配。

### VAL-REV-003
- **Behavior (行为)**: 被删除或精简的约束都记录兼容风险和可逆的恢复条件。
- **Tool (工具)**: manual
- **Evidence (判据)**: 评审记录能说明受影响场景、观察信号和何时重新引入，而不是只写“模型更强”。

### VAL-MIG-001
- **Behavior (行为)**: 最终核心工作流不存在职责重复、循环触发或无上限代理派遣。
- **Tool (工具)**: manual
- **Evidence (判据)**: 组合审查能从入口到完成状态追踪所有触发关系，未发现同一职责由多项约束重复承担或形成递归。

### VAL-MIG-002
- **Behavior (行为)**: 保留的核心工作流在 Claude Code 与 Codex 中都具有明确且最小的运行时边界。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: 两个运行时的安装结果与声明一致，运行时特有约束不会无条件施加到另一运行时。

### VAL-MIG-003
- **Behavior (行为)**: 对用户可见的技能集合或安装行为发生变化时，发布版本与用户文档同步反映该变化。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 发布版本、双语说明、目录清单和安装行为不存在相互矛盾。
