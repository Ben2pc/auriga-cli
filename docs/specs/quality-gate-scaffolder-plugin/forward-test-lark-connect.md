# Quality Gate Scaffolder 前向验证报告

日期：2026-06-13

## 目的

验证 `quality-gate-scaffolder` 插件是否能把现有硬门禁经验迁移到真实目标仓库，并检查新增的 Node 工具技能是否只是适配 `lark-connect`，还是能泛化到更小的 Node 命令行工具样本。

## 验证一：用 TypeScript 前端技能评估 `lark-connect`

目标仓库：`../lark-connect`

使用技能：`scaffold-typescript-frontend-quality-gates`

结论：

- 部分适配，但不是正确技能。
- `lark-connect` 是 JavaScript Node 命令行工具、本地守护进程和 MCP 服务，不是网页前端仓库。
- 共享的三层模型和 L0-L4 分级仍然适用。
- React、浏览器、TypeScript 前端、Vite 或前端 lint 规则不应直接迁移。

暴露的问题：

- 插件缺少 Node 工具、命令行和本地服务仓库的专用技能。
- TypeScript 前端技能边界是正确的，但需要有另一个技能承接 Node 工具场景。

处理结果：

- 新增 `scaffold-node-tool-quality-gates`。
- Node 技能覆盖 `node --check`、`node --test`、命令行入口、包发布形态、运行时配置和敏感环境变量边界。

## 验证二：用 Node 工具技能评估 `lark-connect`

目标仓库：`../lark-connect`

使用技能：`scaffold-node-tool-quality-gates`

结论：

- 推荐目标档位为 L2：生产基础门禁。
- 该判断合理，因为 `lark-connect` 是长期维护的发布型 Node 工具，连接飞书、本地守护进程和 MCP 服务，风险高于一次性脚本。
- 不建议引入 TypeScript、ESLint 或 affected planner 作为第一步；先保护现有 `npm run build`、`npm test`、包形态和命令行入口。

建议方案摘要：

- 工具：`npm run build`、`npm test`、`npm pack --dry-run --json`、`node src/cli.js --help`。
- 规则：`bin` 指向 `src/cli.js` 且保留 shebang；`engines.node` 与 CI Node 主版本一致；默认测试不得触达真实飞书；状态输出不得泄露 `FEISHU_APP_SECRET`；包内容只包含运行时源码和 README。
- 触发：本地 `pre-push` 可跑轻量全量门禁；PR CI 使用 `Node Tool Gates` 作为 required check；真实飞书 live doctor 放手动、合入后或定时 workflow。

校正说明：

- 子代理曾报告 `npm test` 当前红，但主代理复核 `../lark-connect` 当前 `npm test` 通过，54 个测试全绿。因此报告以复核结果为准。
- 子代理没有把网页前端规则带入 Node 工具方案，说明新增技能修正了第一轮暴露的误配问题。

## 验证三：用 Node 工具技能评估最小 Node 样本

目标样本：临时目录 `auriga-qg-node-tool-sample-*`

样本形态：

- 单包 JavaScript Node 命令行工具。
- 有 `package.json`、`src/cli.js`、`tests/cli.test.mjs` 和 README。
- 有 `npm run build` 和 `npm test`。
- 无锁文件、无 Git 仓库元数据、无持续集成。

样本基线：

- `npm run build` 通过。
- `npm test` 通过，2 个测试全绿。

使用技能：`scaffold-node-tool-quality-gates`

结论：

- 推荐档位为 L1：轻量硬门禁。
- 该判断合理，因为样本是小型单包工具，没有锁文件、Git 仓库元数据或持续集成，不应直接上 L2 planner 或复杂规则。
- 如果样本后续发布到 npm 或多人长期维护，可以升级到 L2。

建议方案摘要：

- 工具：保留 `node --check` 和 `node --test`，新增 `npm pack --dry-run --json`。
- 规则：`bin` 指向 CLI 入口，入口保留 shebang，`--help` 无凭证成功，状态输出不泄露 token 原文，发布包只包含运行时文件。
- 触发：本地 `pre-push` 和 PR CI 跑同一组轻量命令；暂不建议 `pre-commit`、main 后 action 或定时 action。
- 用户确认项：是否生成并提交 `package-lock.json`；是否使用 `npm ci`；是否创建 workflow；是否安装本地 hook；是否把 `Node Tool Gates` 设置为 required check。

暴露的问题：

- Node 参考文档默认假设目标是 Git 仓库，并默认要求 `package-lock.json` 配合 `npm ci`。
- 对无锁文件、临时目录或零依赖样本，文档需要明确：先把“是否生成并提交锁文件”列为用户确认项，不要静默假设 `npm ci` 可用。

处理结果：

- 已补充 Node 参考文档：无锁文件或非 Git 仓库时，先报告前提缺失，并让用户决定是否生成锁文件、初始化仓库或迁入真实仓库。

## 总体结论

- 新增 Node 工具技能是必要的，不能把 Node 工具仓库归入 TypeScript 前端技能。
- 新技能能区分 `lark-connect` 这类长期维护工具和最小 Node 样本：前者推荐 L2，后者推荐 L1。
- 技能在两轮 Node 验证中都把最终决策权交给用户，没有直接建议写入文件或修改远端 GitHub 设置。
- 当前剩余风险主要是样本数量仍少；后续可以再找一个真实第三方 Node 命令行仓库做只读前向验证。

## 已运行验证

- `../lark-connect`: `npm test` 通过，54 个测试全绿。
- 临时 Node 样本：`npm run build` 通过。
- 临时 Node 样本：`npm test` 通过，2 个测试全绿。
