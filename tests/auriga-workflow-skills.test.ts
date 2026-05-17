import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const repoRoot = path.resolve(new URL(".", import.meta.url).pathname, "..", "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf-8");
}

describe("auriga-workflow skill contracts", () => {
  test("test-designer consumes project test rules", () => {
    const text = read(
      "plugins/auriga-workflow/skills/test-designer/SKILL.md",
    );
    assert.ok(
      text.includes("docs/rules/test/"),
      "test-designer must consult project test rules under docs/rules/test/",
    );
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
      /test-designer/.test(text),
      "test-quality reviewer must stay aligned with test-designer",
    );
  });
});
