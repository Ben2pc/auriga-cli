# code-simplify 评审

## 当前职责

在不改变外部可观察行为的前提下，实施函数、类、文件内部及局部协作代码的简化；也支持用户主动发起的目录或模块维护性普查。

## 可复现失效模式

- Agent 在其他任务中顺手重构无关代码，扩大差异和回归范围。
- 简化过程中缺少行为保护，结构变化悄悄改变外部契约。
- 只凭风格偏好或机械阈值清理低价值代码，没有降低真实维护成本。

## 目标模型证据

本轮不执行 GPT 5.6 Sol 或 Fable 5 的受控模型评测。处置依据为用户实际使用经验、当前技能文本审查以及与现有工作流边界的对照，不把该结论表述为目标模型能力已被实验验证。

## 与其他资产的关系

- `deep-review` 负责发现拉取请求中的代码质量问题，本技能负责在用户授权后实施简化。
- `systematic-debugging` 负责缺陷根因定位，本技能不以“反复出现缺陷”替代诊断。
- `arch-design` 负责模块边界、依赖方向、分层和领域职责。
- `test-driven-development` 在结构改动缺少行为保护时补充特征测试。

## 处置结论

精简。删除语言示例和主文件中的基础教学、机械阈值及重复软约束；保留授权边界、行为保护、维护成本判断、目录普查和按需重构手法提醒。

## 风险与恢复条件

精简后，模型可能遗漏某些重构风险或在大范围改动中验证不足。如果后续真实任务持续出现未授权扩张、行为回归或无法将复杂重构拆成可验证步骤，应基于具体失败补回最小必要约束，而不是恢复整套教学内容。

## 首次深入评审结果

PR #184 的规范合规与正确性维度无发现。文档同步意见已处理：更新长程状态，修正 `code-quality` 对旧版快速表和逐步测试规则的引用，并把 Claude、Codex 与市场目录描述收敛为能力概括。`skill-plugin-quality` 对市场版本字段的既有规则漂移不由本轮修改，已记录到后续 `deep-review` 评审范围。

## 参考资料

- `plugins/auriga-workflow/skills/code-simplify/SKILL.md`
- `plugins/auriga-workflow/skills/code-simplify/references/smells-and-refactorings.md`
- `plugins/auriga-workflow/skills/deep-review/references/reviewers/code-quality.md`
