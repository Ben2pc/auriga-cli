# ADR-0001: systematic-debugging skill 的来源选型

- 状态：**已评估，决策延后**
- 日期：2026-05-12
- 当前选择：保留 `obra/superpowers` 上游，不引入 `addyosmani/agent-skills`

## 背景

`systematic-debugging` 被 root `CLAUDE.md` 的 pre-coding 阶段直接引用，是调试纪律的入口 skill。本地（user-global 与 `.agents/skills/`）已通过 `npx skills add` 同步至 `obra/superpowers` HEAD。

候选替代：`addyosmani/agent-skills` 的 `debugging-and-error-recovery`，由 Anthropic 生态内活跃维护者编写，最近 6 周仍在迭代。

## 上游活跃度对比

| | obra/superpowers | addyosmani/agent-skills |
|---|---|---|
| 仓库建立 | 2025-10-09 | 2026-02-15 |
| 该 skill 路径提交数 | 7 | 5 |
| 最后实质内容更新 | 2025-12-12 | 2026-03-31 |
| 跟模型版本同步意识 | 不明显 | 有 commit 显式提到 "Soften prescriptive language for Claude 4.6 compatibility" |
| 评价 | 成熟稳定，内容已冻结约 5 个月 | 年轻持续迭代 |

## 内容能力差异

obra 独有的硬资产：

- Phase 2 模式分析（找 codebase 内相似的"工作版本"做对照）
- Phase 4.5 架构升级护栏（连续 3 次修复失败 → 停手质疑架构）
- 三份 reference：`root-cause-tracing.md`、`defense-in-depth.md`、`condition-based-waiting.md`
- `find-polluter.sh` 辅助脚本

addyosmani 独有的硬资产：

- 把错误输出当不可信数据（防 prompt injection）
- `git bisect` / `git bisect run` 回归定位
- 错误类型 playbook（测试失败 / 构建失败 / 运行时错误 三套决策树）
- 末尾的 Verification 清单

## 当前结论与理由

**不引入 addyosmani 版本，保留 obra。** 理由：

1. addyosmani 真正不可替代的只有"不可信错误输出"一条，其它要么重复（Verification 清单与 `verification-before-completion` skill 重叠），要么是已有能力的边角增强（git bisect、错误类型决策树）。
2. 同时安装两份 skill 会造成自然语言触发冲突——两份的 description 关键词高度重合，Agent 匹配会摇摆甚至同时拉起来浪费上下文。
3. obra 的 Phase 4.5 架构升级护栏 + 三份 reference 是稀缺资产，替换成 addyosmani 会损失更多。
4. obra 内容虽冻结，但当前版本是"完成态"，不是"过时态"，短期内被 Claude 模型迭代淘汰的风险可控。

## 何时重新评估

任一触发即应重看：

- obra 上游仍持续 6 个月以上无任何内容更新，且 Claude 模型有显著行为变化（如 5.x 上线）
- 实际遇到"错误信息携带 prompt injection 被 Agent 误执行"事件
- addyosmani 持续迭代到内容明显领先一个数量级
- 团队规模扩大，需要更多面向新人的错误类型 playbook

## 真要迁移时的备选路径

按 auriga-cli 的"owned skill"约定建一份自有版本，**而不是简单替换为 addyosmani 上游**：

1. 路径：`skills/systematic-debugging/SKILL.md`（auriga-cli 自有）
2. 以 obra HEAD 为底（296 行 + 3 份 reference），手动吸收 addyosmani 的"不可信错误输出 + git bisect"两个点（合计 10-15 行）
3. `skills-lock.json` 中 `systematic-debugging` 的 `source` 从 `obra/superpowers` 改为 `Ben2pc/auriga-cli`
4. 建 symlink：`.claude/skills/<name>` 和 `.agents/skills/<name>` 都指向 `../../skills/<name>/`（参照根 CLAUDE.md "Editing an auriga-cli-owned workflow skill" 段落）
5. 在 README 两份语言的 skills 表格里把这条标记为自有
6. 重算 `skills-lock.json` 中的 `computedHash`

收益：拿到 addyosmani 的核心增量；保留 obra 的所有硬资产；脱离 obra 的更新冻结风险，节奏自主；维护成本一次性，无多上游同步开销。

代价：失去免费跟上游的能力；后续 addyosmani 或 obra 若有有价值的新增内容，需手动 cherry-pick。
