---
name: goalify
description: Plan an autonomous goal from the current spec or work-in-progress and dispatch it via Claude Code's built-in /goal command. Trigger when the user wants the agent to "set a goal", "run autonomously", "autopilot", "跑到 Ready", "自动跑完", "自驱跑完这段", "goalify it", or otherwise asks the agent to plan + dispatch /goal rather than just discuss what to do.
---

根据 spec 或者当前的工作进展，先 plan 出 goal 然后再 set goal 并启动，如果有疑问或者目标难以明确，在 set goal 前询问用户。

## 定位

goalify 是**需求已经明确之后**用来驱动长程任务的工具——把"做什么"翻译成一段可被 `/goal` 文本驱动、连续自驱的执行计划。

**适用**：
- spec / validation contract 已完成（或者用户已经在对话里把目标说清楚），现在需要"跑一段"才能拿到结果
- 改动跨多个步骤 / 多个文件 / 多轮 verify，希望 agent 不停在每一步打断用户
- 用户明说"自动跑完 / 跑到 Ready / autopilot / 自驱"

**不适用**：
- 需求还在澄清阶段（Q+GUESS 还没收敛、用户还在 reframe 范围）→ 先走 `spec-design`
- 一次性单步任务（一个 grep、一条命令、一行修改）→ 直接做，goalify 的 plan + /goal 开销不划算
- 改动方向尚未定（plan 阶段未完成）→ 让 `incremental-impl` 先决定切片，再视情况包成 goal

**与 `incremental-impl` 的边界**：incremental-impl 管"怎么切片 + 切片内的纪律"；goalify 管"把一段已切好的、方向明确的长程工作打包成连续执行的 /goal 文本"。两者可以串联：incremental-impl 出 slice 计划 → goalify 把整个 slice 序列写成 /goal 文本 → 用户粘贴启动。

## 输入来源

优先从 `spec-design` 产出的 spec 包里取信息，两份文件都要看：

- `docs/specs/<topic>/spec.md` — 取 Why / What / Out of scope 段，作为 goal 的目的与边界
- `docs/specs/<topic>/validation-contract.md` — 取 VAL 列表，作为 goal 的"完成判据"（每条 VAL 翻译成 goal 内的一个可验证 step；`Tool` 字段决定调哪类工具验证）

没有 spec 包时，从用户对话里的目标描述 + 当前分支 / commit 历史 / PR 描述提炼。

## 其他规则

- 如果可能，按照 auriga workflow 来推进
