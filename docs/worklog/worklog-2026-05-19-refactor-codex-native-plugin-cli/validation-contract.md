# Validation Contract — Codex 原生 plugin 命令接入 (验收契约 — Codex native plugin CLI adoption)

> 与 spec.md 配套:spec.md 描述 why+what;本文件描述"什么算通过"。
> 每条 VAL 只描述 Behavior + Tool + Evidence;测试设计 (函数组织 / fixture / mock) 是 `test-designer` 的活。

## Coverage map (覆盖矩阵)
| Range (范围) | VAL ids |
|---|---|
| 安装切换到 `codex plugin add` | VAL-CDX-001 ~ 003 |
| 卸载切换到 `codex plugin remove` | VAL-CDX-004 |
| Codex 版本门槛 | VAL-CDX-005 ~ 006 |
| Claude Code 侧零回归 | VAL-CDX-007 |

## Toolchain (本仓库验证栈)
> A1 调研所得的既成事实,不是本次功能的实现决策。只填本契约 VAL 实际用到的类别;test-designer 据此免去重新推断该用哪个运行器 / 驱动。

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| `unit-test` | `node:test`(`node --test`,配合 `--experimental-test-module-mocks` 对子进程执行做 mock);现有 `tests/plugins.test.ts`、`tests/plugins-uninstall.test.ts` 即此模式 |

## Assertions (断言)

### VAL-CDX-001
- **Behavior (行为)**: 非交互安装选中一个本地 Codex plugin 时,该 plugin 经由 `codex plugin add` 完成安装;auriga-cli 不再自行把 plugin 目录复制进 Codex cache,也不再自行写入 `config.toml` 的 plugin 启用项。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 安装流程对该 plugin 发起 `codex plugin add`(以 `<plugin>@<marketplace>` 选择器形态)调用;不再发生由 auriga-cli 执行的 cache 目录复制或 `config.toml` 的 `[plugins.*]` 写入。

### VAL-CDX-002
- **Behavior (行为)**: 非交互安装选中一个外部 Codex plugin 时,该 plugin 同样经由 `codex plugin add` 完成安装。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 安装流程对该外部 plugin 以其 `<plugin>@<marketplace>` 选择器发起 `codex plugin add` 调用。

### VAL-CDX-003
- **Behavior (行为)**: 安装一个带 hooks 的 Codex plugin 后,该 plugin 的 hooks 在 Codex 中处于生效状态。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 安装完成后,Codex 配置反映出该 plugin 已启用且其 hooks 生效(由 `codex plugin add` 负责;无论命令自动开启还是经 auriga-cli 显式传参,结果状态一致)。

### VAL-CDX-004
- **Behavior (行为)**: 卸载一个 Codex plugin 时,经由 `codex plugin remove` 完成;auriga-cli 不再自行编辑 `config.toml` 或删除 cache 目录。卸载不连带移除该 plugin 的 marketplace。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 卸载流程对该 plugin 以其 `<plugin>@<marketplace>` 选择器发起 `codex plugin remove` 调用;不再发生由 auriga-cli 执行的 `config.toml` 改写或 cache 目录删除;不发起任何 `codex plugin marketplace remove`。

### VAL-CDX-005
- **Behavior (行为)**: 当 Codex CLI 不支持 `codex plugin add` 时,`--agent codex` 的非交互安装中止,并以可操作的错误提示用户升级 Codex CLI;不回退到任何手工 cache/config 逻辑。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 安装以失败结束,错误信息中含明确的"升级 Codex"指引;不发生 cache 目录复制或 `config.toml` 写入;不调用 `codex plugin add`。

### VAL-CDX-006
- **Behavior (行为)**: 在 `--agent both` 且 Codex 版本不支持 `codex plugin add` 时,Claude Code 侧的 plugin 安装照常完整执行,Codex 侧记为失败。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: Claude 侧安装步骤正常完成;Codex 侧版本门槛失败被纳入现有 partial-failure 处理(非交互路径以非零状态报告失败,失败信息含 Codex 升级指引)。

### VAL-CDX-007
- **Behavior (行为)**: `--agent claude` 的 plugin 安装与卸载行为,与本次切换前逐字一致。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: Claude 侧安装/卸载发起的 `claude plugins ...` 命令序列与切换前相同;现有 `tests/plugins.test.ts`、`tests/plugins-uninstall.test.ts` 中针对 Claude 路径的断言全部保持通过且无需修改。
