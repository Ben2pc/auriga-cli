// Extends Vitest's `expect` with @testing-library/jest-dom matchers
// (toBeInTheDocument, toHaveTextContent, etc.). Registered via
// vite.config.ts -> test.setupFiles so every test file picks it up.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest with `globals: false` does NOT auto-import the `afterEach(cleanup)`
// from @testing-library/react; without it the previous render's DOM bleeds
// into the next test and `getByTestId` returns multiple matches.
afterEach(() => {
  cleanup();
});
