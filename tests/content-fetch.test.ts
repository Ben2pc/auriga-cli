import assert from "node:assert/strict";
import fs from "node:fs";
import { afterEach, describe, test } from "node:test";

import { fetchContentRoot } from "../src/utils.js";

const RESPONSES: Record<string, string> = {
  "CLAUDE.md": "# Claude\n",
  "skills-lock.json": JSON.stringify({ skills: {} }),
  ".claude/plugins.json": JSON.stringify({ plugins: [] }),
  ".agents/plugins/marketplace.json": JSON.stringify({
    name: "auriga-cli",
    plugins: [
      {
        name: "session-instructions-loader",
        source: { source: "local", path: "./plugins/session-instructions-loader" },
      },
    ],
  }),
  ".agents/plugins/install.json": JSON.stringify({
    plugins: [{ name: "session-instructions-loader" }],
  }),
  ".claude/hooks/hooks.json": JSON.stringify({ hooks: [] }),
};

describe("fetchContentRoot", () => {
  const originalFetch = globalThis.fetch;
  const originalDev = process.env.DEV;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalDev === undefined) delete process.env.DEV;
    else process.env.DEV = originalDev;
  });

  test("preloads base content without fetching Codex plugin manifests", async () => {
    delete process.env.DEV;
    const requested: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      const file = Object.keys(RESPONSES).find((candidate) => url.endsWith(`/${candidate}`));
      if (!file) {
        throw new Error(`unexpected fetch: ${url}`);
      }
      requested.push(file);
      return new Response(RESPONSES[file], { status: 200 });
    }) as typeof fetch;

    const root = await fetchContentRoot();

    assert.ok(fs.existsSync(root));
    assert.deepEqual(requested.sort(), Object.keys(RESPONSES).sort());
    assert.ok(
      !requested.some((file) => file.endsWith(".codex-plugin/plugin.json")),
      "Codex plugin manifests should be fetched lazily by the plugin installer",
    );
  });
});
