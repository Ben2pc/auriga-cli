import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseArgs } from "../src/cli.js";

function installArgs(argv: string[]) {
  return parseArgs(["install", ...argv]);
}

function expectParseError(argv: string[], pattern: RegExp): void {
  assert.throws(() => parseArgs(argv), pattern);
}

// Covers spec §3.2 legal CLI forms and §5.2 ParsedArgs command contract.
describe("parseArgs", () => {
  // Covers spec §5.2 top-level command parsing and bare install dispatch.
  test("parses top-level verbs and the canonical install entry shapes", () => {
    assert.deepEqual(parseArgs(["--help"]), { command: "help" });
    assert.deepEqual(parseArgs(["-h"]), { command: "help" });
    assert.deepEqual(parseArgs(["--version"]), { command: "version" });
    assert.deepEqual(parseArgs(["-v"]), { command: "version" });
    assert.deepEqual(parseArgs(["guide"]), { command: "guide" });
    // Bare `npx auriga-cli` (no args) must dispatch to the install bare
    // form, NOT to help — the TTY path serves the legacy checkbox menu
    // and the non-TTY path emits the "requires a TTY" hint. Routing it to
    // help would strand users running the documented entrypoint without
    // an install path. See PR #31 codex review.
    assert.deepEqual(parseArgs([]), {
      command: "install",
      install: { all: false },
    });
    assert.deepEqual(installArgs([]), {
      command: "install",
      install: { all: false },
    });
    assert.deepEqual(installArgs(["--all", "--scope", "user"]), {
      command: "install",
      install: { all: true, scope: "user" },
    });
  });

  // Covers spec §3.2 type-specific forms, §3.5 rules 2/5/6/7, and §5.2 option plumbing.
  test("parses category-specific options and preserves valid filters", () => {
    assert.deepEqual(installArgs(["workflow", "--lang", "zh-CN", "--cwd", process.cwd()]), {
      command: "install",
      install: {
        all: false,
        type: "workflow",
        lang: "zh-CN",
        cwd: process.cwd(),
      },
    });
    assert.deepEqual(installArgs(["skills", "--scope", "user", "--skill", "brainstorming", "test-driven-development"]), {
      command: "install",
      install: {
        all: false,
        type: "skills",
        scope: "user",
        filter: ["brainstorming", "test-driven-development"],
      },
    });
    assert.deepEqual(installArgs(["recommended", "--recommended-skill", "codex-agent"]), {
      command: "install",
      install: {
        all: false,
        type: "recommended",
        filter: ["codex-agent"],
      },
    });
    assert.deepEqual(installArgs(["plugins", "--scope", "user", "--plugin", "auriga-go"]), {
      command: "install",
      install: {
        all: false,
        type: "plugins",
        scope: "user",
        filter: ["auriga-go"],
      },
    });
    assert.deepEqual(installArgs(["hooks", "--hook", "notify", "pr-ready-guard"]), {
      command: "install",
      install: {
        all: false,
        type: "hooks",
        filter: ["notify", "pr-ready-guard"],
      },
    });
  });

  // Covers spec §5.2 filter nargs terminator rules and the explicit `--` edge case.
  test("stops filter nargs at the next flag or explicit terminator", () => {
    assert.deepEqual(installArgs(["skills", "--skill", "brainstorming", "systematic-debugging", "--scope", "user"]), {
      command: "install",
      install: {
        all: false,
        type: "skills",
        filter: ["brainstorming", "systematic-debugging"],
        scope: "user",
      },
    });
    expectParseError(
      ["install", "skills", "--skill", "brainstorming", "--", "systematic-debugging"],
      /install takes one <type> at a time/i,
    );
  });

  // Covers spec §3.5 rules 1-8 and §7 exact parse-stage fail-fast messages.
  test("fail-fasts on illegal combinations, mismatched filters, and top-level misuse", () => {
    expectParseError(["install", "workflow", "skills"], /install takes one <type> at a time/i);
    expectParseError(["install", "--all", "recommended"], /--all is atomic; no extra types or filters/i);
    expectParseError(["install", "--all", "--skill", "brainstorming"], /--all is atomic; no extra types or filters/i);
    expectParseError(["install", "workflow", "--skill", "brainstorming"], /--skill requires 'install skills'/i);
    expectParseError(["install", "--recommended-skill", "codex-agent"], /--recommended-skill requires 'install recommended'/i);
    expectParseError(["install", "workflow", "--plugin", "auriga-go"], /--plugin requires 'install plugins'/i);
    expectParseError(["install", "workflow", "--hook", "notify"], /--hook requires 'install hooks'/i);
    expectParseError(["install", "skills", "--lang", "en"], /--lang\/--cwd only apply to workflow/i);
    expectParseError(["install", "workflow", "--scope", "user"], /--scope does not apply to workflow/i);
    expectParseError(["--all"], /--help/i);
    expectParseError(["foo"], /--help/i);
  });

  // Hooks now accept --scope in non-interactive mode (default: project).
  // The TTY menu is the only surface that exposes project-local.
  test("accepts --scope on install hooks (default: project)", () => {
    assert.deepEqual(installArgs(["hooks", "--scope", "user", "--hook", "notify"]), {
      command: "install",
      install: { all: false, type: "hooks", scope: "user", filter: ["notify"] },
    });
    assert.deepEqual(installArgs(["hooks", "--scope", "project"]), {
      command: "install",
      install: { all: false, type: "hooks", scope: "project" },
    });
    expectParseError(["install", "hooks", "--scope", "project-local"], /scope/i);
  });

  // Per-type --help / -h short-circuits install parsing and returns
  // `{ command: "help", helpType }` so main() can render renderTypeHelp.
  test("install <type> --help routes to per-type help", () => {
    for (const type of ["workflow", "skills", "recommended", "plugins", "hooks"] as const) {
      assert.deepEqual(parseArgs(["install", type, "--help"]), { command: "help", helpType: type });
      assert.deepEqual(parseArgs(["install", type, "-h"]), { command: "help", helpType: type });
    }
    // `install --help` (no type) falls back to top-level help.
    assert.deepEqual(parseArgs(["install", "--help"]), { command: "help" });
    assert.deepEqual(parseArgs(["install", "-h"]), { command: "help" });
  });

  // Covers spec §7 catalog-backed validation, strict value validation, and guide arity fail-fast.
  test("validates names, language, scope, cwd, and guide arity", () => {
    expectParseError(["install", "skills", "--skill", "foo"], /unknown skill 'foo'; available: .*brainstorming/i);
    expectParseError(["install", "recommended", "--recommended-skill", "foo"], /available: .*codex-agent/i);
    expectParseError(["install", "plugins", "--plugin", "foo"], /available: .*auriga-go/i);
    expectParseError(["install", "hooks", "--hook", "foo"], /available: .*notify/i);
    expectParseError(["install", "workflow", "--lang", "xx"], /en.*zh-CN|zh-CN.*en/i);
    expectParseError(["install", "plugins", "--scope", "team"], /scope/i);
    expectParseError(["install", "workflow", "--cwd", "/definitely/not/here"], /cwd|directory|exist/i);
    expectParseError(["guide", "foo"], /guide/i);
  });

  // Covers Opus review finding #1 — `t in TYPE_FOR_FILTER` walked the
  // prototype chain, so `install toString` / `install constructor`
  // would falsely enter the filter-flag branch and surface a confusing
  // "--toString requires 'install …'" error. Object.hasOwn fixes it.
  test("rejects Object.prototype keys as install tokens via the generic unknown-arg path", () => {
    for (const poison of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      expectParseError(["install", poison], /unknown argument/i);
    }
  });

  // `guide --help` / `guide -h` routes to top-level help (universal
  // affordance). Anything else after `guide` still fail-fasts per §3.6.
  test("guide --help and guide -h route to top-level help", () => {
    assert.deepEqual(parseArgs(["guide", "--help"]), { command: "help" });
    assert.deepEqual(parseArgs(["guide", "-h"]), { command: "help" });
    expectParseError(["guide", "foo"], /guide/i);
    expectParseError(["guide", "--lang", "en"], /guide/i);
  });

  // Single-value flags accept both `--flag value` and `--flag=value`
  // (node util.parseArgs / GNU convention). Multi-value filter flags
  // are intentionally space-form only — `--skill=a b c` is ambiguous.
  test("single-value flags accept --flag=value equals form", () => {
    assert.deepEqual(installArgs(["workflow", "--lang=zh-CN", "--cwd=" + process.cwd()]), {
      command: "install",
      install: { all: false, type: "workflow", lang: "zh-CN", cwd: process.cwd() },
    });
    assert.deepEqual(installArgs(["skills", "--scope=user", "--skill", "brainstorming"]), {
      command: "install",
      install: { all: false, type: "skills", scope: "user", filter: ["brainstorming"] },
    });
    expectParseError(["install", "workflow", "--lang="], /--lang requires a value/i);
    expectParseError(["install", "plugins", "--scope="], /--scope requires a value/i);
  });

  // Covers empty-value and missing-value fail-fast (Phase 7 triage: deep-review edge-cases findings).
  test("rejects empty or missing values for flags and filters", () => {
    expectParseError(["install", "workflow", "--lang"], /--lang requires a value/i);
    expectParseError(["install", "workflow", "--cwd"], /--cwd requires a value/i);
    expectParseError(["install", "plugins", "--scope"], /--scope requires a value/i);
    expectParseError(
      ["install", "skills", "--skill", "--scope", "user"],
      /--skill requires at least one name/i,
    );
    expectParseError(["install", "plugins", "--plugin"], /--plugin requires at least one name/i);
  });

  // Covers codex deep-review finding #3: a repeated filter flag silently
  // overwrote earlier values, which is surprising and arguably a rule-1
  // ("one --skill list per install") violation. Fail-fast with a clear
  // message so the user sees the intent mismatch up front.
  test("rejects a repeated filter flag on the same install line", () => {
    expectParseError(
      ["install", "skills", "--skill", "a", "--skill", "b"],
      /--skill .* already (set|given)|repeated.*--skill/i,
    );
    expectParseError(
      ["install", "plugins", "--plugin", "a", "--plugin", "b"],
      /--plugin .* already (set|given)|repeated.*--plugin/i,
    );
  });
});
