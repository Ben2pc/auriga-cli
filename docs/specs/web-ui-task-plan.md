# Web UI v0.1 任务计划

> 派生自 [docs/specs/web-ui.md](web-ui.md)（spec 是真值源）。此文档只切**任务粒度 + 依赖 + 验收**，不重复 design 内容。

## 字段说明

| 字段 | 含义 |
|---|---|
| ID | `T<milestone>.<seq>`，如 `T1.3` = M1 第 3 个任务 |
| 触及 | 新增（A）/ 修改（M）文件路径 |
| Dep | 依赖任务 ID（DAG），`-` = 无依赖 |
| Acceptance | 可验证条件——test 命令、grep 断言或 file-existence 检查 |
| Cx | complexity：`S`=simple / `M`=medium / `C`=complex |
| TD? | 是否需 `test-designer` skill 设计独立失败测试 |
| PI? | 是否走 `parallel-implementation` skill 切片 |

---

## M1：Scanner + Server 基础设施

> 5 个任务。**M1 整体走 parallel-implementation**（命中触发条件 a：0→1 跨多个独立模块）。

| ID | 任务 | 触及 | Dep | Acceptance | Cx | TD? | PI? |
|---|---|---|---|---|---|---|---|
| **T1.1** | 定义共享 API 类型 | A: `src/api-types.ts` | - | `tsc --noEmit` 通过；exports 含 `StateReport / ApplyRequest / ProgressEvent` | S | N | N |
| **T1.2** | 实现 scanner 五类目逻辑 | A: `src/state.ts`, `tests/state.test.ts` | T1.1 | `node --test dist-test/tests/state.test.js` 全绿；fixture 项目覆盖 5 类目 × 3 态 | C | **Y** | - |
| **T1.3** | 实现 HTTP server 路由骨架 | A: `src/server.ts`, `tests/server.test.ts` | T1.1 | `tests/server.test.ts` 覆盖 5 个 `/api/*` 路由；mock installer 调用 | M | N | - |
| **T1.4** | 实现安全中间件（token + Origin） | M: `src/server.ts`; A: `tests/server-auth.test.ts` | T1.3 | token 缺/错 → 401；Origin 黑名单 → 403；DNS rebinding 模拟 → 403 | M | **Y** | - |
| **T1.5** | wire `/api/state` 接 scanner + 心跳生命周期 | M: `src/server.ts` | T1.2, T1.4 | E2E 启 server → GET `/api/state` 返 StateReport；15s 无 ping → 进程退出 0 | M | N | - |

**M1 切片建议**（parallel-implementation 阶段产出）：
- Slice A: T1.1 + T1.2（scanner + types）— 1 个 worktree
- Slice B: T1.3 + T1.4（server + auth）— 1 个 worktree
- Sync 点: T1.5 在主 worktree 合并 A + B 后单 Agent 接

---

## M2：UI Scaffold + 视觉系统

> 7 个任务。tokens.css 是所有 UI 组件的依赖，必须先落。**整体走 parallel-implementation** 切组件层。

| ID | 任务 | 触及 | Dep | Acceptance | Cx | TD? | PI? |
|---|---|---|---|---|---|---|---|
| **T2.1** | Vite + React + Tailwind 工程初始化 | A: `ui/package.json`, `ui/vite.config.ts`, `ui/tsconfig.json`, `ui/index.html`, `ui/src/main.tsx`, `ui/src/App.tsx` | - | `cd ui && npm run build` 成功；`ui/dist/` 包含静态资源 | S | N | N |
| **T2.2** | 注入 DESIGN.md 全套 token | A: `ui/src/styles/tokens.css`, `ui/tailwind.config.ts` | T2.1 | grep `--color-clay: #d97757` `tokens.css`；Tailwind config @theme 含 16 个 color token | S | N | N |
| **T2.3** | Fontsource 接 Inter + JetBrains Mono | M: `ui/package.json`, `ui/src/main.tsx` | T2.1 | `ui/node_modules/@fontsource/inter/` 存在；`main.tsx` import 字体文件 | S | N | N |
| **T2.4** | TopBar + Layout 组件 | A: `ui/src/components/TopBar.tsx`, `ui/src/components/Layout.tsx` | T2.2 | Vitest：renders wordmark + cwd label；只用 token class | M | N | - |
| **T2.5** | StateCard 三态组件 | A: `ui/src/components/StateCard.tsx`, `ui/src/components/StateCard.test.tsx` | T2.2 | Vitest：installed / update-available / not-installed 三态各自正确背景 + 文字 token | M | **Y** | - |
| **T2.6** | ApplyBar sticky 组件 | A: `ui/src/components/ApplyBar.tsx`, `ui/src/components/ApplyBar.test.tsx` | T2.2 | Vitest：0 选时隐藏；≥1 选时滑入；apply 按钮 asymmetric radius；Clay 描边在激活 | M | **Y** | - |
| **T2.7** | Dashboard page 拼接 + `/api/state` fetch | A: `ui/src/pages/Dashboard.tsx`, `ui/src/lib/api.ts` | T2.4, T2.5, T2.6 | `vitest run` 全绿；mock fetch 返 StateReport → 5 类目段全部渲染 | M | N | - |

**M2 切片建议**：
- Slice A: T2.1 + T2.2 + T2.3（scaffold + token + font）— 串行单 Agent
- Slice B: T2.4 + T2.5 + T2.6 三组件并行（依赖 T2.2 完成）— 3 个 worktree
- Sync 点: T2.7 主 worktree 单 Agent 拼接

---

## M3：Installer Uninstall + /api/apply 集成

> 6 个任务。4 个 installer uninstall 函数互相独立可并行；apply 集成串行。

| ID | 任务 | 触及 | Dep | Acceptance | Cx | TD? | PI? |
|---|---|---|---|---|---|---|---|
| **T3.1** | `workflow.uninstall()` 函数 | M: `src/workflow.ts`, `tests/workflow.test.ts`（若无则 A） | - | unit test 断言：删除 `CLAUDE.md` + `AGENTS.md` symlink；二次确认 flag 缺失则抛错 | S | N | N |
| **T3.2** | `skills.uninstall(name)` 函数 | M: `src/skills.ts`, `tests/skills.test.ts` | - | unit test：调 `npx skills remove`；外部 CLI 不支持则手动改 `skills-lock.json` | M | N | N |
| **T3.3** | `plugins.uninstall(id, agent)` 函数 | M: `src/plugins.ts`, `tests/plugins.test.ts` | - | Claude: `claude plugins uninstall` exec；Codex: 手动改 `~/.codex/config.toml` + 删 cache dir | C | **Y** | N |
| **T3.4** | `hooks.uninstall(name)` 函数 | M: `src/hooks.ts`, `tests/hooks.test.ts` | - | 删 `.claude/hooks/<name>/` + 调 `removeHookFromSettings`；幂等 | S | N | N |
| **T3.5** | `/api/apply` + `/api/progress` SSE | M: `src/server.ts` | T3.1, T3.2, T3.3, T3.4 | POST `/api/apply` 立返 jobId；SSE 收到 `item:start / item:log / item:done / all-done` 完整序列 | C | **Y** | - |
| **T3.6** | server-apply 集成测试 | A: `tests/server-apply.test.ts` | T3.5 | scratch project：apply 3 项 → 文件系统副作用断言 + SSE 事件序列断言；fail-fast disabled, 单项失败继续 | C | N | - |

**M3 切片建议**：
- Slice A-D: T3.1 / T3.2 / T3.3 / T3.4 完全并行 — 4 个 worktree
- Sync 点: T3.5 + T3.6 主 worktree 单 Agent 接（依赖全部 4 个）

---

## M4：UI Bundle 发布管线

> 3 个任务，**串行**——release.yml 改动有先后逻辑。无 parallel-implementation。

| ID | 任务 | 触及 | Dep | Acceptance | Cx | TD? | PI? |
|---|---|---|---|---|---|---|---|
| **T4.1** | `src/ui-fetch.ts` 下载 + 缓存 + SHA256 校验 | A: `src/ui-fetch.ts`, `tests/ui-fetch.test.ts` | - | unit：cache miss → fetch → 校验通过；校验失败抛错；cache hit 不重复 fetch | M | **Y** | N |
| **T4.2** | `release.yml` 加 UI build + tarball + gh release upload | M: `.github/workflows/release.yml` | T4.1 | `workflow_dispatch dry_run=true` 演练通过；release asset 列表含 `ui-bundle.tar.gz` + `.sha256` | M | N | N |
| **T4.3** | `cli.ts` `ui` 子命令接 ui-fetch | M: `src/cli.ts` | T4.1 | `npx auriga-cli ui` 启动：缓存缺则下载，缓存命中则直接服务静态资源 | S | N | N |

---

## M5：Playwright e2e + HOME 重定向

> 5 个任务。HOME 重定向脚手架是核心，业务场景测试可并行。

| ID | 任务 | 触及 | Dep | Acceptance | Cx | TD? | PI? |
|---|---|---|---|---|---|---|---|
| **T5.1** | 安装 Playwright + 配置 | M: `package.json`（devDep + script）; A: `playwright.config.ts` | - | `npx playwright install chromium` 成功；`npm run test:web-ui-e2e -- --list` 不报错 | S | N | N |
| **T5.2** | HOME 重定向 + scratch fixture helper | A: `tests/web-ui-helpers.ts` | T5.1 | helper export `createScratch()` 返 `{home, project, cleanup}`；afterEach 清理验证 | M | N | N |
| **T5.3** | Install + uninstall 主路径 e2e | A: `tests/web-ui-e2e.test.ts` | T5.2, M3 完成 | Chromium 驱动：勾选 skill 'brainstorming' → apply → fs 断言；卸载同样断言 | C | **Y** | N |
| **T5.4** | Update 路径 e2e | M: `tests/web-ui-e2e.test.ts` | T5.3 | fixture 设置"装了旧版"状态 → UI 显 "可更新" → apply → fs 含新版 | C | - | N |
| **T5.5** | Canary 断言：真 `$HOME` 未污染 | M: `tests/web-ui-e2e.test.ts` | T5.3, T5.4 | 所有测试结束断言：真实 `$HOME/.claude/.web-ui-e2e-marker` 不存在；测试中故意写 marker 应落在 scratch | M | **Y** | N |

---

## M6：UI Polish

> 4 个任务，**强制调** `make-interfaces-feel-better` skill。

| ID | 任务 | 触及 | Dep | Acceptance | Cx | TD? | PI? |
|---|---|---|---|---|---|---|---|
| **T6.1** | 调 skill 出 polish punch list | A: `progress.md` 临时（M7 前清理） | M5 完成 | skill 返回完整 punch list（覆盖 hover/focus/active + empty/loading/error + 微动效 + a11y + 极端场景） | S | N | N |
| **T6.2** | 实现交互态：hover / focus / active | M: 各组件 `.tsx` | T6.1 | Vitest snapshot：hover 时 border 切到 `--color-slate-medium`；focus ring 存在 | M | N | N |
| **T6.3** | 实现 empty / loading / error 三态 | M: `Dashboard.tsx`, `LogPanel.tsx` | T6.1 | Vitest：fetch pending → loading skeleton；fetch err → error banner；空 state report → empty state | M | N | N |
| **T6.4** | 键盘可达 + 极端场景目检 | M: 必要组件 | T6.1 | 全键盘 tab 走完不死循环；长名 truncate + tooltip；离线 banner 与 error banner 叠加合理 | M | N | N |

---

## M7：文档收尾 + 版本 bump

> 5 个任务。M7 完成 = 准备走 verification + PR Ready。

| ID | 任务 | 触及 | Dep | Acceptance | Cx | TD? | PI? |
|---|---|---|---|---|---|---|---|
| **T7.1** | `README.md` 加 `ui` 子命令文档 | M: `README.md` | M6 完成 | grep `npx auriga-cli ui` `README.md`；含端口/token/--no-open 说明 | S | N | N |
| **T7.2** | `README.zh-CN.md` 同步 | M: `README.zh-CN.md` | T7.1 | 内容与 `README.md` 对应段落齐 | S | N | N |
| **T7.3** | `.claude/CLAUDE.md` 加 "如何跑 e2e" 段 | M: `.claude/CLAUDE.md` | M5 完成 | 含 `npm run test:web-ui-e2e` 命令 + HOME 重定向说明 | S | N | N |
| **T7.4** | `package.json` 版本 bump | M: `package.json` | T7.1-T7.3 | 版本从 `1.x.y` → `1.(x+1).0`（minor bump：feature add） | S | N | N |
| **T7.5** | 清理 spec ephemeral 文件 + 更新 PR body | M: PR description; D: `docs/specs/web-ui-task-plan.md`（promote 到 worklog 或保留） | T7.4 | `docs/specs/` 空或 spec/task-plan 已归档（per CLAUDE.md doc conventions） | S | N | N |

---

## DAG 摘要

```
M1 (T1.1 → T1.2/T1.3 → T1.4 → T1.5)
    ↓
M2 (T2.1 → T2.2/T2.3 → T2.4/T2.5/T2.6 → T2.7)  [可与 M1 并行启动 T2.1]
    ↓
M3 (T3.1/T3.2/T3.3/T3.4 → T3.5 → T3.6)
    ↓
M4 (T4.1 → T4.2/T4.3)  [可与 M3 部分并行]
    ↓
M5 (T5.1 → T5.2 → T5.3 → T5.4 → T5.5)
    ↓
M6 (T6.1 → T6.2/T6.3/T6.4)
    ↓
M7 (T7.1 → T7.2/T7.3 → T7.4 → T7.5)
```

## test-designer 触发清单

以下任务在实现前调用 `test-designer` 让独立 Agent 设计失败测试：
- **T1.2** scanner（跨 5 类目 × 3 态 = 15 个边界）
- **T1.4** server auth（DNS rebinding 等安全边界）
- **T2.5** StateCard（视觉编码契约）
- **T2.6** ApplyBar（asymmetric radius signature + 激活态）
- **T3.3** plugins.uninstall（Claude vs Codex 不对称分支）
- **T3.5** /api/apply（SSE 协议契约）
- **T4.1** ui-fetch（缓存 + 校验交叉）
- **T5.3** e2e 主路径（黑盒交互流）
- **T5.5** Canary（"未污染真 HOME" 强断言）

## parallel-implementation 调度时机

| Phase | 触发条件命中 | 切片对象 |
|---|---|---|
| 进 M1 时 | a (0→1 跨多模块) | T1.2 vs T1.3+T1.4 两 slice |
| 进 M2 时 | a + (≥3 模块) | T2.4 / T2.5 / T2.6 三 slice |
| 进 M3 时 | a + (≥3 模块) | T3.1 / T3.2 / T3.3 / T3.4 四 slice |
