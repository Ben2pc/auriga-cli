import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { planSkillInstallCommands } from "../src/skills.js";

// Mirrors the live skills-lock.json structure — just enough for the planner.
const LOCK = {
  brainstorming: { source: "obra/superpowers" },
  "systematic-debugging": { source: "obra/superpowers" },
  "test-driven-development": { source: "obra/superpowers" },
  "verification-before-completion": { source: "obra/superpowers" },
  "deep-review": { source: "Ben2pc/g-claude-code-plugins" },
  "test-designer": { source: "Ben2pc/g-claude-code-plugins" },
  "parallel-implementation": { source: "Ben2pc/g-claude-code-plugins" },
  "planning-with-files": { source: "OthmanAdi/planning-with-files" },
  "playwright-cli": { source: "microsoft/playwright-cli" },
  "ui-ux-pro-max": { source: "nextlevelbuilder/ui-ux-pro-max-skill" },
};

describe("planSkillInstallCommands", () => {
  test("single source, single skill → one command with npx -y", () => {
    const batches = planSkillInstallCommands(["brainstorming"], LOCK, "");
    assert.equal(batches.length, 1);
    assert.equal(batches[0].source, "obra/superpowers");
    assert.deepEqual(batches[0].skills, ["brainstorming"]);
    assert.match(batches[0].command, /^npx -y skills add /);
    assert.match(batches[0].command, / --skill brainstorming /);
    assert.match(batches[0].command, / --agent claude-code codex /);
    assert.match(batches[0].command, / --yes$/);
  });

  test("single source, multiple skills → merged --skill list, space-separated", () => {
    const batches = planSkillInstallCommands(
      ["brainstorming", "systematic-debugging", "test-driven-development"],
      LOCK,
      "",
    );
    assert.equal(batches.length, 1);
    assert.equal(batches[0].source, "obra/superpowers");
    assert.deepEqual(batches[0].skills, [
      "brainstorming",
      "systematic-debugging",
      "test-driven-development",
    ]);
    assert.match(
      batches[0].command,
      / --skill brainstorming systematic-debugging test-driven-development /,
    );
  });

  test("multiple sources → one batch per source, grouping is stable", () => {
    const batches = planSkillInstallCommands(
      [
        "brainstorming",
        "deep-review",
        "systematic-debugging",
        "test-designer",
        "planning-with-files",
      ],
      LOCK,
      "",
    );
    assert.equal(batches.length, 3);
    const bySource = Object.fromEntries(batches.map((b) => [b.source, b.skills]));
    assert.deepEqual(bySource["obra/superpowers"], [
      "brainstorming",
      "systematic-debugging",
    ]);
    assert.deepEqual(bySource["Ben2pc/g-claude-code-plugins"], [
      "deep-review",
      "test-designer",
    ]);
    assert.deepEqual(bySource["OthmanAdi/planning-with-files"], [
      "planning-with-files",
    ]);
  });

  test("all 10 WORKFLOW_SKILLS-ish entries collapse to 5 commands", () => {
    const batches = planSkillInstallCommands(Object.keys(LOCK), LOCK, "");
    // 5 distinct sources in LOCK
    assert.equal(batches.length, 5);
  });

  test("globalFlag threads into every command", () => {
    const batches = planSkillInstallCommands(
      ["brainstorming", "deep-review"],
      LOCK,
      " -g",
    );
    for (const b of batches) {
      assert.match(b.command, new RegExp(` ${b.source} -g `));
    }
  });

  test("no globalFlag → no trailing -g in the source slot", () => {
    const batches = planSkillInstallCommands(["brainstorming"], LOCK, "");
    assert.doesNotMatch(batches[0].command, / -g /);
  });

  test("unknown skill name is ignored (defensive — caller filters first, but planner must not crash)", () => {
    const batches = planSkillInstallCommands(
      ["brainstorming", "not-a-real-skill"],
      LOCK,
      "",
    );
    // Only the known skill survives; no throw.
    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0].skills, ["brainstorming"]);
  });

  test("empty selection → empty plan", () => {
    assert.deepEqual(planSkillInstallCommands([], LOCK, ""), []);
  });
});
