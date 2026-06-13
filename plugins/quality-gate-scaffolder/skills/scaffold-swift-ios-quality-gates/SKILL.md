---
name: scaffold-swift-ios-quality-gates
description: 为 Swift iOS 仓库搭建质量门禁，按检查工具、检查规则和调用时机三层组织方案，并在写入前确认。
---

# 搭建 Swift iOS 质量门禁

当用户要为纯 Swift iOS 仓库设计或搭建硬质量门禁时使用本技能。范围限定在 Swift 和 Apple 平台工具链，不覆盖 Kotlin Multiplatform、React Native、Flutter 或后端服务。

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

1. 检查目标仓库里的 `AGENTS.md`、包管理脚本、Xcode project 或 workspace、Swift Package Manager 文件、GitHub 工作流、hook、ruleset 文档，以及已有 lint 或测试配置。
2. 按下面三层结构形成方案。
3. 如果需要扩展规则或确认最新规则名，先查 `references/concrete-rules.md` 的官方文档入口，不要只凭记忆补规则。
4. 用 `../references/gate-levels-and-template.md` 的分级表给出推荐档位和取舍，不要替用户决定档位。
5. 停在 confirmation-before-write 闸门。展示计划创建或修改的精确文件和远端设置，然后请求用户明确批准。
6. 批准后，落地最窄但有用的脚手架，运行新的本地入口，并报告仍需手工处理的 GitHub 设置。

## 第一层：检查工具

识别可执行的 Swift iOS 检查：构建、测试、格式化、SwiftLint、SwiftLint analyze、package 依赖解析、自定义 affected-check 脚本，以及设计 token 或本地化校验器。

## 第二层：检查规则

把每个工具映射到它执行的规则：代码风格、静态分析、模块边界、本地化完整性、设计 token 使用、依赖卫生或生成文件漂移。

## 第三层：调用时机

决定检查在哪里运行：本地 hook 提供快速反馈，拉取请求工作流作为权威，required status check 阻塞合并，定时工作流承载昂贵回归，GitHub ruleset 约束审查要求。

## 输出形态

返回简洁的脚手架方案，包含：

- 计划创建或修改的文件；
- 第一层工具表；
- 第二层规则表；
- 第三层调用时机表；
- confirmation-before-write 提示；
- 实现后的验证命令。
