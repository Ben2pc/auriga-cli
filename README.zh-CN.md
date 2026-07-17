[English](README.md) | 中文

# auriga-cli

模块化的 Claude Code harness —— 按需选装你需要的部分。

这个仓库本身就是一个完整配置好的 harness 项目。可以直接 clone 查看完整配置，也可以用 CLI 把各模块安装到你自己的项目中。

Auriga 的 harness 设计受以下几个开源 skill 与 Agent 工作流项目启发：

- [obra/superpowers skills](https://github.com/obra/superpowers/tree/main/skills)
- [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
- [mattpocock/skills](https://github.com/mattpocock/skills/tree/main)

## 包含什么

| 模块 | 说明 |
|---|---|
| **Workflow** | `AGENTS.md` 里的 auriga 工作流：需求澄清 → TDD → Review，Harness 原则，Subagent 使用指南 |
| **Skills** | 外部开发流程 skills —— planning 与 playwright（`systematic-debugging`、TDD、spec 撰写、架构设计与完成声明纪律由工作流或 `auriga-workflow` 插件提供）|
| **Recommended Skills** | 可选的工具类 skills（如 `codex-agent`、`claude-code-agent`），在 workflow skills 之外按需追加 |
| **Plugins** | 推荐的 Claude Code 和 Codex 插件 —— skill-creator、claude-md-management、playground、codex、auriga-workflow、auriga-notify、session-instructions-loader |

## 快速开始

### 安装

推荐安装方式有两种：

1. 用户自己在命令行运行安装器：

```bash
npx -y auriga-cli
```

2. 在交互式 Agent 会话里输入提示词：

> 运行 `npx -y auriga-cli guide`，阅读指南，然后按输出步骤把 Auriga harness 安装到当前仓库。

`guide` 命令是非交互式的，方便 Agent 一次性读取前置检查、catalog 查看命令、安装命令、重启会话步骤和验证清单。

开头的 `-y` 是 **npx 自己的 flag**（用来跳过"是否要装这个包"的确认），**不是** auriga-cli 的参数。

非交互安装命令：

```bash
npx -y auriga-cli install --preset           # 工作流核心:AGENTS.md/CLAUDE.md
                                             #   + 工作流 skill + auriga-workflow 插件
                                             #   (默认:scope user、agent both、lang zh-CN)
npx -y auriga-cli install --preset-plugins-skills
                                             # 跳过 AGENTS.md/CLAUDE.md,只装预设 skill + auriga-workflow 插件
                                             #   (默认:scope user、agent both)
npx -y auriga-cli install --all              # 全装:workflow + skills + recommended + plugins
npx -y auriga-cli install recommended        # 只装可选工具 skills
npx -y auriga-cli install plugins --agent codex --plugin session-instructions-loader
npx -y auriga-cli install <type> [--flags]   # 单类:workflow | skills | recommended | plugins
npx -y auriga-cli --help                     # 完整 catalog + flag 说明
```

`--preset` 是原子标志 —— 不能与 `<type>` 或任何过滤标志同时使用,但可带 `--scope`、`--agent`、`--lang`(预设默认 `user` / `both` / `zh-CN`,与分类安装的默认不同)。如果项目已经有自己的 `AGENTS.md / CLAUDE.md`,用 `--preset-plugins-skills` 只安装同一组预设 skills 和 `auriga-workflow` 插件,不触碰 workflow 文档。

退出码：`0` 成功；`1` 致命错误（前置检查 / 解析 / 拉取失败）；`2` 部分成功——`stderr` 会列出逐类 `[OK]/[FAIL]` 和 `Retry:` 提示。装完后请重启 Agent 会话，让新的 `AGENTS.md` / skills / plugins / hook 插件注册生效。

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
  ◉ Recommended preset — AGENTS.md/CLAUDE.md + workflow skills + auriga-workflow plugin
  ◯ Optional skills — opt-in utility skills (claude-code-agent, codex-agent...)
  ◯ Other plugins — everything except auriga-workflow (auriga-notify, skill-creator, codex...)
```

**Recommended preset** 默认勾选,以预设默认值静默安装（scope `user`、agent `both`、语言 `zh-CN`）—— 要精调这些参数,改用非交互的 `install --preset` 标志。另两项会下钻到逐项子勾选。安装插件时还会先选择目标运行时：Claude Code、Codex 或两者都装。

## 模块详情

### Workflow

将 `AGENTS.md` 安装到目标项目，并创建 `CLAUDE.md` 软链接以兼容 Claude Code。默认安装中文版本，英文可通过 `--lang en` 显式选择。

- **可扩展、可升级**：auriga 工作流被一对 `<!-- AURIGA:WORKFLOW:v1 START/END -->` 标记包成「受管区块」。把你的工程专属规则写在 END 标记**之后**——再次安装只就地升级受管区块,你的内容原样保留。
- 旧版本装下的、无标记的 `CLAUDE.md` 会在下次安装时安全迁移到新的 `AGENTS.md` 主文件形态,旧文件备份到 `CLAUDE.md.bak`。别的工具生成的 `AGENTS.md` 或 `CLAUDE.md` 会作为用户区保留在全新受管区块下方。
- 涵盖：需求澄清、TDD、代码 Review、分支工作流、Subagent 编排

### Skills

通过 `npx skills add` 安装选中的 skills，同时安装到 Claude Code 和 Codex。

| Skill | 来源 | 说明 |
|---|---|---|
| planning-with-files | [OthmanAdi/planning-with-files](https://github.com/OthmanAdi/planning-with-files) | 文件化任务计划与进度跟踪 |
| playwright-cli | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) | 浏览器自动化与测试 |

**Recommended Skills（可选工具类 skill —— `--all` 会装,`--preset` 不装）：**

| Skill | 来源 | 说明 |
|---|---|---|
| claude-code-agent | [Ben2pc/g-claude-code-plugins](https://github.com/Ben2pc/g-claude-code-plugins) | 通过 Claude Code Agent SDK 把任务委派给独立 Claude Code 会话 |
| codex-agent | [Ben2pc/g-claude-code-plugins](https://github.com/Ben2pc/g-claude-code-plugins) | 委派给 Codex 会话，做跨模型覆盖 |
| deprecation-and-migration | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | 废弃与迁移流程 —— 安全地下线、替换或迁移遗留代码 |
| design-taste-frontend | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | 高阶 UI/UX 工程师 —— 度量化设计规则与严格的组件架构约束 |
| frontend-design | [anthropics/skills](https://github.com/anthropics/skills) | 生成有辨识度、production 级的前端界面，避开常见 AI 同质化美学 |
| make-interfaces-feel-better | [jakubkrehel/make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better) | 界面打磨原则 —— 动画、表面、排版、性能 |

支持 project 和 global 两种安装范围。

### Plugins

可以把选中的插件安装到 Claude Code、Codex 或两者都装。Claude Code 路径使用 `claude plugins install`，并遵守 `--scope project|user`；Codex 路径根据 `~/.codex/config.toml` 中是否已注册同名 marketplace 自动选择 `codex plugin marketplace add` 或 `upgrade` 注册 marketplace，再用原生的 `codex plugin add <plugin>@<marketplace>` 命令安装每个选中的插件。Codex 路径要求 Codex CLI 版本新到支持 `codex plugin add`；旧版本会中止 Codex 侧安装并提示升级。

`auriga-workflow` 只负责提供插件内技能，不会扫描、修改或删除以前独立安装的同名技能。团队升级后先确认插件技能可用，再通过 `npx skills remove <skill-name>` 或人工方式移除旧副本及对应锁记录；这项小团队迁移通过口头同步完成，不在安装器里维护自动清理状态机。

示例：

```bash
npx -y auriga-cli install plugins --agent both --plugin auriga-workflow
npx -y auriga-cli install plugins --plugin auriga-notify
npx -y auriga-cli install plugins --agent codex --plugin session-instructions-loader
```

| 插件 | 运行时 | 说明 |
|---|---|---|
| skill-creator | Claude Code | 创建和管理自定义 skills |
| claude-md-management | Claude Code / Codex | 审计和改进 AGENTS.md / CLAUDE.md |
| playground | Claude Code / Codex | 构建交互式 HTML playground |
| codex | Claude Code | Codex 跨模型协作 |
| auriga-workflow | Claude Code / Codex | Auriga 端到端工程工作流，覆盖证据优先的缺陷诊断、按风险选择验证并审慎沉淀永久测试、需求与架构澄清、增量实现、保留人工门禁的自主执行、按持续集成评审情况路由本地深度评审、文档资产治理和 Git 生命周期约束。 |
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
