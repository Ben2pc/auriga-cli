// StateCard — the three-state badge card. Maps to docs/architecture/web-ui.md
// §13.4 (visual encoding) + §13.5 (Release Card mapping). This is the
// visual-encoding centerpiece of the entire UI: status is conveyed by the
// combination of uppercase Mono badge text + card background level, with
// zero chip/pill/capsule chrome.
//
// Encoding table (from spec §13.4):
//
//   status            | badge text         | text color           | card bg
//   ------------------|--------------------|----------------------|-----------------
//   installed         | INSTALLED          | --color-cloud-dark   | --color-ivory-light
//   update-available  | UPDATE AVAILABLE   | --color-clay         | --color-ivory-medium
//   not-installed     | NOT INSTALLED      | --color-cloud-medium | --color-ivory-light
//   error             | ERROR              | --color-accent-ember | --color-ivory-medium
//
// Hard rules:
//   - Badges are pure typographic — NO background, NO border, NO radius.
//   - Card radius = --radius-cards (8px), padding = --spacing-32 (31px in spec).
//   - No box-shadow, no hover-transform/scale.
//   - Focus ring uses --color-slate-medium outline (DESIGN.md polish §13.6).
//   - Checkbox is restyled to 0px radius square; filled state = slate-dark.
//   - Card is interactive: clicking anywhere (except disabled regions) toggles
//     selected. Keyboard: Enter / Space on the card itself toggles selected.
//
// The status data-attribute (`data-status="..."`) is the test-stable hook —
// tests assert encoding via attributes rather than computed-style color
// matching, but each status value is independently visible via getComputedStyle
// on the badge if a polish-phase visual regression test wants it.

import type { JSX, KeyboardEvent, MouseEvent } from "react";

export type CardStatus =
  | "installed"
  | "update-available"
  | "not-installed"
  | "error";

export interface StateCardProps {
  name: string;
  description: string;
  status: CardStatus;
  currentVersion?: string;
  expectedVersion?: string;
  currentHash?: string;
  expectedHash?: string;
  selected: boolean;
  onSelectChange: (selected: boolean) => void;
  // Reserved for the uninstall affordance — surfaced visually via a small
  // marker but the modal confirmation lives at the Dashboard / ApplyBar layer
  // (out of scope for this component).
  uninstallable?: boolean;
}

interface StatusVisual {
  label: string;
  badgeColor: string;
  cardBackground: string;
}

const STATUS_VISUALS: Record<CardStatus, StatusVisual> = {
  installed: {
    label: "INSTALLED",
    badgeColor: "var(--color-cloud-dark)",
    cardBackground: "var(--color-ivory-light)",
  },
  "update-available": {
    label: "UPDATE AVAILABLE",
    badgeColor: "var(--color-clay)",
    cardBackground: "var(--color-ivory-medium)",
  },
  "not-installed": {
    label: "NOT INSTALLED",
    badgeColor: "var(--color-cloud-medium)",
    cardBackground: "var(--color-ivory-light)",
  },
  error: {
    label: "ERROR",
    badgeColor: "var(--color-accent-ember)",
    cardBackground: "var(--color-ivory-medium)",
  },
};

function shortHash(hash: string | undefined): string | undefined {
  if (!hash) return undefined;
  return hash.slice(0, 8);
}

export default function StateCard({
  name,
  description,
  status,
  currentVersion,
  expectedVersion,
  currentHash,
  expectedHash,
  selected,
  onSelectChange,
  uninstallable = false,
}: StateCardProps): JSX.Element {
  const visual = STATUS_VISUALS[status];

  const handleCardClick = (e: MouseEvent<HTMLDivElement>) => {
    // If the click originated inside the checkbox itself, let the input's
    // own onChange fire (we'd otherwise double-toggle).
    const target = e.target as HTMLElement;
    if (target.closest('[data-testid="statecard-checkbox"]')) {
      return;
    }
    onSelectChange(!selected);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectChange(!selected);
    }
  };

  // Version diff text — preferred shape: vX → vY for versions, hash short
  // form for skill / hook hash comparison. We show this only for
  // "update-available" status; other statuses show just the current version
  // (if available) as a metadata caption.
  const versionDiff = (() => {
    if (status !== "update-available") return null;
    if (currentVersion && expectedVersion) {
      return `${currentVersion} → ${expectedVersion}`;
    }
    if (currentHash && expectedHash) {
      return `${shortHash(currentHash)} → ${shortHash(expectedHash)}`;
    }
    return null;
  })();

  // For installed / not-installed: caption shows only the current version
  // if present (e.g. "v1.6.0"). Hash-only entries are intentionally omitted
  // from the caption — they're noisy without a delta.
  const captionVersion =
    status !== "update-available" && currentVersion ? currentVersion : null;

  return (
    <div
      data-testid="statecard"
      data-status={status}
      data-selected={selected}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${name} (${visual.label.toLowerCase()})`}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      className="font-anthropic-sans text-slate-dark cursor-pointer focus:outline-none"
      style={{
        backgroundColor: visual.cardBackground,
        borderRadius: "var(--radius-cards)",
        padding: "var(--spacing-32)",
        // Focus ring per DESIGN.md polish guidance (§13.6, light surface).
        // We attach it via outline on :focus-visible — set via inline class
        // chain below.
        outline: "none",
        // Subtle 1px hairline so cards on the same surface as the page (e.g.
        // installed / not-installed on --color-ivory-light) don't blend
        // entirely with the background. Border color stays achromatic.
        border:
          visual.cardBackground === "var(--color-ivory-light)"
            ? "1px solid var(--color-cloud-light)"
            : "1px solid transparent",
        // Smooth color-only transition per spec §13.6 — no transform/scale.
        transition: "background-color 80ms ease-out, border-color 80ms ease-out",
      }}
      onFocus={(e) => {
        (e.currentTarget as HTMLElement).style.outline =
          "2px solid var(--color-slate-medium)";
        (e.currentTarget as HTMLElement).style.outlineOffset = "2px";
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLElement).style.outline = "none";
        (e.currentTarget as HTMLElement).style.outlineOffset = "0";
      }}
    >
      <div className="flex items-start gap-16">
        {/* Restyled checkbox — appearance-none, 0px radius square, slate-dark
            fill on checked. Keep it semantically a real <input> for a11y. */}
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelectChange(e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          data-testid="statecard-checkbox"
          aria-label={`Select ${name}`}
          style={{
            appearance: "none",
            WebkitAppearance: "none",
            MozAppearance: "none",
            width: "16px",
            height: "16px",
            borderRadius: "0px",
            border: "1px solid var(--color-slate-dark)",
            backgroundColor: selected
              ? "var(--color-slate-dark)"
              : "transparent",
            backgroundImage: selected
              ? `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23faf9f5' stroke-width='2.5'><path d='M3 8.5l3.5 3.5L13 4.5'/></svg>")`
              : "none",
            backgroundSize: "16px 16px",
            backgroundRepeat: "no-repeat",
            flexShrink: 0,
            marginTop: "4px",
            cursor: "pointer",
            outlineColor: "var(--color-slate-medium)",
            outlineOffset: "2px",
          }}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-16">
            <h3
              data-testid="statecard-name"
              className="font-anthropic-sans text-slate-dark"
              style={{
                fontSize: "20px",
                lineHeight: "var(--leading-heading-sm)",
                fontWeight: 600,
                margin: 0,
                wordBreak: "break-word",
              }}
            >
              {name}
            </h3>
            <span
              data-testid="statecard-badge"
              data-status={status}
              className="font-anthropic-mono uppercase shrink-0"
              style={{
                fontSize: "12px",
                lineHeight: 1.3,
                fontFamily: "var(--font-anthropic-mono)",
                color: visual.badgeColor,
                // Hard rules: NO background, NO border, NO radius. Pure text.
                backgroundColor: "transparent",
                border: "none",
                borderRadius: "0px",
                padding: 0,
                letterSpacing: "0.04em",
                fontWeight: 400,
              }}
            >
              {visual.label}
            </span>
          </div>
          <p
            data-testid="statecard-description"
            className="text-slate-light"
            style={{
              marginTop: "var(--spacing-8)",
              marginBottom: 0,
              fontSize: "15px",
              lineHeight: "var(--leading-body-sm)",
              color: "var(--color-slate-light)",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
          >
            {description}
          </p>

          {(versionDiff || captionVersion || uninstallable) && (
            <div
              data-testid="statecard-meta"
              className="font-anthropic-mono"
              style={{
                marginTop: "var(--spacing-16)",
                fontSize: "12px",
                lineHeight: 1.3,
                fontFamily: "var(--font-anthropic-mono)",
                color: "var(--color-cloud-dark)",
                display: "flex",
                gap: "var(--spacing-16)",
                flexWrap: "wrap",
              }}
            >
              {versionDiff && (
                <span data-testid="statecard-version-diff">{versionDiff}</span>
              )}
              {captionVersion && (
                <span data-testid="statecard-version">{captionVersion}</span>
              )}
              {uninstallable && (
                <span data-testid="statecard-uninstallable">REMOVABLE</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
