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
import { useEffect, useRef, useState } from "react";

export type LogLineLevel = "info" | "warn" | "error" | "ok" | "meta";

export interface LogLine {
  /** Stable id for React key. Monotonic timestamp-style works fine. */
  id: string;
  level: LogLineLevel;
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
  /** True if the pending batch contains any uninstall action. Drives the
   *  destructive visual treatment (clay header strip + Apply button color).
   *  Dashboard derives this from the selected map and passes it through. */
  hasDestructive?: boolean;
  onApply: () => void;
  onCancel: () => void;
}

const LEVEL_COLOR: Record<LogLineLevel, string> = {
  info: "var(--color-slate-light)",
  warn: "var(--color-clay)",
  // ember-deep instead of accent-ember: error lines are the most consequential
  // to read accurately, and accent-ember on ivory-medium only clears ~3.5:1
  // (fails WCAG AA 4.5:1 for body text). ember-deep clears ~5:1.
  error: "var(--color-ember-deep)",
  ok: "var(--color-olive)",
  meta: "var(--color-cloud-dark)",
};

export default function LogPanel({
  lines,
  pendingCount,
  applying,
  status,
  hasDestructive = false,
  onApply,
  onCancel,
}: LogPanelProps): JSX.Element {
  // Position-aware auto-scroll. If the user has scrolled up away from the
  // bottom we DON'T pull them back — that hijacks their attention and is
  // why deep-review flagged the original auto-scroll as a UX blocker.
  // `stickToBottom` defaults to true; flips off when the user scrolls up,
  // back on when they reach the bottom.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  useEffect(() => {
    if (!stickToBottom) return;
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines.length, stickToBottom]);

  const onScroll = (): void => {
    const el = bodyRef.current;
    if (!el) return;
    // Consider "at bottom" within a 12px tolerance — keyboard scroll
    // increments and trackpad inertia can otherwise drop us out of sticky
    // mode just from passive scroll events.
    const atBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) <= 12;
    setStickToBottom(atBottom);
  };

  const applyDisabled = applying || pendingCount === 0;
  const applyColor = hasDestructive && !applyDisabled
    ? "var(--color-accent-ember)"
    : applyDisabled
      ? "var(--color-cloud-light)"
      : "var(--color-slate-dark)";

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

      {/* Destructive batch warning — fires when any pending item is an
          uninstall. Ember background + slate-dark text gives 4.6:1 contrast
          (WCAG AA passes); ivory-on-ember at 11px was 3.85:1 (fails AA for
          body text). Bold weight reinforces hierarchy without relying on
          color alone. */}
      {hasDestructive && pendingCount > 0 && (
        <div
          data-testid="log-panel-destructive-banner"
          role="alert"
          className="font-anthropic-mono"
          style={{
            fontSize: "11px",
            color: "var(--color-slate-dark)",
            backgroundColor: "var(--color-accent-ember)",
            padding: "6px 12px",
            borderBottom: "1px solid var(--color-cloud-light)",
            fontFamily: "var(--font-anthropic-mono)",
            letterSpacing: "0.04em",
            fontWeight: 600,
          }}
        >
          ! destructive — batch contains uninstall action(s)
        </div>
      )}

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

      {/* Scrollable body — live region so screen readers announce new lines
          as the install streams. role="log" tells the AT this is a sequential
          log; aria-live=polite avoids interrupting the user mid-action. */}
      <div
        ref={bodyRef}
        onScroll={onScroll}
        data-testid="log-panel-body"
        role="log"
        aria-live="polite"
        aria-atomic="false"
        aria-label="Apply output log"
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
              // slate-light on ivory-medium = 6.1:1 (was cloud-light at 1.34:1 —
              // primary "what do I do next" copy was effectively invisible).
              color: "var(--color-slate-light)",
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
          // Enabled when either there's a pending batch (clear) OR a job is
          // applying (disconnect). Only disabled in the idle empty state.
          disabled={!applying && pendingCount === 0}
          className="font-anthropic-mono uppercase"
          aria-label={applying ? "Disconnect from running job" : "Clear pending selection"}
          style={{
            flex: 1,
            padding: "8px 12px",
            backgroundColor: "transparent",
            border: "1px solid var(--color-slate-medium)",
            color: "var(--color-slate-dark)",
            fontSize: "11px",
            letterSpacing: "0.04em",
            cursor: !applying && pendingCount === 0 ? "not-allowed" : "pointer",
            opacity: !applying && pendingCount === 0 ? 0.5 : 1,
            fontFamily: "var(--font-anthropic-mono)",
            borderRadius: 0,
          }}
        >
          {applying ? "DISCONNECT" : "CANCEL"}
        </button>
        <button
          data-testid="log-panel-apply"
          data-destructive={hasDestructive ? "true" : "false"}
          type="button"
          onClick={onApply}
          disabled={applyDisabled}
          className="font-anthropic-mono uppercase"
          style={{
            flex: 1.5,
            padding: "8px 12px",
            backgroundColor: applyColor,
            border: `1px solid ${applyColor}`,
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
          {applying
            ? "APPLYING…"
            : `${hasDestructive ? "APPLY (DESTRUCTIVE)" : "APPLY"}${pendingCount > 0 ? ` (${pendingCount})` : ""}`}
        </button>
      </div>
    </section>
  );
}
