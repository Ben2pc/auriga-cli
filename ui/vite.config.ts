/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev proxy target: spec §6 default server port. Kept as a constant so the
// number lives in one place — production builds don't use this proxy
// (auriga-cli serves the bundled UI off the same origin as /api/*).
const API_DEV_TARGET = "http://127.0.0.1:4747";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: API_DEV_TARGET,
        // Preserve the browser-supplied Origin header so the server's
        // origin-allowlist check (src/server.ts:isOriginAllowed) treats the
        // request as same-origin from the dev page. `changeOrigin: true`
        // would overwrite Origin with the proxy target and trip the 403.
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
  },
});
