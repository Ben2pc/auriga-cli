// Extends Vitest's `expect` with @testing-library/jest-dom matchers
// (toBeInTheDocument, toHaveTextContent, etc.). Registered via
// vite.config.ts -> test.setupFiles so every test file picks it up.
import "@testing-library/jest-dom/vitest";
