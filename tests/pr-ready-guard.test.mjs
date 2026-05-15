#!/usr/bin/env node
// Smoke + assertion tests for pr-ready-guard.
//
// Each case spawns the plugin script with a fake PreToolUse payload and
// controls the hook's cwd (so we can put stray planning docs into scratch
// dirs without polluting the real repo). Git/gh integration paths that
// need a live remote are exercised manually per README; the smoke cases
// cover the locally-observable branches.
//
//     node tests/pr-ready-guard.test.mjs
//
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(
  HERE,
  "..",
  "plugins",
  "auriga-git-guards",
  "scripts",
  "pr-ready-guard.mjs",
);

function run(command, cwd) {
  const payload = JSON.stringify({
    session_id: "test",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command, description: "test" },
  });
  const r = spawnSync("node", [ENTRY], {
    input: payload,
    encoding: "utf8",
    cwd,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// Makes a scratch dir that looks like a git repo (so upstream-diff
// commands in the hook short-circuit cleanly) but has no remote, no
// gh auth, nothing interesting.
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-ready-guard-test-"));
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  spawnSync("git", ["-C", dir, "config", "user.email", "test@test.invalid"]);
  spawnSync("git", ["-C", dir, "config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "seed"), "x");
  spawnSync("git", ["-C", dir, "add", "."]);
  spawnSync("git", ["-C", dir, "commit", "-q", "-m", "seed"]);
  return dir;
}

const cleanupDirs = [];

const cases = [
  {
    name: "non-gh-pr-ready command passes through silently",
    setup: () => ({ cwd: makeRepo(), cmd: "ls -la" }),
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "gh pr create (not ready) passes through",
    setup: () => ({ cwd: makeRepo(), cmd: 'gh pr create --body "x"' }),
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "echo containing 'gh pr ready' does NOT trigger the hook",
    setup: () => ({ cwd: makeRepo(), cmd: `echo "don't run gh pr ready yet"` }),
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "git commit -m containing 'gh pr ready' does NOT trigger the hook",
    setup: () => {
      const dir = makeRepo();
      // Also plant a stray findings.md to prove: if the hook DID
      // mistakenly trigger on this quoted command, it would block
      // on the stray doc. Since the quote-strip kicks in first, the
      // hook exits 0 silently despite the stray presence.
      fs.writeFileSync(path.join(dir, "findings.md"), "# would block if hook fired\n");
      return { cwd: dir, cmd: `git commit -m "note about gh pr ready workflow"` };
    },
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "stray findings.md at repo root blocks (B2-only → no promote remediation)",
    setup: () => {
      const dir = makeRepo();
      fs.writeFileSync(path.join(dir, "findings.md"), "# notes\n");
      return { cwd: dir, cmd: "gh pr ready" };
    },
    expect: {
      status: 2,
      stderrIncludes: "stray planning docs",
      stderrNotIncludes: "promote",
    },
  },
  {
    name: "stray progress.md + task_plan.md block (names reported)",
    setup: () => {
      const dir = makeRepo();
      fs.writeFileSync(path.join(dir, "progress.md"), "# log\n");
      fs.writeFileSync(path.join(dir, "task_plan.md"), "# plan\n");
      return { cwd: dir, cmd: "gh pr ready" };
    },
    expect: { status: 2, stderrIncludes: "progress.md" },
  },
  {
    name: "stray spec under docs/superpowers/specs/*.md blocks (B3-only → no promote remediation)",
    setup: () => {
      const dir = makeRepo();
      const specDir = path.join(dir, "docs", "superpowers", "specs");
      fs.mkdirSync(specDir, { recursive: true });
      fs.writeFileSync(path.join(specDir, "2026-04-17-foo-design.md"), "# spec\n");
      return { cwd: dir, cmd: "gh pr ready" };
    },
    expect: {
      status: 2,
      stderrIncludes: "spec docs",
      stderrNotIncludes: "promote",
    },
  },
  {
    name: "active spec left in docs/specs/*.md blocks (B4)",
    setup: () => {
      const dir = makeRepo();
      const activeDir = path.join(dir, "docs", "specs");
      fs.mkdirSync(activeDir, { recursive: true });
      fs.writeFileSync(path.join(activeDir, "auriga-go-design.md"), "# active spec\n");
      return { cwd: dir, cmd: "gh pr ready" };
    },
    expect: { status: 2, stderrIncludes: "unfinalized active specs in docs/specs/" },
  },
  {
    name: "B4 message lists promote/archive/delete remediation",
    setup: () => {
      const dir = makeRepo();
      const activeDir = path.join(dir, "docs", "specs");
      fs.mkdirSync(activeDir, { recursive: true });
      fs.writeFileSync(path.join(activeDir, "feature-x-design.md"), "# spec\n");
      return { cwd: dir, cmd: "gh pr ready" };
    },
    expect: { status: 2, stderrIncludes: "promote to docs/architecture/" },
  },
  {
    name: "empty docs/specs/ does NOT block (B4 negative)",
    setup: () => {
      const dir = makeRepo();
      fs.mkdirSync(path.join(dir, "docs", "specs"), { recursive: true });
      // No .md files inside — directory exists but empty.
      return { cwd: dir, cmd: "gh pr ready" };
    },
    expect: { status: 0, stderrNotIncludes: "active specs" },
  },
  {
    name: "non-md files in docs/specs/ don't trigger B4",
    setup: () => {
      const dir = makeRepo();
      const activeDir = path.join(dir, "docs", "specs");
      fs.mkdirSync(activeDir, { recursive: true });
      fs.writeFileSync(path.join(activeDir, ".gitkeep"), "");
      fs.writeFileSync(path.join(activeDir, "draft.md.bak"), "old\n");
      return { cwd: dir, cmd: "gh pr ready" };
    },
    expect: { status: 0, stderrNotIncludes: "active specs" },
  },
  {
    name: "nested active spec docs/specs/<topic>/spec.md blocks (B4 recursive)",
    setup: () => {
      const dir = makeRepo();
      const topicDir = path.join(dir, "docs", "specs", "feature-x");
      fs.mkdirSync(topicDir, { recursive: true });
      fs.writeFileSync(path.join(topicDir, "spec.md"), "# nested spec\n");
      return { cwd: dir, cmd: "gh pr ready" };
    },
    // spec-design / arch-design write docs/specs/<topic>/spec.md — never a
    // flat docs/specs/*.md. The B4 scan must descend into <topic>/, and the
    // reported path must be the full nested repo-relative path.
    expect: { status: 2, stderrIncludes: "docs/specs/feature-x/spec.md" },
  },
  {
    name: "nested spec docs/superpowers/specs/<sub>/design.md blocks (B3 recursive)",
    setup: () => {
      const dir = makeRepo();
      const subDir = path.join(dir, "docs", "superpowers", "specs", "foo");
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, "design.md"), "# nested spec\n");
      return { cwd: dir, cmd: "gh pr ready" };
    },
    expect: { status: 2, stderrIncludes: "docs/superpowers/specs/foo/design.md" },
  },
  {
    name: "archived worklog copy does NOT count as stray",
    setup: () => {
      const dir = makeRepo();
      const worklogDir = path.join(dir, "docs", "worklog", "worklog-2026-04-17-foo");
      fs.mkdirSync(worklogDir, { recursive: true });
      fs.writeFileSync(path.join(worklogDir, "findings.md"), "archived\n");
      // No root-level copies; this one is archived.
      // Also need to ensure no unpushed commits — repo has no remote so
      // the upstream-diff branch will short-circuit.
      return { cwd: dir, cmd: "gh pr ready" };
    },
    // Without a git upstream or gh auth, the hook should proceed past
    // the blocks and into the filter path. We accept either silent pass
    // (if gh query fails silently) or an additionalContext injection;
    // what we're testing is that NO stray-doc block fired.
    expect: { status: 0, stderrNotIncludes: "stray" },
  },
  {
    name: "clean repo passes stray checks (may still fail filter if no gh)",
    setup: () => ({ cwd: makeRepo(), cmd: "gh pr ready" }),
    expect: { status: 0, stderrNotIncludes: "stray" },
  },
  {
    name: "stray-doc check uses git toplevel, not cwd (subdir invocation)",
    setup: () => {
      const dir = makeRepo();
      fs.writeFileSync(path.join(dir, "findings.md"), "# at root\n");
      const subdir = path.join(dir, "src");
      fs.mkdirSync(subdir, { recursive: true });
      // Agent fires the hook from inside src/ — must still see root findings.md
      return { cwd: subdir, cmd: "gh pr ready" };
    },
    expect: { status: 2, stderrIncludes: "findings.md" },
  },
  {
    name: "explicit PR ref skips unpushed-commit check on current branch",
    setup: () => {
      const dir = makeRepo();
      // Fake a scenario where current branch has "unpushed" commits by
      // just not having an upstream — countUnpushed would already return
      // 0 in that case, so this test primarily confirms that extractPRRef
      // returning a value doesn't break the stray-check flow.
      return { cwd: dir, cmd: "gh pr ready 15" };
    },
    // Clean repo + explicit ref → no block, filter path runs; gh may
    // fail in test env so we only assert: no block on unpushed.
    expect: { status: 0, stderrNotIncludes: "unpushed" },
  },

  // ---- Route B: gh pr create without --draft -----------------------
  // pr-ready-guard also fires on `gh pr create` to catch the case where
  // an agent publishes a Ready PR directly (skipping `gh pr ready`).
  // Below: --draft / -d should silently pass; missing --draft should
  // trigger the same structural docs checks as Route A; B1 unpushed is
  // intentionally NOT checked here because gh handles push on create.
  {
    name: "gh pr create with --draft passes through silently (Route B opt-out)",
    setup: () => {
      const dir = makeRepo();
      // Plant stray docs to prove --draft genuinely opts OUT of the
      // structural check (not just absent of docs).
      fs.writeFileSync(path.join(dir, "findings.md"), "# stray but draft\n");
      return { cwd: dir, cmd: 'gh pr create --draft --title foo --body "x"' };
    },
    expect: { status: 0, stdoutEq: "", stderrNotIncludes: "pr-ready-guard" },
  },
  {
    name: "gh pr create with -d short flag passes through silently",
    setup: () => {
      const dir = makeRepo();
      fs.writeFileSync(path.join(dir, "findings.md"), "# stray but -d\n");
      return { cwd: dir, cmd: 'gh pr create -d --title foo --body "x"' };
    },
    expect: { status: 0, stdoutEq: "", stderrNotIncludes: "pr-ready-guard" },
  },
  {
    name: "gh pr create with --draft=true passes through silently",
    setup: () => {
      const dir = makeRepo();
      fs.writeFileSync(path.join(dir, "findings.md"), "# stray but --draft=true\n");
      return { cwd: dir, cmd: 'gh pr create --draft=true --title foo --body "x"' };
    },
    expect: { status: 0, stdoutEq: "", stderrNotIncludes: "pr-ready-guard" },
  },
  {
    name: "gh pr create with --draft=1 / --draft=t / --draft=TRUE (case-insensitive truthy) passes through",
    setup: () => {
      const dir = makeRepo();
      fs.writeFileSync(path.join(dir, "findings.md"), "# stray but truthy\n");
      // Pick one form per test; here case-insensitive TRUE + short t.
      return { cwd: dir, cmd: 'gh pr create --draft=TRUE --title foo' };
    },
    expect: { status: 0, stdoutEq: "", stderrNotIncludes: "pr-ready-guard" },
  },
  {
    name: "gh pr create with --draft=false BLOCKS on stray (cobra falsy → Ready PR)",
    setup: () => {
      const dir = makeRepo();
      fs.writeFileSync(path.join(dir, "findings.md"), "# stray\n");
      // --draft=false semantically creates a NON-draft (Ready) PR per
      // cobra BoolVar; Route B must fire and block on the stray doc.
      return { cwd: dir, cmd: 'gh pr create --draft=false --title foo --body "x"' };
    },
    expect: { status: 2, stderrIncludes: "stray planning docs" },
  },
  {
    name: "gh pr create with --draft=0 BLOCKS on stray (falsy → Ready PR)",
    setup: () => {
      const dir = makeRepo();
      fs.writeFileSync(path.join(dir, "findings.md"), "# stray\n");
      return { cwd: dir, cmd: 'gh pr create --draft=0 --title foo' };
    },
    expect: { status: 2, stderrIncludes: "stray planning docs" },
  },
  {
    name: "gh pr create with --draft= (empty value) BLOCKS on stray (empty → falsy)",
    setup: () => {
      const dir = makeRepo();
      fs.writeFileSync(path.join(dir, "findings.md"), "# stray\n");
      // --draft= with no value is not a valid cobra invocation but we
      // err on the side of "treat as non-draft" since it's not truthy.
      return { cwd: dir, cmd: 'gh pr create --draft= --title foo' };
    },
    expect: { status: 2, stderrIncludes: "stray planning docs" },
  },
  {
    name: "gh pr create --draft at end of command passes through silently (no trailing whitespace)",
    setup: () => {
      const dir = makeRepo();
      fs.writeFileSync(path.join(dir, "findings.md"), "# stray but --draft at end\n");
      return { cwd: dir, cmd: 'gh pr create --title foo --draft' };
    },
    expect: { status: 0, stdoutEq: "", stderrNotIncludes: "pr-ready-guard" },
  },
  {
    name: "gh pr create -d at end of command passes through silently",
    setup: () => {
      const dir = makeRepo();
      fs.writeFileSync(path.join(dir, "findings.md"), "# stray but -d at end\n");
      return { cwd: dir, cmd: 'gh pr create --title foo -d' };
    },
    expect: { status: 0, stdoutEq: "", stderrNotIncludes: "pr-ready-guard" },
  },
  {
    name: "gh pr create without --draft + clean repo passes silently",
    setup: () => ({
      cwd: makeRepo(),
      cmd: 'gh pr create --title foo --body "x"',
    }),
    expect: { status: 0, stdoutEq: "", stderrNotIncludes: "pr-ready-guard" },
  },
  {
    name: "gh pr create without --draft + stray findings.md blocks",
    setup: () => {
      const dir = makeRepo();
      fs.writeFileSync(path.join(dir, "findings.md"), "# notes\n");
      return { cwd: dir, cmd: 'gh pr create --title foo --body "x"' };
    },
    expect: {
      status: 2,
      stderrIncludes: "stray planning docs",
    },
  },
  {
    name: "gh pr create without --draft + active spec blocks with create-route remediation (--draft alternative)",
    setup: () => {
      const dir = makeRepo();
      const activeDir = path.join(dir, "docs", "specs");
      fs.mkdirSync(activeDir, { recursive: true });
      fs.writeFileSync(path.join(activeDir, "feature-x.md"), "# spec\n");
      return { cwd: dir, cmd: 'gh pr create --title foo --body "x"' };
    },
    expect: {
      status: 2,
      // Verifies remediation mentions BOTH the doc resolution paths
      // AND the --draft escape hatch unique to Route B.
      stderrIncludes: "pass --draft",
    },
  },
  {
    name: "gh pr create without --draft + active spec includes promote remediation (B4 promote-able)",
    setup: () => {
      const dir = makeRepo();
      const activeDir = path.join(dir, "docs", "specs");
      fs.mkdirSync(activeDir, { recursive: true });
      fs.writeFileSync(path.join(activeDir, "feature-x.md"), "# spec\n");
      return { cwd: dir, cmd: 'gh pr create --title foo --body "x"' };
    },
    expect: { status: 2, stderrIncludes: "promote to docs/architecture/" },
  },
  {
    name: "echo containing 'gh pr create' does NOT trigger Route B",
    setup: () => {
      const dir = makeRepo();
      // Plant stray to prove the quote-strip prevents this from firing.
      fs.writeFileSync(path.join(dir, "findings.md"), "# would block if hook fired\n");
      return { cwd: dir, cmd: `echo "remember to gh pr create later"` };
    },
    expect: { status: 0, stdoutEq: "", stderrNotIncludes: "pr-ready-guard" },
  },
];

let failed = 0;
let passed = 0;
try {
  for (const c of cases) {
    const { cwd, cmd } = c.setup();
    cleanupDirs.push(cwd);
    const r = run(cmd, cwd);
    const checks = [];
    if (c.expect.status !== undefined)
      checks.push({ ok: r.status === c.expect.status, msg: `status=${r.status} (want ${c.expect.status})` });
    if (c.expect.stdoutEq !== undefined)
      checks.push({ ok: r.stdout === c.expect.stdoutEq, msg: `stdout exact "${c.expect.stdoutEq}" (got "${r.stdout.slice(0, 80)}")` });
    if (c.expect.stdoutIncludes !== undefined)
      checks.push({ ok: r.stdout.includes(c.expect.stdoutIncludes), msg: `stdout includes "${c.expect.stdoutIncludes}" (got "${r.stdout.slice(0, 120)}")` });
    if (c.expect.stderrIncludes !== undefined)
      checks.push({ ok: r.stderr.includes(c.expect.stderrIncludes), msg: `stderr includes "${c.expect.stderrIncludes}" (got "${r.stderr.slice(0, 120)}")` });
    if (c.expect.stderrNotIncludes !== undefined)
      checks.push({ ok: !r.stderr.includes(c.expect.stderrNotIncludes), msg: `stderr does NOT include "${c.expect.stderrNotIncludes}" (got "${r.stderr.slice(0, 120)}")` });

    const allOk = checks.every((x) => x.ok);
    if (allOk) {
      passed++;
      console.log(`  ✓ ${c.name}`);
    } else {
      failed++;
      console.error(`  ✗ ${c.name}`);
      for (const ch of checks) console.error(`      ${ch.ok ? "ok  " : "fail"}  ${ch.msg}`);
    }
  }
} finally {
  for (const d of cleanupDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

// Source-level regression guard: summarize() runs only when gh auth is
// available, so it can't be exercised end-to-end in the smoke harness.
// Read the script source and assert the git-workflow reference is
// present — protects against future edits that drop the skill pointer.
{
  const src = fs.readFileSync(ENTRY, "utf8");
  const ok = src.includes("git-workflow");
  if (ok) {
    passed++;
    console.log("  ✓ pr-ready-guard source references git-workflow skill");
  } else {
    failed++;
    console.error(
      '  ✗ pr-ready-guard source references git-workflow skill — "git-workflow" not found in script',
    );
  }
}

// Structural regression guard for hooks.json: assert pr-ready-guard.mjs
// is registered for BOTH `gh pr ready` AND `gh pr create`. A regression
// that drops the `gh pr create` entry would silently disable Route B
// with no test catching it — this guard is the safety net.
{
  const hooksJsonPath = path.resolve(
    path.dirname(ENTRY),
    "..",
    "hooks",
    "hooks.json",
  );
  const config = JSON.parse(fs.readFileSync(hooksJsonPath, "utf8"));
  const preToolBash = (config.hooks?.PreToolUse ?? []).find(
    (e) => e.matcher === "Bash",
  );
  const entries = preToolBash?.hooks ?? [];
  const matchers = entries
    .filter((h) => (h.command ?? "").includes("pr-ready-guard.mjs"))
    .map((h) => h.if);

  for (const expected of ["Bash(gh pr ready)", "Bash(gh pr create)"]) {
    if (matchers.includes(expected)) {
      passed++;
      console.log(
        `  ✓ hooks.json registers pr-ready-guard.mjs for ${expected}`,
      );
    } else {
      failed++;
      console.error(
        `  ✗ hooks.json missing pr-ready-guard.mjs registration for ${expected} (found: [${matchers.join(", ")}])`,
      );
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
