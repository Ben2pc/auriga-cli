---
name: goalify
description: Plan an autonomous goal from the current spec or work-in-progress and dispatch it via Claude Code's built-in /goal command. Trigger when the user wants the agent to "set a goal", "run autonomously", "autopilot", "跑到 Ready", "自动跑完", "自驱跑完这段", "goalify it", or otherwise asks the agent to plan + dispatch /goal rather than just discuss what to do.
---

根据 spec 或者当前的工作进展，先 plan 出 goal 然后再 set goal 并启动，如果有疑问或者目标难以明确，在 set goal 前询问用户。

## 输入来源

优先从 `spec-design` 产出的 spec 包里取信息，两份文件都要看：

- `docs/specs/<topic>/spec.md` — 取 Why / What / Out of scope 段，作为 goal 的目的与边界
- `docs/specs/<topic>/validation-contract.md` — 取 VAL 列表，作为 goal 的"完成判据"（每条 VAL 翻译成 goal 内的一个可验证 step；`Tool` 字段决定调哪类工具验证）

## 其他规则

- 如果可能，按照 auriga workflow 来推进
