import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { installWorkflow } from "../src/workflow.js";

const scratchDirs: string[] = [];

function makeScratch(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `auriga-install-wf-${label}-`));
  scratchDirs.push(dir);
  return dir;
}

function makePackageRoot(content = "# auriga Workflow (v1.7.0)\n"): string {
  const dir = makeScratch("pkg");
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), content);
  return dir;
}

after(() => {
  for (const d of scratchDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("installWorkflow", () => {
  test("fresh install: no existing CLAUDE.md → no .bak created", async () => {
    const packageRoot = makePackageRoot();
    const cwd = makeScratch("fresh");

    await installWorkflow(packageRoot, { interactive: false, cwd, lang: "en" });

    assert.equal(fs.existsSync(path.join(cwd, "CLAUDE.md")), true);
    assert.equal(fs.existsSync(path.join(cwd, "CLAUDE.md.bak")), false);
  });

  test("install over foreign CLAUDE.md → backs up to .bak", async () => {
    const packageRoot = makePackageRoot();
    const cwd = makeScratch("foreign");
    const original = "# My hand-written notes\nstuff stuff\n";
    fs.writeFileSync(path.join(cwd, "CLAUDE.md"), original);

    await installWorkflow(packageRoot, { interactive: false, cwd, lang: "en" });

    assert.equal(fs.readFileSync(path.join(cwd, "CLAUDE.md.bak"), "utf-8"), original);
    assert.notEqual(fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf-8"), original);
  });

  test("re-install preserves original .bak (F1 regression)", async () => {
    // When re-install becomes the update path (post v1.19.0 update-status
    // deprecation), running installWorkflow twice MUST NOT overwrite the
    // first backup — the FIRST .bak is the one that captures the user's
    // pre-auriga content, which is what they want to restore to. This
    // mirrors src/hooks.ts backupOnce discipline.
    const packageRoot = makePackageRoot();
    const cwd = makeScratch("reinstall");
    const original = "# User's pre-auriga CLAUDE.md\n";
    fs.writeFileSync(path.join(cwd, "CLAUDE.md"), original);

    // First install: original → .bak; auriga workflow → CLAUDE.md
    await installWorkflow(packageRoot, { interactive: false, cwd, lang: "en" });
    assert.equal(fs.readFileSync(path.join(cwd, "CLAUDE.md.bak"), "utf-8"), original);

    // Second install (the "re-install as update" path): .bak MUST still
    // hold the original pre-auriga content, NOT the previous auriga
    // workflow version.
    await installWorkflow(packageRoot, { interactive: false, cwd, lang: "en" });
    assert.equal(
      fs.readFileSync(path.join(cwd, "CLAUDE.md.bak"), "utf-8"),
      original,
      "second install must not overwrite the original .bak — that destroys user's recovery path",
    );
  });

  test("install creates AGENTS.md symlink", async () => {
    const packageRoot = makePackageRoot();
    const cwd = makeScratch("symlink");

    await installWorkflow(packageRoot, { interactive: false, cwd, lang: "en" });

    const lstat = fs.lstatSync(path.join(cwd, "AGENTS.md"));
    assert.equal(lstat.isSymbolicLink(), true);
    assert.equal(fs.readlinkSync(path.join(cwd, "AGENTS.md")), "CLAUDE.md");
  });
});
