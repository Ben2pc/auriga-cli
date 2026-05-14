#!/usr/bin/env node
// pr-create-guard — PostToolUse hook for `gh pr create`.
//
// Fires AFTER the tool runs so we can query the real created PR and
// report its actual body — no command-line regex, no heredoc parsing.
//
// If gh pr create succeeded:
//   - extract the PR URL/number from the tool_response
//   - gh pr view --json body,title to get the real fields
//   - scan ^## / ^### headings, count TODO checkboxes
//   - check title against Conventional Commits format (soft nudge —
//     informational, never a block)
//   - inject `hookSpecificOutput.additionalContext` with the snapshot
//
// If gh pr create failed, or we can't determine the PR, or gh is
// unavailable: exit 0 silent. PostToolUse never blocks — the tool
// already ran, so the value is informational only.

import { spawnSync } from "node:child_process";

// Standard Conventional Commits types. Mirrors what the `git-workflow`
// skill prescribes for commit + PR title prefixes.
const CC_TYPES = [
  "feat",
  "fix",
  "docs",
  "refactor",
  "chore",
  "test",
  "perf",
  "style",
  "build",
  "ci",
  "revert",
];
const CC_RE = new RegExp(
  `^(?:${CC_TYPES.join("|")})(?:\\([^)]+\\))?!?:\\s\\S`,
);

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    if (data?.tool_name !== "Bash") return exit0();

    const cmd = data?.tool_input?.command;
    if (typeof cmd !== "string") return exit0();
    // Strip simple quoted runs so mentions of "gh pr create" inside
    // echo args, git commit messages, etc. don't trigger the hook.
    if (!/\bgh\s+pr\s+create\b/.test(stripQuoted(cmd))) return exit0();

    // Avoid injecting when the tool reported an error — PR wasn't
    // created, so there's nothing to snapshot.
    if (looksLikeFailure(data?.tool_response)) return exit0();

    const prRef = extractPRRef(data?.tool_response);
    if (!prRef) {
      // Can't identify which PR was created (unusual — gh pr create
      // normally prints the URL). Fall back to a passive nudge.
      return inject(
        `[pr-create-guard] PR created, but could not identify it from gh output. Verify the body covers the five elements (scope / acceptance criteria / design decisions / risks / remaining TODOs). Check the title follows Conventional Commits (\`<type>(<scope>)?: <subject>\`) and the description language matches the team's convention. Follow the \`git-workflow\` skill for the five-element PR body.`,
      );
    }

    const fields = fetchPrFields(prRef);
    if (fields === null) {
      // gh unavailable or not authenticated. Don't pretend to know
      // anything; remind the Agent to self-verify.
      return inject(
        `[pr-create-guard] PR ${prRef} created (fields could not be fetched via gh). Verify the five elements (scope / acceptance criteria / design decisions / risks / remaining TODOs), the title follows Conventional Commits, and the language matches the team's convention. Follow the \`git-workflow\` skill for the five-element PR body.`,
      );
    }

    inject(summarize(prRef, fields));
  } catch {
    // Never block on our own parse errors.
    exit0();
  }
});

// ---------------------------------------------------------------------

function looksLikeFailure(resp) {
  if (!resp || typeof resp !== "object") return false;
  if (resp.isError === true) return true;
  if (typeof resp.exit_code === "number" && resp.exit_code !== 0) return true;
  if (typeof resp.exitCode === "number" && resp.exitCode !== 0) return true;
  return false;
}

// Pull a PR reference out of the tool_response. gh pr create prints the
// URL on success; we look for github.com/.../pull/N. Only the response
// is searched — an inline `--body` that mentions some unrelated old PR
// URL must not be mistaken for "the PR just created".
function extractPRRef(resp) {
  const haystack = stringifyResponse(resp);
  const m = haystack.match(/https?:\/\/[^\s"]+\/pull\/(\d+)/);
  if (m) return m[0]; // use the full URL — gh pr view accepts it
  return null;
}

function stringifyResponse(resp) {
  if (!resp) return "";
  if (typeof resp === "string") return resp;
  if (typeof resp !== "object") return String(resp);
  // Walk known fields — different Claude Code versions use different
  // shapes (stdout/output/text/content). Collect all string-valued
  // leaves. Track seen objects to short-circuit cycles; also cap
  // depth so a pathological payload can't blow the stack.
  const parts = [];
  const seen = new WeakSet();
  const visit = (v, depth) => {
    if (depth > 16) return;
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) {
      if (seen.has(v)) return;
      seen.add(v);
      v.forEach((x) => visit(x, depth + 1));
    } else if (v && typeof v === "object") {
      if (seen.has(v)) return;
      seen.add(v);
      Object.values(v).forEach((x) => visit(x, depth + 1));
    }
  };
  visit(resp, 0);
  return parts.join("\n");
}

// Minimal quote-stripper so mentions of our match phrase inside quoted
// args (echo, git commit -m, heredoc-ish strings) don't false-positive
// the hook. Handles '...' and "..." with backslash escapes inside
// double quotes; unclosed quote → return input unchanged (upstream
// regex decides).
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

// Fetch title + body in one round-trip. gh returns JSON; we parse it
// directly so a malformed payload becomes `null` rather than a partial
// object. Returns null on any failure path — gh missing, unauth, parse
// error, etc. — so callers stay on the graceful-degrade branch.
function fetchPrFields(prRef) {
  try {
    const r = spawnSync(
      "gh",
      ["pr", "view", prRef, "--json", "body,title"],
      { encoding: "utf8", timeout: 5000 },
    );
    if (r.status !== 0) return null;
    if (typeof r.stdout !== "string") return null;
    const parsed = JSON.parse(r.stdout);
    if (!parsed || typeof parsed !== "object") return null;
    const body = typeof parsed.body === "string" ? parsed.body : "";
    const title = typeof parsed.title === "string" ? parsed.title : "";
    return { body, title };
  } catch {
    return null;
  }
}

function summarize(prRef, fields) {
  const { body, title } = fields;
  const lines = body.split(/\r?\n/);
  const headings = lines
    .map((l) => l.trim())
    .filter((l) => /^#{2,3}\s+\S/.test(l));
  const unchecked = (body.match(/^\s*-\s+\[\s\]/gm) ?? []).length;
  const checked = (body.match(/^\s*-\s+\[[xX]\]/gm) ?? []).length;
  const bodyLen = body.length;

  const head =
    `[pr-create-guard] PR ${prRef} body snapshot (${bodyLen} chars):`;
  const headingLine =
    headings.length === 0
      ? "  Headings: (none found)"
      : "  Headings:\n" + headings.map((h) => `    - ${h}`).join("\n");
  const todoLine = `  TODO checkboxes: ${unchecked} unchecked, ${checked} checked`;

  // Title format: soft nudge only. PostToolUse can't block, and the
  // CC convention is a style choice — flag it, don't fail the PR.
  // Skip silently when title is empty (means parse hiccup, not violation).
  const titleLine =
    title && !CC_RE.test(title)
      ? `  Title format: ⚠ "${title}" doesn't match Conventional Commits (\`<type>(<scope>)?: <subject>\`, types: ${CC_TYPES.join(" / ")}). Fix via \`gh pr edit ${prRef} --title "<type>: ..."\` if appropriate.`
      : null;

  const tail = [
    "Verify the five PR-body elements are covered: scope / acceptance criteria / design decisions / risks / remaining TODOs.",
    "If the PR description language is inconsistent with the team's convention, fix it via `gh pr edit`.",
    "Follow the `git-workflow` skill for the five-element PR body.",
  ].join(" ");

  const parts = [head, headingLine, todoLine];
  if (titleLine) parts.push(titleLine);
  parts.push(tail);
  return parts.join("\n");
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
