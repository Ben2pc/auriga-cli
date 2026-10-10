import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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

describe("validation results artifacts", () => {
  const templatePath = "plugins/auriga-workflow/skills/spec-design/references/validation-results-template.md";

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
  test("SKILL.md frontmatter has name and description", () => {
    const text = read(
      "plugins/auriga-workflow/skills/spec-design/SKILL.md",
    );
    assert.match(text, /^---[\s\S]*?\nname:\s*spec-design\s*\n/);
    assert.match(text, /\ndescription:\s*[^\s].+\n/);
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

  test("root AGENTS.md stays within host instruction budgets", () => {
    const text = read("AGENTS.md");
    assert.ok(
      Buffer.byteLength(text, "utf-8") < 32 * 1024,
      "root AGENTS.md must stay under Codex's default instruction budget",
    );
    assert.ok(
      text.split("\n").length <= 200,
      "root AGENTS.md must stay lean enough for Claude Code memory guidance",
    );
  });
});
