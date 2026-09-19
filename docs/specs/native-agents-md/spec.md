# 原生 AGENTS.md 工作流入口 — 规范

> Auriga 使用 `AGENTS.md` 作为跨编码 Agent 的唯一默认项目指令入口，不再为 Claude Code 默认生成兼容软链。
> 状态：已确认；确认来源：用户在当前会话选择“原生 AGENTS.md”作为默认策略。

## 1. 产品总览

### 1.1 为什么做

- **问题与用户**：Auriga 当前同时维护 `AGENTS.md` 与 `CLAUDE.md -> AGENTS.md`，并要求每个独立子包重复创建软链；Claude Code 已原生支持 `AGENTS.md` 后，这个兼容层会阻止其默认发现下层 `AGENTS.md`，增加分层指令的维护负担。
- **事实依据**：Claude Code 2.1.277 起可在没有项目级 `CLAUDE.md` / `CLAUDE.local.md` 时原生读取当前目录、祖先和按需子目录中的 `AGENTS.md`；仓库当前安装器仍无条件创建 `CLAUDE.md -> AGENTS.md`，中英文模板与 `documentation-management` 技能仍要求每层保留该软链。
- **价值与时机**：删除默认兼容层后，Claude Code、Codex 与 Cursor 可以共享同一套分层入口，父级索引与子级规则不再依赖宿主专属软链。
- **替代方案**：仅更新文案而保留软链无法获得 Claude Code 的原生分层发现；增加长期兼容选项会扩大安装器接口和测试面，当前可用手动 `CLAUDE.md` 导入满足少数旧环境。

### 1.2 来源结构对齐

| 来源 | 原始章节或需求 | 规格落点 | 对齐说明 |
|---|---|---|---|
| 用户需求描述与策略选择 | Claude Code 支持 `AGENTS.md`，Auriga 默认采用原生 `AGENTS.md` | `2.1 原生安装与安全升级` | 直接对应 |
| 用户需求描述与策略选择 | 调整 Auriga 的规范和指令 | `2.2 分层规范与兼容说明` | 直接对应 |

### 1.3 整体产品体验

- **目标用户与场景**：使用 Auriga 安装或升级工作流文档的开发者，以及按照 Auriga 规范维护分层项目指令的 Agent。
- **端到端结果**：新项目只得到受管 `AGENTS.md`；旧项目升级后，Auriga 自己创建的兼容入口安全退场，用户自有的 Claude 指令不被覆盖；长期规范统一以 `AGENTS.md` 描述分层入口。
- **共享产品规则**：`AGENTS.md` 是默认唯一信息源；只有无法原生读取它的 Claude Code 会话才由用户显式添加 `CLAUDE.md` 导入或软链。
- **总体范围**：安装、升级、卸载兼容、状态识别、测试、双语模板、技能与人类安装说明。

### 1.4 调研发现

- `src/workflow.ts`：当前每次安装结束都会覆盖或创建 `CLAUDE.md -> AGENTS.md`。
- `AGENTS.template.zh-CN.md` / `AGENTS.template.en.md`：当前要求每个独立子包同时维护兼容软链。
- `plugins/auriga-workflow/skills/documentation-management/SKILL.md`：当前把每层兼容软链写成文档治理不变量。
- Claude Code 官方文档：原生读取要求 2.1.277 或更高版本；旧版本、部分第三方提供商、关闭遥测或禁用内置插件的会话仍需 `CLAUDE.md` 导入。

## 2. 产品需求分项

### 2.1 原生安装与安全升级

#### 2.1.1 原始产品需求

- **来源**：当前会话的用户策略选择
- **原始需求**：Auriga 默认采用 Claude Code 原生 `AGENTS.md`，不再生成宿主专属兼容入口，同时保护现有项目文件。

#### 2.1.2 用户可感知行为

- **目标用户与场景**：开发者在新项目安装工作流，或在已有 Auriga / 自定义指令项目中升级工作流。
- **触发与前置条件**：执行现有 workflow 或 preset 安装命令。
- **主要行为**：安装器写入或升级受管 `AGENTS.md`；不创建新的 `CLAUDE.md`；升级时删除 Auriga 创建的精确兼容软链，并迁移旧版 Auriga 主文件形态。
- **成功结果**：新安装目录只有受管 `AGENTS.md`；升级后的项目保留工程自定义区，且没有 Auriga 兼容软链。
- **失败与边界行为**：真实 `CLAUDE.md` 或指向其他目标的软链保持原样，安装器发出兼容提示；损坏的 Auriga 旧主文件仍按既有规则先备份再迁移。
- **兼容要求**：旧版 `AGENTS.md -> CLAUDE.md`、当前版 `CLAUDE.md -> AGENTS.md`、状态扫描和卸载仍能安全处理；用户自有文件不得被静默删除。

#### 2.1.3 分项范围边界

- **本项包含**：默认安装形态、旧形态迁移、用户文件保护、状态扫描与卸载兼容。
- **本项不包含**：新增命令行兼容开关、修改 Claude Code 用户设置、改变 user scope 的 `~/.claude/CLAUDE.md` 行为。
- **引用共享规则**：`AGENTS.md` 是默认唯一信息源，旧环境使用显式兼容入口。

#### 2.1.4 验收映射

- `VAL-INSTALLATION-001`：新安装只生成 `AGENTS.md`。
- `VAL-MIGRATION-001`：Auriga 管理的旧兼容入口安全退场。
- `VAL-SAFETY-001`：用户自有 `CLAUDE.md` 保持不变。
- `VAL-COMPATIBILITY-001`：旧项目仍可识别并卸载。

### 2.2 分层规范与兼容说明

#### 2.2.1 原始产品需求

- **来源**：当前会话用户请求
- **原始需求**：同步调整 Auriga 的规范和指令，使其反映 Claude Code 已原生支持 `AGENTS.md` 的事实。

#### 2.2.2 用户可感知行为

- **目标用户与场景**：开发者阅读安装说明，Agent 按模板或文档管理技能维护项目指令。
- **触发与前置条件**：阅读 README / guide，或触发工作流与文档管理技能。
- **主要行为**：规范只要求在各作用域维护 `AGENTS.md`，并解释何时才需要手动添加 Claude Code 兼容入口。
- **成功结果**：中英文模板、技能、帮助文本与人类文档不再把软链描述为默认产物或每层不变量。
- **失败与边界行为**：对不支持原生读取的 Claude Code 会话，说明使用 `@AGENTS.md` 导入或软链的手动恢复方式与验证入口。

#### 2.2.3 分项范围边界

- **本项包含**：活跃模板、技能、README、guide/help、可移植性规范及其契约测试。
- **本项不包含**：回写历史 worklog，或删除合法的宿主专属 `CLAUDE.md` 用法。

#### 2.2.4 验收映射

- `VAL-DOCUMENTATION-001`：活跃规范统一采用原生 `AGENTS.md` 默认策略。
- `VAL-DOCUMENTATION-002`：兼容限制与手动恢复路径可被用户发现。

## 3. 整体不做

- 不移除 Claude Code 对 `CLAUDE.md` 的一般支持，也不禁止项目保留真正的 Claude 专属指令。
- 不改变 Codex 专用的 `session-instructions-loader` 插件；它解决的是工作区祖先指令注入，不是 Claude Code 兼容软链。
- 不修改已归档的历史设计与交付记录。

## 5. 参考资料

- [Claude Code：How Claude remembers your project](https://code.claude.com/docs/en/memory)
