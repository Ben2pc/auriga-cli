<!-- AURIGA:WORKFLOW:v1 START — 受管区块,由 auriga-cli 维护,请勿手改;升级会整块覆盖。工程专属规则写在下方 END 标记之后。 -->
# auriga 工作流 (v1.13.0)

1. 需求澄清：新需求先用 `spec-design` 澄清。**spec = why + what; plan = how**——requirement 只写"做什么"和验收标准，不写技术路径；产品功能优先讲清"Why"。改动不影响外部行为契约时跳过 spec 直进 plan。

2. 方案计划：先做规模判定——三条谓词（见「快速开发流程」）全部成立走快速流程，否则走完整路径：架构吃重（跨模块、重划边界、"怎么做"不显然）先跑 `arch-design`；再用 `AskUserQuestion` / `request_user_input` 摆全菜单选执行跟踪方式——内置 Plan（中等复杂度）、`planning-with-files`（长程持久跟踪）、`goalify`（自驱 `/goal`）。

3. 分支先行：写码前从 main 建分支，禁止直接提交 main。命名前缀：`feat/`、`fix/`、`docs/`、`refactor/`、`chore/`。所有 git/gh 操作走 `git-workflow`。

4. 尽早提交：首个有意义 commit 后尽早开 Draft PR。

5. bugfix 前先查根因：按 `systematic-debugging`，再决定怎么修。

6. TDD：所有代码改动遵循 `test-driven-development`（唯一例外：纯文档、纯配置）。每个 task 开始前明确可测试的验收标准。写测试前先查 `docs/rules/test/` 相关规则，无则明确记录。需求跨模块且交互非显然、边界场景难自测、或你正想跳过 TDD 时，调用 `test-designer`。

7. 增量实现：非平凡实现（多文件、跨文件重构、落地已规划 task、预计写超 ~100 行）调用 `incremental-impl`——规模判定、切片、派遣由 skill 自身负责；判定 XS 或纯文档/配置时跳过。

8. 验证后再说完成：任何"已完成 / 已修复 / 可评审"判断前，先按 `verification-before-completion` 跑完整验证（自动化测试 + 必要的界面交互检查），不要只靠读实现判断。

9. PR 就绪：验证完成、基准分支无误、PR 描述五要素（范围 / 验收 / 决策 / 风险 / TODO，规范见 `git-workflow`）补全后才标 Ready。当前 PR 的设计产物（spec.md、task_plan.md 等）用 `AskUserQuestion` / `request_user_input` 问用户：删除还是归档到 `docs/worklog/worklog-<YYYY-MM-DD>-<分支名>/`。跨多个 PR 的总规范可保留在 `docs/long-running-specs/`，不受 Ready 清理门禁影响；全部子 PR 结束后由人工决定归档。

10. PR 评审：Ready 后正式 review 必须走 `deep-review`（`/review` 为轻量 fallback）。**评审 Agent 报告所有 finding 并附 severity + confidence，不预过滤**——过滤交给人做。

11. 合并后复利：PR 合并后主动询问是否运行 `session-compound` 沉淀本次会话。

## 快速开发流程（bug fix / 小重构 / 小功能）

三条谓词全部成立才触发：(a) 单一模块；(b) 验收标准 ≤5 条；(c) 无跨边界接口改动（公共 API、schema、共享模块）。任一不成立或拿不准，走完整路径。命中时只跳过 planning——澄清、分支、Draft PR、TDD、验证、review 规则不变，按标准 TDD 循环执行：跑基线 → 红 → 绿 → 全量回归。

## 文档规范

仓库文档统一放 `docs/` 下，按用途分目录：

| 目录 | 用途 | 生命周期 |
|---|---|---|
| `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/` | 已归档的 spec / planning / 架构产物；一个 PR 一个子目录 | 永久 |
| `docs/rules/` | 编码规范、review checklist、命名约定 | 长期 |
| `docs/rules/review/` | 项目自定义 reviewer；`reviewer-creator` 创建，`deep-review` 自动发现分派 | 长期 |
| `docs/rules/test/` | 项目测试规则；`test-designer` 或主 Agent 写测试前必读 | 长期 |
| `docs/rules/spec/` | 项目 spec 规则；`spec-design` 调研阶段必读 | 长期 |
| `docs/rules/arch/` | 项目架构设计规范；`arch-design` 作为设计硬约束 | 长期 |
| `docs/specs/` | `spec-design` / `arch-design` 输出默认归宿，开发期临时工作区。**PR Ready 前必须清空**：晋升到 `docs/architecture/`、归档到 worklog、或删除 | 开发期 |
| `docs/long-running-specs/` | 跨多个 PR 的总规范、共同约束、切片顺序和状态矩阵；当前 PR 的独立验收契约仍放 `docs/specs/` | 跨 PR；全部子 PR 结束后人工归档 |
| `docs/architecture/` | 稳定设计文档 + ADR（`ADR-<序号>-<标题>.md`） | 长期 |
| `docs/` 其他 | 一类文档一个目录，按需新增，不混放 | 因类而异 |

# Harness 原则

- **约束靠机制执行，不靠提示词**：核心规则尽量用 linter / CI / 类型系统 / hook 执行。
- **仓库是唯一信息源**：Agent 无法访问的东西等于不存在；计划、设计决策、技术债务作为版本化产物入库。
- **独立评估**：复杂功能的测试设计和正式 review 由独立 agent 执行，不让 Agent 评估自己的工作。
- **持续对抗熵增**：技术债务小额持续偿还。
- **组件可拆卸**：每个流程步骤都编码了"模型做不好这件事"的假设，随模型能力提升定期审视，每次只动一个变量。
- **指令文件是目录，不是百科全书**：AGENTS.md 保持精简（~200 行）做入口导航，细则拆到 `docs/`；以 AGENTS.md 为主文件，建 `CLAUDE.md -> AGENTS.md` 兼容软链（`ln -s AGENTS.md CLAUDE.md`）。

# Agent 分发原则

| 场景 | 方案 |
|------|------|
| 单文件修复，方案明确 | 自己做 |
| 并行只读任务（搜索、分析） | 对话内 subagent，无需隔离 |
| 多个 subagent 写代码 | `incremental-impl`——门槛达标时返回分片计划 |
| 需要零污染全新视角 / 跨模型盲区覆盖 | 独立 Agent（Reviewer、GPT review Claude 等） |

- **并行写必须隔离**：独立 git worktree，或改动目录完全独立。
- **按档位选模型，不写死型号**：flagship 给架构判断 / 复杂编码；workhorse 给常规机械任务。Effort：写码 / agentic 子任务 `xhigh`，轻度调研 `high`，机械任务 `medium`。
- **派遣必须显式给出验收标准和输出格式**（shape + scope/length），具体格式按任务选。
<!-- AURIGA:WORKFLOW:v1 END -->

<!-- 在下方添加你的工程专属规则。上方受管区块由 auriga-cli 维护,升级时整块替换;此处内容会被保留。 -->
