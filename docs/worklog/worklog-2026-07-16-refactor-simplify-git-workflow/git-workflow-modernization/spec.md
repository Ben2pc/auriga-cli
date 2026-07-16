# Git Workflow Modernization — Spec (Git 工作流现代化 — 规范)

> 精简 Git 生命周期技能，只保留团队交付契约、操作安全边界和 PR 协议。

## Why (为什么做)

最新模型已经稳定掌握常规 Git 命令和交互式变基等基础知识。继续把这些教学常驻在技能中会增加上下文成本，也会让真正需要遵守的团队规则被埋没。

该技能仍有独立价值：它承载仓库与工作树保护、分支和提交纪律、PR 正文契约、评审反馈同步及合并门禁等团队特有规则。

## Findings (调研发现)

- 当前技能共 260 行，同时包含团队规则、通用 Git 教学和 Hook 实现细节。
- 受管工作流已经规定分支先行、尽早创建 Draft PR 和 Ready 门禁，技能应提供这些规则的操作契约而不是重复完整工作流。
- PR 创建与 Ready Hook 只展示正文标题；合并 Hook 可识别以英文验收与验证标题开头的双语章节。
- 项目没有额外的 `docs/rules/spec/` 规则。

## What (做什么)

- 技能在任何会改变 Git 或 GitHub 状态的操作前，要求确认正确仓库、工作树、分支、远端、基准分支和现有用户改动。
- 技能保留分支隔离、按语义边界提交、Conventional Commits、尽早创建 Draft PR、Ready 前同步最终状态、评审反馈批次回报和合并前检查。
- PR 正文模板使用中英文双语章节标题，模板正文示例使用中文。
- 验收标准表示当前 PR 必须成立的可验证结果，不限定为产品需求；没有真实设计决定时允许明确写“无”。
- 技能只概括四个 Git 生命周期 Hook 的职责，不复制参数解析、事件名称或失败策略等实现细节。
- Ready 守卫不再检查仓库根目录的旧版 `task_plan.md`、`findings.md` 和 `progress.md`；只检查 `.planning/.active_plan` 及其指向的活动计划目录，非活动计划目录不阻塞。
- Ready 守卫继续递归检查 `docs/specs/` 中未处理的 Markdown 规格，并在符号链接、读取异常、非法活动计划指针或扫描资源超限时安全阻塞。

## Out of scope (本次不做)

- 不改变其他 Hook 的运行时行为或 PR 合并门禁语义。
- 不修改受管工作流的阶段顺序。
- 不评测 GPT 5.6 Sol 或 Fable 5 的 Git 操作能力。
- 不新增通用 Git 教程或命令参考资料。

## Open questions (悬而未决)

无。

## References (参考资料 — 可选；澄清期间用户给过任何外链时必填)

- `plugins/auriga-workflow` 现有 Git 生命周期技能、Hook 与契约测试。
- `docs/long-running-specs/model-generation-workflow-upgrade/` 的逐技能评审清单。
