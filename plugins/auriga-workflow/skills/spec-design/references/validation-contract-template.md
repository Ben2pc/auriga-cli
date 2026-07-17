# `validation-contract.md` 模板

文件化规格触发时，与 `spec.md` 配套写入同一目录。一条 VAL 是一项验收断言，不代表一个测试用例；实现阶段可以按风险展开为多个必要用例。

使用约定：

- 编号使用 `VAL-<CATEGORY>-<NNN>`；同一行为领域复用类别并连续编号。
- `Behavior` 只表达一个可观察结果，不能让两种明显不同的行为都算通过。
- `Tool` 写证据类别，例如 `unit-test`、`integration-test`、`e2e`、`runtime-probe`、`repo-check` 或 `manual`；可以采用更贴合项目的类别，不维护封闭词表。
- `Evidence` 写什么结果算通过，不写测试函数、fixture、mock、驱动或实现步骤。
- 具体测试工具由 `test-driven-development` 根据项目测试规则和现有设施决定，不在本文件复制工具链清单。

```markdown
# Validation Contract — <主题>（验收契约 — <主题>）

> 与 spec.md 配套：spec.md 描述 why + 用户可观察的 what；本文件描述什么算通过。
> 一条 VAL 不等于一个验证用例。

## Coverage map (覆盖矩阵)

| Range (范围) | VAL ids |
|---|---|
| <行为主题> | VAL-<CAT>-001 ~ NNN |

## Assertions (断言)

### VAL-CAT-001
- **Behavior (行为)**: <单一含义的用户或调用方可观察结果>
- **Tool (工具)**: <适合证明它的证据类别>
- **Evidence (判据)**: <出现什么结果才算通过>
```
