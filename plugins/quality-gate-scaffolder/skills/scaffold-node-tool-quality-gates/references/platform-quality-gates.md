# Node 工具质量门禁参考

## 前向验证样本

`lark-connect` 是前向验证时使用的 Node 工具仓库样本，不是本技能唯一的生产经验来源。它是发布型命令行工具和本地服务仓库，`package.json` 使用 ESM、`bin` 指向 `src/cli.js`，`engines.node` 为 `>=22`，脚本包含 `npm run build`、`npm run lint`、`npm test`、`npm run pack:check` 和统一的 `npm run quality`。其中 `build` 用 `node --check` 对 `src/**/*.js` 做语法检查，`test` 用 `node --test` 跑原生测试，`lint` 用 ESLint 约束危险 JavaScript 模式，`quality` 作为本地和拉取请求持续集成的共同入口。

这个样本说明：Node 工具门禁不应直接套用网页前端的 React、浏览器或打包器规则。低成本但有效的默认门禁应先保护命令行入口、原生测试、包形态、运行时配置、敏感环境变量边界，并把门禁脚本、lint 配置和 GitHub workflow 本身纳入配置漂移测试。

## 第一层：工具选型和版本策略

| 工具 | 作用 | 版本选择建议 |
| --- | --- | --- |
| Node.js | 执行命令行工具、语法检查和原生测试 | CI 显式固定与 `engines.node` 兼容的版本；来源样本为 `>=22`，建议 CI 先固定 22 或当前长期支持版本，再按需加最新版矩阵 |
| npm / `package-lock.json` | 提供可复现安装、脚本入口和发布包形态检查 | CI 使用 `npm ci`；锁文件必须提交；包发布前用 `npm pack --dry-run --json` 检查入包文件 |
| `package.json` `quality` 脚本 | 给本地开发、hook 和 PR CI 提供同一个质量门禁入口 | 生产级单包工具优先提供；小工具可以先没有，但 PR workflow 不应把命令散落到多处 |
| `node --check` | 对纯 JavaScript 工具做低成本语法检查 | 适合无构建步骤的 ESM 或 CommonJS 项目；不能替代 lint 或运行时测试 |
| `node --test` | 运行 Node 原生测试 | 小型工具默认优先用原生测试；已有 Vitest 或 Jest 时可以保留，但不要同时引入多个测试框架 |
| ESLint | 约束未被语法检查覆盖的代码质量、导入边界和危险模式 | 不是低档位必需项；发布型工具、本地守护进程、MCP 服务或多人维护工具建议作为 L2 默认项，使用当前主版本和锁文件固定精确版本 |
| TypeScript / `tsc --noEmit` | TypeScript 工具包或 `checkJs` 项目的类型检查 | 仅当仓库已有 TypeScript 或用户明确选择类型门禁时加入；纯 JavaScript 小工具不要为门禁强行迁移 |
| 配置漂移测试 | 把 `package.json`、包入口、脚本参数、lint 配置和 workflow 当成被测对象 | 跟业务测试同跑；改质量脚本、lint 规则或 required check 时先更新测试表达意图 |
| `tools/quality/run_gates.sh` + planner | 给本地 hook 和 CI 提供单一入口；按 diff 决定是否跑 Node 门禁 | 小仓库可先没有 planner，直接跑全量；多人仓库或 monorepo 再加 affected 规划 |
| GitHub Actions | PR 权威门禁、合入后包形态检查和定时外部集成检查 | required check 不要使用 workflow 级路径过滤；用 plan step 控制是否执行重任务 |

## 第二层：现有规则配置参考

| 配置或脚本 | 当前规则参考 |
| --- | --- |
| `package.json` scripts | `build` 执行 `node --check` 覆盖源码；`test` 执行 `node --test`；`lint` 执行 ESLint；`pack:check` 执行 `npm pack --dry-run --json`；`quality` 串联本地和 PR 门禁；`typecheck` 在纯 JavaScript 样本中复用 `build`，避免制造假类型安全 |
| `package.json` `bin` | `bin` 必须指向存在的入口文件；入口文件保留 shebang；命令行冒烟至少覆盖 `--help` 和一个无需真实外部凭证的子命令 |
| `package.json` `files` | 只发布运行时需要的目录和 README；用 `npm pack --dry-run --json` 检查入包文件 |
| `package.json` `engines` | 声明最低 Node 版本；CI 固定同一主版本，必要时加最新版矩阵发现前向兼容问题 |
| ESLint 配置 | 生产级 Node 工具建议启用 bug-prevention 规则，库代码默认禁止 `console`，CLI 入口可以单独放开输出 |
| 原生测试 | 覆盖参数解析、配置解析、本地守护进程、HTTP 客户端、MCP 协议边界、错误码和异步退出行为 |
| 敏感配置规则 | `doctor` 或配置状态输出不得打印 secret 原文；错误消息不得包含环境变量值；测试中用假值覆盖 |
| 网络和外部服务边界 | 默认测试不得依赖真实飞书、GitHub 或网络；真实集成放手动、合入后或定时 workflow |
| 包形态漂移测试 | 锁住 `bin`、`files`、`engines`、必要脚本和 `npm pack --dry-run` 输出中的关键文件 |
| lint / workflow 漂移测试 | 用 ESLint API 断言解析后的关键规则；用测试锁住 required check 名称、触发事件和 Node 版本 |
| npm 发布门禁 | tag 版本必须等于 `package.json` 版本；发布前跑测试、构建和打包预检；使用 Trusted Publishing 或 provenance，避免长期 npm token |

## 具体规则文件

具体 Node 脚本规则、原生测试规则、包形态规则、ESLint/TypeScript 可选增强和配置漂移测试建议见 `concrete-rules.md`。需要写入或调整目标仓库规则配置时，先读取该文件，不要只依赖本总览。

## 第三层：触发时机建议

| 时机 | 适合检查 | 不适合检查 | 参考建议 |
| --- | --- | --- | --- |
| `pre-commit` | 暂存 JavaScript/TypeScript 文件的格式、lint 自动修复、空白检查 | 全量 `node --test`、包形态、真实外部集成 | 小仓库可以先跳过，等引入 ESLint 或格式化工具后再启用 |
| `pre-push` | `npm run build`、`npm test`、`npm run lint`、轻量命令行冒烟；有统一入口时跑 `npm run quality` | 需要真实飞书凭证、长连接或网络的测试 | 适合 Node 工具仓库默认本地硬门禁；如果 `pack:check` 很慢，可只放 PR CI |
| 本地 hook + planner | monorepo 中只在 `src/`、`tests/`、`package.json`、锁文件或门禁脚本变化时跑 Node 门禁 | 单包小仓库中过早引入复杂 planner | planner 失败时保守跑全量 |
| PR CI | `npm ci`、仓库统一质量入口、配置漂移测试 | 使用 workflow 级路径过滤导致 required check 不上报 | 默认推荐作为 required status check；没有统一入口时才展开为 build、lint、test、pack |
| 合入 `main` 后 | 包安装烟测、`npx` 或 tarball 安装烟测、发布预检、tag/package 版本一致性检查 | 每个 PR 已覆盖的基础语法和单元测试 | 发布型工具建议在合入后跑；真正发布放 tag workflow |
| 定时 workflow | 依赖审计、外部服务 live doctor、真实 API 权限冒烟 | 需要阻塞每个 PR 的基础质量门禁 | 必须使用 secrets，且不能输出敏感值 |

基于 diff 的本地检查建议：

- 单包 Node 工具仓库优先直接跑仓库统一质量入口；如果还没有统一入口，先跑 `npm run build && npm test`，避免为了省几十秒引入 planner。
- 如果目标还不是 Git 仓库或没有锁文件，先把“是否生成并提交 `package-lock.json`、CI 是否使用 `npm ci`”列为用户确认项；不要在未确认时假设 `npm ci` 一定可用。
- monorepo 或多包仓库再引入 planner；命中 `package.json`、锁文件、`src/**`、`tests/**`、`.github/workflows/**` 或 `tools/quality/**` 时输出 `node-tool`。
- `pre-commit` 只处理暂存文件；`pre-push` 跑完整轻量门禁。
- PR CI 不要使用 workflow 级 `paths-ignore`；即使无关改动也应稳定上报成功状态，内部 plan 决定是否跳过重任务。
- 真实外部集成、依赖审计和包发布烟测放合入后或定时 workflow，成熟后再考虑升为 PR required check。

## 示例

共享 hook 和 workflow 模板见 `../../references/invocation-examples.md`。Node 工具侧可以按下面形态落地：

```sh
# 本地全量门禁
npm run build
npm run lint
npm test
npm pack --dry-run --json

# 命令行入口冒烟
node src/cli.js --help
```

```yaml
jobs:
  node-tool:
    name: Node Tool Gates
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm run quality
```
