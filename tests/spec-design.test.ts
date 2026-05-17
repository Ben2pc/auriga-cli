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

  test("SKILL.md documents the D1.5 review-aid three-way (skip / playground / static HTML)", () => {
    const text = read(
      "plugins/auriga-workflow/skills/spec-design/SKILL.md",
    );
    assert.ok(text.includes("D1.5"), "must reference D1.5");
    assert.ok(
      text.toLowerCase().includes("playground"),
      "must mention playground option",
    );
    assert.ok(
      /static\s+html/i.test(text),
      "must mention static HTML option",
    );
  });

  test("validation-contract-template.md ships the ## Toolchain section", () => {
    const text = read(
      "plugins/auriga-workflow/skills/spec-design/references/validation-contract-template.md",
    );
    assert.ok(
      text.includes("## Toolchain"),
      "validation-contract template must include a ## Toolchain section",
    );
  });

  test("spec-template.md Open questions placeholder requires a deferral owner and reason", () => {
    const text = read(
      "plugins/auriga-workflow/skills/spec-design/references/spec-template.md",
    );
    assert.ok(
      text.includes("## Open questions"),
      "spec template must keep the Open questions section",
    );
    // The placeholder is authored in Chinese — assert on the contract it
    // encodes: every open question must name an owner (归属) and a
    // deferral reason (推迟理由).
    assert.ok(
      /归属/.test(text) && /推迟理由/.test(text),
      "Open questions placeholder must require a named owner and a deferral reason",
    );
  });

  test("VAL-DEP-001: product workflow templates (both languages) reference spec-design and not brainstorming", () => {
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
        /spec\s*=\s*why\s*\+\s*what/i,
        `${f} must include the spec/plan boundary rule`,
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
        /test-designer/.test(text) && /docs\/rules\/test\//.test(text),
        `${f} must require test writers to consult docs/rules/test/`,
      );
    }
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

  test("VAL-DEP-004: test-designer SKILL.md mentions validation-contract.md as input", () => {
    const text = read(
      "plugins/auriga-workflow/skills/test-designer/SKILL.md",
    );
    assert.ok(
      text.includes("validation-contract.md"),
      "test-designer must reference validation-contract.md",
    );
    assert.ok(
      text.includes("VAL-XXX-NNN") || /VAL-/.test(text),
      "test-designer must reference VAL ids",
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
    assert.match(text, /# auriga-cli Development Guide/);
    assert.match(text, /Interactive CLI/);
    assert.equal(
      text.startsWith("<!-- AURIGA:WORKFLOW:v1 START"),
      false,
      "root AGENTS.md must be the repo dev guide, not the installed product workflow template",
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
      JSON.parse(read(".agents/plugins/session-instructions-loader.json")),
      {},
      "session-instructions-loader repo config should be retained but empty",
    );
  });

});
