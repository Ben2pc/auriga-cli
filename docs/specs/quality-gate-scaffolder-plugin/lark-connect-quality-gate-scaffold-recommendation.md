# 质量门禁脚手架建议

目标仓库：`../lark-connect`  
目标类型：Node.js 命令行工具、本地守护进程、MCP 服务  
生成依据：`quality-gate-scaffolder` 的最终脚手架建议模板和 `scaffold-node-tool-quality-gates`

## 推荐档位

推荐档位：L2：生产基础门禁  
推荐理由：`lark-connect` 已经是长期维护的 Node 工具仓库，包含命令行入口、本地守护进程、MCP 服务、飞书 SDK 集成和 npm 发布形态；已有稳定的 `npm run build`、`npm test`、`package-lock.json` 和 `engines.node >=22`。它不是一次性脚本，默认应在拉取请求阶段用 required check 阻塞基础质量回归。  
备选档位：如果用户更重视速度，建议降到 L1，只保留 `build`、`test`、`pack:check` 和拉取请求检查；如果更重视稳定性，建议升到 L3，引入包契约测试、命令行冒烟、可选 ESLint 边界规则和合入后 tarball 安装烟测。

## 用户需要决定的事项

| 决策项 | 推荐值 | 可选项 | 取舍 |
| --- | --- | --- | --- |
| 门禁档位 | L2 | L1 / L2 / L3 | L2 能覆盖当前生产工具风险；L1 更轻但缺少配置漂移保护；L3 更稳但需要维护更多规则 |
| 是否启用本地 git hook | 启用 `pre-push` | 不启用 / 只给模板 / 启用 | 启用后能在推送前发现问题；代价是每次推送多跑一次全量轻量门禁 |
| 是否启用本地 git hook + planner | 暂不启用 | 暂不启用 / 后续启用 | 仓库是单包 Node 工具，全量检查很快；现在上 planner 会增加维护成本 |
| PR required check 名 | `Node Tool Gates` | `Quality Gates` / `Node Tool Gates` / 自定义 | 技术栈名更明确；如果未来合并多个技术栈门禁，可以统一为 `Quality Gates` |
| main 后 action | 暂不纳入第一版 | 暂不纳入 / tarball 安装烟测 | 第一版先保护 PR；发布频率稳定后再加 tarball 安装烟测 |
| 定时 action | 暂不纳入第一版 | 暂不纳入 / live doctor / 依赖审计 | 真实飞书检查需要 secrets，适合定时或手动触发，不应阻塞第一版 PR |

## 第一层：检查工具

| 工具 | 作用 | 推荐版本策略 | 预期耗时 | 是否纳入本次脚手架 |
| --- | --- | --- | --- | --- |
| Node.js | 执行命令行、语法检查和原生测试 | CI 固定 Node 22，与 `engines.node >=22` 对齐 | 秒级 | 是 |
| npm / `package-lock.json` | 可复现安装和依赖锁定 | CI 使用 `npm ci`，缓存绑定 `package-lock.json` | 秒级到十几秒 | 是 |
| `npm run build` | 通过 `node --check` 检查 `src/**/*.js` 语法 | 保留现有脚本，不伪装成真实构建产物 | 秒级 | 是 |
| `npm test` | 通过 `node --test` 运行原生测试 | 保留单一测试框架，避免引入 Vitest/Jest 重叠 | 当前约 54 个测试，秒级 | 是 |
| `npm pack --dry-run --json` | 检查 npm 包发布形态和入包文件 | 新增 `pack:check` 脚本或在 CI 直接执行 | 秒级 | 是 |
| `node src/cli.js --help` | 命令行入口无凭证冒烟 | 保持入口可在无真实飞书凭证下运行 | 秒级 | 是 |
| 包契约测试 | 锁住 `bin`、`files`、`engines`、关键 scripts | 用 `node --test` 新增一组配置漂移测试 | 秒级 | 建议纳入 |
| ESLint | 约束导入边界、`process.env` 和 `process.exit` 使用 | 暂不默认引入；L3 时再讨论 | 低到中 | 暂不纳入 |
| GitHub Actions | PR 阶段权威门禁和 required check | `ubuntu-24.04` + `actions/setup-node@v4` + Node 22 | 约 1-3 分钟 | 是 |

## 第二层：检查规则

| 规则类别 | 规则来源文件 | 初始严格度 | 失败形态 | 升级路径 |
| --- | --- | --- | --- | --- |
| JavaScript 语法正确性 | `package.json` `scripts.build` | 严格，`node --check` 失败即阻塞 | `npm run build` 非零退出 | 后续如迁移 TypeScript，再改为 `tsc --noEmit` |
| 原生单元测试 | `tests/*.test.mjs` | 严格，默认测试不得依赖真实飞书 | `npm test` 非零退出 | 增加 CLI、MCP、daemon、HTTP 和错误码覆盖 |
| 命令行入口 | `package.json` `bin`、`src/cli.js` | 严格，入口必须存在且保留 shebang | 包契约测试或 CLI 冒烟失败 | 增加 tarball 安装后执行 `--help` |
| 包发布形态 | `package.json` `files`、`npm pack --dry-run --json` | 严格，运行时文件必须入包 | `pack:check` 或包契约测试失败 | 合入后加 tarball 安装烟测 |
| Node 版本契约 | `package.json` `engines.node`、workflow Node 版本 | 严格，CI 固定 Node 22 | workflow 环境或包契约测试失败 | 增加当前最新稳定 Node 主版本矩阵 |
| 敏感配置不泄露 | `src/config.js`、`doctor` 输出、相关测试 | 严格，不能输出 secret 原文 | 测试断言失败 | 对日志、错误消息和诊断报告增加过滤测试 |
| 外部服务隔离 | tests 和 live doctor 分离 | 严格，默认测试不触达真实飞书 | 测试需要真实 secrets 或网络而失败 | live doctor 放手动、合入后或定时 workflow |
| 配置漂移保护 | 新增 `tests/package-contract.test.mjs` | 中等，先锁关键脚本和包入口 | 配置被改松后测试失败 | 后续加入 ESLint 边界规则和 README 工具表一致性 |

## 第三层：调用时机

| 时机 | 运行内容 | 是否基于 diff | 超时预算 | 失败是否阻塞 |
| --- | --- | --- | --- | --- |
| AGENTS.md 软约束 | 记录 Node 工具门禁边界、真实飞书检查不进默认测试 | 否 | 无 | 不阻塞 |
| `pre-commit` | 暂不启用；可选只跑 `git diff --cached --check` | 是，只看暂存区 | 秒级 | 可选阻塞 |
| `pre-push` | `npm run build && npm test && npm run pack:check && node src/cli.js --help` | 否 | 2 分钟 | 建议阻塞 |
| PR 持续集成 | `npm ci`、`npm run build`、`npm test`、`npm run pack:check`、CLI 冒烟 | 否 | 10 分钟 | 是，作为 required check |
| main 后 action | 暂不纳入；未来可做 tarball 安装烟测 | 否 | 10 分钟 | 不阻塞 PR |
| 定时 action | 暂不纳入；未来可做 live doctor 和依赖审计 | 否 | 10-20 分钟 | 不阻塞 PR |

## 计划创建或修改的文件

| 文件 | 用途 | 由谁维护 |
| --- | --- | --- |
| `package.json` | 增加 `pack:check` 和可选 `quality` 脚本 | 工程维护者 |
| `tests/package-contract.test.mjs` | 锁住 `bin`、`files`、`engines.node`、关键 scripts 和 shebang | 工程维护者 |
| `.github/workflows/node-tool-gates.yml` | PR required check，运行 Node 工具门禁 | 工程维护者和平台负责人 |
| `.githooks/pre-push` | 本地推送前快速门禁 | 工程维护者，可选 |
| `AGENTS.md` | 记录真实飞书检查、secrets 和默认测试边界 | 工程维护者，可选 |

## 不纳入本次的生产级门禁

| 暂不加入项 | 原因 | 未来触发条件 |
| --- | --- | --- |
| affected planner | 单包 Node 工具，全量检查很快 | 仓库变成 monorepo 或全量检查超过 3-5 分钟 |
| ESLint | 当前已有 `node --check` 和测试，第一版先避免引入新依赖 | 出现跨层导入、`process.env` 分散读取或 `process.exit` 滥用 |
| TypeScript / `checkJs` | 纯 JavaScript 仓库，不应为了门禁强行迁移 | 公共协议、MCP schema 或配置对象复杂度上升 |
| main 后 tarball 安装烟测 | 第一版先让 PR required check 稳定 | 准备 npm 发布或发生包内容漂移 |
| 定时 live doctor | 需要真实飞书 secrets，误报和权限成本更高 | 飞书集成进入长期线上可用性要求 |
| 依赖审计 required check | 容易产生维护噪音，不适合第一版阻塞 PR | 安全合规要求提高或依赖数量增长 |

## confirmation-before-write

请确认是否按上面的档位和文件清单写入 `../lark-connect`。确认前不应修改目标仓库。

需要你明确选择：

- 门禁档位：采用推荐 L2，还是先降到 L1？
- 是否新增 `pack:check` 和可选 `quality` 脚本？
- 是否新增 `tests/package-contract.test.mjs`？
- 是否创建 `.github/workflows/node-tool-gates.yml`？
- 是否安装本地 `pre-push` hook，并允许阻塞推送？
- PR required check 名是否固定为 `Node Tool Gates`？
- GitHub ruleset 或 branch protection 是否本次只给手工配置步骤？
