// tests/apply-handlers.test.ts
//
// Verifies that buildDefaultApplyHandlers dispatches correctly across the
// three actions (install / update / uninstall) and the five categories.
// We mock the installer modules at the loader level so this test doesn't
// touch the network or filesystem.
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
  uninstallPlugin: Array<{ id: string; agent: string; opts: unknown }>;
  installHook: Array<{ hook: unknown; scope: string; cwd: string; packageRoot: string }>;
  uninstallHook: Array<{ name: string; opts: unknown }>;
  loadHooksConfig: Array<{ packageRoot: string }>;
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
    installHook: [],
    uninstallHook: [],
    loadHooksConfig: [],
  };
}

async function importAdapter(calls: CallLog, hookDefs: Array<{ name: string }> = [{ name: "notify" }]): Promise<typeof import("../src/apply-handlers.js")> {
  mock.module(new URL("../src/workflow.js", import.meta.url), {
    namedExports: {
      installWorkflow: async (packageRoot: string, opts: unknown) => {
        calls.installWorkflow.push({ packageRoot, opts });
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
      },
      uninstallPlugin: async (id: string, agent: string, opts: unknown) => {
        calls.uninstallPlugin.push({ id, agent, opts });
      },
    },
  });
  mock.module(new URL("../src/hooks.js", import.meta.url), {
    namedExports: {
      installHook: async (
        hook: unknown,
        scope: string,
        cwd: string,
        packageRoot: string,
      ) => {
        calls.installHook.push({ hook, scope, cwd, packageRoot });
      },
      uninstallHook: async (name: string, opts: unknown) => {
        calls.uninstallHook.push({ name, opts });
      },
      loadHooksConfig: (packageRoot: string) => {
        calls.loadHooksConfig.push({ packageRoot });
        return { hooks: hookDefs };
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
    assert.equal(opts.lang, "en");
    assert.equal(calls.uninstallWorkflow.length, 0);
  });

  test("update → also calls installWorkflow (idempotent reinstall)", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map(),
    });
    await handlers.workflow("update", "default-workflow", noopLog());
    assert.equal(calls.installWorkflow.length, 1);
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
    await handlers.skill("install", "brainstorming", noopLog());
    assert.equal(calls.installSkills.length, 1);
    const opts = calls.installSkills[0].opts as { selected: string[] };
    assert.deepEqual(opts.selected, ["brainstorming"]);
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
    await handlers.skill("uninstall", "brainstorming", noopLog());
    assert.equal(calls.uninstallSkill.length, 1);
    assert.equal(calls.uninstallSkill[0].name, "brainstorming");
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
    await handlers["recommended-skill"]("install", "codex-agent", noopLog());
    assert.equal(calls.installRecommendedSkills.length, 1);
    assert.equal(calls.installSkills.length, 0);
    const opts = calls.installRecommendedSkills[0].opts as { selected: string[] };
    assert.deepEqual(opts.selected, ["codex-agent"]);
  });

  test("uninstall → routes to uninstallSkill (shared store)", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map(),
    });
    await handlers["recommended-skill"]("uninstall", "codex-agent", noopLog());
    assert.equal(calls.uninstallSkill.length, 1);
    assert.equal(calls.uninstallSkill[0].name, "codex-agent");
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

describe("buildDefaultApplyHandlers — hook", () => {
  test("install → looks up hook def and calls installHook with project scope", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls, [
      { name: "notify" },
    ]);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map(),
    });
    await handlers.hook("install", "notify", noopLog());
    assert.equal(calls.installHook.length, 1);
    assert.equal(calls.installHook[0].scope, "project");
    assert.equal(calls.installHook[0].cwd, "/proj");
    assert.equal(calls.installHook[0].packageRoot, "/pkg");
    const hook = calls.installHook[0].hook as { name: string };
    assert.equal(hook.name, "notify");
  });

  test("install with unknown hook name → throws", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls, []);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map(),
    });
    await assert.rejects(
      () => handlers.hook("install", "ghost-hook", noopLog()),
      /hook not found in registry/,
    );
    assert.equal(calls.installHook.length, 0);
  });

  test("uninstall → calls uninstallHook by name (no def lookup)", async () => {
    const calls = makeCallLog();
    const { buildDefaultApplyHandlers } = await importAdapter(calls, []);
    const handlers = buildDefaultApplyHandlers({
      packageRoot: "/pkg",
      cwd: "/proj",
      pluginAgentsByName: new Map(),
    });
    await handlers.hook("uninstall", "notify", noopLog());
    assert.equal(calls.uninstallHook.length, 1);
    assert.equal(calls.uninstallHook[0].name, "notify");
    // Uninstall must NOT call loadHooksConfig — that path only matters when
    // we need the HookDef to install/update.
    assert.equal(calls.loadHooksConfig.length, 0);
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
    await handlers.skill("install", "brainstorming", { onLog });
    await handlers.plugin("install", "deep-review", { onLog });
    assert.ok(seen.length >= 3, `expected ≥3 log lines, got ${seen.length}`);
  });
});
