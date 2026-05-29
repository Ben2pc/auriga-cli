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

  test("test-quality reviewer may run unit tests only", () => {
    const text = read(
      "plugins/auriga-workflow/skills/deep-review/references/reviewers/test-quality.md",
    );
    assert.ok(
      /\*\*Tools\*\*.*Bash/.test(text),
      "test-quality reviewer must be granted Bash to run tests",
    );
    assert.ok(
      text.includes("Running tests — unit only"),
      "test-quality reviewer must scope test execution to unit tests only",
    );
  });
});

describe("deep-review custom-reviewer scope overlap", () => {
  const deepReview = (): string =>
    read("plugins/auriga-workflow/skills/deep-review/SKILL.md");

  // VAL-OVL-001 — overlapping custom reviewer is not dispatched separately
  test("overlapping custom reviewer is not dispatched as a separate subagent", () => {
    const text = deepReview();
    assert.ok(
      text.includes("范围重叠"),
      "SKILL.md must define the scope-overlap concept for custom reviewers",
    );
    assert.ok(
      text.includes("不再为该自定义审查者分派独立子代理"),
      "an overlapping custom reviewer must not be dispatched as a separate subagent",
    );
  });

  // VAL-OVL-002 — overlapping custom reviewer's content is absorbed into the host
  test("overlapping custom reviewer's checklist is absorbed into the host built-in", () => {
    const text = deepReview();
    assert.ok(
      text.includes("项目专属补充"),
      "absorbed custom content must be labelled as a project-specific supplement",
    );
    assert.ok(
      /Checklist[^。]*worked scenarios/.test(text),
      "the absorbed content must be the custom reviewer's Checklist and worked scenarios",
    );
  });

  // VAL-OVL-003 — non-overlapping custom reviewer still dispatched standalone
  test("non-overlapping custom reviewer is still dispatched as an independent reviewer", () => {
    const text = deepReview();
    assert.ok(
      text.includes("全新维度"),
      "SKILL.md must describe a non-overlapping custom reviewer as a new dimension",
    );
    assert.ok(
      /不重叠[^]*?独立[^]*?分派/.test(text),
      "a non-overlapping custom reviewer must still be dispatched as an independent reviewer",
    );
  });

  // VAL-OVL-004 — overlap decided semantically, optional explicit field wins
  test("overlap is decided semantically with an optional explicit Extends field", () => {
    const text = deepReview();
    assert.ok(
      text.includes("语义判断"),
      "overlap detection must be primarily a semantic judgment",
    );
    assert.ok(
      text.includes("Extends"),
      "an explicit Extends field, when present, must take precedence",
    );
  });

  // VAL-OVL-005 — name collision unified into absorption, old skip rule removed
  test("name collision is treated as guaranteed overlap, not skip-and-warn", () => {
    const text = deepReview();
    assert.ok(
      /重名[^]*?必然重叠/.test(text),
      "a name collision must be treated as a guaranteed overlap",
    );
    assert.ok(
      !text.includes("跳过并给出警告"),
      "the old skip-and-warn rule for name collisions must be removed",
    );
  });

  // VAL-OVL-006 — host not triggered → absorbed content does not run
  test("absorbed content does not run when the host built-in is not triggered", () => {
    const text = deepReview();
    assert.ok(
      text.includes("随 host 一并不运行"),
      "absorbed custom content must not run when its host built-in is not triggered",
    );
  });

  // VAL-OVL-007 — absorbed findings attributed to the host built-in name
  test("absorbed findings are attributed to the host built-in reviewer name", () => {
    const text = deepReview();
    assert.ok(
      text.includes("按 host 内置审查者名标注"),
      "findings from absorbed content must be attributed to the host built-in name",
    );
  });

  // VAL-OVL-008 — Extends: standalone is a sentinel that forces independent dispatch
  test("Extends: standalone forces independent dispatch", () => {
    const text = deepReview();
    assert.ok(
      text.includes("Extends: standalone") || text.includes("`standalone`"),
      "SKILL.md must recognize the standalone sentinel value of Extends",
    );
    assert.ok(
      /standalone[^]*?独立[^]*?分派/.test(text),
      "Extends: standalone must force the custom reviewer to dispatch independently",
    );
  });

  // VAL-OVL-009 — when Extends is omitted, the default biases toward absorption
  test("default with no Extends biases toward absorption", () => {
    const text = deepReview();
    assert.ok(
      text.includes("偏向吸收"),
      "the default when Extends is omitted must bias toward absorbing into a host",
    );
    assert.ok(
      /套不上|没有.*host|都不.*覆盖/.test(text),
      "independent dispatch must be the fallback only when no host built-in fits",
    );
  });
});

describe("reviewer-creator Extends support", () => {
  // VAL-CRT-001 — the scaffold template ships an Extends metadata row
  test("template.md ships an Extends row in Metadata", () => {
    const text = read(
      "plugins/auriga-workflow/skills/reviewer-creator/references/template.md",
    );
    assert.ok(
      /\*\*Extends\*\*/.test(text),
      "template must include an Extends metadata field",
    );
    assert.ok(
      text.includes("standalone"),
      "template must document the standalone sentinel for forced independence",
    );
  });

  // VAL-CRT-002 — the 7-question flow asks supplement-vs-new-dimension and writes Extends
  test("SKILL.md asks supplement-vs-new-dimension and writes Extends", () => {
    const text = read(
      "plugins/auriga-workflow/skills/reviewer-creator/SKILL.md",
    );
    assert.ok(
      text.includes("Extends"),
      "reviewer-creator must populate the Extends field from the answer",
    );
    assert.ok(
      /补充[^]*?独立维度|独立维度[^]*?补充/.test(text),
      "the flow must ask whether the reviewer supplements a built-in or is a new dimension",
    );
    assert.ok(
      !text.includes("不会自动产出"),
      "the stale claim that reviewer-creator never emits Extends must be removed",
    );
  });
});
