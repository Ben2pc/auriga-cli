# 质量门禁脚手架

这个插件把已经验证过的硬门禁模式沉淀为技术栈专属的脚手架技能。它不是一套可以无脑套用的通用策略包；它的作用是指导 Agent 在目标仓库里做出项目自有、可执行、可维护的门禁方案。

包含的技能：

- `scaffold-swift-ios-quality-gates`
- `scaffold-kotlin-android-quality-gates`
- `scaffold-python-backend-quality-gates`
- `scaffold-typescript-frontend-quality-gates`
- `scaffold-node-tool-quality-gates`

每个技能都使用同一个三层模型：

1. 检查工具：会实际执行并可能失败的命令和脚本。
2. 检查规则：这些工具编码并执行的项目策略。
3. 调用时机：检查在什么时候运行，例如 git hook、GitHub Actions、分支 ruleset 和阻塞式审查线程。

技能在写入目标仓库文件或修改远端 GitHub 设置前，必须先向用户展示方案并拿到明确确认。
