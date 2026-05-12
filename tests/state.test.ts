// =============================================================================
// scanState behavioral test suite — TDD red phase
// =============================================================================
//
// This file is the contract for the not-yet-implemented `scanState` function
// (src/state.ts). It was authored by an independent test designer with no
// access to the implementation, only to:
//
//   - src/api-types.ts (StateReport, ItemStatus, etc. — exported shape)
//   - docs/specs/web-ui.md §6.3 + §10.4 (judgment rules)
//   - the task brief (judgment logic + boundary categories)
//
// =============================================================================
// KEY ASSUMPTIONS (where the spec is ambiguous or silent)
// =============================================================================
//
// 1. **Corrupt workflow header**: `# Some Other Heading` (no parenthesized
//    version) is treated as `status: "not-installed"` with `currentVersion`
//    absent. Rationale: the user has *something* but we cannot prove it is a
//    valid auriga workflow; safer to offer install/reinstall than to label
//    it "installed" against an unknown version. No warning is added — this
//    is single-item state, not a system-wide failure.
//
// 2. **Per-item error encoding**: When an individual plugin / hook / skill
//    cannot be classified (e.g., enabled in Codex config but missing from
//    filesystem, or hooks.json lists it but `index.mjs` is gone), the item
//    appears in the result with `status` set to one of the three valid
//    `ItemStatus` values AND an `error` indication via the `currentHash` /
//    `currentVersion` being absent. Since `ItemStatus` is a closed union
//    ("installed" | "update-available" | "not-installed"), the test contract
//    chooses: such items map to `status: "not-installed"` AND a warning is
//    emitted into the top-level `warnings[]` with a generic descriptive
//    message. The implementer is free to extend the type with a
//    discriminated `"error"` status later, but tests below only assert what
//    today's contract guarantees: the item is NOT silently dropped and the
//    user is informed via warnings.
//
// 3. **Plugin id format**: `<name>@<marketplace>`. Catalog keys MAY include
//    the full id or the bare name — tests use the form that survives spec
//    §6.2 (`"auriga-go@auriga-cli"`). All assertions use property-style
//    membership (`.some(p => p.id === ...)`) not deep-equal on the array, so
//    minor key shape decisions are not over-constrained.
//
// 4. **Skill `isWorkflow` flag**: Comes from the catalog entry, not the
//    skills-lock. Tests build catalog with explicit `isWorkflow: true|false`
//    so the implementer must propagate this field rather than re-derive.
//
// 5. **Hook hashing**: SHA256 of the entire `index.mjs` file bytes. The
//    test computes the expected hash dynamically from the fixture file so
//    the test stays robust to fixture content edits.
//
// 6. **Warning vacuity**: An empty catalog (no plugins / no hooks / no
//    skills) MUST NOT emit warnings even if no CLIs are reachable.
//    Warnings are user-facing — only emit them when a user expectation
//    cannot be served.
//
// 7. **Codex catalog scoping**: Per spec §6.3, only catalog-registered
//    Codex plugins appear; user's hand-installed Codex plugins outside the
//    catalog are filtered out (same rule applies to skills and Claude
//    plugins, but is most consequential for Codex because there's no
//    upstream live query to disambiguate).
//
// =============================================================================
// What is NOT asserted (open contract)
// =============================================================================
//
//   - Order of items within each category array (tests use .find / .some)
//   - Exact wording of warning `message` fields (tests assert `.code` only)
//   - Whether `versionSource` is set on not-installed plugins (tests don't
//     read it on those rows)
//   - File-system traversal strategy / caching
//   - Concurrency model (sync vs parallel reads)
//
// Every test below maps to a clause in the brief via a "spec §X.Y" or
// "boundary: <category>" tag in its comment.
// =============================================================================

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { scanState } from "../src/state.js";
import type { Catalog, ScanOptions } from "../src/state.js";
import type {
  HookState,
  PluginState,
  SkillState,
  StateReport,
} from "../src/api-types.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

// dist-test layout puts this file at dist-test/tests/state.test.js, two
// levels deep from the repo root. Use fileURLToPath so the resolution works
// equally when running through `tsc → dist-test` (the project's standard
// node:test pipeline) and when something invokes the .ts directly via a
// loader.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FIXTURES_ROOT = path.join(REPO_ROOT, "tests", "fixtures", "state");

/** Compute SHA256 of a file's raw bytes — same algorithm the scanner uses. */
function sha256File(p: string): string {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

/** Path to a fixture scenario root (the directory the scanner treats as cwd). */
function fix(scenario: string): string {
  return path.join(FIXTURES_ROOT, scenario);
}

/** Create a minimal catalog. Each category opts-in via the builder args. */
function makeCatalog(over: Partial<Catalog> = {}): Catalog {
  return {
    workflowVersion: "1.6.0",
    skills: {},
    recommendedSkills: {},
    plugins: {},
    hooks: {},
    ...over,
  };
}

/** Track scratch dirs minted per-test so cleanup is unconditional. */
const scratchDirs: string[] = [];
function makeScratch(label: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `state-test-${label}-`));
  scratchDirs.push(d);
  return d;
}
afterEach(() => {
  while (scratchDirs.length) {
    const d = scratchDirs.pop()!;
    fs.rmSync(d, { recursive: true, force: true });
  }
});

/** Build a Claude `execPluginList` mock that returns a fixed payload. */
function mockExec(payload: {
  installed: any[];
  available: any[];
}): ScanOptions["execPluginList"] {
  return async () => payload;
}

/** Build an `execPluginList` mock that throws (simulates Claude CLI crash). */
function mockExecThrows(msg = "claude CLI not found"): ScanOptions["execPluginList"] {
  return async () => {
    throw new Error(msg);
  };
}

// ===========================================================================
// 1. BOUNDARY: empty inputs
// ===========================================================================
describe("scanState — boundary: empty inputs", () => {
  test("empty projectRoot + empty catalog → all categories empty, no warnings (boundary: empty)", async () => {
    const empty = makeScratch("empty");
    const report = await scanState(empty, makeCatalog());
    assert.equal(report.workflow.status, "not-installed");
    assert.equal(report.workflow.expectedVersion, "1.6.0");
    assert.equal(report.workflow.currentVersion, undefined);
    assert.equal(report.skills.length, 0);
    assert.equal(report.recommendedSkills.length, 0);
    assert.equal(report.plugins.length, 0);
    assert.equal(report.hooks.length, 0);
    // Per assumption #6: vacuous catalog → no warnings even with no CLIs.
    assert.equal(report.warnings.length, 0, "no warnings when catalog has no expectations");
  });

  test("empty projectRoot + catalog with one skill → skill is not-installed (boundary: empty)", async () => {
    const empty = makeScratch("empty-skill");
    const catalog = makeCatalog({
      skills: {
        brainstorming: {
          description: "d",
          expectedHash: "h",
          isWorkflow: true,
        },
      },
    });
    const report = await scanState(empty, catalog);
    assert.equal(report.skills.length, 1);
    assert.equal(report.skills[0].name, "brainstorming");
    assert.equal(report.skills[0].status, "not-installed");
    assert.equal(report.skills[0].currentHash, undefined);
    assert.equal(report.skills[0].expectedHash, "h");
    assert.equal(report.skills[0].isWorkflow, true);
  });

  test("empty skills-lock object → all catalog skills not-installed (boundary: empty)", async () => {
    const scratch = makeScratch("empty-lock");
    fs.writeFileSync(
      path.join(scratch, "skills-lock.json"),
      JSON.stringify({ version: 1, skills: {} }),
    );
    const catalog = makeCatalog({
      skills: {
        a: { description: "", expectedHash: "ha", isWorkflow: true },
        b: { description: "", expectedHash: "hb", isWorkflow: true },
      },
    });
    const report = await scanState(scratch, catalog);
    assert.equal(report.skills.filter((s) => s.status === "not-installed").length, 2);
  });
});

// ===========================================================================
// 2. WORKFLOW — three states + corrupt header (spec §6.3 workflow row)
// ===========================================================================
describe("scanState — workflow tri-state", () => {
  test("CLAUDE.md absent → workflow not-installed (spec §6.3)", async () => {
    const report = await scanState(fix("empty"), makeCatalog());
    assert.equal(report.workflow.status, "not-installed");
    assert.equal(report.workflow.currentVersion, undefined);
  });

  test("CLAUDE.md version equals catalog → installed (spec §6.3)", async () => {
    const report = await scanState(fix("workflow-installed"), makeCatalog({ workflowVersion: "1.6.0" }));
    assert.equal(report.workflow.status, "installed");
    assert.equal(report.workflow.currentVersion, "1.6.0");
  });

  test("CLAUDE.md version differs from catalog → update-available (spec §6.3)", async () => {
    const report = await scanState(fix("workflow-update"), makeCatalog({ workflowVersion: "1.6.0" }));
    assert.equal(report.workflow.status, "update-available");
    assert.equal(report.workflow.currentVersion, "1.4.0");
    assert.equal(report.workflow.expectedVersion, "1.6.0");
  });

  test("CLAUDE.md present but version header unparseable → not-installed (assumption #1)", async () => {
    // Per assumption #1: prefer reinstall flow over false-positive "installed"
    // on an unknown-version document. Test enforces the contract; if the
    // implementer chooses a warning-based encoding instead, this test must
    // be updated together with the assumption block at the top of this file.
    const report = await scanState(fix("workflow-corrupt-header"), makeCatalog());
    assert.equal(report.workflow.status, "not-installed");
    assert.equal(report.workflow.currentVersion, undefined);
  });
});

// ===========================================================================
// 3. SKILLS — three states + filtering (spec §6.3 skills row)
// ===========================================================================
describe("scanState — skills tri-state + catalog filter", () => {
  test("skill hash matches catalog → installed (spec §6.3)", async () => {
    const catalog = makeCatalog({
      skills: {
        brainstorming: {
          description: "Brainstorm",
          expectedHash: "hash-brainstorming-current",
          isWorkflow: true,
        },
      },
    });
    const report = await scanState(fix("skills-installed"), catalog);
    const b = report.skills.find((s: SkillState) => s.name === "brainstorming");
    assert.ok(b, "brainstorming skill row present");
    assert.equal(b!.status, "installed");
    assert.equal(b!.currentHash, "hash-brainstorming-current");
    assert.equal(b!.isWorkflow, true);
  });

  test("skill hash differs → update-available (spec §6.3)", async () => {
    const catalog = makeCatalog({
      skills: {
        brainstorming: {
          description: "",
          expectedHash: "hash-brainstorming-CURRENT-CATALOG",
          isWorkflow: true,
        },
      },
    });
    const report = await scanState(fix("skills-update"), catalog);
    const b = report.skills.find((s) => s.name === "brainstorming")!;
    assert.equal(b.status, "update-available");
    assert.equal(b.currentHash, "hash-brainstorming-OLD");
    assert.equal(b.expectedHash, "hash-brainstorming-CURRENT-CATALOG");
  });

  test("catalog skill absent from lockfile → not-installed (spec §6.3)", async () => {
    const catalog = makeCatalog({
      skills: {
        "never-vendored": {
          description: "",
          expectedHash: "h",
          isWorkflow: false,
        },
      },
    });
    const report = await scanState(fix("skills-installed"), catalog);
    const x = report.skills.find((s) => s.name === "never-vendored")!;
    assert.equal(x.status, "not-installed");
    assert.equal(x.currentHash, undefined);
  });

  test("lockfile contains skill NOT in catalog → filtered out (boundary: catalog filter)", async () => {
    // User has `some-orphan-skill-not-in-catalog` in skills-lock.json, but
    // catalog doesn't list it. It must not surface in the UI; UI only shows
    // installable items, and uncatalogued items aren't installable.
    const catalog = makeCatalog({
      skills: {
        brainstorming: {
          description: "",
          expectedHash: "hash-brainstorming-current",
          isWorkflow: true,
        },
      },
    });
    const report = await scanState(fix("skills-not-in-catalog"), catalog);
    assert.equal(report.skills.length, 1);
    assert.equal(report.skills[0].name, "brainstorming");
    assert.ok(
      !report.skills.some((s) => s.name === "some-orphan-skill-not-in-catalog"),
      "orphan skill not in catalog must be filtered",
    );
  });

  test("recommendedSkills vs skills routed by catalog category (spec §6.2)", async () => {
    // brainstorming → skills[]; frontend-design → recommendedSkills[].
    // Property-style assertion: each catalog group lands in its own array,
    // regardless of order.
    const catalog = makeCatalog({
      skills: {
        brainstorming: {
          description: "",
          expectedHash: "hash-brainstorming-current",
          isWorkflow: true,
        },
      },
      recommendedSkills: {
        "frontend-design": {
          description: "",
          expectedHash: "hash-frontend-current",
        },
      },
    });
    const report = await scanState(fix("recommended-mixed"), catalog);
    assert.equal(report.skills.length, 1);
    assert.equal(report.recommendedSkills.length, 1);
    assert.equal(report.skills[0].name, "brainstorming");
    assert.equal(report.skills[0].isWorkflow, true);
    assert.equal(report.recommendedSkills[0].name, "frontend-design");
    // recommendedSkills get isWorkflow=false per spec §6.2.
    assert.equal(report.recommendedSkills[0].isWorkflow, false);
    assert.equal(report.recommendedSkills[0].status, "update-available");
  });

  test("skills-lock.json malformed JSON → category degraded, never crashes (boundary: corrupt JSON)", async () => {
    // The endpoint must keep responding. The skills category may produce
    // not-installed entries (we can't trust the file) and one warning could
    // be added; but the WHOLE endpoint must not throw, and other categories
    // (workflow, plugins, hooks) must still classify correctly.
    const catalog = makeCatalog({
      skills: {
        brainstorming: {
          description: "",
          expectedHash: "hash-brainstorming-current",
          isWorkflow: true,
        },
      },
      hooks: {},
    });
    let report: StateReport;
    await assert.doesNotReject(
      async () => {
        report = await scanState(fix("skills-lock-corrupt"), catalog);
      },
      "scanState must not throw on corrupt skills-lock.json",
    );
    // Skill row exists — implementer chooses status semantics for the
    // degraded path, but the row must not be silently dropped (otherwise
    // the user wouldn't see install offers).
    assert.equal(report!.skills.length, 1);
    assert.equal(report!.skills[0].name, "brainstorming");
    // The whole endpoint did not blow up: workflow / hooks branches still ran.
    assert.ok(report!.workflow, "workflow branch still ran despite corrupt skills-lock");
  });
});

// ===========================================================================
// 4. PLUGINS (Claude) — three states + version normalization (spec §6.3)
// ===========================================================================
describe("scanState — Claude plugins tri-state + ref normalization", () => {
  test("catalog plugin absent from `installed[]` → not-installed (spec §6.3)", async () => {
    const catalog = makeCatalog({
      plugins: {
        "missing-x@auriga-cli": {
          description: "",
          agent: "claude",
        },
      },
    });
    const report = await scanState(makeScratch("p-missing"), catalog, {
      execPluginList: mockExec({ installed: [], available: [] }),
    });
    const p = report.plugins.find((x) => x.id === "missing-x@auriga-cli")!;
    assert.equal(p.status, "not-installed");
    assert.equal(p.agent, "claude");
  });

  test("installed.version === parseRef(available.source.ref) → installed (spec §6.3)", async () => {
    const catalog = makeCatalog({
      plugins: {
        "auriga-go@auriga-cli": { description: "", agent: "claude" },
      },
    });
    const report = await scanState(makeScratch("p-eq"), catalog, {
      execPluginList: mockExec({
        installed: [{ id: "auriga-go@auriga-cli", version: "v1.2.3" }],
        available: [
          { id: "auriga-go@auriga-cli", source: { ref: "v1.2.3" } },
        ],
      }),
    });
    const p = report.plugins.find((x) => x.id === "auriga-go@auriga-cli")!;
    assert.equal(p.status, "installed");
    assert.equal(p.versionSource, "upstream-live");
  });

  test("ref normalization: installed '1.2.3' equates to available 'v1.2.3' (boundary: ref normalize)", async () => {
    // parseRef("v1.2.3") === "1.2.3". installed.version === "1.2.3" without
    // the leading v must still classify as installed; otherwise we'd
    // false-positive update prompts for every plugin whose installer
    // strips the prefix.
    const catalog = makeCatalog({
      plugins: { "auriga-go@auriga-cli": { description: "", agent: "claude" } },
    });
    const report = await scanState(makeScratch("p-norm"), catalog, {
      execPluginList: mockExec({
        installed: [{ id: "auriga-go@auriga-cli", version: "1.2.3" }],
        available: [
          { id: "auriga-go@auriga-cli", source: { ref: "v1.2.3" } },
        ],
      }),
    });
    const p = report.plugins.find((x) => x.id === "auriga-go@auriga-cli")!;
    assert.equal(p.status, "installed", "normalized version must equate v1.2.3 with 1.2.3");
  });

  test("installed.version differs from parseRef(ref) → update-available (spec §6.3)", async () => {
    const catalog = makeCatalog({
      plugins: { "auriga-go@auriga-cli": { description: "", agent: "claude" } },
    });
    const report = await scanState(makeScratch("p-diff"), catalog, {
      execPluginList: mockExec({
        installed: [{ id: "auriga-go@auriga-cli", version: "v1.2.3" }],
        available: [
          { id: "auriga-go@auriga-cli", source: { ref: "v2.0.0" } },
        ],
      }),
    });
    const p = report.plugins.find((x) => x.id === "auriga-go@auriga-cli")!;
    assert.equal(p.status, "update-available");
    assert.equal(p.currentVersion, "v1.2.3");
    assert.equal(p.expectedVersion, "v2.0.0");
  });

  test("installed.version 'unknown' → falls back to installed (spec §6.3 fallback)", async () => {
    // When the installer can't determine the installed version (e.g., manual
    // install), do NOT show "update-available" — that would push users into
    // a reinstall loop. Treat as "we trust it's installed, just can't verify".
    const catalog = makeCatalog({
      plugins: { "auriga-go@auriga-cli": { description: "", agent: "claude" } },
    });
    const report = await scanState(makeScratch("p-unknown"), catalog, {
      execPluginList: mockExec({
        installed: [{ id: "auriga-go@auriga-cli", version: "unknown" }],
        available: [
          { id: "auriga-go@auriga-cli", source: { ref: "v2.0.0" } },
        ],
      }),
    });
    const p = report.plugins.find((x) => x.id === "auriga-go@auriga-cli")!;
    assert.equal(p.status, "installed");
  });

  test("source.ref is a branch (non-vX.Y.Z) → falls back to installed (spec §6.3 fallback)", async () => {
    // Marketplaces pinned to a moving target ("main", "HEAD") cannot be
    // version-compared. Treat as installed rather than perpetual update.
    const catalog = makeCatalog({
      plugins: { "auriga-go@auriga-cli": { description: "", agent: "claude" } },
    });
    const report = await scanState(makeScratch("p-branch"), catalog, {
      execPluginList: mockExec({
        installed: [{ id: "auriga-go@auriga-cli", version: "v1.2.3" }],
        available: [
          { id: "auriga-go@auriga-cli", source: { ref: "main" } },
        ],
      }),
    });
    const p = report.plugins.find((x) => x.id === "auriga-go@auriga-cli")!;
    assert.equal(p.status, "installed");
  });

  test("execPluginList not injected + catalog has claude plugin → degraded + warning (spec §6.3)", async () => {
    const catalog = makeCatalog({
      plugins: { "auriga-go@auriga-cli": { description: "", agent: "claude" } },
    });
    const report = await scanState(makeScratch("p-no-cli"), catalog);
    // Warning code is fixed by the StateWarning union; assert it surfaces.
    assert.ok(
      report.warnings.some((w) => w.code === "claude-cli-missing"),
      "claude-cli-missing warning emitted when Claude CLI absent + catalog has claude expectation",
    );
    // Category is degraded to binary: every plugin reports either installed
    // or not-installed, never update-available (since we can't compare).
    for (const p of report.plugins.filter((x) => x.agent === "claude")) {
      assert.notEqual(p.status, "update-available", "no update-available in degraded mode");
    }
  });

  test("execPluginList throws → degraded + warning, no crash (spec §6.3)", async () => {
    const catalog = makeCatalog({
      plugins: { "auriga-go@auriga-cli": { description: "", agent: "claude" } },
    });
    let report: StateReport;
    await assert.doesNotReject(async () => {
      report = await scanState(makeScratch("p-throw"), catalog, {
        execPluginList: mockExecThrows("ENOENT: claude"),
      });
    });
    assert.ok(
      report!.warnings.some((w) => w.code === "claude-cli-missing"),
      "exec throw must emit claude-cli-missing",
    );
  });

  test("execPluginList absent BUT catalog has no claude plugins → no warning (assumption #6)", async () => {
    const report = await scanState(makeScratch("p-vacuous"), makeCatalog());
    assert.ok(
      !report.warnings.some((w) => w.code === "claude-cli-missing"),
      "no warning emitted when there are no claude plugins to compare",
    );
  });

  test("single-item error isolation: 3 plugins, middle one missing from available[] → others classify (boundary: error isolation)", async () => {
    // good-a + good-b have full data; broken-c is in installed but has
    // null `source` in available. The two well-formed entries MUST still
    // be classified accurately — broken-c must not poison the batch.
    const fixturePath = path.join(fix("plugin-isolation"), "claude-plugin-list.json");
    const payload = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    const catalog = makeCatalog({
      plugins: {
        "good-a@auriga-cli": { description: "", agent: "claude" },
        "good-b@auriga-cli": { description: "", agent: "claude" },
        "broken-c@auriga-cli": { description: "", agent: "claude" },
      },
    });
    const report = await scanState(makeScratch("p-iso"), catalog, {
      execPluginList: mockExec(payload),
    });
    // good-a: installed (v1.0.0 === v1.0.0)
    const a = report.plugins.find((p) => p.id === "good-a@auriga-cli")!;
    assert.equal(a.status, "installed");
    // good-b: update-available (v2.0.0 → v3.0.0)
    const b = report.plugins.find((p) => p.id === "good-b@auriga-cli")!;
    assert.equal(b.status, "update-available");
    assert.equal(b.expectedVersion, "v3.0.0");
    // broken-c: NOT classified as installed (no available info) but row
    // present — the user must see something for it. Per assumption #2, the
    // contract today is that the row exists with a defined status. We
    // assert presence + that the well-formed rows weren't broken.
    assert.ok(report.plugins.some((p) => p.id === "broken-c@auriga-cli"));
  });
});

// ===========================================================================
// 5. PLUGINS (Codex) — three states (spec §6.3 codex row + §10.4)
// ===========================================================================
describe("scanState — Codex plugins tri-state", () => {
  test("toml lacks plugin entry → not-installed (spec §6.3)", async () => {
    const catalog = makeCatalog({
      plugins: {
        "auriga-go@auriga-cli": {
          description: "",
          agent: "codex",
          expectedVersion: "1.0.0",
        },
      },
    });
    const report = await scanState(makeScratch("c-not"), catalog, {
      readCodexConfig: async () => `# empty config\n`,
      readCodexPluginsDir: async () => new Map(),
    });
    const p = report.plugins.find((x) => x.id === "auriga-go@auriga-cli")!;
    assert.equal(p.status, "not-installed");
    assert.equal(p.agent, "codex");
  });

  test("toml enables + fs version matches catalog → installed (spec §6.3)", async () => {
    const catalog = makeCatalog({
      plugins: {
        "auriga-go@auriga-cli": {
          description: "",
          agent: "codex",
          expectedVersion: "1.0.0",
        },
      },
    });
    const report = await scanState(makeScratch("c-installed"), catalog, {
      readCodexConfig: async () =>
        `[plugins."auriga-go@auriga-cli"]\nenabled = true\n`,
      readCodexPluginsDir: async () =>
        new Map([["auriga-go@auriga-cli", "1.0.0"]]),
    });
    const p = report.plugins.find((x) => x.id === "auriga-go@auriga-cli")!;
    assert.equal(p.status, "installed");
    assert.equal(p.currentVersion, "1.0.0");
    assert.equal(p.expectedVersion, "1.0.0");
    assert.equal(p.versionSource, "catalog");
  });

  test("toml enables + fs version differs from catalog → update-available (spec §6.3)", async () => {
    const catalog = makeCatalog({
      plugins: {
        "auriga-go@auriga-cli": {
          description: "",
          agent: "codex",
          expectedVersion: "2.0.0",
        },
      },
    });
    const report = await scanState(makeScratch("c-update"), catalog, {
      readCodexConfig: async () =>
        `[plugins."auriga-go@auriga-cli"]\nenabled = true\n`,
      readCodexPluginsDir: async () =>
        new Map([["auriga-go@auriga-cli", "1.0.0"]]),
    });
    const p = report.plugins.find((x) => x.id === "auriga-go@auriga-cli")!;
    assert.equal(p.status, "update-available");
    assert.equal(p.currentVersion, "1.0.0");
    assert.equal(p.expectedVersion, "2.0.0");
  });

  test("readCodexConfig returns null + catalog has codex plugin → degraded + warning (spec §6.3)", async () => {
    const catalog = makeCatalog({
      plugins: {
        "auriga-go@auriga-cli": {
          description: "",
          agent: "codex",
          expectedVersion: "1.0.0",
        },
      },
    });
    const report = await scanState(makeScratch("c-no-cli"), catalog, {
      readCodexConfig: async () => null,
      readCodexPluginsDir: async () => new Map(),
    });
    assert.ok(
      report.warnings.some((w) => w.code === "codex-cli-missing"),
      "codex-cli-missing warning emitted when toml absent + catalog has codex expectation",
    );
  });

  test("readCodexConfig returns null + catalog has no codex plugins → no warning (spec §6.3)", async () => {
    const report = await scanState(makeScratch("c-vacuous"), makeCatalog(), {
      readCodexConfig: async () => null,
      readCodexPluginsDir: async () => new Map(),
    });
    assert.ok(
      !report.warnings.some((w) => w.code === "codex-cli-missing"),
      "no codex-cli-missing warning when there's nothing codex-expected to compare",
    );
  });

  test("toml enables but plugin missing from filesystem → row present, classified (assumption #2)", async () => {
    // Boundary: user has the plugin enabled in config.toml but the cache
    // directory was deleted. Per assumption #2, the row must remain in the
    // result so the user can re-install, with a status that signals "not
    // really working". We assert: row exists AND status is NOT "installed".
    const catalog = makeCatalog({
      plugins: {
        "auriga-go@auriga-cli": {
          description: "",
          agent: "codex",
          expectedVersion: "1.0.0",
        },
      },
    });
    const report = await scanState(makeScratch("c-broken"), catalog, {
      readCodexConfig: async () =>
        `[plugins."auriga-go@auriga-cli"]\nenabled = true\n`,
      readCodexPluginsDir: async () => new Map(), // not in fs
    });
    const p = report.plugins.find((x) => x.id === "auriga-go@auriga-cli")!;
    assert.ok(p, "row present even when fs/config disagree");
    assert.notEqual(
      p.status,
      "installed",
      "must not claim installed when plugin dir is gone",
    );
  });

  test("Codex catalog scoping: user has uncatalogued codex plugin → filtered out (spec §6.3 + §10.4)", async () => {
    // Per spec §6.3: "UI 仅展示 auriga-cli catalog 里登记的 plugins". User has
    // `random-thing@other-marketplace` installed (in toml + fs) but it is
    // not in catalog; the scanner must NOT surface it.
    const catalog = makeCatalog({
      plugins: {
        "auriga-go@auriga-cli": {
          description: "",
          agent: "codex",
          expectedVersion: "1.0.0",
        },
      },
    });
    const report = await scanState(makeScratch("c-scope"), catalog, {
      readCodexConfig: async () =>
        `[plugins."auriga-go@auriga-cli"]\nenabled = true\n` +
        `[plugins."random-thing@other-marketplace"]\nenabled = true\n`,
      readCodexPluginsDir: async () =>
        new Map([
          ["auriga-go@auriga-cli", "1.0.0"],
          ["random-thing@other-marketplace", "9.9.9"],
        ]),
    });
    assert.ok(
      !report.plugins.some((p) => p.id === "random-thing@other-marketplace"),
      "uncatalogued codex plugin filtered out",
    );
    assert.ok(
      report.plugins.some((p) => p.id === "auriga-go@auriga-cli"),
      "catalog plugin still present",
    );
  });
});

// ===========================================================================
// 6. HOOKS — three states + corrupt config + missing index (spec §6.3 hooks)
// ===========================================================================
describe("scanState — hooks tri-state + errors", () => {
  test("hooks.json absent → catalog hook not-installed (spec §6.3)", async () => {
    const catalog = makeCatalog({
      hooks: { notify: { description: "", expectedHash: "doesnt-matter" } },
    });
    const report = await scanState(fix("hooks-not-in-config"), catalog);
    const h = report.hooks.find((x: HookState) => x.name === "notify")!;
    assert.equal(h.status, "not-installed");
    assert.equal(h.currentHash, undefined);
  });

  test("hooks.json has entry + index.mjs hash matches catalog → installed (spec §6.3)", async () => {
    // Compute the expected hash dynamically from the fixture's index.mjs
    // bytes, so the test stays correct even if someone tweaks the stub
    // file's bytes later. This locks in the SHA256-of-file-bytes algorithm.
    const indexPath = path.join(
      fix("hooks-installed"),
      ".claude/hooks/notify/index.mjs",
    );
    const expectedHash = sha256File(indexPath);
    const catalog = makeCatalog({
      hooks: { notify: { description: "", expectedHash } },
    });
    const report = await scanState(fix("hooks-installed"), catalog);
    const h = report.hooks.find((x) => x.name === "notify")!;
    assert.equal(h.status, "installed");
    assert.equal(h.currentHash, expectedHash);
  });

  test("hooks.json has entry + index.mjs hash differs → update-available (spec §6.3)", async () => {
    // Catalog expects a hash that does NOT match the fixture's bytes.
    const catalog = makeCatalog({
      hooks: {
        notify: {
          description: "",
          expectedHash: "0".repeat(64), // 64-char hex but not the real bytes
        },
      },
    });
    const report = await scanState(fix("hooks-update"), catalog);
    const h = report.hooks.find((x) => x.name === "notify")!;
    assert.equal(h.status, "update-available");
    assert.notEqual(h.currentHash, h.expectedHash);
  });

  test("hooks.json malformed → category degraded but doesn't crash endpoint (boundary: corrupt JSON)", async () => {
    const catalog = makeCatalog({
      hooks: { notify: { description: "", expectedHash: "irrelevant" } },
    });
    let report: StateReport;
    await assert.doesNotReject(async () => {
      report = await scanState(fix("hooks-config-corrupt"), catalog);
    });
    // Hook row must still be present so user can repair; status must not
    // be silently "installed".
    const h = report!.hooks.find((x) => x.name === "notify");
    assert.ok(h, "hook row present even with corrupt hooks.json");
    assert.notEqual(h!.status, "installed", "do not falsely claim installed");
  });

  test("hooks.json lists the hook but index.mjs missing → per-item not classified as installed (assumption #2)", async () => {
    const catalog = makeCatalog({
      hooks: { notify: { description: "", expectedHash: "irrelevant" } },
    });
    const report = await scanState(fix("hooks-index-missing"), catalog);
    const h = report.hooks.find((x) => x.name === "notify");
    assert.ok(h, "row present so user can repair");
    assert.notEqual(
      h!.status,
      "installed",
      "cannot claim installed when index.mjs is missing",
    );
    assert.equal(h!.currentHash, undefined);
  });

  test("hooks.json contains entry but catalog doesn't → filtered out (boundary: catalog filter)", async () => {
    // hooks-installed/.claude/hooks/hooks.json has "notify" but our catalog
    // does NOT list notify. The result must omit it entirely.
    const report = await scanState(fix("hooks-installed"), makeCatalog());
    assert.equal(
      report.hooks.length,
      0,
      "uncatalogued hooks filtered out",
    );
  });
});

// ===========================================================================
// 7. PROPERTY-style cross-cutting assertions
// ===========================================================================
describe("scanState — property assertions across full reports", () => {
  test("two structurally different inputs with same catalog → same well-formed shape (property: shape invariant)", async () => {
    const catalog = makeCatalog({
      skills: {
        brainstorming: {
          description: "",
          expectedHash: "hash-brainstorming-current",
          isWorkflow: true,
        },
      },
      hooks: { notify: { description: "", expectedHash: "x" } },
    });
    const r1 = await scanState(fix("empty"), catalog);
    const r2 = await scanState(fix("skills-installed"), catalog);
    // Same number of catalog-derived rows regardless of fs state.
    assert.equal(
      r1.skills.length,
      r2.skills.length,
      "skill row count is a function of catalog, not fs state",
    );
    assert.equal(r1.hooks.length, r2.hooks.length);
    // Every category-array element must be a well-typed object: stable
    // top-level keys, valid `status` enum value.
    const VALID_STATUS = new Set([
      "installed",
      "update-available",
      "not-installed",
    ]);
    for (const r of [r1, r2]) {
      assert.ok(VALID_STATUS.has(r.workflow.status));
      for (const s of [...r.skills, ...r.recommendedSkills]) {
        assert.ok(VALID_STATUS.has(s.status), `skill ${s.name} status valid`);
        assert.equal(typeof s.name, "string");
        assert.equal(typeof s.isWorkflow, "boolean");
      }
      for (const p of r.plugins) {
        assert.ok(VALID_STATUS.has(p.status));
        assert.ok(p.agent === "claude" || p.agent === "codex");
      }
      for (const h of r.hooks) {
        assert.ok(VALID_STATUS.has(h.status));
        assert.equal(typeof h.name, "string");
      }
      for (const w of r.warnings) {
        assert.ok(
          ["claude-cli-missing", "codex-cli-missing", "marketplace-offline"].includes(w.code),
          `warning code ${w.code} is in the documented enum`,
        );
        assert.equal(typeof w.message, "string");
        assert.ok(w.message.length > 0, "warning message non-empty");
      }
    }
  });

  test("classifying the same project twice yields identical reports (property: determinism)", async () => {
    // Pure-function-ish: with the same inputs (fs + injected mocks), output
    // must be deterministic — no Date.now() / hash-set ordering escaping
    // into the report. Order-tolerance: sort by `name` / `id` before
    // comparing the per-category arrays.
    const catalog = makeCatalog({
      skills: {
        brainstorming: {
          description: "",
          expectedHash: "hash-brainstorming-current",
          isWorkflow: true,
        },
      },
      plugins: { "auriga-go@auriga-cli": { description: "", agent: "claude" } },
    });
    const opts: ScanOptions = {
      execPluginList: mockExec({
        installed: [{ id: "auriga-go@auriga-cli", version: "v1.0.0" }],
        available: [
          { id: "auriga-go@auriga-cli", source: { ref: "v1.0.0" } },
        ],
      }),
    };
    const r1 = await scanState(fix("skills-installed"), catalog, opts);
    const r2 = await scanState(fix("skills-installed"), catalog, opts);
    const sortByName = <T extends { name?: string; id?: string }>(arr: T[]) =>
      [...arr].sort((a, b) => (a.name ?? a.id ?? "").localeCompare(b.name ?? b.id ?? ""));
    assert.deepEqual(sortByName(r1.skills), sortByName(r2.skills));
    assert.deepEqual(sortByName(r1.plugins), sortByName(r2.plugins));
    assert.deepEqual(r1.workflow, r2.workflow);
  });

  test("warnings is always an array (never undefined) (property: shape invariant)", async () => {
    // Even when there's nothing to warn about, `warnings` must be present
    // as an empty array — the UI does `report.warnings.map(...)` and
    // would crash on undefined.
    const r = await scanState(makeScratch("warnings-shape"), makeCatalog());
    assert.ok(Array.isArray(r.warnings));
  });
});

// ===========================================================================
// 8. Composite scenario — multiple categories interact in one call
// ===========================================================================
describe("scanState — composite full-report scenario", () => {
  let scratch: string;
  beforeEach(() => {
    scratch = makeScratch("composite");
    // CLAUDE.md at v1.4.0 (catalog will be v1.6.0 → update-available)
    fs.writeFileSync(
      path.join(scratch, "CLAUDE.md"),
      `# auriga Workflow (v1.4.0)\n\nbody\n`,
    );
    // skills-lock.json with brainstorming at known hash
    fs.writeFileSync(
      path.join(scratch, "skills-lock.json"),
      JSON.stringify({
        version: 1,
        skills: {
          brainstorming: {
            source: "obra/superpowers",
            sourceType: "github",
            skillPath: "skills/brainstorming/SKILL.md",
            computedHash: "hash-brainstorming-current",
          },
        },
      }),
    );
    // notify hook installed
    const hookDir = path.join(scratch, ".claude/hooks/notify");
    fs.mkdirSync(hookDir, { recursive: true });
    fs.writeFileSync(path.join(hookDir, "index.mjs"), "export default 1\n");
    fs.writeFileSync(
      path.join(scratch, ".claude/hooks/hooks.json"),
      JSON.stringify({
        hooks: [
          {
            name: "notify",
            description: "",
            runtimePlatforms: ["darwin"],
            settingsEvents: [{ event: "Notification" }],
            command: 'node "$HOOK_DIR/index.mjs"',
            files: ["index.mjs"],
            marker: "auriga:notify",
          },
        ],
      }),
    );
  });

  test("workflow update + skill installed + hook installed + claude plugin update + codex plugin not-installed all coexist (property: cross-category independence)", async () => {
    const expectedHookHash = sha256File(
      path.join(scratch, ".claude/hooks/notify/index.mjs"),
    );
    const catalog = makeCatalog({
      workflowVersion: "1.6.0",
      skills: {
        brainstorming: {
          description: "Brainstorm",
          expectedHash: "hash-brainstorming-current",
          isWorkflow: true,
        },
      },
      plugins: {
        "auriga-go@auriga-cli": { description: "Claude plugin", agent: "claude" },
        "codex-thing@auriga-cli": {
          description: "Codex plugin",
          agent: "codex",
          expectedVersion: "1.0.0",
        },
      },
      hooks: { notify: { description: "", expectedHash: expectedHookHash } },
    });
    const report = await scanState(scratch, catalog, {
      execPluginList: mockExec({
        installed: [{ id: "auriga-go@auriga-cli", version: "v1.0.0" }],
        available: [
          { id: "auriga-go@auriga-cli", source: { ref: "v2.0.0" } },
        ],
      }),
      readCodexConfig: async () => `# nothing\n`,
      readCodexPluginsDir: async () => new Map(),
    });

    assert.equal(report.workflow.status, "update-available");
    assert.equal(report.workflow.currentVersion, "1.4.0");

    const sk = report.skills.find((s) => s.name === "brainstorming")!;
    assert.equal(sk.status, "installed");

    const cp = report.plugins.find((p) => p.id === "auriga-go@auriga-cli")!;
    assert.equal(cp.status, "update-available");
    assert.equal(cp.agent, "claude");

    const xp = report.plugins.find((p) => p.id === "codex-thing@auriga-cli")!;
    assert.equal(xp.status, "not-installed");
    assert.equal(xp.agent, "codex");

    const hk = report.hooks.find((h) => h.name === "notify")!;
    assert.equal(hk.status, "installed");
    assert.equal(hk.currentHash, expectedHookHash);

    // No warnings: both injection points satisfied, no degraded category.
    assert.equal(
      report.warnings.length,
      0,
      `expected zero warnings, got: ${JSON.stringify(report.warnings)}`,
    );
  });
});
