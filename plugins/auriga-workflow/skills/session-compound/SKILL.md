---
name: session-compound
description: 当用户要求复盘、总结、沉淀、整理这次会话、wrap up this session、extract takeaways from this session，或提取会话中的可复用经验时使用；产出一份可交互的 HTML 会话报告。
---

# Session Compound

把单次 CLI 会话压缩成一份可离线打开的 HTML 报告（写到 `/tmp`，不落进项目仓库）。报告分四个 tab：

- **Narrative** — 这次做了什么（时间线 + 关键反馈时刻 + Agent 撰写的叙事摘要）
- **Health** — token / cache / 工具用量诊断
- **评估** — 中性工作流事实面板 + 独立子代理的指令遵循 / skill 召回 / 逐 skill 执行评估 finding
- **Compound** — playground：左侧候选条目列表（可勾选 + 行内编辑），右侧实时合成 markdown，底部一键复制「提示词」，粘回 Claude / Codex 让 agent 按规则落库

## 何时使用

- 用户要求「复盘 / 总结 / 沉淀 / wrap up」当前会话
- 用户显式调用 `/session-compound` 或类似命令
- 用户想从这次会话里提取 AGENTS.md / `docs/rules/` 增补、可复用的现成 skill、或可抽象的 skill 缺口

**不要**用于跨会话分析——那是 `session-report` 插件的范围（最近 7 天 × 全部项目）。

---

## 工作流

### 步骤 1：跑 analyzer

先判断 CLI 身份（读环境变量 `CLAUDE_CODE_SESSION_ID` 或 `CODEX_THREAD_ID`，命中哪个就是哪一边），再执行对应分支。

#### Claude Code 分支

```sh
node <skill-dir>/analyzers/claude-code.mjs > /tmp/session-compound.json
```

`<skill-dir>` 是这份 SKILL.md 所在目录的绝对路径。

脚本会自动通过 `CLAUDE_CODE_SESSION_ID` 环境变量 + 当前 cwd 推断出 `~/.claude/projects/<cwd-slug>/<session-id>.jsonl`。可选 override：
- `--session-id <uuid>` — 指定会话 id
- `--project-slug <slug>` — 指定 cwd slug（覆盖自动推断）
- `--file <abs-path>` — 直接指定 JSONL 文件路径

运行时要求 Node 18+（脚本用 `node:fs` / `readline` 命名空间 import）。

#### Codex 分支

```sh
node <skill-dir>/analyzers/codex.mjs > /tmp/session-compound.json
```

脚本会从 `CODEX_THREAD_ID` 环境变量读 thread id，然后在 `~/.codex/sessions/**/rollout-*-<thread-id>.jsonl`（以及 `~/.codex/archived_sessions/**/` fallback）下定位文件。可选 override：
- `--thread-id <uuid>` — 指定 thread id（`--session-id` 是其别名）
- `--file <abs-path>` — 直接指定 rollout JSONL 文件路径

#### 通用约束

如果 analyzer 非零退出，读 stderr、对症修正（错路径、缺会话、文件未生成等）后重跑。**未拿到 JSON 不要继续后续步骤**。

### 步骤 2：读 JSON 摘要

读 `/tmp/session-compound.json`。重点扫这些字段：

- `session` — id / cwd / 时长 / 模型 / git；`recorded_turn_ms` 是日志里 `turn_duration` 条目记录的真实 turn 墙钟时长之和（存在时比 `active_ms` 间隙估算更准）
- `narrative.task_title` — 会话标题（Claude 端取自 `aiTitle`，缺失为空串；Codex 端取自首条用户消息），报告 hero 标题用它
- `narrative.human_turns` — 用户每个 turn 的摘要 + token + 触发的工具
- `narrative.feedback_moments` — 检测到的用户纠正 / 方向收缩瞬间（含「先不动 / 不着急 / 微优化」这类改向信号；纯疑问句不计入）
- `narrative.away_summaries` — Claude 在用户离开时写的自然语言摘要（来自 `away_summary` 条目，叙事原料）
- `health.tokens` / `health.cache_hit_rate` / `health.context_window_used_pct`
- `health.tools` / `health.subagents` / `health.skills`（两端都有 skills：Claude 端来自 `Skill` 工具调用，Codex 端来自 `<skill><name>` 块解析；subagents 含 Claude `Agent` / Codex `spawn_agent` 调用）
- `health.skill_attribution` — 每个 skill 驱动了多少次工具调用（工作量，与 `skills` 的调用次数语义不同；目前 Claude 端有，来自 `attributionSkill`）
- `health.prs` — 本次会话引用的 PR 列表（去重，`{number,url,repository}`；目前 Claude 端有，来自 `pr-link`）
- `health.tool_failures` — 失败的工具调用（`{call_id,name,preview}`，两端同形）
- `health.expensive_turns` — token 消耗最高的 turn
- `health.waste_signals` — 重复读同文件、低 cache 命中、API 错误 / 重试等浪费信号
- `health.skill_catalog` — 本机可用的全部已安装 skill 目录（`{name, description, editable}`，按 name 去重折叠插件缓存多版本；`editable` 表示该 skill 源在当前仓库内、可就地优化）。**指令遵循 & skill 召回评估的输入**
- `health.workflow_rules` — 从仓库 AGENTS.md / CLAUDE.md 受管区块解析出的工作流规则（`{n, text}`）；无受管区块为空数组
- `health.workflow_signals` — **中性事实包，不含任何判决**（`{git_branch, on_main, had_code_edit, first_edit_ts, prs_count, skills_invoked_count}`）。机械层只提取事实；指令遵循 / 召回 / skill 执行的判断**全部交评估 subagent**
- `raw_for_compound` — 用来写候选条目的原材料（含 `agent_invocations`、`tool_failures`）

两套 analyzer 输出的**核心字段**（`session.{id,cwd,duration_ms,model,git,recorded_turn_ms}` / `narrative.{task_title,human_turns,feedback_moments,away_summaries}` / `health.{tokens,cache_hit_rate,tools,subagents,skills,skill_attribution,prs,tool_failures,expensive_turns,waste_signals,skill_catalog,workflow_rules,workflow_signals}` / `raw_for_compound.{feedback_moments,repeated_reads,agent_invocations,tool_failures}`）一致，模板按这些字段渲染。除此之外两侧各有 CLI-specific 扩展字段，Codex 多 `health.{compaction_count, turn_aborted_count, patch_apply, mcp_tool_call_count, custom_tool_call_count, web_search_count, tool_search_count, image_generation_count, context_window, reasoning_output_ratio}` 与 `narrative.{task_conclusion, task_completed, task_duration_ms, time_to_first_token_ms}`；Claude 多 `health.{api_calls, cache_breaks}`。注意 `skill_attribution` / `prs` / `away_summaries` 目前仅 Claude 端有数据（Codex 日志无等价信号），缺失侧为空集合。`skill_catalog` / `workflow_rules` / `workflow_signals` 两端都有，各从本 CLI 的 skill 根目录与会话 cwd 的 AGENTS.md 构建（`workflow_signals` 是中性事实，不下判决）。模板已按 CLI 分支处理这些差异。

### 步骤 3：复制模板到输出文件

报告是一次性产物——写到 `/tmp`，不要放进项目目录，避免被 git 跟踪 / 误提交进用户仓库。

```sh
cp <skill-dir>/template.html /tmp/session-compound-$(date +%Y%m%d-%H%M).html
```

### 步骤 4：基于数据预查 ecosystem skill

在写 candidates 之前，**先**从本次 session 数据里识别 3–5 个可能的 skill 缺口模式（重复读同一份文档、反复出现的工具组合 + 失败、长 turn 里出现的固定多步流程关键词），为每个模式生成一个搜索 query，然后跑：

```sh
npx skills find "<query>" 2>&1 | head -30
```

每个 query 抽 top-3 结果（name / install_count / source URL）。

依据返回结果做出 verdict：
- **`recommend-install`** — 找到一个或多个高 install 的现成 skill，复用即可（不用再写 `skill-gap` candidate）
- **`partial-match`** — 有相关 skill 但语义不完全匹配（在 `skill-gap` candidate 的 find-skills 检查字段里引用这些结果，避免下游 agent 重跑）
- **`no-match`** — 完全没有可复用的，写 `skill-gap` candidate 自创

这一步的输出**直接进入下一步 5d 的 candidates 数组**，但需要一个特殊 type `existing-skill`——任何 `recommend-install` verdict 的结果都应该作为一个 `existing-skill` candidate 加进数组（用户在浏览器里勾选 → 复制 prompt 后下游 agent 会自动跑 `npx skills add` 安装）。

### 步骤 4.5：派遣独立 subagent 做指令遵循 & skill 执行评估

产出 `eval-findings`（指令遵循 / 召回 / 逐 skill 执行评估）→ 步骤 5e 注入报告、并可喂 5d 的 skill-body 候选。**完整派遣协议（输入清单、输出 schema、skill-body 落点规则）见 `references/eval-dispatch.md`——派遣前读它。** 这里只列不可省的硬约束：

- **必须用独立、零上下文继承（fresh context）的 subagent**：被评估的会话正是主 Agent 自己跑的，自评有系统性偏差（纪律同 `deep-review` / `test-designer`：新会话、不 resume、不把当前对话历史复制进子代理）。
- **范围**：召回 / 指令遵循覆盖 `skill_catalog` 里**全部已安装 skill** 与全部 `workflow_rules`；逐 skill 执行 eval **仅覆盖本会话真正调用过 / 跑过的 skill**（`health.skills` 里的）。机械层只给 `workflow_signals` 中性事实（分支 / 是否在 main / 有无编辑 / PR / skill 调用数），**所有判断由 subagent 做**——包括"在 main 上编辑了"这类原来机械层下的判决。
- **输出**：finding 数组 `{kind, severity, confidence, text, skill?}`，每条带 `severity` + `confidence`，**不按重要性预过滤**（全部 in-scope finding 都报告，过滤交给人）。

### 步骤 5：注入数据 + 撰写 Agent 填空段（**用 Edit，不用 Write**——必须保留模板的 JS/CSS）

需要做 5 处编辑：

#### 5a. 替换 `<script id="report-data">` 的内容

把这块的内容替换成步骤 1 产出的完整 JSON：

```html
<script id="report-data" type="application/json">
{ "cli": "claude-code", ... }
</script>
```

模板的 JS 会自动从这个 JSON 渲染 hero、所有表格、bar、时间线。

#### 5b. 填 `<!-- AGENT: narrative-summary -->` 块

把这个 div：
```html
<div id="narrative-summary" class="empty-hint">No summary yet — ...</div>
```
替换为：
```html
<div id="narrative-summary">这里写 ≤3 句话的会话叙事摘要</div>
```

摘要要求：**事实性**。引用真实的 turn 内容、真实的决策、真实的工具模式——不要套话。

#### 5c. 填 `<!-- AGENT: anomalies -->` 块

把 `<div class="takes" id="anomalies">...</div>` 内的占位 hint 替换为 **3–5 张 take 卡片**。数值尽量用「占总 token 的 %」表达。精确 markup：

```html
<div class="take bad"><div class="fig">62%</div><div class="txt">Turn <b>#4</b> 一个 prompt 消耗了 62% 的总 token</div></div>
```

class 含义：
- `.take.bad` — 浪费 / 红
- `.take.good` — 健康信号 / 绿
- `.take.warn` — 警示 / 黄
- `.take.info` — 中性事实 / 蓝

`.fig` 是一个短数字（%、计数、或 `12×` 倍数）。`.txt` 是一句白话，主语用 `<b>` 包起来。

可发掘的角度：
- 单个 turn 占了不成比例的份额
- Cache hit < 85%（Claude）或 reasoning 占 output > 50%（Codex）
- 反复读同一个文件
- 子 agent 调用没有输出格式约束
- Context window 接近上限（Codex）

#### 5d. 填 `<script id="candidates">` 数组（**本 skill 的核心价值**）

把那个 script tag 里的 `[]` 替换为候选条目数组。每条候选都属于以下三类之一——**只有这三类**：

1. **`existing-skill`** — 步骤 4 预查命中的现成 ecosystem skill，一条 `npx skills add` 命令即可装上
2. **`agent-md`** — 写入 AGENTS.md 体系（根 AGENTS.md / `docs/rules/<topic>.md` + 索引 / 子目录 AGENTS.md，三种 target 任选其一）
3. **`skill-gap`** — 多步骤可重复模式，ecosystem 没现成可复用，值得抽象成新 skill

Schema：
```json
[
  {
    "name": "kebab-case-name",
    "type": "existing-skill | agent-md | skill-gap",
    "body": "条目正文 markdown——直接落库的文本（或对 existing-skill 来说，含安装命令）",
    "default_selected": true
  }
]
```

##### type 语义

- **`existing-skill`** — 步骤 4 预查时找到的现成 ecosystem skill，verdict 为 `recommend-install`。正文模板：
  ```
  **来源**: <owner/repo@skill> · <NK installs> · <skills.sh URL>
  **解决的本会话问题**: <为什么这个 skill 适合本会话出现的某个模式>
  **安装命令**: `npx -y skills add <owner/repo@skill> -a codex claude-code -y`
  ```
  安装命令拆解：
  - `npx -y` — `-y` 在前面，让 npx 自动升级 / 拉包，跳过"need to install? (y/N)"询问
  - `-a codex claude-code` — `skills add` 的 `-a` 收集后续所有非 flag 参数，所以**空格分隔**多个 agent。本仓库只针对这两个 agent
  - 末尾 `-y` — `skills add` 自身的"yes to confirmation prompts"
  勾选后会进入合成的 prompt，下游 agent 会自动执行 `npx skills add` 安装

- **`agent-md`** — 沉淀到 AGENTS.md 体系。**target 由本 skill 自己判断并在候选里给出推荐，不要把选择甩给用户或下游再决策一轮。**

  选 target 前**先勘察当前工程已有的指令组织规范**——别套用通用默认：
  1. 读根 `AGENTS.md` / `CLAUDE.md`：它通常是**入口 + 索引**，靠多级文件做渐进式披露（根文件保持精简、详细规范拆到 `docs/` 专题文件 / 子目录指令文件）。**不要往根 AGENTS.md 堆内容**——顺着它已有的分层结构走。
  2. 看 `docs/rules/` 等是否已有覆盖该领域的专题文件；有就**在那份文件里扩写**，而不是新建一份平行的。
  3. 看工程**现有 skill** 是否已经覆盖这个模式——若只是某个 skill 的指引不到位 / 缺一条规则，**首选在那个 skill 的 `SKILL.md` 里就地优化**（target 指向该 skill 文件），比新增 AGENTS.md 段落或新建 skill 都更轻、更聚合。

  按下表选 target（优先复用 / 扩写既有文件，最后才考虑新建）：

  | 经验范围 | target | 何时选 |
  |---|---|---|
  | **某个现有 skill 的指引可改进** | 那个 skill 的 `SKILL.md`（就地优化） | 模式已被某 skill 覆盖，只是规则缺一条 / 触发不准——最聚合，优先选 |
  | 现有 `docs/rules/<topic>.md` 已覆盖该领域 | 在那份文件里扩写（不新建平行文件） | 已有专题文件，顺着它加 |
  | 跨整个仓库 / 跨语言 / 工作流级（短规则） | 根 `AGENTS.md`（`CLAUDE.md` 是软链则只写一处） | 短、所有未来会话都该看，且根文件没有更合适的下级归宿 |
  | 跨整个仓库但**内容较长**（>10 行 / 表格 / 代码） | 新建 `docs/rules/<topic>.md` + 根 `AGENTS.md` 加一行索引 | 写进根 AGENTS.md 会让它膨胀，破坏渐进式披露 |
  | 仅针对某个独立子目录（plugin / package / service） | 那个子目录的 `AGENTS.md`（不存在就新建） | 经验只在该子目录上下文生效，写到根会污染全局 |

  正文模板（target 一行必须给出**具体推荐落点** + 是「就地优化既有文件」还是「新建」）：
  ```
  **target**: <具体路径>（如 `<skill>/SKILL.md` 就地优化 / 现有 `docs/rules/<topic>.md` 扩写 / 根 `AGENTS.md` / 新建 `docs/rules/<topic>.md` + 索引 / `<subdir>/AGENTS.md`）
  **落点理由**: <一句话：为什么是这个文件——已有 X 覆盖该领域 / 顺着现有分层 / 根文件无更合适下级>
  **要写入的内容**:
  > <逐字给出要追加 / 修改的段落，下游 agent 复制粘贴即可>
  **索引行**（仅当新建 `docs/rules/<topic>.md` 时填）:
  > - [<title>](docs/rules/<topic>.md) — <一句 hook>
  ```

- **`skill-gap`** — 这次会话里出现了**多步骤可重复模式**，值得抽象成一个新 skill。正文必含：触发短语 / find-skills 检查结果 / imperative 3–5 步流程 / bundled resources / 验证方式（见下方模板）

##### 决策表

| 经验形态 | 沉淀路径 |
|---|---|
| ecosystem 已经有匹配 skill | `existing-skill`（最廉价） |
| **工程现有 skill 已覆盖、只是指引不到位** | `agent-md` → 就地优化那个 skill 的 `SKILL.md`（最聚合，优先） |
| 现有 `docs/rules/<topic>.md` 已覆盖该领域 | `agent-md` → 在那份文件里扩写 |
| 跨会话的工作流约束 / 流程规则（短文本） | `agent-md` → 根 AGENTS.md（无更合适下级时） |
| 跨会话的长文约定（>10 行 / 表格 / 代码） | `agent-md` → 新建 `docs/rules/<topic>.md` + 根 AGENTS.md 索引 |
| 只影响某个子目录的约定 | `agent-md` → `<subdir>/AGENTS.md` |
| **多步骤、可重复、有触发条件、需要脚本辅助** | `skill-gap`（新 skill） |
| 一次性 / 上游工具 issue / 不在用户控制范围内 | **不要写候选** |

落点优先级（从最聚合到最重）：**就地优化现有 skill / 扩写现有 docs** → 现有分层里的合适位置 → 根 AGENTS.md 短规则 → 新建专题文件 → 新建 skill。先复用既有结构，最后才新建。

##### `skill-gap` 候选必须自证「值得做成 skill」

参考 `skill-development` skill 的判断框架，只有同时满足以下 5 条 hard gate 才写 `skill-gap`：

1. **多步骤**：能拆成 ≥3 步、步骤间有顺序 / 依赖
2. **可重复**：未来会话很可能再次发生（一次性的不写候选）
3. **能写出第三人称 + 具体触发短语**——这是 skill description 的硬规范，也是隐式 sanity check：写不出「This skill should be used when the user asks to "X", "Y"」就说明触发场景不清晰，不值得做 skill
4. **可绑定资源**：需要 `scripts/`（deterministic 脚本）/ `references/`（按需加载的文档）/ `assets/`（输出模板）。纯文字规则放 `agent-md` 更轻
5. **ecosystem 里没有现成 skill 能复用**——产出候选前用 `npx skills find <query>` 查过（这是 `find-skills` skill 的核心动作）

反例（这些不该写成 `skill-gap`）：
- "用户偏好先写 spec 再实现" → 单一规则 → 写成 `agent-md`（根 AGENTS.md 一行）
- "lingolens 项目里题型组件命名是 *Question 不是 *Player" → 子目录范围约定 → `agent-md`（`<subdir>/AGENTS.md`）

正例（这些可以做 skill）：
- "e2e 验证前先检查 dev server / 数据库 / 依赖状态机" → 多步骤检查清单 + 可绑定脚本 → `skill-gap`
- "添加新题型组件时：先建 `*Question.tsx`，再加单测，再注册到 router，再写 mobile preview" → 4 步固定流程 → `skill-gap`

`skill-gap` 正文模板（agent 撰写候选时按此填，覆盖全部 5 条 hard gate）：

```markdown
**触发短语**（第三人称 + 具体短语，自证 gate #3）：
> This skill should be used when the user asks to "<具体短语 1>", "<具体短语 2>", or mentions <场景>.

**find-skills 检查**（自证 gate #5，用 `npx skills find <query>`）：
- 已搜：<keyword>
- 结果：无现成可复用 / 找到 `<owner/repo@skill>` 但 <理由不合适>

**3–5 步流程**（imperative，verb-first；遵循 skill-development 写作规范）：
1. Verb …
2. Verb …
3. Verb …

**Bundled resources**（自证 gate #4）：
- `scripts/<name>.sh` — 做 <X>
- `references/<name>.md` — 提供 <Y> 的细节
- `assets/<name>/` — <Z> 模板（可选）

**验证**：跑 `<command>` 应该看到 <expected>；失败时检查 <fallback>。

**为什么不是 `agent-md`**：本条满足 5 条 hard gate（多步骤 + 可重复 + 触发清晰 + 资源可绑定 + ecosystem 没现成的）；写成 AGENTS.md 段落无法承载脚本和多步骤逻辑。
```

下游 agent 拿到这种 `skill-gap` 候选后，应走 `skill-creator` 的完整流程（capture-intent → interview → draft → eval → iterate），**不要直接现场写 SKILL.md**——`skill-creator` 会确保 description 触发率、imperative 风格、progressive disclosure（SKILL.md ≤2k 词，详情拆 references/）这些 skill-development 规范都被遵守。

##### 原材料

来自 JSON 的 `raw_for_compound`：feedback 瞬间、重复读文件、子 agent 调用、turn 时间线。**`narrative.feedback_moments` 里的用户反馈片段（≤200 字符摘要）** 通常是 `agent-md` 候选的起点——如果某条反馈反复出现，就是一条工作流级规则。`human_turns` 里反复出现的工具组合 + 失败模式则是 `skill-gap` 的线索。

**步骤 4.5 的 `eval-findings` 也是候选原材料**——尤其 `kind: skill-eval` 的 finding（某 skill 执行欠佳）：

- 当 finding 指向**本仓库可编辑的** SKILL.md（`skill_catalog` 里 `editable: true` 的那条），且问题是 skill body 写得不到位时，产出一个 `agent-md` 候选，**target 直接指向那份 in-repo SKILL.md** 做就地优化（与决策表「工程现有 skill 已覆盖、只是指引不到位」一致）。这正是"对抗一味叠加内容"的入口：先判断是不是 body 本身没写好，而不是默认加规则。
- 对**外部 / cached、不可编辑**（`editable: false`）的 skill，**不要产出编辑候选**——它的源在插件缓存里，改了下次更新即被覆盖；只在报告「评估」tab 的「指令遵循与 skill 评估」区块里报告它的表现即可。

##### 质量标准

宁少勿滥。**3–8 条高价值候选** 胜过 20 条平庸候选。明显的别写——只保留**未来某次会话**会真正用到的。`skill-gap` 的标准最高，一次产出 0–2 条就够了。

#### 5e. 填 `<script id="eval-findings">` 数组

把步骤 4.5 独立 subagent 返回的 finding 数组写进 `<script id="eval-findings">` 块（默认是 `[]`）：

```html
<script id="eval-findings" type="application/json">
[{ "kind": "recall", "severity": "high", "confidence": "med", "text": "...", "skill": "..." }]
</script>
```

模板会把它渲染进「评估」tab 的「指令遵循与 skill 评估」区块；数组为空则该区块自动隐藏（不显示空壳）。**原样注入 subagent 的输出，不要在这里二次过滤或改写措辞**——预过滤已在派遣纪律里禁止。

### 步骤 6：打开报告

替用户打开报告，并把 `/tmp` 下的绝对路径一并报告。**优先用内置浏览器**打开 `file://<绝对路径>`——不同 Agent 的内置浏览器工具不一样，用当前 Agent 可用的那个；没有内置浏览器时回退到系统命令（macOS `open <path>` / Linux `xdg-open <path>`）。**不要**预渲染候选（勾选交给用户）、**不要**把报告复制进项目仓库（它是一次性产物）。用户在 Compound tab 勾选、行内编辑措辞、点 Copy，把生成的提示词粘回 Agent 那一句话就完成落库。

---

## 备注

- 写 `skill-gap` / `agent-md` 类候选前，强烈建议先用 `find-skills` 跑一次 ecosystem 搜索（`npx skills find <query>`，候选 gate #5）；新建 skill 时按 skill-development 规范（第三人称 description、imperative body、progressive disclosure：SKILL.md ≤2k 词 + references/ + scripts/ + assets/、validation checklist）撰写，`skill-gap` body 模板的每个字段都对应该规范的某条要求
- 模板 JS 只读三个 script block：`<script id="report-data">`（analyzer 输出）、`<script id="candidates">`（你撰写的候选）、`<script id="eval-findings">`（步骤 4.5 独立 subagent 的评估 finding）。其余渲染都靠这三个 blob 驱动。**不要改 HTML 结构**。
- Compound tab 是这个 skill 区别于普通 session report 的核心价值——把「AI 提取候选 → 人审核 → 落入 AGENTS.md / 装 skill / 新建 skill」做成了无摩擦闭环。
- Codex 有原生 sub-agent（`spawn_agent` / `wait_agent` / `close_agent` 工具调用），analyzer 会把 `agent_type` 汇总到 `health.subagents`。Codex 也支持 skill（`$skill-name` 命令，日志里以 `<skill><name>` 块注入），analyzer 解析后填进 `health.skills`，与 Claude 端同形。
- Codex 的 `health` 段额外含：`compaction_count`（自动压缩次数）、`patch_apply.{success, failure}`（代码修改成败比）、`mcp_tool_call_count` / `custom_tool_call_count` / `web_search_count` / `tool_search_count` / `image_generation_count` 等专项工具计数，以及 `context_window`（模型窗口大小）。
- 如果 `raw_for_compound` 很稀（会话短、没反馈瞬间），宁可产出 1–3 条高质量 `skill-gap`，也不要硬凑 5 条。
- 如果 JSON 超过 2MB，截断 `narrative.human_turns` 和 `health.expensive_turns` 到前 50 条再嵌入（analyzer 通常已经控制了，但要检查）。
