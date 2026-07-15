---
name: reviewer-creator
description: "当用户要求创建自定义审查者、添加项目专属审查者、扩展 deep-review，或调用 /reviewer-creator 时使用；在 docs/rules/review/ 下生成结构规范的审查者文件。"
---

# Reviewer Creator

为 `deep-review` 创建项目级审查者。产物写入 `<仓库根>/docs/rules/review/<name>.md`，由 `deep-review` 自动发现。

## 什么时候使用

- 项目有内置审查维度未表达的专属规则；
- 某个内置维度需要结合项目架构、平台或业务进一步收窄；
- 用户显式调用 `/reviewer-creator`。

通用检查已经被内置审查者覆盖、且没有项目专属判断时不要创建文件。

## 先确定定位

每个项目审查者必须明确选择一种定位：

1. **补充内置维度**：写 `extends: <内置名>`，与宿主在同一干净上下文内执行，不额外占用审查代理。
2. **全新独立维度**：写 `extends: standalone`，仅当以下十个内置维度确实都不覆盖时使用。

内置名称：`spec-conformance`、`correctness`、`test-quality`、`docs-sync`、`security`、`ux`、`performance`、`architecture`、`code-quality`、`skill-plugin-quality`。

不要省略 `extends` 让调度器猜测正文语义。自定义 `name` 也不要与内置名称重名，避免来源标注含糊。

## Frontmatter schema

**必填：**

- `name`：kebab-case，必须等于文件名；
- `best_for`：一句话说明此项目规则最适合发现什么；
- `extends`：一个内置名称或 `standalone`；
- `trigger`：见下方触发条件；
- `reasoning`：`flagship` 或 `workhorse`；
- `tools`：默认 `[Read, Grep, Glob]`，确需运行只读验证再加 `Bash`；
- `value`：说明它比宿主通用检查多防住什么项目风险。

**可选：**

- `effort`：只有项目规则确实需要覆盖默认投入时设置，不把模型名写死。

合法 `trigger`：

- `always`
- `tag:executable-behavior`
- `tag:executable-behavior-or-tests`
- `tag:maintained-code`
- `tag:security-sensitive`
- `tag:ui`
- `tag:performance-sensitive`
- `tag:architecture`
- `tag:agent-extension`
- `detection-driven`（正文必须给出可机械识别的检测条件）

补充型审查者的 trigger 与宿主 trigger 取并集：任一命中都会运行宿主与项目补充。

## 流程

### 1. 收集规则来源

让用户提供要执行的项目约定、适用路径、例外和至少一个会被漏掉的实际例子。优先引用仓库已有规范，不把口头偏好扩写成通用最佳实践。

### 2. 选择宿主与触发条件

先问“这是哪个内置维度的项目专属补充，还是全新独立维度”。补充型选择最接近最终判断责任的宿主；不是按文件类型机械选择。

触发条件要描述差异中的事实或风险表面。`always` 只用于几乎所有正式拉取请求都必须检查的项目契约。

### 3. 设计检查清单

保留足以让较低档审查模型执行的细节：

- 5–10 条具体审查问题；
- 检测表，说明差异出现什么信号时关注什么；
- 2–3 个真实场景，至少一个说明“不应报告”的边界；
- 每条发现所需证据和影响；
- 清晰的输出字段。

不要把固定行数、固定次数或个人风格写成缺陷。确有阈值时说明它来自哪个项目预算或规则。

### 4. 写入文件

定位根目录并创建目录：

```bash
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
mkdir -p "$repo_root/docs/rules/review"
```

按 `references/template.md` 写入 `<仓库根>/docs/rules/review/<name>.md`。正文用项目对话语言，frontmatter 键保持模板格式。

### 5. 验证

- YAML frontmatter 能解析，所有必填字段存在；
- `name` 与文件名一致，`extends` 指向合法宿主或 `standalone`；
- `trigger` 合法，检测表与它一致；
- 引用的项目文件和命令存在；
- 用一个应命中和一个不应命中的差异场景手工走查；
- 运行仓库中针对项目审查者协议的测试或校验器。

返回文件路径、定位、触发条件和验证证据。

## Anti-patterns

- 用一个全新审查者重复内置检查，制造同一行的重复发现。
- `extends` 缺失或非法，期待主调度器读取正文猜宿主。
- 为了减少代理数量，把真正独立的治理维度硬塞进不相关宿主。
- 检查清单只有“是否符合最佳实践”之类抽象问题。
- 把安全利用风险写进结构质量审查，或反过来只检查插件 schema 而漏掉执行能力。
- 未验证 frontmatter 和触发条件就宣称创建完成。
