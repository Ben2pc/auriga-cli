[English](README.md) | 中文

# auriga-cli

模块化的 Claude Code harness —— 按需选装你需要的部分。

这个仓库本身就是一个完整配置好的 harness 项目。可以直接 clone 查看完整配置，也可以用 CLI 把各模块安装到你自己的项目中。

## 包含什么

| 模块 | 说明 |
|---|---|
| **Workflow** | `CLAUDE.md` 里的 auriga 工作流：需求澄清 → TDD → Review，Harness 原则，Subagent 使用指南 |
| **Skills** | 开发流程 + 编排类 skills —— brainstorming、systematic-debugging、TDD、verification、planning、playwright、test-designer、parallel-implementation |
| **Recommended Skills** | 可选的工具类 skills（如 `codex-agent`、`claude-code-agent`），在 workflow skills 之外按需追加 |
| **Plugins** | 推荐的 Claude Code 和 Codex 插件 —— skill-creator、claude-md-management、codex、auriga-go、auriga-git-guards、session-instructions-loader、deep-review |
| **Hooks** | Claude Code hooks：`notify`（macOS 通知，终端在焦点时仅放声不弹横幅 —— **opt-in**：`install --all` 不装，需要 `install hooks --hook notify`） |

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

会打印一份 5 步 SOP（前置检查 → `install --all` → 可选 recommended skills → 重启 session → 验证）。Agent 照着顺序往下跑就能装完整套 harness，全程不需要人按键。

开头的 `-y` 是 **npx 自己的 flag**（用来跳过"是否要装这个包"的确认），**不是** auriga-cli 的参数。

非交互安装命令：

```bash
npx -y auriga-cli install --all              # workflow + skills + plugins + hooks（原子）
npx -y auriga-cli install recommended        # 可选工具 skills（不在 --all 内）
npx -y auriga-cli install plugins --agent codex --plugin session-instructions-loader
npx -y auriga-cli install <type> [--flags]   # 单类：workflow | skills | recommended | plugins | hooks
npx -y auriga-cli --help                     # 完整 catalog + flag 说明
```

退出码：`0` 成功；`1` 致命错误（前置检查 / 解析 / 拉取失败）；`2` 部分成功——`stderr` 会列出逐类 `[OK]/[FAIL]` 和 `Retry:` 提示。装完后请重启 Claude Code 或 Codex 会话，让新的 `CLAUDE.md` / skills / plugins / hook 注册生效。

### 交互式菜单

```bash
npx auriga-cli
```

交互式菜单，按需选择安装：

```
? 选择要安装的模块类型：
  ◉ Workflow — CLAUDE.md + AGENTS.md
  ◉ Skills — 开发流程 skills
  ◉ Recommended Skills — 额外的工具 skills
  ◉ Plugins — Claude Code / Codex 插件
  ◉ Hooks — Claude Code hooks
```

每个模块在适用时支持作用域选择（Skills: project/global，Claude Code Plugins: user/project，Hooks: project local / project / user）。安装插件时还会先选择目标运行时：Claude Code、Codex 或两者都装。

## 模块详情

### Workflow

将 `CLAUDE.md` 复制到目标项目，并创建 `AGENTS.md` 软链接以兼容不同 Agent 框架。支持中英文版本，安装时可选择。

- 目标已有 `CLAUDE.md` 时会自动备份后覆盖
- 涵盖：需求澄清、TDD、代码 Review、分支工作流、Subagent 编排

### Skills

通过 `npx skills add` 安装选中的 skills，同时安装到 Claude Code 和 Codex。

| Skill | 来源 | 说明 |
|---|---|---|
| brainstorming | [obra/superpowers](https://github.com/obra/superpowers) | 需求澄清与设计探索 |
| systematic-debugging | [obra/superpowers](https://github.com/obra/superpowers) | 系统化调试，先找根因再修复 |
| test-driven-development | [obra/superpowers](https://github.com/obra/superpowers) | 测试驱动开发流程 |
| verification-before-completion | [obra/superpowers](https://github.com/obra/superpowers) | 完成前验证，用证据说话 |
| planning-with-files | [OthmanAdi/planning-with-files](https://github.com/OthmanAdi/planning-with-files) | 文件化任务计划与进度跟踪 |
| playwright-cli | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) | 浏览器自动化与测试 |
| test-designer | [Ben2pc/auriga-cli](https://github.com/Ben2pc/auriga-cli) | TDD 红灯阶段的 Independent Evaluation 测试设计器 |
| parallel-implementation | [Ben2pc/auriga-cli](https://github.com/Ben2pc/auriga-cli) | 多 subagent 并行写代码时的切片计划器 |
| session-compound | [Ben2pc/auriga-cli](https://github.com/Ben2pc/auriga-cli) | PR 合并后的会话复利 skill — 将本次会话沉淀为交互式 HTML 报告（时间线 + token / cache / 工具健康度 + playground：skill 安装 / AGENTS.md 修改 / 新建 skill 缺口） |

**Recommended Skills（可选，不在 `--all` 内）：**

| Skill | 来源 | 说明 |
|---|---|---|
| claude-code-agent | [Ben2pc/g-claude-code-plugins](https://github.com/Ben2pc/g-claude-code-plugins) | 通过 Claude Code Agent SDK 把任务委派给独立 Claude Code 会话 |
| code-simplification | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | 不改变行为前提下重构代码以提升可读性 —— 清掉累积的不必要复杂度 |
| codex-agent | [Ben2pc/g-claude-code-plugins](https://github.com/Ben2pc/g-claude-code-plugins) | 委派给 Codex 会话，做跨模型覆盖 |
| design-taste-frontend | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | 高阶 UI/UX 工程师 —— 度量化设计规则与严格的组件架构约束 |
| frontend-design | [anthropics/skills](https://github.com/anthropics/skills) | 生成有辨识度、production 级的前端界面，避开常见 AI 同质化美学 |
| make-interfaces-feel-better | [jakubkrehel/make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better) | 界面打磨原则 —— 动画、表面、排版、性能 |

支持 project 和 global 两种安装范围。

### Plugins

可以把选中的插件安装到 Claude Code、Codex 或两者都装。Claude Code 路径使用 `claude plugins install`，并遵守 `--scope project|user`；Codex 路径使用 `codex plugin marketplace add`，并在 `~/.codex/config.toml` 里启用选中的插件。

示例：

```bash
npx -y auriga-cli install plugins --plugin auriga-go
npx -y auriga-cli install plugins --agent codex --plugin session-instructions-loader
npx -y auriga-cli install plugins --agent both --plugin auriga-git-guards
```

| 插件 | 运行时 | 说明 |
|---|---|---|
| skill-creator | Claude Code | 创建和管理自定义 skills |
| claude-md-management | Claude Code | 审计和改进 CLAUDE.md |
| codex | Claude Code | Codex 跨模型协作 |
| auriga-go | Claude Code / Codex | auriga 工作流的自动驾驶：按 `CLAUDE.md` 的 phase 做 reminder-based 导航。内置两个 skill：`auriga-go`（按 description 的自然语言触发 + `/auriga-go` slash command）和 `/goalify`（根据 spec 或当前进展 plan 出 goal，并通过 Claude Code 内置的 `/goal` 命令分发执行）。 |
| auriga-git-guards | Claude Code / Codex | 三个 git-lifecycle guardrail + 内置 `git-workflow` skill。Hooks：`commit-reminder`（Claude Code 下 PostToolUse 匹配 `Edit` / `Write` / `MultiEdit`，Codex 下匹配 `apply_patch`（Codex 文件编辑 canonical `tool_name`），两个 runtime 都触发 —— 未提交 diff 对比 `HEAD` 超过 200 行或 8 个文件，且距上次提醒 ≥ 60 s 时，注入提醒让 Agent 在下一个语义边界 commit）、`pr-create-guard`（`gh pr create` 的 PostToolUse —— 通过 `gh pr view` 拉真实 PR body，扫 `^##` / `^###` headings 并统计 `- [ ]` / `- [x]` 注入 `additionalContext`，让 Agent 对照五要素：scope / acceptance criteria / design decisions / risks / remaining TODOs）、`pr-ready-guard`（`gh pr ready` 的 PreToolUse —— 仅按结构信号拦截：游离 `findings.md` / `progress.md` / `task_plan.md` / `docs/superpowers/specs/*.md`、`docs/specs/*.md` 内未结案的活跃 spec、未 push commits；放行时注入 body 快照）。两个 PostToolUse hook 在 Claude Code / Codex 上完全对齐；Codex 仅对 `pr-ready-guard` 的 PreToolUse `additionalContext` 信息路径 fail-open（block 路径两边一致）。 |
| session-instructions-loader | Codex | Codex-only SessionStart 插件，注入上层目录的 `AGENTS.md` 和仓库配置的额外 instruction 文件。 |
| deep-review | Claude Code / Codex | 多维度 PR review 编排器 —— 并行派发各维度 reviewer（spec-conformance、correctness、test-quality、docs-sync，以及条件触发的 robustness/UX/performance/structure/code-quality/skill-plugin-quality），汇总成 punch list。同包内打包了 `reviewer-creator` skill，用于在 `docs/rules/review/` 下生成项目级自定义 reviewer。承担 `CLAUDE.md` 中的正式评审职责。 |

### Hooks

把 Claude Code hooks 安装到选定的作用域。每个 hook 都是 `.claude/hooks/<name>/` 下一个自包含目录，可以**不改代码**自定义。

| Hook | 说明 |
|---|---|
| notify *(opt-in)* | 当 Claude 需要你关注时弹一条原生 macOS 通知。在通知小图标位显示品牌图，点击通知可把发起 Claude 的终端拉回前台。**焦点感知**：发起 Claude 的终端正处于前台时，仅放提示音不弹横幅（通过 `config.json` 的 `soundOnlyWhenFocused` 切换）。**按项目分组**：新通知会干净地替换通知中心里的旧条目，不会进程堆积，也不会跨项目互相覆盖。会自动通过 Homebrew 安装 `alerter`（`vjeantet/tap/alerter`）。改 `.claude/hooks/notify/config.json` 即可换提示音、替换 `.claude/hooks/notify/icon.png` 即可换图标。仅 macOS 运行时生效，其它平台静默 no-op。 |

作用域选择：

- **Project local**（推荐给跨平台团队）：文件落在 `./.claude/hooks/`，注册到 `./.claude/settings.local.json` —— 每个开发者各自安装，不进 git。
- **Project**：同样的文件，注册到 `./.claude/settings.json` —— 整个团队共享。
- **User**：文件落在 `~/.claude/hooks/`，注册到 `~/.claude/settings.json` —— 全局生效。

重新跑安装器时会保留你修改过的 `config.json` 和 `icon.png`，覆盖运行时本身，并通过 marker 字段幂等去重，绝不会产生重复的 hook 条目。

## 环境要求

- Node.js >= 18
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)（Claude Code Plugins 和 Hooks 模块需要）
- Codex CLI（仅 `install plugins --agent codex|both` 需要）
- [Homebrew](https://brew.sh)（`notify` hook 用来安装 `alerter`，可选）

## 开发

- `npm test` —— 单元/集成测试（亚秒）
- `npm run test:e2e` —— 完整的 tarball 安装 e2e 套件（~90-120s）。`npm pack` 打出真实 tarball，装到临时项目，对着 GitHub 上当前 HEAD SHA 对应的 content 跑 `auriga-cli install`。预检用 `git branch -r --contains HEAD`，纯本地、不发网络请求，因此 **HEAD 必须能被任何本地 remote ref 追溯到**（`git push` 成功时会同步更新本地 remote ref；如果是别人推的，先 `git fetch`）。`plugins` 和 `--all` 场景还要求 `claude` CLI 已在 PATH，否则这两条会优雅跳过。

## License

MIT
