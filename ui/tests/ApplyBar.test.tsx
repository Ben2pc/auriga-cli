import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import ApplyBar from "../src/components/ApplyBar";
import type { PendingAction } from "../src/components/ApplyBar";

function makePending(
  actions: Array<Partial<PendingAction>> = []
): PendingAction[] {
  return actions.map((a, i) => ({
    category: a.category ?? "skill",
    name: a.name ?? `item-${i}`,
    action: a.action ?? "install",
  }));
}

describe("ApplyBar — visibility", () => {
  test("returns null when there are zero pending actions", () => {
    const { container } = render(
      <ApplyBar
        pendingActions={[]}
        onCancel={vi.fn()}
        onApply={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("applybar")).toBeNull();
  });

  test("renders when there is at least one pending action", () => {
    render(
      <ApplyBar
        pendingActions={makePending([{ action: "install" }])}
        onCancel={vi.fn()}
        onApply={vi.fn()}
      />
    );
    expect(screen.getByTestId("applybar")).toBeInTheDocument();
  });
});

describe("ApplyBar — summary text", () => {
  test("summarizes mixed actions with the expected counts", () => {
    render(
      <ApplyBar
        pendingActions={makePending([
          { action: "update" },
          { action: "update" },
          { action: "install" },
          { action: "uninstall" },
        ])}
        onCancel={vi.fn()}
        onApply={vi.fn()}
      />
    );
    const summary = screen.getByTestId("applybar-summary");
    expect(summary.textContent).toMatch(/4 changes/);
    expect(summary.textContent).toMatch(/2 update/);
    expect(summary.textContent).toMatch(/1 install/);
    expect(summary.textContent).toMatch(/1 uninstall/);
  });

  test("singular 'change' for exactly one item", () => {
    render(
      <ApplyBar
        pendingActions={makePending([{ action: "install" }])}
        onCancel={vi.fn()}
        onApply={vi.fn()}
      />
    );
    expect(screen.getByTestId("applybar-summary").textContent).toMatch(
      /1 change /
    );
  });
});

describe("ApplyBar — callbacks", () => {
  test("Apply button invokes onApply", () => {
    const onApply = vi.fn();
    render(
      <ApplyBar
        pendingActions={makePending([{ action: "install" }])}
        onCancel={vi.fn()}
        onApply={onApply}
      />
    );
    fireEvent.click(screen.getByTestId("applybar-apply"));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  test("Cancel button invokes onCancel", () => {
    const onCancel = vi.fn();
    render(
      <ApplyBar
        pendingActions={makePending([{ action: "install" }])}
        onCancel={onCancel}
        onApply={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId("applybar-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("applying=true disables both buttons", () => {
    render(
      <ApplyBar
        pendingActions={makePending([{ action: "install" }])}
        onCancel={vi.fn()}
        onApply={vi.fn()}
        applying
      />
    );
    expect(screen.getByTestId("applybar-apply")).toBeDisabled();
    expect(screen.getByTestId("applybar-cancel")).toBeDisabled();
  });

  test("Apply button label reflects applying state", () => {
    const { rerender } = render(
      <ApplyBar
        pendingActions={makePending([{ action: "install" }])}
        onCancel={vi.fn()}
        onApply={vi.fn()}
      />
    );
    expect(screen.getByTestId("applybar-apply").textContent).toMatch(/Apply/);
    expect(screen.getByTestId("applybar-apply").textContent).not.toMatch(
      /Applying/
    );

    rerender(
      <ApplyBar
        pendingActions={makePending([{ action: "install" }])}
        onCancel={vi.fn()}
        onApply={vi.fn()}
        applying
      />
    );
    expect(screen.getByTestId("applybar-apply").textContent).toMatch(
      /Applying/
    );
  });
});

describe("ApplyBar — signature visual", () => {
  test("Apply button carries the asymmetric border radius (0 0 8px 8px)", () => {
    render(
      <ApplyBar
        pendingActions={makePending([{ action: "install" }])}
        onCancel={vi.fn()}
        onApply={vi.fn()}
      />
    );
    const apply = screen.getByTestId("applybar-apply") as HTMLButtonElement;
    expect(apply).toHaveAttribute("data-asymmetric-radius", "0 0 8px 8px");
    // jsdom serializes the shorthand to longhand on inline style; assert both
    // shapes pass.
    const r = apply.style.borderRadius;
    const tl = apply.style.borderTopLeftRadius;
    const tr = apply.style.borderTopRightRadius;
    const bl = apply.style.borderBottomLeftRadius;
    const br = apply.style.borderBottomRightRadius;
    const ok =
      r === "0px 0px 8px 8px" ||
      r === "0 0 8px 8px" ||
      (tl === "0px" && tr === "0px" && bl === "8px" && br === "8px");
    expect(ok).toBe(true);
  });

  test("Cancel button has 0px radius (ghost button)", () => {
    render(
      <ApplyBar
        pendingActions={makePending([{ action: "install" }])}
        onCancel={vi.fn()}
        onApply={vi.fn()}
      />
    );
    const cancel = screen.getByTestId("applybar-cancel") as HTMLButtonElement;
    expect(cancel.style.borderRadius).toBe("0px");
  });

  test("top border switches to clay accent when there are pending actions", () => {
    render(
      <ApplyBar
        pendingActions={makePending([{ action: "install" }])}
        onCancel={vi.fn()}
        onApply={vi.fn()}
      />
    );
    const bar = screen.getByTestId("applybar") as HTMLElement;
    expect(bar.style.borderTop).toContain("var(--color-clay)");
  });

  test("Apply button uses ivory-light background per DESIGN.md", () => {
    render(
      <ApplyBar
        pendingActions={makePending([{ action: "install" }])}
        onCancel={vi.fn()}
        onApply={vi.fn()}
      />
    );
    const apply = screen.getByTestId("applybar-apply") as HTMLButtonElement;
    expect(apply.style.backgroundColor).toBe("var(--color-ivory-light)");
  });

  test("Cancel button is transparent (ghost)", () => {
    render(
      <ApplyBar
        pendingActions={makePending([{ action: "install" }])}
        onCancel={vi.fn()}
        onApply={vi.fn()}
      />
    );
    const cancel = screen.getByTestId("applybar-cancel") as HTMLButtonElement;
    expect(cancel.style.backgroundColor).toBe("transparent");
  });

  test("Apply button exposes outline focus ring for keyboard a11y", () => {
    render(
      <ApplyBar
        pendingActions={makePending([{ action: "install" }])}
        onCancel={vi.fn()}
        onApply={vi.fn()}
      />
    );
    const apply = screen.getByTestId("applybar-apply") as HTMLButtonElement;
    expect(apply.style.outlineColor).toBe("var(--color-slate-medium)");
  });
});
