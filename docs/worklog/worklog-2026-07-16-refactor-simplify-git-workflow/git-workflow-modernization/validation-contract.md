# Validation Contract — Git Workflow Modernization (验收契约 — Git 工作流现代化)

> 与 spec.md 配套：spec.md 描述 why+what；本文件描述“什么算通过”。

## Coverage map (覆盖矩阵)
| Range (范围) | VAL ids |
|---|---|
| 安全与生命周期契约 | VAL-GIT-001 ~ 002 |
| PR 模板与门禁兼容 | VAL-GIT-003 ~ 004 |
| 上下文成本 | VAL-GIT-005 |
| Ready 临时资产范围与扫描安全 | VAL-GIT-006 ~ 007 |

## Toolchain (本仓库验证栈)

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| `repo-check` | `node:test` 内容契约测试与 Claude Code、Codex 官方技能校验器 |

## Assertions (断言)

### VAL-GIT-001
- **Behavior (行为)**: Git 状态变更前必须确认目标仓库、工作树、分支、远端、基准分支和现有改动，并禁止擅自覆盖归属不明的用户改动。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 技能正文保留完整的操作前安全边界，且契约测试锁定这些要求。

### VAL-GIT-002
- **Behavior (行为)**: 技能继续覆盖分支隔离、语义提交、Draft PR、Ready、评审反馈同步与合并检查的完整生命周期。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 技能正文与内容契约同时包含上述阶段，任何阶段缺失都会使验证失败。

### VAL-GIT-003
- **Behavior (行为)**: PR 模板的六个章节标题同时提供英文锚点和中文提示，示例正文使用中文。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 内容契约逐字匹配六个双语标题，并确认示例中存在中文验收、风险、验证和后续事项。

### VAL-GIT-004
- **Behavior (行为)**: 使用双语验收标准和验证计划标题的 PR，仍会被合并门禁识别其中未完成的检查项。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 合并门禁回归测试使用模板的精确双语标题，并对未勾选项产生阻塞。

### VAL-GIT-005
- **Behavior (行为)**: 技能删除通用 Git 教学和 Hook 实现细节，只保留会改变 Agent 行为的团队契约。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 主文件不超过 140 行，且不再出现交互式变基命令教学、常见忽略文件清单、Hook 事件名称或参数真假值说明。

### VAL-GIT-006
- **Behavior (行为)**: Ready 守卫只把 `.planning/.active_plan` 和它指向的活动计划目录视为当前临时规划状态；旧根目录规划文件、空 `.planning/` 和无活动指针的非活动计划目录不阻塞。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 两条 Ready 路径的回归测试覆盖活动指针、活动目录、仅有 `.attestation`、空目录、旧根目录文件和非活动计划目录。

### VAL-GIT-007
- **Behavior (行为)**: Ready 守卫递归识别 `docs/specs/` 的普通与符号链接 Markdown 规格，不跟随扫描根或子目录符号链接；非法指针、读取失败或扫描资源超限时安全阻塞，输出中的路径经过转义并受长度限制。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 回归测试覆盖嵌套规格、有效和失效规格符号链接、根目录符号链接、非目录扫描根、非法指针、深度与条目上限及控制字符文件名。
