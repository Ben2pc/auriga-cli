import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

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
    assert.match(gate, /默认问一个价值问题/);
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
      "### VAL-ALIGNMENT-001 — <简短的中文标题>",
    );
    const fields = [...assertion.matchAll(/^- \*\*(.+?)\*\*：/gm)].map(
      (match) => match[1],
    );
    assert.deepEqual(fields, ["验收要求", "验证方式", "通过标准"]);
    assert.equal(
      (example.match(/^### VAL-[A-Z]+-\d{3} — .+$/gm) ?? []).length,
      1,
      "example must use a full semantic category and a Chinese title",
    );
    assert.doesNotMatch(example, /Behavior|Tool \(工具\)|Evidence/);
    assert.match(text, /VAL-<完整语义分类>-<NNN>/);
    assert.match(text, /编号后增加简短的中文标题/);
    assert.match(text, /具体测试工具[^\n]*test-driven-development/);
  });

  test("spec-template.md Open questions placeholder requires a deferral owner and reason", () => {
    const text = read(
      "plugins/auriga-workflow/skills/spec-design/references/spec-template.md",
    );
    assert.ok(
      text.includes("## Open questions"),
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
    const why = markdownSubsection(example, "## Why (为什么做)");
    for (const field of ["问题与用户", "事实依据", "价值与时机", "替代方案"]) {
      assert.match(why, new RegExp(`^- \\*\\*${field}\\*\\*：`, "m"));
    }
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
      assert.match(
        text,
        /(?:评审发现|review findings)[^\n]*(?:技术债务|technical debt)/i,
        `${f} must make entropy control actionable for review findings`,
      );
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

    assert.ok(
      read("AGENTS.template.zh-CN.md").includes(
        "任何“已完成、已修复、通过或可评审”的判断，都必须基于最后一次相关修改之后、与该判断匹配的验证结果；证据不足时如实说明缺口。",
      ),
    );
    assert.ok(
      read("AGENTS.template.en.md").includes(
        'Any "done, fixed, passing, or ready for review" judgment must be based on verification results that match the claim and were obtained after the last relevant change; when evidence is insufficient, state the gap.',
      ),
    );

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
      /docs\/long-running-specs\/[\s\S]*跨[^\n]*PR|跨[^\n]*PR[\s\S]*docs\/long-running-specs\//,
      "spec-design must reserve long-running specs for cross-PR work",
    );
    assert.match(
      skill,
      /用户明确(?:批准|确认)[^\n]*长期|长期[^\n]*用户明确(?:批准|确认)/,
      "spec-design must require explicit user approval before using the long-running lifecycle",
    );
    assert.match(
      skill,
      /每个子(?:规范| PR)[^\n]*(?:适用|对应)[^\n]*长期[^\n]*VAL|长期[^\n]*VAL[^\n]*(?:适用|对应)[^\n]*每个子(?:规范| PR)/,
      "each child spec must carry forward every applicable parent validation assertion",
    );
    assert.match(
      skill,
      /docs\/specs\/<child-topic>\/[\s\S]*(?:不能|不得|不可)[^\n]*(?:替代|绕过)|(?:不能|不得|不可)[^\n]*(?:替代|绕过)[\s\S]*docs\/specs\/<child-topic>\//,
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

  test("long-running umbrella template requires parent-to-child VAL traceability", () => {
    const template = read(
      "plugins/auriga-workflow/skills/spec-design/references/umbrella-template.md",
    );
    assert.ok(
      template.includes("## Parent coverage map"),
      "umbrella template must include a parent coverage map",
    );
    const coverage = markdownSection(template, "## Parent coverage map");
    assert.match(
      coverage,
      /\| Parent VAL[^|]*\| Child spec[^|]*\| Child VAL[^|]*\| Status[^|]*\|/,
      "umbrella parent coverage map must provide one structured four-column header",
    );
    assert.match(
      coverage,
      /docs\/worklog\//,
      "umbrella template must require final worklog links after child-spec archival",
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
