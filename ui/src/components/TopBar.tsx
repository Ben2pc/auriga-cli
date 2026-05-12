// TopBar — sticky top navigation bar.
//
// Maps to docs/architecture/web-ui.md §12.1 "Top Bar" and DESIGN.md
// §"Top Navigation Bar". Surface --color-ivory-medium, 68px tall, sticky.
//
// - Left: AURIGA-CLI wordmark (Anthropic Sans 16/700, slate-dark) + cwd label
//   (Anthropic Mono 12/400, cloud-dark). Long cwd paths (>60 chars) are
//   middle-truncated to keep both the project name suffix and the leading
//   "/Users/.../" hint visible; full path lives on the title attribute for
//   hover-tooltip + screen reader.
// - Right: marketplace status (single geometric dot + uppercase text label,
//   §13.4 "no chip" rule — pure text + a colored dot, no pill background).
//
// Status color encoding (spec §13.4 + §12.1):
//   online   → --color-olive   (subtle "healthy" cue, single chromatic accent)
//   offline  → --color-cloud-medium (muted, like NOT INSTALLED)
//   unknown  → --color-cloud-light  (even weaker — "we haven't checked")
//
// data-testid attributes are used for status assertion so tests don't have
// to read computed style for color matching.

import type { JSX } from "react";

export type MarketplaceStatus = "online" | "offline" | "unknown";

export interface TopBarProps {
  cwd: string;
  marketplaceStatus: MarketplaceStatus;
}

// Middle-truncate a long path. Keeps the first segment ("/Users") and the
// final 2-3 trailing segments so the user still sees "what project am I in".
// For paths ≤ maxLen we return as-is. We slice on character count rather
// than path segments because POSIX/Windows path mixing is out of scope here.
export function truncateMiddle(input: string, maxLen = 60): string {
  if (input.length <= maxLen) return input;
  const ellipsis = "…";
  const keepStart = Math.floor((maxLen - ellipsis.length) / 2);
  const keepEnd = maxLen - ellipsis.length - keepStart;
  return input.slice(0, keepStart) + ellipsis + input.slice(input.length - keepEnd);
}

const STATUS_LABEL: Record<MarketplaceStatus, string> = {
  online: "ONLINE",
  offline: "OFFLINE",
  unknown: "UNKNOWN",
};

// Inline style is unavoidable for the dot color: Tailwind v4 doesn't ship
// `bg-olive` etc. with the token-derived utility name in jsdom test env,
// and inline keeps the dot color test-assertable via getComputedStyle.
const STATUS_DOT_VAR: Record<MarketplaceStatus, string> = {
  online: "var(--color-olive)",
  offline: "var(--color-cloud-medium)",
  unknown: "var(--color-cloud-light)",
};

export default function TopBar({
  cwd,
  marketplaceStatus,
}: TopBarProps): JSX.Element {
  const truncated = truncateMiddle(cwd);
  const isTruncated = truncated !== cwd;

  return (
    <header
      data-testid="topbar"
      className="sticky top-0 z-30 w-full bg-ivory-medium"
      style={{
        height: "68px",
        // No bottom border in default state per DESIGN.md "Top Navigation Bar".
        // Scroll state border (slate-medium) is left to T2.7 to wire up.
      }}
    >
      <div className="mx-auto flex h-full max-w-[1200px] items-center justify-between px-32">
        {/* Left: wordmark + cwd */}
        <div className="flex items-center gap-16 min-w-0">
          <span
            data-testid="topbar-wordmark"
            className="font-anthropic-sans text-slate-dark"
            style={{
              fontSize: "16px",
              fontWeight: 700,
              letterSpacing: "-0.002em",
            }}
          >
            AURIGA-CLI
          </span>
          <span
            data-testid="topbar-cwd"
            title={isTruncated ? cwd : undefined}
            className="font-anthropic-mono text-cloud-dark truncate"
            style={{
              fontSize: "12px",
              lineHeight: 1.3,
              fontFamily: "var(--font-anthropic-mono)",
            }}
          >
            {truncated}
          </span>
        </div>

        {/* Right: marketplace status (dot + label) */}
        <div
          data-testid="topbar-marketplace"
          data-status={marketplaceStatus}
          className="flex items-center gap-8"
        >
          <span
            data-testid="topbar-marketplace-dot"
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: STATUS_DOT_VAR[marketplaceStatus],
            }}
          />
          <span
            data-testid="topbar-marketplace-label"
            className="font-anthropic-mono text-slate-dark"
            style={{
              fontSize: "12px",
              fontFamily: "var(--font-anthropic-mono)",
              letterSpacing: "0.04em",
            }}
          >
            {STATUS_LABEL[marketplaceStatus]}
          </span>
        </div>
      </div>
    </header>
  );
}
