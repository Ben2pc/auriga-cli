[English](README.md) | 中文

# auriga-cli

模块化的 Claude Code harness —— 按需选装你需要的部分。

这个仓库本身就是一个完整配置好的 harness 项目。可以直接 clone 查看完整配置，也可以用 CLI 把各模块安装到你自己的项目中。

## 包含什么

| 模块 | 说明 |
|---|---|
| **Workflow** | `CLAUDE.md` 里的 auriga 工作流：需求澄清 → TDD → Review，Harness 原则，Subagent 使用指南 |
| **Skills** | 外部开发流程 skills —— systematic-debugging、TDD、verification、planning、playwright（spec 撰写与架构设计由 `auriga-workflow` 插件内的 `spec-design`、`arch-design` skill 提供）|
| **Recommended Skills** | 可选的工具类 skills（如 `codex-agent`、`claude-code-agent`），在 workflow skills 之外按需追加 |
| **Plugins** | 推荐的 Claude Code 和 Codex 插件 —— skill-creator、claude-md-management、codex、auriga-workflow、auriga-notify、session-instructions-loader |

## 快速开始

### 让你的 Agent 负责安装

最简单的方式是让当前 Agent 先读取安装指南，再按指南执行：

> 运行 `npx -y auriga-cli guide`，阅读指南，然后按输出步骤把 Auriga harness 安装到当前仓库。

`guide` 命令是非交互式的。它会把前置检查、catalog 查看命令、安装命令、重启会话步骤和验证清单一次性提供给 Agent。

### Agent Bootstrap（非交互）

在 `claude -p`、`claude -p --worktree` 或任何非交互 Agent 会话里想装整套 harness？从这里开始：

```bash
npx -y auriga-cli guide
```

会打印一份 5 步 SOP（前置检查 → `install --preset` → 可选 recommended skills → 重启 session → 验证）。Agent 照着顺序往下跑就能装完整套 harness，全程不需要人按键。

开头的 `-y` 是 **npx 自己的 flag**（用来跳过"是否要装这个包"的确认），**不是** auriga-cli 的参数。

非交互安装命令：

```bash
npx -y auriga-cli install --preset           # 工作流核心:CLAUDE.md/AGENTS.md
                                             #   + 工作流 skill + auriga-workflow 插件
                                             #   (默认:scope user、agent both、lang en)
npx -y auriga-cli install --all              # 全装:workflow + skills + recommended + plugins
npx -y auriga-cli install recommended        # 只装可选工具 skills
npx -y auriga-cli install plugins --agent codex --plugin session-instructions-loader
npx -y auriga-cli install <type> [--flags]   # 单类:workflow | skills | recommended | plugins
npx -y auriga-cli --help                     # 完整 catalog + flag 说明
```

`--preset` 是原子标志 —— 不能与 `<type>` 或任何过滤标志同时使用,但可带 `--scope`、`--agent`、`--lang`(预设默认 `user` / `both` / `en`,与分类安装的默认不同)。

退出码：`0` 成功；`1` 致命错误（前置检查 / 解析 / 拉取失败）；`2` 部分成功——`stderr` 会列出逐类 `[OK]/[FAIL]` 和 `Retry:` 提示。装完后请重启 Claude Code 或 Codex 会话，让新的 `CLAUDE.md` / skills / plugins / hook 插件注册生效。

### Web UI（可选）

如果想在浏览器里看到“已装 / 未装 / 半装”全景并一键 apply，跑：

```bash
npx auriga-cli web-ui
```

它会在 `127.0.0.1` 起一个本地 server、自动开浏览器，扫描当前项目并展示 5 个分类的状态。勾选要安装/卸载的项目后点 Apply，SSE 实时回传执行进度。需要"升级"时就重新 install——每个安装器都是幂等覆盖。关浏览器后约 15 秒 server 自动退出。

Web UI 是显式入口；`npx auriga-cli` 仍然走下面的 TTY 菜单。

### 交互式菜单

```bash
npx auriga-cli
```

交互式菜单，按需选择安装：

```
? Select what to install:
  ◉ Recommended preset — CLAUDE.md/AGENTS.md + workflow skills + auriga-workflow plugin
  ◯ Optional skills — opt-in utility skills (claude-code-agent, codex-agent...)
  ◯ Other plugins — everything except auriga-workflow (auriga-notify, skill-creator, codex...)
```

**Recommended preset** 默认勾选,以预设默认值静默安装（scope `user`、agent `both`、语言 `en`）—— 要精调这些参数,改用非交互的 `install --preset` 标志。另两项会下钻到逐项子勾选。安装插件时还会先选择目标运行时：Claude Code、Codex 或两者都装。

## 模块详情

### Workflow

将 `CLAUDE.md` 复制到目标项目，并创建 `AGENTS.md` 软链接以兼容不同 Agent 框架。支持中英文版本，安装时可选择。

- 目标已有 `CLAUDE.md` 时会自动备份后覆盖
- 涵盖：需求澄清、TDD、代码 Review、分支工作流、Subagent 编排

### Skills

通过 `npx skills add` 安装选中的 skills，同时安装到 Claude Code 和 Codex。

| Skill | 来源 | 说明 |
|---|---|---|
| systematic-debugging | [obra/superpowers](https://github.com/obra/superpowers) | 系统化调试，先找根因再修复 |
| test-driven-development | [obra/superpowers](https://github.com/obra/superpowers) | 测试驱动开发流程 |
| verification-before-completion | [obra/superpowers](https://github.com/obra/superpowers) | 完成前验证，用证据说话 |
| planning-with-files | [OthmanAdi/planning-with-files](https://github.com/OthmanAdi/planning-with-files) | 文件化任务计划与进度跟踪 |
| playwright-cli | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) | 浏览器自动化与测试 |

**Recommended Skills（可选工具类 skill —— `--all` 会装,`--preset` 不装）：**

| Skill | 来源 | 说明 |
|---|---|---|
| claude-code-agent | [Ben2pc/g-claude-code-plugins](https://github.com/Ben2pc/g-claude-code-plugins) | 通过 Claude Code Agent SDK 把任务委派给独立 Claude Code 会话 |
| codex-agent | [Ben2pc/g-claude-code-plugins](https://github.com/Ben2pc/g-claude-code-plugins) | 委派给 Codex 会话，做跨模型覆盖 |
| deprecation-and-migration | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | 废弃与迁移流程 —— 安全地下线、替换或迁移遗留代码 |
| design-taste-frontend | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | 高阶 UI/UX 工程师 —— 度量化设计规则与严格的组件架构约束 |
| documentation-and-adrs | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | 记录架构决策与"为什么" —— 为后来的工程师和 Agent 沉淀上下文 |
| frontend-design | [anthropics/skills](https://github.com/anthropics/skills) | 生成有辨识度、production 级的前端界面，避开常见 AI 同质化美学 |
| make-interfaces-feel-better | [jakubkrehel/make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better) | 界面打磨原则 —— 动画、表面、排版、性能 |

支持 project 和 global 两种安装范围。

### Plugins

可以把选中的插件安装到 Claude Code、Codex 或两者都装。Claude Code 路径使用 `claude plugins install`，并遵守 `--scope project|user`；Codex 路径根据 `~/.codex/config.toml` 中是否已注册同名 marketplace 自动选择 `codex plugin marketplace add` 或 `upgrade`，并在 `~/.codex/config.toml` 里启用选中的插件。

示例：

```bash
npx -y auriga-cli install plugins --agent both --plugin auriga-workflow
npx -y auriga-cli install plugins --plugin auriga-notify
npx -y auriga-cli install plugins --agent codex --plugin session-instructions-loader
```

| 插件 | 运行时 | 说明 |
|---|---|---|
| skill-creator | Claude Code | 创建和管理自定义 skills |
| claude-md-management | Claude Code | 审计和改进 CLAUDE.md |
| codex | Claude Code | Codex 跨模型协作 |
| auriga-workflow | Claude Code / Codex | auriga 工作流插件 —— 工作流 skill 加上强制执行工作流的 git 生命周期 hook。Skills：`incremental-impl`、`test-designer`、`spec-design`、`arch-design`、`code-simplify`、`session-compound`、`goalify`（plan 出自驱 goal 并通过内置 `/goal` 命令分发执行）、`deep-review`（多维度 PR review 编排器——并行派发各维度 reviewer，汇总成可执行的 punch list）、`reviewer-creator`（在 `docs/rules/review/` 下生成项目级自定义 reviewer）、`git-workflow`（git 生命周期 skill）。Hooks：`commit-reminder`（文件编辑的 PostToolUse —— Claude Code 匹配 `Edit` / `Write` / `MultiEdit`，Codex 匹配 `apply_patch` —— 未提交 diff 对比 `HEAD` 超过 200 行或 8 个文件时，提醒在下一个语义边界 commit）、`pr-create-guard`（`gh pr create` 的 PostToolUse —— 注入 PR body 快照供五要素自检，并对不符合 Conventional Commits 的标题提示）、`pr-ready-guard`（`gh pr ready` 与非 draft `gh pr create` 的 PreToolUse —— 拦截游离规划文档、`docs/specs/` 内未结案的活跃 spec、未 push commits）。两个 PostToolUse hook 在 Claude Code / Codex 上完全对齐；Codex 仅对 `pr-ready-guard` 的 PreToolUse `additionalContext` 信息路径 fail-open（block 路径两边一致）。默认通过插件路径安装。 |
| auriga-notify *(opt-in)* | Claude Code | Claude Code `Notification` 事件的 macOS 原生通知插件。支持焦点感知仅提示音、点击唤起终端、按项目分组通知，并迁移旧 `config.json` / `icon.png`。不随 `install --all` 默认安装，需要显式执行 `install plugins --plugin auriga-notify`。 |
| session-instructions-loader | Codex | Codex-only SessionStart 插件，注入上层目录的 `AGENTS.md` 和仓库配置的额外 instruction 文件。 |

## 环境要求

- Node.js >= 18
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)（Plugins 模块需要）
- Codex CLI（仅 `install plugins --agent codex|both` 需要）
- [Homebrew](https://brew.sh)（`auriga-notify` 插件使用 `alerter` 时推荐安装）

## 开发

- `npm test` —— 单元/集成测试（亚秒）
- `npm run test:e2e` —— 完整的 tarball 安装 e2e 套件（~90-120s）。`npm pack` 打出真实 tarball，装到临时项目，对着 GitHub 上当前 HEAD SHA 对应的 content 跑 `auriga-cli install`。预检用 `git branch -r --contains HEAD`，纯本地、不发网络请求，因此 **HEAD 必须能被任何本地 remote ref 追溯到**（`git push` 成功时会同步更新本地 remote ref；如果是别人推的，先 `git fetch`）。`plugins` 和 `--all` 场景还要求 `claude` CLI 已在 PATH，否则这两条会优雅跳过。

## License

MIT
