# Agent 可移植性 —— 编写技能与插件的约定

auriga-cli 的技能和插件要服务使用**不同编码 Agent** 的同事 —— Claude Code、Codex、Gemini。`auriga-workflow` 插件本身就是显式双 Agent(Claude Code + Codex)。任何"默认 Agent 就是 Claude"的散文或工具假设,都会让其他运行时的同事踩坑。

编辑 `plugins/<name>/` 下任何内容(`SKILL.md`、`references/`、`README.md`、审查者文件)时,遵守下列约定。

## 约定

1. **"Claude" 不是 "the agent" 的同义词。** 泛指 Agent 时写 "the Agent" / "the agent";"Claude" / "Claude Code" 只留给*确实只对该运行时成立*的陈述。

2. **Claude 独有的工具名要成对写出 Codex 对应物。** 只有 Claude Code 暴露的工具名,必须并列 Codex 的等价工具 —— 例如 `AskUserQuestion` / `request_user_input`。只写 Claude 那个名字,Codex Agent 就无工具可调。

3. **写行为概念,不写 Claude 专属的参数语法。** 表达可移植的*概念*,运行时专属语法只作举例。例如写"each parallel writer in its own git worktree"(git 原生、可移植),而不是把 `Agent` 工具的 `isolation: "worktree"` 参数当成指令本身。

4. **把功能归因到某个 Agent 之前先核实。** 共有功能不可误标 —— 例如 `/goal` 在 Claude Code 和 Codex 都内建,"Claude Code 内建的 /goal" 是错的。

5. **项目指令文件优先写成 `AGENTS.md`,必要时再补 `CLAUDE.md` 兼容入口。** Codex 原生项目可能只带 `AGENTS.md`;只写 `CLAUDE.md` 会让指令在那种项目里找不到文件。

6. **散文里不枚举 Agent。** "粘回 Claude / Codex" 会随第三个 Agent 的出现而过期 —— 写 "the Agent"。

## 合理例外

下列是真正的 Agent 专属,保留它们是正确的,不算违反约定:

- **成对的分运行时实现** —— `analyzers/claude-code.mjs` 配 `analyzers/codex.mjs`、`.claude-plugin/` 配 `.codex-plugin/` manifest。
- **`${CLAUDE_PLUGIN_ROOT}`** —— Codex 故意镜像了这个替换,两端通用,无需改写。
- **设计上就锁定单一 Agent 的技能/插件** —— 例如 `auriga-notify` 按设计仅 Claude Code。这种情况要在描述里**明确写出该范围**,不要假装可移植。

## 背景

本约定从 PR #127 沉淀。当时一次普查发现 `auriga-workflow` 的多个技能在散文与工具引用上默认 Agent 是 Claude Code,会让 Codex / Gemini 同事踩坑。检查项即上面四类:散文写死、Claude 独有工具、功能误归因、只写 `CLAUDE.md` 不写 `AGENTS.md`。
