import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import matter from "gray-matter";

const repoRoot = path.resolve(new URL(".", import.meta.url).pathname, "..", "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf-8");
}

const deepReview = (): string =>
  read("plugins/auriga-workflow/skills/deep-review/SKILL.md");

const builtinReviewerTriggers = {
  architecture: "tag:architecture",
  "code-quality": "tag:maintained-code",
  correctness: "tag:executable-behavior",
  "docs-sync": "always",
  performance: "tag:performance-sensitive",
  security: "tag:security-sensitive",
  "skill-plugin-quality": "tag:agent-extension",
  "spec-conformance": "always",
  "test-quality": "tag:executable-behavior-or-tests",
  ux: "tag:ui",
} as const;

function markdownSection(text: string, heading: string): string {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `missing section ${heading}`);
  const level = heading.match(/^#+/)?.[0].length ?? 0;
  const nextHeading = new RegExp(`^#{1,${level}}\\s`, "m");
  const bodyStart = start + heading.length;
  const tail = text.slice(bodyStart);
  const next = nextHeading.exec(tail);
  return text.slice(start, next ? bodyStart + next.index : text.length);
}

describe("auriga-workflow skill contracts", () => {
  test("unified test-driven-development is plugin-bundled and concise", () => {
    const rel = "plugins/auriga-workflow/skills/test-driven-development/SKILL.md";
    const abs = path.join(repoRoot, rel);

    assert.ok(fs.existsSync(abs), `${rel} must exist`);
    const text = read(rel);
    const parsed = matter(text);

    assert.equal(parsed.data.name, "test-driven-development");
    assert.match(parsed.data.description, /功能.*缺陷修复.*重构/);
    assert.match(
      parsed.data.description,
      /判断[^；。]*(?:当前证据|永久测试)|(?:当前证据|永久测试)[^；。]*判断/,
      "frontmatter must route evidence-lifetime decisions into the skill",
    );
    assert.doesNotMatch(
      parsed.data.description,
      /没有有效自动化接缝[^；。]*不触发|纯配置[^；。]*不触发/,
      "lack of an automation seam or a configuration change must not bypass evidence selection",
    );
    for (const anchor of [
      "validation-contract.md",
      "公共接口",
      "失败",
      "最小实现",
      "纵向",
      "系统边界",
      "机器协议",
    ]) {
      assert.ok(text.includes(anchor), `unified TDD must keep the ${anchor} contract`);
    }
    assert.match(text, /每条验收断言[^。\n]*不等于单个验证用例/);
    assert.match(text, /按[“`]?验证方式[”`]?选择证据类型/);
    assert.match(text, /按风险[^；。\n]*一个或多个必要用例/);
    assert.match(
      text,
      /测试类断言[^。\n]*多个测试用例/,
      "one test-oriented validation assertion may require multiple test cases",
    );
    assert.match(text, /每次改动[^。\n]*验证证据[^。\n]*不等于[^。\n]*新增永久测试/);
    for (const anchor of ["稳定契约", "真实回归风险", "可靠自动化接缝", "长期收益", "维护成本"]) {
      assert.ok(text.includes(anchor), `unified TDD must consider ${anchor}`);
    }
    assert.match(text, /不满足[^。\n]*当前证据/);
    assert.doesNotMatch(
      text,
      /^## 边界$/m,
      "the unified TDD skill must not carry a separate boundary section",
    );
    assert.ok(
      text.split("\n").length <= 80,
      "the unified TDD skill must stay within an 80-line context budget",
    );
    assert.doesNotMatch(text, /独立测试代理|另派[^。\n]*测试代理|separate test agent/i);
    assert.doesNotMatch(text, /xhigh|最强模型|全新会话|fresh context/i);
    assert.match(
      text,
      /不因[^。\n]{0,30}删除[^。\n]{0,12}(?:实现|代码)|不因[^。\n]{0,20}(?:实现|代码)[^。\n]{0,20}删除/,
      "the skill must reject deleting usable implementation only to restart the ritual",
    );
    assert.doesNotMatch(text, /delete means delete/i);
  });

  test("auriga-workflow publishes the exact owned skill inventory", () => {
    const skillsRoot = path.join(repoRoot, "plugins/auriga-workflow/skills");
    const actual = fs.readdirSync(skillsRoot)
      .filter((name) => fs.existsSync(path.join(skillsRoot, name, "SKILL.md")))
      .sort();
    assert.deepEqual(actual, [
      "arch-design",
      "code-simplify",
      "deep-review",
      "docent",
      "documentation-management",
      "git-workflow",
      "goalify",
      "incremental-impl",
      "reviewer-creator",
      "session-compound",
      "spec-design",
      "systematic-debugging",
      "test-driven-development",
    ]);
    assert.equal(fs.existsSync(path.join(repoRoot, ".agents/skills/test-driven-development")), false);
    assert.equal(fs.existsSync(path.join(repoRoot, ".claude/skills/test-driven-development")), false);
  });

  test("git-workflow keeps team lifecycle contracts without generic Git teaching", () => {
    const skill = read("plugins/auriga-workflow/skills/git-workflow/SKILL.md");
    const parsed = matter(skill);
    const lifecyclePath = "plugins/auriga-workflow/skills/git-workflow/references/pull-requests.md";
    assert.ok(skill.includes("references/pull-requests.md"));
    assert.ok(fs.existsSync(path.join(repoRoot, lifecyclePath)));
    const lifecycle = read(lifecyclePath);

    assert.equal(parsed.data.name, "git-workflow");
    assert.match(parsed.data.description, /工作树.*提交.*拉取请求.*Ready.*合并/);
    assert.match(skill, /无法确认归属的改动默认属于用户/);
    assert.match(skill, /未经明确授权，不执行 `git stash`.*`git reset --hard`/);
    const templateHeadings = [
      "## 摘要",
      "## 验收标准",
      "## 验证计划",
    ];
    for (const heading of templateHeadings) {
      assert.ok(lifecycle.includes(heading), `PR template must preserve ${heading}`);
      const body = markdownSection(lifecycle, heading).slice(heading.length);
      assert.match(body, /[\u3400-\u9fff]/, `${heading} example body must use Chinese`);
    }




    assert.match(markdownSection(lifecycle, "## 创建或更新草稿请求"), /尽早创建 Draft 拉取请求/);
    assert.match(markdownSection(lifecycle, "## 进入待评审状态"), /所有当前提交已推送.*基准分支.*目标分支/s);
    assert.match(markdownSection(lifecycle, "## 处理评审与持续集成反馈"), /一批处理完成后.*汇总问题、状态和对应提交/s);
    assert.match(markdownSection(lifecycle, "## 合并"), /必需检查与批准均满足/);
    assert.match(
      skill,
      /`feat`.*`fix`.*`docs`.*`refactor`.*`chore`.*`test`.*`perf`.*`style`.*`build`.*`ci`.*`revert`/s,
      "Conventional Commit types must match pr-create-guard",
    );
    for (const hook of [
      "commit-reminder",
      "pr-create-guard",
      "pr-ready-guard",
      "pr-merge-guard",
    ]) {
      assert.ok(skill.includes(`\`${hook}\``), `git-workflow must preserve ${hook} contract`);
    }
    assert.doesNotMatch(skill, /git rebase -i|交互式变基(?:教学|命令|操作)|Interactive rebase/i);
    assert.doesNotMatch(skill, /常见忽略文件|忽略文件清单|\.gitignore 教程/);
    assert.doesNotMatch(skill, /PostToolUse|PreToolUse|truthy|falsy|BoolVar|Hook 参数|事件名称|失败策略/i);
  });

  test("documentation-management governs document assets and audience-specific context", () => {
    const skillPath = "plugins/auriga-workflow/skills/documentation-management/SKILL.md";
    const skill = read(skillPath);
    const parsed = matter(skill);
    const standards = read(
      "plugins/auriga-workflow/skills/documentation-management/references/document-standards.md",
    );

    assert.equal(parsed.data.name, path.basename(path.dirname(skillPath)));
    assert.match(parsed.data.description, /新建.*更新.*合并.*压缩.*归档.*删除/);
    assert.match(
      parsed.data.description,
      /README.*运行手册.*公共接口文档.*架构文档.*ADR.*变更日志.*代码注释.*AGENTS\.md.*项目规则/,
    );
    assert.match(parsed.data.description, /代码变化造成文档事实漂移/);
    assert.match(parsed.data.description, /长期文档出现过程流水账/);
    assert.match(skill, /默认不新增/);
    for (const action of ["更新", "删除", "合并", "压缩", "归档", "晋升", "新建"]) {
      assert.ok(skill.includes(action), `documentation management must support ${action}`);
    }
    assert.match(skill, /先确定消费者/);
    assert.match(skill, /纯人类文档不挂到 `AGENTS\.md`/);
    assert.match(skill, /区分 Agent 资料与 Agent 指令/);
    assert.match(skill, /工程资料沿用各自的文档结构/);
    assert.match(skill, /只有提示词、项目规则或标准操作流程（SOP）[^。]*才按目标/);
    for (const contract of [
      "目标",
      "成功标准",
      "权限边界",
      "工具路由",
      "输出契约",
      "停止条件",
    ]) {
      assert.ok(skill.includes(contract), `Agent documents must preserve ${contract}`);
    }
    assert.match(skill, /同一规则只写一次/);
    assert.match(skill, /不链接只服务人类阅读的材料/);
    assert.match(skill, /`CLAUDE\.md -> AGENTS\.md` 兼容软链/);
    assert.match(skill, /仓库根只放全局规则与导航/);
    assert.match(skill, /子包[^。\n]*自己的根目录维护 `AGENTS\.md`/);
    // Layered loading: the parent one-line pointer to a sub-scope AGENTS.md is
    // a load-bearing mechanism (runtimes don't reliably auto-load sub-scopes);
    // every other doc index is a nice-to-have bounded by token cost.
    assert.match(skill, /子作用域 `AGENTS\.md` 必须由父级[^。\n]*单行指针/);
    assert.match(skill, /索引是可选优化[^。\n]*不是义务/);
    assert.match(skill, /过长的索引[^。\n]*反渐进式披露/);
    assert.doesNotMatch(
      skill,
      /(?:所有|全部|每个)[^\n。]{0,10}文档[^\n。]{0,10}(?:必须|都要)[^\n。]{0,8}索引/,
      "general doc indexing must stay optional, never a blanket mandate",
    );
    assert.match(skill, /最近公共祖先/);
    // Content focus: docs carry what code cannot express; code-level detail
    // sinks to inline comments; doc debt is technical debt in context terms.
    assert.match(skill, /文档债是技术债/);
    assert.match(skill, /代码推不出来的事实/);
    assert.match(skill, /下沉为行内注释/);
    assert.match(skill, /为什么 > 是什么/);
    assert.match(skill, /长期文档不记过程流水账/);
    assert.match(skill, /长期资产只保存能脱离当前任务独立成立的当前事实或正式决定/);
    assert.match(skill, /未经用户明确授权[^。]*不记录本次实施、评审、修订、提交或上线经过/);
    const assetActions = markdownSection(skill, "### 2. 选择资产与动作");
    for (const [earlier, later] of [
      ["删除失效", "合并、抽象为当前规则或事实"],
      ["合并、抽象为当前规则或事实", "重写原有段落"],
      ["重写原有段落", "只有新的独立长期事实无法被现有结构吸收时才新增内容"],
    ]) {
      assert.ok(
        assetActions.indexOf(earlier) < assetActions.indexOf(later),
        `documentation convergence must keep ${earlier} before ${later}`,
      );
    }
    assert.match(assetActions, /单行新增不是绝对禁止[^。]*不能成为[^。]*默认动作/);
    assert.match(standards, /当前架构文档维护“现在是什么”[^。]*实施、评审、修订和上线经过/);
    assert.match(standards, /ADR[\s\S]*不把初稿变化、评审轮次、修订提交或上线经过写成决策理由/);
    assert.match(standards, /当前时态表达稳定规则[^。]*本次实施或评审经过/);
    // Audience signal: traditional names default to human readers; human docs
    // lead with overview + diagrams.
    assert.match(skill, /`README\.md`[^。\n]*默认面向人类/);
    assert.match(skill, /以 overview 为主[^。\n]*图/);
    assert.match(standards, /为什么 > 是什么/);
    assert.match(standards, /单行指针/);
    assert.match(standards, /行内注释/);
    assert.match(skill, /ADR 可以同时服务人类与 Agent/);
    // Archiving is a governance action (link repair + promotion check), never
    // a bare file move; the trigger sites below route here.
    assert.match(skill, /归档是治理动作[^。\n]*不是直接移动文件/);
    const gitWorkflow = read("plugins/auriga-workflow/skills/git-workflow/references/pull-requests.md");
    assert.match(gitWorkflow, /晋升、归档或删除[^。\n]*`documentation-management`/);
    const specLifecycle = read("plugins/auriga-workflow/skills/spec-design/references/umbrella-template.md");
    assert.match(specLifecycle, /归档或晋升[^。\n]*`documentation-management`/);
    const goalify = read("plugins/auriga-workflow/skills/goalify/SKILL.md");
    assert.match(goalify, /归档用 `documentation-management` 执行[^。\n]*不直接移动文件/);
    const archDesign = read("plugins/auriga-workflow/skills/arch-design/SKILL.md");
    assert.match(archDesign, /晋升与归档用 `documentation-management` 执行[^。\n]*不直接移动文件/);
    assert.match(standards, /架构文档、接口契约、schema、ADR 等资料[^。]*不套用提示词结构/);
    assert.match(standards, /仅对提示词、项目规则和标准操作流程等行为指令/);
    assert.match(skill, /docs-sync[^。\n]*独立审查/);
    assert.doesNotMatch(skill, /常见的自我辩解|危险信号/);

    for (const heading of [
      "README 与开发指南",
      "运行手册",
      "公共接口文档",
      "架构文档",
      "架构决策记录",
      "内联注释",
      "变更日志与发布说明",
      "Agent 文档",
    ]) {
      assert.ok(standards.includes(`## ${heading}`), `document standards must cover ${heading}`);
    }
  });

  test("active workflow surfaces omit retired entries and default test-agent behavior", () => {
    for (const rel of [
      "AGENTS.md",
      "AGENTS.template.zh-CN.md",
      "AGENTS.template.en.md",
      "plugins/auriga-workflow/skills/arch-design/SKILL.md",
      "plugins/auriga-workflow/skills/code-simplify/SKILL.md",
      "plugins/auriga-workflow/skills/deep-review/SKILL.md",
      "plugins/auriga-workflow/skills/incremental-impl/SKILL.md",
      "plugins/auriga-workflow/skills/session-compound/SKILL.md",
      "plugins/auriga-workflow/skills/session-compound/references/eval-dispatch.md",
      "plugins/auriga-workflow/skills/spec-design/SKILL.md",
      "plugins/auriga-workflow/skills/spec-design/references/validation-contract-template.md",
      "plugins/auriga-workflow/skills/test-driven-development/SKILL.md",
      "plugins/auriga-workflow/skills/deep-review/references/reviewers/test-quality.md",
    ]) {
      const text = read(rel);
      assert.doesNotMatch(text, /test-designer/, `${rel} must not reference the retired skill`);
      assert.doesNotMatch(
        text,
        /不另派[^。\n]*测试|不再派遣[^。\n]*测试|当前(?:实现)?代理[^。\n]*(?:测试|失败证据|保护网|建立证据)|实现代理[^。\n]*(?:测试设计|红绿循环|运行器|驱动)|current (?:implementation )?agent[^.\n]*test|separate test agent/i,
        `${rel} must not spend context restating default test-agent behavior`,
      );
    }
  });

  test("systematic-debugging keeps diagnosis evidence-first without a fixed ritual", () => {
    const text = read(
      "plugins/auriga-workflow/skills/systematic-debugging/SKILL.md",
    );
    const parsed = matter(text);

    assert.equal(parsed.data.name, "systematic-debugging");
    for (const anchor of [
      "可重复的问题验证路径",
      "证据采集路径",
      "根因尚未确认",
      "临时缓解",
      "按需",
    ]) {
      assert.ok(
        text.includes(anchor),
        `systematic-debugging must keep the ${anchor} behavior anchor`,
      );
    }
    for (const method of [
      "临时日志",
      "断点",
      "git bisect",
      "重放",
      "性能",
      "监控",
      "报警",
    ]) {
      assert.ok(
        text.toLowerCase().includes(method),
        `systematic-debugging must mention ${method} in its optional diagnostic toolbox`,
      );
    }
    assert.match(text, /只诊断[^\n]{0,40}不(?:实施|修改)/);
    assert.match(text, /仅在用户授权修复[^。]*后执行/);
    assert.match(text, /不得记录密钥、令牌、个人信息或完整敏感载荷/);
    assert.match(text, /重新运行最初的问题验证路径/);
    assert.match(text, /删除临时日志、脚本和诊断代码/);
    assert.ok(
      !text.includes("superpowers:test-driven-development"),
      "systematic-debugging must not force a chained vendor skill invocation",
    );
  });

  test("arch-design triggers for architecture and domain-model clarification", () => {
    const text = read("plugins/auriga-workflow/skills/arch-design/SKILL.md");
    const parsed = matter(text);

    assert.match(parsed.data.description, /(?:架构优化|优化[^。；]*架构)/);
    assert.match(parsed.data.description, /领域模型|领域建模/);
    assert.match(text, /技术方案澄清/);
    assert.match(text, /模块内部[^。\n]*(?:code-simplify|代码简化)/);

    for (const trigger of ["新功能", "职责", "边界", "分层", "依赖", "架构演进"]) {
      assert.ok(
        parsed.data.description.includes(trigger),
        `arch-design description must cover the ${trigger} trigger`,
      );
    }

    for (const rel of ["AGENTS.md", "AGENTS.template.zh-CN.md", "AGENTS.template.en.md"]) {
      const template = read(rel);
      // Version consistency is asserted in spec-design.test.ts against a
      // single source; here only require that a version is declared.
      assert.match(template, /# auriga (?:工作流|Workflow) \(v\d+\.\d+\.\d+\)/);
      assert.match(
        template,
        /领域模型|domain model/i,
        `${rel} must route domain-model clarification to arch-design`,
      );
    }
  });

  test("arch-design separates behavior, technical design, and execution planning", () => {
    const text = read("plugins/auriga-workflow/skills/arch-design/SKILL.md");

    for (const anchor of [
      "用户可观察",
      "领域概念",
      "模块边界",
      "依赖方向",
      "关键接口",
      "数据流",
      "实施步骤",
    ]) {
      assert.ok(text.includes(anchor), `arch-design must keep the ${anchor} boundary`);
    }
    assert.match(text, /产品语义[^。\n]*(?:spec-design|需求规格)/);
    assert.match(text, /本技能不写实施步骤、切片顺序/);
  });

  test("arch-design makes its design document an implementation-entry review gate", () => {
    const text = read("plugins/auriga-workflow/skills/arch-design/SKILL.md");
    const template = read(
      "plugins/auriga-workflow/skills/arch-design/references/arch-design-template.md",
    );

    assert.match(text, /实质[^。\n]*(?:架构|领域模型|跨边界)[^。\n]*arch_design\.md/);
    assert.match(text, /实现前[^。\n]*用户[^。\n]*(?:确认|评审)/);
    assert.match(text, /不能把沉默当作批准/);
    assert.match(text, /设计文档或对话内已确认的设计/);
    assert.match(template, /人工评审重点/);
    assert.match(template, /共享模型设计/);
    for (const field of ["评审状态", "核心决定", "主要影响", "首要风险", "人工确认结果"]) {
      assert.ok(template.includes(field), `arch-design template must preserve ${field}`);
    }
  });

  test("arch-design template moves from architecture overview to requirement-led details", () => {
    const template = read(
      "plugins/auriga-workflow/skills/arch-design/references/arch-design-template.md",
    );

    const headings = [
      "## 2. 架构总览",
      "### 2.1 当前架构现状",
      "### 2.2 目标设计概览",
      "## 3. 分项设计",
      "### 3.1 `<需求主题>`",
      "#### 3.1.1 原始需求",
      "#### 3.1.2 设计",
      "##### 3.1.2.1 本项模型设计",
      "##### 3.1.2.2 接口设计",
      "#### 3.1.3 局部目录变化",
      "#### 3.1.4 流程与必要图示",
      "#### 3.1.5 验证",
      "## 4. 迁移与行为保护",
      "## 5. 质量风险与保障",
      "## 6. 可观测设计",
      "## 7. 部署与运行",
      "## 8. 人工确认结果",
      "## 9. 参考依据",
    ];
    let previous = -1;
    for (const heading of headings) {
      const current = template.indexOf(heading);
      assert.ok(current > previous, `${heading} must follow the total-to-part structure`);
      previous = current;
    }

    const requirement = markdownSection(template, "### 3.1 `<需求主题>`");
    assert.match(requirement, /来源[^。\n]*条款/);
    assert.match(requirement, /业务语言/);
    assert.match(requirement, /非自明字段|结构性选择/);
    assert.match(requirement, /行粒度/);
    assert.match(requirement, /主键/);
    assert.match(requirement, /快照/);
    assert.match(requirement, /冗余/);
    assert.match(template, /图[^。\n]*业务含义[^。\n]*代码标识/);
    assert.match(template, /`flowchart`[^。\n]*`subgraph`[^。\n]*`C4Container`/);

    assert.doesNotMatch(template, /^#### 3\.1\.3 Rationale \/ 为什么$/m);
    assert.doesNotMatch(template, /^## \d+\. API Reference \/ 接口参考$/m);

    const references = markdownSection(template, "## 9. 参考依据");
    for (const field of ["来源", "版本或修订", "条款或代码证据", "设计落点"]) {
      assert.ok(references.includes(field), `references must preserve ${field}`);
    }
  });

  test("arch-design keeps commented API examples inside each requirement", () => {
    const template = read(
      "plugins/auriga-workflow/skills/arch-design/references/arch-design-template.md",
    );
    const requirement = markdownSection(template, "### 3.1 `<需求主题>`");
    const api = markdownSection(requirement, "##### 3.1.2.2 接口设计");

    for (const heading of [
      "请求 DTO",
      "成功响应 DTO",
      "错误响应 DTO",
    ]) {
      assert.ok(api.includes(heading), `API reference must preserve ${heading}`);
    }
    assert.equal((api.match(/```jsonc/g) ?? []).length, 3);
    assert.match(api, /\/\//);
    assert.match(api, /嵌套[^。\n]*不能[^。\n]*(?:省略|`\{\.\.\.\}`)/);
    assert.match(api, /联合类型[^。\n]*分别/);
    assert.match(api, /机器契约[^。\n]*(?:OpenAPI|Protocol Buffers|IDL)/);
    assert.doesNotMatch(template, /^## \d+\. API Reference \/ 接口参考$/m);
    assert.match(api, /设计理由/);
    assert.match(api, /每个对象层级[^。\n]*DTO[^。\n]*(?:新增|复用|修改)/);
    assert.match(api, /修改字段/);
    for (const status of ["新增", "复用", "修改"]) {
      assert.ok(api.includes(`（${status}）`), `API DTO example must show ${status} DTO status`);
    }
    assert.match(api, /重要进程内接口/);
    assert.match(api, /函数或方法签名/);
    assert.match(api, /输入语义/);
    assert.match(api, /输出语义/);
  });

  test("arch-design closes requirement, rationale, and retirement gaps before review", () => {
    const skill = read("plugins/auriga-workflow/skills/arch-design/SKILL.md");
    const migration = read(
      "plugins/auriga-workflow/skills/arch-design/references/migration-strategies.md",
    );
    const template = read(
      "plugins/auriga-workflow/skills/arch-design/references/arch-design-template.md",
    );

    for (const closure of ["需求闭环", "理由闭环", "影响闭环"]) {
      assert.ok(skill.includes(closure), `arch-design must preserve ${closure}`);
    }
    assert.match(skill, /spec\.md[^。\n]*validation-contract\.md[^。\n]*上级规范/);
    assert.match(skill, /项目规则/);
    assert.match(skill, /每条权威要求[^。\n]*具体设计机制[^。\n]*正文位置/);
    assert.match(skill, /全新上下文[^。\n]*只读[^。\n]*独立评审/);

    for (const evidence of [
      "导入",
      "再导出",
      "活代码查询",
      "测试夹具",
      "迁移历史测试",
      "文档规则",
    ]) {
      assert.ok(migration.includes(evidence), `retirement closure must inspect ${evidence}`);
    }
    assert.match(migration, /没有新增资产/);
    assert.match(migration, /第二种独立证据/);

    const retirement = markdownSection(template, "### 4.1 资产退场清单");
    for (const field of ["准确路径", "资产或符号", "当前依赖证据", "处置", "为什么"]) {
      assert.ok(retirement.includes(field), `retirement inventory must preserve ${field}`);
    }
    assert.match(template, /不得使用“对应模块”“相关测试”“及其引用”/);
  });

  test("arch-design keeps a shared model index and makes local model changes direct", () => {
    const skill = read("plugins/auriga-workflow/skills/arch-design/SKILL.md");
    const template = read(
      "plugins/auriga-workflow/skills/arch-design/references/arch-design-template.md",
    );
    const reference = read(
      "plugins/auriga-workflow/skills/arch-design/references/domain-modeling.md",
    );
    const reviewFocus = markdownSection(template, "## 1. 人工评审重点");
    const sharedModel = markdownSection(
      template,
      "### 2.3 共享模型设计",
    );
    const sharedInventory = markdownSection(
      sharedModel,
      "#### 2.3.1 模型总表",
    );
    const sharedDetails = markdownSection(
      sharedModel,
      "#### 2.3.2 模型详情",
    );
    const localModel = markdownSection(
      template,
      "##### 3.1.2.1 本项模型设计",
    );
    const localDetails = markdownSection(
      localModel,
      "###### 3.1.2.1.1 `<模型标识符>`",
    );

    assert.match(reviewFocus, /待确认项/);
    for (const field of ["模型", "变更状态", "代码或存储映射"]) {
      assert.ok(sharedInventory.includes(field), `shared model inventory must preserve ${field}`);
    }
    for (const status of ["已有保留", "已有调整", "本次新增", "计划移除"]) {
      assert.ok(sharedInventory.includes(status), `shared-model inventory must define ${status}`);
    }
    assert.match(sharedInventory, /每个模型只保留一行/);
    assert.match(sharedInventory, /\| `<已有调整的模型>` \| 已有调整 \| 现有：[^\n]+→ 目标：[^\n]+\|/);
    assert.match(sharedInventory, /\| `<新增抽象模型>` \| 本次新增 \| 无独立代码实体（抽象概念） \|/);
    assert.match(sharedInventory, /\| `<映射待确认的模型>` \| [^\n]+\| 待确认：[^\n]+\|/);
    assert.match(sharedInventory, /待确认[^。\n]*人工评审重点/);
    assert.match(sharedDetails, /^##### 2\.3\.2\.1 `<模型标识符>`$/m);
    assert.doesNotMatch(localModel, /Model Inventory \/ 模型清单/);
    for (const field of ["变更状态", "代码或存储映射"]) {
      assert.ok(localDetails.includes(field), `local model details must preserve ${field}`);
    }
    for (const details of [sharedDetails, localDetails]) {
      for (const field of ["承接需求", "设计理由", "同一性判断", "状态与存续范围", "有效状态规则", "成立边界"]) {
        assert.ok(details.includes(field), `model details must preserve ${field}`);
      }
      for (const field of ["字段、关系或约束", "变更", "业务含义", "目标结构", "为什么"]) {
        assert.ok(details.includes(field), `model change table must preserve ${field}`);
      }
      assert.match(details, /新增、修改或删除/);
      assert.match(details, /不[^。\n]*完整字段/);
    }
    for (const identity of ["持久标识", "按值判等", "无独立同一性"]) {
      assert.ok(sharedDetails.includes(identity), `identity guidance must distinguish ${identity}`);
    }
    assert.match(sharedModel, /跨多个分项/);
    assert.match(localModel, /只服务当前分项/);
    assert.match(sharedModel, /不要[^。\n]*重复/);
    assert.match(sharedDetails, /不是登录或认证身份/);
    assert.match(sharedDetails, /输入校验、调用前提、授权策略和实现限制不属于这里/);
    assert.match(sharedDetails, /单次事务/);
    assert.match(sharedDetails, /示例[^。\n]*封闭枚举/);
    assert.match(skill, /arch-design-template\.md[^。\n]*唯一详细契约/);
    assert.match(reference, /arch-design-template\.md[^。\n]*唯一详细契约/);
  });

  test("arch-design template makes current and target architecture easy to compare", () => {
    const template = read(
      "plugins/auriga-workflow/skills/arch-design/references/arch-design-template.md",
    );

    for (const section of [
      "当前架构现状",
      "当前目录结构",
      "目标设计概览",
      "目标目录结构",
    ]) {
      assert.ok(template.includes(section), `arch-design template must preserve ${section}`);
    }
    assert.match(template, /同一抽象层级/);
    assert.match(template, /改变前后|前后对照/);
    assert.match(template, /文件粒度/);
    assert.ok(template.includes("<current-file>"), "current directory tree must show files");
    assert.ok(template.includes("<new-file>"), "target directory tree must show added files");
    assert.ok(template.includes("<existing-file>"), "target directory tree must show changed files");
    assert.ok(template.includes("（新增）"), "target directory tree must mark added paths");
    assert.ok(template.includes("（改）"), "target directory tree must mark changed paths");
    for (const diagram of ["C4", "sequenceDiagram", "stateDiagram-v2", "erDiagram", "classDiagram"]) {
      assert.ok(template.includes(diagram), `arch-design template must cue ${diagram}`);
    }

  });

  test("arch-design makes technical quality and code-level flows reviewable", () => {
    const text = read("plugins/auriga-workflow/skills/arch-design/SKILL.md");
    const template = read(
      "plugins/auriga-workflow/skills/arch-design/references/arch-design-template.md",
    );

    assert.match(text, /技术质量目标/);
    assert.match(text, /人工[^。\n]*重点评审/);
    const quality = markdownSection(template, "## 5. 质量风险与保障");
    const observability = markdownSection(template, "## 6. 可观测设计");
    assert.ok(quality.includes("| 风险维度 | 风险与影响 | 保障方式 | 验证方式与通过标准 |"));
    assert.ok(observability.includes("| 观测维度 | 目的与适用场景 | 信号与采集设计 | 使用与处置 | 验证方式 |"));
    const requirement = markdownSection(template, "### 3.1 `<需求主题>`");
    const flows = markdownSection(
      requirement,
      "#### 3.1.4 流程与必要图示",
    );
    assert.doesNotMatch(requirement, /Data Flow \/ 数据流/);
    assert.match(flows, /完整数据流/);
    assert.match(flows, /图示说明与设计理由/);
    assert.match(template, /用户[^。\n]*外部系统[^。\n]*(?:定时任务|领域事件)/);
    assert.match(template, /代码内部/);
    assert.match(template, /文件级职责/);
    assert.match(template, /接口实现映射/);
    assert.match(template, /部署与运行/);
    assert.match(template, /可选章节/);
    assert.match(template, /普通前端[^。\n]*移动端[^。\n]*默认删除/);
    for (const [earlier, later] of [
      ["## 5. 质量风险与保障", "## 6. 可观测设计"],
      ["## 6. 可观测设计", "## 7. 部署与运行"],
      ["## 7. 部署与运行", "## 8. 人工确认结果"],
    ]) {
      assert.ok(template.indexOf(earlier) < template.indexOf(later), `${earlier} must precede ${later}`);
    }
  });

  test("arch-design keeps rationale next to the mechanism it explains", () => {
    const skill = read("plugins/auriga-workflow/skills/arch-design/SKILL.md");
    const template = read(
      "plugins/auriga-workflow/skills/arch-design/references/arch-design-template.md",
    );
    const requirement = markdownSection(template, "### 3.1 `<需求主题>`");
    const localModel = markdownSection(
      requirement,
      "##### 3.1.2.1 本项模型设计",
    );
    const api = markdownSection(requirement, "##### 3.1.2.2 接口设计");
    const flows = markdownSection(
      requirement,
      "#### 3.1.4 流程与必要图示",
    );

    assert.doesNotMatch(requirement, /Rationale \/ 为什么/);
    assert.match(localModel, /设计理由/);
    assert.match(localModel, /为什么/);
    assert.match(api, /设计理由/);
    assert.match(flows, /图示说明与设计理由/);
    assert.match(skill, /理由[^。\n]*就地/);
    assert.match(skill, /模型[^。\n]*接口[^。\n]*图示/);
  });

  test("arch-design resolves target-local rules and degrades safely without a writable project", () => {
    const text = read("plugins/auriga-workflow/skills/arch-design/SKILL.md");

    assert.match(text, /受影响代码[^。\n]*更近的 `docs\/rules\/arch\/`/);
    assert.match(text, /目标范围[^。\n]*(?:确认|澄清)/);
    assert.match(text, /无法写入[^。\n]*(?:对话|会话)/);
  });

  test("arch-design routes design conditions to a compact reference toolbox", () => {
    const text = read("plugins/auriga-workflow/skills/arch-design/SKILL.md");
    const references = [
      "component-design.md",
      "interface-design.md",
      "domain-modeling.md",
      "migration-strategies.md",
    ];

    for (const file of references) {
      const rel = `plugins/auriga-workflow/skills/arch-design/references/${file}`;
      assert.ok(fs.existsSync(path.join(repoRoot, rel)), `${rel} must exist`);
      assert.ok(text.includes(`references/${file}`), `${file} must have a routing condition`);
      const reference = read(rel);
      assert.match(reference, /何时使用/);
      assert.match(reference, /可用方法|可用兵器/);
    }
  });

  test("arch-design removes presentation detours and synthetic option generation", () => {
    const text = read("plugins/auriga-workflow/skills/arch-design/SKILL.md");
    const template = read(
      "plugins/auriga-workflow/skills/arch-design/references/arch-design-template.md",
    );

    for (const content of [text, template]) {
      assert.doesNotMatch(content, /playground|静态 HTML|arch-overview\.html/i);
      assert.doesNotMatch(content, /(?:≥|>=)\s*2[^。\n]*候选|出[^。\n]*(?:≥|>=)\s*2/);
    }
    assert.match(text, /真实[^。\n]*取舍[^。\n]*候选/);
    assert.match(template, /只有存在[^。\n]*真实取舍[^。\n]*比较候选/);
  });

  test("arch-design migration handoff preserves transition exit conditions", () => {
    const template = read(
      "plugins/auriga-workflow/skills/arch-design/references/arch-design-template.md",
    );
    const migration = read(
      "plugins/auriga-workflow/skills/arch-design/references/migration-strategies.md",
    );

    for (const field of ["中间状态", "兼容窗口", "切换信号", "旧路径删除条件", "负责人"]) {
      assert.ok(template.includes(field), `arch-design template must preserve ${field}`);
      assert.match(
        migration.match(/## 输出到设计文档[\s\S]*/)![0],
        new RegExp(field),
        `migration output mapping must preserve ${field}`,
      );
    }
  });

  test("architecture consumers honor the approved design boundary", () => {
    const specDesign = read("plugins/auriga-workflow/skills/spec-design/SKILL.md");
    const incremental = read("plugins/auriga-workflow/skills/incremental-impl/SKILL.md");
    const handoff = specDesign.match(/### Phase D[^\n]*\n([\s\S]*?)(?=\n## |$)/);

    assert.ok(handoff, "spec-design must preserve its Phase D handoff section");
    assert.match(handoff[0], /arch-design[^。\n]*人工确认/);
    assert.match(incremental, /已确认[^。\n]*arch_design\.md[^。\n]*(?:优先|约束)/);
  });

  test("incremental-impl keeps requirement-led implementation unit contracts", () => {
    const text = read("plugins/auriga-workflow/skills/incremental-impl/SKILL.md");
    const pluginReadme = read("plugins/auriga-workflow/README.md");
    const specDesign = read("plugins/auriga-workflow/skills/spec-design/SKILL.md");
    const umbrellaTemplate = read(
      "plugins/auriga-workflow/skills/spec-design/references/umbrella-template.md",
    );
    const zhWorkflow = read("AGENTS.template.zh-CN.md");
    const enWorkflow = read("AGENTS.template.en.md");
    const repoWorkflow = read("AGENTS.md");

    // VAL-IMPL-001: consume approved inputs without silently reopening upstream decisions.
    assert.match(text, /用户最新决定[^。]*验收契约[^。]*arch_design\.md[^。]*当前计划/);
    assert.match(text, /不在实现阶段重新决定产品范围、模块边界或迁移形态/);

    // VAL-IMPL-002: one unit carries the whole coherent result and its protection evidence.
    assert.match(text, /完整实施单元[^。]*(?:需求结果|迁移状态)[^。]*最小改动集合/);
    assert.match(text, /结果完整[^\n]*(?:代码|实现)[^\n]*测试[^\n]*(?:配置|数据变化)[^\n]*文档/);
    assert.match(text, /行为保护/);

    // VAL-IMPL-003: split by independently verifiable results, not delivery mechanics.
    assert.match(text, /技术不变量/);
    assert.match(text, /只有当两个结果[^。]*分别验证[^。]*分别集成[^。]*才拆/);
    assert.match(text, /文件数、代码行数、提交数量和写入者[^。]*不是单元边界/);
    assert.match(text, /中间状态合法/);

    // VAL-IMPL-005: parallelism follows decomposition and has no unmet dependencies.
    assert.match(text, /默认单写者[^。]*按依赖顺序实施/);
    assert.match(
      text,
      /拆分完成后[^。]*文件所有权互不重叠[^。]*输入输出(?:边界)?稳定[^。]*(?:不存在未满足依赖|依赖已经完成)[^。]*并行/,
    );
    assert.match(text, /有前后依赖[^。]*等待前置结果完成/);

    // VAL-IMPL-006..009: preserve cross-runtime dispatch capabilities and evidence handoff.
    assert.match(text, /模型与推理强度默认继承[^。]*确有需要[^。]*运行时支持[^。]*参数覆盖[^。]*不写死/);
    assert.match(text, /运行时原生工作树/);
    assert.match(text, /主代理预先创建并传入路径/);
    assert.match(text, /无法建立等价隔离时改为串行/);
    assert.match(
      text,
      /写入代理收到[^。]*单元结果[^。]*权威资料[^。]*工作目录[^。]*文件所有权[^。]*禁止范围[^。]*依赖[^。]*验证方式[^。]*期望证据/,
    );
    assert.match(text, /委派写入[^。]*变更结果[^。]*验证证据[^。]*未解决问题/);
    assert.match(text, /内联实现[^。]*不生成[^。]*固定交接模板/);
    assert.match(text, /代理间通信[^。]*正确性不能依赖临时消息/);
    assert.match(text, /权威接口、决定和进度[^。]*仓库或持久计划验证/);

    // VAL-IMPL-010: commits keep semantic boundaries without mirroring unit boundaries.
    assert.match(text, /git-workflow[^。]*语义边界提交[^。]*不强制[^。]*实施单元[^。]*提交/);

    for (const removed of [
      /\b(?:XS|S|M|L|XL)\b/,
      /30[–-]100/,
      /300[–-]800/,
      /规模(?:门|分档|过滤|判定)/,
      /(?:最低|最少|minimum)[^。\n]{0,30}(?:代理|agent|并行|parallel)/i,
      /(?:差异|代码|diff)[^。\n]{0,20}(?:行数|lines?)[^。\n]{0,20}(?:阈值|[<>≤≥]|\d+\s*[–-]\s*\d+)/i,
      /Minimum-slices gate/i,
      /NOTICED BUT NOT TOUCHING/,
      /没有 agent-to-agent channel/i,
      /每个 slice 一个 atomic commit/i,
      /Never delete-and-replace/i,
    ]) {
      assert.doesNotMatch(text, removed);
    }

    // VAL-IMPL-011: public entry points describe decomposition before execution routing.
    assert.match(
      pluginReadme,
      /\| `incremental-impl` \|[^|\n]*requirement changes[^|\n]*implementation units[^|\n]*incremental execution/i,
    );
    assert.match(
      zhWorkflow,
      /incremental-impl[^。\n]*先[^。\n]*完整[^。\n]*实施单元[^。\n]*按依赖/,
    );
    assert.match(enWorkflow, /incremental-impl[^\n]*decompose[^\n]*complete implementation units[^\n]*dependency/i);
    assert.match(specDesign, /incremental-impl[^\n]*子规范[^\n]*完整[^\n]*实施单元/);
    assert.match(umbrellaTemplate, /incremental-impl[^\n]*子规范[^\n]*完整实施单元/);
    assert.doesNotMatch(specDesign, /incremental-impl[^\n]*(?:第 2 步|同一套切分轴)/);
    assert.doesNotMatch(umbrellaTemplate, /incremental-impl Step 2/);
    for (const workflow of [zhWorkflow, enWorkflow, repoWorkflow]) {
      assert.match(workflow, /# auriga (?:工作流|Workflow) \(v\d+\.\d+\.\d+\)/);
    }
    assert.doesNotMatch(zhWorkflow, /判定 XS/);
    assert.doesNotMatch(enWorkflow, /rates the work XS/);
  });

  test("deep-review test-quality reviewer consumes project test rules", () => {
    const text = read(
      "plugins/auriga-workflow/skills/deep-review/references/reviewers/test-quality.md",
    );
    assert.ok(
      text.includes("docs/rules/test/"),
      "test-quality reviewer must consult project test rules under docs/rules/test/",
    );
    assert.ok(
      /test-driven-development/.test(text),
      "test-quality reviewer must stay aligned with test-driven-development",
    );
  });

  test("test-quality reviewer may run unit tests only", () => {
    const text = read(
      "plugins/auriga-workflow/skills/deep-review/references/reviewers/test-quality.md",
    );
    assert.ok(
      /tools:.*Bash/.test(text),
      "test-quality reviewer must be granted Bash to run tests",
    );
    assert.ok(
      text.includes("Running tests — unit only"),
      "test-quality reviewer must scope test execution to unit tests only",
    );
  });

  test("tiered reviewers classify targets before checking", () => {
    const tiers: Array<{ file: string; section: string; anchors: string[] }> = [
      {
        file: "docs-sync.md",
        section: "Document tiers",
        anchors: ["归档快照", "精简或删除"],
      },
      {
        file: "code-quality.md",
        section: "Audience tiers",
        anchors: ["低受众代码", "机制优先"],
      },
      {
        file: "ux.md",
        section: "Surface tiers",
        anchors: ["内部工具 / 临时制品", "自动化承重"],
      },
    ];
    for (const { file, section, anchors } of tiers) {
      const text = read(
        `plugins/auriga-workflow/skills/deep-review/references/reviewers/${file}`,
      );
      assert.ok(
        text.includes(section),
        `${file} must keep its "${section}" tiering section`,
      );
      for (const anchor of anchors) {
        assert.ok(
          text.includes(anchor),
          `${file} tiering rule must keep the "${anchor}" rule anchor`,
        );
      }
      assert.ok(
        text.includes("不是预过滤"),
        `${file} output contract must reconcile tiering with the no-prefilter preamble`,
      );
    }
  });
});

describe("project rule discovery anchors to the repo root", () => {
  const ruleConsumers: Array<{ rel: string; area: string; label: string }> = [
    {
      rel: "plugins/auriga-workflow/skills/deep-review/SKILL.md",
      area: "docs/rules/review/",
      label: "deep-review",
    },
    {
      rel: "plugins/auriga-workflow/skills/test-driven-development/SKILL.md",
      area: "docs/rules/test/",
      label: "test-driven-development",
    },
    {
      rel: "plugins/auriga-workflow/skills/deep-review/references/reviewers/test-quality.md",
      area: "docs/rules/test/",
      label: "test-quality reviewer",
    },
    {
      rel: "plugins/auriga-workflow/skills/spec-design/SKILL.md",
      area: "docs/rules/spec/",
      label: "spec-design",
    },
    {
      rel: "plugins/auriga-workflow/skills/arch-design/SKILL.md",
      area: "docs/rules/arch/",
      label: "arch-design",
    },
  ];

  for (const { rel, area, label } of ruleConsumers) {
    test(`${label} resolves ${area} from the git repo root`, () => {
      const text = read(rel);
      assert.ok(
        text.includes(area),
        `${rel} must consume project rules under ${area}`,
      );
      assert.ok(
        text.includes("git rev-parse --show-toplevel"),
        `${rel} must anchor rule discovery to the repo root via git rev-parse --show-toplevel`,
      );
      assert.ok(
        /子包级.{0,4}(为准|优先)/.test(text),
        `${rel} must state subpackage-level precedence as one phrase (子包级…为准/优先)`,
      );
      assert.ok(
        /非 git 仓库[^\n]{0,12}回退/.test(text),
        `${rel} must define the non-git-repo fallback to cwd`,
      );
    });
  }

  test("reviewer-creator writes custom reviewers anchored to the repo root", () => {
    const text = read(
      "plugins/auriga-workflow/skills/reviewer-creator/SKILL.md",
    );
    assert.ok(
      text.includes("git rev-parse --show-toplevel"),
      "reviewer-creator must resolve the output directory from the git repo root",
    );
    assert.ok(
      text.includes("|| pwd"),
      "the mkdir command must fall back to cwd when git rev-parse fails (non-git dir would otherwise expand to /docs/rules/review/)",
    );
    assert.ok(
      text.includes("<仓库根>/docs/rules/review/<name>.md"),
      "the write target must be anchored to the repo root",
    );
  });

  test("spec-design consumes project spec rules as clarification input and gate item", () => {
    const text = read("plugins/auriga-workflow/skills/spec-design/SKILL.md");
    assert.ok(
      text.includes("docs/rules/spec/"),
      "spec-design must consult project spec rules under docs/rules/spec/",
    );
    assert.ok(
      /无项目专属 spec 规则/.test(text),
      "spec-design must record explicitly when no project spec rules exist",
    );
  });

  test("session-compound separates report generation from opt-in asset management", () => {
    const text = read(
      "plugins/auriga-workflow/skills/session-compound/SKILL.md",
    );
    assert.ok(
      text.includes("documentation-management") &&
        text.includes("skill-creator") &&
        text.includes("reviewer-creator"),
      "selected candidates must route through the appropriate asset-management skill",
    );
    assert.ok(
      /不自动安装技能/.test(text) && /只有用户明确选择/.test(text),
      "report generation must not mutate long-term assets by default",
    );
  });

  test("arch-design consumes project architecture rules as design constraints", () => {
    const text = read("plugins/auriga-workflow/skills/arch-design/SKILL.md");
    assert.ok(
      text.includes("docs/rules/arch/"),
      "arch-design must consult project architecture rules under docs/rules/arch/",
    );
    assert.ok(
      /无项目专属架构规则/.test(text),
      "arch-design must record explicitly when no project architecture rules exist",
    );
  });
});

describe("deep-review custom-reviewer explicit protocol", () => {
  test("custom reviewers declare a host or standalone explicitly", () => {
    const text = deepReview();
    assert.ok(
      text.includes("extends: <内置审查者名>"),
      "SKILL.md must require an explicit built-in host",
    );
    assert.ok(
      text.includes("extends: standalone"),
      "SKILL.md must support an explicit standalone dimension",
    );
  });

  test("hosted custom content is delivered as a project supplement", () => {
    const text = deepReview();
    assert.ok(
      text.includes("项目专属补充"),
      "absorbed custom content must be labelled as a project-specific supplement",
    );
    assert.ok(
      /宿主组成一个数据包/.test(text),
      "the host and project supplement must share one review packet",
    );
  });

  test("standalone custom reviewer remains an independent dimension", () => {
    const text = deepReview();
    assert.ok(
      text.includes("独立维度"),
      "SKILL.md must describe a standalone reviewer as an independent dimension",
    );
    assert.ok(
      /extends: standalone/.test(text),
      "independent dispatch must be explicit",
    );
  });

  test("invalid metadata becomes a review gap instead of semantic guessing", () => {
    const text = deepReview();
    assert.ok(
      text.includes("不做正文语义猜测"),
      "the orchestrator must not infer a host from the reviewer body",
    );
    assert.ok(
      text.includes("审查缺口"),
      "invalid custom metadata must remain visible as a gap",
    );
    for (const key of [
      "name",
      "best_for",
      "extends",
      "trigger",
      "reasoning",
      "tools",
      "value",
    ]) {
      assert.match(
        text,
        new RegExp(`\\b${key}\\b`),
        `custom reviewer validation must cover ${key}`,
      );
    }
  });

  test("name collision does not silently choose a host", () => {
    const text = deepReview();
    assert.ok(
      /重名[^]*?显式声明/.test(text),
      "a name collision must still require an explicit declaration",
    );
  });

  test("extension trigger can activate its host", () => {
    const text = deepReview();
    assert.ok(
      /宿主默认条件或任一项目扩展[^]*?命中[^]*?运行宿主/.test(text),
      "host and extension triggers must be combined",
    );
  });

  test("absorbed findings preserve the project reviewer source", () => {
    const text = deepReview();
    assert.ok(
      /\(宿主名 \/ 项目审查者名\)/.test(text),
      "findings from project supplements must preserve their source",
    );
    assert.match(
      text,
      /独立审查者[^。\n]*\(项目审查者名, standalone\)/,
      "standalone findings must preserve their independent source",
    );
  });

  test("project reviewer instructions come from the trusted base", () => {
    const text = deepReview();
    assert.match(text, /基准分支[^。\n]*(?:可信|信任)/);
    assert.match(text, /新增或修改[^。\n]*项目审查者[^。\n]*(?:不执行|不能执行)/);
    assert.match(text, /作为[^。\n]*(?:差异|审查对象)/);
  });

  // VAL-OVL-008 — Extends: standalone is a sentinel that forces independent dispatch
  test("Extends: standalone forces independent dispatch", () => {
    const text = deepReview();
    assert.ok(
      text.includes("extends: standalone") || text.includes("`standalone`"),
      "SKILL.md must recognize the standalone sentinel value of extends",
    );
    assert.ok(
      /standalone[^]*?独立[^]*?分派/.test(text),
      "Extends: standalone must force the custom reviewer to dispatch independently",
    );
  });

  test("missing Extends is rejected instead of absorbed by default", () => {
    const text = deepReview();
    assert.ok(
      /缺失(?:、|或)非法[^]*?extends/.test(text),
      "missing or invalid extends must be called out",
    );
    assert.ok(
      !text.includes("偏向吸收"),
      "the old implicit absorption rule must be removed",
    );
  });
});

describe("deep-review dispatch delivery", () => {
  // VAL-DISP-001 — reviewer content is self-read by the subagent via absolute path
  test("reviewer content is delivered by absolute-path self-read, not inlined through the main agent", () => {
    const text = deepReview();
    assert.ok(
      text.includes("绝对路径"),
      "the subagent must receive an absolute path to the reviewer file",
    );
    assert.ok(
      text.includes("自读"),
      "the subagent must self-read the reviewer file in its own context",
    );
  });

  // VAL-DISP-002 — main agent reads only the YAML frontmatter to orchestrate
  test("main agent reads only the frontmatter to orchestrate dispatch", () => {
    const text = deepReview();
    assert.ok(
      text.includes("frontmatter"),
      "orchestration must rely on the YAML frontmatter",
    );
    assert.ok(
      /只读[^]*?frontmatter/.test(text),
      "the main agent must read only the frontmatter for orchestration, not the full body",
    );
  });

  // VAL-DISP-003 — inline fallback documented for sandboxes that cannot resolve the path
  test("an inline fallback is documented for delegates that cannot resolve the path", () => {
    const text = deepReview();
    assert.ok(
      /路径[^]*?内联|内联[^]*?路径|无法解析[^]*?内联/.test(text),
      "a path-unresolvable delegate must fall back to inlining the reviewer body",
    );
  });

  test("reviewers without frontmatter are reported as gaps without prose fallback", () => {
    const text = deepReview();
    assert.ok(
      /合法 YAML frontmatter/.test(text),
      "SKILL.md must require valid YAML frontmatter",
    );
    assert.ok(
      !/回退读取旧 `## Metadata`/.test(text) || text.includes("不回退读取旧 `## Metadata`"),
      "the legacy prose metadata fallback must be removed",
    );
  });
});

describe("reviewer-creator extends support", () => {
  // VAL-CRT-001 — the scaffold template ships an extends frontmatter key
  test("template.md ships an extends key in YAML frontmatter", () => {
    const text = read(
      "plugins/auriga-workflow/skills/reviewer-creator/references/template.md",
    );
    assert.ok(
      text.startsWith("---\n"),
      "template must lead with YAML frontmatter",
    );
    assert.ok(
      /^name:/m.test(text),
      "template frontmatter must include a name key",
    );
    assert.ok(
      /^extends:/m.test(text),
      "template frontmatter must include an extends key",
    );
    assert.ok(
      text.includes("standalone"),
      "template must document the standalone sentinel for forced independence",
    );
  });

  // VAL-REV-001, VAL-REV-002 — classify from evidence and ask only on real ambiguity
  test("SKILL.md classifies hosted versus standalone reviewers without mandatory questioning", () => {
    const text = read(
      "plugins/auriga-workflow/skills/reviewer-creator/SKILL.md",
    );
    assert.ok(
      text.includes("extends"),
      "reviewer-creator must populate the extends field from the answer",
    );
    assert.match(text, /补充[^]*?独立维度|独立维度[^]*?补充/);
    assert.match(
      text,
      /证据[^。\n]*(?:明确|足够)[^。\n]*(?:直接|判断|确定)/,
      "clear repository evidence should be enough to classify the reviewer",
    );
    assert.match(
      text,
      /歧义[^。\n]*(?:询问|确认)/,
      "user confirmation should be reserved for ambiguity that changes routing",
    );
    assert.ok(
      !text.includes("不会自动产出"),
      "the stale claim that reviewer-creator never emits extends must be removed",
    );
  });

  // VAL-CRT-003 — the field schema (required vs optional) is documented explicitly
  test("SKILL.md documents the frontmatter field schema with required vs optional", () => {
    const text = read(
      "plugins/auriga-workflow/skills/reviewer-creator/SKILL.md",
    );
    assert.ok(
      /Frontmatter schema|字段 schema|frontmatter 字段/.test(text),
      "must include an explicit frontmatter schema section",
    );
    assert.ok(
      text.includes("必填") && text.includes("可选"),
      "the schema must distinguish required from optional fields",
    );
    assert.match(text.match(/\*\*必填：\*\*[\s\S]*?\*\*可选：\*\*/)?.[0] ?? "", /extends/);
    assert.match(text.match(/\*\*可选：\*\*[\s\S]*?(?:##|$)/)?.[0] ?? "", /effort/);
  });

  // VAL-REV-004 — deep-review owns the current registry and routing vocabulary
  test("reviewer-creator reads the current deep-review protocol instead of duplicating its registry", () => {
    const text = read(
      "plugins/auriga-workflow/skills/reviewer-creator/SKILL.md",
    );
    assert.match(text, /deep-review[^。\n]*(?:路由表|元数据协议|注册表)/);
    assert.doesNotMatch(text, /内置名称：/);
    for (const trigger of Object.values(builtinReviewerTriggers)) {
      assert.ok(
        !text.includes(`- \`${trigger}\``),
        `reviewer-creator must not duplicate registered trigger ${trigger}`,
      );
    }
  });

  // VAL-REV-003 — content depth follows risk instead of fixed quotas
  test("reviewer guidance has no fixed checklist or scenario quota", () => {
    const creator = read(
      "plugins/auriga-workflow/skills/reviewer-creator/SKILL.md",
    );
    const template = read(
      "plugins/auriga-workflow/skills/reviewer-creator/references/template.md",
    );
    assert.doesNotMatch(creator, /5[–-]10|2[–-]3/);
    assert.doesNotMatch(template, /5[–-]10|2[–-]3/);
    assert.match(template, /边界[^。\n]*(?:容易混淆|不明显)[^。\n]*(?:保留|提供)/);
    assert.match(template, /没有[^。\n]*(?:真实|必要)[^。\n]*删除本节/);
  });

  test("reviewer-creator uses only mechanically routable triggers", () => {
    const text = read(
      "plugins/auriga-workflow/skills/reviewer-creator/SKILL.md",
    );
    assert.doesNotMatch(text, /detection-driven/);
  });

  // VAL-REV-005 — project reviewers keep dimension rules without changing the shared envelope
  test("project reviewers inherit the shared output envelope", () => {
    const creator = read(
      "plugins/auriga-workflow/skills/reviewer-creator/SKILL.md",
    );
    const template = read(
      "plugins/auriga-workflow/skills/reviewer-creator/references/template.md",
    );
    assert.match(creator, /补充型[^。\n]*继承[^。\n]*宿主[^。\n]*输出契约/);
    assert.match(creator, /所有项目审查者[^。\n]*统一 Reviewer Output Contract/);
    assert.match(template, /仅[^。\n]*standalone[^。\n]*保留/);
    assert.match(template, /统一 Reviewer Output Contract/);
    assert.doesNotMatch(template, /\[severity:|\[confidence:|No findings\./);
  });
});

describe("deep-review modernization contract", () => {
  const reviewer = (name: string) =>
    read(
      `plugins/auriga-workflow/skills/deep-review/references/reviewers/${name}.md`,
    );

  test("CI review uses the trusted base contract without overriding its synthesis format", () => {
    const workflow = read(".github/workflows/claude-code-review.yml");

    assert.match(
      workflow,
      /BASE_SHA=\$\{\{ github\.event\.pull_request\.base\.sha \}\}/,
      "review orchestration must anchor to the trusted base commit",
    );
    assert.match(workflow, /git archive "\$BASE_SHA" "\$CONTRACT_DIR"/);
    assert.match(workflow, /echo "path=\$SKILL" >> "\$GITHUB_OUTPUT"/);
    assert.match(workflow, /steps\.deep-review-contract\.outputs\.path/);
    assert.doesNotMatch(workflow, /LOCAL_SKILL=|npx -y skills add/);
    assert.match(workflow, /Reviewer Output Contract/);
    assert.match(workflow, /综合/);
    assert.match(workflow, /anchored to a changed diff line/);
    assert.match(workflow, /cannot be anchored[^.\n]*review body/);
    assert.doesNotMatch(workflow, /No findings\.|\[severity:|OVERALL:/);
  });

  test("first formal review respects CI routing and later agent-proposed reruns ask", () => {
    const text = deepReview();
    assert.match(text, /没有[^。]*持续集成评审[^。]*本地[^。]*直接执行/);
    assert.match(text, /已有[^。]*持续集成评审[^。]*询问用户[^。]*本地/);
    assert.match(text, /用户明确要求[^。]*深度审查[^。]*直接执行/);
    assert.match(text, /用户明确要求再次审查[^。]*直接执行/);
    assert.match(text, /代理主动建议重跑[^。]*先询问用户/);
    assert.match(text, /正式审查记录|正式评审记录/);
    assert.match(text, /无法判断[^。\n]*询问用户/);
  });

  test("reviewers run with an explicit clean-context packet and bounded retry", () => {
    const text = deepReview();
    const execution = markdownSection(text, "## 5. 独立执行");
    for (const anchor of [
      "不继承实现会话",
      "不使用 `resume` / `continue`",
      "目标元数据",
      "原始差异",
      "权威需求",
      "适用项目规则",
      "审查者文件路径",
      "审查缺口",
    ]) {
      assert.ok(execution.includes(anchor), `missing isolation anchor: ${anchor}`);
    }
    for (const forbidden of ["实现会话", "当前对话历史", "先前审查会话"]) {
      assert.match(
        execution,
        new RegExp(`不继承[^。\\n]*${forbidden}|不复制[^。\\n]*${forbidden}`),
        `clean contexts must prohibit inheriting ${forbidden}`,
      );
    }
    assert.match(execution, /明确的瞬时失败[^。\n]*重试一次/);
    assert.match(execution, /共享故障|永久错误/);
  });

  test("built-in agents are the default and external processes require an explicit user request", () => {
    const text = deepReview();
    const execution = markdownSection(text, "## 5. 独立执行");
    assert.match(execution, /默认[^。\n]*平台内置[^。\n]*Agent/);
    assert.match(
      execution,
      /只有用户明确要求[^。\n]*(?:独立进程|非交互式)[^。\n]*Agent[^。\n]*才[^。\n]*外部/,
    );
    assert.match(
      execution,
      /缺少[^。\n]*细粒度[^。\n]*(?:不能|不得)[^。\n]*切换[^。\n]*外部/,
    );
    assert.match(
      execution,
      /缺少[^。\n]*细粒度[^。\n]*(?:不能|不得)[^。\n]*停止[^。\n]*内置/,
    );
    assert.doesNotMatch(execution, /平台能力确有需要[^。\n]*外部代理/);
  });

  test("reviewer tools are enforced and untrusted head code is not executed", () => {
    const text = deepReview();
    const execution = markdownSection(text, "## 5. 独立执行");
    assert.match(execution, /tools[^。\n]*最大权限/);
    assert.match(execution, /实际权限[^。\n]*交集/);
    assert.match(execution, /平台原生[^。\n]*(?:隔离|权限边界)/);
    assert.match(
      execution,
      /外部[^。\n]*无法[^。\n]*(?:只读|阻止外部写入)[^。\n]*不启动/,
    );
    assert.match(
      execution,
      /外部[^。\n]*无法[^。\n]*(?:只读|阻止外部写入)[^。\n]*审查缺口/,
    );
    assert.match(execution, /不可信[^。\n]*(?:头分支|拉取请求)[^。\n]*不执行/);
    assert.match(execution, /持续集成[^。\n]*证据/);
  });

  test("routing uses risk surfaces instead of a trivial/non-trivial split", () => {
    const text = deepReview();
    for (const signal of [
      "executable-behavior",
      "tests",
      "maintained-code",
      "security-sensitive",
      "performance-sensitive",
      "agent-extension",
    ]) {
      assert.ok(text.includes(`\`${signal}\``), `missing signal ${signal}`);
    }
    assert.match(text, /新增普通文件本身不等于架构变化/);
    assert.match(text, /生产代码或测试变化时触发|`executable-behavior` 或 `tests`/);
    for (const [reviewer, trigger] of Object.entries(builtinReviewerTriggers)) {
      const row = text
        .split("\n")
        .find((line) => line.startsWith(`| \`${reviewer}\` |`));
      assert.ok(row, `missing routing row for ${reviewer}`);
      const expectedSignals = trigger === "tag:executable-behavior-or-tests"
        ? ["`executable-behavior`", "`tests`"]
        : [trigger === "always" ? "始终执行" : `\`${trigger.slice(4)}\``];
      assert.ok(
        expectedSignals.every((signal) => row.includes(signal)),
        `${reviewer} must keep routing trigger ${trigger}`,
      );
    }
  });

  test("correctness owns edge and failure behavior and robustness is retired", () => {
    const text = reviewer("correctness");
    assert.match(text, /正常、边界和失败/);
    assert.match(text, /超时与重试/);
    assert.match(text, /资源生命周期/);
    assert.ok(
      !fs.existsSync(
        path.join(
          repoRoot,
          "plugins/auriga-workflow/skills/deep-review/references/reviewers/robustness.md",
        ),
      ),
      "robustness reviewer must be removed",
    );
  });

  test("deep-review ships exactly ten built-in reviewers", () => {
    const dir = path.join(
      repoRoot,
      "plugins/auriga-workflow/skills/deep-review/references/reviewers",
    );
    assert.deepEqual(
      fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".md"))
        .map((name) => name.replace(/\.md$/, ""))
        .sort(),
      Object.keys(builtinReviewerTriggers).sort(),
    );
  });

  test("auriga-workflow dual-runtime manifests carry the same release version", () => {
    const claude = JSON.parse(
      read("plugins/auriga-workflow/.claude-plugin/plugin.json"),
    );
    const codex = JSON.parse(
      read("plugins/auriga-workflow/.codex-plugin/plugin.json"),
    );
    assert.equal(codex.version, claude.version);
    assert.match(claude.version, /^\d+\.\d+\.\d+$/);
    const [major, minor, patch] = claude.version.split(".").map(Number);
    assert.ok(
      major > 4 || (major === 4 && (minor > 0 || patch >= 16)),
      `plugin version ${claude.version} must not regress below 4.0.18`,
    );
  });

  test("spec conformance keeps the complete authoritative-source priority", () => {
    const text = reviewer("spec-conformance");
    const sources = markdownSection(text, "## Authoritative sources");
    const rows = sources
      .split("\n")
      .filter((line) => /^\| [1-5] \|/.test(line));
    assert.equal(rows.length, 5);
    for (const [index, expected] of [
      "当前对话",
      "validation-contract.md",
      "任务、问题、计划、长期规格或已确认设计",
      "worklog",
      "拉取请求正文",
    ].entries()) {
      assert.match(rows[index], new RegExp(expected.replace(".", "\\.")));
    }
  });

  test("spec conformance accepts conversational requirements and rejects implementation rationale", () => {
    const text = reviewer("spec-conformance");
    assert.match(text, /用户的原始要求与最新明确决定/);
    assert.match(text, /validation-contract\.md/);
    assert.match(text, /docs\/long-running-specs/);
    assert.match(text, /提交信息、实现说明、技术理由[^。]*不是权威需求来源/);
    assert.match(text, /No authoritative requirement source/);
  });

  test("docs sync checks unchanged assets and supports reducing the document estate", () => {
    const text = reviewer("docs-sync");
    assert.match(text, /未修改文档/);
    for (const action of ["删除", "合并", "压缩", "归档", "晋升"]) {
      assert.ok(text.includes(action), `docs-sync must support ${action}`);
    }
    assert.match(text, /归档快照[^。]*不为追赶当前实现而改写/);
    assert.match(text, /未经用户明确授权的过程流水账应删除或迁移/);
    assert.match(text, /只追加单行[^。]*替换或重写相邻内容/);
    assert.match(text, /指出删除或迁移哪些内容[^>]*合并、抽象成什么稳定规则/);
    assert.match(text, /`delete`、`merge` 和 `compress` 不能只给动作标签/);
    assert.match(text, /未经授权记录任务过程[^。]*阻断问题/);
    assert.match(text, /零散、重复或可进一步抽象[^。]*非阻断问题/);
    assert.doesNotMatch(text, /按 (?:blocking|non-blocking) 报告/);
  });

  test("test review is behavior-led without mechanical case or assertion rules", () => {
    const text = reviewer("test-quality");
    assert.match(text, /一条验收要求可以需要多个测试[^。]*一个高层测试/);
    assert.match(text, /文本契约/);
    assert.match(text, /不强制单断言/);
    assert.ok(!text.includes("五类场景"));
    assert.ok(!text.includes("每个分支必须"));
  });

  test("architecture review follows approved designs without rejecting anemic models", () => {
    const text = reviewer("architecture");
    assert.match(text, /docs\/rules\/arch/);
    assert.match(text, /arch_design\.md/);
    assert.match(text, /贫血模型中立/);
    assert.match(text, /规则散落、不变量泄漏、职责错位/);
    assert.ok(!text.includes("贫血领域模型是反模式"));
  });

  test("security, performance and ux require contextual evidence", () => {
    const security = reviewer("security");
    assert.match(security, /生产公开、生产受限、内部、个人本地、短期演示/);
    assert.match(security, /攻击者能控制什么/);
    assert.match(security, /信任边界/);

    const performance = reviewer("performance");
    assert.match(performance, /输入规模、增长方式/);
    assert.match(performance, /measured/);
    assert.match(performance, /structural/);
    assert.match(performance, /speculative/);

    const ux = reviewer("ux");
    assert.match(ux, /trigger:\s*["']?tag:ui["']?/);
    assert.match(ux, /尼尔森[^。\n]*可用性启发式/);
    assert.match(ux, /不是[^。\n]*(?:固定问卷|逐项清单|合规清单)/);
    assert.match(ux, /视觉[^。]*需要渲染、截图或明确代码证据/);
    assert.match(ux, /accessibilityIdentifier[^；]*不等于 VoiceOver/);
    assert.match(ux, /resource-id[^。]*不等于 TalkBack/);
    assert.match(ux, /可靠撤销时不强制二次确认/);
    assert.match(ux, /heuristic:/);
  });

  test("skill and plugin review keeps Auriga dual entry points and validators", () => {
    const text = reviewer("skill-plugin-quality");
    assert.match(text, /`AGENTS\.md` 与 `CLAUDE\.md` \*\*同时存在\*\*/);
    assert.match(text, /`CLAUDE\.md -> AGENTS\.md` 兼容软链/);
    assert.match(text, /Claude Code：[\s\S]*quick_validate\.py/);
    assert.match(text, /Codex：[\s\S]*quick_validate\.py/);
    assert.match(text, /两种验证器可用时都运行/);
    assert.match(text, /不要每次审查抓取全部官方文档/);
  });

  test("skill and plugin review covers context engineering of instruction assets", () => {
    const text = reviewer("skill-plugin-quality");
    // The four reportable finding classes for instruction entry points.
    assert.match(text, /分层错位/);
    assert.match(text, /披露失败/);
    assert.match(text, /内容焦点/);
    assert.match(text, /受众错位/);
    // The parent pointer is load-bearing; a general index stays optional so
    // this reviewer never becomes an index-mandating size cop.
    assert.match(text, /缺少父级单行指针[^。\n]*承重缺陷/);
    assert.match(text, /索引是可选优化[^。\n]*缺索引不是缺陷/);
    // Boundary against double-reporting with the docs reviewer.
    assert.match(text, /交给 `docs-sync`/);
  });

  test("reviewer packets use shared category tables and architecture owns observations", () => {
    const text = deepReview();
    const output = text.slice(
      text.indexOf("### Reviewer Output Contract"),
      text.indexOf("## 6. 综合"),
    );
    assert.ok(output.startsWith("### Reviewer Output Contract"));
    for (const section of ["### 阻断问题", "### 非阻断问题", "### 需要验证"]) {
      assert.ok(output.includes(section), `reviewer output must keep ${section}`);
    }
    assert.equal(
      output.match(/\| 编号 \| 来源 \| 位置 \| 问题与影响 \| 置信度 \|/g)?.length,
      2,
      "blocking and non-blocking reviewer tables must share the same columns",
    );
    assert.ok(
      output.includes("| 编号 | 来源 | 位置或证据 | 缺失证据与风险 | 验证方式 |"),
      "reviewer validation table must match the synthesis input shape",
    );
    assert.match(output, /阻断1/);
    assert.match(output, /非阻断1/);
    assert.match(output, /没有条目[^。\n]*`无。`/);
    assert.match(output, /架构观察[^。\n]*仅[^。\n]*`architecture`/);
    assert.match(output, /审查缺口[^。\n]*无法完成/);
    assert.match(output, /亮点[^。\n]*至多一条/);

    for (const name of Object.keys(builtinReviewerTriggers)) {
      const contract = markdownSection(reviewer(name), "## Output contract");
      assert.match(contract, /统一 Reviewer Output Contract/);
      assert.doesNotMatch(contract, /No findings\./);
      assert.doesNotMatch(contract, /\[severity:|\[confidence:/);
      if (name === "architecture") {
        assert.match(contract, /架构观察/);
      } else {
        assert.doesNotMatch(contract, /架构观察/);
      }
    }
  });

  test("synthesis uses stable category tables with source-grouped action decisions", () => {
    const text = deepReview();
    const synthesis = text.slice(
      text.indexOf("## 6. 综合"),
      text.indexOf("## 7. 交回用户决定"),
    );
    for (const section of [
      "### 阻断问题",
      "### 非阻断问题",
      "### 需要验证",
      "### 架构观察",
      "### 审查缺口",
      "### 亮点",
    ]) {
      assert.ok(synthesis.includes(section), `missing output section ${section}`);
    }

    const blocking = markdownSection(synthesis, "### 阻断问题");
    const nonBlocking = markdownSection(synthesis, "### 非阻断问题");
    for (const [section, id] of [
      [blocking, "阻断1"],
      [nonBlocking, "非阻断1"],
    ]) {
      assert.ok(
        section.includes("| 编号 | 来源 | 位置 | 问题与影响 | 主代理建议与判断理由 |"),
        "finding table must keep the exact column order",
      );
      assert.ok(section.includes(id), `finding table must demonstrate ${id}`);
      assert.doesNotMatch(section, /confidence|置信度/i);
    }

    for (const [heading, header] of [
      ["### 需要验证", "| 编号 | 来源 | 位置或证据 | 缺失证据与风险 | 验证方式 |"],
      ["### 架构观察", "| 编号 | 来源 | 位置或证据 | 观察与长期成本 | 后续建议 |"],
      ["### 审查缺口", "| 编号 | 来源 | 缺口 | 影响 | 补齐方式 |"],
      ["### 亮点", "| 编号 | 来源 | 位置或证据 | 亮点 |"],
    ]) {
      assert.ok(
        markdownSection(synthesis, heading).includes(header),
        `${heading} must keep the exact column order`,
      );
    }

    assert.match(blocking, /\*\*修\*\*/);
    assert.match(nonBlocking, /\*\*(?:修|不修)\*\*/);
    assert.match(synthesis, /相同来源[^。\n]*相邻/);
    assert.match(synthesis, /第一来源[^。\n]*分组/);
    assert.match(synthesis, /阻断问题只能建议 `修`/);
    assert.match(synthesis, /判断 `不修`[^。\n]*(?:重新分类|不能|不得)/);
    assert.match(synthesis, /没有条目[^。\n]*`无。`/);
    assert.match(synthesis, /按同一根因合并重复发现，同时保留所有来源/);

    const preamble = markdownSection(text, "### Reviewer Must-Not Preamble");
    for (const prohibition of [
      "不按严重度或置信度预过滤",
      "不修改代码、创建问题、提交评论、批准设计",
      "不要编写补丁",
      "必须重新检查本次差异",
      "只对本维度有证据的问题下结论",
    ]) {
      assert.ok(preamble.includes(prohibition), `missing prohibition: ${prohibition}`);
    }
    assert.match(preamble, /运行、视觉或负载证据[^。\n]*需要验证/);
    assert.match(preamble, /权威来源[^。\n]*无法完成[^。\n]*审查缺口/);
    assert.doesNotMatch(preamble, /运行、视觉、负载或权威来源[^。\n]*需要验证/);
  });
});

describe("built-in reviewer metadata is machine-readable frontmatter", () => {
  const reviewerDir =
    "plugins/auriga-workflow/skills/deep-review/references/reviewers";

  for (const [name, expectedTrigger] of Object.entries(builtinReviewerTriggers)) {
    // VAL-FM-001 — each built-in carries valid, parseable YAML frontmatter
    test(`${name}.md frontmatter parses and carries valid orchestration keys`, () => {
      const text = read(`${reviewerDir}/${name}.md`);
      assert.ok(
        text.startsWith("---\n"),
        `${name}.md must start with YAML frontmatter`,
      );
      let fm: Record<string, unknown>;
      try {
        fm = matter(text).data as Record<string, unknown>;
      } catch (e) {
        assert.fail(
          `${name}.md frontmatter is not valid YAML: ${(e as Error).message}`,
        );
        return;
      }
      for (const key of [
        "name",
        "best_for",
        "trigger",
        "reasoning",
        "tools",
        "value",
      ]) {
        assert.ok(key in fm, `${name}.md frontmatter must define ${key}`);
      }
      assert.equal(
        fm.name,
        name,
        `${name}.md frontmatter name must match its filename stem`,
      );
      assert.ok(
        fm.reasoning === "flagship" || fm.reasoning === "workhorse",
        `${name}.md reasoning must be flagship|workhorse, got ${String(fm.reasoning)}`,
      );
      assert.ok(
        /^(always|tag:(executable-behavior|executable-behavior-or-tests|maintained-code|security-sensitive|ui|performance-sensitive|architecture|agent-extension))$/.test(
          String(fm.trigger),
        ),
        `${name}.md trigger must be a legal value, got ${String(fm.trigger)}`,
      );
      assert.equal(fm.trigger, expectedTrigger);
      assert.ok(
        Array.isArray(fm.tools) && (fm.tools as unknown[]).includes("Read"),
        `${name}.md tools must be a list including Read`,
      );
      assert.ok(
        !("extends" in fm),
        `${name}.md is a host built-in and must not declare extends`,
      );
      assert.ok(
        !/^## Metadata/m.test(text),
        `${name}.md must not keep the old prose ## Metadata section`,
      );
    });
  }
});
