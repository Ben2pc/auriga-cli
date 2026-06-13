---
name: scaffold-kotlin-android-quality-gates
description: 为 Kotlin Android 仓库搭建质量门禁，按检查工具、检查规则和调用时机三层组织方案，并在写入前确认。
---

# 搭建 Kotlin Android 质量门禁

当用户要为 Kotlin Android 仓库设计或搭建硬质量门禁时使用本技能。范围限定在 Android Gradle 项目，不覆盖 iOS、后端服务或 Web 前端。

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

1. 检查目标仓库里的 `AGENTS.md`、Gradle wrapper、convention plugin、`build.gradle.kts`、GitHub 工作流、hook 脚本、Detekt、Spotless、Android Lint、测试任务和已有 affected-check 代码。
2. 按下面三层结构形成方案。
3. 如果需要扩展规则或确认最新规则名，先查 `references/concrete-rules.md` 的官方文档入口，不要只凭记忆补规则。
4. 用 `../references/gate-levels-and-template.md` 的分级表给出推荐档位和取舍，不要替用户决定档位。
5. 停在 confirmation-before-write 闸门。展示计划创建或修改的精确文件和远端设置，然后请求用户明确批准。
6. 批准后，落地最窄但有用的脚手架，运行新的本地入口，并报告仍需手工处理的 GitHub 设置。

## 第一层：检查工具

识别可执行的 Android 检查：Gradle 构建和测试任务、Spotless、Detekt、Android Lint、截图或 preview 检查、自定义 affected-quality 编排入口，以及依赖或模块图检查。

## 第二层：检查规则

把每个工具映射到它执行的规则：格式化、Kotlin 静态分析、Android 资源正确性、模块边界、本地化、依赖约束、截图契约或 preview 契约。

## 第三层：调用时机

决定检查在哪里运行：本地 hook 提供快速反馈，拉取请求工作流作为权威，required status check 阻塞合并，定时工作流承载慢回归，GitHub ruleset 约束审查要求。

## 输出形态

返回简洁的脚手架方案，包含：

- 计划创建或修改的文件；
- 第一层工具表；
- 第二层规则表；
- 第三层调用时机表；
- confirmation-before-write 提示；
- 实现后的验证命令。
