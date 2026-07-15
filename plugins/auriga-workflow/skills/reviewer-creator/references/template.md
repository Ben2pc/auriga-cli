---
name: <NAME>
best_for: "<BEST_FOR>"
extends: <EXTENDS>  # 内置审查者名，或 standalone
trigger: <TRIGGER>
reasoning: <REASONING>
tools: [Read, Grep, Glob]
value: "<这个项目规则比宿主通用检查多防住什么风险>"
# effort: <EFFORT>  # 可选；仅在项目确需覆盖默认投入时填写
---

# <TITLE>

## Scope

<说明项目背景、适用路径、与宿主维度的边界。若 extends: standalone，说明为什么十个内置维度都不覆盖。>

## Rule sources

- `<项目规则或代码路径>` — <它约束什么>

## Checklist

<写 5–10 条具体、可操作的问题。每条说明要找的证据和产生的项目影响；不要用固定数量或个人风格替代判断。>

1. **<类别>**：<审查问题、证据和影响>
2. **<类别>**：<审查问题、证据和影响>
3. **<类别>**：<审查问题、证据和影响>

## Detection table

| 信号 | 重点检查 |
|---|---|
| <差异信号> | <项目专属风险> |

## Worked scenarios

1. **应报告**：<具体差异与 finding 格式>。
2. **应报告**：<边界或容易遗漏的项目场景>。
3. **不应报告**：<看似命中但不违反项目规则的场景，以及原因>。

## Output contract

这是全覆盖审查，不是预过滤。返回至多 300 字摘要，随后逐条输出：

`<file>:<line> — <项目规则、证据和影响> — [severity: blocking | non-blocking] — [confidence: high | medium | low]`

只有没有发现时返回 `No findings.`。
