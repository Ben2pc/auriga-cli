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
    version: "4.2.4",
    hasHooks: true,
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
    version: "0.2.3",
    hasHooks: false,
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
    version: "1.0.6",
    hasHooks: true,
    nativeManifests: [".codex-plugin/plugin.json"],
    skills: [],
  },
  {
    name: "auriga-notify",
    version: "1.0.3",
    hasHooks: true,
    nativeManifests: [".claude-plugin/plugin.json"],
    skills: [],
  },
] as const;

function readJson(rel: string): JsonObject {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf-8")) as JsonObject;
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
  test("portable-only plugins have a valid root manifest while Hook plugins use native manifests", () => {
    const ownedPluginNames = fs
      .readdirSync(path.join(repoRoot, "plugins"))
      .filter((name) => fs.statSync(path.join(repoRoot, "plugins", name)).isDirectory())
      .sort();
    assert.deepEqual(
      ownedPluginNames,
      plugins.map(({ name }) => name).sort(),
      "every owned plugin must declare its manifest and Hook classification",
    );

    for (const plugin of plugins) {
      const pluginRoot = path.join(repoRoot, "plugins", plugin.name);
      const manifestPath = path.join(pluginRoot, "plugin.json");
      assert.equal(
        fs.existsSync(manifestPath),
        !plugin.hasHooks,
        plugin.hasHooks
          ? `${plugin.name}/plugin.json must be absent so hosts select the native Hook manifest`
          : `${plugin.name}/plugin.json must expose the portable Agent Plugins package`,
      );

      const portableManifest = plugin.hasHooks
        ? undefined
        : readJson(`plugins/${plugin.name}/plugin.json`);
      if (portableManifest) {
        assertAgentPluginManifest(portableManifest, `${plugin.name}/plugin.json`);
        assert.equal(portableManifest.name, plugin.name);
        assert.equal(portableManifest.version, plugin.version);
      }

      for (const nativePath of plugin.nativeManifests) {
        const nativeManifest = readJson(`plugins/${plugin.name}/${nativePath}`);
        assert.equal(nativeManifest.name, plugin.name);
        assert.equal(nativeManifest.version, plugin.version);

        if (plugin.hasHooks && nativePath !== ".claude-plugin/plugin.json") {
          assert.equal(
            nativeManifest.hooks,
            "./hooks/hooks.json",
            `${plugin.name} must expose its Hook registry in ${nativePath}`,
          );
        } else if (!plugin.hasHooks) {
          assert.equal(
            nativeManifest.hooks,
            undefined,
            `${plugin.name} must not expose a Hook registry in ${nativePath}`,
          );
        }

        if (!portableManifest) continue;
        for (const field of ["name", "version", "homepage", "repository", "license"]) {
          assert.equal(
            nativeManifest[field],
            portableManifest[field],
            `${plugin.name} ${field} must stay aligned in ${nativePath}`,
          );
        }

        assertPlainObject(portableManifest.author, `${plugin.name}/plugin.json.author`);
        assertPlainObject(nativeManifest.author, `${plugin.name}/${nativePath}.author`);
        for (const field of ["name", "email"]) {
          assert.equal(
            nativeManifest.author[field],
            portableManifest.author[field],
            `${plugin.name} author.${field} must stay aligned in ${nativePath}`,
          );
        }
        if ("url" in nativeManifest.author) {
          assert.equal(
            nativeManifest.author.url,
            portableManifest.author.url,
            `${plugin.name} author.url must stay aligned in ${nativePath}`,
          );
        }

        const expectedDescription =
          localizedNativeDescriptions[`${plugin.name}/${nativePath}`] ??
          portableManifest.description;
        assert.equal(
          nativeManifest.description,
          expectedDescription,
          `${plugin.name} description must stay aligned or use an approved localization in ${nativePath}`,
        );
      }

      assert.equal(
        fs.existsSync(path.join(pluginRoot, "hooks", "hooks.json")),
        plugin.hasHooks,
        `${plugin.name} Hook registry classification drifted`,
      );
    }
  });

  test("VAL-PORTABILITY-003 and VAL-COMPATIBILITY-003: native host scope stays bounded", () => {
    for (const plugin of plugins) {
      for (const nativePath of nativeManifestPaths) {
        assert.equal(
          fs.existsSync(path.join(repoRoot, "plugins", plugin.name, nativePath)),
          (plugin.nativeManifests as readonly string[]).includes(nativePath),
          `${plugin.name} native host scope drifted at ${nativePath}`,
        );
      }
    }
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
      const cursorManifest = readJson(`plugins/${plugin.name}/.cursor-plugin/plugin.json`);
      assert.equal(
        cursorManifest.skills,
        "./skills/",
        `${plugin.name} Cursor manifest must declare the skills container for marketplace indexing`,
      );
    }
  });
});
