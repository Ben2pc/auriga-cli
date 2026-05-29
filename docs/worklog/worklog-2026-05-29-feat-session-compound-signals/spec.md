# session-compound 信号覆盖扩展 — Spec

> 把 session-compound 两个 analyzer 从「只解析 assistant + user」扩展到覆盖日志里已存在但被丢弃的高价值信号，让会话复盘报告补齐 PR 生命周期、skill 工作量、工具失败等本该有的维度。

## Why (为什么做)

session-compound 的价值是把单次 CLI 会话压成一份可复盘的报告，核心闭环是「客观指标 + 反馈识别 + 可复用经验候选」。但在真实会话上跑下来，发现两个 analyzer 只解析了日志里很小一部分：Claude 端只吃 `assistant`（token + tool_use）和 `user`（人类消息），其余结构化程度最高的元数据全部丢弃。

结果是报告缺了几个「会话复盘本该有」的维度：

- 一个建并合并了 PR #155 的会话，报告里一个字都没提 PR。
- skill 工作量被严重低估：报告说 git-workflow「调用 1 次」，而日志显示它实际驱动了 39 次工具调用。
- Claude 端完全没有工具失败检测，而 Codex 端有——两端 schema 不对称。
- Codex 端 `skills` 字段恒为空，注释还写着「codex has no skill concept」，但 Codex 现在完全支持 skill（`$skill-name` 命令），调用记录就在日志里。

此外几个启发式信号在真实数据上明显欠拟合：反馈识别漏掉「方向收缩」类信号、`reasoning_ratio` 对纯调研会话误报浪费、`task_conclusion` 截断会切半 markdown 代码块污染候选原料。

这次把这些一次性补齐，并维持两端 schema 对称这一既有设计原则。

## Findings (调研发现)

实证来自在真实会话上跑现有 analyzer + 扒原始日志：

- 现有 analyzer 入口：`plugins/auriga-workflow/skills/session-compound/analyzers/claude-code.mjs`、`codex.mjs`，输出统一 JSON 由 `template.html` 渲染。
- Claude 端 `codex.mjs` 风格的工具失败检测缺失：`claude-code.mjs` 的 `handleAssistant` 只统计 `tool_use`，从不读 `tool_result` 的成败。
- Codex 端硬编码 `skills: []`，注释 `// codex has no skill concept (uses plugins instead)`（`codex.mjs` emit 段），与现实矛盾。
- Claude 日志里被丢弃的可解析信号（在 `f1aa2905` 会话实测）：
  - `pr-link` 条目（13 条，带 `prNumber` / `prUrl` / `prRepository`），实际指向同一个 PR #155。
  - `attributionSkill` / `attributionPlugin`（各 55 条）：把工具调用归因到驱动它的 skill；git-workflow 39、deep-review 16，而现有 `Skill` 工具计数只得 1 / 1。
  - `tool_result` 的 `is_error` 标记：3 次失败 / 62 次成功，语义可分（用户否决 / agent 失误 / 命令错误）。
  - `system` 子类型：`turn_duration`（每 turn 真实 `durationMs`）、`away_summary`（Claude 自己写的离开摘要，自然语言）、`api_error`（含一次 403 + 重试字段）。
  - `aiTitle`：现成会话标题「Analyze context usage and optimization」，而报告标题硬编码 "Session Compound"。
- Codex `<skill>` 块结构：`response_item` 且 `payload.type==="message"` 且 `role==="user"`，`content[0].text` 以 `<skill>\n<name>X</name>\n<path>Y</path>` 开头；一次真实调用只注入一次（无重复，直接计数即可，不需去重）。
- 现有 `active_ms` 是用人类 turn 间隙、按 5 分钟封顶估算；`system/turn_duration` 提供真实墙钟时长 ground truth。
- 反馈正则（`claude-code.mjs` 的 `FEEDBACK_RE`）刻意剔除单字中文，但漏了「先不动吧 / 不着急 / 微优化吧」这类方向收缩信号；Codex 端 4 个追问 turn 识别出 0 条反馈。
- 仓库测试栈：`node --test`（Node 内置），TS 测试编译进 `dist-test`，另有独立 `.mjs` 脚本测试（git-guards 风格）。session-compound 的 analyzer 目前无专属测试。

## What (做什么)

外部可观察契约分为三类信号扩展 + 呈现 + 对称性约束。两端共享的核心字段必须 schema 同步；CLI 专属字段各自扩展，模板按 `cli` 分支处理（沿用既有设计）。新增字段一律为**纯增量**——不删除、不重命名既有字段。

### 1. A 类：新增提取（两端对称）

- **PR 生命周期**：Claude analyzer 从 `pr-link` 条目提取出本次会话引用的 PR（去重后的 number + url + repository 列表）。
- **skill 工作量归因**：Claude analyzer 输出每个 skill 被归因的工具调用次数（来自 `attributionSkill`），与现有「调用次数」并存且区分。
- **工具失败检测**：Claude analyzer 从 `is_error` 的 `tool_result` 提取失败记录（工具名 + 次数 + 预览），shape 与 Codex 端 `tool_failures` 一致。
- **Codex skill 调用维度**：Codex analyzer 解析 `<skill><name>` 块，输出真实 skill 调用列表（替换硬编码空数组），shape 与 Claude 端 `health.skills` 一致。

### 2. B 类：真实数据替换估算

- **真实 turn 时长**：Claude analyzer 在存在 `turn_duration` 系统条目时，用其真实墙钟时长，而不只是间隙估算。
- **API 错误浪费信号**：会话存在 `api_error` / 重试时，作为一条 waste signal 暴露。
- **会话标题**：报告标题在存在 `aiTitle` 时采用它，缺失时回退到默认标题。
- **离开摘要原料**：Claude analyzer 把 `away_summary` 文本作为叙事原料暴露给下游。

### 3. C 类：启发式重校准

- **反馈语义扩展**：`feedback_moments` 捕捉「纠正 + 方向收缩」信号（补上「先不动吧 / 不着急 / 微优化吧」这类漏网），但**不**把无纠正/改向意图的纯疑问句（如「为什么有 60 个技能」）一律算作反馈。
- **reasoning_ratio 不误报**：对没有任何代码修改活动的纯只读调研会话，不再触发 `high_reasoning_ratio` 浪费信号。
- **边界感知截断**：`task_conclusion` 截断不切断 markdown 代码块，不留半截围栏或断行。

### 4. 呈现（HTML 报告）

以上全部新信号在报告里都有对应展示区：PR 生命周期、skill attribution 工作量、工具失败渲染到叙事 / 健康度 tab；turn 时长、API 错误、离开摘要也各有展示位。某信号在某会话缺失时，对应区块优雅留空 / 隐藏，而不是显示破损脚手架。两端（claude-code / codex）都遵守此规则。

### 5. 对称性与向后兼容

两端 analyzer 共享的核心字段（含新增的 `tool_failures`、`skills`）shape 必须一致；CLI 专属字段留在各自 `cli` 分支。新增字段不破坏既有消费方（模板既有渲染、`raw_for_compound`）。SKILL.md 中关于「Codex 没有 skill 概念」「Codex skills 永远为空」等过时描述要更正，并补充新字段说明。

## Out of scope (本次不做)

- 不引入跨会话分析（那是 `session-report` 插件范围）。
- 不改候选条目（candidates）的三类语义与 Compound tab 的交互闭环。
- 不改 `npx skills find` 预查流程。
- 不为 Codex 端补 Claude 专属的 attribution（Codex 日志无等价 `attributionSkill` 字段；Codex 的 skill 维度仅做调用计数）。
- 不重写反馈识别为机器学习 / 语义模型；仍是规则 / 正则方案，只校准覆盖。
- 不改 auriga-cli 自身的 Web UI（catalog / install 界面）；本次仅动 session-compound 报告模板。

## Open questions (悬而未决)

1. **turn_duration 与间隙估算的优先级**（归属：plan）：当 `turn_duration` 存在时是完全替换 `active_ms` 估算，还是二者并存、估算作为缺失时的回退——精确优先级留给 plan 决定，本 spec 只要求「存在时采用真实值」。推迟理由：属于实现策略，不改外部契约的「有真实时长就用真实时长」语义。
2. **reasoning_ratio 的具体门控方式**（归属：impl）：是「无代码修改即抑制该信号」、「提高阈值」，还是二者结合——具体门控逻辑留给 impl，本 spec 只钉死「纯只读会话不误报」这一可观察行为。推迟理由：多种实现都能满足该行为，选择属实现细节。

## References (参考资料)

无（本次澄清未引入外部链接；所有发现来自仓库内文件与本地会话日志实测）。
