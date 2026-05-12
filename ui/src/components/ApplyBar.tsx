// ApplyBar — sticky bottom action bar. Maps to docs/specs/web-ui.md §12.3
// + §13.5. Carries the signature asymmetric-radius primary CTA from
// DESIGN.md §"Primary Nav Button (Try Claude)".
//
// Visual rules:
//   - Surface --color-ivory-light, padding 16px.
//   - 1px solid top border. Default = --color-slate-dark; when there are
//     pending actions, the top border switches to --color-clay to draw the
//     eye (the only chromatic accent in the dashboard).
//   - pendingActions.length === 0 → component returns null (not rendered).
//   - pendingActions.length > 0 → slides in from below with
//     transform translateY(0 → 100%) over 120ms ease-out (handled via CSS
//     transition; the parent decides when to mount/unmount).
//
// Button mapping (DESIGN.md):
//   - Cancel  → Ghost Nav Button (transparent bg, 1px solid slate-dark, 0px
//     radius, padding 22px 12px, Sans 15/400)
//   - Apply   → Primary Nav Button (ivory-light bg, slate-dark text, 1px
//     solid slate-dark border, **borderRadius 0 0 8px 8px** — flat top,
//     rounded bottom — signature element; padding 12px 31px; Sans 15/500)
//
// The asymmetric-radius signature is the load-bearing visual detail. Tests
// assert it via data attribute + inline-style computed value to prevent
// regression.

import type { JSX } from "react";

export type ApplyAction = "install" | "update" | "uninstall";

export interface PendingAction {
  category: string;
  name: string;
  action: ApplyAction;
}

export interface ApplyBarProps {
  pendingActions: PendingAction[];
  onCancel: () => void;
  onApply: () => void;
  applying?: boolean;
}

function summarize(actions: PendingAction[]): string {
  const counts = { install: 0, update: 0, uninstall: 0 };
  for (const a of actions) counts[a.action] += 1;
  const parts: string[] = [];
  if (counts.update > 0) parts.push(`${counts.update} update`);
  if (counts.install > 0) parts.push(`${counts.install} install`);
  if (counts.uninstall > 0) parts.push(`${counts.uninstall} uninstall`);
  const total = actions.length;
  const noun = total === 1 ? "change" : "changes";
  return `${total} ${noun} (${parts.join(" / ")})`;
}

export default function ApplyBar({
  pendingActions,
  onCancel,
  onApply,
  applying = false,
}: ApplyBarProps): JSX.Element | null {
  if (pendingActions.length === 0) {
    return null;
  }

  const hasPending = pendingActions.length > 0;
  const topBorderColor = hasPending
    ? "var(--color-clay)"
    : "var(--color-slate-dark)";

  return (
    <div
      data-testid="applybar"
      data-pending-count={pendingActions.length}
      data-applying={applying}
      role="region"
      aria-label="Pending changes"
      style={{
        backgroundColor: "var(--color-ivory-light)",
        padding: "16px var(--spacing-32)",
        borderTop: `1px solid ${topBorderColor}`,
        // Transform-based slide-in. Parent mounts the component when
        // pendingActions transitions 0 → >0, the CSS transition handles the
        // visual slide.
        transform: "translateY(0)",
        transition: "transform 120ms ease-out, border-top-color 80ms ease-out",
      }}
    >
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-16">
        <span
          data-testid="applybar-summary"
          className="font-anthropic-sans text-slate-dark"
          style={{
            fontSize: "15px",
            fontWeight: 500,
            lineHeight: "var(--leading-body-sm)",
          }}
        >
          {summarize(pendingActions)}
        </span>

        <div className="flex items-center gap-16">
          {/* Ghost: Cancel */}
          <button
            type="button"
            data-testid="applybar-cancel"
            onClick={onCancel}
            disabled={applying}
            className="font-anthropic-sans"
            style={{
              backgroundColor: "transparent",
              color: applying
                ? "var(--color-cloud-medium)"
                : "var(--color-slate-dark)",
              border: `1px solid ${
                applying
                  ? "var(--color-cloud-medium)"
                  : "var(--color-slate-dark)"
              }`,
              borderRadius: "0px",
              padding: "22px 12px",
              fontSize: "15px",
              fontWeight: 400,
              lineHeight: 1,
              cursor: applying ? "not-allowed" : "pointer",
              outlineColor: "var(--color-slate-medium)",
              outlineOffset: "2px",
              transition: "color 80ms ease-out, border-color 80ms ease-out",
            }}
          >
            Cancel
          </button>

          {/* Primary: Apply — signature asymmetric radius */}
          <button
            type="button"
            data-testid="applybar-apply"
            data-asymmetric-radius="0 0 8px 8px"
            onClick={onApply}
            disabled={applying}
            className="font-anthropic-sans"
            style={{
              backgroundColor: "var(--color-ivory-light)",
              color: applying
                ? "var(--color-cloud-medium)"
                : "var(--color-slate-dark)",
              border: `1px solid ${
                applying
                  ? "var(--color-cloud-medium)"
                  : "var(--color-slate-dark)"
              }`,
              // Signature: 0px top corners, 8px bottom corners.
              borderRadius: "0 0 8px 8px",
              padding: "12px 31px",
              fontSize: "15px",
              fontWeight: 500,
              lineHeight: 1,
              cursor: applying ? "not-allowed" : "pointer",
              outlineColor: "var(--color-slate-medium)",
              outlineOffset: "2px",
              transition: "color 80ms ease-out, border-color 80ms ease-out",
            }}
          >
            {applying ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
