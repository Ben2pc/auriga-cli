---
name: spec-design
description: 当 feat/ 或 fix/ 会新增或改变外部可见行为时使用；也用于澄清需求、写 spec、拆需求、定义行为契约，产出 `spec.md` 和 `validation-contract.md`。
---

# Spec Design

需求澄清调度器。把模糊的诉求（一句话、一张 HTML 原型、一份 PRD、一个 Figma 链接，甚至用户自己写的"spec"）转化成两份下游流程可以机械消费的文件：

- `docs/specs/<topic>/spec.md` — Why + Findings + What + Out of scope + Open questions（+ References）
- `docs/specs/<topic>/validation-contract.md` — `VAL-XXX-NNN` 断言，每条含 `Behavior + Tool + Evidence`
- `docs/specs/<topic>/umbrella.md` — 仅当规模闸门触发拆分时生成

Validation Contract 是承重产物。`test-designer` 把 VAL 作为主输入；`deep-review` 的 `spec-conformance` 审查者读 VAL 来确认一个 PR 的 diff 满足每一条断言。

## 什么时候用

- 有人提出新功能、公共 API 变更、schema 迁移、CLI 子命令，或任何用户可见的行为变化
- 用户说"来写个 spec"、"澄清需求"、"给 X 写个规范"、"头脑风暴一个功能"
- 用户自带的 spec 需要按 auriga 标准审一遍，下游阶段才能消费

**不要用在：**

- 纯实现策略调整、外部行为契约不动的情况（重构、换算法、换库）——直接进 plan
- 已有复现步骤的 bug 修复型任务（bug 报告本身*就是*需求）——走 systematic-debugging
- 没有行为表面的纯文档 / 配置任务

## 铁律（spec / plan 边界）

**spec = why + what; plan = how.**

如果一处改动会移动外部行为契约——用户、外部调用方、API 消费者、或下游文件格式能观察到的东西——那它在进 plan 之前要先过这个 skill。

如果一处改动纯属内部——同样的可观察行为、只是换了实现策略——跳过这个 skill，直接进 plan。

`spec.md` 记录外部表面与动机。一旦某节读起来像"我们会用文件 X、函数 Y、配合辅助函数 Z"，它就越界进了 how——把这部分留给 plan 阶段，不要写进 `spec.md`。

## 禁止事项（调度器边界）

- **实现已经开始、或已经打过草稿之后，不要再调用本 skill。** 派遣的审计和 Q+GUESS 循环都假设零实现上下文。一旦你已经讨论过哪些文件 / 函数会改，澄清循环就会为那份草稿找理由，而不是探究用户的真实意图。
- **不要让 `spec.md` 堆积 How。** 模块名、类名、确切的 API 签名、数据结构选择、库名——都不在范围内。用户主动给了，就写进将来的 plan，不写进 spec。
- **不要跳过 Q+GUESS 的置信度停止点。** 在预测置信度约 95% 处停下是纪律；硬冲 100% 会把对话收得过窄，让 spec 变成伪装的 plan。
- **不要编造 VAL 编号。** 每条 VAL 都必须来自一个真实且独立的外部行为。为了显得周全而凑数会把契约变成噪声。

## 输入（五种模式）

| 模式 | 形态 | A1 处理方式 |
|---|---|---|
| 1. 文字描述 | 一句话或一段话 | 仓库预研后直接进 Q+GUESS |
| 2. 静态 HTML 原型 | 用户提供的 HTML 文件 | 打开、截图 / 罗列页面、抽取交互元素、推断用户故事 |
| 3. PRD | Notion / Markdown / PDF | 概括关键章节，标出含糊处，进 Q 列表 |
| 4. Figma 链接 | URL | 请用户附上关键页面截图或 PNG 导出；**不要**尝试直接抓取 Figma |
| 5. 用户自带 spec | 用户以为已经写好了 | **必须**按 `## 用户自带 spec 审计` 审一遍——绝不照单全收 |

五种模式共享同一份下游契约：`docs/specs/<topic>/` 下的 `spec.md` + `validation-contract.md` 一对文件。

## 流程

```
A. 调研   →  B. 定方向、定切分  →  C. 落到文件   →  D. 闸门与交接
```

### Phase A — 调研

**A1. 预研 + 摄入 + 审计。**
在问任何澄清问题之前：

- 按这个优先级读仓库入口：先 `AGENTS.md` 和 `CLAUDE.md`（面向 agent 的事实源），再相关的 `docs/` 子目录，再用 `git log` 看近期 commit。只有当 `AGENTS.md` 和 `CLAUDE.md` 都不存在时才读 `README.md`（README 面向人类，可能带宣传性质，或相对 agent 契约已经过时）。
- 如果用户给了文件路径 / commit / issue 编号，*把它们打开*——不要转述
- 如果输入属于模式 2–4（HTML / PRD / Figma），把关键可见元素抽取进一份草稿 `## Findings` 段
- 如果输入是模式 5（用户自带 spec），跑下面的审计清单；任何缺失项都变成 A2 里的一个 Q
- 例外：只有当用户的消息同时明确给出目标文件路径*和*精确的改动表面时，才跳过 A1。即便如此也要记一句"因为用户给了 X，跳过预研"，让这个决定可追溯。

**A1.5. 规模检查。**
估算这件事是否需要拆分（见 `## 拆分规模闸门`）。任一信号触发，就在 Phase B 走 B0。

**A2. Q+GUESS 澄清循环。**
- 每轮通过 `AskUserQuestion` / `request_user_input` 只问一个问题
- 每个问题都带一个假设 + 置信度（例："我猜是 X，~60% 把握"）
- 在预测置信度约 95% 处停下——**不要**硬冲 100%
- 最多约 10 轮；若置信度仍未收敛，退回去问用户：是要拆分（B0），还是这个需求本身需要分成多个会话来做

**A3. 6 行复述。**
- 把澄清后的需求压缩到 ≤ 6 行
- 进 Phase B 之前要拿到明确的"是"；不要从沉默或话题延续推断同意

### Phase B — 定方向、定切分

**B0. 拆分（仅当 A1.5 触发）。** 用下面的决策树选一条切分轴，产出子规范列表和一份 `umbrella.md`。

**B1. 给 2–3 个候选方案。** 说清权衡并推荐一个。推荐项放最前；备选项是留给用户改方向用的。

**B2. 分节呈现。** 设计的每个主要章节（架构、用户流程、验证表面、下游影响）都设一个中途的用户确认节拍。不要一次性把整个 What 倒出来。

### Phase C — 落到文件

**语言规则（适用于 C1/C2/C2.5 全部）**：每个模板里的 **section 标题**都是双语的（英文锚点 + 中文提示），必须逐字保留——`test-designer` 和 `deep-review` 的 `spec-conformance` 审查者会 grep 英文锚点，所以不能把它们翻译掉。`validation-contract.md` 里的**结构关键字**（`VAL-XXX-NNN`、`Behavior`、`Tool`、`Evidence`、Tool 类别名）同样保持英文。**所有正文内容**——Why / Findings / What 正文、VAL 的 Behavior + Evidence 描述、切分轴理由、Open questions 等——必须用本次对话所用的语言来写。中文对话→正文写中文；英文对话→英文。同一段落里不要中英文混写。

**C1.** 按 `references/spec-template.md` 撰写 `docs/specs/<topic>/spec.md`。

**C2.** 按 `references/validation-contract-template.md` 撰写 `docs/specs/<topic>/validation-contract.md`。反模式检查：每条 VAL 只说*什么*算通过，不说*怎么*测——后者是 `test-designer` 的活。用 A1 调研结果填 `## Toolchain` 表（仓库里每个类别对应的具体工具），把工具链调研结论往下游传递，省得下游重新发现。

**C2.5.** 若 B0 触发了拆分，按 `references/umbrella-template.md` 撰写 `docs/specs/<topic>/umbrella.md`。

### Phase D — 闸门与交接

**D1. 交接审查。** 从消费方（test-designer / 规划者 / 一个月后的你）视角套用 `## 交接审查清单（D1）`。当场修问题——不要重跑前面的阶段。

**D1.5. 提供审查辅助（三选一）。** 用 `AskUserQuestion` / `request_user_input` 给出：
- (c) **跳过** — 直接进 D2。小规模 spec（≤ 5 条 VAL、单文件）的默认项。
- (a) **Playground** — 用 `document-critique` 模板派遣 `playground:playground`（Anthropic 官方插件）；把 spec.md + validation-contract.md（有 umbrella.md 也一并）作为输入传入。playground 插件没装就隐藏这一项。
- (b) **静态 HTML** — 生成一份自包含的 `docs/specs/<topic>/review.html`，渲染两份文档并带锚点 + 一张 VAL 表。执行 `open <file>.html`。无交互，不依赖 playground。

选项顺序必须是 `skip → playground → static HTML`。skip 故意放第一；小 spec 不该被推进工具化的繁文缛节。

如果用户选了 playground 并给出 reject / comment 反馈，解析它们，当场改，进 D2 前再跑一次 D1。

**D2. 明确同意闸门。** 把 spec 文件路径打印回给用户，等明确批准。不要因为沉默就开始 plan 或编码前准备。

**D3. 交接。** 套用 `CLAUDE.md` / `AGENTS.md` 里的规模判定：
- QDF 三条谓词全部成立（单模块、验收标准 ≤ 5、无跨边界接口）→ 跳过 plan，直接进编码前准备 / 建分支
- 否则 → 交接给用户选定的 plan 阶段工具（内置 Plan、`planning-with-files`、或用户选的任何下游规划 skill）。不要写死某个具体的 plan 阶段 skill 名；那个决定归工作流 CLAUDE.md / AGENTS.md 管。

## 用户自带 spec 审计

当用户说"这是我的 spec"，逐条核对下面每一项。任何缺失都变成 A2 里的一个 Q——不要照单全收。

1. **Why 清晰** — 动机能用一句话表达；若缺失，与用户协作补 1–3 句
2. **Findings 有据** — 有具体证据（文件路径、commit SHA、外链）；若只是空口断言，回仓库里挖，或向用户要来源
3. **Validation Contract 存在** — 有结构化的 `VAL-XXX-NNN` 断言或等价物；若只有散文，重构成 VAL 列表
4. **Out of scope 已标注** — 有明确的"本次不做"列表
5. **没有 How 泄漏** — 没有模块名、类名、签名、库选择；若有，标为越界并挪到 plan

## 模板

三份 Phase-C 输出模板各自存在本 skill 旁边的独立文件里：

| 输出文件 | 模板 | 何时用 |
|---|---|---|
| `docs/specs/<topic>/spec.md` | `references/spec-template.md` | 总是（Phase C1） |
| `docs/specs/<topic>/validation-contract.md` | `references/validation-contract-template.md` | 总是（Phase C2） |
| `docs/specs/<topic>/umbrella.md` | `references/umbrella-template.md` | 仅当 B0 触发拆分（Phase C2.5） |

写对应的 Phase-C 输出前，先读相关的模板文件。skill 正文保留*意图*（每一节是干什么的）；*形态*（确切的标题、占位符、表格布局、编号约定）以模板文件为准。把模板块复制进 `docs/specs/<topic>/<file>.md`，替换每个 `<占位符>`。

VAL 编号约定适用于所有写 VAL 的地方：`VAL-<CATEGORY>-<NNN>`。`CATEGORY` 是 3–5 个字母的大写标签（`WORK` / `DEP` / `UI` / `CLI` / …）。`NNN` 零填充。多条 VAL 共享同一领域时复用同一类别；不要跳号（跳号意味着删过断言，会破坏基于 grep 的可追溯性）。

## 拆分规模闸门

任一信号触发 B0：

- 预估 VAL 数量 > 20
- 触及模块 > 5
- 触及子系统 > 2（例：同时改 CLI + Web UI + 插件清单）
- UI 组件 > 10
- 用户明说"这大概 > 3000 行"

## 拆分决策树

按顺序走，第一个命中的胜出。这些轴特意与 `incremental-impl` 第 2 步的词汇对齐——spec 一旦选定一条轴，下游 plan 和 impl 沿用同名，不再重新决定。

1. **全新地（一个全新子系统）** → **Walking Skeleton**：先打通最薄的端到端路径，之后纵向加厚
2. **高风险 / 高未知的技术表面** → **By risk**：先攻最不确定的子规范，验证，再扩展
3. **跨模块、各模块形态相似的改动** → **Horizontal sweep**：一个模块一个子规范，串行
4. **对既有表面的原地迁移** → **Branch by Abstraction**：先引入抽象，在抽象之下替换实现
5. **兜底** → **Vertical slice**：按用户故事切

## 工具词汇表

VAL 的 `Tool` 字段必须从下面的**类别**里选——绝不写具体工具名（避免锁死实现）：

| Tool | 用于 |
|---|---|
| `unit-test` | 单元级逻辑 |
| `integration-test` | 单运行时内的跨模块 / 跨进程 |
| `e2e-browser` | 浏览器端到端（plan 时再定 Browser Use / Playwright / Chrome MCP） |
| `e2e-mobile` | 移动端 / 模拟器端到端（plan 时再定 Computer Use / XCUITest / Espresso） |
| `e2e-cli` | 对 CLI 的子进程黑盒测试 |
| `http-probe` | HTTP 请求 + 响应断言 |
| `repo-check` | 文件存在性 / 内容 / 权限 |
| `git-state` | Git 分支 / commit / 工作树状态 |
| `gh-state` | GitHub PR / Issue / Release 状态 |
| `lint` | 静态检查（eslint / tsc --noEmit / shellcheck 等） |
| `build` | 构建产物正确性（tsc / npm pack / 产物形态） |
| `manual` | 仅人工验证；必须写明"什么算通过" |

单条 VAL 的 `Tool` 字段保持是**类别**——这让它可 grep，也让断言与实现无关。每个类别对应的仓库**具体**工具（用哪个测试运行器、哪个浏览器驱动、哪条构建命令）是 A1 调研所得的事实，不是本功能的实现决策——在 `validation-contract.md` 的 `## Toolchain` 表里记**一次**，不要逐条 VAL 重复。这把工具链调研结论往下游传递，`test-designer` 无需重新推断就能瞄准正确的运行器 / 驱动（它仍会扫描既有测试来摸清 fixture 和命名约定），也解决类别内部的真实歧义（例：`e2e-browser` → Browser Use vs Playwright vs Chrome MCP，三者的证据形态不同）。只为契约里 VAL 实际用到的类别填 Toolchain 行。

## 交接审查清单（D1）

从下游消费方的位置看（test-designer、规划者、一个月后的你）。当场修——不要重做。

- [ ] 没有 TBD / TODO / 占位符
- [ ] Why 对一个零上下文的 agent 也读得懂
- [ ] 每条 VAL 的 Behavior 只有单一含义（不能出现两种实现都能自圆其说算通过）
- [ ] 没有 VAL 在说怎么测，只说什么算通过
- [ ] `validation-contract.md` 有一张 `## Toolchain` 表，覆盖其 VAL 用到的每个类别，每行点名一个 A1 调研中观察到的具体工具（仓库既有的测试设施，不是设计决策）
- [ ] Out of scope 覆盖了所有"看起来该包含"但其实不包含的东西
- [ ] What 与 VAL 之间没有矛盾
- [ ] Open questions 里只有刻意推迟给下游的决策，每条都有点名的归属（plan / impl）和写明的理由——没有未解决的需求歧义藏在里面
- [ ] 若已拆分，umbrella.md 不打开子规范也能给出完整概览

## 反模式

- ❌ 一轮问多个问题——消耗用户耐心，还把不同维度搅在一起
- ❌ 冲过 95% 置信度——边际上的那个问题会过度规定
- ❌ 把实现提示写进 `spec.md`（"我们会在 `utils.ts` 加一个 `validateX` 函数"）
- ❌ 描述测试机制的 VAL（"调用 `assertEquals(parse(s), …)`"）——那属于 test-designer
- ❌ 为显得周全而凑 VAL 数量——少而规整的 VAL 胜过多而含糊的
- ❌ 在单条 VAL 的 `Tool` 字段里写具体工具名——具体工具只在 `## Toolchain` 表里记一次
- ❌ 为填满章节而编造假的 Open questions——对一份澄清充分的 spec 来说，"无"是合法且常见的结果
- ❌ 把未解决的需求歧义倒进 Open questions，而不在 A2 循环里解决——Open questions 只装刻意推迟给下游的决策
- ❌ 不跑审计就接受用户自带的 spec
- ❌ 静默跳过 D1.5——审查选项必须呈现出来；之后用户可以自己选跳过
- ❌ 为显得有条理而把小 spec 拆成子规范——规模闸门才是闸门
- ❌ 把 Figma URL 当成可直接读取的；永远要导出的 PNG / 截图

## 和其他 skill 的关系

- `test-designer` — 把 `validation-contract.md` 作为主输入消费（`spec.md` 正文作为兜底上下文）；写失败测试
- `incremental-impl` — 沿用 B0 选定的同一套切分轴词汇；把 spec + plan 带进逐切片执行
- plan 阶段工具（内置 Plan、`planning-with-files`、或工作流 CLAUDE.md 点名的任何规划 skill）——当规模判定走完整 plan 路径时，是 D3 的下游
- `deep-review` 的 `spec-conformance` 审查者 — 拿 PR diff 对照 VAL 列表验证；finding 标注 `VAL-XXX-NNN`
- `playground:playground`（Anthropic 官方，软依赖）— 通过 `document-critique` 模板做 D1.5 审查辅助
- `goalify` — 本 skill 的 spec 一旦定稿，`goalify` 消费 spec.md + validation-contract.md，把长程执行打包成一段 `/goal` 脚本（自主连续运行，例如"把这个推到 PR Ready"）。属于流程外：这里不自动调用；用户想无人值守地执行一个已澄清的需求时才自己调用
