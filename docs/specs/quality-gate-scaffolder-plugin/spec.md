# Quality Gate Scaffolder Plugin — Spec (质量门禁脚手架插件 — 规范)

> 创建一个技术栈优先的脚手架插件，把 CurioSea 已验证工程的硬门禁经验沉淀成可复用的 agent 工作流，并通过 Node 工具仓库前向验证补齐覆盖缺口。

## Why (为什么做)

CurioSea 当前已经在 iOS、Android、LingoLens 后端和 LingoLens 前端四个工程里落地了一套“软规范 + 硬门禁”的组合：`AGENTS.md` 和 `auriga-workflow` 负责工作纪律，脚本、Git hooks、GitHub Actions、远端 ruleset 和 review thread 负责真正阻塞违规合入。

这些经验已经证明有效，但目前分散在四个工程里。后续新工程或外部工程要复用时，agent 需要重新调研、重新判断哪些门禁适用，容易遗漏关键取舍，例如 required check 不能随便使用路径过滤、lint 配置本身要有元门禁、AI review 的 inline comment 要配合 conversation resolution 才能真正阻塞合入。

本需求要把这些经验沉淀成一个脚手架插件。插件不是泛化到所有技术栈的“万能门禁生成器”，而是先覆盖当前已验证的四类生产级技术栈：纯 Swift iOS、Kotlin Android、Python 后端、TypeScript 前端；同时通过 `lark-connect` 前向验证补充 Node 工具、命令行和本地服务仓库路径。每个 skill 都应先引导 agent 和用户逐项确认要落地的内容，再帮助完成落地。

## Findings (调研发现)

- `plugins/auriga-workflow/.codex-plugin/plugin.json` 已展示现有插件形态：一个插件可以同时发布多个 workflow skill，并携带 hooks。
- `plugins/auriga-workflow/skills/` 已有多个流程型 skill，适合作为新脚手架 skill 的结构参考。
- `CurioSea-iOS/Tools/Quality/` 将检查器、自测和 affected dispatcher 放在同一质量域下；`CurioSea-iOS/.github/workflows/pr-quality-checks.yml` 与 `swift-package-gates.yml` 分别承载 PR 阶段和合并后重型门禁。
- `CurioSea-Android/tools/quality/` 将 shell 薄入口、Kotlin 规划器、截图预览契约检查、workflow 不变量自测放在同一质量域下；`CurioSea-Android/.github/workflows/pr-quality-checks.yml` 明确 required check 不得使用路径过滤。
- `lingolens/tools/quality/run_gates.sh` 和 `lingolens/tools/quality/planner.py` 是前后端门禁的单一执行入口和路径映射入口，`lingolens/backend/tools/quality/gate_*.py` 承载后端工程约束。
- `lingolens/frontend/src/gateLintConfig.test.ts` 是前端 lint 配置的元门禁，专门锁住 Biome 与 ESLint 的职责分工、严格参数和 `axios` 出口规则。
- `lark-connect` 前向验证暴露出一个覆盖缺口：Node 命令行工具、本地守护进程和 MCP 服务不应套用网页前端规则；它们需要保护 `node --check`、`node --test`、命令行入口、包发布形态和敏感环境变量边界。
- `github-action-research/code-review-templates/` 已经沉淀了 Claude Code 与 Codex 两套代码审查工作流模板，核心经验是将 blocking finding 发布为可解决的 inline review thread。
- 2026-06-13 通过 `gh ruleset list` 和 `gh api repos/.../rulesets/...` 验证：三个目标仓库的 main ruleset 均已启用 required status checks、conversation resolution、code owner review、禁止删除、禁止非快进和 squash-only 合并。
- 当前 `auriga-cli` 仓库没有发现 `docs/rules/spec/` 下的项目专属 spec 规则。

## What (做什么)

### 1. 插件形态

新增一个名为 `quality-gate-scaffolder` 的插件。该插件包含五个技术栈优先命名的脚手架 skill：

- `scaffold-swift-ios-quality-gates`：面向纯 Swift / Swift Package Manager / iOS 工程。
- `scaffold-kotlin-android-quality-gates`：面向 Kotlin / Gradle / Android 工程。
- `scaffold-python-backend-quality-gates`：面向 Python 后端工程。
- `scaffold-typescript-frontend-quality-gates`：面向 TypeScript 前端工程。
- `scaffold-node-tool-quality-gates`：面向 Node.js 命令行工具、本地守护进程、MCP 服务或轻量 JavaScript/TypeScript 工具仓库。

五个 skill 的名称、描述和触发语义必须明确表达技术栈边界，避免让 agent 误以为它们适用于未验证的混合栈或其他语言框架。

### 2. 三层门禁引导

每个 skill 都以三层模型组织脚手架工作：

1. 检查工具层：确认目标仓库已有或需要新增的检查器、脚本、配置、调度器、GitHub workflow、远端 ruleset 和 agent hook。
2. 检查规则层：确认这些工具要强制的规则，包括基础质量、架构边界、平台契约、元门禁、防漂移规则、例外和成本取舍。
3. 调用时机层：确认这些检查在 SessionStart、pre-commit、pre-push、PR Ready、push main、定时任务、manual dispatch、AI review 或远端合入规则中的触发位置。

这三层是所有 skill 的共同语言。不同技术栈可以有不同工具和规则，但不能跳过层级确认。

### 3. 用户确认后落地

每个 skill 必须先根据目标仓库现状、当前四个 CurioSea 生产级工程经验，以及 Node 工具前向验证样本给出候选落地内容，再让用户确认哪些内容要落地。用户确认前，skill 不能直接把门禁脚本、workflow、hook 或远端规则写进目标仓库。

用户确认后，skill 可以帮助完成落地，包括生成或修改目标仓库中的质量脚本、规则文档、Git hooks、GitHub Actions、元门禁测试和必要的说明文档。落地过程必须保留可审查的差异，并在结束时说明哪些检查已经运行、哪些需要用户在外部系统中手动配置。

### 4. 经验来源与边界

五个 skill 必须以内置参考材料或明确指引保留经验来源：

- Swift iOS skill 参考 CurioSea iOS 的 quality dispatcher、SwiftLint、Swift Package 边界、本地化、设计 token、合并后重型门禁。
- Kotlin Android skill 参考 CurioSea Android 的 affected planner、Gradle 门禁、模块边界、截图预览契约、本地化、required workflow 不变量、定时回归。
- Python backend skill 参考 LingoLens 后端的 uv workspace、ruff、mypy、import-linter、pytest gate、出网拦截、Celery task 注册、部署门禁。
- TypeScript frontend skill 参考 LingoLens 前端的 Biome、ESLint 类型感知规则、TypeScript、Vitest、lint 配置元门禁和服务层边界。
- Node tool skill 参考 `lark-connect` 的前向验证样本，覆盖 Node 原生语法检查、原生测试、命令行入口、包发布形态、运行时配置和敏感环境变量边界。

这些参考必须作为“已验证模式”提供给 agent，而不是让 agent 从零重新发现。

## Out of scope (本次不做)

- 不支持未验证技术栈，例如 React Native、混合 Swift/Objective-C、Java Android、Go/Rust 后端，或不属于网页前端、后端服务、移动端、Node 工具的其他栈。
- 不做一个跨所有语言的通用门禁生成器。
- 不默认替目标仓库配置 GitHub Secrets、Variables、ruleset 或 branch protection；这类远端状态只能在用户确认后由后续步骤处理。
- 不替代 `auriga-workflow` 的需求澄清、计划、分支、提交、PR Ready 和 deep-review 生命周期规则。
- 不保证脚手架一次性生成的门禁无需人工调整；第一版目标是把当前经验转成可确认、可审查、可落地的起点。

## Open questions (悬而未决)

1. 插件最终是作为独立插件发布，还是并入 `auriga-cli` 的现有 marketplace；归属 plan 阶段，因为这影响目录结构、版本管理和 marketplace 配置，不影响用户可见能力。
2. 五个 skill 的参考材料以 `references/` 文档、模板资产、脚本资产，还是三者组合承载；归属 plan 阶段，因为这属于实现组织形式。
3. GitHub ruleset 的落地是生成人工 checklist，还是提供可选的 `gh` 命令辅助；归属 plan 阶段，因为远端写操作需要更细的安全边界和确认流程。

## References (参考资料 — 可选；澄清期间用户给过任何外链时必填)

- 无外部链接。本 spec 基于当前工作区四个生产级工程、`lark-connect` 前向验证样本和 `github-action-research/code-review-templates/` 的本地调研。
