import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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
    assert.match(text, /价值门禁[\s\S]*最多两轮/);
    assert.match(text, /推荐答案和理由/);
    assert.match(text, /成本更低的替代/);
    for (const exit of ["值得做", "先验证", "暂缓", "不做"]) {
      assert.ok(text.includes(exit), `value gate must preserve the ${exit} exit`);
    }
    assert.doesNotMatch(text, /D1\.5|playground|静态 HTML/i);
  });

  test("validation-contract keeps evidence semantics without duplicating a concrete toolchain", () => {
    const text = read(
      "plugins/auriga-workflow/skills/spec-design/references/validation-contract-template.md",
    );
    assert.doesNotMatch(text, /## Toolchain/);
    assert.match(text, /一条 VAL[^\n]*不代表一个测试用例/);
    for (const field of ["验收要求", "验证方式", "通过标准"]) {
      assert.ok(text.includes(field), `validation contract must preserve ${field}`);
    }
    assert.doesNotMatch(text, /Behavior|Tool \(工具\)|Evidence/);
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

  test("spec-design uses Socratic decision alignment without synthetic options", () => {
    const text = read(
      "plugins/auriga-workflow/skills/spec-design/SKILL.md",
    );
    assert.match(text, /苏格拉底式需求对齐/);
    assert.match(text, /一次解决一个决定/);
    assert.match(text, /推荐答案及主要后果/);
    assert.match(text, /不存在真实取舍时直接推荐，不制造候选/);
    assert.match(text, /用户明确确认前，不进入架构、计划或实现/);
  });

  test("spec-design persists only when traceability or handoff needs it", () => {
    const text = read(
      "plugins/auriga-workflow/skills/spec-design/SKILL.md",
    );
    assert.match(text, /当前对话中的用户确认作为权威规格，不强制生成文件/);
    assert.match(text, /跨会话、跨 Agent 或独立评审/);
    assert.match(text, /文件只保存确认后的结果，不记录冗长问答流水/);
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

  test("workflow templates keep the unified TDD trigger and refactor boundary", () => {
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
      assert.match(
        text,
        /(?:重构[^\n]*保护网|refactor[^\n]*protection)/i,
        `${f} must preserve the green characterization-test path for refactors`,
      );
    }
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

    const reviewIndex = read(
      "docs/long-running-specs/model-generation-workflow-upgrade/reviews/README.md",
    );
    assert.match(reviewIndex, /verification-before-completion[^\n]*主结论：删除/);
    assert.doesNotMatch(reviewIndex, /verification-before-completion[^\n]*删除并由[^\n]*替代/);
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

  test("systematic-debugging records map parent VALs and separate implementation from model evaluation", () => {
    const parentContract = read(
      "docs/long-running-specs/model-generation-workflow-upgrade/validation-contract.md",
    );
    const umbrella = read(
      "docs/long-running-specs/model-generation-workflow-upgrade/umbrella.md",
    );
    const reviewIndex = read(
      "docs/long-running-specs/model-generation-workflow-upgrade/reviews/README.md",
    );
    const childReview = read(
      "docs/worklog/worklog-2026-07-14-feat-model-generation-workflow-upgrade/systematic-debugging/review.md",
    );

    const parentCoverage = markdownSection(umbrella, "## Parent coverage map");
    const parentIds = parentContract.match(/### (VAL-[A-Z]+-\d+)/g)?.map((line) => line.slice(4)) ?? [];
    const requiredChildren: Record<string, string[]> = {
      "VAL-INV-001": ["待定"],
      "VAL-INV-002": ["待定"],
      "VAL-REV-001": ["待定"],
      "VAL-REV-002": ["待定"],
      "VAL-REV-003": ["VAL-RISK-001", "VAL-VRSK-001", "VAL-DRISK-001"],
      "VAL-MIG-001": ["VAL-ASSET-001", "VAL-FLOW-002", "VAL-VAST-001", "VAL-VREF-001", "VAL-ROUT-001..003", "VAL-CUST-002"],
      "VAL-MIG-002": ["VAL-PUBL-001..002", "VAL-REMOVE-001", "VAL-NOMUTATE-001", "VAL-FLOW-002", "VAL-REL-002", "VAL-VRUL-001", "VAL-VMIG-001", "VAL-PORT-001..002"],
      "VAL-MIG-003": ["VAL-PUBL-001", "VAL-MANUAL-001", "VAL-RELEASE-001", "VAL-REL-001", "VAL-VREL-001", "VAL-DRREL-001"],
      "VAL-DOC-001": ["VAL-LIFE-001"],
      "VAL-DOC-002": ["VAL-LIFE-001", "VAL-DRREL-002"],
    };
    assert.deepEqual(Object.keys(requiredChildren).sort(), [...parentIds].sort());
    for (const parentVal of parentIds) {
      const rows = parentCoverage.split("\n").filter((line) => line.startsWith(`| ${parentVal} |`));
      assert.equal(rows.length, 1, `umbrella must contain exactly one coverage row for ${parentVal}`);
      assert.match(
        rows[0],
        /\| (?:\[[^\]]+\]\([^\)]+validation-contract\.md\)|待定)(?:、\[[^\]]+\]\([^\)]+validation-contract\.md\))* \| (?:VAL-[A-Z]+-\d+(?:\.\.\d+)?(?:、VAL-[A-Z]+-\d+(?:\.\.\d+)?)*|待定) \| [^|]+ \|$/,
        `${parentVal} must map to exact child contracts and child VALs, or be explicitly pending`,
      );
      const cells = rows[0].split("|").map((cell) => cell.trim());
      const actualChildren = cells[3].split("、");
      for (const required of requiredChildren[parentVal]) {
        assert.ok(
          actualChildren.includes(required),
          `${parentVal} must keep required child mapping ${required}`,
        );
      }
      if (cells[3] !== "待定") {
        const linkedContracts = [...cells[2].matchAll(/\(([^)]+validation-contract\.md)\)/g)]
          .map((match) => fs.readFileSync(path.resolve(
            repoRoot,
            "docs/long-running-specs/model-generation-workflow-upgrade",
            match[1],
          ), "utf-8"));
        assert.ok(linkedContracts.length > 0, `${parentVal} must link its child contracts`);
        for (const range of cells[3].matchAll(/VAL-([A-Z]+)-(\d+)(?:\.\.(\d+))?/g)) {
          const [, family, startRaw, endRaw] = range;
          const start = Number(startRaw);
          const end = endRaw ? Number(endRaw) : start;
          for (let value = start; value <= end; value += 1) {
            const childVal = `VAL-${family}-${String(value).padStart(startRaw.length, "0")}`;
            assert.ok(
              linkedContracts.some((contract) => contract.includes(`### ${childVal}`)),
              `${parentVal} references missing child assertion ${childVal}`,
            );
          }
        }
      }
    }
    assert.ok(
      umbrella.includes("## Parent coverage map"),
      "active long-running umbrella must carry the parent coverage map",
    );
    const systematicRow = markdownSection(umbrella, "## Sub-specs")
      .split("\n")
      .find((line) => line.includes("systematic-debugging"));
    assert.ok(systematicRow, "umbrella must keep the systematic-debugging child row");
    assert.match(systematicRow, /实现[^|]*(?:完成|已合入).*PR #177/);
    assert.match(systematicRow, /PR #178[^|]*(?:取消自动迁移|人工清理)/);
    assert.match(systematicRow, /模型评测[^|]*(?:未执行|不在[^|]*范围)/);
    for (const text of [reviewIndex, childReview]) {
      assert.match(text, /实现[^\n]*(?:完成|已合入)/, "must state implementation status");
      assert.match(text, /PR #178[^\n]*(?:取消自动迁移|人工清理)/, "must state manual cleanup decision");
      assert.match(text, /模型评测[^\n]*(?:未执行|不在[^\n]*范围)/, "must state model evaluation status");
    }
    assert.match(
      reviewIndex,
      /docs\/specs\/<asset-name>\/review\.md[\s\S]*docs\/worklog\//,
      "review index must route child records through PR-scoped specs and Ready archival",
    );
    assert.match(
      reviewIndex,
      /正式评审记录[^\n]*(?:不能删除|不得删除)/,
      "formal child review evidence must survive the Ready transition",
    );
    assert.match(
      reviewIndex,
      /用户明确豁免子规范[^\n]*只保留评审记录/,
      "an explicit user decision may waive a child spec without manufacturing an unused asset",
    );
    assert.match(
      reviewIndex,
      /豁免子规范不等于豁免正式评审记录/,
      "waiving a child spec must not erase formal review evidence",
    );
  });

  test("archived child contract uses unique VAL ids and maps them to parent assertions", () => {
    const parent = read(
      "docs/long-running-specs/model-generation-workflow-upgrade/validation-contract.md",
    );
    const child = read(
      "docs/worklog/worklog-2026-07-14-feat-model-generation-workflow-upgrade/systematic-debugging/validation-contract.md",
    );
    const parentIds = new Set(parent.match(/### (VAL-[A-Z]+-\d+)/g)?.map((line) => line.slice(4)) ?? []);
    const repair = read(
      "docs/worklog/worklog-2026-07-14-fix-migrated-skill-cleanup/validation-contract.md",
    );
    const unifiedTdd = read(
      "docs/worklog/worklog-2026-07-14-refactor-simplify-tdd-skill/unified-tdd-skill/validation-contract.md",
    );
    const verificationRule = read(
      "docs/worklog/worklog-2026-07-14-refactor-remove-verification-skill/verification-before-completion/validation-contract.md",
    );
    const umbrella = read(
      "docs/long-running-specs/model-generation-workflow-upgrade/umbrella.md",
    );
    const umbrellaDir = path.join(
      repoRoot,
      "docs/long-running-specs/model-generation-workflow-upgrade",
    );
    const linkedContractPaths = new Set(
      [...umbrella.matchAll(/\(([^)]+validation-contract\.md)\)/g)].map(
        (match) => path.resolve(umbrellaDir, match[1]),
      ),
    );
    const childIds = [...linkedContractPaths]
      .flatMap((contractPath) => fs.readFileSync(contractPath, "utf-8")
        .match(/### (VAL-[A-Z]+-\d+)/g)?.map((line) => line.slice(4)) ?? []);

    assert.equal(
      childIds.some((id) => parentIds.has(id)),
      false,
      "child VAL ids must not collide with parent VAL ids",
    );
    const childCoverage = markdownSection(child, "## Parent coverage map");
    assert.ok(
      childCoverage.includes("## Parent coverage map"),
      "archived child contract must preserve its mapping to the parent contract",
    );
    assert.ok(childCoverage.includes("VAL-PUBL-001..002"), "parent coverage map must reference both publish VALs");
    assert.equal(childCoverage.includes("VAL-DIAG-001"), false, "behavior VALs must not stand in for model evidence");
    assert.equal(childCoverage.includes("VAL-PROD-001"), false, "production VALs must not stand in for model evidence");

    assert.equal(new Set(childIds).size, childIds.length, "child VAL ids must be unique across archived contracts");
    const tddCoverage = markdownSection(unifiedTdd, "## Parent coverage map");
    assert.match(tddCoverage, /\| VAL-REV-003 \| VAL-RISK-001 \|/);
    assert.match(tddCoverage, /\| VAL-MIG-001 \| VAL-ASSET-001、VAL-FLOW-002 \|/);
    assert.doesNotMatch(tddCoverage, /VAL-FLOW-001/);
    const tddActiveCoverage = markdownSection(unifiedTdd, "## Coverage map");
    assert.doesNotMatch(tddActiveCoverage, /VAL-FLOW-001/);
    const tddAssertions = markdownSection(unifiedTdd, "## Assertions");
    assert.doesNotMatch(tddAssertions, /### VAL-FLOW-001/);
    assert.match(unifiedTdd, /## Withdrawn assertion history[\s\S]*`VAL-FLOW-001`[^\n]*不再属于[^\n]*最终验收/);
    const repairCoverage = markdownSection(repair, "## Parent coverage map");
    for (const row of [
      ["VAL-MIG-002", "VAL-REMOVE-001", "VAL-NOMUTATE-001"],
      ["VAL-MIG-003", "VAL-MANUAL-001", "VAL-RELEASE-001"],
      ["VAL-DOC-001", "VAL-LIFE-001"],
      ["VAL-DOC-002", "VAL-LIFE-001"],
    ]) {
      const [parentVal, ...childVals] = row;
      const line = repairCoverage.split("\n").find((candidate) => candidate.startsWith(`| ${parentVal} |`));
      assert.ok(line, `repair child contract must map ${parentVal}`);
      for (const childVal of childVals) {
        assert.ok(line.includes(childVal), `${parentVal} row must map ${childVal}`);
      }
    }
  });

  test("deep-review formal record preserves modernization risks and recovery signals", () => {
    const rel = "docs/worklog/worklog-2026-07-15-refactor-deep-review-for-new-models/deep-review-modernization/review.md";
    assert.ok(fs.existsSync(path.join(repoRoot, rel)), "deep-review must keep a formal review record");
    const review = read(rel);
    for (const heading of [
      "## 当前职责",
      "## 可复现失效模式",
      "## 处置结论",
      "## 风险与恢复条件",
    ]) {
      assert.ok(review.includes(heading), `deep-review review record must keep ${heading}`);
    }
    assert.match(review, /观察信号/);
    assert.match(review, /恢复条件/);
    assert.match(review, /模型评测未执行|没有执行[^。\n]*模型评测/);
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
    assert.match(text, /需求澄清：新需求先用 `spec-design`/);
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
