// Layout — page-level container with three slots (topBar / children /
// bottomBar). Maps to docs/architecture/web-ui.md §12:
//   - Page surface = --color-ivory-light (the "warm paper" base)
//   - max-width 1200px, centered (handled inside content slot)
//   - section gap = --spacing-32 between top-level children
//   - bottomBar slot sticks to the bottom of the viewport — for the ApplyBar
//
// We don't enforce padding on `children` here: section / category headers
// own their own spacing per spec §12.2. Layout's job is the chrome (top +
// bottom slots + page surface).

import type { JSX, ReactNode } from "react";

export interface LayoutProps {
  topBar: ReactNode;
  children: ReactNode;
  bottomBar?: ReactNode;
}

export default function Layout({
  topBar,
  children,
  bottomBar,
}: LayoutProps): JSX.Element {
  return (
    <div
      data-testid="layout-root"
      className="flex min-h-screen flex-col bg-ivory-light text-slate-dark font-anthropic-sans"
    >
      {topBar}
      <main
        data-testid="layout-main"
        className="flex-1 w-full"
      >
        <div className="mx-auto max-w-[1200px] px-32 py-32">
          {children}
        </div>
      </main>
      {bottomBar !== undefined && (
        <div
          data-testid="layout-bottombar"
          className="sticky bottom-0 z-30 w-full"
        >
          {bottomBar}
        </div>
      )}
    </div>
  );
}
