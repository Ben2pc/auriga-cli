# Validation Contract — arch-design modernization (验收契约 — `arch-design` 现代化)

> 与 spec.md 配套：spec.md 描述 why+what；本文件描述“什么算通过”。
> 每条 VAL 只描述 Behavior + Tool + Evidence；测试设计由实现阶段决定。

## Coverage map (覆盖矩阵)

| Range (范围) | VAL ids |
|---|---|
| 触发与职责边界 | VAL-ARCH-001 ~ 002 |
| 人工评审产物 | VAL-ARCH-003 |
| 条件式参考资料 | VAL-ARCH-004 |
| 流程精简 | VAL-ARCH-005 |

## Toolchain (本仓库验证栈)

> A1 调研所得的既成事实，不是本次功能的实现决策。只填本契约 VAL 实际用到的类别。

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| `repo-check` | `node:test` 驱动的仓库契约测试与文件内容检查 |

## Assertions (断言)

### VAL-ARCH-001
- **Behavior (行为)**: `arch-design` 能覆盖新功能设计，也能覆盖用户主动提出的现有架构优化、领域模型改善、职责或边界重塑、依赖与分层调整等技术澄清场景。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 技能的触发描述和正文同时明确这些场景，并保留对局部代码清理的退出边界。

### VAL-ARCH-002
- **Behavior (行为)**: 技能清楚区分需求规格、架构设计和执行计划，同时规定架构澄清发现产品语义不明确时返回需求规格补充。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 技能说明领域概念、职责、模块边界、依赖、接口和数据流属于技术方案澄清，并且没有把实施切片纳入架构设计。

### VAL-ARCH-003
- **Behavior (行为)**: 存在实质性的架构、领域模型或跨边界决策时，默认形成便于人工评审的 `arch_design.md`，并在实现前取得用户确认。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 技能和设计文档模板都体现人工评审门禁；仅在不构成架构设计或用户明确选择对话内决定时允许跳过文档。

### VAL-ARCH-004
- **Behavior (行为)**: 参考资料作为按设计场景调用的工具箱，保留方法、适用条件、选择信号和主要风险，并覆盖组件或模块划分、接口接缝、领域模型和渐进迁移。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 主技能明确每类资料的读取条件；参考资料不重复大段通用教学，且领域模型场景具有可发现的入口。

### VAL-ARCH-005
- **Behavior (行为)**: 架构设计不生成交互式页面或静态网页，不强制提供两个候选，也不在缺少真实取舍时强制用户选型。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 技能正文与模板中不存在上述强制流程；多个候选只在存在实质性权衡时出现。
