import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Compiled test lives at dist-test/tests/goalify.test.js; ../.. = repo root.
const repoRoot = path.resolve(
  new URL(".", import.meta.url).pathname,
  "..",
  "..",
);

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf-8");
}

describe("goalify skill contract", () => {
  test("documents spec-design inputs", () => {
    const text = read("plugins/auriga-workflow/skills/goalify/SKILL.md");
    assert.ok(
      text.includes("spec.md") && text.includes("validation-contract.md"),
      "goalify must list both spec source files",
    );
  });

  test("keeps /goal text portable and boundary-light", () => {
    const text = read("plugins/auriga-workflow/skills/goalify/SKILL.md");
    assert.ok(text.includes("## Must Not"), "goalify must define Must Not rules");
    assert.ok(text.includes("## Examples"), "goalify must include /goal examples");
    assert.ok(
      text.includes("Must not 在 `/goal` 文本里硬编切片计划"),
      "goalify must prohibit hard-coded slice plans in /goal text",
    );
    assert.ok(
      text.includes("Must not 把 `spec.md`、`validation-contract.md`") &&
        text.includes("大段复制进 `/goal`"),
      "goalify must prohibit copying existing spec content into /goal text",
    );
    assert.ok(
      text.includes("Must not 预判 `deep-review`"),
      "goalify must prohibit pre-judging deep-review findings",
    );
    assert.ok(
      text.includes("Claude Code") && text.includes("Codex"),
      "goalify must document runtime-specific /goal dispatch behavior",
    );
    assert.ok(
      text.includes("deep-review") && text.includes("blocking"),
      "goalify must document the common endpoint of completing deep-review and fixing blocking findings",
    );
    assert.ok(
      text.includes("handoff") &&
        text.includes("这次做了什么") &&
        text.includes("怎么验收") &&
        text.includes("下一步可以做什么"),
      "goalify must require a final handoff with what changed, acceptance, and next steps",
    );
    assert.ok(
      text.includes("incremental-impl"),
      "goalify must preserve the boundary with incremental-impl",
    );
    assert.equal(
      text.includes("切片计划一起写进 `/goal`"),
      false,
      "goalify must not instruct Agents to hard-code slice plans into /goal text",
    );
    assert.equal(
      /每条\s+VAL[\s\S]{0,40}翻译成\s+goal/.test(text),
      false,
      "goalify must not instruct Agents to translate each VAL into /goal text",
    );
  });
});
