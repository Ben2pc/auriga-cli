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

<说明项目背景、适用路径、与宿主维度的边界。若 extends: standalone，说明为什么当前内置维度都不承担这项判断。>

## Rule sources

- `<项目规则或代码路径>` — <它约束什么>

## Checklist

<按项目规则复杂度写足够的具体问题。每条说明要找的证据和产生的项目影响；不要用固定数量或个人风格替代判断。>

1. **<类别>**：<审查问题、证据和影响>

## Detection table

| 信号 | 重点检查 |
|---|---|
| <差异信号> | <项目专属风险> |

## Worked scenarios (optional)

<只有判断边界容易混淆时保留，按需给出“应报告”或“不应报告”的真实场景。没有真实必要时删除本节。>

- **<应报告或不应报告>**：<具体差异、判断及原因>。

## Output contract

> 仅 `extends: standalone` 保留本节。补充型审查者删除本节，继承宿主的维度输出契约，由 `deep-review` 标注 `(宿主名 / 项目审查者名)` 来源。

遵循主代理数据包中的统一 Reviewer Output Contract，不修改核心章节、列、编号或空结果写法。“问题与影响”必须说明违反的项目规则、证据和具体影响；本节只补充该独立维度特有的单元格内容要求。
