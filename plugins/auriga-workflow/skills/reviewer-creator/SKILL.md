---
name: reviewer-creator
description: "当用户要求创建自定义审查者、添加项目专属审查者、扩展 deep-review，或调用 /reviewer-creator 时使用；在 docs/rules/review/ 下生成结构规范的审查者文件。"
---

# Reviewer Creator

为 `deep-review` 技能脚手架一个项目级自定义审查者文件。生成的文件位于 `docs/rules/review/<name>.md`，会在分派时被调度器自动发现（依据 `deep-review/SKILL.md` 第 2 步的发现规则）。

## When to use

- 用户想新增一个 11 位内置审查者未覆盖的项目专属审查关切（例如"迁移安全"、"特性标志清理"、"国际化键一致性"、"schema 版本兼容性"、"遥测命名"）
- 用户调用 `/reviewer-creator`
- 团队正在引入一项新约定，希望在拉取请求阶段强制执行

**两种定位（由 `Extends` 字段声明）：** 自定义审查者要么是 (a) **某个内置维度的项目专属补充 / 收窄**（`Extends: <内置名>`，由 `deep-review` 吸收进同一 host 一并审查），要么是 (b) **一个全新独立维度**（`Extends: standalone`）。多数项目专属关切属于 (a)，优先用吸收以控制子代理数量。

**Skip for:** 内置审查者已覆盖、且无需任何项目专属补充的通用关切。

## Prerequisites

- 已安装 `auriga-workflow` 插件（本技能与 `deep-review` 技能一同随该插件分发）
- `docs/rules/review/` 目录不存在时会按需创建
- `references/template.md`（位于本技能目录下）是规范模板

## Steps

### 1. Gather metadata via `AskUserQuestion` / `request_user_input`

按顺序收集：

1. **Name** — kebab-case（例如 `migration-safety`、`i18n-keys`）。校验：
   - 全小写 / 连字符分隔 / 无空格或特殊字符
   - **拒绝与内置审查者重名**：`spec-conformance`、`correctness`、`test-quality`、`docs-sync`、`robustness`、`security`、`ux`、`performance`、`architecture`、`code-quality`、`skill-plugin-quality` — 与内置重名会被 `deep-review` 视为必然重叠，直接吸收进同名内置审查者；自定义审查者应取一个区别于内置的名字，避免被意外吸收
2. **One-line "Best for"** — 简短的职责描述（12–25 字）
3. **Domain** — 用于范围前言的一个短语（例如"迁移安全"、"特性标志清理"）
4. **Trigger category** — 恰好选一项：
   - `always` — 每个拉取请求都触发（慎用；成本会累积）
   - `tag:<name>` — 仅当某个既有标签被设置时触发（`logic` / `auth-sensitive` / `ui` / `perf` / `arch`）
   - `non-trivial` — 任何非平凡变更都触发
   - `detection-driven` — 仅当 Detection 信号匹配时触发（窄关切的推荐默认值）
5. **Detection signals** — 至少 3 行可 grep 的规则（路径通配 / 导入模式 / API 调用模式）。`detection-driven` 必需；对其他类别可作为关注提示
6. **Reasoning tier** — `flagship`（需要深层多跳推理——例如缺陷排查、架构判断）或 `workhorse`（模式匹配 / 清单核对）。各平台将其映射到各自的模型类别：Claude flagship → Opus，workhorse → Sonnet；Codex flagship → GPT-5.5，workhorse → GPT-5.5-mini。默认 `workhorse`，除非该审查者需要对差异做横切推理
7. **One worked scenario** — 该审查者会捕捉的问题的具体 file:line 式示例（用于填充 Worked scenarios 章节；另外 ≥2 个留作 TODO）
8. **Dispatch 模式（`Extends`）** —（建议最先确认，它决定整份文件的定位）询问：这个审查者是 (a) **某个内置维度的项目专属补充**，还是 (b) **一个全新独立维度**？
   - (a) 选定一个内置审查者名（`spec-conformance` / `correctness` / `test-quality` / `docs-sync` / `robustness` / `security` / `ux` / `performance` / `architecture` / `code-quality` / `skill-plugin-quality`）→ 写 `Extends: <内置名>`。`deep-review` 会把它的 Checklist 与 worked scenarios 吸收进该 host 一并审查，不额外占用子代理。
   - (b) 内置 11 位都不覆盖、需要独立分派 → 写 `Extends: standalone`。
   - 多数项目专属审查者属于 (a)；优先吸收以控制子代理数量。拿不准时，对照 `deep-review/SKILL.md` 第 2 步的吸收示例选最接近的 host。

### 2. Generate the file

```bash
mkdir -p docs/rules/review/
```

读取本技能的 `references/template.md`。替换：

| Placeholder | 来源 |
|---|---|
| `<TITLE>` | 名称 → 人类可读形式（例如 `migration-safety` → "Migration Safety"） |
| `<DOMAIN>` | 第 1 步的领域短语 |
| `<BEST_FOR>` | 第 1 步的"Best for"一句话 |
| `<TRIGGER>` | 第 1 步的 Trigger category |
| `<REASONING>` | 第 1 步的 Reasoning tier |
| `<DETECTION_ROWS>` | 由 Detection signals 拼装成的 Markdown 表格行 |
| `<WORKED_SCENARIO_1>` | 第 1 步提供的那个场景 |
| `<EXTENDS>` | 第 8 步的 Dispatch 模式（`Extends: <内置名>` 或 `Extends: standalone`） |

将替换后的内容写入 `docs/rules/review/<name>.md`。

其余的 `<TODO: ...>` 占位符（Value 一句话、Checklist 正文、场景 2 和 3、Output contract 细节）留给用户填写——它们需要本技能无法合成的领域专业知识。

### 3. Tell the user what to do next

打印一段简短摘要：

1. 文件已创建于 `docs/rules/review/<name>.md`
2. **使用前必须完成的编辑：**
   - 填写 Metadata 中的 `**Value**：` 一行
   - 将 Checklist 中的 `<TODO: ...>` 占位符替换为 5–10 条具体、可操作的审查问题
   - 再补 2 个 Worked scenarios（具体的 file:line 式示例）
   - 如该审查者需要特殊的 lens/category 标签，可选地调整 Output contract
3. **验证：**
   - 在一个本应触发新审查者的拉取请求上运行 `/deep-review`
   - 检查分派的审查者列表中包含 `<name>`
   - 确认综合输出中包含该自定义审查者的发现
4. **若 Trigger 设置错了：** 编辑文件中的 `**Trigger**：` 字段并重新运行；无需其他改动

## Anti-patterns

- ❌ 使用内置审查者的名称——`deep-review` 会把重名的自定义审查者吸收进同名内置审查者；要新增一个维度，就取一个区别于内置的名字
- ❌ 为窄关切设置 `always` 触发——每个拉取请求都要付出分派成本；优先用带具体信号的 `detection-driven`
- ❌ 省略 Detection signals——`detection-driven` 必需，在其他场景也可作为关注提示
- ❌ 删除"起点，而非边界"的范围前言——缺少它的审查者往往会漏掉清单之外的发现（较新的推理模型倾向于把枚举列表当成封闭集合）
- ❌ 把某内置维度的项目专属收窄声明成 `Extends: standalone`（或不写 `Extends` 又把 `Scope` 写得像全新维度）——它会被独立分派，和 host 对同一 file:line 重复报告、空耗子代理。若它本质是某内置维度的收窄，用 `Extends: <内置名>` 声明吸收；只有内置 11 位都不覆盖的关切才用 `standalone`

## Example session

```
User: /reviewer-creator
Assistant: [走完 8 个问题；用户提供：
            name=migration-safety, best_for="捕捉不安全的数据库迁移",
            domain="迁移安全", trigger=detection-driven, signals=
            (*.sql 文件、ALTER TABLE 模式、drop_column 调用、
            migrations/ 目录), reasoning=workhorse, 1 个场景,
            extends=standalone（迁移安全是内置维度未覆盖的全新维度）]
Assistant: [生成 docs/rules/review/migration-safety.md]
Assistant: "文件已创建。接下来：填写 Checklist（5–10 条具体的安全检查，
            如'添加 NOT NULL 却没有回填？'、'并发索引创建？'），
            补 2 个 Worked scenarios，然后在一个含迁移的拉取请求上运行
            /deep-review 以验证分派。"
```
