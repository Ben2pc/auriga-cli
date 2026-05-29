#!/usr/bin/env node
// TDD red-phase tests for the session-compound analyzers' signal-coverage
// expansion. Each test traces to a VAL-XXX-NNN id in
// docs/specs/session-compound-signals/validation-contract.md.
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

// Accessors that tolerate either of the assumed field locations (see header).
function pickPrs(out) {
  return out.health?.prs ?? out.narrative?.prs ?? null;
}
function pickSkillAttribution(out, skillName) {
  if (Array.isArray(out.health?.skill_attribution)) {
    const hit = out.health.skill_attribution.find((s) => s.name === skillName);
    return hit ? hit.count : null;
  }
  const sk = out.health?.skills?.find?.((s) => s.name === skillName);
  if (sk && (sk.attribution != null || sk.attributed_calls != null)) {
    return sk.attribution ?? sk.attributed_calls;
  }
  return null;
}
function pickToolFailures(out) {
  return out.health?.tool_failures ?? out.raw_for_compound?.tool_failures ?? null;
}
function pickRecordedTurnMs(out) {
  return out.session?.recorded_turn_ms ?? out.session?.turn_duration_ms ?? null;
}
function pickAwaySummaries(out) {
  return out.narrative?.away_summaries ?? out.raw_for_compound?.away_summaries ?? null;
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
  // Aggregate of the two recorded values; not equal to the single-turn
  // active_ms gap estimate (which is <= IDLE_GAP_MS and gap-derived).
  assertEqual(recorded, 51281 + 12000, "recorded duration should aggregate turn_duration records");
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
test("claude analyzer classifies scope-narrowing phrase as feedback [VAL-HEUR-001]", () => {
  // "先不动吧 / 不着急 / 微优化吧" — direction-shrinking, currently missed.
  const file = writeFixture("heur-shrink", [
    claudeUser("这个先不动吧，不着急，先做个微优化吧", T0),
  ]);
  const out = runAnalyzer(CLAUDE, file);
  const fm = out.narrative?.feedback_moments ?? [];
  assert(fm.length >= 1, "scope-narrowing turn should enter feedback_moments");
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
