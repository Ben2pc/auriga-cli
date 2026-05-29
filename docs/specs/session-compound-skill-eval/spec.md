# session-compound 指令遵循 & Skill 执行评估 — Spec

> 给 session-compound 加一个元层：复盘单次会话时，独立评估「AGENTS.md 规则与 skill 是否在该触发时被正确召回」以及「跑过的 skill 是否达到其设计目标」，反哺 skill body 优化。

## Why (为什么做)

session-compound 现在只回答两件事：这次**做了什么**（Narrative）、token / 工具**健康度如何**（Health），再让主 Agent 内联写沉淀候选（Compound）。它不评估**工作流本身有没有被正确执行**——规则有没有在该触发的时刻触发、skill 有没有在该召回的时刻召回、真正跑起来的 skill 有没有兑现它的设计意图。

用户要补这层判断，目的有二：

1. **指令遵循 + 召回效果**——看本次会话里 AGENTS.md 体系和 skill 是否都在正确的时机被使用。这是对工作流契约执行质量的体检。
2. **从设计目标出发评估 skill 执行表现**——用于后续优化 skill body。关键动机是**对抗"一味叠加内容"**：一个 skill 表现差，可能不是缺规则，而是它本来就写得不好；先评估再决定改法，而不是默认往里加东西。

这层判断**必须由独立 subagent 做**：被评估的会话正是主 Agent 自己跑的，让它评自己的指令遵循度与 skill 召回有系统性偏差。这正是 auriga「独立评估」原则的应用，与 `test-designer` / `deep-review` 同源。

## Findings (调研发现)

- `analyzers/claude-code.mjs` 已**精确**提取（非启发式）：逐 turn skill 调用（`Skill` 工具入参，`claude-code.mjs:340-343`）、skill attribution 工作量（`attributionSkill`，`:323-328`）、subagent 派遣（`:345-351`）、逐 turn 工具序列（`:320-322`）、feedback 时刻、PR、工具失败。
- analyzer **目前没有**两样新评估所需的输入：(a) 可用 skill 的目录（名字 + 触发条件），(b) AGENTS.md / CLAUDE.md 工作流规则集。两者都未被解析。
- `~/.claude/skills/skill-cleaner/scripts/skill-cleaner.ts` 提供可复用手法：`walkFiles` + `parseFrontmatter`（`:149-240`）走 skill 根目录、解析 frontmatter 拿 `{name, description}`；以及"存在但零使用"的缺口检测（`scanUsage` + Unused Candidates，`:489-539`、`:913-919`）。
- session-compound 是**单会话精确数据**，不需要 skill-cleaner 的文本启发式（`$name` / `skills/<name>/SKILL.md` 计数）——目录构建那段可借，使用统计那段不用。
- 现有 `SKILL.md` 已有「步骤 4：基于数据预查 ecosystem skill」和「步骤 5d：候选数组（三类 existing-skill / agent-md / skill-gap）」，以及独立 subagent 派遣的现成范式可镜像。
- 两套 analyzer（claude-code.mjs / codex.mjs）输出**对称核心 schema** 是 session-compound 的核心设计值，CLI-specific 字段才分叉。
- 报告模板用 `showIf()` 做"数据缺失优雅隐藏"，新区块需沿用。

## What (做什么)

### 1. analyzer 产出评估 substrate（确定性层）

两套 analyzer 各自新增输出，供下游判断层消费：

- **可用 skill 目录**：本机已安装的全部 skill 的 `{name, description}`（description 即触发条件）。claude 端从 Claude 的 skill 根目录构建，codex 端从 Codex 的 skill 根目录构建。
- **工作流规则集**：从仓库 AGENTS.md / CLAUDE.md 受管工作流区块解析出的规则条目列表。
- **机械可判的合规项**：能由确定性数据直接判定的工作流谓词（例如「编码前是否先建分支」「是否尽早开 Draft PR」「某 skill 本会话是否跑过」），每项给出 pass / fail / not-applicable。

两套 analyzer 的 substrate 核心字段**同形**；某 CLI 拿不到的来源，对应字段为空集合（沿用现有缺失侧空集合约定）。

### 2. 运行时独立 subagent 评估（判断层）

session-compound 执行过程中**派遣一个独立的、零上下文继承的 subagent** 做语义评估：

- **输入**：analyzer 的 substrate + 本会话的逐 turn 摘要 / transcript。
- **召回 & 指令遵循分析**：覆盖**全部已安装 skill** 与全部工作流规则——找出"本该召回某 skill / 本该触发某规则却没有"的缺口，以及被正确遵循的项。
- **逐 skill 执行 eval**：仅覆盖**本会话真正跑过的 skill**（没跑过的无法评执行表现），从每个 skill 的设计目标出发，判断它这次是否兑现、哪里欠佳、问题是否出在 skill body 本身。
- **输出**：结构化 finding，每条带 severity + confidence，**不按重要性预过滤**（与 deep-review 同纪律，过滤交给人）。

### 3. 报告新增「指令遵循 & Skill Eval」区块

报告渲染判断层的 finding：召回缺口、指令遵循情况、逐 skill 执行 eval。评估数据缺失时该区块优雅隐藏，不显示空壳。

### 4. skill-body 优化候选（闭环到落库）

评估产出喂入 Compound 候选流：

- 对**本仓库可编辑的** SKILL.md，产出 skill-body 优化候选（`agent-md` 指向该 SKILL.md，或 `skill-gap`）。
- 对**外部 / cached、不可编辑**的 skill，只在报告里报告其表现，**不产出编辑候选**（改了下次更新即被覆盖）。

## Out of scope (本次不做)

- 跨会话趋势分析（属 `session-report` 插件范围）。
- 自动改写 skill body——本功能只产出候选，落库仍由人审、走既有 Compound 流。
- 为外部 / cached skill 产出编辑候选。
- 为本会话未跑过的 skill 评执行表现（召回分析仍覆盖它们，但执行 eval 不评）。
- 重做现有 Narrative / Health / Compound 三 tab 的既有内容。

## Open questions (悬而未决)

1. substrate 喂给 subagent 的具体形态（analyzer digest vs 直接传 transcript 文件路径让 subagent 自取片段）——归属 **impl**，理由：属于派遣实现细节，不影响外部契约（subagent 拿到足够上下文产出 finding 即可）。
2. 判断层是单个 subagent 还是小型 panel（召回 / 指令遵循 / 逐 skill eval 分派）——归属 **impl**，理由：取决于实测单 subagent 在"全部已安装 skill"规模下的产出质量，先做单 subagent，质量不足再拆。
3. analyzer 构建"全部已安装 skill 目录"时需要一个 skill 根目录 override 入口以便单测对 fixture 根断言（类比 skill-cleaner 的 `--root`）——归属 **impl**，理由：纯测试可达性设计决策。
4. 新区块放在现有哪个 tab（并入 Health、或新开一个 tab）——归属 **impl**，理由：纯渲染布局选择，不改数据契约。

## References (参考资料)

无外链。代码来源已在 Findings 内逐条锚定（`skill-cleaner.ts`、`analyzers/claude-code.mjs`、`SKILL.md`、`template.html`）。
