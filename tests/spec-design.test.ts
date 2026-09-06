import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { parseMarkers, hashBlock } from "../src/workflow-markers.js";

// Compiled test lives at dist-test/tests/spec-design.test.js; ../.. = repo root.
const repoRoot = path.resolve(
  new URL(".", import.meta.url).pathname,
  "..",
  "..",
);

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf-8");
}

function markdownSection(text: string, heading: string): string {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `missing markdown heading: ${heading}`);
  const bodyStart = start + heading.length;
  const nextHeading = text.indexOf("\n## ", bodyStart);
  return text.slice(start, nextHeading === -1 ? text.length : nextHeading);
}

function markdownSubsection(text: string, heading: string): string {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `missing markdown heading: ${heading}`);
  const level = heading.match(/^#+/)?.[0].length ?? 1;
  const bodyStart = start + heading.length;
  const nextHeading = text.slice(bodyStart).search(
    new RegExp(`\\n#{1,${level}} `),
  );
  return text.slice(
    start,
    nextHeading === -1 ? text.length : bodyStart + nextHeading,
  );
}

function fencedMarkdownExample(text: string): string {
  const match = text.match(/```markdown\n([\s\S]*?)\n```/);
  assert.ok(match, "template must contain one fenced markdown example");
  return match[1];
}

describe("validation results artifacts", () => {
  const templatePath = "plugins/auriga-workflow/skills/spec-design/references/validation-results-template.md";

  test("results template exposes coverage and evidence records separately", () => {
    const example = fencedMarkdownExample(read(templatePath));
    assert.match(example, /## 1\. Current Coverage \/ 当前验收覆盖/);
    assert.match(example, /## 2\. Validation Records \/ 验证记录/);
    assert.match(example, /\| 验收要求 \| 当前状态 \| 结果引用与缺口 \|/);
    const fields = [...example.matchAll(/^- \*\*([^*]+)\*\*：/gm)].map((match) => match[1]);
    assert.deepEqual(fields, ["关联", "验证对象", "执行", "实际结果", "结论", "证据"]);
  });

  test("producers and consumers can discover the shared results template", () => {
    for (const skill of ["spec-design", "test-driven-development", "incremental-impl"]) {
      const skillPath = `plugins/auriga-workflow/skills/${skill}/SKILL.md`;
      const references = [...read(skillPath).matchAll(/`([^`]*references\/validation-results-template\.md)`/g)];
      assert.ok(references.length > 0, `${skill} must expose the results reference`);
      for (const [, reference] of references) {
        assert.equal(path.resolve(repoRoot, path.dirname(skillPath), reference), path.join(repoRoot, templatePath));
        assert.ok(fs.existsSync(path.resolve(repoRoot, path.dirname(skillPath), reference)));
      }
    }
  });
});

describe("spec-design skill — repo-check VALs", () => {
  test("VAL-DEP-003: SKILL.md exists at plugin-bundled path", () => {
    const p = path.join(
      repoRoot,
      "plugins/auriga-workflow/skills/spec-design/SKILL.md",
    );
    assert.ok(fs.existsSync(p), `expected SKILL.md at ${p}`);
  });

  test("VAL-DEP-003: plugin manifest versions match (Claude + Codex)", () => {
    const claude = JSON.parse(
      read("plugins/auriga-workflow/.claude-plugin/plugin.json"),
    );
    const codex = JSON.parse(
      read("plugins/auriga-workflow/.codex-plugin/plugin.json"),
    );
    assert.equal(
      claude.version,
      codex.version,
      "Claude/Codex plugin manifest versions must match",
    );
    assert.ok(
      Number(claude.version.split(".")[0]) >= 4,
      "removing the public test-designer skill must advance the plugin major version",
    );
  });

  test("SKILL.md frontmatter has name and description", () => {
    const text = read(
      "plugins/auriga-workflow/skills/spec-design/SKILL.md",
    );
    assert.match(text, /^---[\s\S]*?\nname:\s*spec-design\s*\n/);
    assert.match(text, /\ndescription:\s*[^\s].+\n/);
  });

  test("SKILL.md covers the 4 phases (A/B/C/D) of the spec", () => {
    const text = read(
      "plugins/auriga-workflow/skills/spec-design/SKILL.md",
    );
    // Anchor on the stable `### Phase X` header prefix only — the skill body
    // is authored in Chinese, so the descriptive suffix (调研 / 定方向… ) is
    // translatable; the `Phase A/B/C/D` token is the structural contract.
    for (const phase of [
      "### Phase A",
      "### Phase B",
      "### Phase C",
      "### Phase D",
    ]) {
      assert.ok(
        text.includes(phase),
        `SKILL.md must reference ${phase}`,
      );
    }
  });

  test("SKILL.md makes value triage bounded, advisory, and terminal", () => {
    const text = read(
      "plugins/auriga-workflow/skills/spec-design/SKILL.md",
    );
    const gate = markdownSubsection(text, "#### B1. 价值门禁");
    assert.match(gate, /只有第一轮仍无法选择出口时追加第二个/);
    assert.match(gate, /最多两轮/);
    assert.match(gate, /推荐答案和理由/);
    assert.match(gate, /成本更低的替代/);
    assert.match(gate, /\| 值得做 \| 继续 B2 的需求对齐 \|/);
    assert.match(gate, /\| 先验证 \|[^\n]*最低成本实验[^\n]*继续信号和停止信号[^\n]*不直接建设完整功能 \|/);
    assert.match(gate, /\| 暂缓 \|[^\n]*重新评估[^\n]*停止 \|/);
    assert.match(gate, /\| 不做 \| 停止规格和实现 \|/);
    assert.match(gate, /风险、影响和优先级/);
    assert.doesNotMatch(text, /D1\.5|playground|静态 HTML/i);
  });

  test("validation-contract keeps evidence semantics without duplicating a concrete toolchain", () => {
    const text = read(
      "plugins/auriga-workflow/skills/spec-design/references/validation-contract-template.md",
    );
    const example = fencedMarkdownExample(text);
    assert.doesNotMatch(example, /## Toolchain/);
    assert.match(text, /一条 VAL[^\n]*不代表一个测试用例/);
    const assertion = markdownSubsection(
      example,
      "#### VAL-ALIGNMENT-001 — <简短的中文标题>",
    );
    const fields = [...assertion.matchAll(/^- \*\*(.+?)\*\*：/gm)].map(
      (match) => match[1],
    );
    assert.deepEqual(fields, ["验收要求", "验证方式", "通过标准"]);
    assert.equal(
      (example.match(/^#### VAL-[A-Z]+-\d{3} — .+$/gm) ?? []).length,
      1,
      "example must use a full semantic category and a Chinese title",
    );
    assert.doesNotMatch(example, /Behavior|Tool \(工具\)|Evidence/);
    assert.match(text, /VAL-<完整语义分类>-<NNN>/);
    assert.match(text, /编号后增加简短的中文标题/);
    assert.match(text, /具体测试工具[^\n]*test-driven-development/);
  });

  test("validation-contract requires agent-executable end-to-end paths by product surface", () => {
    const skill = read("plugins/auriga-workflow/skills/spec-design/SKILL.md");
    const template = read(
      "plugins/auriga-workflow/skills/spec-design/references/validation-contract-template.md",
    );
    const example = fencedMarkdownExample(template);

    assert.match(template, /Agent 可执行[^。\n]*端到端验收路径/);
    assert.match(template, /客户端[^。\n]*UI 自动化[^。\n]*(?:MCP|CLI)[^。\n]*(?:模拟器|真机)/);
    assert.match(template, /前端[^。\n]*UI 自动化[^。\n]*(?:MCP|CLI)[^。\n]*浏览器/);
    assert.match(template, /服务端 API[^。\n]*HTTP[^。\n]*接口端到端验收/);
    assert.match(template, /脚本[^。\n]*(?:客户端|前端页面)[^。\n]*触发/);
    assert.match(template, /人工验收[^。\n]*例外[^。\n]*原因/);
    assert.match(example, /Agent validation path \(Agent 验收路径\)/);
    assert.match(skill, /优先[^。\n]*Agent[^。\n]*验收/);
    assert.match(skill, /客户端[^。\n]*前端[^。\n]*UI/);
    assert.match(skill, /服务端 API[^。\n]*HTTP/);
    assert.match(skill, /人工验收[^。\n]*例外/);
  });

  test("spec-template.md Open questions placeholder requires a deferral owner and reason", () => {
    const text = read(
      "plugins/auriga-workflow/skills/spec-design/references/spec-template.md",
    );
    assert.ok(
      text.includes("## 4. Open questions / 悬而未决"),
      "spec template must keep the Open questions section",
    );
    assert.ok(
      /归属/.test(text) && /推迟理由/.test(text),
      "Open questions placeholder must require a named owner and a deferral reason",
    );
    assert.match(text, /不适用的可选章节[^\n]*删除/);
    assert.doesNotMatch(text, /不要删掉可选章节/);
  });

  test("spec-design grounds clarity in facts and uses a semantic alignment gate", () => {
    const text = read(
      "plugins/auriga-workflow/skills/spec-design/SKILL.md",
    );
    assert.match(text, /事实先于问题/);
    assert.match(text, /需求是否明确[^。]*不能依赖模型记忆、置信度或主观印象/);
    assert.match(text, /事实由 Agent 调查，决定由人确认/);
    assert.match(text, /两个独立且称职的 Agent[^。]*明显不同的用户结果/);
    assert.match(text, /停止条件不是固定问题数或主观置信度/);
    assert.doesNotMatch(text, /Q\+GUESS|约 95%|最多约 10 轮|6 行复述/);
  });

  test("spec-design uses dependency-aware Socratic rounds without synthetic options", () => {
    const text = read(
      "plugins/auriga-workflow/skills/spec-design/SKILL.md",
    );
    const alignment = markdownSubsection(text, "#### B2. 苏格拉底式需求对齐");
    assert.match(alignment, /决策依赖图/);
    assert.match(alignment, /同一轮[^。]*互不依赖/);
    assert.match(alignment, /每轮最多三个/);
    assert.match(alignment, /依赖本轮[^。]*后续轮次/);
    assert.match(alignment, /推荐答案、理由和主要后果/);
    assert.match(alignment, /每轮回答[^。]*原始目标一致/);
    assert.match(alignment, /廉价事实[^。]*当前 Agent/);
    assert.match(alignment, /独立且耗时[^。]*子代理/);
    assert.match(alignment, /只阻塞[^。]*下游问题/);
    assert.match(alignment, /不存在会改变用户结果的真实决策分支时[^。]*不提问[^。]*直接给出推荐/);
    assert.match(text, /用户明确确认前，不进入架构、计划或实现/);
  });

  test("spec-design persists only when traceability or handoff needs it", () => {
    const text = read(
      "plugins/auriga-workflow/skills/spec-design/SKILL.md",
    );
    assert.match(text, /当前对话中的用户确认作为权威规格，不强制生成文件/);
    const persistence = markdownSubsection(text, "#### C1. 选择对话或文件");
    for (const trigger of [
      "多个用户可观察结果",
      "公共接口、共享契约、跨模块行为或实质范围取舍",
      "跨会话、跨 Agent 或独立评审",
      "多个提交或拉取请求",
      "用户明确要求保存规格",
    ]) {
      assert.ok(persistence.includes(trigger), `missing persistence trigger: ${trigger}`);
    }
    assert.match(text, /文件只保存确认后的结果，不记录冗长问答流水/);
    assert.match(text, /实现中发现新的产品语义、范围或用户结果歧义时返回本技能澄清/);
  });

  test("spec template keeps the four required Why decisions", () => {
    const example = fencedMarkdownExample(read(
      "plugins/auriga-workflow/skills/spec-design/references/spec-template.md",
    ));
    const why = markdownSubsection(example, "### 1.1 Why / 为什么做");
    for (const field of ["问题与用户", "事实依据", "价值与时机", "替代方案"]) {
      assert.match(why, new RegExp(`^- \\*\\*${field}\\*\\*：`, "m"));
    }
  });

  test("spec artifacts follow product-source structure with a user-visible fallback", () => {
    const skill = read("plugins/auriga-workflow/skills/spec-design/SKILL.md");
    const specTemplate = read(
      "plugins/auriga-workflow/skills/spec-design/references/spec-template.md",
    );
    const validationTemplate = read(
      "plugins/auriga-workflow/skills/spec-design/references/validation-contract-template.md",
    );
    const spec = fencedMarkdownExample(specTemplate);
    const validation = fencedMarkdownExample(validationTemplate);

    const headings = [
      "## 1. Product Overview / 产品总览",
      "### 1.2 Source Structure Alignment / 来源结构对齐",
      "## 2. Product Requirement Details / 产品需求分项",
      "### 2.1 `<产品需求文档中的功能章节，或用户可感知的产品子功能>`",
      "#### 2.1.1 Original Product Requirement / 原始产品需求",
      "#### 2.1.2 User-visible Behavior / 用户可感知行为",
      "#### 2.1.3 Interaction Design / 交互设计",
      "#### 2.1.4 Scope Boundaries / 分项范围边界",
      "#### 2.1.5 Validation Mapping / 验收映射",
      "## 3. Overall Out of Scope / 整体不做",
      "## 5. References / 参考资料",
    ];
    let previous = -1;
    for (const heading of headings) {
      const current = spec.indexOf(heading);
      assert.ok(current > previous, `${heading} must follow the overview-to-detail structure`);
      previous = current;
    }

    assert.match(skill, /产品需求文档|PRD/);
    assert.match(skill, /章节[^。\n]*名称[^。\n]*顺序|名称[^。\n]*顺序[^。\n]*章节/);
    assert.match(skill, /没有[^。\n]*(?:前置产物|来源结构)[^。\n]*用户可感知[^。\n]*产品子功能/);
    assert.match(skill, /不能[^。\n]*(?:模块|接口|数据表)[^。\n]*划分/);
    assert.match(specTemplate, /优先[^。\n]*(?:产品需求文档|PRD)[^。\n]*结构/);
    assert.match(specTemplate, /没有[^。\n]*(?:前置产物|来源结构)[^。\n]*用户可感知[^。\n]*产品子功能/);
    assert.match(spec, /原始章节或需求/);
    assert.match(spec, /规格落点/);

    assert.match(validationTemplate, /与 `spec\.md`[^。\n]*相同[^。\n]*名称[^。\n]*顺序/);
    assert.match(validation, /## 1\. Coverage Overview \/ 覆盖总览/);
    assert.match(validation, /## 2\. Assertions by Product Requirement \/ 按产品分项组织断言/);
    assert.match(validation, /### 2\.1 `<与 spec\.md 一致的产品分项名称>`/);
    assert.match(validation, /Spec subsection \(规格分项\)/);
    assert.match(validation, /Source section \(来源章节\)/);
  });

  test("interaction design is specified per user-visible leaf function", () => {
    const skill = read("plugins/auriga-workflow/skills/spec-design/SKILL.md");
    const specTemplate = read(
      "plugins/auriga-workflow/skills/spec-design/references/spec-template.md",
    );
    const spec = fencedMarkdownExample(specTemplate);
    const interactionDesign = markdownSubsection(
      spec,
      "#### 2.1.3 Interaction Design / 交互设计",
    );

    assert.match(skill, /尼尔森[^。\n]*可用性启发式/);
    assert.match(skill, /不是[^。\n]*(?:固定问卷|逐项清单|合规清单)/);
    assert.match(skill, /叶子功能[^。\n]*交互设计/);
    assert.match(specTemplate, /Interaction Design \/ 交互设计/);
    for (const field of [
      "场景与目标",
      "操作、控制与效率",
      "状态反馈与恢复",
      "动效与过渡",
      "无障碍与适配",
      "文案契约",
    ]) {
      assert.ok(
        specTemplate.includes(field),
        `interaction design template must include ${field}`,
      );
    }
    const uxHeader = "| 场景与目标 | 入口与前置条件 | 操作、控制与效率 | 状态反馈与恢复 | 动效与过渡 | 无障碍与适配 |";
    const copyHeader = "| 场景与触发条件 | 展示位置或载体 | 最终文案 | 动态变量与兜底 | 文案来源 |";
    assert.ok(interactionDesign.includes(uxHeader));
    assert.ok(interactionDesign.includes(copyHeader));
    assert.ok(
      interactionDesign.indexOf(uxHeader) < interactionDesign.indexOf(copyHeader),
      "interaction table must precede the separate copy contract table",
    );
    assert.doesNotMatch(interactionDesign, /\|[^\n]*动效[^\n]*最终文案[^\n]*\|/);
  });

  test("production copy remains a product contract regardless of delivery owner", () => {
    const skill = read("plugins/auriga-workflow/skills/spec-design/SKILL.md");
    const specTemplate = read(
      "plugins/auriga-workflow/skills/spec-design/references/spec-template.md",
    );
    const validationTemplate = read(
      "plugins/auriga-workflow/skills/spec-design/references/validation-contract-template.md",
    );

    assert.match(skill, /生产级[^。\n]*具体文案/);
    assert.match(skill, /服务端下发[^。\n]*规格/);
    assert.match(
      specTemplate,
      /场景与触发条件[^\n]*最终文案[^\n]*动态变量与兜底[^\n]*文案来源/,
    );
    assert.match(specTemplate, /客户端固定[^。\n]*服务端下发[^。\n]*服务端配置/);
    assert.match(validationTemplate, /服务端下发[^。\n]*(?:接口契约|HTTP)/);
    assert.match(validationTemplate, /关键状态[^。\n]*用户可见文案[^。\n]*验收断言/);
  });

  test("spec decomposition follows complete user outcomes, not implementation thresholds", () => {
    const skill = markdownSubsection(
      read("plugins/auriga-workflow/skills/spec-design/SKILL.md"),
      "#### C3. 拆分大需求",
    );
    const umbrella = read(
      "plugins/auriga-workflow/skills/spec-design/references/umbrella-template.md",
    );
    for (const text of [skill, umbrella]) {
      assert.match(text, /独立确认、独立验收/);
      assert.match(text, /完整用户结果/);
      assert.match(text, /模块数|文件数/);
      assert.match(text, /实施手法/);
      assert.doesNotMatch(text, /验收标准\s*[<>≤=]+\s*\d+|抽象分支|绞杀榕/);
    }
  });

  test("VAL-DEP-001: product workflow templates keep the three-stage clarification boundary", () => {
    for (const f of ["AGENTS.template.zh-CN.md", "AGENTS.template.en.md"]) {
      const text = read(f);
      assert.ok(
        text.includes("spec-design"),
        `${f} must reference spec-design`,
      );
      assert.equal(
        /\bbrainstorming\b/.test(text),
        false,
        `${f} must not still reference brainstorming`,
      );
      assert.match(
        text,
        /spec\s*=\s*why\s*\+\s*(?:用户可观察的\s*)?(?:observable\s*)?what/i,
        `${f} must define the observable spec boundary`,
      );
      assert.match(
        text,
        /arch design\s*=\s*(?:系统结构的|structural)\s*how/i,
        `${f} must define architecture design as structural clarification`,
      );
      assert.match(
        text,
        /plan\s*=\s*(?:实施步骤|implementation steps)/i,
        `${f} must reserve implementation steps for planning`,
      );
      assert.equal(
        /ln -s CLAUDE\.md AGENTS\.md|AGENTS\.md (?:的)?软链接.*CLAUDE\.md|AGENTS\.md symlink to CLAUDE\.md/i.test(text),
        false,
        `${f} must not describe the legacy AGENTS.md -> CLAUDE.md symlink direction`,
      );
    }
  });

  test("workflow consolidation separates planning carriers from autonomous execution", () => {
    for (const f of ["AGENTS.md", "AGENTS.template.zh-CN.md", "AGENTS.template.en.md"]) {
      const text = read(f);
      assert.match(
        text,
        /(?:内置 Plan[^\n]*planning-with-files[^\n]*二选一|choose[^\n]*built-in Plan[^\n]*planning-with-files)/i,
        `${f} must ask users to choose exactly one planning carrier`,
      );
      assert.match(
        text,
        /goalify[^\n]*(?:组合|combine)/i,
        `${f} must describe goalify as composable with the selected planning carrier`,
      );
      assert.doesNotMatch(
        text,
        /Plan[^\n]*planning-with-files[^\n]*goalify[^\n]*(?:三选一|three|menu)/i,
        `${f} must not treat goalify as a third planning carrier`,
      );
    }
  });

  test("quick development routing uses semantic outcomes instead of fixed thresholds", () => {
    const files = [
      "AGENTS.md",
      "AGENTS.template.zh-CN.md",
      "AGENTS.template.en.md",
      "plugins/auriga-workflow/skills/spec-design/SKILL.md",
    ];
    for (const f of files) {
      const text = read(f);
      assert.doesNotMatch(
        text,
        /三条谓词|three predicates|验收标准\s*[<>≤=]+\s*\d+|acceptance criteria\s*[<>≤=]+\s*\d+|single module/i,
        `${f} must not route implementation planning by fixed size thresholds`,
      );
      assert.doesNotMatch(
        text,
        /最后运行全量回归|then run full regression/i,
        `${f} must not force full regression for every quick change`,
      );
    }
    for (const f of ["AGENTS.template.zh-CN.md", "AGENTS.template.en.md"]) {
      const text = read(f);
      assert.match(text, /(?:单一明确结果|single clear outcome)/i);
      assert.match(text, /(?:跨会话|cross-session)/i);
      assert.match(text, /(?:完整实施单元|complete implementation unit)/i);
    }
  });

  test("workflow entry keeps only durable lifecycle prompts and routing context", () => {
    for (const f of ["AGENTS.md", "AGENTS.template.zh-CN.md", "AGENTS.template.en.md"]) {
      const text = read(f);
      assert.doesNotMatch(
        text,
        /合并后主动询问|Post-merge Compounding|proactively ask whether to run `session-compound`/i,
        `${f} must not interrupt every merge with a compounding prompt`,
      );
      assert.match(
        text,
        /(?:删除还是归档|delete or archive)/i,
        `${f} must preserve the PR Ready artifact decision`,
      );
      assert.match(text, /\| `docs\/rules\/` \|/);
      assert.doesNotMatch(text, /\| `docs\/` (?:其他|\(other\))/i);
      assert.doesNotMatch(text, /组件可拆卸|Components are detachable/i);
      assert.doesNotMatch(text, /\*\*独立评估\*\*|\*\*Independent Evaluation\*\*/i);
      assert.doesNotMatch(text, /xhigh|workhorse|flagship/i);
      assert.doesNotMatch(text, /从 main 建分支|Create a branch from main/i);
      assert.match(text, /(?:基准分支|base branch)/i);
    }
  });

  test("bug fixes load diagnosis before test-driven implementation", () => {
    const debugging = read(
      "plugins/auriga-workflow/skills/systematic-debugging/SKILL.md",
    );
    const tdd = matter(
      read("plugins/auriga-workflow/skills/test-driven-development/SKILL.md"),
    );
    assert.match(
      tdd.data.description,
      /(?:根因|诊断)[^；。]*确认|确认[^；。]*(?:根因|诊断)/,
      "TDD must only claim defect-fix work after diagnosis is established",
    );
    assert.match(
      debugging,
      /根因[^。\n]*确认[^。\n]*`test-driven-development`|`test-driven-development`[^。\n]*根因[^。\n]*确认/,
      "systematic-debugging must hand confirmed fixes to TDD",
    );
    assert.match(
      debugging,
      /`test-driven-development`[^。\n]*(?:证据寿命|永久保护)|(?:证据寿命|永久保护)[^。\n]*`test-driven-development`/,
      "systematic-debugging must delegate permanent-test decisions to TDD",
    );
  });

  test("workflow entry keeps TDD broad and routes local review around CI review", () => {
    for (const f of ["AGENTS.md", "AGENTS.template.zh-CN.md", "AGENTS.template.en.md"]) {
      const text = read(f);
      assert.match(
        text,
        /(?:新增行为[^\n]*缺陷修复[^\n]*重构[^\n]*test-driven-development|new behavior[^\n]*defect fixes[^\n]*refactors[^\n]*test-driven-development)/i,
        `${f} must present TDD as the shared route for new behavior, defect fixes, and refactors`,
      );
      assert.match(
        text,
        /(?:没有持续集成评审[^\n]*本地[^\n]*deep-review|without CI review[^\n]*local[^\n]*deep-review)/i,
        `${f} must require local deep-review when no CI review exists`,
      );
      assert.match(
        text,
        /(?:已有持续集成评审[^\n]*用户决定[^\n]*本地|with CI review[^\n]*user decide[^\n]*local)/i,
        `${f} must let the user decide whether CI-reviewed PRs also need local review`,
      );
    }
  });

  // Skeleton anchors, not verbatim prose: each regex pins the load-bearing
  // tokens of the layering rule and tolerates rewording between them. The
  // language is selected per file so a zh paragraph pasted into the en
  // template (or vice versa) fails instead of matching the other branch.
  const LAYERING_ANCHORS: Record<string, RegExp[]> = {
    "zh-CN": [
      /根 `AGENTS\.md`[^\n]*全局规则[^\n]*索引/,
      /子包[^\n]*`AGENTS\.md`[^\n]*`CLAUDE\.md -> AGENTS\.md`/,
      /运行时[^\n]*不一致[^\n]*单行索引/,
    ],
    en: [
      /root `AGENTS\.md`[^\n]*global rules[^\n]*index/i,
      /subpackage[^\n]*`AGENTS\.md`[^\n]*`CLAUDE\.md -> AGENTS\.md`/i,
      /[Rr]untimes differ[^\n]*one-line index/,
    ],
  };

  test("workflow entry requires layered context instead of one monolithic file", () => {
    const byFile: Array<[string, string]> = [
      ["AGENTS.md", "zh-CN"],
      ["AGENTS.template.zh-CN.md", "zh-CN"],
      ["AGENTS.template.en.md", "en"],
    ];
    for (const [f, lang] of byFile) {
      const text = read(f);
      for (const re of LAYERING_ANCHORS[lang]) {
        assert.match(text, re, `${f} must carry the layered-context rule (${lang}): ${re}`);
      }
      // The rule must not be undercut by an escape hatch in the same file.
      // This closes known reversals only — a negative assertion cannot
      // enumerate every way prose could weaken the rule.
      assert.doesNotMatch(
        text,
        /(?:堆进根|全部(?:写|放)进根|pile (?:everything|it all) into the root|all in(?:to)? the root `AGENTS\.md`)/i,
        `${f} must not offer an opt-out from layering`,
      );
    }
  });

  // Rule 7 owns the archive decision, but skills only load on demand — the
  // always-loaded workflow entry must carry the routing itself: archiving is
  // a governance action executed via documentation-management, never a bare
  // file move.
  const ARCHIVE_ROUTING_ANCHORS: Record<string, RegExp[]> = {
    "zh-CN": [/归档[^\n]*`documentation-management`[^\n]*不直接移动文件/],
    en: [
      /archiv\w*[^\n]*`documentation-management`[^\n]*(?:instead of|rather than|not|never)[^\n]*mov\w+ files/i,
    ],
  };

  test("workflow entry routes spec archiving through documentation-management", () => {
    const byFile: Array<[string, string]> = [
      ["AGENTS.md", "zh-CN"],
      ["AGENTS.template.zh-CN.md", "zh-CN"],
      ["AGENTS.template.en.md", "en"],
    ];
    for (const [f, lang] of byFile) {
      const text = read(f);
      for (const re of ARCHIVE_ROUTING_ANCHORS[lang]) {
        assert.match(
          text,
          re,
          `${f} must route spec archiving through documentation-management (${lang}): ${re}`,
        );
      }
    }
  });

  // Structural invariants of the repo's own installed sample. These replace
  // per-sentence prose assertions: they catch *any* drift in the managed
  // block, not just the phrases someone remembered to pin.
  test("root AGENTS.md stays a faithful, self-consistent installed sample", () => {
    const root = parseMarkers(read("AGENTS.md"));
    const zh = parseMarkers(read("AGENTS.template.zh-CN.md"));
    assert.equal(root.kind, "marked", "root AGENTS.md must carry managed markers");
    assert.equal(zh.kind, "marked", "zh template must carry managed markers");

    // The root file is the zh template plus repo-specific rules below END.
    assert.equal(
      root.blockBody,
      zh.blockBody,
      "root AGENTS.md managed block must match AGENTS.template.zh-CN.md byte for byte",
    );

    // A stale END hash makes installWorkflow treat this repo's own sample as
    // hand-edited, producing a spurious .bak and warning.
    assert.equal(
      root.endHash,
      hashBlock(root.blockBody),
      "root AGENTS.md END marker hash must match its managed block; recompute it after editing",
    );
  });

  // Single source for the workflow contract version: read it from the zh
  // template, then require the other entrypoints to agree. Bumping the
  // version must not require editing version literals in tests.
  test("workflow contract version is declared consistently across entrypoints", () => {
    const headerRe = /^#\s+auriga\s+(?:Workflow|工作流)\s*\(v(\d+\.\d+\.\d+)\)/m;
    const declared = read("AGENTS.template.zh-CN.md").match(headerRe);
    assert.ok(declared, "AGENTS.template.zh-CN.md must declare the workflow contract version");
    const version = declared[1];

    for (const f of ["AGENTS.md", "AGENTS.template.en.md"]) {
      const found = read(f).match(headerRe);
      assert.ok(found, `${f} must declare the workflow contract version`);
      assert.equal(found[1], version, `${f} must declare workflow version v${version}`);
    }
  });

  // The layering rule's own detail lives in documentation-management; the
  // workflow entry must point at it rather than restate it (which is what the
  // rule itself prescribes).
  test("workflow entry defers layering detail instead of restating it", () => {
    for (const f of ["AGENTS.md", "AGENTS.template.zh-CN.md", "AGENTS.template.en.md"]) {
      const text = read(f);
      assert.match(
        text,
        /documentation-management/,
        `${f} must index documentation-management as the layering source of truth`,
      );
    }
  });

  test("workflow instructions require durable comments and Agent docs to state requirements without spec ids", () => {
    const zh = read("AGENTS.template.zh-CN.md");
    const en = read("AGENTS.template.en.md");

    assert.match(zh, /代码注释[^。\n]*Agent 指令文档[^。\n]*(?:不得|不能)[^。\n]*(?:规格|spec)[^。\n]*编号/);
    assert.match(zh, /简洁[^。\n]*原始需求描述[^。\n]*脱离[^。\n]*(?:规格|spec)[^。\n]*成立/);
    assert.match(en, /Code comments[^.\n]*Agent instruction documents[^.\n]*must not[^.\n]*spec[^.\n]*(?:identifiers|numbers)/i);
    assert.match(en, /concise[^.\n]*(?:original|underlying) requirement[^.\n]*without[^.\n]*(?:source )?spec/i);
  });

  test("workflow docs define review/test rule subdirectories and consumers", () => {
    for (const f of ["AGENTS.template.zh-CN.md", "AGENTS.template.en.md"]) {
      const text = read(f);
      assert.ok(
        text.includes("docs/rules/review/"),
        `${f} must document the custom-reviewer rules directory`,
      );
      assert.ok(
        text.includes("docs/rules/test/"),
        `${f} must document the test rules directory`,
      );
      assert.ok(
        /deep-review/.test(text) && /reviewer-creator/.test(text),
        `${f} must connect docs/rules/review/ with deep-review custom reviewers`,
      );
      assert.ok(
        /test-driven-development/.test(text) && /docs\/rules\/test\//.test(text),
        `${f} must require test writers to consult docs/rules/test/`,
      );
    }
  });

  test("workflow templates keep the unified TDD route and the skill keeps refactor protection", () => {
    for (const f of ["AGENTS.md", "AGENTS.template.zh-CN.md", "AGENTS.template.en.md"]) {
      const text = read(f);
      const version = text.match(/v(\d+)\.(\d+)\.(\d+)/);
      assert.ok(version, `${f} must declare the workflow contract version`);
      assert.ok(
        Number(version[1]) > 1 ||
          (Number(version[1]) === 1 && Number(version[2]) >= 16),
        `${f} must preserve at least the unified-TDD workflow contract version`,
      );
      assert.doesNotMatch(
        text,
        /不另派[^。\n]*测试|测试设计由当前实现|current implementation Agent owns test design|separate test Agent/i,
        `${f} must not spend workflow context restating the default test-agent behavior`,
      );
      assert.match(text, /test-driven-development/);
    }
    assert.match(
      read("plugins/auriga-workflow/skills/test-driven-development/SKILL.md"),
      /重构[^\n]*保护/,
      "the TDD skill must preserve the green characterization-test path for refactors",
    );
  });

  test("completion evidence is a workflow rule, not an installable skill", () => {
    const lock = JSON.parse(read("skills-lock.json"));
    assert.equal(lock.skills["verification-before-completion"], undefined);
    assert.equal(
      fs.existsSync(path.join(repoRoot, ".agents/skills/verification-before-completion")),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(repoRoot, ".claude/skills/verification-before-completion")),
      false,
    );

    for (const f of ["src/skills.ts", "README.md", "README.zh-CN.md"]) {
      assert.doesNotMatch(
        read(f),
        /verification-before-completion/,
        `${f} must not publish the retired skill`,
      );
    }
    assert.doesNotMatch(read("README.md"), /External development process skills — verification/);
    assert.doesNotMatch(read("README.zh-CN.md"), /外部开发流程 skills —— verification/);

    assert.match(read("AGENTS.template.zh-CN.md"), /完成、修复、通过或可评审[^。]*最后一次相关修改后[^。]*对应证据/);
    assert.match(read("AGENTS.template.en.md"), /completion, fixes, passing checks, or review readiness[^.]*matching evidence after the last relevant change/);

    for (const f of [
      "plugins/auriga-workflow/skills/incremental-impl/SKILL.md",
      "plugins/auriga-workflow/skills/test-driven-development/SKILL.md",
    ]) {
      assert.doesNotMatch(read(f), /verification-before-completion/);
    }

  });

  test("workflow docs define spec/arch rule subdirectories and consumers", () => {
    for (const f of ["AGENTS.template.zh-CN.md", "AGENTS.template.en.md"]) {
      const text = read(f);
      assert.ok(
        text.includes("docs/rules/spec/"),
        `${f} must document the project spec rules directory`,
      );
      assert.ok(
        text.includes("docs/rules/arch/"),
        `${f} must document the project architecture rules directory`,
      );
      assert.ok(
        /docs\/rules\/spec\/[^\n]*spec-design/.test(text),
        `${f} must name spec-design as the consumer on the docs/rules/spec/ table row`,
      );
      assert.ok(
        /docs\/rules\/arch\/[^\n]*arch-design/.test(text),
        `${f} must name arch-design as the consumer on the docs/rules/arch/ table row`,
      );
    }
  });

  test("workflow docs and spec-design distinguish PR-scoped specs from cross-PR long-running specs", () => {
    const skill = read(
      "plugins/auriga-workflow/skills/spec-design/SKILL.md",
    );
    assert.ok(
      skill.includes("docs/long-running-specs/"),
      "spec-design must document the cross-PR long-running spec destination",
    );
    assert.match(
      skill,
      /docs\/long-running-specs\/[\s\S]*跨[^\n]*(?:PR|拉取请求)|跨[^\n]*(?:PR|拉取请求)[\s\S]*docs\/long-running-specs\//,
      "spec-design must reserve long-running specs for cross-PR work",
    );
    assert.match(
      skill,
      /用户明确(?:批准|确认)[^\n]*长期|长期[^\n]*用户明确(?:批准|确认)/,
      "spec-design must require explicit user approval before using the long-running lifecycle",
    );
    assert.match(
      skill,
      /每个子规范[^\n]*所有适用的父级验收锚点/,
      "each child spec must carry forward every applicable parent validation assertion",
    );
    assert.match(
      skill,
      /docs\/long-running-specs\/<topic>\/[\s\S]*(?:不能|不得|不可)[^\n]*(?:替代|绕过)|(?:不能|不得|不可)[^\n]*(?:替代|绕过)[\s\S]*docs\/long-running-specs\/<topic>\//,
      "long-running specs must not replace or bypass the child PR Ready contract",
    );

    for (const f of ["AGENTS.template.zh-CN.md", "AGENTS.template.en.md"]) {
      const text = read(f);
      assert.ok(
        text.includes("docs/long-running-specs/"),
        `${f} must document the long-running spec directory`,
      );
      assert.match(
        text,
        /docs\/long-running-specs\/[\s\S]*(?:人工|manual)/i,
        `${f} must make long-running spec archival a manual lifecycle decision`,
      );
    }
  });

  test("umbrella coordinates complete child outcomes without mirroring parent sections", () => {
    const skill = markdownSubsection(
      read("plugins/auriga-workflow/skills/spec-design/SKILL.md"),
      "#### C3. 拆分大需求",
    );
    const template = read(
      "plugins/auriga-workflow/skills/spec-design/references/umbrella-template.md",
    );
    const specTemplate = read(
      "plugins/auriga-workflow/skills/spec-design/references/spec-template.md",
    );
    const validationTemplate = read(
      "plugins/auriga-workflow/skills/spec-design/references/validation-contract-template.md",
    );
    const example = fencedMarkdownExample(template);

    assert.match(
      template,
      /以下代码块是生成的 `umbrella\.md` 正文模板：\n\n```markdown/,
      "the template file must identify which document the fenced body generates",
    );
    assert.match(
      skill,
      /总 `spec\.md`[^。\n]*父级验收锚点[^。\n]*`umbrella\.md`[^。\n]*(?:协调|覆盖)/,
      "split specs must keep parent assertions in the parent spec and coordination in umbrella",
    );
    assert.doesNotMatch(
      `${skill}\n${template}\n${specTemplate}\n${validationTemplate}`,
      /总 `validation-contract\.md`/,
      "split specs must not invent a parent validation-contract file",
    );
    assert.match(
      template,
      /```text\ndocs\/long-running-specs\/\n└── <总主题>\/\n    ├── spec\.md\n    ├── umbrella\.md\n    └── <子主题>\/\n        ├── spec\.md\n        ├── validation-contract\.md\n        └── validation-results\.md\n```/,
      "umbrella must show the long-running hierarchy as a directory tree",
    );
    assert.match(
      template,
      /```text\ndocs\/specs\/\n└── <总主题>\/\n    ├── spec\.md\n    ├── umbrella\.md\n    └── <子主题>\/\n        ├── spec\.md\n        ├── validation-contract\.md\n        └── validation-results\.md\n```/,
      "umbrella must show the PR-scoped hierarchy as a directory tree",
    );
    assert.doesNotMatch(
      template,
      /每个子规范写入 `docs\/|验收契约写入 `docs\//,
      "directory trees should replace repetitive path prose",
    );
    assert.match(
      template,
      /docs\/long-running-specs\/[\s\S]*<总主题>[\s\S]*<子主题>[\s\S]*spec\.md/,
      "long-running child specs must live below their umbrella topic",
    );
    assert.match(
      template,
      /docs\/long-running-specs\/[\s\S]*<总主题>[\s\S]*<子主题>[\s\S]*validation-contract\.md/,
      "long-running child validation contracts must live beside their child specs",
    );
    assert.doesNotMatch(
      `${skill}\n${template}`,
      /父级?目录/,
      "the template must not use an ambiguous parent-directory label",
    );
    assert.doesNotMatch(
      template,
      /相同的产品分组、叶子功能名称和顺序/,
      "umbrella must not require child delivery slices to mirror parent product sections",
    );
    assert.match(example, /## 1\. Goal and Shared Scope \/ 目标与共同范围/);
    assert.match(
      example,
      /## 2\. Sub-specs \/ 子规范/,
    );
    assert.match(
      example,
      /\| 顺序 \| 完整用户结果 \| 子规范 \| 验收契约 \| 验证结果 \| 父级验收项 \| 状态 \|/,
      "umbrella must index independently deliverable child outcomes and their contracts",
    );
    assert.match(
      example,
      /## 3\. Parent Validation Coverage \/ 父级验收覆盖/,
    );
    assert.match(
      example,
      /\| 父级验收项 \| 共同结果 \| 子规范 \| 子验收项 \| 状态 \|/,
      "umbrella must map every parent assertion to concrete child assertions",
    );
    assert.match(example, /## 4\. Dependencies and Boundaries \/ 依赖与边界/);
    assert.match(example, /## 5\. Cross-spec Acceptance \/ 跨规范验收/);
    assert.match(example, /## 6\. Overall Out of Scope \/ 整体不做/);
    assert.match(example, /## 7\. Open questions \/ 悬而未决/);
    assert.match(example, /## 8\. References and Lifecycle \/ 参考资料与生命周期/);
    assert.match(
      example,
      /docs\/worklog\//,
      "umbrella template must require final worklog links after child-spec archival",
    );
    const nonHeadingProse = example
      .split("\n")
      .filter((line) => !/^#{1,6} /.test(line))
      .join("\n");
    assert.doesNotMatch(
      nonHeadingProse,
      /\b(?:Order|Complete user outcome|Sub-spec|Validation contract|Parent VAL|Child VAL|Status|Overall outcome|Shared product rules|Overall boundary|parallel|draft|confirmed|planned|passed|not run|out of scope|Delivery dependency|Shared-rule ownership|Child boundaries|Parent product spec|Parent validation contract|arch|plan|impl|Agent)\b/,
      "umbrella prose and tables must use Chinese outside bilingual headings",
    );
  });

  test("VAL-DEP-002: skills-lock.json no longer contains brainstorming entry; .agents/skills/brainstorming/ is gone", () => {
    const lock = JSON.parse(read("skills-lock.json"));
    assert.equal(
      "brainstorming" in lock.skills,
      false,
      "skills-lock.json must not contain brainstorming",
    );
    assert.equal(
      fs.existsSync(path.join(repoRoot, ".agents/skills/brainstorming")),
      false,
      ".agents/skills/brainstorming/ must be deleted",
    );
  });

  test("VAL-DOC-001: documentation-management replaces the vendored documentation skill and ships only through auriga-workflow", () => {
    const lock = JSON.parse(read("skills-lock.json"));
    assert.equal(
      "documentation-and-adrs" in lock.skills,
      false,
      "skills-lock.json must not contain documentation-and-adrs (forked into auriga-workflow)",
    );
    assert.equal(
      "documentation-management" in lock.skills,
      false,
      "auriga-owned documentation-management must not return to skills-lock.json",
    );
    assert.equal(
      fs.existsSync(path.join(repoRoot, ".agents/skills/documentation-and-adrs")),
      false,
      ".agents/skills/documentation-and-adrs/ must be deleted",
    );
    assert.equal(
      fs.existsSync(
        path.join(
          repoRoot,
          "plugins/auriga-workflow/skills/documentation-management/SKILL.md",
        ),
      ),
      true,
      "documentation-management must ship as a plugin-bundled auriga-workflow skill",
    );
    assert.equal(
      fs.existsSync(
        path.join(repoRoot, "plugins/auriga-workflow/skills/documentation-and-adrs"),
      ),
      false,
      "the old documentation-and-adrs plugin path must be retired",
    );
    // Plugin-bundled skills carry no .claude/skills/<name> symlink — the
    // fork must remove the one the vendored skill left behind.
    assert.equal(
      fs.existsSync(path.join(repoRoot, ".claude/skills/documentation-and-adrs")),
      false,
      ".claude/skills/documentation-and-adrs symlink must be removed",
    );
    assert.equal(
      fs.existsSync(path.join(repoRoot, ".claude/skills/documentation-management")),
      false,
      "plugin-bundled documentation-management must not have a standalone symlink",
    );
    assert.ok(
      read("plugins/auriga-workflow/README.md").includes("documentation-management"),
      "plugin README skills table must list documentation-management",
    );
  });

  test("VAL-DOC-002: documentation-management stores ADRs under docs/architecture/, not docs/decisions/", () => {
    const text = read(
      "plugins/auriga-workflow/skills/documentation-management/SKILL.md",
    );
    assert.ok(
      text.includes("docs/architecture/"),
      "forked skill must point ADRs at docs/architecture/",
    );
    assert.equal(
      text.includes("docs/decisions/"),
      false,
      "forked skill must not retain the upstream docs/decisions/ path",
    );
  });

  test("VAL-DEP-004: unified TDD skill consumes the validation contract", () => {
    const text = read(
      "plugins/auriga-workflow/skills/test-driven-development/SKILL.md",
    );
    assert.ok(
      text.includes("validation-contract.md"),
      "test-driven-development must reference validation-contract.md",
    );
    assert.ok(
      text.includes("docs/rules/test/"),
      "test-driven-development must consume project test rules",
    );
  });

  test("VAL-DEP-009: deep-review spec-conformance reviewer requires VAL tagging", () => {
    const text = read(
      "plugins/auriga-workflow/skills/deep-review/references/reviewers/spec-conformance.md",
    );
    assert.ok(
      text.includes("validation-contract.md"),
      "spec-conformance reviewer must read validation-contract.md",
    );
    assert.ok(
      /VAL-XXX-NNN|VAL-[A-Z]+/.test(text),
      "spec-conformance reviewer must tag findings with VAL ids",
    );
  });

  test("repo instruction entrypoints are separated from product templates", () => {
    const text = read("AGENTS.md");
    assert.equal(
      text.startsWith("<!-- AURIGA:WORKFLOW:v1 START"),
      true,
      "root AGENTS.md should be shaped like an installed workflow sample",
    );
    assert.match(text, /# auriga 工作流/);
    assert.match(text, /Interactive CLI/);
    assert.match(text, /需求澄清：[^\n]*`spec-design`/);
    assert.match(text, /docs\/rules\/test\//);
    assert.match(text, /docs\/rules\/spec\//);
    assert.match(text, /docs\/rules\/arch\//);
    assert.match(text, /# auriga-cli 工程专属规则/);
    assert.ok(
      text.indexOf("# auriga-cli 工程专属规则") > text.indexOf("AURIGA:WORKFLOW:v1 END"),
      "repo-specific rules should live below the managed workflow block",
    );
    assert.ok(
      Buffer.byteLength(text, "utf-8") < 32 * 1024,
      "root AGENTS.md must stay under Codex's default instruction budget",
    );
    assert.ok(
      text.split("\n").length <= 200,
      "root AGENTS.md must stay lean enough for Claude Code memory guidance",
    );
    assert.equal(
      fs.existsSync(path.join(repoRoot, ".claude/AGENTS.md")),
      false,
      ".claude/AGENTS.md compatibility entry should be removed",
    );
    assert.equal(
      fs.existsSync(path.join(repoRoot, ".claude/CLAUDE.md")),
      false,
      ".claude/CLAUDE.md compatibility entry should be removed",
    );
    assert.deepEqual(
      JSON.parse(read(".codex/session-instructions-loader.json")),
      { ancestorLevel: 1 },
      "session-instructions-loader repo config should limit ancestor discovery",
    );
  });

});
