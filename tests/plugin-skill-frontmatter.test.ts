import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import matter from "gray-matter";

// Plugin-bundled SKILL.md files are NOT parsed by the build-time catalog
// generator (it only reads `.agents/skills/<name>/SKILL.md`), so invalid
// YAML frontmatter slips past `npm run build`. The agent runtimes DO parse
// them with strict YAML parsers — a stray `: ` (colon-space) in an unquoted
// description value crashes Codex's plugin loader. This test parses every
// plugin-bundled SKILL.md with the same gray-matter / js-yaml strictness so
// the failure surfaces in CI instead of on a user's machine.

const REPO_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..", "..");

function discoverPluginSkillMds(): string[] {
  const pluginsDir = path.join(REPO_ROOT, "plugins");
  const found: string[] = [];
  for (const plugin of fs.readdirSync(pluginsDir)) {
    const skillsDir = path.join(pluginsDir, plugin, "skills");
    if (!fs.existsSync(skillsDir)) continue;
    for (const skill of fs.readdirSync(skillsDir)) {
      const skillMd = path.join(skillsDir, skill, "SKILL.md");
      if (fs.existsSync(skillMd)) found.push(skillMd);
    }
  }
  return found;
}

function discoverPluginHooksJson(): string[] {
  const pluginsDir = path.join(REPO_ROOT, "plugins");
  const found: string[] = [];
  for (const plugin of fs.readdirSync(pluginsDir)) {
    const hooksJson = path.join(pluginsDir, plugin, "hooks", "hooks.json");
    if (fs.existsSync(hooksJson)) found.push(hooksJson);
  }
  return found;
}

describe("plugin-bundled SKILL.md frontmatter", () => {
  const skillMds = discoverPluginSkillMds();

  test("at least one plugin-bundled SKILL.md is discovered", () => {
    assert.ok(skillMds.length > 0, "expected to find plugin-bundled SKILL.md files");
  });

  for (const skillMd of skillMds) {
    const rel = path.relative(REPO_ROOT, skillMd);
    test(`${rel} has valid YAML frontmatter with name + description`, () => {
      const raw = fs.readFileSync(skillMd, "utf-8");
      let parsed: ReturnType<typeof matter>;
      try {
        parsed = matter(raw);
      } catch (e) {
        assert.fail(`invalid YAML frontmatter: ${(e as Error).message}`);
      }
      assert.equal(
        typeof parsed.data.name,
        "string",
        "frontmatter must have a string `name`",
      );
      assert.ok(
        typeof parsed.data.description === "string" && parsed.data.description.length > 0,
        "frontmatter must have a non-empty string `description`",
      );
    });
  }
});

describe("plugin hooks.json contracts", () => {
  const hooksJsonFiles = discoverPluginHooksJson();

  test("at least one plugin hooks.json is discovered", () => {
    assert.ok(hooksJsonFiles.length > 0, "expected to find plugin hooks.json files");
  });

  for (const hooksJson of hooksJsonFiles) {
    const rel = path.relative(REPO_ROOT, hooksJson);
    test(`${rel} has only the Codex-supported top-level hooks field`, () => {
      const parsed = JSON.parse(fs.readFileSync(hooksJson, "utf-8")) as Record<string, unknown>;
      assert.deepEqual(
        Object.keys(parsed).sort(),
        ["hooks"],
        "Codex plugin hooks parser rejects unknown top-level fields",
      );
      assert.equal(typeof parsed.hooks, "object", "`hooks` must be an object");
      assert.notEqual(parsed.hooks, null, "`hooks` must not be null");
    });
  }
});
