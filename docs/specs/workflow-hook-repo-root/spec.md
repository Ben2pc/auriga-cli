# 钩子按工作区定位仓库 — Spec（Hook repo-root resolution — 规范）

> 让 `auriga-workflow` 的 git 生命周期钩子在 Cursor 上对用户的项目仓库生效，而不是对插件缓存目录生效。

## Why (为什么做)

- **问题与用户**：在 Cursor 里改用户项目时，提交提醒进不了模型上下文；就绪 / 合并守卫找不到仓库就放行。Claude Code 和 Codex 上同一套脚本是通的。
- **事实依据**：
  - Cursor 把插件钩子的进程目录设成插件缓存。iOS 仓库会话日志写明 `Running script in directory: ~/.claude/plugins/cache/auriga-cli/auriga-workflow/4.0.26`，同时载荷带有 `workspace_roots: ["/Users/pangcheng/Workspace/CurioSea/CurioSea-iOS"]`。
  - `commit-reminder.mjs` 解析标准输入后丢掉；`git rev-parse` / `git diff HEAD` 跟当前目录走。插件缓存不是 Git 仓库，脚本按设计静默退出。
  - 同一份脚本在 iOS 仓库目录里立刻打出 600 行 / 7 个文件的提醒。临时环境里，包装器按载荷定位后再调 4.0.26 脚本，Cursor / Grok 形状的输入都能提醒或拦截。
  - Cursor 真机：按 `workspace_roots` 定位后，探测标记进入了模型上下文。
  - Grok 真机：进程目录本来就是仓库，并注入 `cwd` / `workspaceRoot` / `CLAUDE_PROJECT_DIR`。改文件后的附加上下文模型看不到；`gh pr ready` 的退出码 2 拦截模型看得到。
  - [Grok Build](https://github.com/xai-org/grok-build) 源码里，改文件之后走 `dispatch_non_blocking`，不解析标准输出。`additionalContext` 只在回合结束钩子上交给模型，而且会拦住结束再跑一轮。
- **价值与时机**：这是已支持宿主上的守卫失效，不是新能力。不修的话，Cursor 上广告出去的提醒和就绪 / 合并门禁会继续静默失效。
- **替代方案**：等 Cursor 改工作目录不可控；人工记得提交不稳定。把提醒接到 Grok 回合结束上会改变「只提醒、不拦停」的产品语义，本次不做。

## Findings (调研发现)

- 无项目专属 spec 规则（`docs/rules/spec/` 为空）。
- 当前插件版本 `4.0.26`。本次只改插件载荷，不提升命令行安装器版本。
- `pr-create-guard` 从工具结果里识别新建拉取请求，不扫本地仓库；不受这次工作目录问题影响。
- `auriga-notify` 只给 Claude Code；`session-instructions-loader` 只给 Codex，且已经读载荷里的 `cwd`。
- 被改文件路径不能当第一信号：Cursor 常把 `Write` 写到 `~/.cursor/projects/.../agent-tools/`，不在用户仓库里。

## What (做什么)

装上本次插件后，用户可观察的行为：

1. **提交提醒（Cursor）**：未提交差异超过 200 行或 8 个文件，且冷却已过时，下一次改文件后，模型上下文出现 `[commit-reminder]`。即使钩子进程目录是插件缓存，只要载荷带了工作区根目录，就对那个仓库算差异、写状态文件。
2. **就绪守卫**：在 Cursor / Grok / Claude Code / Codex 上执行 `gh pr ready`（或无草稿的 `gh pr create`）时，按用户项目仓库检查 `.planning/`、`docs/specs/` 和未推送提交。进程目录是插件缓存时不得因此放行。
3. **合并守卫**：裸 `gh pr merge`（没有编号或地址）时，按用户项目仓库取当前拉取请求正文，再检查验收标准和验证计划。不得因为进程目录不是仓库就放行。
4. **Claude Code / Codex**：会话目录已经是项目时，现有提醒和守卫行为保持不变。
5. **Grok**：拦截通道保持可用。不要求改文件之后的提醒或创建快照出现在模型上下文里。
6. **找不到仓库时**：仍然静默放行 / 不提醒，与现在「不在 Git 仓库里就退出」一致。
7. **多根工作区**：使用 `workspace_roots` 的第一项作为目标仓库。

定位顺序（用户能观察到的是「对哪个仓库生效」，不是函数名）：

1. Cursor 的 `workspace_roots` 第一项
2. Grok 的 `workspaceRoot` 或 `cwd`
3. 环境变量 `CLAUDE_PROJECT_DIR`、`GROK_WORKSPACE_ROOT`
4. 当前目录

## Out of scope (本次不做)

- 让 Grok 在改文件之后把提交提醒或创建快照注入模型。宿主丢掉这条标准输出；接到回合结束钩子上会拦住结束，另开产品决定。
- 改阈值、冷却时间、提醒文案或守卫的拦截条件。
- 修改 `pr-create-guard`、`auriga-notify`、`session-instructions-loader`。
- 用被改文件路径反查仓库作为主信号。
- 提升命令行安装器版本。
- 等待 Cursor 或 Grok 官方改钩子工作目录 / 注入通道。

## Open questions (悬而未决)

- 共用解析函数怎么抽、测试怎么组织 — 归属：impl；推迟理由：不改变上述用户可观察契约。

## References (参考资料)

- Cursor 钩子日志：`Running script in directory` + `workspace_roots` + `Hook produced no output`
- 临时探测：`/tmp/auriga-hook-cwd-probe`
- Grok 文档：`~/.grok/docs/user-guide/10-hooks.md`「Passive Hooks」
- 源码：`xai-org/grok-build` 的 `xai-grok-hooks/src/dispatcher.rs`、`result.rs`、`runner/command.rs`
