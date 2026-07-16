# git-workflow 评审

## 当前职责

`git-workflow` 管理从操作前仓库确认、分支与工作树隔离、提交、Draft 拉取请求、Ready、评审反馈到合并的完整生命周期。它不再教授常规 Git 命令，而是保存团队特有的安全边界、交付契约和 GitHub 状态同步规则。

## 可复现失效模式

- 在错误仓库、工作树、分支或基准分支上开始工作。
- 覆盖、移动或误提交用户已有且归属不明的改动。
- 拉取请求正文与最终提交、验证结果、风险或后续事项发生漂移。
- 评审修复只存在于本地或对话，没有回报到拉取请求会话。
- 未确认检查、批准、合并策略或远端提交就执行合并。

## 目标模型证据

本轮没有执行 GPT 5.6 Sol 或 Fable 5 模型评测，不把删除 Git 教学解释为模型能力证据。处置依据是通用 Git 知识与团队专属契约的职责边界，以及现有 Hook 和测试已经承担的确定性机制。

## 与其他资产的关系

- 受管 `AGENTS.md` 规定分支先行、尽早创建 Draft 拉取请求和 Ready 门禁，本技能补充这些规则在真实仓库状态下的操作边界。
- `incremental-impl` 使用本技能的语义提交规则，不在自身重复 Git 生命周期。
- `commit-reminder`、`pr-create-guard`、`pr-ready-guard` 和 `pr-merge-guard` 执行可确定的提醒与阻塞，本技能只概括它们的行为契约。
- `deep-review` 负责正式评审；本技能负责把评审处理结果同步回拉取请求并保持正文为当前事实。

## 处置结论

- 结论为精简，Auriga 继续拥有该技能。
- 主文件从 260 行压缩到 108 行，删除通用 Git 教程、交互式变基说明、常见忽略文件清单和 Hook 实现细节。
- 新增仓库、工作树、分支、远端、基准分支和用户改动的操作前检查，并明确高风险历史操作的授权边界。
- 保留语义提交、尽早创建 Draft 拉取请求、Ready、评审反馈批次回报与合并检查。
- PR 模板使用中英文标题，正文示例使用中文；验收标准不再限定为产品需求，没有真实设计决定时允许写“无”。

## 风险与恢复条件

- **风险：安全约束不足。** 若再次出现误操作仓库、覆盖用户改动或错误基准分支，应强化操作前检查或增加确定性保护机制。
- **风险：PR 正文契约过重。** 若简单改动频繁产生无意义章节，优先允许明确写“无”，不删除验收、风险和验证的稳定标题。
- **风险：Hook 与技能漂移。** 若双语标题、Ready 或合并规则改变，必须同步更新 Hook 契约测试和技能中的机制表。
- **风险：反馈同步产生噪声。** 若批次评论重复正文内容，保留“评论记录过程、正文记录当前事实”的边界并进一步压缩评论格式。

## 参考资料

- `plugins/auriga-workflow/skills/git-workflow/SKILL.md`
- `plugins/auriga-workflow/scripts/commit-reminder.mjs`
- `plugins/auriga-workflow/scripts/pr-create-guard.mjs`
- `plugins/auriga-workflow/scripts/pr-ready-guard.mjs`
- `plugins/auriga-workflow/scripts/pr-merge-guard.mjs`
- `docs/long-running-specs/model-generation-workflow-upgrade/`
