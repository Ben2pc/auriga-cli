// LogPanel — right-rail OUTPUT column. Covers rendering, action buttons,
// destructive-batch visual treatment, position-aware auto-scroll, and the
// empty / pending states.

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import LogPanel from "../src/components/LogPanel";
import type { LogLine } from "../src/components/LogPanel";

function makeLines(count: number): LogLine[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `line-${i}`,
    level: "info" as const,
    text: `line ${i}`,
  }));
}

describe("LogPanel — rendering", () => {
  test("renders header, OUTPUT label, and pending count when present", () => {
    render(
      <LogPanel
        mode="install"
        onModeChange={() => {}}
        lines={[]}
        pendingCount={3}
        applying={false}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByTestId("log-panel-header")).toHaveTextContent("OUTPUT");
    expect(screen.getByTestId("log-panel-pending-count")).toHaveTextContent("(3)");
  });

  test("omits pending count chip when batch is empty", () => {
    render(
      <LogPanel
        mode="install"
        onModeChange={() => {}}
        lines={[]}
        pendingCount={0}
        applying={false}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByTestId("log-panel-pending-count")).toBeNull();
  });

  test("empty state surfaces guidance depending on pending count", () => {
    const { rerender } = render(
      <LogPanel
        mode="install"
        onModeChange={() => {}}
        lines={[]}
        pendingCount={0}
        applying={false}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByTestId("log-panel-empty")).toHaveTextContent(/select items/i);

    rerender(
      <LogPanel
        mode="install"
        onModeChange={() => {}}
        lines={[]}
        pendingCount={2}
        applying={false}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByTestId("log-panel-empty")).toHaveTextContent(/click apply/i);
  });

  test("renders each log line with level-mapped colors", () => {
    const lines: LogLine[] = [
      { id: "a", level: "info", text: "informational" },
      { id: "b", level: "warn", text: "warning" },
      { id: "c", level: "error", text: "boom" },
      { id: "d", level: "ok", text: "done" },
      { id: "e", level: "meta", text: "metadata" },
    ];
    render(
      <LogPanel
        mode="install"
        onModeChange={() => {}}
        lines={lines}
        pendingCount={1}
        applying={false}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    const rendered = screen.getAllByTestId("log-panel-line");
    expect(rendered).toHaveLength(5);
    expect(rendered[2].getAttribute("data-level")).toBe("error");
    expect(rendered[3].getAttribute("data-level")).toBe("ok");
  });

  test("renders optional status banner above the log body", () => {
    render(
      <LogPanel
        mode="install"
        onModeChange={() => {}}
        lines={[]}
        pendingCount={0}
        applying={false}
        status="Job abc123… running"
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByTestId("log-panel-status")).toHaveTextContent(/job abc123/i);
  });
});

describe("LogPanel — buttons", () => {
  test("apply button is disabled when pendingCount === 0", () => {
    render(
      <LogPanel
        mode="install"
        onModeChange={() => {}}
        lines={[]}
        pendingCount={0}
        applying={false}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect((screen.getByTestId("log-panel-apply") as HTMLButtonElement).disabled).toBe(true);
  });

  test("apply button is disabled while applying is true", () => {
    render(
      <LogPanel
        mode="install"
        onModeChange={() => {}}
        lines={[]}
        pendingCount={2}
        applying={true}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    const btn = screen.getByTestId("log-panel-apply") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toMatch(/APPLYING/);
  });

  test("apply label shows the count when there are pending items", () => {
    render(
      <LogPanel
        mode="install"
        onModeChange={() => {}}
        lines={[]}
        pendingCount={7}
        applying={false}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByTestId("log-panel-apply").textContent).toMatch(/APPLY.*\(7\)/);
  });

  test("apply click fires onApply", () => {
    const onApply = vi.fn();
    render(
      <LogPanel
        mode="install"
        onModeChange={() => {}}
        lines={[]}
        pendingCount={1}
        applying={false}
        onApply={onApply}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("log-panel-apply"));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  test("cancel click fires onCancel", () => {
    const onCancel = vi.fn();
    render(
      <LogPanel
        mode="install"
        onModeChange={() => {}}
        lines={[]}
        pendingCount={1}
        applying={false}
        onApply={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("log-panel-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("LogPanel — destructive batch visual", () => {
  test("hasDestructive=true renders the ember warning banner", () => {
    render(
      <LogPanel
        mode="install"
        onModeChange={() => {}}
        lines={[]}
        pendingCount={2}
        applying={false}
        hasDestructive
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByTestId("log-panel-destructive-banner")).toBeInTheDocument();
  });

  test("hasDestructive=false omits the warning banner", () => {
    render(
      <LogPanel
        mode="install"
        onModeChange={() => {}}
        lines={[]}
        pendingCount={2}
        applying={false}
        hasDestructive={false}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByTestId("log-panel-destructive-banner")).toBeNull();
  });

  test("destructive batch repaints Apply button label + data attr", () => {
    render(
      <LogPanel
        mode="install"
        onModeChange={() => {}}
        lines={[]}
        pendingCount={1}
        applying={false}
        hasDestructive
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    const btn = screen.getByTestId("log-panel-apply");
    expect(btn.textContent).toMatch(/APPLY \(DESTRUCTIVE\)/);
    expect(btn.getAttribute("data-destructive")).toBe("true");
  });

  test("destructive banner hidden when batch is empty (no pending items)", () => {
    render(
      <LogPanel
        mode="install"
        onModeChange={() => {}}
        lines={[]}
        pendingCount={0}
        applying={false}
        hasDestructive
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByTestId("log-panel-destructive-banner")).toBeNull();
  });
});

describe("LogPanel — position-aware auto-scroll", () => {
  // jsdom doesn't run layout, so scrollTop / scrollHeight / clientHeight are
  // settable manually. We verify the component's behavior by simulating scroll
  // events with the relevant values.

  function getBody(): HTMLDivElement {
    return screen.getByTestId("log-panel-body") as HTMLDivElement;
  }

  test("auto-scrolls to bottom when new lines arrive and user is at bottom", () => {
    const { rerender } = render(
      <LogPanel
        mode="install"
        onModeChange={() => {}}
        lines={makeLines(3)}
        pendingCount={1}
        applying={false}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    const body = getBody();

    // Simulate: user is at the bottom (delta ≤ 12px tolerance).
    Object.defineProperty(body, "scrollHeight", { value: 200, configurable: true });
    Object.defineProperty(body, "clientHeight", { value: 100, configurable: true });
    body.scrollTop = 100;
    fireEvent.scroll(body);

    // New lines arrive; scrollTop should snap to scrollHeight.
    Object.defineProperty(body, "scrollHeight", { value: 240, configurable: true });
    rerender(
      <LogPanel
        mode="install"
        onModeChange={() => {}}
        lines={makeLines(5)}
        pendingCount={1}
        applying={false}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(body.scrollTop).toBe(240);
  });

  test("does NOT scroll when user has scrolled up (stickToBottom = false)", () => {
    const { rerender } = render(
      <LogPanel
        mode="install"
        onModeChange={() => {}}
        lines={makeLines(3)}
        pendingCount={1}
        applying={false}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    const body = getBody();

    // Simulate: user scrolled away from bottom.
    Object.defineProperty(body, "scrollHeight", { value: 200, configurable: true });
    Object.defineProperty(body, "clientHeight", { value: 100, configurable: true });
    body.scrollTop = 30; // far above the bottom
    fireEvent.scroll(body);

    // Capture pre-rerender scrollTop, then push more lines.
    const before = body.scrollTop;
    Object.defineProperty(body, "scrollHeight", { value: 240, configurable: true });
    rerender(
      <LogPanel
        mode="install"
        onModeChange={() => {}}
        lines={makeLines(5)}
        pendingCount={1}
        applying={false}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    // scrollTop must stay where the user left it — no hijack.
    expect(body.scrollTop).toBe(before);
  });
});
