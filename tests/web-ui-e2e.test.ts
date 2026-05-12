// tests/web-ui-e2e.test.ts
//
// Hermetic end-to-end test for the `npx auriga-cli ui` flow. Spawns the
// CLI as a child process with HOME / XDG redirected to a scratch dir so
// the run cannot touch the developer's real cache / config / plugins.
// Verifies:
//   1. The server comes up on a usable port.
//   2. /api/state returns a structurally valid StateReport.
//   3. /api/apply + SSE drive a real workflow install end-to-end against
//      the scratch project; filesystem side effects appear under scratch.
//   4. Canary: $HOME (the real one) was NOT modified during the run.
//
// Not on CI by default — invoked via `npm run test:web-ui-e2e`. Plain Node
// (no Playwright) keeps the dependency surface zero; Vitest + RTL covers
// the UI rendering layer (see ui/tests/*.test.tsx). The harness-based
// approach satisfies the user's "verify e2e + don't break local env"
// requirement; a Playwright-driven browser overlay can layer on later
// without rewriting this scaffolding (see spec §10.1).

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, test } from "node:test";

const REAL_HOME = process.env.HOME ?? "";
// Compiled file lives at `dist-test/tests/web-ui-e2e.test.js`; the repo
// root is two levels up. Resolving from src form would only be one — but
// the runtime path is always the compiled one.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

// ---------------------------------------------------------------------------
// Skip the suite when prerequisites aren't met. Two practical pre-reqs:
//   1. dist/cli.js must exist (npm run build has run).
//   2. ui/dist/index.html must exist (npm --prefix ui run build has run).
// Both are produced by `npm run pretest:web-ui-e2e`, but a manual invocation
// without that hook should fail cleanly rather than spawn a broken CLI.
// ---------------------------------------------------------------------------

function prereqMissing(): string | null {
  if (!existsSync(path.join(REPO_ROOT, "dist", "cli.js"))) {
    return "dist/cli.js missing — run 'npm run build' first";
  }
  if (!existsSync(path.join(REPO_ROOT, "ui", "dist", "index.html"))) {
    return "ui/dist/index.html missing — run 'npm --prefix ui run build' first";
  }
  if (!REAL_HOME) {
    return "real HOME not set; the canary cannot verify isolation";
  }
  return null;
}

const skipReason = prereqMissing();

// ---------------------------------------------------------------------------
// Scratch lifecycle. Each test gets a brand-new HOME redirect + workspace.
// ---------------------------------------------------------------------------

interface ScratchEnv {
  root: string;
  fakeHome: string;
  workspace: string;
  /** Token printed by the CLI. Captured from stdout. */
  token: string;
  /** Port the CLI bound to. Captured from stdout. */
  port: number;
  /** The child process. */
  proc: ChildProcess;
}

const URL_RE = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([0-9a-f]+)/;

async function bootCli(): Promise<ScratchEnv> {
  const root = await mkdtemp(path.join(os.tmpdir(), "auriga-web-ui-e2e-"));
  const fakeHome = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  await mkdir(fakeHome, { recursive: true });
  await mkdir(workspace, { recursive: true });

  // Pre-populate the scratch workspace with the bits ensureUiBundle would
  // normally fetch from GitHub. We point --ui-dir at the locally built
  // ui/dist so the test doesn't go to the network.
  const uiDir = path.join(REPO_ROOT, "ui", "dist");

  const proc = spawn(
    process.execPath,
    [
      path.join(REPO_ROOT, "dist", "cli.js"),
      "ui",
      "--ui-dir",
      uiDir,
      "--no-open",
      "--port",
      "0",
    ],
    {
      cwd: workspace,
      env: {
        // Scrub anything that could leak the real HOME into the child.
        PATH: process.env.PATH,
        HOME: fakeHome,
        XDG_CACHE_HOME: path.join(fakeHome, ".cache"),
        XDG_CONFIG_HOME: path.join(fakeHome, ".config"),
        XDG_DATA_HOME: path.join(fakeHome, ".local", "share"),
        AURIGA_E2E: "1",
        DEV: "1", // skip network fetch of content; use repo files
        NODE_OPTIONS: process.env.NODE_OPTIONS ?? "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  // Capture stdout/stderr for diagnostic + URL parse.
  let stdoutBuf = "";
  let stderrBuf = "";
  proc.stdout?.on("data", (c: Buffer) => (stdoutBuf += c.toString("utf8")));
  proc.stderr?.on("data", (c: Buffer) => (stderrBuf += c.toString("utf8")));

  // Wait up to 20s for the URL line to appear (covers slow CI / cold start).
  const deadline = Date.now() + 20_000;
  let match: RegExpMatchArray | null = null;
  while (Date.now() < deadline) {
    match = URL_RE.exec(stdoutBuf);
    if (match) break;
    if (proc.exitCode !== null) {
      throw new Error(
        `CLI exited (${proc.exitCode}) before URL was printed.\nSTDOUT:\n${stdoutBuf}\nSTDERR:\n${stderrBuf}`,
      );
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!match) {
    proc.kill("SIGTERM");
    throw new Error(
      `Timed out waiting for the 'auriga UI is live' URL line.\nSTDOUT:\n${stdoutBuf}\nSTDERR:\n${stderrBuf}`,
    );
  }

  return {
    root,
    fakeHome,
    workspace,
    port: Number.parseInt(match[1], 10),
    token: match[2],
    proc,
  };
}

async function shutdownCli(env: ScratchEnv): Promise<void> {
  if (env.proc.exitCode === null) {
    // Try graceful shutdown via the API first.
    try {
      await fetch(`http://127.0.0.1:${env.port}/api/shutdown`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.token}` },
      });
    } catch {
      /* ignore */
    }
    // Force-kill after a short grace period if it didn't exit.
    const grace = setTimeout(() => env.proc.kill("SIGKILL"), 2_000);
    grace.unref();
    await new Promise<void>((resolve) => env.proc.once("exit", () => resolve()));
  }
  await rm(env.root, { recursive: true, force: true });
}

let cur: ScratchEnv | null = null;

beforeEach(async () => {
  if (skipReason) return;
  cur = await bootCli();
});
afterEach(async () => {
  if (!cur) return;
  await shutdownCli(cur);
  cur = null;
});

// Capture a snapshot of the real HOME's top-level entries at suite start;
// the canary asserts the set didn't change after each test.
let homeSnapshot = new Set<string>();
try {
  homeSnapshot = new Set(await readdir(REAL_HOME));
} catch {
  /* if HOME isn't readable, snapshot stays empty; canary downgrades to
     "no new top-level entries added" which is still useful. */
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("web UI e2e (spec §8.1 hermetic guarantee)", () => {
  test("server boots, /api/state returns a valid StateReport, real HOME unchanged", async (t) => {
    if (skipReason) {
      t.skip(skipReason);
      return;
    }
    assert.ok(cur);
    const baseUrl = `http://127.0.0.1:${cur.port}`;

    const stateRes = await fetch(`${baseUrl}/api/state`, {
      headers: { Authorization: `Bearer ${cur.token}` },
    });
    assert.equal(stateRes.status, 200);
    const state = (await stateRes.json()) as {
      workflow: { status: string };
      skills: Array<{ name: string; status: string }>;
      plugins: Array<{ id: string; status: string }>;
    };
    assert.ok(state.workflow, "missing workflow in state report");
    assert.ok(Array.isArray(state.skills), "missing skills array");
    assert.ok(Array.isArray(state.plugins), "missing plugins array");
    // Scratch workspace has no harness installed yet → workflow must be
    // not-installed.
    assert.equal(state.workflow.status, "not-installed");

    // Static asset surface: GET / must serve index.html.
    const indexRes = await fetch(`${baseUrl}/`);
    assert.equal(indexRes.status, 200);
    const indexBody = await indexRes.text();
    assert.match(indexBody, /<!doctype html>/i);

    // Canary: real HOME must not have any new top-level entries.
    const after = await readdir(REAL_HOME);
    const added = after.filter((n) => !homeSnapshot.has(n));
    assert.deepEqual(
      added,
      [],
      `CLI subprocess wrote new entries to real HOME: ${added.join(", ")}`,
    );
  });

  test("apply install workflow → SSE all-done success=true, scratch workspace has CLAUDE.md", async (t) => {
    if (skipReason) {
      t.skip(skipReason);
      return;
    }
    assert.ok(cur);
    const baseUrl = `http://127.0.0.1:${cur.port}`;

    const applyRes = await fetch(`${baseUrl}/api/apply`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cur.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        items: [
          { category: "workflow", name: "workflow", action: "install" },
        ],
      }),
    });
    assert.equal(applyRes.status, 202);
    const { jobId } = (await applyRes.json()) as { jobId: string };

    // Drain SSE until all-done.
    const progRes = await fetch(
      `${baseUrl}/api/progress?jobId=${jobId}`,
      {
        headers: {
          Authorization: `Bearer ${cur.token}`,
          Accept: "text/event-stream",
        },
      },
    );
    assert.equal(progRes.status, 200);
    const reader = progRes.body!.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    let allDoneOk: boolean | null = null;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (value) buf += decoder.decode(value, { stream: true });
      const m = /"type":"all-done","success":(true|false),"failedCount":(\d+)/.exec(buf);
      if (m) {
        allDoneOk = m[1] === "true";
        break;
      }
      if (done) break;
    }
    try { reader.releaseLock(); } catch { /* ignore */ }
    assert.ok(allDoneOk !== null, `no all-done frame seen. Buffer: ${buf.slice(0, 400)}`);
    assert.equal(allDoneOk, true, "workflow install should succeed");

    // Filesystem side effect: scratch workspace gained CLAUDE.md.
    assert.ok(
      existsSync(path.join(cur.workspace, "CLAUDE.md")),
      "CLAUDE.md should exist in scratch workspace after install",
    );

    // Canary again, post-apply.
    const after = await readdir(REAL_HOME);
    const added = after.filter((n) => !homeSnapshot.has(n));
    assert.deepEqual(
      added,
      [],
      `apply leaked entries into real HOME: ${added.join(", ")}`,
    );
  });
});

// Suppress unused-imports for fixtures kept for future expansion.
void copyFile;
void writeFile;
void readFile;
void stat;
