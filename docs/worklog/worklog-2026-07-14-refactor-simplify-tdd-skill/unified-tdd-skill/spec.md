# 统一最简测试驱动开发技能 — Spec (统一最简测试驱动开发技能 — 规范)

> 用一个 Auriga 自有的最简测试驱动开发技能，替代外部 Superpowers 版本与 `test-designer` 入口。

## Why (为什么做)

新一代编码模型已经普遍具备测试先行、红绿循环和回归验证的基础能力。继续加载一份长篇、绝对化的测试驱动开发技能，会重复模型已有知识，并诱导代理为了遵守流程而增加测试数量，而不是选择最有价值的失败证据。

当前外部技能要求所有功能、缺陷修复和重构都严格先写失败测试；若实现先出现，甚至要求删除后重来。Auriga 为补足它的测试设计能力，又增加了 `test-designer`，要求最高推理强度、五类场景覆盖、可执行失败测试和十二项交付检查。两者叠加后，容易产生低价值用例，尤其是只断言说明文字、提示词措辞或内部实现细节的测试。

Auriga 仍需要一个很小的测试入口，用于提醒代理选择有意义的行为接缝、建立正确的失败证据并以纵向小切片推进；但它不应重新教授完整的测试驱动开发理论。

## Findings (调研发现)

- `.agents/skills/test-driven-development/SKILL.md` 来自 `obra/superpowers`，主文件约 279 行有效内容；它把测试驱动开发设为所有代码变更的绝对流程，并要求删除先于测试出现的实现。
- `plugins/auriga-workflow/skills/test-designer/SKILL.md` 是外部技能的补充层；它要求最高推理强度、五类场景覆盖、可执行失败测试和十二项交付检查，再把结果交回外部测试驱动开发技能。
- `AGENTS.template.zh-CN.md` 与 `AGENTS.template.en.md` 同时强制外部测试驱动开发技能，并在复杂场景调用 `test-designer`；同一测试纪律由两个入口共同承担。
- `plugins/auriga-workflow/skills/deep-review/references/reviewers/test-quality.md` 已在拉取请求阶段独立检查测试层级、行为断言、模拟边界和覆盖缺口；测试质量仍有事后独立评估入口。
- `skills-lock.json` 与 `src/skills.ts` 把外部 `test-driven-development` 作为预设核心技能安装；`test-designer` 则由 `auriga-workflow` 插件发布。
- Matt Pocock 的 `tdd` 技能把重点收缩到公共接口、预先选择测试接缝、纵向小切片、行为断言和只在系统边界模拟；其主文件约 22 行有效内容，但“每次写测试前都向用户确认接缝”仍会增加不必要的交互。
- 仓库不存在 `docs/rules/spec/`，本子规范没有额外的项目专属规范规则。

## What (做什么)

### 1. 收敛为一个自有入口

Auriga 只提供一个自有的 `test-driven-development` 技能。外部 Superpowers 版本不再属于预设或锁定技能，独立的 `test-designer` 入口退出工作流。

### 2. 只保留最小且非显然的测试纪律

技能从验收契约、缺陷事实和项目测试规则出发，选择能验证可观察行为的最小测试接缝。在存在有价值接缝时，先建立因目标行为缺失而失败的证据，再写最小实现，并在每个纵向小切片后回归验证。

技能不要求为了仪式删除已有实现，也不把所有代码改动都强制转换成同一种红绿循环。纯文档、纯配置、生成代码、机械变更，以及不存在有效自动化接缝的场景，可以采用与风险相称的其他验证方式。

### 3. 保留高价值测试设计原则

测试优先验证公共接口上的行为，选择能捕捉目标风险的最低有效层级，并只在系统边界模拟外部依赖。测试应围绕当前行为纵向推进，不预先批量编写对想象中实现结构的断言。

不为满足流程而新增只验证说明文字、提示词措辞、私有辅助方法或内部调用顺序的测试。只有当文本本身属于机器解析协议、稳定文件格式或用户可见契约时，文本断言才构成有效行为验证。

### 4. 同步工作流与发布表面

工作流模板、技能清单、安装说明、相关技能之间的引用和长期评审状态必须统一指向新的自有技能。旧外部副本由小团队在确认插件版本可用后人工清理，安装器不自动迁移或删除。

## Out of scope (本次不做)

- 不为 GPT 5.6 Sol 或 Fable 5 建立模型评测样本；本次结论来自用户使用经验、资产对照和职责分析。
- 不重写完成前验证或拉取请求测试质量审查的整体职责，只同步因技能收敛产生的引用和边界。
- 不引入新的测试框架、覆盖率指标或通用测试目录规范。
- 不自动删除已安装的外部技能副本，也不恢复自动迁移状态机。

## Open questions (悬而未决)

1. 技能正文中保留多少示例、哪些细节留给项目级测试规则，由实现阶段在“最小上下文成本”约束下决定；推迟是因为这属于内容组织而非行为契约。

## References (参考资料 — 可选；澄清期间用户给过任何外链时必填)

- [Superpowers `test-driven-development`](https://github.com/obra/superpowers/blob/main/skills/test-driven-development/SKILL.md)：当前外部版本，用于识别绝对化流程和重复内容。
- [Matt Pocock `tdd`](https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/SKILL.md)：对照公共接口、测试接缝和纵向小切片原则。
- [Matt Pocock `tests.md`](https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/tests.md)：对照行为测试与实现细节测试的边界。
- [Matt Pocock `mocking.md`](https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/mocking.md)：对照只在系统边界模拟的原则。
- `docs/long-running-specs/model-generation-workflow-upgrade/`：本子规范所属的跨拉取请求总规范。
