---
name: scaffold-python-backend-quality-gates
description: 为 Python 后端仓库搭建质量门禁，按检查工具、检查规则和调用时机三层组织方案，并在写入前确认。
---

# 搭建 Python 后端质量门禁

当用户要为 Python 后端仓库或后端子包设计或搭建硬质量门禁时使用本技能。范围限定在 Python 后端服务，不覆盖移动客户端或 Web 前端。

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

1. 检查目标仓库里的 `AGENTS.md`、Python 包管理文件、`pyproject.toml`、测试配置、导入边界工具、部署检查、GitHub 工作流、hook 脚本和已有门禁编排入口。
2. 按下面三层结构形成方案。
3. 如果需要扩展规则或确认最新规则名，先查 `references/concrete-rules.md` 的官方文档入口，不要只凭记忆补规则。
4. 用 `../references/gate-levels-and-template.md` 的分级表给出推荐档位和取舍，不要替用户决定档位。
5. 停在 confirmation-before-write 闸门。展示计划创建或修改的精确文件和远端设置，然后请求用户明确批准。
6. 批准后，落地最窄但有用的脚手架，运行新的本地入口，并报告仍需手工处理的 GitHub 设置。

## 第一层：检查工具

识别可执行的 Python 后端检查：格式化工具、静态检查工具、类型检查器、导入边界检查器、单元测试和集成测试、环境校验、部署校验、后台任务进程或任务队列检查，以及自定义 gate 脚本。

## 第二层：检查规则

把每个工具映射到它执行的规则：代码风格、类型、架构边界、默认无网络测试、测试夹具策略、环境变量要求、部署不变量或后台任务进程契约。

## 第三层：调用时机

决定检查在哪里运行：本地 hook 提供快速反馈，拉取请求工作流作为权威，required status check 阻塞合并，部署工作流承载发布前门禁，GitHub ruleset 约束审查要求。

## 输出形态

返回简洁的脚手架方案，包含：

- 计划创建或修改的文件；
- 第一层工具表；
- 第二层规则表；
- 第三层调用时机表；
- confirmation-before-write 提示；
- 实现后的验证命令。
