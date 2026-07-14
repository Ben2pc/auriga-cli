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
  test("unified test-driven-development is plugin-bundled and concise", () => {
    const rel = "plugins/auriga-workflow/skills/test-driven-development/SKILL.md";
    const abs = path.join(repoRoot, rel);

    assert.ok(fs.existsSync(abs), `${rel} must exist`);
    const text = read(rel);
    const parsed = matter(text);

    assert.equal(parsed.data.name, "test-driven-development");
    assert.match(parsed.data.description, /功能.*缺陷修复.*重构/);
    assert.match(
      parsed.data.description,
      /纯文档.*纯配置.*生成代码.*没有有效自动化接缝.*不触发/,
      "frontmatter must preserve the exemption semantics",
    );
    for (const anchor of [
      "validation-contract.md",
      "公共接口",
      "失败",
      "最小实现",
      "纵向",
      "系统边界",
      "机器协议",
    ]) {
      assert.ok(text.includes(anchor), `unified TDD must keep the ${anchor} contract`);
    }
    assert.match(text, /每条验收断言[^。\n]*不等于单个验证用例/);
    assert.match(text, /按 `?Tool`? 选择验证方式/);
    assert.match(text, /按风险[^；。\n]*一个或多个必要用例/);
    assert.match(
      text,
      /测试类断言[^。\n]*多个测试用例/,
      "one test-oriented validation assertion may require multiple test cases",
    );
    assert.doesNotMatch(
      text,
      /^## 边界$/m,
      "the unified TDD skill must not carry a separate boundary section",
    );
    assert.ok(
      text.split("\n").length <= 80,
      "the unified TDD skill must stay within an 80-line context budget",
    );
    assert.doesNotMatch(text, /独立测试代理|另派[^。\n]*测试代理|separate test agent/i);
    assert.doesNotMatch(text, /xhigh|最强模型|全新会话|fresh context/i);
    assert.match(
      text,
      /不因[^。\n]{0,30}删除[^。\n]{0,12}(?:实现|代码)|不因[^。\n]{0,20}(?:实现|代码)[^。\n]{0,20}删除/,
      "the skill must reject deleting usable implementation only to restart the ritual",
    );
    assert.doesNotMatch(text, /delete means delete/i);
  });

  test("auriga-workflow publishes the exact owned skill inventory", () => {
    const skillsRoot = path.join(repoRoot, "plugins/auriga-workflow/skills");
    const actual = fs.readdirSync(skillsRoot)
      .filter((name) => fs.existsSync(path.join(skillsRoot, name, "SKILL.md")))
      .sort();
    assert.deepEqual(actual, [
      "arch-design",
      "code-simplify",
      "deep-review",
      "docent",
      "documentation-and-adrs",
      "git-workflow",
      "goalify",
      "incremental-impl",
      "reviewer-creator",
      "session-compound",
      "spec-design",
      "systematic-debugging",
      "test-driven-development",
    ]);
    assert.equal(fs.existsSync(path.join(repoRoot, ".agents/skills/test-driven-development")), false);
    assert.equal(fs.existsSync(path.join(repoRoot, ".claude/skills/test-driven-development")), false);
  });

  test("active workflow surfaces omit retired entries and default test-agent behavior", () => {
    for (const rel of [
      "AGENTS.md",
      "AGENTS.template.zh-CN.md",
      "AGENTS.template.en.md",
      "plugins/auriga-workflow/skills/arch-design/SKILL.md",
      "plugins/auriga-workflow/skills/code-simplify/SKILL.md",
      "plugins/auriga-workflow/skills/deep-review/SKILL.md",
      "plugins/auriga-workflow/skills/incremental-impl/SKILL.md",
      "plugins/auriga-workflow/skills/session-compound/SKILL.md",
      "plugins/auriga-workflow/skills/session-compound/references/eval-dispatch.md",
      "plugins/auriga-workflow/skills/spec-design/SKILL.md",
      "plugins/auriga-workflow/skills/spec-design/references/validation-contract-template.md",
      "plugins/auriga-workflow/skills/test-driven-development/SKILL.md",
      "plugins/auriga-workflow/skills/deep-review/references/reviewers/test-quality.md",
    ]) {
      const text = read(rel);
      assert.doesNotMatch(text, /test-designer/, `${rel} must not reference the retired skill`);
      assert.doesNotMatch(
        text,
        /不另派[^。\n]*测试|不再派遣[^。\n]*测试|当前(?:实现)?代理[^。\n]*(?:测试|失败证据|保护网|建立证据)|实现代理[^。\n]*(?:测试设计|红绿循环|运行器|驱动)|current (?:implementation )?agent[^.\n]*test|separate test agent/i,
        `${rel} must not spend context restating default test-agent behavior`,
      );
    }
  });

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

  test("arch-design triggers for architecture and domain-model clarification", () => {
    const text = read("plugins/auriga-workflow/skills/arch-design/SKILL.md");
    const parsed = matter(text);

    assert.match(parsed.data.description, /(?:架构优化|优化[^。；]*架构)/);
    assert.match(parsed.data.description, /领域模型|领域建模/);
    assert.match(text, /技术方案澄清/);
    assert.match(text, /模块内部[^。\n]*(?:code-simplify|代码简化)/);

    for (const trigger of ["新功能", "职责", "边界", "分层", "依赖", "架构演进"]) {
      assert.ok(
        parsed.data.description.includes(trigger),
        `arch-design description must cover the ${trigger} trigger`,
      );
    }

    for (const rel of ["AGENTS.md", "AGENTS.template.zh-CN.md", "AGENTS.template.en.md"]) {
      const template = read(rel);
      assert.match(template, /v1\.17\.0/);
      assert.match(
        template,
        /领域模型|domain model/i,
        `${rel} must route domain-model clarification to arch-design`,
      );
      assert.match(
        template,
        /(?:快速流程|quick flow)[^\n]*(?:只跳过实施计划|skips only implementation planning)/i,
        `${rel} must not let the quick flow bypass architecture clarification`,
      );
    }
  });

  test("arch-design separates behavior, technical design, and execution planning", () => {
    const text = read("plugins/auriga-workflow/skills/arch-design/SKILL.md");

    for (const anchor of [
      "用户可观察",
      "领域概念",
      "模块边界",
      "依赖方向",
      "关键接口",
      "数据流",
      "实施步骤",
    ]) {
      assert.ok(text.includes(anchor), `arch-design must keep the ${anchor} boundary`);
    }
    assert.match(text, /产品语义[^。\n]*(?:spec-design|需求规格)/);
    assert.match(text, /本技能不写实施步骤、切片顺序/);
  });

  test("arch-design makes its design document an implementation-entry review gate", () => {
    const text = read("plugins/auriga-workflow/skills/arch-design/SKILL.md");
    const template = read(
      "plugins/auriga-workflow/skills/arch-design/references/arch-design-template.md",
    );

    assert.match(text, /实质[^。\n]*(?:架构|领域模型|跨边界)[^。\n]*arch_design\.md/);
    assert.match(text, /实现前[^。\n]*用户[^。\n]*(?:确认|评审)/);
    assert.match(text, /不能把沉默当作批准/);
    assert.match(text, /设计文档或对话内已确认的设计/);
    assert.match(template, /Review Focus \/ 人工评审重点/);
    assert.match(template, /Domain Model \/ 领域模型/);
    for (const field of ["评审状态", "核心决定", "主要影响", "首要风险", "Human Decisions"]) {
      assert.ok(template.includes(field), `arch-design template must preserve ${field}`);
    }
  });

  test("arch-design template makes current and target architecture easy to compare", () => {
    const template = read(
      "plugins/auriga-workflow/skills/arch-design/references/arch-design-template.md",
    );

    for (const section of [
      "Current Architecture / 当前架构现状",
      "Current Directory Structure / 当前目录结构",
      "Target Architecture / 目标整体架构",
      "Target Directory Structure / 目标目录结构",
    ]) {
      assert.ok(template.includes(section), `arch-design template must preserve ${section}`);
    }
    assert.match(template, /同一抽象层级/);
    assert.match(template, /改变前后|前后对照/);
    assert.ok(template.includes("（新增）"), "target directory tree must mark added paths");
    assert.ok(template.includes("（改）"), "target directory tree must mark changed paths");
    for (const diagram of ["C4", "sequenceDiagram", "stateDiagram-v2", "erDiagram", "classDiagram"]) {
      assert.ok(template.includes(diagram), `arch-design template must cue ${diagram}`);
    }
  });

  test("arch-design resolves target-local rules and degrades safely without a writable project", () => {
    const text = read("plugins/auriga-workflow/skills/arch-design/SKILL.md");

    assert.match(text, /受影响代码[^。\n]*更近的 `docs\/rules\/arch\/`/);
    assert.match(text, /目标范围[^。\n]*(?:确认|澄清)/);
    assert.match(text, /无法写入[^。\n]*(?:对话|会话)/);
  });

  test("arch-design routes design conditions to a compact reference toolbox", () => {
    const text = read("plugins/auriga-workflow/skills/arch-design/SKILL.md");
    const references = [
      "component-design.md",
      "interface-design.md",
      "domain-modeling.md",
      "migration-strategies.md",
    ];

    for (const file of references) {
      const rel = `plugins/auriga-workflow/skills/arch-design/references/${file}`;
      assert.ok(fs.existsSync(path.join(repoRoot, rel)), `${rel} must exist`);
      assert.ok(text.includes(`references/${file}`), `${file} must have a routing condition`);
      const reference = read(rel);
      assert.match(reference, /何时使用/);
      assert.match(reference, /可用方法|可用兵器/);
    }
  });

  test("arch-design removes presentation detours and synthetic option generation", () => {
    const text = read("plugins/auriga-workflow/skills/arch-design/SKILL.md");
    const template = read(
      "plugins/auriga-workflow/skills/arch-design/references/arch-design-template.md",
    );

    for (const content of [text, template]) {
      assert.doesNotMatch(content, /playground|静态 HTML|arch-overview\.html/i);
      assert.doesNotMatch(content, /(?:≥|>=)\s*2[^。\n]*候选|出[^。\n]*(?:≥|>=)\s*2/);
    }
    assert.match(text, /真实[^。\n]*取舍[^。\n]*候选/);
    assert.match(template, /仅在存在真实取舍时保留本节/);
  });

  test("arch-design migration handoff preserves transition exit conditions", () => {
    const template = read(
      "plugins/auriga-workflow/skills/arch-design/references/arch-design-template.md",
    );
    const migration = read(
      "plugins/auriga-workflow/skills/arch-design/references/migration-strategies.md",
    );

    for (const field of ["中间状态", "兼容窗口", "切换信号", "旧路径删除条件", "负责人"]) {
      assert.ok(template.includes(field), `arch-design template must preserve ${field}`);
      assert.match(
        migration.match(/## 输出到设计文档[\s\S]*/)![0],
        new RegExp(field),
        `migration output mapping must preserve ${field}`,
      );
    }
  });

  test("architecture consumers honor the approved design boundary", () => {
    const specDesign = read("plugins/auriga-workflow/skills/spec-design/SKILL.md");
    const incremental = read("plugins/auriga-workflow/skills/incremental-impl/SKILL.md");
    const handoff = specDesign.match(/\*\*D3\. 交接。\*\*[\s\S]*?## 用户自带 spec 审计/);

    assert.ok(handoff, "spec-design must preserve its D3 handoff section");
    assert.match(handoff[0], /arch-design[^。\n]*人工确认/);
    assert.match(incremental, /已确认[^。\n]*arch_design\.md[^。\n]*(?:优先|约束)/);
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
      /test-driven-development/.test(text),
      "test-quality reviewer must stay aligned with test-driven-development",
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
