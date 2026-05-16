# AGENTS.md 主文件与中文默认安装 — Spec (AGENTS.md 主文件与中文默认安装 — 规范)

> 让 auriga-cli 以后按社区通用约定安装 `AGENTS.md` 主文件,并把默认工作流语言改为中文,同时安全迁移已有 `CLAUDE.md` 主文件形态。

## Why (为什么做)

社区对 Agent 项目指令的默认入口正在向 `AGENTS.md` 收敛。auriga-cli 现在仍把 `CLAUDE.md` 当作实体主文件,再创建 `AGENTS.md -> CLAUDE.md` 软链。这个方向对 Claude Code 友好,但会让 Codex 原生项目、只认识 `AGENTS.md` 的工具,以及后续文档规范都带着历史包袱。

用户也明确希望默认安装改为中文版本。当前安装路径虽然支持 `--lang zh-CN`,但无参数默认仍是英文;推荐预设、交互菜单、网页安装和文档也都把英文写成默认。这对中文团队来说会让每次安装都需要额外选择或后续替换。

本 spec 的目标是移动外部可见契约:以后新装和升级都应以 `AGENTS.md` 为可编辑主文件,`CLAUDE.md` 只是兼容 Claude Code 的软链;没有显式指定语言时,安装中文工作流。英文仍保留为显式可选项。

## Findings (调研发现)

- 根目录当前形态是 `AGENTS.md -> CLAUDE.md` 软链,`CLAUDE.md` 与 `CLAUDE.zh-CN.md` 是两个实体模板文件。
- `src/workflow.ts` 当前安装行为是读取语言模板,写入目标目录的 `CLAUDE.md` 实体文件,再创建 `AGENTS.md -> CLAUDE.md` 软链。
- `src/workflow.ts` 已有五类受管块迁移行为:新装、标记格式升级、旧格式迁移、foreign 首装、标记损坏重装;并已有 backup-once 规则,避免覆盖首个 `.bak`。
- `src/workflow-markers.ts` 的受管块标记语义目前写死为面向 `CLAUDE.md` 的说明,但结构令牌是 `AURIGA:WORKFLOW:v1 START/END`,本身不依赖文件名。
- `src/utils.ts` 的 `LANGUAGES` 当前把 `en` 映射到 `CLAUDE.md`,把 `zh-CN` 映射到 `CLAUDE.zh-CN.md`;`fetchContentRoot()` 只拉取 `CLAUDE.md` 等内容文件,非默认语言由安装时按需拉取。
- 非交互 `install workflow` 在 `src/workflow.ts` 中把缺省语言落到 `en`;`install --preset` 在 `src/cli.ts` 中把缺省语言落到 `en`;交互菜单的推荐预设也显式传 `lang: "en"`。
- Web UI 默认语言存在多处:服务端 apply handler 默认 `en`,工作流语言控件默认 `en`,推荐预设语言控件默认 `en`,相关测试也把 `en` 作为契约。
- `src/state.ts` 当前项目范围只扫描 `<project>/CLAUDE.md`,并把 foreign `CLAUDE.md` 报成 `workflow-foreign-claudemd`;测试覆盖了标记格式 `CLAUDE.md` 的已安装识别。
- `README.md`、`README.zh-CN.md`、`src/help.ts`、`src/guide.ts` 和多个测试描述仍把工作流安装表述为 `CLAUDE.md + AGENTS.md` 且默认语言为 `en`。
- 全仓库当前契约描述分布较散: `.claude/CLAUDE.md` 开发指南、`docs/rules/agent-portability.md`、deep-review 的 `skill-plugin-quality` 审查者、`src/*` 注释、`ui/src/pages/Dashboard.tsx` 文案、`tests/*` 场景名和 helper 都含有 `CLAUDE.md` 主体或 `lang en` 的当前约定。
- `docs/worklog/` 下也有大量历史条目记录当时的 `CLAUDE.md` 主体和英文默认值,但这些是历史证据,不应为了当前契约而机械改写。
- `tests/e2e-install.test.ts` 的 tarball 安装 smoke 当前断言 `install workflow` 产生 `CLAUDE.md` 实体和 `AGENTS.md -> CLAUDE.md` 软链。
- 记忆中已有约束:根 `CLAUDE.md` 是安装到用户项目的产品模板,`.claude/CLAUDE.md` 才是本仓库开发指南;运行时读取必须以发布包和远程内容拉取形态为准,不能只在源码树里成立。
- 用户已确认旧形态迁移采用“自动安全翻转”:把旧 `CLAUDE.md` 主文件内容迁到 `AGENTS.md` 实体文件,再把 `CLAUDE.md` 改成指向 `AGENTS.md` 的软链;遇到内容或软链冲突时先备份。

## What (做什么)

### 1. 新的工作流文件形态

工作流安装后的项目根目录以 `AGENTS.md` 为实体主文件。auriga 工作流受管块和项目自定义用户区都位于 `AGENTS.md` 中。`CLAUDE.md` 是指向 `AGENTS.md` 的相对软链,只作为 Claude Code 兼容入口。

新装项目不应生成可编辑的实体 `CLAUDE.md`。用户后续应该在 `AGENTS.md` 的用户区添加项目专属规则。

### 2. 旧形态自动安全迁移

已经按旧版安装过的项目,即存在实体 `CLAUDE.md` 且 `AGENTS.md -> CLAUDE.md` 的项目,再次安装或升级后应自动翻转成新形态。旧 `CLAUDE.md` 中可保留的用户区必须继续保留在新的 `AGENTS.md` 中。

如果已有 `AGENTS.md` 不是旧安装软链,它代表用户或其他工具的独立意图,不得静默覆盖。安装必须先保留该内容或备份该路径,再完成新形态安装。

如果已有 `CLAUDE.md` 不是指向 `AGENTS.md` 的兼容软链,且安装需要替换它,也必须遵守 backup-once 规则,首个 `.bak` 不被覆盖。

### 3. 受管块升级语义保持

受管块仍由 auriga-cli 维护,升级时只替换受管区,保留用户区。手改受管区、旧格式、foreign 内容、标记损坏等情况仍要有明确且不丢内容的处理方式。

文件名翻转不应降低现有安全性:能识别的旧用户内容要迁入新主文件,不能识别或无法安全合并的内容要备份并提示。

### 4. 默认语言改为中文

没有显式指定语言时,工作流安装默认使用中文模板。这个默认适用于非交互 `install workflow`、非交互 `install --preset`、交互菜单的推荐预设、Web UI 的工作流安装和 Web UI 的推荐预设。

英文模板继续保留。用户显式传 `--lang en` 或在 Web UI / 交互入口选择英文时,安装英文工作流。

### 5. 状态扫描与全工程描述同步

状态扫描应以新主文件形态识别已安装工作流。新形态项目不应因为 `CLAUDE.md` 是软链而误报未安装,也不应把旧形态项目误报为全新安装。

命令行帮助、安装指南、README、网页文案、错误码说明和测试名称应同步表达新契约:`AGENTS.md` 是主文件,`CLAUDE.md` 是兼容软链;默认语言是中文。

本仓库的持久工程说明也要同步分层处理:描述当前代码结构、当前审查规则、当前安装契约的文件必须改成 `AGENTS.md` 主体;历史归档 worklog 只在被引用为当前依据时才更新或补说明,不要批量重写历史。

### 6. 发布包与远程内容形态同步

tarball 安装、从 GitHub tag 拉取内容、开发模式本地读取三种路径都必须能拿到新默认语言模板和英文可选模板。默认中文不能只在源码树里成立。

## Out of scope (本次不做)

- 不改变 skills、recommended skills、plugins 的安装路径和默认选择。
- 不改变 `--lang en|zh-CN` 的取值集合,也不新增第三种语言。
- 不把 `AGENTS.md` 和 `CLAUDE.md` 都做成独立可编辑文件;本次仍要求单一主文件加一个兼容软链。
- 不改变受管块 schema 版本,除非 plan 阶段证明文件名翻转必须引入新的 schema。
- 不迁移 `.claude/skills`、`.agents/skills` 或插件缓存目录。
- 不要求安装命令自动提交或修改 Git 状态。
- 不批量改写 `docs/worklog/` 历史归档中的旧事实;那些文件记录的是当时已经发生的实现和决策。

## Open questions (悬而未决)

1. 内部模块与类型命名是否从 `workflow/claude` 迁到更中性的命名,归 plan 阶段决定。原因是外部契约只要求文件形态和行为变化,内部命名可以按影响半径选择逐步迁移或暂时保留。
2. 用户范围扫描路径是否保留历史 `~/.claude/CLAUDE.md` 兼容识别,归 plan 阶段决定。原因是当前工作流安装没有用户范围安装入口,项目范围的新契约已明确,历史扫描兼容可以在架构设计里权衡。

## References (参考资料 — 可选；澄清期间用户给过任何外链时必填)

- 当前用户请求: “后续以AGENTS.md为主文件，CLAUDE.md为软连接，因为社区规范就是AGENTS.md；默认安装改成中文版本。”
- 当前用户确认: 旧形态迁移采用“自动安全翻转”。
