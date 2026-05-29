# Validation Contract — session-compound 指令遵循 & Skill 执行评估

> 与 spec.md 配套：spec.md 描述 why+what；本文件描述"什么算通过"。
> 每条 VAL 只描述 Behavior + Tool + Evidence；测试设计（函数组织 / fixture / mock）是 `test-designer` 的活。
> 类别说明：`tests/session-compound-analyzers.test.mjs` 已被上一个已合并功能占用 `EXTRACT` / `SYM` / `DOC` 命名空间，本契约改用 `SUB`（substrate 提取）/ `PAR`（两套 analyzer parity）/ `REL`（release 收尾）三个仓库内唯一标签，避免共享测试文件里 VAL id 撞车、保持 grep 可追溯。

## Coverage map (覆盖矩阵)
| Range (范围) | VAL ids |
|---|---|
| analyzer substrate（确定性层） | VAL-SUB-001 ~ 004 |
| 两套 analyzer 对称 | VAL-PAR-001 |
| 独立 subagent 评估派遣 | VAL-EVAL-001 ~ 003 |
| 报告区块渲染 | VAL-RENDER-001 ~ 002 |
| skill-body 优化候选 | VAL-CAND-001 ~ 002 |
| 版本 / 测试 / 文档收尾 | VAL-REL-001 ~ 002 |

## Toolchain (本仓库验证栈)
> A1 调研所得的既成事实，不是本次功能的实现决策。只填本契约 VAL 实际用到的类别。

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| `unit-test` | 手写断言 harness（`node tests/session-compound-analyzers.test.mjs`，`spawnSync` 跑 analyzer + tmpdir fixture，经 `npm run test:session-compound`） |
| `repo-check` | 文件内容 / 存在性断言（grep SKILL.md / template.html / plugin.json / package.json / test.yml） |
| `manual` | headless DOM-stub 渲染校验脚本 + 浏览器人工核对（见 dev-guide Web UI 检查） |

## Assertions (断言)

### VAL-SUB-001
- **Behavior (行为)**: analyzer 输出含本机可用 skill 目录，每项至少有 `name` 与 `description`（触发条件），覆盖多个 skill 根目录来源。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 对含 ≥2 个 skill 根的 fixture 跑 analyzer，输出 JSON 在约定字段下含一个数组，每项有非空 `name`、有 `description` 键；条目数 = fixture 内 SKILL.md 数。

### VAL-SUB-002
- **Behavior (行为)**: analyzer 输出含从仓库 AGENTS.md / CLAUDE.md 受管工作流区块解析出的规则条目列表。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 含受管区块的 fixture → 非空规则数组；区块缺失的 fixture → 空数组而非报错。

### VAL-SUB-003
- **Behavior (行为)**: analyzer 输出含中性工作流事实包 `workflow_signals`（`{git_branch, on_main, had_code_edit, first_edit_ts, prs_count, skills_invoked_count}`），**只摆事实、不含任何判决字段**（无 status / pass / fail）。判断全部交评估 subagent。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: feature-branch + 编辑 + PR + skill 调用的会话 → `git_branch` 为该分支、`on_main:false`、`had_code_edit:true`、`first_edit_ts` 为数、`prs_count`/`skills_invoked_count` 计数正确；read-only on main 会话 → `on_main:true`、`had_code_edit:false`、`first_edit_ts:null`。对象不含 `status`/`pass` 键。

### VAL-SUB-004
- **Behavior (行为)**: 可用 skill 目录条目去重，同一真实路径不重复计入（符号链接 / 多根指向同一 skill 只算一条）。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: fixture 用符号链接让两个根指向同一 SKILL.md，跑 analyzer，目录里该 skill 仅出现一次。

### VAL-PAR-001
- **Behavior (行为)**: `claude-code.mjs` 与 `codex.mjs` 输出相同的 substrate 核心字段（`skill_catalog` 数组 / `workflow_rules` 数组 / `workflow_signals` 对象），各自从本 CLI 的 skill 根与 cwd 构建；某 CLI 无对应来源时数组为空、`workflow_signals` 仍为含全部事实键的对象。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 分别对两套 analyzer 的 fixture 跑出 JSON，断言三个核心字段键两侧都存在且类型同形（catalog/rules 为数组、workflow_signals 为对象且含相同事实键）。

### VAL-EVAL-001
- **Behavior (行为)**: `SKILL.md` 新增一个评估派遣步骤，明确要求以**独立、零上下文继承**的 subagent 执行该评估。
- **Tool (工具)**: `repo-check`
- **Evidence (判据)**: `SKILL.md` 含描述该派遣步骤的章节，文本明确"独立 / 不继承上下文 / fresh context"等约束语义（grep 命中相应措辞）。

### VAL-EVAL-002
- **Behavior (行为)**: 派遣指令规定召回 / 指令遵循分析覆盖**全部已安装 skill 与全部工作流规则**，而逐 skill 执行 eval **仅覆盖本会话跑过的 skill**。
- **Tool (工具)**: `repo-check`
- **Evidence (判据)**: `SKILL.md` 派遣步骤文本同时含两条范围界定：召回=全部已安装；执行 eval=本会话已调用。

### VAL-EVAL-003
- **Behavior (行为)**: 派遣指令要求每条 finding 带 severity + confidence，且**不按重要性预过滤**。
- **Tool (工具)**: `repo-check`
- **Evidence (判据)**: `SKILL.md` 派遣步骤文本含 severity、confidence 字段要求与"不预过滤 / 全报告"语义。

### VAL-RENDER-001
- **Behavior (行为)**: 报告含一个「指令遵循 & Skill Eval」区块，渲染召回缺口、指令遵循情况与逐 skill 执行 eval。
- **Tool (工具)**: `manual`
- **Evidence (判据)**: 用含评估 finding 的数据跑 headless DOM-stub 渲染校验，该区块标题与各 finding 文本出现在输出 DOM 中。

### VAL-RENDER-002
- **Behavior (行为)**: 评估数据缺失（无 finding）时，该区块优雅隐藏，不渲染空壳。
- **Tool (工具)**: `manual`
- **Evidence (判据)**: 用无评估 finding 的数据跑渲染校验，该区块不出现在输出 DOM 中（沿用 `showIf()` 行为）。

### VAL-CAND-001
- **Behavior (行为)**: 对本仓库可编辑的 SKILL.md，评估流可产出 skill-body 优化候选，候选 target 指向该可编辑 SKILL.md 路径。
- **Tool (工具)**: `repo-check`
- **Evidence (判据)**: `SKILL.md` 候选章节记载：评估产出可生成 target 指向 in-repo SKILL.md 的 `agent-md`（或 `skill-gap`）候选，并给出落点判定规则。

### VAL-CAND-002
- **Behavior (行为)**: 对外部 / cached、不可编辑的 skill，不产出编辑候选，仅在报告中报告其表现。
- **Tool (工具)**: `repo-check`
- **Evidence (判据)**: `SKILL.md` 文本明确：不可编辑 / cached skill 不生成编辑候选，理由为更新即被覆盖。

### VAL-REL-001
- **Behavior (行为)**: 发布该用户可见变更前，`auriga-workflow` 插件版本已提升，且 `SKILL.md` 文档更新描述了新 substrate 字段与新评估步骤。
- **Tool (工具)**: `repo-check`
- **Evidence (判据)**: `.claude-plugin/plugin.json` 与 `.codex-plugin/plugin.json` version 高于当前 3.7.0；`SKILL.md` 的 JSON 字段清单与工作流步骤含新内容。

### VAL-REL-002
- **Behavior (行为)**: 新增 analyzer 评估 substrate 的测试纳入 `test:session-compound` 脚本与 CI 步骤。
- **Tool (工具)**: `repo-check`
- **Evidence (判据)**: `tests/session-compound-analyzers.test.mjs` 含覆盖 SUB/PAR 的新断言；`package.json` 的 `test:session-compound` 仍指向该文件；`.github/workflows/test.yml` 的 Session-compound 步骤存在。
