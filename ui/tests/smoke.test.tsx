import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import App from "../src/App";

// App now mounts Dashboard, which immediately calls fetch("/api/state"). We
// stub fetch so the smoke test stays hermetic (no jsdom network noise).
describe("M2 smoke", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({}), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("App mounts and renders TopBar", () => {
    render(<App />);
    // Loading state renders the TopBar slot synchronously.
    expect(screen.getByTestId("topbar")).toBeInTheDocument();
  });
});
