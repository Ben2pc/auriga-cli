#!/usr/bin/env node
// Smoke tests for commit-reminder (PostToolUse).
//
// The hooks.json matcher decides which tools invoke this script.
// The script itself keys off the working-tree diff, not tool_name.
// These tests cover threshold detection (lines OR files), the
// 5-minute rate-limit window, and graceful no-op outside a git
// repository.
//
//     node tests/commit-reminder.test.mjs

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(
  HERE,
  "..",
  "plugins",
  "auriga-workflow",
  "scripts",
  "commit-reminder.mjs",
);

function setupRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "commit-reminder-test-"));
  spawnSync("git", ["init", "--quiet", "-b", "main"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: dir });
  spawnSync(
    "git",
    ["commit", "--allow-empty", "-m", "init", "--quiet"],
    { cwd: dir },
  );
  return dir;
}

function writeFile(dir, name, lineCount) {
  const full = path.join(dir, name);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, "x\n".repeat(lineCount));
}

function hookEnv(overrides = {}) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.GROK_WORKSPACE_ROOT;
  return { ...env, ...overrides };
}

function run(payload, cwd, env) {
  return spawnSync("node", [ENTRY], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd,
    env: hookEnv(env),
  });
}

function makePluginCache() {
  return mkdtempSync(path.join(tmpdir(), "commit-reminder-plugin-cache-"));
}

function statePath(dir) {
  return path.join(dir, ".git", "auriga-commit-reminder.last");
}

function payload(tool = "Edit") {
  return {
    hook_event_name: "PostToolUse",
    tool_name: tool,
    tool_input: {},
    tool_response: {},
  };
}

let failed = 0;
let passed = 0;

function check(name, condition, info = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}  ${info}`);
  }
}

// Case 1: tool_name is not a script-side gate. Once the matcher
// invokes the script, a huge diff must remind even if the payload
// uses a name that is not in the historical Edit/Write allowlist.
{
  const dir = setupRepo();
  writeFile(dir, "big.txt", 500);
  spawnSync("git", ["add", "."], { cwd: dir });
  const r = run(payload("Read"), dir);
  check(
    "script does not filter by tool_name",
    r.status === 0 && r.stdout.includes("commit-reminder"),
    `stdout="${r.stdout}"`,
  );
}

// Case 2: under both thresholds -> silent
{
  const dir = setupRepo();
  writeFile(dir, "small.txt", 10);
  spawnSync("git", ["add", "."], { cwd: dir });
  const r = run(payload("Edit"), dir);
  check(
    "under threshold stays silent",
    r.status === 0 && r.stdout === "",
    `stdout="${r.stdout}"`,
  );
}

// Case 3: over line threshold + no state file -> inject reminder + create state
{
  const dir = setupRepo();
  writeFile(dir, "big.txt", 500);
  spawnSync("git", ["add", "."], { cwd: dir });
  const r = run(payload("Edit"), dir);
  check(
    "over-line-threshold injects additionalContext",
    r.status === 0 && r.stdout.includes("commit-reminder"),
    `stdout="${r.stdout}"`,
  );
  check(
    "reminder references git-workflow skill",
    r.stdout.includes("git-workflow"),
    `stdout="${r.stdout}"`,
  );
  check(
    "state file created on first reminder",
    existsSync(statePath(dir)),
    `expected file at ${statePath(dir)}`,
  );
}

// Case 4: over threshold + recent state (< 5min) -> silent
{
  const dir = setupRepo();
  writeFile(dir, "big.txt", 500);
  spawnSync("git", ["add", "."], { cwd: dir });
  writeFileSync(statePath(dir), String(Math.floor(Date.now() / 1000)));
  const r = run(payload("Edit"), dir);
  check(
    "within rate-limit window stays silent",
    r.status === 0 && r.stdout === "",
    `stdout="${r.stdout}"`,
  );
}

// Case 5: over threshold + stale state (> 5min) -> inject + refresh state
{
  const dir = setupRepo();
  writeFile(dir, "big.txt", 500);
  spawnSync("git", ["add", "."], { cwd: dir });
  const oldTs = Math.floor(Date.now() / 1000) - 400;
  writeFileSync(statePath(dir), String(oldTs));
  const r = run(payload("Edit"), dir);
  check(
    "stale state triggers reminder",
    r.status === 0 && r.stdout.includes("commit-reminder"),
    `stdout="${r.stdout}"`,
  );
  const newTs = parseInt(readFileSync(statePath(dir), "utf8").trim(), 10);
  check(
    "state file refreshed after reminder",
    Number.isFinite(newTs) && newTs > oldTs,
    `oldTs=${oldTs} newTs=${newTs}`,
  );
}

// Case 6: not a git repo -> silent (no crash, no output)
{
  const dir = mkdtempSync(path.join(tmpdir(), "commit-reminder-not-git-"));
  writeFile(dir, "x.txt", 500);
  const r = run(payload("Edit"), dir);
  check(
    "non-git directory stays silent",
    r.status === 0 && r.stdout === "",
    `stdout="${r.stdout}"`,
  );
}

// Case 6b: Cursor-shaped payload — process cwd is a plugin cache, the
// dirty repo is named by workspace_roots. Must remind against that repo
// and write cooldown state there, not into the cache.
{
  const repo = setupRepo();
  writeFile(repo, "big.txt", 500);
  spawnSync("git", ["add", "."], { cwd: repo });
  const cache = makePluginCache();
  const r = run(
    { ...payload("Write"), workspace_roots: [repo, cache] },
    cache,
  );
  check(
    "workspace_roots from plugin-cache cwd injects reminder",
    r.status === 0 &&
      r.stdout.includes("commit-reminder") &&
      r.stdout.includes("500"),
    `stdout="${r.stdout}"`,
  );
  check(
    "cooldown state is written to the workspace repo, not the plugin cache",
    existsSync(statePath(repo)) && !existsSync(statePath(cache)),
    `repoState=${existsSync(statePath(repo))} cacheState=${existsSync(statePath(cache))}`,
  );
}

// Case 6c: Grok-shaped payload fields still locate the repo.
{
  const repo = setupRepo();
  writeFile(repo, "big.txt", 500);
  spawnSync("git", ["add", "."], { cwd: repo });
  const cache = makePluginCache();
  const viaRoot = run(
    { ...payload("search_replace"), workspaceRoot: repo },
    cache,
  );
  check(
    "workspaceRoot from plugin-cache cwd injects reminder",
    viaRoot.status === 0 && viaRoot.stdout.includes("commit-reminder"),
    `stdout="${viaRoot.stdout}"`,
  );

  const repo2 = setupRepo();
  writeFile(repo2, "big.txt", 500);
  spawnSync("git", ["add", "."], { cwd: repo2 });
  const viaCwd = run({ ...payload("search_replace"), cwd: repo2 }, cache);
  check(
    "payload cwd from plugin-cache cwd injects reminder",
    viaCwd.status === 0 && viaCwd.stdout.includes("commit-reminder"),
    `stdout="${viaCwd.stdout}"`,
  );
}

// Case 6d: CLAUDE_PROJECT_DIR / GROK_WORKSPACE_ROOT locate the repo
// when the payload has no workspace fields.
{
  const repo = setupRepo();
  writeFile(repo, "big.txt", 500);
  spawnSync("git", ["add", "."], { cwd: repo });
  const cache = makePluginCache();
  const viaClaude = run(payload("Write"), cache, {
    CLAUDE_PROJECT_DIR: repo,
  });
  check(
    "CLAUDE_PROJECT_DIR from plugin-cache cwd injects reminder",
    viaClaude.status === 0 && viaClaude.stdout.includes("commit-reminder"),
    `stdout="${viaClaude.stdout}"`,
  );

  const repo2 = setupRepo();
  writeFile(repo2, "big.txt", 500);
  spawnSync("git", ["add", "."], { cwd: repo2 });
  const viaGrok = run(payload("Write"), cache, {
    GROK_WORKSPACE_ROOT: repo2,
  });
  check(
    "GROK_WORKSPACE_ROOT from plugin-cache cwd injects reminder",
    viaGrok.status === 0 && viaGrok.stdout.includes("commit-reminder"),
    `stdout="${viaGrok.stdout}"`,
  );
}

// Case 6e: plugin-cache cwd and no workspace signal → still silent
{
  const cache = makePluginCache();
  const r = run(payload("Write"), cache);
  check(
    "plugin-cache cwd with no workspace signal stays silent",
    r.status === 0 && r.stdout === "",
    `stdout="${r.stdout}"`,
  );
}

// Case 7: file-count threshold (>8 files) triggers even at low line count
{
  const dir = setupRepo();
  for (let i = 0; i < 10; i++) writeFile(dir, `f${i}.txt`, 3);
  spawnSync("git", ["add", "."], { cwd: dir });
  const r = run(payload("Edit"), dir);
  check(
    "file-count threshold triggers reminder",
    r.status === 0 && r.stdout.includes("commit-reminder"),
    `stdout="${r.stdout}"`,
  );
}

// Case 8: malformed JSON payload -> silent
{
  const r = spawnSync("node", [ENTRY], {
    input: "not json",
    encoding: "utf8",
  });
  check(
    "malformed JSON stays silent",
    r.status === 0 && r.stdout === "",
    `stdout="${r.stdout}"`,
  );
}

// Case 9: Write tool triggers same as Edit
{
  const dir = setupRepo();
  writeFile(dir, "big.txt", 500);
  spawnSync("git", ["add", "."], { cwd: dir });
  const r = run(payload("Write"), dir);
  check(
    "Write tool triggers reminder",
    r.status === 0 && r.stdout.includes("commit-reminder"),
    `stdout="${r.stdout}"`,
  );
}

// Case 10: MultiEdit tool triggers same as Edit
{
  const dir = setupRepo();
  writeFile(dir, "big.txt", 500);
  spawnSync("git", ["add", "."], { cwd: dir });
  const r = run(payload("MultiEdit"), dir);
  check(
    "MultiEdit tool triggers reminder",
    r.status === 0 && r.stdout.includes("commit-reminder"),
    `stdout="${r.stdout}"`,
  );
}

// Case 11: host-specific file-edit names still remind when invoked.
// Matcher coverage is asserted separately against hooks.json; this
// loop locks the script-side contract that tool_name is not a gate.
// Each tool gets its own repo so the 5-minute rate limit does not
// hide later names.
{
  for (const tool of [
    "apply_patch",
    "StrReplace",
    "NotebookEdit",
    "Delete",
    "EditNotebook",
  ]) {
    const dir = setupRepo();
    writeFile(dir, "big.txt", 500);
    spawnSync("git", ["add", "."], { cwd: dir });
    const r = run(payload(tool), dir);
    check(
      `${tool} tool_name still reminds when invoked`,
      r.status === 0 && r.stdout.includes("commit-reminder"),
      `stdout="${r.stdout}"`,
    );
  }
}

// Case 12: untracked files alone (no git add) cross the file threshold
// — covers the realistic PostToolUse flow where agents Write new files
// without staging them. Regression guard against the silent-no-op bug
// where `git diff HEAD` ignored untracked content.
{
  const dir = setupRepo();
  for (let i = 0; i < 10; i++) writeFile(dir, `untracked-${i}.txt`, 3);
  // NB: no `git add` — files stay untracked.
  const r = run(payload("Write"), dir);
  check(
    "untracked files cross file threshold without git add",
    r.status === 0 && r.stdout.includes("commit-reminder"),
    `stdout="${r.stdout}"`,
  );
}

// Case 13: a small number of untracked files plus a small tracked diff
// must stay under the threshold (negative test — avoids false-positive
// reminders for routine single-file work).
{
  const dir = setupRepo();
  writeFile(dir, "tracked.txt", 5);
  spawnSync("git", ["add", "tracked.txt"], { cwd: dir });
  writeFile(dir, "untracked.txt", 5);
  const r = run(payload("Edit"), dir);
  check(
    "few tracked + few untracked stays silent",
    r.status === 0 && r.stdout === "",
    `stdout="${r.stdout}"`,
  );
}

// Case 14: primary state path unwritable → hook falls back to tmpdir,
// still injects reminder, still honors the rate limit via fallback.
// Simulates read-only .git/ (CI / restricted containers) by placing a
// directory at the primary state path so writeFileSync hits EISDIR.
{
  const dir = setupRepo();
  writeFile(dir, "big.txt", 500);
  spawnSync("git", ["add", "."], { cwd: dir });
  // Make primary path unwritable by occupying it with a directory.
  mkdirSync(path.join(dir, ".git", "auriga-commit-reminder.last"), {
    recursive: true,
  });

  const r1 = run(payload("Edit"), dir);
  check(
    "primary state unwritable still injects via fallback",
    r1.status === 0 && r1.stdout.includes("commit-reminder"),
    `stdout="${r1.stdout}"`,
  );

  const r2 = run(payload("Edit"), dir);
  check(
    "fallback state respects rate limit",
    r2.status === 0 && r2.stdout === "",
    `stdout2="${r2.stdout}"`,
  );
}

// Structural: hooks.json matcher must name every host file-edit tool.
// The script no longer filters tool_name, so dropping a name here
// silently disables the reminder on that host.
{
  const hooksJsonPath = path.resolve(
    path.dirname(ENTRY),
    "..",
    "hooks",
    "hooks.json",
  );
  const config = JSON.parse(readFileSync(hooksJsonPath, "utf8"));
  const group = (config.hooks?.PostToolUse ?? []).find((entry) =>
    (entry.hooks ?? []).some((hook) =>
      (hook.command ?? "").includes("commit-reminder.mjs"),
    ),
  );
  const named = new Set((group?.matcher ?? "").split("|").map((part) => part.trim()));
  for (const tool of [
    "Edit",
    "Write",
    "MultiEdit",
    "NotebookEdit",
    "apply_patch",
    "StrReplace",
    "Delete",
    "EditNotebook",
    "search_replace",
  ]) {
    check(
      `hooks.json commit-reminder matcher includes ${tool}`,
      named.has(tool),
      `matcher=${JSON.stringify(group?.matcher)}`,
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
