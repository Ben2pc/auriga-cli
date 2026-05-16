# Validation Contract — Preset Install (验收契约 — 推荐预设安装)

> Pairs with spec.md. spec.md = why+what; this file = how-to-judge-pass.
> 与 spec.md 配套:spec.md 描述 why+what;本文件描述 "什么算通过"。
> Each VAL describes Behavior + Tool + Evidence only. Test design (function organization, fixtures, mocks) is `test-designer`'s job.
> 每条 VAL 只描述 Behavior + Tool + Evidence;测试设计 (函数组织 / fixture / mock) 是 `test-designer` 的活。

## Coverage map (覆盖矩阵)

| Range (范围) | VAL ids |
|---|---|
| `--preset` 非交互行为 | VAL-CLI-001 ~ 008 |
| `--all` 语义变更 | VAL-CLI-009 |
| hooks 安装表面移除 | VAL-CLI-010 ~ 012、VAL-CAT-001 |
| `--help` 输出 | VAL-HELP-001 ~ 002 |
| 交互菜单 (TUI) | VAL-TUI-001 ~ 005 |
| Web UI | VAL-WEB-001 ~ 005 |
| guide 子命令 | VAL-GUIDE-001 ~ 002 |
| 配套文档与版本 | VAL-DOC-001 ~ 002、VAL-VER-001 |

## Assertions (断言)

### VAL-CLI-001
- **Behavior (行为)**: `install --preset` 安装完成后,workflow 文档、`auriga-workflow` 插件、全部 5 个 `WORKFLOW_SKILLS` 工作流 skill 三者都已落地。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: 命令 exit 0;目标环境出现 CLAUDE.md 与 AGENTS.md;`auriga-workflow` 插件在已安装列表中;5 个工作流 skill 全部出现在已安装 skill 集合中。

### VAL-CLI-002
- **Behavior (行为)**: `install --preset` 不带 `--scope` 时,安装范围为 `user`。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: 安装产物落在 user 全局范围(skill 走全局、plugin 走 `--scope user`),而非当前项目目录。

### VAL-CLI-003
- **Behavior (行为)**: `install --preset` 不带 `--agent` 时,`auriga-workflow` 插件同时对 Claude Code 与 Codex 两个 Agent 安装。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: 安装后 Claude 侧与 Codex 侧均能见到 `auriga-workflow` 插件已启用。

### VAL-CLI-004
- **Behavior (行为)**: `install --preset` 不带 `--lang` 时,安装的 workflow 文档为英文版。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: 落地的 CLAUDE.md 内容与英文模板一致(而非 zh-CN 模板)。

### VAL-CLI-005
- **Behavior (行为)**: `install --preset` 接受 `--scope` / `--agent` / `--lang` 覆盖各自默认值。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: 例如 `--preset --scope project --lang zh-CN` 后,产物落在项目范围且 CLAUDE.md 为中文版。

### VAL-CLI-006
- **Behavior (行为)**: `--preset` 与位置参数 `<type>` 同时出现时被拒绝。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: 命令 exit 1,stderr 给出参数互斥错误信息。

### VAL-CLI-007
- **Behavior (行为)**: `--preset` 与任一子项过滤标志(`--skill` / `--plugin` / `--recommended-skill`)同时出现时被拒绝。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: 命令 exit 1,stderr 给出参数互斥错误信息。

### VAL-CLI-008
- **Behavior (行为)**: `install --preset` 在部分类别安装失败时返回分级退出码并标明失败类别。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: 出现部分失败时 exit 2,stderr 列出失败的类别;全部成功时 exit 0。

### VAL-CLI-009
- **Behavior (行为)**: `install --all` 现在把 recommended skills 也纳入安装范围。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: `install --all` 完成后,recommended skills 出现在已安装 skill 集合中。

### VAL-CLI-010
- **Behavior (行为)**: `install hooks` 不再是合法命令。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: 执行 `install hooks` 以 exit 1 退出,stderr 给出「未知/非法类别」类参数错误。

### VAL-CLI-011
- **Behavior (行为)**: `--hook` 过滤标志不再被接受。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: 任何带 `--hook` 的 `install` 调用以 exit 1 退出并报参数错误。

### VAL-CLI-012
- **Behavior (行为)**: 移除 hooks 后,所有既有合法命令形式(交互菜单除外)的解析与安装行为不回归。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: `install --all`、`install workflow|skills|recommended|plugins`、各子项过滤形式仍按各自契约成功执行。

### VAL-CAT-001
- **Behavior (行为)**: 构建产物 catalog 不再包含 hooks 类目。
- **Tool (工具)**: build
- **Evidence (判据)**: `npm run build` 产出的 `dist/catalog.json` 不含 `hooks` 键。

### VAL-HELP-001
- **Behavior (行为)**: 顶层 `--help` 输出描述 `--preset` 用法,且不出现 hooks 类目。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: `--help` stdout 含 `--preset` 用法行;不含 `install hooks` 或 hooks 类目条目。

### VAL-HELP-002
- **Behavior (行为)**: 不存在 `install hooks --help` 这一 per-type help。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: `install hooks --help` 以 exit 1 退出报参数错误;`install workflow|skills|recommended|plugins --help` 仍正常输出。

### VAL-TUI-001
- **Behavior (行为)**: 交互菜单恰好提供 3 个选项:推荐预设、选装 skill、其他插件。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 菜单选项集合等于这 3 项,不含 Workflow / Skills / Hooks 独立项。

### VAL-TUI-002
- **Behavior (行为)**: 「推荐预设」是菜单首项且默认勾选;另两项默认不勾选。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 选项顺序中「推荐预设」居首,其 checked 为真,「选装 skill」「其他插件」checked 为假。

### VAL-TUI-003
- **Behavior (行为)**: 在菜单中选择「推荐预设」执行的安装内容等于 `--preset` 预设(workflow 文档 + auriga-workflow 插件 + 5 个工作流 skill)。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 选中该项后触发的安装动作覆盖且仅覆盖预设三类成员。

### VAL-TUI-004
- **Behavior (行为)**: 选择「选装 skill」或「其他插件」后,进入该类目的逐项子勾选。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 「选装 skill」下钻为 recommended skills 子选择;「其他插件」下钻为 `auriga-workflow` 以外插件的子选择。

### VAL-TUI-005
- **Behavior (行为)**: 「其他插件」子选择列表不含 `auriga-workflow`。
- **Tool (工具)**: integration-test
- **Evidence (判据)**: 该子选择集合为 auriga-cli 提供的全部插件去掉 `auriga-workflow` 后的余集。

### VAL-WEB-001
- **Behavior (行为)**: Web UI 仪表盘不再显示 hooks 卡片。
- **Tool (工具)**: e2e-browser
- **Evidence (判据)**: 仪表盘渲染后页面上无 hooks 类目卡片。

### VAL-WEB-002
- **Behavior (行为)**: Web UI 仪表盘顶部存在「安装推荐预设」一键按钮。
- **Tool (工具)**: e2e-browser
- **Evidence (判据)**: 仪表盘渲染后顶部可见该按钮且可点击。

### VAL-WEB-003
- **Behavior (行为)**: 点击「安装推荐预设」执行预设安装,完成后预设覆盖的类目状态更新为已安装。
- **Tool (工具)**: e2e-browser
- **Evidence (判据)**: 点击并等待完成后,workflow / auriga-workflow 插件 / 工作流 skill 对应卡片状态变为已安装。

### VAL-WEB-004
- **Behavior (行为)**: `/api/state` 响应不再包含 hooks 类目。
- **Tool (工具)**: http-probe
- **Evidence (判据)**: `/api/state` 返回的 JSON 中无 hooks 类目字段。

### VAL-WEB-005
- **Behavior (行为)**: 「安装推荐预设」按钮旁提供 scope / agent / lang 参数控件(默认 user / both / en),预设安装按控件当前值执行。
- **Tool (工具)**: e2e-browser
- **Evidence (判据)**: 三个控件可见且初始为默认值;改动控件值后点击按钮,实际安装的 scope / agent / lang 与控件所选一致。

### VAL-GUIDE-001
- **Behavior (行为)**: `guide` 输出推荐 `install --preset` 作为安装方式。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: `guide` stdout 含 `install --preset` 命令行。

### VAL-GUIDE-002
- **Behavior (行为)**: `guide` 输出不再出现 `install hooks` 相关内容。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: `guide` stdout 不含 `install hooks` 字样及 hooks per-type help 行。

### VAL-DOC-001
- **Behavior (行为)**: `README.md` 与 `README.zh-CN.md` 均描述 `--preset`,且均不再描述 hooks 安装表面。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 两份 README 都含 `--preset` 说明;都不含 `install hooks` 安装指引。

### VAL-DOC-002
- **Behavior (行为)**: `docs/architecture/install-subcommand.md` 反映新命令表面。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 该文档含 `--preset` 形式、`--all` 含 recommended 的说明;不再把 `hooks` 列为合法 `<type>`。

### VAL-VER-001
- **Behavior (行为)**: CLI 版本号相对上一发布版本完成 bump。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: `package.json` 的 `version` 高于上一已发布版本。
