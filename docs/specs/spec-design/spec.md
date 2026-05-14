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

**spec.md (本文件本身就是模板)**：Why / Findings / What / Out of scope / Open questions。What 段落的内部结构按需求复杂度自行展开，不强制统一。

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

### 10. 下游集成 (Section 4 待展开)

本节占位，将在 brainstorming 的 Section 4 讨论后补全。预期触及：

- `test-designer` 的输入契约升级 (从读 spec.md 散文改为读 validation-contract.md)
- `goalify` 在 spec 阶段的注入逻辑
- `CLAUDE.md` / `CLAUDE.zh-CN.md` 的需求澄清 + 规划阶段重写
- `skills-lock.json` 中 upstream brainstorming 的移除
- `.agents/skills/brainstorming/` 的清理
- 新 skill 在 `plugins/auriga-workflow-skills/` 中的目录与 plugin manifest

## Out of scope

本次 spec-design skill 的实现 **不包含**：

- 自动从 Figma 拉图 (要求用户自行附图)
- 把 spec 写出来后自动执行 plan / impl (仍是分阶段 skill 链)
- 替换或干预 `test-designer` / `incremental-impl` 的内部逻辑 (只升级契约)
- 多人协作下的 spec 合并 / 冲突解决 (单作者模型)
- 自动判断 "需要拆分 spec" 时的细粒度跨子 spec 共享 VAL 机制 (Shared VAL 已显式禁用)

## Open questions

留给 Section 4 与后续 plan 阶段澄清：

1. `goalify` 的 `/goal` 文本是否需要在 spec 阶段就生成，还是 plan 阶段才介入？
2. `CLAUDE.md` 重写时，spec / plan 边界规则放到 workflow 头还是单独一节？
3. `skills-lock.json` 中 brainstorming 移除后，是否需要在 README 表格留一行"deprecated, replaced by …"作为迁移指引？
4. spec-design 在 dual-Agent (Claude Code + Codex) 下的差异化：是否需要在 Codex 端缩减 Q+GUESS 轮数以适配其 hook 反馈通道差异？
