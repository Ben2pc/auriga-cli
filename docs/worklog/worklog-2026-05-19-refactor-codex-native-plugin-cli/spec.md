# Codex 原生 plugin 命令接入 — Spec (Codex native plugin CLI adoption — Spec)

> 把 auriga-cli 对 Codex 的 plugin 安装/卸载,从半手工的文件系统 + config.toml 操作,切换到 Codex CLI 的原生 `plugin add` / `plugin remove` 命令。

## Why (为什么做)

Codex CLI 0.131.0 把 plugin 的安装与卸载做成了一等命令。auriga-cli 当前对 Codex 的处理是在 Codex 还没有这些命令时写的"垫片":marketplace 那步已经用 CLI,但"安装某个 plugin"这步是 auriga-cli 自己把本地 plugin 目录复制进 Codex 的 cache,再手写 `config.toml`;卸载同理靠手工删 config 项 + 删 cache 目录。

这套手工逻辑复刻了 Codex 的内部约定(cache 目录布局、`config.toml` 中 `[features]` 与 `[plugins.*]` 的结构)。这些约定属于 Codex,不属于 auriga-cli——Codex 一旦调整,垫片就会悄悄失配。既然 Codex 已经提供官方命令,继续维护这份逆向实现是纯粹的负债。切换后由 Codex CLI 自己负责 cache 物化与配置写入,auriga-cli 只需调用命令。

## Findings (调研发现)

- Codex CLI 0.131.0 的 `codex plugin --help` 提供四个子命令:`add`(从已配置的 marketplace snapshot 安装 plugin)、`remove`(从本地 config 和 cache 移除 plugin)、`list`、`marketplace`。
- `codex plugin add` 接受 `<PLUGIN@MARKETPLACE>`,或 `<PLUGIN>` 配合 `-m/--marketplace`;并带 `--enable <FEATURE>` 用于开启 feature。
- `codex plugin remove` 同样接受 `<PLUGIN@MARKETPLACE>`,文档明确表述为"从本地 config 和 cache 移除"。
- 当前安装路径 `src/plugins.ts:installCodexPlugins()`:marketplace 步骤已用 `codex plugin marketplace add/upgrade`;`materializeLocalCodexPluginCache()`(`src/plugins.ts:706`)手工把本地 plugin 目录复制进 `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`;`enableCodexPluginConfig()`(`src/plugins.ts:838`)手写 `config.toml` 的 `[features]` 与 `[plugins."<name>@<marketplace>"]`。
- 当前卸载路径 `src/plugins.ts:uninstallPlugin()` 的 Codex 分支(`src/plugins.ts:1360` 起):解析 `config.toml`、删除 `[plugins."<id>"]` 项、原子写回,再 `rm` 掉 cache 目录;代码注释写明这是因为"当时没有 `codex plugin uninstall`"。
- 安装器的失败语义:`opts.interactive === false` 时失败抛错;交互路径"记录日志并继续",让 TTY 菜单原地展示错误(`docs/architecture/auriga-cli-dev-guide.md`)。现有 Codex 安装对本地 marketplace 缺失等情况采用"partial install 优于 zero install"的处理。
- Claude Code 侧的安装/卸载走 `claude plugins ...` 命令,与 Codex 路径相互独立。

## What (做什么)

### 1. 安装切换到 `codex plugin add`

`auriga-cli install plugins`(`--agent codex` 或 `--agent both`)在完成 marketplace 注册后,对每个选中的 plugin——本地的与外部的——通过 Codex 原生的 `codex plugin add` 命令完成安装。auriga-cli 不再自行把本地 plugin 目录复制进 Codex cache,也不再自行写入 `config.toml` 的 plugin 启用项。

安装完成后的可观察结果与切换前一致:选中的 plugin 在 Codex 中处于已启用状态;带 hooks 的 plugin,其 hooks 在 Codex 中生效。

### 2. 卸载切换到 `codex plugin remove`

`uninstallPlugin()` 的 Codex 分支通过 `codex plugin remove` 完成卸载,由 Codex CLI 负责从其 config 与 cache 中移除 plugin。auriga-cli 不再自行编辑 `config.toml` 或删除 cache 目录。

与现状一致地保留一条边界:卸载单个 plugin 不连带移除其 marketplace——一个 marketplace 可能托管多个 plugin。

### 3. marketplace 管理维持现状

marketplace 的注册与刷新仍走现有的 `codex plugin marketplace add` / `upgrade`,以及配套的同名异源劫持防护。本次不改动。

### 4. Codex 版本门槛

当检测到当前安装的 Codex CLI 不支持 `codex plugin add` 时,Codex 侧的 plugin 安装中止,并向用户给出可操作的错误提示,说明需要升级 Codex CLI。不再保留旧的手工 cache/config 逻辑作为低版本 fallback——旧逻辑随本次切换一并删除。

### 5. 版本门槛只挂 Codex 侧

版本门槛触发时只影响 Codex 侧。在 `--agent both` 场景下,Claude Code 侧的 plugin 安装照常完整执行;Codex 侧记为失败,沿用现有的 partial-failure 处理与退出语义(非交互路径以非零状态报告失败,交互路径记录错误并让菜单继续)。

### 6. Claude Code 侧零改动

`--agent claude` 的安装与卸载行为,以及 Claude 侧的卸载路径,本次完全不改动,行为与切换前逐字一致。

## Out of scope (本次不做)

- 不引入 `codex plugin list` 的新功能(例如用它做安装前的可用性校验)。本次只接入 `add` / `remove`。
- 不改动 Codex marketplace 的注册/刷新逻辑与同名异源防护。
- 不改动 Claude Code 侧的任何安装/卸载逻辑。
- 不改动 `.agents/plugins/marketplace.json`、`extra_plugin_configs.json`、`.claude-plugin/marketplace.json` 的格式或内容契约。
- 不为低版本 Codex 保留手工 fallback——明确移除,而非保留。

## Open questions (悬而未决)

1. **(归属 plan)** Codex 版本门槛的检测方式:按版本号比较,还是按能力探测(例如探查 `codex plugin add` 子命令是否存在)。推迟理由:两种方式都能满足"不支持就报错"的行为契约,选择取决于实现稳健性与对 Codex 未来版本的兼容性,属于实现策略。
2. **(归属 impl)** `codex plugin add` 是否会自行开启 `features.plugins` 与 `features.plugin_hooks`,还是仍需 auriga-cli 通过 `--enable` 显式传入。推迟理由:这是外部命令的实际行为,需在实现阶段以真实 Codex CLI 验证后确定,不影响本 spec 的行为契约(无论哪种,安装后"plugin 启用、hooks 生效"的结果不变)。

## References (参考资料)

无外链。命令契约来自本机 `codex plugin --help`(Codex CLI 0.131.0)的输出,已记入 Findings。
