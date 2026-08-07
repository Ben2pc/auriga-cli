import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

// E2E install test — the missing piece of the test pyramid.
//
// Unit tests mock fetch + installer modules; entrypoint.test.ts covers
// the bin-symlink path on the raw dist/cli.js. What nothing covers is
// "take the ACTUAL npm tarball we'd publish, install it into a clean
// project, spawn `auriga-cli install` against real GitHub content
// pinned to the current HEAD SHA, and assert files land correctly".
//
// The gap matters because our content-fetch path couples the published
// package to the git repo at runtime (fetchContentRoot pins to
// v<package.version> by default; AURIGA_CONTENT_REF overrides it).
// Before this test, the only way to validate that coupling end-to-end
// was to publish to npm and try it — the worst possible discovery path.
//
// Deliberately slim: one scenario per install surface (workflow content
// fetch, external skill via the skills CLI, plugin via the Claude
// marketplace). Category composition (`install --all`, recommended
// filters) and the legacy-notify migration are unit-covered
// (cli-parse / apply-handlers / plugins tests); repeating them here
// only added minutes of runtime and clones of slow external repos —
// planning-with-files in particular flaked on unauthenticated GitHub
// rate limits.
//
// Run after `git push` (the suite skips on unpushed HEAD):
//   npm run test:e2e
// Not in `npm test`: requires network. release.yml runs it at tag time.

// `npm run test:e2e` always runs from the repo root (same contract as
// `npm test`). We rely on this to resolve relative npm/git commands.
const REPO_ROOT = process.cwd();

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    env: opts.env ?? process.env,
    encoding: "utf-8",
  });
}

// Lazy: running `git rev-parse HEAD` at module import would crash the
// entire test process if the file were ever imported from a non-git
// checkout (e.g. a tarball). Defer until describe evaluation so the
// suite-level skip can still fire with a clean message.
let _gitState: { headSha: string; onOrigin: boolean; skipReason: string | undefined } | null = null;
function gitState() {
  if (_gitState) return _gitState;
  const headResult = run("git", ["rev-parse", "HEAD"]);
  if (headResult.status !== 0) {
    _gitState = {
      headSha: "",
      onOrigin: false,
      skipReason: `not in a git repo (git rev-parse HEAD failed): ${headResult.stderr.trim()}`,
    };
    return _gitState;
  }
  const headSha = headResult.stdout.trim();
  // `git branch -r --contains <sha>` prints remote branches that reach
  // the SHA. Empty stdout means the commit isn't pushed to a remote
  // that the local checkout knows about. Uses local refs only — no
  // network round-trip. The caller should have recently pushed so that
  // `push` (which updates local remote refs synchronously) made the
  // SHA reachable; or have `git fetch`-ed if someone else pushed it.
  const reachResult = run("git", ["branch", "-r", "--contains", headSha]);
  const onOrigin = reachResult.status === 0 && reachResult.stdout.trim().length > 0;
  _gitState = {
    headSha,
    onOrigin,
    skipReason: onOrigin
      ? undefined
      : `HEAD ${headSha.slice(0, 8)} is not reachable from any remote ref known locally — push first (a successful push updates local remote refs) or fetch if someone else pushed it.`,
  };
  return _gitState;
}

// Cache so scenarios consulting this don't spawn `which claude` N times.
// Plugins install shells out to `claude plugins install`, unavailable
// in stripped environments; scenarios that depend on it skip rather
// than fail hard.
const CLAUDE_AVAILABLE = (() => {
  const r = spawnSync("which", ["claude"], { encoding: "utf-8" });
  return r.status === 0 && r.stdout.trim().length > 0;
})();

describe(
  "e2e install — tarball → npm install → auriga-cli install",
  { skip: gitState().skipReason },
  () => {
    const scratchDirs: string[] = [];
    let tarballPath: string | null = null;

    function makeScratch(label: string): string {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `auriga-e2e-${label}-`));
      scratchDirs.push(dir);
      return dir;
    }

    function packTarball(): string {
      const dest = makeScratch("pack");
      // Locate the tarball by listing the scratch dir instead of parsing
      // `npm pack --json`: npm 12 changed that JSON shape from an array
      // to an object keyed by package name, while a fresh scratch dir
      // holds exactly one .tgz on any npm version.
      const r = run("npm", ["pack", "--pack-destination", dest]);
      if (r.status !== 0) {
        throw new Error(`npm pack failed (exit ${r.status}): ${r.stderr || r.stdout || "(no output)"}`);
      }
      const tgzs = fs.readdirSync(dest).filter((f) => f.endsWith(".tgz"));
      if (tgzs.length !== 1) {
        throw new Error(`expected exactly one .tgz in ${dest}, found [${tgzs.join(", ")}]`);
      }
      return path.join(dest, tgzs[0]);
    }

    // Set up a fresh scratch project and install the just-packed
    // tarball into it. Returns the project dir. Registry deps
    // (@inquirer/prompts, gray-matter) still fetch from npmjs.com —
    // this assumes the dev machine has network.
    function setupProject(tarball: string): string {
      const proj = makeScratch("proj");
      fs.writeFileSync(
        path.join(proj, "package.json"),
        JSON.stringify({ name: "scratch", version: "0.0.0", private: true }),
      );
      const r = run("npm", ["install", tarball, "--no-audit", "--no-fund", "--silent"], {
        cwd: proj,
      });
      if (r.status !== 0) {
        throw new Error(
          `npm install <tarball> failed (exit ${r.status}): ${r.stderr || r.stdout || "(no output)"}`,
        );
      }
      return proj;
    }

    function runCli(proj: string, args: string[], envExtra: Record<string, string> = {}) {
      const bin = path.join(proj, "node_modules", ".bin", "auriga-cli");
      if (!fs.existsSync(bin)) {
        throw new Error(`auriga-cli bin not found at ${bin}`);
      }
      // Scrub DEV from the inherited env: a dev shell with `DEV=1`
      // exported (documented in README as the dev flow) would make
      // `fetchContentRoot` short-circuit to `getPackageRoot()`. The
      // installed tarball's package root does not carry workflow templates /
      // skills-lock.json / marketplace JSON (those are excluded from
      // the `files` manifest on purpose — they live on GitHub), so
      // every scenario would fail with a misleading "file missing"
      // error. The e2e's whole point is to exercise the real fetch
      // path, so DEV must be explicitly off.
      const env: NodeJS.ProcessEnv = { ...process.env, AURIGA_CONTENT_REF: gitState().headSha, ...envExtra };
      delete env.DEV;
      return spawnSync(bin, args, { cwd: proj, encoding: "utf-8", env });
    }

    // Skills materialize at `.agents/skills/<name>` OR `.claude/skills/<name>`
    // depending on the upstream `skills` CLI's convention. Check both
    // so the assertion survives a benign path-convention bump.
    function findSkillDir(proj: string, name: string): string | undefined {
      const candidates = [
        path.join(proj, ".agents", "skills", name),
        path.join(proj, ".claude", "skills", name),
      ];
      return candidates.find((p) => fs.existsSync(p));
    }
    function findSkillFile(proj: string, name: string): string | undefined {
      const dir = findSkillDir(proj, name);
      if (!dir) return undefined;
      const f = path.join(dir, "SKILL.md");
      return fs.existsSync(f) ? f : undefined;
    }

    // Any test calling an installer that shells out to the npm
    // registry or GitHub can in principle hang (registry slow-lane,
    // `claude plugins install` waiting on auth prompt on some CLI
    // versions). Without a timeout the suite hangs indefinitely,
    // which is nasty for a release gate.
    const TIMEOUT = 180_000;

    before(() => {
      tarballPath = packTarball();
    });

    after(() => {
      for (const d of scratchDirs) {
        try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
      }
      // `claude plugins install` writes to a machine-level registry at
      // ~/.claude/plugins/installed_plugins.json with a per-project
      // entry that persists even after the project dir is deleted. Our
      // scratch dirs vanish in the loop above, so any registry entry
      // with `projectPath` pointing into our scratch prefix is an
      // orphan. Self-heal here so the dev machine doesn't accumulate
      // dead plugin registrations across test runs (this is a real
      // footgun; previously 20+ orphans built up over a dozen runs).
      cleanupPluginRegistryOrphans();
    });

    function cleanupPluginRegistryOrphans(): void {
      // Whole-body try/catch — this helper is best-effort; nothing it
      // does should ever fail the test run. Covers any unexpected
      // throw (EACCES on homedir, realpathSync on a missing tmpdir,
      // JSON stringify overflow, etc.).
      try {
        const registryPath = path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");
        if (!fs.existsSync(registryPath)) return;
        let data: unknown;
        try {
          data = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
        } catch {
          // Corrupt registry — not ours to fix, leave alone.
          return;
        }
        if (!data || typeof data !== "object" || !("plugins" in data)) return;
        const plugins = (data as { plugins: unknown }).plugins;
        if (!plugins || typeof plugins !== "object") return;
        // Canonicalize tmp root — on macOS `os.tmpdir()` returns
        // `/var/folders/...` but projectPath shows up as
        // `/private/var/folders/...`. realpath normalizes to the
        // `/private`-prefixed form.
        const tmpRoot = fs.realpathSync(os.tmpdir()) + path.sep;
        const SCRATCH_MARKER = path.sep + "auriga-e2e-proj-";
        let removed = 0;
        for (const [pluginId, entries] of Object.entries(plugins as Record<string, unknown>)) {
          if (!Array.isArray(entries)) continue;
          const filtered = entries.filter((e: unknown) => {
            if (!e || typeof e !== "object") return true;
            const entry = e as Record<string, unknown>;
            if (entry.scope !== "project") return true;
            const pp = entry.projectPath;
            if (typeof pp !== "string") return true;
            // Only remove entries whose projectPath is clearly ours:
            // under the canonicalized tmp root AND containing our
            // scratch-dir prefix. Defensive against any real path that
            // coincidentally contains the marker.
            return !(pp.startsWith(tmpRoot) && pp.includes(SCRATCH_MARKER));
          });
          removed += entries.length - filtered.length;
          (plugins as Record<string, unknown>)[pluginId] = filtered;
        }
        if (removed === 0) return;
        // Atomic write via tmp + rename.
        const tmp = registryPath + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
        try {
          fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
          fs.renameSync(tmp, registryPath);
        } catch {
          // Best-effort: don't fail the test run on cleanup failure.
          try { fs.unlinkSync(tmp); } catch {}
        }
      } catch {
        // Swallow — see top-of-function rationale.
      }
    }

    test("preflight: HEAD is reachable from origin", { timeout: TIMEOUT }, () => {
      // Tautological given the suite-level skip, but surfaces the state
      // explicitly in test output so a green run confirms we DID verify
      // the push — not that we silently skipped.
      assert.ok(gitState().onOrigin, gitState().skipReason);
      assert.ok(tarballPath && fs.existsSync(tarballPath), "tarball not packed");
    });

    test("install workflow → AGENTS.md primary + CLAUDE.md symlink land in the project", { timeout: TIMEOUT }, () => {
      const proj = setupProject(tarballPath!);
      const r = runCli(proj, ["install", "workflow"]);
      assert.equal(
        r.status,
        0,
        `auriga-cli install workflow exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
      );

      const agentsMd = path.join(proj, "AGENTS.md");
      assert.ok(fs.existsSync(agentsMd), `AGENTS.md missing at ${agentsMd}`);
      assert.ok(fs.statSync(agentsMd).size > 0, "AGENTS.md is empty");
      assert.match(
        fs.readFileSync(agentsMd, "utf-8"),
        /# auriga 工作流/,
        "default tarball workflow install should use the Chinese AGENTS.md template",
      );

      const claudeMd = path.join(proj, "CLAUDE.md");
      assert.ok(fs.existsSync(claudeMd), `CLAUDE.md missing at ${claudeMd}`);
      const lst = fs.lstatSync(claudeMd);
      assert.ok(lst.isSymbolicLink(), "CLAUDE.md should be a symlink to AGENTS.md");
      assert.equal(fs.readlinkSync(claudeMd), "AGENTS.md");
    });

    test(
      "install plugins --plugin auriga-workflow → plugin registered without modifying standalone skills",
      { skip: CLAUDE_AVAILABLE ? undefined : "requires 'claude' CLI", timeout: TIMEOUT },
      () => {
        const proj = setupProject(tarballPath!);
        const legacyDir = path.join(proj, ".agents", "skills", "test-driven-development");
        fs.mkdirSync(legacyDir, { recursive: true });
        fs.writeFileSync(path.join(legacyDir, "SKILL.md"), "# team-managed legacy copy\n");
        const lockPath = path.join(proj, "skills-lock.json");
        fs.writeFileSync(lockPath, JSON.stringify({
          version: 1,
          skills: {
            "test-driven-development": { source: "obra/superpowers" },
          },
        }, null, 2) + "\n");
        const lockBefore = fs.readFileSync(lockPath, "utf-8");

        const r = runCli(proj, ["install", "plugins", "--plugin", "auriga-workflow"]);
        assert.equal(
          r.status,
          0,
          `install plugins exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
        );
        const settings = path.join(proj, ".claude", "settings.json");
        assert.ok(fs.existsSync(settings), `.claude/settings.json missing at ${settings}`);
        assert.match(
          fs.readFileSync(settings, "utf-8"),
          /auriga-workflow/,
          "auriga-workflow not mentioned in .claude/settings.json",
        );
        assert.equal(
          fs.readFileSync(path.join(legacyDir, "SKILL.md"), "utf-8"),
          "# team-managed legacy copy\n",
        );
        assert.equal(fs.readFileSync(lockPath, "utf-8"), lockBefore);
      },
    );

    test("install skills --skill playwright-cli → filter filters, retired user copy untouched", { timeout: TIMEOUT }, () => {
      const proj = setupProject(tarballPath!);
      // A retired, user-managed skill copy sits next to the install
      // target; the installer must leave it byte-identical.
      const retiredSkill = path.join(
        proj,
        ".agents",
        "skills",
        "verification-before-completion",
        "SKILL.md",
      );
      fs.mkdirSync(path.dirname(retiredSkill), { recursive: true });
      fs.writeFileSync(retiredSkill, "# team-managed retired copy\n");
      const r = runCli(proj, ["install", "skills", "--skill", "playwright-cli"]);
      assert.equal(
        r.status,
        0,
        `install skills --skill playwright-cli exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
      );
      // playwright-cli must be present — otherwise the filter-leak
      // check below would pass vacuously if the whole install silently
      // errored out and produced no skills dir at all.
      assert.ok(findSkillDir(proj, "playwright-cli"), "playwright-cli dir missing (filter test would be vacuous)");
      // A random non-selected workflow skill must NOT be present —
      // proves the filter isn't a silent no-op that installs everything.
      assert.ok(
        !findSkillDir(proj, "planning-with-files"),
        "non-selected skill leaked through filter: planning-with-files",
      );
      assert.equal(
        fs.readFileSync(retiredSkill, "utf-8"),
        "# team-managed retired copy\n",
        "installing a workflow skill must not modify a retired user-managed copy",
      );
    });
  },
);
