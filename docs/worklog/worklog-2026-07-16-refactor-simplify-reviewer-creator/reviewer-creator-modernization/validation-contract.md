# Validation Contract — Reviewer Creator Modernization (验收契约 — 项目审查者创建技能现代化)

> 与 spec.md 配套：spec.md 描述 why+what；本文件描述什么算通过。

## Coverage map (覆盖矩阵)

| Range (范围) | VAL ids |
|---|---|
| 定位与交互 | VAL-REV-001 ~ 002 |
| 内容与维护 | VAL-REV-003 ~ 004 |
| 调度协议 | VAL-REV-005 |

## Toolchain (本仓库验证栈)

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| `repo-check` | `node:test` 中的技能协议测试与官方技能验证工具 |

## Assertions (断言)

### VAL-REV-001
- **Behavior (行为)**: 项目规则已经明确属于某个内置维度或独立维度时，创建技能直接确定定位；只有真实歧义会触发用户确认。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 技能流程明确允许基于仓库证据直接判断，并把询问限制在会改变 `extends` 结果的歧义。

### VAL-REV-002
- **Behavior (行为)**: 每个生成的项目审查者仍显式声明合法 `extends`，不依赖名称或正文语义猜测调度关系。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 模板保留 `extends`，技能保留补充型与独立型的机械定位和校验规则。

### VAL-REV-003
- **Behavior (行为)**: 检查问题和场景数量由项目规则与判断边界决定，不要求固定数量配额；边界场景只有在能提高判断精度时才保留。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 技能和模板不含固定数量要求，场景章节被标为条件式内容。

### VAL-REV-004
- **Behavior (行为)**: 内置审查者和合法触发条件以 `deep-review` 当前协议为准，创建技能不维护第二份完整注册表。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 创建流程要求读取当前 `deep-review` 协议，且不再枚举全部内置名称或触发标签。

### VAL-REV-005
- **Behavior (行为)**: 补充型审查者继承宿主输出契约，独立型审查者保留完整输出契约，现有 frontmatter 与权限校验继续生效。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 技能、模板和协议测试共同保留上述调度契约。
