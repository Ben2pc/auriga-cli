#!/usr/bin/env node
// Smoke tests for agents-md-ancestor-loader (SessionStart).
//
//     node tests/agents-md-ancestor-loader.test.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(
  HERE,
  "..",
  "plugins",
  "agents-md-ancestor-loader",
  "scripts",
  "session-start.mjs",
);

function run(cwd) {
  const payload = {
    session_id: "test",
    transcript_path: null,
    cwd,
    hook_event_name: "SessionStart",
    model: "gpt-test",
    permission_mode: "default",
    source: "startup",
  };
  const r = spawnSync("node", [ENTRY], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function parseAdditionalContext(stdout) {
  if (stdout.trim() === "") return "";
  const parsed = JSON.parse(stdout);
  return parsed.hookSpecificOutput?.additionalContext ?? "";
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agents-md-ancestor-loader-test-"));
}

const cleanupDirs = [];

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

for (const c of cases) {
  const cwd = c.setup();
  const r = run(cwd);
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

for (const dir of cleanupDirs) {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`agents-md-ancestor-loader: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
