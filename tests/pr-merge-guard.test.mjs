#!/usr/bin/env node
// Smoke + assertion tests for pr-merge-guard.
//
// pr-merge-guard fetches the PR body via `gh pr view`. To exercise the
// blocking / passing branches deterministically, each case runs the hook
// with a fake `gh` on PATH that prints a fixture body. When a case omits
// a fixture body the fake `gh` exits non-zero, which exercises the
// gh-failure (non-fatal → pass) branch.
//
//     node tests/pr-merge-guard.test.mjs
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
  "auriga-workflow",
  "scripts",
  "pr-merge-guard.mjs",
);

// Build a scratch dir with a fake `gh` on PATH. When `body` is a string
// it is written to <scratch>/pr-body.md and the fake gh cats it; when
// `body` is null the fake gh exits 1 (gh-failure simulation).
function makeScratch(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-merge-guard-test-"));
  const bin = path.join(dir, ".bin");
  fs.mkdirSync(bin);
  const bodyFile = path.join(dir, "pr-body.md");
  // The hook only ever calls `gh pr view ... --json body -q .body`.
  fs.writeFileSync(
    path.join(bin, "gh"),
    `#!/bin/sh\nif [ -f "${bodyFile}" ]; then cat "${bodyFile}"; exit 0; fi\nexit 1\n`,
  );
  fs.chmodSync(path.join(bin, "gh"), 0o755);
  if (typeof body === "string") fs.writeFileSync(bodyFile, body);
  return { dir, bin };
}

function run(command, body) {
  const { dir, bin } = makeScratch(body);
  const payload = JSON.stringify({
    session_id: "test",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command, description: "test" },
  });
  const r = spawnSync("node", [ENTRY], {
    input: payload,
    encoding: "utf8",
    cwd: dir,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// ---- Body fixtures ---------------------------------------------------

const ALL_CHECKED = `## Scope

Does a thing.

## Acceptance criteria

- [x] First criterion met
- [x] Second criterion met

## Remaining TODOs

- None.
`;

const ONE_UNCHECKED = `## Acceptance criteria

- [x] First criterion met
- [ ] Second criterion not yet met
`;

const UNCHECKED_OUTSIDE = `## Acceptance criteria

- [x] All acceptance criteria met

## Remaining TODOs

- [ ] Follow-up tracked in issue #999
`;

const NO_AC_SECTION = `## Scope

A trivial change.

## Risks

- Low.
`;

const AC_WITH_PLAIN_BULLETS = `## Acceptance criteria

- [x] Criterion met
- Plain informational bullet, not a task
`;

const TWO_UNCHECKED = `## Acceptance criteria

- [ ] Alpha pending
- [ ] Beta pending
`;

const CHINESE_UNCHECKED = `## 验收标准

- [x] 第一条已满足
- [ ] 第二条尚未满足
`;

const UPPERCASE_X = `## Acceptance criteria

- [X] Done with uppercase X
`;

// ---- Cases -----------------------------------------------------------

const cases = [
  {
    name: "non-gh-pr-merge command passes through silently",
    cmd: "ls -la",
    body: ONE_UNCHECKED,
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "echo containing 'gh pr merge' does NOT trigger the hook",
    cmd: `echo "remember to gh pr merge later"`,
    body: ONE_UNCHECKED,
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "git commit -m containing 'gh pr merge' does NOT trigger the hook",
    cmd: `git commit -m "prep for gh pr merge"`,
    body: ONE_UNCHECKED,
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "all acceptance-criteria items checked → passes",
    cmd: "gh pr merge --squash",
    body: ALL_CHECKED,
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "unchecked acceptance-criteria item → blocks",
    cmd: "gh pr merge --squash --delete-branch",
    body: ONE_UNCHECKED,
    expect: { status: 2, stderrIncludes: ["Second criterion not yet met"] },
  },
  {
    name: "unchecked item outside the acceptance section → passes",
    cmd: "gh pr merge --squash",
    body: UNCHECKED_OUTSIDE,
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "no acceptance-criteria section → passes",
    cmd: "gh pr merge",
    body: NO_AC_SECTION,
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "acceptance section with checked items + plain bullets → passes",
    cmd: "gh pr merge --squash",
    body: AC_WITH_PLAIN_BULLETS,
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "gh failure (body unavailable) is non-fatal → passes",
    cmd: "gh pr merge",
    body: null,
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "two unchecked items → blocks and lists both",
    cmd: "gh pr merge --squash",
    body: TWO_UNCHECKED,
    expect: { status: 2, stderrIncludes: ["Alpha pending", "Beta pending"] },
  },
  {
    name: "explicit PR ref (gh pr merge 130) still fetches body and blocks",
    cmd: "gh pr merge 130 --squash",
    body: ONE_UNCHECKED,
    expect: { status: 2, stderrIncludes: ["Second criterion not yet met"] },
  },
  {
    name: "Chinese 验收标准 heading is recognized → blocks",
    cmd: "gh pr merge --squash",
    body: CHINESE_UNCHECKED,
    expect: { status: 2, stderrIncludes: ["第二条尚未满足"] },
  },
  {
    name: "uppercase [X] counts as checked → passes",
    cmd: "gh pr merge --squash",
    body: UPPERCASE_X,
    expect: { status: 0, stdoutEq: "" },
  },
];

// ---- Runner ----------------------------------------------------------

let passed = 0;
let failed = 0;

for (const c of cases) {
  const r = run(c.cmd, c.body);
  const errs = [];
  if (c.expect.status !== undefined && r.status !== c.expect.status) {
    errs.push(`expected exit ${c.expect.status}, got ${r.status}`);
  }
  if (c.expect.stdoutEq !== undefined && r.stdout !== c.expect.stdoutEq) {
    errs.push(`expected stdout ${JSON.stringify(c.expect.stdoutEq)}, got ${JSON.stringify(r.stdout)}`);
  }
  for (const needle of c.expect.stderrIncludes ?? []) {
    if (!r.stderr.includes(needle)) {
      errs.push(`expected stderr to include ${JSON.stringify(needle)}, got ${JSON.stringify(r.stderr)}`);
    }
  }
  if (errs.length === 0) {
    passed++;
    console.log(`  ✓ ${c.name}`);
  } else {
    failed++;
    console.log(`  ✗ ${c.name}`);
    for (const e of errs) console.log(`      ${e}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
