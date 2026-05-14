import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { validateSkillsLock } from "../src/skills.js";
import { validateExtraPluginConfigs } from "../src/plugins.js";

// skills-lock.json + extra_plugin_configs.json are fetched from raw GitHub
// at runtime and their values are interpolated into shell commands. These
// validators are the boundary between compromised metadata and command
// injection, so keep them conservative.

describe("validateSkillsLock (codex deep-review #3)", () => {
  test("accepts the canonical shape", () => {
    assert.doesNotThrow(() =>
      validateSkillsLock({
        skills: {
          brainstorming: { source: "obra/superpowers", sourceType: "github", computedHash: "x" },
          "test-designer": { source: "Ben2pc/g-claude-code-plugins" },
        },
      }),
    );
  });

  test("rejects skill name with shell metacharacters", () => {
    assert.throws(
      () =>
        validateSkillsLock({
          skills: { "a; rm -rf /": { source: "ok/ok" } },
        }),
      /skill name .* does not match/,
    );
  });

  test("rejects source with backticks / $() / spaces / shell quoting", () => {
    for (const bad of ["ok/ok`whoami`", "$(whoami)", "ok/ok;ls", "ok ok", "ok/ok'x'"]) {
      assert.throws(
        () => validateSkillsLock({ skills: { a: { source: bad } } }),
        /source .* does not match/,
        `${bad} must be rejected`,
      );
    }
  });

  test("rejects missing / non-object root and missing skills", () => {
    assert.throws(() => validateSkillsLock(null), /root must be an object/);
    assert.throws(() => validateSkillsLock({}), /\.skills must be an object/);
  });
});

describe("validateExtraPluginConfigs", () => {
  test("accepts local overrides plus Claude and Codex external plugins", () => {
    assert.doesNotThrow(() =>
      validateExtraPluginConfigs({
        plugins: [
          { name: "auriga-notify", agents: ["claude"], defaultOn: false },
          {
            name: "skill-creator",
            agents: ["claude"],
            description: "Create and manage custom skills",
            claude: { package: "skill-creator@claude-plugins-official" },
          },
          {
            name: "external-codex",
            agents: ["codex"],
            description: "External Codex plugin",
            codex: { marketplace: { name: "external", source: "ok/ok" } },
          },
        ],
      }),
    );
  });

  test("rejects plugin name / package / marketplace source with injection payloads", () => {
    const cases: [string, unknown][] = [
      ["name", "a; rm -rf /"],
      ["claude.package", "pkg@owner`whoami`"],
      ["marketplace.source", "$(whoami)"],
    ];
    for (const [field, payload] of cases) {
      const base: Record<string, unknown> = { name: "ok", agents: ["claude"] };
      if (field === "name") base.name = payload as string;
      if (field === "claude.package") base.claude = { package: payload as string };
      if (field === "marketplace.source") {
        base.codex = { marketplace: { name: "ok", source: payload as string } };
      }
      assert.throws(
        () => validateExtraPluginConfigs({ plugins: [base] }),
        /does not match|must be an object/,
        `${field}=${String(payload)} must be rejected`,
      );
    }
  });

  test("rejects malformed agents, plugin list, and marketplace references", () => {
    assert.throws(() => validateExtraPluginConfigs({ plugins: "oops" }), /\.plugins must be an array/);
    assert.throws(() => validateExtraPluginConfigs({ plugins: ["oops"] }), /must be an object/);
    assert.throws(
      () => validateExtraPluginConfigs({ plugins: [{ name: "ok", agents: ["weird"] }] }),
      /agents must contain only/,
    );
    assert.throws(
      () =>
        validateExtraPluginConfigs({
          plugins: [{ name: "x", codex: { marketplace: { name: "ok", source: "owner/repo/extra" } } }],
        }),
      /marketplace\.source/,
    );
  });
});
