import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import App from "../src/App";

describe("M2 smoke", () => {
  test("App renders", () => {
    render(<App />);
    expect(screen.getByText(/M2 scaffold OK/i)).toBeInTheDocument();
  });
});
