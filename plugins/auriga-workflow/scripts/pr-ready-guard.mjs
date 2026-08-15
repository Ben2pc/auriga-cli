#!/usr/bin/env node
// pr-ready-guard — PreToolUse guard for PR transitions into Ready state.
//
// Two trigger routes share this script because they both put a PR
// into Ready immediately and therefore must enforce the same
// structural baseline:
//
//   Route A: `gh pr ready`                  → existing flow
//   Route B: `gh pr create` without --draft → bypasses Route A entirely
//
// Block only on structural signals that can't be reasonably debated:
//   B1  unpushed commits on the current branch  (Route A only — gh
//       pr create handles push itself, so this check is moot there)
//   B2  the active planning pointer and state named by it under .planning/
//   B3  active specs left under docs/specs/ — that directory is a
//       dev-only temporary workspace and must be empty by PR Ready
//       (promote to docs/architecture/, archive to docs/worklog/, or
//       delete; per CLAUDE.md Document Conventions). Cross-PR program
//       specs live under docs/long-running-specs/ and intentionally stay
//       outside this per-PR cleanup gate.
//
// Filter-only (Route A): we fetch the real PR body via gh pr view,
// list ^## / ^### headings, count TODO checkboxes, and inject as
// additionalContext. Route B skips the snapshot because the PR doesn't
// exist yet — pr-create-guard's PostToolUse hook handles that side.
// No text-regex of body content is ever used as a block signal.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    const cmd = toolCommand(data);
    if (typeof cmd !== "string") return exit0();
    // Strip simple quoted runs so mentions of our match phrases inside
    // echo args, git commit messages, etc. don't trigger the hook.
    const stripped = stripQuoted(cmd);

    if (/\bgh\s+pr\s+ready\b/.test(stripped)) {
      return handlePrReady(cmd);
    }
    if (/\bgh\s+pr\s+create\b/.test(stripped)) {
      // --draft / -d defers the Ready transition to a later
      // `gh pr ready`, which Route A guards separately. Silent here.
      if (hasDraftFlag(stripped)) return exit0();
      return handlePrCreateGoingReady();
    }
    return exit0();
  } catch {
    exit0();
  }
});

// Claude Code / Codex / Cursor use tool_input; Grok Build uses toolInput.
function toolCommand(data) {
  const input = data?.tool_input ?? data?.toolInput;
  const cmd = input?.command;
  return typeof cmd === "string" ? cmd : null;
}

// ---------------------------------------------------------------------
// Route handlers

function handlePrReady(cmd) {
  const repoRoot = gitToplevel() ?? process.cwd();
  const artifacts = findUnresolvedReadyArtifacts(repoRoot);
  if (hasUnresolvedArtifacts(artifacts)) {
    return block(formatReadyBlockMessage(artifacts, "ready"));
  }

  // B1: unpushed commits on current branch. Only meaningful when the
  // Agent is marking the current branch's PR ready — if an explicit
  // PR ref was passed (`gh pr ready 15` / `gh pr ready <url>`), the
  // current branch may be unrelated and its push state is irrelevant.
  const prRef = extractPRRef(cmd);
  if (prRef === null) {
    const unpushed = countUnpushed();
    if (unpushed > 0) {
      return block(
        `${unpushed} unpushed commit${unpushed === 1 ? "" : "s"} on current branch. Push first so the PR reflects your local state.`,
      );
    }
  }

  // Filter path: body snapshot. gh failures are non-fatal.
  const body = fetchBody(prRef);
  if (body === null) {
    // Nothing useful to say without a body; stay out of the way.
    return exit0();
  }
  inject(summarize(prRef ?? "(current branch)", body));
}

function handlePrCreateGoingReady() {
  // `gh pr create` without --draft publishes a Ready PR immediately,
  // bypassing Route A entirely. Run the same structural docs checks
  // here so stray planning artifacts can't slip in via this route.
  // Skip B1 (gh handles push on create) and skip the body snapshot
  // (PR doesn't exist yet — PostToolUse pr-create-guard handles it).
  const repoRoot = gitToplevel() ?? process.cwd();
  const artifacts = findUnresolvedReadyArtifacts(repoRoot);
  if (hasUnresolvedArtifacts(artifacts)) {
    return block(formatReadyBlockMessage(artifacts, "create-nondraft"));
  }
  return exit0();
}

// ---------------------------------------------------------------------
// Command parsing

function hasDraftFlag(stripped) {
  // gh follows cobra BoolVar semantics for `--draft`:
  //   - bare `--draft` / `-d`           → true (draft)
  //   - `--draft=<truthy>` (1/t/true)   → true (draft)
  //   - `--draft=<falsy>`  (0/f/false)  → false (Ready PR)
  // Match the truthy paths only; falsy values must NOT silently bypass
  // Route B's structural checks — that's exactly the case Route B exists
  // to catch. The match is case-insensitive to mirror Go's strconv.ParseBool.
  // Anchored on whitespace boundaries so we don't false-match `--draft-something`.
  if (/(?:^|\s)(?:--draft|-d)(?:\s|$)/.test(stripped)) return true;
  const m = stripped.match(/(?:^|\s)--draft=(\S*)(?:\s|$)/);
  if (m) return /^(?:1|t|true)$/i.test(m[1]);
  return false;
}

function extractPRRef(cmd) {
  // `gh pr ready` optionally accepts a PR number or URL as its first
  // positional argument. When omitted, gh picks the PR for the current
  // branch. We don't need to resolve the current branch ourselves —
  // gh pr view with no ref does the same.
  const m = cmd.match(/\bgh\s+pr\s+ready\s+(\S+)/);
  if (!m) return null;
  const candidate = m[1];
  // Ignore flag-starting tokens (`--confirm`, etc.)
  if (candidate.startsWith("-")) return null;
  return candidate;
}

// Minimal quote-stripper so mentions of our match phrases inside quoted
// args (echo, git commit -m, etc.) don't false-positive the hook.
// Handles '...' and "..." with backslash escapes inside double quotes;
// unclosed quote → return input unchanged (upstream regex decides).
function stripQuoted(cmd) {
  let out = "";
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < cmd.length) i++;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    out += c;
  }
  return quote === null ? out : cmd;
}

// ---------------------------------------------------------------------
// Structural checks

const MAX_SCAN_DEPTH = 20;
const MAX_SCAN_ENTRIES = 200;
const MAX_POINTER_BYTES = 256;
const MAX_REPORTED_ITEMS = 12;
const MAX_REPORTED_PATH_CHARS = 160;

function issue(kind, relPath, code = null) {
  return { kind, path: relPath, code };
}

function lstatRoot(absPath, relPath, issues, { missingIsIssue = false } = {}) {
  try {
    const stat = fs.lstatSync(absPath);
    if (stat.isSymbolicLink()) {
      issues.push(issue("scan root is a symbolic link", relPath));
      return null;
    }
    if (!stat.isDirectory()) {
      issues.push(issue("scan root is not a directory", relPath));
      return null;
    }
    return stat;
  } catch (error) {
    if (error?.code === "ENOENT" && !missingIsIssue) return null;
    const kind = error?.code === "ENOENT" ? "active plan directory is missing" : "scan root cannot be read";
    issues.push(issue(kind, relPath, error?.code ?? "UNKNOWN"));
    return null;
  }
}

// Walk a verified directory without following directory symlinks. The caller
// chooses which non-directory entries count as artifacts. Scanner failures and
// resource limits become blocking issues instead of silently failing open.
function collectBoundedEntries(absRoot, relRoot, include, issues) {
  if (!lstatRoot(absRoot, relRoot, issues)) return [];

  const found = [];
  const state = { entries: 0, stopped: false };

  function walk(absDir, relDir, depth) {
    if (state.stopped) return;
    if (depth > MAX_SCAN_DEPTH) {
      issues.push(issue("scan depth limit exceeded", relDir));
      state.stopped = true;
      return;
    }

    let currentStat;
    try {
      currentStat = fs.lstatSync(absDir);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      issues.push(issue("directory cannot be read", relDir, error?.code ?? "UNKNOWN"));
      state.stopped = true;
      return;
    }
    if (currentStat.isSymbolicLink()) {
      issues.push(issue("directory became a symbolic link during scan", relDir));
      state.stopped = true;
      return;
    }
    if (!currentStat.isDirectory()) {
      issues.push(issue("scan path is not a directory", relDir));
      state.stopped = true;
      return;
    }

    let dir;
    try {
      dir = fs.opendirSync(absDir);
      while (!state.stopped) {
        const ent = dir.readSync();
        if (ent === null) break;

        state.entries++;
        if (state.entries > MAX_SCAN_ENTRIES) {
          issues.push(issue("scan entry limit exceeded", relRoot));
          state.stopped = true;
          break;
        }

        const childAbs = path.join(absDir, ent.name);
        const childRel = `${relDir}/${ent.name}`;
        if (ent.isDirectory()) {
          walk(childAbs, childRel, depth + 1);
        } else if (include(ent, childRel)) {
          found.push(childRel);
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        issues.push(issue("directory cannot be read", relDir, error?.code ?? "UNKNOWN"));
        state.stopped = true;
      }
    } finally {
      try {
        dir?.closeSync();
      } catch (error) {
        issues.push(issue("directory handle cannot be closed", relDir, error?.code ?? "UNKNOWN"));
        state.stopped = true;
      }
    }
  }

  walk(absRoot, relRoot, 0);
  return found;
}

function findActivePlanningState(repoRoot, issues) {
  const planningRoot = path.join(repoRoot, ".planning");
  if (!lstatRoot(planningRoot, ".planning", issues)) return [];

  const pointerPath = path.join(planningRoot, ".active_plan");
  let pointerStat;
  try {
    pointerStat = fs.lstatSync(pointerPath);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    issues.push(issue("active plan pointer cannot be read", ".planning/.active_plan", error?.code ?? "UNKNOWN"));
    return [];
  }

  const planning = [".planning/.active_plan"];
  if (!pointerStat.isFile() || pointerStat.isSymbolicLink()) {
    issues.push(issue("active plan pointer is not a regular file", ".planning/.active_plan"));
    return planning;
  }
  if (pointerStat.size > MAX_POINTER_BYTES) {
    issues.push(issue("active plan pointer exceeds size limit", ".planning/.active_plan"));
    return planning;
  }

  let planId;
  try {
    planId = fs.readFileSync(pointerPath, "utf8").trim();
  } catch (error) {
    issues.push(issue("active plan pointer cannot be read", ".planning/.active_plan", error?.code ?? "UNKNOWN"));
    return planning;
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(planId)) {
    issues.push(issue("invalid active plan identifier", ".planning/.active_plan"));
    return planning;
  }

  const planRel = `.planning/${planId}`;
  const planAbs = path.join(planningRoot, planId);
  if (!lstatRoot(planAbs, planRel, issues, { missingIsIssue: true })) return planning;
  // The root has already been verified. collectBoundedEntries performs the
  // same check immediately before walking to avoid time-of-check races.
  const planFiles = collectBoundedEntries(
    planAbs,
    planRel,
    (ent, childRel) => {
      if (ent.isSymbolicLink()) {
        issues.push(issue("active plan contains a symbolic link", childRel));
        return false;
      }
      return ent.isFile();
    },
    issues,
  );
  planning.push(...planFiles);
  return planning;
}

function findUnresolvedReadyArtifacts(repoRoot) {
  const scanIssues = [];
  const planning = findActivePlanningState(repoRoot, scanIssues);

  // docs/specs/ preserves the historical contract: every non-directory
  // Markdown entry except *.bak blocks, including valid and broken symlinks.
  const activeSpecs = collectBoundedEntries(
    path.join(repoRoot, "docs", "specs"),
    "docs/specs",
    (ent) => /\.md$/i.test(ent.name) && !/\.bak$/i.test(ent.name),
    scanIssues,
  );
  return { planning, activeSpecs, scanIssues };
}

function hasUnresolvedArtifacts(artifacts) {
  return (
    artifacts.planning.length > 0 ||
    artifacts.activeSpecs.length > 0 ||
    artifacts.scanIssues.length > 0
  );
}

function quotePath(value) {
  const shortened =
    value.length > MAX_REPORTED_PATH_CHARS
      ? `${value.slice(0, MAX_REPORTED_PATH_CHARS - 1)}…`
      : value;
  return JSON.stringify(shortened);
}

function formatPathList(paths) {
  const shown = paths.slice(0, MAX_REPORTED_ITEMS).map(quotePath);
  if (paths.length > shown.length) shown.push(JSON.stringify(`… ${paths.length - shown.length} more`));
  return `[${shown.join(", ")}]`;
}

function formatIssues(issues) {
  const shown = issues.slice(0, MAX_REPORTED_ITEMS).map((entry) => {
    const code = entry.code ? ` (${entry.code})` : "";
    return `${entry.kind}${code}: ${quotePath(entry.path)}`;
  });
  if (issues.length > shown.length) shown.push(`… ${issues.length - shown.length} more`);
  return shown.join(", ");
}

function formatReadyBlockMessage(artifacts, route) {
  const parts = [];
  if (artifacts.planning.length > 0) {
    parts.push(
      `temporary planning artifacts for active plan: ${formatPathList(artifacts.planning)}`,
    );
  }
  if (artifacts.activeSpecs.length > 0) {
    parts.push(
      `unfinalized active specs in docs/specs/: ${formatPathList(artifacts.activeSpecs)}`,
    );
  }
  if (artifacts.scanIssues.length > 0) {
    parts.push(`blocking scanner issues: ${formatIssues(artifacts.scanIssues)}`);
  }
  // Only active specs are "promote-able" to docs/architecture/.
  // Planning state is session-ephemeral by definition — don't suggest
  // promotion when only that fires.
  const promoteable = artifacts.activeSpecs.length > 0;
  const archiveTarget = "docs/worklog/worklog-<YYYY-MM-DD>-<branch>/";

  // Route the execution through the documentation-management skill: archiving
  // is a governance action (promotion check + link repair), and this message
  // fires at the exact moment an agent would otherwise bare-`mv` the specs.
  const routeHint =
    "execute via the documentation-management skill, not a bare file move";
  let remediation;
  if (route === "create-nondraft") {
    const promoteHint = promoteable ? "promote to docs/architecture/, " : "";
    remediation =
      `Resolve before \`gh pr create\` without --draft: ${promoteHint}archive to ${archiveTarget}, or delete — ${routeHint}. Alternatively, pass --draft to defer the Ready transition to a separate \`gh pr ready\`.`;
  } else {
    remediation = promoteable
      ? `Resolve before marking ready: promote to docs/architecture/, archive to ${archiveTarget}, or delete — ${routeHint}.`
      : `Archive to ${archiveTarget} or delete before marking ready — ${routeHint}.`;
  }
  return `${parts.join("; ")}. ${remediation}`;
}

// ---------------------------------------------------------------------
// Git / gh helpers

function gitToplevel() {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    timeout: 3000,
  });
  if (r.status !== 0) return null;
  const out = (r.stdout ?? "").trim();
  return out.length > 0 ? out : null;
}

function countUnpushed() {
  // @{u} is the configured upstream of the current branch. If unset
  // (detached HEAD, no tracking), the rev-list call exits non-zero
  // and we return 0 to avoid blocking a branch that isn't even on a
  // remote yet.
  const r = spawnSync("git", ["rev-list", "--count", "@{u}..HEAD"], {
    encoding: "utf8",
    timeout: 3000,
  });
  if (r.status !== 0) return 0;
  const n = parseInt((r.stdout ?? "").trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

function fetchBody(prRef) {
  const args = ["pr", "view"];
  if (prRef) args.push(prRef);
  args.push("--json", "body", "-q", ".body");
  try {
    const r = spawnSync("gh", args, { encoding: "utf8", timeout: 5000 });
    if (r.status !== 0) return null;
    return typeof r.stdout === "string" ? r.stdout : null;
  } catch {
    return null;
  }
}

function summarize(ref, body) {
  const lines = body.split(/\r?\n/);
  const headings = lines
    .map((l) => l.trim())
    .filter((l) => /^#{2,3}\s+\S/.test(l));
  const unchecked = (body.match(/^\s*-\s+\[\s\]/gm) ?? []).length;
  const checked = (body.match(/^\s*-\s+\[[xX]\]/gm) ?? []).length;

  const head = `[pr-ready-guard] PR ${ref} body snapshot (${body.length} chars):`;
  const headingLine =
    headings.length === 0
      ? "  Headings: (none found)"
      : "  Headings:\n" + headings.map((h) => `    - ${h}`).join("\n");
  const todoLine = `  TODO checkboxes: ${unchecked} unchecked, ${checked} checked`;
  const tail =
    "Confirm acceptance criteria are met and the body reflects the final commits. Use `gh pr edit` to sync anything drifted. Follow the `git-workflow` skill for ready-state expectations and post-ready batch-comment discipline.";
  return [head, headingLine, todoLine, tail].join("\n");
}

// ---------------------------------------------------------------------
// Output helpers

function block(reason) {
  process.stderr.write(`pr-ready-guard: ${reason}\n`);
  process.exit(2);
}

function inject(message) {
  const out = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: message,
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

function exit0() {
  process.exit(0);
}
