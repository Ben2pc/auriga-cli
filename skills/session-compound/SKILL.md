---
name: session-compound
description: This skill should be used when the user asks to "复盘 / 总结 / 沉淀 / wrap up this session", "整理一下这次会话", or "extract takeaways from this session". It compounds a single Claude Code or Codex CLI session into a self-contained interactive HTML report (narrative timeline + token / cache / tool health + a playground panel with checkable candidate items for ecosystem-skill installs / AGENTS.md edits / new-skill gaps) so the user can review, tick, and copy back a prompt that lands each item in the right place.
---

# Session Compound

把单次 CLI 会话压缩成一份保存在当前目录下、可离线打开的 HTML 报告。报告分三个 tab：

- **Narrative** — 这次做了什么（时间线 + 关键反馈时刻 + Agent 撰写的叙事摘要）
- **Health** — token / cache / 工具用量诊断
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

- `session` — id / cwd / 时长 / 模型 / git
- `narrative.human_turns` — 用户每个 turn 的摘要 + token + 触发的工具
- `narrative.feedback_moments` — 检测到的用户纠正/反馈瞬间
- `health.tokens` / `health.cache_hit_rate` / `health.context_window_used_pct`
- `health.tools` / `health.subagents` / `health.skills`（Claude 端通常 subagents + skills 都会有，Codex 端 skills 永远为空、subagents 含 `spawn_agent` 调用）
- `health.expensive_turns` — token 消耗最高的 turn
- `health.waste_signals` — 重复读同文件、低 cache 命中等浪费信号
- `raw_for_compound` — 用来写候选条目的原材料（含 `agent_invocations`）

两套 analyzer 输出的**核心字段**（`session.{id,cwd,duration_ms,model,git}` / `narrative.{human_turns,feedback_moments}` / `health.{tokens,cache_hit_rate,tools,subagents,skills,expensive_turns,waste_signals}` / `raw_for_compound.{feedback_moments,repeated_reads,agent_invocations}`）一致，模板按这些字段渲染。除此之外两侧各有 CLI-specific 扩展字段，Codex 多 `health.{compaction_count, turn_aborted_count, patch_apply, mcp_tool_call_count, custom_tool_call_count, web_search_count, tool_search_count, image_generation_count, context_window, reasoning_output_ratio}` 与 `narrative.{task_title, task_conclusion, task_completed, task_duration_ms, time_to_first_token_ms}`；Claude 多 `health.{api_calls, cache_breaks}`。模板已按 CLI 分支处理这些差异。

### 步骤 3：复制模板到输出文件

```sh
cp <skill-dir>/template.html ./session-compound-$(date +%Y%m%d-%H%M).html
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

### 步骤 5：注入数据 + 撰写 Agent 填空段（**用 Edit，不用 Write**——必须保留模板的 JS/CSS）

需要做 4 处编辑：

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

- **`agent-md`** — 沉淀到 AGENTS.md 体系。**根据经验的范围选 target**，正文第一行就声明 target，方便下游 agent 直接落地：

  | 经验范围 | target | 何时选 |
  |---|---|---|
  | 跨整个仓库 / 跨语言 / 工作流级 | 根 `AGENTS.md`（如果 `CLAUDE.md` 是软链则只写一处） | 短规则、所有未来会话都该看 |
  | 跨整个仓库但**内容较长**（>10 行 / 有表格 / 有示例代码） | `docs/rules/<topic>.md` 新建一份，再在根 `AGENTS.md` 加一行索引 | 写在根 AGENTS.md 会让那份文件膨胀 |
  | 仅针对某个独立子目录（一个 plugin、一个 package、一个 service） | 那个子目录的 `AGENTS.md`（不存在就新建） | 经验只在该子目录上下文里生效，写到根 AGENTS.md 会污染全局 |

  正文模板：
  ```
  **target**: <path>（如 `AGENTS.md` / `docs/rules/<topic>.md` + 索引到根 AGENTS.md / `<subdir>/AGENTS.md`）
  **要写入的内容**:
  > <逐字给出要追加 / 修改的段落，下游 agent 复制粘贴即可>
  **索引行**（仅当 target 是 `docs/rules/<topic>.md` 时填）:
  > - [<title>](docs/rules/<topic>.md) — <一句 hook>
  ```

- **`skill-gap`** — 这次会话里出现了**多步骤可重复模式**，值得抽象成一个新 skill。正文必含：触发短语 / find-skills 检查结果 / imperative 3–5 步流程 / bundled resources / 验证方式（见下方模板）

##### 决策表

| 经验形态 | 沉淀路径 |
|---|---|
| ecosystem 已经有匹配 skill | `existing-skill`（最廉价） |
| 跨会话的工作流约束 / 流程规则（短文本） | `agent-md` → 根 AGENTS.md |
| 跨会话的长文约定（>10 行 / 表格 / 代码） | `agent-md` → `docs/rules/<topic>.md` + 根 AGENTS.md 索引 |
| 只影响某个子目录的约定 | `agent-md` → `<subdir>/AGENTS.md` |
| **多步骤、可重复、有触发条件、需要脚本辅助** | `skill-gap`（新 skill） |
| 一次性 / 上游工具 issue / 不在用户控制范围内 | **不要写候选** |

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

##### 质量标准

宁少勿滥。**3–8 条高价值候选** 胜过 20 条平庸候选。明显的别写——只保留**未来某次会话**会真正用到的。`skill-gap` 的标准最高，一次产出 0–2 条就够了。

### 步骤 6：报告输出路径

把保存的绝对路径报告给用户。**不要**打开它、**不要**预渲染。用户自己打开、在 Compound tab 勾选、行内编辑措辞、点 Copy，把生成的提示词粘回 Claude / Codex 那一句话就完成落库。

---

## 备注

- 写 `skill-gap` / `agent-md` 类候选前，强烈建议先用 `find-skills` 跑一次 ecosystem 搜索（`npx skills find <query>`，候选 gate #5）；新建 skill 时按 skill-development 规范（第三人称 description、imperative body、progressive disclosure：SKILL.md ≤2k 词 + references/ + scripts/ + assets/、validation checklist）撰写，`skill-gap` body 模板的每个字段都对应该规范的某条要求
- 模板 JS 只读两个 script block：`<script id="report-data">`（analyzer 输出）和 `<script id="candidates">`（你撰写的候选）。其余渲染都靠这两个 blob 驱动。**不要改 HTML 结构**。
- Compound tab 是这个 skill 区别于普通 session report 的核心价值——把「AI 提取候选 → 人审核 → 落入 AGENTS.md / 装 skill / 新建 skill」做成了无摩擦闭环。
- Codex 有原生 sub-agent（`spawn_agent` / `wait_agent` / `close_agent` 工具调用），analyzer 会把 `agent_type` 汇总到 `health.subagents`。Codex 没有 skill 概念，模板会隐藏对应表格。
- Codex 的 `health` 段额外含：`compaction_count`（自动压缩次数）、`patch_apply.{success, failure}`（代码修改成败比）、`mcp_tool_call_count` / `custom_tool_call_count` / `web_search_count` / `tool_search_count` / `image_generation_count` 等专项工具计数，以及 `context_window`（模型窗口大小）。
- 如果 `raw_for_compound` 很稀（会话短、没反馈瞬间），宁可产出 1–3 条高质量 `skill-gap`，也不要硬凑 5 条。
- 如果 JSON 超过 2MB，截断 `narrative.human_turns` 和 `health.expensive_turns` 到前 50 条再嵌入（analyzer 通常已经控制了，但要检查）。
