# auriga-pr-guards plugin

把现有的 `pr-create-guard` 和 `pr-ready-guard` 两个 hook 从 auriga-cli 自家 hook registry 迁出，重打包成同时兼容 Claude Code 与 Codex 的插件。

## 为什么做

- 现状：两个 hook 通过 auriga-cli 自定义的 `.claude/hooks/hooks.json` registry 注册到用户 `~/.claude/settings.json`，**只服务 Claude Code**。
- Codex 的 hook 系统采用与 Claude Code 高度兼容的 schema（嵌套形状一致、`${CLAUDE_PLUGIN_ROOT}` 由 Codex 主动 mirror、stdin/stdout 契约一致）。
- 打包成插件后：
  1. 同一份脚本服务两个 Agent；
  2. 走 Agent 原生插件分发（`/plugin install` / `codex plugin marketplace add`），不再依赖 auriga-cli 自家 registry；
  3. auriga-cli 一侧少维护一类资源（hook registry 仅留 `notify`）。

## 验收标准

1. 新插件目录 `plugins/auriga-pr-guards/` 同时被 Claude Code 与 Codex 识别为合法插件。
2. 安装后，`gh pr create` 之后注入 PR body 摘要（headings + TODO 计数），两 Agent 均生效。
3. 安装后，`gh pr ready` 在以下任一情况阻断（exit 2 + stderr，文本一致），两 Agent 均生效：
   - 仓库根存在 `findings.md` / `progress.md` / `task_plan.md`；
   - `docs/superpowers/specs/*.md` 非空；
   - `docs/specs/*.md` 非空；
   - 当前分支有未推送的 commits 且命令未传 PR ref。
4. `gh pr ready` 通过时，Claude Code 注入 PR body 摘要；Codex 上 fail-open 不注入（已知差异，README 写明）。
5. auriga-cli 安装入口对齐：
   - Hooks 选择器不再列出 `pr-create-guard` / `pr-ready-guard`；
   - Plugins 选择器列出 `auriga-pr-guards`，可一键安装。
6. README.md / README.zh-CN.md 同步更新（hooks 表 -2 行、plugins 表 +1 行）。
7. `package.json` 版本号 bump 一档（触发原因：`.claude/hooks/hooks.json` 与 `.claude/plugins.json` 都是 CONTENT_FILES）。
8. plugin 脚本的单元测试搬到 repo-root `tests/pr-create-guard.test.mjs` 与 `tests/pr-ready-guard.test.mjs`，能被 `npm test` 入口运行（或在 `npm run test:e2e` 之外另起一个 npm script）。

## 不做的事

- 不修改 `pr-create-guard.mjs` / `pr-ready-guard.mjs` 的核心逻辑（只迁移路径，行为保持一致）。
- 不为这两个 hook 增加新 matcher / event / pattern。
- 不动 `auriga-go` 插件。
- 不为已经装过老 hook 的用户做自动迁移（团队内部使用，旧条目人工清理，无需 CLI 侧支持）。

## 已知差异

- **Codex 上 ready-guard 放行无摘要**：Codex 当前对 PreToolUse 的 `hookSpecificOutput.additionalContext` 解析但不生效（fail-open）。阻断功能完整，仅"放行时注入 body 摘要"在 Codex 上看不到。README 写明。

## 风险与对策

- **R1 Codex 严格校验 `if` 字段**：`hooks.json` 中 `if: "Bash(...)"` 是 Claude Code 专属。Codex 文档未声明对未知字段的处理。**对策**：实现阶段在 Codex 上跑一遍；若拒绝，则去掉 `if` 字段，靠脚本内部已有的 `gh pr ...` 子串校验兜底（每次 Bash 多拉一个 1ms-exit 子进程，可接受）。

## 交付物（文件层面）

新增：

```
plugins/auriga-pr-guards/
  .claude-plugin/plugin.json
  .codex-plugin/plugin.json
  hooks/hooks.json
  scripts/pr-create-guard.mjs       # 从 .claude/hooks/pr-create-guard/index.mjs 搬
  scripts/pr-ready-guard.mjs        # 从 .claude/hooks/pr-ready-guard/index.mjs 搬
  README.md
tests/pr-create-guard.test.mjs      # 从 .claude/hooks/pr-create-guard/test.mjs 搬
tests/pr-ready-guard.test.mjs       # 从 .claude/hooks/pr-ready-guard/test.mjs 搬
```

修改：

```
.claude/hooks/hooks.json            # 移除 pr-create-guard / pr-ready-guard 两条
.claude/plugins.json                # 新增 auriga-pr-guards
.claude-plugin/marketplace.json     # 新增 auriga-pr-guards（Codex 也读这份）
README.md / README.zh-CN.md         # hooks 表 -2 行、plugins 表 +1 行
.claude/CLAUDE.md                   # 插件清单更新、移除两个旧 hook 的开发说明
package.json                        # version bump
tests/hooks.test.ts                 # 删除 pr-* 相关 case
```

删除：

```
.claude/hooks/pr-create-guard/      # 整个目录
.claude/hooks/pr-ready-guard/       # 整个目录
```

## 后续工作流锚点（供下一阶段 Agent 引用）

- 此 spec 的验收标准 → 推进 TDD 阶段时的 acceptance bullets。
- "已知差异 + R1 对策"两节 → 实现阶段在 Codex 上联调时的 checklist。
- "交付物"清单 → Pre-coding / 实现阶段的文件级 todo。
