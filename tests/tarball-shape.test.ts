// Tarball-shape regression — pin the rule that runtime reads must hit
// shipped paths only (.claude/CLAUDE.md → Principles).
//
// The v1.18.x scanner shipped 4 distinct "read from disk at runtime, but the
// file isn't in the tarball" bugs in quick succession (workflowVersion,
// plugin agent map, plugin expectedVersion, skill hash). Dev environment
// hides them because `packageRoot === repoRoot`. This test extracts the
// actual `npm pack` artifact and asserts that everything the scanner needs
// is present inside `dist/catalog.json`, since `package.json` `files` only
// ships `dist/`.
//
// If a future change reintroduces "read a non-shipped file at scan time",
// this test will fail at CI before the bug ships.

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, before, describe, test } from "node:test";

import type { Catalog } from "../src/catalog.js";

const REPO_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..", "..");

let catalogFromTarball: Catalog;
let tmpDir: string;
let tarballPath: string;

before(() => {
  // Pack into a scratch dir so we never pollute the repo root with a .tgz.
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tarball-shape-"));
  // `npm pack --json` returns the exact filename so we don't have to guess
  // the version. `--silent` keeps non-JSON output out of stdout.
  const packed = JSON.parse(
    execSync(`npm pack --pack-destination ${tmpDir} --json --silent`, {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    }),
  ) as Array<{ filename: string }>;
  tarballPath = path.join(tmpDir, packed[0].filename);

  // Extract just dist/catalog.json — we don't need the rest of the tarball
  // for these assertions and avoiding a full extract keeps the test fast.
  const catalogJson = execSync(
    `tar -xOzf ${tarballPath} package/dist/catalog.json`,
    { encoding: "utf-8" },
  );
  catalogFromTarball = JSON.parse(catalogJson) as Catalog;
});

afterEach(() => {
  // Tarball is the only artifact; clean once per file via the tmp dir.
});

describe("tarball-shape — dist/catalog.json carries everything the scanner needs", () => {
  test("dist/catalog.json is present in the packed tarball", () => {
    assert.ok(
      fs.existsSync(tarballPath),
      `expected tarball at ${tarballPath}`,
    );
    assert.ok(catalogFromTarball, "catalog parsed from tarball");
  });

  test("catalog has no version / hash fields (v1.19.0 presence-only)", () => {
    // The scanner is presence-only as of v1.19.0; baking workflowVersion
    // or per-plugin expectedVersion would be dead data shipping in every
    // tarball. This test pins that surface stays gone.
    assert.equal(
      (catalogFromTarball as unknown as Record<string, unknown>).workflowVersion,
      undefined,
      "workflowVersion must not appear in dist/catalog.json",
    );
    for (const entry of catalogFromTarball.plugins) {
      assert.equal(
        (entry as unknown as Record<string, unknown>).expectedVersion,
        undefined,
        `plugin ${entry.name}: expectedVersion must not be baked`,
      );
    }
  });

  test("every plugin entry carries a baked agents map (build-time)", () => {
    // rationale: scan-catalog used to read .claude/plugins.json +
    // .agents/plugins/install.json at runtime, both NOT in the tarball.
    // dist/catalog.json must carry the agent map per plugin so the runtime
    // adapter doesn't need to touch any non-shipped file.
    for (const entry of catalogFromTarball.plugins) {
      assert.ok(
        Array.isArray(entry.agents) && entry.agents.length > 0,
        `plugin ${entry.name}: agents must be a non-empty array (got ${JSON.stringify(entry.agents)})`,
      );
      for (const a of entry.agents!) {
        assert.ok(
          a === "claude" || a === "codex",
          `plugin ${entry.name}: agent must be 'claude' or 'codex' (got ${JSON.stringify(a)})`,
        );
      }
    }
  });

  test("owned plugins lack external flag; external plugins have it", () => {
    // rationale: the EXTERNAL badge tells users "upgrades go through
    // `claude plugins update`, not us" for plugins published in upstream
    // marketplaces. Pure UI hint since v1.19.0 (used to also gate
    // update-available reporting; that surface is gone).
    const owned = [
      "auriga-go",
      "auriga-git-guards",
      "auriga-workflow-skills",
      "auriga-notify",
      "deep-review",
      "session-instructions-loader",
    ];
    const external = ["skill-creator", "claude-md-management", "codex"];
    for (const name of owned) {
      const e = catalogFromTarball.plugins.find((p) => p.name === name);
      assert.ok(e, `${name} present in tarball catalog`);
      assert.notEqual(e!.external, true, `owned plugin ${name} must NOT be external`);
    }
    for (const name of external) {
      const e = catalogFromTarball.plugins.find((p) => p.name === name);
      assert.ok(e, `${name} present in tarball catalog`);
      assert.equal(e!.external, true, `external plugin ${name} must carry external:true`);
    }
  });
});
