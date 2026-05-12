import assert from "node:assert/strict";
import { describe, test } from "node:test";
import path from "node:path";

import type { Catalog, CatalogEntry } from "../src/catalog.js";
import { loadCatalog } from "../src/catalog.js";
import { generateCatalog } from "../src/build/generate-catalog.js";

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

  test("workflow skills: 9 entries matching WORKFLOW_SKILLS", () => {
    assert.equal(catalog.workflowSkills.length, 9);
    const names = catalog.workflowSkills.map((e) => e.name).sort();
    // deep-review is no longer here — it ships as the `deep-review` plugin
    // (assertion lives in the plugins block below).
    assert.deepEqual(names, [
      "brainstorming",
      "incremental-impl",
      "planning-with-files",
      "playwright-cli",
      "session-compound",
      "systematic-debugging",
      "test-designer",
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

  test("plugins: Claude Code entries plus Codex-only entries", () => {
    assert.equal(catalog.plugins.length, 7);
    const names = catalog.plugins.map((e) => e.name).sort();
    assert.deepEqual(names, [
      "auriga-git-guards",
      "auriga-go",
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
  });

  test("hooks: 1 entry", () => {
    assert.equal(catalog.hooks.length, 1);
    const names = catalog.hooks.map((e) => e.name).sort();
    assert.deepEqual(names, ["notify"]);
    assertEntriesShape(catalog.hooks, "hooks");
  });

  test("owned plugins carry baked expectedVersion from plugin.json", () => {
    // rationale: the scanner relies on this baked field to surface
    // "update-available" for already-installed plugins. Reading at runtime
    // doesn't work because `plugins/<name>/` is not in the npm tarball's
    // `files` allowlist — must be baked into dist/catalog.json at build time.
    for (const name of ["auriga-go", "auriga-git-guards", "deep-review", "session-instructions-loader"]) {
      const e = catalog.plugins.find((p) => p.name === name);
      assert.ok(e, `${name} present in catalog`);
      assert.match(
        e!.expectedVersion ?? "",
        /^\d+\.\d+\.\d+/,
        `${name} must bake a semver expectedVersion; got ${JSON.stringify(e!.expectedVersion)}`,
      );
    }
  });

  test("external-marketplace plugins do NOT carry expectedVersion", () => {
    // rationale: skill-creator / claude-md-management / codex install from
    // upstream marketplaces; their manifest doesn't live in this repo. The
    // scanner must treat them as "trust whatever is installed" by leaving
    // expectedVersion undefined — pinning a version here would force
    // perpetual update-available against upstream's own release cadence.
    for (const name of ["skill-creator", "claude-md-management", "codex"]) {
      const e = catalog.plugins.find((p) => p.name === name);
      assert.ok(e, `${name} present in catalog`);
      assert.equal(
        e!.expectedVersion,
        undefined,
        `${name} must NOT carry expectedVersion (external marketplace)`,
      );
    }
  });

  test("descriptions survive unicode special chars (incremental-impl)", () => {
    const e = catalog.workflowSkills.find((e) => e.name === "incremental-impl");
    assert.ok(e);
    // Description contains em-dashes and unicode arrows that must survive
    // YAML parsing through the catalog generator. Regression guard for
    // YAML special-character handling in skill descriptions.
    assert.match(e.description, /XS–XL/);
    assert.match(e.description, /Implement → Test → Verify → Commit/);
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
