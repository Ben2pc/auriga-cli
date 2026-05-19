---
name: documentation-and-adrs
description: 当做出架构决策、变更公共 API、发布会改变用户可见行为的功能,需要把 arch-design 产出的 arch_design.md 沉淀为长期 ADR,或需要为后续工程师和 Agent 记录代码库背景上下文时使用。
---

# 文档与架构决策记录

## 概述

要记录的是决策,而不只是代码。最有价值的文档记下的是"为什么"——做出某个决策时的背景、约束和取舍。代码展示了"做了什么",文档解释的是"为什么这样做""考虑过哪些别的方案"。这份上下文,对后续在这个代码库里工作的人和 Agent 都不可或缺。

## 何时使用

- 做出一个重要的架构决策
- 在几个相互竞争的方案之间做选择
- 新增或变更一个公共 API
- 发布一个会改变用户可见行为的功能
- 帮新成员(包括 Agent)熟悉项目
- 发现自己在反复解释同一件事

**何时不要使用**:不要给一目了然的代码写文档。不要写只是复述代码本身的注释。不要给用完即弃的原型写文档。

## 架构决策记录(ADR)

ADR 记录的是重要技术决策背后的推理过程。它是你能写下的回报率最高的一类文档。

### 何时该写 ADR

- 选定一个框架、库或重要依赖
- 设计数据模型或数据库 schema
- 选定一种鉴权策略
- 决定 API 架构(REST、GraphQL、tRPC 之类)
- 在构建工具、托管平台或基础设施之间做选择
- 任何一旦做错就很难逆转的决策

### ADR 存放位置

ADR 存放在 `docs/architecture/` 下,文件名用 `ADR-<序号>-<简短标题>.md`(例如 `ADR-001-use-postgresql.md`)。序号连续递增,`ADR-` 前缀让它在 `docs/architecture/` 里和模块布局、数据流等其他设计文档摆在一起时仍然能一眼认出。

默认平铺即可。当 ADR 数量变多、按主题归类更清晰时,可以在 `docs/architecture/` 下按需创建子目录(例如 `data/`、`auth/`),把同一主题的 ADR 收拢进去;序号仍在全局范围保持连续。

> 与 `arch-design` 的分工:`arch-design` 产出的 `arch_design.md` 是开发过程中的方案文档;ADR 是长期档案,用来在收尾时固化"昂贵到难以逆转"的决策。两者职责不重叠——一个服务当下实现,一个服务后续推理。

### ADR 模板

```markdown
# ADR-001: 主数据库选用 PostgreSQL

## 状态
已接受 | 被 ADR-XXX 取代 | 已废弃

## 日期
2025-01-15

## 背景
任务管理应用需要一个主数据库。关键需求:
- 关系型数据模型(用户、任务、团队之间有关联)
- 任务状态变更需要 ACID 事务
- 任务内容需要支持全文检索
- 需要有托管服务(团队小,运维能力有限)

## 决策
选用 PostgreSQL,搭配 Prisma ORM。

## 考虑过的备选方案

### MongoDB
- 优点:schema 灵活,起步快
- 缺点:我们的数据本质上是关系型的,得手动维护关联关系
- 否决原因:在文档型存储里放关系型数据,要么导致复杂的 join,要么导致数据冗余

### SQLite
- 优点:零配置、内嵌、读取快
- 缺点:并发写入支持有限,生产环境没有托管服务
- 否决原因:不适合生产环境下的多用户 Web 应用

### MySQL
- 优点:成熟,支持广泛
- 缺点:PostgreSQL 的 JSON 支持、全文检索和生态工具更好
- 否决原因:就我们的功能需求而言,PostgreSQL 更合适

## 后果
- Prisma 提供类型安全的数据访问和迁移管理
- 可以直接用 PostgreSQL 的全文检索,不必再引入 Elasticsearch
- 团队需要具备 PostgreSQL 知识(属于通用技能,风险低)
- 托管在托管服务上(Supabase、Neon 或 RDS)
```

### ADR 生命周期

```
提议 → 已接受 → (被取代 或 已废弃)
```

- **不要删除旧的 ADR。** 它们承载着历史背景。
- 当一个决策发生变化时,新写一条 ADR,并在其中引用并声明取代旧的那条。

## 内联文档

### 何时写注释

注释要解释"为什么",而不是"做了什么":

```typescript
// 反例:复述代码本身
// 计数器加 1
counter += 1;

// 正例:解释不显然的意图
// 限流采用滑动窗口——在窗口边界重置计数器,
// 而不是按固定时刻重置,以防止攻击者在窗口交界处突发请求
if (now - windowStart > WINDOW_SIZE_MS) {
  counter = 0;
  windowStart = now;
}
```

### 何时不要写注释

```typescript
// 不要给不言自明的代码写注释
function calculateTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

// 不要为"现在就该做的事"留 TODO 注释
// TODO: 加错误处理  ← 现在就加

// 不要留被注释掉的代码
// const oldImplementation = () => { ... }  ← 直接删掉,git 里有历史
```

### 记录已知的坑

```typescript
/**
 * 重要:这个函数必须在首次渲染之前调用。
 * 如果在 hydration 之后才调用,会出现一次无样式内容闪烁,
 * 因为服务端渲染期间主题上下文还不可用。
 *
 * 完整的设计理由见 ADR-003。
 */
export function initializeTheme(theme: Theme): void {
  // ...
}
```

## API 文档

针对公共 API(REST、GraphQL、库的对外接口):

### 与类型写在一起(TypeScript 首选)

```typescript
/**
 * 创建一个新任务。
 *
 * @param input - 任务创建数据(title 必填,description 可选)
 * @returns 创建出的任务,带服务端生成的 ID 和时间戳
 * @throws {ValidationError} 当 title 为空或超过 200 字符
 * @throws {AuthenticationError} 当用户未认证
 *
 * @example
 * const task = await createTask({ title: '买菜' });
 * console.log(task.id); // "task_abc123"
 */
export async function createTask(input: CreateTaskInput): Promise<Task> {
  // ...
}
```

### REST API 用 OpenAPI / Swagger

```yaml
paths:
  /api/tasks:
    post:
      summary: 创建一个任务
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateTaskInput'
      responses:
        '201':
          description: 任务已创建
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Task'
        '422':
          description: 校验错误
```

## README 结构

每个项目都该有一份 README,覆盖以下内容:

```markdown
# 项目名称

一段话说明这个项目是做什么的。

## 快速开始
1. 克隆仓库
2. 安装依赖:`npm install`
3. 配置环境:`cp .env.example .env`
4. 启动开发服务器:`npm run dev`

## 命令
| 命令 | 说明 |
|---|---|
| `npm run dev` | 启动开发服务器 |
| `npm test` | 运行测试 |
| `npm run build` | 生产构建 |
| `npm run lint` | 运行 linter |

## 架构
简要说明项目结构和关键设计决策。详情链接到对应 ADR。

## 贡献指南
如何贡献、编码规范、PR 流程。
```

## Changelog 维护

针对已发布的功能:

```markdown
# Changelog

## [1.2.0] - 2025-01-20
### 新增
- 任务分享:用户可以把任务分享给团队成员 (#123)
- 任务指派的邮件通知 (#124)

### 修复
- 快速连点创建按钮时出现重复任务 (#125)

### 变更
- 任务列表每页加载量从 20 改为 50,体验更好 (#126)
```

## 给 Agent 的文档

针对 AI Agent 上下文的特别考量:

- **指令文件(AGENTS.md / CLAUDE.md 等)**——记录项目约定,让 Agent 遵循它们
- **spec 文件**——保持 spec 更新,让 Agent 构建出正确的东西
- **ADR**——帮助 Agent 理解过去的决策为什么这样做(避免重复推翻已定的事)
- **内联的坑**——避免 Agent 掉进已知陷阱

## 常见的自我辩解

| 自我辩解 | 实情 |
|---|---|
| "代码自解释" | 代码展示了"做了什么"。它不展示"为什么"、否决了哪些备选方案、有哪些约束。 |
| "等 API 稳定了再写文档" | API 在被写下来之后才更快稳定。写文档是对设计的第一次检验。 |
| "没人看文档" | Agent 会看。后来的工程师会看。三个月后的你自己也会看。 |
| "ADR 是额外负担" | 一条 10 分钟的 ADR,能省下半年后围绕同一个决策的 2 小时争论。 |
| "注释会过时" | 解释"为什么"的注释是稳定的。解释"做了什么"的注释才会过时——所以只写前者。 |

## 危险信号

- 架构决策没有任何书面理由
- 公共 API 没有文档,也没有类型
- README 没说清楚怎么把项目跑起来
- 用注释掉代码代替删除
- TODO 注释挂了好几周
- 项目有重要架构选型,却没有 ADR
- 文档在复述代码,而不是解释意图

## 验证

写完文档后:

- [ ] 所有重要架构决策都有对应的 ADR
- [ ] README 覆盖了快速开始、命令和架构概览
- [ ] API 函数有参数和返回类型的文档
- [ ] 已知的坑在它真正起作用的地方有内联记录
- [ ] 没有残留被注释掉的代码
- [ ] 指令文件(AGENTS.md / CLAUDE.md 等)是最新且准确的
