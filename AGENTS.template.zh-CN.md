<!-- AURIGA:WORKFLOW:v1 START — 受管区块,由 auriga-cli 维护,请勿手改;升级会整块覆盖。工程专属规则写在下方 END 标记之后。 -->
# auriga 工作流 (v1.17.0)

1. 需求澄清：新需求先用 `spec-design` 澄清。**spec = why + 用户可观察的 what；arch design = 系统结构的 how；plan = 实施步骤**——需求规格不写技术路径；产品功能优先讲清“为什么做”。改动不影响外部行为契约时可以跳过需求规格，但技术方案仍可能需要架构澄清。

2. 方案计划：新功能跨模块、需要重划边界、“怎么做”不显然，或用户要求优化既有架构、澄清领域模型和职责时，先跑 `arch-design`；存在实质性设计决策时先形成便于人工评审的 `arch_design.md`，取得用户确认后再继续。快速流程只跳过实施计划，不跳过这个架构澄清门禁。随后做规模判定——三条谓词（见「快速开发流程」）全部成立时直接进入实现，否则用 `AskUserQuestion` / `request_user_input` 摆全菜单选执行跟踪方式：内置 Plan（中等复杂度）、`planning-with-files`（长程持久跟踪）、`goalify`（自驱 `/goal`）。

3. 分支先行：写码前从 main 建分支，禁止直接提交 main。命名前缀：`feat/`、`fix/`、`docs/`、`refactor/`、`chore/`。所有 git/gh 操作走 `git-workflow`。

4. 尽早提交：首个有意义 commit 后尽早开 Draft PR。

5. bugfix 前先查根因：按 `systematic-debugging`，再决定怎么修。

6. TDD：会改变可观察行为的代码改动遵循 `test-driven-development`；纯文档、纯配置、生成代码或没有有效自动化接缝的改动除外。每个 task 开始前明确可测试的验收标准，写测试前先查 `docs/rules/test/`。

7. 增量实现：非平凡实现（多文件、跨文件重构、跨切面修改或落地已规划任务）调用 `incremental-impl`，先按需求结果、验证边界和合法中间状态拆成完整实施单元，再按依赖增量落地；纯文档、纯配置或单一明确的小修改跳过。

8. 验证后再说完成：任何“已完成、已修复、通过或可评审”的判断，都必须基于最后一次相关修改之后、与该判断匹配的验证结果；证据不足时如实说明缺口。

9. PR 就绪：验证完成、基准分支无误、PR 描述五要素（范围 / 验收 / 决策 / 风险 / TODO，规范见 `git-workflow`）补全后才标 Ready。当前 PR 的设计产物（spec.md、task_plan.md 等）用 `AskUserQuestion` / `request_user_input` 问用户：删除还是归档到 `docs/worklog/worklog-<YYYY-MM-DD>-<分支名>/`。跨多个 PR 的总规范可保留在 `docs/long-running-specs/`，不受 Ready 清理门禁影响；全部子 PR 结束后由人工决定归档。

10. PR 评审：Ready 后正式 review 必须走 `deep-review`（`/review` 为轻量 fallback）。**评审 Agent 报告所有 finding 并附 severity + confidence，不预过滤**——过滤交给人做。

11. 合并后复利：PR 合并后主动询问是否运行 `session-compound` 沉淀本次会话。

## 快速开发流程（bug fix / 小重构 / 小功能）

三条谓词全部成立才触发：(a) 单一模块；(b) 验收标准 ≤5 条；(c) 无跨边界接口改动（公共 API、schema、共享模块）。任一不成立或拿不准，走完整路径。命中时只跳过实施计划，不跳过需求澄清或架构澄清；分支、Draft PR、TDD、验证、review 规则同样不变。新行为与缺陷修复按失败证据 → 最小实现推进；小重构先确认行为保护网，再在持续通过的状态下改结构；最后运行全量回归。

## 文档规范

仓库文档统一放 `docs/` 下，按用途分目录：

| 目录 | 用途 | 生命周期 |
|---|---|---|
| `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/` | 已归档的 spec / planning / 架构产物；一个 PR 一个子目录 | 永久 |
| `docs/rules/` | 编码规范、review checklist、命名约定 | 长期 |
| `docs/rules/review/` | 项目自定义 reviewer；`reviewer-creator` 创建，`deep-review` 自动发现分派 | 长期 |
| `docs/rules/test/` | 项目测试规则；`test-driven-development` 在写测试前读取 | 长期 |
| `docs/rules/spec/` | 项目 spec 规则；`spec-design` 调研阶段必读 | 长期 |
| `docs/rules/arch/` | 项目架构设计规范；`arch-design` 作为设计硬约束 | 长期 |
| `docs/specs/` | `spec-design` / `arch-design` 输出默认归宿，开发期临时工作区。**PR Ready 前必须清空**：晋升到 `docs/architecture/`、归档到 worklog、或删除 | 开发期 |
| `docs/long-running-specs/` | 跨多个 PR 的总规范、共同约束、切片顺序和状态矩阵；当前 PR 的独立验收契约仍放 `docs/specs/` | 跨 PR；全部子 PR 结束后人工归档 |
| `docs/architecture/` | 稳定设计文档 + ADR（`ADR-<序号>-<标题>.md`） | 长期 |
| `docs/` 其他 | 一类文档一个目录，按需新增，不混放 | 因类而异 |

# Harness 原则

- **约束靠机制执行，不靠提示词**：核心规则尽量用 linter / CI / 类型系统 / hook 执行。
- **仓库是唯一信息源**：Agent 无法访问的东西等于不存在；计划、设计决策、技术债务作为版本化产物入库。
- **独立评估**：正式 review 中的测试质量与其他维度由独立 Agent 评估，不让实现 Agent 对自己的工作作最终判断。
- **持续对抗熵增**：技术债务小额持续偿还。
- **组件可拆卸**：每个流程步骤都编码了"模型做不好这件事"的假设，随模型能力提升定期审视，每次只动一个变量。
- **指令文件是目录，不是百科全书**：AGENTS.md 保持精简（~200 行）做入口导航，细则拆到 `docs/`；以 AGENTS.md 为主文件，建 `CLAUDE.md -> AGENTS.md` 兼容软链（`ln -s AGENTS.md CLAUDE.md`）。

# Agent 分发原则

| 场景 | 方案 |
|------|------|
| 单文件修复，方案明确 | 自己做 |
| 并行只读任务（搜索、分析） | 对话内 subagent，无需隔离 |
| 多个 subagent 写代码 | `incremental-impl`——明确文件所有权、工作树隔离和集成顺序 |
| 需要零污染全新视角 / 跨模型盲区覆盖 | 独立 Agent（Reviewer、GPT review Claude 等） |

- **并行写必须隔离**：独立 git worktree，或改动目录完全独立。
- **按档位选模型，不写死型号**：flagship 给架构判断 / 复杂编码；workhorse 给常规机械任务。Effort：写码 / agentic 子任务 `xhigh`，轻度调研 `high`，机械任务 `medium`。
- **派遣必须显式给出验收标准和输出格式**（shape + scope/length），具体格式按任务选。
<!-- AURIGA:WORKFLOW:v1 END -->

<!-- 在下方添加你的工程专属规则。上方受管区块由 auriga-cli 维护,升级时整块替换;此处内容会被保留。 -->
