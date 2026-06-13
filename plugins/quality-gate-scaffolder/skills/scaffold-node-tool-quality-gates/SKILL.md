---
name: scaffold-node-tool-quality-gates
description: 为 Node.js 命令行工具、本地守护进程、MCP 服务或轻量 JavaScript/TypeScript 工具仓库搭建质量门禁，按检查工具、检查规则和调用时机三层组织方案，并在写入前确认。
---

# 搭建 Node 工具质量门禁

当用户要为 Node.js 命令行工具、本地守护进程、MCP 服务、发布到 npm 的工具包，或轻量 JavaScript/TypeScript 工具仓库设计或搭建硬质量门禁时使用本技能。范围不包括网页前端框架的浏览器体验门禁；网页前端使用 `scaffold-typescript-frontend-quality-gates`。

## 必读材料

提出变更前，完整阅读这些文件：

- `../references/three-layer-model.md`
- `../references/landing-safety.md`
- `../references/github-review-and-rulesets.md`
- `../references/invocation-examples.md`
- `../references/gate-levels-and-template.md`
- `references/platform-quality-gates.md`
- `references/concrete-rules.md`

这些路径都以本技能的 `SKILL.md` 所在目录为锚点；加载技能后，按相对路径渐进式读取对应材料。

## 流程

1. 检查目标仓库里的 `AGENTS.md`、`package.json`、锁文件、Node 版本约束、命令行入口、测试配置、lint 或类型配置、GitHub 工作流、hook 脚本和已有门禁编排入口。
2. 按下面三层结构形成方案。
3. 如果需要扩展规则或确认最新规则名，先查 `references/concrete-rules.md` 的官方文档入口，不要只凭记忆补规则。
4. 用 `../references/gate-levels-and-template.md` 的分级表给出推荐档位和取舍，不要替用户决定档位。
5. 停在 confirmation-before-write 闸门。展示计划创建或修改的精确文件和远端设置，然后请求用户明确批准。
6. 批准后，落地最窄但有用的脚手架，运行新的本地入口，并报告仍需手工处理的 GitHub 设置。

## 第一层：检查工具

识别可执行的 Node 工具检查：包管理脚本中的语法检查、原生测试、lint、类型检查、命令行冒烟、包发布形态检查、配置漂移测试，以及保护运行时边界的项目专属测试。

## 第二层：检查规则

把每个工具映射到它执行的规则：脚本入口稳定性、Node 版本兼容性、命令行参数行为、异步资源释放、敏感环境变量不泄露、包内容和 `bin` 映射正确性、依赖锁定、配置漂移和网络边界。

## 第三层：调用时机

决定检查在哪里运行：本地 hook 提供快速反馈，拉取请求工作流作为权威，required status check 阻塞合并，合入后验证包形态或发布烟测，定时工作流覆盖依赖审计和外部集成冒烟。

## 输出形态

返回简洁的脚手架方案，包含：

- 计划创建或修改的文件；
- 第一层工具表；
- 第二层规则表；
- 第三层调用时机表；
- confirmation-before-write 提示；
- 实现后的验证命令。
