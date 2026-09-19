# 原生 AGENTS.md 单一入口 — 规范

> Auriga 项目工作流只使用 `AGENTS.md`，不提供低版本 Claude Code 兼容入口。
> 状态：已确认；确认来源：用户要求去掉低版本 Claude Code 兼容代码和指令描述。

## 1. 为什么做

- Claude Code 已原生支持 `AGENTS.md`，继续维护 `CLAUDE.md` 回退、迁移、告警和使用说明只会扩大代码、测试与认知成本。
- Auriga 面向多个编码 Agent，项目工作流应保持单一跨宿主入口。
- 本次采用直接退役：不提供兼容开关，不保留项目级 `CLAUDE.md` 回退，也不指导手动导入或软链。

## 2. 用户可观察行为

### 2.1 项目工作流只管理 AGENTS.md

- 安装和升级只读取、写入及备份项目根目录 `AGENTS.md`。
- 状态扫描只用项目根目录 `AGENTS.md` 判断项目工作流状态。
- 卸载只删除可识别为 Auriga 工作流的真实 `AGENTS.md`；外国文件和软链保持不变。
- 项目级 `CLAUDE.md` 不被读取、创建、迁移、警告或删除。
- 旧版无受管标记的 Auriga `AGENTS.md` 仍按现有备份规则迁移到受管格式；这属于同一文件格式升级，不是宿主兼容。

### 2.2 规范只描述原生入口

- 双语模板、文档管理技能、评审规则、帮助、README 和 Web UI 只把 `AGENTS.md` 描述为项目工作流入口。
- 不描述 Claude Code 最低版本、功能开关、`@AGENTS.md` 导入或 `CLAUDE.md` 软链恢复方式。
- 真正的 Claude 专属配置仍可存在，但不得作为 Auriga 项目规则兼容入口。

## 3. 范围边界

- 不修改 Claude Code 用户级 `~/.claude/CLAUDE.md` 状态展示；它是现有用户作用域配置，不是项目兼容入口。
- 不回写历史 worklog 或明确标为历史快照的架构文档。
- 不接管或删除任何项目现有 `CLAUDE.md`；Auriga 对它完全无感。

## 4. 验收映射

- `VAL-OWNERSHIP-001`：安装、升级与卸载只管理 `AGENTS.md`。
- `VAL-SCAN-001`：项目状态扫描只读取 `AGENTS.md`。
- `VAL-DOCUMENTATION-001`：活跃规范没有低版本 Claude Code 兼容说明。
- `VAL-REGRESSION-001`：既有 `AGENTS.md` 受管区块、备份与用户区行为保持不变。
