import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const repoRoot = path.resolve(new URL(".", import.meta.url).pathname, "..", "..");
const schemaUri = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const nativeManifestPaths = [
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
] as const;

const localizedNativeDescriptions: Record<string, string> = {
  "quality-gate-scaffolder/.codex-plugin/plugin.json":
    "为 Swift iOS、Kotlin Android、Python 后端、TypeScript 前端和 Node 工具项目搭建仓库质量门禁。",
  "auriga-workflow/.cursor-plugin/plugin.json":
    "Auriga's end-to-end engineering workflow: clarification, diagnosis, implementation, maintenance, review, and Git lifecycle guardrails.",
};

type JsonObject = Record<string, unknown>;

const plugins = [
  {
    name: "auriga-workflow",
    version: "4.0.24",
    nativeManifests: [
      ".claude-plugin/plugin.json",
      ".codex-plugin/plugin.json",
      ".cursor-plugin/plugin.json",
    ],
    skills: [
      "arch-design",
      "code-simplify",
      "deep-review",
      "docent",
      "documentation-management",
      "git-workflow",
      "goalify",
      "incremental-impl",
      "reviewer-creator",
      "session-compound",
      "spec-design",
      "systematic-debugging",
      "test-driven-development",
    ],
  },
  {
    name: "quality-gate-scaffolder",
    version: "0.2.2",
    nativeManifests: [
      ".claude-plugin/plugin.json",
      ".codex-plugin/plugin.json",
      ".cursor-plugin/plugin.json",
    ],
    skills: [
      "scaffold-kotlin-android-quality-gates",
      "scaffold-node-tool-quality-gates",
      "scaffold-python-backend-quality-gates",
      "scaffold-swift-ios-quality-gates",
      "scaffold-typescript-frontend-quality-gates",
    ],
  },
  {
    name: "session-instructions-loader",
    version: "1.0.4",
    nativeManifests: [".codex-plugin/plugin.json"],
    skills: [],
  },
  {
    name: "auriga-notify",
    version: "1.0.2",
    nativeManifests: [".claude-plugin/plugin.json"],
    skills: [],
  },
] as const;

function readJson(rel: string): JsonObject {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf-8")) as JsonObject;
}

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf-8");
}

function assertPlainObject(value: unknown, label: string): asserts value is JsonObject {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${label} must be an object`,
  );
}

function assertOptionalString(manifest: JsonObject, field: string, label: string): void {
  if (field in manifest) {
    assert.equal(typeof manifest[field], "string", `${label}.${field} must be a string`);
  }
}

function assertAgentPluginManifest(manifest: JsonObject, label: string): void {
  const allowedFields = new Set([
    "$schema",
    "name",
    "version",
    "description",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
    "extensions",
  ]);
  assert.deepEqual(
    Object.keys(manifest).filter((field) => !allowedFields.has(field)),
    [],
    `${label} contains fields outside the closed Agent Plugins 1.0.0 schema`,
  );
  assert.equal(manifest.$schema, schemaUri, `${label} must target the canonical schema`);
  assert.equal(typeof manifest.name, "string", `${label}.name must be a string`);
  const name = manifest.name as string;
  assert.ok(name.length >= 1 && name.length <= 64, `${label}.name length must be 1..64`);
  assert.match(
    name,
    /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/,
    `${label}.name must satisfy the Agent Plugins name pattern`,
  );

  for (const field of ["version", "description", "homepage", "repository", "license"]) {
    assertOptionalString(manifest, field, label);
  }

  if ("author" in manifest) {
    assertPlainObject(manifest.author, `${label}.author`);
    const allowedAuthorFields = new Set(["name", "email", "url"]);
    assert.deepEqual(
      Object.keys(manifest.author).filter((field) => !allowedAuthorFields.has(field)),
      [],
      `${label}.author contains unknown fields`,
    );
    for (const [field, value] of Object.entries(manifest.author)) {
      assert.equal(typeof value, "string", `${label}.author.${field} must be a string`);
    }
  }

  if ("keywords" in manifest) {
    assert.ok(Array.isArray(manifest.keywords), `${label}.keywords must be an array`);
    for (const keyword of manifest.keywords) {
      assert.equal(typeof keyword, "string", `${label}.keywords entries must be strings`);
    }
  }

  if ("extensions" in manifest) {
    assertPlainObject(manifest.extensions, `${label}.extensions`);
    for (const [namespace, value] of Object.entries(manifest.extensions)) {
      assertPlainObject(value, `${label}.extensions.${namespace}`);
    }
  }
}

function discoveredSkills(pluginName: string): string[] {
  const skillsRoot = path.join(repoRoot, "plugins", pluginName, "skills");
  if (!fs.existsSync(skillsRoot)) return [];
  return fs
    .readdirSync(skillsRoot)
    .filter((name) => fs.statSync(path.join(skillsRoot, name)).isDirectory())
    .filter((name) => fs.existsSync(path.join(skillsRoot, name, "SKILL.md")))
    .sort();
}

describe("Agent Plugins 1.0.0 package contract", () => {
  test("VAL-PORTABILITY-001/002 and VAL-VERSIONING-001/002: every owned plugin has a valid, aligned root manifest", () => {
    for (const plugin of plugins) {
      const pluginRoot = path.join(repoRoot, "plugins", plugin.name);
      const manifestPath = path.join(pluginRoot, "plugin.json");
      assert.ok(fs.lstatSync(manifestPath).isFile(), `${plugin.name}/plugin.json must be a file`);

      const manifest = readJson(`plugins/${plugin.name}/plugin.json`);
      assertAgentPluginManifest(manifest, `${plugin.name}/plugin.json`);
      assert.equal(manifest.name, plugin.name);
      assert.equal(manifest.version, plugin.version);

      for (const nativePath of plugin.nativeManifests) {
        const nativeManifest = readJson(`plugins/${plugin.name}/${nativePath}`);
        for (const field of ["name", "version", "homepage", "repository", "license"]) {
          assert.equal(
            nativeManifest[field],
            manifest[field],
            `${plugin.name} ${field} must stay aligned in ${nativePath}`,
          );
        }

        assertPlainObject(manifest.author, `${plugin.name}/plugin.json.author`);
        assertPlainObject(nativeManifest.author, `${plugin.name}/${nativePath}.author`);
        for (const field of ["name", "email"]) {
          assert.equal(
            nativeManifest.author[field],
            manifest.author[field],
            `${plugin.name} author.${field} must stay aligned in ${nativePath}`,
          );
        }
        if ("url" in nativeManifest.author) {
          assert.equal(
            nativeManifest.author.url,
            manifest.author.url,
            `${plugin.name} author.url must stay aligned in ${nativePath}`,
          );
        }

        const expectedDescription =
          localizedNativeDescriptions[`${plugin.name}/${nativePath}`] ?? manifest.description;
        assert.equal(
          nativeManifest.description,
          expectedDescription,
          `${plugin.name} description must stay aligned or use an approved localization in ${nativePath}`,
        );
      }
    }
  });

  test("VAL-PORTABILITY-003 and VAL-COMPATIBILITY-003: portable components and native host scope stay bounded", () => {
    for (const plugin of plugins) {
      for (const nativePath of nativeManifestPaths) {
        assert.equal(
          fs.existsSync(path.join(repoRoot, "plugins", plugin.name, nativePath)),
          (plugin.nativeManifests as readonly string[]).includes(nativePath),
          `${plugin.name} native host scope drifted at ${nativePath}`,
        );
      }

      assert.equal(
        fs.existsSync(path.join(repoRoot, "plugins", plugin.name, "mcp.json")),
        false,
        `${plugin.name} must not add an MCP server in this migration`,
      );
    }

    const sessionLoader = readJson("plugins/session-instructions-loader/plugin.json");
    assert.match(
      String(sessionLoader.description),
      /Codex-only/,
      "session-instructions-loader must declare its Codex-only scope",
    );
    const notify = readJson("plugins/auriga-notify/plugin.json");
    assert.match(
      String(notify.description),
      /Claude Code/,
      "auriga-notify must declare its Claude Code-only scope",
    );
  });

  test("VAL-DISCOVERY-001/002: standard fixed locations expose the expected Skills only", () => {
    for (const plugin of plugins) {
      assert.deepEqual(discoveredSkills(plugin.name), [...plugin.skills].sort());
    }
  });

  test("VAL-COMPATIBILITY-001/002/003 and VAL-DISTRIBUTION-001: marketplace scopes stay unchanged", () => {
    const claudeMarketplace = readJson(".claude-plugin/marketplace.json") as {
      plugins: Array<{ name: string; source: string }>;
    };
    const codexMarketplace = readJson(".agents/plugins/marketplace.json") as {
      plugins: Array<{ name: string; source: { source: string; path: string } }>;
    };
    const cursorMarketplace = readJson(".cursor-plugin/marketplace.json") as {
      name: string;
      owner: { name: string; email?: string };
      metadata?: { pluginRoot?: string };
      plugins: Array<{ name: string; source: string; category?: string; version?: string }>;
    };

    assert.deepEqual(
      claudeMarketplace.plugins.map(({ name }) => name).sort(),
      ["auriga-notify", "auriga-workflow", "quality-gate-scaffolder"],
    );
    assert.deepEqual(
      codexMarketplace.plugins.map(({ name }) => name).sort(),
      ["auriga-workflow", "quality-gate-scaffolder", "session-instructions-loader"],
    );
    assert.equal(cursorMarketplace.name, "auriga-cli");
    assert.equal(typeof cursorMarketplace.owner?.name, "string");
    assert.equal(cursorMarketplace.metadata?.pluginRoot, "plugins");
    assert.deepEqual(
      cursorMarketplace.plugins.map(({ name }) => name).sort(),
      ["auriga-workflow", "quality-gate-scaffolder"],
    );

    for (const plugin of claudeMarketplace.plugins) {
      assert.equal(plugin.source, `./plugins/${plugin.name}`);
    }
    for (const plugin of codexMarketplace.plugins) {
      assert.deepEqual(plugin.source, {
        source: "local",
        path: `./plugins/${plugin.name}`,
      });
    }
    for (const plugin of cursorMarketplace.plugins) {
      assert.equal(plugin.source, plugin.name);
      assert.equal(plugin.category, "developer-tools");
      const owned = plugins.find((entry) => entry.name === plugin.name);
      assert.ok(owned, `Cursor marketplace lists unknown plugin ${plugin.name}`);
      if (plugin.version !== undefined) {
        assert.equal(
          plugin.version,
          owned.version,
          `Cursor marketplace version for ${plugin.name} must match the plugin manifest`,
        );
      }
    }
  });

  test("VAL-GOVERNANCE-001: project guidance and review recognize the portable core", () => {
    const agentInstructions = read("AGENTS.md");
    const readme = read("README.md");
    const readmeZh = read("README.zh-CN.md");
    const portability = read("docs/rules/agent-portability.md");
    const developerGuide = read("docs/architecture/auriga-cli-dev-guide.md");
    const reviewer = read(
      "plugins/auriga-workflow/skills/deep-review/references/reviewers/skill-plugin-quality.md",
    );

    for (const [label, text] of [
      ["repository agent instructions", agentInstructions],
      ["English README", readme],
      ["Chinese README", readmeZh],
      ["agent portability rules", portability],
      ["developer guide", developerGuide],
      ["skill-plugin-quality reviewer", reviewer],
    ]) {
      assert.match(text, /Agent Plugins 1\.0\.0/, `${label} must name the portable standard`);
      assert.match(text, /根 `plugin\.json`|root `plugin\.json`/, `${label} must cover root manifest`);
      assert.match(
        text,
        /固定[^。\n]*`skills\/`|`skills\/`[^。\n]*固定|fixed[^.\n]*`skills\/`|`skills\/`[^.\n]*fixed/i,
        `${label} must cover Skills fixed location`,
      );
      assert.match(text, /`mcp\.json`/, `${label} must cover the MCP fixed location`);
    }

    for (const [label, text] of [
      ["repository agent instructions", agentInstructions],
      ["English README", readme],
      ["Chinese README", readmeZh],
      ["agent portability rules", portability],
      ["developer guide", developerGuide],
    ]) {
      assert.match(text, /`hooks\/hooks\.json`/, `${label} must identify the hook registry`);
      assert.match(
        text,
        /宿主专属|host-specific/i,
        `${label} must separate host-specific capabilities`,
      );
    }

    assert.match(reviewer, /闭合[^。\n]*顶层字段|顶层字段[^。\n]*闭合/);
    assert.match(reviewer, /`extensions`/);
    assert.match(reviewer, /`\.claude-plugin\/plugin\.json`/);
    assert.match(reviewer, /`\.codex-plugin\/plugin\.json`/);

    for (const plugin of plugins) {
      assert.ok(readme.includes(plugin.name), `README.md must list ${plugin.name}`);
      assert.ok(readmeZh.includes(plugin.name), `README.zh-CN.md must list ${plugin.name}`);
    }
  });
});
