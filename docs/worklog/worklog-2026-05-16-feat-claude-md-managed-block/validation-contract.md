# Validation Contract — CLAUDE.md 受管标记块 (验收契约 — 可扩展且可升级的 CLAUDE.md)

> 与 spec.md 配套:spec.md 描述 why+what;本文件描述「什么算通过」。
> 每条 VAL 只描述 Behavior + Tool + Evidence;测试设计 (函数组织 / fixture / mock) 是 `test-designer` 的活。

## Coverage map (覆盖矩阵)
| Range (范围) | VAL ids |
|---|---|
| 安装 / 升级行为(workflow.ts) | VAL-WF-001 ~ 011 |
| 安装状态识别(state.ts scanner) | VAL-SCAN-001 ~ 002 |

## Toolchain (本仓库验证栈)
> A1 调研所得的既成事实,不是本次功能的实现决策。只填本契约 VAL 实际用到的类别。

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| `unit-test` | `node:test`——`tsc -p tsconfig.test.json` 编译到 `dist-test/` 后 `node --test`。测试文件在 `tests/` 下并手动登记进 `package.json` 的 `test` 脚本白名单;workflow / scanner 测试用 `os.tmpdir()` scratch 目录做文件系统断言(见 `tests/workflow-install.test.ts`、`tests/state.test.ts`)。 |

## Assertions (断言)

### VAL-WF-001
- **Behavior (行为)**: 装入一个没有 `CLAUDE.md` 的工程后,生成的文件含一对成对的受管标记(标记带 schema 版本标识),auriga 工作流文档位于标记内,受管标记块位于文件前部。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 安装后的 `CLAUDE.md` 同时含 START 与 END 标记;标记串带版本标识;auriga header 出现在两个标记之间;START 标记之前没有其它非空内容。

### VAL-WF-002
- **Behavior (行为)**: 全新安装后,受管 END 标记之后存在一个用户区(允许为空或仅含占位提示),该区不在受管标记内。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: END 标记之后的文件区段可被定位;若模板带占位提示,该提示文本出现在 END 标记之后。

### VAL-WF-003
- **Behavior (行为)**: 对一个已是标记格式、且受管区未被手改的 `CLAUDE.md` 升级后,受管区内容被替换为新版本,而受管标记之外的用户区内容字节级原样保留。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 升级前在用户区写入一段可识别文本;升级后该段文本在新文件中字节级不变;受管区内容等于新版本的 auriga 文档。

### VAL-WF-004
- **Behavior (行为)**: 对标记格式、受管区未被手改的文件做升级(happy path)不产生任何备份文件。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 升级后目标目录不存在 `CLAUDE.md.bak` 及 `CLAUDE.md.bak.<timestamp>` 文件(且升级前也不存在)。

### VAL-WF-005
- **Behavior (行为)**: 升级时检测到受管区被用户手改过,仍然替换受管区,但升级前先把整个旧文件快照到一份备份,并向用户发出警告。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 构造一个受管区被改动的标记格式文件并升级;升级后受管区等于新版本;存在一份备份文件,其内容等于升级前的整个旧文件;有一条面向用户的警告输出。

### VAL-WF-006
- **Behavior (行为)**: 装入一个已有 `CLAUDE.md`、既无 auriga header 也无受管标记的 foreign 工程后,生成的文件 = 受管标记块在前 + 原 foreign 内容原样作为用户区追加在后;foreign 内容零丢失。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 安装前写入一段可识别的 foreign 文本;安装后该段文本字节级出现在 END 标记之后;受管区含 auriga 文档。

### VAL-WF-007
- **Behavior (行为)**: 装入一个有 auriga header 但无受管标记的旧格式工程(本特性发布前安装的文件),首次升级把整个旧文件备份到 `.bak`,装入全新的标记格式文件(用户区为空),并提示用户从 `.bak` 手动迁移其定制。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 构造一个有 auriga header、无标记的文件并升级;升级后 `CLAUDE.md.bak` 内容等于旧文件;新 `CLAUDE.md` 含成对受管标记;有一条提示用户迁移定制的输出。

### VAL-WF-008
- **Behavior (行为)**: 上述任何产生备份的路径都不覆盖已存在的首个 `CLAUDE.md.bak`——首个 `.bak` 保持不变,当次内容改写到带时间戳的备份槽。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 预置一个已有 `CLAUDE.md.bak`,触发一条会备份的路径(如 VAL-WF-005 / VAL-WF-007);备份后原 `CLAUDE.md.bak` 字节不变,新增一个 `CLAUDE.md.bak.<timestamp>` 文件承载当次内容。

### VAL-WF-009
- **Behavior (行为)**: 文件含损坏的受管标记(只有 START、只有 END、或 END 排在 START 之前)时,安装不在损坏标记上做 splice,而是走安全回退——按不可识别格式处理(备份后重装),不改写无法可靠定位边界的文件。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 分别构造三种损坏标记的文件并安装;无任一情形把原文件内容静默截断或破坏;原内容被保留进备份;新文件含一对完整成对的受管标记。

### VAL-WF-010
- **Behavior (行为)**: 安装后 `AGENTS.md` 仍是指向 `CLAUDE.md` 的软链,形态与现状一致。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 安装后 `AGENTS.md` 经 `lstat` 判定为符号链接,且链接目标为 `CLAUDE.md`。

### VAL-WF-011
- **Behavior (行为)**: 两种语言模板(`lang=en` 的 `CLAUDE.md` 与 `lang=zh-CN` 的 `CLAUDE.zh-CN.md`)安装后都带成对受管标记,标记块行为对两种语言一致。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 分别以 `en` 与 `zh-CN` 安装;两种产物都含成对受管标记,且各自的 auriga 文档位于标记内。

### VAL-SCAN-001
- **Behavior (行为)**: 一个标记格式的 `CLAUDE.md`(受管标记注释行排在 auriga header 之前)被 `scanState` 识别为 workflow `installed`。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 对一个标记块在前、auriga header 在标记内的 `CLAUDE.md` 调用 `scanState`,返回的 workflow 状态为 `installed`。

### VAL-SCAN-002
- **Behavior (行为)**: 一个既无受管标记、也无 auriga header 的 `CLAUDE.md` 仍被 `scanState` 按 foreign 处理——状态 `not-installed` 并产生 foreign 警告,与现状一致。
- **Tool (工具)**: `unit-test`
- **Evidence (判据)**: 对一个无标记、无 header 的 `CLAUDE.md` 调用 `scanState`,workflow 状态为 `not-installed`,且 warnings 含 `workflow-foreign-claudemd`。
