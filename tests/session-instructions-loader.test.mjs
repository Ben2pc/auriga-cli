#!/usr/bin/env node
// Smoke tests for session-instructions-loader (SessionStart).
//
//     node tests/session-instructions-loader.test.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(
  HERE,
  "..",
  "plugins",
  "session-instructions-loader",
);
const HOOKS_CONFIG = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8"));
const SESSION_START_HOOK = HOOKS_CONFIG.hooks?.SessionStart?.[0];
const SESSION_START_COMMAND = SESSION_START_HOOK?.hooks?.[0]?.command;

function run(cwd) {
  return runWithSource(cwd, "startup");
}

function runWithSource(cwd, source) {
  const payload = {
    session_id: "test",
    transcript_path: null,
    cwd,
    hook_event_name: "SessionStart",
    model: "gpt-test",
    permission_mode: "default",
    source,
  };
  const r = spawnSync(SESSION_START_COMMAND, {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
    },
    shell: true,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function parseAdditionalContext(stdout) {
  if (stdout.trim() === "") return "";
  const parsed = JSON.parse(stdout);
  return parsed.hookSpecificOutput?.additionalContext ?? "";
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "session-instructions-loader-test-"));
}

const cleanupDirs = [];

const configChecks = [
  {
    ok: SESSION_START_HOOK?.matcher === "startup|resume|compact",
    msg: `SessionStart matcher is ${JSON.stringify(SESSION_START_HOOK?.matcher)}`,
  },
  {
    ok: SESSION_START_COMMAND === 'node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs"',
    msg: `SessionStart command is ${JSON.stringify(SESSION_START_COMMAND)}`,
  },
];

const cases = [
  {
    name: "inside a git repo, injects only AGENTS.md above the git root",
    setup: () => {
      const root = makeTempDir();
      cleanupDirs.push(root);
      fs.writeFileSync(path.join(root, "AGENTS.md"), "workspace parent instructions");

      const repo = path.join(root, "repo");
      fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
      fs.writeFileSync(path.join(repo, "AGENTS.md"), "repo instructions already loaded");

      const cwd = path.join(repo, "pkg", "feature");
      fs.mkdirSync(cwd, { recursive: true });
      return cwd;
    },
    expect: {
      includes: ["workspace parent instructions"],
      excludes: ["repo instructions already loaded"],
    },
  },
  {
    name: "inside a git repo, preserves multiple ancestor AGENTS.md order",
    setup: () => {
      const root = makeTempDir();
      cleanupDirs.push(root);
      fs.writeFileSync(path.join(root, "AGENTS.md"), "outer ancestor instructions");

      const workspace = path.join(root, "workspace");
      fs.mkdirSync(workspace, { recursive: true });
      fs.writeFileSync(path.join(workspace, "AGENTS.md"), "inner ancestor instructions");

      const repo = path.join(workspace, "repo");
      fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
      fs.writeFileSync(path.join(repo, "AGENTS.md"), "repo instructions already loaded");

      const cwd = path.join(repo, "pkg");
      fs.mkdirSync(cwd, { recursive: true });
      return cwd;
    },
    expect: {
      includes: ["outer ancestor instructions", "inner ancestor instructions"],
      excludes: ["repo instructions already loaded"],
      ordered: ["outer ancestor instructions", "inner ancestor instructions"],
    },
  },
  {
    name: "inside a Codex managed worktree, injects original repo ancestors but not Codex home AGENTS.md",
    setup: () => {
      const home = makeTempDir();
      cleanupDirs.push(home);

      const codexHome = path.join(home, ".codex");
      fs.mkdirSync(codexHome, { recursive: true });
      fs.writeFileSync(path.join(codexHome, "AGENTS.md"), "codex home instructions");

      const worktreeParent = path.join(codexHome, "worktrees", "1234");
      fs.mkdirSync(worktreeParent, { recursive: true });
      fs.writeFileSync(path.join(worktreeParent, "AGENTS.md"), "worktree local instructions");

      const workspace = path.join(home, "Workspace");
      fs.mkdirSync(workspace, { recursive: true });
      fs.writeFileSync(path.join(workspace, "AGENTS.md"), "workspace instructions");

      const originalRepo = path.join(workspace, "repo");
      const gitWorktrees = path.join(originalRepo, ".git", "worktrees");
      fs.mkdirSync(gitWorktrees, { recursive: true });

      const repo = path.join(worktreeParent, "repo");
      fs.mkdirSync(repo, { recursive: true });
      fs.writeFileSync(path.join(repo, ".git"), `gitdir: ${path.join(gitWorktrees, "1234")}\n`);

      const cwd = path.join(repo, "pkg");
      fs.mkdirSync(cwd, { recursive: true });
      return cwd;
    },
    expect: {
      includes: ["workspace instructions", "worktree local instructions"],
      excludes: ["codex home instructions"],
    },
  },
  {
    name: "gitfile repositories do not inject non-worktree gitdir target ancestors",
    setup: () => {
      const root = makeTempDir();
      cleanupDirs.push(root);

      const currentWorkspace = path.join(root, "current-workspace");
      fs.mkdirSync(currentWorkspace, { recursive: true });
      fs.writeFileSync(path.join(currentWorkspace, "AGENTS.md"), "current workspace instructions");

      const foreignWorkspace = path.join(root, "foreign-workspace");
      fs.mkdirSync(foreignWorkspace, { recursive: true });
      fs.writeFileSync(path.join(foreignWorkspace, "AGENTS.md"), "foreign workspace instructions");
      fs.mkdirSync(path.join(foreignWorkspace, "repo", ".git"), { recursive: true });

      const repo = path.join(currentWorkspace, "repo");
      fs.mkdirSync(repo, { recursive: true });
      fs.writeFileSync(path.join(repo, ".git"), `gitdir: ${path.join(foreignWorkspace, "repo", ".git")}\n`);

      const cwd = path.join(repo, "pkg");
      fs.mkdirSync(cwd, { recursive: true });
      return cwd;
    },
    expect: {
      includes: ["current workspace instructions"],
      excludes: ["foreign workspace instructions"],
    },
  },
  {
    name: "truncates oversized ancestor AGENTS.md within the content budget",
    setup: () => {
      const root = makeTempDir();
      cleanupDirs.push(root);
      fs.writeFileSync(
        path.join(root, "AGENTS.md"),
        `budget head\n${"x".repeat(70 * 1024)}\ntail after budget`,
      );

      const cwd = path.join(root, "repo", "pkg");
      fs.mkdirSync(path.join(root, "repo", ".git"), { recursive: true });
      fs.mkdirSync(cwd, { recursive: true });
      return cwd;
    },
    expect: {
      includes: ["budget head", "[truncated by session-instructions-loader]"],
      excludes: ["tail after budget"],
    },
  },
  {
    name: "prioritizes nearer ancestor AGENTS.md when content budget is exhausted",
    setup: () => {
      const root = makeTempDir();
      cleanupDirs.push(root);
      fs.writeFileSync(
        path.join(root, "AGENTS.md"),
        `outer budget head\n${"x".repeat(70 * 1024)}\nouter budget tail`,
      );

      const workspace = path.join(root, "workspace");
      fs.mkdirSync(workspace, { recursive: true });
      fs.writeFileSync(path.join(workspace, "AGENTS.md"), "nearest ancestor instructions");

      const cwd = path.join(workspace, "repo", "pkg");
      fs.mkdirSync(path.join(workspace, "repo", ".git"), { recursive: true });
      fs.mkdirSync(cwd, { recursive: true });
      return cwd;
    },
    expect: {
      includes: ["nearest ancestor instructions"],
      excludes: ["outer budget tail"],
    },
  },
  {
    name: "injects repo-local extra files from plugin config",
    setup: () => {
      const root = makeTempDir();
      cleanupDirs.push(root);
      fs.writeFileSync(path.join(root, "AGENTS.md"), "workspace parent instructions");

      const repo = path.join(root, "repo");
      fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
      fs.mkdirSync(path.join(repo, ".agents", "plugins"), { recursive: true });
      fs.mkdirSync(path.join(repo, ".claude"), { recursive: true });
      fs.writeFileSync(path.join(repo, ".claude", "CLAUDE.md"), "repo claude instructions");
      fs.writeFileSync(
        path.join(repo, ".agents", "plugins", "session-instructions-loader.json"),
        JSON.stringify({ extraFiles: [".claude/CLAUDE.md"] }),
      );

      const cwd = path.join(repo, "pkg");
      fs.mkdirSync(cwd, { recursive: true });
      return cwd;
    },
    expect: {
      includes: ["workspace parent instructions", "repo claude instructions"],
      ordered: ["workspace parent instructions", "repo claude instructions"],
    },
  },
  {
    name: "skips extra files outside the project root",
    setup: () => {
      const root = makeTempDir();
      cleanupDirs.push(root);
      fs.writeFileSync(path.join(root, "SECRET.md"), "outside root secret");

      const repo = path.join(root, "repo");
      fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
      fs.mkdirSync(path.join(repo, ".agents", "plugins"), { recursive: true });
      fs.writeFileSync(
        path.join(repo, ".agents", "plugins", "session-instructions-loader.json"),
        JSON.stringify({ extraFiles: ["../SECRET.md", path.join(root, "SECRET.md")] }),
      );

      const cwd = path.join(repo, "pkg");
      fs.mkdirSync(cwd, { recursive: true });
      return cwd;
    },
    expect: {
      excludes: ["outside root secret"],
    },
  },
  {
    name: "supports compact SessionStart source after Codex compaction",
    setup: () => {
      const root = makeTempDir();
      cleanupDirs.push(root);
      fs.writeFileSync(path.join(root, "AGENTS.md"), "workspace parent instructions after compact");

      const repo = path.join(root, "repo");
      fs.mkdirSync(path.join(repo, ".git"), { recursive: true });

      const cwd = path.join(repo, "pkg");
      fs.mkdirSync(cwd, { recursive: true });
      return { cwd, source: "compact" };
    },
    expect: {
      includes: ["workspace parent instructions after compact"],
    },
  },
  {
    name: "outside git, injects parent AGENTS.md but not cwd AGENTS.md",
    setup: () => {
      const root = makeTempDir();
      cleanupDirs.push(root);
      fs.writeFileSync(path.join(root, "AGENTS.md"), "non-git parent instructions");

      const cwd = path.join(root, "child");
      fs.mkdirSync(cwd, { recursive: true });
      fs.writeFileSync(path.join(cwd, "AGENTS.md"), "cwd instructions");
      return cwd;
    },
    expect: {
      includes: ["non-git parent instructions"],
      excludes: ["cwd instructions"],
    },
  },
  {
    name: "no ancestor AGENTS.md exits silently",
    setup: () => {
      const root = makeTempDir();
      cleanupDirs.push(root);
      const cwd = path.join(root, "repo", "pkg");
      fs.mkdirSync(path.join(root, "repo", ".git"), { recursive: true });
      fs.mkdirSync(cwd, { recursive: true });
      return cwd;
    },
    expect: { stdoutEq: "" },
  },
];

let failed = 0;
let passed = 0;

try {
  for (const check of configChecks) {
    if (check.ok) {
      passed++;
      console.log(`  ✓ ${check.msg}`);
    } else {
      failed++;
      console.error(`  ✗ ${check.msg}`);
    }
  }

  for (const c of cases) {
    const setupResult = c.setup();
    const cwd = typeof setupResult === "string" ? setupResult : setupResult.cwd;
    const source = typeof setupResult === "string" ? "startup" : (setupResult.source ?? "startup");
    const r = runWithSource(cwd, source);
    const checks = [];
    checks.push({ ok: r.status === 0, msg: `status=${r.status} stderr=${r.stderr}` });

    if (c.expect.stdoutEq !== undefined) {
      checks.push({
        ok: r.stdout === c.expect.stdoutEq,
        msg: `stdout exact match (got "${r.stdout.slice(0, 120)}")`,
      });
    } else {
      let context = "";
      try {
        context = parseAdditionalContext(r.stdout);
      } catch (err) {
        checks.push({ ok: false, msg: `stdout is not valid hook JSON: ${err.message}` });
      }
      for (const expected of c.expect.includes ?? []) {
        checks.push({
          ok: context.includes(expected),
          msg: `context includes "${expected}"`,
        });
      }
      for (const unexpected of c.expect.excludes ?? []) {
        checks.push({
          ok: !context.includes(unexpected),
          msg: `context excludes "${unexpected}"`,
        });
      }
      let previousIndex = -1;
      for (const expected of c.expect.ordered ?? []) {
        const index = context.indexOf(expected);
        checks.push({
          ok: index > previousIndex,
          msg: `context order includes "${expected}" after index ${previousIndex}`,
        });
        previousIndex = index;
      }
    }

    const allOk = checks.every((x) => x.ok);
    if (allOk) {
      passed++;
      console.log(`  ✓ ${c.name}`);
    } else {
      failed++;
      console.error(`  ✗ ${c.name}`);
      for (const check of checks.filter((x) => !x.ok)) {
        console.error(`    - ${check.msg}`);
      }
      console.error(`    stdout: ${r.stdout.slice(0, 240)}`);
      console.error(`    stderr: ${r.stderr.slice(0, 240)}`);
    }
  }
} finally {
  for (const dir of cleanupDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`session-instructions-loader: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
