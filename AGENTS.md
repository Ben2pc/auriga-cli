<!-- AURIGA:WORKFLOW:v1 START — 受管区块,由 auriga-cli 维护,请勿手改;升级会整块覆盖。工程专属规则写在下方 END 标记之后。 -->
# auriga 工作流 (v1.19.0)

1. 需求澄清：新需求先用 `spec-design` 基于实际代码与产品事实判断价值并对齐目标。价值门禁最多两轮，每问给出建议与低成本替代方案，明确进入值得做、先验证、暂缓或不做；确认值得做后，再沿真实决策分支澄清用户可观察行为。**spec = why + 用户可观察的 what；arch design = 系统结构的 how；plan = 实施步骤**——需求规格不写技术路径。改动不影响外部行为契约时可以跳过需求规格，但技术方案仍可能需要架构澄清。

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
<!-- AURIGA:WORKFLOW:v1 END sha256=aabb9f841dd21708 -->

<!-- 在下方添加你的工程专属规则。上方受管区块由 auriga-cli 维护,升级时整块替换;此处内容会被保留。 -->

# auriga-cli 工程专属规则

这个仓库是一个带有 auriga Workflow 的示例项目：受管工作流区块放在最前面，仓库专属规则写在 END 标记下面。根目录的 `CLAUDE.md` 指向这个文件。

`auriga-cli` 是一个用于安装 workflow docs、skills、recommended skills 和 plugins 的 Interactive CLI。产品工作流模板位于根目录，文件名是 `AGENTS.template.zh-CN.md` 和 `AGENTS.template.en.md`；它们会安装到用户项目中，生成 `AGENTS.md` 以及 `CLAUDE.md -> AGENTS.md`。

完整的开发者指南位于 `docs/architecture/auriga-cli-dev-guide.md`。这个根文件应尽量只保留可执行的仓库指令和示例安装形态。

## 仓库结构

重要的运行时文件：

- `src/utils.ts` 负责 `DEFAULT_WORKFLOW_TEMPLATE_FILE`、`LANGUAGES` 和 `CONTENT_FILES`。
- `src/workflow.ts` 读取模板源文件，并写入用户项目的 `AGENTS.md`。
- `src/workflow-docs.ts` 负责用户项目的指令文件名。
- `src/workflow-markers.ts` 负责受管区块 marker 协议。
- `plugins/auriga-workflow/` 负责 workflow skills 和 git 生命周期钩子。
- `plugins/session-instructions-loader/` 负责 Codex SessionStart 的祖先指令注入。
- `.codex/session-instructions-loader.json` 在这个仓库里有意设置为 `{ "ancestorLevel": 1 }`；不要重新加回 `.claude/CLAUDE.md` 的额外注入。
- `.claude/` 只保留本地设置和外部 skill 的符号链接。不要重新引入 `.claude/AGENTS.md` 或 `.claude/CLAUDE.md` 兼容项。

这个区域的关键测试：

- `tests/content-fetch.test.ts` 检查 runtime content fetch 的输入和旧版模板回退。
- `tests/workflow-install.test.ts` 检查模板源文件是否仍然会安装为用户项目的 `AGENTS.md`。
- `tests/spec-design.test.ts` 包含对 workflow 模板和指令入口契约的仓库级检查。
- `tests/session-instructions-loader.test.mjs` 检查 SessionStart 行为。
- `tests/tarball-shape.test.ts` 检查运行时读取不会依赖未随包发布的 tarball 路径。

## 版本管理

`package.json` 是 CLI 版本号。只要要发布用户可见的交付内容，就必须先提升版本，通常和下面这些变更放在同一个 PR 里：

- `src/`
- `.claude-plugin/marketplace.json`
- `.agents/plugins/marketplace.json`
- `extra_plugin_configs.json`
- `skills-lock.json` 的结构性变化
- `.agents/skills/<name>/SKILL.md` frontmatter 的 `description:`
- `AGENTS.template.zh-CN.md` / `AGENTS.template.en.md`
- `README.md` / `README.zh-CN.md` 中改变 CLI 安装、发布、运行时行为或用户可见 package 说明的内容

以下情况不需要提升版本：

- 根目录 `AGENTS.md` / `CLAUDE.md` 开发指令
- `.claude/skills/<name>` 软链
- `tests/`, `docs/`, `tsconfig*.json`, `.github/`
- `README.md` / `README.zh-CN.md` 的纯仓库文档同步，例如 plugin payload 说明、开发协作说明、表述澄清；若只同步 plugin payload 内容，按插件自己的 manifest version 判断
- `plugins/<name>/*` 下仅变更 plugin payload 的内容，且 freshness 由插件自己的 marketplace/version 路径负责时
- 仅刷新外部 skill 的正文或 hash，且没有结构性锁文件字段变化或 frontmatter `description:` 变化时

发布流程：合并版本提升 PR，打上 `v<package.version>` 标签，推送该标签，然后让 release CI 完成发布。`fetchContentRoot()` 会把 runtime content 固定到 `v<package.version>`，除非被 `AURIGA_CONTENT_REF` 覆盖。

如果用户明确把版本提升拆到后续的 pre-release PR 里，要在 PR 的风险部分写明，并保留 runtime 兼容性。这个 PR 里有意包含了针对旧标签的临时旧内容回退：如果新的模板源路径返回 404，`fetchContentRoot()` 可能会抓取重命名之前的 `AGENTS.md` / `AGENTS.en.md`，并把它写到临时 content root 里的新模板文件名下。这个回退要保留到下一个包含 `AGENTS.template.*` 的 release tag 已经发布之后。

## 验证命令

先运行最窄、但仍然有意义的一组命令，然后在 PR Ready 之前再扩大范围：

```bash
npm test
npm run test:session-instructions-loader
npm run test:git-guards
```

`npm run test:e2e` 很慢，而且依赖网络。普通的文档、测试、注释，或者只改仓库指令时，不要默认运行它。只有当变更会影响 tarball/package 形态、`package.json` 版本或 bin 元数据、`fetchContentRoot()` / runtime content fetch、workflow/skill/plugin 的安装行为、marketplace 安装路径，或者在准备发布前，才运行它。它要求当前 HEAD 已经推送，因为它会安装 tarball，并抓取固定到分支 HEAD 的 GitHub 内容。

在把 PR 标记为 Ready 之前，任何会影响 Web UI state/catalog inputs 的变更，都还要按 `docs/architecture/auriga-cli-dev-guide.md` 里的说明做一次手工 Web UI 检查。

## 文档规则

- 当前 PR 独有的活动规划 / 设计产物只在开发期间放在 `docs/specs/`。
- PR Ready 时要求 `docs/specs/` 为空：要么晋升到 `docs/architecture/`，要么归档到 `docs/worklog/worklog-<YYYY-MM-DD>-<branch-name>/`，要么删除。
- 跨多个 PR 的总规范放在 `docs/long-running-specs/`；它不受单个 PR 的 Ready 清理门禁影响，全部子 PR 结束后由人工归档。
- 稳定的模块和流程文档放在 `docs/architecture/`、`docs/rules/`、`docs/runbooks/`，或者其他按用途划分的目录下。
- `docs/rules/review/` 放的是给 `deep-review` 使用的项目自定义 reviewer。
- `docs/rules/test/` 放的是项目测试规则；`test-driven-development` 在写测试前必须先检查相关文件。

## 编辑指引

- 优先使用仓库里已有的模式和辅助函数，不要轻易新增抽象。
- 除非明确只限于某一语言，否则模板源编辑要同时保持两种语言一致。
- 不要把 plugin payload 加进 `CONTENT_FILES`；plugin 的 freshness 属于 plugin marketplace 的职责。
- 不要把 auriga 自己负责的 workflow skills 再加回 `skills-lock.json` 或 `.agents/skills/`；它们通过 `auriga-workflow` plugin 发布。
- 编辑 plugin 或 skill 资产时，要同时考虑 Claude Code 和 Codex 的可移植性。可移植性检查清单见 `docs/rules/agent-portability.md`。
- 只在注释能够解释不明显的约束或历史背景时，才写简短注释。

## 沟通

默认用中文和用户沟通。日常更新保持简洁；但当工作涉及不熟悉的领域、测试策略、发布行为或跨模块契约时，要把取舍讲清楚。
