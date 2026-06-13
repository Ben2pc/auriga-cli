# TypeScript 前端质量门禁参考

## 已验证来源项目

`lingolens` 提供了来源模式。已观察到的前端门禁由仓库根 `tools/quality/run_gates.sh` 编排，前端目标会进入 `frontend/` 后依次执行 `npm run lint`、`npm run typecheck`、`npm run format:check` 和 `npm run test`。工具链包括 Biome、ESLint、TypeScript、Vitest 和 `lint-staged`，并用配置漂移测试锁住门禁配置不漂移。

GitHub 侧模式在 monorepo 中使用名为 `Frontend Gates` 的拉取请求检查。workflow 总是对非 Draft 拉取请求上报，先用 `tools/quality/run_gates.sh frontend --affected --print-targets` 做计划，再决定是否安装 `npm` 依赖和执行完整前端门禁。

## 第一层：工具选型和版本策略

| 工具 | 作用 | 版本选择建议 |
| --- | --- | --- |
| Node.js / npm / `package-lock.json` | 提供前端脚本和依赖安装的可复现入口 | CI 显式固定 Node 版本，来源项目为 Node 24；安装用 `npm ci`；精确依赖由 `package-lock.json` 固定 |
| Biome | 承载格式化和基础 lint，减少 Prettier + 基础 ESLint 的重叠 | 质量工具用 `~` 锁补丁线，来源项目为 `@biomejs/biome ~2.4.16`；schema 版本跟工具版本保持一致 |
| ESLint 9 flat config | 承载 Biome 不适合做的类型感知规则、React hooks 规则和分层 import 规则 | `eslint ~9.39.4`、`typescript-eslint ~8.61.0`、`eslint-plugin-react-hooks ~7.1.1`、`eslint-plugin-react-refresh ~0.5.2`；升级时要跑配置漂移测试 |
| TypeScript compiler | `tsc --noEmit` 做严格类型检查，不负责产物输出 | `typescript ~5.9.3`；`tsconfig.json` 严格选项与 bundler module resolution 一起版本化 |
| Vitest | 运行前端单元测试和门禁配置测试 | `vitest ~3.2.6`；组件测试环境依赖 `jsdom`，用锁文件固定 |
| `lint-staged` | 在 pre-commit 阶段只处理 staged 文件，并允许安全自动修复 | `lint-staged ~17.0.7`；命令参数要被测试锁住，防止本地 hook 悄悄放宽 |
| 配置漂移测试 | 把质量门禁配置自身当成被测对象，防止脚本、Biome、ESLint 和 lint-staged 规则漂移 | 跟业务测试同跑；改门禁配置时先更新测试表达意图 |
| `tools/quality/run_gates.sh` + `planner.py` | 给本地 hook 和 CI 提供单一入口；根据 diff 输出 `frontend` token | shell 只编排，路径分类放在 planner；planner 失败时 fail-closed 回退全量 |
| Playwright 或浏览器自动化 | 只在已有稳定场景时覆盖路由、交互和真实浏览器冒烟 | 不要默认放进每个 PR 的 required check；先作为定向 workflow、合入后或定时 workflow 验证 |

## 第二层：现有规则配置参考

| 配置或脚本 | 当前规则参考 |
| --- | --- |
| `frontend/package.json` scripts | `lint` 同时跑 `biome check --error-on-warnings .` 和 `eslint src --max-warnings 0`；`typecheck` 跑 `tsc --noEmit`；`format:check` 跑 `biome format .`；`test` 跑 `vitest run` |
| `frontend/package.json` `lint-staged` | `*.{ts,tsx}` 先 `biome check --write --no-errors-on-unmatched`，再 `eslint --fix --max-warnings 0 --no-warn-ignored` |
| `frontend/biome.jsonc` | 只包含 `src/**`、根 `*.ts`、`*.js`；formatter 固定 2 空格、100 列、单引号、按需分号、ES5 trailing comma；linter 开启 recommended |
| Biome 规则所有权 | Hooks 依赖、未用变量和显式 any 交给 ESLint 的类型感知规则；无障碍规则是否启用按产品面向人群单独决策 |
| `frontend/eslint.config.js` | 使用 ESLint 9 flat config；只管类型感知规则和 React hooks；`recommendedTypeChecked` 加 `react-hooks` `recommended-latest`；`react-refresh/only-export-components` 是 warning，但 `--max-warnings 0` 让它阻塞 |
| ESLint 分层规则 | 禁止页面或组件直连底层网络库，保留统一 API client 出口 |
| ESLint 渐进债务 | `no-unsafe-*`、`no-floating-promises`、`require-await`、部分 React hooks 新规则当前显式关闭，并以债务说明登记；偿还后逐项删除，不要一次性开 `strictTypeChecked` |
| `frontend/tsconfig.json` | `strict: true`、`noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch`、`noEmit`、`isolatedModules`、`moduleResolution: "bundler"` |
| 配置漂移测试 | 锁住 package scripts 的严格参数、`lint-staged` 参数、Biome/ESLint 规则所有权、网络出口例外、hooks 规则和无障碍取舍 |
| `tools/quality/run_gates.sh` | 前端目标固定顺序为 lint、typecheck、format check、Vitest；本地 pre-push 和 PR CI 共用同一入口 |

## 具体规则文件

具体 Biome 规则、ESLint 类型感知规则、TypeScript 编译选项、lint-staged 参数和配置漂移测试建议见 `concrete-rules.md`。需要写入或调整目标仓库规则配置时，先读取该文件，不要只依赖本总览。

## 第三层：触发时机建议

| 时机 | 适合检查 | 不适合检查 | 当前参考 |
| --- | --- | --- | --- |
| `pre-commit` | staged `*.ts` / `*.tsx` 的 Biome 和 ESLint 自动修复，空白检查 | 全量 typecheck、全量 Vitest、Vite build、浏览器自动化 | `lingolens/.githooks/pre-commit` |
| `pre-push` | `run_gates.sh all --affected`，命中前端时跑完整前端门禁；docs-only 可跳过 | 需要启动浏览器或服务端依赖的端到端测试 | `lingolens/.githooks/pre-push` |
| PR CI | `Frontend Gates`：plan、`npm ci`、lint、typecheck、format check、Vitest | workflow 级 `paths-ignore`；会导致 required check 在纯文档 PR 上不汇报 | `lingolens/.github/workflows/frontend-quality-checks.yml` |
| 合入 `main` 后 | Vite build、静态资源大小检查、部署预览构建、关键路由冒烟 | 每个 PR 已经覆盖的 staged 修复 | 来源项目当前 PR 门禁未包含 build；目标仓库若前端会部署给用户，建议加 main push build |
| 定时 workflow | Playwright 浏览器冒烟、截图回归、跨浏览器检查、依赖审计 | 基础 Biome/ESLint/TypeScript 检查 | 来源项目未观察到独立前端定时 workflow；新仓库应等场景稳定后再加 |

基于 diff 的本地检查建议：

- `planner.py` 命中 `frontend/`、前端配置文件、`tools/quality/` 或锁文件时输出 `frontend`。
- `pre-commit` 只看 staged 文件，调用 `lint-staged`；它可以自动修复并回写暂存区，避免每次启动完整 `tsc`。
- `pre-push` 可以跑完整前端门禁，但只在 diff 命中前端时跑；命中共享脚本或 planner 自身时保守跑前后端。
- PR CI 不要用 workflow 级路径过滤；用 plan step 控制后续安装和执行，保证 required check 稳定上报。
- 浏览器自动化和 build 成本更高，先放合入后或定时 workflow；当误报率和耗时稳定后，再考虑升为 PR required check。

## 示例

共享 hook 和 workflow 模板见 `../../references/invocation-examples.md`。TypeScript 前端侧可以按下面形态落地：

```sh
# 查看当前分支是否命中前端门禁
tools/quality/run_gates.sh frontend --affected --print-targets

# 本地前端全量门禁
tools/quality/run_gates.sh frontend

# 前端目录内逐项调试
cd frontend
npm run lint
npm run typecheck
npm run format:check
npm run test
```

```yaml
jobs:
  frontend:
    name: Frontend Gates
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - name: Plan affected gates
        id: plan
        env:
          GATES_BASE_REF: ${{ github.event.pull_request.base.sha }}
          GATES_HEAD_REF: ${{ github.event.pull_request.head.sha }}
        run: |
          targets="$(tools/quality/run_gates.sh frontend --affected --print-targets)"
          if [[ -n "$targets" ]]; then echo "run=true" >> "$GITHUB_OUTPUT"; else echo "run=false" >> "$GITHUB_OUTPUT"; fi
      - uses: actions/setup-node@v4
        if: steps.plan.outputs.run == 'true'
        with:
          node-version: "24"
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - name: Install frontend dependencies
        if: steps.plan.outputs.run == 'true'
        run: cd frontend && npm ci
      - name: Run frontend gates
        if: steps.plan.outputs.run == 'true'
        run: tools/quality/run_gates.sh frontend
```
