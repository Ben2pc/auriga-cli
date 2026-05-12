// tests/server-auth.test.ts
//
// Failing tests for the auth + Origin/Host middleware of the (unimplemented)
// HTTP server in `src/server.ts`. Designed by an independent test designer
// who has NOT read any server implementation. Drives spec/docs:
//   - docs/architecture/web-ui.md §4.4 (security model)
//   - docs/architecture/web-ui.md §6.1 (endpoints; `/api/*` token-protected, `/` and
//     `/assets/*` public)
//   - docs/architecture/web-ui.md §7   (401/403 generic, no leak of cause)
//
// ---------------------------------------------------------------------------
// Assumptions (locked here so the implementer can read the contract before
// looking at any test body):
//
// A1. `src/server.ts` exports `startServer(opts: StartServerOptions): Promise<RunningServer>`.
//     - StartServerOptions has at least { port?: number; token: string; cwd: string }.
//       `port: 0` asks the OS to assign a free port.
//     - RunningServer has at least { port: number; close(): Promise<void> }.
//
// A2. Server binds on 127.0.0.1 (or ::1). Tests target `http://127.0.0.1:<port>`.
//
// A3. Endpoints covered by auth: any path starting with `/api/`. We probe with
//     `/api/state` (a GET endpoint per §6.1) — we do NOT assert the success body
//     shape, only the auth status code (200-class for pass, 401/403 for fail).
//     A "pass" is asserted as `status !== 401 && status !== 403`, so the test
//     is robust even if a route legitimately 404s while still passing auth.
//
// A4. Public paths: `/` and `/assets/*`. They must NOT 401/403 regardless of
//     missing token. They may 200 or 404 depending on whether a UI bundle is
//     wired in — we only assert "not 401/403".
//
// A5. Failure-response body shape: JSON with at minimum `{ "error": <string> }`.
//     401 body MUST contain `"error": "unauthorized"`; 403 body MUST contain
//     `"error": "forbidden"`. No extra detail of *why* (anti-probing).
//
// A6. Token check accepts EITHER `Authorization: Bearer <token>` header OR
//     `?token=<token>` query string. If both are present they must match.
//
// A7. Origin/Host whitelist members (case-insensitive on the host portion):
//     `127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`.
//     Origin may be absent (programmatic fetch / file://) — that's fine,
//     auth must NOT 403 solely on missing Origin.
//
// A8. Token is never echoed in any response (body, headers, error message).
//     We assert this via a "canary" token containing a unique sentinel string;
//     we then grep the full response (status line + headers + body) for that
//     sentinel.
//
// A9. The middleware short-circuits cheaply on bad tokens (no expensive work).
//     We assert this loosely: 1000 bad-token requests complete in < 5s.
//     This is a soft DOS / timing-attack canary, not a hard perf gate.
//
// A10. `node --test` runs from this repo's tooling; the file compiles via
//      `tsconfig.test.json` to `dist-test/tests/server-auth.test.js`, hence
//      the relative import `../src/server.js`.

import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { after, before, describe, test } from "node:test";

import { startServer } from "../src/server.js";
import type {
  RunningServer,
  StartServerOptions,
} from "../src/server.js";

// `fetch` (undici) overwrites the `Host` header with the URL's host, so it
// cannot be used to send a forged `Host` header. To exercise the Host-based
// DNS-rebinding defense, we need a request client that transmits whatever
// headers we set. Node's `http.request` respects the `Host` header verbatim.
//
// `rawFetch` wraps `http.request` into a `fetch`-compatible Response so the
// rest of the test file's helpers (`expectStatus`, `expectErrorBody`,
// `expectAuthPassed`) keep working without per-call branching.
async function rawFetch(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<Response> {
  const parsed = new URL(url);
  return new Promise<Response>((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: init?.method ?? "GET",
        headers: init?.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const respHeaders = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (v === undefined) continue;
            respHeaders.set(k, Array.isArray(v) ? v.join(", ") : v);
          }
          resolve(
            new Response(body, {
              status: res.statusCode ?? 0,
              statusText: res.statusMessage ?? "",
              headers: respHeaders,
            }),
          );
        });
      },
    );
    req.on("error", reject);
    if (init?.body) req.write(init.body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// 64 hex chars (32 bytes) — matches the URL-safe token shape implied by the
// spec ("Token 在 URL 中传递"). Suffix sentinel makes the canary grep
// unambiguous: even if some random byte sequence happened to be a substring,
// `AURIGA_TOKEN_CANARY_DO_NOT_LEAK` won't collide.
const TOKEN =
  "a".repeat(32) +
  "AURIGA_TOKEN_CANARY_DO_NOT_LEAK_" +
  "b".repeat(1); // pad to a distinctive shape; exact length isn't part of contract
const CANARY_SENTINEL = "AURIGA_TOKEN_CANARY_DO_NOT_LEAK";

// A second token of the same shape — used in the header/query conflict test.
const OTHER_TOKEN =
  "c".repeat(32) +
  "AURIGA_TOKEN_CANARY_DO_NOT_LEAK_OTHER_" +
  "d".repeat(1);

type ServerCtx = {
  server: RunningServer;
  baseUrl: string; // e.g. "http://127.0.0.1:54321"
  port: number;
};

let ctx: ServerCtx;

async function bootServer(): Promise<ServerCtx> {
  const opts: StartServerOptions = {
    port: 0, // OS-assigned free port
    token: TOKEN,
    cwd: process.cwd(),
  };
  const server = await startServer(opts);
  return {
    server,
    port: server.port,
    baseUrl: `http://127.0.0.1:${server.port}`,
  };
}

before(async () => {
  ctx = await bootServer();
});

after(async () => {
  if (ctx?.server) {
    await ctx.server.close();
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function expectStatus(
  res: Response,
  expected: number,
  message: string,
): Promise<void> {
  assert.equal(
    res.status,
    expected,
    `${message} — got ${res.status} ${res.statusText}`,
  );
}

async function expectErrorBody(
  res: Response,
  expectedError: "unauthorized" | "forbidden",
): Promise<void> {
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    assert.fail(
      `expected JSON error body, got non-JSON: ${text.slice(0, 200)}`,
    );
  }
  assert.ok(
    parsed && typeof parsed === "object",
    `error body must be a JSON object, got: ${text.slice(0, 200)}`,
  );
  const errVal = (parsed as { error?: unknown }).error;
  assert.equal(
    errVal,
    expectedError,
    `error body must have { "error": "${expectedError}" }`,
  );
}

function expectAuthPassed(res: Response, message: string): void {
  // "Pass" = not blocked by auth middleware. Route may legitimately 404 or
  // produce some other downstream status — we only assert auth didn't reject.
  assert.notEqual(res.status, 401, `${message} — got 401`);
  assert.notEqual(res.status, 403, `${message} — got 403`);
}

// Collect everything the client could read off the wire — status line +
// every header + body — into one string to grep for the canary.
async function fullResponseTrace(res: Response): Promise<string> {
  const parts: string[] = [];
  parts.push(`HTTP/1.1 ${res.status} ${res.statusText}`);
  res.headers.forEach((value, key) => {
    parts.push(`${key}: ${value}`);
  });
  parts.push("");
  parts.push(await res.text());
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Token presence + format
// ---------------------------------------------------------------------------

describe("server auth — token presence (spec §4.4)", () => {
  test("boundary: missing token → 401 with generic error body", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/state`);
    await expectStatus(res, 401, "no Authorization header, no ?token");
    await expectErrorBody(res, "unauthorized");
  });

  test("boundary: wrong token (well-formed but unknown) → 401", async () => {
    const wrong = "f".repeat(64);
    const res = await fetch(`${ctx.baseUrl}/api/state`, {
      headers: { Authorization: `Bearer ${wrong}` },
    });
    await expectStatus(res, 401, "wrong Bearer token");
    await expectErrorBody(res, "unauthorized");
  });

  test("boundary: malformed Authorization (not Bearer) → 401", async () => {
    // `Basic` scheme, `Token` scheme, raw token, empty value — all rejected.
    const cases = [
      `Basic ${TOKEN}`,
      `Token ${TOKEN}`,
      `${TOKEN}`, // missing scheme
      `Bearer`, // missing value
      `Bearer  ${TOKEN}`, // double-space (loose: implementer may accept; assertion is strict to force a single canonical shape)
    ];
    for (const auth of cases) {
      const res = await fetch(`${ctx.baseUrl}/api/state`, {
        headers: { Authorization: auth },
      });
      await expectStatus(
        res,
        401,
        `malformed Authorization header (${JSON.stringify(auth)})`,
      );
      await expectErrorBody(res, "unauthorized");
    }
  });
});

// ---------------------------------------------------------------------------
// Token transport variants
// ---------------------------------------------------------------------------

describe("server auth — token transport (spec §4.4)", () => {
  test("spec §4.4: header-only Bearer token passes", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/state`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expectAuthPassed(res, "header-only token");
  });

  test("spec §4.4: query-only ?token= passes", async () => {
    const url = `${ctx.baseUrl}/api/state?token=${encodeURIComponent(TOKEN)}`;
    const res = await fetch(url);
    expectAuthPassed(res, "query-only token");
  });

  test("boundary: header + query token conflict → 401", async () => {
    // Spec §4.4 says either source works. Defense-in-depth: when BOTH are
    // present and they disagree, the request is ambiguous and must be denied
    // rather than picking one silently (smuggling defense).
    const url = `${ctx.baseUrl}/api/state?token=${encodeURIComponent(OTHER_TOKEN)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    await expectStatus(res, 401, "header/query token conflict");
    await expectErrorBody(res, "unauthorized");
  });

  test("spec §4.4: header + query token AGREEING passes", async () => {
    // Sanity: if both present and identical, request must still pass.
    const url = `${ctx.baseUrl}/api/state?token=${encodeURIComponent(TOKEN)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expectAuthPassed(res, "header+query token matching");
  });
});

// ---------------------------------------------------------------------------
// Static asset exemption
// ---------------------------------------------------------------------------

describe("server auth — static asset exemption (spec §6.1)", () => {
  test("spec §6.1: `/` is public (no token) — not 401/403", async () => {
    const res = await fetch(`${ctx.baseUrl}/`);
    // Static asset may legitimately 200 (bundle present) or 404 (bundle
    // missing in this test env). Either is fine — auth must not reject.
    expectAuthPassed(res, "GET / with no auth");
  });

  test("spec §6.1: `/assets/foo.js` is public (no token) — not 401/403", async () => {
    const res = await fetch(`${ctx.baseUrl}/assets/foo.js`);
    expectAuthPassed(res, "GET /assets/foo.js with no auth");
  });
});

// ---------------------------------------------------------------------------
// Origin / Host whitelist (DNS rebinding defense)
// ---------------------------------------------------------------------------

describe("server auth — Origin/Host whitelist (spec §4.4)", () => {
  test("boundary: missing Origin + Host=127.0.0.1:<port> + good token → pass", async () => {
    // fetch() to 127.0.0.1 won't set an Origin header by default — that's the
    // exact CLI-tool / programmatic case the spec carves out.
    const res = await fetch(`${ctx.baseUrl}/api/state`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expectAuthPassed(res, "no Origin, default Host");
  });

  test("spec §4.4: Origin=http://localhost:<port> + Host=localhost:<port> + good token → pass", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/state`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Origin: `http://localhost:${ctx.port}`,
        Host: `localhost:${ctx.port}`,
      },
    });
    expectAuthPassed(res, "Origin=localhost + Host=localhost");
  });

  test("boundary: Origin=http://evil.com + good token → 403", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/state`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Origin: "http://evil.com",
      },
    });
    await expectStatus(res, 403, "evil Origin");
    await expectErrorBody(res, "forbidden");
  });

  test("boundary: DNS rebinding — Host=evil.com + good token → 403", async () => {
    // Use rawFetch so the forged Host header reaches the server. `fetch`
    // would overwrite Host with the URL's host (127.0.0.1) and silently
    // turn this into a happy-path request.
    const res = await rawFetch(`${ctx.baseUrl}/api/state`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Host: "evil.com",
      },
    });
    await expectStatus(res, 403, "evil Host (DNS rebinding)");
    await expectErrorBody(res, "forbidden");
  });

  test("boundary: Host case-insensitive — Host=LOCALHOST:<port> passes", async () => {
    // rawFetch so the upper-cased Host actually transmits. With fetch the
    // Host would silently downcase via URL normalization.
    const res = await rawFetch(`${ctx.baseUrl}/api/state`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Host: `LOCALHOST:${ctx.port}`,
      },
    });
    expectAuthPassed(res, "uppercase LOCALHOST host");
  });

  test("boundary: IPv6 form — Host=[::1]:<port> passes", async () => {
    // rawFetch so [::1] reaches the server unchanged. fetch would parse the
    // bracketed form differently and rewrite Host.
    const res = await rawFetch(`${ctx.baseUrl}/api/state`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Host: `[::1]:${ctx.port}`,
      },
    });
    expectAuthPassed(res, "IPv6 [::1] host");
  });

  test("boundary: Origin=null (file:// origin) + valid Host + good token → pass", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/state`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Origin: "null",
        Host: `127.0.0.1:${ctx.port}`,
      },
    });
    expectAuthPassed(res, 'Origin="null" + valid Host');
  });

  test("boundary: Origin valid + Host evil → 403 (both must pass, not either)", async () => {
    // rawFetch so Host="evil.com" actually transmits. fetch would override.
    const res = await rawFetch(`${ctx.baseUrl}/api/state`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Origin: `http://localhost:${ctx.port}`,
        Host: "evil.com",
      },
    });
    await expectStatus(res, 403, "valid Origin + evil Host");
    await expectErrorBody(res, "forbidden");
  });
});

// ---------------------------------------------------------------------------
// Token-leak canary
// ---------------------------------------------------------------------------

describe("server auth — token never leaks in responses (spec §4.4)", () => {
  test("boundary: deliberately bad request → response contains no token bytes", async () => {
    // Construct a request that's wrong in multiple ways: bad token, bad
    // Origin, bad Host. The middleware should reject with a generic 401/403
    // and NEVER echo any part of the real token or its canary sentinel into
    // any response surface (status line, headers, body, error text).
    const res = await fetch(`${ctx.baseUrl}/api/state?token=wrong-value-here`, {
      headers: {
        Authorization: `Bearer wrong-bearer-value`,
        Origin: "http://evil.com",
        Host: "evil.com",
        // Sneak the real token into a custom header just to be extra sure
        // it never echoes back (e.g. via verbose error reflection).
        "X-Debug-Probe": TOKEN,
      },
    });
    assert.ok(
      res.status === 401 || res.status === 403,
      `bad request must be denied, got ${res.status}`,
    );
    const trace = await fullResponseTrace(res);
    assert.ok(
      !trace.includes(CANARY_SENTINEL),
      `response must not contain token canary sentinel "${CANARY_SENTINEL}". ` +
        `Full response trace:\n${trace}`,
    );
    assert.ok(
      !trace.includes(TOKEN),
      "response must not contain the full token string",
    );
  });

  test("boundary: 401 body does not distinguish missing vs bad token", async () => {
    // Anti-probing: spec §7 says we don't reveal which auth predicate failed.
    // Both "no token" and "wrong token" must produce the same body bytes.
    const noTokenRes = await fetch(`${ctx.baseUrl}/api/state`);
    const badTokenRes = await fetch(`${ctx.baseUrl}/api/state`, {
      headers: { Authorization: `Bearer ${"f".repeat(64)}` },
    });
    assert.equal(noTokenRes.status, 401);
    assert.equal(badTokenRes.status, 401);
    const noTokenBody = await noTokenRes.text();
    const badTokenBody = await badTokenRes.text();
    assert.equal(
      noTokenBody,
      badTokenBody,
      "401 body must be byte-identical for 'missing' and 'bad' token cases " +
        "(anti-probing per spec §7)",
    );
  });
});

// ---------------------------------------------------------------------------
// Fast-reject behavior (soft DOS / timing canary)
// ---------------------------------------------------------------------------

describe("server auth — fast reject of bad tokens", () => {
  test("boundary: 1000 bad-token requests all 401 within 5s budget", async () => {
    const N = 1000;
    const t0 = Date.now();
    // Sequential to avoid `fetch`-level concurrency limits skewing the
    // result. If the middleware is doing heavy work per request (sync I/O,
    // expensive hashing, etc) it will blow past the 5s budget.
    let denied = 0;
    for (let i = 0; i < N; i++) {
      const res = await fetch(`${ctx.baseUrl}/api/state`, {
        headers: { Authorization: `Bearer ${"x".repeat(64)}` },
      });
      // Drain body so the socket can be reused.
      await res.text();
      if (res.status === 401) denied++;
    }
    const elapsedMs = Date.now() - t0;
    assert.equal(denied, N, `expected all ${N} requests denied, got ${denied}`);
    assert.ok(
      elapsedMs < 5000,
      `1000 bad-token rejects took ${elapsedMs}ms; budget is 5000ms`,
    );
  });
});
