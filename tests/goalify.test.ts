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
      text.includes("跑到 deep-review 收敛"),
      "goalify must offer a converged deep-review terminus alongside the one-shot variant",
    );
    assert.ok(
      text.includes("PR Check") && text.includes("unresolved"),
      "the converged terminus must spell out CI-green and no-unresolved-blocking-comment criteria",
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

  test("requires a stable /goal output shape", () => {
    const text = read("plugins/auriga-workflow/skills/goalify/SKILL.md");
    for (const section of [
      "目标一句话",
      "事实来源",
      "执行约束",
      "终点条件",
      "越界停止规则",
      "handoff 要求",
    ]) {
      assert.ok(text.includes(section), `goalify output shape must include ${section}`);
    }
  });

  test("keeps built-in endpoint choices focused", () => {
    const text = read("plugins/auriga-workflow/skills/goalify/SKILL.md");
    const endpointSection = text.match(/## 确定终点阶段[\s\S]*?## 启动方式/);
    assert.ok(endpointSection, "goalify must document endpoint selection");
    const endpoints = endpointSection[0];

    assert.ok(endpoints.includes("跑到 PR Ready"), "PR Ready remains a built-in endpoint");
    assert.ok(
      endpoints.includes("跑到 deep-review 收敛"),
      "deep-review convergence remains a built-in endpoint",
    );
    assert.ok(endpoints.includes("跑到合并"), "merge remains a built-in endpoint");
    assert.ok(endpoints.includes("用户自定义"), "custom endpoint remains available");

    assert.equal(endpoints.includes("跑到 Draft PR"), false, "Draft PR is no longer built-in");
    assert.equal(endpoints.includes("跑到验证完成"), false, "verification-only is no longer built-in");
    assert.equal(
      endpoints.includes("跑到 deep-review 完成"),
      false,
      "one-shot deep-review is no longer built-in",
    );
  });
});
