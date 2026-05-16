// tests/test-handler-helpers.ts
//
// Mock ApplyHandler builders + SSE parsing helpers used by
// tests/server-apply.test.ts. Kept separate from the test file so the same
// fixtures are reusable if later slices add more apply-related tests
// (e.g. a future tests/server-apply-perf.test.ts).
//
// IMPORTANT: this file imports public types only — no server-internal
// helpers. The `ApplyHandler` / `ApplyHandlers` / `ApplyCatalog` types are
// expected to be re-exported from `src/server.ts` (see assumptions block at
// the top of tests/server-apply.test.ts).

import type { ApplyAction, ApplyItemRef } from "../src/api-types.js";

// ---------------------------------------------------------------------------
// Mirror of the public type surface the implementer must expose from
// src/server.ts. Defining it here (rather than re-importing) means the test
// file will fail to *compile* if the implementer ships an incompatible
// surface, which is the intended red signal.
// ---------------------------------------------------------------------------

export type LogLevel = "info" | "warn" | "error";

export interface ApplyHandlerOptions {
  onLog: (line: string, level: LogLevel) => void;
  scope?: "project" | "user";
  lang?: "en" | "zh-CN";
  agent?: "claude" | "codex" | "both";
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
  preset: ApplyHandler;
}

export interface ApplyCatalog {
  workflow: Set<string>;
  skill: Set<string>;
  "recommended-skill": Set<string>;
  plugin: Set<string>;
  preset: Set<string>;
}

// ---------------------------------------------------------------------------
// Handler builders
// ---------------------------------------------------------------------------

/** Resolves immediately with no log lines. */
export function successHandler(): ApplyHandler {
  return async () => {
    /* noop */
  };
}

/** Rejects synchronously with the given Error message. */
export function failHandler(message: string): ApplyHandler {
  return async () => {
    throw new Error(message);
  };
}

/**
 * Resolves or rejects after `ms` milliseconds. If `success === false`,
 * rejects with an Error("delayed-fail-${ms}ms").
 */
export function delayedHandler(ms: number, success = true): ApplyHandler {
  return async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
    if (!success) throw new Error(`delayed-fail-${ms}ms`);
  };
}

/**
 * Emits each (line, level) tuple via onLog in order, then resolves.
 */
export function loggingHandler(
  lines: Array<[string, LogLevel]>,
): ApplyHandler {
  return async (_action, _name, opts) => {
    for (const [line, level] of lines) {
      opts.onLog(line, level);
    }
  };
}

/**
 * Composes a handlers map where every category gets the same backing
 * handler. Useful when a test wants uniform behavior regardless of category.
 */
export function uniformHandlers(h: ApplyHandler): ApplyHandlers {
  return {
    workflow: h,
    skill: h,
    "recommended-skill": h,
    plugin: h,
    preset: h,
  };
}

/**
 * Builds a catalog from a flat list of [category, name] tuples. Sugar so
 * tests don't repeat the 5-key Set boilerplate.
 */
export function makeCatalog(
  entries: Array<[keyof ApplyCatalog, string]>,
): ApplyCatalog {
  const cat: ApplyCatalog = {
    workflow: new Set(),
    skill: new Set(),
    "recommended-skill": new Set(),
    plugin: new Set(),
    preset: new Set(),
  };
  for (const [category, name] of entries) {
    cat[category].add(name);
  }
  return cat;
}

// ---------------------------------------------------------------------------
// SSE parsing
// ---------------------------------------------------------------------------

export interface SSEFrame {
  /** Value of the `id:` field, if present. */
  id?: string;
  /** Value of the `event:` field, if present. */
  event?: string;
  /** Concatenated data lines (joined with "\n"). */
  data: string;
}

/**
 * Streams an HTTP Response body as parsed SSE frames. The async iterator
 * yields one frame per blank-line-terminated block. Stops when the underlying
 * stream closes.
 *
 * Why we don't use EventSource: undici's Response.body is a Web ReadableStream
 * of Uint8Array, and Node has no built-in EventSource. Parsing manually keeps
 * the dependency surface zero and lets us assert on raw bytes (e.g. the token
 * canary test must see the unprocessed byte stream).
 */
export async function* parseSSE(
  res: Response,
): AsyncGenerator<SSEFrame, void, void> {
  const body = res.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE event boundary: blank line (either \n\n or \r\n\r\n).
      let idx: number;
      while ((idx = findFrameEnd(buf)) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx).replace(/^(\r?\n){2}/, "");
        const frame = parseFrame(raw);
        if (frame !== null) yield frame;
      }
    }
    // Flush any trailing frame that lacked the terminating blank line.
    if (buf.trim() !== "") {
      const frame = parseFrame(buf);
      if (frame !== null) yield frame;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

function findFrameEnd(buf: string): number {
  // Returns index of the LAST char before the blank-line terminator, or -1.
  const lf = buf.indexOf("\n\n");
  const crlf = buf.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return -1;
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

function parseFrame(raw: string): SSEFrame | null {
  const out: SSEFrame = { data: "" };
  const dataParts: string[] = [];
  let any = false;
  for (const line of raw.split(/\r?\n/)) {
    if (line === "" || line.startsWith(":")) continue; // comments are ignored
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon);
    let value = line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "id") {
      out.id = value;
      any = true;
    } else if (field === "event") {
      out.event = value;
      any = true;
    } else if (field === "data") {
      dataParts.push(value);
      any = true;
    }
  }
  if (!any) return null;
  out.data = dataParts.join("\n");
  return out;
}

/**
 * Convenience: consume an SSE stream until a frame whose parsed JSON matches
 * the predicate (or the stream closes), and return the full list of frames
 * collected up to that point. Caller is responsible for setting a node:test
 * test-level timeout to bound this.
 */
export async function readSSEUntil(
  res: Response,
  matcher: (frame: SSEFrame, parsed: unknown) => boolean,
): Promise<SSEFrame[]> {
  const collected: SSEFrame[] = [];
  for await (const frame of parseSSE(res)) {
    collected.push(frame);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(frame.data);
    } catch {
      /* ignore non-JSON frames; matcher gets null */
    }
    if (matcher(frame, parsed)) return collected;
  }
  return collected;
}

/**
 * Parses every frame in an SSE response (until close) and returns them.
 */
export async function readAllSSE(res: Response): Promise<SSEFrame[]> {
  const out: SSEFrame[] = [];
  for await (const frame of parseSSE(res)) out.push(frame);
  return out;
}
