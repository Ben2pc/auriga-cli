import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import Layout from "../src/components/Layout";

describe("Layout", () => {
  test("renders topBar, children, and bottomBar slots when all provided", () => {
    render(
      <Layout
        topBar={<div data-testid="probe-topbar">TOP</div>}
        bottomBar={<div data-testid="probe-bottombar">BOTTOM</div>}
      >
        <div data-testid="probe-children">CHILD</div>
      </Layout>
    );
    expect(screen.getByTestId("probe-topbar")).toBeInTheDocument();
    expect(screen.getByTestId("probe-children")).toBeInTheDocument();
    expect(screen.getByTestId("probe-bottombar")).toBeInTheDocument();
    // bottomBar slot wrapper present
    expect(screen.getByTestId("layout-bottombar")).toBeInTheDocument();
  });

  test("omits the bottombar wrapper when bottomBar prop is undefined", () => {
    render(
      <Layout topBar={<div>top</div>}>
        <div data-testid="probe-children">CHILD</div>
      </Layout>
    );
    expect(screen.queryByTestId("layout-bottombar")).toBeNull();
    expect(screen.getByTestId("probe-children")).toBeInTheDocument();
  });

  test("root container uses the ivory-light surface", () => {
    render(
      <Layout topBar={<div>top</div>}>
        <div>child</div>
      </Layout>
    );
    const root = screen.getByTestId("layout-root");
    // Tailwind class presence — the className wires the page surface.
    expect(root.className).toContain("bg-ivory-light");
  });

  test("content wrapper applies the max-w-[1440px] constraint", () => {
    // 5-column Kanban layout needs more horizontal room than the original
    // 1200px allowed; bumped to 1440 so 5 columns at ~270px each fit on a
    // typical 14"+ laptop screen without column truncation.
    render(
      <Layout topBar={<div>top</div>}>
        <div data-testid="probe-children">child</div>
      </Layout>
    );
    const main = screen.getByTestId("layout-main");
    const wrapper = main.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("max-w-[1440px]");
  });
});
