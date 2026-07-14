# 技能评审索引

本目录用于逐项记录技能与插件评审。每次只评审一个资产；参考技能可以先加入“对照材料”，不必自动成为安装资产。

## 评审结论

每项资产只能选择一个主结论：

- 删除：目标模型原生能力已稳定覆盖，且约束的净影响为负。
- 保留：仍有独立职责，当前形态没有明显冗余。
- 精简：职责仍成立，但触发条件、步骤或产物过重。
- 内化：属于核心职责，且外部维护权或漂移风险不可接受。
- 合并：与另一项资产职责重叠，应收敛为一个入口或契约。
- 机制替代：应由测试、类型系统、钩子或持续集成等确定性机制执行。

## 必答维度

1. 它针对什么可复现失效模式？
2. GPT 5.6 Sol 与 Fable 5 是否仍会出现该失效？
3. 它是否抑制模型原生规划、工具选择或代理协作？
4. 它是否承担确定性机制、持久契约、独立评估或跨运行时适配？
5. 它与其他技能是否重复、递归或形成强耦合？
6. 它增加多少交互轮次、令牌、延迟与维护成本？
7. Auriga 是否必须拥有其维护权？
8. 删除或精简后，出现什么信号才应恢复？

## 当前清单

### Auriga 自有工作流技能

| Asset (资产) | Source (来源) | Runtime (运行时) | Status (状态) |
|---|---|---|---|
| `arch-design` | Auriga 插件 | Claude Code / Codex | 待评审 |
| `code-simplify` | Auriga 插件 | Claude Code / Codex | 待评审 |
| `deep-review` | Auriga 插件 | Claude Code / Codex | 待评审 |
| `docent` | Auriga 插件 | Claude Code / Codex | 待评审 |
| `documentation-and-adrs` | Auriga 插件 | Claude Code / Codex | 待评审 |
| `git-workflow` | Auriga 插件 | Claude Code / Codex | 待评审 |
| `goalify` | Auriga 插件 | Claude Code / Codex | 待评审 |
| `incremental-impl` | Auriga 插件 | Claude Code / Codex | 待评审 |
| `reviewer-creator` | Auriga 插件 | Claude Code / Codex | 待评审 |
| `session-compound` | Auriga 插件 | Claude Code / Codex | 待评审 |
| `spec-design` | Auriga 插件 | Claude Code / Codex | 待评审 |
| [`systematic-debugging`](../../../worklog/worklog-2026-07-14-feat-model-generation-workflow-upgrade/systematic-debugging/review.md) | Auriga 插件；内化自 `obra/superpowers` | Claude Code / Codex | 内化；实现与迁移已完成，目标模型受控评测待补；PR #177 |
| `test-designer` | Auriga 插件 | Claude Code / Codex | 待评审 |

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
| `planning-with-files` | `OthmanAdi/planning-with-files` | Claude Code / Codex | 待评审 |
| `playwright-cli` | `microsoft/playwright-cli` | Claude Code / Codex | 待评审 |
| `test-driven-development` | `obra/superpowers` | Claude Code / Codex | 待评审 |
| `verification-before-completion` | `obra/superpowers` | Claude Code / Codex | 待评审 |

### 外部推荐技能

| Asset (资产) | Source (来源) | Runtime (运行时) | Status (状态) |
|---|---|---|---|
| `claude-code-agent` | `Ben2pc/g-claude-code-plugins` | Claude Code / Codex | 待评审 |
| `codex-agent` | `Ben2pc/g-claude-code-plugins` | Claude Code / Codex | 待评审 |
| `deprecation-and-migration` | `addyosmani/agent-skills` | Claude Code / Codex | 待评审 |
| `design-taste-frontend` | `Leonxlnx/taste-skill` | Claude Code / Codex | 待评审 |
| `frontend-design` | `anthropics/skills` | Claude Code / Codex | 待评审 |
| `make-interfaces-feel-better` | `jakubkrehel/make-interfaces-feel-better` | Claude Code / Codex | 待评审 |

### 外部或可选插件

| Asset (资产) | Source (来源) | Runtime (运行时) | Status (状态) |
|---|---|---|---|
| `auriga-notify` | Auriga 插件，可选 | Claude Code | 待评审 |
| `skill-creator` | Anthropic 官方插件市场 | Claude Code | 待评审 |
| `claude-md-management` | Anthropic 官方插件市场 | Claude Code / Codex | 待评审 |
| `playground` | Anthropic 官方插件市场 | Claude Code / Codex | 待评审 |
| `codex` | OpenAI 插件市场 | Claude Code | 待评审 |
| `session-instructions-loader` | Auriga 插件 | Codex | 待评审 |

## 单项记录模板

新增 `reviews/<asset-name>.md`，正文使用以下结构：

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
