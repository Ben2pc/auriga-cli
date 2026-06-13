# Node 工具具体规则参考

本文件只放 Node 工具、命令行、本地守护进程和 MCP 服务仓库的具体规则。使用技能时，先用 `platform-quality-gates.md` 判断工具和触发时机；需要写入 `package.json`、门禁脚本、测试或 GitHub workflow 时，再加载本文件。

## 官方文档入口

需要更多规则、确认最新命令参数、确认配置字段或升级版本时，先查官方文档，不要只凭模型记忆补规则。

- Node.js 文档入口：https://nodejs.org/api/
- Node.js 命令行参数：https://nodejs.org/api/cli.html
- Node.js test runner：https://nodejs.org/api/test.html
- Node.js packages 文档：https://nodejs.org/api/packages.html
- Node.js process 文档：https://nodejs.org/api/process.html
- npm `package.json` 文档：https://docs.npmjs.com/files/package.json/
- npm scripts 文档：https://docs.npmjs.com/cli/using-npm/scripts/
- npm run 文档：https://docs.npmjs.com/cli/v11/commands/npm-run/
- npm ci 文档：https://docs.npmjs.com/cli/v11/commands/npm-ci/
- npm pack 文档：https://docs.npmjs.com/cli/v11/commands/npm-pack/
- GitHub Actions workflow 语法：https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions
- GitHub ruleset 可用规则：https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets

## package scripts 规则

纯 JavaScript Node 工具的最低脚本建议：

```json
{
  "scripts": {
    "build": "find src -name '*.js' -print0 | xargs -0 -n1 node --check",
    "test": "node --test",
    "typecheck": "npm run build",
    "pack:check": "npm pack --dry-run --json"
  }
}
```

规则：

- `build` 可以用 `node --check` 表达语法门禁，但必须覆盖运行时源码目录。
- `test` 优先用一个测试框架；小型 Node 工具默认用 `node --test`。
- 纯 JavaScript 仓库不要把 `typecheck` 包装成不存在的类型安全；可以显式复用 `build`，也可以不提供 `typecheck`。
- 发布型工具建议提供 `pack:check`，或者在 CI 直接执行 `npm pack --dry-run --json`。
- 如果仓库已有 TypeScript，`typecheck` 应改为 `tsc --noEmit`，`build` 应表达真实构建或语法输出检查。
- `npm ci` 依赖已提交的锁文件。目标仓库没有 `package-lock.json` 时，先让用户决定是否生成锁文件；临时样本或零依赖草稿可以先用 `npm install --ignore-scripts` 或跳过安装步骤，但不能把这种形态推荐为长期 required check。

## 命令行入口规则

发布型命令行工具至少检查这些点：

- `package.json` 的 `bin` 指向存在的文件。
- `bin` 入口文件第一行保留 `#!/usr/bin/env node`。
- `node src/cli.js --help` 或等价命令可以无凭证成功输出。
- 至少一个无外部网络的子命令有端到端测试，例如 `setup-url`、`version`、`config doctor` 的本地模式。
- 未知命令、缺少必填参数、非法数字参数都有失败测试。
- 长运行命令必须能用依赖注入或测试替身避免真实长连接。

配置漂移测试示例检查项：

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))

describe('quality gate package contract', () => {
  it('keeps required scripts strict', () => {
    assert.match(pkg.scripts.build, /node --check/)
    assert.equal(pkg.scripts.test, 'node --test')
  })

  it('keeps bin entry publishable', () => {
    assert.equal(pkg.bin['curiosea-lark-connect'], './src/cli.js')
    assert.ok(fs.readFileSync('src/cli.js', 'utf8').startsWith('#!/usr/bin/env node'))
  })
})
```

## 原生测试规则

`node --test` 适合保护 Node 工具的核心行为：

- 参数解析和默认值。
- 环境变量解析、显式参数覆盖环境变量的优先级。
- HTTP、本地守护进程或 MCP 协议边界。
- 异步命令的退出码、错误传播和资源释放。
- 本地文件或标准输入输出协议。
- 长连接、网络和外部 SDK 调用必须使用测试替身，不在默认测试里触达真实服务。

建议命名：

- `tests/cli.test.mjs` 覆盖命令行行为。
- `tests/config.test.mjs` 覆盖配置和环境变量。
- `tests/<module>.test.mjs` 覆盖核心模块。
- 需要 Node 测试替身能力时，可以按项目需要启用 Node 当前支持的 mock API；启用实验参数时要在脚本和测试里锁住原因。

## 敏感配置和输出规则

Node 工具经常处理令牌、密钥或本地服务地址，门禁应保护这些边界：

- 状态输出可以展示 `appId`、`chatId`、服务地址和布尔检查结果，但不得输出 `appSecret`、访问令牌或完整认证头。
- 错误消息不得拼接 secret 原文；测试要用假 secret 断言输出不包含该值。
- GitHub Actions 中使用 secrets 的 live 检查只能放合入后或定时 workflow，并关闭调试输出。
- 诊断报告、日志和临时文件若可能包含环境变量，应有显式过滤或不在 CI 上传。
- 默认测试环境不得读取开发者机器上的真实配置文件，除非用户明确选择 live 测试。

## 包形态规则

发布到 npm 或通过 `npx` 调用的工具至少保护这些点：

- `files` 只包含运行时目录、README、LICENSE 和必要资源。
- `bin` 指向入包文件；`npm pack --dry-run --json` 输出必须包含该文件。
- `engines.node` 和 CI Node 版本一致；最低版本要覆盖实际使用的 Node API。
- 包名、版本、license、repository、homepage 和 README 不能缺失。
- `package-lock.json` 必须提交；CI 用 `npm ci` 而不是 `npm install`。
- 如果目标不是 Git 仓库，先报告这一点；不要建议配置 required status check 或本地 hook，直到用户确认要初始化仓库或把样本迁入真实仓库。
- 合入 `main` 后可以加 tarball 安装烟测：生成包、在临时目录安装，再执行 `--help` 或无凭证子命令。

## ESLint 和 TypeScript 可选增强

不是所有 Node 工具都需要一开始引入 ESLint 或 TypeScript。选择规则：

- L1 小工具：`node --check`、`node --test`、命令行冒烟、包形态检查通常足够。
- L2 生产工具：如果已有多人协作或模块边界复杂，增加 ESLint。
- L3 大型工具或 SDK：如果 API 契约复杂，增加 TypeScript 或 `checkJs`，并用 `tsc --noEmit` 阻塞 PR。

ESLint 可以优先约束：

- 禁止测试以外直接访问真实外部服务。
- 禁止业务模块直接读取 `process.env`，统一走配置模块。
- 禁止 CLI 层之外调用 `process.exit`。
- 禁止深层模块写 `console.log`，统一走输出适配器。
- 对未处理 Promise、未使用变量和导入顺序使用严格规则。

TypeScript 或 `checkJs` 可以优先约束：

- 公共配置对象、命令参数和协议消息结构。
- MCP 工具输入输出 schema。
- 本地守护进程状态机和错误码联合类型。

## GitHub workflow 规则

PR 门禁默认形态：

```yaml
name: Node Tool Gates

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

jobs:
  node-tool:
    name: Node Tool Gates
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm pack --dry-run --json
```

规则：

- required check 名称固定，例如 `Node Tool Gates`。
- 不使用 workflow 级 `paths-ignore`，避免 required check 在文档 PR 上消失。
- 小仓库不需要 planner；monorepo 才加 plan step。
- 使用 `timeout-minutes` 防止长连接测试挂住。
- live 集成检查单独 workflow，使用 `workflow_dispatch`、`schedule` 或合入 `main` 后触发。

## 版本规则

版本选择建议：

- Node 版本以 `engines.node` 为起点；CI 固定最低支持主版本。
- 如果需要前向兼容信号，再增加当前最新稳定主版本矩阵，但不要把最新版作为唯一 required check。
- npm 精确版本通常跟随 Node 附带版本；依赖精确版本由 `package-lock.json` 固定。
- 新增 ESLint、TypeScript 或测试框架时，用 package manager 写入锁文件，并把升级验证纳入配置漂移测试。
