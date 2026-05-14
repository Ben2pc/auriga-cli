---
name: goalify
description: Plan an autonomous goal from the current spec or work-in-progress and dispatch it via Claude Code's built-in /goal command. Trigger when the user wants the agent to "set a goal", "run autonomously", "autopilot", "跑到 Ready", "自动跑完", "自驱跑完这段", "goalify it", or otherwise asks the agent to plan + dispatch /goal rather than just discuss what to do.
---

根据 spec 或者当前的工作进展，先 plan 出 goal 然后再 set goal 并启动，如果有疑问或者目标难以明确，在 set goal 前询问用户。

## 输入来源

优先从 `spec-design` 产出的 spec 包里取信息，两份文件都要看：

- `docs/specs/<topic>/spec.md` — 取 Why / What / Out of scope 段，作为 goal 的目的与边界
- `docs/specs/<topic>/validation-contract.md` — 取 VAL 列表，作为 goal 的"完成判据"（每条 VAL 翻译成 goal 内的一个可验证 step；`Tool` 字段决定调哪类工具验证）

如果用户没经过 spec-design (直接给一段话或一个分支)，回退到工作进展 / PR 描述 / 最近 commit message 提炼。

## 典型时机

PR Ready 阶段最有价值：spec 已锁定、实现已落地、剩下的就是"按 VAL 跑一遍证明 Ready"。早期 (spec 没定 / 实现没写) 时调 goalify 容易产出 throwaway 的 /goal 文本，不推荐自动嵌入到 workflow 中。

## 其他规则

- 如果可能，按照 auriga workflow 来推进
