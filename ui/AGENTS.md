# auriga-cli Web UI

Vite + React 19 + Tailwind v4 子项目，构建产物作为 GitHub Release asset（`ui-bundle.tar.gz`）发布，CLI 通过 `src/ui-fetch.ts` 按需拉取。根仓库规则见 `../AGENTS.md`；这里只写在本目录才成立的约束。

## 独立工具链

这个子项目有自己的 `package.json` 和依赖树，**不随根仓库的 `npm test` 运行**：

```bash
npm --prefix ui ci     # 安装依赖
npm --prefix ui test   # vitest run
npm --prefix ui build  # tsc && vite build
```

改动本目录后必须跑 `npm --prefix ui test`；根目录的 `npm test` 覆盖不到这里。

## 与 CLI 的契约

- 前后端共享类型的唯一信息源是 `../src/api-types.ts`（`StateReport`、`ApplyRequest`、`ProgressEvent` 等）。不要在 `src/lib/api.ts` 里重新声明这些类型，改契约要先改 `api-types.ts`。
- 服务端是 `../src/server.ts`：token + Origin 认证、SSE `/api/progress`、静态资源服务。本地联调用 `npx auriga-cli web-ui` 启动真实 server，不要 mock 掉认证路径。
- 端到端 harness 是 `../tests/web-ui-e2e.test.ts`，用 `npm run test:web-ui-e2e` 跑（不属于根 `npm test`）。

## 发布形态

`ui/` 不随 npm tarball 发布，只作为 Release asset。因此运行时读取路径不能假设 `ui/` 存在于已安装的包里——这类回归由 `../tests/tarball-shape.test.ts` 约束。

对本目录或 `../src/server.ts` 的实质行为改动，若自动化测试无法给出信心，可按需参照 `../docs/architecture/auriga-cli-dev-guide.md` 的「Web UI 手动验证」一节人工核对；这不是 Ready 门禁。
