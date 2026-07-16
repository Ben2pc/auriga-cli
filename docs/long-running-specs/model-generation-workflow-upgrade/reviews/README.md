# 技能评审索引

本目录用于逐项记录本轮技能评审。每次只评审一个技能；参考技能可以先加入“对照材料”，不必自动成为安装资产。外部与可选插件仅保留清单，不计入本轮评审完成度。

## 深入评审结论

每项进入深入评审的技能只能选择一个主结论：

- 删除：目标模型原生能力已稳定覆盖，且约束的净影响为负。
- 保留：仍有独立职责，当前形态没有明显冗余。
- 精简：职责仍成立，但触发条件、步骤或产物过重。
- 内化：属于核心职责，且外部维护权或漂移风险不可接受。
- 合并：与另一项资产职责重叠，应收敛为一个入口或契约。
- 机制替代：应由测试、类型系统、钩子或持续集成等确定性机制执行。

## 深入评审必答维度

1. 它针对什么可复现失效模式？
2. GPT 5.6 Sol 与 Fable 5 是否仍会出现该失效？
3. 它是否抑制模型原生规划、工具选择或代理协作？
4. 它是否承担确定性机制、持久契约、独立评估或跨运行时适配？
5. 它与其他技能是否重复、递归或形成强耦合？
6. 它增加多少交互轮次、令牌、延迟与维护成本？
7. Auriga 是否必须拥有其维护权？
8. 删除或精简后，出现什么信号才应恢复？

## 跳过深入评审的保留决定

用户可以明确按分发与触发边界保留一个非强制工具型技能，并跳过目标模型深入评审。记录必须区分“是否默认安装”和“是否默认执行”，说明它为何不会成为每个任务的强制步骤，并保留共同风险与重新评估条件。这类决定是范围处置，不构成 GPT 5.6 Sol 或 Fable 5 的模型能力证据。

共同风险：上游技能可能扩大触发条件、增加常驻上下文，或从可选工具演变为默认流程约束。出现以下任一信号时重新评估：技能开始自动触发、成为每个任务的强制步骤、明显增加无关上下文，或上游职责发生实质变化。

## 当前清单

### Auriga 自有工作流技能

| Asset (资产) | Source (来源) | Runtime (运行时) | Status (状态) |
|---|---|---|---|
| [`arch-design`](../../../worklog/worklog-2026-07-14-refactor-simplify-arch-design/arch-design-modernization/review.md) | Auriga 插件 | Claude Code / Codex | 精简；实现已落地 PR #183；强化架构与领域模型触发、人工评审门禁、技术质量目标和条件式工具箱；模型评测未执行 |
| [`code-simplify`](../../../worklog/worklog-2026-07-15-refactor-simplify-code-simplify-skill/code-simplify-modernization/review.md) | Auriga 插件 | Claude Code / Codex | 精简；PR #184 首次深入评审无阻塞问题，文档同步意见已处理；保留授权边界、行为保护、维护成本判断、用户确认的普查模式和按需手法提醒；模型评测未执行 |
| [`deep-review`](../../../worklog/worklog-2026-07-15-refactor-deep-review-for-new-models/deep-review-modernization/review.md) | Auriga 插件 | Claude Code / Codex | 精简；PR #185 已完成首次深入评审并处理信任边界、协议闭环、长期契约与结构性测试意见；保留 10 个独立审查维度和弱模型所需细节；模型评测未执行 |
| [`docent`](../../../worklog/worklog-2026-07-15-refactor-simplify-docent-skill/docent-modernization/review.md) | Auriga 插件 | Claude Code / Codex | 首次深入评审完成并修复默认视觉基线、验证路径、真实调用名与契约证据；保留显式调用、单子代理隔离和可视化离线制品；模型评测未执行 |
| [`documentation-management`](../../../worklog/worklog-2026-07-16-refactor-documentation-management/documentation-management/review.md) | Auriga 插件；由 `documentation-and-adrs` 重命名 | Claude Code / Codex | 精简；PR #188 已完成首次深入评审并修复阻塞项；转为工程文档资产治理，区分人类文档、Agent 资料、行为指令与共享资产；模型评测未执行 |
| [`git-workflow`](../../../worklog/worklog-2026-07-16-refactor-simplify-git-workflow/git-workflow-modernization/review.md) | Auriga 插件 | Claude Code / Codex | PR #189 首次深入评审完成并修复全部确认项；删除通用 Git 教学与 Hook 实现细节，保留仓库安全、提交、拉取请求、评审反馈和合并契约，Ready 守卫只检查活动计划并具备安全扫描边界；模型评测未执行 |
| [`goalify`](../../../worklog/worklog-2026-07-16-refactor-goalify-simplify/goalify-modernization/review.md) | Auriga 插件 | Claude Code / Codex | 精简；PR #190 首次深入评审完成并修复全部高置信度契约与文档问题；保留深度评审收敛、架构人工门禁和双运行时条件式启动；模型评测未执行 |
| [`incremental-impl`](../../../worklog/worklog-2026-07-16-refactor-simplify-incremental-impl/review.md) | Auriga 插件 | Claude Code / Codex | 精简；PR #191 首次深入评审完成并修复并行依赖、契约追溯、工作流版本和长期文档同步问题；核心职责收敛为按需求结果与合法中间状态拆分完整实施单元，派发降为可选执行方式；模型评测未执行 |
| `reviewer-creator` | Auriga 插件 | Claude Code / Codex | 待评审 |
| `session-compound` | Auriga 插件 | Claude Code / Codex | 待评审 |
| `spec-design` | Auriga 插件 | Claude Code / Codex | 待评审；PR #183 已修复交接绕过 `arch-design`，现有长程子规范拆分树与“规格 / 架构 / 实施计划”三阶段边界仍需在本技能轮次单独澄清 |
| [`systematic-debugging`](../../../worklog/worklog-2026-07-14-feat-model-generation-workflow-upgrade/systematic-debugging/review.md) | Auriga 插件；内化自 `obra/superpowers` | Claude Code / Codex | 内化结论暂定；实现已合入 PR #177；PR #178 取消自动迁移并采用团队人工清理；模型评测未执行且不在 PR #178 范围内 |
| [`test-driven-development`](../../../worklog/worklog-2026-07-14-refactor-simplify-tdd-skill/unified-tdd-skill/review.md) | Auriga 插件；精简自 `obra/superpowers` 并合并原 `test-designer` | Claude Code / Codex | 精简、内化并合并；模型评测未执行 |

### Auriga 自有质量门禁技能

| Asset (资产) | Source (来源) | Runtime (运行时) | Status (状态) |
|---|---|---|---|
| `scaffold-kotlin-android-quality-gates` | Auriga 插件 | Claude Code / Codex | 待评审 |
| `scaffold-node-tool-quality-gates` | Auriga 插件 | Claude Code / Codex | 待评审 |
| `scaffold-python-backend-quality-gates` | Auriga 插件 | Claude Code / Codex | 待评审 |
| `scaffold-swift-ios-quality-gates` | Auriga 插件 | Claude Code / Codex | 待评审 |
| `scaffold-typescript-frontend-quality-gates` | Auriga 插件 | Claude Code / Codex | 待评审 |

### 外部核心技能

| Asset (资产) | Source (来源) | Runtime (运行时) | Status (状态) |
|---|---|---|---|
| `planning-with-files` | `OthmanAdi/planning-with-files` | Claude Code / Codex | 保留；随推荐预设默认安装，但只有用户在计划菜单选择长程持久跟踪时才执行；文件化计划对跨会话任务有独立价值；跳过深入评审，不构成模型能力结论 |
| `playwright-cli` | `microsoft/playwright-cli` | Claude Code / Codex | 保留；随推荐预设默认安装，但只在浏览器自动化任务中触发，不是每个任务的强制步骤；跳过深入评审，不构成模型能力结论 |
| [`test-driven-development`](../../../worklog/worklog-2026-07-14-refactor-simplify-tdd-skill/unified-tdd-skill/review.md) | `obra/superpowers` | Claude Code / Codex | 外部版本退出锁定与预设，由 Auriga 精简版本替代；模型评测未执行 |
| [`verification-before-completion`](../../../worklog/worklog-2026-07-14-refactor-remove-verification-skill/verification-before-completion/review.md) | `obra/superpowers` | Claude Code / Codex | PR #181 已完成实现并归档子规范；主结论：删除；完成声明职责由工作流规则与确定性机制承担；模型评测未执行 |

### 外部推荐技能

| Asset (资产) | Source (来源) | Runtime (运行时) | Status (状态) |
|---|---|---|---|
| `claude-code-agent` | `Ben2pc/g-claude-code-plugins` | Claude Code / Codex | 保留；主工作流外的显式跨模型委派能力；跳过深入评审 |
| `codex-agent` | `Ben2pc/g-claude-code-plugins` | Claude Code / Codex | 保留；主工作流外的显式独立 Codex 会话委派能力；跳过深入评审 |
| `deprecation-and-migration` | `addyosmani/agent-skills` | Claude Code / Codex | 保留；只在明确弃用或迁移任务中调用，不进入主工作流；跳过深入评审 |
| `design-taste-frontend` | `Leonxlnx/taste-skill` | Claude Code / Codex | 保留；主工作流外的可选前端设计能力；跳过深入评审 |
| `frontend-design` | `anthropics/skills` | Claude Code / Codex | 保留；主工作流外的可选前端实现能力；跳过深入评审 |
| `make-interfaces-feel-better` | `jakubkrehel/make-interfaces-feel-better` | Claude Code / Codex | 保留；主工作流外的可选界面打磨能力；跳过深入评审 |

### 范围外：所有插件

| Asset (资产) | Source (来源) | Runtime (运行时) | Status (状态) |
|---|---|---|---|
| `auriga-notify` | Auriga 插件，可选 | Claude Code | 本轮范围外；保持现状 |
| `skill-creator` | Anthropic 官方插件市场 | Claude Code | 本轮范围外；保持现状 |
| `claude-md-management` | Anthropic 官方插件市场 | Claude Code / Codex | 本轮范围外；保持现状 |
| `playground` | Anthropic 官方插件市场 | Claude Code / Codex | 本轮范围外；保持现状 |
| `codex` | OpenAI 插件市场 | Claude Code | 本轮范围外；保持现状 |
| `session-instructions-loader` | Auriga 插件 | Codex | 本轮范围外；保持现状 |

## 单项记录模板

深入评审进行时先新增 `docs/specs/<asset-name>/review.md`。默认在同目录维护当前子 PR 的规范与验收契约；用户明确豁免子规范时可以只保留评审记录，并在记录中写明豁免决定。豁免子规范不等于豁免正式评审记录：正式评审记录仍是长期总规范的验收证据，PR Ready 时必须归档到 `docs/worklog/` 或晋升到稳定文档，不能删除；临时规范与计划仍按工作流规则选择归档或删除。本索引只链接归档或晋升后的正式记录，不在长期规范里绕过子 PR 的生命周期门禁。正文使用以下结构：

```markdown
# <asset-name> 评审

## 当前职责

## 可复现失效模式

## 目标模型证据

## 与其他资产的关系

## 处置结论

## 风险与恢复条件

## 参考资料
```
