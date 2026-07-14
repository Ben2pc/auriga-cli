# Validation Contract — 取消自动技能迁移

> 与本目录的 `spec.md` 配套；本文件随 PR #178 归档。

## Parent coverage map

| Parent VAL | Child VAL | Status |
|---|---|---|
| VAL-MIG-002 | VAL-REMOVE-001、VAL-NOMUTATE-001 | 自动迁移被删除；插件技能保留，旧副本由团队人工处理 |
| VAL-MIG-003 | VAL-MANUAL-001、VAL-RELEASE-001 | 双语说明和 CLI 版本同步人工清理决策 |
| VAL-DOC-001 | VAL-LIFE-001 | 长期总规范继续保留 |
| VAL-DOC-002 | VAL-LIFE-001 | 当前子规范已归档到 worklog |

## Assertions

### VAL-REMOVE-001
- **Behavior**：`auriga-workflow` 安装路径不包含旧独立工作流技能的自动迁移状态机。
- **Tool**：repo-check
- **Evidence**：源码不存在受管来源列表、技能目录清理、内容散列、软链接物化、迁移锁或恢复日志逻辑。

### VAL-NOMUTATE-001
- **Behavior**：安装 `auriga-workflow` 不修改已存在的独立技能目录和 skills 锁文件。
- **Tool**：unit-test、e2e-cli
- **Evidence**：安装前后技能正文与锁文件逐字节一致，同时插件注册成功。

### VAL-MANUAL-001
- **Behavior**：团队升级流程明确采用人工清理，不暗示安装器会自动处理旧副本。
- **Tool**：repo-check
- **Evidence**：双语 README、ADR 和开发者指南统一要求先验证插件，再通过 `npx skills remove <skill-name>` 或人工方式清理旧副本。

### VAL-RELEASE-001
- **Behavior**：删除自动迁移属于用户可见 CLI 行为变化，必须提升 CLI 版本。
- **Tool**：repo-check
- **Evidence**：`package.json` 版本高于基准分支；插件载荷未变化，因此插件清单版本不额外提升。

### VAL-TRACE-001
- **Behavior**：长期总规范能追踪自动迁移已取消、人工清理已采用。
- **Tool**：repo-check
- **Evidence**：父级 `VAL-MIG-002/003` 精确映射到本契约的子验收项。

### VAL-TRACE-002
- **Behavior**：技能实现、人工清理和目标模型评测状态分别表达。
- **Tool**：repo-check
- **Evidence**：长期总览与评审记录明确模型评测未执行且不属于 PR #178。

### VAL-LIFE-001
- **Behavior**：当前子 PR 的规范归档，跨 PR 总规范继续保留。
- **Tool**：repo-check
- **Evidence**：本契约位于 worklog；`docs/specs/` 不保留当前 PR 产物。

## Verification record

- `npm test`：483 项通过，0 项失败。
- `npm run test:session-instructions-loader`：20 项通过，0 项失败。
- `npm run test:git-guards`：28 项通过，0 项失败。
- `npm run test:e2e`：待当前提交推送后执行。
- 本次不执行 GPT 5.6 Sol 或 Fable 5 模型评测。
