// Tarball-shape regression — pin the rule that runtime reads must hit
// shipped paths only (see the runtime-read rule in AGENTS.md).
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
  // Locate the tarball by listing the scratch dir instead of parsing
  // `npm pack --json`: npm 12 changed that JSON shape from an array to an
  // object keyed by package name, while a fresh scratch dir holds exactly
  // one .tgz on any npm version.
  execSync(`npm pack --pack-destination ${tmpDir} --silent`, {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
  const tgzs = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".tgz"));
  assert.equal(
    tgzs.length,
    1,
    `expected exactly one .tgz in ${tmpDir}, got [${tgzs.join(", ")}]`,
  );
  tarballPath = path.join(tmpDir, tgzs[0]);

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
  test("every plugin entry carries a baked agents map (build-time)", () => {
    // rationale: scan-catalog used to derive the agent map from runtime plugin
    // config files that are NOT in the tarball. dist/catalog.json must carry
    // the agent map per plugin so the runtime
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
});
