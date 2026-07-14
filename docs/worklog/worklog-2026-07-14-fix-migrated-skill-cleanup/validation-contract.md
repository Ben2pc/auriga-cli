# Validation Contract — 已迁移技能安全清理 (验收契约 — 已迁移技能安全清理)

> 与 spec.md 配套：spec.md 描述 why+what；本文件描述“什么算通过”。
> 每条 VAL 只描述 Behavior + Tool + Evidence；测试设计归后续测试驱动开发阶段。
> 本文件随 PR #178 在 Ready 前于 2026-07-14 归档。

## Coverage map (覆盖矩阵)

| Range (范围) | VAL ids |
|---|---|
| 迁移安全 | VAL-SAFE-001 ~ VAL-SAFE-004 |
| 规范追踪 | VAL-TRACE-001 ~ VAL-TRACE-002 |
| 真实安装 | VAL-INST-001 |

## Parent coverage map (父级覆盖矩阵)

| Parent VAL (父级验收项) | Child VAL (当前子项) | Status (状态) |
|---|---|---|
| VAL-REV-001 | VAL-TRACE-002 | 仅修正状态表达；目标模型评测明确排除在本次范围外 |
| VAL-REV-002 | VAL-TRACE-002 | 目标模型评测仍待后续人工决定，不在本次宣称通过 |
| VAL-MIG-002 | VAL-SAFE-001、VAL-SAFE-003、VAL-INST-001 | 本次修复并验证双运行时安装与迁移边界 |
| VAL-MIG-003 | VAL-SAFE-002、VAL-SAFE-004、VAL-TRACE-001 | 本次同步发布行为、迁移说明和规范追踪 |
| VAL-DOC-001 | VAL-TRACE-001 | 本次继续保留长期总规范，并验证当前子规范独立存在 |
| VAL-DOC-002 | VAL-TRACE-001 | 本次 Ready 前归档当前子规范，长期总规范继续人工管理 |

## Toolchain (本仓库验证栈)

> 以下是调研所得的既成事实，不是本次功能的实现决策。

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| `unit-test` | `node:test` 驱动的插件迁移与规范契约测试 |
| `e2e-cli` | `npm run test:e2e` 的真实安装包与双运行时安装验证 |
| `repo-check` | `node:test` 驱动的文件内容、版本和父子映射断言 |

## Assertions (断言)

### VAL-SAFE-001
- **Behavior (行为)**: 只迁移一个运行时时，未迁移运行时原本可用的受管独立技能仍然可用，不会留下指向已删除目标的软链接或虚假的锁记录。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: 历史真实实体目录与兼容软链接布局分别执行 Claude Code 单运行时、Codex 单运行时和双运行时迁移后，所有保留路径都能解析到技能正文，所有已删除路径均无残留锁记录。

### VAL-SAFE-002
- **Behavior (行为)**: 所有已知 Auriga 官方历史来源都可以迁移，同名自定义来源、缺失来源和不可读锁文件不会被误删。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: 每个受管历史来源的旧副本均按目标运行时清理；非受管或无法证明来源的副本保持原样，并产生可见的保留原因。

### VAL-SAFE-003
- **Behavior (行为)**: 只有确认目标运行时安装的插件实际包含待迁移技能时，才允许删除旧独立副本。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: 市场刷新失败、旧插件缓存、目标技能缺失和插件安装失败场景都保留旧副本；包含目标技能的新插件安装成功后才执行清理。

### VAL-SAFE-004
- **Behavior (行为)**: 插件安装结果与迁移结果分别可见，部分迁移失败不会被描述为插件未安装或静默成功。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: 插件内容验证、锁读取与锁写入等代表性迁移异常产生可操作的迁移状态，统一异常边界保证其他清理失败也不会被归类为插件安装失败或静默成功。

### VAL-TRACE-001
- **Behavior (行为)**: 长期总规范模板与当前总览都能无歧义追踪父级验收项由哪个子规范覆盖、哪些仍待后续完成。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 总览模板包含父子覆盖结构，当前 `systematic-debugging` 条目和当前子规范都记录对应父级验收项及待补状态，不存在同名不同义的验收编号。

### VAL-TRACE-002
- **Behavior (行为)**: `systematic-debugging` 的实现、迁移与目标模型评测状态分别表达，未执行的评测不会被写成当前拉取请求的完成条件或完成证据。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 长期总览、评审索引和归档评审一致标记实现与迁移状态，并明确目标模型评测未执行且不属于本次范围。

### VAL-INST-001
- **Behavior (行为)**: 使用不改写工作流文档的预设安装后，Claude Code 与 Codex 都从 `auriga-workflow` 获得 `systematic-debugging`，且受管旧独立副本与锁记录不再遮蔽插件技能。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: 真实安装包在两个运行时完成预设安装，插件技能可发现，历史真实布局中的受管旧副本和对应锁记录均按迁移边界处理。
