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

const reviewReference = (file: string): string =>
  read(`plugins/auriga-workflow/skills/deep-review/references/${file}`);

const builtinReviewerTriggers = {
  architecture: "tag:architecture",
  "engineering-quality": "tag:maintained-code",
  correctness: "tag:executable-behavior",
  "docs-sync": "always",
  performance: "tag:performance-sensitive",
  security: "tag:security-sensitive",
  "skill-plugin-quality": "tag:agent-extension",
  "spec-conformance": "always",
  "test-quality": "tag:executable-behavior-or-tests",
  ux: "tag:ui",
} as const;

describe("auriga-workflow skill contracts", () => {
  test("unified test-driven-development is plugin-bundled and concise", () => {
    const rel = "plugins/auriga-workflow/skills/test-driven-development/SKILL.md";
    const abs = path.join(repoRoot, rel);

    assert.ok(fs.existsSync(abs), `${rel} must exist`);
    const text = read(rel);
    const parsed = matter(text);

    assert.equal(parsed.data.name, "test-driven-development");
    assert.ok(
      text.split("\n").length <= 80,
      "the unified TDD skill must stay within an 80-line context budget",
    );
  });

  test("auriga-owned test-driven-development is not vendored as a project skill", () => {
    assert.equal(fs.existsSync(path.join(repoRoot, ".agents/skills/test-driven-development")), false);
    assert.equal(fs.existsSync(path.join(repoRoot, ".claude/skills/test-driven-development")), false);
  });

  test("git-workflow keeps team lifecycle contracts without generic Git teaching", () => {
    const skill = read("plugins/auriga-workflow/skills/git-workflow/SKILL.md");
    const parsed = matter(skill);
    const lifecyclePath = "plugins/auriga-workflow/skills/git-workflow/references/pull-requests.md";
    assert.ok(skill.includes("references/pull-requests.md"));
    assert.ok(fs.existsSync(path.join(repoRoot, lifecyclePath)));
    const lifecycle = read(lifecyclePath);

    assert.equal(parsed.data.name, "git-workflow");
    const templateHeadings = [
      "## 摘要",
      "## 验收标准",
      "## 验证计划",
    ];
    for (const heading of templateHeadings) {
      assert.ok(lifecycle.includes(heading), `PR template must preserve ${heading}`);
    }
    assert.match(
      skill,
      /`feat`.*`fix`.*`docs`.*`refactor`.*`chore`.*`test`.*`perf`.*`style`.*`build`.*`ci`.*`revert`/s,
      "Conventional Commit types must match pr-create-guard",
    );
  });
});

describe("project rule discovery anchors to the repo root", () => {
  const ruleConsumers: Array<{ rel: string; area: string; label: string }> = [
    {
      rel: "plugins/auriga-workflow/skills/deep-review/references/project-reviewers.md",
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
    });
  }
});

describe("deep-review custom-reviewer explicit protocol", () => {
  test("custom reviewers declare a host or standalone explicitly", () => {
    const text = reviewReference("project-reviewers.md");
    assert.ok(
      text.includes("extends: <内置审查者名>"),
      "SKILL.md must require an explicit built-in host",
    );
    assert.ok(
      text.includes("extends: standalone"),
      "SKILL.md must support an explicit standalone dimension",
    );
  });

  test("custom reviewer metadata validation covers every frontmatter key", () => {
    const text = reviewReference("project-reviewers.md");
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

  // VAL-CRT-003 — the field schema (required vs optional) is documented explicitly
  test("shared protocol documents required and optional metadata", () => {
    const text = reviewReference("project-reviewers.md");
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
});

describe("deep-review modernization contract", () => {
  test("candidate table lists every built-in reviewer with its frontmatter trigger signal", () => {
    const text = deepReview();
    for (const [reviewer, trigger] of Object.entries(builtinReviewerTriggers)) {
      const row = text
        .split("\n")
        .find((line) => line.startsWith(`| \`${reviewer}\` |`));
      assert.ok(row, `missing candidate row for ${reviewer}`);
      const expectedSignals = trigger === "tag:executable-behavior-or-tests"
        ? ["`executable-behavior`", "`tests`"]
        : [trigger === "always" ? "通用候选" : `\`${trigger.slice(4)}\``];
      assert.ok(
        expectedSignals.every((signal) => row.includes(signal)),
        `${reviewer} must keep candidate signal ${trigger}`,
      );
    }
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

  test("engineering reviewer preserves the legacy host mapping", () => {
    assert.match(reviewReference("project-reviewers.md"), /extends: code-quality[^。]*engineering-quality/);
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
