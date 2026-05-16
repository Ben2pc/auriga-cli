// =============================================================================
// scanState behavioral test suite — TDD red phase (Web UI scanner rewrite)
// =============================================================================
//
// This file is the contract for the rewritten `scanState` function in
// src/state.ts. The rewrite changes the truth sources from auriga-cli's own
// dev-repo layout (e.g. `<cwd>/skills-lock.json`, `<cwd>/.claude/hooks/hooks.json`)
// to Claude Code's *actual* install locations, per scope:
//
//   Workflow user      → ~/.claude/CLAUDE.md
//   Workflow project   → <proj>/CLAUDE.md  (first)
//                        <proj>/.claude/CLAUDE.md  (fallback)
//   Skills user        → ~/.claude/skills/<name>/SKILL.md
//   Skills project     → <proj>/.claude/skills/<name>/SKILL.md
//   Plugins user       → `claude plugins list --user --json`
//                        + ~/.claude/settings.json `enabledPlugins`
//   Plugins project    → `claude plugins list --project --json`
//                        + <proj>/.claude/settings.json
//   Plugins (Codex)    → ~/.codex/config.toml + cache (user-scope only)
//   Hooks user         → ~/.claude/settings.json `hooks.<Event>[]` matched by `_marker`
//   Hooks project      → <proj>/.claude/settings.json same shape
//
// All tests below assert the rewritten public surface only — they DO NOT
// import any internal helper from state.ts beyond `scanState` itself.
//
// =============================================================================
// REQUIRED PUBLIC API SURFACE (asserted by these tests)
// =============================================================================
//
//   scanState(
//     projectRoot: string,
//     catalog: Catalog,
//     opts?: ScanOptions,
//   ): Promise<StateReport>
//
//   ScanOptions:
//     execPluginList?: (scope: 'user' | 'project') => Promise<{ installed, available }>
//       (Note: signature gains a scope arg so tests can verify the right
//        --user / --project flag flows through. The implementation may also
//        accept the legacy zero-arg form, but it MUST honor the scope arg
//        when the test passes it through opts.scopes.plugins.)
//     readCodexConfig?: () => Promise<string | null>
//     readCodexPluginsDir?: () => Promise<Map<string, string>>
//     scopes?: {
//       workflow?: 'user' | 'project'   // default: 'project'
//       skills?:   'user' | 'project'   // default: 'project'
//       plugins?:  'user' | 'project'   // default: 'user'
//       hooks?:    'user' | 'project'   // default: 'user'
//     }
//     // homeDir is OPTIONAL — implementation MAY accept it for testability;
//     // if absent, the implementation must read process.env.HOME via
//     // os.homedir(). Tests use process.env.HOME redirection so both
//     // contracts pass.
//     homeDir?: string
//
//   StateReport:
//     workflow:           WorkflowState   (now carries observedScope)
//     skills:             SkillState[]    (each carries observedScope)
//     recommendedSkills:  SkillState[]    (each carries observedScope)
//     plugins:            PluginState[]   (each carries observedScope)
//     warnings:           StateWarning[]
//
//   WorkflowState extends prior shape with: observedScope: 'user' | 'project'
//   SkillState    extends prior shape with: observedScope: 'user' | 'project'
//   PluginState   extends prior shape with: observedScope: 'user' | 'project'
//
//   StateWarning.code union must include (in addition to existing codes):
//     - "claude-code-not-installed"   (both ~/.claude and <proj>/.claude absent)
//     - "settings-unreadable"         (settings.json corrupt / unreadable)
//     - "skill-malformed"             (skill dir present but SKILL.md missing/broken)
//     - "workflow-foreign-claudemd"   (CLAUDE.md exists but no auriga marker)
//
// =============================================================================
// KEY ASSUMPTIONS (where the spec is ambiguous or silent)
// =============================================================================
//
//   A1. **Workflow CLAUDE.md exists but no auriga marker** → status
//       "not-installed" + warning code "workflow-foreign-claudemd". The file
//       is foreign content, not an installed auriga workflow. Install path
//       (src/workflow.ts) protects user content via CLAUDE.md.bak backup,
//       so the scanner can report not-installed honestly. (Revised in v1.18.5
//       — pre-v1.18.5 the row was conflated as "installed + workflow-unknown-
//       version warning" which caused the $HOME-as-projectRoot bug.)
//
//   A2. **Skills via filesystem**: a SKILL.md present under
//       `<scope>/skills/<name>/` classifies as "installed"; missing →
//       "not-installed". v1.19.0 dropped hash-based drift detection — the
//       scanner is presence-only; re-install is the update path.
//
//   A3. **Skill malformed**: a directory exists under `<scope>/skills/<name>/`
//       but `SKILL.md` is missing or unreadable → row present with status
//       "installed" + a warning `skill-malformed`. (Per spec degraded-path
//       row "Skills 目录里某子目录的 SKILL.md 损坏 / 缺失".)
//
//   A4. **Hooks via settings.json marker**: the scanner reads
//       `settings.json` and walks `hooks.<Event>[].hooks[]` looking for an
//       entry whose `_marker` sentinel value equals the catalog hook's name
//       (or a catalog-specified `marker` field). Tests use `_marker:
//       "<hook-name>"` matching by name; the implementation is free to use
//       a richer marker shape so long as the catalog hook name appears
//       somewhere in the marker chain.
//
//   A5. **Settings.json corrupt** → all catalog hooks classify as
//       "not-installed" PLUS one warning `settings-unreadable`. The whole
//       endpoint must not throw. (Per spec degraded-path row.)
//
//   A6. **Settings.json absent** → all catalog hooks classify as
//       "not-installed" with NO warning (common case for fresh user).
//
//   A8. **No Claude install at all**: neither `~/.claude/` nor
//       `<proj>/.claude/` exists → emit ONE `claude-code-not-installed`
//       warning regardless of how many user-scope categories are scanned.
//
//   A9. **Default scopes** (when opts.scopes omitted entirely):
//          workflow = 'project'
//          skills   = 'project'
//          plugins  = 'user'
//          hooks    = 'user'
//       (Match install defaults per spec "UI 行为" section.)
//
//   A10. **observedScope reflects what was scanned**, not what was found.
//        E.g. if scopes.workflow === 'user' and ~/.claude/CLAUDE.md is
//        absent, the workflow row still reports observedScope: 'user'.
//
//   A11. **execPluginList scope arg**: the test's mock receives the scope
//        ('user' or 'project') as its first argument so we can assert the
//        right flag flowed through. Implementations using the legacy
//        zero-arg form must be updated to accept the scope arg.
//
// =============================================================================
// WHAT IS NOT ASSERTED
// =============================================================================
//
//   - Exact wording of warning `message` fields (tests assert `.code` only).
//   - Internal function names (no imports beyond `scanState` + `mergePluginsById`).
//   - File-system traversal strategy / caching.
//   - Order of items within each category array (use .find / .some).
//
// Every test name carries its scenario number from the brief
// (e.g. "#7 skills/user happy path").
// =============================================================================

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { mergePluginsById, scanState } from "../src/state.js";
import type { Catalog, ScanOptions } from "../src/state.js";
import { generateCatalog } from "../src/build/generate-catalog.js";
import type {
  ItemStatus,
  PluginState,
  SkillState,
  StateReport,
  StateWarning,
} from "../src/api-types.js";

const REPO_ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

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

/** Save + restore HOME / USERPROFILE around a block. Required because the
 *  scanner reads `os.homedir()` (which consults these envs) to compute the
 *  user-scope truth source. Tests MUST NEVER touch the real $HOME. */
const homeStash: { home?: string; userprofile?: string } = {};
function redirectHome(to: string): void {
  homeStash.home = process.env.HOME;
  homeStash.userprofile = process.env.USERPROFILE;
  process.env.HOME = to;
  // On Windows, os.homedir() prefers USERPROFILE; set both for safety.
  process.env.USERPROFILE = to;
}
function restoreHome(): void {
  if (homeStash.home === undefined) delete process.env.HOME;
  else process.env.HOME = homeStash.home;
  if (homeStash.userprofile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = homeStash.userprofile;
  homeStash.home = undefined;
  homeStash.userprofile = undefined;
}
afterEach(() => restoreHome());

/** Build a Catalog with everything defaulted to empty. */
function makeCatalog(over: Partial<Catalog> = {}): Catalog {
  return {
    skills: {},
    recommendedSkills: {},
    plugins: {},
    ...over,
  };
}

/** Write a CLAUDE.md file with the auriga workflow header at the given version. */
function writeWorkflowFile(p: string, version: string | null, extraBody = ""): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const header = version === null ? "# Some Other Heading\n" : `# auriga Workflow (v${version})\n`;
  fs.writeFileSync(p, header + "\nbody\n" + extraBody);
}

/** Materialize a skill at the given dir with a SKILL.md whose body matches
 *  the supplied content. Returns the content so the caller can hash it. */
function writeSkill(skillDir: string, content: string): void {
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), content);
}

/** Spy: returns an execPluginList mock that records the scope arg it was
 *  called with, alongside the fixed payload it returns. Tests assert the
 *  recorded scope to verify --user / --project flag plumbing. */
function spyExec(payload: { installed: any[]; available: any[] }): {
  fn: NonNullable<ScanOptions["execPluginList"]>;
  calls: Array<unknown>;
} {
  const calls: unknown[] = [];
  // Implementations may invoke with zero args or with a scope arg; we accept
  // both shapes and record whatever shows up at args[0].
  const fn = (async (...args: unknown[]) => {
    calls.push(args[0]);
    return payload;
  }) as NonNullable<ScanOptions["execPluginList"]>;
  return { fn, calls };
}

/** Convenience: build the default Codex injectors (no codex anywhere). */
const codexNone: Pick<ScanOptions, "readCodexConfig" | "readCodexPluginsDir"> = {
  readCodexConfig: async () => null,
  readCodexPluginsDir: async () => new Map(),
};

/** Cast helper: scopes is a new field on ScanOptions; until the
 *  implementation lands, TS may complain. Tests cast through `any` at the
 *  call site rather than the helper itself to keep the test code legible. */
type AnyScanOptions = ScanOptions & {
  scopes?: {
    workflow?: "user" | "project";
    skills?: "user" | "project";
    plugins?: "user" | "project";
  };
  homeDir?: string;
};
function scan(
  projectRoot: string,
  catalog: Catalog,
  opts: AnyScanOptions = {},
): Promise<StateReport> {
  return scanState(projectRoot, catalog, opts as ScanOptions);
}

function generatedScanCatalog(): Catalog {
  const generated = generateCatalog(REPO_ROOT);
  return {
    skills: Object.fromEntries(
      generated.workflowSkills.map((entry) => [
        entry.name,
        { description: entry.description, isWorkflow: true },
      ]),
    ),
    recommendedSkills: Object.fromEntries(
      generated.recommendedSkills.map((entry) => [
        entry.name,
        { description: entry.description },
      ]),
    ),
    plugins: Object.fromEntries(
      generated.plugins.map((entry) => [
        entry.name,
        {
          description: entry.description,
          agents: entry.agents ?? ["claude"],
          ...(entry.external === true ? { external: true } : {}),
        },
      ]),
    ),
  };
}

describe("scanState — generated catalog migration surface", () => {
  test("Web UI rows expose migrated assets as plugins, not standalone skills", async () => {
    // rationale: /api/state uses the generated catalog as its row source.
    // Migrated repo-owned assets must therefore disappear from the Web UI's
    // standalone skill column and reappear in the plugin column.
    const home = makeScratch("home-migrated-catalog");
    redirectHome(home);
    const report = await scan(makeScratch("proj-migrated-catalog"), generatedScanCatalog(), {
      execPluginList: async () => ({ installed: [] }),
      readCodexConfig: async () => "",
      readCodexPluginsDir: async () => new Map(),
      homeDir: home,
    });

    const skillNames = report.skills.map((s) => s.name).sort();
    for (const name of ["incremental-impl", "test-designer", "session-compound"]) {
      assert.equal(skillNames.includes(name), false, `${name} must not render as a standalone skill row`);
    }

    const pluginNames = report.plugins.map((p) => p.id).sort();
    assert.ok(pluginNames.includes("auriga-workflow"));
    assert.ok(pluginNames.includes("auriga-notify"));
  });
});

// ===========================================================================
// #1 — Workflow / user scope: happy path
// ===========================================================================
describe("scanState — #1 Workflow / user scope happy path", () => {
  test("#1 workflow/user installed with version match", async () => {
    // rationale: catches scanner still reading <proj>/CLAUDE.md when scope=user
    const home = makeScratch("home1");
    writeWorkflowFile(path.join(home, ".claude", "CLAUDE.md"), "1.6.0");
    redirectHome(home);

    const report = await scan(makeScratch("proj1"), makeCatalog(), {
      scopes: { workflow: "user" },
      homeDir: home, // belt-and-suspenders for impls that prefer opts.homeDir
    });

    assert.equal(report.workflow.status, "installed");
    assert.equal((report.workflow as any).observedScope, "user");
  });
});

// ===========================================================================
// #2 — Workflow / user scope: missing file
// ===========================================================================
describe("scanState — #2 Workflow / user scope missing file", () => {
  test("#2 workflow/user not-installed when ~/.claude/CLAUDE.md absent", async () => {
    // rationale: catches false-positive when scanner falls back to <proj>/CLAUDE.md
    const home = makeScratch("home2");
    redirectHome(home);
    // Project DOES have CLAUDE.md to ensure scanner isn't bleeding scopes.
    const proj = makeScratch("proj2");
    writeWorkflowFile(path.join(proj, "CLAUDE.md"), "1.6.0");

    const report = await scan(proj, makeCatalog(), {
      scopes: { workflow: "user" },
      homeDir: home,
    });

    assert.equal(report.workflow.status, "not-installed");
    assert.equal((report.workflow as any).observedScope, "user");
  });
});

// ===========================================================================
// #4 — Workflow / project scope: happy path (scanner is presence-only since
// v1.19.0 — no version comparison; tests #3 / #3b that asserted
// update-available semantics were deleted with that surface)
// ===========================================================================
describe("scanState — #4 Workflow / project scope happy path", () => {
  test("#4 workflow/project installed reads <proj>/CLAUDE.md", async () => {
    // rationale: catches scanner still reading <cwd>/CLAUDE.md (dev-repo path)
    const home = makeScratch("home4");
    redirectHome(home);
    const proj = makeScratch("proj4");
    writeWorkflowFile(path.join(proj, "CLAUDE.md"), "1.6.0");

    const report = await scan(proj, makeCatalog(), {
      scopes: { workflow: "project" },
      homeDir: home,
    });

    assert.equal(report.workflow.status, "installed");
    assert.equal((report.workflow as any).observedScope, "project");
  });
});

// ===========================================================================
// #5 — Workflow / project scope: does NOT fall back to .claude/CLAUDE.md
// ===========================================================================
describe("scanState — #5 Workflow / project scope no .claude/CLAUDE.md fallback", () => {
  test("#5 workflow/project does NOT fall back to <proj>/.claude/CLAUDE.md", async () => {
    // rationale: the v1.18.4 verification (running web-ui from $HOME) showed
    // the old fallback collapsing project-scope onto user-scope when
    // projectRoot === $HOME — `<proj>/.claude/CLAUDE.md` and
    // `$HOME/.claude/CLAUDE.md` are the same file. The auriga installer
    // (src/workflow.ts) writes ONLY to `<proj>/CLAUDE.md`; there was never
    // a real installer convention placing the workflow under `.claude/`.
    // (Pre-v1.18.5 this test asserted the opposite — that the fallback
    // worked. It was documenting a bug.)
    const home = makeScratch("home5");
    redirectHome(home);
    const proj = makeScratch("proj5");
    // NO file at <proj>/CLAUDE.md, only at <proj>/.claude/CLAUDE.md
    writeWorkflowFile(path.join(proj, ".claude", "CLAUDE.md"), "1.6.0");

    const report = await scan(proj, makeCatalog(), {
      scopes: { workflow: "project" },
      homeDir: home,
    });

    assert.equal(report.workflow.status, "not-installed", "must not pick up the .claude/ subdir file");
  });
});

// ===========================================================================
// #6 — Workflow / foreign CLAUDE.md (file exists, no auriga marker)
// ===========================================================================
describe("scanState — #6 Workflow foreign-CLAUDE.md", () => {
  test("#6 workflow file exists but no auriga marker → not-installed + workflow-foreign-claudemd warning", async () => {
    // rationale: a CLAUDE.md without our header is foreign content, not
    // an installed auriga workflow. The v1.18.4 verification (running
    // web-ui from $HOME) showed the user's `# Global`-headed
    // ~/.claude/CLAUDE.md was being reported as `installed`, which is
    // wrong. Install path protects user content via CLAUDE.md.bak backup
    // — the scanner can honestly report `not-installed`.
    const home = makeScratch("home6");
    redirectHome(home);
    const proj = makeScratch("proj6");
    writeWorkflowFile(path.join(proj, "CLAUDE.md"), null /* no marker */);

    const report = await scan(proj, makeCatalog(), {
      scopes: { workflow: "project" },
      homeDir: home,
    });

    assert.equal(report.workflow.status, "not-installed", "foreign CLAUDE.md is not our workflow");
    assert.ok(
      report.warnings.some((w: StateWarning) => (w.code as string) === "workflow-foreign-claudemd"),
      "must emit workflow-foreign-claudemd warning",
    );
  });

});

// ===========================================================================
// #7 — Skills / user scope: filesystem happy path
// ===========================================================================
describe("scanState — #7 Skills / user scope happy path", () => {
  test("#7 skills/user reads ~/.claude/skills/<name>/SKILL.md filesystem", async () => {
    // rationale: catches scanner still consulting skills-lock.json
    const home = makeScratch("home7");
    redirectHome(home);
    const content = "---\nname: systematic-debugging\nversion: 1.0.0\n---\nbody";
    writeSkill(path.join(home, ".claude", "skills", "systematic-debugging"), content);

    const catalog = makeCatalog({
      skills: {
        "systematic-debugging": { description: "B", isWorkflow: true },
      },
    });
    const report = await scan(makeScratch("proj7"), catalog, {
      scopes: { skills: "user" },
      homeDir: home,
    });

    const s = report.skills.find((x: SkillState) => x.name === "systematic-debugging");
    assert.ok(s, "skill row present");
    assert.equal(s!.status, "installed");
    assert.equal((s! as any).observedScope, "user");
  });
});

// ===========================================================================
// #8 — Skills / user scope: partial installation
// ===========================================================================
describe("scanState — #8 Skills / user scope partial", () => {
  test("#8 skills/user partial: present skill installed, absent skill not-installed, all observedScope='user'", async () => {
    // rationale: catches scanner short-circuiting whole category when one skill missing
    const home = makeScratch("home8");
    redirectHome(home);
    const content = "---\nname: systematic-debugging\n---\nbody";
    writeSkill(path.join(home, ".claude", "skills", "systematic-debugging"), content);

    const catalog = makeCatalog({
      skills: {
        "systematic-debugging": { description: "", isWorkflow: true },
        "not-on-disk": { description: "", isWorkflow: true },
      },
    });
    const report = await scan(makeScratch("proj8"), catalog, {
      scopes: { skills: "user" },
      homeDir: home,
    });

    const present = report.skills.find((x) => x.name === "systematic-debugging")!;
    const missing = report.skills.find((x) => x.name === "not-on-disk")!;
    assert.equal(present.status, "installed");
    assert.equal(missing.status, "not-installed");
    // Property assertion: every row reports its scanned scope, not just installed ones.
    for (const s of report.skills) {
      assert.equal((s as any).observedScope, "user", `${s.name} must carry observedScope='user'`);
    }
  });
});

// ===========================================================================
// #9 — Skills / project scope: filesystem same shape
// ===========================================================================
describe("scanState — #9 Skills / project scope", () => {
  test("#9 skills/project reads <proj>/.claude/skills/<name>/SKILL.md", async () => {
    // rationale: catches scanner reading from wrong scope's filesystem
    const home = makeScratch("home9");
    redirectHome(home);
    const proj = makeScratch("proj9");
    const content = "---\nname: systematic-debugging\n---\nbody";
    writeSkill(path.join(proj, ".claude", "skills", "systematic-debugging"), content);

    const catalog = makeCatalog({
      skills: {
        "systematic-debugging": { description: "", isWorkflow: true },
      },
    });
    const report = await scan(proj, catalog, {
      scopes: { skills: "project" },
      homeDir: home,
    });

    const s = report.skills.find((x) => x.name === "systematic-debugging")!;
    assert.equal(s.status, "installed");
    assert.equal((s as any).observedScope, "project");
  });
});

// ===========================================================================
// #10 — Skills / SKILL.md unreadable but dir present → skill-malformed warning
// ===========================================================================
describe("scanState — #10 Skills malformed (dir present, SKILL.md missing)", () => {
  test("#10 skills/user skill-malformed: dir exists but SKILL.md missing → row installed + warning, others unaffected", async () => {
    // rationale: catches scanner crashing or silently dropping the malformed
    // row, leaving the user unable to repair
    const home = makeScratch("home10");
    redirectHome(home);
    // systematic-debugging: dir exists but SKILL.md does NOT
    fs.mkdirSync(path.join(home, ".claude", "skills", "systematic-debugging"), { recursive: true });
    // healthy skill so we can assert isolation
    const healthyContent = "---\nname: healthy\n---\nok";
    writeSkill(path.join(home, ".claude", "skills", "healthy"), healthyContent);

    const catalog = makeCatalog({
      skills: {
        "systematic-debugging": { description: "", isWorkflow: true },
        healthy: { description: "", isWorkflow: false },
      },
    });
    let report: StateReport;
    await assert.doesNotReject(async () => {
      report = await scan(makeScratch("proj10"), catalog, {
        scopes: { skills: "user" },
        homeDir: home,
      });
    }, "scanState must not throw on malformed skill");

    const broken = report!.skills.find((x) => x.name === "systematic-debugging")!;
    const ok = report!.skills.find((x) => x.name === "healthy")!;
    assert.ok(broken, "row present for malformed skill so user can repair");
    assert.equal(broken.status, "installed", "directory presence means installed; SKILL.md missing → warning");
    assert.ok(
      report!.warnings.some((w) => (w.code as string) === "skill-malformed"),
      "must emit skill-malformed warning",
    );
    assert.equal(ok.status, "installed", "healthy skill unaffected by malformed sibling");
  });
});

// ===========================================================================
// #11 — Skills / drift detection deliberately deferred to `npx skills update`
// ===========================================================================
describe("scanState — #11 Skills presence-only (no content drift)", () => {
  test("#11 skill content drift never flips status (scanner is presence-only)", async () => {
    // rationale: v1.19.0 dropped update-available status — re-running
    // install is the update path. Drift detection deliberately deferred
    // to `npx skills update --project`, which compares against each
    // skill's own upstream HEAD. This test pins the contract so a future
    // regression that re-introduces hash comparison would fail here.
    const home = makeScratch("home11");
    redirectHome(home);
    const onDisk = "---\nname: systematic-debugging\nversion: 0.9.0\n---\nold";
    writeSkill(path.join(home, ".claude", "skills", "systematic-debugging"), onDisk);

    const catalog = makeCatalog({
      skills: {
        "systematic-debugging": { description: "", isWorkflow: true },
      },
    });
    const report = await scan(makeScratch("proj11"), catalog, {
      scopes: { skills: "user" },
      homeDir: home,
    });

    const s = report.skills.find((x) => x.name === "systematic-debugging")!;
    assert.equal(
      s.status,
      "installed",
      "presence-only: SKILL.md present → installed regardless of content",
    );
    assert.equal((s as any).observedScope, "user");
  });
});

// ===========================================================================
// #12 — Plugins (Claude) / user scope: happy path via execPluginList
// ===========================================================================
describe("scanState — #12 Plugins (Claude) / user scope happy path", () => {
  test("#12 plugins/claude user installed when execPluginList returns matching entry", async () => {
    // rationale: catches scanner reading the wrong source-of-truth for plugin install state
    const home = makeScratch("home12");
    redirectHome(home);
    const spy = spyExec({
      installed: [{ id: "auriga-go@auriga-cli", version: "v1.0.0" }],
      available: [{ id: "auriga-go@auriga-cli", source: { ref: "v1.0.0" } }],
    });
    const catalog = makeCatalog({
      plugins: { "auriga-go@auriga-cli": { description: "", agents: ["claude"] } },
    });

    const report = await scan(makeScratch("proj12"), catalog, {
      execPluginList: spy.fn,
      scopes: { plugins: "user" },
      homeDir: home,
      ...codexNone,
    });

    const p = report.plugins.find((x) => x.id === "auriga-go@auriga-cli")!;
    assert.equal(p.status, "installed");
    assert.equal((p as any).observedScope, "user");
    assert.deepEqual(p.agents, ["claude"]);
  });
});

// ===========================================================================
// #12b — Plugins (Claude) / presence-only: no version field → still installed
// ===========================================================================
describe("scanState — #12b Plugins (Claude) presence-only contract", () => {
  test("#12b plugins/claude installed=true when record exists without a version field (v1.19.0 presence-only)", async () => {
    // rationale: v1.19.0 dropped version comparison; classifyClaudePlugin
    // must NOT require installed.version to be a string. If a future
    // `claude plugins list` shape omits the version field for installed
    // entries, the scanner should still report the row as installed.
    // Re-introducing a version-string requirement would falsely flip
    // the UI to "not-installed" → push the user toward unnecessary
    // re-installs.
    const home = makeScratch("home12b");
    redirectHome(home);
    const spy = spyExec({
      installed: [{ id: "auriga-go@auriga-cli" }], // no version field
      available: [{ id: "auriga-go@auriga-cli" }],
    });
    const catalog = makeCatalog({
      plugins: { "auriga-go@auriga-cli": { description: "", agents: ["claude"] } },
    });

    const report = await scan(makeScratch("proj12b"), catalog, {
      execPluginList: spy.fn,
      scopes: { plugins: "user" },
      homeDir: home,
      ...codexNone,
    });

    const p = report.plugins.find((x) => x.id === "auriga-go@auriga-cli")!;
    assert.equal(p.status, "installed");
  });
});

// ===========================================================================
// #13 — Plugins (Claude) / project scope: scope flag plumbed through
// ===========================================================================
describe("scanState — #13 Plugins (Claude) / project scope flag plumbing", () => {
  test("#13 plugins/claude project: execPluginList receives 'project' scope arg", async () => {
    // rationale: catches scanner always calling `claude plugins list --user`
    // regardless of opts.scopes.plugins, OR silently passing the wrong flag
    const home = makeScratch("home13");
    redirectHome(home);
    const spy = spyExec({
      installed: [{ id: "auriga-go@auriga-cli", version: "v1.0.0" }],
      available: [{ id: "auriga-go@auriga-cli", source: { ref: "v1.0.0" } }],
    });
    const catalog = makeCatalog({
      plugins: { "auriga-go@auriga-cli": { description: "", agents: ["claude"] } },
    });

    const report = await scan(makeScratch("proj13"), catalog, {
      execPluginList: spy.fn,
      scopes: { plugins: "project" },
      homeDir: home,
      ...codexNone,
    });

    // Spy assertion: at least one call recorded a scope arg of 'project'.
    assert.ok(
      spy.calls.some((c) => c === "project"),
      `expected execPluginList to be called with 'project', got calls=${JSON.stringify(spy.calls)}`,
    );
    const p = report.plugins.find((x) => x.id === "auriga-go@auriga-cli")!;
    assert.equal((p as any).observedScope, "project");
  });
});

// ===========================================================================
// #14 — Plugins (Claude) / `claude` missing → degraded + warning
// ===========================================================================
describe("scanState — #14 Plugins (Claude) CLI missing degraded path", () => {
  test("#14 plugins/claude: execPluginList absent → degraded rows + claude-cli-missing warning", async () => {
    // rationale: catches scanner crashing or silently producing no rows when claude CLI missing
    const home = makeScratch("home14");
    redirectHome(home);
    const catalog = makeCatalog({
      plugins: { "auriga-go@auriga-cli": { description: "", agents: ["claude"] } },
    });

    const report = await scan(makeScratch("proj14"), catalog, {
      scopes: { plugins: "user" },
      homeDir: home,
      // NOTE: execPluginList intentionally omitted
      ...codexNone,
    });

    assert.ok(
      report.warnings.some((w) => w.code === "claude-cli-missing"),
      "claude-cli-missing warning required when CLI absent + catalog has claude plugin",
    );
    // Row still present; observedScope still reported.
    const p = report.plugins.find((x) => x.id === "auriga-go@auriga-cli");
    assert.ok(p, "degraded row still present");
    assert.equal((p as any).observedScope, "user");
  });

  test("#14b plugins/claude: execPluginList throws → degraded + warning, no crash", async () => {
    // rationale: catches scanner letting a CLI exception bubble to /api/state
    const home = makeScratch("home14b");
    redirectHome(home);
    const catalog = makeCatalog({
      plugins: { "auriga-go@auriga-cli": { description: "", agents: ["claude"] } },
    });
    const thrower = (async () => {
      throw new Error("ENOENT: claude");
    }) as NonNullable<ScanOptions["execPluginList"]>;

    let report: StateReport;
    await assert.doesNotReject(async () => {
      report = await scan(makeScratch("proj14b"), catalog, {
        execPluginList: thrower,
        scopes: { plugins: "user" },
        homeDir: home,
        ...codexNone,
      });
    });
    assert.ok(
      report!.warnings.some((w) => w.code === "claude-cli-missing"),
      "throw must surface as claude-cli-missing warning",
    );
  });
});

// ===========================================================================
// #14d — Plugins (Claude) / external flag preserved
// ===========================================================================
describe("scanState — #14d Plugins (Claude) external flag", () => {
  test("#14d external plugin shape: status installed when present; carries external:true", async () => {
    // rationale: external-marketplace plugins (skill-creator etc.) install
    // through Claude Code's marketplace; the `external` flag is a pure UI
    // hint that upgrades go through `claude plugins update`, not us. The
    // scanner must surface this flag on every row regardless of install
    // state so the EXTERNAL badge renders consistently.
    const home = makeScratch("home14d");
    redirectHome(home);
    const catalog = makeCatalog({
      plugins: {
        "skill-creator@claude-plugins-official": {
          description: "",
          agents: ["claude"],
          external: true,
        },
      },
    });
    const report = await scan(makeScratch("proj14d"), catalog, {
      execPluginList: (async () => ({
        installed: [
          { id: "skill-creator@claude-plugins-official", version: "1.0.0" },
        ],
      })) as NonNullable<ScanOptions["execPluginList"]>,
      scopes: { plugins: "user" },
      homeDir: home,
      ...codexNone,
    });

    const p = report.plugins.find(
      (x) => x.id === "skill-creator@claude-plugins-official",
    )!;
    assert.equal(p.status, "installed");
    assert.equal((p as any).external, true);
  });
});

// ===========================================================================
// #15 — Plugins (Codex) / unchanged behavior: still works
// ===========================================================================
describe("scanState — #15 Plugins (Codex) sanity (unchanged behavior)", () => {
  test("#15 plugins/codex installed when toml enables + fs version present", async () => {
    // rationale: catches the rewrite accidentally breaking the existing
    // codex scanner (Codex is user-scope only and stays so)
    const home = makeScratch("home15");
    redirectHome(home);
    const catalog = makeCatalog({
      plugins: {
        "auriga-go@auriga-cli": { description: "", agents: ["codex"] },
      },
    });
    const report = await scan(makeScratch("proj15"), catalog, {
      readCodexConfig: async () => `[plugins."auriga-go@auriga-cli"]\nenabled = true\n`,
      readCodexPluginsDir: async () => new Map([["auriga-go@auriga-cli", "1.0.0"]]),
      homeDir: home,
    });

    const p = report.plugins.find((x) => x.id === "auriga-go@auriga-cli")!;
    assert.equal(p.status, "installed");
    // Codex is user-scope only.
    assert.equal((p as any).observedScope, "user");
  });

  test("#15b plugins/codex: catalog bare name resolves to enabled `<plugin>@<marketplace>` entry", async () => {
    // rationale: production catalog tracks bare names (e.g. "auriga-go") but
    // ~/.codex/config.toml [plugins.<plugin>@<marketplace>] sections plus
    // defaultReadCodexPluginsDir emit `<plugin>@<marketplace>` keys (e.g.
    // "auriga-go@auriga-cli"). Without dual-indexing the bare-named catalog
    // entry can never match, so every dual-Agent plugin permanently reports
    // as not-installed on the Codex side → mergePluginsById then folds that
    // into a misleading partial-install.
    const home = makeScratch("home15b");
    redirectHome(home);
    const catalog = makeCatalog({
      plugins: {
        "auriga-go": { description: "", agents: ["codex"] },
      },
    });
    const report = await scan(makeScratch("proj15b"), catalog, {
      // Codex emits the @marketplace form on both reads.
      readCodexConfig: async () => `[plugins."auriga-go@auriga-cli"]\nenabled = true\n`,
      readCodexPluginsDir: async () => new Map([["auriga-go@auriga-cli", "1.1.0"]]),
      homeDir: home,
    });

    const p = report.plugins.find((x) => x.id === "auriga-go")!;
    assert.ok(p, "catalog bare-name row must be present in the report");
    assert.equal(p.status, "installed", "bare-name catalog entry must resolve to the @marketplace TOML key");
  });
});

// ===========================================================================
// #21 — Aggregate: no Claude install at all
// ===========================================================================
describe("scanState — #21 No Claude install detected at all", () => {
  test("#21 neither ~/.claude/ nor <proj>/.claude/ exists → all user-scope rows not-installed + ONE claude-code-not-installed warning", async () => {
    // rationale: catches scanner producing inscrutable "all not-installed"
    // with no signal that Claude Code itself is missing
    const home = makeScratch("home21");
    // Intentionally do NOT create ~/.claude/
    redirectHome(home);
    const proj = makeScratch("proj21");
    // Intentionally do NOT create <proj>/.claude/ either.

    const catalog = makeCatalog({
      skills: {
        "systematic-debugging": { description: "", isWorkflow: true },
      },
    });
    const report = await scan(proj, catalog, {
      scopes: { workflow: "user", skills: "user", plugins: "user" },
      homeDir: home,
      ...codexNone,
    });

    // All user-scope rows must be not-installed.
    assert.equal(report.workflow.status, "not-installed");
    for (const s of report.skills) {
      assert.equal(s.status, "not-installed", `${s.name} not-installed when no Claude install`);
    }
    // Exactly ONE claude-code-not-installed warning surfaced, not one per category.
    const matches = report.warnings.filter((w) => (w.code as string) === "claude-code-not-installed");
    assert.equal(matches.length, 1, `expected exactly 1 claude-code-not-installed warning, got ${matches.length}`);
  });
});

// ===========================================================================
// #22 — Scope defaults when opts.scopes omitted entirely
// ===========================================================================
describe("scanState — #22 Default scopes when opts.scopes omitted", () => {
  test("#22 default workflow scope = 'project'", async () => {
    // rationale: catches default scope drift
    const home = makeScratch("home22w");
    redirectHome(home);
    const proj = makeScratch("proj22w");
    writeWorkflowFile(path.join(proj, "CLAUDE.md"), "1.6.0");
    // Also write a different version at user scope to prove project wins.
    writeWorkflowFile(path.join(home, ".claude", "CLAUDE.md"), "0.1.0");

    const report = await scan(proj, makeCatalog(), {
      homeDir: home,
      // no scopes field
    });
    assert.equal((report.workflow as any).observedScope, "project");
  });

  test("#22 default skills scope = 'project'", async () => {
    const home = makeScratch("home22s");
    redirectHome(home);
    const proj = makeScratch("proj22s");
    const projContent = "---\nname: systematic-debugging\n---\nproj";
    const userContent = "---\nname: systematic-debugging\n---\nuser";
    writeSkill(path.join(proj, ".claude", "skills", "systematic-debugging"), projContent);
    writeSkill(path.join(home, ".claude", "skills", "systematic-debugging"), userContent);

    const catalog = makeCatalog({
      skills: {
        "systematic-debugging": { description: "", isWorkflow: true },
      },
    });
    const report = await scan(proj, catalog, { homeDir: home });
    const s = report.skills.find((x) => x.name === "systematic-debugging")!;
    assert.equal((s as any).observedScope, "project");
    assert.equal(s.status, "installed", "must have hashed project content, not user content");
  });

  test("#22 default plugins scope = 'user'", async () => {
    const home = makeScratch("home22p");
    redirectHome(home);
    const spy = spyExec({ installed: [], available: [] });
    const catalog = makeCatalog({
      plugins: { "auriga-go@auriga-cli": { description: "", agents: ["claude"] } },
    });
    const report = await scan(makeScratch("proj22p"), catalog, {
      execPluginList: spy.fn,
      homeDir: home,
      ...codexNone,
    });
    const p = report.plugins.find((x) => x.id === "auriga-go@auriga-cli")!;
    assert.equal((p as any).observedScope, "user");
    // If a scope arg flowed through, it must be 'user'.
    if (spy.calls.length > 0 && typeof spy.calls[0] === "string") {
      assert.equal(spy.calls[0], "user", "default plugins scope must be 'user'");
    }
  });

});

// ===========================================================================
// #23 — Per-category scope picker reads each category's chosen scope
// ===========================================================================
describe("scanState — #23 Per-category scope picker independence", () => {
  test("#23 each category reads its own scope's truth source independently", async () => {
    // rationale: catches scanner using a single global scope for all
    // categories instead of looking up per-category from opts.scopes
    const home = makeScratch("home23");
    redirectHome(home);
    const proj = makeScratch("proj23");

    // workflow = 'user'         → ~/.claude/CLAUDE.md  v1.6.0 (installed)
    writeWorkflowFile(path.join(home, ".claude", "CLAUDE.md"), "1.6.0");
    //   counter-evidence at project: <proj>/CLAUDE.md v0.0.1
    writeWorkflowFile(path.join(proj, "CLAUDE.md"), "0.0.1");

    // skills = 'project'        → <proj>/.claude/skills/systematic-debugging/SKILL.md
    const projSkillContent = "---\nname: systematic-debugging\n---\nproject";
    writeSkill(path.join(proj, ".claude", "skills", "systematic-debugging"), projSkillContent);
    //   counter-evidence at user: different content
    writeSkill(
      path.join(home, ".claude", "skills", "systematic-debugging"),
      "---\nname: systematic-debugging\n---\nuser",
    );

    // plugins = 'user'          → execPluginList called with 'user'
    const spy = spyExec({
      installed: [{ id: "auriga-go@auriga-cli", version: "v1.0.0" }],
      available: [{ id: "auriga-go@auriga-cli", source: { ref: "v1.0.0" } }],
    });

    const catalog = makeCatalog({
      skills: {
        "systematic-debugging": { description: "", isWorkflow: true },
      },
      plugins: { "auriga-go@auriga-cli": { description: "", agents: ["claude"] } },
    });

    const report = await scan(proj, catalog, {
      execPluginList: spy.fn,
      scopes: {
        workflow: "user",
        skills: "project",
        plugins: "user",
      },
      homeDir: home,
      ...codexNone,
    });

    // Workflow: read user scope — installed; project's foreign-version
    // file does not bleed in.
    assert.equal((report.workflow as any).observedScope, "user");
    assert.equal(report.workflow.status, "installed");

    // Skills: read project scope (matches catalog hash) — installed.
    const sk = report.skills.find((x) => x.name === "systematic-debugging")!;
    assert.equal((sk as any).observedScope, "project");
    assert.equal(sk.status, "installed");

    // Plugins: scope arg = 'user'.
    if (spy.calls.length > 0 && typeof spy.calls[0] === "string") {
      assert.equal(spy.calls[0], "user");
    }
    const pl = report.plugins.find((x) => x.id === "auriga-go@auriga-cli")!;
    assert.equal((pl as any).observedScope, "user");
    assert.equal(pl.status, "installed");
  });
});

// =============================================================================
// mergePluginsById — dual-Agent dedup + status aggregation (regression)
// =============================================================================
// These tests were carried over from the previous suite; the rewrite must
// preserve mergePluginsById's contract (it's a pure function downstream of
// scanState's classification step).
// =============================================================================
describe("mergePluginsById — dedup by id + aggregate status", () => {
  function p(
    id: string,
    agents: ("claude" | "codex")[],
    status: ItemStatus,
  ): PluginState {
    return { id, description: "", status, agents };
  }

  test("distinct ids are passed through unchanged", () => {
    // rationale: regression — single-agent rows must not be folded
    const out = mergePluginsById([
      p("a", ["claude"], "installed"),
      p("b", ["codex"], "not-installed"),
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0].id, "a");
    assert.deepEqual(out[0].agents, ["claude"]);
    assert.equal(out[1].id, "b");
    assert.deepEqual(out[1].agents, ["codex"]);
  });

  test("both sides installed → installed", () => {
    // rationale: regression — full install across both agents stays green
    const out = mergePluginsById([
      p("x", ["claude"], "installed"),
      p("x", ["codex"], "installed"),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].status, "installed");
    assert.deepEqual(out[0].agents, ["claude", "codex"]);
  });

  test("both sides not-installed → not-installed", () => {
    // rationale: regression — neither agent installed stays gray
    const out = mergePluginsById([
      p("x", ["claude"], "not-installed"),
      p("x", ["codex"], "not-installed"),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].status, "not-installed");
  });

  test("partial install (installed + not-installed) → partial-install + missingAgents", () => {
    // rationale: dual-Agent plugin with one side missing surfaces as
    // partial-install + missingAgents so the UI renders per-agent ✓/✗
    // marks. The Apply path dispatches install to the missing agent.
    // (The pre-v1.19.0 "update-available + stale-side picker" branches
    // are deleted with the update-available surface.)
    const out = mergePluginsById([
      p("x", ["claude"], "installed"),
      p("x", ["codex"], "not-installed"),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].status, "partial-install");
    assert.deepEqual(out[0].missingAgents, ["codex"]);
  });
});
