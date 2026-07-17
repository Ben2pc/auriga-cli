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
      /纯文档.*纯配置.*生成代码.*没有有效自动化接缝.*不触发/,
      "frontmatter must preserve the exemption semantics",
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

    assert.equal(parsed.data.name, "git-workflow");
    assert.match(parsed.data.description, /工作树.*提交.*拉取请求.*Ready.*合并/);
    assert.ok(
      skill.split("\n").length <= 140,
      "git-workflow must stay within a 140-line context budget",
    );
    assert.match(skill, /确认目标仓库、工作树、当前分支、远端、基准分支/);
    assert.match(skill, /无法确认归属的改动默认属于用户/);
    assert.match(skill, /未经明确授权，不执行 `git stash`.*`git reset --hard`/);
    const templateHeadings = [
      "## Summary / 摘要",
      "## Acceptance Criteria / 验收标准",
      "## Design Decisions / 设计决策",
      "## Risks / 风险",
      "## Test Plan / 验证计划",
      "## Remaining TODOs / 后续事项",
    ];
    for (const heading of templateHeadings) {
      assert.ok(skill.includes(heading), `PR template must preserve ${heading}`);
      const body = markdownSection(skill, heading).slice(heading.length);
      assert.match(body, /[\u3400-\u9fff]/, `${heading} example body must use Chinese`);
    }
    assert.match(skill, /本次变更解决了什么问题/);
    assert.match(skill, /用户或调用方能够观察到的结果成立/);
    assert.match(skill, /没有真实决定时写“无”/);
    const preflight = markdownSection(skill, "## 1. 操作前检查");
    assert.match(preflight, /仓库根.*当前分支.*工作树状态.*远端关系/);
    assert.match(preflight, /基准分支/);
    assert.match(markdownSection(skill, "## 3. 创建 Draft 拉取请求"), /尽早创建 Draft 拉取请求/);
    assert.match(markdownSection(skill, "## 4. 进入 Ready"), /所有当前提交已推送.*基准分支.*目标分支/s);
    assert.match(markdownSection(skill, "## 5. 处理评审与持续集成反馈"), /一批处理完成后.*汇总问题、状态和对应提交/s);
    assert.match(markdownSection(skill, "## 6. 合并"), /必需检查与批准均满足/);
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
    assert.match(skill, /最近的适用作用域[^。\n]*`AGENTS\.md` 建立索引/);
    assert.match(skill, /最近公共祖先/);
    assert.match(skill, /ADR 可以同时服务人类与 Agent/);
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
      assert.match(template, /v1\.20\.0/);
      assert.match(
        template,
        /领域模型|domain model/i,
        `${rel} must route domain-model clarification to arch-design`,
      );
      assert.match(
        template,
        /(?:快速流程|quick flow)[\s\S]{0,500}(?:不跳过适用的需求澄清、架构确认|never bypasses applicable requirement clarification, architecture approval)/i,
        `${rel} must not let the quick flow bypass architecture clarification`,
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
    assert.match(template, /Review Focus \/ 人工评审重点/);
    assert.match(template, /Domain Model \/ 领域模型/);
    for (const field of ["评审状态", "核心决定", "主要影响", "首要风险", "Human Decisions"]) {
      assert.ok(template.includes(field), `arch-design template must preserve ${field}`);
    }
  });

  test("arch-design template makes current and target architecture easy to compare", () => {
    const template = read(
      "plugins/auriga-workflow/skills/arch-design/references/arch-design-template.md",
    );

    for (const section of [
      "Current Architecture / 当前架构现状",
      "Current Directory Structure / 当前目录结构",
      "Target Architecture / 目标整体架构",
      "Target Directory Structure / 目标目录结构",
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
    assert.match(template, /Quality Attributes & Technical Goals \/ 质量属性与技术目标/);
    assert.match(template, /重点评审/);
    for (const example of [
      "可观测性",
      "可排查性",
      "故障隔离或容灾",
      "数据一致性",
      "安全性",
      "性能与资源预算",
    ]) {
      assert.ok(template.includes(example), `technical quality examples must cue ${example}`);
    }
    assert.match(template, /示例[^。\n]*不是必填|不是必填[^。\n]*示例/);
    assert.match(template, /Data Flow \/ 数据流/);
    assert.match(template, /用户[^。\n]*外部系统[^。\n]*(?:定时任务|领域事件)/);
    assert.match(template, /代码内部/);
    assert.match(template, /文件级职责/);
    assert.match(template, /接口实现映射/);
    assert.match(template, /Deployment & Operations \/ 部署与运行/);
    assert.match(template, /可选章节/);
    assert.match(template, /普通前端[^。\n]*移动端[^。\n]*默认删除/);
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
    assert.match(template, /仅在存在真实取舍时保留本节/);
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
    const handoff = specDesign.match(/### Phase D[\s\S]*?## 交接前检查/);

    assert.ok(handoff, "spec-design must preserve its Phase D handoff section");
    assert.match(handoff[0], /arch-design[^。\n]*人工确认/);
    assert.match(incremental, /已确认[^。\n]*arch_design\.md[^。\n]*(?:优先|约束)/);
  });

  test("incremental-impl traces VAL-IMPL-001..011 to requirement-led implementation units", () => {
    const text = read("plugins/auriga-workflow/skills/incremental-impl/SKILL.md");
    const contract = read(
      "docs/worklog/worklog-2026-07-16-refactor-simplify-incremental-impl/validation-contract.md",
    );
    const pluginReadme = read("plugins/auriga-workflow/README.md");
    const specDesign = read("plugins/auriga-workflow/skills/spec-design/SKILL.md");
    const umbrellaTemplate = read(
      "plugins/auriga-workflow/skills/spec-design/references/umbrella-template.md",
    );
    const reviewRecord = read(
      "docs/worklog/worklog-2026-07-16-refactor-simplify-incremental-impl/review.md",
    );
    const reviewIndex = read(
      "docs/long-running-specs/model-generation-workflow-upgrade/reviews/README.md",
    );
    const programUmbrella = read(
      "docs/long-running-specs/model-generation-workflow-upgrade/umbrella.md",
    );
    const zhWorkflow = read("AGENTS.template.zh-CN.md");
    const enWorkflow = read("AGENTS.template.en.md");
    const repoWorkflow = read("AGENTS.md");

    for (let index = 1; index <= 11; index += 1) {
      const id = `VAL-IMPL-${String(index).padStart(3, "0")}`;
      assert.match(contract, new RegExp(`\\| ${id} \\|`), `${id} must remain traceable`);
    }

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
      assert.match(workflow, /# auriga (?:工作流|Workflow) \(v1\.20\.0\)/);
    }
    assert.match(reviewIndex, /incremental-impl[^\n]*worklog-2026-07-16-refactor-simplify-incremental-impl\/review\.md/);
    assert.match(programUmbrella, /incremental-impl[^\n]*VAL-IMPL-001\.\.011[^\n]*PR #191/);
    for (const heading of [
      "## 当前职责",
      "## 可复现失效模式",
      "## 目标模型证据",
      "## 与其他资产的关系",
      "## 处置结论",
      "## 风险与恢复条件",
      "## 参考资料",
    ]) {
      assert.ok(reviewRecord.includes(heading), `review record must preserve ${heading}`);
    }
    assert.match(reviewRecord, /(?:未执行[^。]*模型行为评测|模型行为评测[^。]*未执行)/);
    assert.match(reviewRecord, /观察信号|如果正式评审|如果多写者/);
    assert.match(reviewRecord, /恢复|加强|补充/);
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

  // VAL-REV-005 — hosted and standalone reviewers keep distinct output contracts
  test("hosted reviewers inherit the host output contract", () => {
    const creator = read(
      "plugins/auriga-workflow/skills/reviewer-creator/SKILL.md",
    );
    const template = read(
      "plugins/auriga-workflow/skills/reviewer-creator/references/template.md",
    );
    assert.match(creator, /补充型[^。\n]*继承[^。\n]*宿主[^。\n]*输出契约/);
    assert.match(template, /仅[^。\n]*standalone[^。\n]*保留/);
    assert.match(template, /补充型[^。\n]*删除[^。\n]*继承宿主/);
  });
});

describe("deep-review modernization contract", () => {
  const reviewer = (name: string) =>
    read(
      `plugins/auriga-workflow/skills/deep-review/references/reviewers/${name}.md`,
    );

  test("first formal review runs automatically and later agent-proposed reruns ask", () => {
    const text = deepReview();
    assert.match(text, /第一次[^。]*直接执行/);
    assert.match(text, /用户明确要求再次审查[^。]*直接执行/);
    assert.match(text, /代理主动建议重跑[^。]*先询问用户/);
    assert.match(text, /不要[^。]*自动开始下一轮深度审查/);
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
    assert.match(ux, /视觉[^。]*需要渲染、截图或明确代码证据/);
    assert.match(ux, /accessibilityIdentifier[^；]*不等于 VoiceOver/);
    assert.match(ux, /resource-id[^。]*不等于 TalkBack/);
    assert.match(ux, /可靠撤销时不强制二次确认/);
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

  test("synthesis preserves sources, validation needs, gaps and read-only authority", () => {
    const text = deepReview();
    const synthesis = text.slice(
      text.indexOf("## 6. 综合"),
      text.indexOf("## 7. 交回用户决定"),
    );
    for (const section of [
      "### Blocking issues",
      "### Non-blocking suggestions",
      "### Needs validation",
      "### Architectural observations",
      "### Review gaps",
    ]) {
      assert.ok(synthesis.includes(section), `missing output section ${section}`);
    }
    for (const field of ["severity", "confidence", "来源"]) {
      assert.ok(synthesis.includes(field), `synthesis must preserve ${field}`);
    }
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
