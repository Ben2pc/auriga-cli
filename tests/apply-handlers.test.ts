// tests/apply-handlers.test.ts
//
// Verifies that buildDefaultApplyHandlers dispatches correctly across the
// two actions (install / uninstall) and the five categories (workflow,
// skill, recommended-skill, plugin, preset).
// We mock the installer modules at the loader level so this test doesn't
// touch the network or filesystem. The `preset` handler is NOT mocked —
// it runs the real installPreset orchestration, whose dynamic imports
// resolve to the same mocked installer modules.
//
// Deep filesystem integration (apply 3 items → real side effects) is
// deferred to the M5 Playwright e2e where a hermetic HOME redirect is in
// place; this test guards dispatch shape only.

import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";

afterEach(() => {
  mock.restoreAll();
});

let importSerial = 0;

interface CallLog {
  installWorkflow: Array<{ packageRoot: string; opts: unknown }>;
  uninstallWorkflow: Array<{ opts: unknown }>;
  installSkills: Array<{ packageRoot: string; opts: unknown }>;
  installRecommendedSkills: Array<{ packageRoot: string; opts: unknown }>;
  uninstallSkill: Array<{ name: string; opts: unknown }>;
  installPlugins: Array<{ packageRoot: string; opts: unknown }>;
  installPluginsImpl?: (packageRoot: string, opts: unknown) => Promise<void>;
  installWorkflowImpl?: (packageRoot: string, opts: unknown) => Promise<void>;
  installSkillsImpl?: (packageRoot: string, opts: unknown) => Promise<void>;
  uninstallPlugin: Array<{ id: string; agent: string; opts: unknown }>;
  uninstallPluginImpl?: (id: string, agent: string, opts: unknown) => Promise<void>;
  /** Cross-installer call order — lets a test assert the preset's
   *  workflow → skills → plugins sequencing across separate mocks. */
  order: string[];
}

function makeCallLog(): CallLog {
  return {
    installWorkflow: [],
    uninstallWorkflow: [],
    installSkills: [],
    installRecommendedSkills: [],
    uninstallSkill: [],
    installPlugins: [],
    uninstallPlugin: [],
    order: [],
  };
}

async function importAdapter(calls: CallLog): Promise<typeof import("../src/apply-handlers.js")> {
  mock.module(new URL("../src/workflow.js", import.meta.url), {
    namedExports: {
      installWorkflow: async (packageRoot: string, opts: unknown) => {
        calls.installWorkflow.push({ packageRoot, opts });
        calls.order.push("workflow");
        if (calls.installWorkflowImpl) {
          await calls.installWorkflowImpl(packageRoot, opts);
        }
      },
      uninstallWorkflow: async (opts: unknown) => {
        calls.uninstallWorkflow.push({ opts });
      },
    },
  });
  mock.module(new URL("../src/skills.js", import.meta.url), {
    namedExports: {
      installSkills: async (packageRoot: string, opts: unknown) => {
        calls.installSkills.push({ packageRoot, opts });
        calls.order.push("skills");
        if (calls.installSkillsImpl) {
          await calls.installSkillsImpl(packageRoot, opts);
        }
      },
      installRecommendedSkills: async (packageRoot: string, opts: unknown) => {
        calls.installRecommendedSkills.push({ packageRoot, opts });
      },
      uninstallSkill: async (name: string, opts: unknown) => {
        calls.uninstallSkill.push({ name, opts });
      },
    },
  });
  mock.module(new URL("../src/plugins.js", import.meta.url), {
    namedExports: {
      installPlugins: async (packageRoot: string, opts: unknown) => {
        calls.installPlugins.push({ packageRoot, opts });
        calls.order.push("plugins");
        if (calls.installPluginsImpl) {
          await calls.installPluginsImpl(packageRoot, opts);
        }
      },
      uninstallPlugin: async (id: string, agent: string, opts: unknown) => {
        calls.uninstallPlugin.push({ id, agent, opts });
        if (calls.uninstallPluginImpl) {
          await calls.uninstallPluginImpl(id, agent, opts);
        }
      },
    },
  });
  // Cache-bust so each test gets a fresh module instance with its mocks.
  return await import(
    new URL(`../src/apply-handlers.js?case=${importSerial++}`, import.meta.url).href
  );
}

function noopLog(): { onLog: (line: string, level: "info" | "warn" | "error") => void } {
  return { onLog: () => {} };
}

describe("buildDefaultApplyHandlers — workflow", () => {
  test("install → calls installWorkflow with lang + cwd", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map(),
    });
    await handlers.workflow("install", "default-workflow", noopLog());
    assert.equal(calls.installWorkflow.length, 1);
    const opts = calls.installWorkflow[0].opts as {
      interactive: boolean;
      cwd: string;
      lang: string;
    };
    assert.equal(opts.interactive, false);
    assert.equal(opts.cwd, "/proj");
    assert.equal(opts.lang, "zh-CN");
    assert.equal(calls.uninstallWorkflow.length, 0);
  });

  test("uninstall → calls uninstallWorkflow with force=true", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map(),
    });
    await handlers.workflow("uninstall", "default-workflow", noopLog());
    assert.equal(calls.uninstallWorkflow.length, 1);
    const opts = calls.uninstallWorkflow[0].opts as { force: boolean; cwd: string };
    assert.equal(opts.force, true);
    assert.equal(opts.cwd, "/proj");
  });
});

describe("buildDefaultApplyHandlers — skill (workflow set)", () => {
  test("install → calls installSkills with selected:[name]", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map(),
    });
    await handlers.skill("install", "systematic-debugging", noopLog());
    assert.equal(calls.installSkills.length, 1);
    const opts = calls.installSkills[0].opts as { selected: string[] };
    assert.deepEqual(opts.selected, ["systematic-debugging"]);
    assert.equal(calls.installRecommendedSkills.length, 0);
  });

  test("uninstall → calls uninstallSkill by name", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map(),
    });
    await handlers.skill("uninstall", "systematic-debugging", noopLog());
    assert.equal(calls.uninstallSkill.length, 1);
    assert.equal(calls.uninstallSkill[0].name, "systematic-debugging");
  });
});

describe("buildDefaultApplyHandlers — recommended-skill", () => {
  test("install → calls installRecommendedSkills (not installSkills)", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map(),
    });
    await handlers["recommended-skill"]("install", "frontend-design", noopLog());
    assert.equal(calls.installRecommendedSkills.length, 1);
    assert.equal(calls.installSkills.length, 0);
    const opts = calls.installRecommendedSkills[0].opts as { selected: string[] };
    assert.deepEqual(opts.selected, ["frontend-design"]);
  });

  test("uninstall → routes to uninstallSkill (shared store)", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map(),
    });
    await handlers["recommended-skill"]("uninstall", "frontend-design", noopLog());
    assert.equal(calls.uninstallSkill.length, 1);
    assert.equal(calls.uninstallSkill[0].name, "frontend-design");
  });
});

describe("buildDefaultApplyHandlers — plugin", () => {
  test("install → uses single-agent list from pluginAgentsByName (codex)", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map([
        ["session-instructions-loader", ["codex"]],
      ]),
    });
    await handlers.plugin(
      "install",
      "session-instructions-loader",
      noopLog(),
    );
    assert.equal(calls.installPlugins.length, 1);
    const opts = calls.installPlugins[0].opts as {
      agent: string;
      selected: string[];
    };
    assert.equal(opts.agent, "codex");
    assert.deepEqual(opts.selected, ["session-instructions-loader"]);
  });

  test("install → unmapped plugin defaults to claude", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map(),
    });
    await handlers.plugin("install", "unknown-plugin", noopLog());
    assert.equal(calls.installPlugins.length, 1);
    const opts = calls.installPlugins[0].opts as { agent: string };
    assert.equal(opts.agent, "claude");
  });

  test("install → dual-Agent plugin installs to both agents in order", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map([["auriga-go", ["claude", "codex"]]]),
    });
    await handlers.plugin("install", "auriga-go", noopLog());
    assert.equal(calls.installPlugins.length, 2);
    assert.equal(
      (calls.installPlugins[0].opts as { agent: string }).agent,
      "claude",
    );
    assert.equal(
      (calls.installPlugins[1].opts as { agent: string }).agent,
      "codex",
    );
  });

  test("uninstall → calls uninstallPlugin with looked-up agent", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map([["deep-review", ["claude"]]]),
    });
    await handlers.plugin("uninstall", "deep-review", noopLog());
    assert.equal(calls.uninstallPlugin.length, 1);
    assert.equal(calls.uninstallPlugin[0].id, "deep-review");
    assert.equal(calls.uninstallPlugin[0].agent, "claude");
  });

  test("uninstall → dual-Agent plugin uninstalls from both agents in order", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map([["auriga-go", ["claude", "codex"]]]),
    });
    await handlers.plugin("uninstall", "auriga-go", noopLog());
    assert.equal(calls.uninstallPlugin.length, 2);
    assert.equal(calls.uninstallPlugin[0].agent, "claude");
    assert.equal(calls.uninstallPlugin[1].agent, "codex");
  });
});

describe("buildDefaultApplyHandlers — scope forwarding on uninstall", () => {
  test("skill uninstall forwards scope:'user' to uninstallSkill", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map(),
    });
    await handlers.skill("uninstall", "systematic-debugging", {
      onLog: () => {},
      scope: "user",
    });
    assert.equal(calls.uninstallSkill.length, 1);
    const opts = calls.uninstallSkill[0].opts as { scope?: string };
    assert.equal(opts.scope, "user");
  });

  test("recommended-skill uninstall forwards scope:'user' to uninstallSkill", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map(),
    });
    await handlers["recommended-skill"]("uninstall", "frontend-design", {
      onLog: () => {},
      scope: "user",
    });
    assert.equal(calls.uninstallSkill.length, 1);
    const opts = calls.uninstallSkill[0].opts as { scope?: string };
    assert.equal(opts.scope, "user");
  });
});

describe("buildDefaultApplyHandlers — dual-Agent plugin isolation", () => {
  test("install: claude fails → codex still attempted, error aggregates both", async () => {
    const calls = makeCallLog();
    // Fail Claude install but succeed Codex install. The handler must:
    //  - call installPlugins for both agents (don't short-circuit on Claude)
    //  - emit onLog lines for both agent outcomes
    //  - throw at the end so the SSE marks the item failed (with Claude error in the message)
    calls.installPluginsImpl = async (_pkg, opts) => {
      if ((opts as { agent: string }).agent === "claude") {
        throw new Error("boom-claude");
      }
    };

    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map([["auriga-go", ["claude", "codex"]]]),
    });

    const logs: string[] = [];
    await assert.rejects(
      () =>
        handlers.plugin("install", "auriga-go", {
          onLog: (l) => logs.push(l),
        }),
      /boom-claude/,
    );

    // Both agents were attempted — isolation prevented claude failure from
    // skipping codex
    assert.equal(calls.installPlugins.length, 2);
    assert.equal((calls.installPlugins[0].opts as { agent: string }).agent, "claude");
    assert.equal((calls.installPlugins[1].opts as { agent: string }).agent, "codex");

    // onLog records both outcomes
    assert.ok(
      logs.some((l) => /claude/i.test(l) && /(fail|error|boom)/i.test(l)),
      `missing claude failure log: ${logs.join(" | ")}`,
    );
    assert.ok(
      logs.some((l) => /codex/i.test(l) && /install/i.test(l)),
      `missing codex success log: ${logs.join(" | ")}`,
    );
  });

  test("uninstall: claude fails → codex still attempted, error aggregates both", async () => {
    const calls = makeCallLog();
    calls.uninstallPluginImpl = async (_id, agent) => {
      if (agent === "claude") throw new Error("boom-claude");
    };

    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map([["auriga-go", ["claude", "codex"]]]),
    });

    await assert.rejects(
      () =>
        handlers.plugin("uninstall", "auriga-go", { onLog: () => {} }),
      /boom-claude/,
    );

    assert.equal(calls.uninstallPlugin.length, 2);
    assert.equal(calls.uninstallPlugin[0].agent, "claude");
    assert.equal(calls.uninstallPlugin[1].agent, "codex");
  });
});

describe("buildDefaultApplyHandlers — preset", () => {
  // The preset handler is the thinnest possible wrapper over installPreset;
  // installPreset itself is NOT mocked here, so these tests exercise the
  // real workflow → skills → plugins orchestration end-to-end with only the
  // three leaf installers stubbed.
  test("install → drives installPreset across workflow / skills / plugins in order", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map(),
    });
    await handlers.preset("install", "preset", noopLog());
    assert.equal(calls.installWorkflow.length, 1);
    assert.equal(calls.installSkills.length, 1);
    assert.equal(calls.installPlugins.length, 1);
    assert.equal(calls.installRecommendedSkills.length, 0);
    assert.deepEqual(calls.order, ["workflow", "skills", "plugins"]);
    // plugins step pins the install surface to auriga-workflow only.
    const pluginOpts = calls.installPlugins[0].opts as { selected: string[] };
    assert.deepEqual(pluginOpts.selected, ["auriga-workflow"]);
  });

  test("install → omitted scope/agent/lang fall back to preset defaults (user/both/zh-CN)", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map(),
    });
    await handlers.preset("install", "preset", noopLog());
    const wf = calls.installWorkflow[0].opts as { lang: string };
    const sk = calls.installSkills[0].opts as { scope: string; agent: string };
    assert.equal(wf.lang, "zh-CN");
    assert.equal(sk.scope, "user");
    assert.equal(sk.agent, "both");
  });

  test("install → explicit scope/agent/lang are forwarded to the installers", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map(),
    });
    await handlers.preset("install", "preset", {
      onLog: () => {},
      scope: "project",
      agent: "codex",
      lang: "zh-CN",
    });
    const wf = calls.installWorkflow[0].opts as { lang: string };
    const pl = calls.installPlugins[0].opts as { scope: string; agent: string };
    assert.equal(wf.lang, "zh-CN");
    assert.equal(pl.scope, "project");
    assert.equal(pl.agent, "codex");
  });

  test("uninstall → rejected (preset is install-only)", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map(),
    });
    await assert.rejects(
      () => handlers.preset("uninstall", "preset", noopLog()),
      /preset only supports the install action/i,
    );
    // Nothing should have been installed.
    assert.equal(calls.order.length, 0);
  });

  test("a failing step → later steps still run, handler throws naming the failed step", async () => {
    const calls = makeCallLog();
    // skills step fails — workflow (before) and plugins (after) must still run.
    calls.installSkillsImpl = async () => {
      throw new Error("skills boom");
    };
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map(),
    });
    const logs: string[] = [];
    await assert.rejects(
      () =>
        handlers.preset("install", "preset", {
          onLog: (l) => logs.push(l),
        }),
      /preset install failed.*skills/i,
    );
    // log-and-continue: a mid-sequence failure does not abort the rest.
    assert.deepEqual(calls.order, ["workflow", "skills", "plugins"]);
    assert.ok(
      logs.some((l) => /skills/i.test(l) && /fail/i.test(l)),
      `missing skills failure log: ${logs.join(" | ")}`,
    );
  });
});

describe("buildDefaultApplyHandlers — handler logging", () => {
  test("install handlers emit at least one onLog line", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map(),
    });
    const seen: string[] = [];
    const onLog = (line: string): void => {
      seen.push(line);
    };
    await handlers.workflow("install", "default-workflow", { onLog });
    await handlers.skill("install", "systematic-debugging", { onLog });
    await handlers.plugin("install", "deep-review", { onLog });
    assert.ok(seen.length >= 3, `expected ≥3 log lines, got ${seen.length}`);
  });
});
