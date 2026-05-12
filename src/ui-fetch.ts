// Fetches the Web UI bundle for the current CLI version from GitHub Releases,
// verifies its SHA256, and extracts it into a per-version cache directory.
// Subsequent CLI invocations reuse the cache instead of re-downloading.
//
// Spec: docs/specs/web-ui.md §4.1 (boot), §9 (release pipeline + checksum +
// cache policy). Tests inject a fake `fetcher` so the unit suite never
// touches the network.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { gunzipSync } from "node:zlib";

const RELEASE_BASE = "https://github.com/Ben2pc/auriga-cli/releases/download";
const BUNDLE_FILE = "ui-bundle.tar.gz";
const SHA_FILE = "ui-bundle.sha256";

/** How many cached versions to keep before LRU-evicting older ones. */
const CACHE_KEEP_COUNT = 3;

export interface UiFetchResponse {
  status: number;
  body: Buffer;
}

export type UiFetcher = (url: string) => Promise<UiFetchResponse>;

export interface EnsureUiBundleOptions {
  /** CLI version, e.g. "1.15.0". Used both in the cache path and the URL. */
  version: string;
  /** Root for cached bundles. Defaults to `~/.cache/auriga-cli`. */
  cacheRoot?: string;
  /** Injectable network function. Tests pass a fake; CLI omits and gets the
   *  built-in https fetcher. */
  fetcher?: UiFetcher;
  /** Optional progress sink so the CLI / server SSE can stream lines. */
  onLog?: (line: string) => void;
}

/**
 * Resolve / populate the per-version cache dir; return its absolute path.
 *
 * Algorithm:
 *   1. If `<cacheRoot>/ui-v<version>/index.html` exists → cache hit, return.
 *   2. Fetch tar.gz + .sha256 in parallel; verify hash.
 *   3. Extract to a sibling tmp dir; rename atomically into place.
 *   4. Evict older versions beyond CACHE_KEEP_COUNT.
 *
 * Any failure path cleans up its own scratch state and rejects with a
 * descriptive Error so the CLI can surface "try `npx auriga-cli`" guidance.
 */
export async function ensureUiBundle(
  opts: EnsureUiBundleOptions,
): Promise<string> {
  const cacheRoot = opts.cacheRoot ?? defaultCacheRoot();
  const versionDir = path.join(cacheRoot, `ui-v${opts.version}`);
  const fetcher = opts.fetcher ?? builtinHttpsFetcher;
  const emit = (line: string): void => opts.onLog?.(line);

  // 1. Cache hit.
  if (existsSync(path.join(versionDir, "index.html"))) {
    emit(`ui bundle cache hit: ${versionDir}`);
    return versionDir;
  }

  await mkdir(cacheRoot, { recursive: true });

  // 2. Fetch.
  const bundleUrl = `${RELEASE_BASE}/v${opts.version}/${BUNDLE_FILE}`;
  const shaUrl = `${RELEASE_BASE}/v${opts.version}/${SHA_FILE}`;
  emit(`fetching ${bundleUrl}`);
  const [bundleRes, shaRes] = await Promise.all([
    fetcher(bundleUrl),
    fetcher(shaUrl),
  ]);
  if (bundleRes.status !== 200) {
    throw new Error(
      `ui bundle download failed: HTTP ${bundleRes.status} ${bundleUrl}`,
    );
  }
  if (shaRes.status !== 200) {
    throw new Error(
      `ui bundle SHA256 download failed: HTTP ${shaRes.status} ${shaUrl}`,
    );
  }
  const expectedHash = parseShaFile(shaRes.body.toString("utf8"));
  const actualHash = createHash("sha256").update(bundleRes.body).digest("hex");
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error(
      `ui bundle SHA256 mismatch: expected ${expectedHash}, got ${actualHash}`,
    );
  }
  emit(`sha256 verified (${actualHash.slice(0, 12)}…)`);

  // 3. Extract to a sibling scratch dir.
  const scratch = await mkdtemp(path.join(cacheRoot, `.ui-extract-`));
  try {
    // Verify gzip header before paying for `tar` — gives a clearer error.
    let raw: Buffer;
    try {
      raw = gunzipSync(bundleRes.body);
    } catch (err) {
      throw new Error(
        `ui bundle gzip decode failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const tarPath = path.join(scratch, "bundle.tar");
    await writeFile(tarPath, raw);
    await extractTar(tarPath, scratch);
    // Sanity: extracted contents must include an `index.html` somewhere
    // immediately under scratch. tar archives created with `tar -czf …
    // -C dist .` place files at the root; some manual archives nest under
    // a subdir. Handle both.
    const indexLoc = await findIndexHtml(scratch);
    if (!indexLoc) {
      throw new Error("ui bundle archive missing index.html");
    }
    const extractRoot = path.dirname(indexLoc);
    // 4. Atomic move into the per-version dir. If versionDir already exists
    //    (race with another invocation), prefer the existing one.
    try {
      await rename(extractRoot, versionDir);
    } catch (err) {
      if (existsSync(versionDir)) {
        // Lost the race — somebody else extracted. Use theirs.
        emit(`cache populated concurrently; reusing ${versionDir}`);
      } else {
        throw err;
      }
    }
  } catch (err) {
    await rm(scratch, { recursive: true, force: true });
    // Defensive: make sure versionDir doesn't survive partial state.
    await rm(versionDir, { recursive: true, force: true });
    throw err;
  } finally {
    // Best-effort scratch cleanup; the rename above usually consumed it.
    await rm(scratch, { recursive: true, force: true });
  }

  await evictOldCacheDirs(cacheRoot, opts.version);
  return versionDir;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultCacheRoot(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? tmpdir();
  return path.join(home, ".cache", "auriga-cli");
}

function parseShaFile(text: string): string {
  // `shasum -a 256` output: `<hex>  <filename>\n`. We accept either the bare
  // 64-char hex string (e.g. produced by `openssl dgst -sha256 | head`) or
  // the `<hex>  <file>` form.
  const trimmed = text.trim();
  const m = /^([0-9a-fA-F]{64})\b/.exec(trimmed);
  if (!m) {
    throw new Error(`ui bundle SHA256 file is not parseable: ${trimmed.slice(0, 80)}`);
  }
  return m[1];
}

/** Spawn `tar -xf` to extract into `dest`. Throws on non-zero exit. */
function extractTar(tarPath: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("tar", ["-xf", tarPath, "-C", dest], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderrChunks: Buffer[] = [];
    proc.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const msg = Buffer.concat(stderrChunks).toString("utf8").trim();
        reject(
          new Error(
            `ui bundle tar extract failed (exit ${code}): ${msg || "(no stderr)"}`,
          ),
        );
      }
    });
  });
}

/** Locate `index.html` under `root` (depth ≤ 2). Returns absolute path or null. */
async function findIndexHtml(root: string): Promise<string | null> {
  const direct = path.join(root, "index.html");
  if (existsSync(direct)) return direct;
  const entries = await readdir(root, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const nested = path.join(root, e.name, "index.html");
    if (existsSync(nested)) return nested;
  }
  return null;
}

/** Built-in fetcher using Node's https client. Follows one redirect (GitHub
 *  Release assets bounce through a signed objects URL). Buffers the whole
 *  response — bundles are well under 5 MB. */
async function builtinHttpsFetcher(url: string): Promise<UiFetchResponse> {
  return await new Promise((resolve, reject) => {
    let redirectsLeft = 5;
    const go = (target: string): void => {
      const u = new URL(target);
      const fn = u.protocol === "http:" ? httpRequest : httpsRequest;
      const req = fn(u, { method: "GET" }, (res) => {
        const status = res.statusCode ?? 0;
        if (
          [301, 302, 303, 307, 308].includes(status) &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          redirectsLeft--;
          res.resume();
          const next = new URL(res.headers.location, target).toString();
          go(next);
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status, body: Buffer.concat(chunks) }),
        );
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end();
    };
    go(url);
  });
}

/** Keep at most CACHE_KEEP_COUNT `ui-v*` dirs (newest by mtime). The
 *  just-fetched version is always retained. */
async function evictOldCacheDirs(
  cacheRoot: string,
  currentVersion: string,
): Promise<void> {
  const all = await readdir(cacheRoot, { withFileTypes: true });
  const versionDirs = all.filter(
    (e) => e.isDirectory() && e.name.startsWith("ui-v"),
  );
  if (versionDirs.length <= CACHE_KEEP_COUNT) return;

  const withMtime: Array<{ name: string; mtime: number }> = await Promise.all(
    versionDirs.map(async (d) => {
      const s = await stat(path.join(cacheRoot, d.name));
      return { name: d.name, mtime: s.mtimeMs };
    }),
  );
  withMtime.sort((a, b) => b.mtime - a.mtime); // newest first

  const keep = new Set<string>();
  keep.add(`ui-v${currentVersion}`);
  for (const entry of withMtime) {
    if (keep.size >= CACHE_KEEP_COUNT) break;
    keep.add(entry.name);
  }
  for (const entry of withMtime) {
    if (!keep.has(entry.name)) {
      await rm(path.join(cacheRoot, entry.name), {
        recursive: true,
        force: true,
      });
    }
  }
}
