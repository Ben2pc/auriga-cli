# git-workflow skill spec

按 Git 工作流顺序组织：分支创建 → 开发期 commit → PR 前整理 → PR 创建 → PR 创建后反思。

---

## 阶段 1：分支创建（开发前）

- 禁止直接 commit 到 `main` 
- 每次新任务从最新 main 切分支：


### 并发隔离：git worktree

多 agent / 多任务并行时，每个任务一个 worktree：

```bash
git worktree add ../<task-dir> -b <branch-name>
git worktree list
git worktree remove ../<task-dir>
```

---

## 阶段 2：开发期 commit

### Atomic commit 原则

每个 commit 必须：

- 表达一个逻辑变更
- 该 commit 处代码可编译、测试可通过
- 不混杂重构与功能修改
- 不混杂多个无关模块的修改

示例切分（refresh token 功能）：

```
feat(auth): add RefreshToken domain model and repository interface
feat(auth): implement JWT refresh token issuance in AuthService
feat(auth): expose POST /auth/refresh endpoint
test(auth): add unit tests for refresh token rotation logic
```

### Commit message 格式

```
<type>(<scope>): <summary>

<正文：本次变更的背景与动机、关键设计决策、已知局限>
```

- `type` 遵循 Conventional Commits（feat / fix / refactor / docs / test / chore）
- `scope` 可选
- 正文用自然段写"为什么这样做"和"权衡过哪些方案"
- 任务 ID（Jira / Linear）可在正文提及，或放在 PR description 里关联

### Checkpoint commit（开发中存档）

按**语义单元**触发，不按时间：完成一个能用一句话说清的独立逻辑单元就 commit。说不清"这个 commit 干了啥"，就再做一步、或者拆开。

互补的 **风险驱动** 触发：即将做高风险动作前先 commit 作为安全网——大规模删除、跨模块重构、依赖升级、自动批量 rename 等。

每个 checkpoint commit 用易识别的前缀（如 `wip:`），或用 `git commit --fixup=<hash>` 标记。前缀字面值不重要，可识别即可，用于后续 rebase 整理。

### 不应该 commit 的内容

- API key / token / password（用环境变量）
- 构建产物、`node_modules`、`__pycache__`
- 本地配置（`.env`、`*.local`）
- 大二进制（必要时用 Git LFS）

---

## 阶段 3：PR 前整理历史

skill 在准备开 PR 前自动执行，不向用户征求确认：

```bash
# 1. 自查当前分支提交
git log --oneline main..HEAD

# 2. 识别 checkpoint / wip / fixup → 用 autosquash 整理
git rebase -i --autosquash main

# 3. 整理后再次自查
git log --oneline main..HEAD
```

interactive rebase 操作动词：

- `pick` 保留
- `squash` / `s` 合并到上一个并合并 message
- `fixup` / `f` 合并到上一个，丢弃本提交 message
- `reword` / `r` 修改 message
- `drop` / `d` 删除

约束：

- 整理目标是每个保留 commit 都是 atomic、message 符合 Conventional Commits、正文写清 why
- 已 push 到远端的分支不做 force push（除非团队明确约定）

---

## 阶段 4：PR 创建

### 语言选择

在调用 `gh pr create` 前，用 `AskUserQuestion` 询问 PR description 用什么语言：中文 / 英文 / 跟随项目历史 PR。本次任务内复用，不记入 memory。

### PR description 五要素

PR 描述需覆盖：**scope / acceptance criteria / design decisions / risks / remaining TODOs**。

推荐 body 结构：

```markdown
## Summary
<做了什么 + 为什么这样做（why 而不是文件清单）>

## Acceptance Criteria
- [ ] 可验证条目 1
- [ ] 可验证条目 2

## Design Decisions
- 选 X 而非 Y，因为 ...
- 已知权衡：...

## Risks
- 边界条件 / 已知限制 / 可能波及的模块

## Test plan
- [ ] unit / integration tests
- [ ] manual / UI / browser verification: ...

## Remaining TODOs
- None | [ ] follow-up item
```

要点：

- 章节标题保持 `##` 一级，hook 才能扫到
- `Acceptance Criteria` 写"要满足什么"（产品视角的验收条件）；`Test plan` 写"如何验证"（测试动作清单），两者分开不合并
- `Design Decisions` 单独成章，避免与 Risks 糊在一起
- `Summary` 必须包含 why，不能写成 "改了 a/b/c 三个文件"
- 所有 list 章节缺值显式写 `None`，避免章节缺失被误判为遗漏

---

## 阶段 5：PR 创建后反思

`pr-create-guard` hook（PostToolUse，非阻塞）：

- 扫 `^##` 标题、统计 TODO checkbox，注入提醒是否覆盖五要素
- 输出里追加一条："如 PR 描述语言与团队约定不一致，请用 `gh pr edit` 修正"。不做语言自动检测。

---

## 阶段 2 附属机制：commit-reminder hook

新增 hook 提醒 agent 在合适语义边界 commit，对应阶段 2 的 atomic commit 与 checkpoint 原则。

- **触发**：`PostToolUse` on `Edit` / `Write` / `MultiEdit`
- **逻辑**：跑 `git diff --shortstat HEAD`，未 commit 改动 `> 200 行` 或 `> 8 文件` 时注入 `additionalContext` 提醒"在合适语义边界 commit 一段"
- **频率控制**：用 `.git/auriga-commit-reminder.last` 存 epoch 时间戳，距上次 < 60s 静默；否则提醒并更新时间戳。不做内容去重，纯时间窗口
- **非阻塞**：atomic commit 是设计判断，硬阻塞会误伤大型重构合理单 commit

---

## 实施计划

### plugin 重命名 + 整合

`auriga-pr-guards` → `auriga-git-guards`，把 git 工作流相关的 hook 和 skill 都收进来：

```
plugins/auriga-git-guards/
  .claude-plugin/plugin.json
  .codex-plugin/plugin.json
  hooks/hooks.json                  (PreToolUse + PostToolUse 注册三个 hook)
  scripts/
    pr-create-guard.mjs             (从 auriga-pr-guards 迁移)
    pr-ready-guard.mjs              (从 auriga-pr-guards 迁移)
    commit-reminder.mjs             (新增)
  skills/git-workflow/SKILL.md      (新增，本 spec 落地)
```

### 需要同步改动的现有契约

- **CLAUDE.md PR Readiness 段**：把四要素（scope / acceptance criteria / risks / remaining TODOs）改为五要素，新增 "design decisions"
- **`pr-create-guard` 提示词**：扫描提示中加 "design decisions"；追加语言不一致提醒
- **`.claude-plugin/marketplace.json`** + **`.agents/plugins/marketplace.json`**：plugin 名 `auriga-pr-guards` → `auriga-git-guards`，`source: "./plugins/auriga-git-guards"`
- **`.claude/plugins.json`** + **`.agents/plugins/install.json`**：plugin 名同步更新
- **tests/**：`pr-create-guard.test.mjs` / `pr-ready-guard.test.mjs` 路径更新；新增 `commit-reminder.test.mjs`
- **`package.json` scripts**：`test:pr-guards` → `test:git-guards`

