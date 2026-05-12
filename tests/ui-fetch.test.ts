// tests/ui-fetch.test.ts
//
// Contract:
//   ensureUiBundle({ version, cacheRoot, fetcher })
//     → resolves to absolute path of the extracted bundle directory
//        (`${cacheRoot}/ui-v${version}/`). Caller can serve static assets
//        from there.
//
// Spec refs: docs/specs/web-ui.md §4.1 (CLI ui boot), §9.3 (SHA256 verify),
// §9.4 (cache management), §9.5 (no version mismatch).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test, beforeEach, afterEach } from "node:test";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";

import { ensureUiBundle } from "../src/ui-fetch.js";
import type { UiFetcher } from "../src/ui-fetch.js";

// ---------------------------------------------------------------------------
// Helpers: build a valid bundle and a deterministic fetcher
// ---------------------------------------------------------------------------

/** Build a minimal valid tar.gz containing `index.html` + an `assets/` dir.
 *  Returns the gz'd bytes (what GitHub would serve). */
async function buildTarGz(
  contents: Array<{ relpath: string; body: string }>,
): Promise<Buffer> {
  // Stage files in a temp dir, then tar -czf so we exercise the exact same
  // tar format ensureUiBundle will see in production.
  const stage = await mkdtemp(path.join(os.tmpdir(), "ui-fetch-build-"));
  try {
    for (const f of contents) {
      const full = path.join(stage, f.relpath);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, f.body);
    }
    const tarFile = path.join(stage, "out.tar");
    const r = spawnSync("tar", ["-cf", tarFile, "-C", stage, "."], {
      stdio: "pipe",
    });
    if (r.status !== 0) {
      throw new Error(
        `tar build failed: ${r.stderr?.toString() ?? ""}`,
      );
    }
    const raw = await readFile(tarFile);
    return gzipSync(raw);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

interface FakeFetchTable {
  [url: string]: { status: number; body: Buffer };
}

function makeFetcher(table: FakeFetchTable): {
  fetcher: UiFetcher;
  calls: string[];
} {
  const calls: string[] = [];
  const fetcher: UiFetcher = async (url) => {
    calls.push(url);
    const entry = table[url];
    if (!entry) {
      throw new Error(`unmocked URL: ${url}`);
    }
    return entry;
  };
  return { fetcher, calls };
}

// ---------------------------------------------------------------------------
// Fixtures + setup
// ---------------------------------------------------------------------------

const VERSION = "9.99.99";
const BUNDLE_URL = `https://github.com/Ben2pc/auriga-cli/releases/download/v${VERSION}/ui-bundle.tar.gz`;
const SHA_URL = `https://github.com/Ben2pc/auriga-cli/releases/download/v${VERSION}/ui-bundle.sha256`;

let cacheRoot: string;

beforeEach(async () => {
  cacheRoot = await mkdtemp(path.join(os.tmpdir(), "ui-fetch-cache-"));
});

afterEach(async () => {
  await rm(cacheRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Cache miss → fetch + verify + extract
// ---------------------------------------------------------------------------

describe("ensureUiBundle — cache miss", () => {
  test("downloads, verifies SHA256, extracts index.html into version dir", async () => {
    const bundle = await buildTarGz([
      { relpath: "index.html", body: "<!doctype html><html></html>" },
      { relpath: "assets/main.js", body: "console.log(1)" },
    ]);
    const expected = sha256Hex(bundle);
    const { fetcher, calls } = makeFetcher({
      [BUNDLE_URL]: { status: 200, body: bundle },
      [SHA_URL]: {
        status: 200,
        body: Buffer.from(`${expected}  ui-bundle.tar.gz\n`),
      },
    });

    const out = await ensureUiBundle({
      version: VERSION,
      cacheRoot,
      fetcher,
    });

    assert.equal(out, path.join(cacheRoot, `ui-v${VERSION}`));
    assert.ok(
      existsSync(path.join(out, "index.html")),
      "expected index.html in extracted dir",
    );
    assert.ok(
      existsSync(path.join(out, "assets", "main.js")),
      "expected assets/main.js in extracted dir",
    );
    assert.equal(
      (await readFile(path.join(out, "index.html"), "utf8")).slice(0, 9),
      "<!doctype",
    );
    // Both URLs must have been fetched once each.
    assert.equal(calls.filter((c) => c === BUNDLE_URL).length, 1);
    assert.equal(calls.filter((c) => c === SHA_URL).length, 1);
  });
});

// ---------------------------------------------------------------------------
// 2. Cache hit → no fetch
// ---------------------------------------------------------------------------

describe("ensureUiBundle — cache hit", () => {
  test("when cache dir already contains index.html, returns it without fetching", async () => {
    const versionDir = path.join(cacheRoot, `ui-v${VERSION}`);
    await mkdir(versionDir, { recursive: true });
    await writeFile(path.join(versionDir, "index.html"), "<html>cached</html>");
    const { fetcher, calls } = makeFetcher({});

    const out = await ensureUiBundle({
      version: VERSION,
      cacheRoot,
      fetcher,
    });

    assert.equal(out, versionDir);
    assert.equal(calls.length, 0, "fetcher must NOT be called on cache hit");
  });
});

// ---------------------------------------------------------------------------
// 3. SHA256 mismatch → throw + leave no partial cache
// ---------------------------------------------------------------------------

describe("ensureUiBundle — checksum failure", () => {
  test("throws when downloaded SHA256 doesn't match advertised value", async () => {
    const bundle = await buildTarGz([
      { relpath: "index.html", body: "<html></html>" },
    ]);
    const wrong = "0".repeat(64);
    const { fetcher } = makeFetcher({
      [BUNDLE_URL]: { status: 200, body: bundle },
      [SHA_URL]: {
        status: 200,
        body: Buffer.from(`${wrong}  ui-bundle.tar.gz\n`),
      },
    });

    await assert.rejects(
      () => ensureUiBundle({ version: VERSION, cacheRoot, fetcher }),
      /sha256|checksum|integrity/i,
    );

    // No partial cache dir left around — failure must clean up.
    const versionDir = path.join(cacheRoot, `ui-v${VERSION}`);
    assert.equal(
      existsSync(versionDir),
      false,
      "partial cache dir must be cleaned up after checksum failure",
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Network failure → throw with helpful message
// ---------------------------------------------------------------------------

describe("ensureUiBundle — network failure", () => {
  test("fetcher returning non-200 status throws", async () => {
    const fetcher: UiFetcher = async () => ({
      status: 404,
      body: Buffer.from(""),
    });

    await assert.rejects(
      () => ensureUiBundle({ version: VERSION, cacheRoot, fetcher }),
      /404|not.?found|fetch|download/i,
    );
  });

  test("fetcher throwing surfaces the error", async () => {
    const fetcher: UiFetcher = async () => {
      throw new Error("ENOTFOUND github.com");
    };
    await assert.rejects(
      () => ensureUiBundle({ version: VERSION, cacheRoot, fetcher }),
      /ENOTFOUND|network|fetch/i,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. LRU eviction: keep only the 3 newest versions
// ---------------------------------------------------------------------------

describe("ensureUiBundle — LRU cache eviction", () => {
  test("after a successful fetch, only the 3 newest ui-v* dirs remain", async () => {
    // Pre-seed 4 stale version dirs with deliberately old mtimes. Their
    // contents are arbitrary; we only care about dir presence.
    const stale = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"];
    for (const v of stale) {
      const dir = path.join(cacheRoot, `ui-v${v}`);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "index.html"), `<html>${v}</html>`);
    }
    // Walk back the mtimes so the "newest" sort is unambiguous: lower
    // version → older mtime. We touch via Node's utimes.
    const { utimes } = await import("node:fs/promises");
    const base = Math.floor(Date.now() / 1000);
    for (let i = 0; i < stale.length; i++) {
      const dir = path.join(cacheRoot, `ui-v${stale[i]}`);
      const t = base - (stale.length - i) * 1000;
      await utimes(dir, t, t);
    }

    // Now trigger a real cache miss + fetch for VERSION. After the fetch,
    // the new dir + the 2 newest staled dirs (1.3.0, 1.2.0) should remain.
    const bundle = await buildTarGz([
      { relpath: "index.html", body: "<html>new</html>" },
    ]);
    const expected = sha256Hex(bundle);
    const { fetcher } = makeFetcher({
      [BUNDLE_URL]: { status: 200, body: bundle },
      [SHA_URL]: {
        status: 200,
        body: Buffer.from(`${expected}  ui-bundle.tar.gz\n`),
      },
    });

    await ensureUiBundle({ version: VERSION, cacheRoot, fetcher });

    const entries = (await readdir(cacheRoot)).filter((e) =>
      e.startsWith("ui-v"),
    );
    assert.equal(entries.length, 3, `expected 3 ui-v* dirs, got ${entries.join(",")}`);
    // The just-fetched VERSION must be present.
    assert.ok(entries.includes(`ui-v${VERSION}`));
    // The two newest pre-seeded versions (1.2.0, 1.3.0) must also be present.
    assert.ok(entries.includes("ui-v1.3.0"));
    assert.ok(entries.includes("ui-v1.2.0"));
    // The oldest two (1.0.0, 1.1.0) must be gone.
    assert.ok(!entries.includes("ui-v1.0.0"));
    assert.ok(!entries.includes("ui-v1.1.0"));
  });
});

// ---------------------------------------------------------------------------
// 6. Corrupt tarball → throw + cleanup
// ---------------------------------------------------------------------------

describe("ensureUiBundle — corrupt archive", () => {
  test("bytes that pass SHA256 but aren't a valid tar.gz throw cleanly", async () => {
    // Garbage bytes whose advertised SHA matches.
    const junk = Buffer.from("not a tarball at all");
    const sha = sha256Hex(junk);
    const { fetcher } = makeFetcher({
      [BUNDLE_URL]: { status: 200, body: junk },
      [SHA_URL]: {
        status: 200,
        body: Buffer.from(`${sha}  ui-bundle.tar.gz\n`),
      },
    });

    await assert.rejects(
      () => ensureUiBundle({ version: VERSION, cacheRoot, fetcher }),
      /extract|tar|archive|gzip/i,
    );

    // No partial cache dir survives a failed extract.
    const versionDir = path.join(cacheRoot, `ui-v${VERSION}`);
    assert.equal(
      existsSync(versionDir),
      false,
      "failed extract must not leave a partial cache dir",
    );
  });
});

// Silence unused-import lint in case stat ends up redundant.
void stat;
