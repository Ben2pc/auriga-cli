# auriga-cli Web UI 设计文档（v0.1）

> 状态：active spec（brainstorming 产出，待 PR Ready 时按 [Document Conventions](../../CLAUDE.md) 处置）
> 受众：实现该功能的工程师 / Agent
> 语言：中文（代码、路径、字段名保留英文）

---

## 1 概述

为 `npx auriga-cli` 增加一个 **本地 Web UI**，作为现有 TTY 菜单的并行入口，提供：

- **状态可见性**：扫用户项目得出每项 workflow / skill / plugin / hook 的"已装 / 可更新 / 未装"三态——这是现 CLI 完全没有的能力
- **批量操作**：勾选 + 一键 install / update / uninstall，SSE 实时进度
- **更友好的呈现**：图标、描述、tooltip，对非工程师也能用

本期 **v0.1 = MVP**，覆盖 install / update / uninstall 三动作 + 三态 scanner + 基础 UI。后续 v0.2 / v0.3 再加 preset、搜索、preview 等。

**视觉系统**：UI 遵循 Anthropic 自家的"温白纸面 + 单一陶土橙强调"风格——温白页面（ivory #faf9f5）+ 近黑文本（slate #141413）+ 单一 Clay (#d97757) 强调，零阴影 / 零渐变 / 用背景对比制造层次。完整 token 表见 [`docs/design/anthropic-style-reference.md`](../design/anthropic-style-reference.md)（已入仓）。前端实现的最后一公里 polish 强制走 `make-interfaces-feel-better` skill。详见 [§13 视觉风格](#13-视觉风格与-ui-polish)。

---

## 2 目标与非目标

### 2.1 v0.1 目标

1. 通过 `npx auriga-cli web-ui` 子命令启动本地 server + 自动开浏览器
2. UI 默认按 5 个类目（Workflow / Skills / Recommended Skills / Plugins / Hooks）平铺展示，每项三态徽章 + 描述
3. 用户能勾选 N 项 × M 动作 → 一次提交批量执行 → SSE 流式回显逐项进度
4. 现有 TTY 菜单零回归（`npx auriga-cli` 不带参数行为完全不变）
5. UI 资源按 CLI 版本号从 GitHub Release 拉取并缓存

### 2.2 v0.1 非目标（推迟到后续）

- preset / use-case grouping（"一键 iOS 开发配齐"）
- 搜索 / 筛选 / 排序
- 安装前 preview（具体要改哪些文件 / 哪几行）
- 截图 / 视频示例
- 多项目切换 UI（仍是"一个 server 绑定一个 cwd"）
- e2e 上 CI（v0.1 的 spawn-CLI e2e 只在本地 / 发版前手工跑）
- 跨浏览器兼容（IE / 旧 Edge / 移动浏览器）
- hook 自定义配置 UI（如 notify 托盘图标设置）—— 用默认值安装
- 离线 plugin 版本对比（Codex 端依赖 catalog）
- 启用 / 禁用切换（Codex `[plugins.*].enabled` toggle）

### 2.3 成功标准

- 三态 scanner 在 fixture 项目上 100% 准确（对每类目 × 三态都有单测断言）
- 一次完整的 install + update + uninstall 流程在浏览器中可走通，过程通过 SSE 实时反馈
- **Hermetic spawn-CLI e2e**（`npm run test:web-ui-e2e`，plain `node:test`）在**完全隔离的 HOME** 环境中通过：HOME 重定向到 scratch 目录 → spawn 真 CLI 启 server → 调用 `/api/state` + `/api/apply` → 断言 scratch 文件系统副作用 + 断言用户真实 `$HOME` 未被触碰；在本地与发版前各跑一次。（Playwright 浏览器覆盖推迟到 v0.2）
- 现有所有测试 (`npm test` + `npm run test:git-guards` + `npm run test:e2e`) 不回归
- 安全测试覆盖：token 缺失 / 错误 → 401，Origin 黑名单 → 403，DNS rebinding 模拟 → 403

---

## 3 用户故事

| 角色 | 故事 |
|---|---|
| 老用户（工程师） | 跑 `npx auriga-cli` 走熟悉的 TTY 菜单，零学习成本 |
| 新用户（工程师） | 跑 `npx auriga-cli web-ui` 在浏览器里一目了然看到推荐项和已装项 |
| 非工程师 | 同事告诉他"在项目目录跑 `npx auriga-cli web-ui`"，他在浏览器里勾选预设项 → 点确认 → 看完成提示 |
| 维护者 | 几个月没更新过的项目，跑 `auriga-cli web-ui` 一眼看到 5 个"可更新" → 批量勾选 → 一键升级 |

---

## 4 架构概览

### 4.1 入口与启动序列

```
npx auriga-cli                  → TTY 菜单（现有，未变）
npx auriga-cli web-ui               → Web UI（新增）
npx auriga-cli web-ui --port 5050   → 显式端口
npx auriga-cli web-ui --no-open     → 启 server 但不自动开浏览器
npx auriga-cli web-ui --ui-dir <p>  → 指定本地 UI 构建（开发用）
npx auriga-cli guide            → 现有，未变
```

`web-ui` 子命令启动序列：

1. `cli.ts` 解析 `web-ui` 子命令，调用 `runWebUi(opts)`
2. 检查 `~/.cache/auriga-cli/ui-v<package.version>/` 是否存在
   - 不存在 → `src/ui-fetch.ts` 从 `https://github.com/Ben2pc/auriga-cli/releases/download/v<version>/ui-bundle.tar.gz` 下载 + SHA256 校验 + 解压
   - 存在 → 直接使用
3. 选端口：默认 4747，占用则递增到 4756（共 10 个端口）；全占用 → 退出码 2
4. 生成 32 字节随机 token（`crypto.randomBytes(32).toString('hex')`）
5. 启 HTTP server 绑定 `127.0.0.1:<port>`
6. 用 `open` 包打开 `http://127.0.0.1:<port>/?token=<token>`，stdout 同时醒目打印该 URL（无浏览器时手动开）
7. 进程驻留，等浏览器心跳

### 4.2 fallback 与错误退出

`web-ui` 是显式触发——任何启动失败**报错退出，不偷偷降级**。错误信息附建议"试试 `npx auriga-cli`（TTY 菜单）"。

唯一例外：浏览器 `open` 失败但 server 已启动 → 继续运行，打印 URL 让用户手动开。

### 4.3 生命周期

- UI 每 5s POST `/api/ping`
- server 内部维护 `lastPingAt`，> 120s 未刷新 → graceful shutdown：
  - 等当前 job 完成，最多再等 30s
  - 关 server，清理资源，退出码 0
- Ctrl+C 同路径
- UI 关闭前主动 POST `/api/shutdown`（best-effort，浏览器关页时未必能发出）

### 4.4 安全模型

| 措施 | 防御 |
|---|---|
| `127.0.0.1` bind（非 `0.0.0.0`） | 局域网内其他机器访问 |
| Token 在 URL 中传递，所有 `/api/*` 必须带 token（query 或 `Authorization: Bearer`） | 同机其他进程随意调用、CSRF |
| `Origin` / `Host` header 必须 ∈ `{127.0.0.1:<port>, localhost:<port>}` | DNS rebinding |
| Token 永不进日志（含 SSE 事件、错误信息） | 日志泄漏 |
| 鉴权失败统一返回通用错误（401 / 403），不区分原因 | 探测式攻击 |

### 4.5 项目作用域

server 启动时锁定 `process.cwd()`，整个会话只操作这一个项目。多项目 = 多次 `npx auriga-cli web-ui`（多端口 / 多浏览器标签）。v0.1 不做项目切换 UI。

---

## 5 模块拆分

### 5.1 新增文件

| 文件 | 职责 | 预估 LOC |
|---|---|---|
| `src/server.ts` | HTTP server（Node 原生 `http`）、路由、SSE、token 校验、Origin 白名单、心跳生命周期 | ~300 |
| `src/state.ts` | scanner：`scanState(projectRoot, catalog)` → `StateReport` | ~250 |
| `src/ui-fetch.ts` | bundle 下载 + 缓存 + SHA256 校验 | ~120 |
| `src/api-types.ts` | server / UI 共享的 TS 类型 | ~80 |
| `ui/` | Vite + React + Tailwind 子项目 | ~800 (TSX) |
| `tests/state.test.ts` | scanner 单测 | ~250 |
| `tests/server.test.ts` | 路由 + 校验 | ~200 |
| `tests/server-auth.test.ts` | 安全测试 | ~120 |
| `tests/ui-fetch.test.ts` | 缓存 / 校验 / 重试 | ~100 |
| `tests/server-apply.test.ts` | 集成：POST apply → SSE → 文件系统副作用 | ~200 |
| `tests/web-ui-e2e.test.ts` | Hermetic spawn-CLI e2e + HOME 重定向 + canary（plain `node:test`，无 Playwright） | ~250 |
| `docs/design/anthropic-style-reference.md` | Anthropic 视觉系统 of record（从外部 Anthropic style reference 复制入仓，遵循 "repo as truth" 原则） | ~385（已入仓） |
| `ui/src/styles/tokens.css` | DESIGN.md 的 `:root` CSS 变量声明 | ~80 |
| `ui/src/styles/index.css` | Tailwind v4 `@theme` 块 + dashboard 响应式 grid（同一套 token） | ~150 |

### 5.2 修改的现有文件

| 文件 | 改动 | 风险 |
|---|---|---|
| `src/cli.ts` | parseArgs 增 `web-ui` 分支；其余路径不动 | 低（新分支隔离） |
| `src/help.ts` | 加 `web-ui` 子命令说明；TTY 菜单收尾打印一行提示 | 极低 |
| `src/workflow.ts` | 加 `uninstallWorkflow()`（删 `CLAUDE.md` + `AGENTS.md` symlink，要求二次确认 flag） | 低 |
| `src/skills.ts` | 加 `uninstallSkill(name)`（调 `npx skills remove`，若不支持则手动删 + 改 lockfile） | 低-中（依赖外部 CLI） |
| `src/plugins.ts` | 加 `uninstallPlugin(id, agent)`（调 `claude plugins uninstall` / `codex plugin marketplace ...`） | 中（Codex 没 uninstall 命令，待实现时确认） |
| `src/hooks.ts` | 加 `uninstallHook(name)`（删 hook 目录 + `removeHookFromSettings`） | 低（基础设施已就绪） |
| `.github/workflows/release.yml` | publish 前加 UI build + tarball + upload | 中（CI 改动） |
| `tsconfig.json` | `exclude` 加 `ui/` | 极低 |
| `.gitignore` | 加 `ui/dist`、`ui/node_modules` | 极低 |
| `package.json` | 不加 workspaces；加 `scripts.test:web-ui-e2e`、`scripts.ui:build`（v0.1 不依赖 `@playwright/test`，hermetic spawn-CLI e2e 即可覆盖契约） | 极低 |

### 5.3 依赖图

```
ui/ (浏览器)
   ↓ HTTP/SSE
src/server.ts
   ├─ src/state.ts ──→ src/catalog.ts (现有) + fs
   ├─ src/workflow.ts / skills.ts / plugins.ts / hooks.ts (现有 install + 新 uninstall)
   └─ src/utils.ts (现有)

src/cli.ts
   ├─ "web-ui" 子命令 → src/ui-fetch.ts → src/server.ts
   └─ 默认 → 现有 TTY 路径（未变）
```

**关键边界**：现有 installer 文件**只新增 uninstall 函数**，install 函数体不动。保护 TTY 路径零回归。

---

## 6 数据流与 API 设计

### 6.1 端点

| 路径 | 方法 | 用途 |
|---|---|---|
| `/` 和 `/assets/*` | GET | UI 静态资源（从 `~/.cache/auriga-cli/ui-v<version>/`） |
| `/api/catalog` | GET | 返回 `dist/catalog.json` 内容 |
| `/api/state` | GET | 实时扫描 → `StateReport` |
| `/api/apply` | POST | 提交 batch，立即返 `{ jobId }` |
| `/api/progress?jobId=...` | GET (SSE) | 推送该 job 的逐项进度 |
| `/api/ping` | POST | 心跳，重置 120s 退出计时器 |
| `/api/shutdown` | POST | 主动优雅退出（best-effort） |

所有 `/api/*` 校验 token + Origin。静态资源不校验（公开内容）。

### 6.2 关键类型（`src/api-types.ts`）

```ts
export type ItemStatus = "installed" | "update-available" | "not-installed";
export type ApplyAgent = "claude" | "codex";
export type ApplyScope = "project" | "user";
export type ApplyLang = "en" | "zh-CN";

export interface StateReport {
  cwd: string;                 // home-reduced project path, e.g. "~/Workspace/foo"
  workflow: WorkflowState;
  skills: SkillState[];
  recommendedSkills: SkillState[];
  plugins: PluginState[];      // deduped by id; dual-Agent → agents:["claude","codex"]
  hooks: HookState[];
  warnings: StateWarning[];    // 如 "claude-cli-missing", "codex-cli-missing"
}

export interface WorkflowState {
  status: ItemStatus;
  currentVersion?: string;     // CLAUDE.md 顶部解析
  expectedVersion: string;     // catalog
}

export interface SkillState {
  name: string;
  description: string;
  status: ItemStatus;
  isWorkflow: boolean;         // workflow-set vs recommended
  currentHash?: string;
  expectedHash: string;
}

export interface PluginState {
  id: string;                  // 形如 "auriga-go@auriga-cli"
  description: string;
  status: ItemStatus;          // 聚合：所有 agent 都装 → installed; 都没装 → not-installed; 否则 update-available
  agents: ApplyAgent[];        // 该 plugin 在 catalog 注册的 agent 集合（dual = ["claude","codex"]）
  currentVersion?: string;
  expectedVersion?: string;    // Claude: 上游活查；Codex: catalog
  versionSource: "upstream-live" | "catalog";
}

export interface HookState {
  name: string;
  description: string;
  status: ItemStatus;
  currentHash?: string;
  expectedHash: string;
}

export interface StateWarning {
  code: "claude-cli-missing" | "codex-cli-missing" | "marketplace-offline";
  message: string;
}

export interface ApplyItemRef {
  category: "workflow" | "skill" | "recommended-skill" | "plugin" | "hook";
  name: string;
  action: "install" | "update" | "uninstall";
  scope?: ApplyScope;          // 默认 "project"；workflow / 不支持 scope 的类目可省略
  lang?: ApplyLang;             // 仅 workflow 类目使用；其它类目带值会被 400 拒绝
}

export interface ApplyRequest { items: ApplyItemRef[] }

export type ProgressEvent =
  | { type: "item:start"; index: number; total: number; item: ApplyItemRef }
  | { type: "item:log"; index: number; line: string; level: "info" | "warn" | "error" }
  | { type: "item:done"; index: number; success: boolean; error?: string }
  | { type: "all-done"; success: boolean; failedCount: number };
```

### 6.3 scanner 判定逻辑

scanner 按 Claude Code 实际安装位置读真值源，**支持 per-category × per-scope（user / project）**：

| 类目 | User scope 真值 | Project scope 真值 | 三态判定 |
|---|---|---|---|
| Workflow | `~/.claude/CLAUDE.md` | `<proj>/CLAUDE.md` 优先，回落 `<proj>/.claude/CLAUDE.md` | 文件缺失 → not-installed；解析 `# auriga Workflow (vX.Y.Z)` 头部成功且版本 = `catalog.workflowVersion` → installed；版本不同 → update-available；文件存在但无 auriga 头 → installed + `workflow-unknown-version` warning |
| Skills / Recommended | `~/.claude/skills/<name>/SKILL.md` 文件系统 | `<proj>/.claude/skills/<name>/SKILL.md` 文件系统 | 目录缺 → not-installed；SKILL.md 不可读 → installed + `skill-malformed` warning（不影响其他 skill）；`sha256(SKILL.md bytes)` 与 catalog 期望同 → installed，不同 → update-available |
| Plugins (Claude) | `claude plugins list --json` + 客户端按 `record.scope === "user"` 过滤 | 同命令 + 按 `record.scope === "project"` 且 `record.projectPath === <projectRoot>` 过滤 | `installed[id].version` vs `available[id].source.ref`（注意 id 双索引：CLI 用 `<plugin>@<marketplace>` 形式，catalog 用裸名）；CLI 不在 PATH → 类目降级为二态 + `claude-cli-missing` warning |
| Plugins (Codex) | `~/.codex/config.toml` + `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/` 文件系统 | n/a — Codex 设计上 user-scope only | 不变（v0.1 即正确）|
| Hooks | `~/.claude/settings.json` 的 `hooks.<Event>[].hooks[]` 按 `_marker` sentinel 匹配 catalog 登记的 hook | `<proj>/.claude/settings.json` 同段同匹配 | 文件缺 → not-installed（不发 warning，常见情况）；JSON 损坏 → not-installed + `settings-unreadable` warning；marker 命中但 `matcher` / `if` / event 与 catalog 不同 → update-available |

**默认 scope**（与 install 默认一致）：workflow=project，skills=project，plugins=user，hooks=user。UI 每列有独立的 scope 下拉，切换即触发该列单独 refetch。

**真值源迁移说明（v1.16.0 → v1.16.1）**：v1.16.0 读 auriga-cli **dev 仓库自己的清单文件**（`<cwd>/.claude/plugins.json`、`<cwd>/skills-lock.json`、`<cwd>/.claude/hooks/hooks.json`），结果用户在普通项目或 `~/` 下都看到「全 not installed」。v1.16.1 全部换成 Claude Code 实际安装位置（上表）。`claude plugins list` 不支持 `--user/--project` 旗标，scope 过滤改在客户端做。skill 的 `expectedHash` 改为 `sha256(SKILL.md bytes)` —— `skills-lock.json` 的 `computedHash`（全目录 sorted-hash）与该算法不兼容，过去比对永远不等，现在不再读 lock 文件。

**Plugin 期望版本号的真值源选择（v1.18.2 → v1.18.3）**：scanner 判 `update-available` 需要"上游应该是几号版本"。三个候选源：

| 源 | 含义 | 用 / 不用的原因 |
|---|---|---|
| (A) `~/.claude/plugins/marketplaces/<marketplace>/plugins/<name>/.claude-plugin/plugin.json` | Claude Code 本地缓存的 marketplace 镜像 | **不用**：stale，需要用户手动 `claude plugins update <marketplace>` 才会刷新，UI 没法告诉用户「你的缓存过期了」 |
| (B) `claude plugins list --available --json` 的 `.available[]` | Claude CLI 给的 "marketplace 当前可用列表" | **只用于 fresh-install 场景**：CLI 故意把已装 plugin 从 `.available[]` 排除，所以已装升级永远查不到。`available[i].source.ref` 在能拿到时优先（最 fresh），拿不到才退到 (C) |
| (C) auriga-cli 自己 `dist/catalog.json` 里 `plugins[i].expectedVersion` | build 时从 `plugins/<name>/.claude-plugin/plugin.json` 烤入 | **owned in-tree plugins 的主源**：auriga-go / auriga-git-guards / deep-review / session-instructions-loader 都是本仓库 owned，它们的 `plugin.json` 就是权威版本号。用户跑 `npm i auriga-cli@latest` 即刻同步 |

外部 marketplace plugin（skill-creator、claude-md-management、codex 这类 upstream 不在本仓库的）**不烤** `expectedVersion`：钉版本会让我们追不上 upstream 的发版节奏，每次 upstream bump 都误报 update。scanner 在 `expectedVersion` 缺失时退化为「信任已装」，符合"我们不发版你自己管"的契约。

trade-off：用 (C) 意味着想暴露新 plugin 版本必须重发 auriga-cli。可接受 —— 自家 plugin 的 bump 总会跟 auriga-cli 的 release 走（修 plugin 就 bump auriga-cli 即可）。

`classifyClaudePlugin` 优先级：`available[].source.ref` 可解析 semver → 用 (B)，`versionSource: "upstream-live"`；否则用 (C) baked `expectedVersion`，`versionSource: "catalog"`。两个值都拿不到 → 信任已装。

**v1.18.2 的常见误区（建议避免）**：版本号读取必须在 **build 时**入 `dist/catalog.json`，不能在 runtime 读 `packageRoot/plugins/<name>/plugin.json`。`package.json` `files` 字段只 ship `dist/`，runtime 读 `plugins/` 会在 npm 装好后静默拿空。dev 环境（`packageRoot === repoRoot`）能跑通是巧合，会掩盖这个 bug 直到打 tarball 发出去。该规则记录在 [.claude/CLAUDE.md → Principles](../.claude/CLAUDE.md#principles)。

**降级路径汇总**：

| 触发 | 行为 |
|---|---|
| 既无 `~/.claude/` 又无 `<proj>/.claude/` | 所有 user-scope 类目落 not-installed + 一次性 `claude-code-not-installed` warning |
| `which claude` 失败 | Plugins (Claude) degraded rows + `claude-cli-missing` warning |
| `<scope>/.claude/settings.json` 损坏 JSON | Hooks 落 not-installed + `settings-unreadable` warning |
| Skill 目录存在但 SKILL.md 不可读 | 该 skill installed + 一次性 `skill-malformed` warning，兄弟 skill 不受影响 |
| CLAUDE.md 存在但无 auriga 头 | installed + `workflow-unknown-version` warning |

**Claude / Codex Plugins 不对称的合理性**：

- Claude CLI 提供 `--available` 模式直接活查上游，精度最高；离线 / CLI 缺失时降级
- Codex CLI 没有 `list` 子命令，只能靠 filesystem + auriga-cli catalog；catalog 在 CLI 发版时烤入，对 auriga-cli-owned plugins（auriga-go 等）足够精确，对外部 plugins 精度取决于 CLI 新鲜度
- 该 trade-off 已记录在 [10.1 决策日志](#101-决策日志)

### 6.4 Apply 执行模型

**串行执行**，**单项失败继续**：

1. UI POST `/api/apply` → server 校验 token + 逐项对照 catalog（不在 catalog 的 name 直接 400）
2. Server 立即返 `202 + { jobId }`，UI 立即开 SSE 到 `/api/progress?jobId=...`
3. 后台串行跑每项：调对应 installer 函数，stdout/stderr 通过自定义 logger 转 `item:log` 推到 SSE
4. 单项失败 → 记 `success: false` 继续下一项
5. 全跑完 → 发 `all-done { success, failedCount }`

**为什么串行不并行**：installer 之间会撞共享文件（`settings.json` / `skills-lock.json` / `CLAUDE.md`），并行 = 竞态。每项 ~1-3s，顺序对 UX 影响小。

**为什么继续不 fail-fast**：installer 操作互相独立。一个 skill 网络抖动失败不应阻断其他 9 个。失败的具体项在 UI 上有清晰红色徽章 + 错误信息。

### 6.5 SSE 实现

- 标准 `text/event-stream`，每条 `event: progress\ndata: <JSON>\n\n`
- server 缓存近 200 个事件（per job），客户端断线可用 `Last-Event-ID` 续传
- job 完成 + client 收到 `all-done` → server 关流；job 数据 5 分钟后从内存淘汰

### 6.6 心跳详情

- UI 每 5s POST `/api/ping`
- server 维护 `lastPingAt: number`（单时间戳，单 token = 单 session）；启动时初始化为当前时间，给浏览器 120s 启动窗口
- 后台 setInterval 每 ~40s 检查 `Date.now() - lastPingAt > 120000`（间隔 = `timeout/3`）
- 触发 → 调 `gracefulShutdown()`：阻塞新 `/api/apply`，等当前 job 完，最多再等 30s 后强退

---

## 7 错误处理

| 出错位置 | 时机 | 处理 |
|---|---|---|
| 端口获取 | server 启动 | 10 端口都占用 → 退出码 2 + 提示 `--port <n>` 或 `npx auriga-cli`（TTY） |
| UI bundle 拉取 | server 启动前 | 网络失败 / SHA256 校验失败 → 退出码 3 + 提示 `--ui-dir <path>` |
| 浏览器 open | server 起来后 | 失败 → server 继续运行；stdout 醒目打印 URL 让用户手动开 |
| catalog 解析 | `/api/state` | catalog 损坏 → 500 + `{ error: "catalog-malformed", details }`；UI 展示错误页 |
| scanner | `/api/state` | 单文件读取异常 → try/catch 后该项标 `status: "error"` + message；endpoint 整体不挂 |
| 上游 CLI 缺失 | `/api/state` | `claude` / `codex` 不在 PATH → 对应类目降级二态，response 含 `warnings`；UI 顶部 banner |
| token / Origin 校验 | 任何 `/api/*` | 401 / 403 通用错误信息（不泄露具体原因） |
| `/api/apply` 单项 | 执行中 | catch → `item:done success: false, error` 通过 SSE 推；不中断 batch |
| `/api/apply` 全部失败 | 末尾 | `all-done failedCount: N, success: false`；HTTP 仍 200 |
| SSE 断线 | 推流中 | client `Last-Event-ID` 重连；server 缓存最近 200 个事件 5 分钟 |
| 心跳超时 | server 运行中 | 120s 无 ping → graceful shutdown（覆盖 Chrome 后台 tab 的 throttle）|

---

## 8 测试策略

| 测试文件 | 覆盖 |
|---|---|
| `tests/state.test.ts` | scanner：每类目 × 三态 × 边界（CLAUDE.md 缺失、skills-lock 损坏、claude CLI 离线等） |
| `tests/server.test.ts` | 路由逐个 + JSON schema 校验，mock installers |
| `tests/server-auth.test.ts` | token 正确 / 错误 / 缺失；Origin 白名单 / 黑名单 / DNS rebinding 模拟 |
| `tests/ui-fetch.test.ts` | 缓存 hit / miss / SHA256 校验失败 / 网络重试 |
| `tests/server-apply.test.ts` | server 集成：POST apply → SSE → scratch 文件系统副作用断言（mock 出 install 函数，纯 Node，CI 跑） |
| `ui/tests/*.test.tsx` | Vitest + RTL：StateCard 按状态渲染、ApplyBar 勾选/汇总、错误 banner |
| `tests/web-ui-e2e.test.ts` | **Hermetic spawn-CLI e2e**（plain `node:test`，无 Playwright）：HOME 重定向 → spawn 真 CLI 启 server → 触 `/api/state` + `/api/apply` → 断言 scratch 文件系统副作用 + 真 `$HOME` canary。**只在本地 / 发版前手工跑**（见下方 Hermetic 保证 + CI 策略） |
| **现有测试** | 全部保持通过（install-nontty / hooks / skills / catalog / cli-parse / e2e-install / git-guards） |

### 8.1 Hermetic 保证（spawn-CLI e2e 不污染本地环境）

e2e 测试 spawn 子进程时强制重定向所有用户全局状态目录，确保对运行者真实环境零副作用：

```ts
const scratch = await mkdtemp(path.join(os.tmpdir(), 'auriga-web-e2e-'));
const fakeHome = path.join(scratch, '.home');
const projectDir = path.join(scratch, 'project');

const server = spawn('node', ['./dist/cli.js', 'web-ui', '--no-open', '--port', '4848'], {
  cwd: projectDir,
  env: {
    ...process.env,
    HOME: fakeHome,
    XDG_CACHE_HOME: path.join(fakeHome, '.cache'),
    XDG_CONFIG_HOME: path.join(fakeHome, '.config'),
    AURIGA_E2E: '1',
  },
});
```

`HOME` 重定向使 `~/.claude/`、`~/.codex/`、`~/.cache/auriga-cli/`、`~/.npm/` 全部落到 scratch 内。`claude` / `codex` / `npm` / `npx skills` 都遵守 `$HOME`，验证一次即一劳永逸。

**canary 断言**：测试结束前断言运行者真实 `$HOME` 的关键路径没被新建文件——若某个 installer 漏掉 `$HOME` 直接 hardcode 路径，canary 会捕获。

**清理**：测试结束 `fs.rm(scratch, { recursive: true, force: true })`；测试中断（Ctrl+C / 超时）通过 `afterEach` + signal handler 兜底清理。

### 8.2 CI 策略

| 测试套件 | 触发命令 | 跑在 CI | 跑在本地 |
|---|---|---|---|
| `npm test`（含 server / state / auth / ui-fetch / server-apply 单测与集成） | 每次 PR | ✅ | ✅ |
| `cd ui && npm test`（前端单测） | release.yml build UI 前 | ✅ | ✅ |
| `npm run test:e2e`（现有 tarball install e2e） | release 前手工 | ❌（手工） | ✅ |
| `npm run test:web-ui-e2e`（**新增 hermetic spawn-CLI e2e**） | **本地开发 / release 前手工** | ❌ | ✅ |
| `npm run test:git-guards` / `:session-instructions-loader` | 每次 PR | ✅ | ✅ |

**为什么 spawn-CLI e2e 不上 CI**：跨 OS 上 `claude` / `codex` 二进制可用性不稳定，CI 跑真 installer 的 flakiness 综合成本高；server-apply.test.ts 已覆盖 SSE / 文件系统副作用契约；UI 渲染层由 Vitest + RTL 单测兜底。e2e 的增量价值是"真 server × 真后端 × 真用户路径"——这种价值在开发者本地按节奏跑 1-2 次即可，不必每次 PR 重跑。

**Playwright browser overlay（v0.2 候选）**：现在的 hermetic harness 已经 spawn 真 CLI + HOME 重定向；v0.2 可以在同一套 fixture 上挂 chromium，把"真浏览器"那一层也补上。v0.1 不引入 `@playwright/test` 依赖。

---

## 9 发版与版本管理

### 9.1 版本绑定

UI bundle 与 CLI **同版本节奏**：CLI 每次发版同时 build 新的 UI bundle 并 attach 到同一个 GitHub Release。

### 9.2 Release flow 改动

`.github/workflows/release.yml` 在现有的 `npm publish` 前插入：

```yaml
- name: Build UI bundle
  run: |
    cd ui
    npm ci
    npm test
    npm run build
    tar -czf ../ui-bundle.tar.gz -C dist .

- name: Compute UI bundle SHA256
  run: shasum -a 256 ui-bundle.tar.gz > ui-bundle.sha256

- name: Upload UI bundle to Release
  run: gh release upload "v${VERSION}" ui-bundle.tar.gz ui-bundle.sha256
```

**失败策略**：UI build 失败 = 整个 release abort（半残发布比延迟发布危害更大）。

### 9.3 客户端校验

`src/ui-fetch.ts` 下载 `ui-bundle.tar.gz` 后 SHA256 校验对照 `ui-bundle.sha256`。校验失败 → 删本地缓存 + 报错退出，提示用户重试或用 `--ui-dir`。

### 9.4 缓存管理

- 缓存路径：`~/.cache/auriga-cli/ui-v<package.version>/`（按版本隔离，零混淆风险）
- 缓存淘汰：每次启动检查 `~/.cache/auriga-cli/ui-v*/` 数量，> 3 个则 LRU 删旧的（保留近 3 个版本）
- 用户手动清理：直接 `rm -rf ~/.cache/auriga-cli/`，下次自动重拉

### 9.5 版本不匹配场景

UI bundle 路径键就是 `v<package.version>`，CLI 启动时根据自身版本号查缓存，**结构上不存在 UI / CLI 版本错配的可能**。这是与"将版本号当成内容字段写在 manifest 里"相比的一大优势。

---

## 10 已知约束与未来工作

### 10.1 决策日志

| 议题 | v0.1 决策 | 原因 |
|---|---|---|
| 入口默认 | TTY 菜单（`npx auriga-cli`）；UI 显式 `ui` 子命令 | 保护存量用户零回归 |
| 端口策略 | 默认 4747，fallback 到 4756（10 端口范围） | 固定优先于随机；避开常见占用 |
| 安全模型 | URL 中 token + Origin 白名单 + 127.0.0.1 bind | 抗 DNS rebinding 与同机其他进程访问 |
| 前端栈 | React + Vite + Tailwind | 生态最熟，Agent 写 React UI 质量最高 |
| 仓库布局 | 同仓库 `ui/` 子目录，不用 npm workspaces | 简单优先 |
| installer 集成方式 | A 方案：薄 wrapper + 独立 scanner（读 catalog） | 工程量最小，catalog 已是真值源；preview 推迟 |
| Plugin 期望版本源 | Claude 走活上游，Codex 走 catalog（不对称） | Claude 体验最优，Codex 受限于其 CLI 无 `list` |
| Apply 并发 | 串行 + 单项失败继续 | installer 撞共享文件；继续比 fail-fast 实用 |
| 生命周期 | 浏览器心跳 + 120s 超时退出 | "关浏览器 = 关 server" 自然体验；超时长到能容忍 Chrome 后台 tab throttling |
| 卸载范围 | v0.1 包含 install / update / uninstall 三动作 | UI dashboard 完整性需要 |
| Plugins 二态/三态 | Claude 三态（CLI 离线 / 缺失时降级二态 + warning）、Codex 三态（仅对 catalog 登记项；非 catalog plugin 不展示） | 与 scanner depth = 三态目标一致 |
| e2e 形态 | v0.1 含 **hermetic spawn-CLI 调用 + HOME 重定向 + scratch 项目** 的 e2e 套（`tests/web-ui-e2e.test.ts`，plain `node:test`，无 Playwright）；Playwright browser overlay 推迟到 v0.2，但保留实现路径——同一套 fixture 可以无成本接上 | 用户接受“模拟环境也行”的等价要求；Vitest + RTL 已覆盖 UI 渲染层，server-apply.test.ts 覆盖 SSE/文件副作用契约；Playwright 的增量价值（“真浏览器 × 真后端”）在 v0.1 的边际收益不抵其 ~80MB 浏览器依赖 + CI flakiness 成本 |
| 视觉系统 | 复用 Anthropic 自家"温白 + Clay 强调"风格的全套 token；DESIGN.md 入仓；强制 polish 阶段调 `make-interfaces-feel-better` skill | 视觉品质是非工程师用户的关键体验差距；现成且自洽的 token 系统避免新造车；polish skill 把"hover/focus/empty/error"这类容易漏的细节按方法论补齐 |

### 10.2 v0.2 候选

- **UI polish 第二轮**——v0.1 落地 Anthropic token + 基础 Dashboard 后，下一轮 `make-interfaces-feel-better` skill 跑一遍补 loading / empty / error / focus-ring / 微文案
- **Playwright browser overlay**——v0.1 的 hermetic harness 已经 spawn 真 CLI + HOME 重定向；v0.2 在同一套 fixture 上挂 chromium，把"真浏览器 × 真后端 × 真 installer"补齐
- 搜索 / 筛选 UI
- 单项详细描述展开（截图、README、示例）
- 安装前 preview（"会写哪些文件"）—— 需要 installer 加 `plan()` 函数（A → B 升级路径已在代码组织上预留）
- Codex plugin 活上游对比（通过 git clone marketplace.json 实现）
- Playwright e2e 上 CI（v0.1 已实现 e2e，本期只是不接 CI）

### 10.3 v0.3 候选

- preset / use-case grouping（"iOS dev 一键配齐"）
- 项目切换器（多 cwd 支持）
- hook 自定义配置 UI
- 离线模式 / "缓存模式"声明

### 10.4 已知缺口

- Codex plugin 期望版本依赖 CLI catalog 新鲜度——用户手动 `codex plugin marketplace upgrade` 超过 catalog 时会误报"已装"（良性偏差）
- Codex plugin 没有 `uninstall` 直接命令——`src/plugins.ts` 的 `uninstallPlugin` 对 Codex 端需要在实现时确认替代路径（手动改 `config.toml` + 删 cache 目录？）
- 多浏览器标签同时打开同一 UI URL：行为未定义。v0.1 假设单标签使用，多标签下心跳争抢不影响功能，但日志可能混

---

## 11 实现里程碑（参考）

> 仅为粗略时序参考，实际由 `writing-plans` skill 细化为 task plan

1. **M1：scanner + server 基础设施**
   - `src/state.ts` + `tests/state.test.ts`
   - `src/server.ts` 路由骨架 + 安全中间件
   - `tests/server.test.ts` + `tests/server-auth.test.ts`

2. **M2：UI 工程脚手架 + 视觉系统打底**
   - `ui/` Vite 项目初始化
   - 注入 `tokens.css` + `tailwind.config.ts`（DESIGN.md 全套 token）
   - 主页面骨架 + StateCard + ApplyBar 组件，**只用 token，不引入任何 token 外的颜色 / radius / spacing**
   - 字体接入：Inter / JetBrains Mono via Fontsource（Playwright e2e 友好，无 CDN 依赖）
   - Vitest 单测

3. **M3：installer uninstall + server apply 集成**
   - 各 installer 加 `uninstall*()`
   - `/api/apply` + SSE
   - `tests/server-apply.test.ts`

4. **M4：UI bundle 发布管线**
   - `src/ui-fetch.ts` + 测试
   - `release.yml` 改造
   - 完整发版演练（dry-run）

5. **M5：Playwright e2e + 联调**
   - `tests/web-ui-e2e.test.ts` + HOME 重定向脚手架 + canary
   - `package.json` 加 `scripts.test:web-ui-e2e`
   - 端到端跑通 install + update + uninstall × workflow + skill + plugin + hook 几条主路径

6. **M6：UI polish pass（`make-interfaces-feel-better`）**
   - 强制调用该 skill 做最后一公里打磨
   - 关注：hover / focus / active 三态 + empty / loading / error 三态 + 微动效（仅 transition-colors 60-120ms，符合 DESIGN.md "无阴影 / 无渐变"语言）
   - 键盘可达性 + focus ring（light surface 用 #3d3d3a，dark surface 用 #e8e6dc）
   - 极端场景目检：长 item 名截断、多 hook 滚动、离线 banner 叠加

7. **M7：文档收尾**
   - README 中英更新
   - CLAUDE.md（dev guide）补"如何跑 e2e"
   - 收尾打磨

> 不附工时估算——里程碑只表达**顺序与拆分粒度**，实际投入由实现 Agent 与人按当下节奏判断。

---

## 12 页面布局

整页结构自上而下：

1. **Top Bar**（surface `--color-ivory-medium`，68px 高，全宽 sticky）
   - 左：wordmark `AURIGA-CLI`（Anthropic Sans 16/700）+ 紧跟 cwd 路径标签
     - cwd 标签前置 `CWD ▸` 小型 clay-border 胶囊，路径正文用 Anthropic Mono 13px / `--color-slate-dark`（早期版本用 cloud-dark 12px，对比度太弱不易被注意到，已经升级）
   - 右：marketplace 健康徽章（单个几何 dot + 文本标签，遵守 §13.4 "无 chip" 规则）+ 设置入口

2. **Dashboard Kanban**（surface `--color-ivory-light`，居中 max-width 1440px）—— 6 列 CSS Grid：
   - **左 5 列** = 类目（顺序与 [§6.2 StateReport](#62-关键类型) 一致）：Workflow → Skills → Recommended Skills → Plugins → Hooks
   - **第 6 列（右 rail，320px）** = **LogPanel / OUTPUT 列**
   - 类目列每列顶部一个 column header：类目名 + 当前 scope/lang 下拉（scope 列：Skills / Recommended / Plugins / Hooks，下拉值 = `project | user`；Workflow 列：lang 下拉 = `EN | zh-CN`）
   - 类目列下方按 ItemStatus 排序堆叠 [State Card](#135-关键组件映射)（紧凑行，~40px 高），gap 4px
   - **响应式**：≥1440px 6 列原状；1024–1439px 类目 5 列 + LogPanel 折到下一整行；640–1023px 类目 2 列 + LogPanel 占满；<640px 单列纵向堆叠。

3. **LogPanel / OUTPUT 列**（右 rail，替代早期设计的"Sticky 底部 Action Bar"）
   - 列头："OUTPUT" + 当前 pending 数量徽章
   - 中段：滚动日志缓冲（Anthropic Mono 11px），按 `ProgressEvent` 实时推。**位置感知 auto-scroll**：用户在底部 → 跟随；用户向上滚 → 不劫持
   - **Destructive Banner**：pending 中含 uninstall 时，OUTPUT 列上方插入 `--color-accent-ember` 警示条
   - 列脚：左 `CANCEL` ghost 按钮（pending=0 或 applying 时禁用）+ 右 `APPLY (n)` primary 按钮（destructive batch 时变 ember 色 + 标签变 "APPLY (DESTRUCTIVE)"）
   - **Apply 前的双重确认**：workflow uninstall = 两次 `window.confirm`（spec §13.5），其它 uninstall = 一次 `window.confirm` 列出待删项；纯 install/update 不需要确认
   - **Cancel 前的确认**：pending > 0 时弹一次 `window.confirm`，applying 时 Cancel 是 no-op（in-flight abort 待 v0.2 加 server-side `/api/cancel`）

**不出现的元素**：sidebar、mega-menu、hero band、footer chrome、decorative imagery、emoji——与 DESIGN.md "text-dominant" + §13 "三态徽章纯文字" 风格一致；早期设计中的"Sticky 底部 Action Bar"已被右侧 LogPanel 替代，Layout 仍保留 `bottomBar` 槽位作为未来通用挂载点。

**响应式**：v0.1 桌面优先（1024px+ 体验最佳）。窄到 ~640px 仍可用（单列堆叠），但移动端 polish 推迟到 v0.3。

---

## 13 视觉风格与 UI polish

### 13.1 视觉系统 of record

[`docs/design/anthropic-style-reference.md`](../design/anthropic-style-reference.md)（385 行）是本期 UI 的视觉真值源。该文件从外部 Anthropic style reference 复制入仓，遵循 [Harness Principles](../../CLAUDE.md) 的 "repo as truth"。

实现路径：

- `ui/src/styles/tokens.css`：把 DESIGN.md `:root` 块的 CSS 变量全量注入
- `ui/src/styles/index.css`：Tailwind v4 `@theme` 块直接列出 token；同文件还包含 `.dashboard-grid` 响应式 grid 规则。Tailwind v4 不再需要 `tailwind.config.ts`

所有组件**只允许引用 token**（`var(--color-slate-dark)`、`text-heading-sm` 等），不允许在源码里 hardcode 任何颜色 / radius / spacing 值。lint 规则可考虑加 stylelint 拒绝 hex 字面量（v0.2 候选）。

### 13.2 我们取什么、不取什么

我们的 UI 是**工具型 dashboard**，不是 editorial 站点。从 DESIGN.md 取：

- 整套 token（colors / type scale / spacing / surfaces / radii）
- 0px 按钮 radius + 8px card radius 的硬边语言
- 无 shadow / 无渐变 / 用背景对比制造层次
- 单一 Clay (#d97757) 强调色，仅用于"有 pending 变更"的 apply CTA
- Anthropic Mono 用于 metadata 标签（hash、version、category）

**不取**：

- 91px display 尺寸的 Anthropic Serif（editorial 专用，dashboard 无 hero）
- 黑色 24px featureCards 的"contained inversion"——例外是 SSE 日志面板，下面 §13.5 说
- 三角形 underline emphasis 机制（headline 专用，dashboard 无 hero headline）

### 13.3 字体策略

真 Anthropic 字体是私有产品。按 DESIGN.md 提供的 substitute：

| 角色 | 主字体 | substitute | 接入方式 |
|---|---|---|---|
| UI chrome | Anthropic Sans | **Inter** | Fontsource self-host（npm 包），Playwright e2e 友好，无 CDN |
| 数据标签 | Anthropic Mono | **JetBrains Mono** | 同上 |
| editorial（v0.1 几乎用不到） | Anthropic Serif | Playfair Display | 仅 empty state 大标题等极少处考虑 |

### 13.4 三态徽章视觉编码

DESIGN.md：「metadata labels are pure text with no chip/pill/capsule treatment.」三态徽章遵循同样原则——**纯文字标签 + 卡片背景层级**：

| 状态 | 徽章文字（Anthropic Mono 12px，uppercase） | 颜色 token | 卡片背景 token |
|---|---|---|---|
| 已装 | `INSTALLED` | `--color-cloud-dark` (#87867f) | `--color-ivory-light` (持平页面) |
| 可更新 | `UPDATE AVAILABLE` | `--color-clay` (#d97757，仅这里出现) | `--color-ivory-medium` (#f0eee6，"浮起") |
| 未装 | `NOT INSTALLED` | `--color-cloud-medium` (#b0aea5，更弱) | `--color-ivory-light` (持平) |
| 错误 | `ERROR` | `--color-accent-ember` (#c6613f) | `--color-ivory-medium` |

### 13.5 关键组件映射

| 组件 | 映射 DESIGN.md |
|---|---|
| Apply button | "Primary Nav Button (Try Claude)" — 0px 0px 8px 8px 非对称 radius 是 signature；激活时 sticky bar 包一层 Clay 边 |
| Cancel button | "Ghost Nav Button" — 0px radius，1px solid border |
| State card | "Release Card (Light)" — 8px radius, 31px padding, 背景按 §13.4 |
| Top bar | "Top Navigation Bar" — `#f0eee6`, height 68px。左 wordmark "AURIGA-CLI"，中间 cwd 路径（mono 标签），右 marketplace 健康状态徽章 |
| SSE 日志面板 | **唯一启用的 "Feature Card (Dark)"**：24px radius, `#141413` 背景，Anthropic Mono `#e8e6dc` 显示流式日志。理由：log 视觉上天然适合反相 dark surface |
| 二次确认 modal（卸载 workflow） | 半透明遮罩 + 中心 panel `#faf9f5` 16px radius；button 用 0px radius |

### 13.6 polish 流程

M6 阶段独立调 `make-interfaces-feel-better` skill，覆盖：

- **交互状态**：hover / focus / active 三态。DESIGN.md 没明说交互态，建议 hover = border 切到 `--color-slate-medium`，focus ring = `--color-slate-medium` (light) / `--color-ivory-dark` (dark)
- **载入/空/错三态**：每个 card 容器、每个 SSE 流面板都有这三态完整覆盖
- **微动效**：仅 `transition: colors 80-120ms ease-out`；不允许 transform / scale / blur 类（违反"无 shadow / 无渐变"语言）
- **键盘可达性**：tab 顺序、Enter / Space 触发、Escape 关 modal
- **极端场景**：长 item 名（CSS truncate + tooltip）、多 hook 滚动、离线 banner 与错误叠加
- **打印 / 高对比无障碍**：DESIGN.md 本身高对比，但 polish 阶段验证一遍

polish 完毕的验收：随机 3 个 fixture 项目走完 install + update + uninstall，所有交互在 hover / focus / loading / error 任一状态下都不出现 token 外的视觉元素，且 100% 通过键盘可达。

