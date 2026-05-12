import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import StateCard from "../src/components/StateCard";
import type { CardStatus } from "../src/components/StateCard";

function baseProps(overrides: Partial<Parameters<typeof StateCard>[0]> = {}) {
  return {
    name: "test-item",
    description: "A short description.",
    status: "installed" as CardStatus,
    selected: false,
    onSelectChange: vi.fn(),
    ...overrides,
  };
}

describe("StateCard — status encoding", () => {
  test("installed renders INSTALLED badge with cloud-dark color", () => {
    render(<StateCard {...baseProps({ status: "installed" })} />);
    const badge = screen.getByTestId("statecard-badge") as HTMLElement;
    expect(badge).toHaveAttribute("data-status", "installed");
    expect(badge).toHaveTextContent("INSTALLED");
    expect(badge.style.color).toBe("var(--color-cloud-dark)");
  });

  test("update-available renders UPDATE AVAILABLE badge with clay color", () => {
    render(<StateCard {...baseProps({ status: "update-available" })} />);
    const badge = screen.getByTestId("statecard-badge") as HTMLElement;
    expect(badge).toHaveTextContent("UPDATE AVAILABLE");
    expect(badge.style.color).toBe("var(--color-clay)");
  });

  test("not-installed renders NOT INSTALLED badge with cloud-medium color", () => {
    render(<StateCard {...baseProps({ status: "not-installed" })} />);
    const badge = screen.getByTestId("statecard-badge") as HTMLElement;
    expect(badge).toHaveTextContent("NOT INSTALLED");
    expect(badge.style.color).toBe("var(--color-cloud-medium)");
  });

  test("error renders ERROR badge with accent-ember color", () => {
    render(<StateCard {...baseProps({ status: "error" })} />);
    const badge = screen.getByTestId("statecard-badge") as HTMLElement;
    expect(badge).toHaveTextContent("ERROR");
    expect(badge.style.color).toBe("var(--color-accent-ember)");
  });

  test("card background varies by status (ivory-light vs ivory-medium)", () => {
    const { rerender } = render(
      <StateCard {...baseProps({ status: "installed" })} />
    );
    let card = screen.getByTestId("statecard") as HTMLElement;
    expect(card.style.backgroundColor).toBe("var(--color-ivory-light)");

    rerender(<StateCard {...baseProps({ status: "update-available" })} />);
    card = screen.getByTestId("statecard") as HTMLElement;
    expect(card.style.backgroundColor).toBe("var(--color-ivory-medium)");

    rerender(<StateCard {...baseProps({ status: "not-installed" })} />);
    card = screen.getByTestId("statecard") as HTMLElement;
    expect(card.style.backgroundColor).toBe("var(--color-ivory-light)");

    rerender(<StateCard {...baseProps({ status: "error" })} />);
    card = screen.getByTestId("statecard") as HTMLElement;
    expect(card.style.backgroundColor).toBe("var(--color-ivory-medium)");
  });

  test("badge has no chip/pill chrome (no bg, no border, 0 radius)", () => {
    render(<StateCard {...baseProps({ status: "update-available" })} />);
    const badge = screen.getByTestId("statecard-badge") as HTMLElement;
    expect(
      badge.style.backgroundColor === "" ||
        badge.style.backgroundColor === "transparent"
    ).toBe(true);
    expect(badge.style.border === "" || badge.style.border === "none").toBe(
      true
    );
    expect(badge.style.borderRadius).toBe("0px");
    expect(badge.style.padding === "" || badge.style.padding === "0px").toBe(
      true
    );
  });

  test("card has no box-shadow (zero-shadow language)", () => {
    render(<StateCard {...baseProps()} />);
    const card = screen.getByTestId("statecard") as HTMLElement;
    expect(card.style.boxShadow === "" || card.style.boxShadow === "none").toBe(
      true
    );
  });

  test("no emoji glyphs in any status's rendered text", () => {
    const statuses: CardStatus[] = [
      "installed",
      "update-available",
      "not-installed",
      "error",
    ];
    for (const status of statuses) {
      const { unmount } = render(<StateCard {...baseProps({ status })} />);
      const card = screen.getByTestId("statecard") as HTMLElement;
      const text = card.textContent ?? "";
      expect(
        /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text),
        `status=${status} should not include emoji`
      ).toBe(false);
      unmount();
    }
  });
});

describe("StateCard — selection", () => {
  test("checkbox click triggers onSelectChange(true) when unselected", () => {
    const onSelectChange = vi.fn();
    render(<StateCard {...baseProps({ onSelectChange })} />);
    const checkbox = screen.getByTestId(
      "statecard-checkbox"
    ) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(onSelectChange).toHaveBeenCalledTimes(1);
    expect(onSelectChange).toHaveBeenCalledWith(true);
  });

  test("checkbox click triggers onSelectChange(false) when selected", () => {
    const onSelectChange = vi.fn();
    render(
      <StateCard {...baseProps({ selected: true, onSelectChange })} />
    );
    const checkbox = screen.getByTestId(
      "statecard-checkbox"
    ) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(onSelectChange).toHaveBeenCalledWith(false);
  });

  test("clicking card body (outside checkbox) toggles selection", () => {
    const onSelectChange = vi.fn();
    render(<StateCard {...baseProps({ onSelectChange })} />);
    const description = screen.getByTestId("statecard-description");
    fireEvent.click(description);
    expect(onSelectChange).toHaveBeenCalledWith(true);
  });

  test("clicking the checkbox itself does not double-toggle via the card", () => {
    const onSelectChange = vi.fn();
    render(<StateCard {...baseProps({ onSelectChange })} />);
    const checkbox = screen.getByTestId("statecard-checkbox");
    fireEvent.click(checkbox);
    expect(onSelectChange).toHaveBeenCalledTimes(1);
  });

  test("Enter key on card toggles selection", () => {
    const onSelectChange = vi.fn();
    render(<StateCard {...baseProps({ onSelectChange })} />);
    const card = screen.getByTestId("statecard");
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onSelectChange).toHaveBeenCalledWith(true);
  });

  test("Space key on card toggles selection", () => {
    const onSelectChange = vi.fn();
    render(<StateCard {...baseProps({ onSelectChange })} />);
    const card = screen.getByTestId("statecard");
    fireEvent.keyDown(card, { key: " " });
    expect(onSelectChange).toHaveBeenCalledWith(true);
  });

  test("aria-pressed reflects selected state", () => {
    const { rerender } = render(<StateCard {...baseProps()} />);
    expect(screen.getByTestId("statecard")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    rerender(<StateCard {...baseProps({ selected: true })} />);
    expect(screen.getByTestId("statecard")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});

describe("StateCard — version metadata", () => {
  test("update-available with versions shows curr → expected", () => {
    render(
      <StateCard
        {...baseProps({
          status: "update-available",
          currentVersion: "v1.0.0",
          expectedVersion: "v1.1.0",
        })}
      />
    );
    const diff = screen.getByTestId("statecard-version-diff");
    expect(diff).toHaveTextContent("v1.0.0 → v1.1.0");
  });

  test("update-available with hashes shows 8-char prefixes", () => {
    render(
      <StateCard
        {...baseProps({
          status: "update-available",
          currentHash: "abcdef1234567890",
          expectedHash: "0987654321fedcba",
        })}
      />
    );
    const diff = screen.getByTestId("statecard-version-diff");
    expect(diff).toHaveTextContent("abcdef12 → 09876543");
  });

  test("installed shows only currentVersion if available", () => {
    render(
      <StateCard
        {...baseProps({
          status: "installed",
          currentVersion: "v1.6.0",
        })}
      />
    );
    expect(screen.getByTestId("statecard-version")).toHaveTextContent("v1.6.0");
    expect(screen.queryByTestId("statecard-version-diff")).toBeNull();
  });

  test("uninstallable shows a removable marker only on installed", () => {
    render(
      <StateCard
        {...baseProps({
          status: "installed",
          uninstallable: true,
        })}
      />
    );
    expect(screen.getByTestId("statecard-uninstallable")).toBeInTheDocument();
  });
});

describe("StateCard — long content handling", () => {
  test("a very long description does not throw layout", () => {
    const longDesc = "lorem ipsum ".repeat(80).trim();
    render(<StateCard {...baseProps({ description: longDesc })} />);
    const desc = screen.getByTestId(
      "statecard-description"
    ) as HTMLElement;
    expect(desc).toBeInTheDocument();
    // Word-break / overflow-wrap inline-style guard
    expect(
      desc.style.overflowWrap === "anywhere" ||
        desc.style.wordBreak === "break-word"
    ).toBe(true);
  });
});
