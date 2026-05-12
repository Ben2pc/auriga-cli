// HTTP server for the Web UI (`auriga-cli web-ui`).
//
// Responsibilities: token + Origin auth, /api/state scanner endpoint,
// /api/apply (202 + SSE-progress), /api/progress (SSE with Last-Event-ID
// resume + 200-event ring buffer), /api/shutdown (graceful drain), and
// static asset serve from the extracted UI bundle dir.
//
// Public contract is anchored in docs/architecture/web-ui.md §4 (server
// surface), §6 (data flow + types), §7 (errors).

export type LogLevel = "info" | "warn" | "error";

export interface ApplyHandlerOptions {
  onLog: (line: string, level: LogLevel) => void;
  /** Installer scope from the ApplyItemRef. Forwarded as-is — handlers
   *  translate into the per-installer flag (`--scope project|user`). The
   *  workflow handler ignores it (workflow has no scope concept). */
  scope?: "project" | "user";
  /** Workflow CLAUDE.md language variant. Only meaningful for the workflow
   *  handler; other handlers ignore it. Omitted = "en". */
  lang?: "en" | "zh-CN";
}

export type ApplyHandler = (
  action: ApplyAction,
  name: string,
  opts: ApplyHandlerOptions,
) => Promise<void>;

export interface ApplyHandlers {
  workflow: ApplyHandler;
  skill: ApplyHandler;
  "recommended-skill": ApplyHandler;
  plugin: ApplyHandler;
  hook: ApplyHandler;
}

export interface ApplyCatalog {
  workflow: Set<string>;
  skill: Set<string>;
  "recommended-skill": Set<string>;
  plugin: Set<string>;
  hook: Set<string>;
}

export interface StartServerOptions {
  port?: number;
  token: string;
  cwd: string;
  /** Where auriga-cli itself lives — source of dist/catalog.json,
   *  skills-lock.json, hook payloads, etc. Defaults to cwd, which is
   *  correct when running tests from the auriga-cli checkout. CLI mode
   *  must pass getPackageRoot() so the server uses the installed package
   *  rather than the user's project. */
  packageRoot?: string;
  /** Idle-shutdown timeout in ms. The browser POSTs /api/ping every 5s;
   *  if no ping arrives for this duration, the server shuts down
   *  gracefully (closing-browser-closes-server UX). `0` disables the
   *  heartbeat (used by tests so a single suite doesn't time-bomb). */
  heartbeatTimeoutMs?: number;
  /** Apply handlers per category. When omitted, /api/apply falls back to
   *  built-in installers wired by the CLI. Tests inject mocks to make apply
   *  behavior deterministic without touching real installers. */
  applyHandlers?: ApplyHandlers;
  /** Per-category name whitelist. When set, /api/apply rejects (400) any
   *  item whose name is not present in the matching category's Set. When
   *  omitted, name membership is not enforced (CLI builds a default
   *  catalog at boot time). */
  applyCatalog?: ApplyCatalog;
  /** Directory whose contents are served for non-/api paths (the extracted
   *  UI bundle). When undefined, every static path returns 404 — useful in
   *  tests and the M1 server smoke checks. */
  uiDir?: string;
  /** Max time to wait for an in-flight job during graceful shutdown before
   *  force-closing sockets (spec §4.3 / §6.6). Defaults to 30000 ms in
   *  production; tests override to a small value (e.g. 200 ms) so they
   *  don't time-bomb. */
  shutdownGraceMs?: number;
}

export interface RunningServer {
  port: number;
  /** Explicit shutdown. Idempotent. */
  close(): Promise<void>;
  /** Resolves when the server has fully stopped — either via close() or the
   *  heartbeat-driven shutdown. CLI callers await this to block their event
   *  loop until "browser was closed" actually fires. */
  closed: Promise<void>;
}

import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { Buffer } from "node:buffer";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ApplyAction, ApplyItemRef, ApplyRequest, ProgressEvent } from "./api-types.js";
import { buildScanCatalog } from "./scan-catalog.js";
import { scanState } from "./state.js";

// Body parsing cap. /api/apply payloads are tiny (an array of item refs);
// 1 MiB is generously above the largest realistic batch and small enough that
// abusive clients can't pin memory.
const MAX_JSON_BODY = 1 * 1024 * 1024;

// SSE replay cache: keep at least 200 events per job for at least 5 minutes
// after the job's `all-done` event so reconnecting clients can resume
// (spec §6.5).
const SSE_BUFFER_CAP = 200;
const SSE_JOB_TTL_MS = 5 * 60 * 1000;

interface BufferedEvent {
  /** Monotonically increasing per-job event id, used by Last-Event-ID resume.
   *  Stringified base-10 integer so it sorts numerically when needed. */
  id: string;
  event: ProgressEvent;
}

interface JobState {
  jobId: string;
  /** Ring buffer of recent events. Length ≤ SSE_BUFFER_CAP. */
  events: BufferedEvent[];
  /** Next id to assign. First emitted event gets id "1". */
  nextId: number;
  /** True once `all-done` has been emitted. After this, the job state is kept
   *  in the cache for SSE_JOB_TTL_MS to serve late subscribers, then deleted. */
  finished: boolean;
  /** Live SSE connections subscribed to this job. */
  subscribers: Set<ServerResponse>;
  /** Cleanup timer scheduled when the job finishes. */
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// Generic error helpers — bodies are byte-identical for matching status codes
// so probers can't distinguish *why* auth failed (spec §7 anti-probing).
// ---------------------------------------------------------------------------

const UNAUTHORIZED_BODY = JSON.stringify({ error: "unauthorized" });
const FORBIDDEN_BODY = JSON.stringify({ error: "forbidden" });

function sendJson(
  res: ServerResponse,
  status: number,
  body: string | object,
): void {
  if (res.headersSent || res.writableEnded) return;
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(payload);
}

function sendUnauthorized(res: ServerResponse): void {
  sendJson(res, 401, UNAUTHORIZED_BODY);
}

function sendForbidden(res: ServerResponse): void {
  sendJson(res, 403, FORBIDDEN_BODY);
}

function send404(res: ServerResponse): void {
  // Generic 404 for unknown routes / missing static assets. Body is JSON for
  // consistency with the other error surfaces; tests only assert the status.
  sendJson(res, 404, { error: "not-found" });
}

// ---------------------------------------------------------------------------
// Token: timing-safe constant-time compare on equal-length byte buffers.
// Returns false fast on length mismatch (length is not secret).
// ---------------------------------------------------------------------------

function tokensEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  if (a.length === 0) return false;
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // Buffer.from on a string always returns a buffer of byte-length matching
  // utf8 encoding; for our hex token shape, byte length == char length, but
  // even with multibyte inputs the length check above + the equal-length
  // guard below keep this safe.
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Extracts token from Authorization header. Returns null if not a well-formed
// `Bearer <value>` (single space, non-empty value). Strict by design — spec
// A3 says the canonical shape is "Bearer <token>".
function parseBearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  // Reject any internal whitespace beyond the single delimiter between scheme
  // and value. `Bearer  token` (double space) → reject.
  const m = /^Bearer ([^\s]+)$/.exec(authHeader);
  if (!m) return null;
  return m[1] ?? null;
}

// Extracts ?token=... from the URL search string. URL is parsed against a
// dummy base so we can reuse the WHATWG parser without needing the real host.
function parseQueryToken(reqUrl: string | undefined): string | null {
  if (!reqUrl) return null;
  try {
    const u = new URL(reqUrl, "http://localhost");
    const t = u.searchParams.get("token");
    return t === null || t === "" ? null : t;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Host / Origin whitelist.
// ---------------------------------------------------------------------------

function buildAllowedHosts(port: number): Set<string> {
  // Stored lowercased; comparisons normalize the incoming header the same way.
  return new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
  ]);
}

function isHostAllowed(
  hostHeader: string | undefined,
  allowed: Set<string>,
): boolean {
  if (!hostHeader) {
    // HTTP/1.1 requires Host; if absent, treat as bad. (HTTP/1.0 callers don't
    // exist in this app's threat model.)
    return false;
  }
  return allowed.has(hostHeader.toLowerCase());
}

function isOriginAllowed(
  originHeader: string | undefined,
  allowed: Set<string>,
): boolean {
  if (originHeader === undefined) return true; // missing Origin = programmatic / file://
  if (originHeader === "null") return true; // file:// origin sends "null"
  // Strip scheme. Only http://host:port is allowed (no https on loopback).
  const m = /^https?:\/\/(.+)$/i.exec(originHeader);
  if (!m) return false;
  return allowed.has(m[1].toLowerCase());
}

// ---------------------------------------------------------------------------
// Request URL: parse path + search without depending on host header (which
// may be hostile — Host is validated separately).
// ---------------------------------------------------------------------------

function parseRequestUrl(reqUrl: string | undefined): {
  pathname: string;
  searchParams: URLSearchParams;
} {
  if (!reqUrl) return { pathname: "/", searchParams: new URLSearchParams() };
  const u = new URL(reqUrl, "http://localhost");
  return { pathname: u.pathname, searchParams: u.searchParams };
}

// ---------------------------------------------------------------------------
// Body reader with a hard cap so malicious clients can't OOM the server by
// streaming forever. Resolves with the buffered string or rejects.
// ---------------------------------------------------------------------------

function readJsonBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_JSON_BODY) {
        reject(new Error("body-too-large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// ApplyRequest body validation. Returns null if invalid. Validates only the
// shape we promise to consumers — Slice C / the apply runner may add deeper
// checks (e.g. name ∈ catalog) later.
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = new Set([
  "workflow",
  "skill",
  "recommended-skill",
  "plugin",
  "hook",
]);
const VALID_ACTIONS = new Set(["install", "update", "uninstall"]);
const VALID_SCOPES = new Set(["project", "user"]);
const VALID_LANGS = new Set(["en", "zh-CN"]);

function parseApplyRequest(raw: string): ApplyRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const items = (parsed as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  for (const it of items) {
    if (!it || typeof it !== "object") return null;
    const { category, name, action, scope, lang } = it as Record<
      string,
      unknown
    >;
    if (typeof category !== "string" || !VALID_CATEGORIES.has(category)) {
      return null;
    }
    if (typeof name !== "string" || name.length === 0) return null;
    if (typeof action !== "string" || !VALID_ACTIONS.has(action)) return null;
    // Scope is optional. When present it must be a known value AND must not
    // be paired with `category === "workflow"` (workflow is a single root
    // file with no scope concept).
    if (scope !== undefined) {
      if (typeof scope !== "string" || !VALID_SCOPES.has(scope)) return null;
      if (category === "workflow") return null;
    }
    // Lang is optional and only meaningful for category="workflow". Any
    // other pairing is a client bug and we reject loudly.
    if (lang !== undefined) {
      if (typeof lang !== "string" || !VALID_LANGS.has(lang)) return null;
      if (category !== "workflow") return null;
    }
  }
  return parsed as ApplyRequest;
}

function namesInCatalog(items: ApplyItemRef[], catalog: ApplyCatalog): boolean {
  for (const it of items) {
    const set = catalog[it.category];
    if (!set || !set.has(it.name)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Static asset handler. When `uiDir` is configured, we serve files from
// there with SPA fallback (any unknown path → index.html). When not
// configured (tests, no-bundle environments), every request returns 404.
// ---------------------------------------------------------------------------

const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

async function handleStatic(
  pathname: string,
  uiDir: string | undefined,
  res: ServerResponse,
): Promise<void> {
  if (!uiDir) {
    send404(res);
    return;
  }
  // Strip leading `/`. Path traversal defense: resolve and verify the
  // result stays inside uiDir.
  const requested = pathname.replace(/^\/+/, "");
  const target = requested === "" ? "index.html" : requested;
  const resolved = path.resolve(uiDir, target);
  const uiDirResolved = path.resolve(uiDir);
  const isInside =
    resolved === uiDirResolved ||
    resolved.startsWith(uiDirResolved + path.sep);
  if (!isInside) {
    send404(res);
    return;
  }
  try {
    const content = await readFile(resolved);
    sendFile(res, resolved, content);
    return;
  } catch {
    // SPA fallback: serve index.html for unknown paths (excluding asset-like
    // extensions). This keeps client-side routing usable without 404 noise.
    if (!/\.[a-z0-9]+$/i.test(target)) {
      try {
        const index = await readFile(path.join(uiDirResolved, "index.html"));
        sendFile(res, "index.html", index);
        return;
      } catch {
        /* fall through to 404 */
      }
    }
    send404(res);
  }
}

function sendFile(res: ServerResponse, filePath: string, body: Buffer): void {
  if (res.headersSent || res.writableEnded) return;
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_BY_EXT[ext] ?? "application/octet-stream";
  res.statusCode = 200;
  res.setHeader("content-type", type);
  res.setHeader("cache-control", "no-store");
  res.end(body);
}

// ---------------------------------------------------------------------------
// startServer
// ---------------------------------------------------------------------------

export async function startServer(
  opts: StartServerOptions,
): Promise<RunningServer> {
  // Lifecycle flags. Mutated only by the close path.
  let closing = false;
  // Track open sockets so close() can forcibly tear down idle keep-alive
  // connections (Node's `server.close` only stops accepting; it waits for
  // open sockets indefinitely otherwise).
  const openSockets = new Set<Socket>();
  // Heartbeat state. `lastPingAt` is bumped on each POST /api/ping. The
  // interval fires periodically and triggers shutdown if too much time
  // has passed without a ping — implementing "closing the browser closes
  // the server" UX.
  let lastPingAt = Date.now();
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // Per-instance helpers that need the port (chosen after listen()).
  let allowedHosts: Set<string>;

  // ---- Apply / SSE state ----
  // Job cache. Keyed by jobId; entries are deleted SSE_JOB_TTL_MS after the
  // job finishes. Late subscribers and Last-Event-ID resume both read from
  // here. `currentJobId` enforces serial execution: a second /api/apply that
  // arrives while another job is in-flight returns 409 (spec §6.4 — installers
  // contend on shared files like settings.json + skills-lock.json).
  const jobs = new Map<string, JobState>();
  let currentJobId: string | null = null;

  function emit(job: JobState, event: ProgressEvent): void {
    const id = String(job.nextId);
    job.nextId++;
    job.events.push({ id, event });
    if (job.events.length > SSE_BUFFER_CAP) job.events.shift();

    const frame = `id: ${id}\nevent: progress\ndata: ${JSON.stringify(event)}\n\n`;
    for (const sub of job.subscribers) {
      try {
        if (!sub.writableEnded) sub.write(frame);
      } catch {
        /* subscriber went away mid-write — close listener will remove it */
      }
    }

    if (event.type === "all-done") {
      job.finished = true;
      // Close all live subscribers — they've received the terminal event.
      for (const sub of job.subscribers) {
        try {
          if (!sub.writableEnded) sub.end();
        } catch {
          /* ignore */
        }
      }
      job.subscribers.clear();
      // Schedule cache eviction. .unref() so we don't keep the process alive.
      job.cleanupTimer = setTimeout(() => {
        jobs.delete(job.jobId);
      }, SSE_JOB_TTL_MS);
      job.cleanupTimer.unref?.();
    }
  }

  async function runApplyJob(
    job: JobState,
    items: ApplyItemRef[],
    handlers: ApplyHandlers,
  ): Promise<void> {
    let failedCount = 0;
    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        emit(job, {
          type: "item:start",
          index: i,
          total: items.length,
          item,
        });
        const handler = handlers[item.category];
        try {
          await handler(item.action, item.name, {
            onLog: (line, level) =>
              emit(job, { type: "item:log", index: i, line, level }),
            scope: item.scope,
            lang: item.lang,
          });
          emit(job, { type: "item:done", index: i, success: true });
        } catch (err) {
          failedCount++;
          const msg =
            err instanceof Error && err.message ? err.message : "handler-failed";
          emit(job, {
            type: "item:done",
            index: i,
            success: false,
            error: msg,
          });
        }
      }
    } finally {
      // Clear the in-flight slot BEFORE emitting all-done so a client that
      // reacts immediately to the terminal frame can submit a new apply
      // without racing (test "after first job finishes, new apply succeeds").
      if (currentJobId === job.jobId) currentJobId = null;
      emit(job, {
        type: "all-done",
        success: failedCount === 0,
        failedCount,
      });
    }
  }

  async function handleApply(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // 1. Concurrency: serial execution per spec §6.4.
    if (currentJobId !== null) {
      sendJson(res, 409, { error: "apply-in-flight" });
      return;
    }

    // 2. Body cap + JSON parse + shape validation.
    let raw: string;
    try {
      raw = await readJsonBody(req);
    } catch {
      sendJson(res, 413, { error: "body-too-large" });
      return;
    }
    const parsed = parseApplyRequest(raw);
    if (parsed === null) {
      sendJson(res, 400, { error: "bad-request" });
      return;
    }

    // 3. Catalog membership (only when an applyCatalog was injected).
    if (opts.applyCatalog) {
      if (parsed.items.length === 0) {
        sendJson(res, 400, { error: "items-empty" });
        return;
      }
      if (!namesInCatalog(parsed.items, opts.applyCatalog)) {
        sendJson(res, 400, { error: "unknown-name" });
        return;
      }
    }

    // 4. Allocate job. randomBytes(16) → 32 hex chars = 128 bits of entropy.
    const jobId = randomBytes(16).toString("hex");
    const job: JobState = {
      jobId,
      events: [],
      nextId: 1,
      finished: false,
      subscribers: new Set(),
    };
    jobs.set(jobId, job);
    currentJobId = jobId;

    // 5. Accept fast — 202 returns BEFORE any handler runs.
    sendJson(res, 202, { jobId });

    // 6. Kick off the worker on the next tick so the response flushes first.
    const handlers = opts.applyHandlers ?? defaultHandlersNotConfigured;
    setImmediate(() => {
      void runApplyJob(job, parsed.items, handlers);
    });
  }

  function handleProgress(
    req: IncomingMessage,
    searchParams: URLSearchParams,
    res: ServerResponse,
  ): void {
    const jobId = searchParams.get("jobId");
    if (!jobId) {
      sendJson(res, 400, { error: "missing-jobId" });
      return;
    }
    const job = jobs.get(jobId);
    if (!job) {
      sendJson(res, 404, { error: "unknown-job" });
      return;
    }

    // Parse Last-Event-ID. If valid numeric, replay buffered events with
    // id strictly greater than the cursor. Otherwise replay everything in
    // the buffer. EventSource spec sends the value verbatim from the last
    // observed `id:` field.
    const lastEventIdHeader = req.headers["last-event-id"];
    let cursor = -1;
    if (typeof lastEventIdHeader === "string" && lastEventIdHeader.length > 0) {
      const parsedCursor = Number.parseInt(lastEventIdHeader, 10);
      if (Number.isFinite(parsedCursor)) cursor = parsedCursor;
    }

    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders?.();

    // Replay strictly-newer cached events.
    for (const buffered of job.events) {
      const bid = Number.parseInt(buffered.id, 10);
      if (Number.isFinite(bid) && bid <= cursor) continue;
      res.write(
        `id: ${buffered.id}\nevent: progress\ndata: ${JSON.stringify(buffered.event)}\n\n`,
      );
    }

    if (job.finished) {
      // No more events will arrive; close cleanly so late subscribers and
      // resumers don't hold the socket forever.
      res.end();
      return;
    }

    // Subscribe for live events. Detach on client disconnect.
    job.subscribers.add(res);
    const detach = (): void => {
      job.subscribers.delete(res);
    };
    req.once("close", detach);
    res.once("close", detach);
  }

  const server: Server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (err) {
      // Last-resort safety net. Never echo error details — they may contain
      // upstream library messages we don't control.
      if (!res.headersSent && !res.writableEnded) {
        sendJson(res, 500, { error: "internal" });
      }
      // Log to stderr without surfacing token-bearing context (req.url may
      // include ?token=, so don't print it).
      const safeMsg =
        err instanceof Error ? err.message.replace(/token=[^&\s]*/gi, "token=***") : String(err);
      // eslint-disable-next-line no-console
      console.error(`[server] handler error: ${safeMsg}`);
    }
  });

  server.on("connection", (socket) => {
    openSockets.add(socket);
    socket.once("close", () => openSockets.delete(socket));
  });

  async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const { pathname, searchParams } = parseRequestUrl(req.url);
    const hostHeader = req.headers.host;
    const originHeader = req.headers.origin;

    // 1. Host whitelist (DNS-rebinding defense) — applies to ALL paths, even
    //    public statics. Without this, an attacker could lure the user to a
    //    rebinding-controlled domain and pull JS off `/`.
    if (!isHostAllowed(hostHeader, allowedHosts)) {
      sendForbidden(res);
      return;
    }

    // 2. Origin whitelist — also applies to all paths.
    if (!isOriginAllowed(originHeader, allowedHosts)) {
      sendForbidden(res);
      return;
    }

    const isApiPath = pathname.startsWith("/api/");

    // 3. Token (only on /api/*). Static paths are public per spec §6.1.
    if (isApiPath) {
      const headerToken = parseBearer(req.headers.authorization);
      const queryToken = parseQueryToken(req.url);

      // If BOTH sources present, they must agree (defense against smuggling
      // ambiguity per A6).
      if (headerToken !== null && queryToken !== null) {
        if (!tokensEqual(headerToken, queryToken)) {
          sendUnauthorized(res);
          return;
        }
      }
      const presented = headerToken ?? queryToken;
      if (presented === null) {
        sendUnauthorized(res);
        return;
      }
      if (!tokensEqual(presented, opts.token)) {
        sendUnauthorized(res);
        return;
      }
    }

    // 4. Routing.
    const method = req.method ?? "GET";

    if (!isApiPath) {
      await handleStatic(pathname, opts.uiDir, res);
      return;
    }

    if (closing && pathname !== "/api/shutdown") {
      // After shutdown is initiated, refuse further work cleanly.
      sendJson(res, 503, { error: "shutting-down" });
      return;
    }

    if (pathname === "/api/catalog" && method === "GET") {
      await routeCatalog(opts.cwd, res);
      return;
    }
    if (pathname === "/api/state" && method === "GET") {
      await routeState(opts.cwd, opts.packageRoot ?? opts.cwd, res);
      return;
    }
    if (pathname === "/api/apply" && method === "POST") {
      await handleApply(req, res);
      return;
    }
    if (pathname === "/api/progress" && method === "GET") {
      handleProgress(req, searchParams, res);
      return;
    }
    if (pathname === "/api/ping" && method === "POST") {
      lastPingAt = Date.now();
      sendJson(res, 200, { ok: true });
      return;
    }
    if (pathname === "/api/shutdown" && method === "POST") {
      sendJson(res, 200, { ok: true });
      // Defer the actual teardown so the response can flush.
      closing = true;
      setImmediate(() => {
        void initiateShutdown();
      });
      return;
    }

    send404(res);
  }

  async function initiateShutdown(): Promise<void> {
    closing = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    // Spec §4.3 / §6.6 — graceful shutdown waits for the in-flight job up to
    // `shutdownGraceMs` (default 30s). Items continue to drive SSE events
    // through to all-done; new /api/apply is already blocked by `closing`.
    const graceMs = opts.shutdownGraceMs ?? 30_000;
    if (currentJobId !== null && graceMs > 0) {
      await new Promise<void>((resolve) => {
        const start = Date.now();
        const timer = setInterval(() => {
          if (currentJobId === null || Date.now() - start >= graceMs) {
            clearInterval(timer);
            resolve();
          }
        }, 50);
        timer.unref?.();
      });
    }
    // Stop accepting new connections.
    server.close();
    // Force-close open keep-alive sockets so close() can resolve promptly.
    for (const s of openSockets) {
      s.destroy();
    }
    openSockets.clear();
  }

  // Listen.
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(opts.port ?? 0, "127.0.0.1");
  });

  const address = server.address() as AddressInfo | null;
  const port = address?.port ?? opts.port ?? 0;
  allowedHosts = buildAllowedHosts(port);

  // Start heartbeat if enabled. Interval is half the timeout so the worst-
  // case detection latency is ≤ timeout + interval. `.unref()` keeps Node
  // from hanging waiting on this timer if the user kills the process.
  const heartbeatMs = opts.heartbeatTimeoutMs ?? 0;
  if (heartbeatMs > 0) {
    const interval = Math.max(1000, Math.floor(heartbeatMs / 3));
    heartbeatTimer = setInterval(() => {
      if (closing) return;
      if (Date.now() - lastPingAt > heartbeatMs) {
        void initiateShutdown();
      }
    }, interval);
    heartbeatTimer.unref();
  }

  // Tracks "fully stopped" — resolved by Node's http server `close` event,
  // which fires on either the explicit close() path or the heartbeat-driven
  // initiateShutdown() path.
  const closed = new Promise<void>((resolve) => {
    server.once("close", () => resolve());
  });

  return {
    port,
    close: async () => {
      closing = true;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      // Synchronously break all open sockets so close() resolves quickly
      // (otherwise keep-alive idle conns would block until their timeout).
      for (const s of openSockets) {
        s.destroy();
      }
      openSockets.clear();
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      } catch (err) {
        // `Server.close()` rejects when the server isn't running — happens
        // when the heartbeat path already shut things down. Treat as success.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/not running|not listening/i.test(msg)) throw err;
      }
      await closed;
    },
    closed,
  };
}

// ---------------------------------------------------------------------------
// Route: GET /api/state
// ---------------------------------------------------------------------------

async function routeState(
  cwd: string,
  packageRoot: string,
  res: ServerResponse,
): Promise<void> {
  try {
    const catalog = await buildScanCatalog(packageRoot);
    const report = await scanState(cwd, catalog);
    sendJson(res, 200, report);
  } catch {
    // Catalog or scan blew up — return a structured 500 so the UI can show
    // a recovery banner rather than getting an HTML error page.
    sendJson(res, 500, { error: "scan-failed" });
  }
}

// ---------------------------------------------------------------------------
// Route: GET /api/catalog
// ---------------------------------------------------------------------------

async function routeCatalog(
  cwd: string,
  res: ServerResponse,
): Promise<void> {
  // Read `<cwd>/dist/catalog.json`. The spec (§6.1) says this endpoint
  // returns the current catalog content; if the catalog is missing (e.g.,
  // running from a checkout without `npm run build`), return an empty
  // object so the UI can degrade gracefully rather than 500-ing.
  const catalogPath = path.join(cwd, "dist", "catalog.json");
  let body: string;
  try {
    body = await readFile(catalogPath, "utf8");
    // Validate it parses as JSON before forwarding; if not, fall back to {}.
    JSON.parse(body);
  } catch {
    body = "{}";
  }
  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(body);
}

// ---------------------------------------------------------------------------
// Default apply handlers: returned when callers don't inject their own.
// CLI mode (M3 T3.6) replaces this with real installers wired via
// applyHandlers; tests always inject explicit mocks. The fallback throws so
// any forgotten wiring surfaces immediately as an item:done failure instead
// of silently no-op'ing.
// ---------------------------------------------------------------------------

const handlerNotConfigured: ApplyHandler = async () => {
  throw new Error("apply handlers not configured");
};

const defaultHandlersNotConfigured: ApplyHandlers = {
  workflow: handlerNotConfigured,
  skill: handlerNotConfigured,
  "recommended-skill": handlerNotConfigured,
  plugin: handlerNotConfigured,
  hook: handlerNotConfigured,
};
