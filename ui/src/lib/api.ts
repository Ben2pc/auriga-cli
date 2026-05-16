// API helpers for the Dashboard.
//
// Maps to docs/architecture/web-ui.md §6 ("数据流与 API 设计"):
//
//  - Token discovery: URL `?token=<hex>` on first load → sessionStorage so a
//    page refresh keeps the same session without losing the token from the
//    location bar (the auriga-cli launcher prints the URL once; users will
//    bookmark / reload).
//  - All `/api/*` requests carry `Authorization: Bearer <token>` per §6.1.
//    The same-origin Origin check is satisfied automatically by the browser.
//  - SSE wiring (`openProgress`) is a stub here — slice M3 wires the real
//    event pump. Keeping the contract stable now so Dashboard can be tested
//    without future churn.

import type {
  ApplyRequest,
  ApplyResponse,
  ProgressEvent as ApiProgressEvent,
  StateReport,
} from "../../../src/api-types.js";

const SESSION_TOKEN_KEY = "auriga-cli:api-token";

/**
 * Returns the API token to attach to subsequent `/api/*` calls.
 *
 * Resolution order (per §6 contract):
 *   1. `?token=<hex>` query string on the current page URL (first paint after
 *      the launcher hands the user a deep-link).
 *   2. `sessionStorage` (subsequent reloads in the same tab).
 *
 * When a fresh URL-supplied token is seen, it is also persisted to
 * sessionStorage so reload-without-querystring keeps working. Returns `null`
 * if neither source has a token — the UI should surface an unauthorized
 * banner rather than fire `Authorization: Bearer null`.
 */
export function getApiToken(): string | null {
  // Guard: SSR / non-browser test envs without `window`.
  if (typeof window === "undefined") return null;

  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("token");
    if (fromUrl && fromUrl.length > 0) {
      try {
        window.sessionStorage.setItem(SESSION_TOKEN_KEY, fromUrl);
      } catch {
        // sessionStorage may be unavailable (privacy mode, jsdom config) —
        // we still return the URL-sourced token so the current request works.
      }
      return fromUrl;
    }
  } catch {
    // Malformed URL — fall through to sessionStorage.
  }

  try {
    const fromStorage = window.sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (fromStorage && fromStorage.length > 0) return fromStorage;
  } catch {
    // sessionStorage unavailable.
  }

  return null;
}

function authHeaders(): HeadersInit {
  const token = getApiToken();
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token !== null) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

/**
 * GET /api/state — fetch the live `StateReport` for the current cwd.
 *
 * `scopes` is the per-category scope the UI is currently showing
 * (workflow / skills / plugins each "user" | "project"). When
 * provided, serialized into the `scopes` query param as a comma-separated
 * `cat:scope` list. Omit the param to let the server fall back to its
 * built-in defaults (workflow=project, skills=project, plugins=user —
 * matches `claude plugins install` default).
 *
 * Throws on non-2xx so callers can surface an error banner with the status
 * code rather than silently rendering empty categories.
 */
export async function fetchState(scopes?: Partial<{
  workflow: "user" | "project";
  skills: "user" | "project";
  plugins: "user" | "project";
}>): Promise<StateReport> {
  const url = scopes && Object.keys(scopes).length > 0
    ? `/api/state?scopes=${encodeURIComponent(
        Object.entries(scopes)
          .filter(([, v]) => v === "user" || v === "project")
          .map(([k, v]) => `${k}:${v}`)
          .join(","),
      )}`
    : "/api/state";
  const res = await fetch(url, {
    method: "GET",
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`fetchState failed: ${res.status}`);
  }
  return (await res.json()) as StateReport;
}

/**
 * POST /api/apply — submit a batch. Server returns `{ jobId }` immediately
 * (202); the actual work streams over `/api/progress?jobId=...` via SSE.
 *
 * M1 server returns a placeholder `{ jobId: "placeholder" }`. M3 wires
 * actual job dispatch; the type contract is stable.
 */
export async function submitApply(req: ApplyRequest): Promise<ApplyResponse> {
  const res = await fetch("/api/apply", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(`submitApply failed: ${res.status}`);
  }
  return (await res.json()) as ApplyResponse;
}

/**
 * POST /api/ping — bumps the server-side `lastPingAt` heartbeat so the
 * 2-minute idle-shutdown timer doesn't fire while the tab is open. The
 * Dashboard fires this every 5 seconds.
 *
 * Failures here are non-fatal; we deliberately don't throw because a
 * transient ping failure shouldn't tear down the dashboard.
 */
export async function ping(): Promise<void> {
  try {
    await fetch("/api/ping", {
      method: "POST",
      headers: authHeaders(),
    });
  } catch {
    // Swallow — heartbeat is best-effort.
  }
}

/**
 * Open an SSE connection to `/api/progress?jobId=...`.
 *
 * **v0.1 stub** — M3 wires the real `EventSource` flow with reconnection,
 * `Last-Event-ID` resume, and JSON-per-event parsing. Today we just open the
 * connection so the URL pattern + auth attach point are correct, and return
 * a `close()` handle the caller can wire to the cancel/unmount path.
 *
 * The token has to ride on the query string because the browser
 * `EventSource` API doesn't expose request headers — the server's auth
 * middleware accepts `?token=<hex>` as an alternate channel (and rejects
 * smuggling per A6: header + query must agree if both present).
 */
export function openProgress(
  jobId: string,
  onEvent: (e: ApiProgressEvent) => void,
): { close: () => void } {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    // Non-browser env — return a no-op so unit tests can call this safely.
    return { close: () => undefined };
  }

  const token = getApiToken();
  const params = new URLSearchParams({ jobId });
  if (token !== null) params.set("token", token);
  const url = `/api/progress?${params.toString()}`;

  const source = new EventSource(url);
  // Server only emits named `event: progress` frames (see server.ts emit());
  // the default `message` channel never fires, so we only listen on `progress`.
  source.addEventListener("progress", (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data) as ApiProgressEvent;
      onEvent(data);
    } catch {
      // Ignore malformed frames.
    }
  });

  return {
    close: () => source.close(),
  };
}
