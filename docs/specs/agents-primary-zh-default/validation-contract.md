# Validation Contract — AGENTS.md 主文件与中文默认安装 (验收契约 — AGENTS.md 主文件与中文默认安装)

> 与 spec.md 配套：spec.md 描述 why+what；本文件描述"什么算通过"。
> 每条 VAL 只描述 Behavior + Tool + Evidence；测试设计 (函数组织 / fixture / mock) 是 `test-designer` 的活。

## Coverage map (覆盖矩阵)
| Range (范围) | VAL ids |
|---|---|
| 文件形态与迁移 | VAL-FILE-001 ~ 008 |
| 默认语言 | VAL-LANG-001 ~ 006 |
| 状态扫描与文案 | VAL-SCAN-001 ~ 002, VAL-DOC-001 ~ 003 |
| 发布包与端到端安装 | VAL-PACK-001 ~ 002 |

## Toolchain (本仓库验证栈)
> A1 调研所得的既成事实，不是本次功能的实现决策。只填本契约 VAL 实际用到的类别；test-designer 据此免去重新推断该用哪个运行器 / 驱动。

| Category (类别) | This repo's concrete tool (本仓库具体工具) |
|---|---|
| `unit-test` | `node:test`。`npm test` 先运行 `tsc -p tsconfig.test.json`,再执行 `dist-test/tests/*.test.js`;工作流安装、状态扫描、命令行解析、apply handler 都已有对应测试文件。 |
| `repo-check` | 文件系统断言。既有测试用 `fs.lstatSync`、`fs.readlinkSync`、`fs.readFileSync` 和临时目录检查安装后的文件形态、备份文件和文案内容。 |
| `build` | `npm run build` 与 `tests/tarball-shape.test.ts`。发布包只携带 `dist/*` 和 npm 默认文件,运行时内容依赖 GitHub tag 拉取与 build-time catalog。 |
| `e2e-cli` | `npm run test:e2e`。该套件打真实 npm tarball,在 scratch 项目中运行 `auriga-cli install` 并检查落盘结果。 |
| `manual` | 人工检查 README、帮助文本、指南和网页文案是否统一表达新契约。仅用于文案语义,不替代自动化测试。 |

## Assertions (断言)

### VAL-FILE-001
- **Behavior (行为)**: 全新安装工作流后,目标项目根目录存在实体 `AGENTS.md`,该文件包含 auriga 受管块和用户区。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 对安装后的 `AGENTS.md` 执行 `lstat` 不是符号链接;读取内容能解析出成对的 `AURIGA:WORKFLOW:v1 START/END` 标记;用户区存在。

### VAL-FILE-002
- **Behavior (行为)**: 全新安装工作流后,`CLAUDE.md` 是指向 `AGENTS.md` 的相对软链。
- **Tool (工具)**: repo-check
- **Evidence (判据)**: 对安装后的 `CLAUDE.md` 执行 `lstat` 是符号链接,`readlink` 结果为 `AGENTS.md`。

### VAL-FILE-003
- **Behavior (行为)**: 全新安装工作流不产生实体 `CLAUDE.md`,也不产生任何 `.bak` 备份文件。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: fresh install 场景中 `CLAUDE.md` 只能是软链;目录下不存在 `AGENTS.md.bak`、`CLAUDE.md.bak` 以及对应时间戳备份。

### VAL-FILE-004
- **Behavior (行为)**: 旧形态项目存在实体 `CLAUDE.md` 与 `AGENTS.md -> CLAUDE.md` 时,再次安装会自动翻转成 `AGENTS.md` 实体文件与 `CLAUDE.md -> AGENTS.md` 软链。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: 安装后 `AGENTS.md` 不是符号链接且含受管块;`CLAUDE.md` 是指向 `AGENTS.md` 的软链;旧 `AGENTS.md -> CLAUDE.md` 不再存在。

### VAL-FILE-005
- **Behavior (行为)**: 旧形态项目中可识别的用户区内容在自动翻转后保留在新的 `AGENTS.md` 用户区。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: 在旧形态文件的用户区放入唯一字符串,升级翻转后该字符串仍出现在 `AGENTS.md` 的受管块之后,且不出现在受管块内部。

### VAL-FILE-006
- **Behavior (行为)**: 目标项目已有非旧安装软链的 `AGENTS.md` 时,安装不得静默覆盖该内容。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: 构造已有实体 `AGENTS.md` 或指向其他目标的 `AGENTS.md` 软链后运行安装;原内容或原软链目标被保存在备份或用户区中,并有用户可见提示。

### VAL-FILE-007
- **Behavior (行为)**: 安装需要替换已有 `CLAUDE.md` 实体文件时,不得覆盖首个 `.bak` 备份槽。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: 预置已有 `CLAUDE.md.bak`,再触发需要备份 `CLAUDE.md` 的路径;首个 `.bak` 字节不变,当次内容写入带时间戳的新备份。

### VAL-FILE-008
- **Behavior (行为)**: 受管块升级继续只替换 auriga 受管区,保留主文件用户区;手改受管区、旧格式、foreign 内容、标记损坏都有不丢内容的处理。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: 现有五类工作流安装测试在新主文件形态下仍有对应覆盖;每个需要备份的路径都能在目标目录找到保存旧内容的文件或在用户区找到原内容。

### VAL-LANG-001
- **Behavior (行为)**: 非交互 `install workflow` 未传 `--lang` 时默认安装中文工作流。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: 未传语言参数时,安装后的主文件 header 为 `# auriga 工作流 (vX.Y.Z)`,启动标记使用中文说明。

### VAL-LANG-002
- **Behavior (行为)**: 非交互 `install --preset` 未传 `--lang` 时默认把中文语言传给工作流安装。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: `install --preset` 分发测试中,workflow installer 收到的语言为 `zh-CN`;skills 和 plugins 的既有默认不因此改变。

### VAL-LANG-003
- **Behavior (行为)**: 交互菜单的推荐预设默认使用中文语言。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: 菜单选中推荐预设时传给预设安装的语言为 `zh-CN`;菜单标签显示默认语言为 `zh-CN` 或中文。

### VAL-LANG-004
- **Behavior (行为)**: Web UI 的工作流安装语言控件默认中文,并在用户未改动时提交中文语言。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: Dashboard 测试中工作流语言控件初始值为 `zh-CN`;选择工作流安装后提交的 apply item 带 `lang: "zh-CN"`。

### VAL-LANG-005
- **Behavior (行为)**: Web UI 的推荐预设语言控件默认中文,并在用户未改动时提交中文语言。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: Preset bar 测试中语言控件初始值为 `zh-CN`;点击安装预设提交的 apply item 带 `lang: "zh-CN"`。

### VAL-LANG-006
- **Behavior (行为)**: 英文模板仍可显式安装。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: `--lang en` 或 Web UI 选择英文后,安装后的主文件 header 为 `# auriga Workflow (vX.Y.Z)`,且不被默认中文逻辑覆盖。

### VAL-SCAN-001
- **Behavior (行为)**: 状态扫描能把新形态项目识别为工作流已安装。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: 目标项目中 `AGENTS.md` 为含受管块的实体文件且 `CLAUDE.md -> AGENTS.md` 时,扫描结果 workflow 状态为 `installed`,不产生 foreign workflow 警告。

### VAL-SCAN-002
- **Behavior (行为)**: 状态扫描对明显 foreign 的主文件仍诚实报告未安装并给出不会丢内容的提示。
- **Tool (工具)**: unit-test
- **Evidence (判据)**: 目标项目存在无 auriga header 且无受管块的主文件时,workflow 状态为 `not-installed`,warning code 能表达 foreign workflow,提示安装会保护已有内容。

### VAL-DOC-001
- **Behavior (行为)**: 命令行帮助、安装指南和 README 都把 `AGENTS.md` 描述为主文件,把 `CLAUDE.md` 描述为兼容软链。
- **Tool (工具)**: manual
- **Evidence (判据)**: 检查 `--help`、`install workflow --help`、guide 输出、英文 README、中文 README,不再出现“安装 `CLAUDE.md` 并创建 `AGENTS.md` 软链”作为当前契约的表述。

### VAL-DOC-002
- **Behavior (行为)**: 命令行帮助、交互菜单、Web UI 文案和 README 都把默认工作流语言描述为中文。
- **Tool (工具)**: manual
- **Evidence (判据)**: 所有面向用户的默认值说明都不再写 `lang en` 作为默认;英文可选项仍被文档列出。

### VAL-DOC-003
- **Behavior (行为)**: 本仓库描述当前契约的持久工程文档、源码注释、插件审查规则和测试说明都完成 `AGENTS.md` 主体普查;该改的改,该保留为历史的明确保留。
- **Tool (工具)**: manual
- **Evidence (判据)**: 对非归档路径执行 `rg "CLAUDE\\.md|AGENTS\\.md|lang en|default en"` 后,剩余命中要么描述 Claude Code 兼容软链、英文显式选项或历史兼容路径,要么位于明确的历史归档中;不再有当前契约把 `CLAUDE.md` 说成主文件或把英文说成默认语言。

### VAL-PACK-001
- **Behavior (行为)**: 非开发模式下,默认中文模板和显式英文模板都能通过发布包加远程内容拉取路径获得。
- **Tool (工具)**: build
- **Evidence (判据)**: 打包或内容拉取相关测试证明默认安装无需依赖源码树中的非发布文件;显式 `--lang en` 不会因为内容文件缺失失败。

### VAL-PACK-002
- **Behavior (行为)**: 真实 tarball 端到端 `install workflow` 落盘为新形态,且默认内容为中文。
- **Tool (工具)**: e2e-cli
- **Evidence (判据)**: `npm run test:e2e` 的 workflow 场景在 scratch 项目中看到实体 `AGENTS.md`、`CLAUDE.md -> AGENTS.md` 软链,且主文件 header 为中文工作流。
