#!/usr/bin/env node
// pr-merge-guard — PreToolUse guard for `gh pr merge`.
//
// Blocks a merge while the PR body's "Acceptance criteria" OR "Test plan"
// section still has unchecked `- [ ]` checklist items. The merge is the
// final gate: an acceptance criterion still open at merge time was either
// forgotten or was never a real pre-merge criterion, and an unchecked
// test step is verification the author planned but never ran.
//
// Scope is deliberately limited to those two sections:
//   - Checked items (`- [x]` / `- [X]`) never block.
//   - Non-task bullets (`- foo`) never block.
//   - Unchecked items in OTHER sections (e.g. "Remaining TODOs") never
//     block — those sections list deferred work by design.
// An item that genuinely cannot be verified before merge is neither an
// acceptance criterion nor a pre-merge test step for this PR; the block
// message tells the author to move it to "Remaining TODOs" as a plain
// bullet.
//
// gh failures (unavailable, unauth, PR not found) are non-fatal: the
// guard exits 0 silently rather than blocking on its own inability to
// inspect the body.

import { spawnSync } from "node:child_process";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    const cmd = toolCommand(data);
    if (typeof cmd !== "string") return exit0();
    // Strip simple quoted runs so mentions of "gh pr merge" inside echo
    // args, git commit messages, etc. don't trigger the hook.
    const stripped = stripQuoted(cmd);
    if (!/\bgh\s+pr\s+merge\b/.test(stripped)) return exit0();

    const prRef = extractMergeRef(stripped);
    const body = fetchBody(prRef);
    if (body === null) return exit0(); // gh failure — non-fatal

    const unchecked = findGatedUnchecked(body);
    if (unchecked.acceptance.length > 0 || unchecked.testPlan.length > 0) {
      return block(formatBlockMessage(prRef, unchecked));
    }
    return exit0();
  } catch {
    // Never block on our own parse errors.
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
// Command parsing

// `gh pr merge` accepts an optional `[<number> | <url> | <branch>]` as
// its first positional argument. We grab the token right after `merge`;
// if it is a flag or a shell operator (`&&`, `|`, `;`) it is not a ref,
// so we return null and let `gh pr view` resolve the current branch's
// PR — which, at merge time, is the PR being merged anyway.
function extractMergeRef(stripped) {
  const m = stripped.match(/\bgh\s+pr\s+merge\s+(\S+)/);
  if (!m) return null;
  const candidate = m[1];
  if (candidate.startsWith("-")) return null;
  // A real ref is a PR number, a URL, or a branch-name-shaped token.
  if (!/^(?:\d+|https?:\/\/\S+|[\w./-]+)$/.test(candidate)) return null;
  return candidate;
}

// Minimal quote-stripper so mentions of "gh pr merge" inside quoted args
// (echo, git commit -m, etc.) don't false-positive the hook. Handles
// '...' and "..." with backslash escapes inside double quotes; an
// unclosed quote returns the input unchanged (upstream regex decides).
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
// Body parsing

// Heading text that marks each gated section. Anchored at the start of
// the heading text so a heading that merely *mentions* the phrase
// ("Why acceptance criteria matter") is not mistaken for the section.
// Each matches the English form and the Chinese forms the bilingual
// PR-body convention uses.
const AC_HEADING = /^(?:acceptance\s+criteria|验收(?:标准|条件|清单|准则)?)/i;
const TEST_PLAN_HEADING = /^(?:test\s+plan|测试(?:计划|方案))/i;

// True for a fenced-code-block delimiter line (``` or ~~~, optionally
// indented, optionally with an info string).
function isFenceToggle(line) {
  return /^\s*(?:```|~~~)/.test(line);
}

// Return the unchecked checklist items inside the body section whose
// heading matches `headingRegex`. The section runs from its heading to
// the next heading of the same or shallower level (a deeper heading is
// a subsection and stays in scope). Fenced code blocks are skipped in
// both the heading scan and the item scan — a ``` fence can hold
// `- [ ]` examples and `#` lines that are not real checklist items /
// headings. If there is no matching heading, returns [] — nothing to
// enforce.
function findUncheckedInSection(lines, headingRegex) {
  let inFence = false;
  let level = 0;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isFenceToggle(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (h && headingRegex.test(h[2])) {
      level = h[1].length;
      start = i + 1;
      break;
    }
  }
  if (start === -1) return [];

  // The heading was found outside any fence, so fence state at `start`
  // is "outside" — safe to rescan from a closed fence.
  const out = [];
  inFence = false;
  for (let i = start; i < lines.length; i++) {
    if (isFenceToggle(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = lines[i].match(/^(#{1,6})\s+\S/);
    if (h && h[1].length <= level) break; // next same-or-shallower heading
    const item = lines[i].match(/^\s*-\s+\[\s\]\s*(.*\S)?\s*$/);
    if (item) out.push((item[1] ?? "").trim());
  }
  return out;
}

// Return the unchecked checklist items in the two gated sections,
// keyed by section. Either list is [] when its heading is absent.
function findGatedUnchecked(body) {
  const lines = body.split(/\r?\n/);
  return {
    acceptance: findUncheckedInSection(lines, AC_HEADING),
    testPlan: findUncheckedInSection(lines, TEST_PLAN_HEADING),
  };
}

// ---------------------------------------------------------------------
// gh helper

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

// ---------------------------------------------------------------------
// Output helpers

function renderGroup(label, items) {
  const list = items
    .map((t) => `  - [ ] ${t.length > 200 ? t.slice(0, 197) + "…" : t}`)
    .join("\n");
  return `${label} (${items.length}):\n${list}`;
}

function formatBlockMessage(prRef, unchecked) {
  const ref = prRef ?? "(current branch)";
  const total = unchecked.acceptance.length + unchecked.testPlan.length;
  const groups = [];
  if (unchecked.acceptance.length > 0) {
    groups.push(renderGroup("Acceptance criteria", unchecked.acceptance));
  }
  if (unchecked.testPlan.length > 0) {
    groups.push(renderGroup("Test plan", unchecked.testPlan));
  }
  return (
    `PR ${ref} has ${total} unchecked pre-merge checklist item${total === 1 ? "" : "s"} — resolve before merge:\n` +
    `${groups.join("\n")}\n` +
    `Check each item off once it is met. If an item genuinely cannot be ` +
    `verified before merge, it is not a pre-merge gate for this PR — ` +
    `move it into the "Remaining TODOs" section as a plain bullet. Then re-run \`gh pr merge\`.`
  );
}

function block(reason) {
  process.stderr.write(`pr-merge-guard: ${reason}\n`);
  process.exit(2);
}

function exit0() {
  process.exit(0);
}
