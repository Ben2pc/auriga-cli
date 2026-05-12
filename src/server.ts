// Stub for test designer's red phase. The real implementation must
// replace everything below the marker. Tests in tests/server-auth.test.ts
// and tests/server.test.ts exercise contracts defined in
// docs/specs/web-ui.md §4.4 / §6 / §7.
//
// This stub returns a trivially-wrong server (every request → 200) so tests
// compile and produce real assertion-mismatch failures (not "cannot find
// module" fake-red failures). The implementer of Slice B should delete
// everything below the marker line.

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
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

// ---- IMPLEMENTATION GOES BELOW ----

import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ApplyRequest } from "./api-types.js";
import { buildScanCatalog } from "./scan-catalog.js";
import { scanState } from "./state.js";

// Body parsing cap. /api/apply payloads are tiny (an array of item refs);
// 1 MiB is generously above the largest realistic batch and small enough that
// abusive clients can't pin memory.
const MAX_JSON_BODY = 1 * 1024 * 1024;

// SSE placeholder hold time. Keeps the connection open briefly so the client
// sees an established stream, then closes cleanly. Slice C will replace this
// with a real event pump fed by the apply job runner.
const SSE_PLACEHOLDER_HOLD_MS = 50;

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
    const { category, name, action } = it as Record<string, unknown>;
    if (typeof category !== "string" || !VALID_CATEGORIES.has(category)) {
      return null;
    }
    if (typeof name !== "string" || name.length === 0) return null;
    if (typeof action !== "string" || !VALID_ACTIONS.has(action)) return null;
  }
  return parsed as ApplyRequest;
}

// ---------------------------------------------------------------------------
// Static asset placeholder. M1 ships without a UI bundle; we return 404 for
// every public-path request, but crucially NOT 401/403 — tests probe this.
// M4 ui-fetch will replace this with a file-system static handler reading
// from the cached UI bundle.
// ---------------------------------------------------------------------------

function handleStatic(_req: IncomingMessage, res: ServerResponse): void {
  send404(res);
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
      // Static. `/` and `/assets/*` — placeholder 404 until UI bundle is wired.
      handleStatic(req, res);
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
      await routeApply(req, res);
      return;
    }
    if (pathname === "/api/progress" && method === "GET") {
      await routeProgress(searchParams, res);
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
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
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
// Route: POST /api/apply
// ---------------------------------------------------------------------------

async function routeApply(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
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
  // M1 placeholder — Slice C will dispatch this to the apply runner and
  // return a real jobId.
  sendJson(res, 202, {
    jobId: "placeholder",
    note: "not-implemented-in-M1",
  });
}

// ---------------------------------------------------------------------------
// Route: GET /api/progress?jobId=...
// ---------------------------------------------------------------------------

async function routeProgress(
  searchParams: URLSearchParams,
  res: ServerResponse,
): Promise<void> {
  const jobId = searchParams.get("jobId");
  if (!jobId) {
    sendJson(res, 400, { error: "missing-jobId" });
    return;
  }
  // Open an SSE stream, send nothing, close shortly after. Slice C wires this
  // to the real event pump.
  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("connection", "keep-alive");
  res.flushHeaders?.();
  // A no-op comment frame keeps some proxies happy.
  res.write(": connected\n\n");
  await new Promise<void>((resolve) =>
    setTimeout(resolve, SSE_PLACEHOLDER_HOLD_MS),
  );
  res.end();
}
