import assert from "node:assert/strict";
import { describe, test } from "node:test";
import path from "node:path";

import type { Catalog, CatalogEntry } from "../src/catalog.js";
import { loadCatalog } from "../src/catalog.js";
import { generateCatalog } from "../src/build/generate-catalog.js";
import { renderTypeHelp } from "../src/help.js";

// Covers spec §5.4 "Catalog 生成"

const REPO_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..", "..");

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

  test("catalog has all four top-level sections", () => {
    assert.ok(Array.isArray(catalog.workflowSkills));
    assert.ok(Array.isArray(catalog.recommendedSkills));
    assert.ok(Array.isArray(catalog.plugins));
    assert.ok(Array.isArray(catalog.hooks));
    assert.ok(typeof catalog.generatedAt === "string" && catalog.generatedAt.length > 0);
  });

  test("workflow skills exclude repo-owned skills migrated into auriga-workflow-skills", () => {
    assert.equal(catalog.workflowSkills.length, 6);
    const names = catalog.workflowSkills.map((e) => e.name).sort();
    assert.deepEqual(names, [
      "brainstorming",
      "planning-with-files",
      "playwright-cli",
      "systematic-debugging",
      "test-driven-development",
      "verification-before-completion",
    ]);
    assertEntriesShape(catalog.workflowSkills, "workflowSkills");
  });

  test("recommended skills: 8 entries (cross-model delegators + frontend skills + code-simplification + deprecation-and-migration + documentation-and-adrs)", () => {
    assert.equal(catalog.recommendedSkills.length, 8);
    const names = catalog.recommendedSkills.map((e) => e.name).sort();
    assert.deepEqual(names, [
      "claude-code-agent",
      "code-simplification",
      "codex-agent",
      "deprecation-and-migration",
      "design-taste-frontend",
      "documentation-and-adrs",
      "frontend-design",
      "make-interfaces-feel-better",
    ]);
    assertEntriesShape(catalog.recommendedSkills, "recommendedSkills");
  });

  test("plugins: Claude Code entries plus Codex-only entries plus migrated repo-owned assets", () => {
    assert.equal(catalog.plugins.length, 9);
    const names = catalog.plugins.map((e) => e.name).sort();
    assert.deepEqual(names, [
      "auriga-git-guards",
      "auriga-go",
      "auriga-notify",
      "auriga-workflow-skills",
      "claude-md-management",
      "codex",
      "deep-review",
      "session-instructions-loader",
      "skill-creator",
    ]);
    assertEntriesShape(catalog.plugins, "plugins");
    assert.match(
      catalog.plugins.find((e) => e.name === "auriga-go")?.description ?? "",
      /^\(Claude\/Codex\)/,
    );
    assert.match(
      catalog.plugins.find((e) => e.name === "session-instructions-loader")?.description ?? "",
      /^\(Codex\)/,
    );
    // deep-review is dual-Agent and locally bundled (registered in
    // .claude/plugins.json + .agents/plugins/install.json, sourced from
    // .claude-plugin/marketplace.json + .agents/plugins/marketplace.json).
    assert.match(
      catalog.plugins.find((e) => e.name === "deep-review")?.description ?? "",
      /^\(Claude\/Codex\)/,
    );
    assert.match(
      catalog.plugins.find((e) => e.name === "auriga-workflow-skills")?.description ?? "",
      /^\(Claude\/Codex\)/,
    );
  });

  test("hooks: notify is no longer exposed as a traditional hook", () => {
    assert.equal(catalog.hooks.length, 0);
    const names = catalog.hooks.map((e) => e.name).sort();
    assert.deepEqual(names, []);
    assertEntriesShape(catalog.hooks, "hooks");
  });

  test("plugins carry baked agents map (build-time, no runtime IO)", () => {
    // rationale: scan-catalog used to read .claude/plugins.json +
    // .agents/plugins/install.json at runtime to derive the agent map.
    // Those files are NOT in the npm tarball (`files` only ships dist/), so
    // installed users had every plugin default to ["claude"] — dual-Agent
    // plugins (auriga-go etc.) mis-classified as Claude-only. The fix bakes
    // `agents` at build time. This pins the contract per plugin.
    const expectedAgents: Record<string, ("claude" | "codex")[]> = {
      "auriga-go": ["claude", "codex"],
      "auriga-git-guards": ["claude", "codex"],
      "auriga-workflow-skills": ["claude", "codex"],
      "auriga-notify": ["claude"],
      "deep-review": ["claude", "codex"],
      "session-instructions-loader": ["codex"],
      "skill-creator": ["claude"],
      "claude-md-management": ["claude"],
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
    const externals = new Set(["skill-creator", "claude-md-management", "codex"]);
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

  test("install help reflects migrated plugin surfaces instead of standalone entries", () => {
    // rationale: install help is rendered from the generated catalog, so this
    // pins the user-visible CLI surface as well as dist/catalog.json.
    const skillHelp = renderTypeHelp(catalog, "skills", "0.0.0-test");
    for (const name of ["incremental-impl", "test-designer", "session-compound"]) {
      assert.doesNotMatch(skillHelp, new RegExp(`\\b${name}\\b`));
    }

    const pluginHelp = renderTypeHelp(catalog, "plugins", "0.0.0-test");
    assert.match(pluginHelp, /\bauriga-workflow-skills\b/);
    assert.match(pluginHelp, /\bauriga-notify\b/);

    const hookHelp = renderTypeHelp(catalog, "hooks", "0.0.0-test");
    assert.doesNotMatch(hookHelp, /\bnotify\b/);
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
