#!/usr/bin/env node
// Smoke + assertion tests for pr-create-guard.
//
// Each case spawns index.mjs exactly the way Claude Code does (JSON on
// stdin, tool_input shape), captures exit / stdout / stderr, and asserts.
// No shared state between cases.
//
//     node .claude/hooks/pr-create-guard/test.mjs
//
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, "index.mjs");

function run(command) {
  const payload = JSON.stringify({
    session_id: "test",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command, description: "test" },
  });
  const r = spawnSync("node", [ENTRY], { input: payload, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// Scratch dir for --body-file cases. Cleaned up in finally.
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "pr-create-guard-test-"));
const GOOD_FILE = path.join(SCRATCH, "good.md");
fs.writeFileSync(
  GOOD_FILE,
  "## Summary\n\nScope.\n\n## Test plan\n\n- [ ] do the thing\n\n## Risks\n\nLow.\n\n## Remaining TODO\n\n- [ ] ship\n",
);
const MISSING_FILE = path.join(SCRATCH, "missing.md");

const cases = [
  {
    name: "non-gh-pr-create command passes through silently",
    cmd: "ls -la .claude/hooks/",
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "gh pr view (not create/ready) passes through",
    cmd: 'gh pr view 14 --json body',
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "gh pr create with no body flag is blocked",
    cmd: 'gh pr create --title "some title"',
    expect: { status: 2, stderrIncludes: "No body source" },
  },
  {
    name: "gh pr create --body \"\" (empty) is blocked",
    cmd: 'gh pr create --title foo --body ""',
    expect: { status: 2, stderrIncludes: "Empty --body" },
  },
  {
    name: "gh pr create -b \"\" (short empty) is blocked",
    cmd: 'gh pr create --title foo -b ""',
    expect: { status: 2, stderrIncludes: "Empty --body" },
  },
  {
    name: "gh pr create --body-file <nonexistent> is blocked",
    cmd: `gh pr create --title foo --body-file ${JSON.stringify(MISSING_FILE)}`,
    expect: { status: 2, stderrIncludes: "not found" },
  },
  {
    name: "gh pr create --body with headings injects additionalContext",
    cmd: `gh pr create --title foo --body ${JSON.stringify("## Summary\n\nok.\n\n## Test plan\n\n- [ ] run it")}`,
    expect: { status: 0, stdoutIncludes: "additionalContext" },
  },
  {
    name: "gh pr create --body-file <existing> scans the file",
    cmd: `gh pr create --title foo --body-file ${JSON.stringify(GOOD_FILE)}`,
    expect: { status: 0, stdoutIncludes: "## Summary" },
  },
  {
    name: "gh pr create --body with heredoc-ish subshell falls back",
    cmd: `gh pr create --title foo --body "$(cat <<'EOF'\n## Summary\nok\nEOF\n)"`,
    expect: { status: 0, stdoutIncludes: "not statically parseable" },
  },
  {
    name: "gh pr create --template default.md acknowledges template, skips scan",
    cmd: `gh pr create --title foo --template default.md`,
    expect: { status: 0, stdoutIncludes: "--template" },
  },
];

let failed = 0;
let passed = 0;
try {
  for (const c of cases) {
    const r = run(c.cmd);
    const checks = [];
    if (c.expect.status !== undefined) checks.push({ ok: r.status === c.expect.status, msg: `status=${r.status} (want ${c.expect.status})` });
    if (c.expect.stdoutEq !== undefined) checks.push({ ok: r.stdout === c.expect.stdoutEq, msg: `stdout="${r.stdout.slice(0, 60)}..." (want exactly "${c.expect.stdoutEq}")` });
    if (c.expect.stdoutIncludes !== undefined) checks.push({ ok: r.stdout.includes(c.expect.stdoutIncludes), msg: `stdout includes "${c.expect.stdoutIncludes}"? got stdout="${r.stdout.slice(0, 100)}..."` });
    if (c.expect.stderrIncludes !== undefined) checks.push({ ok: r.stderr.includes(c.expect.stderrIncludes), msg: `stderr includes "${c.expect.stderrIncludes}"? got stderr="${r.stderr.slice(0, 100)}..."` });

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
  fs.rmSync(SCRATCH, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
