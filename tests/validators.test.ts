import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { validateSkillsLock } from "../src/skills.js";
import { validatePluginsConfig } from "../src/plugins.js";
import { validateCodexInstallConfig } from "../src/codex-plugin-config.js";

// skills-lock.json + .claude/plugins.json are fetched from raw GitHub
// at runtime and their values are interpolated into shell commands.
// These validators are the only thing standing between a compromised
// metadata source and arbitrary command execution — lock them down.

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

describe("validatePluginsConfig (codex deep-review #4)", () => {
  test("accepts the canonical shape", () => {
    assert.doesNotThrow(() =>
      validatePluginsConfig({
        plugins: [
          { name: "skill-creator", package: "skill-creator@anthropic" },
          {
            name: "auriga-go",
            package: "auriga-go@auriga-cli",
            marketplace: { name: "auriga-cli", source: "Ben2pc/auriga-cli" },
          },
        ],
      }),
    );
  });

  test("rejects plugin name / package / marketplace source with injection payloads", () => {
    const cases: [string, unknown][] = [
      ["name", "a; rm -rf /"],
      ["package", "pkg@owner`whoami`"],
      ["marketplace.source", "$(whoami)"],
    ];
    for (const [field, payload] of cases) {
      const base: Record<string, unknown> = { name: "ok", package: "ok@ok" };
      if (field === "name") base.name = payload as string;
      if (field === "package") base.package = payload as string;
      if (field === "marketplace.source") {
        base.marketplace = { name: "ok", source: payload as string };
      }
      assert.throws(
        () => validatePluginsConfig({ plugins: [base] }),
        /does not match|must be an object/,
        `${field}=${String(payload)} must be rejected`,
      );
    }
  });

  test("rejects non-array .plugins and non-object entries", () => {
    assert.throws(() => validatePluginsConfig({ plugins: "oops" }), /\.plugins must be an array/);
    assert.throws(
      () => validatePluginsConfig({ plugins: ["oops"] }),
      /must be an object/,
    );
  });
});

describe("validateCodexInstallConfig — local + external marketplace shapes", () => {
  test("accepts the canonical local-only shape", () => {
    assert.doesNotThrow(() =>
      validateCodexInstallConfig({
        plugins: [
          { name: "auriga-go", description: "x" },
          { name: "session-instructions-loader" },
        ],
      }),
    );
  });

  test("accepts an external-marketplace entry with name + source", () => {
    assert.doesNotThrow(() =>
      validateCodexInstallConfig({
        plugins: [
          { name: "auriga-go" },
          {
            name: "deep-review",
            description: "Multi-dimensional PR review",
            marketplace: { name: "g-claude-code-plugins", source: "Ben2pc/g-claude-code-plugins" },
          },
        ],
      }),
    );
  });

  test("rejects marketplace name / source with shell injection payloads", () => {
    const cases: [string, string][] = [
      ["name", "a; rm -rf /"],
      ["name", "ok`whoami`"],
      ["source", "$(whoami)"],
      ["source", "ok ok"],
      ["source", "ok/ok'x'"],
    ];
    for (const [field, payload] of cases) {
      const marketplace =
        field === "name"
          ? { name: payload, source: "ok/ok" }
          : { name: "ok", source: payload };
      assert.throws(
        () =>
          validateCodexInstallConfig({
            plugins: [{ name: "deep-review", marketplace }],
          }),
        /does not match/,
        `marketplace.${field}=${payload} must be rejected`,
      );
    }
  });

  test("rejects non-object marketplace field", () => {
    assert.throws(
      () =>
        validateCodexInstallConfig({
          plugins: [{ name: "deep-review", marketplace: "oops" }],
        }),
      /marketplace must be an object/,
    );
  });

  test("rejects marketplace missing name or source", () => {
    assert.throws(
      () =>
        validateCodexInstallConfig({
          plugins: [{ name: "deep-review", marketplace: { name: "ok" } }],
        }),
      /marketplace\.source/,
    );
    assert.throws(
      () =>
        validateCodexInstallConfig({
          plugins: [{ name: "deep-review", marketplace: { source: "ok/ok" } }],
        }),
      /marketplace\.name/,
    );
  });
});
