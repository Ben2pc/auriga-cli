// StateCard — compact dashboard row. Reworked from the original tall card
// layout (~120px per item) to a denser table-style row (~40px) so a typical
// project's 5 categories × ~5–10 items fit in one viewport without scroll.
//
// Layout (horizontal, single visible row):
//
//   [✓]  ●   name           description (truncated)         meta      STATUS
//   ────────────────────────────────────────────────────────────────────────
//        ↑                                                  ↑         ↑
//        status indicator                                   ver diff  badge
//
// Status encoding (single-source data-status attribute drives both the dot
// color and the badge text):
//   installed         → olive dot      | INSTALLED
//   update-available  → clay dot       | UPDATE
//   not-installed     → cloud-medium   | NOT INSTALLED
//   error             → ember dot      | ERROR
//
// Hard rules carried over from the previous design:
//   - Badge is pure typography — no background, no border, no radius.
//   - Status dot is a chromatic accent (one of clay / olive / ember / cloud).
//   - Whole row is interactive (click anywhere off the checkbox to toggle).
//   - Keyboard: Enter / Space on the row toggles selection.
//   - Focus ring: 2px slate-medium outline (DESIGN.md polish §13.6).
//
// Stable data-testids preserved so the existing RTL suite keeps passing:
//   statecard, statecard-checkbox, statecard-name, statecard-description,
//   statecard-badge, statecard-meta, statecard-version-diff, statecard-version,
//   statecard-uninstallable.

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
  // marker but the modal confirmation lives at the Dashboard / ApplyBar layer.
  uninstallable?: boolean;
}

interface StatusVisual {
  label: string;
  badgeColor: string;
  dotColor: string;
}

const STATUS_VISUALS: Record<CardStatus, StatusVisual> = {
  installed: {
    label: "INSTALLED",
    badgeColor: "var(--color-cloud-dark)",
    dotColor: "var(--color-olive)",
  },
  "update-available": {
    label: "UPDATE",
    badgeColor: "var(--color-clay)",
    dotColor: "var(--color-clay)",
  },
  "not-installed": {
    label: "NOT INSTALLED",
    badgeColor: "var(--color-cloud-medium)",
    dotColor: "var(--color-cloud-light)",
  },
  error: {
    label: "ERROR",
    badgeColor: "var(--color-accent-ember)",
    dotColor: "var(--color-accent-ember)",
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

  const handleRowClick = (e: MouseEvent<HTMLDivElement>) => {
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

  const captionVersion =
    status !== "update-available" && currentVersion ? currentVersion : null;

  // Background: selected wins, then a subtle alternating shade on hover
  // is provided by CSS (defined inline as data-attribute-driven).
  const rowBg = selected
    ? "var(--color-ivory-medium)"
    : "transparent";

  return (
    <div
      data-testid="statecard"
      data-status={status}
      data-selected={selected}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${name} (${visual.label.toLowerCase()})`}
      onClick={handleRowClick}
      onKeyDown={handleKeyDown}
      className="group cursor-pointer focus:outline-none"
      style={{
        display: "grid",
        gridTemplateColumns: "16px 8px minmax(140px, 220px) minmax(0, 1fr) auto auto",
        alignItems: "center",
        gap: "12px",
        padding: "8px 12px",
        minHeight: "40px",
        backgroundColor: rowBg,
        borderTop: "1px solid var(--color-cloud-light)",
        outline: "none",
        transition: "background-color 80ms ease-out",
      }}
      onMouseEnter={(e) => {
        if (!selected) {
          (e.currentTarget as HTMLElement).style.backgroundColor =
            "var(--color-ivory-medium)";
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
        }
      }}
      onFocus={(e) => {
        (e.currentTarget as HTMLElement).style.outline =
          "2px solid var(--color-slate-medium)";
        (e.currentTarget as HTMLElement).style.outlineOffset = "-2px";
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLElement).style.outline = "none";
        (e.currentTarget as HTMLElement).style.outlineOffset = "0";
      }}
    >
      {/* Column 1: checkbox */}
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
          width: "14px",
          height: "14px",
          borderRadius: "0px",
          border: "1px solid var(--color-slate-dark)",
          backgroundColor: selected ? "var(--color-slate-dark)" : "transparent",
          backgroundImage: selected
            ? `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23faf9f5' stroke-width='2.5'><path d='M3 8.5l3.5 3.5L13 4.5'/></svg>")`
            : "none",
          backgroundSize: "14px 14px",
          backgroundRepeat: "no-repeat",
          cursor: "pointer",
          outlineColor: "var(--color-slate-medium)",
          outlineOffset: "2px",
          margin: 0,
        }}
      />

      {/* Column 2: status dot (chromatic accent) */}
      <span
        aria-hidden="true"
        data-testid="statecard-status-dot"
        style={{
          display: "inline-block",
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          backgroundColor: visual.dotColor,
        }}
      />

      {/* Column 3: name (mono, monospace-feel, fixed width range) */}
      <h3
        data-testid="statecard-name"
        className="text-slate-dark"
        style={{
          fontSize: "13px",
          lineHeight: 1.3,
          fontWeight: 600,
          margin: 0,
          fontFamily: "var(--font-anthropic-mono)",
          letterSpacing: "0",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={name}
      >
        {name}
      </h3>

      {/* Column 4: description (flex-grow, truncated) */}
      <p
        data-testid="statecard-description"
        className="text-slate-light font-anthropic-sans"
        style={{
          fontSize: "13px",
          lineHeight: 1.4,
          color: "var(--color-slate-light)",
          margin: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={description}
      >
        {description}
      </p>

      {/* Column 5: meta (version diff / version / uninstallable) */}
      <div
        data-testid="statecard-meta"
        className="font-anthropic-mono"
        style={{
          fontSize: "11px",
          lineHeight: 1.3,
          fontFamily: "var(--font-anthropic-mono)",
          color: "var(--color-cloud-dark)",
          display: "flex",
          gap: "12px",
          whiteSpace: "nowrap",
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

      {/* Column 6: badge (uppercase mono, right-anchored) */}
      <span
        data-testid="statecard-badge"
        data-status={status}
        className="font-anthropic-mono uppercase"
        style={{
          fontSize: "11px",
          lineHeight: 1.3,
          fontFamily: "var(--font-anthropic-mono)",
          color: visual.badgeColor,
          backgroundColor: "transparent",
          border: "none",
          borderRadius: "0px",
          padding: 0,
          letterSpacing: "0.04em",
          fontWeight: 500,
          whiteSpace: "nowrap",
        }}
      >
        {visual.label}
      </span>
    </div>
  );
}
