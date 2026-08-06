<!-- AURIGA:WORKFLOW:v1 START — 受管区块,由 auriga-cli 维护,请勿手改;升级会整块覆盖。工程专属规则写在下方 END 标记之后。 -->
# auriga 工作流 (v1.21.0)

1. 需求澄清：新增或改变外部可见行为时，先用 `spec-design` 基于实际代码与产品事实判断价值并对齐目标。**spec = why + 用户可观察的 what；arch design = 系统结构的 how；plan = 实施步骤**。外部行为不变时可以跳过需求规格，但仍可能需要架构澄清。

2. 架构与计划：技术方案不显然、需要重划边界、优化架构或澄清领域模型时使用 `arch-design`；实质性设计必须在实现前取得用户确认。需要计划时，在进入实现前让用户从内置 Plan 与 `planning-with-files` 中二选一；`goalify` 是可与任一计划载体组合的自主执行模式，只在用户明确选择时启用。

3. Git 生命周期：写码前从仓库约定的基准分支建立任务分支，禁止直接提交基准分支。命名前缀：`feat/`、`fix/`、`docs/`、`refactor/`、`chore/`。所有 git/gh 操作走 `git-workflow`，首个有意义提交后尽早创建 Draft PR。

4. 测试与缺陷：新增行为、缺陷修复和重构都按 `test-driven-development` 建立有意义的失败证据或行为保护网；其中缺陷在进入修复实现前，先用 `systematic-debugging` 建立证据并确认根因。

5. 增量实现：非平凡实现使用 `incremental-impl` 先拆成完整、可验证、可集成的实施单元，再按依赖增量落地。

6. 验证后再说完成：任何“已完成、已修复、通过或可评审”的判断，都必须基于最后一次相关修改之后、与该判断匹配的验证结果；证据不足时如实说明缺口。

7. PR 就绪：按 `git-workflow` 完成验证和拉取请求整理后才标 Ready。当前 PR 的设计产物（spec.md、task_plan.md 等）用 `AskUserQuestion` / `request_user_input` 问用户：删除还是归档到 `docs/worklog/worklog-<YYYY-MM-DD>-<分支名>/`。跨多个 PR 的总规范可保留在 `docs/long-running-specs/`，不受 Ready 清理门禁影响；全部子 PR 结束后由人工决定归档。

8. PR 评审：Ready 后，没有持续集成评审（CI Review）的项目必须在本地运行 `deep-review`；已有持续集成评审时，由用户决定是否还需要本地评审。具体路由、输出和重跑授权由该技能负责。

## 快速开发流程（缺陷修复 / 小重构 / 小功能）

当任务只有一个单一明确结果、没有未决的产品或架构决定、不需要跨会话跟踪，也不需要拆成多个完整实施单元时，可以跳过计划载体选择并直接进入实现。否则在实现前选择内置 Plan 或 `planning-with-files`。快速流程不跳过适用的需求澄清、架构确认、测试、验证和评审。

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

## 运行框架原则

- **约束靠机制执行，不靠提示词**：核心规则尽量用 linter / CI / 类型系统 / hook 执行。
- **仓库保存长期事实**：需要跨会话使用的当前事实、计划和设计决定必须存在于 Agent 可访问的版本化资产中。
- **持续对抗熵增**：处理评审发现时，在不扩大当前改动范围的前提下，持续偿还确定、低风险的小额技术债务。
- **上下文分层，按需加载**：规则写在它实际约束的作用域里，根 `AGENTS.md` 只放全局规则和索引。子包或有独立工具链、独立约定的目录维护自己的 `AGENTS.md`，并配 `CLAUDE.md -> AGENTS.md` 兼容软链。运行时对子作用域指令的自动加载范围并不一致，所以下沉的内容必须同时由上层 `AGENTS.md` 单行索引指向，不能假设它一定会被自动读取。分层判据见 `documentation-management`。

## Agent 分发原则

- 简单明确的任务由当前 Agent 完成；相互独立的只读工作优先使用运行时内置子代理。
- 多个写入者由 `incremental-impl` 明确文件所有权、依赖、集成顺序和隔离方式；并行写使用独立工作树或完全不重叠的目录。
- 只有用户明确要求独立进程，或任务确实需要跨模型、零污染的新视角时，才使用外部 Agent。
- 派遣时明确结果目标、范围、验证方式和输出要求；模型与推理强度按任务风险选择，并在运行时支持时覆盖。

<!-- AURIGA:WORKFLOW:v1 END sha256=2b4c66cd40f16bac -->

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
- `ui/` 是独立工具链的 Web UI 子项目，规则见 `ui/AGENTS.md`；改动该目录前先读它。

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

各目录的用途和生命周期见上方受管区块的「文档规范」表，这里不重复。本仓库额外使用 `docs/runbooks/` 存放操作手册。

## 编辑指引

- 优先使用仓库里已有的模式和辅助函数，不要轻易新增抽象。
- 除非明确只限于某一语言，否则模板源编辑要同时保持两种语言一致。
- 不要把 plugin payload 加进 `CONTENT_FILES`；plugin 的 freshness 属于 plugin marketplace 的职责。
- 不要把 auriga 自己负责的 workflow skills 再加回 `skills-lock.json` 或 `.agents/skills/`；它们通过 `auriga-workflow` plugin 发布。
- 编辑 plugin 或 skill 资产时，要同时考虑 Claude Code 和 Codex 的可移植性。可移植性检查清单见 `docs/rules/agent-portability.md`。
- 只在注释能够解释不明显的约束或历史背景时，才写简短注释。

## 沟通

默认用中文和用户沟通。日常更新保持简洁；但当工作涉及不熟悉的领域、测试策略、发布行为或跨模块契约时，要把取舍讲清楚。
