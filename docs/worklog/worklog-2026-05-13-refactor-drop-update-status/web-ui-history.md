# Web UI scanner — historical decisions around update-available detection

> **Status**: Archived 2026-05-13 when v1.19.0 deprecated the `update-available`
> status entirely. The decisions captured here were made in v1.18.2 → v1.18.4
> to support a surface that no longer exists; preserved here as historical
> context, not as live guidance. Current scanner contract lives in
> [`docs/architecture/web-ui.md`](../../architecture/web-ui.md).

---

## Why these decisions exist

Between v1.18.0 and v1.18.5 the scanner had to answer a hard question: "is the
user's locally installed plugin the latest version available?". Four patch
versions chased the edge cases of that question across the dev/prod npm
tarball boundary (#79, #84, #86, #88). v1.19.0 collapsed the surface by
making re-install the update path for every category — re-running install is
idempotent and overwriting, so there's no need for a separate update signal.

The records below predate that collapse.

---

## 真值源迁移（v1.16.0 → v1.16.1）

v1.16.0 读 auriga-cli **dev 仓库自己的清单文件**（`<cwd>/.claude/plugins.json`、
`<cwd>/skills-lock.json`、`<cwd>/.claude/hooks/hooks.json`），结果用户在普通项目
或 `~/` 下都看到「全 not installed」。v1.16.1 全部换成 Claude Code 实际安装位置
（`~/.claude/`、`<proj>/.claude/`）。`claude plugins list` 不支持 `--user/--project`
旗标，scope 过滤改在客户端做。skill 的 `expectedHash` 当时改为
`sha256(SKILL.md bytes)` —— `skills-lock.json` 的 `computedHash`（全目录
sorted-hash）与该算法不兼容，过去比对永远不等，现在不再读 lock 文件。

**当前关联**: 真值源仍然在 Claude Code 实际安装位置，这部分契约保留。
v1.19.0 起 skill `expectedHash` 字段从 API 里彻底删除——既不读也不烤——presence
是唯一信号。

---

## skill drift 撤销 + catalog bake（v1.18.4）

v1.16.1 之前的 skill drift 检测**已撤销**——scan-catalog 改为所有 skill 都设
`expectedHash: ""` 通配符，scanner 退化为「SKILL.md 存在 → installed，缺失 →
not-installed」二态。原因：`npx skills update --project` 已经直接对每个 skill
上游 HEAD 做比对，auriga-cli catalog 烤焙的 hash 顶多是发版瞬间的快照，再做
drift 比对反而把"用户已手动升级到最新"误判成"漂移了"。

同 PR 把 plugin `agents` map / `external` 标志 / `workflowVersion` /
`expectedVersion` 全部 build 时烤进 `dist/catalog.json` —— 因为
`package.json` `files` 字段只 ship `dist/`，runtime 读 `.claude/plugins.json`
/ `.agents/plugins/install.json` / `CLAUDE.md` 在 npm 装好后都拿空（dev 环境
`packageRoot=repoRoot` 才能撑住，掩盖了 bug）。配套 `tests/tarball-shape.test.ts`
元 regression 在 CI 守这个契约。

**当前关联**: "runtime reads must hit shipped paths only" 规则仍是 dev guide
的核心原则之一。`agents` map + `external` 标志继续烤入 `dist/catalog.json`
（plugin agent 分类靠它）；`workflowVersion` + `expectedVersion` 在 v1.19.0
随 update-available surface 一起退出。tarball-shape.test.ts 的契约翻转为
**negative** 断言："workflowVersion / expectedVersion must NOT appear in
dist/catalog.json"。

---

## Plugin 期望版本号的真值源选择（v1.18.2 → v1.18.3）

scanner 判 `update-available` 需要"上游应该是几号版本"。三个候选源：

| 源 | 含义 | 用 / 不用的原因 |
|---|---|---|
| (A) `~/.claude/plugins/marketplaces/<marketplace>/plugins/<name>/.claude-plugin/plugin.json` | Claude Code 本地缓存的 marketplace 镜像 | **不用**：stale，需要用户手动 `claude plugins update <marketplace>` 才会刷新，UI 没法告诉用户「你的缓存过期了」 |
| (B) `claude plugins list --available --json` 的 `.available[]` | Claude CLI 给的 "marketplace 当前可用列表" | **只用于 fresh-install 场景**：CLI 故意把已装 plugin 从 `.available[]` 排除，所以已装升级永远查不到。`available[i].source.ref` 在能拿到时优先（最 fresh），拿不到才退到 (C) |
| (C) auriga-cli 自己 `dist/catalog.json` 里 `plugins[i].expectedVersion` | build 时从 `plugins/<name>/.claude-plugin/plugin.json` 烤入 | **owned in-tree plugins 的主源**：auriga-go / auriga-git-guards / deep-review / session-instructions-loader 都是本仓库 owned，它们的 `plugin.json` 就是权威版本号。用户跑 `npm i auriga-cli@latest` 即刻同步 |

外部 marketplace plugin（skill-creator、claude-md-management、codex 这类
upstream 不在本仓库的）**不烤** `expectedVersion`：钉版本会让我们追不上
upstream 的发版节奏，每次 upstream bump 都误报 update。scanner 在
`expectedVersion` 缺失时退化为「信任已装」，符合"我们不发版你自己管"的契约。

trade-off：用 (C) 意味着想暴露新 plugin 版本必须重发 auriga-cli。可接受 ——
自家 plugin 的 bump 总会跟 auriga-cli 的 release 走（修 plugin 就 bump
auriga-cli 即可）。

`classifyClaudePlugin` 优先级：`available[].source.ref` 可解析 semver → 用 (B)，
`versionSource: "upstream-live"`；否则用 (C) baked `expectedVersion`，
`versionSource: "catalog"`。两个值都拿不到 → 信任已装。

**v1.18.2 的常见误区**：版本号读取必须在 **build 时**入 `dist/catalog.json`，
不能在 runtime 读 `packageRoot/plugins/<name>/plugin.json`。`package.json`
`files` 字段只 ship `dist/`，runtime 读 `plugins/` 会在 npm 装好后静默拿空。
dev 环境（`packageRoot === repoRoot`）能跑通是巧合，会掩盖这个 bug 直到打
tarball 发出去。

**当前关联**: 整个版本号比对机制在 v1.19.0 移除。scanner 不再消费
`expectedVersion`，`dist/catalog.json` 不再烤焙它，`PluginState` 类型也不
再带 `currentVersion / expectedVersion / versionSource` 字段。对应的 CI
契约由 `tests/tarball-shape.test.ts` 翻转为"这些字段必须不出现"的负面断言守住。
build-time bake 路径上仍然保留 `agents` map + `external` 标志的烤入逻辑——
这两个是独立信号（agent 分类 + UI EXTERNAL badge），不为升级检测服务。

---

## 不对称 Claude / Codex 升级路径

- Claude CLI 当时提供 `--available` 模式直接活查上游，精度最高；离线 / CLI
  缺失时降级
- Codex CLI 没有 `list` 子命令，只能靠 filesystem + auriga-cli catalog；
  catalog 在 CLI 发版时烤入，对 auriga-cli-owned plugins（auriga-go 等）足够
  精确，对外部 plugins 精度取决于 CLI 新鲜度

**当前关联**: v1.19.0 后两侧都走 presence-only，不对称消失。Claude 侧不再调
`claude plugins list --available --json`（连带删掉 `extractAvailableArray`、
`parseRef`、`available[]` 索引）；Codex 侧本来就只判存在性。

---

## 反向迁移路径（如果未来需要）

如果某天发现某个真实场景需要 update-available 信号（例如某个 hook 的 settings
entry drift 单靠 re-install 修复不了），重建路径：

1. 恢复 `ItemStatus.update-available` + `ApplyAction.update`（git history 给出
   完整 diff）
2. 视场景重建：版本比对（plugin） / 哈希比对（skill / hook）
3. 同步恢复对应的 catalog 烤焙字段
4. tarball-shape 测试翻回 positive 断言

成本估计：scanner 比对逻辑约 200 行 + 类型 ~50 行 + 测试。整段 diff 可以从
v1.18.5 的 src/state.ts checkout 出来作为参照。
