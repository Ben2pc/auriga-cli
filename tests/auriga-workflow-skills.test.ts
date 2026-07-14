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

describe("auriga-workflow skill contracts", () => {
  test("systematic-debugging keeps diagnosis evidence-first without a fixed ritual", () => {
    const text = read(
      "plugins/auriga-workflow/skills/systematic-debugging/SKILL.md",
    );
    const parsed = matter(text);

    assert.equal(parsed.data.name, "systematic-debugging");
    for (const anchor of [
      "可重复的问题验证路径",
      "证据采集路径",
      "根因尚未确认",
      "临时缓解",
      "按需",
    ]) {
      assert.ok(
        text.includes(anchor),
        `systematic-debugging must keep the ${anchor} behavior anchor`,
      );
    }
    for (const method of [
      "临时日志",
      "断点",
      "git bisect",
      "重放",
      "性能",
      "监控",
      "报警",
    ]) {
      assert.ok(
        text.toLowerCase().includes(method),
        `systematic-debugging must mention ${method} in its optional diagnostic toolbox`,
      );
    }
    assert.match(text, /只诊断[^\n]{0,40}不(?:实施|修改)/);
    assert.match(text, /仅在用户授权修复后执行/);
    assert.match(text, /不得记录密钥、令牌、个人信息或完整敏感载荷/);
    assert.match(text, /重新运行最初的问题验证路径/);
    assert.match(text, /删除临时日志、脚本和诊断代码/);
    assert.ok(
      !text.includes("superpowers:test-driven-development"),
      "systematic-debugging must not force a chained vendor skill invocation",
    );
  });

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
      /tools:.*Bash/.test(text),
      "test-quality reviewer must be granted Bash to run tests",
    );
    assert.ok(
      text.includes("Running tests — unit only"),
      "test-quality reviewer must scope test execution to unit tests only",
    );
  });

  test("tiered reviewers classify targets before checking", () => {
    const tiers: Array<{ file: string; section: string; anchors: string[] }> = [
      {
        file: "docs-sync.md",
        section: "Document tiers",
        anchors: ["归档快照", "精简或删除"],
      },
      {
        file: "code-quality.md",
        section: "Audience tiers",
        anchors: ["低受众代码", "机制优先"],
      },
      {
        file: "ux.md",
        section: "Surface tiers",
        anchors: ["内部工具 / 临时制品", "自动化承重"],
      },
    ];
    for (const { file, section, anchors } of tiers) {
      const text = read(
        `plugins/auriga-workflow/skills/deep-review/references/reviewers/${file}`,
      );
      assert.ok(
        text.includes(section),
        `${file} must keep its "${section}" tiering section`,
      );
      for (const anchor of anchors) {
        assert.ok(
          text.includes(anchor),
          `${file} tiering rule must keep the "${anchor}" rule anchor`,
        );
      }
      assert.ok(
        text.includes("不是预过滤"),
        `${file} output contract must reconcile tiering with the no-prefilter preamble`,
      );
    }
  });
});

describe("project rule discovery anchors to the repo root", () => {
  const ruleConsumers: Array<{ rel: string; area: string; label: string }> = [
    {
      rel: "plugins/auriga-workflow/skills/deep-review/SKILL.md",
      area: "docs/rules/review/",
      label: "deep-review",
    },
    {
      rel: "plugins/auriga-workflow/skills/test-designer/SKILL.md",
      area: "docs/rules/test/",
      label: "test-designer",
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
      assert.ok(
        /子包级.{0,4}(为准|优先)/.test(text),
        `${rel} must state subpackage-level precedence as one phrase (子包级…为准/优先)`,
      );
      assert.ok(
        /非 git 仓库[^\n]{0,12}回退/.test(text),
        `${rel} must define the non-git-repo fallback to cwd`,
      );
    });
  }

  test("reviewer-creator writes custom reviewers anchored to the repo root", () => {
    const text = read(
      "plugins/auriga-workflow/skills/reviewer-creator/SKILL.md",
    );
    assert.ok(
      text.includes("git rev-parse --show-toplevel"),
      "reviewer-creator must resolve the output directory from the git repo root",
    );
    assert.ok(
      text.includes("|| pwd"),
      "the mkdir command must fall back to cwd when git rev-parse fails (non-git dir would otherwise expand to /docs/rules/review/)",
    );
    assert.ok(
      text.includes("<仓库根>/docs/rules/review/<name>.md"),
      "the write target must be anchored to the repo root",
    );
  });

  test("spec-design consumes project spec rules as clarification input and gate item", () => {
    const text = read("plugins/auriga-workflow/skills/spec-design/SKILL.md");
    assert.ok(
      text.includes("docs/rules/spec/"),
      "spec-design must consult project spec rules under docs/rules/spec/",
    );
    assert.ok(
      /无项目专属 spec 规则/.test(text),
      "spec-design must record explicitly when no project spec rules exist",
    );
  });

  test("session-compound routes categorized lessons to consumer-bound rule directories", () => {
    const text = read(
      "plugins/auriga-workflow/skills/session-compound/SKILL.md",
    );
    for (const dir of [
      "docs/rules/spec/",
      "docs/rules/arch/",
      "docs/rules/test/",
      "docs/rules/review/",
    ]) {
      assert.ok(
        text.includes(dir),
        `session-compound must offer ${dir} as a sedimentation target`,
      );
    }
    assert.ok(
      text.includes("reviewer-creator"),
      "session-compound must route new review dimensions through reviewer-creator instead of free-form files",
    );
    assert.ok(
      /消费方绑定/.test(text),
      "session-compound must explain that consumer-bound directories are auto-discovered by downstream skills",
    );
  });

  test("arch-design consumes project architecture rules as design constraints", () => {
    const text = read("plugins/auriga-workflow/skills/arch-design/SKILL.md");
    assert.ok(
      text.includes("docs/rules/arch/"),
      "arch-design must consult project architecture rules under docs/rules/arch/",
    );
    assert.ok(
      /无项目专属架构规则/.test(text),
      "arch-design must record explicitly when no project architecture rules exist",
    );
  });
});

describe("deep-review custom-reviewer scope overlap", () => {
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
      text.includes("extends"),
      "an explicit extends field, when present, must take precedence",
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
      text.includes("extends: standalone") || text.includes("`standalone`"),
      "SKILL.md must recognize the standalone sentinel value of extends",
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

describe("deep-review dispatch delivery", () => {
  // VAL-DISP-001 — reviewer content is self-read by the subagent via absolute path
  test("reviewer content is delivered by absolute-path self-read, not inlined through the main agent", () => {
    const text = deepReview();
    assert.ok(
      text.includes("绝对路径"),
      "the subagent must receive an absolute path to the reviewer file",
    );
    assert.ok(
      text.includes("自读"),
      "the subagent must self-read the reviewer file in its own context",
    );
  });

  // VAL-DISP-002 — main agent reads only the YAML frontmatter to orchestrate
  test("main agent reads only the frontmatter to orchestrate dispatch", () => {
    const text = deepReview();
    assert.ok(
      text.includes("frontmatter"),
      "orchestration must rely on the YAML frontmatter",
    );
    assert.ok(
      /只读[^]*?frontmatter/.test(text),
      "the main agent must read only the frontmatter for orchestration, not the full body",
    );
  });

  // VAL-DISP-003 — inline fallback documented for sandboxes that cannot resolve the path
  test("an inline fallback is documented for delegates that cannot resolve the path", () => {
    const text = deepReview();
    assert.ok(
      /路径[^]*?内联|内联[^]*?路径|无法解析[^]*?内联/.test(text),
      "a path-unresolvable delegate must fall back to inlining the reviewer body",
    );
  });

  // VAL-DEG-001 — graceful degradation for older reviewers without frontmatter
  test("reviewers without frontmatter fall back to the prose Metadata section", () => {
    const text = deepReview();
    assert.ok(
      /没有 frontmatter|无 frontmatter|缺少 frontmatter|没有 YAML frontmatter/.test(
        text,
      ),
      "SKILL.md must address reviewers that lack YAML frontmatter",
    );
    assert.ok(
      /(降级|回退)[^]*?## Metadata|## Metadata[^]*?(降级|回退)/.test(text),
      "the fallback must read the prose ## Metadata section",
    );
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

  // VAL-CRT-002 — the question flow asks supplement-vs-new-dimension and writes extends
  test("SKILL.md asks supplement-vs-new-dimension and writes extends", () => {
    const text = read(
      "plugins/auriga-workflow/skills/reviewer-creator/SKILL.md",
    );
    assert.ok(
      text.includes("extends"),
      "reviewer-creator must populate the extends field from the answer",
    );
    assert.ok(
      /补充[^]*?独立维度|独立维度[^]*?补充/.test(text),
      "the flow must ask whether the reviewer supplements a built-in or is a new dimension",
    );
    assert.ok(
      !text.includes("不会自动产出"),
      "the stale claim that reviewer-creator never emits extends must be removed",
    );
  });

  // VAL-CRT-003 — the field schema (required vs optional) is documented explicitly
  test("SKILL.md documents the frontmatter field schema with required vs optional", () => {
    const text = read(
      "plugins/auriga-workflow/skills/reviewer-creator/SKILL.md",
    );
    assert.ok(
      /Frontmatter schema|字段 schema|frontmatter 字段/.test(text),
      "must include an explicit frontmatter schema section",
    );
    assert.ok(
      text.includes("必填") && text.includes("可选"),
      "the schema must distinguish required from optional fields",
    );
    assert.ok(
      /可选[^]*?(extends|effort)/.test(text),
      "extends and effort must be documented as optional",
    );
  });
});

describe("built-in reviewer metadata is machine-readable frontmatter", () => {
  const reviewerDir =
    "plugins/auriga-workflow/skills/deep-review/references/reviewers";
  const builtins = [
    "architecture",
    "code-quality",
    "correctness",
    "docs-sync",
    "performance",
    "robustness",
    "security",
    "skill-plugin-quality",
    "spec-conformance",
    "test-quality",
    "ux",
  ];

  for (const name of builtins) {
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
        /^(always|non-trivial|detection-driven|tag:(logic|auth-sensitive|ui|perf|arch))$/.test(
          String(fm.trigger),
        ),
        `${name}.md trigger must be a legal value, got ${String(fm.trigger)}`,
      );
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
