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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const LINE_THRESHOLD = 200;
const FILE_THRESHOLD = 8;
const INTERVAL_SECONDS = 60;
const STATE_FILENAME = "auriga-commit-reminder.last";
const MATCH_TOOLS = new Set(["Edit", "Write", "MultiEdit", "apply_patch"]);

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

    const statePath = path.join(gitDir, STATE_FILENAME);
    const now = Math.floor(Date.now() / 1000);
    const last = readStamp(statePath);
    if (last !== null && now - last < INTERVAL_SECONDS) return exit0();

    writeStamp(statePath, now);
    return inject(formatMessage(files, lines));
  } catch {
    return exit0();
  }
});

function resolveGitDir() {
  const r = spawnSync("git", ["rev-parse", "--git-dir"], {
    encoding: "utf8",
    timeout: 2000,
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
    { encoding: "utf8", timeout: 2000 },
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

function readStamp(p) {
  try {
    const raw = readFileSync(p, "utf8").trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeStamp(p, ts) {
  try {
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, String(ts));
  } catch {
    // Best-effort: failing to persist just means the next call
    // will treat the reminder as fresh-needed again.
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
