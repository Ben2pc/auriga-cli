# deep-review 自定义 reviewer 范围重叠处理 — Spec (deep-review custom-reviewer scope overlap — 规范)

> 让 `deep-review` 在分派阶段识别自定义 reviewer 与内置维度的范围重叠,把重叠的自定义检查并入内置 reviewer,而不是双 reviewer 重复审查。

## Why (为什么做)

`deep-review` 支持项目级自定义 reviewer(`docs/rules/review/*.md`)。当前的去重机制只在自定义 reviewer 与内置 reviewer **重名**时拦截(跳过 + 警告),挡不住「范围重叠但名字不同」的情况。

典型场景:iOS 工程团队新建一个 `ios-a11y` 自定义 reviewer,它的检查范围与内置 `ux` reviewer 的 Accessibility — Mobile 段重叠;或新建 `ios-perf`,与内置 `performance` reviewer 的 Mobile 段重叠。名字不同,所以调度器不会拦截,两个 reviewer 会被并行分派,对同一 `file:line` 报同一问题。synthesize 阶段虽然按 `file:line` 去重,但子代理已经白跑、token 已经白烧,而且自定义 reviewer 与内置 reviewer 各自只看到一半上下文,审查质量反而下降。

正确的模型是:范围重叠的自定义 reviewer 不该是「又一个并行 reviewer」,而该是「对某个内置维度的项目专属补充」——它的检查清单应当并入那个内置 reviewer,由同一个子代理在完整上下文里一并审查。

## Findings (调研发现)

- `plugins/auriga-workflow/skills/deep-review/SKILL.md` 第 2 步「Dispatch reviewers」:目前对自定义 reviewer 的处理是「检索 `docs/rules/review/*.md`,解析 `Trigger` 路由到 A/B/C/D 类别;若与内置 reviewer 重名则跳过并警告」。
- `plugins/auriga-workflow/skills/deep-review/SKILL.md` 第 99–105 行 Anti-patterns:明确「不允许自定义 reviewer 通过重名覆盖内置 reviewer」。
- `plugins/auriga-workflow/skills/deep-review/references/reviewers/performance.md`:内置 `performance` reviewer 已含独立的 Mobile 段,包含 iOS specifics(动画期间视图层级变更、`LazyVStack` vs `VStack`、主 Actor 跳转)。
- `plugins/auriga-workflow/skills/deep-review/references/reviewers/ux.md`:内置 `ux` reviewer 把 Accessibility — Mobile (iOS / Android) 作为一等视角(VoiceOver 标签、Dynamic Type、触摸目标、Reduce Motion)。
- `plugins/auriga-workflow/skills/reviewer-creator/references/template.md`:自定义 reviewer 文件的 Metadata 字段为 `Best for` / `Trigger` / `Reasoning` / `Tools` / `Value`,**没有声明「扩展哪个内置维度」的字段**。
- 本仓库当前不存在 `docs/rules/review/` 目录,没有真实自定义 reviewer 需要迁移。
- 内置 reviewer 共 11 个:`spec-conformance`、`correctness`、`test-quality`、`docs-sync`、`robustness`、`security`、`ux`、`performance`、`architecture`、`code-quality`、`skill-plugin-quality`。

## What (做什么)

改动只落在 `deep-review` 的分派契约;`reviewer-creator` 不变。

### 1. 重叠判定

`deep-review` 在第 2 步分派前,对每个 `docs/rules/review/` 自定义 reviewer 判断它是否与某个内置维度范围重叠:

- 以**语义判断**为主:对照 11 个内置维度,判断该自定义 reviewer 的关切是否落在某个内置维度的范围之内。
- 若自定义 reviewer 文件的 Metadata 中**手写了显式归属字段**(声明它扩展哪个内置维度),则优先采信该字段,不再做语义猜测。该字段是可选的、手填的;`reviewer-creator` 不会自动产出它。

### 2. 重叠时的吸收行为

判定为与某个内置维度重叠时:

- **不**为该自定义 reviewer 分派独立子代理。
- 把该自定义 reviewer 的 Checklist 与 worked scenarios 作为「项目专属补充」并入对应内置 reviewer(host)的指令包,由 host 内置 reviewer 在同一子代理里一并审查。

### 3. 不重叠时的行为

判定为不与任何内置维度重叠(即引入一个全新维度)时,按现状作为独立子代理分派——本场景行为不变。

### 4. 重名规则统一

自定义 reviewer 与某个内置 reviewer **重名**,被视为「必然重叠」,直接吸收进同名内置 reviewer。旧的「重名 → 跳过 + 警告」规则被这条取代;对应的 Anti-pattern 条目一并更新。

### 5. host 未触发时的行为

当吸收目标(host)的内置维度本次未被触发时(例如自定义 reviewer 重叠 `performance`,但本次 PR 没有 `perf` 标签,`performance` 不分派),被吸收的自定义内容**随 host 一并不运行**。重叠的自定义 reviewer 自身的 `Trigger` 在这种情况下不再独立生效——它的运行与否跟随 host 内置维度。

### 6. finding 归属

被吸收的自定义内容产生的 finding,在 synthesize 阶段**只按 host 内置 reviewer 名标注**(如 `(performance)`),不附加自定义 reviewer 来源标记。

## Out of scope (本次不做)

- 不改 `reviewer-creator`:不新增范围重叠的创建期闸门,不修改其 `template.md`(包括不新增显式归属字段的自动产出)。
- 不引入「自定义 reviewer 显式覆盖/抑制某个内置子视角」的机制。
- 不改 11 个内置 reviewer 的检查清单本身。
- 不做 `docs/rules/`(不含 `review/`)被内置 reviewer 自动采纳的机制——那是另一条路径,本次不碰。
- 不处理「一个自定义 reviewer 部分重叠、部分是新维度」的拆分:重叠判定是二元的,以该自定义 reviewer 的主关切归属为准。

## Open questions (悬而未决)

无。

## References (参考资料)

无。
