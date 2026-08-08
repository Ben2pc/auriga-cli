# Agent Plugins 1.0.0 全量兼容 — Spec（Agent Plugins 1.0.0 full compatibility — 规范）

> 让 auriga-cli 当前发布的全部四个插件在同一次交付中成为合法的 Agent Plugins 1.0.0 包，同时保持现有 Claude Code 与 Codex 安装和运行行为不变。

## Why (为什么做)

- **问题与用户**：auriga-cli 维护者和插件使用者当前只能依赖 `.claude-plugin/plugin.json` 或 `.codex-plugin/plugin.json` 等宿主清单。支持 Agent Plugins 新标准的客户端无法从统一的根清单确认插件身份、目标规范版本和可移植组件。
- **事实依据**：仓库当前发布 `auriga-workflow`、`quality-gate-scaffolder`、`session-instructions-loader`、`auriga-notify` 四个插件，均没有根 `plugin.json`。Agent Plugins 1.0.0 要求根清单，并只把 `skills/` 与 `mcp.json` 定义为可移植组件；现有两个 Skills 插件已经使用固定的 `skills/` 位置，另外两个插件只提供宿主 hooks。
- **价值与时机**：Agent Plugins 1.0.0 已公开规范和 canonical JSON Schema，Codex 已支持标准根清单以及 `.codex-plugin/plugin.json` 兼容 overlay。现在增加标准入口，可以让插件包采用跨客户端共同识别的最小契约，同时不等待 hooks 等宿主能力进入未来标准。
- **替代方案**：只迁移 Skills 插件的改动更小，但会让同一 marketplace 中的自有插件长期处于两种包身份，增加维护者判断和自动检查分支。用户已选择四个插件一次性迁移，不采用分批试点。

## Findings (调研发现)

1. Agent Plugins 1.0.0 当前状态为 Working Draft。每个合规包必须在插件根目录提供 `plugin.json`，其中 `$schema` 与 `name` 必填；顶层字段是闭合集合，`skills`、`hooks`、`interface` 等宿主字段不能放在标准顶层。
2. v1 的可移植组件只有 Agent Skills 与 MCP servers。缺少 `skills/` 或 `mcp.json` 是合法状态，因此 hook-only 插件可以是合法标准包，但其 hook 行为不会因此跨客户端可移植。
3. 当前插件能力矩阵：

   | Plugin | Agent Skills | Hooks | Native manifests |
   |---|---:|---:|---|
   | `auriga-workflow` | 13 | 有 | Claude Code + Codex |
   | `quality-gate-scaffolder` | 5 | 无 | Claude Code + Codex |
   | `session-instructions-loader` | 0 | 有 | Codex |
   | `auriga-notify` | 0 | 有 | Claude Code |

4. Codex 对合法根 `plugin.json` 使用固定 `./skills` 与 `./mcp.json` 发现路径；当标准清单没有 inline `extensions.com.openai` 时，可以继续读取 `.codex-plugin/plugin.json` 作为 apps、hooks 与 interface overlay。
5. 两个 marketplace 都通过插件目录寻址。新增根清单不要求改变现有 marketplace 名称、来源路径、安装策略或运行时覆盖范围。
6. 当前仓库把 plugin payload 的版本和新鲜度交给各插件 manifest/marketplace 管理。仅增加插件 payload、测试和仓库文档不要求提升 auriga-cli 的 `package.json` 版本；若实施阶段扩大到 `src/` 或其他用户可见 CLI 行为，则按仓库版本规则重新判断。
7. 仓库没有 `docs/rules/spec/` 下的项目专属规格补充规则；本规格遵循根 `AGENTS.md` 与 `spec-design` 的通用规格契约。

## What (做什么)

### 1. 一次性交付全部标准根清单

同一个变更必须为以下四个插件全部提供根 `plugin.json`：

- `plugins/auriga-workflow/plugin.json`
- `plugins/quality-gate-scaffolder/plugin.json`
- `plugins/session-instructions-loader/plugin.json`
- `plugins/auriga-notify/plugin.json`

不接受只完成部分插件后将仓库置于混合迁移状态。

### 2. 声明 Agent Plugins 1.0.0 合规身份

每份根清单必须：

- 使用 canonical schema `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`；
- 使用与现有插件相同的稳定 `name`；
- 只包含 Agent Plugins 1.0.0 允许的顶层字段；
- 复用现有可移植元数据，包括版本、描述、作者、主页、代码仓库、许可证和关键词；
- 不声明不存在的可移植组件，不创建空 `mcp.json`，也不把宿主路径配置复制到标准顶层。

### 3. 保持可移植组件的实际发现结果

标准客户端从固定 `skills/` 位置发现：

- `auriga-workflow` 的全部现有 workflow skills；
- `quality-gate-scaffolder` 的全部 5 个现有质量门禁 skills；同级 `references/` 不含 `SKILL.md`，标准客户端必须忽略它而不能误报为第 6 个 Skill。

本次迁移不改变任何 `SKILL.md` 的行为契约、名称、描述或目录结构。`session-instructions-loader` 与 `auriga-notify` 没有标准 v1 可移植组件，客户端不得将其宿主 hooks 误报为标准组件。

### 4. 保留宿主能力与安装兼容性

现有 `.claude-plugin/plugin.json`、`.codex-plugin/plugin.json`、`hooks/`、marketplace 条目和安装范围全部保留：

- Claude Code 继续通过其原生清单加载适用插件和 hooks；
- Codex 继续通过其原生 overlay 获得 hooks 与 interface；
- `auriga-notify` 仍是 Claude Code-only；
- `session-instructions-loader` 仍是 Codex-only；
- 新标准支持不扩大任何插件的宿主范围，也不改变默认安装、鉴权时机或 opt-in 行为。

### 5. 同步插件版本与共享身份

本次是插件用户可见的发布形态变化，各插件提升一个 patch version：

| Plugin | Current | Target |
|---|---:|---:|
| `auriga-workflow` | `4.0.22` | `4.0.23` |
| `quality-gate-scaffolder` | `0.2.1` | `0.2.2` |
| `session-instructions-loader` | `1.0.3` | `1.0.4` |
| `auriga-notify` | `1.0.1` | `1.0.2` |

同一插件所有适用清单的 `name` 与 `version` 必须逐字一致。描述、作者和其他共享元数据必须表达同一插件身份，但允许延续现有运行时的语言与展示详略差异；宿主专属字段继续只存在于对应原生清单。标准根清单使用不依赖某个客户端界面的可移植元数据。

### 6. 建立长期防漂移门禁

仓库自动验证必须覆盖：

- 四份根清单都存在、JSON 可解析并满足 Agent Plugins 1.0.0 的闭合字段和类型约束；
- canonical `$schema`、插件名称和目标版本正确；
- 同一插件的标准清单与原生清单名称、版本和语义身份一致；
- Skills 插件仍可从标准固定位置发现预期的直接子目录；
- marketplace 仍指向原插件目录，宿主范围不变；
- 后续新增自有插件时，项目规则和审查规则要求同时评估标准根清单，而不是继续只认识 Claude Code/Codex 双清单。

标准校验失败必须让仓库验证失败，不能依赖客户端静默回退到旧清单掩盖不合规状态。

## Out of scope (本次不做)

- 删除、废弃或重命名 `.claude-plugin/plugin.json`、`.codex-plugin/plugin.json`。
- 把 hooks、apps、commands、agents 或 interface 宣称为 Agent Plugins 1.0.0 可移植组件。
- 为 `auriga-notify` 增加 Codex 支持，或为 `session-instructions-loader` 增加 Claude Code 支持。
- 移动现有 hooks 到新的反向域名扩展目录，或把现有 overlay 内联到 `extensions.com.openai`。
- 新增 MCP server、创建空 `mcp.json`，或迁移不存在的 MCP 配置。
- 改变 marketplace 来源、安装策略、默认选择、鉴权时机或 CLI 安装命令。
- 让 auriga-cli 支持未来新增的 standard-only 插件源，或改变 catalog 的元数据优先级。
- 提前支持 Agent Plugins 1.0.0 之后尚未发布的规范版本。

## Open questions (悬而未决)

- 标准清单与原生清单的共享元数据通过测试约束还是生成机制保持同步 — 归属：arch；推迟理由：两种方式都能满足相同用户行为与验收结果，且不改变本规格的兼容边界。
- 标准清单校验复用外部 JSON Schema 验证器、仓库内轻量校验器还是固定 schema fixture — 归属：arch / test；推迟理由：这是验证实现选择，不改变什么算合规。

## References (参考资料)

- [Agent Plugins Specification 1.0.0](https://agent-plugins.org/specification)
- [Agent Plugins canonical plugin schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)
- [Agent Plugins compatible clients](https://agent-plugins.org/compatible-clients)
- [Codex Agent Plugins manifest loader](https://github.com/openai/codex/blob/572954683910555cbbe3034bc8a2a0aa2bc7e66a/codex-rs/core-plugins/src/agent_plugin_manifest.rs)
- [`docs/rules/agent-portability.md`](../../rules/agent-portability.md)
- [`docs/architecture/auriga-cli-dev-guide.md`](../../architecture/auriga-cli-dev-guide.md)
