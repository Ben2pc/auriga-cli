#!/usr/bin/env node
// Tests for the session-compound analyzers' signal-coverage expansion.
// Each test traces to a VAL-XXX-NNN id in
// docs/worklog/worklog-2026-05-29-feat-session-compound-signals/validation-contract.md.
//
//     node tests/session-compound-analyzers.test.mjs
//
// These analyzers are pure "JSONL input -> JSON output" functions. Each test
// writes a minimal, self-contained fixture transcript to a tmp dir, spawns the
// analyzer with --file, parses stdout JSON, and asserts on output fields.
// No network, no real time, no real session files.
//
// ASSUMPTIONS (cannot be verified from read-only analyzer source — listed so a
// reviewer can sanity-check the contract reading):
//  1. The Claude PR list is expected on health.prs (or narrative.prs). The test
//     accepts either location; both being absent is the red failure today.
//  2. Claude skill-attribution workload is expected on health.skill_attribution
//     as [{name,count}] OR on each health.skills[] entry as an extra
//     `attribution`/`attributed_calls` field. The test accepts either shape.
//  3. Claude tool_failures land on health.tool_failures and/or
//     raw_for_compound.tool_failures, with the same key set as a Codex
//     tool_failures entry ({call_id?, name, preview}).
//  4. The real-recorded turn duration is exposed on session.recorded_turn_ms
//     (sum of system/turn_duration durationMs) — distinct from active_ms gap
//     estimate.
//  5. away_summary text is exposed as narrative raw material on
//     narrative.away_summaries (array) or raw_for_compound.away_summaries.
//  6. aiTitle drives narrative.task_title (Claude side), default when absent.
//
// If the implementation chooses different field names, update the accessors in
// the small `pick*` helpers below — the asserted BEHAVIOR (presence, dedup,
// counts, key-set parity, no broken fences) is what the contract pins, not the
// exact field name.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_DIR = path.resolve(
  HERE,
  "..",
  "plugins",
  "auriga-workflow",
  "skills",
  "session-compound",
  "analyzers",
);
const CLAUDE = path.join(ANALYZER_DIR, "claude-code.mjs");
const CODEX = path.join(ANALYZER_DIR, "codex.mjs");
const SKILL_MD = path.resolve(ANALYZER_DIR, "..", "SKILL.md");

const cleanupFiles = [];

// Write a fixture JSONL (array of entry objects -> one JSON per line) to a tmp
// file and return the absolute path. Self-cleaning at process exit.
function writeFixture(prefix, entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sc-${prefix}-`));
  const file = path.join(dir, "transcript.jsonl");
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  cleanupFiles.push(dir);
  return file;
}

function runAnalyzer(script, file) {
  const r = spawnSync("node", [script, "--file", file], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(
      `analyzer ${path.basename(script)} exited ${r.status}: ${r.stderr}`,
    );
  }
  return JSON.parse(r.stdout);
}

// ---------- tiny entry builders (Claude transcript) ----------
let uuidSeq = 0;
function uuid() {
  return `uuid-${uuidSeq++}`;
}

function claudeUser(text, ts) {
  return {
    type: "user",
    uuid: uuid(),
    timestamp: ts,
    sessionId: "sess-claude",
    cwd: "/repo",
    message: { role: "user", content: text },
  };
}

function claudeAssistant({ ts, reqId, content = [], attributionSkill, usage }) {
  const e = {
    type: "assistant",
    uuid: uuid(),
    timestamp: ts,
    requestId: reqId,
    message: {
      role: "assistant",
      model: "claude-test",
      content,
      usage: usage || { input_tokens: 10, output_tokens: 5 },
    },
  };
  if (attributionSkill) e.attributionSkill = attributionSkill;
  return e;
}

// A user entry carrying a tool_result block (Claude marks failures with
// is_error). Not a human turn.
function claudeToolResult({ ts, toolUseId, isError, content }) {
  return {
    type: "user",
    uuid: uuid(),
    timestamp: ts,
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: toolUseId, is_error: isError, content },
      ],
    },
  };
}

function claudePrLink({ prNumber, prUrl, prRepository, ts }) {
  return {
    type: "pr-link",
    uuid: uuid(),
    sessionId: "sess-claude",
    prNumber,
    prUrl,
    prRepository,
    timestamp: ts,
  };
}

function claudeAiTitle(aiTitle) {
  return { type: "ai-title", uuid: uuid(), sessionId: "sess-claude", aiTitle };
}

function claudeSystem(subtype, extra) {
  return {
    type: "system",
    uuid: uuid(),
    subtype,
    timestamp: "2026-05-28T11:46:55.392Z",
    sessionId: "sess-claude",
    ...extra,
  };
}

// ---------- tiny entry builders (Codex rollout) ----------
function codexMeta() {
  return {
    type: "session_meta",
    timestamp: "2026-05-28T18:23:49.000Z",
    payload: { id: "thread-codex", cwd: "/repo", cli_version: "1.0", git: { branch: "main" } },
  };
}
function codexTurnContext(model = "gpt-test") {
  return { type: "turn_context", timestamp: "2026-05-28T18:23:50.000Z", payload: { model } };
}
function codexUserMsgEvent(text, ts) {
  return { type: "event_msg", timestamp: ts, payload: { type: "user_message", message: text } };
}
// The <skill><name>X</name> block arrives as a response_item/message (role:user).
function codexSkillBlock(name, ts) {
  return {
    type: "response_item",
    timestamp: ts,
    payload: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: `<skill>\n<name>${name}</name>\n<path>/repo/.agents/skills/${name}/SKILL.md</path>\n---\nname: ${name}\n---\n`,
        },
      ],
    },
  };
}
function codexTokenCount({ input = 1000, output = 1000, reasoning = 0, cached = 0, ts }) {
  const usage = {
    input_tokens: input,
    cached_input_tokens: cached,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: input + output,
  };
  return {
    type: "event_msg",
    timestamp: ts,
    payload: {
      type: "token_count",
      info: { total_token_usage: usage, last_token_usage: usage, model_context_window: 258400 },
    },
  };
}
function codexPatchApplyEnd({ success = true, ts }) {
  return {
    type: "event_msg",
    timestamp: ts,
    payload: { type: "patch_apply_end", success, call_id: `c-${uuid()}` },
  };
}
function codexAgentFinal(message, ts) {
  return {
    type: "event_msg",
    timestamp: ts,
    payload: { type: "agent_message", phase: "final", message },
  };
}

// ---------- shared helpers ----------
const T0 = "2026-05-28T10:00:00.000Z";
const T1 = "2026-05-28T10:01:00.000Z";
const T2 = "2026-05-28T10:02:00.000Z";

// Accessors pinned to the shipped field locations (the implementation has
// landed; tolerant multi-location lookups would mask an accidental relocation
// that SKILL.md and the template depend on).
function pickPrs(out) {
  return out.health?.prs ?? null;
}
function pickSkillAttribution(out, skillName) {
  if (!Array.isArray(out.health?.skill_attribution)) return null;
  const hit = out.health.skill_attribution.find((s) => s.name === skillName);
  return hit ? hit.count : null;
}
function pickToolFailures(out) {
  return out.health?.tool_failures ?? null;
}
function pickRecordedTurnMs(out) {
  return out.session?.recorded_turn_ms ?? null;
}
function pickAwaySummaries(out) {
  return out.narrative?.away_summaries ?? null;
}

// ---------- eval-substrate helpers (new feature: skill_catalog / workflow_rules / workflow_signals) ----------
//
// These build tmpdir fixtures the analyzers can be pointed at, so the new
// substrate fields are driven by controlled inputs rather than the real
// ~/.claude / ~/.codex / repo AGENTS.md. The analyzers gain a repeatable
// --skill-root <path> flag; the workflow-rules source is the session cwd's
// AGENTS.md (fallback CLAUDE.md), with the managed block delimited by the
// markers defined in src/workflow-markers.ts.

// Real managed-block markers, mirrored from src/workflow-markers.ts
// (START_LINE_RE / END_LINE_RE, MARKER_SCHEMA = "v1"). The parser keys on the
// language-independent `AURIGA:WORKFLOW:v1 START|END` token, so these literal
// lines satisfy the regexes the analyzer must reuse.
const MANAGED_START =
  "<!-- AURIGA:WORKFLOW:v1 START — Managed block, maintained by auriga-cli. Do not edit by hand; upgrades replace it wholesale. Put project-specific instructions after the END marker below. -->";
const MANAGED_END = "<!-- AURIGA:WORKFLOW:v1 END sha256=0123456789abcdef -->";

// Create a fresh tmp dir holding one SKILL.md per provided skill spec.
// `skills` is an array of { name, description, dirName? }. Each SKILL.md is
// written under <root>/<dirName||name>/SKILL.md with YAML frontmatter that
// matches the skill-cleaner parseFrontmatter contract (name:/description:).
// Returns the absolute root path. Self-cleaning at process exit.
function writeSkillRoot(prefix, skills) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sc-skills-${prefix}-`));
  for (const s of skills) {
    const sub = path.join(root, s.dirName || s.name);
    fs.mkdirSync(sub, { recursive: true });
    const fm = `---\nname: ${s.name}\ndescription: ${s.description}\n---\n\n# ${s.name}\n\nbody.\n`;
    fs.writeFileSync(path.join(sub, "SKILL.md"), fm);
  }
  cleanupFiles.push(root);
  return root;
}

// Create a tmp dir to use as a session cwd, optionally containing an AGENTS.md.
// `agentsBody`:
//   - string with a managed block -> written verbatim as AGENTS.md
//   - null -> no AGENTS.md at all (tests the "no managed block" path)
// Returns the absolute cwd dir. Self-cleaning at process exit.
function writeCwdDir(prefix, agentsBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sc-cwd-${prefix}-`));
  if (agentsBody != null) {
    fs.writeFileSync(path.join(dir, "AGENTS.md"), agentsBody);
  }
  cleanupFiles.push(dir);
  return dir;
}

// Build an AGENTS.md body wrapping the given rule lines inside a valid managed
// block. `rules` is an array of strings; each becomes a numbered list item, the
// shape the analyzer's workflow-rule parser is expected to read.
function managedAgentsMd(rules) {
  const block = rules.map((r, i) => `${i + 1}. ${r}`).join("\n");
  return `# auriga 工作流 (v1.9.0)\n\n${MANAGED_START}\n${block}\n${MANAGED_END}\n\n# repo-specific\n\nlocal stuff.\n`;
}

// Run an analyzer with arbitrary extra args (e.g. repeated --skill-root). Same
// failure contract as runAnalyzer (non-zero exit -> throw, so "red" never means
// a crash). `opts.cwd` sets the spawned process cwd when provided.
function runAnalyzerArgs(script, args, opts = {}) {
  const r = spawnSync("node", [script, ...args], {
    encoding: "utf8",
    cwd: opts.cwd,
  });
  if (r.status !== 0) {
    throw new Error(
      `analyzer ${path.basename(script)} exited ${r.status}: ${r.stderr}`,
    );
  }
  return JSON.parse(r.stdout);
}

// Write a Claude fixture JSONL whose human-turn entries carry a chosen cwd, so
// the analyzer's "read session cwd's AGENTS.md" path resolves to a tmpdir we
// control. Mirrors writeFixture but stamps `cwd` onto each entry that has one.
function writeClaudeFixtureWithCwd(prefix, entries, cwd) {
  const stamped = entries.map((e) =>
    e.type === "user" && e.cwd ? { ...e, cwd } : e,
  );
  return writeFixture(prefix, stamped);
}

// Accessors for the new substrate fields (pinned to the agreed contract).
function pickSkillCatalog(out) {
  return out.health?.skill_catalog ?? null;
}
function pickWorkflowRules(out) {
  return out.health?.workflow_rules ?? null;
}
function pickWorkflowSignals(out) {
  return out.health?.workflow_signals ?? null;
}

// ---------- test harness ----------
const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}
function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || "assertEqual"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// =====================================================================
// VAL-EXTRACT-001 — Claude PR list (dedup, full fields), empty when absent
// =====================================================================
test("claude analyzer extracts deduped PR list from repeated pr-link entries [VAL-EXTRACT-001]", () => {
  const file = writeFixture("pr-dedup", [
    claudeUser("open a PR", T0),
    claudePrLink({ prNumber: 155, prUrl: "https://github.com/o/r/pull/155", prRepository: "o/r", ts: T0 }),
    claudePrLink({ prNumber: 155, prUrl: "https://github.com/o/r/pull/155", prRepository: "o/r", ts: T1 }),
    claudePrLink({ prNumber: 155, prUrl: "https://github.com/o/r/pull/155", prRepository: "o/r", ts: T2 }),
  ]);
  const out = runAnalyzer(CLAUDE, file);
  const prs = pickPrs(out);
  assert(Array.isArray(prs), "expected a PR list array (health.prs / narrative.prs)");
  // Property: N entries -> 1 deduped PR.
  assertEqual(prs.length, 1, "PR list should dedup to one entry");
  const pr = prs[0];
  assertEqual(pr.number ?? pr.prNumber, 155, "PR entry carries number");
  assert(typeof (pr.url ?? pr.prUrl) === "string", "PR entry carries url");
  assert(typeof (pr.repository ?? pr.prRepository) === "string", "PR entry carries repository");
});

test("claude analyzer emits empty PR list when no pr-link entries present [VAL-EXTRACT-001]", () => {
  const file = writeFixture("pr-empty", [claudeUser("just chatting", T0)]);
  const out = runAnalyzer(CLAUDE, file);
  const prs = pickPrs(out);
  assert(Array.isArray(prs), "PR field must exist as empty array, not be missing");
  assertEqual(prs.length, 0, "no pr-link entries -> empty PR list");
});

// =====================================================================
// VAL-EXTRACT-002 — Claude skill attribution count, coexisting w/ skill calls
// =====================================================================
test("claude analyzer counts attributionSkill workload as N tool calls [VAL-EXTRACT-002]", () => {
  const skill = "auriga-workflow:git-workflow";
  // 3 assistant tool_use fragments attributed to the same skill.
  const file = writeFixture("attr", [
    claudeUser("do git stuff", T0),
    claudeAssistant({
      ts: T0,
      reqId: "r1",
      attributionSkill: skill,
      content: [{ type: "tool_use", name: "Bash", input: { command: "git status" } }],
    }),
    claudeAssistant({
      ts: T1,
      reqId: "r2",
      attributionSkill: skill,
      content: [{ type: "tool_use", name: "Bash", input: { command: "git add" } }],
    }),
    claudeAssistant({
      ts: T2,
      reqId: "r3",
      attributionSkill: skill,
      content: [{ type: "tool_use", name: "Bash", input: { command: "git commit" } }],
    }),
  ]);
  const out = runAnalyzer(CLAUDE, file);
  assertEqual(pickSkillAttribution(out, skill), 3, "attributed workload should be 3");
});

test("claude attribution does not clobber existing skill-invocation count field [VAL-EXTRACT-002]", () => {
  const skill = "auriga-workflow:git-workflow";
  // One real Skill invocation + two attributed Bash calls under that skill.
  const file = writeFixture("attr-coexist", [
    claudeUser("run the skill", T0),
    claudeAssistant({
      ts: T0,
      reqId: "r1",
      content: [{ type: "tool_use", name: "Skill", input: { skill } }],
    }),
    claudeAssistant({
      ts: T1,
      reqId: "r2",
      attributionSkill: skill,
      content: [{ type: "tool_use", name: "Bash", input: { command: "x" } }],
    }),
    claudeAssistant({
      ts: T2,
      reqId: "r3",
      attributionSkill: skill,
      content: [{ type: "tool_use", name: "Bash", input: { command: "y" } }],
    }),
  ]);
  const out = runAnalyzer(CLAUDE, file);
  // Existing health.skills count semantics (Skill-tool invocations) preserved.
  const sk = out.health?.skills?.find?.((s) => s.name === skill);
  assert(sk, "existing skills entry must still exist");
  assertEqual(sk.count, 1, "Skill-invocation count must remain readable (=1), not overwritten by attribution");
  // Attribution workload is the distinct, larger number.
  assertEqual(pickSkillAttribution(out, skill), 2, "attributed Bash workload should be 2 and distinguishable");
});

// =====================================================================
// VAL-EXTRACT-003 — Claude tool_failures from is_error, shape == Codex
// =====================================================================
test("claude analyzer extracts tool failures from is_error tool_result with codex-parity keys [VAL-EXTRACT-003]", () => {
  // Build a Claude fixture with 2 failing tool_results + Codex fixture with 1
  // patch failure; compare key sets of one entry from each.
  const claudeFile = writeFixture("tf-claude", [
    claudeUser("edit files", T0),
    claudeAssistant({
      ts: T0,
      reqId: "r1",
      content: [{ type: "tool_use", id: "tu1", name: "Edit", input: { file_path: "/a" } }],
    }),
    claudeToolResult({ ts: T0, toolUseId: "tu1", isError: true, content: "Error: file not found" }),
    claudeAssistant({
      ts: T1,
      reqId: "r2",
      content: [{ type: "tool_use", id: "tu2", name: "Bash", input: { command: "bad" } }],
    }),
    claudeToolResult({ ts: T1, toolUseId: "tu2", isError: true, content: "command not found" }),
  ]);
  const out = runAnalyzer(CLAUDE, claudeFile);
  const failures = pickToolFailures(out);
  assert(Array.isArray(failures), "tool_failures must be an array");
  assertEqual(failures.length, 2, "two is_error tool_results -> two failure records");
  // The tool name must be resolved from the originating tool_use (id->name map),
  // not the 'unknown' fallback — confirms the labeling path, not just the count.
  const names = failures.map((f) => f.name).sort();
  assertEqual(JSON.stringify(names), JSON.stringify(["Bash", "Edit"]), "failure names resolved from tool_use_id");

  // Codex reference entry (patch failure) for key-set parity.
  const codexFile = writeFixture("tf-codex", [
    codexMeta(),
    codexTurnContext(),
    codexUserMsgEvent("apply patch", T0),
    codexPatchApplyEnd({ success: false, ts: T0 }),
  ]);
  const codexOut = runAnalyzer(CODEX, codexFile);
  const codexFailures = codexOut.raw_for_compound?.tool_failures ?? [];
  assert(codexFailures.length >= 1, "codex fixture should produce a tool_failure");

  const claudeKeys = new Set(Object.keys(failures[0]));
  const codexKeys = new Set(Object.keys(codexFailures[0]));
  // Parity: claude failure entry must carry the same key set as a codex one.
  const same =
    claudeKeys.size === codexKeys.size &&
    [...codexKeys].every((k) => claudeKeys.has(k));
  assert(same, `claude failure keys [${[...claudeKeys]}] must equal codex keys [${[...codexKeys]}]`);
});

test("claude analyzer reports no tool failures when no is_error results present [VAL-EXTRACT-003]", () => {
  const file = writeFixture("tf-none", [
    claudeUser("ok", T0),
    claudeAssistant({
      ts: T0,
      reqId: "r1",
      content: [{ type: "tool_use", id: "tu1", name: "Read", input: { file_path: "/a" } }],
    }),
    claudeToolResult({ ts: T0, toolUseId: "tu1", isError: false, content: "file contents" }),
  ]);
  const out = runAnalyzer(CLAUDE, file);
  const failures = pickToolFailures(out);
  assert(Array.isArray(failures), "tool_failures must exist as empty array");
  assertEqual(failures.length, 0, "no is_error -> no failures (no false positive)");
});

// =====================================================================
// VAL-EXTRACT-004 — Codex real skills from <skill><name> blocks
// =====================================================================
test("codex analyzer extracts skill invocations from <skill><name> block [VAL-EXTRACT-004]", () => {
  const file = writeFixture("codex-skill", [
    codexMeta(),
    codexTurnContext(),
    codexUserMsgEvent("use a skill", T0),
    codexSkillBlock("skill-cleaner", T0),
  ]);
  const out = runAnalyzer(CODEX, file);
  assert(Array.isArray(out.health?.skills), "health.skills must be an array");
  const hit = out.health.skills.find((s) => s.name === "skill-cleaner");
  assert(hit, "skill-cleaner must appear in health.skills");
  assertEqual(hit.count, 1, "one <skill> block -> count 1");
});

test("codex analyzer emits empty skills list when no <skill> block present [VAL-EXTRACT-004]", () => {
  const file = writeFixture("codex-noskill", [
    codexMeta(),
    codexTurnContext(),
    codexUserMsgEvent("no skills here", T0),
  ]);
  const out = runAnalyzer(CODEX, file);
  assert(Array.isArray(out.health?.skills), "health.skills must be an array");
  assertEqual(out.health.skills.length, 0, "no <skill> block -> empty skills list");
});

// =====================================================================
// VAL-GROUND-001 — Claude duration from recorded turn_duration
// =====================================================================
test("claude analyzer surfaces recorded turn_duration distinct from gap estimate [VAL-GROUND-001]", () => {
  const file = writeFixture("turndur", [
    claudeUser("hi", T0),
    claudeSystem("turn_duration", { durationMs: 51281, messageCount: 12 }),
    claudeSystem("turn_duration", { durationMs: 12000, messageCount: 4 }),
  ]);
  const out = runAnalyzer(CLAUDE, file);
  const recorded = pickRecordedTurnMs(out);
  assert(recorded != null, "recorded turn duration field must exist");
  // Aggregate of the two recorded values.
  assertEqual(recorded, 51281 + 12000, "recorded duration should aggregate turn_duration records");
  // Must be distinguishable from the active_ms gap estimate (the contract's
  // "distinct from gap estimate" clause) — guards against accidentally aliasing them.
  assert(recorded !== out.session?.active_ms, "recorded_turn_ms must differ from the active_ms gap estimate");
});

// =====================================================================
// VAL-GROUND-002 — Claude api_error -> waste signal
// =====================================================================
test("claude analyzer emits an api-error waste signal on api_error/retry events [VAL-GROUND-002]", () => {
  const file = writeFixture("apierr", [
    claudeUser("do work", T0),
    claudeSystem("api_error", {
      level: "error",
      error: { message: "403 Forbidden", formatted: "403" },
      retryAttempt: 1,
      maxRetries: 10,
    }),
  ]);
  const out = runAnalyzer(CLAUDE, file);
  const signals = out.health?.waste_signals ?? [];
  const hit = signals.find((s) => /api/i.test(s.type) || /api/i.test(s.note || ""));
  assert(hit, "an api-error-type waste signal must be present");
});

test("claude analyzer emits no api-error waste signal when none occurred [VAL-GROUND-002]", () => {
  const file = writeFixture("apierr-none", [claudeUser("do work", T0)]);
  const out = runAnalyzer(CLAUDE, file);
  const signals = out.health?.waste_signals ?? [];
  const hit = signals.find((s) => /api_error|api error/i.test(s.type || ""));
  assert(!hit, "no api_error event -> no api-error waste signal");
});

// =====================================================================
// VAL-GROUND-003 — title from aiTitle, fallback default
// =====================================================================
test("claude analyzer uses aiTitle as the report title when present [VAL-GROUND-003]", () => {
  const file = writeFixture("aititle", [
    claudeAiTitle("Analyze context usage and optimization"),
    claudeUser("let's optimize context", T0),
  ]);
  const out = runAnalyzer(CLAUDE, file);
  const title = out.narrative?.task_title ?? out.session?.title ?? null;
  assertEqual(title, "Analyze context usage and optimization", "title should equal aiTitle");
});

test("claude analyzer falls back to a default title when aiTitle is absent [VAL-GROUND-003]", () => {
  const file = writeFixture("aititle-none", [claudeUser("hello", T0)]);
  const out = runAnalyzer(CLAUDE, file);
  const title = out.narrative?.task_title ?? out.session?.title ?? null;
  // Behavior: when aiTitle missing the title field is a defined default (not
  // the raw aiTitle and not undefined). Empty string or a constant both pass;
  // we only forbid leaking an undefined/null hole.
  assert(title !== null && title !== undefined, "title field must have a defined default when aiTitle absent");
});

// =====================================================================
// VAL-GROUND-004 — away_summary exposed as narrative raw material
// =====================================================================
test("claude analyzer exposes away_summary text as narrative raw material [VAL-GROUND-004]", () => {
  const summary = "Goal was reducing context; trimmed skill descriptions, tests green.";
  const file = writeFixture("away", [
    claudeUser("status?", T0),
    claudeSystem("away_summary", { content: summary }),
  ]);
  const out = runAnalyzer(CLAUDE, file);
  const summaries = pickAwaySummaries(out);
  assert(Array.isArray(summaries), "away summaries must be an array");
  assert(summaries.some((s) => (typeof s === "string" ? s : s.text || "").includes("trimmed skill descriptions")),
    "away_summary content must be present in narrative raw material");
});

test("claude analyzer leaves away summaries empty when no away_summary present [VAL-GROUND-004]", () => {
  const file = writeFixture("away-none", [claudeUser("hi", T0)]);
  const out = runAnalyzer(CLAUDE, file);
  const summaries = pickAwaySummaries(out);
  assert(Array.isArray(summaries), "away summaries must exist as empty array");
  assertEqual(summaries.length, 0, "no away_summary -> empty");
});

// =====================================================================
// VAL-HEUR-001 — feedback captures scope-narrowing / redirect phrases
// =====================================================================
test("claude analyzer classifies each scope-narrowing phrase as feedback [VAL-HEUR-001]", () => {
  // Each direction-shrink phrase must independently land in feedback_moments —
  // one turn per phrase so a regression dropping any single alternation is caught
  // (a combined turn would hide it: any one match satisfies the turn).
  const phrases = ["这个先不动吧", "不着急，慢慢来", "先做个微优化"];
  for (const phrase of phrases) {
    const file = writeFixture("heur-shrink", [claudeUser(phrase, T0)]);
    const out = runAnalyzer(CLAUDE, file);
    const fm = out.narrative?.feedback_moments ?? [];
    assert(fm.length === 1, `scope-narrowing phrase "${phrase}" should enter feedback_moments`);
  }
});

// =====================================================================
// VAL-HEUR-002 — pure research question is NOT feedback
// =====================================================================
test("claude analyzer does not classify a pure research question as feedback [VAL-HEUR-002]", () => {
  // "为什么有 60 个技能" — investigative, no correction/redirect intent.
  const file = writeFixture("heur-question", [
    claudeUser("为什么有 60 个技能", T0),
  ]);
  const out = runAnalyzer(CLAUDE, file);
  const fm = out.narrative?.feedback_moments ?? [];
  assert(fm.length === 0, "pure research question must NOT be feedback");
});

// =====================================================================
// VAL-HEUR-003 — read-only Codex session: no high_reasoning_ratio
// =====================================================================
test("codex analyzer suppresses high_reasoning_ratio for read-only session [VAL-HEUR-003]", () => {
  // High reasoning ratio, large output, but NO patch/edit/write activity.
  const file = writeFixture("heur-readonly", [
    codexMeta(),
    codexTurnContext(),
    codexUserMsgEvent("just analyze, don't change anything", T0),
    codexTokenCount({ input: 5000, output: 20000, reasoning: 15000, ts: T0 }),
  ]);
  const out = runAnalyzer(CODEX, file);
  const signals = out.health?.waste_signals ?? [];
  const hit = signals.find((s) => s.type === "high_reasoning_ratio");
  assert(!hit, "read-only session must not trip high_reasoning_ratio");
});

test("codex analyzer still flags high_reasoning_ratio when patch activity exists [VAL-HEUR-003]", () => {
  const file = writeFixture("heur-withpatch", [
    codexMeta(),
    codexTurnContext(),
    codexUserMsgEvent("implement the change", T0),
    codexPatchApplyEnd({ success: true, ts: T0 }),
    codexTokenCount({ input: 5000, output: 20000, reasoning: 15000, ts: T0 }),
  ]);
  const out = runAnalyzer(CODEX, file);
  const signals = out.health?.waste_signals ?? [];
  const hit = signals.find((s) => s.type === "high_reasoning_ratio");
  assert(hit, "same ratio WITH patch activity should still trip high_reasoning_ratio");
});

// =====================================================================
// VAL-HEUR-004 — task_conclusion truncation must not break a code fence
// =====================================================================
test("codex analyzer truncates task_conclusion without leaving an unclosed code fence [VAL-HEUR-004]", () => {
  // Build a final message whose default-truncation point lands inside a fenced
  // block: long preamble, then an opening ``` fence near the cutoff.
  const preamble = "结论说明：".repeat(40); // pushes the fence past the 240-char cutoff window
  const message =
    preamble +
    "\n下面是关键命令：\n```bash\nnpm test\nnpm run build\n```\n完成。";
  const file = writeFixture("heur-fence", [
    codexMeta(),
    codexTurnContext(),
    codexUserMsgEvent("summarize", T0),
    codexAgentFinal(message, T0),
  ]);
  const out = runAnalyzer(CODEX, file);
  const concl = out.narrative?.task_conclusion ?? "";
  // Count of ``` fences must be even (every opener closed) — no half fence.
  const fenceCount = (concl.match(/```/g) || []).length;
  assert(fenceCount % 2 === 0, `task_conclusion has an unclosed code fence: ${JSON.stringify(concl)}`);
  // Guard against a degenerate "" passing the even-count check: the preamble
  // (which sits before the fence) must survive the truncation.
  assert(concl.includes("结论说明"), "task_conclusion must keep the pre-fence preamble, not collapse to empty");
  // And no dangling 1-2 backtick remnant either.
  assert(!/(^|\s)`{1,2}$/.test(concl.replace(/…$/, "")), "task_conclusion must not end in a stray backtick remnant");
});

// =====================================================================
// VAL-SYM-001 — shared core fields key-set parity across both analyzers
// =====================================================================
test("both analyzers produce identical key sets for shared health fields incl. skills/tool_failures [VAL-SYM-001]", () => {
  // Isomorphic minimal fixtures that exercise skills + a tool failure on both.
  const claudeFile = writeFixture("sym-claude", [
    claudeUser("work", T0),
    claudeAssistant({
      ts: T0,
      reqId: "r1",
      content: [
        { type: "tool_use", id: "tu1", name: "Skill", input: { skill: "demo" } },
        { type: "tool_use", id: "tu2", name: "Edit", input: { file_path: "/a" } },
      ],
    }),
    claudeToolResult({ ts: T0, toolUseId: "tu2", isError: true, content: "Error: boom" }),
  ]);
  const codexFile = writeFixture("sym-codex", [
    codexMeta(),
    codexTurnContext(),
    codexUserMsgEvent("work", T0),
    codexSkillBlock("demo", T0),
    codexPatchApplyEnd({ success: false, ts: T0 }),
  ]);
  const cOut = runAnalyzer(CLAUDE, claudeFile);
  const xOut = runAnalyzer(CODEX, codexFile);

  // Both must expose skills as [{name,count}] with the same entry key set.
  const cSkill = cOut.health?.skills?.[0];
  const xSkill = xOut.health?.skills?.[0];
  assert(cSkill && xSkill, "both sides must produce a skills entry");
  const cSkillKeys = JSON.stringify(Object.keys(cSkill).sort());
  const xSkillKeys = JSON.stringify(Object.keys(xSkill).sort());
  assertEqual(cSkillKeys, xSkillKeys, "skills entry key sets must match across analyzers");

  // Both must expose a tool_failures entry with the same key set.
  const cFail = (cOut.health?.tool_failures ?? cOut.raw_for_compound?.tool_failures ?? [])[0];
  const xFail = (xOut.health?.tool_failures ?? xOut.raw_for_compound?.tool_failures ?? [])[0];
  assert(cFail && xFail, "both sides must produce a tool_failures entry");
  const cFailKeys = JSON.stringify(Object.keys(cFail).sort());
  const xFailKeys = JSON.stringify(Object.keys(xFail).sort());
  assertEqual(cFailKeys, xFailKeys, "tool_failures entry key sets must match across analyzers");

  // The shared core fields must be PRESENT on both sides (empty on codex where
  // it has no equivalent signal) — guards a rename/removal of the symmetry
  // placeholders that SKILL.md documents as core fields.
  for (const out of [cOut, xOut]) {
    assert(Array.isArray(out.health?.skill_attribution), "health.skill_attribution present on both");
    assert(Array.isArray(out.health?.prs), "health.prs present on both");
    assert(Array.isArray(out.narrative?.away_summaries), "narrative.away_summaries present on both");
    assert(typeof out.session?.recorded_turn_ms === "number", "session.recorded_turn_ms present on both");
  }
});

// =====================================================================
// VAL-SYM-002 — pre-existing fields preserved (additive, not destructive)
// =====================================================================
test("claude analyzer preserves pre-existing top-level and key nested fields [VAL-SYM-002]", () => {
  const file = writeFixture("sym2", [
    claudeUser("hi", T0),
    claudeAssistant({ ts: T0, reqId: "r1", content: [{ type: "tool_use", name: "Read", input: { file_path: "/a" } }] }),
  ]);
  const out = runAnalyzer(CLAUDE, file);
  // These existed before the expansion; the contract pins them as non-removed,
  // type-stable. (This guards against an accidental rename during the change.)
  assert(typeof out.cli === "string", "cli preserved");
  assert(out.session && typeof out.session === "object", "session preserved");
  assert(out.narrative && Array.isArray(out.narrative.feedback_moments), "narrative.feedback_moments preserved");
  assert(out.health && out.health.tokens && typeof out.health.tokens.total === "number", "health.tokens.total preserved");
  assert(Array.isArray(out.health.waste_signals), "health.waste_signals preserved");
  assert(out.raw_for_compound && Array.isArray(out.raw_for_compound.repeated_reads), "raw_for_compound preserved");
});

// =====================================================================
// VAL-DOC-001 — SKILL.md no longer claims Codex has no skills (repo-check)
// =====================================================================
test("SKILL.md drops the outdated 'Codex skills always empty / no skill concept' claims [VAL-DOC-001]", () => {
  const txt = fs.readFileSync(SKILL_MD, "utf8");
  assert(!/skills\s*永远为空/.test(txt), "SKILL.md must not claim Codex skills are always empty");
  assert(!/Codex[^\n]*没有\s*skill/.test(txt) && !/没有\s*skill\s*概念/.test(txt),
    "SKILL.md must not claim Codex has no skill concept");
});

test("SKILL.md documents the newly added analyzer fields [VAL-DOC-001]", () => {
  const txt = fs.readFileSync(SKILL_MD, "utf8");
  // Each new signal area should be mentioned somewhere in the doc.
  const required = ["PR", "attribution", "turn_duration", "away_summary", "aiTitle"];
  const missing = required.filter((k) => !txt.includes(k));
  assert(missing.length === 0, `SKILL.md missing docs for new fields: ${missing.join(", ")}`);
  // Tool-failure documentation (allow either the field name or phrase).
  assert(/tool_failures|工具失败/.test(txt), "SKILL.md must document tool failures");
});

// =====================================================================
// NEW FEATURE — evaluation substrate (skill_catalog / workflow_rules /
// workflow_signals). Traces to docs/worklog/worklog-2026-05-29-feat-session-compound-skill-eval/
// validation-contract.md. The substrate is the analyzer's deterministic
// FACT extraction; all judgement is the eval subagent's job. Tests assert
// health.skill_catalog / health.workflow_rules / health.workflow_signals.
// "Red" here = the analyzer runs (exit 0) but the asserted field is
// absent/empty/wrong — never a crash (runAnalyzer* throw on non-zero exit).
// =====================================================================

// ---------------------------------------------------------------------
// VAL-SUB-001 — skill_catalog: one entry per installed SKILL.md, each with
// a non-empty name and a present description, across ≥2 skill roots.
// RED today: --skill-root is ignored, health.skill_catalog is undefined.
// The assertions pin exact fixture-derived skill names that the real
// ~/.claude roots cannot accidentally satisfy.
// ---------------------------------------------------------------------
test("claude analyzer builds skill_catalog from --skill-root SKILL.md files [VAL-SUB-001]", () => {
  const rootA = writeSkillRoot("a", [
    { name: "alpha-skill", description: "use when doing alpha things" },
    { name: "beta-skill", description: "use when doing beta things" },
  ]);
  const rootB = writeSkillRoot("b", [
    { name: "gamma-skill", description: "use when doing gamma things" },
  ]);
  const file = writeFixture("cat-claude", [claudeUser("hello", T0)]);
  const out = runAnalyzerArgs(CLAUDE, [
    "--file",
    file,
    "--skill-root",
    rootA,
    "--skill-root",
    rootB,
  ]);
  const cat = pickSkillCatalog(out);
  assert(Array.isArray(cat), "health.skill_catalog must be an array");
  const names = cat.map((e) => e.name).sort();
  // Exactly the three fixture skills — confirms it scanned the override roots,
  // not the real ~/.claude root (which would add unrelated names).
  assertEqual(
    JSON.stringify(names),
    JSON.stringify(["alpha-skill", "beta-skill", "gamma-skill"]),
    "skill_catalog must contain exactly the three fixture skills (one per SKILL.md, both roots)",
  );
  for (const e of cat) {
    assert(typeof e.name === "string" && e.name.length > 0, "each entry name non-empty string");
    assert(typeof e.description === "string", "each entry has a description string");
    assert(e.description.length > 0, "fixture descriptions are non-empty");
    assert(typeof e.editable === "boolean", "each entry has a boolean editable flag");
  }
});

// ---------------------------------------------------------------------
// VAL-SUB-001 (editable branch) — editable resolves TRUE for a skill whose
// source lives under the session cwd (in-repo, optimizable in place) and FALSE
// for a root outside it. Exercises buildSkillCatalog's repoPrefix check in BOTH
// directions — the field VAL-CAND-001 candidate routing depends on. The basic
// SUB-001 test only asserts editable is a boolean, and since its fixtures live
// in os.tmpdir() with the cwd elsewhere, the true branch had zero coverage.
// ---------------------------------------------------------------------
test("claude analyzer marks in-repo skills editable:true, external editable:false [VAL-SUB-001]", () => {
  // A session cwd that physically contains an in-repo skill source.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sc-editcwd-"));
  cleanupFiles.push(cwd);
  const inRepoRoot = path.join(cwd, "plugins", "demo", "skills");
  const inRepoSkillDir = path.join(inRepoRoot, "in-repo-skill");
  fs.mkdirSync(inRepoSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(inRepoSkillDir, "SKILL.md"),
    "---\nname: in-repo-skill\ndescription: use when editing in-repo\n---\n\n# in-repo-skill\n\nbody.\n",
  );
  // An external root outside the cwd -> editable must be false.
  const externalRoot = writeSkillRoot("ext", [
    { name: "external-skill", description: "use when external" },
  ]);

  const file = writeClaudeFixtureWithCwd("editflag", [{ ...claudeUser("work", T0), cwd }], cwd);
  const out = runAnalyzerArgs(
    CLAUDE,
    ["--file", file, "--skill-root", inRepoRoot, "--skill-root", externalRoot],
    { cwd },
  );

  const cat = pickSkillCatalog(out);
  assert(Array.isArray(cat), "skill_catalog must be an array");
  const inRepo = cat.find((e) => e.name === "in-repo-skill");
  const external = cat.find((e) => e.name === "external-skill");
  assert(inRepo, "in-repo-skill must be present in the catalog");
  assert(external, "external-skill must be present in the catalog");
  assertEqual(inRepo.editable, true, "skill whose source is under the session cwd -> editable:true");
  assertEqual(external.editable, false, "skill from a root outside the session cwd -> editable:false");
});

// ---------------------------------------------------------------------
// VAL-SUB-002 — workflow_rules parsed from the cwd AGENTS.md managed block;
// empty array (not an error) when no managed block exists.
// cwd is routed via the session JSONL (claudeUser entries carry cwd) AND the
// spawned process cwd, covering both plausible resolution strategies.
// RED today: health.workflow_rules is undefined regardless of AGENTS.md.
// ---------------------------------------------------------------------
test("claude analyzer parses workflow_rules from the cwd AGENTS.md managed block [VAL-SUB-002]", () => {
  const rules = [
    "需求澄清：新需求先澄清 requirement。",
    "方案计划：先做规模判定再决定 plan 方式。",
    "尽早提交：完成第一个 commit 后尽早开 Draft PR。",
  ];
  const cwd = writeCwdDir("withblock", managedAgentsMd(rules));
  const file = writeClaudeFixtureWithCwd("wr-claude", [claudeUser("go", T0)], cwd);
  const out = runAnalyzerArgs(CLAUDE, ["--file", file], { cwd });
  const wr = pickWorkflowRules(out);
  assert(Array.isArray(wr), "health.workflow_rules must be an array");
  assert(wr.length >= 1, "managed block present -> non-empty workflow_rules");
  for (const r of wr) {
    assert(typeof r.n === "number", "each rule has a numeric n");
    assert(typeof r.text === "string" && r.text.length > 0, "each rule has non-empty text");
  }
  // Rule text must be sourced from the fixture block, not somewhere else.
  const joined = wr.map((r) => r.text).join(" ");
  assert(joined.includes("需求澄清") || joined.includes("Draft PR"),
    "workflow_rules text must come from the fixture managed block");
});

test("claude analyzer emits empty workflow_rules when cwd AGENTS.md has no managed block [VAL-SUB-002]", () => {
  // AGENTS.md exists but carries NO managed markers -> [] (not an error).
  const cwd = writeCwdDir("noblock", "# just a plain repo file\n\nno managed block here.\n");
  const file = writeClaudeFixtureWithCwd("wr-none", [claudeUser("go", T0)], cwd);
  const out = runAnalyzerArgs(CLAUDE, ["--file", file], { cwd });
  const wr = pickWorkflowRules(out);
  assert(Array.isArray(wr), "workflow_rules must exist as an empty array, not be missing");
  assertEqual(wr.length, 0, "no managed block -> empty workflow_rules (not an error)");
});

// ---------------------------------------------------------------------
// VAL-SUB-003 — workflow_signals is a NEUTRAL facts object (no verdicts):
// git_branch / on_main / had_code_edit / first_edit_ts / prs_count /
// skills_invoked_count. The mechanical layer only extracts facts; all
// instruction-following judgement is the eval subagent's job.
// RED before the facts rework: health.workflow_signals is undefined.
// ---------------------------------------------------------------------
test("claude analyzer emits neutral workflow_signals facts (no verdicts) [VAL-SUB-003]", () => {
  // Scenario A: edits ON A FEATURE BRANCH + a PR + a skill call.
  const fileA = writeFixture("wsig-a", [
    { ...claudeUser("do feature work", T0), gitBranch: "feat/x" },
    claudeAssistant({
      ts: T0,
      reqId: "r1",
      content: [
        { type: "tool_use", id: "s1", name: "Skill", input: { skill: "test-designer" } },
        { type: "tool_use", id: "e1", name: "Edit", input: { file_path: "/a" } },
      ],
    }),
    claudePrLink({ prNumber: 200, prUrl: "https://github.com/o/r/pull/200", prRepository: "o/r", ts: T1 }),
  ]);
  const a = pickWorkflowSignals(runAnalyzer(CLAUDE, fileA));
  assert(a && typeof a === "object" && !Array.isArray(a), "workflow_signals must be a (non-array) object");
  // No verdict fields — purely facts.
  assert(!("status" in a) && !("pass" in a), "workflow_signals must not carry pass/fail verdicts");
  assertEqual(a.git_branch, "feat/x", "git_branch reflects the session branch");
  assertEqual(a.on_main, false, "on_main false on a feature branch");
  assertEqual(a.had_code_edit, true, "had_code_edit true when an Edit tool was used");
  assert(typeof a.first_edit_ts === "number", "first_edit_ts is a number when edits occurred");
  assertEqual(a.prs_count, 1, "prs_count counts the pr-link");
  assertEqual(a.skills_invoked_count, 1, "skills_invoked_count counts the Skill call");

  // Scenario B: read-only session on main — facts reflect that honestly.
  const fileB = writeFixture("wsig-b", [
    { ...claudeUser("just read", T0), gitBranch: "main" },
    claudeAssistant({ ts: T0, reqId: "r1", content: [{ type: "tool_use", id: "rd", name: "Read", input: { file_path: "/a" } }] }),
  ]);
  const b = pickWorkflowSignals(runAnalyzer(CLAUDE, fileB));
  assertEqual(b.on_main, true, "on_main true on main branch");
  assertEqual(b.had_code_edit, false, "had_code_edit false with no edit tools");
  assertEqual(b.first_edit_ts, null, "first_edit_ts null when no edits");
  assertEqual(b.prs_count, 0, "prs_count 0 with no PR");
});

// ---------------------------------------------------------------------
// VAL-SUB-004 — skill_catalog dedups by realpath/name: two --skill-root
// dirs where a symlink makes the SAME SKILL.md reachable twice -> one entry.
// RED today: skill_catalog is undefined; once implemented, a naive scanner
// that doesn't dedup by realpath would emit the skill twice.
// ---------------------------------------------------------------------
test("claude analyzer dedups skill_catalog when a symlink exposes the same skill twice [VAL-SUB-004]", () => {
  // rootA holds the real skill dir; rootB symlinks to rootA's skill dir, so the
  // same SKILL.md realpath is reachable from both roots.
  const rootA = writeSkillRoot("dedupA", [
    { name: "dup-skill", description: "use when deduping" },
  ]);
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), "sc-skills-dedupB-"));
  cleanupFiles.push(rootB);
  const realSkillDir = path.join(rootA, "dup-skill");
  const linkPath = path.join(rootB, "dup-skill");
  let symlinkOk = true;
  try {
    fs.symlinkSync(realSkillDir, linkPath, "dir");
  } catch {
    // Filesystem without symlink support: fall back to a hard duplicate so the
    // name-based dedup half of the contract is still exercised.
    symlinkOk = false;
    fs.mkdirSync(linkPath, { recursive: true });
    fs.copyFileSync(
      path.join(realSkillDir, "SKILL.md"),
      path.join(linkPath, "SKILL.md"),
    );
  }
  const file = writeFixture("dedup-claude", [claudeUser("hi", T0)]);
  const out = runAnalyzerArgs(CLAUDE, [
    "--file",
    file,
    "--skill-root",
    rootA,
    "--skill-root",
    rootB,
  ]);
  const cat = pickSkillCatalog(out);
  assert(Array.isArray(cat), "health.skill_catalog must be an array");
  const dups = cat.filter((e) => e.name === "dup-skill");
  assertEqual(
    dups.length,
    1,
    `the same skill reachable via two roots (${symlinkOk ? "symlink" : "duplicate"}) must appear once`,
  );
});

// ---------------------------------------------------------------------
// VAL-PAR-001 — both analyzers emit the three substrate keys under health with
// matching types: skill_catalog (array), workflow_rules (array),
// workflow_signals (object). With nothing found, the arrays are empty and the
// signals object is still present. For codex, cwd is routed via
// session_meta.payload.cwd; here we point both at empty skill roots + a cwd
// with no managed block.
// RED before the rework: the keys are undefined on both analyzers.
// ---------------------------------------------------------------------
test("both analyzers emit skill_catalog/workflow_rules/workflow_signals under health, same types [VAL-PAR-001]", () => {
  // Empty skill root (dir with no SKILL.md) -> skill_catalog should be [].
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sc-skills-empty-"));
  cleanupFiles.push(emptyRoot);
  // cwd with no managed block -> workflow_rules should be [].
  const cwd = writeCwdDir("sym", "# plain\n\nno block.\n");

  const claudeFile = writeClaudeFixtureWithCwd("sym-sub-claude", [claudeUser("hi", T0)], cwd);
  const cOut = runAnalyzerArgs(CLAUDE, ["--file", claudeFile, "--skill-root", emptyRoot], { cwd });

  const codexFile = (() => {
    const f = writeFixture("sym-sub-codex", [
      // session_meta carries cwd; stamp the controlled cwd onto it.
      { ...codexMeta(), payload: { ...codexMeta().payload, cwd } },
      codexTurnContext(),
      codexUserMsgEvent("hi", T0),
    ]);
    return f;
  })();
  const xOut = runAnalyzerArgs(CODEX, ["--file", codexFile, "--skill-root", emptyRoot], { cwd });

  for (const [label, out] of [["claude", cOut], ["codex", xOut]]) {
    const cat = pickSkillCatalog(out);
    const wr = pickWorkflowRules(out);
    const wsig = pickWorkflowSignals(out);
    assert(Array.isArray(cat), `${label}: health.skill_catalog must be present as an array`);
    assert(Array.isArray(wr), `${label}: health.workflow_rules must be present as an array`);
    assert(wsig && typeof wsig === "object" && !Array.isArray(wsig),
      `${label}: health.workflow_signals must be present as a (non-array) object`);
    // Nothing found -> empty arrays (present, not missing); signals still object.
    assertEqual(cat.length, 0, `${label}: empty skill root -> empty skill_catalog`);
    assertEqual(wr.length, 0, `${label}: no managed block -> empty workflow_rules`);
    // workflow_signals carries the same fact keys on both CLIs.
    for (const f of ["git_branch", "on_main", "had_code_edit", "first_edit_ts", "prs_count", "skills_invoked_count"]) {
      assert(f in wsig, `${label}: workflow_signals must carry the ${f} fact`);
    }
  }
  // Type parity across analyzers.
  assert(Array.isArray(cOut.health?.skill_catalog) && Array.isArray(xOut.health?.skill_catalog),
    "skill_catalog must be an array on both analyzers");
  assert(Array.isArray(cOut.health?.workflow_rules) && Array.isArray(xOut.health?.workflow_rules),
    "workflow_rules must be an array on both analyzers");
  assert(typeof cOut.health?.workflow_signals === "object" && typeof xOut.health?.workflow_signals === "object",
    "workflow_signals must be an object on both analyzers");
});

// =====================================================================
// EVAL / CAND / REL — doc + release contract (repo-check). These grep the
// SKILL.md / plugin.json / package.json / CI that the feature must ship.
// Trace to docs/worklog/worklog-2026-05-29-feat-session-compound-skill-eval/validation-contract.md.
// =====================================================================
const REPO_ROOT = path.resolve(HERE, "..");
const PLUGIN_ROOT = path.resolve(ANALYZER_DIR, "..", "..", "..");
function semverGt(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

test("SKILL.md mandates an independent, zero-context eval subagent [VAL-EVAL-001]", () => {
  const txt = fs.readFileSync(SKILL_MD, "utf8");
  assert(/独立/.test(txt), "SKILL.md eval step must require an 独立 subagent");
  assert(/零上下文继承|fresh context/i.test(txt),
    "SKILL.md must require fresh/zero-context dispatch for the eval subagent");
});

test("SKILL.md scopes recall to all installed skills, execution-eval to invoked-only [VAL-EVAL-002]", () => {
  const txt = fs.readFileSync(SKILL_MD, "utf8");
  assert(/全部已安装\s*skill/.test(txt), "recall must cover 全部已安装 skill");
  assert(/(本会话.*(调用过|跑过))|(调用过|跑过).*skill/.test(txt),
    "execution eval must be scoped to skills invoked this session");
});

test("SKILL.md requires severity+confidence findings with no pre-filtering [VAL-EVAL-003]", () => {
  const txt = fs.readFileSync(SKILL_MD, "utf8");
  assert(/severity/.test(txt) && /confidence/.test(txt),
    "findings must carry severity + confidence");
  assert(/不.{0,4}预过滤/.test(txt), "findings must not be pre-filtered by importance");
});

test("SKILL.md routes editable in-repo SKILL.md eval findings to skill-body candidates [VAL-CAND-001]", () => {
  const txt = fs.readFileSync(SKILL_MD, "utf8");
  assert(/editable/.test(txt), "candidate guidance must key on the editable flag");
  assert(/in-repo\s*SKILL\.md|in-repo SKILL/.test(txt) && /就地优化/.test(txt),
    "editable findings must target the in-repo SKILL.md for in-place optimization");
});

test("SKILL.md forbids edit candidates for external/cached skills [VAL-CAND-002]", () => {
  const txt = fs.readFileSync(SKILL_MD, "utf8");
  assert(/不.{0,6}产出编辑候选|不要产出编辑候选/.test(txt),
    "external/cached skills must not yield edit candidates");
  assert(/更新即被覆盖|下次更新.*覆盖/.test(txt),
    "rationale (overwritten on update) must be stated");
});

test("auriga-workflow plugin version bumped above 3.7.0 + SKILL.md documents new fields [VAL-REL-001]", () => {
  for (const rel of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
    const p = path.join(PLUGIN_ROOT, rel);
    const v = JSON.parse(fs.readFileSync(p, "utf8")).version;
    assert(semverGt(v, "3.7.0"), `${rel} version ${v} must be > 3.7.0`);
  }
  const txt = fs.readFileSync(SKILL_MD, "utf8");
  for (const f of ["skill_catalog", "workflow_rules", "workflow_signals"]) {
    assert(txt.includes(f), `SKILL.md must document new substrate field ${f}`);
  }
});

test("substrate tests are wired into test:session-compound + CI [VAL-REL-002]", () => {
  const self = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert(/\[VAL-SUB-001\]/.test(self) && /\[VAL-PAR-001\]/.test(self),
    "this file must carry the SUB/PAR substrate assertions");
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert(/session-compound-analyzers\.test\.mjs/.test(pkg.scripts["test:session-compound"] || ""),
    "package.json test:session-compound must point at this file");
  const ci = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "test.yml"), "utf8");
  assert(/test:session-compound/.test(ci), "CI must run test:session-compound");
});

// ---------- skill timeline + review syntheses (stage classification raw material) ----------

const DEEP_REVIEW_TEXT =
  "## Deep Review: PR #7 — fix scope\n**Tags**: logic  |  **Reviewers**: correctness\n### Blocking issues\n- [correctness] off-by-one in pager (severity: high, confidence: 0.9)\n### Non-blocking\n- none";

test("claude analyzer emits a timestamped skill_timeline for Skill invocations [VAL-TL-001]", () => {
  const file = writeFixture("tl-claude", [
    claudeUser("start", T0),
    claudeAssistant({
      ts: T1,
      reqId: "r1",
      content: [{ type: "tool_use", id: "t1", name: "Skill", input: { skill: "spec-design" } }],
    }),
    claudeAssistant({
      ts: T2,
      reqId: "r2",
      content: [{ type: "tool_use", id: "t2", name: "Skill", input: { skill: "test-driven-development" } }],
    }),
  ]);
  const out = runAnalyzer(CLAUDE, file);
  const tl = out.raw_for_compound?.skill_timeline;
  assert(Array.isArray(tl), "raw_for_compound.skill_timeline must be an array");
  assert(tl.length === 2, `expected 2 timeline entries, got ${tl?.length}`);
  assert(tl[0].name === "spec-design" && typeof tl[0].ts === "number",
    "each entry must carry {ts, name}");
  assert(tl[1].name === "test-driven-development", "entries must keep invocation order");
});

test("claude analyzer emits empty skill_timeline without Skill calls [VAL-TL-001]", () => {
  const file = writeFixture("tl-claude-empty", [claudeUser("hi", T0)]);
  const out = runAnalyzer(CLAUDE, file);
  assert(Array.isArray(out.raw_for_compound?.skill_timeline) && out.raw_for_compound.skill_timeline.length === 0,
    "skill_timeline must default to an empty array");
});

test("codex analyzer emits a timestamped skill_timeline from <skill> blocks [VAL-TL-002]", () => {
  const file = writeFixture("tl-codex", [
    codexMeta(),
    codexTurnContext(),
    codexUserMsgEvent("start", T0),
    codexSkillBlock("spec-design", T1),
  ]);
  const out = runAnalyzer(CODEX, file);
  const tl = out.raw_for_compound?.skill_timeline;
  assert(Array.isArray(tl) && tl.length === 1, "codex skill_timeline must capture the skill block");
  assert(tl[0].name === "spec-design" && typeof tl[0].ts === "number",
    "codex entries must carry {ts, name}");
});

test("claude analyzer captures deep-review synthesis text in review_syntheses [VAL-RS-001]", () => {
  const file = writeFixture("rs-claude", [
    claudeUser("review the PR", T0),
    claudeAssistant({ ts: T1, reqId: "r1", content: [{ type: "text", text: "正在分派审查者……" }] }),
    claudeAssistant({ ts: T2, reqId: "r2", content: [{ type: "text", text: DEEP_REVIEW_TEXT }] }),
  ]);
  const out = runAnalyzer(CLAUDE, file);
  const rs = out.raw_for_compound?.review_syntheses;
  assert(Array.isArray(rs) && rs.length === 1,
    `only the punch-list message must be captured, got ${rs?.length}`);
  assert(typeof rs[0].ts === "number" && rs[0].text.includes("Blocking issues"),
    "the synthesis text must be kept (not a 200-char preview)");
});

test("codex analyzer captures deep-review synthesis from agent_message [VAL-RS-002]", () => {
  const file = writeFixture("rs-codex", [
    codexMeta(),
    codexTurnContext(),
    codexUserMsgEvent("review the PR", T0),
    codexAgentFinal(DEEP_REVIEW_TEXT, T1),
  ]);
  const out = runAnalyzer(CODEX, file);
  const rs = out.raw_for_compound?.review_syntheses;
  assert(Array.isArray(rs) && rs.length === 1, "codex must capture the punch-list agent_message");
  assert(rs[0].text.includes("Blocking issues"), "synthesis text must be kept");
});

test("SKILL.md documents skill_timeline / review_syntheses and CI review consumption [VAL-RS-003]", () => {
  const txt = fs.readFileSync(SKILL_MD, "utf8");
  assert(txt.includes("skill_timeline"), "SKILL.md must document skill_timeline");
  assert(txt.includes("review_syntheses"), "SKILL.md must document review_syntheses");
  assert(/gh pr view[^\n]*--comments|--comments[^\n]*gh pr view/.test(txt),
    "SKILL.md must instruct pulling PR review comments (incl. CI reviews) via gh");
});

// ---------- report + cleanup ----------
for (const dir of cleanupFiles) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`  ok  ${r.name}`);
  } else {
    failed++;
    console.log(`FAIL  ${r.name}`);
    console.log(`      ${r.err.message}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
