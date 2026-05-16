# Preset Install — Spec (推荐预设安装 — 规范)

> 给 auriga-cli 一条「装对的默认」的命令与菜单入口:`--preset` 一键装工作流核心,并把已经空掉的 hooks 安装表面彻底清理掉。

## Why (为什么做)

auriga-cli 的安装重心已经从 skills 转移到 `auriga-workflow` 插件——10 个内部工作流 skill 现在打包在该插件里。但安装入口没跟上:今天要装齐「工作流核心」(CLAUDE.md/AGENTS.md + auriga-workflow 插件 + 默认工作流 skill),非交互下要敲三条命令;`--all` 虽然一条命令,却把 auriga-notify、外部插件等全都带上,粒度太粗,而且它自己还排除 recommended skills,「全装」名不副实。缺一个「正好装工作流核心」的入口。

同时,hooks 安装表面已经是死表面:`dist/catalog.json` 的 `hooks` 字段是空数组,所有仓库自有 hook 都改为随插件分发。但 CLI 的 `install hooks` 子命令、交互菜单的 Hooks 类目、Web UI 的 hooks 卡片、guide SOP 里的 hooks 行仍然存在,是一组没有任何内容、却仍占据用户注意力的空入口。

这次把两件事一起做:补上「推荐预设」这个对的默认入口,清掉 hooks 这个空入口,并让 `--all` 回归真正的「全装」语义。

## Findings (调研发现)

- `src/cli.ts` 的 `parseArgs`:`--all` 是原子标志(报错信息 `--all is atomic; no extra types or filters allowed`),且 §3.2 明确 `--all` 安装范围为 workflow+skills+plugins+hooks、**不含 recommended**。
- `WORKFLOW_SKILLS`(`src/skills.ts`)固定为 5 个:`planning-with-files`、`playwright-cli`、`systematic-debugging`、`test-driven-development`、`verification-before-completion`。
- `dist/catalog.json` 的 `hooks` 字段当前为空数组 `[]`——没有任何 hook 通过 CLI 分发。
- 交互菜单 `runLegacyMenu`(`src/cli.ts`)是单个 checkbox,5 个类目(Workflow / Skills / Recommended / Plugins / Hooks)全部 `checked: true`。
- `auriga-workflow` 插件目标 Agent 为 Claude Code + Codex,并自带 git 守卫 hook;`auriga-cli` 提供的 6 个插件里,它之外还有 `auriga-notify`、`skill-creator`、`claude-md-management`、`codex`、`session-instructions-loader`。
- `src/guide.ts` 输出的 Agent bootstrap SOP:Step 2 列出 `install hooks --help`,Step 3 推荐 `install --all` 作为预设、并描述「legacy hooks category is currently empty」。
- `docs/architecture/install-subcommand.md` §3.2 把 `hooks` 列为合法 `<type>`,§3.3 给出 `install hooks` 示例。
- Web UI:`src/state.ts` / `src/scan-catalog.ts` / `src/api-types.ts` / `ui/` 仍按类目展示状态,hooks 是其中一类。
- `src/hooks.ts` 的外部消费者仅两处:`src/cli.ts`(`installHooks`)与 `src/apply-handlers.ts`(`installHook` / `loadHooksConfig` / `uninstallHook`);`plugins.ts` 的 auriga-notify legacy 迁移自带一套 settings 清理逻辑(`plugins.ts:473-509`),**不依赖 `hooks.ts`**——因此移除 hooks 安装表面不会波及 auriga-notify 迁移。

## What (做什么)

### 1. 新增 `--preset` 安装入口

- `npx auriga-cli install --preset` 一次安装「工作流核心」:workflow 文档(CLAUDE.md + AGENTS.md)+ `auriga-workflow` 插件 + 全部 5 个 `WORKFLOW_SKILLS` 工作流 skill。
- `--preset` 是**原子标志**:不能与 `<type>` 位置参数或任何子项过滤(`--skill` / `--plugin` / `--recommended-skill`)同时出现,违反时报参数错误并以 exit 1 退出。
- `--preset` 接受 `--scope`、`--agent`、`--lang` 三个修饰标志,且**默认值与分类安装不同**:
  - `--scope` 默认 `user`(分类安装默认 `project`)
  - `--agent` 默认 `both`(= Claude Code + Codex;分类安装 plugins 默认 `claude`)
  - `--lang` 默认 `en`
- `--preset` 与 `--all` 一样具备分级退出码:全部成功 exit 0,致命错误 exit 1,部分类别失败 exit 2 且 stderr 列出失败类别。

### 2. `--all` 回归「全装」语义

- `install --all` 改为纳入 recommended skills,真正安装「全部内容」。hooks 不在其中(见 §3,已移除)。

### 3. 移除 hooks 安装表面

- `install hooks` 不再是合法命令;`hooks` 不再是合法 `<type>`;`--hook` 过滤标志不再被接受。传入这些一律报参数错误、exit 1。
- 构建产物目录(`dist/catalog.json`)不再有 hooks 类目。
- `--help`(顶层与 per-type)、`guide` SOP、`docs/architecture/install-subcommand.md` 不再出现 hooks 相关内容。
- Web UI 不再展示 hooks 卡片;`/api/state` 响应、`/api/apply` 请求不再涉及 hooks 类目。
- 本次不主动卸载用户在更早版本中已安装的 legacy hooks(见 Out of scope)。

### 4. 交互菜单(TUI)重构为 3 项

- `npx auriga-cli`(无参)/ `install`(TTY)进入的 checkbox 菜单从 5 项重构为 3 项,顺序固定:
  1. **推荐预设** —— 置顶,默认勾选。选中即执行 §1 定义的预设安装,**静默采用默认参数(scope=user、agent=both、lang=en),不就地询问**;菜单项标签标明这些默认值,使用户知情。要精调参数走非交互 CLI。
  2. **选装 skill** —— recommended skills(选装工具类 skill)。默认不勾选。
  3. **其他插件** —— `auriga-workflow` 以外的全部插件,即 `auriga-notify`、`skill-creator`、`claude-md-management`、`codex`、`session-instructions-loader` 共 5 个。默认不勾选。
- Workflow、Skills、Hooks 不再作为独立菜单项:前两者被「推荐预设」吸收,Hooks 随 §3 移除。
- 勾选「选装 skill」或「其他插件」后,仍像现状一样下钻到该类目的逐项子勾选。

### 5. Web UI 新增一键预设、移除 hooks 卡片

- 仪表盘移除 hooks 卡片。
- 仪表盘顶部新增「安装推荐预设」按钮;按钮旁提供 scope / agent / lang 三个参数控件,默认值为 user / both / en。点击按钮即按当前控件值执行 §1 定义的预设安装;安装完成后,预设覆盖的类目状态如实更新为已安装。

### 6. guide 子命令推荐 `--preset`

- `guide` 输出的 Agent bootstrap SOP 把推荐安装方式改为 `npx -y auriga-cli install --preset`,作为 Agent 的默认安装路径。
- SOP 不再出现 `install hooks` 相关行。

### 7. 配套文档与版本

- `--help` 顶层输出与各 per-type help 反映新命令表面(含 `--preset`,`--all` 含 recommended,无 hooks)。
- `README.md` 与 `README.zh-CN.md` 双语同步描述 `--preset`。
- `docs/architecture/install-subcommand.md` 回写新命令表面。
- CLI 版本号(`package.json`)bump。

## Out of scope (本次不做)

- **不主动卸载**用户在更早版本里已安装的 legacy hooks——只移除「未来还能装 hooks」这个表面,不动用户磁盘上的既有产物。
- 不改 `auriga-workflow` 插件自身内容(它打包的 skill 与 git 守卫 hook 不变)。
- 不改底层安装机制(`npx skills`、`claude plugins`、`codex plugin`)。
- 不改 `WORKFLOW_SKILLS` 与 recommended skills 的成员构成。
- 预设成员固定为「workflow 文档 + auriga-workflow 插件 + 5 个 WORKFLOW_SKILLS」,不做用户可配置的自定义预设。
- 不引入新的非交互多类别组合语法;`--preset` 与 `--all` 仍是各自原子。

## Open questions (悬而未决)

澄清期的 4 个 open question 已在 spec 评审中全部定案,结论已并入上方 Findings 与 What 各节:

1. **(已定)** TUI 选中「推荐预设」静默采用默认参数(user/both/en),不就地询问;菜单项标签标明默认值。见 What §4。
2. **(已定)** Web UI「安装推荐预设」按钮旁提供 scope/agent/lang 参数控件,默认 user/both/en。见 What §5。
3. **(已定)** 「其他插件」包含 `session-instructions-loader`,即等于 `auriga-workflow` 以外的全部插件。见 What §4。
4. **(已定)** `src/hooks.ts` 的外部消费者仅 `cli.ts` 与 `apply-handlers.ts`,auriga-notify 迁移不依赖它,可干净删除;删除边界已明确。见 Findings。

## References (参考资料)

无外链。本 spec 的依据均为仓库内文件,已在 Findings 中逐条锚定。
