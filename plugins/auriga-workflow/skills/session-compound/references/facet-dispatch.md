# 逐会话切面派遣协议

仅在“最近 30 天洞察”模式处理未缓存会话时读取。

## 派遣方式

- 使用宿主内置 Agent；每批传入少量会话证据文件路径，不复制主 Agent 的推理过程。
- 每个证据文件由对应运行时分析器通过 `--file` 生成。优先读取结构化证据；只有结构化字段无法解释关键转折时才按需打开原始日志片段。
- 一个会话对应一个独立切面。批次内某一项失败时仍返回其他有效项。
- 切面只描述本会话，不判断“反复”“长期习惯”或是否应该修改工程资产。

## 证据纪律

- 区分明确用户原文、结构化事件、当前状态回看和模型分析。
- 非零工具退出只有在上下文证明其造成意外返工时才写为摩擦；失败测试和存在性探测不能自动算浪费。
- 显式与推断技能使用保持原标签。
- 不复制完整会话；`brief_summary` 保持简短，证据使用 `session-id:turn:N`、`session-id:skill-event:N` 等引用。

## 输出

只返回 JSON 数组，每个输入会话一项：

```json
[
  {
    "session_id": "...",
    "project_area": "从 cwd 或任务识别的简短领域；未知则 unknown",
    "underlying_goal": "用户真正想达成什么",
    "outcome": "fully_achieved|partially_achieved|not_achieved|unknown",
    "wins": [
      { "text": "有效做法", "evidence_refs": ["session:turn:1"] }
    ],
    "frictions": [
      {
        "owner": "agent|user|environment|unknown",
        "text": "具体摩擦",
        "consequence": "造成的后果",
        "evidence_refs": ["session:turn:2"]
      }
    ],
    "user_instructions": [
      {
        "text": "明确纠正、偏好或长期要求",
        "persistence": "explicit-persistent|session-only|unspecified",
        "evidence_refs": ["session:turn:3"]
      }
    ],
    "brief_summary": "两三句话以内的会话摘要",
    "evidence_refs": ["session:turn:0"]
  }
]
```

必填字段不得缺失；没有内容的数组用 `[]`。不能判断的结果使用 `unknown`，不要用空字符串或数字零代替。
