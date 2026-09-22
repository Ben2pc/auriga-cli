import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { WORKFLOW_SKILLS, planSkillInstallCommands } from "../src/skills.js";
import type { SkillsLock } from "../src/utils.js";

// Typed as the real SkillsLock["skills"] shape so schema drift in
// SkillEntry (new required fields, etc.) surfaces here as a compile error.
const stub = (source: string) => ({
  source,
  sourceType: "github",
  computedHash: "x",
});

// Mirrors real skills-lock.json source mappings so the fixture is
// truthful — past versions used `deep-review` as a stand-in for a
// g-claude-code-plugins skill, which is now misleading (deep-review is
// a plugin, not a skill, and lives in this repo). When in doubt, keep
// names + sources aligned with skills-lock.json.
const LOCK: SkillsLock["skills"] = {
  "claude-code-agent": stub("Ben2pc/g-claude-code-plugins"),
  "codex-agent": stub("Ben2pc/g-claude-code-plugins"),
  "playwright-cli": stub("microsoft/playwright-cli"),
};

describe("planSkillInstallCommands", () => {
  test("repo-owned plugin skills and retired entries are not standalone workflow-skill defaults", () => {
    // rationale: these names either ship through auriga-workflow or were
    // retired into it, so bare `install skills` must not ask the skills CLI
    // to add them as standalone workflow skills.
    const pluginOwnedOrRetired = [
      "incremental-impl",
      "test-designer",
      "session-compound",
      "systematic-debugging",
      "test-driven-development",
    ];
    assert.deepEqual(
      pluginOwnedOrRetired.filter((name) => WORKFLOW_SKILLS.includes(name)),
      [],
    );
    assert.equal(WORKFLOW_SKILLS.includes("test-driven-development"), false);
  });

  test("single source, single skill → one command with npx -y", () => {
    const batches = planSkillInstallCommands(["playwright-cli"], LOCK, "");
    assert.equal(batches.length, 1);
    assert.equal(batches[0].source, "microsoft/playwright-cli");
    assert.deepEqual(batches[0].skills, ["playwright-cli"]);
    assert.match(batches[0].command, /^npx -y skills add /);
    assert.match(batches[0].command, / --skill playwright-cli /);
    assert.match(batches[0].command, / --agent claude-code codex /);
    assert.match(batches[0].command, / --yes$/);
  });

  test("single source, multiple skills → merged --skill list, space-separated", () => {
    const batches = planSkillInstallCommands(
      ["claude-code-agent", "codex-agent"],
      LOCK,
      "",
    );
    assert.equal(batches.length, 1);
    assert.equal(batches[0].source, "Ben2pc/g-claude-code-plugins");
    assert.deepEqual(batches[0].skills, [
      "claude-code-agent",
      "codex-agent",
    ]);
    assert.match(
      batches[0].command,
      / --skill claude-code-agent codex-agent /,
    );
  });

  test("duplicate selections are preserved for the caller to diagnose", () => {
    const batches = planSkillInstallCommands(
      ["playwright-cli", "playwright-cli"],
      LOCK,
      "",
    );
    assert.deepEqual(batches[0].skills, [
      "playwright-cli",
      "playwright-cli",
    ]);
  });

  test("multiple sources → one batch per source, grouping is stable", () => {
    const batches = planSkillInstallCommands(
      [
        "claude-code-agent",
        "codex-agent",
        "playwright-cli",
      ],
      LOCK,
      "",
    );
    assert.equal(batches.length, 2);
    const bySource = Object.fromEntries(batches.map((b) => [b.source, b.skills]));
    assert.deepEqual(bySource["Ben2pc/g-claude-code-plugins"], [
      "claude-code-agent",
      "codex-agent",
    ]);
    assert.deepEqual(bySource["microsoft/playwright-cli"], ["playwright-cli"]);
  });

  test("every distinct source yields one batch", () => {
    const batches = planSkillInstallCommands(Object.keys(LOCK), LOCK, "");
    assert.equal(batches.length, 2); // 2 distinct sources in the real lock fixture
  });

  test("globalFlag threads into every command", () => {
    const batches = planSkillInstallCommands(
      ["playwright-cli", "claude-code-agent"],
      LOCK,
      " -g",
    );
    for (const b of batches) {
      assert.match(b.command, new RegExp(` ${b.source} -g `));
    }
  });

  test("no globalFlag → no trailing -g in the source slot", () => {
    const batches = planSkillInstallCommands(["playwright-cli"], LOCK, "");
    assert.doesNotMatch(batches[0].command, / -g /);
  });

  test("unknown skill name is ignored (defensive — caller filters first, but planner must not crash)", () => {
    const batches = planSkillInstallCommands(
      ["playwright-cli", "not-a-real-skill"],
      LOCK,
      "",
    );
    // Only the known skill survives; no throw.
    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0].skills, ["playwright-cli"]);
  });

  test("empty selection → empty plan", () => {
    assert.deepEqual(planSkillInstallCommands([], LOCK, ""), []);
  });
});
