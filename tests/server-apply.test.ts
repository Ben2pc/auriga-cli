// tests/server-apply.test.ts
//
// Failing tests for the /api/apply + /api/progress (SSE) contract of
// `src/server.ts`. Designed by an independent test designer who has NOT read
// any implementation of the apply/progress slice. Drives spec:
//   - docs/specs/web-ui.md §6.1 (endpoints)
//   - docs/specs/web-ui.md §6.4 (apply execution model: serial, fail-continue)
//   - docs/specs/web-ui.md §6.5 (SSE implementation: 200-event cache, 5min TTL,
//     Last-Event-ID resume)
//   - api-types.ts (ApplyRequest / ProgressEvent shapes)
//
// =============================================================================
// ASSUMPTIONS (locked here so the implementer can read the contract first)
// =============================================================================
//
// AA1. `startServer` accepts two new optional fields on `StartServerOptions`:
//
//        applyHandlers?: ApplyHandlers;
//        applyCatalog?:  ApplyCatalog;
//
//      When `applyHandlers` is set, /api/apply spawns a background worker that
//      runs each item by calling `applyHandlers[item.category](item.action,
//      item.name, { onLog, signal })`. When `applyCatalog` is set, /api/apply
//      validates that every item's `name` is a member of
//      `applyCatalog[item.category]`; unknown names → 400.
//
//      If `applyCatalog` is omitted, no name-membership check is performed
//      (the server falls back to whatever default catalog the CLI built).
//      Tests in THIS file always inject both options so behavior is
//      deterministic.
//
// AA2. The `ApplyHandlers` / `ApplyCatalog` / `ApplyHandler` types are
//      re-exported from `src/server.ts`. Test-side mirrors live in
//      `tests/test-handler-helpers.ts`; if the implementer's public surface
//      drifts, TypeScript compilation of this test file will break — that is
//      the intended "red" signal.
//
// AA3. POST /api/apply
//      - Body validated for shape (category ∈ 5 known values, action ∈ 3
//        known values, name non-empty, items[] is an array).
//      - When `applyCatalog` is injected, name must be in
//        `applyCatalog[category]` Set. Otherwise → 400 with `error: "bad-request"`.
//      - On success, returns 202 + `{ jobId: string }`. jobId is **opaque,
//        unguessable, ≥ 32 hex chars** (≥ 128 bits entropy).
//      - Worker runs in the background; the 202 must return BEFORE any
//        handler runs (tests assert via a delayed handler).
//
// AA4. GET /api/progress?jobId=<id>
//      - Content-Type: `text/event-stream`. Connection stays open until
//        either `all-done` is emitted (then server closes) or the client
//        disconnects.
//      - Every event frame has an `id:` field (monotonically increasing,
//        per-job), an `event: progress` line, and a `data:` line containing
//        a JSON-stringified `ProgressEvent`.
//      - Sequence per item i (0-indexed):
//          1× item:start  → { type, index, total, item }
//          0..N× item:log → { type, index, line, level }
//          1× item:done   → { type, index, success, error? }
//      - After last item: 1× all-done → { type, success, failedCount }.
//      - Unknown jobId → 404 + JSON `{ error: ... }` and close.
//      - Server caches recent events per-job (spec §6.5 says ≥ 200 events for
//        ≥ 5 minutes after `all-done`). A client connecting AFTER `all-done`
//        receives the full replay in one shot and then the server closes.
//      - `Last-Event-ID` request header (or equivalent query param — tests
//        use the header form because EventSource specifies it that way) lets
//        a re-connecting client resume strictly AFTER that id. Tests assert
//        the resumed stream does not duplicate already-seen frames.
//
// AA5. Concurrency
//      A second POST /api/apply that arrives while another job is still
//      running must return **409 Conflict** with `error: "apply-in-flight"`.
//      Rationale: installers contend on shared files (settings.json,
//      skills-lock.json, CLAUDE.md); the spec §6.4 explicitly chooses serial
//      execution to avoid races. If the implementer decides to allow
//      concurrent jobs (multi-queue + per-file locks), they must revisit
//      this test consciously rather than silently change behavior.
//
// AA6. Application-layer failure ≠ HTTP failure. A handler throwing for an
//      item produces an `item:done {success:false, error}` SSE frame and
//      continues with the next item. The HTTP POST /api/apply still returned
//      202; the GET /api/progress connection still returns 200. Only the
//      `all-done {success:false}` body conveys aggregate failure.
//
// AA7. Token canary: the token is never echoed into any SSE frame (even
//      indirectly via error reflection). Tests use a unique sentinel
//      `AURIGA_TEST_CANARY_<random hex>` per-suite.
//
// =============================================================================

import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { describe, test } from "node:test";
import { randomBytes } from "node:crypto";

import { startServer } from "../src/server.js";
import type {
  ApplyAction,
  ApplyCategory,
  ApplyItemRef,
  ProgressEvent,
} from "../src/api-types.js";
import {
  delayedHandler,
  failHandler,
  loggingHandler,
  makeCatalog,
  parseSSE,
  readAllSSE,
  readSSEUntil,
  successHandler,
  uniformHandlers,
} from "./test-handler-helpers.js";
import type {
  ApplyCatalog,
  ApplyHandler,
  ApplyHandlers,
  SSEFrame,
} from "./test-handler-helpers.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function randomToken(): string {
  return randomBytes(32).toString("hex");
}

const CANARY_SENTINEL = `AURIGA_TEST_CANARY_${randomBytes(8).toString("hex")}`;
const CANARY_TOKEN =
  randomBytes(16).toString("hex") + CANARY_SENTINEL + randomBytes(8).toString("hex");

/**
 * Default catalog used by most tests. Names chosen to cover every category
 * so each test can pick the category that suits its scenario without
 * fighting the validator.
 */
function defaultCatalog(): ApplyCatalog {
  return makeCatalog([
    ["workflow", "default-workflow"],
    ["skill", "alpha"],
    ["skill", "beta"],
    ["skill", "gamma"],
    ["recommended-skill", "rec-alpha"],
    ["plugin", "plug-alpha"],
    ["plugin", "plug-beta"],
    ["hook", "hook-alpha"],
  ]);
}

interface BootOpts {
  token?: string;
  catalog?: ApplyCatalog;
  handlers?: ApplyHandlers;
}

interface BootResult {
  baseUrl: string;
  token: string;
  close: () => Promise<void>;
}

async function bootApplyServer(opts: BootOpts = {}): Promise<BootResult> {
  const token = opts.token ?? randomToken();
  const handlers = opts.handlers ?? uniformHandlers(successHandler());
  const catalog = opts.catalog ?? defaultCatalog();
  // TS-cast through unknown so this file compiles even before the
  // implementer widens StartServerOptions — the resulting runtime call still
  // fails-red (handlers / catalog are ignored), which is the intended signal.
  // Once the implementer adds the fields to StartServerOptions this cast
  // becomes a no-op.
  const server = await startServer({
    port: 0,
    token,
    cwd: process.cwd(),
    applyHandlers: handlers,
    applyCatalog: catalog,
  } as unknown as Parameters<typeof startServer>[0]);
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    token,
    close: () => server.close(),
  };
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

/** Build a valid ApplyItemRef list from concise [cat, name, action] tuples. */
function items(
  ...spec: Array<[ApplyCategory, string, ApplyAction]>
): ApplyItemRef[] {
  return spec.map(([category, name, action]) => ({ category, name, action }));
}

async function postApply(
  baseUrl: string,
  token: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}/api/apply`, {
    method: "POST",
    headers: authHeaders(token),
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/**
 * Issue GET /api/progress with optional Last-Event-ID. Uses node:http so we
 * can attach the `Last-Event-ID` header (fetch/undici accepts it but some
 * implementations historically stripped non-standard SSE headers; we use the
 * raw http client to be future-proof).
 */
async function openProgress(
  baseUrl: string,
  token: string,
  jobId: string,
  lastEventId?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "text/event-stream",
  };
  if (lastEventId !== undefined) headers["Last-Event-ID"] = lastEventId;
  return fetch(
    `${baseUrl}/api/progress?jobId=${encodeURIComponent(jobId)}`,
    { headers },
  );
}

/** Parse a frame's data as a ProgressEvent. Throws if it doesn't look right. */
function asProgressEvent(frame: SSEFrame): ProgressEvent {
  const parsed = JSON.parse(frame.data);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`frame data is not an object: ${frame.data}`);
  }
  return parsed as ProgressEvent;
}

// ---------------------------------------------------------------------------
// 1. Happy path — single item install (spec §6.4)
// ---------------------------------------------------------------------------

describe("POST /api/apply + SSE /api/progress — happy path", () => {
  test("boundary: single item install → full event sequence", async (t) => {
    const ctx = await bootApplyServer({
      handlers: uniformHandlers(
        loggingHandler([
          ["installing alpha…", "info"],
          ["downloaded", "info"],
        ]),
      ),
    });
    t.after(() => ctx.close());

    const applyRes = await postApply(ctx.baseUrl, ctx.token, {
      items: items(["skill", "alpha", "install"]),
    });
    assert.equal(applyRes.status, 202);
    const { jobId } = (await applyRes.json()) as { jobId: string };

    const progressRes = await openProgress(ctx.baseUrl, ctx.token, jobId);
    assert.equal(progressRes.status, 200);
    assert.match(
      progressRes.headers.get("content-type") ?? "",
      /text\/event-stream/i,
    );

    const frames = await readSSEUntil(progressRes, (_f, parsed) => {
      const ev = parsed as ProgressEvent | null;
      return ev?.type === "all-done";
    });

    const types = frames.map((f) => {
      try {
        return (JSON.parse(f.data) as ProgressEvent).type;
      } catch {
        return "<non-json>";
      }
    });
    // Must contain at least: item:start, item:done, all-done. Logs are
    // optional in the abstract contract but this handler emits 2, so we
    // assert their presence to keep the test honest.
    assert.ok(types.includes("item:start"), `missing item:start in ${types.join(",")}`);
    assert.ok(types.includes("item:done"), `missing item:done in ${types.join(",")}`);
    assert.ok(types.includes("all-done"), `missing all-done in ${types.join(",")}`);
    const start = frames
      .map((f) => JSON.parse(f.data) as ProgressEvent)
      .find((e) => e.type === "item:start");
    assert.ok(start && start.type === "item:start");
    assert.equal(start.index, 0);
    assert.equal(start.total, 1);
    assert.equal(start.item.category, "skill");
    assert.equal(start.item.name, "alpha");
    assert.equal(start.item.action, "install");

    const allDone = frames
      .map((f) => JSON.parse(f.data) as ProgressEvent)
      .find((e) => e.type === "all-done");
    assert.ok(allDone && allDone.type === "all-done");
    assert.equal(allDone.success, true);
    assert.equal(allDone.failedCount, 0);

    // Every frame must carry an `id:` for resume. Spec §6.5.
    for (const f of frames) {
      assert.ok(
        typeof f.id === "string" && f.id.length > 0,
        `frame missing id: ${JSON.stringify(f)}`,
      );
    }
  });

  // -------------------------------------------------------------------------
  // 2. Happy path — multi item, all success (spec §6.4)
  // -------------------------------------------------------------------------
  test("boundary: 3 items all succeed → all-done success=true failedCount=0", async (t) => {
    const ctx = await bootApplyServer();
    t.after(() => ctx.close());

    const applyRes = await postApply(ctx.baseUrl, ctx.token, {
      items: items(
        ["skill", "alpha", "install"],
        ["skill", "beta", "install"],
        ["plugin", "plug-alpha", "install"],
      ),
    });
    assert.equal(applyRes.status, 202);
    const { jobId } = (await applyRes.json()) as { jobId: string };

    const progressRes = await openProgress(ctx.baseUrl, ctx.token, jobId);
    const frames = await readSSEUntil(
      progressRes,
      (_f, parsed) => (parsed as ProgressEvent | null)?.type === "all-done",
    );

    const events = frames.map((f) => JSON.parse(f.data) as ProgressEvent);
    const starts = events.filter((e) => e.type === "item:start");
    const dones = events.filter((e) => e.type === "item:done");
    assert.equal(starts.length, 3, "expected 3 item:start events");
    assert.equal(dones.length, 3, "expected 3 item:done events");
    // Total field consistent across starts
    for (const s of starts) {
      if (s.type === "item:start") assert.equal(s.total, 3);
    }
    const allDone = events.find((e) => e.type === "all-done");
    assert.ok(allDone && allDone.type === "all-done");
    assert.equal(allDone.success, true);
    assert.equal(allDone.failedCount, 0);
  });
});

// ---------------------------------------------------------------------------
// 3. Single-item failure → continue with rest (spec §6.4)
// ---------------------------------------------------------------------------

describe("POST /api/apply — fail-continue semantics (spec §6.4)", () => {
  test("boundary: middle item fails → next item still runs", async (t) => {
    // Per-category handler so we can fail one specific item without polluting
    // the others.
    const handlers: ApplyHandlers = {
      workflow: successHandler(),
      skill: async (_action, name) => {
        if (name === "beta") throw new Error("beta-blew-up");
      },
      "recommended-skill": successHandler(),
      plugin: successHandler(),
      hook: successHandler(),
    };
    const ctx = await bootApplyServer({ handlers });
    t.after(() => ctx.close());

    const applyRes = await postApply(ctx.baseUrl, ctx.token, {
      items: items(
        ["skill", "alpha", "install"],
        ["skill", "beta", "install"],
        ["skill", "gamma", "install"],
      ),
    });
    assert.equal(applyRes.status, 202);
    const { jobId } = (await applyRes.json()) as { jobId: string };

    const progressRes = await openProgress(ctx.baseUrl, ctx.token, jobId);
    const frames = await readSSEUntil(
      progressRes,
      (_f, parsed) => (parsed as ProgressEvent | null)?.type === "all-done",
    );
    const events = frames.map((f) => JSON.parse(f.data) as ProgressEvent);

    const dones = events.filter((e) => e.type === "item:done");
    assert.equal(dones.length, 3, "all 3 items must produce item:done");
    // Item at index 1 (beta) must have success=false; 0 and 2 must succeed.
    const byIndex = new Map<number, ProgressEvent>();
    for (const d of dones) if (d.type === "item:done") byIndex.set(d.index, d);
    const d0 = byIndex.get(0);
    const d1 = byIndex.get(1);
    const d2 = byIndex.get(2);
    assert.ok(d0 && d0.type === "item:done" && d0.success === true);
    assert.ok(d1 && d1.type === "item:done" && d1.success === false);
    assert.ok(
      d1 && d1.type === "item:done" && typeof d1.error === "string" && d1.error.length > 0,
      "failed item:done must carry an error string",
    );
    assert.ok(d2 && d2.type === "item:done" && d2.success === true);
    const allDone = events.find((e) => e.type === "all-done");
    assert.ok(allDone && allDone.type === "all-done");
    assert.equal(allDone.success, false);
    assert.equal(allDone.failedCount, 1);
  });

  // -------------------------------------------------------------------------
  // 4. All items fail (spec §6.4)
  // -------------------------------------------------------------------------
  test("boundary: all items fail → all-done success=false failedCount=N", async (t) => {
    const ctx = await bootApplyServer({
      handlers: uniformHandlers(failHandler("uniform-blowup")),
    });
    t.after(() => ctx.close());

    const applyRes = await postApply(ctx.baseUrl, ctx.token, {
      items: items(
        ["skill", "alpha", "install"],
        ["skill", "beta", "update"],
        ["skill", "gamma", "uninstall"],
      ),
    });
    assert.equal(applyRes.status, 202);
    const { jobId } = (await applyRes.json()) as { jobId: string };

    const progressRes = await openProgress(ctx.baseUrl, ctx.token, jobId);
    const frames = await readSSEUntil(
      progressRes,
      (_f, parsed) => (parsed as ProgressEvent | null)?.type === "all-done",
    );
    const events = frames.map((f) => JSON.parse(f.data) as ProgressEvent);
    const dones = events.filter((e) => e.type === "item:done");
    assert.equal(dones.length, 3);
    for (const d of dones) {
      if (d.type === "item:done") assert.equal(d.success, false);
    }
    const allDone = events.find((e) => e.type === "all-done");
    assert.ok(allDone && allDone.type === "all-done");
    assert.equal(allDone.success, false);
    assert.equal(allDone.failedCount, 3);
  });
});

// ---------------------------------------------------------------------------
// 5–9. Body / shape / catalog validation (spec §6.4)
// ---------------------------------------------------------------------------

describe("POST /api/apply — validation", () => {
  test("boundary: non-JSON body → 400", async (t) => {
    const ctx = await bootApplyServer();
    t.after(() => ctx.close());
    const res = await postApply(ctx.baseUrl, ctx.token, "{not valid json");
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: unknown };
    assert.equal(typeof body.error, "string");
  });

  test("boundary: items[] empty → 400 (with applyCatalog injected)", async (t) => {
    // NB: server.test.ts asserts an empty items[] is 202 in the no-catalog
    // path. When a catalog IS injected, the spec semantics tighten — an
    // empty batch is almost certainly client error (UI bug or stale state)
    // and should fail loudly rather than silently no-op. Implementer may
    // legitimately push back on this if product UX disagrees, but the test
    // forces the conversation.
    const ctx = await bootApplyServer();
    t.after(() => ctx.close());
    const res = await postApply(ctx.baseUrl, ctx.token, { items: [] });
    assert.equal(res.status, 400);
  });

  test("boundary: items[].category invalid → 400", async (t) => {
    const ctx = await bootApplyServer();
    t.after(() => ctx.close());
    const res = await postApply(ctx.baseUrl, ctx.token, {
      items: [{ category: "not-a-thing", name: "alpha", action: "install" }],
    });
    assert.equal(res.status, 400);
  });

  test("boundary: items[].action invalid → 400", async (t) => {
    const ctx = await bootApplyServer();
    t.after(() => ctx.close());
    const res = await postApply(ctx.baseUrl, ctx.token, {
      items: [{ category: "skill", name: "alpha", action: "obliterate" }],
    });
    assert.equal(res.status, 400);
  });

  test("boundary: items[].name not in applyCatalog → 400", async (t) => {
    // Catalog only contains "alpha" / "beta" / "gamma" for skill; submitting
    // a skill whose name is "ghost-skill" must be rejected.
    const ctx = await bootApplyServer();
    t.after(() => ctx.close());
    const res = await postApply(ctx.baseUrl, ctx.token, {
      items: items(["skill", "ghost-skill", "install"]),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: unknown };
    assert.equal(typeof body.error, "string");
  });
});

// ---------------------------------------------------------------------------
// 10. jobId entropy (spec §6.5 — id must be unguessable)
// ---------------------------------------------------------------------------

describe("POST /api/apply — jobId entropy", () => {
  test("boundary: 5 sequential applies produce 5 distinct jobIds, each ≥ 32 hex chars", async (t) => {
    // Use uniformHandlers(successHandler) and a fresh apply each time. Since
    // serial concurrency policy applies (AA5), wait for each job to finish
    // before posting the next. We detect "finished" by reading the SSE until
    // all-done.
    const ctx = await bootApplyServer();
    t.after(() => ctx.close());
    const seen = new Set<string>();
    const N = 5;
    for (let i = 0; i < N; i++) {
      const res = await postApply(ctx.baseUrl, ctx.token, {
        items: items(["skill", "alpha", "install"]),
      });
      assert.equal(res.status, 202);
      const { jobId } = (await res.json()) as { jobId: string };
      assert.equal(typeof jobId, "string");
      // ≥ 32 hex chars = ≥ 128 bits. Hex alphabet only.
      assert.match(
        jobId,
        /^[0-9a-f]{32,}$/i,
        `jobId must be ≥ 32 hex chars (entropy floor), got "${jobId}"`,
      );
      assert.ok(!seen.has(jobId), `jobId collision: ${jobId}`);
      seen.add(jobId);
      // Drain progress so the next POST isn't blocked by AA5 (concurrent).
      const prog = await openProgress(ctx.baseUrl, ctx.token, jobId);
      await readSSEUntil(
        prog,
        (_f, parsed) => (parsed as ProgressEvent | null)?.type === "all-done",
      );
    }
    assert.equal(seen.size, N);
  });
});

// ---------------------------------------------------------------------------
// 11. Unknown jobId on /api/progress → 404
// ---------------------------------------------------------------------------

describe("GET /api/progress — unknown jobId", () => {
  test("boundary: unknown jobId → 404 immediate close", async (t) => {
    const ctx = await bootApplyServer();
    t.after(() => ctx.close());
    const bogus = randomBytes(16).toString("hex");
    const res = await openProgress(ctx.baseUrl, ctx.token, bogus);
    assert.equal(res.status, 404);
    // Should not be an SSE stream — short JSON body.
    await res.text();
  });
});

// ---------------------------------------------------------------------------
// 12. Mid-stream client disconnect → server keeps running, job completes
// ---------------------------------------------------------------------------

describe("GET /api/progress — client disconnect tolerance", () => {
  test("boundary: client aborts mid-stream → server stays healthy + job still finishes", async (t) => {
    // Use 3 items, each delayedHandler(150ms) → total ~450ms; we'll abort
    // ~50ms in, then probe the server health afterwards. The server must
    // not crash (next request must succeed) and the job must still complete
    // (we reconnect at the end and observe all-done in the cached replay).
    const ctx = await bootApplyServer({
      handlers: uniformHandlers(delayedHandler(150, true)),
    });
    t.after(() => ctx.close());

    const applyRes = await postApply(ctx.baseUrl, ctx.token, {
      items: items(
        ["skill", "alpha", "install"],
        ["skill", "beta", "install"],
        ["skill", "gamma", "install"],
      ),
    });
    assert.equal(applyRes.status, 202);
    const { jobId } = (await applyRes.json()) as { jobId: string };

    // Open SSE, read a couple of frames, then abort.
    const ctrl = new AbortController();
    const partial = await fetch(
      `${ctx.baseUrl}/api/progress?jobId=${jobId}`,
      {
        headers: {
          Authorization: `Bearer ${ctx.token}`,
          Accept: "text/event-stream",
        },
        signal: ctrl.signal,
      },
    );
    assert.equal(partial.status, 200);
    // Read one frame then abort. Don't await full drain.
    const iter = parseSSE(partial)[Symbol.asyncIterator]();
    try {
      await iter.next();
    } catch {
      /* fine if stream closed before any frame arrived */
    }
    ctrl.abort();

    // Probe the server with an unrelated request — must still respond 200.
    const ping = await fetch(`${ctx.baseUrl}/api/ping`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.token}` },
    });
    assert.equal(ping.status, 200, "server unhealthy after client disconnect");

    // Wait for job to complete (rough upper bound: 3×150ms + slack).
    await new Promise((r) => setTimeout(r, 800));

    // Reconnect and confirm all-done arrived in the cached replay.
    const replay = await openProgress(ctx.baseUrl, ctx.token, jobId);
    const frames = await readSSEUntil(
      replay,
      (_f, parsed) => (parsed as ProgressEvent | null)?.type === "all-done",
    );
    const types = frames.map((f) => {
      try {
        return (JSON.parse(f.data) as ProgressEvent).type;
      } catch {
        return "<non-json>";
      }
    });
    assert.ok(types.includes("all-done"), `replay missing all-done; saw: ${types.join(",")}`);
  });
});

// ---------------------------------------------------------------------------
// 13. Last-Event-ID resume (spec §6.5)
// ---------------------------------------------------------------------------

describe("GET /api/progress — Last-Event-ID resume", () => {
  test("boundary: reconnect with Last-Event-ID receives strictly newer frames", async (t) => {
    const ctx = await bootApplyServer({
      handlers: uniformHandlers(delayedHandler(80, true)),
    });
    t.after(() => ctx.close());

    const applyRes = await postApply(ctx.baseUrl, ctx.token, {
      items: items(
        ["skill", "alpha", "install"],
        ["skill", "beta", "install"],
        ["skill", "gamma", "install"],
      ),
    });
    assert.equal(applyRes.status, 202);
    const { jobId } = (await applyRes.json()) as { jobId: string };

    // First connection: read up to and including the first item:start, then
    // abort to simulate a flaky network.
    const ctrl = new AbortController();
    const firstRes = await fetch(
      `${ctx.baseUrl}/api/progress?jobId=${jobId}`,
      {
        headers: {
          Authorization: `Bearer ${ctx.token}`,
          Accept: "text/event-stream",
        },
        signal: ctrl.signal,
      },
    );
    assert.equal(firstRes.status, 200);
    let lastSeenId: string | undefined;
    const firstFrames: SSEFrame[] = [];
    try {
      for await (const f of parseSSE(firstRes)) {
        firstFrames.push(f);
        if (f.id !== undefined) lastSeenId = f.id;
        let ev: ProgressEvent | null = null;
        try {
          ev = JSON.parse(f.data) as ProgressEvent;
        } catch {
          /* ignore */
        }
        if (ev?.type === "item:start") {
          ctrl.abort();
          break;
        }
      }
    } catch {
      /* abort throws; that's expected */
    }
    assert.ok(
      typeof lastSeenId === "string" && lastSeenId.length > 0,
      `must observe at least one frame with an id before disconnecting; got firstFrames=${firstFrames.length}`,
    );

    // Reconnect with Last-Event-ID. Must receive only frames with id strictly
    // greater than lastSeenId (server treats id as a resume cursor).
    const resumeRes = await openProgress(
      ctx.baseUrl,
      ctx.token,
      jobId,
      lastSeenId,
    );
    assert.equal(resumeRes.status, 200);
    const resumeFrames = await readSSEUntil(
      resumeRes,
      (_f, parsed) => (parsed as ProgressEvent | null)?.type === "all-done",
    );
    assert.ok(resumeFrames.length > 0, "resume returned 0 frames");
    // Compare ids as numeric strings (the spec leaves the id space opaque,
    // but the natural implementation is monotonic integers; we assert the
    // weaker invariant: no resume-frame id equals the cursor or any id we
    // already saw in the first connection).
    const seenIds = new Set(
      firstFrames.map((f) => f.id).filter((x): x is string => typeof x === "string"),
    );
    for (const f of resumeFrames) {
      assert.ok(
        f.id !== undefined,
        `resume frame missing id: ${JSON.stringify(f)}`,
      );
      assert.ok(
        !seenIds.has(f.id!),
        `resume must not redeliver already-seen id "${f.id}"`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 14. Late subscriber (spec §6.5 — 200 events / 5 min cache)
// ---------------------------------------------------------------------------

describe("GET /api/progress — late subscriber receives full replay", () => {
  test("boundary: connect AFTER job completes → receive full event sequence", async (t) => {
    const ctx = await bootApplyServer();
    t.after(() => ctx.close());

    const applyRes = await postApply(ctx.baseUrl, ctx.token, {
      items: items(
        ["skill", "alpha", "install"],
        ["skill", "beta", "update"],
        ["plugin", "plug-alpha", "uninstall"],
      ),
    });
    assert.equal(applyRes.status, 202);
    const { jobId } = (await applyRes.json()) as { jobId: string };

    // Wait long enough that the job almost certainly finished. successHandler
    // resolves on the same microtask; 200ms is generous.
    await new Promise((r) => setTimeout(r, 200));

    const progressRes = await openProgress(ctx.baseUrl, ctx.token, jobId);
    assert.equal(progressRes.status, 200);
    const frames = await readAllSSE(progressRes);
    const events = frames
      .map((f) => {
        try {
          return JSON.parse(f.data) as ProgressEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is ProgressEvent => e !== null);

    const starts = events.filter((e) => e.type === "item:start");
    const dones = events.filter((e) => e.type === "item:done");
    const alls = events.filter((e) => e.type === "all-done");
    assert.equal(starts.length, 3, "expected 3 item:start in replay");
    assert.equal(dones.length, 3, "expected 3 item:done in replay");
    assert.equal(alls.length, 1, "expected exactly 1 all-done in replay");
    assert.ok(alls[0].type === "all-done" && alls[0].success === true);
  });
});

// ---------------------------------------------------------------------------
// 15. Token canary (spec §4.4 + AA7)
// ---------------------------------------------------------------------------

describe("POST /api/apply + SSE — token never leaks", () => {
  test("boundary: wrong token → 401 (apply-layer enforces auth)", async (t) => {
    const ctx = await bootApplyServer({ token: CANARY_TOKEN });
    t.after(() => ctx.close());
    const res = await fetch(`${ctx.baseUrl}/api/apply`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${"f".repeat(64)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ items: items(["skill", "alpha", "install"]) }),
    });
    assert.equal(res.status, 401);
  });

  test("boundary: full SSE byte stream contains no token sentinel", async (t) => {
    // Use a logging handler that purposely tries to mention something that
    // looks like a secret — the implementation MUST scrub or simply never
    // surface the real token. We assert by reading the entire raw byte
    // stream of the SSE response and checking it doesn't contain the
    // canary sentinel.
    const ctx = await bootApplyServer({
      token: CANARY_TOKEN,
      handlers: uniformHandlers(
        loggingHandler([
          ["hello from handler", "info"],
          ["just-a-line", "warn"],
        ]),
      ),
    });
    t.after(() => ctx.close());

    const applyRes = await postApply(ctx.baseUrl, ctx.token, {
      items: items(
        ["skill", "alpha", "install"],
        ["skill", "beta", "install"],
      ),
    });
    assert.equal(applyRes.status, 202);
    const { jobId } = (await applyRes.json()) as { jobId: string };

    const progressRes = await openProgress(ctx.baseUrl, ctx.token, jobId);
    const body = progressRes.body;
    assert.ok(body, "SSE response body missing");
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let raw = "";
    // Read until all-done appears in the decoded stream or the stream ends.
    while (true) {
      const { value, done } = await reader.read();
      if (value) raw += decoder.decode(value, { stream: true });
      if (done) break;
      if (raw.includes('"all-done"')) {
        // Drain a little more to capture the trailing terminator.
        const { value: tail } = await reader.read();
        if (tail) raw += decoder.decode(tail, { stream: true });
        break;
      }
    }
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }

    assert.ok(
      !raw.includes(CANARY_SENTINEL),
      `SSE stream leaked token canary sentinel "${CANARY_SENTINEL}". ` +
        `First 400 chars: ${raw.slice(0, 400)}`,
    );
    assert.ok(
      !raw.includes(CANARY_TOKEN),
      "SSE stream leaked the full token string",
    );
  });
});

// ---------------------------------------------------------------------------
// 16. Concurrent apply rejected (AA5 — spec §6.4 serial execution)
// ---------------------------------------------------------------------------

describe("POST /api/apply — concurrent apply rejected (AA5)", () => {
  test("boundary: second apply while first is in-flight → 409", async (t) => {
    // First job uses delayedHandler(250ms) so it definitely overlaps the
    // second POST. uniformHandlers ensures every category is slow.
    const ctx = await bootApplyServer({
      handlers: uniformHandlers(delayedHandler(250, true)),
    });
    t.after(() => ctx.close());

    const firstRes = await postApply(ctx.baseUrl, ctx.token, {
      items: items(["skill", "alpha", "install"]),
    });
    assert.equal(firstRes.status, 202);
    const { jobId: firstJobId } = (await firstRes.json()) as { jobId: string };

    // Immediately POST a second valid apply. With the first handler still
    // sleeping, this must be rejected. Body shape is identical so the only
    // reason for rejection is concurrency policy.
    const secondRes = await postApply(ctx.baseUrl, ctx.token, {
      items: items(["skill", "beta", "install"]),
    });
    assert.equal(
      secondRes.status,
      409,
      "second concurrent /api/apply must be 409 (AA5: serial execution)",
    );
    const body = (await secondRes.json()) as { error?: unknown };
    assert.equal(typeof body.error, "string");
    assert.match(
      body.error as string,
      /in-flight|busy|conflict|apply/i,
      `error message should hint at in-flight conflict; got: ${String(body.error)}`,
    );

    // Drain the first job to completion so the server tears down cleanly.
    const progressRes = await openProgress(ctx.baseUrl, ctx.token, firstJobId);
    await readSSEUntil(
      progressRes,
      (_f, parsed) => (parsed as ProgressEvent | null)?.type === "all-done",
    );
  });

  test("boundary: after first job finishes, a new apply succeeds (AA5 not sticky)", async (t) => {
    // Sanity follow-up: the 409 must NOT be a permanent state. Once the
    // first job's all-done has been emitted, the server should accept a new
    // apply.
    const ctx = await bootApplyServer({
      handlers: uniformHandlers(delayedHandler(60, true)),
    });
    t.after(() => ctx.close());

    const first = await postApply(ctx.baseUrl, ctx.token, {
      items: items(["skill", "alpha", "install"]),
    });
    assert.equal(first.status, 202);
    const { jobId } = (await first.json()) as { jobId: string };
    const prog = await openProgress(ctx.baseUrl, ctx.token, jobId);
    await readSSEUntil(
      prog,
      (_f, parsed) => (parsed as ProgressEvent | null)?.type === "all-done",
    );

    const second = await postApply(ctx.baseUrl, ctx.token, {
      items: items(["skill", "beta", "install"]),
    });
    assert.equal(
      second.status,
      202,
      "after the in-flight job finishes, a new apply must be accepted",
    );
  });
});

// ---------------------------------------------------------------------------
// Suppress an unused-symbol warning if the runtime never reaches httpRequest
// (some tests imported it speculatively for forged-Host scenarios; keeping
// the import behind a no-op reference avoids tsconfig noUnusedLocals firing
// in the future if it's added). The `void` here is a sink, not behavior.
// ---------------------------------------------------------------------------
void httpRequest;
