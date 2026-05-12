import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, mock, test } from "node:test";

import type { SkillsLock } from "../src/utils.js";

let importSerial = 0;

function makeScratchLock(skills: Record<string, { source: string }>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-uninstall-skill-"));
  const lock: SkillsLock = {
    version: 1,
    skills: Object.fromEntries(
      Object.entries(skills).map(([n, e]) => [
        n,
        { source: e.source, sourceType: "github", computedHash: "x" },
      ]),
    ),
  };
  fs.writeFileSync(path.join(root, "skills-lock.json"), JSON.stringify(lock, null, 2) + "\n");
  return root;
}

async function importSkills(
  execImpl: (cmd: string, opts?: { cwd?: string; inherit?: boolean }) => string,
) {
  // Each test imports a fresh module copy via the ?case=N query trick
  // (plugins.test.ts uses the same pattern) so mock.module overrides
  // bind cleanly and don't bleed between cases.
  mock.module(new URL("../src/utils.js", import.meta.url), {
    namedExports: {
      atomicWriteFile: (filePath: string, content: string) => {
        fs.writeFileSync(filePath, content);
      },
      exec: execImpl,
      readPackageVersion: () => "0.0.0-test",
      log: {
        ok: () => {},
        warn: () => {},
        error: () => {},
        skip: () => {},
      },
      withEsc: async <T>(prompt: Promise<T>) => prompt,
    },
  });
  return import(new URL(`../src/skills.js?case=${importSerial++}`, import.meta.url).href);
}

afterEach(() => {
  mock.restoreAll();
});

describe("uninstallSkill — exec success path", () => {
  test("calls `npx -y skills remove <name>` and stops on success", async () => {
    const cwd = makeScratchLock({});
    const calls: string[] = [];
    const { uninstallSkill } = await importSkills((cmd) => {
      calls.push(cmd);
      return "";
    });

    await uninstallSkill("brainstorming", { cwd });

    assert.deepEqual(calls, ["npx -y skills remove brainstorming"]);
  });

  test("forwards arbitrary exec errors (non-fallback failures propagate)", async () => {
    const cwd = makeScratchLock({});
    const { uninstallSkill } = await importSkills(() => {
      throw new Error("ENETDOWN: network down");
    });

    await assert.rejects(
      () => uninstallSkill("brainstorming", { cwd }),
      /ENETDOWN/,
    );
  });

  test("rejects invalid skill names before any exec call", async () => {
    const cwd = makeScratchLock({});
    const calls: string[] = [];
    const { uninstallSkill } = await importSkills((cmd) => {
      calls.push(cmd);
      return "";
    });

    await assert.rejects(
      () => uninstallSkill("../escape", { cwd }),
      /invalid skill name/,
    );
    assert.deepEqual(calls, [], "exec must not be called for invalid input");
  });
});

describe("uninstallSkill — fallback path", () => {
  // The fallback fires when `npx skills remove` errors with a message
  // signaling the subcommand isn't supported. We simulate the upstream
  // CLI's "Unknown command remove" output.
  function makeRemoveUnsupportedError(): Error {
    const err = new Error("Command failed: npx -y skills remove brainstorming");
    (err as Error & { stderr?: string }).stderr = "Unknown command 'remove'";
    return err;
  }

  test("falls back to manual cleanup when CLI doesn't support remove", async () => {
    const cwd = makeScratchLock({
      brainstorming: { source: "obra/superpowers" },
      "deep-review": { source: "Ben2pc/g-claude-code-plugins" },
    });
    fs.mkdirSync(path.join(cwd, ".claude/skills/brainstorming"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".claude/skills/brainstorming/SKILL.md"), "x");
    fs.mkdirSync(path.join(cwd, ".agents/skills/brainstorming"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".agents/skills/brainstorming/SKILL.md"), "x");

    const { uninstallSkill } = await importSkills(() => {
      throw makeRemoveUnsupportedError();
    });

    await uninstallSkill("brainstorming", { cwd });

    // Directories gone
    assert.equal(fs.existsSync(path.join(cwd, ".claude/skills/brainstorming")), false);
    assert.equal(fs.existsSync(path.join(cwd, ".agents/skills/brainstorming")), false);

    // Lockfile mutated: brainstorming gone, deep-review preserved
    const lock = JSON.parse(fs.readFileSync(path.join(cwd, "skills-lock.json"), "utf-8")) as SkillsLock;
    assert.equal("brainstorming" in lock.skills, false);
    assert.equal("deep-review" in lock.skills, true);
  });

  test("fallback is idempotent — skill absent everywhere → no throw", async () => {
    const cwd = makeScratchLock({ "deep-review": { source: "x/y" } });
    const { uninstallSkill } = await importSkills(() => {
      throw makeRemoveUnsupportedError();
    });

    // brainstorming was never installed — fallback must succeed silently
    await uninstallSkill("brainstorming", { cwd });

    // Lockfile untouched (deep-review still there)
    const lock = JSON.parse(fs.readFileSync(path.join(cwd, "skills-lock.json"), "utf-8")) as SkillsLock;
    assert.equal("deep-review" in lock.skills, true);
  });

  test("fallback handles missing lockfile (cleans dirs only)", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-uninstall-skill-nolock-"));
    fs.mkdirSync(path.join(cwd, ".claude/skills/brainstorming"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".claude/skills/brainstorming/SKILL.md"), "x");

    const { uninstallSkill } = await importSkills(() => {
      throw makeRemoveUnsupportedError();
    });

    await uninstallSkill("brainstorming", { cwd });

    assert.equal(fs.existsSync(path.join(cwd, ".claude/skills/brainstorming")), false);
    assert.equal(fs.existsSync(path.join(cwd, "skills-lock.json")), false);
  });

  test("onLog stream records the fallback decision", async () => {
    const cwd = makeScratchLock({ brainstorming: { source: "obra/superpowers" } });
    fs.mkdirSync(path.join(cwd, ".claude/skills/brainstorming"), { recursive: true });

    const logs: string[] = [];
    const { uninstallSkill } = await importSkills(() => {
      throw makeRemoveUnsupportedError();
    });

    await uninstallSkill("brainstorming", { cwd, onLog: (l: string) => logs.push(l) });

    assert.ok(
      logs.some((l) => /fall(ing|back|\s+back)/i.test(l)),
      `expected onLog to record fallback decision, got: ${logs.join(" | ")}`,
    );
    assert.ok(
      logs.some((l) => /removed/i.test(l) && /\.claude/.test(l)),
      `expected onLog to record .claude removal, got: ${logs.join(" | ")}`,
    );
  });
});

describe("uninstallSkillManual — direct entry point", () => {
  test("removes .claude + .agents + lockfile entry in one pass", async () => {
    const cwd = makeScratchLock({
      brainstorming: { source: "obra/superpowers" },
      "deep-review": { source: "Ben2pc/g-claude-code-plugins" },
    });
    fs.mkdirSync(path.join(cwd, ".claude/skills/brainstorming"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".claude/skills/brainstorming/SKILL.md"), "x");
    fs.mkdirSync(path.join(cwd, ".agents/skills/brainstorming"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".agents/skills/brainstorming/SKILL.md"), "y");

    const { uninstallSkillManual } = await importSkills(() => "");

    await uninstallSkillManual("brainstorming", cwd);

    assert.equal(fs.existsSync(path.join(cwd, ".claude/skills/brainstorming")), false);
    assert.equal(fs.existsSync(path.join(cwd, ".agents/skills/brainstorming")), false);
    const lock = JSON.parse(fs.readFileSync(path.join(cwd, "skills-lock.json"), "utf-8")) as SkillsLock;
    assert.deepEqual(Object.keys(lock.skills), ["deep-review"]);
  });

  test("rejects invalid name in fallback too (defense in depth)", async () => {
    const cwd = makeScratchLock({});
    const { uninstallSkillManual } = await importSkills(() => "");
    await assert.rejects(
      () => uninstallSkillManual("../escape", cwd),
      /invalid skill name/,
    );
  });
});
