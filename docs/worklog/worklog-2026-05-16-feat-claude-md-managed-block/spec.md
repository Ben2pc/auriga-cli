# CLAUDE.md 受管标记块 — Spec (可扩展且可升级的 CLAUDE.md — 规范)

> 让 auriga-cli 安装到下游工程的 CLAUDE.md 既能被工程自己扩展,又能被 auriga-cli 正常升级——把文件切成「auriga 受管区」和「工程用户区」两半。

## Why (为什么做)

auriga-cli 把工作流文档 `CLAUDE.md` 安装进下游工程,这个文件目前是 auriga 独占的:每次升级都整文件覆盖。下游工程一旦想加自己的工程专属规则(项目约定、本地命令、团队纪律),就只能直接改 `CLAUDE.md`——而下次 `auriga-cli` 升级会把这些改动连同 auriga 内容一起推进 `.bak`,活文件里全部消失,用户得手动重新合并。

结果是:**「扩展」和「升级」二选一**。要么不升级、保住自己的定制;要么升级、丢掉定制。这个 spec 要让两者共存——下游工程能在同一个 `CLAUDE.md` 里写自己的规则,而 auriga 升级只刷新它自己那部分。

方案在进入本 skill 前已经过候选比较:拆文件 + `@import`(Codex 不支持 `@import`,会让整个工作流对 Codex 消失)、分层文件(工程级、双 Agent 都原生读取的位置只有根目录一个槽位)都被双 Agent 可移植性否决。选定的是**受管标记块**:单文件,auriga 内容包在固定标记内,标记之外是用户区,升级只替换标记内的内容。

## Findings (调研发现)

- `src/workflow.ts:86`:`installWorkflow` 用 `fs.copyFileSync` 整文件覆盖目标 `CLAUDE.md`。
- `src/workflow.ts:66-84`:备份判定靠**整文件字节比对** `currentBytes.equals(sourceBytes)`;不一致即备份。backup-once 逻辑——`CLAUDE.md.bak` 已存在时改写到 `CLAUDE.md.bak.<timestamp>`,首个 `.bak` 永不被覆盖。
- `src/workflow.ts:96`:`AGENTS.md` 由 `fs.symlinkSync("CLAUDE.md", ...)` 创建,是指向 `CLAUDE.md` 的相对软链。
- `src/state.ts:262`:`WORKFLOW_HEADER_RE = /^#\s+auriga\s+Workflow\s*\(v\d+\.\d+\.\d+\)/` 是「这是不是我们的文件」的唯一识别依据。
- `src/state.ts:301-306`:`scanWorkflow` 逐行扫描,**遇到第一个非空行就 break**。受管标记注释行若排在 header 之前,会先撞上它(非空、非 header)并 break,导致 auriga 文件被误判为 `not-installed`。
- 两个语言模板:仓库根 `CLAUDE.md`(header `# auriga Workflow (v1.9.0)`)和 `CLAUDE.zh-CN.md`(`# auriga 工作流 (v1.9.0)`);语言映射在 `src/utils.ts:202` 的 `LANGUAGES` 常量。
- `tests/workflow-install.test.ts:40-50` 把「foreign CLAUDE.md → 备份到 `.bak` 且 foreign 内容不进新文件」写成了契约;`:52-134` 覆盖 backup-once 不变量。本需求改写 foreign 首装行为,这些用例需要更新。
- `installWorkflow` 的调用方:CLI 的 `workflow` 子命令(`src/cli.ts:749`)、预设流程(`src/preset.ts:105`)、Web UI 的 apply handler(`src/apply-handlers.ts:86`)。任何行为变化对三个入口一致生效。
- 双 Agent 约束:`auriga-workflow` 插件同时面向 Claude Code 与 Codex;`AGENTS.md` 软链让两者读同一物理文件。HTML 注释 `<!-- ... -->` 对两个 Agent 都是惰性内容,可安全用作标记。
- `docs/specs/` 当前为空。

## What (做什么)

### 1. 受管标记块格式 (Marker format)

`CLAUDE.md` 由一对固定标记切分为两部分:

- **受管区**:一对成对的 HTML 注释标记之间的内容,标记带 schema 版本(本次为 `v1`)。这一段是 auriga 工作流文档,auriga-cli 独占,升级会整块覆盖。标记文案需明示「请勿手改,升级会覆盖」。
- **用户区**:受管区之外的所有内容(本 spec 约定排在受管区**之后**)。工程自己的规则写在这里,auriga 升级永不改动。

标记是一份**冻结的契约**:格式一旦定下,老工程升级时要靠它定位上次写入的边界。schema 版本号给未来的格式演进留出空间。

### 2. 全新安装 (Fresh install)

装入一个**没有 `CLAUDE.md`** 的工程时,生成的文件:受管标记块在文件前部、内含 auriga 工作流文档;标记块之后是一个用户区(可为空,可带一行占位提示告诉工程「在此添加专属规则,升级不会动这里」)。不产生 `.bak`。

### 3. 升级:已是标记格式的文件 (Upgrade — marked file)

文件已含成对受管标记时,升级**只 splice 替换受管区的内容**,受管区之外(用户区)的内容**字节级原样保留**。

- 受管区与新版本一致、或仅受管区被刷新(用户未手改受管区):升级**不产生 `.bak`**——非破坏性升级是这个特性的核心。
- 检测到受管区被用户手改过:仍然替换受管区,但升级前先把**整个旧文件**快照到一份备份,并向用户发出警告(提示受管区改动已被覆盖、可从备份找回)。

### 4. Foreign 首装 (Install over a foreign CLAUDE.md)

装入一个已有 `CLAUDE.md` 但**既无 auriga header、也无受管标记**的工程(别的工具生成或手写的文件):生成的文件 = 受管标记块在前 + 原有 foreign 内容**原样作为用户区**追加在后。foreign 内容零丢失、就地可用。

### 5. 旧格式迁移 (Migration of pre-marker installs)

装入一个**有 auriga header、但无受管标记**的工程(本特性发布前由旧版 auriga-cli 安装的文件):此文件可能是纯 auriga 内容,也可能被工程手改过——但没有标记,**无法区分哪些行是用户的**。首次升级的处理:把整个旧文件备份到 `.bak`,装入全新的标记格式文件(用户区为空),并提示用户「如果你改过旧 CLAUDE.md,请从 `.bak` 把你的定制手动迁移到新文件的用户区」。这是一次性成本;迁移后所有后续升级都走第 3 节的干净路径。

### 6. 标记损坏的安全回退 (Malformed markers)

文件含**损坏的标记**(只有 START、只有 END、或 END 排在 START 之前)时,**不静默 splice**(splice 在损坏标记上会破坏内容)。走安全回退:按「不可识别格式」处理——备份后重装,绝不在无法可靠定位边界的情况下改写文件。

### 7. 安装状态识别 (Scanner)

`scanState` 对工作流的「已安装」识别必须在标记格式下继续正确:标记格式的 `CLAUDE.md`(受管标记注释行排在 auriga header 之前)要被识别为 workflow `installed`。一个只有用户区、不含受管标记、也无 auriga header 的 `CLAUDE.md` 仍按 foreign 处理(`not-installed` + warning),与现状一致。

### 8. 双语与一致性 (Bilingual & consistency)

两个语言模板 `CLAUDE.md` 与 `CLAUDE.zh-CN.md` 都要带受管标记,行为对两种语言一致。`AGENTS.md` 保持指向 `CLAUDE.md` 的软链不变。三个安装入口(CLI、预设、Web UI)行为一致。

## Out of scope (本次不做)

1. 不改 auriga 工作流文档**内容本身**——工作流步骤、原则不变,只是在外面包一对标记。
2. 不引入 `@import` 或拆文件机制——已被双 Agent 可移植性否决。
3. 不改 `AGENTS.md` 的软链形态。
4. 不做受管区**内部的逐节三方合并**——用户在受管区里的局部改动不做精细 merge,整块覆盖(见第 3 节)。
5. 不做标记 schema `v1`→未来版本的跨版本迁移——本次只引入 `v1`。
6. 不改 skills / plugins / hooks 的安装路径——本 spec 只动 workflow 文档这一类。

## Open questions (悬而未决)

1. Foreign 首装(第 4 节)在把 foreign 内容并入用户区的同时,**是否还额外写一份 `.bak` 作为冗余保险**。归属:plan。理由:这是纯安全裕度权衡,不改变「foreign 内容被保留在用户区」这条核心契约;splice/merge 万一有 bug 时多一份 `.bak` 能兜底,但也可能只是噪声。
2. 标记 schema 版本号在何种情况下从 `v1` 递增、递增后旧标记如何被识别与兼容。归属:plan。理由:本次只落地 `v1`,跨版本标记兼容是未来问题;现在定死规则会过度约束。

## References (参考资料)

无。
