import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import TopBar, { truncateMiddle } from "../src/components/TopBar";

describe("TopBar", () => {
  test("renders the AURIGA-CLI wordmark", () => {
    render(<TopBar cwd="/Users/me/proj" marketplaceStatus="online" />);
    const wordmark = screen.getByTestId("topbar-wordmark");
    expect(wordmark).toBeInTheDocument();
    expect(wordmark).toHaveTextContent(/AURIGA-CLI/);
  });

  test("renders the cwd label when short", () => {
    render(<TopBar cwd="/Users/me/proj" marketplaceStatus="online" />);
    const cwd = screen.getByTestId("topbar-cwd");
    expect(cwd).toHaveTextContent("/Users/me/proj");
    // Short cwd: no truncation, no title attribute hint needed.
    expect(cwd).not.toHaveAttribute("title");
  });

  test("middle-truncates a long cwd and exposes the full path on title", () => {
    const longPath =
      "/Users/somebody/Workspace/auriga-cli/.claude/worktrees/ui/some/deeply/nested/project-directory";
    render(<TopBar cwd={longPath} marketplaceStatus="online" />);
    const cwd = screen.getByTestId("topbar-cwd");
    // Visible text should be shorter than the original and contain an ellipsis
    expect(cwd.textContent!.length).toBeLessThan(longPath.length);
    expect(cwd.textContent).toContain("…");
    // title attribute carries the full untruncated path for tooltip + a11y
    expect(cwd).toHaveAttribute("title", longPath);
  });

  test("truncateMiddle helper preserves first + last characters", () => {
    const path = "/Users/me/" + "a".repeat(100) + "/end";
    const truncated = truncateMiddle(path, 30);
    expect(truncated.length).toBeLessThanOrEqual(30);
    expect(truncated.startsWith("/Users")).toBe(true);
    expect(truncated.endsWith("end")).toBe(true);
    expect(truncated).toContain("…");
  });

  test("marketplaceStatus drives a data-status attribute (online)", () => {
    render(<TopBar cwd="/p" marketplaceStatus="online" />);
    const wrap = screen.getByTestId("topbar-marketplace");
    expect(wrap).toHaveAttribute("data-status", "online");
    expect(screen.getByTestId("topbar-marketplace-label")).toHaveTextContent(
      "ONLINE"
    );
  });

  test("marketplaceStatus offline shows OFFLINE", () => {
    render(<TopBar cwd="/p" marketplaceStatus="offline" />);
    expect(screen.getByTestId("topbar-marketplace")).toHaveAttribute(
      "data-status",
      "offline"
    );
    expect(screen.getByTestId("topbar-marketplace-label")).toHaveTextContent(
      "OFFLINE"
    );
  });

  test("marketplaceStatus unknown shows UNKNOWN", () => {
    render(<TopBar cwd="/p" marketplaceStatus="unknown" />);
    expect(screen.getByTestId("topbar-marketplace")).toHaveAttribute(
      "data-status",
      "unknown"
    );
    expect(screen.getByTestId("topbar-marketplace-label")).toHaveTextContent(
      "UNKNOWN"
    );
  });

  test("each marketplace status produces a distinct dot color", () => {
    const { rerender } = render(
      <TopBar cwd="/p" marketplaceStatus="online" />
    );
    const onlineColor = (
      screen.getByTestId("topbar-marketplace-dot") as HTMLElement
    ).style.backgroundColor;

    rerender(<TopBar cwd="/p" marketplaceStatus="offline" />);
    const offlineColor = (
      screen.getByTestId("topbar-marketplace-dot") as HTMLElement
    ).style.backgroundColor;

    rerender(<TopBar cwd="/p" marketplaceStatus="unknown" />);
    const unknownColor = (
      screen.getByTestId("topbar-marketplace-dot") as HTMLElement
    ).style.backgroundColor;

    expect(onlineColor).not.toBe(offlineColor);
    expect(offlineColor).not.toBe(unknownColor);
    expect(onlineColor).not.toBe(unknownColor);
  });

  test("does not render any emoji characters", () => {
    render(<TopBar cwd="/Users/me/proj" marketplaceStatus="online" />);
    const bar = screen.getByTestId("topbar");
    // Quick emoji range probe — covers most common emoji/dingbats blocks.
    // The dot is a CSS-drawn span, not a unicode glyph, so this guard is
    // meaningful.
    const text = bar.textContent ?? "";
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)).toBe(false);
  });

  test("status indicator is not a chip / pill (no background on label)", () => {
    render(<TopBar cwd="/p" marketplaceStatus="online" />);
    const label = screen.getByTestId(
      "topbar-marketplace-label"
    ) as HTMLElement;
    // No inline background-color set on the label itself.
    expect(label.style.backgroundColor === "" ||
      label.style.backgroundColor === "transparent").toBe(true);
  });
});
