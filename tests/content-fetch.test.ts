import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, test } from "node:test";

import { fetchContentRoot } from "../src/utils.js";

const BASE_RESPONSES: Record<string, string> = {
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

const CODEX_PLUGIN_DIRS = [
  "plugins/auriga-go",
  "plugins/auriga-git-guards",
  "plugins/auriga-workflow-skills",
  "plugins/session-instructions-loader",
  "plugins/deep-review",
];

function listFilesUnder(relativeDir: string): string[] {
  const root = path.join(process.cwd(), relativeDir);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        out.push(path.relative(process.cwd(), abs).split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  return out.sort();
}

const CODEX_PLUGIN_FILES = CODEX_PLUGIN_DIRS.flatMap(listFilesUnder);

const RESPONSES: Record<string, string> = {
  ...BASE_RESPONSES,
  ...Object.fromEntries(CODEX_PLUGIN_FILES.map((file) => [file, `${file}\n`])),
};

describe("fetchContentRoot", () => {
  const originalFetch = globalThis.fetch;
  const originalDev = process.env.DEV;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalDev === undefined) delete process.env.DEV;
    else process.env.DEV = originalDev;
  });

  test("preloads base content and local Codex plugin payloads", async () => {
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
      fs.existsSync(`${root}/plugins/auriga-workflow-skills/skills/incremental-impl/SKILL.md`),
      "local Codex plugin skills should be available for cache materialization",
    );
  });
});
