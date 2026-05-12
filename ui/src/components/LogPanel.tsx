// LogPanel — the right-rail "OUTPUT" column. Replaces the bottom ApplyBar.
//
// Layout (vertical):
//
//   ┌──────────────────────┐
//   │ OUTPUT      (N)      │  ← column header (count = pending items)
//   ├──────────────────────┤
//   │ [item:start] alpha   │  ← scrollable log buffer (mono, line-by-line)
//   │ [info]     downloaded│
//   │ [done] alpha ✓       │
//   │ ...                  │
//   ├──────────────────────┤
//   │ Project · 3 items    │  ← brief summary of what's pending
//   │ [Cancel]  [Apply (3)]│  ← buttons at the bottom
//   └──────────────────────┘
//
// SSE flow lives in Dashboard.tsx; this component only renders the
// already-formatted lines plus the action buttons.

import type { JSX } from "react";
import { useEffect, useRef } from "react";

export type LogLevel = "info" | "warn" | "error" | "ok" | "meta";

export interface LogLine {
  /** Stable id for React key. Monotonic timestamp-style works fine. */
  id: string;
  level: LogLevel;
  text: string;
}

export interface LogPanelProps {
  lines: LogLine[];
  /** Pending action count surfaced next to OUTPUT header + APPLY button. */
  pendingCount: number;
  /** Disable Apply during in-flight job; show a spinner-like label. */
  applying: boolean;
  /** Optional banner under the header explaining the in-flight job /
   *  completed status. */
  status?: string;
  onApply: () => void;
  onCancel: () => void;
}

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: "var(--color-slate-light)",
  warn: "var(--color-clay)",
  error: "var(--color-accent-ember)",
  ok: "var(--color-olive)",
  meta: "var(--color-cloud-dark)",
};

export default function LogPanel({
  lines,
  pendingCount,
  applying,
  status,
  onApply,
  onCancel,
}: LogPanelProps): JSX.Element {
  // Auto-scroll the log body to the bottom when new lines arrive so the user
  // always sees the latest event without having to scroll manually.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const applyDisabled = applying || pendingCount === 0;

  return (
    <section
      data-testid="log-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        height: "100%",
        backgroundColor: "var(--color-ivory-light)",
        border: "1px solid var(--color-cloud-light)",
      }}
    >
      {/* Header row */}
      <h2
        data-testid="log-panel-header"
        className="font-anthropic-mono text-cloud-dark uppercase"
        style={{
          fontSize: "11px",
          lineHeight: 1.3,
          fontFamily: "var(--font-anthropic-mono)",
          fontWeight: 500,
          letterSpacing: "0.06em",
          margin: 0,
          padding: "12px 12px 6px 12px",
          borderBottom: "1px solid var(--color-cloud-light)",
          display: "flex",
          alignItems: "baseline",
          gap: "8px",
        }}
      >
        <span>OUTPUT</span>
        {pendingCount > 0 && (
          <span
            data-testid="log-panel-pending-count"
            style={{
              color: "var(--color-cloud-light)",
              fontSize: "11px",
              fontWeight: 400,
            }}
          >
            ({pendingCount})
          </span>
        )}
      </h2>

      {/* Optional status banner */}
      {status && (
        <div
          data-testid="log-panel-status"
          className="font-anthropic-mono"
          style={{
            fontSize: "11px",
            color: "var(--color-slate-light)",
            padding: "6px 12px",
            borderBottom: "1px solid var(--color-cloud-light)",
            fontFamily: "var(--font-anthropic-mono)",
          }}
        >
          {status}
        </div>
      )}

      {/* Scrollable body */}
      <div
        ref={bodyRef}
        data-testid="log-panel-body"
        className="font-anthropic-mono"
        style={{
          flex: 1,
          minHeight: "180px",
          maxHeight: "calc(100vh - 280px)",
          overflowY: "auto",
          padding: "8px 12px",
          fontSize: "11px",
          lineHeight: 1.5,
          fontFamily: "var(--font-anthropic-mono)",
          color: "var(--color-slate-dark)",
          backgroundColor: "var(--color-ivory-medium)",
        }}
      >
        {lines.length === 0 ? (
          <div
            data-testid="log-panel-empty"
            style={{
              color: "var(--color-cloud-light)",
              fontSize: "11px",
              fontStyle: "italic",
            }}
          >
            {pendingCount === 0
              ? "Select items in the columns, then Apply."
              : `${pendingCount} item${pendingCount > 1 ? "s" : ""} pending — click Apply to start.`}
          </div>
        ) : (
          lines.map((line) => (
            <div
              key={line.id}
              data-testid="log-panel-line"
              data-level={line.level}
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                color: LEVEL_COLOR[line.level],
              }}
            >
              {line.text}
            </div>
          ))
        )}
      </div>

      {/* Footer: buttons */}
      <div
        data-testid="log-panel-footer"
        style={{
          display: "flex",
          gap: "6px",
          padding: "10px 12px",
          borderTop: "2px solid var(--color-clay)",
          backgroundColor: "var(--color-ivory-light)",
        }}
      >
        <button
          data-testid="log-panel-cancel"
          type="button"
          onClick={onCancel}
          disabled={pendingCount === 0 || applying}
          className="font-anthropic-mono uppercase"
          style={{
            flex: 1,
            padding: "8px 12px",
            backgroundColor: "transparent",
            border: "1px solid var(--color-slate-medium)",
            color: "var(--color-slate-dark)",
            fontSize: "11px",
            letterSpacing: "0.04em",
            cursor:
              pendingCount === 0 || applying ? "not-allowed" : "pointer",
            opacity: pendingCount === 0 || applying ? 0.5 : 1,
            fontFamily: "var(--font-anthropic-mono)",
            borderRadius: 0,
          }}
        >
          CANCEL
        </button>
        <button
          data-testid="log-panel-apply"
          type="button"
          onClick={onApply}
          disabled={applyDisabled}
          className="font-anthropic-mono uppercase"
          style={{
            flex: 1.5,
            padding: "8px 12px",
            backgroundColor: applyDisabled
              ? "var(--color-cloud-light)"
              : "var(--color-slate-dark)",
            border: "1px solid var(--color-slate-dark)",
            color: "var(--color-ivory-light)",
            fontSize: "11px",
            letterSpacing: "0.04em",
            cursor: applyDisabled ? "not-allowed" : "pointer",
            opacity: applyDisabled ? 0.6 : 1,
            fontWeight: 600,
            fontFamily: "var(--font-anthropic-mono)",
            borderRadius: 0,
          }}
        >
          {applying ? "APPLYING…" : `APPLY${pendingCount > 0 ? ` (${pendingCount})` : ""}`}
        </button>
      </div>
    </section>
  );
}
