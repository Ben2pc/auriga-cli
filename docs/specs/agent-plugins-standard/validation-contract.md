# Validation Contract — Agent Plugins 1.0.0 全量兼容（验收契约 — Agent Plugins 1.0.0 full compatibility）

> 与 spec.md 配套：spec.md 描述 why + 用户可观察的 what；本文件描述什么算通过。
> 一条 VAL 不等于一个验证用例。

## Coverage map (覆盖矩阵)

| Range (范围) | VAL ids |
|---|---|
| 全量标准包身份 | VAL-PORTABILITY-001 ~ VAL-PORTABILITY-003 |
| Skills 发现 | VAL-DISCOVERY-001 ~ VAL-DISCOVERY-002 |
| 原生运行时兼容 | VAL-COMPATIBILITY-001 ~ VAL-COMPATIBILITY-003 |
| 元数据与版本 | VAL-VERSIONING-001 ~ VAL-VERSIONING-002 |
| Marketplace 与发布边界 | VAL-DISTRIBUTION-001 ~ VAL-DISTRIBUTION-002 |
| 长期治理与回归 | VAL-GOVERNANCE-001 ~ VAL-GOVERNANCE-002 |

## Assertions (断言)

### VAL-PORTABILITY-001 — 四个插件全部具备标准根清单
- **验收要求**：`auriga-workflow`、`quality-gate-scaffolder`、`session-instructions-loader`、`auriga-notify` 在同一次交付中全部包含根 `plugin.json`。
- **验证方式**：仓库检查。
- **通过标准**：四个约定路径均为随插件发布的普通 JSON 文件，不存在缺失、分批迁移或指向包外目标的情况。

### VAL-PORTABILITY-002 — 根清单符合 Agent Plugins 1.0.0
- **验收要求**：每份根清单满足 Agent Plugins 1.0.0 canonical manifest 契约。
- **验证方式**：schema 验证与仓库检查。
- **通过标准**：`$schema` 为 canonical 1.0.0 URI，必填字段、名称、字段类型和闭合顶层字段全部有效；不存在 `skills`、`hooks`、`interface` 等非标准顶层字段。

### VAL-PORTABILITY-003 — Hook-only 插件不伪装成可移植能力
- **验收要求**：`session-instructions-loader` 与 `auriga-notify` 是合法标准包，但不把宿主 hooks 声明成 Agent Plugins v1 可移植组件。
- **验证方式**：仓库检查与人工规格核对。
- **通过标准**：两份标准根清单只声明合法身份和元数据；不存在虚构的 Skills、MCP 配置或可移植 hook 声明。

### VAL-DISCOVERY-001 — auriga-workflow Skills 可由标准位置发现
- **验收要求**：标准客户端可以从 `auriga-workflow/skills/` 的直接子目录发现全部现有 Skills。
- **验证方式**：集成测试或等价运行探测，以及仓库检查。
- **通过标准**：标准根清单生效时发现集合与迁移前插件提供的 13 个 Skills 一致，且不依赖标准清单中的非标准路径字段。

### VAL-DISCOVERY-002 — quality-gate-scaffolder Skills 可由标准位置发现
- **验收要求**：标准客户端可以从 `quality-gate-scaffolder/skills/` 的直接子目录发现全部现有 Skills。
- **验证方式**：集成测试或等价运行探测，以及仓库检查。
- **通过标准**：标准根清单生效时发现集合与迁移前插件提供的 5 个 Skills 一致；同级 `references/` 因不含 `SKILL.md` 而被忽略，发现过程不依赖标准清单中的非标准路径字段。

### VAL-COMPATIBILITY-001 — Claude Code 能力保持不变
- **验收要求**：新增标准根清单后，Claude Code 适用插件的安装范围、Skills 和 hooks 行为不回退。
- **验证方式**：回归测试与安装行为检查。
- **通过标准**：Claude marketplace 继续包含 `auriga-workflow`、`quality-gate-scaffolder`、`auriga-notify`；对应原生清单和 hooks 保留，`auriga-notify` 仍为 opt-in 且 Claude Code-only。

### VAL-COMPATIBILITY-002 — Codex 能力保持不变
- **验收要求**：新增标准根清单后，Codex 适用插件的安装范围、Skills、hooks 与 interface 行为不回退。
- **验证方式**：回归测试与标准清单加载探测。
- **通过标准**：Codex marketplace 继续包含 `auriga-workflow`、`quality-gate-scaffolder`、`session-instructions-loader`；原生 `.codex-plugin/plugin.json` 仍能作为适用插件的宿主 overlay，现有安装命令和启用能力不变。

### VAL-COMPATIBILITY-003 — 不扩大单运行时插件范围
- **验收要求**：标准化包身份不改变 hook-only 插件的目标运行时。
- **验证方式**：仓库检查与 catalog 回归测试。
- **通过标准**：`auriga-notify` 仍只标记 Claude Code，`session-instructions-loader` 仍只标记 Codex；没有新增另一运行时的 marketplace 条目或原生清单。

### VAL-VERSIONING-001 — 四个插件版本按目标提升
- **验收要求**：四个插件分别发布 `4.0.23`、`0.2.2`、`1.0.4`、`1.0.2`。
- **验证方式**：仓库检查。
- **通过标准**：每个标准根清单及该插件所有适用原生清单都使用规格指定的目标版本。

### VAL-VERSIONING-002 — 同一插件共享身份无漂移
- **验收要求**：同一插件的标准清单与原生清单表达相同的共享身份。
- **验证方式**：自动化契约测试。
- **通过标准**：`name` 与 `version` 逐字一致，描述与作者等元数据在语义上指向同一插件；允许既有语言与展示详略差异，宿主专属路径和 interface 字段不被错误要求复制到标准清单。

### VAL-DISTRIBUTION-001 — Marketplace 寻址与策略不变
- **验收要求**：标准迁移不改变现有 marketplace 对插件目录的寻址和安装策略。
- **验证方式**：仓库检查与现有 marketplace 测试。
- **通过标准**：两个 marketplace 的插件集合、source 路径、installation、authentication、default/opt-in 语义与迁移前一致。

### VAL-DISTRIBUTION-002 — CLI 包版本边界保持准确
- **验收要求**：仅插件 payload、测试和仓库文档变化时，不把标准迁移误报为 auriga-cli runtime 版本变化；若实施触达 `src/` 或其他用户可见 CLI 行为，则重新应用仓库版本规则。
- **验证方式**：差异检查与版本规则核对。
- **通过标准**：最终差异与 `package.json` 版本处理符合根 `AGENTS.md` 的版本边界，风险说明没有遗漏实际触达的 CLI 行为。

### VAL-GOVERNANCE-001 — 项目规则认识标准根清单
- **验收要求**：后续维护者与 deep-review 能把根 `plugin.json` 作为 portable core 的一等入口，并与宿主清单分开判断。
- **验证方式**：文档检查与 reviewer 契约测试。
- **通过标准**：开发指南、可移植性说明或插件质量 reviewer 的有效入口明确覆盖标准根清单、固定组件位置、闭合字段和宿主扩展边界，不再只枚举 `.claude-plugin` 与 `.codex-plugin`。

### VAL-GOVERNANCE-002 — 现有验证无回归
- **验收要求**：新增标准入口不破坏现有插件安装、Skills、hooks、catalog、版本一致性和发布形态契约。
- **验证方式**：项目测试、相关独立测试组和必要的安装端到端验证。
- **通过标准**：最后一次相关修改后的既有必需验证与本规格新增契约验证全部通过；任何不可运行的验证被明确记录为证据缺口，不能被表述为通过。
