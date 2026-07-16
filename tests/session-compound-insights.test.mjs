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
function run(script, args, opts = {}) {
  return spawnSync("node", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...opts.env },
  });
}
function writeCodexSession(root, id, timestamp, extra = []) {
  const file = path.join(root, `rollout-${id}.jsonl`);
  const entries = [
    { timestamp, type: "session_meta", payload: { id, cwd: "/repo" } },
    { timestamp, type: "event_msg", payload: { type: "user_message", message: `task ${id}` } },
    ...extra,
  ];
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(file, `${entries.map((x) => JSON.stringify(x)).join("\n")}\n`);
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
    "--facet-schema-version", "1",
    "--prompt-version", "1",
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
    "--facet-schema-version", "1",
    "--prompt-version", "1",
  ]);
  assert(r.status === 0, `prepare failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  equal(out.coverage.discovered, 2, "the damaged source remains visible in inventory coverage");
  equal(out.coverage.in_window, 2, "mtime keeps an unparseable recent source in the window");
  equal(out.coverage.eligible, 1, "only the healthy source is eligible for semantic analysis");
  equal(out.coverage.excluded, 1, "the damaged source is isolated as excluded");
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
    "--facet-schema-version", "1",
    "--prompt-version", "1",
  ];
  const first = JSON.parse(run(PIPELINE, ["prepare", ...common]).stdout);
  const descriptorFile = path.join(tmpDir("descriptor"), "descriptor.json");
  const facetFile = path.join(tmpDir("facet"), "facet.json");
  writeJson(descriptorFile, first.analysis_queue[0]);
  writeJson(facetFile, {
    session_id: "cached",
    underlying_goal: "test caching",
    outcome: "fully_achieved",
    wins: [],
    frictions: [],
    user_instructions: [],
    brief_summary: "cache test",
    evidence_refs: ["turn:0"],
  });
  const stored = run(PIPELINE, [
    "store",
    "--cache-root", cache,
    "--descriptor", descriptorFile,
    "--facet", facetFile,
    "--facet-schema-version", "1",
    "--prompt-version", "1",
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

  fs.appendFileSync(source, `${JSON.stringify({ timestamp: "2026-07-11T00:00:00.000Z", type: "event_msg", payload: { type: "user_message", message: "changed" } })}\n`);
  const changed = JSON.parse(run(PIPELINE, ["prepare", ...common]).stdout);
  equal(changed.coverage.cache_hits, 0, "changed source invalidates the facet");
  equal(changed.analysis_queue.length, 1, "changed source is queued again");

  const versionChanged = JSON.parse(run(PIPELINE, [
    "prepare", ...common.slice(0, -2), "--prompt-version", "2",
  ]).stdout);
  equal(versionChanged.coverage.cache_hits, 0, "prompt version changes invalidate the facet");
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
    session_id: "private",
    underlying_goal: "keep the cache small",
    outcome: "fully_achieved",
    wins: [],
    frictions: [],
    user_instructions: [],
    brief_summary: "safe summary",
    evidence_refs: ["private:turn:0"],
    transcript: "full raw conversation must not be cached",
  });
  const r = run(PIPELINE, [
    "store",
    "--cache-root", cache,
    "--descriptor", descriptor,
    "--facet", facet,
    "--facet-schema-version", "1",
    "--prompt-version", "1",
  ]);
  assert(r.status !== 0, "unexpected top-level fields must fail validation");
  assert(/unexpected field: transcript/.test(r.stderr), "the failure identifies the unsafe field");
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
    "--facet-schema-version", "1",
    "--prompt-version", "1",
  ];
  const first = JSON.parse(run(PIPELINE, ["prepare", ...common]).stdout);
  const descriptorFile = path.join(tmpDir("corrupt-descriptor"), "descriptor.json");
  const facetFile = path.join(tmpDir("corrupt-facet"), "facet.json");
  writeJson(descriptorFile, first.analysis_queue[0]);
  writeJson(facetFile, {
    session_id: "corrupt-cache",
    underlying_goal: "validate reads",
    outcome: "fully_achieved",
    wins: [],
    frictions: [],
    user_instructions: [],
    brief_summary: "valid before corruption",
    evidence_refs: ["corrupt-cache:turn:0"],
  });
  const stored = JSON.parse(run(PIPELINE, [
    "store",
    "--cache-root", cache,
    "--descriptor", descriptorFile,
    "--facet", facetFile,
    "--facet-schema-version", "1",
    "--prompt-version", "1",
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
    coverage: { discovered: 7, in_window: 6, eligible: 6, excluded: 0, cache_hits: 4, queued: 2, deferred: 0 },
    cached_facets: cached,
    analysis_queue: [],
  });
  writeJson(freshFile, [
    {
      session_id: "fresh-1",
      underlying_goal: "new goal",
      outcome: "fully_achieved",
      wins: [],
      frictions: [{ text: "friction", evidence_refs: ["fresh-1:turn:1"] }],
      user_instructions: [],
      brief_summary: "fresh one",
      evidence_refs: ["fresh-1:turn:0"],
    },
    {
      session_id: "fresh-2",
      underlying_goal: "another goal",
      outcome: "not_achieved",
      wins: [],
      frictions: [],
      user_instructions: [],
      brief_summary: "fresh two",
      evidence_refs: ["fresh-2:turn:0"],
    },
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
});

test("renderer creates both reports without editing template source [VAL-MODE-004]", () => {
  for (const mode of ["single", "insights"]) {
    const dir = tmpDir(`render-${mode}`);
    const dataFile = path.join(dir, "data.json");
    const output = path.join(dir, `${mode}.html`);
    const data = mode === "single"
      ? {
          mode,
          report_data: { cli: "codex", session: { id: "s1" }, narrative: {}, health: {}, raw_for_compound: {} },
          narrative_summary: "Summary with </script> safety",
          anomalies: [],
          eval_findings: [],
          observations: [],
          experiments: [],
          durable_candidates: [],
        }
      : {
          mode,
          window: { days: 30, started_at: "2026-06-16T00:00:00.000Z", ended_at: "2026-07-16T00:00:00.000Z" },
          coverage: { discovered: 3, analyzed: 2, cache_hits: 1, excluded: 1 },
          at_a_glance: { working: "works", hindering: "friction", quick_wins: "try", ambitious: "later" },
          project_areas: [],
          interaction_style: "iterative",
          wins: [],
          frictions: [],
          experiments: [],
          durable_candidates: [],
          evidence_limitations: [],
        };
    writeJson(dataFile, data);
    const r = run(RENDERER, [
      "--mode", mode,
      "--template", path.join(TEMPLATES, mode === "single" ? "single-session.html" : "recent-insights.html"),
      "--data", dataFile,
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
      assert(html.includes('id="window-label"') && html.includes('未做语义分析'),
        "the report must disclose the actual window and semantic coverage gap");
    }
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
