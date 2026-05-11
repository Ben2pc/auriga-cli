#!/usr/bin/env node
// commit-reminder — PostToolUse hook for file-edit tools.
//
// Claude Code reports tool_name as "Edit" / "Write" / "MultiEdit".
// Codex reports all file edits as tool_name "apply_patch" (its
// canonical name; matcher aliases Edit / Write resolve to it).
// We accept either side's naming so the hook works in both runtimes.
//
// When uncommitted diff vs HEAD crosses size thresholds (lines OR
// files) AND the last reminder was at least 60s ago, injects an
// additionalContext nudging the agent to commit at the next semantic
// boundary. Never blocks. Silent outside a git repo, on git errors,
// or on malformed input.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const LINE_THRESHOLD = 200;
const FILE_THRESHOLD = 8;
const INTERVAL_SECONDS = 60;
const STATE_FILENAME = "auriga-commit-reminder.last";
const MATCH_TOOLS = new Set(["Edit", "Write", "MultiEdit", "apply_patch"]);

// LC_ALL=C forces git --shortstat into stable English output. Without
// this, locales like de_DE / zh_CN translate "files changed" /
// "insertions" / "deletions" and our regex parser silently returns 0.
const GIT_ENV = { ...process.env, LC_ALL: "C" };

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    if (!data || !MATCH_TOOLS.has(data.tool_name)) return exit0();

    const gitDir = resolveGitDir();
    if (!gitDir) return exit0();

    const stat = readDiffStat();
    if (!stat) return exit0();
    const { files, lines } = stat;
    if (files <= FILE_THRESHOLD && lines <= LINE_THRESHOLD) return exit0();

    const now = Math.floor(Date.now() / 1000);
    const last = readStamp(gitDir);
    if (last !== null && now - last < INTERVAL_SECONDS) return exit0();

    writeStamp(gitDir, now);
    return inject(formatMessage(files, lines));
  } catch {
    return exit0();
  }
});

function resolveGitDir() {
  const r = spawnSync("git", ["rev-parse", "--git-dir"], {
    encoding: "utf8",
    timeout: 2000,
    env: GIT_ENV,
  });
  if (r.status !== 0) return null;
  const out = (r.stdout ?? "").trim();
  if (!out) return null;
  return path.resolve(out);
}

function readDiffStat() {
  // Tracked changes (staged + unstaged) — diff vs HEAD.
  const diff = spawnSync("git", ["diff", "--shortstat", "HEAD"], {
    encoding: "utf8",
    timeout: 2000,
    env: GIT_ENV,
  });
  if (diff.status !== 0) return null;
  const tracked = parseShortstat(diff.stdout ?? "");

  // Untracked files — agents that just `Write`-ed a new file have not
  // staged it yet, so `git diff HEAD` won't see it. Count those toward
  // the file threshold so brand-new files still trigger the reminder.
  // Lines are intentionally not counted for untracked files: file count
  // alone is a strong "N new artifacts, commit soon" signal.
  const untracked = spawnSync(
    "git",
    ["ls-files", "--others", "--exclude-standard"],
    { encoding: "utf8", timeout: 2000, env: GIT_ENV },
  );
  if (untracked.status !== 0) return null;
  const untrackedFiles = (untracked.stdout ?? "")
    .split("\n")
    .filter((line) => line.length > 0).length;

  return {
    files: tracked.files + untrackedFiles,
    lines: tracked.lines,
  };
}

// Parse one of:
//   " 3 files changed, 12 insertions(+), 5 deletions(-)\n"
//   " 1 file changed, 10 insertions(+)\n"
//   ""  (no changes)
function parseShortstat(out) {
  const trimmed = out.trim();
  if (!trimmed) return { files: 0, lines: 0 };
  const filesMatch = trimmed.match(/(\d+)\s+files?\s+changed/);
  const insMatch = trimmed.match(/(\d+)\s+insertions?\(\+\)/);
  const delMatch = trimmed.match(/(\d+)\s+deletions?\(-\)/);
  const files = parseInt(filesMatch?.[1] ?? "0", 10);
  const ins = parseInt(insMatch?.[1] ?? "0", 10);
  const del = parseInt(delMatch?.[1] ?? "0", 10);
  return { files, lines: ins + del };
}

// Primary state path lives inside .git/. Fallback path lives under
// os.tmpdir() keyed by a hash of the gitDir, used when .git/ is
// read-only (CI runners, restrictive containers). Without the fallback
// the hook would re-fire on every Edit forever in those environments.
function primaryStatePath(gitDir) {
  return path.join(gitDir, STATE_FILENAME);
}

function fallbackStatePath(gitDir) {
  const hash = createHash("sha256").update(gitDir).digest("hex").slice(0, 12);
  return path.join(os.tmpdir(), `auriga-commit-reminder-${hash}.last`);
}

function readStamp(gitDir) {
  for (const candidate of [primaryStatePath(gitDir), fallbackStatePath(gitDir)]) {
    try {
      const raw = readFileSync(candidate, "utf8").trim();
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) return n;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function writeStamp(gitDir, ts) {
  const primary = primaryStatePath(gitDir);
  try {
    mkdirSync(path.dirname(primary), { recursive: true });
    writeFileSync(primary, String(ts));
    return;
  } catch {
    // .git/ unwritable — fall through to tmpdir.
  }
  try {
    writeFileSync(fallbackStatePath(gitDir), String(ts));
  } catch {
    // Both write paths failed; next call treats reminder as fresh-needed.
  }
}

function formatMessage(files, lines) {
  return [
    `[commit-reminder] Uncommitted diff: ${lines} line(s) across ${files} file(s).`,
    "Consider committing at the next semantic boundary so the working tree stays manageable.",
    "Atomic commits make rebase / bisect / revert dramatically easier.",
  ].join("\n");
}

function inject(message) {
  const out = {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: message,
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

function exit0() {
  process.exit(0);
}
