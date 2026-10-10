import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Catalog } from "../src/catalog.js";
import { loadCatalog } from "../src/catalog.js";
import { generateCatalog } from "../src/build/generate-catalog.js";
import { renderTypeHelp } from "../src/help.js";

// Covers spec §5.4 "Catalog 生成"

const REPO_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..", "..");

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

describe("generateCatalog (build-time)", () => {
  const catalog: Catalog = generateCatalog(REPO_ROOT);

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
