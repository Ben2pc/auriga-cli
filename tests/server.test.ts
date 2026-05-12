// tests/server.test.ts
//
// Route-level unit tests for the HTTP server in `src/server.ts`. Covers the
// six /api/* endpoints under the assumption that auth (token + Origin/Host)
// passes — that surface is exercised by tests/server-auth.test.ts.
//
// Each test boots its own server on an OS-assigned port (port: 0) and tears
// it down in a `finally` block so port allocations don't leak between tests.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { startServer } from "../src/server.js";
import type { RunningServer } from "../src/server.js";

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

function randomToken(): string {
  return randomBytes(32).toString("hex");
}

async function bootServer(opts?: {
  cwd?: string;
  token?: string;
}): Promise<{ server: RunningServer; baseUrl: string; token: string }> {
  const token = opts?.token ?? randomToken();
  const server = await startServer({
    port: 0,
    token,
    cwd: opts?.cwd ?? process.cwd(),
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.port}`,
    token,
  };
}

function authHeaders(token: string): Record<string, string> {
  // Use the explicit-loopback Origin variant so we're exercising both the
  // permissive-no-Origin path (in some tests) and the explicit-whitelisted
  // path. Host defaults to 127.0.0.1:<port> via undici and is always allowed.
  return { Authorization: `Bearer ${token}` };
}

async function withServer<T>(
  fn: (ctx: { baseUrl: string; token: string }) => Promise<T>,
  opts?: { cwd?: string; token?: string },
): Promise<T> {
  const ctx = await bootServer(opts);
  try {
    return await fn({ baseUrl: ctx.baseUrl, token: ctx.token });
  } finally {
    await ctx.server.close();
  }
}

// ---------------------------------------------------------------------------
// GET /api/catalog
// ---------------------------------------------------------------------------

describe("GET /api/catalog (spec §6.1)", () => {
  test("returns dist/catalog.json content when present", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "server-catalog-"));
    try {
      const dist = path.join(tmp, "dist");
      await mkdir(dist, { recursive: true });
      const expected = {
        workflowVersion: "v1.6.0",
        skills: { foo: { description: "Foo skill", expectedHash: "abc", isWorkflow: true } },
        plugins: {},
      };
      await writeFile(
        path.join(dist, "catalog.json"),
        JSON.stringify(expected),
        "utf8",
      );
      await withServer(
        async ({ baseUrl, token }) => {
          const res = await fetch(`${baseUrl}/api/catalog`, {
            headers: authHeaders(token),
          });
          assert.equal(res.status, 200);
          assert.match(
            res.headers.get("content-type") ?? "",
            /application\/json/i,
          );
          const body = await res.json();
          assert.deepEqual(body, expected);
        },
        { cwd: tmp },
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("returns {} when dist/catalog.json is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "server-no-catalog-"));
    try {
      // Intentionally no dist/ subdirectory.
      await withServer(
        async ({ baseUrl, token }) => {
          const res = await fetch(`${baseUrl}/api/catalog`, {
            headers: authHeaders(token),
          });
          assert.equal(res.status, 200);
          const body = await res.json();
          assert.deepEqual(body, {});
        },
        { cwd: tmp },
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("returns {} when dist/catalog.json is malformed JSON", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "server-bad-catalog-"));
    try {
      const dist = path.join(tmp, "dist");
      await mkdir(dist, { recursive: true });
      await writeFile(path.join(dist, "catalog.json"), "{not json", "utf8");
      await withServer(
        async ({ baseUrl, token }) => {
          const res = await fetch(`${baseUrl}/api/catalog`, {
            headers: authHeaders(token),
          });
          assert.equal(res.status, 200);
          const body = await res.json();
          assert.deepEqual(body, {});
        },
        { cwd: tmp },
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/state
// ---------------------------------------------------------------------------

describe("GET /api/state (spec §6.1)", () => {
  test("returns a structurally valid StateReport", async () => {
    await withServer(async ({ baseUrl, token }) => {
      const res = await fetch(`${baseUrl}/api/state`, {
        headers: authHeaders(token),
      });
      assert.equal(res.status, 200);
      assert.match(
        res.headers.get("content-type") ?? "",
        /application\/json/i,
      );
      const body = (await res.json()) as Record<string, unknown>;
      // Required top-level keys per api-types.ts StateReport.
      for (const key of [
        "workflow",
        "skills",
        "recommendedSkills",
        "plugins",
        "hooks",
        "warnings",
      ]) {
        assert.ok(key in body, `StateReport missing key: ${key}`);
      }
      assert.ok(Array.isArray(body.skills));
      assert.ok(Array.isArray(body.recommendedSkills));
      assert.ok(Array.isArray(body.plugins));
      assert.ok(Array.isArray(body.hooks));
      assert.ok(Array.isArray(body.warnings));
      const wf = body.workflow as Record<string, unknown>;
      assert.equal(typeof wf.status, "string");
      assert.equal(typeof wf.expectedVersion, "string");
      assert.ok(
        ["installed", "update-available", "not-installed"].includes(
          wf.status as string,
        ),
        `workflow.status must be a valid ItemStatus, got: ${String(wf.status)}`,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/apply
// ---------------------------------------------------------------------------

describe("POST /api/apply (spec §6.1 / §6.4)", () => {
  test("valid ApplyRequest → 202 with jobId", async () => {
    await withServer(async ({ baseUrl, token }) => {
      const body = {
        items: [
          { category: "skill", name: "brainstorming", action: "install" },
          { category: "hook", name: "notify", action: "uninstall" },
        ],
      };
      const res = await fetch(`${baseUrl}/api/apply`, {
        method: "POST",
        headers: {
          ...authHeaders(token),
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 202);
      const parsed = (await res.json()) as { jobId?: unknown };
      assert.equal(typeof parsed.jobId, "string");
      assert.ok((parsed.jobId as string).length > 0);
    });
  });

  test("non-JSON body → 400", async () => {
    await withServer(async ({ baseUrl, token }) => {
      const res = await fetch(`${baseUrl}/api/apply`, {
        method: "POST",
        headers: { ...authHeaders(token), "content-type": "application/json" },
        body: "{not json at all",
      });
      assert.equal(res.status, 400);
      const parsed = (await res.json()) as { error?: unknown };
      assert.equal(typeof parsed.error, "string");
    });
  });

  test("missing items[] → 400", async () => {
    await withServer(async ({ baseUrl, token }) => {
      const res = await fetch(`${baseUrl}/api/apply`, {
        method: "POST",
        headers: { ...authHeaders(token), "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
    });
  });

  test("invalid category in item → 400", async () => {
    await withServer(async ({ baseUrl, token }) => {
      const res = await fetch(`${baseUrl}/api/apply`, {
        method: "POST",
        headers: { ...authHeaders(token), "content-type": "application/json" },
        body: JSON.stringify({
          items: [{ category: "not-a-thing", name: "x", action: "install" }],
        }),
      });
      assert.equal(res.status, 400);
    });
  });

  test("invalid action in item → 400", async () => {
    await withServer(async ({ baseUrl, token }) => {
      const res = await fetch(`${baseUrl}/api/apply`, {
        method: "POST",
        headers: { ...authHeaders(token), "content-type": "application/json" },
        body: JSON.stringify({
          items: [{ category: "skill", name: "x", action: "obliterate" }],
        }),
      });
      assert.equal(res.status, 400);
    });
  });

  test("empty items[] is accepted → 202", async () => {
    // Empty batch is well-formed; the runner will simply emit all-done with
    // failedCount: 0. No reason to 400.
    await withServer(async ({ baseUrl, token }) => {
      const res = await fetch(`${baseUrl}/api/apply`, {
        method: "POST",
        headers: { ...authHeaders(token), "content-type": "application/json" },
        body: JSON.stringify({ items: [] }),
      });
      assert.equal(res.status, 202);
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/ping
// ---------------------------------------------------------------------------

describe("POST /api/ping (spec §6.1 / §6.6)", () => {
  test("returns 200 { ok: true }", async () => {
    await withServer(async ({ baseUrl, token }) => {
      const res = await fetch(`${baseUrl}/api/ping`, {
        method: "POST",
        headers: authHeaders(token),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok?: unknown };
      assert.equal(body.ok, true);
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/progress
// ---------------------------------------------------------------------------

describe("GET /api/progress (spec §6.5)", () => {
  test("returns 200 + text/event-stream when jobId is given", async () => {
    await withServer(async ({ baseUrl, token }) => {
      const res = await fetch(`${baseUrl}/api/progress?jobId=abc`, {
        headers: authHeaders(token),
      });
      assert.equal(res.status, 200);
      assert.match(
        res.headers.get("content-type") ?? "",
        /text\/event-stream/i,
      );
      // Drain so the socket can be recycled before close().
      await res.text();
    });
  });

  test("missing jobId → 400", async () => {
    await withServer(async ({ baseUrl, token }) => {
      const res = await fetch(`${baseUrl}/api/progress`, {
        headers: authHeaders(token),
      });
      assert.equal(res.status, 400);
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/shutdown
// ---------------------------------------------------------------------------

describe("POST /api/shutdown (spec §4.3)", () => {
  test("returns 200 then refuses subsequent requests", async () => {
    const ctx = await bootServer();
    try {
      const res = await fetch(`${ctx.baseUrl}/api/shutdown`, {
        method: "POST",
        headers: authHeaders(ctx.token),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok?: unknown };
      assert.equal(body.ok, true);

      // After shutdown the listener should refuse new connections. Give the
      // teardown a short window to complete, then expect the connect attempt
      // to either fail (ECONNREFUSED) or, if still mid-flight, return our
      // 503 "shutting-down" status.
      let connectionRefused = false;
      let httpStatus: number | null = null;
      // Poll for up to ~1s so flakiness from event-loop timing is bounded.
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 50));
        try {
          const probe = await fetch(`${ctx.baseUrl}/api/ping`, {
            method: "POST",
            headers: authHeaders(ctx.token),
          });
          await probe.text();
          httpStatus = probe.status;
          if (probe.status === 503) break;
        } catch {
          connectionRefused = true;
          break;
        }
      }
      assert.ok(
        connectionRefused || httpStatus === 503,
        `post-shutdown probe should refuse (ECONNREFUSED) or return 503; ` +
          `got status=${httpStatus} refused=${connectionRefused}`,
      );
    } finally {
      // Idempotent: close() resolves even if the server has already torn down.
      await ctx.server.close().catch(() => {});
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: tokens differ per server instance — no cross-contamination
// ---------------------------------------------------------------------------

describe("server instances are independent", () => {
  test("token from one server is rejected by another", async () => {
    const a = await bootServer();
    const b = await bootServer();
    try {
      const res = await fetch(`${b.baseUrl}/api/ping`, {
        method: "POST",
        headers: authHeaders(a.token), // wrong token for server B
      });
      assert.equal(res.status, 401);
    } finally {
      await a.server.close();
      await b.server.close();
    }
  });
});
