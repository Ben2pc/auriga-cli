# Validation Contract — Quality Gate Scaffolder Plugin (验收契约 — 质量门禁脚手架插件)

> 与 spec.md 配套：spec.md 描述 why+what；本文件描述"什么算通过"。
> 每条 VAL 只描述 Behavior + Tool + Evidence；测试设计 (函数组织 / fixture / mock) 是 `test-designer` 的活。

## Coverage map (覆盖矩阵)
| Range (范围) | VAL ids |
|---|---|
| 插件与 skill 外部表面 | VAL-PLUG-001 ~ VAL-PLUG-005 |
| 技术栈 scope 与三层工作流 | VAL-SKIL-001 ~ VAL-SKIL-004 |
| 用户确认与落地安全 | VAL-LAND-001 ~ VAL-LAND-004 |
| 参考经验与验证证据 | VAL-REF-001 ~ VAL-REF-004 |

## Toolchain (本仓库验证栈)
> A1 调研所得的既成事实，不是本次功能的实现决策。只填本契约 VAL 实际用到的类别；test-designer 据此免去重新推断该用哪个运行器 / 驱动。

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| repo-check | 文件存在性、manifest 内容、skill frontmatter 和引用关系检查；可结合 `rg`、`jq`、`find` 或仓库测试实现 |
| lint | skill frontmatter 可用 `skill-creator` 的 `quick_validate.py` 验证；插件 manifest 和 marketplace 形态按现有插件测试或仓库测试验证 |
| manual | 通过一次真实或模拟的 agent 使用流程确认：skill 先分层确认，再经用户同意后落地 |

## Assertions (断言)

### VAL-PLUG-001
- **Behavior (行为)**: 仓库中存在一个对外名为 `quality-gate-scaffolder` 的插件。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 插件 manifest 或 marketplace 条目能被定位，名称与 `quality-gate-scaffolder` 完全一致。

### VAL-PLUG-002
- **Behavior (行为)**: 插件暴露 `scaffold-swift-ios-quality-gates` skill。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 对应 skill 存在，frontmatter 名称完全一致，description 明确包含 Swift、iOS、质量门禁脚手架语义。

### VAL-PLUG-003
- **Behavior (行为)**: 插件暴露 `scaffold-kotlin-android-quality-gates` skill。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 对应 skill 存在，frontmatter 名称完全一致，description 明确包含 Kotlin、Android、质量门禁脚手架语义。

### VAL-PLUG-004
- **Behavior (行为)**: 插件暴露 `scaffold-python-backend-quality-gates` 和 `scaffold-typescript-frontend-quality-gates` 两个 skill。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 两个 skill 均存在，frontmatter 名称完全一致，description 分别明确包含 Python 后端、TypeScript 前端和质量门禁脚手架语义。

### VAL-PLUG-005
- **Behavior (行为)**: 插件暴露 `scaffold-node-tool-quality-gates` skill。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 对应 skill 存在，frontmatter 名称完全一致，description 明确包含 Node 工具、命令行或本地服务、质量门禁脚手架语义。

### VAL-SKIL-001
- **Behavior (行为)**: 每个 skill 都明确限制自己的技术栈 scope，不声称支持未验证语言或框架。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 五个 skill 的说明中均能找到支持范围和不支持范围；不出现“任意语言”“所有前端”“所有后端”等无边界表述。

### VAL-SKIL-002
- **Behavior (行为)**: 每个 skill 都以“检查工具、检查规则、调用时机”三层引导 agent 调研和确认目标仓库门禁。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 五个 skill 的正文均包含这三层，且每层都说明 agent 需要与用户确认的输出。

### VAL-SKIL-003
- **Behavior (行为)**: 每个 skill 都要求识别元门禁或防漂移机制，而不只列出 lint/test 命令。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 五个 skill 的规则层说明均包含元门禁、防漂移、不变量或等价概念，并要求记录其验证方式。

### VAL-SKIL-004
- **Behavior (行为)**: 每个 skill 都要求把远端合入规则作为调用时机或合入外壳的一部分检查。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 五个 skill 都要求检查 required status checks、conversation resolution、code owner review、merge method 或等价远端合入策略。

### VAL-LAND-001
- **Behavior (行为)**: 用户确认前，skill 不允许直接写入目标仓库的门禁文件。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 五个 skill 都明确写出“先确认后落地”的流程，且没有鼓励未确认直接修改目标仓库的表述。

### VAL-LAND-002
- **Behavior (行为)**: 用户确认后，skill 能帮助落地脚手架，而不是只停留在建议清单。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 五个 skill 都明确说明确认后可以生成或修改目标仓库中的质量脚本、规则文档、Git hooks、GitHub Actions 或元门禁测试。

### VAL-LAND-003
- **Behavior (行为)**: skill 在落地后必须要求报告已运行验证和未完成外部配置。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 五个 skill 都要求最终输出包含已运行检查、未运行原因、需要用户在 GitHub 或其他外部系统中手动完成的配置。

### VAL-LAND-004
- **Behavior (行为)**: 远端 GitHub 写操作必须被视为高风险外部状态变更，不能静默执行。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 五个 skill 或共享说明均要求对 ruleset、Secrets、Variables、branch protection 等远端状态写操作先取得用户确认。

### VAL-REF-001
- **Behavior (行为)**: Swift iOS skill 保留 CurioSea iOS 质量门禁经验作为参考来源。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: Swift iOS skill 或其引用材料覆盖 affected dispatcher、SwiftLint、Swift Package 边界、本地化、设计 token、合并后重型门禁这些经验点。

### VAL-REF-002
- **Behavior (行为)**: Kotlin Android skill 保留 CurioSea Android 质量门禁经验作为参考来源。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: Kotlin Android skill 或其引用材料覆盖 affected planner、Gradle 门禁、模块边界、截图预览契约、本地化、required workflow 不变量、定时回归这些经验点。

### VAL-REF-003
- **Behavior (行为)**: Python 后端和 TypeScript 前端 skill 保留 LingoLens 对应门禁经验作为参考来源。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: Python 后端 skill 覆盖 uv workspace、ruff、mypy、import-linter、pytest gate、出网拦截、Celery task 注册、部署门禁；TypeScript 前端 skill 覆盖 Biome、ESLint 类型感知规则、TypeScript、Vitest、lint 配置元门禁和服务层边界。

### VAL-REF-004
- **Behavior (行为)**: Node 工具 skill 保留 `lark-connect` 前向验证样本作为参考来源，但不把它当成唯一生产经验来源。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: Node 工具 skill 或其引用材料覆盖 Node 原生语法检查、原生测试、命令行入口、包发布形态、运行时配置和敏感环境变量边界，并明确 Node 工具不应直接套用网页前端规则。
