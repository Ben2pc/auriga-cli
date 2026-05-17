import assert from "node:assert/strict";
import fs from "node:fs";
import { afterEach, describe, test } from "node:test";

import { fetchContentRoot } from "../src/utils.js";

const BASE_RESPONSES: Record<string, string> = {
  "AGENTS.template.zh-CN.md": "# auriga 工作流\n",
  "AGENTS.template.en.md": "# auriga Workflow\n",
  "skills-lock.json": JSON.stringify({ skills: {} }),
  ".claude-plugin/marketplace.json": JSON.stringify({ name: "auriga-cli", plugins: [] }),
  ".agents/plugins/marketplace.json": JSON.stringify({
    name: "auriga-cli",
    plugins: [
      {
        name: "session-instructions-loader",
        source: { source: "local", path: "./plugins/session-instructions-loader" },
      },
    ],
  }),
  "extra_plugin_configs.json": JSON.stringify({ plugins: [] }),
};

const RESPONSES: Record<string, string> = {
  ...BASE_RESPONSES,
};

describe("fetchContentRoot", () => {
  const originalFetch = globalThis.fetch;
  const originalDev = process.env.DEV;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalDev === undefined) delete process.env.DEV;
    else process.env.DEV = originalDev;
  });

  test("preloads only auriga-cli install inputs, not plugin payloads", async () => {
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
    assert.equal(
      fs.existsSync(`${root}/plugins`),
      false,
      "plugin payloads should come from Agent plugin marketplaces, not fetchContentRoot",
    );
  });

  test("falls back to legacy template names when a pinned tag predates the rename", async () => {
    delete process.env.DEV;
    const requested: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      for (const missing of ["AGENTS.template.zh-CN.md", "AGENTS.template.en.md"]) {
        if (url.endsWith(`/${missing}`)) {
          requested.push(missing);
          return new Response("", { status: 404 });
        }
      }
      const legacyResponses: Record<string, string> = {
        ...BASE_RESPONSES,
        "AGENTS.md": "# legacy auriga 工作流\n",
        "AGENTS.en.md": "# legacy auriga Workflow\n",
      };
      const file = Object.keys(legacyResponses).find((candidate) =>
        url.endsWith(`/${candidate}`)
      );
      if (!file) {
        throw new Error(`unexpected fetch: ${url}`);
      }
      requested.push(file);
      return new Response(legacyResponses[file], { status: 200 });
    }) as typeof fetch;

    const root = await fetchContentRoot();

    assert.match(
      fs.readFileSync(`${root}/AGENTS.template.zh-CN.md`, "utf-8"),
      /legacy auriga 工作流/,
    );
    assert.match(
      fs.readFileSync(`${root}/AGENTS.template.en.md`, "utf-8"),
      /legacy auriga Workflow/,
    );
    assert.ok(requested.includes("AGENTS.md"));
    assert.ok(requested.includes("AGENTS.en.md"));
  });
});
