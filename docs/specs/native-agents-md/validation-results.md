# 原生 AGENTS.md 工作流入口 — 验证结果

> 验收来源：[validation-contract.md](validation-contract.md)。
> 交付范围：当前任务分支。

## 1. 当前验收覆盖

| 验收要求 | 当前状态 | 结果引用与缺口 |
|---|---|---|
| `VAL-INSTALLATION-001` 新安装只生成原生入口 | 待复验 | 文件系统集成测试通过；待远端分支端到端安装复验 |
| `VAL-MIGRATION-001` Auriga 旧入口安全退场 | 通过 | 两代旧形态迁移与当前兼容软链移除测试通过 |
| `VAL-SAFETY-001` 用户 Claude 指令不被覆盖 | 通过 | 真实文件与外国软链保持测试通过 |
| `VAL-COMPATIBILITY-001` 历史形态保持可识别可卸载 | 通过 | 状态与卸载回归包含在根测试 549/549 中 |
| `VAL-DOCUMENTATION-001` 活跃规范统一原生策略 | 通过 | 双语模板与技能契约测试通过，活跃表述已反向检查 |
| `VAL-DOCUMENTATION-002` 旧环境恢复路径可发现 | 通过 | 中英文 README 与 guide 记录版本门槛和显式导入路径 |

> 状态：未执行 / 通过 / 失败 / 阻塞 / 待复验 / 不适用。

## 2. 验证记录

- `npm test`：549 项通过，0 项失败。
- `npm run test:session-instructions-loader`：20 项通过，0 项失败。
- `npm run test:git-guards`：commit reminder 39 项、pr-create 33 项、pr-ready 60 项、pr-merge 35 项全部通过。
- `npm --prefix ui test`：6 个测试文件、75 项测试通过。
- Claude Code 与 Codex 的 `quick_validate.py`：`documentation-management` skill 均通过。
- `git diff --check`：通过。
- `npm run test:e2e`：待当前提交推送远端后执行。
