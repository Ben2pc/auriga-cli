# Validation Contract — session-compound 信号覆盖扩展

> 与 spec.md 配套：spec.md 描述 why+what；本文件描述"什么算通过"。
> 每条 VAL 只描述 Behavior + Tool + Evidence；测试设计 (函数组织 / fixture / mock) 是 `test-designer` 的活。

## Coverage map (覆盖矩阵)
| Range (范围) | VAL ids |
|---|---|
| A 类：新增提取 | VAL-EXTRACT-001 ~ 004 |
| B 类：真实数据替换估算 | VAL-GROUND-001 ~ 004 |
| C 类：启发式重校准 | VAL-HEUR-001 ~ 004 |
| 呈现（HTML 报告） | VAL-RENDER-001 ~ 005 |
| 对称性与向后兼容 | VAL-SYM-001 ~ 002 |
| 文档更正 | VAL-DOC-001 |

## Toolchain (本仓库验证栈)
> A1 调研所得的既成事实，不是本次功能的实现决策。只填本契约 VAL 实际用到的类别；test-designer 据此免去重新推断该用哪个运行器 / 驱动。

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| `unit-test` | `node --test`（Node 内置测试运行器，对 analyzer 喂 fixture JSONL，断言输出 JSON 字段）。analyzer 是纯 `.mjs`，可直连 fixture 跑，或仿 `tests/*.test.mjs` 独立脚本风格 |
| `repo-check` | 文件内容检查（`SKILL.md` 措辞、`template.html` 是否含新增展示区的 DOM 锚点）；可用 `node --test` 读文件断言或 grep |
| `manual` | 人工渲染一份报告（`node analyzers/*.mjs` → 注入 → 浏览器打开），肉眼核对新增展示区与优雅留空 |

## Assertions (断言)

### VAL-EXTRACT-001
- **Behavior (行为)**: 当 Claude 会话日志含 `pr-link` 条目时，analyzer 输出本次会话引用的 PR 列表（去重的 number + url + repository）；无 `pr-link` 时该字段为空集合而非缺失。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 喂含多条指向同一 PR 的 `pr-link` fixture，输出的 PR 列表去重后恰含该 PR 且字段齐全；喂无 `pr-link` 的 fixture，输出为空数组。

### VAL-EXTRACT-002
- **Behavior (行为)**: Claude analyzer 输出每个 skill 被归因的工具调用次数（来自 `attributionSkill`），与现有 skill 调用次数字段并存且语义可区分。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 喂 `attributionSkill` 出现 N 次某 skill 的 fixture，该 skill 的归因工作量为 N；同一输出里现有的 skill 调用计数字段不被覆盖、仍可读。

### VAL-EXTRACT-003
- **Behavior (行为)**: Claude analyzer 从 `is_error` 的 `tool_result` 提取工具失败记录（工具名 + 次数 + 预览），其字段 shape 与 Codex analyzer 的 `tool_failures` 一致。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 喂含若干 `is_error` tool_result 的 fixture，输出的失败记录条数与之相符，且每条键集合与 Codex 端 `tool_failures` 条目相同。

### VAL-EXTRACT-004
- **Behavior (行为)**: Codex analyzer 从 `<skill><name>` 块解析出真实 skill 调用列表（替换原硬编码空数组），每次真实调用计一次。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 喂含一个 `<skill><name>X</name>` 块的 Codex fixture，输出 `health.skills` 含 `{name:X,count:1}`；不含 `<skill>` 块的 fixture 输出空列表。

### VAL-GROUND-001
- **Behavior (行为)**: 当 Claude 日志含 `turn_duration` 系统条目时，analyzer 的时长来自真实记录值，而非仅间隙估算。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 喂含已知 `turn_duration` 值的 fixture，输出的对应时长等于记录值（在容许的聚合口径内），可与纯间隙估算结果区分。

### VAL-GROUND-002
- **Behavior (行为)**: 当会话含 `api_error` / 重试事件时，analyzer 输出一条对应的 waste signal。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 喂含 `api_error`（如 403）+ 重试字段的 fixture，`health.waste_signals` 含一条 API 错误类型的信号；无此类事件的 fixture 不产生该信号。

### VAL-GROUND-003
- **Behavior (行为)**: 报告标题在会话含 `aiTitle` 时采用该标题；缺失时回退到默认标题。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 喂含 `aiTitle` 的 fixture，输出中承载报告标题的字段等于该 `aiTitle`；不含时该字段为约定的默认值。

### VAL-GROUND-004
- **Behavior (行为)**: Claude analyzer 把 `away_summary` 文本作为叙事原料暴露给下游（存在即可被读取）。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 喂含 `away_summary` 的 fixture，输出的叙事原料字段含该摘要文本；不含时为空。

### VAL-HEUR-001
- **Behavior (行为)**: `feedback_moments` 捕捉方向收缩 / 改向类信号（例「先不动吧」「不着急」「微优化吧」），这些在改造前会被漏掉。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 喂含上述方向收缩短语的人类 turn fixture，对应 turn 进入 `feedback_moments`。

### VAL-HEUR-002
- **Behavior (行为)**: 不携带纠正 / 改向意图的纯疑问句（例「为什么有 60 个技能」）不被分类为 feedback。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 喂仅含此类调研型疑问句的人类 turn fixture，`feedback_moments` 不含该 turn。

### VAL-HEUR-003
- **Behavior (行为)**: 对没有任何代码修改活动（无 edit/write/patch 类工具）的纯只读会话，不触发 `high_reasoning_ratio` 浪费信号，即便推理占比超过原阈值。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 喂一个 reasoning 占比高、但无任何代码修改工具调用的 Codex fixture，`waste_signals` 不含 `high_reasoning_ratio`；同等占比但有 patch 活动的 fixture 仍可触发。

### VAL-HEUR-004
- **Behavior (行为)**: `task_conclusion` 截断不在 markdown 代码块内部切断，不留半截围栏或断行。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 喂一个结论文本在截断点处于代码围栏内的 fixture，输出的 `task_conclusion` 不含未闭合的 ``` 围栏。

### VAL-RENDER-001
- **Behavior (行为)**: HTML 报告渲染 PR 区，列出本次会话引用的 PR（number + 可点链接）。
- **Tool (工具)**: `manual`
- **Evidence (判据)**: 用含 PR 的数据渲染报告，浏览器中可见 PR 列表区，PR 号与链接正确。

### VAL-RENDER-002
- **Behavior (行为)**: HTML 报告渲染 skill attribution 工作量（每个 skill 被归因的工具调用次数）。
- **Tool (工具)**: `manual`
- **Evidence (判据)**: 用含 attribution 的数据渲染报告，可见各 skill 的工作量数值，与 analyzer 输出一致。

### VAL-RENDER-003
- **Behavior (行为)**: HTML 报告渲染工具失败列表，对 claude-code 与 codex 两端均生效。
- **Tool (工具)**: `manual`
- **Evidence (判据)**: 分别用两端含失败记录的数据渲染报告，均可见工具失败区与对应条目。

### VAL-RENDER-004
- **Behavior (行为)**: HTML 报告为 turn 时长、API 错误、离开摘要这三类次级信号各提供展示位，存在数据时可见。
- **Tool (工具)**: `manual`
- **Evidence (判据)**: 用分别含这三类数据的报告渲染，每类在对应区块可见。

### VAL-RENDER-005
- **Behavior (行为)**: 某信号在某会话缺失时，其展示区优雅留空 / 隐藏，而非显示破损脚手架；两端均如此。
- **Tool (工具)**: `manual`
- **Evidence (判据)**: 用缺失若干信号的最小会话数据渲染报告，缺失区块呈现空态提示或隐藏，无破损 DOM / 占位乱码。

### VAL-SYM-001
- **Behavior (行为)**: 两端 analyzer 共享的核心字段（含新增的 `tool_failures`、`skills`）键集合与结构一致；CLI 专属字段留在各自分支。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 对同构最小 fixture 分别跑两端，断言共享字段的键集合相等；专属字段只出现在对应 CLI 输出。

### VAL-SYM-002
- **Behavior (行为)**: 既有字段（模板既有渲染所依赖的字段、`raw_for_compound` 等）不被删除或重命名；扩展为纯增量。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 对一份代表性 fixture 的输出，改造前存在的顶层及关键嵌套字段在改造后依然存在且类型不变。

### VAL-DOC-001
- **Behavior (行为)**: `SKILL.md` 不再声称「Codex 没有 skill 概念」「Codex skills 永远为空」，并补充了新增字段（PR、attribution、工具失败、turn 时长、API 错误、离开摘要、aiTitle）的说明。
- **Tool (工具)**: `repo-check`
- **Evidence (判据)**: `SKILL.md` 不含过时断言字样；含对上述新字段的描述。
