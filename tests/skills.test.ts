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
  "test-driven-development": stub("obra/superpowers"),
  "verification-before-completion": stub("obra/superpowers"),
  "claude-code-agent": stub("Ben2pc/g-claude-code-plugins"),
  "codex-agent": stub("Ben2pc/g-claude-code-plugins"),
  "incremental-impl": stub("Ben2pc/auriga-cli"),
  "planning-with-files": stub("OthmanAdi/planning-with-files"),
  "playwright-cli": stub("microsoft/playwright-cli"),
};

describe("planSkillInstallCommands", () => {
  test("repo-owned migrated workflow skills are not standalone workflow-skill defaults", () => {
    // rationale: these skills now ship through the auriga-workflow
    // plugin, so bare `install skills` must not ask the skills CLI to add
    // them as standalone workflow skills.
    const migrated = [
      "incremental-impl",
      "test-designer",
      "session-compound",
      "systematic-debugging",
    ];
    assert.deepEqual(
      migrated.filter((name) => WORKFLOW_SKILLS.includes(name)),
      [],
    );
    assert.ok(WORKFLOW_SKILLS.includes("test-driven-development"));
  });

  test("single source, single skill → one command with npx -y", () => {
    const batches = planSkillInstallCommands(["test-driven-development"], LOCK, "");
    assert.equal(batches.length, 1);
    assert.equal(batches[0].source, "obra/superpowers");
    assert.deepEqual(batches[0].skills, ["test-driven-development"]);
    assert.match(batches[0].command, /^npx -y skills add /);
    assert.match(batches[0].command, / --skill test-driven-development /);
    assert.match(batches[0].command, / --agent claude-code codex /);
    assert.match(batches[0].command, / --yes$/);
  });

  test("single source, multiple skills → merged --skill list, space-separated", () => {
    const batches = planSkillInstallCommands(
      ["test-driven-development", "test-driven-development", "verification-before-completion"],
      LOCK,
      "",
    );
    assert.equal(batches.length, 1);
    assert.equal(batches[0].source, "obra/superpowers");
    assert.deepEqual(batches[0].skills, [
      "test-driven-development",
      "test-driven-development",
      "verification-before-completion",
    ]);
    assert.match(
      batches[0].command,
      / --skill test-driven-development test-driven-development verification-before-completion /,
    );
  });

  test("multiple sources → one batch per source, grouping is stable", () => {
    const batches = planSkillInstallCommands(
      [
        "test-driven-development",
        "claude-code-agent",
        "test-driven-development",
        "codex-agent",
        "planning-with-files",
      ],
      LOCK,
      "",
    );
    assert.equal(batches.length, 3);
    const bySource = Object.fromEntries(batches.map((b) => [b.source, b.skills]));
    assert.deepEqual(bySource["obra/superpowers"], [
      "test-driven-development",
      "test-driven-development",
    ]);
    assert.deepEqual(bySource["Ben2pc/g-claude-code-plugins"], [
      "claude-code-agent",
      "codex-agent",
    ]);
    assert.deepEqual(bySource["OthmanAdi/planning-with-files"], [
      "planning-with-files",
    ]);
  });

  test("every distinct source yields one batch", () => {
    const batches = planSkillInstallCommands(Object.keys(LOCK), LOCK, "");
    assert.equal(batches.length, 5); // 5 distinct sources in LOCK
  });

  test("globalFlag threads into every command", () => {
    const batches = planSkillInstallCommands(
      ["test-driven-development", "claude-code-agent"],
      LOCK,
      " -g",
    );
    for (const b of batches) {
      assert.match(b.command, new RegExp(` ${b.source} -g `));
    }
  });

  test("no globalFlag → no trailing -g in the source slot", () => {
    const batches = planSkillInstallCommands(["test-driven-development"], LOCK, "");
    assert.doesNotMatch(batches[0].command, / -g /);
  });

  test("unknown skill name is ignored (defensive — caller filters first, but planner must not crash)", () => {
    const batches = planSkillInstallCommands(
      ["test-driven-development", "not-a-real-skill"],
      LOCK,
      "",
    );
    // Only the known skill survives; no throw.
    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0].skills, ["test-driven-development"]);
  });

  test("empty selection → empty plan", () => {
    assert.deepEqual(planSkillInstallCommands([], LOCK, ""), []);
  });
});
