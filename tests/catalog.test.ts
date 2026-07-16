import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Catalog, CatalogEntry } from "../src/catalog.js";
import { loadCatalog } from "../src/catalog.js";
import { generateCatalog } from "../src/build/generate-catalog.js";
import { renderHelp, renderTypeHelp } from "../src/help.js";

// Covers spec §5.4 "Catalog 生成"

const REPO_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..", "..");

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function assertEntriesShape(entries: CatalogEntry[], label: string): void {
  for (const e of entries) {
    assert.ok(
      typeof e.name === "string" && e.name.length > 0,
      `${label}: name must be non-empty string (got ${JSON.stringify(e)})`,
    );
    assert.ok(
      typeof e.description === "string" && e.description.length > 0,
      `${label}: description must be non-empty string (got ${JSON.stringify(e)})`,
    );
  }
}

describe("generateCatalog (build-time)", () => {
  const catalog: Catalog = generateCatalog(REPO_ROOT);

  test("catalog has all three top-level sections", () => {
    assert.ok(Array.isArray(catalog.workflowSkills));
    assert.ok(Array.isArray(catalog.recommendedSkills));
    assert.ok(Array.isArray(catalog.plugins));
    assert.ok(typeof catalog.generatedAt === "string" && catalog.generatedAt.length > 0);
  });

  // VAL-CAT-001: hooks 安装表面已移除,catalog 不再有 hooks 字段。
  test("catalog 不再含 hooks 字段", () => {
    assert.equal(
      Object.hasOwn(catalog as object, "hooks"),
      false,
      "catalog 不应再有 hooks 键",
    );
  });

  test("workflow skills exclude repo-owned skills migrated into auriga-workflow (and dropped retired brainstorming)", () => {
    assert.equal(catalog.workflowSkills.length, 2);
    const names = catalog.workflowSkills.map((e) => e.name).sort();
    assert.deepEqual(names, [
      "planning-with-files",
      "playwright-cli",
    ]);
    assertEntriesShape(catalog.workflowSkills, "workflowSkills");
  });

  test("recommended skills: 6 entries (cross-model delegators + frontend skills + deprecation-and-migration); documentation management is owned by auriga-workflow", () => {
    assert.equal(catalog.recommendedSkills.length, 6);
    const names = catalog.recommendedSkills.map((e) => e.name).sort();
    assert.deepEqual(names, [
      "claude-code-agent",
      "codex-agent",
      "deprecation-and-migration",
      "design-taste-frontend",
      "frontend-design",
      "make-interfaces-feel-better",
    ]);
    assertEntriesShape(catalog.recommendedSkills, "recommendedSkills");
  });

  test("plugins: Claude Code entries plus Codex-only entries plus migrated repo-owned assets", () => {
    assert.equal(catalog.plugins.length, 8);
    const names = catalog.plugins.map((e) => e.name).sort();
    assert.deepEqual(names, [
      "auriga-notify",
      "auriga-workflow",
      "claude-md-management",
      "codex",
      "playground",
      "quality-gate-scaffolder",
      "session-instructions-loader",
      "skill-creator",
    ]);
    assertEntriesShape(catalog.plugins, "plugins");
    assert.match(
      catalog.plugins.find((e) => e.name === "session-instructions-loader")?.description ?? "",
      /^\(Codex\)/,
    );
    // auriga-workflow is dual-Agent and locally bundled, sourced from both
    // repo marketplace manifests.
    assert.match(
      catalog.plugins.find((e) => e.name === "auriga-workflow")?.description ?? "",
      /^\(Claude\/Codex\)/,
    );
  });

  test("external Codex plugins from extra_plugin_configs appear in catalog/help", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-catalog-extra-codex-"));
    writeJson(path.join(repoRoot, "skills-lock.json"), { skills: {} });
    writeJson(path.join(repoRoot, "extra_plugin_configs.json"), {
      plugins: [
        {
          name: "external-codex-plugin",
          agents: ["codex"],
          description: "External Codex plugin from extra config",
          codex: {
            marketplace: {
              name: "external-marketplace",
              source: "owner/repo",
            },
          },
        },
      ],
    });

    const extraCatalog = generateCatalog(repoRoot);
    const entry = extraCatalog.plugins.find((p) => p.name === "external-codex-plugin");
    assert.deepEqual(entry?.agents, ["codex"]);
    assert.equal(entry?.external, true);
    assert.match(entry?.description ?? "", /^\(Codex\) External Codex plugin from extra config$/);
    assert.match(renderTypeHelp(extraCatalog, "plugins", "0.0.0-test"), /external-codex-plugin/);
  });

  test("plugins carry baked agents map (build-time, no runtime IO)", () => {
    // rationale: scan-catalog used to derive the agent map from non-tarball
    // plugin config files at runtime. Those files are NOT in the npm tarball
    // (`files` only ships dist/), so
    // installed users had every plugin default to ["claude"] — dual-Agent
    // plugins (auriga-workflow etc.) mis-classified as Claude-only. The fix
    // bakes `agents` at build time. This pins the contract per plugin.
    const expectedAgents: Record<string, ("claude" | "codex")[]> = {
      "auriga-workflow": ["claude", "codex"],
      "auriga-notify": ["claude"],
      "quality-gate-scaffolder": ["claude", "codex"],
      "session-instructions-loader": ["codex"],
      "skill-creator": ["claude"],
      "claude-md-management": ["claude", "codex"],
      playground: ["claude", "codex"],
      codex: ["claude"],
    };
    for (const [name, agents] of Object.entries(expectedAgents)) {
      const e = catalog.plugins.find((p) => p.name === name);
      assert.ok(e, `${name} present in catalog`);
      assert.deepEqual(
        e!.agents,
        agents,
        `${name} agents must be ${JSON.stringify(agents)}, got ${JSON.stringify(e!.agents)}`,
      );
    }
  });

  test("external flag set on upstream-marketplace plugins, absent on owned", () => {
    // rationale: the EXTERNAL badge tells users "upgrades go through
    // `claude plugins update`, not us" for plugins published in upstream
    // marketplaces. Mis-flagging an owned plugin as external would point
    // users at the wrong upgrade channel; the inverse would do the same.
    const externals = new Set(["skill-creator", "claude-md-management", "codex", "playground"]);
    for (const entry of catalog.plugins) {
      if (externals.has(entry.name)) {
        assert.equal(entry.external, true, `${entry.name} must be external`);
      } else {
        assert.notEqual(
          entry.external,
          true,
          `${entry.name} must NOT be external (owned in-tree)`,
        );
      }
    }
  });

  test("install surfaces reflect plugin-owned skills instead of standalone entries", () => {
    // rationale: install help is rendered from the generated catalog, so this
    // pins the user-visible CLI surface as well as dist/catalog.json.
    const skillHelp = renderTypeHelp(catalog, "skills", "0.0.0-test");
    for (const name of [
      "incremental-impl",
      "test-designer",
      "session-compound",
      "systematic-debugging",
      "test-driven-development",
    ]) {
      assert.doesNotMatch(skillHelp, new RegExp(`\\b${name}\\b`));
    }

    const pluginHelp = renderTypeHelp(catalog, "plugins", "0.0.0-test");
    assert.match(pluginHelp, /\bauriga-workflow\b/);
    assert.match(pluginHelp, /\bauriga-notify\b/);
    const workflowPlugin = catalog.plugins.find((entry) => entry.name === "auriga-workflow");
    assert.ok(workflowPlugin, "auriga-workflow must remain in the plugin catalog");
    assert.match(workflowPlugin.description, /engineering workflow/i);
    assert.ok(
      workflowPlugin.description.length <= 240,
      "plugin catalog description should summarize the workflow instead of enumerating every skill",
    );
    assert.doesNotMatch(workflowPlugin.description, /test-designer/);
  });

  // VAL-HELP-001: top-level `--help` advertises the `install --preset` entry
  // point with its three modifier flags.
  test("top-level --help advertises install --preset", () => {
    const help = renderHelp(catalog, "0.0.0-test");
    assert.match(help, /install --preset/);
    assert.match(help, /--preset[\s\S]*--scope[\s\S]*--agent[\s\S]*--lang/);
    assert.match(help, /install --preset-plugins-skills/);
    assert.match(help, /--preset-plugins-skills[\s\S]*--scope[\s\S]*--agent/);
    assert.match(help, /Workflow skills[\s\S]*--preset-plugins-skills/);
    assert.match(help, /Recommended skills[\s\S]*NOT by preset modes/);
  });

  // VAL-HELP-002: the removed `hooks` install surface must not resurface in
  // top-level help — no `install hooks` invocation, no `hooks` <type> row,
  // no `(category: hooks)`. (The word "hook" still legitimately appears in
  // plugin descriptions — e.g. auriga-notify's notification hook — so the
  // assertions target the install-surface tokens, not the bare word.)
  test("top-level --help no longer mentions the removed hooks surface", () => {
    const help = renderHelp(catalog, "0.0.0-test");
    assert.doesNotMatch(help, /install hooks/);
    assert.doesNotMatch(help, /^\s+hooks\s/m);
    assert.doesNotMatch(help, /category: hooks/);
  });
});

describe("loadCatalog", () => {
  test("reads catalog.json from packageRoot/dist/catalog.json", () => {
    // This runs only after `npm run build` generated dist/catalog.json.
    // If the file is missing, loadCatalog should throw with a clear message.
    const catalog = loadCatalog(REPO_ROOT);
    assert.ok(catalog.workflowSkills.length > 0);
    assert.ok(catalog.plugins.length > 0);
  });

  test("throws a clear error when dist/catalog.json is missing", () => {
    const missingRoot = "/tmp/does-not-exist-catalog-root-" + Date.now();
    assert.throws(
      () => loadCatalog(missingRoot),
      /catalog missing/i,
    );
  });
});
