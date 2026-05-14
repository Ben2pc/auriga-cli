# spec-design Skill 设计文档

> 这是一份用于替换上游 `brainstorming` 的新版需求澄清 skill 的设计 spec。
> 它本身就是新 skill 要产出的 spec 形态的样例 —— 读者可以把它当作模板对照。

## Why

当前 auriga workflow 的需求澄清阶段调用上游 `addyosmani/agent-skills` 的 `brainstorming` skill，存在三个问题：

1. **输出形态弱**：产出是一份散文风格的 design doc，下游 (test-designer / incremental-impl) 需要再解析一遍才能用，且没有结构化的行为断言，容易出现"实现完了才发现需求被悄悄改了"。
2. **没有审查闸门**：spec 写完即认为完成，缺少对 spec 自身质量的检查 (placeholder、内部矛盾、可测试性)，也缺少把 spec 移交给下一阶段时的 handoff 视角检查。
3. **不区分 Why / What / How**：upstream 把架构、组件、数据流也写进 spec，导致 spec 越写越像 plan；当 plan 阶段的 agent 拿到这份 spec，往往会被既定的实现路径绑住手脚。

借鉴 Factory Missions 的 Validation Contract 模式，并融合 `interview-me` 的提问纪律与 `spec-driven-development` 的可测试约束，我们用一个 **auriga 自有的 `spec-design` skill** 全面替换上游 brainstorming。

## Findings

进入 What 之前先沉淀几个调研结论：

- Factory Missions 把 spec 拆成 "Coverage map + Assertions" 两段，每条 Assertion 形如 `VAL-XXX-NNN: behavior + tool + evidence`，这种结构让 test-designer 可以直接消费而不必再做语义抽取。
- `interview-me` 的核心是 "Hypothesis+Confidence / Q+GUESS / Explicit-yes gate / 95% 置信度停止" —— 通过一次只问一个、附带可被反驳的猜测，把澄清过程压缩到 5–10 轮。
- `spec-driven-development` 强调 "surface-findings" 纪律 (调研结果先摊开)、把模糊需求 reframe 成可测试断言、把 spec 当作"活文档"持续维护。
- 当前 workflow 里 `incremental-impl` 已经在 Step 2 内置了五条 slicing 轴 (Walking Skeleton / By risk / Horizontal sweep / Branch by Abstraction / Vertical slice)，我们可以在 spec 层做"大需求拆分"时复用同一套词汇，避免下游 Plan 阶段又造一遍。
- 用户实际进入 spec 阶段的输入形态高度多样：一段话、静态 HTML 原型、PRD、Figma 链接、甚至已经写好的"伪 spec"。skill 必须显式覆盖这五种入口。

## What

### 1. 工作流定位与 Spec / Plan 边界

spec-design 是 auriga workflow 的**需求澄清阶段**唯一入口 skill。

- **spec = why + what**：为什么要做、做完什么样子算成功、外部可观察的行为契约。
- **plan = how**：模块拆分、接口形态、目录布局、实现顺序、具体技术选型。

**边界规则**：如果一次改动影响 **外部行为契约** (新增/修改用户可见行为、API、CLI 子命令、文件格式、对外文档…)，必须先过 spec；如果只是 **实现策略** 的替换 (重构、改算法、换库) 且外部行为不变，跳过 spec 直接进 plan。这条规则会同步写进 `CLAUDE.md` 的工作流头。

### 2. Skill 内部流程：4 阶段 × 11 子步

```
A. Discover   →  B. Decide & Design  →  C. Write   →  D. Gate & Handoff
   (查清楚)        (定方向、定切分)        (落到文件)     (交付前自检)
```

| 阶段 | 子步 | 干什么 |
|---|---|---|
| **A. Discover** | A1 | Pre-research：读 README / docs / 近期 commits；如果用户给了 spec，按 §4 审计清单逐项审；如果给了 HTML / PRD / Figma 链接，提取关键截图或正文要点写入 Findings 草稿 |
|  | A1.5 | Size check：根据用户描述与初步 ingest，判断这次需求是否超过单 spec 容量 (见 §6) |
|  | A2 | Q+GUESS 澄清循环：每轮一个问题，附带 Hypothesis+Confidence，95% 置信度停止 |
|  | A3 | 6-line restate：把澄清结果压成 ≤6 行复述，请用户 Explicit-yes 确认 |
| **B. Decide & Design** | B0 | Decomposition (仅当 A1.5 判定超阈值)：按 §7 决策树选拆分轴，输出子 spec 列表 + umbrella.md |
|  | B1 | Propose 2-3 approaches：列出 trade-off + 推荐方向 |
|  | B2 | Present in sections：按章节呈现设计，每节后等用户认可再继续 |
| **C. Write** | C1 | 写 `spec.md` (本文档结构即模板) |
|  | C2 | 写 `validation-contract.md` (Coverage map + Assertions) |
|  | C2.5 | 如果 B0 触发了拆分，再写 `umbrella.md` 串起所有子 spec |
| **D. Gate & Handoff** | D1 | Handoff review：从下游消费者视角自检 spec (见 §8 checklist) |
|  | D2 | Explicit-yes gate：把 spec 文件路径交给用户，等待明确认可才进入下一阶段 |
|  | D3 | Handoff：按 scope triage 结果，把 spec 交给 plan / 直接进入 Pre-coding (QDF) |

### 3. 五种输入模式

| 模式 | 用户给出的形态 | A1 处理重点 |
|---|---|---|
| 1. 文本描述 | 一段话 / 几句话 | 直接进 Q+GUESS；先做仓库调研补背景 |
| 2. 静态 HTML 原型 | 用户自己生成的 HTML 文件 | 截图/列页面 → 提取可交互元素 → 反推用户故事 |
| 3. PRD 文档 | Notion / Markdown / PDF | 摘要关键章节 → 标出未澄清/有歧义的点 → 入 Q 列表 |
| 4. Figma 链接 | URL | 提示用户附上关键页面截图或导出 png；不要求 skill 自己访问 Figma |
| 5. 用户自带 spec | 用户认为已完成的 spec | **必须走 §4 审计清单**，不要直接接受 |

### 4. 用户自带 spec 的审计清单

即使用户声称"这就是我的 spec"，也按以下 5 点逐项审，缺哪项就在 Q+GUESS 阶段补：

1. **Why 是否清晰**：动机一句话能否说清，缺失则补 1–3 句
2. **Findings 是否有据**：是否有具体调研依据 (文件路径、引用、commit、外部链接)
3. **Validation Contract 是否存在**：有没有可被测试的行为断言；只有散文 → 必须 reframe 成 VAL 列表
4. **Out of scope 是否标注**：是否显式列出"这次不做"的范围
5. **是否暗藏 How**：spec 里如果出现具体模块名 / 类名 / 接口签名 / 数据结构 → 标记为越界，转入 plan 阶段

### 5. 三个文件模板

**spec.md (本文件本身就是模板)**：Why / Findings / What / Out of scope / Open questions / **References (可选)**。What 段落的内部结构按需求复杂度自行展开，不强制统一。

`References` 段用于存档用户在 brainstorming 过程中提供的外部链接 (文章、上游 SKILL.md、PRD 链接、Figma URL、相关 issue/PR 等)。skill 在 A1 / A2 / A3 阶段一旦接收到 URL 类输入，必须把它落入此段并标注来源时机 (例如 "用户在 A2 第 3 轮提供") 与该链接对设计的影响要点，避免链接丢失或下游 agent 无法回溯依据。仅当用户未提供任何外链时，References 段可省略。

**validation-contract.md**：

```markdown
# Validation Contract — <feature-name>

## Coverage map
- 模块 / 边界 / 用户故事 → 对应 VAL 编号区间

## Assertions

### VAL-CAT-001
- **Behavior**: 用一句话说清外部可观察到的行为
- **Tool**: 用哪类工具验证 (见 §9 工具词表)
- **Evidence**: 通过的判定依据 (命令退出码 / 输出片段 / 截图差异 / 测试断言)
```

VAL 编号约定：`VAL-<CATEGORY>-<NNN>`，`CATEGORY` 用 3–5 字母大写词 (WORK / DEP / UI / CLI…)，`NNN` 三位零填充。**禁止把 VAL 写成测试设计**：VAL 只说"什么算通过"，不说"测试函数怎么组织 / mock 谁 / 用哪个 fixture" —— 那些是 test-designer 的活。

**umbrella.md (仅在拆分时存在)**：

```markdown
# <feature> — umbrella

## 子 spec 列表
| 顺序 | spec | 关键 VAL 区间 | 状态 |
|---|---|---|---|

## 拆分轴
说明选了哪条 slicing axis 及理由 (见 §7)
```

### 6. 何时拆分 spec：Size gate 信号

任一信号触发即进 B0 拆分：

- 预估 VAL 总数 > 20
- 涉及模块 > 5
- 涉及子系统 > 2 (例如同时改 CLI、Web UI、plugin manifest)
- 涉及 UI 组件 > 10
- 用户明确说"这次大概 > 3000 行"

### 7. B0 拆分决策树

按以下顺序判断，命中即停：

1. **Q1：是否 Greenfield (从零搭子系统)？** → **Walking Skeleton**：最薄端到端先跑通，再纵向加肉
2. **Q2：是否存在显著高风险/未知技术点？** → **By risk**：先攻最不确定的子 spec，验证后再展开其余
3. **Q3：是否横向波及多模块但每模块改动相似？** → **Horizontal sweep**：一个子 spec 一个模块，串行做
4. **Q4：是否需要 in-place 渐进迁移？** → **Branch by Abstraction**：先引抽象层，再切换
5. **Fallback** → **Vertical slice**：按用户故事纵切

> 这五条轴与 `incremental-impl` Step 2 完全同名同义；spec 阶段定的轴，plan / 实现阶段直接沿用，不再二次决策。

### 8. Handoff review checklist (D1)

从下游 (test-designer / planner / 用户本人) 视角扫一遍：

- [ ] 是否有 TBD / TODO / placeholder？
- [ ] Why 段落是否能让一个空白上下文的 agent 理解动机？
- [ ] 每条 VAL 的 Behavior 是否单义？(同一句话不会被两种实现都判为通过)
- [ ] VAL 是否只描述"什么算通过"而非"怎么测"？
- [ ] Out of scope 是否覆盖了所有"看起来该做但这次不做"的项？
- [ ] 是否有 What 段落与 VAL 之间互相矛盾？
- [ ] 如果做了拆分，umbrella.md 是否能在不打开子 spec 的情况下看清总体范围？

发现问题就地修，不重做。

### 9. 工具词表 (VAL 的 Tool 字段使用)

VAL 的 `Tool` 字段必须从下列**类别**里选一个，不写具体工具名 (避免锁死实现)：

- `unit-test` — 单元测试
- `integration-test` — 集成测试 (跨模块、跨进程内)
- `e2e-browser` — 浏览器端到端 (具体走 Browser Use / Playwright / Chrome MCP 由 plan 决定)
- `e2e-mobile` — 移动端/模拟器端到端 (具体走 Computer Use / XCUITest / Espresso 由 plan 决定)
- `e2e-cli` — 命令行端到端 (子进程黑盒)
- `http-probe` — HTTP 请求 + 响应断言
- `repo-check` — 仓库文件存在性 / 内容 / 权限
- `git-state` — git 分支 / 提交 / 状态
- `gh-state` — GitHub PR / Issue / Release 状态
- `lint` — 静态检查 (eslint / type check / shellcheck …)
- `build` — 构建产物正确性 (tsc / npm pack / artifact shape)
- `manual` — 人工验证 (仅用于无法自动化的 UX 判断；要写清"看到什么算通过")

### 10. 下游集成

**10.1 `test-designer` 输入契约**：升级为"**VAL 优先 + spec 散文兜底**"。test-designer 默认读 `validation-contract.md` 的 VAL 列表作为行为契约来源；当独立评估 agent 发现某条 VAL 的 Behavior 不够单义、或某个隐含行为未被任何 VAL 覆盖时，可回到 `spec.md` 散文段落补抽。两份文档对独立评估 agent 都可见。test-designer 在感到 VAL 严重不足时仍可退回 spec-design 修改 spec，而非自行展开。

**10.2 `goalify` 集成**：`spec-design` **不**调 goalify；workflow 也**不**嵌入 goalify。仅在 `goalify/SKILL.md` 内说明输入来源 = `spec.md` + `validation-contract.md`，并标注典型使用时机为 **PR Ready 阶段** (整理 PR 时把目标翻译成 `/goal` 文本给用户)。原因：goalify 本质是 how 的末端翻译，过早自动调会产生 throwaway 的 /goal 文本；当前 goalify 稳定度尚不足以嵌入 workflow。

**10.3 `CLAUDE.md` / `CLAUDE.zh-CN.md` 改动**：

- 在 Requirement Clarification 步 (Step 1) 内追加一行 bullet：`spec = why+what; plan = how。若改动不影响外部行为契约，可跳过 spec 直接进 plan。`
- 把"Use `brainstorming` to clarify requirements"替换为"Use `spec-design` to clarify requirements"。
- 不新增独立小节 (保持文件精简)。
- 中英两份必须同步改 (按 `feedback_plan_language` 与 README/CLAUDE 双语同步规则)。

**10.4 upstream `brainstorming` 退役**：直接删除——`skills-lock.json` 移除条目；`.agents/skills/brainstorming/` 目录删除；`README.md` / `README.zh-CN.md` 的 Skills 表格中 brainstorming 行替换为 spec-design 行。**Release notes** 在版本 bump 时显式标注："Removed external `brainstorming` skill; replaced by auriga-owned `spec-design` (bundled in `auriga-workflow-skills` plugin)."

**10.5 新 skill 落点**：

- 路径：`plugins/auriga-workflow-skills/skills/spec-design/SKILL.md` (+ 必要的 `references/` 子文件)
- 双 manifest 同步 bump：`.claude-plugin/plugin.json` 与 `.codex-plugin/plugin.json` 的 version 由 1.0.2 → 1.0.3 (或更高，根据 PR 合并顺序)
- 本地开发期符号链接：`.claude/skills/spec-design` 与 `.agents/skills/spec-design` 指向 plugin 内目录 (与 `incremental-impl` / `test-designer` 同模式)
- `dist/catalog.json` 在 `npm run build` 后自动收录 spec-design 描述 (来自 SKILL.md frontmatter)

**10.6 `deep-review` 的 `spec-conformance` reviewer 升级**：把 reviewer 的主要输入从 "spec.md 散文" 调整为 "`validation-contract.md` 的 VAL 列表"。reviewer 必须对照 PR diff 逐条核验 VAL 是否被实现满足 (Behavior 命中 / Tool 与 Evidence 可被现有测试或检查覆盖)；`spec.md` 仍保留为 Why 上下文与 Out-of-scope 判定来源。任何 VAL 漏覆盖一律算 blocking，写入 deep-review 报告时附 `VAL-XXX-NNN` 编号定位。文件路径：`plugins/deep-review/skills/deep-review/references/reviewers/spec-conformance.md`。该 reviewer 的 Detection table、Output contract、worked scenarios 都需同步更新。

## Out of scope

本次 spec-design skill 的实现 **不包含**：

- 自动从 Figma 拉图 (要求用户自行附图)
- 把 spec 写出来后自动执行 plan / impl (仍是分阶段 skill 链)
- 替换或干预 `test-designer` / `incremental-impl` 的内部逻辑 (只升级契约)
- 多人协作下的 spec 合并 / 冲突解决 (单作者模型)
- 自动判断 "需要拆分 spec" 时的细粒度跨子 spec 共享 VAL 机制 (Shared VAL 已显式禁用)
- **修改已存在 spec** 的轻量循环 (本 skill 是创建新 spec 的流程；针对小修改的 spec 维护按 PR 内常规编辑处理，不另起一遍 4 阶段流程)

## Open questions

留给 plan 阶段 (writing-plans) 澄清：

1. **dual-Agent 差异**：spec-design 在 Codex 端是否需要缩减 Q+GUESS 轮数以适配其 hook 反馈通道差异 (Codex 当前在 PreToolUse `additionalContext` 上 fail-open)？
2. **B0 拆分后 PR 链路**：一次 spec-design 产出 N 个子 spec 时，是 N 个独立 Draft PR 串行，还是一个 umbrella PR + N 个 follow-up issue？取决于 `incremental-impl` 是否能跨 spec 复用 slice 计划。
3. **spec-design 自身的 dogfood 顺序**：是否先用一份手写 spec-design SKILL.md 走第一轮实现，再回头用最终 spec-design 跑自己一次作为 regression？

## References

- **Factory Missions (Factory.ai)** — 2026-05 公开介绍文章 (用户在初次对话提供)。借鉴：orchestrator/worker/validator 分离、Validation Contract `VAL-XXX-NNN` 形态、写串行/读并行的 broker 模型、Self-Evaluation Bias 概念。
- **interview-me** — `https://github.com/addyosmani/agent-skills/blob/main/skills/interview-me/SKILL.md` (用户在 Section 1 提供)。借鉴：Hypothesis+Confidence 提问纪律、Q+GUESS 单问、Explicit-yes gate、95% 置信度停止规则、6-line restate。
- **spec-driven-development** — `https://github.com/addyosmani/agent-skills/blob/main/skills/spec-driven-development/SKILL.md` (用户在 Section 1 提供)。借鉴：surface-findings 纪律、模糊需求 reframe 成可测试断言、把 spec 当"活文档"维护的姿态。
- **incremental-impl** — 本仓库 `plugins/auriga-workflow-skills/skills/incremental-impl/SKILL.md`。复用 §7 五条 slicing axes (Walking Skeleton / By risk / Horizontal sweep / Branch by Abstraction / Vertical slice)，spec 层定的轴下游 plan / impl 阶段直接沿用。
- **brainstorming (upstream，待退役)** — `https://github.com/addyosmani/agent-skills/blob/main/skills/brainstorming/SKILL.md`。本 skill 上线后，按 §10.4 直接删 lock 条目 + `.agents/skills/brainstorming/`，release notes 标注迁移路径。
