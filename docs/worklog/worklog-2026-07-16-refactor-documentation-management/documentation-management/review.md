# documentation-management 评审

## 当前职责

`documentation-management` 管理工程文档与长期上下文资产。它先识别消费者、作用域、当前信息源和生命周期，再选择更新、删除、合并、压缩、归档、晋升或新建；同时区分纯人类文档、Agent 可读工程资料、直接控制 Agent 行为的指令和双方共享资产。

本项由 `documentation-and-adrs` 重命名并扩展职责。用户明确豁免当前子规范与独立验收契约，因此本工作记录只保留正式评审证据，不补造无人消费的 spec。

## 可复现失效模式

- 文档只增加不压缩、不删除，造成事实分叉和维护成本持续上升。
- 把纯人类叙事无差别挂到根 `AGENTS.md`，污染所有 Agent 会话。
- 因为 Agent 会阅读某份架构文档或 ADR，就把它强行改写成提示词结构。
- 所有子包规则与索引集中在仓库根，局部上下文无法按作用域发现。
- 把 ADR 预设为只供人类阅读，导致 Agent 无法发现必须遵守的长期决定。

## 目标模型证据

本轮没有执行 GPT 5.6 Sol 或 Fable 5 模型评测，不把技能精简结果描述为模型能力证据。验收仅覆盖静态契约、插件发布形态和仓库验证。

## 与其他资产的关系

- `arch-design` 将已确认且长期有效的昂贵决定交给本技能沉淀为 ADR。
- `docs-sync` 继续作为 `deep-review` 的独立只读审查维度；本技能负责执行文档资产变更，不取代审查者。
- 根与子包 `AGENTS.md` 负责按作用域索引 Agent 必须读取的规则、资料与共享决定；纯人类文档不进入该索引。
- `references/document-standards.md` 只在涉及对应文档类型时按需读取，避免把写作教学常驻在主技能上下文。

## 处置结论

- Auriga 继续拥有该技能，并以 `documentation-management` 名称随 `auriga-workflow` 插件发布。
- 主技能保留资产治理流程和消费者分流，各类文档的最小规范下沉到按需参考资料。
- 首次深入评审发现 4 个阻塞问题：frontmatter 语义测试缺口、`4.0.8` 版本下限未锁定、子规范豁免与长程规则冲突、umbrella 未追踪本项。四项均在 PR #188 内修复。
- 两条非阻塞建议不纳入本轮必要修复：开发指南的一行职责摘要仍较窄，双语 README 未增加旧名称迁移说明。

## 风险与恢复条件

- **风险：触发面过宽。** 若普通代码任务频繁误触发，收窄 frontmatter 的触发描述，不删除文档治理职责。
- **风险：共享资产被滥挂到 Agent 上下文。** 若根 `AGENTS.md` 索引持续膨胀，检查是否能下沉到最近子包或改为条件式读取。
- **风险：提示词结构重新扩散到所有 Agent 可读资料。** 若架构文档、schema 或 ADR 被机械改写为目标与输出契约，恢复“资料沿用自身类型、只有行为指令使用提示词结构”的边界。
- **风险：文档治理演变为强制写文档。** 若技能持续新增无人消费的资产，重新强化“默认不新增”和单一当前信息源原则。

## 验证证据

- documentation-management 定向契约：95/95 通过。
- 全量 `npm test`：521/521 通过；SessionStart：20/20 通过；Git guards：105/105 通过。
- Codex 与 Claude Code 官方技能校验均通过。
- 真实打包后的 `auriga-workflow` 插件安装场景：1/1 通过。
- 从用户目录、工作区目录和仓库目录启动真实安装包的 Web UI，工作流状态、插件平台映射、外部插件标记、部分安装提示和缺失平台提示均符合预期。
- 完整端到端套件卡在无关的外部 `planning-with-files` 网络安装；本 PR 直接影响的打包、插件安装与界面状态已由上述独立验证覆盖。

## 参考资料

- [GPT-5.6 Prompting Guide](https://developers.openai.com/api/docs/guides/prompt-guidance-gpt-5p6)
- [PR #188](https://github.com/Ben2pc/auriga-cli/pull/188)
- `plugins/auriga-workflow/skills/documentation-management/SKILL.md`
- `plugins/auriga-workflow/skills/documentation-management/references/document-standards.md`
