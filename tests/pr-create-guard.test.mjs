#!/usr/bin/env node
// Smoke tests for pr-create-guard (PostToolUse).
//
// Locally-observable paths only: pass-through for non-matching commands
// and graceful fallback when the PR cannot be fetched via gh. The
// happy-path body snapshot is exercised by worktree-isolated subagent
// verification against a real gh session.
//
//     node tests/pr-create-guard.test.mjs

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(
  HERE,
  "..",
  "plugins",
  "auriga-workflow",
  "scripts",
  "pr-create-guard.mjs",
);

function run(payload, opts = {}) {
  const r = spawnSync("node", [ENTRY], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: opts.env ?? process.env,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// Portable fake-gh: writes a node script that exits with predefined
// stdout, drops it into a tmpdir, and returns the dir + a PATH-prepended
// env so callers can spawn pr-create-guard.mjs with gh shimmed to our
// fixture. Lets us exercise the title-check + summarize() happy path
// that otherwise needs real gh auth.
function makeFakeGh(body, title) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-create-guard-fake-gh-"));
  const binDir = path.join(dir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const ghPath = path.join(binDir, "gh");
  // Use node + JSON.stringify for safe payload encoding — covers titles
  // with quotes, newlines, backticks, etc. without shell-escape grief.
  const payload = JSON.stringify({ body: body ?? "", title: title ?? "" });
  const script =
    `#!/usr/bin/env node\n` +
    `process.stdout.write(${JSON.stringify(payload)});\n`;
  fs.writeFileSync(ghPath, script);
  fs.chmodSync(ghPath, 0o755);
  return {
    dir,
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
  };
}

// Standard payload shape for "gh pr create succeeded → URL is in tool_response"
function createSuccessPayload(prUrl) {
  return {
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: 'gh pr create --title foo --body "x"' },
    tool_response: { stdout: `${prUrl}\n`, exit_code: 0 },
  };
}

const cases = [
  {
    name: "non-Bash tool is ignored",
    payload: {
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_input: {},
      tool_response: {},
    },
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "non-gh-pr-create command passes through silently",
    payload: {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
      tool_response: { stdout: "", exit_code: 0 },
    },
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "gh pr view (not create) passes through",
    payload: {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "gh pr view 14 --json body" },
      tool_response: { stdout: '{"body":"x"}', exit_code: 0 },
    },
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "echo containing 'gh pr create' does NOT trigger the hook",
    payload: {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: `echo "don't run gh pr create yet"` },
      tool_response: { stdout: "don't run gh pr create yet\n", exit_code: 0 },
    },
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "git commit -m containing 'gh pr create' does NOT trigger the hook",
    payload: {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: `git commit -m "note about gh pr create workflow"` },
      tool_response: { stdout: "", exit_code: 0 },
    },
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "gh pr create failure (non-zero exit) is ignored",
    payload: {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: 'gh pr create --title foo --body "x"' },
      tool_response: { stderr: "auth failed", exit_code: 1, isError: true },
    },
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "gh pr create success without URL: passive nudge lists six sections",
    payload: {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: 'gh pr create --title foo --body "x"' },
      tool_response: { stdout: "some output without url", exit_code: 0 },
    },
    expect: {
      status: 0,
      stdoutIncludesAll: [
        "could not identify",
        "six sections",
        "design decisions",
        "test plan",
        "git-workflow",
        "Conventional Commits",
      ],
      // Negative anchor: the language-convention reminder was removed —
      // catch a regression that reintroduces it (PR #143).
      stdoutExcludesAll: ["language"],
    },
  },
  {
    name: "gh pr create with URL but fetch fails: fallback lists six sections",
    payload: {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: 'gh pr create --title foo --body "x"' },
      tool_response: {
        stdout: "https://github.com/no-such-owner/no-such-repo/pull/999999\n",
        exit_code: 0,
      },
    },
    // The fetch will fail (no auth / no such repo). The hook should
    // gracefully inject the fallback message containing the five
    // sections — not crash, not block.
    expect: {
      status: 0,
      stdoutIncludesAll: [
        "pr-create-guard",
        "six sections",
        "design decisions",
        "test plan",
        "git-workflow",
        "Conventional Commits",
      ],
      // Negative anchor: the language-convention reminder was removed —
      // catch a regression that reintroduces it (PR #143).
      stdoutExcludesAll: ["language"],
    },
  },
  {
    name: "inline URL in command body does NOT leak: still emits six sections",
    payload: {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      // Body mentions an old PR's URL; tool_response has no URL.
      // The hook must NOT fetch the old PR — it should take the
      // passive-nudge path instead, which includes the six-section
      // verification list.
      tool_input: {
        command:
          'gh pr create --title foo --body "refs https://github.com/some-owner/some-repo/pull/42"',
      },
      tool_response: { stdout: "creating pull request...", exit_code: 0 },
    },
    expect: {
      status: 0,
      stdoutIncludesAll: [
        "could not identify",
        "six sections",
        "design decisions",
        "test plan",
        "git-workflow",
        "Conventional Commits",
      ],
      // Negative anchor: the language-convention reminder was removed —
      // catch a regression that reintroduces it (PR #143).
      stdoutExcludesAll: ["language"],
    },
  },
];

let failed = 0;
let passed = 0;
const cleanupFakeGhDirs = [];

for (const c of cases) {
  const r = run(c.payload);
  const checks = [];
  if (c.expect.status !== undefined)
    checks.push({ ok: r.status === c.expect.status, msg: `status=${r.status} (want ${c.expect.status})` });
  if (c.expect.stdoutEq !== undefined)
    checks.push({
      ok: r.stdout === c.expect.stdoutEq,
      msg: `stdout exact match (got "${r.stdout.slice(0, 80)}")`,
    });
  if (c.expect.stdoutIncludes !== undefined)
    checks.push({
      ok: r.stdout.includes(c.expect.stdoutIncludes),
      msg: `stdout includes "${c.expect.stdoutIncludes}" (got "${r.stdout.slice(0, 120)}")`,
    });
  if (Array.isArray(c.expect.stdoutIncludesAll))
    for (const needle of c.expect.stdoutIncludesAll)
      checks.push({
        ok: r.stdout.includes(needle),
        msg: `stdout includes "${needle}" (got "${r.stdout.slice(0, 200)}")`,
      });
  if (Array.isArray(c.expect.stdoutExcludesAll))
    for (const needle of c.expect.stdoutExcludesAll)
      checks.push({
        ok: !r.stdout.includes(needle),
        msg: `stdout does NOT include "${needle}" (got "${r.stdout.slice(0, 200)}")`,
      });

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

// Behavioral tests for the title-fetched happy path. The fake gh
// installed under PATH=<tmp>/bin returns predefined JSON, so the script
// exercises its real summarize() + CC check branch end-to-end. Each
// case asserts the warning (or its absence) for one CC-conformance
// scenario.
const ccCases = [
  // ---- Non-conforming titles → warning expected ----
  {
    name: "title-check: non-CC title 'Migrate plugins' emits Title format ⚠ warning",
    title: "Migrate plugins",
    body: "## Summary\n- thing",
    expect: { stdoutIncludes: "Title format: ⚠" },
  },
  {
    name: "title-check: capital 'Feat: x' rejected (CC types are lowercase)",
    title: "Feat: x",
    body: "",
    expect: { stdoutIncludes: "Title format: ⚠" },
  },
  {
    name: "title-check: 'feat: ' (empty subject) rejected",
    title: "feat: ",
    body: "",
    expect: { stdoutIncludes: "Title format: ⚠" },
  },
  {
    name: "title-check: 'feat:foo' (no space after colon) rejected",
    title: "feat:foo",
    body: "",
    expect: { stdoutIncludes: "Title format: ⚠" },
  },
  {
    name: "title-check: 'wip: something' (non-CC type) rejected",
    title: "wip: something",
    body: "",
    expect: { stdoutIncludes: "Title format: ⚠" },
  },

  // ---- Conforming titles → NO warning ----
  {
    name: "title-check: 'feat: a' (minimal 1-char subject) accepted",
    title: "feat: a",
    body: "",
    expect: { stdoutNotIncludes: "Title format: ⚠" },
  },
  {
    name: "title-check: 'feat!: breaking change' (breaking, no scope) accepted",
    title: "feat!: breaking change",
    body: "",
    expect: { stdoutNotIncludes: "Title format: ⚠" },
  },
  {
    name: "title-check: 'feat(api): foo:bar' (colon in subject) accepted",
    title: "feat(api): foo:bar",
    body: "",
    expect: { stdoutNotIncludes: "Title format: ⚠" },
  },
  {
    name: "title-check: 'fix(deep/scope): x' (slash in scope) accepted",
    title: "fix(deep/scope): x",
    body: "",
    expect: { stdoutNotIncludes: "Title format: ⚠" },
  },
  {
    name: "title-check: 'perf: speed up x' (extended CC type) accepted",
    title: "perf: speed up x",
    body: "",
    expect: { stdoutNotIncludes: "Title format: ⚠" },
  },
  {
    name: "title-check: 'revert: foo' (extended CC type) accepted",
    title: "revert: foo",
    body: "",
    expect: { stdoutNotIncludes: "Title format: ⚠" },
  },
  // ---- Empty title (gh returned empty) → silently skip the check ----
  {
    name: "title-check: empty title silently skipped (parse hiccup, not violation)",
    title: "",
    body: "## Summary",
    expect: { stdoutNotIncludes: "Title format: ⚠" },
  },
];

for (const c of ccCases) {
  const { env, dir } = makeFakeGh(c.body, c.title);
  cleanupFakeGhDirs.push(dir);
  const r = run(createSuccessPayload("https://github.com/o/r/pull/42"), { env });
  const checks = [];
  // Status 0 because PostToolUse never blocks.
  checks.push({ ok: r.status === 0, msg: `status=${r.status} (want 0)` });
  if (c.expect.stdoutIncludes !== undefined) {
    checks.push({
      ok: r.stdout.includes(c.expect.stdoutIncludes),
      msg: `stdout includes "${c.expect.stdoutIncludes}" (got "${r.stdout.slice(0, 200)}")`,
    });
  }
  if (c.expect.stdoutNotIncludes !== undefined) {
    checks.push({
      ok: !r.stdout.includes(c.expect.stdoutNotIncludes),
      msg: `stdout does NOT include "${c.expect.stdoutNotIncludes}" (got "${r.stdout.slice(0, 200)}")`,
    });
  }
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

// Source-level regression guard: defense-in-depth alongside the
// behavioral tests above. Catches removals of the CC infrastructure
// even if behavioral tests were also accidentally deleted/disabled.
{
  const src = fs.readFileSync(ENTRY, "utf8");
  const checks = [
    { needle: "CC_TYPES", label: "Conventional Commits type list" },
    { needle: "CC_RE", label: "Conventional Commits regex" },
    { needle: "Title format", label: "title format injection line" },
  ];
  for (const { needle, label } of checks) {
    if (src.includes(needle)) {
      passed++;
      console.log(`  ✓ pr-create-guard source contains ${label}`);
    } else {
      failed++;
      console.error(
        `  ✗ pr-create-guard source contains ${label} — "${needle}" not found`,
      );
    }
  }
}

// Cleanup fake-gh tmpdirs
for (const d of cleanupFakeGhDirs) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
