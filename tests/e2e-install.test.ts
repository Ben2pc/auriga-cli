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
// project, spawn `auriga-cli install --all` against real GitHub content
// pinned to the current HEAD SHA, and assert files land correctly".
//
// The gap matters because our content-fetch path couples the published
// package to the git repo at runtime (fetchContentRoot pins to
// v<package.version> by default; AURIGA_CONTENT_REF overrides it).
// Before this test, the only way to validate that coupling end-to-end
// was to publish to npm and try it — the worst possible discovery path.
//
// This test is LOCAL-ONLY for now (dev runs it after `git push`):
//   npm run test:e2e
// It's NOT in `npm test` because it takes ~1-2 minutes and requires
// network access. A follow-up release workflow will wire the same test
// into a tag-push publish gate.

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
      // `npm pack --json` is structured and version-proof: stdout is a
      // JSON array with `.filename` on each entry. Parsing the last
      // line of human-readable output is fragile across npm versions.
      const r = run("npm", ["pack", "--pack-destination", dest, "--json"]);
      if (r.status !== 0) {
        throw new Error(`npm pack failed (exit ${r.status}): ${r.stderr || r.stdout || "(no output)"}`);
      }
      const parsed = JSON.parse(r.stdout) as Array<{ filename?: string }>;
      const filename = parsed?.[0]?.filename;
      if (!filename) {
        throw new Error(`npm pack --json returned unexpected shape: ${r.stdout.slice(0, 200)}`);
      }
      const tarball = path.join(dest, filename);
      if (!fs.existsSync(tarball)) {
        throw new Error(`npm pack claimed to emit ${filename} but it does not exist in ${dest}`);
      }
      return tarball;
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
      // installed tarball's package root does not carry AGENTS.md /
      // skills-lock.json / .claude/*.json (those are excluded from
      // the `files` manifest on purpose — they live on GitHub), so
      // every scenario would fail with a misleading "file missing"
      // error. The e2e's whole point is to exercise the real fetch
      // path, so DEV must be explicitly off.
      const env: NodeJS.ProcessEnv = { ...process.env, AURIGA_CONTENT_REF: gitState().headSha, ...envExtra };
      delete env.DEV;
      return spawnSync(bin, args, { cwd: proj, encoding: "utf-8", env });
    }

    function isClaudeMarketplaceMissingPlugin(output: string, pluginName: string): boolean {
      return new RegExp(`Plugin "${pluginName}" not found in marketplace "auriga-cli"`).test(output);
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
    // which is nasty for a release gate. 180s per test is generous
    // for the 30-40s `install skills` / `install --all` scenarios.
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

    test("install skills → WORKFLOW_SKILLS materialize under .agents/skills/", { timeout: TIMEOUT }, () => {
      const proj = setupProject(tarballPath!);
      const r = runCli(proj, ["install", "skills"]);
      assert.equal(
        r.status,
        0,
        `install skills exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
      );
      assert.ok(findSkillFile(proj, "systematic-debugging"), "systematic-debugging SKILL.md missing");
    });

    test("install recommended --recommended-skill codex-agent → only codex-agent lands", { timeout: TIMEOUT }, () => {
      const proj = setupProject(tarballPath!);
      const r = runCli(proj, ["install", "recommended", "--recommended-skill", "codex-agent"]);
      assert.equal(
        r.status,
        0,
        `install recommended exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
      );
      assert.ok(findSkillFile(proj, "codex-agent"), "codex-agent SKILL.md missing");
    });

    test(
      "install plugins --plugin auriga-workflow → plugin registered in .claude/settings.json",
      { skip: CLAUDE_AVAILABLE ? undefined : "requires 'claude' CLI", timeout: TIMEOUT },
      (t) => {
        const proj = setupProject(tarballPath!);
        const r = runCli(proj, ["install", "plugins", "--plugin", "auriga-workflow"]);
        // A freshly renamed/added plugin is not in the Claude marketplace
        // default branch until this PR merges; `claude plugins marketplace
        // add` always pulls from the repo's default branch. Skip rather than
        // fail in that pre-merge window.
        if (isClaudeMarketplaceMissingPlugin(r.stderr, "auriga-workflow")) {
          t.skip(
            "auriga-workflow is present on this PR branch but not yet in the Claude marketplace default branch",
          );
          return;
        }
        assert.equal(
          r.status,
          0,
          `install plugins exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
        );
        const settings = path.join(proj, ".claude", "settings.json");
        assert.ok(fs.existsSync(settings), `.claude/settings.json missing at ${settings}`);
        const content = fs.readFileSync(settings, "utf-8");
        assert.match(content, /auriga-workflow/, "auriga-workflow not mentioned in .claude/settings.json");
      },
    );

    test(
      "install plugins --plugin auriga-notify → plugin registered + legacy notify config migrated",
      { skip: CLAUDE_AVAILABLE ? undefined : "requires 'claude' CLI", timeout: TIMEOUT },
      (t) => {
        const proj = setupProject(tarballPath!);
        const legacyDir = path.join(proj, ".claude", "hooks", "notify");
        fs.mkdirSync(legacyDir, { recursive: true });
        fs.writeFileSync(path.join(legacyDir, "config.json"), JSON.stringify({ title: "legacy" }));
        fs.writeFileSync(path.join(legacyDir, "icon.png"), "legacy-icon");
        fs.writeFileSync(
          path.join(proj, ".claude", "settings.json"),
          JSON.stringify({
            hooks: {
              Notification: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "node .claude/hooks/notify/index.mjs",
                      _marker: "auriga:notify",
                    },
                  ],
                },
              ],
            },
          }),
        );

        const r = runCli(proj, ["install", "plugins", "--plugin", "auriga-notify"]);
        if (r.status !== 0 && isClaudeMarketplaceMissingPlugin(r.stderr, "auriga-notify")) {
          t.skip("auriga-notify is present on this PR branch but not yet in the Claude marketplace default branch");
          return;
        }
        assert.equal(
          r.status,
          0,
          `install plugins exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
        );

        const settings = path.join(proj, ".claude", "settings.json");
        assert.ok(fs.existsSync(settings), ".claude/settings.json missing");
        const content = fs.readFileSync(settings, "utf-8");
        assert.match(content, /auriga-notify/, "auriga-notify not mentioned in .claude/settings.json");

        const pluginConfigDir = path.join(proj, ".claude", "auriga-notify");
        assert.equal(
          fs.readFileSync(path.join(pluginConfigDir, "config.json"), "utf-8"),
          JSON.stringify({ title: "legacy" }),
          "legacy notify config.json was not preserved under the plugin config dir",
        );
        assert.equal(
          fs.readFileSync(path.join(pluginConfigDir, "icon.png"), "utf-8"),
          "legacy-icon",
          "legacy notify icon.png was not preserved under the plugin config dir",
        );
        assert.equal(fs.existsSync(legacyDir), false, "legacy .claude/hooks/notify dir should be removed");

        const parsed = JSON.parse(content) as {
          hooks?: Record<string, Array<{ hooks: Array<{ _marker?: string }> }>>;
        };
        const markers = Object.values(parsed.hooks ?? {})
          .flatMap((events) => events.flatMap((e) => e.hooks.map((h) => h._marker)));
        assert.equal(
          markers.some((m) => typeof m === "string" && m.includes("notify")),
          false,
          `legacy auriga:notify marker should be removed, got ${JSON.stringify(markers)}`,
        );
      },
    );

    test("install skills --skill systematic-debugging → filter actually filters (other skills absent)", { timeout: TIMEOUT }, () => {
      const proj = setupProject(tarballPath!);
      const r = runCli(proj, ["install", "skills", "--skill", "systematic-debugging"]);
      assert.equal(
        r.status,
        0,
        `install skills --skill systematic-debugging exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
      );
      // systematic-debugging must be present — otherwise the filter-leak
      // check below would pass vacuously if the whole install silently
      // errored out and produced no skills dir at all.
      assert.ok(findSkillDir(proj, "systematic-debugging"), "systematic-debugging dir missing (filter test would be vacuous)");
      // A random non-selected workflow skill must NOT be present —
      // proves the filter isn't a silent no-op that installs everything.
      assert.ok(
        !findSkillDir(proj, "test-driven-development"),
        "non-selected skill leaked through filter: test-driven-development",
      );
    });

    test(
      "install --all → workflow + skills + default plugins present, opt-in notify absent",
      { skip: CLAUDE_AVAILABLE ? undefined : "requires 'claude' CLI", timeout: TIMEOUT },
      (t) => {
        const proj = setupProject(tarballPath!);
        const r = runCli(proj, ["install", "--all"]);
        // `install --all` may exit 2 on partial success. Accept 0 as
        // strict pass, 2 as soft pass only if every must-have category
        // artifact landed — per-category assertions below catch the
        // silent-failure regression where one category errors inside
        // the loop and the test otherwise accepts "mostly green".
        if (r.status !== 0 && r.status !== 2) {
          assert.fail(`install --all exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
        }

        const agentsMd = path.join(proj, "AGENTS.md");
        assert.ok(fs.existsSync(agentsMd) && fs.statSync(agentsMd).size > 0, "AGENTS.md missing/empty (workflow category)");

        assert.ok(findSkillFile(proj, "systematic-debugging"), "systematic-debugging SKILL.md missing (skills category)");

        // Plugins category: `.claude/settings.json` exists AND mentions
        // auriga-workflow. Gated above by CLAUDE_AVAILABLE so claude plugins
        // install can actually write it.
        const settings = path.join(proj, ".claude", "settings.json");
        assert.ok(fs.existsSync(settings), ".claude/settings.json missing (plugins category)");
        const settingsContent = fs.readFileSync(settings, "utf-8");
        // Skip in the pre-merge window where auriga-workflow is not yet in
        // the Claude marketplace default branch (see the --plugin test).
        if (
          !/auriga-workflow/.test(settingsContent)
          && isClaudeMarketplaceMissingPlugin(r.stderr, "auriga-workflow")
        ) {
          t.skip(
            "auriga-workflow is present on this PR branch but not yet in the Claude marketplace default branch",
          );
          return;
        }
        assert.match(
          settingsContent,
          /auriga-workflow/,
          "auriga-workflow plugin not registered in settings.json (default plugin selection regressed)",
        );
        assert.doesNotMatch(
          settingsContent,
          /auriga-notify/,
          "auriga-notify is opt-in and must not be installed by install --all",
        );
        assert.equal(
          fs.existsSync(path.join(proj, ".claude", "auriga-notify")),
          false,
          "auriga-notify config dir should not be created by install --all",
        );
      },
    );
  },
);
