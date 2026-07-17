#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SKILL_ROOT = path.join(
  ROOT,
  "plugins",
  "auriga-workflow",
  "skills",
  "session-compound",
);
const PIPELINE = path.join(SKILL_ROOT, "scripts", "insights-pipeline.mjs");
const RENDERER = path.join(SKILL_ROOT, "scripts", "render-report.mjs");
const TEMPLATES = path.join(SKILL_ROOT, "templates");

const results = [];
const cleanup = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}
function assert(value, message) {
  if (!value) throw new Error(message);
}
function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sc-insights-${prefix}-`));
  cleanup.push(dir);
  return dir;
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
}
function validFacet(id, overrides = {}) {
  return {
    session_id: id,
    project_area: "project-a",
    underlying_goal: "complete the task",
    outcome: "fully_achieved",
    wins: [],
    frictions: [],
    user_instructions: [],
    brief_summary: "A short evidence-based summary.",
    evidence_refs: [`${id}:turn:0`],
    ...overrides,
  };
}

function validSingleReport(overrides = {}) {
  return {
    mode: "single",
    report_data: {
      schema_version: 2,
      cli: "codex",
      session: { id: "single-session" },
      narrative: {},
      health: {},
      raw_for_compound: {},
    },
    narrative_summary: "A concise factual summary.",
    anomalies: [],
    eval_findings: [],
    observations: [],
    experiments: [],
    durable_candidates: [],
    ...overrides,
  };
}

function validInsightsReport(overrides = {}) {
  return {
    mode: "insights",
    generated_at: "2026-07-16T00:00:00.000Z",
    window: {
      days: 30,
      started_at: "2026-06-16T00:00:00.000Z",
      ended_at: "2026-07-16T00:00:00.000Z",
    },
    coverage: {
      discovered: 3,
      in_window: 3,
      eligible: 2,
      analyzed: 2,
      cache_hits: 1,
      newly_analyzed: 1,
      failed: 0,
      queued: 1,
      excluded: 1,
      excluded_subagents: 0,
      excluded_damaged: 0,
      invalid_cache: 0,
      deferred: 0,
      representative_count: 2,
      semantic_budget_deferred: 0,
      not_semantically_analyzed: 0,
    },
    at_a_glance: {
      working: "works",
      hindering: "friction",
      quick_wins: "try",
      ambitious: "later",
    },
    project_areas: [],
    interaction_style: "iterative",
    wins: [],
    frictions: [],
    observations: [],
    experiments: [],
    durable_candidates: [],
    evidence_limitations: [],
    ...overrides,
  };
}
function validInsightsAggregate(overrides = {}) {
  return {
    mode: "insights-aggregate",
    runtime: "codex",
    representative_facets: [{
      session_id: "session-readable",
      project_area: "Auriga 工作流升级",
      ended_at: "2026-07-15T08:00:00.000Z",
    }],
    ...overrides,
  };
}
function run(script, args, opts = {}) {
  return spawnSync("node", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...opts.env },
  });
}
function writeCodexSession(root, id, timestamp, extra = [], source = null) {
  const file = path.join(root, `rollout-${id}.jsonl`);
  const entries = [
    { timestamp, type: "session_meta", payload: { id, cwd: "/repo", ...(source == null ? {} : { source }) } },
    { timestamp, type: "event_msg", payload: { type: "user_message", message: `task ${id}` } },
    ...extra,
  ];
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(file, `${entries.map((x) => JSON.stringify(x)).join("\n")}\n`);
  return file;
}

function writeClaudeSession(root, id, timestamp, extra = [], { subagent = false } = {}) {
  const dir = subagent ? path.join(root, "project", id, "subagents") : path.join(root, "project");
  const file = path.join(dir, `${id}.jsonl`);
  const entries = [
    {
      timestamp,
      type: "user",
      sessionId: id,
      cwd: "/repo",
      message: { role: "user", content: `task ${id}` },
    },
    ...extra,
  ];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  return file;
}

test("prepare discovers the 30-day window and exposes cache coverage [VAL-MODE-003]", () => {
  const sessions = tmpDir("prepare-sessions");
  const cache = tmpDir("prepare-cache");
  writeCodexSession(sessions, "recent", "2026-07-10T00:00:00.000Z");
  writeCodexSession(sessions, "old", "2026-05-01T00:00:00.000Z");
  const r = run(PIPELINE, [
    "prepare",
    "--runtime", "codex",
    "--sessions-root", sessions,
    "--cache-root", cache,
    "--now", "2026-07-16T00:00:00.000Z",
    "--days", "30",
    "--facet-schema-version", "2",
    "--prompt-version", "2",
  ]);
  assert(r.status === 0, `prepare failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  equal(out.coverage.discovered, 2, "all source sessions are inventoried");
  equal(out.coverage.in_window, 1, "only the recent session enters the window");
  equal(out.coverage.cache_hits, 0, "first run has no cache hits");
  equal(out.analysis_queue.length, 1, "the recent uncached session is queued");
  equal(out.analysis_queue[0].session_id, "recent", "the queue carries the session id");
});

test("prepare isolates a damaged recent log instead of aborting the inventory [VAL-MODE-003]", () => {
  const sessions = tmpDir("damaged-sessions");
  const cache = tmpDir("damaged-cache");
  writeCodexSession(sessions, "healthy", "2026-07-10T00:00:00.000Z");
  const damaged = path.join(sessions, "rollout-damaged.jsonl");
  fs.writeFileSync(damaged, "not-json\n{still-not-json\n");
  const damagedTime = new Date("2026-07-12T00:00:00.000Z");
  fs.utimesSync(damaged, damagedTime, damagedTime);
  const r = run(PIPELINE, [
    "prepare",
    "--runtime", "codex",
    "--sessions-root", sessions,
    "--cache-root", cache,
    "--now", "2026-07-16T00:00:00.000Z",
    "--days", "30",
    "--facet-schema-version", "2",
    "--prompt-version", "2",
  ]);
  assert(r.status === 0, `prepare failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  equal(out.coverage.discovered, 2, "the damaged source remains visible in inventory coverage");
  equal(out.coverage.in_window, 2, "mtime keeps an unparseable recent source in the window");
  equal(out.coverage.eligible, 1, "only the healthy source is eligible for semantic analysis");
  equal(out.coverage.excluded, 1, "the damaged source is isolated as excluded");
});

test("prepare excludes partial logs and internal subagent sessions [VAL-MODE-003]", () => {
  const sessions = tmpDir("session-boundaries");
  const cache = tmpDir("session-boundaries-cache");
  writeCodexSession(sessions, "main", "2026-07-10T00:00:00.000Z");
  writeCodexSession(
    sessions,
    "subagent",
    "2026-07-10T01:00:00.000Z",
    [],
    { subagent: { thread_spawn: { parent_thread_id: "main" } } },
  );
  const partial = writeCodexSession(sessions, "partial", "2026-07-10T02:00:00.000Z");
  fs.appendFileSync(partial, "{broken-json\n");
  const r = run(PIPELINE, [
    "prepare",
    "--runtime", "codex",
    "--sessions-root", sessions,
    "--cache-root", cache,
    "--now", "2026-07-16T00:00:00.000Z",
    "--days", "30",
    "--facet-schema-version", "2",
    "--prompt-version", "2",
  ]);
  assert(r.status === 0, `prepare failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  equal(out.coverage.eligible, 1, "only the complete main session is eligible");
  equal(out.coverage.excluded_subagents, 1, "internal subagents are disclosed separately");
  equal(out.coverage.excluded_damaged, 1, "partial logs are disclosed as damaged");
  equal(out.analysis_queue[0].session_id, "main", "only the main session is queued");
});

test("Claude Code inventory skips subagents and uses an isolated runtime queue [VAL-MODE-003]", () => {
  const sessions = tmpDir("claude-sessions");
  const cache = tmpDir("claude-cache");
  writeClaudeSession(sessions, "claude-main", "2026-07-10T00:00:00.000Z");
  writeClaudeSession(sessions, "claude-child", "2026-07-10T01:00:00.000Z", [], { subagent: true });
  const r = run(PIPELINE, [
    "prepare",
    "--runtime", "claude-code",
    "--sessions-root", sessions,
    "--cache-root", cache,
    "--now", "2026-07-16T00:00:00.000Z",
    "--days", "30",
    "--facet-schema-version", "2",
    "--prompt-version", "2",
  ]);
  assert(r.status === 0, `Claude prepare failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  equal(out.coverage.eligible, 1, "the Claude main session is eligible");
  equal(out.analysis_queue[0].session_id, "claude-main", "the Claude queue stays runtime-specific");
});

test("stored facets hit cache until content or analysis protocol changes [VAL-MODE-003]", () => {
  const sessions = tmpDir("cache-sessions");
  const cache = tmpDir("cache-root");
  const source = writeCodexSession(sessions, "cached", "2026-07-10T00:00:00.000Z");
  const common = [
    "--runtime", "codex",
    "--sessions-root", sessions,
    "--cache-root", cache,
    "--now", "2026-07-16T00:00:00.000Z",
    "--days", "30",
    "--facet-schema-version", "2",
    "--prompt-version", "2",
  ];
  const first = JSON.parse(run(PIPELINE, ["prepare", ...common]).stdout);
  const descriptorFile = path.join(tmpDir("descriptor"), "descriptor.json");
  const facetFile = path.join(tmpDir("facet"), "facet.json");
  writeJson(descriptorFile, first.analysis_queue[0]);
  writeJson(facetFile, validFacet("cached", {
    underlying_goal: "test caching",
    brief_summary: "cache test",
  }));
  const stored = run(PIPELINE, [
    "store",
    "--cache-root", cache,
    "--descriptor", descriptorFile,
    "--facet", facetFile,
    "--facet-schema-version", "2",
    "--prompt-version", "2",
  ]);
  assert(stored.status === 0, `store failed: ${stored.stderr}`);
  const storedResult = JSON.parse(stored.stdout);
  equal(fs.statSync(storedResult.cache_file).mode & 0o777, 0o600,
    "facet cache files are private to the current user");
  equal(fs.statSync(path.dirname(storedResult.cache_file)).mode & 0o777, 0o700,
    "runtime cache directories are private to the current user");
  const hit = JSON.parse(run(PIPELINE, ["prepare", ...common]).stdout);
  equal(hit.coverage.cache_hits, 1, "unchanged source and protocol reuse the facet");
  equal(hit.analysis_queue.length, 0, "a cache hit is not queued again");

  const staleEntry = JSON.parse(fs.readFileSync(storedResult.cache_file, "utf8"));
  staleEntry.cache_contract.analysis_prompt_version = "1";
  fs.writeFileSync(storedResult.cache_file, JSON.stringify(staleEntry));
  const versionChanged = JSON.parse(run(PIPELINE, ["prepare", ...common]).stdout);
  equal(versionChanged.coverage.cache_hits, 0, "prompt version changes invalidate the facet");

  staleEntry.cache_contract.analysis_prompt_version = "2";
  fs.writeFileSync(storedResult.cache_file, JSON.stringify(staleEntry));
  fs.appendFileSync(source, `${JSON.stringify({ timestamp: "2026-07-11T00:00:00.000Z", type: "event_msg", payload: { type: "user_message", message: "changed" } })}\n`);
  const changed = JSON.parse(run(PIPELINE, ["prepare", ...common]).stdout);
  equal(changed.coverage.cache_hits, 0, "changed source invalidates the facet");
  equal(changed.analysis_queue.length, 1, "changed source is queued again");
});

test("store rejects fields that would turn the cache into a transcript copy [VAL-MODE-003]", () => {
  const cache = tmpDir("private-cache");
  const dir = tmpDir("private-inputs");
  const descriptor = path.join(dir, "descriptor.json");
  const facet = path.join(dir, "facet.json");
  writeJson(descriptor, {
    runtime: "codex",
    session_id: "private",
    source_file: "/tmp/session.jsonl",
    content_fingerprint: "abc",
    started_at: "2026-07-10T00:00:00.000Z",
    ended_at: "2026-07-10T01:00:00.000Z",
    cwd: "/repo",
  });
  writeJson(facet, {
    ...validFacet("private", { underlying_goal: "keep the cache small" }),
    transcript: "full raw conversation must not be cached",
  });
  const r = run(PIPELINE, [
    "store",
    "--cache-root", cache,
    "--descriptor", descriptor,
    "--facet", facet,
    "--facet-schema-version", "2",
    "--prompt-version", "2",
  ]);
  assert(r.status !== 0, "unexpected top-level fields must fail validation");
  assert(/unexpected field: transcript/.test(r.stderr), "the failure identifies the unsafe field");
});

test("store rejects transcript copies hidden inside facet entries [VAL-MODE-003]", () => {
  const cache = tmpDir("nested-private-cache");
  const dir = tmpDir("nested-private-inputs");
  const descriptor = path.join(dir, "descriptor.json");
  const facet = path.join(dir, "facet.json");
  writeJson(descriptor, {
    runtime: "codex",
    session_id: "nested-private",
    source_file: "/tmp/session.jsonl",
    content_fingerprint: "abc",
  });
  writeJson(facet, validFacet("nested-private", {
    wins: [{ text: "worked", evidence_refs: ["nested-private:turn:0"], transcript: "raw" }],
  }));
  const r = run(PIPELINE, [
    "store",
    "--cache-root", cache,
    "--descriptor", descriptor,
    "--facet", facet,
  ]);
  assert(r.status !== 0, "unexpected nested fields must fail validation");
  assert(/unexpected field: transcript/.test(r.stderr), "the nested unsafe field is identified");
});

test("prepare enforces the analysis budget and preserves continuation coverage [VAL-MODE-003]", () => {
  const sessions = tmpDir("budget-sessions");
  const cache = tmpDir("budget-cache");
  for (let index = 0; index < 55; index++) {
    writeCodexSession(sessions, `budget-${index}`, "2026-07-10T00:00:00.000Z");
  }
  const r = run(PIPELINE, [
    "prepare",
    "--runtime", "codex",
    "--sessions-root", sessions,
    "--cache-root", cache,
    "--now", "2026-07-16T00:00:00.000Z",
    "--days", "30",
  ]);
  assert(r.status === 0, `budget prepare failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  equal(out.analysis_queue.length, 50, "the default run queues at most fifty sessions");
  equal(out.coverage.queued, 50, "queued coverage matches the actual batch");
  equal(out.coverage.deferred, 5, "remaining sessions are explicitly deferred");
});

test("prepare isolates a structurally corrupt cache entry [VAL-MODE-003]", () => {
  const sessions = tmpDir("corrupt-cache-sessions");
  const cache = tmpDir("corrupt-cache-root");
  writeCodexSession(sessions, "corrupt-cache", "2026-07-10T00:00:00.000Z");
  const common = [
    "--runtime", "codex",
    "--sessions-root", sessions,
    "--cache-root", cache,
    "--now", "2026-07-16T00:00:00.000Z",
    "--days", "30",
    "--facet-schema-version", "2",
    "--prompt-version", "2",
  ];
  const first = JSON.parse(run(PIPELINE, ["prepare", ...common]).stdout);
  const descriptorFile = path.join(tmpDir("corrupt-descriptor"), "descriptor.json");
  const facetFile = path.join(tmpDir("corrupt-facet"), "facet.json");
  writeJson(descriptorFile, first.analysis_queue[0]);
  writeJson(facetFile, validFacet("corrupt-cache", {
    underlying_goal: "validate reads",
    brief_summary: "valid before corruption",
  }));
  const stored = JSON.parse(run(PIPELINE, [
    "store",
    "--cache-root", cache,
    "--descriptor", descriptorFile,
    "--facet", facetFile,
    "--facet-schema-version", "2",
    "--prompt-version", "2",
  ]).stdout);
  const entry = JSON.parse(fs.readFileSync(stored.cache_file, "utf8"));
  entry.facet.transcript = "corrupt raw copy";
  fs.writeFileSync(stored.cache_file, JSON.stringify(entry));
  const prepared = JSON.parse(run(PIPELINE, ["prepare", ...common]).stdout);
  equal(prepared.coverage.cache_hits, 0, "corrupt cached content is never reused");
  equal(prepared.coverage.invalid_cache, 1, "the corrupt entry is visible in coverage");
  equal(prepared.analysis_queue.length, 1, "the source is queued for rebuilding");
});

test("aggregate counts every valid facet but bounds semantic detail [VAL-MODE-003]", () => {
  const dir = tmpDir("aggregate");
  const preparedFile = path.join(dir, "prepared.json");
  const freshFile = path.join(dir, "fresh.json");
  const cached = Array.from({ length: 4 }, (_, index) => ({
    session_id: `cached-${index}`,
    project_area: index < 3 ? "project-a" : "project-b",
    underlying_goal: `goal ${index}`,
    outcome: index % 2 ? "partially_achieved" : "fully_achieved",
    wins: index === 0 ? [{ text: "worked", evidence_refs: [`cached-${index}:turn:0`] }] : [],
    frictions: [],
    user_instructions: [],
    brief_summary: `cached ${index}`,
    evidence_refs: [`cached-${index}:turn:0`],
  }));
  writeJson(preparedFile, {
    mode: "insights-prepare",
    runtime: "codex",
    window: { days: 30 },
    coverage: {
      discovered: 7,
      in_window: 6,
      eligible: 6,
      excluded: 0,
      excluded_subagents: 0,
      excluded_damaged: 0,
      cache_hits: 4,
      queued: 2,
      deferred: 0,
      invalid_cache: 0,
    },
    cached_facets: cached,
    analysis_queue: [
      { session_id: "fresh-1", ended_at: "2026-07-15T00:00:00.000Z" },
      { session_id: "fresh-2", ended_at: "2026-07-14T00:00:00.000Z" },
    ],
  });
  writeJson(freshFile, [
    validFacet("fresh-1", {
      underlying_goal: "new goal",
      frictions: [{
        owner: "agent",
        text: "friction",
        consequence: "extra work",
        evidence_refs: ["fresh-1:turn:1"],
      }],
      brief_summary: "fresh one",
    }),
    validFacet("fresh-2", {
      underlying_goal: "another goal",
      outcome: "not_achieved",
      brief_summary: "fresh two",
    }),
  ]);
  const r = run(PIPELINE, [
    "aggregate",
    "--prepared", preparedFile,
    "--facet", freshFile,
    "--max-facets", "3",
  ]);
  assert(r.status === 0, `aggregate failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  equal(out.coverage.analyzed, 6, "all cached and fresh facets contribute to coverage");
  equal(out.mechanical.outcome_counts.fully_achieved, 3, "mechanical counts use the full facet set");
  equal(out.representative_facets.length, 3, "semantic detail respects the explicit bound");
  equal(out.representative_count, 3, "the report can disclose the bounded sample");
  assert(out.representative_facets.some((facet) => facet.project_area === "project-b"),
    "the bounded sample preserves a smaller project area before taking more from the dominant area");
  equal(out.coverage.cache_hits, 4, "pre-existing cache reuse remains distinct");
  equal(out.coverage.newly_analyzed, 2, "fresh facets are counted as this-run analysis");
  equal(out.coverage.failed, 0, "every queued descriptor produced a valid facet");
});

test("aggregate reports failed sessions and enforces a serialized semantic budget [VAL-MODE-003]", () => {
  const dir = tmpDir("aggregate-budget");
  const preparedFile = path.join(dir, "prepared.json");
  const freshFile = path.join(dir, "fresh.json");
  writeJson(preparedFile, {
    mode: "insights-prepare",
    runtime: "codex",
    window: { days: 30, started_at: "2026-06-16T00:00:00.000Z", ended_at: "2026-07-16T00:00:00.000Z" },
    coverage: {
      discovered: 3,
      in_window: 3,
      eligible: 3,
      excluded: 0,
      excluded_subagents: 0,
      excluded_damaged: 0,
      cache_hits: 0,
      queued: 3,
      deferred: 0,
      invalid_cache: 0,
    },
    cached_facets: [],
    analysis_queue: [
      { session_id: "fresh-a" },
      { session_id: "fresh-b" },
      { session_id: "failed-c" },
    ],
  });
  writeJson(freshFile, [
    validFacet("fresh-a", { brief_summary: "a".repeat(1200) }),
    validFacet("fresh-b", { brief_summary: "b".repeat(1200) }),
  ]);
  const r = run(PIPELINE, [
    "aggregate",
    "--prepared", preparedFile,
    "--facet", freshFile,
    "--max-facets", "10",
    "--max-bytes", "1800",
  ]);
  assert(r.status === 0, `aggregate budget failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  equal(out.coverage.newly_analyzed, 2, "two queued sessions produced facets");
  equal(out.coverage.failed, 1, "the missing queued facet is reported as failed");
  assert(Buffer.byteLength(JSON.stringify(out.representative_facets)) <= 1800,
    "the semantic sample respects the explicit byte budget");
  equal(out.coverage.semantic_budget_deferred, 1,
    "facets omitted by the byte budget remain visible in coverage");
});

test("compact-evidence bounds each session before Agent dispatch [VAL-MODE-003]", () => {
  const dir = tmpDir("compact-evidence");
  const evidenceFile = path.join(dir, "evidence.json");
  writeJson(evidenceFile, {
    schema_version: 2,
    cli: "codex",
    session: { id: "large" },
    narrative: {
      human_turns: Array.from({ length: 200 }, (_, index) => ({
        summary: `turn ${index} ${"x".repeat(1000)}`,
      })),
    },
    health: { skills: [], tool_failures: [] },
    raw_for_compound: {},
  });
  const r = run(PIPELINE, [
    "compact-evidence",
    "--evidence", evidenceFile,
    "--max-bytes", "12000",
  ]);
  assert(r.status === 0, `compact-evidence failed: ${r.stderr}`);
  const output = JSON.parse(r.stdout);
  assert(Buffer.byteLength(r.stdout) <= 12000, "compacted evidence fits the per-session byte budget");
  assert(output.evidence_truncated === true, "the compacted payload discloses truncation");
});

test("renderer creates both reports without editing template source [VAL-MODE-004]", () => {
  for (const mode of ["single", "insights"]) {
    const dir = tmpDir(`render-${mode}`);
    const dataFile = path.join(dir, "data.json");
    const output = path.join(dir, `${mode}.html`);
    const data = mode === "single"
      ? validSingleReport({ narrative_summary: "Summary with </script> safety" })
      : validInsightsReport();
    writeJson(dataFile, data);
    const aggregateArgs = [];
    if (mode === "insights") {
      const aggregateFile = path.join(dir, "aggregate.json");
      writeJson(aggregateFile, validInsightsAggregate());
      aggregateArgs.push("--aggregate", aggregateFile);
    }
    const r = run(RENDERER, [
      "--mode", mode,
      "--template", path.join(TEMPLATES, mode === "single" ? "single-session.html" : "recent-insights.html"),
      "--data", dataFile,
      ...aggregateArgs,
      "--output", output,
    ]);
    assert(r.status === 0, `${mode} renderer failed: ${r.stderr}`);
    const html = fs.readFileSync(output, "utf8");
    assert(!html.includes("__REPORT_BUNDLE__"), `${mode} output must replace the only data slot`);
    assert(!html.includes("</script> safety"), "captured text must not close the JSON script element");
    assert(html.includes("<script id=\"report-bundle\""), `${mode} output keeps the stable data contract`);
    if (mode === "insights") {
      assert(html.includes('href="#wins"') && html.includes('id="wins"'),
        "the at-a-glance summary must navigate to its supporting section");
      assert(html.includes('id="window-label"') && html.includes('尚未完成内容分析'),
        "the report must disclose the actual window and semantic coverage gap");
    }
  }
});

test("recent report uses natural Chinese labels instead of translated analytics jargon [VAL-MODE-004]", () => {
  const insights = fs.readFileSync(path.join(TEMPLATES, "recent-insights.html"), "utf8");
  for (const label of [
    "近期会话洞察",
    "值得延续",
    "主要问题",
    "优先尝试",
    "长期改进方向",
    "反复出现的问题",
    "报告范围与限制",
    "尝试方式",
    "判断是否有效",
  ]) {
    assert(insights.includes(label), `recent report must use natural Chinese label: ${label}`);
  }
  for (const translated of [
    "Recent session insights",
    "正在奏效",
    "正在阻碍",
    "快速改善",
    "更大胆尝试",
    "反复摩擦",
    "证据边界",
    "试法：",
    "成功信号：",
  ]) {
    assert(!insights.includes(translated), `recent report must remove translated label: ${translated}`);
  }
});

test("recent report keeps raw evidence references traceable but presents a readable session index [VAL-MODE-004]", () => {
  const dir = tmpDir("render-readable-evidence");
  const dataFile = path.join(dir, "data.json");
  const aggregateFile = path.join(dir, "aggregate.json");
  const output = path.join(dir, "insights.html");
  const rawRef = "session-readable:turn:12";
  writeJson(dataFile, validInsightsReport({
    wins: [{ title: "可读证据", text: "保留追溯能力", evidence_refs: [rawRef] }],
  }));
  writeJson(aggregateFile, validInsightsAggregate());
  const rendered = run(RENDERER, [
    "--mode", "insights",
    "--template", path.join(TEMPLATES, "recent-insights.html"),
    "--data", dataFile,
    "--aggregate", aggregateFile,
    "--output", output,
  ]);
  assert(rendered.status === 0, `readable evidence render failed: ${rendered.stderr}`);
  const html = fs.readFileSync(output, "utf8");
  assert(html.includes('"evidence_sessions"') && html.includes("Auriga 工作流升级"),
    "renderer must add deterministic human-readable session metadata");
  assert(html.includes(rawRef), "the exact raw evidence reference must remain in the report bundle");
  assert(html.includes("查看依据") && html.includes("原始编号"),
    "raw references must move behind an explicit evidence disclosure");
  assert(!html.includes("add(heading, 'div', evidence(item), 'meta')"),
    "raw IDs must not remain the default row metadata");
});

test("single report uses readable evidence disclosures instead of exposing raw references [VAL-MODE-004]", () => {
  const single = fs.readFileSync(path.join(TEMPLATES, "single-session.html"), "utf8");
  assert(single.includes("查看依据") && single.includes("原始编号"),
    "single report must put exact evidence references behind an explicit disclosure");
  assert(single.includes("第 ${Number(index) + 1} 轮"),
    "single report must translate turn references into human-readable positions");
  for (const rawRenderer of [
    "(f.evidence_refs || []).join(' · ')",
    "c.evidenceRefs.join(' · ')",
    "(item.evidence_refs || []).join(' · ')",
  ]) {
    assert(!single.includes(rawRenderer), `single report must remove direct raw reference rendering: ${rawRenderer}`);
  }
});

test("both report modes share the natural Chinese writing contract [VAL-MODE-004]", () => {
  const skill = fs.readFileSync(path.join(SKILL_ROOT, "SKILL.md"), "utf8");
  const single = fs.readFileSync(path.join(TEMPLATES, "single-session.html"), "utf8");
  assert(skill.includes("两种报告") && skill.includes("自然、具体的中文"),
    "the core skill must apply natural-language guidance to both report modes");
  for (const label of ["单会话复盘", "总令牌数", "拉取请求", "资源消耗最高的轮次", "技能评估"]) {
    assert(single.includes(label), `single report must use natural Chinese label: ${label}`);
  }
  for (const mixedLabel of ["Session Compound — 单会话复盘", "总 token", "本次会话的 PR", "最贵的 turn", "skill 评估"]) {
    assert(!single.includes(mixedLabel), `single report must remove mixed-language label: ${mixedLabel}`);
  }
});

test("renderer rejects malformed mode data before writing a report [VAL-MODE-004]", () => {
  const dir = tmpDir("render-invalid");
  const dataFile = path.join(dir, "data.json");
  const output = path.join(dir, "invalid.html");
  writeJson(dataFile, { mode: "insights", coverage: "not-an-object" });
  const r = run(RENDERER, [
    "--mode", "insights",
    "--template", path.join(TEMPLATES, "recent-insights.html"),
    "--data", dataFile,
    "--output", output,
  ]);
  assert(r.status !== 0, "malformed structured data must fail before rendering");
  assert(!fs.existsSync(output), "a failed render must not leave a partial report");
});

test("renderer rejects missing coverage fields and unsafe default selections [VAL-MODE-004] [VAL-FLOW-001]", () => {
  const dir = tmpDir("render-strict");
  const cases = [
    validInsightsReport({ coverage: { discovered: 1 } }),
    validSingleReport({
      durable_candidates: [{
        name: "unsafe",
        type: "agent-context",
        text: "must not be preselected",
        why_durable: "explicit",
        default_selected: true,
        evidence_refs: ["turn:1"],
      }],
    }),
  ];
  for (const [index, data] of cases.entries()) {
    const dataFile = path.join(dir, `data-${index}.json`);
    const output = path.join(dir, `output-${index}.html`);
    writeJson(dataFile, data);
    const r = run(RENDERER, [
      "--mode", data.mode,
      "--template", path.join(TEMPLATES, data.mode === "single" ? "single-session.html" : "recent-insights.html"),
      "--data", dataFile,
      "--output", output,
    ]);
    assert(r.status !== 0, "invalid report data must be rejected");
    assert(!fs.existsSync(output), "invalid reports leave no output");
  }
});

test("workspace and rendered reports use private paths and reject symlink outputs [VAL-MODE-004]", () => {
  const workspaceRun = run(PIPELINE, ["workspace"]);
  assert(workspaceRun.status === 0, `workspace creation failed: ${workspaceRun.stderr}`);
  const workspace = workspaceRun.stdout.trim();
  cleanup.push(workspace);
  equal(fs.statSync(workspace).mode & 0o777, 0o700, "the execution workspace is private");

  const dataFile = path.join(workspace, "data.json");
  const aggregateFile = path.join(workspace, "aggregate.json");
  const output = path.join(workspace, "report.html");
  writeJson(dataFile, validInsightsReport());
  writeJson(aggregateFile, validInsightsAggregate());
  const rendered = run(RENDERER, [
    "--mode", "insights",
    "--template", path.join(TEMPLATES, "recent-insights.html"),
    "--data", dataFile,
    "--aggregate", aggregateFile,
    "--output", output,
  ]);
  assert(rendered.status === 0, `private render failed: ${rendered.stderr}`);
  equal(fs.statSync(output).mode & 0o777, 0o600, "reports are private files");

  const symlink = path.join(workspace, "linked.html");
  fs.symlinkSync(output, symlink);
  const rejected = run(RENDERER, [
    "--mode", "insights",
    "--template", path.join(TEMPLATES, "recent-insights.html"),
    "--data", dataFile,
    "--aggregate", aggregateFile,
    "--output", symlink,
  ]);
  assert(rejected.status !== 0, "renderer refuses an existing symlink output");
});

test("report templates expose evidence, coverage, opt-in selection, and keyboard tabs [VAL-MODE-004] [VAL-FLOW-001]", () => {
  const single = fs.readFileSync(path.join(TEMPLATES, "single-session.html"), "utf8");
  const insights = fs.readFileSync(path.join(TEMPLATES, "recent-insights.html"), "utf8");

  assert(single.includes("Content-Security-Policy") && insights.includes("Content-Security-Policy"),
    "both offline reports must restrict active content with CSP");
  assert(/role="tablist"/.test(single) && (single.match(/<button[^>]+role="tab"/g) || []).length === 4,
    "single-session navigation must expose semantic tabs");
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
    assert(single.includes(key), `single-session tabs must handle ${key}`);
  }
  for (const field of ["explicit_count", "inferred_count", "evidence_types", "evidence_nature", "evidence_refs"]) {
    assert(single.includes(field), `single-session report must render ${field}`);
  }
  assert(/selected:\s*false/.test(single), "single-session candidates must initialize unselected");
  assert(single.includes("success_signal") && single.includes("自动复制失败"),
    "single-session report must preserve experiment success signals and visible copy failure");

  for (const field of [
    "eligible", "newly_analyzed", "failed", "queued", "excluded_subagents",
    "excluded_damaged", "invalid_cache", "representative_count", "semantic_budget_deferred",
  ]) {
    assert(insights.includes(`coverage.${field}`), `recent report must render coverage.${field}`);
  }
  assert(insights.includes("#observations") || insights.includes('id="observations"'),
    "recent report must render one-off observations");
  assert(insights.includes("success_signal") && insights.includes("ownerLabel"),
    "recent report must preserve experiment success signals and friction ownership");
  assert(insights.includes('type = \'checkbox\'') && insights.includes("checkbox.checked = false"),
    "recent candidates must be selectable and initialize unselected");
  assert(!insights.includes("$('#coverage-list').innerHTML"),
    "coverage rows must use textContent-backed DOM nodes, not HTML interpolation");
  assert(insights.includes("自动复制失败"), "recent report must expose copy failure to the user");
});

test("dispatch protocols treat session evidence as untrusted and cap semantic inputs [VAL-MODE-003]", () => {
  const skill = fs.readFileSync(path.join(SKILL_ROOT, "SKILL.md"), "utf8");
  const evalDispatch = fs.readFileSync(path.join(SKILL_ROOT, "references", "eval-dispatch.md"), "utf8");
  const facetDispatch = fs.readFileSync(path.join(SKILL_ROOT, "references", "facet-dispatch.md"), "utf8");
  const insightsDispatch = fs.readFileSync(path.join(SKILL_ROOT, "references", "insights-dispatch.md"), "utf8");

  assert(skill.includes("scripts/insights-pipeline.mjs workspace") && skill.includes("umask 077"),
    "every run must start in a private workspace");
  assert(skill.includes("compact-evidence") && skill.includes("65536") && skill.includes("256 KiB"),
    "facet dispatch must have per-session and per-batch byte limits");
  assert(skill.includes("不要在本轮结束前重跑 `prepare`"),
    "the workflow must preserve initial cache provenance");
  assert(skill.includes("当前资产核对") && skill.includes("已吸收 / 部分吸收 / 未吸收 / 未知"),
    "the main workflow must own durable-candidate asset screening");
  assert(skill.includes("不能仅因为缺少核对结果就强制 `durable_candidates` 为空"),
    "missing asset screening must remain visible instead of silently producing zero candidates");
  assert(!skill.includes("references/result-contracts.md"),
    "the always-required result semantics must not be hidden behind an unconditional reference read");
  assert(fs.readFileSync(RENDERER, "utf8").includes("reportValidationError"),
    "the deterministic renderer must enforce the complete report shape");
  for (const [name, text] of [
    ["eval", evalDispatch], ["facet", facetDispatch], ["insights", insightsDispatch],
  ]) {
    assert(/不可信/.test(text), `${name} dispatch must treat transcript content as untrusted data`);
  }
  assert(/禁止 shell、网络、写文件/.test(evalDispatch) && /禁止 shell、网络、写文件/.test(facetDispatch),
    "evidence agents must have explicit tool restrictions");
  assert(/不授予文件、shell、网络或写入工具/.test(insightsDispatch),
    "cross-session synthesis must run without tools");
  assert(/自然、具体的中文/.test(insightsDispatch) && /避免直接翻译英文分析术语/.test(insightsDispatch),
    "cross-session synthesis must produce natural Chinese for human readers");
  assert(/具体做法、问题或改进方向/.test(insightsDispatch),
    "titles must describe concrete behavior instead of stacking abstractions");
});

for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });

let failed = 0;
for (const result of results) {
  if (result.ok) console.log(`  ok  ${result.name}`);
  else {
    failed++;
    console.log(`FAIL  ${result.name}`);
    console.log(`      ${result.err.message}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exit(1);
