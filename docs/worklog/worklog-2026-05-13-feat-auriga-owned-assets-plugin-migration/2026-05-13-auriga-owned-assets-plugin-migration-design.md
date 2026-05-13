# auriga 自维护资产插件化迁移设计

> Status: active spec
> Date: 2026-05-13
> Scope: 将本仓库自维护的三个 workflow skill 和 `notify` hook 迁移为插件。

## Scope Triage

scope triage -> full path: 迁移覆盖两个安装模型和两个不同插件形态，会改变公开安装行为、catalog 分类、Web UI 状态展示、默认安装集合、legacy 清理和本仓库开发期发现路径；不适合 Quick Development Flow。

## 背景

auriga-cli 现在同时维护三种安装模型：

- `skills-lock.json` + `.agents/skills/` / `.claude/skills/`：传统 skill 安装模型。
- `.claude/hooks/hooks.json` + `.claude/hooks/<name>/`：传统 hook 安装模型。
- `plugins/<name>/` + `.claude-plugin/marketplace.json` + `.agents/plugins/marketplace.json`：插件模型。

当前仍在传统模型里的本仓库自维护资产有两类。

第一类是根目录 `skills/` 下的三个 workflow skill：

- `incremental-impl`
- `session-compound`
- `test-designer`

它们通过 `.agents/skills/<name>` 和 `.claude/skills/<name>` 符号链接暴露给本仓库内的 Agent，同时通过 `skills-lock.json` 暴露给 `npx auriga-cli install skills`。

第二类是 `.claude/hooks/notify`：

- `notify` 是 macOS 原生通知 hook。
- 当前在 `.claude/hooks/hooks.json` 中 `defaultOn: false`，需要显式选择。
- 它有用户可定制的 `config.json` 和 `icon.png`，传统 installer 会保留这两个文件。

目标是把这些本仓库自维护资产的产品分发形态统一到插件系统，减少并行安装模型。外部来源的 workflow / recommended skills 不在本次迁移范围内。

## Decision

采用两个插件：

1. 新增双端插件 `auriga-workflow-skills`，聚合三个自维护 workflow skill。
2. 新增 Claude Code-only 插件 `auriga-notify`，承载 `Notification` hook、通知脚本和默认资产。

`auriga-workflow-skills` 默认安装，延续三个 workflow skill 以前属于 default-on set 的语义。

`auriga-notify` 保持 opt-in，不进入 `install --all` 的默认安装集合。用户需要显式执行 `install plugins --plugin auriga-notify`，或在交互式 / Web UI 中单独选择。

## Alternatives Considered

### Workflow skills: 一个聚合插件

优点：

- 安装入口少，用户只需要理解一个插件。
- 三个 skill 都是 auriga workflow 的执行期能力，边界一致。
- 未来如果新增自维护 workflow skill，可以继续放进同一个插件。

缺点：

- 不能独立安装其中某一个 skill。

结论：选择。当前目标是简化分发模型，不是提供最细粒度的安装菜单。

### Workflow skills: 三个 skill 各自一个插件

优点：

- 粒度最细，版本可以独立演进。

缺点：

- 插件列表变吵，用户需要理解三个内部工具的区别。
- `.claude/plugins.json`、`.agents/plugins/install.json` 和 README 表格都会增加重复维护面。

结论：拒绝。对当前仓库来说过度设计。

### Workflow skills: 并入 `auriga-go`

优点：

- 最少新增一个插件。

缺点：

- `auriga-go` 是 workflow navigator；这三个 skill 是执行阶段工具。
- 合并后插件职责变大，后续维护和说明会变模糊。

结论：拒绝。保持导航器和执行工具分离。

### Notify: 继续保留传统 hook

优点：

- 代码改动最少。
- 现有配置保留逻辑不用迁移。

缺点：

- 继续保留并行 hook 安装模型，违背本次目标。
- `notify` 作为本仓库自维护 hook，仍然要走一套与其它插件 hook 不同的发布和扫描路径。

结论：拒绝。`notify` 也迁移到插件。

### Notify: 并入现有插件

优点：

- 少一个插件条目。

缺点：

- `notify` 是个人注意力提醒工具，不属于 `auriga-git-guards`、`auriga-go` 或 `deep-review` 的职责。
- `notify` 有 macOS 平台限制、Homebrew 可选依赖和用户配置迁移，放进现有插件会污染边界。

结论：拒绝。单独建 `auriga-notify`。

## In Scope

- 新增 `plugins/auriga-workflow-skills/` 作为三个自维护 workflow skill 的 source of truth。
- 新增 `plugins/auriga-notify/` 作为通知 hook 的 source of truth。
- 将根目录 `skills/` 下三个 skill 的内容迁入 `auriga-workflow-skills`。
- 将 `.claude/hooks/notify` 的运行脚本、测试脚本、默认配置、默认图标和 README 迁入 `auriga-notify`。
- 在 Claude Code marketplace 中注册两个插件。
- 在 Codex marketplace 中只注册 `auriga-workflow-skills`。
- 更新 auriga-cli 的插件安装列表，使 `install plugins` 和 `install --all` 通过插件安装默认能力。
- 为 `.claude/plugins.json` 增加 `defaultOn?: boolean`，让 `auriga-notify` 保持 opt-in。
- 从 `skills-lock.json` 和 `WORKFLOW_SKILLS` 中移除三个 self-owned skill。
- 从 `.claude/hooks/hooks.json` 中移除 `notify`，或保留空 registry 以维持 `install hooks` 命令兼容。
- 保留本仓库开发期发现能力：`.agents/skills/<name>` 和 `.claude/skills/<name>` 继续作为符号链接存在，但目标必须指向 `plugins/auriga-workflow-skills/skills/<name>`。
- 增加 legacy cleanup，避免旧 standalone skill / hook 与插件内同名能力长期并存。
- 更新 README、中文 README 和 `.claude/CLAUDE.md` 中的作者入口与数据源说明。

## Out of Scope

- 外部来源的 workflow skills，例如 `brainstorming`、`systematic-debugging`、`test-driven-development`、`verification-before-completion`。
- recommended skills，例如 `codex-agent`、`claude-code-agent`。
- 将 `auriga-notify` 做成 Codex 插件。当前 `notify` 依赖 Claude Code 的 `Notification` 事件；没有验证过 Codex 侧等价事件。
- 更改 root `CLAUDE.md` 的 workflow contract。三个 skill 名称保持不变，workflow 步骤仍引用同名能力。
- 移除 `install skills`、`install recommended`、`install hooks` 这些命令类别。它们仍作为外部 skill / legacy hook 兼容路径保留。

## Plugin Layout

### `auriga-workflow-skills`

```text
plugins/auriga-workflow-skills/
  .claude-plugin/plugin.json
  .codex-plugin/plugin.json
  README.md
  skills/
    incremental-impl/SKILL.md
    session-compound/SKILL.md
    session-compound/template.html
    session-compound/analyzers/*.mjs
    test-designer/SKILL.md
```

该插件不包含 hooks。

### `auriga-notify`

```text
plugins/auriga-notify/
  .claude-plugin/plugin.json
  README.md
  hooks/hooks.json
  scripts/notify.mjs
  scripts/test-notify.mjs
  defaults/config.json
  assets/icon.png
```

该插件只注册 Claude Code `Notification` hook。脚本运行时继续在非 macOS 平台静默退出。

## Install Behavior

### Plugin default selection

扩展 `.claude/plugins.json` schema：

```ts
interface PluginDef {
  name: string;
  package: string;
  description: string;
  marketplace?: MarketplaceRef;
  defaultOn?: boolean;
}
```

选择规则与 Codex 插件 install list 对齐：

- `selected === undefined`：只安装 `defaultOn !== false` 的插件。
- `selected === ["*"]`：安装全部插件，包括 opt-in 插件。
- 显式 `--plugin <name>`：只安装指定插件，即使它是 `defaultOn: false`。

`auriga-workflow-skills` 不设置 `defaultOn`，默认安装。

`auriga-notify` 设置 `defaultOn: false`，默认不安装。

`src/build/generate-catalog.ts` 对 opt-in 插件描述加 `(opt-in)` 前缀，和现有 hook catalog 行为保持一致。

### Claude Code

`.claude-plugin/marketplace.json` 增加两个插件。

`.claude/plugins.json` 增加：

```json
{
  "name": "auriga-workflow-skills",
  "package": "auriga-workflow-skills@auriga-cli",
  "description": "Bundles the auriga-owned workflow execution skills: incremental-impl, test-designer, and session-compound.",
  "marketplace": {
    "name": "auriga-cli",
    "source": "Ben2pc/auriga-cli"
  }
}
```

```json
{
  "name": "auriga-notify",
  "package": "auriga-notify@auriga-cli",
  "description": "Opt-in macOS native notification hook for Claude Code Notification events.",
  "defaultOn": false,
  "marketplace": {
    "name": "auriga-cli",
    "source": "Ben2pc/auriga-cli"
  }
}
```

### Codex

`.agents/plugins/marketplace.json` 增加 `auriga-workflow-skills`。

`.agents/plugins/install.json` 增加 `auriga-workflow-skills` install entry。

Codex install 启用：

```toml
[plugins."auriga-workflow-skills@auriga-cli"]
enabled = true
```

`auriga-workflow-skills` 不包含 hooks，因此不需要打开 `features.plugin_hooks`。

`auriga-notify` 不进入 `.agents/plugins/marketplace.json` 或 `.agents/plugins/install.json`。

### `install skills`

`install skills` 继续服务外部 workflow skills，但不再安装三个本仓库自维护 skill。

`install recommended` 不变。

### `install hooks`

迁移后默认没有 repo-owned traditional hook 要安装。为了兼容命令表面，`install hooks` 可以继续存在，并在 registry 为空时输出 no hooks。

## Legacy Cleanup

### Workflow skill cleanup

插件安装后，如果用户项目里已经有旧 standalone skill 目录，运行时可能出现同名 skill 的两份来源。实现需要提供窄范围迁移清理：

- 只清理 `incremental-impl`、`session-compound`、`test-designer` 三个名字。
- 只清理 auriga-cli 当前 install 目标 scope 对应的位置。
- project scope：清理 `<cwd>/.claude/skills/<name>` 和 `<cwd>/.agents/skills/<name>`。
- user scope：清理 `~/.claude/skills/<name>` 和 `~/.agents/skills/<name>`。
- 清理前不触碰外部 skill，也不删除用户自定义的其它 skill。
- 非交互安装要打印清理摘要；Web UI apply 日志要能显示清理动作。

Codex 插件启用本身是 user-level，但 skill cleanup 仍应遵守 `--scope` 参数；缺省按 project scope 清理，因为旧 `install skills` 的默认 scope 也是 project。

### Notify cleanup and config migration

`notify` 插件安装成功后，需要迁移旧传统 hook 的用户配置，然后移除旧 hook 注册，避免重复通知。

旧位置：

- project scope：`<cwd>/.claude/hooks/notify/`
- user scope：`~/.claude/hooks/notify/`

新配置位置：

- project scope：`<cwd>/.claude/auriga-notify/`
- user scope：`~/.config/auriga-cli/notify/`

迁移规则：

- 如果旧 `config.json` 存在且新位置没有 `config.json`，复制过去。
- 如果旧 `icon.png` 存在且新位置没有 `icon.png`，复制过去。
- 如果新位置已有文件，保留新位置，不覆盖。
- 从对应 scope 的 settings file 中移除 marker `auriga:notify`。
- 删除旧 `.claude/hooks/notify/` 目录。
- 不删除新配置目录。

运行时配置查找顺序：

1. `AURIGA_NOTIFY_CONFIG` 指向的 JSON 文件。
2. `<cwd>/.claude/auriga-notify/config.json`。
3. `~/.config/auriga-cli/notify/config.json`。
4. 插件内 `defaults/config.json`。

图标解析规则：

- 如果配置中的 `icon` 是绝对路径，直接使用。
- 如果配置来自 project / user 配置文件，相对路径相对该配置文件所在目录。
- 如果配置来自插件默认文件，相对路径相对插件 root。
- 找不到图标时退回插件内 `assets/icon.png`。

## Catalog and Web UI

迁移后 catalog 语义：

- `workflowSkills` 不再包含 `incremental-impl`、`session-compound`、`test-designer`。
- `hooks` 不再包含 `notify`。
- `plugins` 包含 `auriga-workflow-skills`，并标记 `agents: ["claude", "codex"]`。
- `plugins` 包含 `auriga-notify`，并标记 `agents: ["claude"]`，描述带 `(opt-in)` 前缀。
- Web UI 中这三个 skill 不再作为独立 workflow skill 卡片出现。
- Web UI 中 `notify` 不再作为 hook 卡片出现；它作为 opt-in plugin 出现。

`src/build/generate-catalog.ts` 仍从 `.claude/plugins.json` 和 `.agents/plugins/install.json` 烘焙 plugin agent map 到 `dist/catalog.json`。运行时不要从 `plugins/<name>/` 读取数据，因为 npm tarball 不包含该目录。

## Compatibility

- 已经安装到用户项目中的旧 standalone skill 不会在扫描时被列为需要升级；安装 `auriga-workflow-skills` 是迁移路径，安装成功后执行窄范围 cleanup。
- 已经安装到用户项目中的旧 `notify` hook 不会在扫描时被列为需要升级；安装 `auriga-notify` 是迁移路径，安装成功后迁移配置并清理旧 hook 注册。
- 迁移清理只在安装请求包含对应插件时触发；未选中该插件的其它 plugin 安装不能清理旧 skill / hook 目录。
- 保留 `install skills`、`install recommended` 和 `install hooks` 命令类别，避免外部 skill 和 legacy hook 路径回归。
- 本仓库开发期可以保留 `.agents/skills` 和 `.claude/skills` 符号链接，但 source of truth 必须是插件目录。

## Acceptance Criteria

- `npm run build` 生成的 `dist/catalog.json` 中：
  - `workflowSkills` 不包含三个迁移 skill。
  - `hooks` 不包含 `notify`。
  - `plugins` 包含 `auriga-workflow-skills`，`agents` 为 `["claude", "codex"]`。
  - `plugins` 包含 `auriga-notify`，`agents` 为 `["claude"]`，描述标明 opt-in。
- `npx auriga-cli install plugins --plugin auriga-workflow-skills --agent both` 会尝试安装 Claude Code 和 Codex 两侧插件。
- `npx auriga-cli install plugins --plugin auriga-notify --agent claude` 会安装 Claude Code 插件，并迁移 legacy notify 配置。
- `npx auriga-cli install --all --agent both` 会通过插件路径安装三个 workflow skill，但不会默认安装 `auriga-notify`。
- `npx auriga-cli install plugins --plugin '*' --agent claude` 会包含 `auriga-notify`。
- 旧 standalone skill 的同名目录会按 scope 被清理，且不会清理外部 skills。
- 旧 notify hook 的 `config.json` / `icon.png` 会按 scope 迁移，且不会覆盖新位置已有文件。
- 旧 notify hook 的 settings marker 会被移除，避免重复通知。
- `install skills` 和 `install recommended` 的外部 skill 路径不回归。
- Web UI 状态扫描不再把三个自维护 skill 展示为独立 workflow skill，也不再把 `notify` 展示为 hook。
- `npm test`、`npm run test:git-guards`、`npm run test:session-instructions-loader`、`npm run test:e2e` 通过。
- 若改动影响 Web UI 状态或 catalog 输入，按 `.claude/CLAUDE.md` 的 Web UI manual verification 要求额外验证三种 project root。

## Implementation Plan

1. Tests first:
   - catalog test：锁定三个 skill 从 workflowSkills 消失，`notify` 从 hooks 消失，两个新插件出现在 plugins，agent map 正确。
   - plugin installer test：锁定 plugin `defaultOn` 选择语义，尤其 `auriga-notify` 默认跳过、`*` 和显式选择会安装。
   - workflow skill cleanup test：锁定只清理三个 legacy skill 名称，不触碰外部 skill。
   - notify migration test：锁定 config/icon 复制、不覆盖、旧 marker 删除、旧目录清理。
   - Web UI / state test：锁定状态报告不再出现三个 standalone workflow skill 和 legacy notify hook。
2. Move workflow skill source:
   - 创建 `plugins/auriga-workflow-skills/`。
   - 搬迁三个 skill 文件。
   - 保留 `.agents/skills` 和 `.claude/skills` 作为本仓库开发期符号链接，并把目标改到插件内的 `skills/<name>`。
3. Move notify source:
   - 创建 `plugins/auriga-notify/`。
   - 搬迁 `notify` 运行脚本、测试脚本、README、默认配置和默认图标。
   - 调整脚本配置查找逻辑，支持 project / user 配置位置。
4. Register plugins:
   - 更新 `.claude-plugin/marketplace.json`。
   - 更新 `.claude/plugins.json`，并为 `auriga-notify` 设置 `defaultOn: false`。
   - 更新 `.agents/plugins/marketplace.json`，只加入 `auriga-workflow-skills`。
   - 更新 `.agents/plugins/install.json`，只加入 `auriga-workflow-skills`。
5. Remove standalone catalog exposure:
   - 从 `skills-lock.json` 移除三个 owned skill。
   - 从 `WORKFLOW_SKILLS` 移除三个名字。
   - 从 `.claude/hooks/hooks.json` 移除 `notify` 或改为空 registry。
   - 更新相关 tests、README 和 `.claude/CLAUDE.md`。
6. Add legacy cleanup:
   - 在安装 `auriga-workflow-skills` 成功后执行 skill cleanup。
   - 在安装 `auriga-notify` 成功后执行 notify config migration + cleanup。
   - Web UI apply path 复用同一逻辑。
7. Verification:
   - `npm run build`
   - `npm test`
   - `npm run test:git-guards`
   - `npm run test:session-instructions-loader`
   - `npm run test:e2e`
   - 如触发 Web UI 条件，再执行手动 Web UI 状态验证。

## Release Notes

这是用户可见安装行为变更，应 bump `package.json` CLI 版本。建议使用 minor bump，因为默认 harness 组成方式改变，但 skill 名称和 workflow contract 保持兼容。

`auriga-workflow-skills` 插件版本从 `1.0.0` 开始。后续修改三个 bundled skill 的运行合同，应 bump 该插件 manifest version；若该修改也影响 auriga-cli catalog 或默认安装行为，同时 bump CLI version。

`auriga-notify` 插件版本从 `1.0.0` 开始。后续修改通知脚本行为、配置 schema、默认资产或 hook 注册，应 bump 该插件 manifest version；若该修改也影响 auriga-cli catalog 或默认安装行为，同时 bump CLI version。

Root `CLAUDE.md` workflow header 不需要因为本次迁移单独 bump，除非实现阶段改动 workflow 步骤合同。
