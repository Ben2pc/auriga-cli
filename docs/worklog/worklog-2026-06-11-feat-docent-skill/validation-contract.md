# Validation Contract — docent (验收契约 — 代码讲解员)

> 与 spec.md 配套：spec.md 描述 why+what；本文件描述"什么算通过"。
> 每条 VAL 只描述 Behavior + Tool + Evidence；测试设计 (函数组织 / fixture / mock) 是 `test-designer` 的活。

## Coverage map (覆盖矩阵)

| Range (范围) | VAL ids |
|---|---|
| skill 资产形态与发布 | VAL-DCNT-001 ~ 004, 013 |
| 入口行为 | VAL-DCNT-005 ~ 006 |
| 执行模型 | VAL-DCNT-007 |
| 产物形态 | VAL-DCNT-008 ~ 009 |
| 报告内容契约 | VAL-DCNT-010 ~ 011 |
| 纠偏循环 | VAL-DCNT-012 |

## Toolchain (本仓库验证栈)

> A1 调研所得的既成事实，不是本次功能的实现决策。只填本契约 VAL 实际用到的类别；test-designer 据此免去重新推断该用哪个运行器 / 驱动。

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| `repo-check` | `node --test`（经 `npm test` 触发；插件 skill 的仓库级检查先例为 `tests/plugin-skill-frontmatter.test.ts`、`tests/auriga-workflow-skills.test.ts`） |
| `manual` | 在真实仓库中显式调用 `/docent` 并人工核对报告 |

## Assertions (断言)

### VAL-DCNT-001
- **Behavior (行为)**: auriga-workflow 插件内存在名为 `docent` 的 skill，且声明为仅限用户显式调用、模型不可自动触发。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: skill 的 SKILL.md 存在于插件 skills 目录下，frontmatter 含合法的 `name` / `description`，且含禁止模型自动调用的声明字段。

### VAL-DCNT-002
- **Behavior (行为)**: skill 不携带固定 HTML 模板资产；报告质量约束以"核心目的 + 可视化调色板 + 硬性约束（必答清单、锚点、自包含）"的形式写在 skill 指令中。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: skill 目录下不存在 `template.html` 或等价的固定报告模板文件；SKILL.md 正文可检出必答清单与硬性约束的表述。

### VAL-DCNT-003
- **Behavior (行为)**: skill 指令满足双 Agent 可移植性约定（`docs/rules/agent-portability.md`）：泛指 Agent 不写 "Claude"，Claude 独有工具名成对写出 Codex 对应物。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 对 SKILL.md 及其附属文件的检查不命中"裸 Claude 指代 the agent"与"只写 Claude 独有工具名"的违例模式。

### VAL-DCNT-004
- **Behavior (行为)**: auriga-workflow 插件 manifest 版本相对 3.9.0 已提升，且两份 marketplace 清单的插件 description 均包含 `docent`；CLI `package.json` 版本不因本变更提升。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: `plugins/auriga-workflow/.claude-plugin/plugin.json` 与 `.codex-plugin/plugin.json` 的 version 一致且大于 3.9.0；`.claude-plugin/marketplace.json` 的该插件 description 与两份插件 manifest 的 description 均可检出 `docent`；`.agents/plugins/marketplace.json` 存在指向该插件目录的条目（该清单结构无 description 字段，Codex 侧用户可见描述由 `.codex-plugin/plugin.json` 承载——按仓库事实修正原判据）。

### VAL-DCNT-005
- **Behavior (行为)**: 以自然语言问题为参数显式调用时，skill 先定位相关代码再生成报告，最终产出满足本契约产物与内容断言的报告。
- **Tool (工具)**: manual
- **Evidence (判据)**: 在本仓库执行一次 `/docent <自然语言问题>`（例："runtime content 是怎么固定到版本 tag 的"），得到的报告覆盖该问题对应的真实代码且通过 VAL-DCNT-008 ~ 011 核对。

### VAL-DCNT-006
- **Behavior (行为)**: 以存在的文件或目录路径为参数显式调用时，理解范围即该路径（跳过主题定位），产出契约与主题入口一致。
- **Tool (工具)**: manual
- **Evidence (判据)**: 在本仓库执行一次 `/docent <仓库内目录>`，报告聚焦该路径内容，且同样通过 VAL-DCNT-008 ~ 011 核对。

### VAL-DCNT-007
- **Behavior (行为)**: 定位、通读、合成、生成全过程由单个专职子代理完成；主对话中不出现批量的代码文件阅读，只出现派遣、结果路径与摘要。
- **Tool (工具)**: manual
- **Evidence (判据)**: 调用过程的会话记录显示恰好一个承担生成职责的子代理；主对话内无逐文件读代码的展开。

### VAL-DCNT-008
- **Behavior (行为)**: 产物为单文件 HTML，写入 `/tmp` 而非项目仓库，打开时无运行时网络依赖，生成后自动打开，主对话同时给出文件路径与文字摘要。
- **Tool (工具)**: manual
- **Evidence (判据)**: 报告文件位于 `/tmp` 下且为单文件；断网状态下用浏览器打开渲染完整（含全部图表）；会话记录含自动打开动作、路径与摘要；`git status` 显示仓库无新增产物。

### VAL-DCNT-009
- **Behavior (行为)**: 报告语言跟随当次对话语言。
- **Tool (工具)**: manual
- **Evidence (判据)**: 中文会话产出的报告正文为中文（代码标识符与锚点除外）。

### VAL-DCNT-010
- **Behavior (行为)**: 报告回答九条必答（为什么存在；入口与主流程；代码地图——目录结构与文件角色合并呈现；数据/状态流转；不明显的坑；相邻模块契约；历史演化脉络；如何验证理解；阅读足迹）；"入口与主流程"至少配一张标准软件工程图（时序/流程/状态图）；窄范围允许显式标注"不适用"，禁止静默缺失。（修订记录：原十条中"文件角色"+"目录结构"合并、"定位透明"更名"阅读足迹"、新增主流程图要求——PR Ready 后用户反馈。）
- **Tool (工具)**: manual
- **Evidence (判据)**: 逐条核对报告：每条必答在报告中有对应内容或显式"不适用"标注；不存在既无内容也无标注的维度。

### VAL-DCNT-011
- **Behavior (行为)**: 报告中所有关于代码的结论附带 `文件:行号` 锚点，且锚点指向的仓库位置真实存在并与结论相符。
- **Tool (工具)**: manual
- **Evidence (判据)**: 抽查报告中的结论性陈述，每条可定位到锚点；抽查的锚点在仓库对应文件行号处内容相符。

### VAL-DCNT-012
- **Behavior (行为)**: 用户在主对话指出定位遗漏或偏差后，同一会话内可获得一份修订后的报告，修订覆盖被指出的缺口；无跨会话持久化状态。
- **Tool (工具)**: manual
- **Evidence (判据)**: 对一次生成的报告提出"漏看了 X"反馈后，得到的新报告包含 X 的讲解；过程未在仓库或用户目录写入跨会话状态文件。

### VAL-DCNT-013
- **Behavior (行为)**: skill 自带一份前端设计规范参考（摘取改编自 `frontend-design` 的审美准则），随插件分发、不按路径依赖 `.claude/` 或插件外资产；skill 指令要求子代理生成报告 HTML 时参考该规范。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 插件 skill 目录下存在该设计规范参考文件；SKILL.md 可检出对它的引用；文件内容不含指向 `.claude/` 或插件目录之外的路径依赖。
