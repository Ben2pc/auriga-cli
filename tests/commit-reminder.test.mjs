#!/usr/bin/env node
// Smoke tests for commit-reminder (PostToolUse).
//
// Verifies non-Edit/Write tools are skipped, threshold detection
// (lines OR files), the 60s rate-limit window, and graceful no-op
// outside a git repository.
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
  "auriga-git-guards",
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

function run(payload, cwd) {
  return spawnSync("node", [ENTRY], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd,
  });
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

// Case 1: non-Edit/Write tool ignored even if diff is huge
{
  const dir = setupRepo();
  writeFile(dir, "big.txt", 500);
  spawnSync("git", ["add", "."], { cwd: dir });
  const r = run(payload("Read"), dir);
  check(
    "non-Edit/Write tool is ignored",
    r.status === 0 && r.stdout === "",
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
    "state file created on first reminder",
    existsSync(statePath(dir)),
    `expected file at ${statePath(dir)}`,
  );
}

// Case 4: over threshold + recent state (< 60s) -> silent
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

// Case 5: over threshold + stale state (> 60s) -> inject + refresh state
{
  const dir = setupRepo();
  writeFile(dir, "big.txt", 500);
  spawnSync("git", ["add", "."], { cwd: dir });
  const oldTs = Math.floor(Date.now() / 1000) - 120;
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

// Case 11: Codex reports file edits as tool_name "apply_patch"
{
  const dir = setupRepo();
  writeFile(dir, "big.txt", 500);
  spawnSync("git", ["add", "."], { cwd: dir });
  const r = run(payload("apply_patch"), dir);
  check(
    "Codex apply_patch tool_name triggers reminder",
    r.status === 0 && r.stdout.includes("commit-reminder"),
    `stdout="${r.stdout}"`,
  );
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
// still injects reminder, still honors 60s rate limit via fallback.
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
    "fallback state respects 60s rate limit",
    r2.status === 0 && r2.stdout === "",
    `stdout2="${r2.stdout}"`,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
