// StateCard — compact column-cell. Designed for a Kanban-style 5-column
// dashboard where each category gets its own column and items stack
// vertically inside the column.
//
// Layout (vertical, ~80px tall):
//
//   ┃ [✓] name               ●
//   ┃ description (2 lines, truncated)
//   ┃ STATUS · v1.6.0
//
// Status encoding:
//   - LEFT border stripe (3px) is the chromatic accent — installed=olive,
//     update=clay, not-installed=cloud-light, error=ember.
//   - SMALL dot in the header row mirrors the same color (redundant but
//     scannable from a distance).
//   - BADGE text in the footer is uppercase mono, no background.
//
// Stable data-testids preserved:
//   statecard, statecard-checkbox, statecard-name, statecard-description,
//   statecard-badge, statecard-meta, statecard-version-diff,
//   statecard-version, statecard-uninstallable, statecard-status-dot.

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
  uninstallable?: boolean;
  /** Optional Agent runtimes this item installs into. Only meaningful for
   *  plugins today. When set with one entry the badge reads CLAUDE or
   *  CODEX; with two entries it reads BOTH. Omitted = no badge (the card
   *  doesn't belong to a category where agent split is meaningful, e.g.
   *  workflow / skill / hook). */
  agents?: ("claude" | "codex")[];
  /** True for plugins whose source lives in an upstream marketplace. Adds
   *  an EXTERNAL badge alongside the agent badge to signal "upgrades go
   *  through `claude plugins update`, not us". */
  external?: boolean;
}

interface StatusVisual {
  label: string;
  badgeColor: string;
  accentColor: string;
}

const STATUS_VISUALS: Record<CardStatus, StatusVisual> = {
  installed: {
    label: "INSTALLED",
    badgeColor: "var(--color-cloud-dark)",
    accentColor: "var(--color-olive)",
  },
  "update-available": {
    label: "UPDATE",
    badgeColor: "var(--color-clay)",
    accentColor: "var(--color-clay)",
  },
  "not-installed": {
    label: "NOT INSTALLED",
    // cloud-medium on ivory-light fails WCAG AA (~2.4:1); slate-light
    // clears 4.5:1. cloud-light stripe also failed 3:1 for non-text UI;
    // cloud-dark gives the rail enough presence to read as a status hint.
    badgeColor: "var(--color-slate-light)",
    accentColor: "var(--color-cloud-dark)",
  },
  error: {
    label: "ERROR",
    badgeColor: "var(--color-accent-ember)",
    accentColor: "var(--color-accent-ember)",
  },
};

function shortHash(hash: string | undefined): string | undefined {
  if (!hash) return undefined;
  return hash.slice(0, 8);
}

function agentLabel(agents: ("claude" | "codex")[] | undefined): string | null {
  if (!agents || agents.length === 0) return null;
  if (agents.length === 2) return "BOTH";
  return agents[0].toUpperCase();
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
  agents,
  external = false,
}: StateCardProps): JSX.Element {
  const visual = STATUS_VISUALS[status];

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-testid="statecard-checkbox"]')) return;
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

  const cellBg = selected
    ? "var(--color-ivory-medium)"
    : "var(--color-ivory-light)";

  return (
    <div
      data-testid="statecard"
      data-status={status}
      data-selected={selected}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${name} (${visual.label.toLowerCase()})`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="cursor-pointer focus:outline-none"
      style={{
        position: "relative",
        backgroundColor: cellBg,
        borderTop: "1px solid var(--color-cloud-light)",
        borderRight: "1px solid var(--color-cloud-light)",
        borderBottom: "1px solid var(--color-cloud-light)",
        // 3px chromatic left-stripe carries the status accent.
        borderLeft: `3px solid ${visual.accentColor}`,
        padding: "10px 12px 10px 12px",
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
          (e.currentTarget as HTMLElement).style.backgroundColor =
            "var(--color-ivory-light)";
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
      {/* Header row: checkbox + name + small status dot */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "4px",
        }}
      >
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
            width: "13px",
            height: "13px",
            borderRadius: "0px",
            border: "1px solid var(--color-slate-dark)",
            backgroundColor: selected
              ? "var(--color-slate-dark)"
              : "transparent",
            backgroundImage: selected
              ? `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23faf9f5' stroke-width='2.5'><path d='M3 8.5l3.5 3.5L13 4.5'/></svg>")`
              : "none",
            backgroundSize: "13px 13px",
            backgroundRepeat: "no-repeat",
            cursor: "pointer",
            outlineColor: "var(--color-slate-medium)",
            outlineOffset: "2px",
            flexShrink: 0,
            margin: 0,
          }}
        />
        <h3
          data-testid="statecard-name"
          className="text-slate-dark"
          style={{
            fontSize: "12px",
            lineHeight: 1.3,
            fontWeight: 600,
            margin: 0,
            fontFamily: "var(--font-anthropic-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
          title={name}
        >
          {name}
        </h3>
        <span
          aria-hidden="true"
          data-testid="statecard-status-dot"
          style={{
            display: "inline-block",
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            backgroundColor: visual.accentColor,
            flexShrink: 0,
          }}
        />
      </div>

      {/* Description: clamped to 2 lines */}
      <p
        data-testid="statecard-description"
        className="text-slate-light font-anthropic-sans"
        style={{
          fontSize: "12px",
          lineHeight: 1.4,
          color: "var(--color-slate-light)",
          margin: 0,
          marginBottom: "6px",
          // Two-line clamp via CSS box-orient + overflow.
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          overflow: "hidden",
          textOverflow: "ellipsis",
          wordBreak: "break-word",
        }}
        title={description}
      >
        {description}
      </p>

      {/* Footer: badge + meta in a single mono line */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "8px",
          flexWrap: "wrap",
          fontFamily: "var(--font-anthropic-mono)",
          fontSize: "10px",
          lineHeight: 1.3,
          letterSpacing: "0.04em",
        }}
      >
        <span
          data-testid="statecard-badge"
          data-status={status}
          className="font-anthropic-mono uppercase"
          style={{
            fontSize: "10px",
            color: visual.badgeColor,
            backgroundColor: "transparent",
            border: "none",
            borderRadius: "0px",
            padding: 0,
            letterSpacing: "0.04em",
            fontWeight: 500,
          }}
        >
          {visual.label}
        </span>
        <div
          data-testid="statecard-meta"
          className="font-anthropic-mono"
          style={{
            fontSize: "10px",
            color: "var(--color-cloud-dark)",
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
            alignItems: "baseline",
            flex: 1,
            justifyContent: "flex-end",
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
          {agentLabel(agents) && (
            <span
              data-testid="statecard-agents"
              data-agents={(agents ?? []).join(",")}
              className="font-anthropic-mono uppercase"
              style={{
                color: "var(--color-clay)",
                border: "1px solid var(--color-clay)",
                padding: "0 4px",
                letterSpacing: "0.04em",
                fontWeight: 600,
                lineHeight: "14px",
              }}
            >
              {agentLabel(agents)}
            </span>
          )}
          {external && (
            <span
              data-testid="statecard-external"
              className="font-anthropic-mono uppercase"
              title="Updates via `claude plugins update`"
              style={{
                color: "var(--color-slate-light)",
                border: "1px solid var(--color-slate-light)",
                padding: "0 4px",
                letterSpacing: "0.04em",
                fontWeight: 600,
                lineHeight: "14px",
              }}
            >
              EXTERNAL
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
