#!/usr/bin/env node
// Smoke + assertion tests for pr-merge-guard.
//
// pr-merge-guard fetches the PR body via `gh pr view`. To exercise the
// blocking / passing branches deterministically, each case runs the hook
// with a fake `gh` on PATH that prints a fixture body. When a case omits
// a fixture body the fake `gh` exits non-zero, which exercises the
// gh-failure (non-fatal → pass) branch. The fake `gh` also records its
// argv so the ref-forwarding assertion can confirm `gh pr merge <ref>`
// reaches `gh pr view <ref>`.
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
const HOOKS_JSON = path.resolve(
  HERE,
  "..",
  "plugins",
  "auriga-workflow",
  "hooks",
  "hooks.json",
);

const cleanupDirs = [];

// Build a scratch dir with a fake `gh` on PATH. When `body` is a string
// it is written to <scratch>/pr-body.md and the fake gh cats it; when
// `body` is null the fake gh exits 1 (gh-failure simulation). The fake
// gh appends its argv to <scratch>/gh-argv.txt on every call.
function makeScratch(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-merge-guard-test-"));
  cleanupDirs.push(dir);
  const bin = path.join(dir, ".bin");
  fs.mkdirSync(bin);
  const bodyFile = path.join(dir, "pr-body.md");
  const argvFile = path.join(dir, "gh-argv.txt");
  // The hook only ever calls `gh pr view ... --json body -q .body`.
  fs.writeFileSync(
    path.join(bin, "gh"),
    `#!/bin/sh\nprintf 'cwd=%s\\n' "$(pwd)" >> "${argvFile}"\n` +
      `printf '%s\\n' "$*" >> "${argvFile}"\n` +
      `if [ -f "${bodyFile}" ]; then cat "${bodyFile}"; exit 0; fi\nexit 1\n`,
  );
  fs.chmodSync(path.join(bin, "gh"), 0o755);
  if (typeof body === "string") fs.writeFileSync(bodyFile, body);
  return { dir, bin, argvFile };
}

function hookEnv(overrides = {}) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CURSOR_PROJECT_DIR;
  delete env.GROK_WORKSPACE_ROOT;
  return { ...env, ...overrides };
}

function run(command, body, toolName = "Bash", style = "snake", extras = {}) {
  const { dir, bin, argvFile } = makeScratch(body);
  const payload =
    style === "camel"
      ? {
          hookEventName: "PreToolUse",
          toolInput: { command, description: "test" },
        }
      : {
          session_id: "test",
          hook_event_name: "PreToolUse",
          tool_input: { command, description: "test" },
        };
  if (toolName !== null) {
    if (style === "camel") payload.toolName = toolName;
    else payload.tool_name = toolName;
  }
  Object.assign(payload, extras.payload ?? {});
  const cwd = extras.cwd ?? dir;
  const r = spawnSync("node", [ENTRY], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd,
    env: hookEnv({
      PATH: `${bin}:${process.env.PATH}`,
      ...(extras.env ?? {}),
    }),
  });
  const ghArgv = fs.existsSync(argvFile)
    ? fs.readFileSync(argvFile, "utf8")
    : "";
  const ghCwdMatch = ghArgv.match(/^cwd=(.*)$/m);
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    ghArgv,
    ghCwd: ghCwdMatch?.[1] ?? "",
    scratch: dir,
  };
}

function makeGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-merge-guard-repo-"));
  cleanupDirs.push(dir);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  spawnSync("git", ["-C", dir, "config", "user.email", "test@test.invalid"]);
  spawnSync("git", ["-C", dir, "config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "seed"), "x");
  spawnSync("git", ["-C", dir, "add", "."]);
  spawnSync("git", ["-C", dir, "commit", "-q", "-m", "seed"]);
  return dir;
}

function makePluginCache() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-merge-guard-plugin-cache-"));
  cleanupDirs.push(dir);
  return dir;
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

// `- [ ]` inside a fenced code block under the AC heading is an example,
// not a real checklist item — must not block.
const FENCED_CHECKBOX_IN_AC = `## Acceptance criteria

- [x] The real criterion is met

Example of the body shape this guard checks:

\`\`\`markdown
## Acceptance criteria
- [ ] illustrative unchecked item
\`\`\`
`;

// A heading that merely mentions the phrase must not be treated as the
// AC section (anchored heading match).
const MENTIONS_PHRASE_NOT_SECTION = `## Why acceptance criteria matter

- [ ] this is not inside a real Acceptance criteria section
`;

// ONE_UNCHECKED with CRLF line endings — must still block.
const ONE_UNCHECKED_CRLF = ONE_UNCHECKED.replace(/\n/g, "\r\n");

// --- Test plan section fixtures --------------------------------------
// The guard also gates the "Test plan" section: an unchecked test step
// at merge time is verification the author claimed but did not run.

const TEST_PLAN_UNCHECKED = `## Acceptance criteria

- [x] Criterion met

## Test plan

- [x] unit tests run
- [ ] manual verification pending
`;

const TEST_PLAN_ALL_CHECKED = `## Acceptance criteria

- [x] Criterion met

## Test plan

- [x] unit tests run
- [x] manual verification done
`;

// Both sections have unchecked items — the block message must list both,
// each under its own section label.
const BOTH_SECTIONS_UNCHECKED = `## Acceptance criteria

- [ ] Criterion not met

## Test plan

- [ ] manual verification pending
`;

const CHINESE_TEST_PLAN_UNCHECKED = `## 验收标准

- [x] 第一条已满足

## 测试计划

- [ ] 手工模拟器验证待补
`;

const BILINGUAL_TEMPLATE_UNCHECKED = `## Acceptance Criteria / 验收标准

- [ ] 双语验收项待完成

## Test Plan / 验证计划

- [ ] 双语验证项待完成
`;

// `- [ ]` inside a fenced code block under the Test plan heading is an
// example, not a real test step — must not block.
const TEST_PLAN_FENCED = `## Test plan

- [x] real test step done

\`\`\`markdown
## Test plan
- [ ] illustrative unchecked item
\`\`\`
`;

// Test plan fully checked; Remaining TODOs after it has an unchecked
// item — the Test plan scan must stop at the next heading and the
// Remaining TODOs item must not block.
const TEST_PLAN_THEN_TODOS = `## Test plan

- [x] unit tests run

## Remaining TODOs

- [ ] follow-up deferred to CI
`;

// The `测试方案` alias of TEST_PLAN_HEADING is a live regex branch — a
// regression narrowing the alternation must fail a test.
const TEST_PLAN_ALIAS_UNCHECKED = `## 测试方案

- [ ] 集成测试待补
`;

// A Test plan section with no Acceptance criteria heading anywhere —
// pins the testPlan-only block path (acceptance list empty).
const TEST_PLAN_ONLY_UNCHECKED = `## Summary

Adds a thing.

## Test plan

- [ ] manual verification pending
`;

// A heading that merely mentions "test plan" must not be treated as the
// Test plan section (anchored heading match — twin of
// MENTIONS_PHRASE_NOT_SECTION for the Acceptance criteria heading).
const MENTIONS_TEST_PLAN_NOT_SECTION = `## Why the test plan matters

- [ ] this is not inside a real Test plan section
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
    name: "Cursor Shell tool_name still blocks unchecked acceptance items",
    cmd: "gh pr merge --squash --delete-branch",
    toolName: "Shell",
    body: ONE_UNCHECKED,
    expect: { status: 2, stderrIncludes: ["Second criterion not yet met"] },
  },
  {
    name: "Grok camelCase toolInput still blocks unchecked acceptance items",
    cmd: "gh pr merge --squash --delete-branch",
    toolName: "run_terminal_command",
    style: "camel",
    body: ONE_UNCHECKED,
    expect: { status: 2, stderrIncludes: ["Second criterion not yet met"] },
  },
  {
    name: "missing tool_name still blocks unchecked acceptance items",
    cmd: "gh pr merge --squash --delete-branch",
    toolName: null,
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
  {
    name: "unchecked item inside a fenced code block → passes (example, not a task)",
    cmd: "gh pr merge --squash",
    body: FENCED_CHECKBOX_IN_AC,
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "heading that only mentions the phrase is not the AC section → passes",
    cmd: "gh pr merge --squash",
    body: MENTIONS_PHRASE_NOT_SECTION,
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "CRLF line endings → unchecked item still blocks",
    cmd: "gh pr merge --squash",
    body: ONE_UNCHECKED_CRLF,
    expect: { status: 2, stderrIncludes: ["Second criterion not yet met"] },
  },
  {
    name: "unchecked Test plan item → blocks",
    cmd: "gh pr merge --squash",
    body: TEST_PLAN_UNCHECKED,
    expect: { status: 2, stderrIncludes: ["manual verification pending"] },
  },
  {
    name: "all Test plan items checked → passes",
    cmd: "gh pr merge --squash",
    body: TEST_PLAN_ALL_CHECKED,
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "unchecked items in both sections → blocks, lists both under section labels",
    cmd: "gh pr merge --squash",
    body: BOTH_SECTIONS_UNCHECKED,
    expect: {
      status: 2,
      stderrIncludes: [
        "Criterion not met",
        "manual verification pending",
        "Acceptance criteria",
        "Test plan",
      ],
      // Structural: each item must render under its own section label
      // with the per-group count — guards against a regression that
      // emits both labels but pairs them with the wrong items.
      stderrMatches: [
        /Acceptance criteria \(1\):\n {2}- \[ \] Criterion not met/,
        /Test plan \(1\):\n {2}- \[ \] manual verification pending/,
      ],
    },
  },
  {
    name: "Test plan section with no Acceptance criteria section → blocks",
    cmd: "gh pr merge --squash",
    body: TEST_PLAN_ONLY_UNCHECKED,
    expect: {
      status: 2,
      stderrIncludes: ["manual verification pending"],
      // Singular wording when exactly one item blocks across both sections.
      stderrMatches: [/has 1 unchecked pre-merge checklist item /],
    },
  },
  {
    name: "Chinese 测试计划 heading is recognized → blocks",
    cmd: "gh pr merge --squash",
    body: CHINESE_TEST_PLAN_UNCHECKED,
    expect: { status: 2, stderrIncludes: ["手工模拟器验证待补"] },
  },
  {
    name: "Chinese 验证计划 template heading is recognized → blocks",
    cmd: "gh pr merge --squash",
    body: CHINESE_TEST_PLAN_UNCHECKED.replace("测试计划", "验证计划"),
    expect: { status: 2, stderrIncludes: ["手工模拟器验证待补"] },
  },
  {
    name: "bilingual template headings are recognized → blocks",
    cmd: "gh pr merge --squash",
    body: BILINGUAL_TEMPLATE_UNCHECKED,
    expect: {
      status: 2,
      stderrIncludes: ["双语验收项待完成", "双语验证项待完成"],
    },
  },
  {
    name: "Chinese 测试方案 alias heading is recognized → blocks",
    cmd: "gh pr merge --squash",
    body: TEST_PLAN_ALIAS_UNCHECKED,
    expect: { status: 2, stderrIncludes: ["集成测试待补"] },
  },
  {
    name: "heading that only mentions 'test plan' is not the Test plan section → passes",
    cmd: "gh pr merge --squash",
    body: MENTIONS_TEST_PLAN_NOT_SECTION,
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "unchecked item inside a fenced block under Test plan → passes",
    cmd: "gh pr merge --squash",
    body: TEST_PLAN_FENCED,
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "unchecked Remaining TODOs after a Test plan section → passes",
    cmd: "gh pr merge --squash",
    body: TEST_PLAN_THEN_TODOS,
    expect: { status: 0, stdoutEq: "" },
  },
];

// ---- Runner ----------------------------------------------------------

let passed = 0;
let failed = 0;

function check(name, errs) {
  if (errs.length === 0) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`);
    for (const e of errs) console.log(`      ${e}`);
  }
}

for (const c of cases) {
  const r = run(c.cmd, c.body, c.toolName, c.style);
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
  for (const re of c.expect.stderrMatches ?? []) {
    if (!re.test(r.stderr)) {
      errs.push(`expected stderr to match ${re}, got ${JSON.stringify(r.stderr)}`);
    }
  }
  check(c.name, errs);
}

// ---- Structural assertions -------------------------------------------

// Ref forwarding: `gh pr merge <ref>` must reach `gh pr view <ref>`;
// `gh pr merge` with only flags must NOT forward a positional ref.
{
  const withRef = run("gh pr merge 130 --squash", ONE_UNCHECKED);
  check(
    "gh pr merge 130 forwards ref 130 to gh pr view",
    /(^|\s)pr view 130(\s|$)/.test(withRef.ghArgv)
      ? []
      : [`gh pr view argv did not carry ref 130: ${JSON.stringify(withRef.ghArgv)}`],
  );
  const noRef = run("gh pr merge --squash --delete-branch", ALL_CHECKED);
  check(
    "gh pr merge with only flags forwards no positional ref",
    /(^|\s)pr view --json/.test(noRef.ghArgv)
      ? []
      : [`gh pr view argv unexpectedly carried a ref: ${JSON.stringify(noRef.ghArgv)}`],
  );
}

{
  const repo = makeGitRepo();
  const cache = makePluginCache();
  const r = run("gh pr merge --squash", ONE_UNCHECKED, "Bash", "snake", {
    cwd: cache,
    payload: { workspace_roots: [repo] },
  });
  const errs = [];
  if (r.status !== 2) errs.push(`expected exit 2, got ${r.status}`);
  if (!r.stderr.includes("Second criterion not yet met")) {
    errs.push(`expected stderr to mention unchecked item, got ${JSON.stringify(r.stderr)}`);
  }
  const expectedCwd = fs.realpathSync(repo);
  const actualCwd = r.ghCwd ? fs.realpathSync(r.ghCwd) : "";
  if (actualCwd !== expectedCwd) {
    errs.push(`expected gh cwd ${expectedCwd}, got ${JSON.stringify(r.ghCwd)}`);
  }
  check("workspace_roots from plugin-cache cwd inspects the target repo PR", errs);
}

{
  const cache = makePluginCache();
  const r = run("gh pr merge --squash", null, "Bash", "snake", { cwd: cache });
  check(
    "plugin-cache cwd with no workspace signal stays silent",
    r.status === 0 && r.stdout === ""
      ? []
      : [`expected silent pass, got status=${r.status} stdout=${JSON.stringify(r.stdout)}`],
  );
}

// hooks.json wiring: pr-merge-guard.mjs must be registered on the
// shared shell-tool matcher. The script itself recognizes `gh pr merge`.
{
  const errs = [];
  try {
    const hooks = JSON.parse(fs.readFileSync(HOOKS_JSON, "utf8"));
    const group = (hooks?.hooks?.PreToolUse ?? []).find((entry) =>
      (entry.hooks ?? []).some((hook) =>
        (hook.command ?? "").includes("pr-merge-guard.mjs"),
      ),
    );
    if (!group) {
      errs.push("no PreToolUse hook registers pr-merge-guard.mjs");
    } else {
      const named = new Set(
        (group.matcher ?? "").split("|").map((part) => part.trim()),
      );
      for (const tool of ["Bash", "Shell", "PowerShell", "run_terminal_command"]) {
        if (!named.has(tool)) {
          errs.push(`matcher missing ${tool} (found: ${JSON.stringify(group.matcher)})`);
        }
      }
    }
  } catch (e) {
    errs.push(`failed to read/parse hooks.json: ${e.message}`);
  }
  check("hooks.json registers pr-merge-guard.mjs for Bash|Shell|PowerShell", errs);
}

// ---- Teardown --------------------------------------------------------

for (const d of cleanupDirs) {
  fs.rmSync(d, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
