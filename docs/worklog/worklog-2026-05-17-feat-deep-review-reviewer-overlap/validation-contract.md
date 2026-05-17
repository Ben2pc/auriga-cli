# Validation Contract — deep-review 自定义 reviewer 范围重叠处理 (验收契约 — deep-review custom-reviewer scope overlap)

> 与 spec.md 配套:spec.md 描述 why+what;本文件描述"什么算通过"。
> 每条 VAL 只描述 Behavior + Tool + Evidence;测试设计 (函数组织 / fixture / mock) 是 `test-designer` 的活。

## Coverage map (覆盖矩阵)
| Range (范围) | VAL ids |
|---|---|
| deep-review 分派契约的范围重叠处理 | VAL-OVL-001 ~ 007 |

## Toolchain (本仓库验证栈)
> A1 调研所得的既成事实,不是本次功能的实现决策。只填本契约 VAL 实际用到的类别;test-designer 据此免去重新推断该用哪个运行器 / 驱动。

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| `repo-check` | `node:test`(`node --test`,经 `npm test` 编译 `tests/*.test.ts` 后运行;参照既有的 `tests/auriga-workflow-skills.test.ts`、`tests/spec-design.test.ts` 对 skill 文本做仓库级断言) |

## Assertions (断言)

### VAL-OVL-001
- **Behavior (行为)**: `deep-review` 的分派指令规定——判定为与某内置维度范围重叠的 `docs/rules/review/` 自定义 reviewer,不被分派为独立子代理。
- **Tool (工具)**: `repo-check`
- **Evidence (判据)**: `deep-review/SKILL.md` 第 2 步包含「重叠 → 不单独分派子代理」这条规则,且表述无歧义(不会被读成"既吸收又分派")。

### VAL-OVL-002
- **Behavior (行为)**: 判定为重叠的自定义 reviewer,其 Checklist 与 worked scenarios 作为「项目专属补充」并入对应内置 reviewer(host)的指令包,由 host 子代理一并审查。
- **Tool (工具)**: `repo-check`
- **Evidence (判据)**: `deep-review/SKILL.md` 第 2 步明确「把自定义 reviewer 的 Checklist 与 worked scenarios 并入 host 内置 reviewer 的指令包」,并点明并入的内容范围(Checklist + worked scenarios)。

### VAL-OVL-003
- **Behavior (行为)**: 判定为不与任何内置维度重叠的自定义 reviewer,仍按现状作为独立子代理分派,行为不变。
- **Tool (工具)**: `repo-check`
- **Evidence (判据)**: `deep-review/SKILL.md` 第 2 步保留「不重叠 → 按 `Trigger` 路由到 A/B/C/D 类别、作为独立 reviewer 分派」的路径。

### VAL-OVL-004
- **Behavior (行为)**: 重叠判定以语义判断为主;当自定义 reviewer 文件 Metadata 含显式归属字段时,优先采信该字段而不再做语义猜测。
- **Tool (工具)**: `repo-check`
- **Evidence (判据)**: `deep-review/SKILL.md` 第 2 步描述判定依据为「对照 11 个内置维度做语义判断」,并写明「Metadata 含显式归属字段时优先采信」;同时说明该字段是可选手填、`reviewer-creator` 不自动产出。

### VAL-OVL-005
- **Behavior (行为)**: 与某内置 reviewer 重名的自定义 reviewer 被视为必然重叠,吸收进同名内置 reviewer;旧的「重名 → 跳过 + 警告」规则被取代。
- **Tool (工具)**: `repo-check`
- **Evidence (判据)**: `deep-review/SKILL.md` 第 2 步把重名描述为「必然重叠 → 吸收」;原「重名跳过并给出警告」的表述及第 99–105 行对应的 Anti-pattern 条目已更新为与吸收行为一致,文件内不残留矛盾表述。

### VAL-OVL-006
- **Behavior (行为)**: 当吸收目标(host)的内置维度本次未被触发时,被吸收的自定义内容随 host 一并不运行。
- **Tool (工具)**: `repo-check`
- **Evidence (判据)**: `deep-review/SKILL.md` 第 2 步写明「host 未触发 → 被吸收的自定义内容不运行」,并说明重叠自定义 reviewer 自身的 `Trigger` 在此情况下不独立生效。

### VAL-OVL-007
- **Behavior (行为)**: 被吸收的自定义内容产生的 finding,在 synthesize 阶段只按 host 内置 reviewer 名标注,不附加自定义 reviewer 来源标记。
- **Tool (工具)**: `repo-check`
- **Evidence (判据)**: `deep-review/SKILL.md` 第 3 步(Synthesize)对 finding 的 `(<reviewer>)` 标注规则,说明被吸收 finding 用 host 内置 reviewer 名标注。
