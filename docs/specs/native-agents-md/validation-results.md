# 原生 AGENTS.md 单一入口 — 验证结果

> 验收来源：[validation-contract.md](validation-contract.md)。

| 验收要求 | 当前状态 | 结果引用与缺口 |
|---|---|---|
| `VAL-OWNERSHIP-001` | 待复验 | 文件系统测试与全量根测试通过；待推送后端到端复验 |
| `VAL-SCAN-001` | 通过 | 项目只有 `CLAUDE.md` 时报告未安装；受管 `AGENTS.md` 正常识别 |
| `VAL-DOCUMENTATION-001` | 通过 | 契约测试、双宿主技能验证器与活跃文件反向搜索通过 |
| `VAL-REGRESSION-001` | 待复验 | 根测试与会话分析器通过；待推送后端到端复验 |

## 当前证据

- 修改测试后、删除实现前，窄测试出现 8 项预期失败，覆盖项目扫描回退、安装提示和卸载清理旧入口。
- 删除兼容实现后，同一组安装、卸载与状态扫描测试 65/65 通过。
- `npm test`：547 项通过，0 项失败。
- `node tests/session-compound-analyzers.test.mjs`：68 项通过，0 项失败。
- `npm run test:session-instructions-loader`：20 项通过，0 项失败。
- `npm run test:git-guards`：四组守卫测试全部通过。
- `npm --prefix ui test`：75 项通过，0 项失败。
- Claude Code 与 Codex 的 `quick_validate.py`：`documentation-management` skill 均通过。
- `git diff --check`：通过。
- `npm run test:e2e`：待当前提交推送后执行。
