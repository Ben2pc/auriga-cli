# auriga-cli 详细开发指南

> 这是 auriga-cli 开发的详细参考。仓库入口的简版说明在根目录 `AGENTS.md`。

## 这是什么

Interactive CLI（`npx auriga-cli`），用于模块化安装 Claude Code harness 组件：Workflow、Skills、Recommended Skills、Plugins。`install --preset` 是一键式“workflow core”入口（workflow 文档 + workflow skills + auriga-workflow plugin）。

## 架构

```
src/
  cli.ts        — 入口。parseArgs（非交互）+ 旧式 TTY 菜单 + 分级退出码（0/1/2）
  guide.ts      — `npx auriga-cli guide` 的 SOP 输出（Agent bootstrap）
  help.ts       — `--help` 渲染器，读取构建期 catalog
  catalog.ts    — Catalog 类型 + loadCatalog()（读取 dist/catalog.json）
  types.ts      — 共享的叶子类型（CategoryName、CATEGORY_NAMES）；放在 cli.ts 之外，避免 help.ts 反向依赖入口文件
  build/
    generate-catalog.ts — 构建期：解析 SKILL.md + plugin configs → dist/catalog.json
  codex-plugin-config.ts — Codex plugin manifest/config 校验 + 安全的本地路径辅助函数
  utils.ts      — 常量、远程 fetch、exec、日志、InstallOpts、getPackageRoot
  workflow.ts   — AGENTS.md + CLAUDE.md 兼容软链安装。Install/upgrade 使用 managed-block splice（五种情况：fresh / marked-upgrade / hand-edited-block / foreign / old-format migration），不是整文件覆盖。非交互模式下失败会抛错。还导出 `uninstallWorkflow({force, cwd})`，供 Web UI 的 /api/apply 路由使用。
  workflow-markers.ts — AGENTS.md managed-block marker 约定的单一真源（`<!-- AURIGA:WORKFLOW:v1 START/END -->`）。导出 parseMarkers / composeMarkedFile / hashBlock / hasAurigaHeader / WORKFLOW_HEADER_RE。这里不能有重量级 import，因为 workflow.ts 和 state.ts 都要用它（state.ts 不能 import workflow.ts，后者会拉入 @inquirer/prompts）。
  skills.ts     — Workflow + recommended skills 的安装；导出 WORKFLOW_SKILLS 和 `uninstallSkill(name, opts)`
  plugins.ts    — Plugin + marketplace 安装；导出 `uninstallPlugin(id, agent, opts)` 和 `excludeByName`（TUI「其他插件」过滤器）
  preset.ts     — `installPreset(packageRoot, opts)` — 负责编排 curated preset（workflow 文档 + workflow skills + auriga-workflow plugin）；供 CLI `--preset`、TUI 和 Web UI apply handler 复用
  api-types.ts  — `src/server.ts` 与 `ui/` 之间共享的 TS 类型（StateReport、ApplyRequest、ProgressEvent…）
  state.ts      — `scanState(projectRoot, catalog)` — `/api/state` 的按类别、仅 presence 的扫描器（3 种状态：installed / not-installed / partial-install；v1.19.0 去掉了 update-available——重新安装就是更新路径）
  scan-catalog.ts — 构建期 catalog → runtime ScanCatalog 适配器（消耗烘焙进来的 plugin agent map 和 plugin external 标志，来自 dist/catalog.json；不再包含 version / hash / event 字段，v1.19.0 起如此）
  server.ts     — 本地 HTTP server（token + Origin 认证、SSE /api/progress、静态资源服务到 uiDir）。通过 `npx auriga-cli web-ui` 启动
  apply-handlers.ts — `buildDefaultApplyHandlers(ctx)` 将批量安装器按 `selected: [name]` 组织成逐项 ApplyHandlers。Web UI 的 CLI 模式会用它；测试会注入自己的 mock
  ui-fetch.ts   — 下载当前 CLI 版本对应的 `ui-bundle.tar.gz` + `.sha256`，用 SHA256 校验后解压到 `~/.cache/auriga-cli/ui-v<version>/`。LRU 驱逐保留最近 3 个版本。

ui/             — Vite + React 19 + Tailwind v4 子项目。构建产物作为 GitHub Release asset（ui-bundle.tar.gz）发布——release.yml 在 tag push 时构建并上传。CLI 通过 ui-fetch.ts 按需拉取。
                    src/components/  TopBar / Layout / StateCard / LogPanel
                    src/pages/Dashboard.tsx
                    src/styles/tokens.css     Anthropic visual tokens（见 docs/design/anthropic-style-reference.md）
                    src/styles/index.css      Tailwind v4 @theme + base
                    src/lib/api.ts            fetch wrapper（token 来自 URL `?token=`）
                    vite.config.ts            dev proxy /api → http://127.0.0.1:4747（changeOrigin: false）

tests/web-ui-e2e.test.ts — Hermetic 的端到端 harness，用于 `npx auriga-cli web-ui`。它会在 HOME 重定向的 scratch dir 中启动真实 CLI，访问 /api/state + /api/apply，断言 scratch 中的文件系统副作用，并验证真实 $HOME 没被碰到（canary）。不属于 `npm test`，请用 `npm run test:web-ui-e2e` 执行。

plugins/
  auriga-workflow/
                  仓库自有的双 Agent plugin（Claude Code + Codex），
                  打包了所有 auriga 自有 workflow skill 以及强制工作流
                  的 git 生命周期 hooks。
                    .claude-plugin/plugin.json  (Claude Code manifest)
                    .codex-plugin/plugin.json   (Codex manifest)
                    skills/incremental-impl/SKILL.md
                    skills/test-designer/SKILL.md
                    skills/spec-design/SKILL.md  (+ references/)
                    skills/session-compound/
                    skills/arch-design/SKILL.md  (+ references/)
                    skills/code-simplify/SKILL.md (+ references/)
                    skills/goalify/SKILL.md      (通过 Claude Code 内置
                                                 /goal 命令规划 goal 并分发)
                    skills/deep-review/          (PR review orchestrator +
                                                 references/reviewers/<name>.md
                                                 每个维度一个 reviewer 文件)
                    skills/reviewer-creator/     (在 docs/rules/review/ 下
                                                 脚手架生成项目级自定义 reviewer)
                    skills/git-workflow/SKILL.md (git 生命周期 skill)
                    hooks/hooks.json            (PreToolUse + PostToolUse，
                                                 共享结构；使用
                                                 ${CLAUDE_PLUGIN_ROOT}，Codex
                                                 也刻意镜像它以保证开箱兼容)
                    scripts/commit-reminder.mjs (PostToolUse:
                                                 Edit|Write|MultiEdit|apply_patch
                                                 — 同时覆盖 Claude Code 的
                                                 tool 名和 Codex 的标准
                                                 file-edit 名 `apply_patch`)
                    scripts/pr-create-guard.mjs (PostToolUse: gh pr create)
                    scripts/pr-ready-guard.mjs  (PreToolUse: gh pr ready +
                                                 非 draft 的 gh pr create)
                    scripts/pr-merge-guard.mjs  (PreToolUse: gh pr merge —
                                                 在 PR body 的 Acceptance
                                                 criteria 里还有未勾选项时阻止)
                  由原先的 auriga-go（仅 goalify）、deep-review 和
                  auriga-git-guards plugin 合并而成。Codex 支持 hook
                  `additionalContext`；block path 完全一致。
                  commit-reminder 和 pr-create-guard 已达到完整 parity。
                  自有 skills 不带任何 `.agents/skills/<name>` 或
                  `.claude/skills/<name>` 软链——plugin 打包的 skills 通过
                  plugin 的 marketplace + `skills:` manifest 字段发现。
  auriga-notify/ Claude Code-only 的可选通知 plugin。
                    .claude-plugin/plugin.json
                    hooks/hooks.json
                    scripts/notify.mjs
                    scripts/test-notify.mjs
                    defaults/config.json
                    assets/icon.png
                  旧的 `.claude/hooks/notify/` 安装会在插件安装成功后由
                  plugins.ts 迁移。
  session-instructions-loader/
                  仅供 Codex 的 plugin。
                    .codex-plugin/plugin.json   (Codex manifest)
                    hooks/hooks.json            (SessionStart)
                    scripts/session-start.mjs   (注入祖先 AGENTS.md 文件
                                                 以及仓库配置的额外 instruction files)
.claude-plugin/
  marketplace.json — 本仓库的 Marketplace manifest；列出
                     auriga-workflow + auriga-notify，供 Claude Code 使用。

.agents/plugins/
  marketplace.json — 本仓库的 Codex-native Marketplace manifest；列出
                     auriga-workflow + session-instructions-loader。
                     如果存在，Codex 优先使用这个 repo-scoped 文件，
                     而不是回退到 Claude-style marketplace。

extra_plugin_configs.json
  Auriga CLI plugin overlay，供外部 plugins 和本地默认策略覆盖使用。
  本地仓库 plugin 只来自上面的标准 marketplaces。
  只有上游拥有的 plugin 或像 `defaultOn` 这样的字段才加到这里。

tests/
  skills.test.ts        — skill planner 单元测试
  catalog.test.ts       — 构建期 catalog 结构 + description 覆盖测试
  cli-parse.test.ts     — parseArgs 矩阵（spec §3.5 / §5.2）
  install-nontty.test.ts — 非交互 install 分发 + 分级退出
  preset.test.ts        — `--preset` parse / dispatch / 分级退出；`--all` 包含 recommended
  legacy-menu.test.ts   — TUI 三项菜单契约 + excludeByName 过滤器
  guide.test.ts         — renderGuide snapshot + ANSI 分支
  validators.test.ts    — validateSkillsLock / validateExtraPluginConfigs
  entrypoint.test.ts    — dist/cli.js 符号链接 bin guard 回归
  e2e-install.test.ts   — tarball → npm install → auriga-cli install（网络 + 本地，走 npm run test:e2e，不在 `npm test` 内）
  commit-reminder.test.mjs — plugins/auriga-workflow/scripts/commit-reminder.mjs 的 smoke tests
  pr-create-guard.test.mjs — plugins/auriga-workflow/scripts/pr-create-guard.mjs 的 smoke tests
  pr-ready-guard.test.mjs  — plugins/auriga-workflow/scripts/pr-ready-guard.mjs 的 smoke tests
  pr-merge-guard.test.mjs  — plugins/auriga-workflow/scripts/pr-merge-guard.mjs 的 smoke tests
```

- 没有 CLI framework——非交互路径自己手写 `cli.ts` 里的 `parseArgs`；TTY 菜单使用懒加载的 `@inquirer/prompts`
- 运行时内容从 GitHub 获取（`fetchContentRoot()`）
- `withEsc()` 包装所有 prompts，以支持 ESC 取消
- 安装器（`workflow.ts` / `skills.ts` / `plugins.ts`）在 `opts.interactive === false` 时，失败会 **抛出**；交互路径则保留“记录日志并继续”，这样 TTY 菜单可以在原地展示错误，而不会中断整个菜单

## 关键约定

- **Skill 分类**：`skills.ts` 里的 `WORKFLOW_SKILLS` 是通过 `npx skills add` 安装的外部 workflow skills 的 curated 默认启用集合。`skills-lock.json` 里的其他内容都属于“recommended”（按需启用工具）。auriga-cli 自有的 workflow skills 现在放在 `plugins/auriga-workflow/`，通过 plugin 路径安装。
  - **从外部仓库添加 workflow skill**：先在上游编写 `SKILL.md` 并完成 PR merge → `npx skills add <repo> --skill <name> --agent claude-code codex --yes`，更新 `skills-lock.json` 并填充 `.agents/skills/` → 把名字加到 `src/skills.ts` 的 `WORKFLOW_SKILLS` 数组 → 在两个 README 的 skills 表里各加一行 → 如果这个 skill 取代了某段 prose，再在相关 `AGENTS.md` 步骤里引用它。**不要直接编辑 `.agents/skills/<name>/SKILL.md`**——它由 `npx skills add` 生成，重新同步时会被静默覆盖。若要在上游 merge 后刷新外部 skill，**按 skill 逐个重新执行 `npx skills add <repo> --skill <name>`**（不要跑 `npx skills update --project`），这样只会影响你真正想更新的那个 skill。
  - **编辑 auriga-cli 自有的 workflow skill**（`incremental-impl`、`session-compound`、`test-designer`、`spec-design`、`arch-design`、`code-simplify`）：编辑 `plugins/auriga-workflow/skills/<name>/` 下的源文件。自有 skills **不带** `.claude/skills/<name>` 或 `.agents/skills/<name>` 软链——plugin-bundled skills 通过 plugin 的 marketplace + `skills:` manifest 字段发现。不要把自有 skill 名字加回 `skills-lock.json` 或 `WORKFLOW_SKILLS`；面向用户的安装入口是 `auriga-workflow` plugin。若某次编辑改变了 skill 的**输出契约**（它会产出给下游 skill 消费的文件 / 字段 / 内容），要在同一次变更里更新它的 consumer skills——自有 skills 是一条流水线（`spec-design` → `test-designer` / `deep-review` → `incremental-impl`），契约变化如果不向下游传播，就会变成跨 skill drift（PR #119：`validation-contract.md` 里新增的 `## Toolchain` 表格，差点和 `test-designer` 的 SKILL.md 里“从头扫描测试栈”的旧说明一起发出去——最后靠 deep-review 才拦住）。
  - **添加新的自有 workflow skill**：在 `plugins/auriga-workflow/skills/<new-name>/` 下新增，带上自己的 `SKILL.md`（如果 body 预计会超过 ~500 行，可再加 `references/` 做 progressive disclosure）。**不要** 在 `.claude/skills/` 或 `.agents/skills/` 下创建软链——plugin manifest 才是标准发现路径。更新 `auriga-workflow` plugin manifests（Claude + Codex 两份）以及 `.claude-plugin/marketplace.json` 里的 `auriga-workflow` description，这样新 skill 才会进入 `dist/catalog.json`。只有当这个 skill 成为 workflow contract 的一部分时，才更新产品 workflow templates。
  - **添加 recommended skill**：`npx skills add <repo> --skill <name>` 就够了——它的 `SKILL.md` frontmatter `description` 会在构建时被 `src/build/generate-catalog.ts` 读出并写入 `dist/catalog.json`，这会驱动 `--help` 输出和交互菜单。不要在代码里手工维护 description 列表。
    - **优先走 plugin 路径的情形**：在上游如果已经以单 skill plugin 的形式发布，先检查 upstream repo——如果它分发的是一个只包含这一个 skill 的 plugin（也就是 `.claude-plugin/plugin.json` / marketplace entry，其 `skills/` 只解析到这个 skill），就改为在 `extra_plugin_configs.json` 里把它注册成 external plugin。Plugin marketplace 自带真实的 version + upgrade 语义（`claude plugins update`、固定版本）；`npx skills add` 这条路会在安装时解析 upstream HEAD，没有版本 pin。这个规则只适用于干净的 **1:1** 场景——多 skill 的“skills library” plugins（`obra/superpowers`、`addyosmani/agent-skills`、`anthropics/skills` `example-skills`）不算，因为把单个 skill 通过它们路由会把其余内容也拖进来。以 [#131](https://github.com/Ben2pc/auriga-cli/issues/131) 的审计为准，当前没有任何 `skills-lock.json` 条目满足这个条件；这个规则面向**未来**新增项，不是对现有条目的迁移。
- **添加 auriga-cli 自有 plugin**（例如 `auriga-workflow`——skills + hooks——或 `auriga-notify`——只有 hooks）：在仓库根目录 `plugins/<name>/` 下编写。这个仓库本身就是真源。必需结构：`.claude-plugin/plugin.json`（元数据）、可选 `hooks/hooks.json` + hook scripts（标准 hook 示例见 `plugins/auriga-workflow/`）、可选 `skills/<skill-name>/SKILL.md`（可加 `references/`）。**`plugins/<name>/` 里的所有内容都会发给用户**——开发专用资源（tests、generators）要放在仓库根目录的 `tests/`。然后：注册到 `.claude-plugin/marketplace.json`（`"source": "./plugins/<name>"`）。如果该 plugin 也要面向 Codex，再注册到 `.agents/plugins/marketplace.json`，并补 `.codex-plugin/plugin.json`。`extra_plugin_configs.json` 只用于像 `defaultOn` 这样的策略覆盖，不作为本地 plugin 的真源。用户通过 `npx auriga-cli` → Plugins 安装。
  - **双 Agent 版本（Claude Code + Codex）**：Codex 的 hook system 与 Claude Code 兼容 schema（`hooks.<Event>[].matcher + hooks[]` 结构，`${CLAUDE_PLUGIN_ROOT}` 也被 Codex 刻意镜像，以便开箱兼容，stdin/stdout 合同一致）。要把 plugin 同时注册到两个 marketplace：Claude Code 用 `.claude-plugin/marketplace.json`，Codex 用 `.agents/plugins/marketplace.json`。另外再加一份 `.codex-plugin/plugin.json`，写入 Codex 特有的更丰富 schema（`version`、`homepage`、`repository`、`license`、`keywords`、带 `displayName` / `category` / etc. 的 `interface` block）；`.claude-plugin/plugin.json` 保持最小，但也要镜像 `version`，方便升级比较器使用。`hooks/hooks.json` 内容相同，`scripts` 相同，README 也相同——canonical 示例见 `plugins/auriga-workflow/`。Codex 支持 hook `additionalContext`；block path（`exit 2 + stderr`，或 `permissionDecision: "deny"`）的行为完全一样。Claude-Code-only 的 `if: "Bash(...)"` 过滤在 `hooks/hooks.json` 里仍保留（Codex 文档并不会因为通用 JSON registry 行为而拒绝未知字段）；如果未来 Codex 版本严格校验并拒绝 `if`，就删掉它，改成 script 内部做 substring 检查即可（不会有行为回退——scripts 本来就会自己校验命令是否匹配）。
- **添加 external-marketplace plugin**（由其他 GitHub repo 维护，而本 CLI 只是注册）：本仓库里不维护 plugin 源码——plugin 仍在上游，我们只把它注册到 `extra_plugin_configs.json`。对 Claude Code，要设置 `claude.package`，如果 marketplace 还没被知晓，再设置 `claude.marketplace`。对 Codex，要设置 `codex.marketplace`；auriga-cli 会先跑 `codex plugin marketplace add https://github.com/<source>.git`，再用 `codex plugin add <plugin>@<marketplace>` 安装。`marketplace.{name, source}` 的结构通过 `src/marketplace.ts` 里的 `validateMarketplaceField` 复用。**构建时不要去抓 upstream manifest**——对 external entries，`src/build/generate-catalog.ts` 直接使用 extra config 里的 description，因为上游的 Codex manifest 可能不存在，或者可能由下游 CLI 解析。
- **plugin-bundled hooks**：通过 `plugins/<name>/hooks/hooks.json` 注册 hooks，并使用 `command: "${CLAUDE_PLUGIN_ROOT}/..."`。这个替换在 `claude -p` 和交互模式下都稳定生效（已实测）。通过 `SKILL.md` frontmatter 的 `hooks:` 字段也能注册 hook，但 `${CLAUDE_SKILL_DIR}` 目前**不会**在 hook command 字符串里展开（这是 Claude Code bug），而且 hook 的 cwd 是项目根目录，不是 skill 目录，所以文档里的 `./scripts/...` 示例也会失败。需要 hook 时的 workaround 是：把 skill 打包进 plugin，再把 hook 提到 plugin 根目录（canonical dual-Agent 示例见 `plugins/auriga-workflow/`）。不要为了新 hooks 重新引入根目录的 `.claude/hooks/hooks.json`；未来的 hooks 应该跟着 plugins 一起分发。
- **Plugin 配置**：`.claude-plugin/marketplace.json` 和 `.agents/plugins/marketplace.json` 定义本地 plugin surface。`extra_plugin_configs.json` 定义 external plugins 和本地默认策略覆盖。
- **Hook 配置**：仓库自有 hooks 通过 plugin 的 `plugins/<name>/hooks/hooks.json` 分发，不再有 CLI 可安装的 `hooks` 类别。`auriga-notify` 的迁移就是一个 Claude Code-only hook plugin 带用户配置迁移的参考形状。
- **Agent 可移植性**：skills 和 plugins 是给不同 coding agent 的队友用的（Claude Code / Codex / Gemini）——`auriga-workflow` plugin 明确是双 Agent。编写或修改 `plugins/<name>/` 下内容时，不要让 prose 或 tooling 默认假设 agent 是 Claude Code：例如写成“Claude 专属”的泛化表述、只写 Claude-only tool 名而不写 Codex 对应物、把共享能力误归到某一个 agent，或者在项目指令里只写 `CLAUDE.md` 而不写 `AGENTS.md`。完整清单见 [`docs/rules/agent-portability.md`](../rules/agent-portability.md)。
- **子进程调用**：使用 `exec()` wrapper，流式输出时用 `{ inherit: true }`。
- **面向用户的输出**：统一使用 `log.ok/warn/error/skip`，保证颜色风格一致。

## 命令

```bash
npm run build    # tsc → dist/，然后 node dist/build/generate-catalog.js → dist/catalog.json
npm run dev      # tsc --watch
npm start        # node dist/cli.js
DEV=1 npm start  # 使用本地文件，而不是从 GitHub 获取

npm test         # tsc -p tsconfig.test.json → dist-test/，然后 node --test
                 #   单元 + 集成测试在 tests/ 里。测试文件白名单手工维护在 package.json 的
                 #   `test` / `test:watch` scripts 里——新增测试文件时要把它们加进去。

npm run test:e2e # 完整的 tarball install e2e（约 90-120s）。会打包真实的 npm
                 # tarball，安装进 scratch project，在 GitHub content 上运行
                 # `auriga-cli install`，并把内容 pin 到 HEAD SHA。pretest hook 会先跑
                 # `npm run build`，确保 tarball 始终反映当前 src/。需要 HEAD 已推送
                 # （否则 preflight 会跳过）；`plugins` 和 `--all` 场景还要求 PATH 上有
                 # `claude` CLI。它不属于 `npm test`——因为它依赖网络且很慢。切 release tag
                 # 前要跑。

npm run test:git-guards
                 # `plugins/auriga-workflow/scripts/*.mjs` 的 smoke tests
                 #（commit-reminder + pr-create-guard + pr-ready-guard
                 # + pr-merge-guard）。
                 # 纯 Node，不是 node:test 框架，所以作为单独的 npm script，
                 # 而不是挂进 `npm test` 的 TS suite。修改
                 # `plugins/auriga-workflow/scripts/` 或该 plugin 的
                 # `hooks/hooks.json` 前要跑。

npm run test:session-instructions-loader
                 # `plugins/session-instructions-loader/scripts/session-start.mjs` 的 smoke tests。
                 # 修改该 plugin 的 SessionStart hook 或 Codex marketplace metadata 前要跑。

npx skills update --project
                 # 刷新所有外部 vendored skill 的上游来源
                 #（写入 skills-lock.json + .agents/skills/<name>/SKILL.md）。
                 # 上游 PR merge 之后运行。不会自动 commit 或 push。
```

## Web UI 手动验证

在 PR Ready 之前（并且在合并前再次执行），凡是改动 `src/state.ts`、`src/scan-catalog.ts`、`src/server.ts`、`src/api-types.ts`、`src/build/generate-catalog.ts`、`ui/`，或者任何流向 `dist/catalog.json` / runtime content fetch 的输入（`AGENTS.template.*.md`、`.claude-plugin/marketplace.json`、`.agents/plugins/marketplace.json`、`extra_plugin_configs.json`、`skills-lock.json`、`plugins/<name>/.claude-plugin/plugin.json`、`plugins/<name>/.codex-plugin/plugin.json`、plugin `hooks/hooks.json`），都要从三个 project root 启动已安装的 `web-ui`，并逐行肉眼检查。自动化的 `tests/tarball-shape.test.ts` 只覆盖构建期 tarball-shape 契约；这个手动步骤覆盖的是在真实安装状态下的 runtime 行为，没法靠单元测试为每种 project shape 都构造完整 hermetic fixture。

1. `~/` —— 暴露 scope boundary 的边角情况（例如 `<proj>/.claude/CLAUDE.md` 折叠到 `$HOME/.claude/CLAUDE.md`）
2. `~/Workspace/`（或者任何不是 auriga-cli 父目录的位置）——“什么都没安装”的基线状态
3. 当前 repo 目录——完全安装好的开发态

每个 root 的操作流程：

```bash
cd <test-root>
nohup npx -y auriga-cli@<version> web-ui --no-open > /tmp/auriga-web-ui.log 2>&1 &
sleep 6
TOKEN=$(grep -oE 'token=[a-f0-9]+' /tmp/auriga-web-ui.log | head -1 | cut -d= -f2)
curl -s "http://127.0.0.1:4747/api/state?token=$TOKEN&projectRoot=$PWD" | python3 -m json.tool
# UI view: http://127.0.0.1:4747/?token=$TOKEN
pkill -f 'auriga-cli web-ui'
```

逐行检查项：workflow 的 `status` 要反映磁盘真实状态（AGENTS.md 存在 ⊕ auriga header 存在——“有文件但没 header”不能悄悄算成 `installed`），plugin 的 `agents` map 要正确，upstream-owned plugins（skill-creator / claude-md-management / codex）要标 `external: true`，双 Agent 的 partial installs 要以 `partial-install` + `missingAgents` 呈现，顶部的 `warnings[]` 在 AGENTS.md / settings.json 存在但 foreign 时要有内容。自 v1.19.0 起，卡片里不再显示 version string（重新安装就是更新路径）。

如果是未发布的工作（还没有公开 version），把 `npx auriga-cli@<version>` 换成本地打包的 tarball（`npm pack --pack-destination /tmp` → 安装到 scratch prefix → 从那个 bin 运行 `auriga-cli web-ui`）。不要直接在 repo 里跑 `node dist/cli.js web-ui`——那会绕过 tarball boundary，把整个 `runtime-reads-non-shipped-paths` bug 类藏起来（这正是 v1.18.x 的回归系列）。

## 手动 e2e 探针卫生

对 scratch project 运行 `auriga-cli install` 的手动 e2e 探针——`install --preset`、`install plugins`，或者任何会走到 `claude plugins install` / `codex plugin marketplace add` 的操作——会修改**真实的全局** agent state：Claude plugin registry 在 `~/.claude`，Codex 在 `~/.codex/config.toml`。`--scope project` 只能把*文件*限制在 scratch dir 里（AGENTS.md / skills 会落到 scratch 目录下）；plugin registry entry 仍然是**全局**的，按项目绝对路径做 key。所以只 `rm -rf <scratch-dir>` 并不能撤销安装——它只会留下一个指向已删除目录的 plugin registry entry（`claude plugins list` 还会继续显示它）。

手动探针时，二选一：

- **把 probe 的 HOME 重定向**（`HOME=/tmp/<scratch> <command>`），这样真实的 `~/.claude` / `~/.codex` 完全不会被碰到——这正是 `tests/web-ui-e2e.test.ts` 的做法（hermetic，带 canary 校验），也因此不需要额外清理步骤。
- **显式卸载**作为清理步骤，再删 scratch dir：`claude plugins uninstall <id> --scope project`（在 scratch dir 里执行——project scope 按 cwd 解析），如果用了 `--agent codex|both`，再执行对应的 Codex 删除。

`rm -rf` scratch directory 本身，不能算任何触碰过全局 agent registry 的操作的清理。

## 数据源

| 文件 | 维护方式 | 用途 |
|------|--------------|------|
| `skills-lock.json` | `npx skills` CLI | 外部 skill registry（不要手动改结构）。同步后生成的 `.agents/skills/<name>/SKILL.md` 也是生成物——不要直接编辑。auriga-cli 自有 workflow skills 放在 `plugins/auriga-workflow/`，不要再加回 lock |
| `plugins/<name>/` | 手动 | auriga-cli 自有 plugin 源码（例如 `plugins/auriga-workflow/`）。通过仓库根目录的 `.claude-plugin/marketplace.json` 分发。目录内的一切都会发给用户——开发专用资源（tests）放到仓库根目录 `tests/` |
| `.claude-plugin/marketplace.json` | 手动 | 本仓库发布给 Claude Code 的 plugin Marketplace manifest |
| `.agents/plugins/marketplace.json` | 手动 | 本仓库发布给 Codex 的 plugin Marketplace manifest |
| `extra_plugin_configs.json` | 手动 | external plugin registry 和默认策略覆盖 |
| `dist/catalog.json` | `npm run build`（经由 `src/build/generate-catalog.ts`） | workflow skills / recommended skills / plugins 的构建期 catalog——只含 name + description。它是 `--help` 输出和非交互过滤器名称校验的真源，会随 npm tarball 一起发出。只要改了任何 `SKILL.md` frontmatter、plugin marketplace/config、plugin manifest，或 plugin `hooks/hooks.json`，都要重新生成。 |
| `AGENTS.template.zh-CN.md` / `AGENTS.template.en.md` | 手动 | Workflow templates（产品本体）。**必须成对编辑**——两个语言版本必须同步 |
| `README.md` / `README.zh-CN.md` | 手动 | 公共文档。**必须成对编辑**——两个语言版本必须同步 |

## 版本与发布

- `package.json` 里的版本遵循 semver：bugfix 用 patch，新功能用 minor，breaking change 用 major。
- **提升规则**：在发布**用户可见状态**之前，先 bump CLI version（`package.json`）。通常这个 bump 会落在同一个 PR 里；如果用户明确要求把 bump 拆到一个发布前的后续 PR，要在 PR risk section 里写清楚，并在 release tag 存在前保持 runtime 兼容。
  - **触发 bump 的内容**（命中任一项即可）：
    - `src/` —— 会被重建到 `dist/`，并随 tarball 一起发出
    - `.claude-plugin/marketplace.json`、`.agents/plugins/marketplace.json`、`extra_plugin_configs.json` —— 这些既是 runtime 获取的 `CONTENT_FILES` 输入，也是 `dist/catalog.json` / install 行为的输入
    - plugin install surface 在 marketplace manifests 或 `extra_plugin_configs.json` 中的变化——这些决定 auriga-cli 提供或默认安装哪些 plugin
    - **`skills-lock.json` 的结构性变化**——新增 / 删除条目，或编辑 `source` / `skillPath`。这些会改变 auriga-cli 提供哪些 skills（`dist/catalog.json`）或者安装从哪里拉取。**仅 `computedHash` 漂移不是版本提升触发条件**（见下方豁免项）。
    - **`.agents/skills/<name>/SKILL.md` frontmatter 的 `description:` 变化**——构建时会写进 `dist/catalog.json`，驱动 `--help` 输出和交互菜单。body / scripts / hooks 的变化不算（见下方豁免项）。
    - `AGENTS.template.zh-CN.md` / `AGENTS.template.en.md` —— workflow templates，runtime 会获取
    - `README.md` / `README.zh-CN.md` —— 随 tarball 发出（npm 默认包含）；其中 `README.md` 会驱动 npmjs.com landing page
  - **豁免**（不需要 bump）：
    - `AGENTS.md` / `CLAUDE.md`（本仓库的 dev guide 和兼容软链——不发布、不获取）
    - `.claude/skills/<name>` 软链（仅供本仓库内的 Agents 使用；不发布、不获取）
    - `tests/`、`tsconfig*.json`、CI 配置（`.github/`）
    - `docs/`
    - `plugins/<name>/*` payload-only 变化——由 Agent plugin marketplaces 直接获取。Claude Code 用 `claude plugins marketplace update` + `claude plugins update`；Codex 用 `codex plugin marketplace add/upgrade` 刷新 marketplace snapshot，再用 `codex plugin add` 安装/更新 plugin（cache 物化与 config 写入都由 Codex CLI 负责）。因此 plugin payload-only 变化可以不经过 CLI 版本提升就传播；若 plugin 的 contract/content 真的变化，再提升 plugin 自己的 manifest version。
    - **外部 skill refresh——`skills-lock.json` 的 `computedHash` 漂移，以及 `.agents/skills/<name>/*` body/hooks/scripts 的变化**，前提是没有结构性 lock 字段变化，也没有 `SKILL.md` frontmatter `description:` 变化。`src/skills.ts` 的安装路径会输出 `npx -y skills add <source> --skill <name>`，它在安装时从 upstream HEAD 解析——auriga-cli 不会把用户锁到 lock 里的 `computedHash`。外部 skill 的内容新鲜度属于上游 repo（边界模型和 `plugins/<name>/*` 一样）；如果 contract 变化，就应在上游给外部 skill 自己 bump version。
  - **为什么**：runtime 会把 auriga-cli 自有的安装输入 pin 到 `v<package.version>`，而且 `dist/catalog.json` 在 tarball 里是冻结的。没有 version bump + tag，workflow templates、marketplace install surface、extra plugin config 或 CLI behavior 的变化，对 `npx auriga-cli` 用户来说都是不可见的（PR #57 就是那个破坏案例）。plugin payload 更新和 external skill 的 body/script 更新是两个例外——它们都各自有上游新鲜度通道（plugin marketplaces / `npx skills add` 到 upstream HEAD），所以可以不经过 CLI bump 传播。
- **发布流程（tag push 触发 CI publish）**：`src/utils.ts` 里的 `fetchContentRoot` 会把内容 pin 到 git tag `v<package.version>`，所以在用户可以 `npx auriga-cli@<version>` 之前，GitHub 上必须已经存在这个 tag。`.github/workflows/release.yml` 会强制这一点：它在 `push: tags: ['v*']` 时触发，checkout tag，校验 `tag == package.json version`（不一致就 fail loud），运行 unit → git-guards → e2e tests（每一步的 `pretest*` hook 都会 rebuild `dist/`），然后 `npm publish --provenance`（OIDC + 显式 provenance attestation；需要 Node 24——Node ≤ 22 自带的 npm 10.x 不支持 OIDC 握手），最后用 `gh release create --generate-notes` 同步发布 GitHub Release 和 npm artifact（会按 Conventional Commits 前缀自动分类；像 `v1.2.3-rc.1` 这样的 tag 会自动标成 prerelease）。只有所有 gate 都通过，publish + Release 才会执行。标准顺序是：在 PR 里 bump version → merge → `git tag v<version> && git push origin v<version>` → 交给 CI。现在不再手工 `npm publish` / create release。认证方式是 **npm Trusted Publishing (OIDC)**——不需要轮换 secret；workflow 用的是 GitHub 发的短期 OIDC token。npmjs.com 上的一次性配置路径：package page → Settings → Publishing → Add trusted publisher，绑定这个 repo 和精确的 workflow 文件名 `release.yml`。如果重命名 workflow 文件，publish 会失效，直到 npm 配置更新。开发时可以设 `AURIGA_CONTENT_REF=main` 绕过 tag pin。手工 `workflow_dispatch` 搭配 `dry_run=true` 会跑完整 pipeline 但不发布——改 workflow 时很有用。
- **两个版本各自独立变化**：`package.json` 是 **CLI tool** 版本（按上面的规则，只要 shipped state 变化就提升版本）。`AGENTS.template.zh-CN.md` / `AGENTS.template.en.md` 里的 workflow header（例如 `# auriga 工作流 (v1.5.0)`）是 **workflow content** 版本——当 workflow template 的 contract 变化时单独提升版本（步骤重排、原则改名等）。workflow template 里做个 typo fix 或 wording polish 仍然要提升 CLI version（因为这是用户可见改动），但不需要提升 workflow header。这两个版本号服务的对象不同：CLI version 回答“我运行的是哪个 tarball？”，workflow header 回答“我遵循的是哪个 workflow contract？”。

## 原则

- 保持简单——不要为一次性操作抽象出一层又一层。
- 主菜单顺序就是执行顺序：Workflow -> Skills -> Recommended Skills -> Plugins。TUI 把它们收敛成 3 个条目（Recommended preset / Optional skills / Other plugins）；非交互的 `install <type>` 仍然按四个类别分别处理。
- 全部使用 ESM（`"type": "module"`，import 里用 `.js` 扩展名）。
- **运行时读取必须只命中已发出的路径。** `package.json` 的 `files` 白名单只包含 `dist/*.js`、`dist/*.d.ts`、`dist/catalog.json`（再加上 npm 默认的 `README*` / `LICENSE` / `package.json`）。本仓库的其他所有内容——`plugins/<name>/`、`.claude/`、`.agents/`、`skills/`、`src/` 里的 TS 源码——在已安装的 npm tarball 里**不存在**。如果 runtime 模块在运行时解析到 `packageRoot/<something-not-in-the-allowlist>/`，对 npm 安装用户来说这个读取会悄悄失败（`fs.readFile` → ENOENT → 被捕获 → 行为降级）。开发环境会把这个 bug 藏起来，因为 `packageRoot === repoRoot`，仓库文件都在那里。任何 runtime 模块需要的非发出路径内容，都必须要么在构建期**烘焙进 `dist/catalog.json`**（必要时扩展 `CatalogEntry`），要么在它是 auriga-cli install 输入时**通过 GitHub runtime fetch**（由 `fetchContentRoot` pin 到 `v<package.version>`），要么在它是 plugin payload 时**从 Agent plugin marketplace 解析**（`claude plugins marketplace update` / `claude plugins update`；`codex plugin marketplace add/upgrade` 然后 `codex plugin add`）。不要把 plugin payload 文件加进 `CONTENT_FILES`；plugin freshness 属于 plugin marketplace，不属于 CLI tarball。验证方式是把 `npm pack` 生成的 tarball 解压出来，然后 grep 你以为 runtime 会读到的东西——*runtime 正确性是 tarball-shape 问题，不是源码树问题*。
  - 具体例子：plugin 的 agents map（例如 `auriga-workflow` 同时面向 Claude 和 Codex）是从 `.claude-plugin/marketplace.json`、`.agents/plugins/marketplace.json` 和 `extra_plugin_configs.json` 派生出来的——这些都在 tarball 白名单之外。`src/build/generate-catalog.ts` 在构建期读取它们，并把 `agents` 烘焙到每个 plugin 的 `CatalogEntry`；`src/scan-catalog.ts` 再消费这个已烘焙字段。`tests/catalog.test.ts` + `tests/tarball-shape.test.ts` 一起把这个契约钉死。历史说明：v1.18.x 还烘焙过一个 `expectedVersion` 字段，用来做 update-available 检测；v1.19.0 弃掉了这个 surface 并删除了该字段——回滚故事见 [`docs/worklog/worklog-2026-05-13-refactor-drop-update-status/web-ui-history.md`](../worklog/worklog-2026-05-13-refactor-drop-update-status/web-ui-history.md)。
