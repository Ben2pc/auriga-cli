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
//     hooks:              HookState[]     (each carries observedScope)
//     warnings:           StateWarning[]
//
//   WorkflowState extends prior shape with: observedScope: 'user' | 'project'
//   SkillState    extends prior shape with: observedScope: 'user' | 'project'
//   PluginState   extends prior shape with: observedScope: 'user' | 'project'
//   HookState     extends prior shape with: observedScope: 'user' | 'project'
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
//   A2. **Skills via filesystem**: each row's `currentHash` is the SHA256 of
//       the SKILL.md file bytes. The catalog row's `expectedHash` is the
//       comparison target. A SKILL.md frontmatter `version` field MAY override
//       the hash check (per spec), but tests assert via hash-only paths so
//       implementations choosing either route both pass.
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
//   A7. **Hook matcher drift**: settings.json contains a hook entry with the
//       right `_marker` but its `matcher` field differs from the catalog's
//       expected matcher → status `update-available`. The catalog hook
//       entry's `expectedHash` field doubles as a coarse drift signal;
//       tests assert via the `matcher` divergence path which is the spec's
//       primary trigger.
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
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { mergePluginsById, scanState } from "../src/state.js";
import type { Catalog, ScanOptions } from "../src/state.js";
import type {
  HookState,
  PluginState,
  SkillState,
  StateReport,
  StateWarning,
} from "../src/api-types.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Compute SHA256 of a string — same algorithm we'd expect the scanner to use. */
function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
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
    workflowVersion: "1.6.0",
    skills: {},
    recommendedSkills: {},
    plugins: {},
    hooks: {},
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

/** Build a Claude settings.json `hooks` segment with one hook keyed by
 *  marker = hookName. The `matcher` field can be customized to test drift. */
function makeHookSettings(args: {
  hookName: string;
  event?: string;
  matcher?: string;
  command?: string;
}): object {
  const event = args.event ?? "PostToolUse";
  return {
    hooks: {
      [event]: [
        {
          matcher: args.matcher ?? "Write|Edit",
          hooks: [
            {
              type: "command",
              command: args.command ?? `node /some/path/${args.hookName}/index.mjs`,
              _marker: args.hookName,
            },
          ],
        },
      ],
    },
  };
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
    hooks?: "user" | "project";
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

// ===========================================================================
// #1 — Workflow / user scope: happy path
// ===========================================================================
describe("scanState — #1 Workflow / user scope happy path", () => {
  test("#1 workflow/user installed with version match", async () => {
    // rationale: catches scanner still reading <proj>/CLAUDE.md when scope=user
    const home = makeScratch("home1");
    writeWorkflowFile(path.join(home, ".claude", "CLAUDE.md"), "1.6.0");
    redirectHome(home);

    const report = await scan(makeScratch("proj1"), makeCatalog({ workflowVersion: "1.6.0" }), {
      scopes: { workflow: "user" },
      homeDir: home, // belt-and-suspenders for impls that prefer opts.homeDir
    });

    assert.equal(report.workflow.status, "installed");
    assert.equal((report.workflow as any).observedScope, "user");
    assert.equal(report.workflow.currentVersion, "1.6.0");
    assert.equal(report.workflow.expectedVersion, "1.6.0");
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

    const report = await scan(proj, makeCatalog({ workflowVersion: "1.6.0" }), {
      scopes: { workflow: "user" },
      homeDir: home,
    });

    assert.equal(report.workflow.status, "not-installed");
    assert.equal((report.workflow as any).observedScope, "user");
    assert.equal(report.workflow.currentVersion, undefined);
  });
});

// ===========================================================================
// #3 — Workflow / user scope: version mismatch → update-available
// ===========================================================================
describe("scanState — #3 Workflow / user scope version mismatch", () => {
  test("#3 workflow/user update-available when marker version older", async () => {
    // rationale: catches missing version-compare for user-scope path
    const home = makeScratch("home3");
    writeWorkflowFile(path.join(home, ".claude", "CLAUDE.md"), "1.4.0");
    redirectHome(home);

    const report = await scan(makeScratch("proj3"), makeCatalog({ workflowVersion: "1.6.0" }), {
      scopes: { workflow: "user" },
      homeDir: home,
    });

    assert.equal(report.workflow.status, "update-available");
    assert.equal(report.workflow.currentVersion, "1.4.0");
    assert.equal(report.workflow.expectedVersion, "1.6.0");
    assert.equal((report.workflow as any).observedScope, "user");
  });

  test("#3b workflow/empty-expectedVersion trusts installed (no phantom update-available)", async () => {
    // rationale: scan-catalog may fail to extract auriga-cli's own
    // CLAUDE.md header (build-time miss / malformed shipped template), in
    // which case catalog.workflowVersion is "". Without an explicit bypass
    // the comparison `"1.6.0" === ""` is false and a freshly-installed
    // workflow flips to "update-available" against the empty string —
    // user has nothing to upgrade to and the UI gives no actionable info.
    const home = makeScratch("home3b");
    writeWorkflowFile(path.join(home, ".claude", "CLAUDE.md"), "1.6.0");
    redirectHome(home);

    const report = await scan(makeScratch("proj3b"), makeCatalog({ workflowVersion: "" }), {
      scopes: { workflow: "user" },
      homeDir: home,
    });

    assert.equal(report.workflow.status, "installed", "empty expectedVersion must NOT trigger update-available");
    assert.equal(report.workflow.currentVersion, "1.6.0");
  });
});

// ===========================================================================
// #4 — Workflow / project scope: happy path
// ===========================================================================
describe("scanState — #4 Workflow / project scope happy path", () => {
  test("#4 workflow/project installed reads <proj>/CLAUDE.md", async () => {
    // rationale: catches scanner still reading <cwd>/CLAUDE.md (dev-repo path)
    const home = makeScratch("home4");
    redirectHome(home);
    const proj = makeScratch("proj4");
    writeWorkflowFile(path.join(proj, "CLAUDE.md"), "1.6.0");

    const report = await scan(proj, makeCatalog({ workflowVersion: "1.6.0" }), {
      scopes: { workflow: "project" },
      homeDir: home,
    });

    assert.equal(report.workflow.status, "installed");
    assert.equal((report.workflow as any).observedScope, "project");
    assert.equal(report.workflow.currentVersion, "1.6.0");
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

    const report = await scan(proj, makeCatalog({ workflowVersion: "1.6.0" }), {
      scopes: { workflow: "project" },
      homeDir: home,
    });

    assert.equal(report.workflow.status, "not-installed", "must not pick up the .claude/ subdir file");
    assert.equal(report.workflow.currentVersion, undefined);
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

    const report = await scan(proj, makeCatalog({ workflowVersion: "1.6.0" }), {
      scopes: { workflow: "project" },
      homeDir: home,
    });

    assert.equal(report.workflow.status, "not-installed", "foreign CLAUDE.md is not our workflow");
    assert.equal(report.workflow.currentVersion, undefined);
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
    const content = "---\nname: brainstorming\nversion: 1.0.0\n---\nbody";
    writeSkill(path.join(home, ".claude", "skills", "brainstorming"), content);

    const catalog = makeCatalog({
      skills: {
        brainstorming: { description: "B", expectedHash: sha256(content), isWorkflow: true },
      },
    });
    const report = await scan(makeScratch("proj7"), catalog, {
      scopes: { skills: "user" },
      homeDir: home,
    });

    const s = report.skills.find((x: SkillState) => x.name === "brainstorming");
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
    const content = "---\nname: brainstorming\n---\nbody";
    writeSkill(path.join(home, ".claude", "skills", "brainstorming"), content);

    const catalog = makeCatalog({
      skills: {
        brainstorming: { description: "", expectedHash: sha256(content), isWorkflow: true },
        "not-on-disk": { description: "", expectedHash: "any", isWorkflow: true },
      },
    });
    const report = await scan(makeScratch("proj8"), catalog, {
      scopes: { skills: "user" },
      homeDir: home,
    });

    const present = report.skills.find((x) => x.name === "brainstorming")!;
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
    const content = "---\nname: brainstorming\n---\nbody";
    writeSkill(path.join(proj, ".claude", "skills", "brainstorming"), content);

    const catalog = makeCatalog({
      skills: {
        brainstorming: { description: "", expectedHash: sha256(content), isWorkflow: true },
      },
    });
    const report = await scan(proj, catalog, {
      scopes: { skills: "project" },
      homeDir: home,
    });

    const s = report.skills.find((x) => x.name === "brainstorming")!;
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
    // brainstorming: dir exists but SKILL.md does NOT
    fs.mkdirSync(path.join(home, ".claude", "skills", "brainstorming"), { recursive: true });
    // healthy skill so we can assert isolation
    const healthyContent = "---\nname: healthy\n---\nok";
    writeSkill(path.join(home, ".claude", "skills", "healthy"), healthyContent);

    const catalog = makeCatalog({
      skills: {
        brainstorming: { description: "", expectedHash: "anyhash", isWorkflow: true },
        healthy: { description: "", expectedHash: sha256(healthyContent), isWorkflow: false },
      },
    });
    let report: StateReport;
    await assert.doesNotReject(async () => {
      report = await scan(makeScratch("proj10"), catalog, {
        scopes: { skills: "user" },
        homeDir: home,
      });
    }, "scanState must not throw on malformed skill");

    const broken = report!.skills.find((x) => x.name === "brainstorming")!;
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
describe("scanState — #11 Skills drift detection deferred", () => {
  test("#11 skill content drift is ignored when catalog expectedHash is empty (production path)", async () => {
    // rationale: production scan-catalog sets every skill's expectedHash to
    // "" (wildcard) — drift detection deliberately deferred to
    // `npx skills update --project`, which compares against each skill's own
    // upstream HEAD. Our catalog snapshot is at best stale; mis-reporting
    // legitimate user-side updates as drift would push users into a confusing
    // "auriga-cli says reinstall, npx skills says you're current" loop.
    // The classifier already supports the wildcard (state.ts:455); this test
    // pins the contract so a future regression that reintroduces non-empty
    // skill hashes will fail loudly here too.
    const home = makeScratch("home11");
    redirectHome(home);
    const onDisk = "---\nname: brainstorming\nversion: 0.9.0\n---\nold";
    writeSkill(path.join(home, ".claude", "skills", "brainstorming"), onDisk);

    const catalog = makeCatalog({
      skills: {
        brainstorming: {
          description: "",
          // Mirror production: scan-catalog always emits "" for skills.
          expectedHash: "",
          isWorkflow: true,
        },
      },
    });
    const report = await scan(makeScratch("proj11"), catalog, {
      scopes: { skills: "user" },
      homeDir: home,
    });

    const s = report.skills.find((x) => x.name === "brainstorming")!;
    assert.equal(
      s.status,
      "installed",
      "skill with content drift must still classify as installed when expectedHash is wildcard",
    );
    assert.notEqual(
      s.status,
      "update-available",
      "must not surface update-available — that signal would be a stale proxy for what `npx skills update` already checks better",
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
// #14c — Plugins (Claude) / baked def.expectedVersion path
// ===========================================================================
describe("scanState — #14c Plugins (Claude) baked expectedVersion", () => {
  test("#14c plugins/claude: baked def.expectedVersion mismatches installed.version → update-available", async () => {
    // rationale: `claude plugins list --available --json` deliberately omits
    // already-installed plugins from `.available[]`, so the marketplace-live
    // ref path can never fire for the common upgrade case. When the scanner
    // has a baked expectedVersion from auriga-cli's own
    // plugins/<name>/.claude-plugin/plugin.json (the canonical source for
    // owned plugins), it MUST use that to surface "an upgrade is available".
    // Without this path a stale local install (e.g. deep-review@0.3.0 while
    // the marketplace ships 0.3.1) reports a misleading green "installed".
    const home = makeScratch("home14c");
    redirectHome(home);
    const catalog = makeCatalog({
      plugins: {
        "deep-review@auriga-cli": {
          description: "",
          agents: ["claude"],
          expectedVersion: "0.3.1",
        },
      },
    });
    const report = await scan(makeScratch("proj14c"), catalog, {
      execPluginList: (async () => ({
        installed: [{ id: "deep-review@auriga-cli", version: "0.3.0" }],
        available: [], // CLI excludes installed plugins from .available[]
      })) as NonNullable<ScanOptions["execPluginList"]>,
      scopes: { plugins: "user" },
      homeDir: home,
      ...codexNone,
    });

    const p = report.plugins.find((x) => x.id === "deep-review@auriga-cli")!;
    assert.equal(p.status, "update-available");
    assert.equal(p.currentVersion, "0.3.0");
    assert.equal(p.expectedVersion, "0.3.1");
    assert.equal(p.versionSource, "catalog");
  });

  test("#14c plugins/claude: baked def.expectedVersion matches installed.version → installed", async () => {
    // rationale: confirms the baked-version path doesn't false-positive
    // when the user IS up to date with the catalog-shipped version.
    const home = makeScratch("home14c-eq");
    redirectHome(home);
    const catalog = makeCatalog({
      plugins: {
        "deep-review@auriga-cli": {
          description: "",
          agents: ["claude"],
          expectedVersion: "0.3.1",
        },
      },
    });
    const report = await scan(makeScratch("proj14c-eq"), catalog, {
      execPluginList: (async () => ({
        installed: [{ id: "deep-review@auriga-cli", version: "0.3.1" }],
        available: [],
      })) as NonNullable<ScanOptions["execPluginList"]>,
      scopes: { plugins: "user" },
      homeDir: home,
      ...codexNone,
    });

    const p = report.plugins.find((x) => x.id === "deep-review@auriga-cli")!;
    assert.equal(p.status, "installed");
    assert.equal(p.currentVersion, "0.3.1");
    assert.equal(p.versionSource, "catalog");
  });
});

// ===========================================================================
// #14d — Plugins (Claude) / external short-circuit
// ===========================================================================
describe("scanState — #14d Plugins (Claude) external short-circuit", () => {
  test("#14d external plugin with installed.version mismatch → still installed (never update-available)", async () => {
    // rationale: external-marketplace plugins (skill-creator etc.) install
    // through Claude Code's marketplace; upgrades go through
    // `claude plugins update`, not us. Even if some signal claims a newer
    // version is available, the scanner MUST report installed — surfacing
    // update-available would push users to apply via auriga-cli, which
    // doesn't know how to talk to the upstream marketplace correctly.
    // Property under test: def.external === true overrides version compare.
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
        // Even a live "newer" marketplace ref must not flip the status —
        // we explicitly defer authority to upstream for these.
        available: [
          {
            id: "skill-creator@claude-plugins-official",
            source: { ref: "v2.0.0" },
          },
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
    assert.equal(p.currentVersion, "1.0.0");
    assert.equal((p as any).external, true);
    assert.notEqual(
      p.status,
      "update-available",
      "external plugins must never report update-available",
    );
  });
});

// ===========================================================================
// #15 — Plugins (Codex) / unchanged behavior: still works
// ===========================================================================
describe("scanState — #15 Plugins (Codex) sanity (unchanged behavior)", () => {
  test("#15 plugins/codex installed when toml enables + fs version matches catalog expectedVersion", async () => {
    // rationale: catches the rewrite accidentally breaking the existing
    // codex scanner (Codex is user-scope only and stays so)
    const home = makeScratch("home15");
    redirectHome(home);
    const catalog = makeCatalog({
      plugins: {
        "auriga-go@auriga-cli": {
          description: "",
          agents: ["codex"],
          expectedVersion: "1.0.0",
        },
      },
    });
    const report = await scan(makeScratch("proj15"), catalog, {
      readCodexConfig: async () => `[plugins."auriga-go@auriga-cli"]\nenabled = true\n`,
      readCodexPluginsDir: async () => new Map([["auriga-go@auriga-cli", "1.0.0"]]),
      homeDir: home,
    });

    const p = report.plugins.find((x) => x.id === "auriga-go@auriga-cli")!;
    assert.equal(p.status, "installed");
    assert.equal(p.currentVersion, "1.0.0");
    assert.equal(p.versionSource, "catalog");
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
    // into a sticky "update-available" even when both sides are installed.
    const home = makeScratch("home15b");
    redirectHome(home);
    const catalog = makeCatalog({
      plugins: {
        "auriga-go": {
          description: "",
          agents: ["codex"],
          expectedVersion: "1.1.0",
        },
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
    assert.equal(p.currentVersion, "1.1.0");
  });
});

// ===========================================================================
// #16 — Hooks / user scope: settings.json marker match
// ===========================================================================
describe("scanState — #16 Hooks / user scope happy path", () => {
  test("#16 hooks/user installed when ~/.claude/settings.json carries _marker for catalog hook", async () => {
    // rationale: catches scanner still reading <proj>/.claude/hooks/hooks.json
    // (dev-repo registry) instead of the user's actual settings.json
    const home = makeScratch("home16");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".claude", "settings.json"),
      JSON.stringify(makeHookSettings({ hookName: "notify" })),
    );
    redirectHome(home);

    const catalog = makeCatalog({
      hooks: { notify: { description: "", expectedHash: "any" } },
    });
    const report = await scan(makeScratch("proj16"), catalog, {
      scopes: { hooks: "user" },
      homeDir: home,
    });

    const h = report.hooks.find((x: HookState) => x.name === "notify")!;
    assert.ok(h, "hook row present");
    assert.equal(h.status, "installed");
    assert.equal((h as any).observedScope, "user");
  });
});

// ===========================================================================
// #17 — Hooks / project scope: settings.json marker match
// ===========================================================================
describe("scanState — #17 Hooks / project scope happy path", () => {
  test("#17 hooks/project installed when <proj>/.claude/settings.json carries marker", async () => {
    // rationale: catches scanner reading the wrong scope's settings.json
    const home = makeScratch("home17");
    redirectHome(home);
    const proj = makeScratch("proj17");
    fs.mkdirSync(path.join(proj, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(proj, ".claude", "settings.json"),
      JSON.stringify(makeHookSettings({ hookName: "notify" })),
    );

    const catalog = makeCatalog({
      hooks: { notify: { description: "", expectedHash: "any" } },
    });
    const report = await scan(proj, catalog, {
      scopes: { hooks: "project" },
      homeDir: home,
    });

    const h = report.hooks.find((x) => x.name === "notify")!;
    assert.equal(h.status, "installed");
    assert.equal((h as any).observedScope, "project");
  });
});

// ===========================================================================
// #18 — Hooks / settings.json corrupt JSON → settings-unreadable warning
// ===========================================================================
describe("scanState — #18 Hooks settings.json corrupt", () => {
  test("#18 hooks: corrupt settings.json → all hooks not-installed + settings-unreadable warning, no crash", async () => {
    // rationale: catches scanner crashing on broken JSON or silently
    // classifying hooks as installed
    const home = makeScratch("home18");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), "{not valid json");
    redirectHome(home);

    const catalog = makeCatalog({
      hooks: { notify: { description: "", expectedHash: "any" } },
    });
    let report: StateReport;
    await assert.doesNotReject(async () => {
      report = await scan(makeScratch("proj18"), catalog, {
        scopes: { hooks: "user" },
        homeDir: home,
      });
    });

    const h = report!.hooks.find((x) => x.name === "notify")!;
    assert.ok(h, "row present even with broken settings.json");
    assert.equal(h.status, "not-installed");
    assert.ok(
      report!.warnings.some((w) => (w.code as string) === "settings-unreadable"),
      "must emit settings-unreadable warning",
    );
  });
});

// ===========================================================================
// #19 — Hooks / settings.json missing → silent not-installed
// ===========================================================================
describe("scanState — #19 Hooks settings.json absent (common case)", () => {
  test("#19 hooks: settings.json missing → all hooks not-installed, NO warning", async () => {
    // rationale: catches scanner emitting a warning every page-load on
    // first-time users (most users haven't touched settings.json)
    const home = makeScratch("home19");
    // Make ~/.claude exist so we don't trip claude-code-not-installed.
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    redirectHome(home);

    const catalog = makeCatalog({
      hooks: { notify: { description: "", expectedHash: "any" } },
    });
    const report = await scan(makeScratch("proj19"), catalog, {
      scopes: { hooks: "user" },
      homeDir: home,
    });

    const h = report.hooks.find((x) => x.name === "notify")!;
    assert.equal(h.status, "not-installed");
    assert.ok(
      !report.warnings.some((w) => (w.code as string) === "settings-unreadable"),
      "no settings-unreadable warning when file is simply absent",
    );
  });
});

// ===========================================================================
// #20 — Hooks / matcher drift → update-available
// ===========================================================================
describe("scanState — #20 Hooks matcher drift", () => {
  test("#20 hooks: settings has marker but matcher differs from catalog → update-available", async () => {
    // rationale: catches scanner ignoring matcher drift and reporting
    // installed when the registered matcher no longer matches the registry
    const home = makeScratch("home20");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    // Settings carries an OLD matcher.
    fs.writeFileSync(
      path.join(home, ".claude", "settings.json"),
      JSON.stringify(makeHookSettings({ hookName: "notify", matcher: "Stop" })),
    );
    redirectHome(home);

    // Build a catalog whose expectedHash encodes the NEW matcher signal. We
    // express drift via the catalog hook's expectedHash diverging from
    // whatever signature the scanner computes for the current settings —
    // any implementation that detects drift via matcher or hash must land
    // here as "update-available".
    const catalog = makeCatalog({
      hooks: {
        notify: {
          description: "",
          // Anything that the scanner can't square with the on-disk matcher.
          expectedHash: "expected-new-matcher-signature",
        },
      },
    });
    const report = await scan(makeScratch("proj20"), catalog, {
      scopes: { hooks: "user" },
      homeDir: home,
    });

    const h = report.hooks.find((x) => x.name === "notify")!;
    assert.equal(h.status, "update-available", "marker present + matcher drift must surface as update-available");
    assert.equal((h as any).observedScope, "user");
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
        brainstorming: { description: "", expectedHash: "h", isWorkflow: true },
      },
      hooks: { notify: { description: "", expectedHash: "h" } },
    });
    const report = await scan(proj, catalog, {
      scopes: { workflow: "user", skills: "user", plugins: "user", hooks: "user" },
      homeDir: home,
      ...codexNone,
    });

    // All user-scope rows must be not-installed.
    assert.equal(report.workflow.status, "not-installed");
    for (const s of report.skills) {
      assert.equal(s.status, "not-installed", `${s.name} not-installed when no Claude install`);
    }
    for (const h of report.hooks) {
      assert.equal(h.status, "not-installed", `${h.name} not-installed when no Claude install`);
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

    const report = await scan(proj, makeCatalog({ workflowVersion: "1.6.0" }), {
      homeDir: home,
      // no scopes field
    });
    assert.equal((report.workflow as any).observedScope, "project");
    assert.equal(report.workflow.currentVersion, "1.6.0", "must have read project file, not user file");
  });

  test("#22 default skills scope = 'project'", async () => {
    const home = makeScratch("home22s");
    redirectHome(home);
    const proj = makeScratch("proj22s");
    const projContent = "---\nname: brainstorming\n---\nproj";
    const userContent = "---\nname: brainstorming\n---\nuser";
    writeSkill(path.join(proj, ".claude", "skills", "brainstorming"), projContent);
    writeSkill(path.join(home, ".claude", "skills", "brainstorming"), userContent);

    const catalog = makeCatalog({
      skills: {
        brainstorming: { description: "", expectedHash: sha256(projContent), isWorkflow: true },
      },
    });
    const report = await scan(proj, catalog, { homeDir: home });
    const s = report.skills.find((x) => x.name === "brainstorming")!;
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

  test("#22 default hooks scope = 'user'", async () => {
    const home = makeScratch("home22h");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".claude", "settings.json"),
      JSON.stringify(makeHookSettings({ hookName: "notify" })),
    );
    redirectHome(home);
    const proj = makeScratch("proj22h");
    // Project-scope settings.json that does NOT have the hook — proves
    // default scanned user, not project.
    fs.mkdirSync(path.join(proj, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(proj, ".claude", "settings.json"), JSON.stringify({ hooks: {} }));

    const catalog = makeCatalog({
      hooks: { notify: { description: "", expectedHash: "any" } },
    });
    const report = await scan(proj, catalog, { homeDir: home });
    const h = report.hooks.find((x) => x.name === "notify")!;
    assert.equal((h as any).observedScope, "user");
    assert.equal(h.status, "installed", "must have read user settings.json (which has the hook)");
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

    // skills = 'project'        → <proj>/.claude/skills/brainstorming/SKILL.md
    const projSkillContent = "---\nname: brainstorming\n---\nproject";
    writeSkill(path.join(proj, ".claude", "skills", "brainstorming"), projSkillContent);
    //   counter-evidence at user: different content
    writeSkill(
      path.join(home, ".claude", "skills", "brainstorming"),
      "---\nname: brainstorming\n---\nuser",
    );

    // plugins = 'user'          → execPluginList called with 'user'
    const spy = spyExec({
      installed: [{ id: "auriga-go@auriga-cli", version: "v1.0.0" }],
      available: [{ id: "auriga-go@auriga-cli", source: { ref: "v1.0.0" } }],
    });

    // hooks = 'project'         → <proj>/.claude/settings.json has notify
    fs.mkdirSync(path.join(proj, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(proj, ".claude", "settings.json"),
      JSON.stringify(makeHookSettings({ hookName: "notify" })),
    );
    //   counter-evidence at user: settings WITHOUT the hook
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ hooks: {} }));

    const catalog = makeCatalog({
      workflowVersion: "1.6.0",
      skills: {
        brainstorming: {
          description: "",
          expectedHash: sha256(projSkillContent),
          isWorkflow: true,
        },
      },
      plugins: { "auriga-go@auriga-cli": { description: "", agents: ["claude"] } },
      hooks: { notify: { description: "", expectedHash: "any" } },
    });

    const report = await scan(proj, catalog, {
      execPluginList: spy.fn,
      scopes: {
        workflow: "user",
        skills: "project",
        plugins: "user",
        hooks: "project",
      },
      homeDir: home,
      ...codexNone,
    });

    // Workflow: read user scope (v1.6.0) — installed; not the project file (v0.0.1).
    assert.equal((report.workflow as any).observedScope, "user");
    assert.equal(report.workflow.currentVersion, "1.6.0");
    assert.equal(report.workflow.status, "installed");

    // Skills: read project scope (matches catalog hash) — installed.
    const sk = report.skills.find((x) => x.name === "brainstorming")!;
    assert.equal((sk as any).observedScope, "project");
    assert.equal(sk.status, "installed");

    // Plugins: scope arg = 'user'.
    if (spy.calls.length > 0 && typeof spy.calls[0] === "string") {
      assert.equal(spy.calls[0], "user");
    }
    const pl = report.plugins.find((x) => x.id === "auriga-go@auriga-cli")!;
    assert.equal((pl as any).observedScope, "user");
    assert.equal(pl.status, "installed");

    // Hooks: read project scope (which has the hook) — installed.
    const hk = report.hooks.find((x) => x.name === "notify")!;
    assert.equal((hk as any).observedScope, "project");
    assert.equal(hk.status, "installed");
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
    status: "installed" | "update-available" | "not-installed",
  ): PluginState {
    return {
      id,
      description: "",
      status,
      agents,
      versionSource: "upstream-live",
    };
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
    // rationale: revised v1.18.5 — pre-v1.18.5 this folded to
    // update-available, which surfaced as a misleading "vX → vX" upgrade
    // when the installed side's version matched the catalog. The new
    // partial-install state names the actual problem (the other agent
    // doesn't have it) and missingAgents lets the UI render per-agent
    // ✓/✗ marks. The Apply path can dispatch a single install to the
    // missing agent.
    const out = mergePluginsById([
      p("x", ["claude"], "installed"),
      p("x", ["codex"], "not-installed"),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].status, "partial-install");
    assert.deepEqual(out[0].missingAgents, ["codex"]);
  });

  test("update-available on one side + not-installed on other → partial-install", () => {
    // rationale: missing on one agent supersedes stale-on-another — the
    // user-facing action is "install on the missing agent" first, then
    // upgrade. Apply will do both, but the badge color must lead with
    // "Codex side missing", not "Claude side stale".
    const out = mergePluginsById([
      p("x", ["claude"], "update-available"),
      p("x", ["codex"], "not-installed"),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].status, "partial-install");
    assert.deepEqual(out[0].missingAgents, ["codex"]);
  });

  test("update-available on both sides → update-available (pure version drift)", () => {
    // rationale: regression — version drift on every targeted agent stays
    // update-available; no partial-install when nothing is "missing".
    const out = mergePluginsById([
      p("x", ["claude"], "update-available"),
      p("x", ["codex"], "update-available"),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].status, "update-available");
    assert.equal(out[0].missingAgents, undefined, "no missingAgents when nothing is missing");
  });
});
