# Web UI Scanner 真值源重构（v1.16.1 hotfix）

## 背景与问题

v1.16.0 的 Web UI scanner 把 auriga-cli **本仓库 dev 布局**当成 Claude Code 真实的安装位置：

| 类目 | v1.16.0 读取路径（错） | Claude Code 实际安装位置 |
|---|---|---|
| Workflow | `<cwd>/CLAUDE.md`（部分对） | `<scope>/CLAUDE.md` 或 `<scope>/.claude/CLAUDE.md`（user scope 走 `~/.claude/CLAUDE.md`） |
| Skills | `<cwd>/skills-lock.json` | `<scope>/.claude/skills/<name>/SKILL.md` 文件系统 |
| Plugins (Claude) | `claude plugins list --available --json`（真值源对，但 PATH 假设错） | 同 + 区分 user / project scope |
| Plugins (Codex) | `~/.codex/config.toml` + `~/.codex/plugins/cache/`（已对） | 同（Codex 设计上 user-scope only） |
| Hooks | `<cwd>/.claude/hooks/hooks.json`（auriga-cli 注册表，不是 Claude Code 安装态） | `<scope>/.claude/settings.json` 的 `hooks` 段 + `_marker` 匹配 |

结果：用户在自己的项目（任何普通 repo）或者 `~/` 跑 `npx auriga-cli web-ui`，scanner 全部判定「not installed」—— 因为普通项目根本不会有 `<cwd>/.claude/plugins.json`、`<cwd>/skills-lock.json`、`<cwd>/.claude/hooks/hooks.json` 这些 auriga-cli dev 仓库特有的文件。

本次重构把 scanner 的真值源替换为 Claude Code 的实际安装位置，**user 和 project 两个 scope 都修**。

## 真值源映射（最终态）

### Workflow

| Scope | 真值文件 | 检测逻辑 |
|---|---|---|
| User | `~/.claude/CLAUDE.md` | 文件存在 → `installed`；`grep` 出 auriga 标记行（如 `# auriga Workflow (v<x>)`）→ 提取版本号并与 catalog 比较 |
| Project | `<proj>/CLAUDE.md`（首选）或 `<proj>/.claude/CLAUDE.md`（备选） | 同上；`AGENTS.md` 软链不影响判定 |

### Skills

| Scope | 真值目录 | 检测逻辑 |
|---|---|---|
| User | `~/.claude/skills/<name>/SKILL.md` | 目录存在且 `SKILL.md` 可读 → `installed`；读 `SKILL.md` frontmatter `version`（或对 SKILL.md 内容做 sha256）与 catalog 比较，缺/不一致 → `update-available` 或 `installed` |
| Project | `<proj>/.claude/skills/<name>/SKILL.md` | 同上 |

废弃 `skills-lock.json` 作为安装态来源；它仅在 `npx skills` 的 dev 流程中是真值源，但**普通用户没有这个文件**。

### Plugins（Claude）

| Scope | 真值源 | 检测逻辑 |
|---|---|---|
| User | `claude plugins list --user --json` + `~/.claude/settings.json` 的 `enabledPlugins` 对账 | 落 `installed`/`update-available`/`not-installed` 三态 |
| Project | `claude plugins list --project --json` + `<proj>/.claude/settings.json` 的 `enabledPlugins` 对账 | 同 |

`claude` 不在 PATH 时：保留现有降级路径（degraded row + warning），不改。

### Plugins（Codex）

只有 user scope（Codex 没有 project-scope plugin）。现状已对，本次仅微调：把 `codex` CLI 不在 PATH 的提示文案统一。

### Hooks

| Scope | 真值文件 | 检测逻辑 |
|---|---|---|
| User | `~/.claude/settings.json` 的 `hooks.<Event>[]` 段 | 用 catalog 里登记的 `marker`（`_marker` sentinel）+ event 类型匹配；命中 → `installed`；命中但 `matcher` / `if` 与 catalog 不一致 → `update-available` |
| Project | `<proj>/.claude/settings.json` 同段 | 同 |

废弃 `<cwd>/.claude/hooks/hooks.json` 作为安装态来源 —— 它是 auriga-cli 内部用来描述「有哪些 hook 可装」的清单，不是「已经装了什么」。

## UI 行为

- 保留**每列各自的 scope picker**（v0.1 已有），下拉选项为 `Project` / `User`，默认按目前 UI 逻辑（Workflow / Skills / Recommended 默认 Project，Plugins / Hooks 默认 User —— 与 install 默认 scope 一致）。
- Scope 切换触发该列单独刷新（继续走 `/api/state?categoryScopes=...`，scope 信息分类目随 query 传到 server），无需整页 refetch。
- 加 **warning toast** —— scanner 探不到 `~/.claude/` 也探不到 `<proj>/.claude/` 时显眼提示「未发现任何 Claude Code 安装痕迹，确认你装过 Claude Code」，避免空状态被误读为「auriga-cli 坏了」。

## Scanner 模块改造

### `src/state.ts`

- `scanState(projectRoot, catalog, opts)` 签名扩展，加 `scopes: { workflow: 'user'|'project', skills: ..., plugins: ..., hooks: ... }`。`server.ts` 把 query 参数透传过来。
- 每个 `scan<Cat>` 子函数按 `scope` 拼真值源路径：`scope === 'user' ? homeDir() : projectRoot`。
- `readSkillsLock` / `<cwd>/.claude/hooks/hooks.json` 读取**删除**。
- 新增 `scanWorkflowFromFile(claudeMdPath)` —— 解析文件头部的 `# auriga Workflow (vX.Y.Z)` 行；找不到 → status `installed`（已装，但无版本信号），fallback 用文件 mtime 做弱区分。
- 新增 `scanSkillsFromDir(skillsDir, catalog)` —— `fs.readdir(skillsDir)`，对每个子目录 read `SKILL.md`，frontmatter `version` 优先，否则对文件做 sha256 与 catalog 中的 `expectedHash` 对比。
- 新增 `scanHooksFromSettings(settingsPath, catalogHooks)` —— 读 `settings.json` 的 `hooks` 段，按 `_marker` 命中 catalog 中登记的 hook。

### `src/api-types.ts`

- 新增 `ScanScope = 'user' | 'project'`；`StateRequestQuery` 增加 `scopes` 字段。
- `WorkflowState` / `SkillState` / `PluginState` / `HookState` 增加 `observedScope: ScanScope` 字段（用于 UI 显示「这一项是 user 还是 project 装的」）。

### `src/server.ts`

- `/api/state` 接受 query `scopes=workflow:user,skills:project,...` 或 JSON body；解析后透传给 `scanState`。
- 兼容旧调用：未传 `scopes` 时按 UI 默认 scope 行事。

## 降级路径（必须 explicit，附 warning）

| 触发 | 行为 |
|---|---|
| `~/.claude/` 不存在（用户没装 Claude Code） | 全 user-scope 类目落 `not-installed`，加 warning `claude-code-not-installed` |
| `claude` CLI 不在 PATH | Plugins (Claude) 走 degraded path，warning `claude-cli-missing`（沿用现状） |
| `<scope>/.claude/settings.json` 不可读 / 损坏 JSON | hooks 落 `not-installed`，warning `settings-unreadable` 带 path |
| Skills 目录里某子目录的 `SKILL.md` 损坏 / 缺失 | 该 skill 单独落 `installed` + warning `skill-malformed`，不影响其他 |
| Workflow CLAUDE.md 存在但没识别到 auriga 标记 | 落 `installed` + warning `workflow-unknown-version`，提示「这个 CLAUDE.md 不像是 auriga-cli 装的」 |

## 测试策略

`test-designer` 独立 Agent 设计失败测试（隔离 — 写测试的 Agent 看不到本 spec 的「实现路径」段，只看本节的需求 + 现有代码路径）。需要覆盖：

1. 多 scope × 多类目矩阵（4 类目 × 2 scope = 8 场景的安装/未装/更新可用三态）
2. 5 条降级路径每条单独的失败测试
3. UI 默认 scope 默认值回归（Workflow/Skills/Recommended 默认 Project，Plugins/Hooks 默认 User）
4. Per-column scope picker 切换时只 refetch 该列
5. observedScope 字段透传到 UI

mock 文件系统用 `fs.mkdtempSync` 临时目录；mock `claude plugins list` 用现有 `execPluginList` 入参注入。

## 兼容性

- `/api/state` 旧 client（没传 `scopes`）应继续工作 —— scanner 用 UI 默认 scope（同 install 默认）兜底。
- `StateReport` 输出多了 `observedScope` 字段，旧 UI 忽略不影响。
- v1.16.0 已发布到 npm 且**不 deprecate**；用户升级到 1.16.1 后自然修复。Release notes 解释。

## 不在本次 scope

- 「显示非 catalog 的已装 plugin」—— 用户可能装了 catalog 之外的 plugin，本次不展示（保持现有 catalog-driven 模型）。
- 全屏 scope toggle（User / Project / Both stacked）—— 保留 per-column picker 不变。
- 重新设计 update 检测（如 frontmatter version vs file hash 哪个权威）—— 本次先用 frontmatter version 优先 + hash fallback，后续观察实际效果再调。
