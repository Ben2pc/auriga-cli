# Validation Contract — spec-design skill

> 与 `spec.md` 配套。spec.md 描述"做什么 / 为什么"，本文件描述"什么算做完了"。
> 每条 VAL 只说 Behavior + Tool + Evidence，不指定具体测试组织方式 (那是 test-designer 的活)。

## Coverage map

| 范围 | VAL 区间 |
|---|---|
| Skill 内部 4 阶段行为 (Discover / Decide & Design / Write / Gate & Handoff) | VAL-WORK-001 ~ VAL-WORK-015 |
| 下游集成 (workflow 文档、上游 brainstorming 退役、plugin manifest、test-designer 契约、goalify 标注、release notes) | VAL-DEP-001 ~ VAL-DEP-008 |

## Assertions

### Skill 行为 (VAL-WORK-*)

#### VAL-WORK-001
- **Behavior**: skill 被调用时**必须先执行 A1 Pre-research** (读 README / docs / 近期 commits 或用户给定文件) 才进入 A2 提问；唯一例外是用户输入显式自带充分上下文 (含具体文件路径与改动范围)
- **Tool**: e2e-cli
- **Evidence**: skill 调用日志中 AskUserQuestion 之前至少有一次 Read/Grep/git 读取调用；例外路径需在 skill 文本里有显式声明 "skipping Pre-research because user supplied …"

#### VAL-WORK-002
- **Behavior**: 当用户输入引用了仓库文件 / docs 路径 / commit hash，A1 必须真的去读这些资源，不能仅复述
- **Tool**: repo-check
- **Evidence**: skill 在产出 Findings 时引用了至少一个具体行号 / commit short SHA / 文件路径片段

#### VAL-WORK-003
- **Behavior**: 用户输入命中"用户自带 spec"模式时，必须按 §4 五项审计清单逐项走，缺哪项即在 A2 中补问
- **Tool**: e2e-cli
- **Evidence**: 在 A2 的提问列表里能映射回审计清单 1–5 项中至少缺失的那几项

#### VAL-WORK-004
- **Behavior**: A2 Q+GUESS 必须一次只问一个问题，且每个问题附带 Hypothesis+Confidence (例如"我猜 X，置信 60%")
- **Tool**: e2e-cli
- **Evidence**: 单条 AskUserQuestion 只含一个 question；问题描述里出现置信度数字或定性词 (低/中/高)

#### VAL-WORK-005
- **Behavior**: 当 skill 自评 ≥95% 置信度时停止 Q+GUESS，转入 A3
- **Tool**: e2e-cli
- **Evidence**: 在 ≥95% 触发的会话中，停止时 Q 总轮数 ≤10；存在一条明确的"置信度达成，进入 restate"的状态切换日志或对话语

#### VAL-WORK-006
- **Behavior**: A3 6-line restate 必须 ≤6 行，且必须等待用户 explicit-yes 才进 B 阶段
- **Tool**: e2e-cli
- **Evidence**: restate 文本行数 ≤6；用户未回"是/可以/yes/同意/继续"前不会产出 Decide & Design 的内容

#### VAL-WORK-007
- **Behavior**: A1.5 Size check 命中阈值 (VAL 估 >20 / 模块 >5 / 子系统 >2 / 组件 >10 / 用户声明 >3000 LOC) 时必须进入 B0 拆分
- **Tool**: e2e-cli
- **Evidence**: 触发条件的会话中存在 umbrella.md 产物；未触发则没有 umbrella.md

#### VAL-WORK-008
- **Behavior**: B0 拆分必须按 §7 决策树顺序判断 (Greenfield → By risk → Horizontal → BBA → Vertical fallback)
- **Tool**: e2e-cli
- **Evidence**: umbrella.md 的"拆分轴"段落显式标注命中哪条 Q 与对应轴名；不允许写出五条轴之外的名字

#### VAL-WORK-009
- **Behavior**: B1 必须给出 2–3 个候选方向，且明确推荐其中一个并说明 trade-off
- **Tool**: e2e-cli
- **Evidence**: B1 输出中含至少 2 个选项 + 至少 1 个 "推荐 X，因为 …" 的句式

#### VAL-WORK-010
- **Behavior**: B2 按章节呈现设计，每节后等用户认可才继续下一节
- **Tool**: e2e-cli
- **Evidence**: 不存在一次性 dump 整个 What 段落的对话节点；每节产出后下一个非 skill 的对话回合来自用户

#### VAL-WORK-011
- **Behavior**: C1 产出的 `spec.md` 必须包含 Why / Findings / What / Out of scope / Open questions 五段头
- **Tool**: repo-check
- **Evidence**: `docs/specs/<topic>/spec.md` 内 `grep -E '^## (Why|Findings|What|Out of scope|Open questions)'` 命中 5 行

#### VAL-WORK-012
- **Behavior**: C2 产出的 `validation-contract.md` 必须包含 Coverage map + Assertions 两段；每条 VAL 必须有 Behavior / Tool / Evidence 三字段；Tool 字段值必须来自 §9 词表
- **Tool**: repo-check
- **Evidence**: 文件内 `grep -c '^### VAL-'` ≥1；每条 VAL 块内三字段齐全；Tool 值在 {unit-test, integration-test, e2e-browser, e2e-mobile, e2e-cli, http-probe, repo-check, git-state, gh-state, lint, build, manual} 之内

#### VAL-WORK-013
- **Behavior**: D1 Handoff review checklist 必须就地修，不重做；修过后不再进 C 阶段
- **Tool**: e2e-cli
- **Evidence**: 修复后没有重新调用 C 阶段子步；D1 修改通过 Edit 工具直接落到文件

#### VAL-WORK-014
- **Behavior**: D2 Explicit-yes gate：必须把 spec 文件路径明确告知用户，等待用户回认才进入下一阶段 (plan / Pre-coding)
- **Tool**: e2e-cli
- **Evidence**: skill 最后一条文本包含 `docs/specs/<topic>/spec.md` 路径；下一个 skill 调用必须在用户回复"是/可以/ready"等明确认可之后

#### VAL-WORK-015
- **Behavior**: 当 A1.5 / B0 触发 spec 拆分时，C2.5 必须额外产出 `umbrella.md`，且 umbrella 内含"子 spec 列表"表格与"拆分轴"段落；不拆分则不应产出 umbrella.md
- **Tool**: repo-check
- **Evidence**: 拆分触发的会话中 `docs/specs/<topic>/umbrella.md` 存在且含 `## 子 spec 列表` 与 `## 拆分轴` 两段；未触发的会话该文件不存在

### 下游集成 (VAL-DEP-*)

#### VAL-DEP-001
- **Behavior**: `CLAUDE.md` 与 `CLAUDE.zh-CN.md` 的需求澄清阶段 (Step 1) 引用 `spec-design`，不再引用 `brainstorming`；并在 Step 1 内追加一行 bullet 表达 "spec = why+what; plan = how；若改动不影响外部行为契约，可跳过 spec 直接进 plan"
- **Tool**: repo-check
- **Evidence**: 两文件 Step 1 段落同时含 `spec-design` 与该边界规则 bullet；全文 `grep -c brainstorming` == 0 (或仅出现在 release notes / 迁移说明里)

#### VAL-DEP-002
- **Behavior**: `skills-lock.json` 移除 upstream `brainstorming` 条目；`.agents/skills/brainstorming/` 不再存在
- **Tool**: repo-check
- **Evidence**: lock 文件无 brainstorming 字段；目录不存在

#### VAL-DEP-003
- **Behavior**: 新 skill 位于 `plugins/auriga-workflow-skills/skills/spec-design/SKILL.md`；plugin 的 Claude / Codex 双 manifest 版本号同步 bump
- **Tool**: repo-check
- **Evidence**: 路径存在并有 SKILL.md；`.claude-plugin/plugin.json` 与 `.codex-plugin/plugin.json` 的 version 字段相等且大于此前版本

#### VAL-DEP-004
- **Behavior**: `test-designer/SKILL.md` 的输入契约更新为"VAL 优先 + spec 散文兜底"：默认读 `validation-contract.md` 的 VAL 列表；允许在 VAL 不充分时回退读 `spec.md` 散文段补充
- **Tool**: repo-check
- **Evidence**: SKILL.md 内同时提及 `validation-contract.md` 与 spec.md；含"VAL 优先 / fallback"语义的说明段；存在一段说明 VAL → 失败测试 的映射规则

#### VAL-DEP-005
- **Behavior**: `package.json` CLI 版本号根据"一 PR 一次累积 bump"规则上调一次 (因 CLAUDE.md / skills-lock.json / plugin manifest 都属于 user-visible state)
- **Tool**: repo-check
- **Evidence**: `package.json` version 字段相比 main 大且只大一档；版本号变化与 CHANGELOG 一致

#### VAL-DEP-006
- **Behavior**: `dist/catalog.json` 重新生成后包含 spec-design 条目 (来自新 plugin)，并不再包含 brainstorming 条目
- **Tool**: build
- **Evidence**: `npm run build` 后 `grep -c spec-design dist/catalog.json` ≥1；`grep -c '"brainstorming"' dist/catalog.json` == 0

#### VAL-DEP-007
- **Behavior**: `goalify/SKILL.md` 在文档头明确标注输入来源为 `spec.md` + `validation-contract.md`，并标注典型使用时机为 PR Ready 阶段；workflow (`CLAUDE.md`) 不嵌入 goalify 调用
- **Tool**: repo-check
- **Evidence**: SKILL.md 提及两份输入文件路径与 "PR Ready" 关键字；`CLAUDE.md` 在需求澄清 / 规划阶段 grep goalify == 0

#### VAL-DEP-008
- **Behavior**: 版本 release notes / CHANGELOG (或 git tag 的 release body) 在引入 spec-design 的版本里显式标注"removed brainstorming, replaced by spec-design"
- **Tool**: gh-state
- **Evidence**: `gh release view v<new-version>` 的 body 含"brainstorming"与"spec-design"两个关键字
