# auriga 工作流 (v1.9.1)

1. 需求澄清：新需求先用 `spec-design` 澄清 requirement。**requirement聚焦"做什么"和验收标准，不写具体技术路径**，如果是产品功能优先关注"Why"，让实现阶段的 Agent 自行决定怎么做。**spec = why + what; plan = how。** 如果改动不影响外部行为契约（重构、换算法、换库但可观察行为不变），跳过 spec 直接进 plan。

2. 方案计划：完成需求澄清后，先做一次**规模判定**再决定 plan 方式。**满足以下三条全部成立**才走快速开发流程（详见下文「快速开发流程」段；跳过 planning，直接进入 pre-coding / 建分支阶段）：(a) 工作落在单一模块或单一概念内；(b) 验收标准 ≤5 条 bullet；(c) 不涉及跨边界接口改动（公共 API、schema、共享模块）。把判定结果记进任务追踪器（例：「规模判定 → QDF：单模块，3 条验收，无接口改动」）。任一不成立或拿不准，就走完整路径。先显式判断并表态：工作是否架构吃重（跨多个模块、重划模块边界、或"怎么做"并不显然）；若是，先跑 `arch-design`——它是执行跟踪方式的前置步骤而非替代，也是"跳过 spec 的架构级重构"入口。然后用 `AskUserQuestion` 选如何往下推进，要摆出完整菜单、不要默认只给两项：内置 Plan（中等复杂度）、`planning-with-files`（长程、持久跟踪），或用 `goalify` 把工作交给自驱的 `/goal` 运行。选 `goalify` 不等于跳过 plan——被分发的 agent 仍要自行选定上述一种方式，再自主把工作往下推进。计划、设计决策、技术债务应作为仓库内的版本化产物，方便后续 Agent 推理上下文。

3. 编码前准备1：**开始写代码前，先从 main 创建开发分支**，所有 commit 在分支上完成，禁止直接提交到 main。分支命名规范：`feat/`（新功能）、`fix/`（修复）、`docs/`（文档）、`refactor/`（重构）、`chore/`（杂项）。所有 git/gh 操作（建分支、commit、PR create/ready、review 后处理）都使用 `git-workflow` skill（随 `auriga-workflow` 插件分发）。

4. 编码前准备2：创建开发分支并完成第一个有意义的 commit 后，尽早创建 Draft Pull Request，让 CI、范围对齐和增量反馈在实现完成前就可以开始。

5. 编码前准备3：遇到 bug、测试失败或异常行为时，先按 `systematic-debugging` 找根因，再决定修复。

6. TDD：所有代码改动都遵循 `test-driven-development`（唯一例外见「快速开发流程」段：纯文档、纯配置）：先写失败测试，再写最小实现，再回归验证。**每个 task 开始前明确可测试的验收标准**（具体功能点 + 验收条件 + 边界场景），不是最后才检查。满足以下**任一**条件时调用 `test-designer` skill：(a) 需求跨 ≥2 个模块且交互非显然；(b) 边界场景难以让实现 Agent 公平自测；(c) 你正想跳过 TDD，因为"实现看起来比测试更显然"。skill 内置 **Independent Evaluation**，派遣零上下文的 agent，仅接收需求描述和代码路径（不包含实现方案），以最高推理力度返回可执行的失败测试。

7. 增量实现：绿灯阶段对任何非平凡的实现工作调用 `incremental-impl`——多文件改动、跨文件重构、落地一个已规划的 task（来源不限：内置 Plan、`planning-with-files`、`spec-design` spec、`arch-design` 的 arch_design.md、或用户直接给的任务）、跨切面修改、或预计要写超过 ~100 行。规模判定（XS–XL）、切片策略、按需并行派遣、片间执行纪律都由 skill 自身负责——具体规则看 skill 本身。仅当 skill 的规模判定为 XS、或改动是纯文档 / 纯配置时跳过。

8. 完成编码后：任何"已完成 / 已修复 / 可以提交 / 可以进入评审"的判断前，都先按 `verification-before-completion` 运行并检查完整验证。运行受影响的自动化测试，以及必要的浏览器、界面或移动端交互检查；不要只靠阅读实现来判断完成。

9. PR就绪：在验证完成、基准分支确认无误，并且 PR 描述已补全五要素——变更范围、验收标准、设计决策、风险、剩余 TODO 之前，保持 PR 为 Draft。完成这些条件后，将 PR 标记为 Ready for Review。如果 `spec-design`、`arch-design` 或 `planning-with-files` 产生了设计文档（`spec.md`、`arch_design.md`）、findings.md、progress.md、task_plan.md 等产物，用 `AskUserQuestion` 询问用户：删除还是存档到 `docs/worklog/worklog-<YYYY-MM-DD>-<分支名>/` 目录下便于回溯。

10. PR评审：Draft PR 阶段可以先获取早期反馈。PR 标记为 Ready for Review 后，正式 review 必须通过 `deep-review` skill（打包在 `auriga-workflow` 插件中）发起。`/review` 保留作为轻量 fallback。**评审 Agent 必须报告所有 finding 并附 severity + confidence，不要按重要性预过滤**——强推理模型会字面执行 "only report high-severity" 类指令，导致真实 bug 召回下降；过滤交给人来做。

11. 合并后复利：PR 合并完成的那一刻，用 `AskUserQuestion` 主动询问用户是否运行 `session-compound` skill。该 skill 把本次会话沉淀为自包含的交互式 HTML 报告（叙事时间线 + token / cache / 工具健康度 + playground 面板，列出生态 skill 安装、AGENTS.md 修改、缺失 skill 等可勾选候选项），让本次会话的洞察落到对的位置，而不是合并完就蒸发。每次合并询问一次；不要静默执行，用户拒绝后也不要反复追问。

## 快速开发流程（bug fix / 小重构 / 小功能）

由 planning 阶段入口的规模判定三条谓词全部命中时触发。只跳过 planning——需求澄清、分支、Draft PR、TDD、验证和 review 规则仍然适用。步骤：

1. **跑基线**：先跑受影响模块的现有测试，确认当前状态（全绿 or 已有失败）
2. **写/更新测试**（红灯）：用 `test-driven-development` 描述期望行为。改动涉及公共模块时，确认所有消费方的测试都在基线内
3. **实现**（绿灯）：写最小代码让测试通过
4. **回归验证**：跑全量受影响测试，不只是新写的

跳过 TDD 的唯一例外：纯文档、纯配置 改动（无代码逻辑变更）。

## 文档规范

仓库文档统一放 `docs/` 下，按用途分目录，让 Agent、`pr-ready-guard` hook、人工 reviewer 对"文档该放哪、从哪找"有一致认知。

| 目录 | 用途 | 生命周期 |
|---|---|---|
| `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/` | 已归档的 session-ephemeral planning 产物（`findings.md`、`progress.md`、`task_plan.md`、设计 spec）。在 PR-readiness 阶段归档。一个 PR 一个子目录，`docs/worklog/` 作为统一父目录，方便集中查阅 | PR merge 后永久保留 |
| `docs/rules/` | 编码规范、review checklist、命名 / 风格约定 | 长期维护 |
| `docs/specs/` | **`spec-design` 和 `arch-design` 输出的默认归宿。** 开发期间存放活跃 spec / 架构设计 / 需求澄清的临时工作区。**PR Ready 前必须清空**——每个 spec 晋升到 `docs/architecture/`（长期参考）、归档到 `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/`（历史轨迹），或删除。由 `pr-ready-guard` 强制（同时覆盖 `gh pr ready` 和不带 `--draft` 的 `gh pr create`） | 开发期临时 |
| `docs/architecture/` | 稳定、长期的设计文档（模块布局、数据流、组件职责）。新条目通常由 `docs/specs/` 晋升而来 | 长期 |
| `docs/` 其他 | 按需新增：`runbooks/`（运维流程）、`adr/`（架构决策记录）、`onboarding/` 等。一类文档一个目录，不混放 | 因类而异 |

# Harness 原则

- **约束靠机制执行，不靠提示词**：核心架构规则尽量用 linter / CI / 类型系统执行，不依赖 Agent 自觉遵守。
- **仓库是唯一信息源**：Agent 无法访问的东西等于不存在。外部文档需要搬入仓库才算数。
- **Independent Evaluation（独立评估）**：复杂功能的测试设计和正式 review 必须由独立 agent 执行，不要让 Agent 评估自己的工作。
- **浏览器工作流不只属于编码后验证**：当任务需要打开或浏览页面、检查本地网页界面、复现浏览器问题、检查交互、截图，或设计和运行浏览器端到端场景时，优先使用 `Browser Use`。需要可重复、脚本化、适合持续集成的浏览器回归检查时，使用 `playwright-cli`。移动端模拟器或原生应用界面自动化使用 `Computer Use`。
- **持续对抗熵增**：技术债务小额持续偿还，不等积累后痛苦处理。
- **组件可拆卸**：流程中的每个步骤都编码了"模型做不好这件事"的假设，随模型能力提升定期审视，每次只动一个变量。
- **指令文件是目录，不是百科全书**：什么都重要等于什么都不重要。CLAUDE.md / AGENTS.md 保持精简（~100 行），作为入口和导航，详细规范拆分到 `docs/` 下的专题文件中。子系统可以有自己的局部指令文件。永远为 CLAUDE.md 创建一个 AGENTS.md 的软链接（`ln -s CLAUDE.md AGENTS.md`），确保不同 Agent 框架读取同一份指令。

# Agent 分发原则

根据任务性质选择合适的委派层级：

| 场景 | 方案 |
|------|------|
| 单文件修复，方案明确 | 自己做——不需要 subagent 开销 |
| 并行只读任务（review、搜索、分析） | 对话内 subagent，无需隔离 |
| 单个 subagent 写代码 | 对话内 subagent，无需隔离 |
| 多个 subagent 写代码 | 调用 `incremental-impl`——派遣门槛达标时返回分片计划，按计划用 `isolation: "worktree"` 派遣 |
| 需要零上下文污染的全新视角 | 独立 Agent（如 TDD 红灯阶段的测试设计） |
| 跨模型盲区覆盖 | 独立 Agent（如 GPT review Claude 的代码） |
| 不确定该用哪种方案 | 用 `AskUserQuestion` 询问，列出选项并给出建议 |

对话内 subagent 共享主 Agent 的工作目录。核心规则：

- **并行写必须隔离**：并行写代码**必须**使用 `isolation: "worktree"`；单个写者无需隔离。切片决策（轴向选择、粒度、并行与否、碰撞合并、大小过滤）由 `incremental-impl` skill 负责。派遣门槛未达标时 skill 终止并行路径，主 Agent 顺序写。
- **按任务选模型和 effort**：模型（Claude sonnet / opus，或 Codex 旗舰 / mini）与 effort 按任务选。**Effort 默认值：写代码 / agentic 子任务用 `xhigh`；设计与正式评审用 `high`；只有短小、范围明确的查询才用 `medium`；只有当 `xhigh` 仍欠思考时才升 `max`。** 强推理模型严格遵守 `low` / `medium` 力度，复杂任务用低力度有欠思考风险。
  - ✅ "给 cli.ts 的 `parseArgs()` 加输入校验" → sonnet @ xhigh
  - ✅ "设计插件依赖解析策略" → opus @ xhigh
  - ✅ 涉及大量架构权衡的复杂 review → Codex 旗舰 @ high，跨模型盲区覆盖
- **始终显式指定输出格式**（shape + scope/length）：规则本身只约束"必须显式"——具体格式按任务选，例如 "summary ≤300 字"、"punch list，每项一行"、"diff + 每处一行理由"、"结构化 JSON `{...}`"、"一段话判断 + 一行依据"。不穷举格式清单，按任务选合适的。
