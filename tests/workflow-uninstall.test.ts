import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { uninstallWorkflow } from "../src/workflow.js";
import { composeMarkedFile } from "../src/workflow-markers.js";

// Track scratch dirs so a single after-hook can sweep them up, even on
// test failure. Hardcoded /tmp paths would race across concurrent runs.
const scratchDirs: string[] = [];

function makeScratch(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `auriga-uninstall-wf-${label}-`));
  scratchDirs.push(dir);
  return dir;
}

after(() => {
  for (const d of scratchDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("uninstallWorkflow", () => {
  test("force=false throws (refuses to act without explicit consent)", async () => {
    const cwd = makeScratch("noforce");
    await assert.rejects(
      () => uninstallWorkflow({ cwd, force: false }),
      /requires force=true/,
    );
  });

  test("force omitted throws (default deny)", async () => {
    const cwd = makeScratch("missing");
    await assert.rejects(
      () => uninstallWorkflow({ cwd } as { cwd: string; force?: boolean }),
      /requires force=true/,
    );
  });

  test("force=true removes managed AGENTS.md primary", async () => {
    const cwd = makeScratch("agents-primary");
    fs.writeFileSync(
      path.join(cwd, "AGENTS.md"),
      composeMarkedFile({ blockBody: "# auriga Workflow (v1.9.0)\nbody\n" }),
    );
    fs.symlinkSync("AGENTS.md", path.join(cwd, "CLAUDE.md"));
    await uninstallWorkflow({ cwd, force: true });
    assert.equal(fs.existsSync(path.join(cwd, "AGENTS.md")), false);
    assert.equal(fs.existsSync(path.join(cwd, "CLAUDE.md")), false);
  });

  test("legacy AGENTS.md -> CLAUDE.md install shape is removed", async () => {
    const cwd = makeScratch("symlink");
    fs.writeFileSync(
      path.join(cwd, "CLAUDE.md"),
      composeMarkedFile({ blockBody: "# auriga Workflow (v1.9.0)\nbody\n" }),
    );
    fs.symlinkSync("CLAUDE.md", path.join(cwd, "AGENTS.md"));
    // sanity: lstat reports symlink before uninstall
    assert.equal(fs.lstatSync(path.join(cwd, "AGENTS.md")).isSymbolicLink(), true);

    await uninstallWorkflow({ cwd, force: true });

    // Both gone; no leftover dangling symlink
    assert.equal(fs.existsSync(path.join(cwd, "CLAUDE.md")), false);
    let lstatErr: NodeJS.ErrnoException | null = null;
    try { fs.lstatSync(path.join(cwd, "AGENTS.md")); } catch (e) { lstatErr = e as NodeJS.ErrnoException; }
    assert.equal(lstatErr?.code, "ENOENT");
  });

  test("foreign AGENTS.md as a real file is preserved", async () => {
    const cwd = makeScratch("realfile");
    fs.writeFileSync(path.join(cwd, "AGENTS.md"), "# Custom agents content\n");
    fs.symlinkSync("AGENTS.md", path.join(cwd, "CLAUDE.md"));

    const logs: string[] = [];
    await uninstallWorkflow({ cwd, force: true, onLog: (l) => logs.push(l) });

    // CLAUDE.md gone, foreign AGENTS.md preserved
    assert.equal(fs.existsSync(path.join(cwd, "CLAUDE.md")), false);
    assert.equal(fs.existsSync(path.join(cwd, "AGENTS.md")), true);
    assert.equal(
      fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf-8"),
      "# Custom agents content\n",
    );
    // Warning surfaced on onLog stream so the SSE caller can show it
    assert.ok(
      logs.some((l) => /foreign AGENTS\.md/i.test(l)),
      `expected onLog to mention foreign AGENTS.md, got: ${logs.join(" | ")}`,
    );
  });

  test("foreign instruction symlinks are preserved", async () => {
    const cwd = makeScratch("foreignlinks");
    fs.writeFileSync(path.join(cwd, "shared-agents.md"), "# Shared AGENTS\n");
    fs.writeFileSync(path.join(cwd, "shared-claude.md"), "# Shared CLAUDE\n");
    fs.symlinkSync("shared-agents.md", path.join(cwd, "AGENTS.md"));
    fs.symlinkSync("shared-claude.md", path.join(cwd, "CLAUDE.md"));

    const logs: string[] = [];
    await uninstallWorkflow({ cwd, force: true, onLog: (l) => logs.push(l) });

    assert.equal(fs.readlinkSync(path.join(cwd, "AGENTS.md")), "shared-agents.md");
    assert.equal(fs.readlinkSync(path.join(cwd, "CLAUDE.md")), "shared-claude.md");
    assert.ok(
      logs.some((l) => /foreign AGENTS\.md/i.test(l)) &&
        logs.some((l) => /foreign CLAUDE\.md/i.test(l)),
      `expected foreign symlink logs, got: ${logs.join(" | ")}`,
    );
  });

  test("missing files are idempotent (no throw, no error)", async () => {
    const cwd = makeScratch("empty");
    // Empty dir, no CLAUDE.md, no AGENTS.md
    await uninstallWorkflow({ cwd, force: true });
    // Second run is also a no-op
    await uninstallWorkflow({ cwd, force: true });
    // Nothing got created
    assert.equal(fs.existsSync(path.join(cwd, "CLAUDE.md")), false);
    assert.equal(fs.existsSync(path.join(cwd, "AGENTS.md")), false);
  });

  test("invalid cwd throws (not a directory)", async () => {
    await assert.rejects(
      () => uninstallWorkflow({ cwd: "/nonexistent-path-uninstall-test", force: true }),
      /Not a valid directory/,
    );
  });

  test("does not touch .claude/ siblings", async () => {
    const cwd = makeScratch("claudedir");
    fs.writeFileSync(
      path.join(cwd, "AGENTS.md"),
      composeMarkedFile({ blockBody: "# auriga Workflow (v1.9.0)\nbody\n" }),
    );
    fs.symlinkSync("AGENTS.md", path.join(cwd, "CLAUDE.md"));
    fs.mkdirSync(path.join(cwd, ".claude", "skills", "x"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".claude", "skills", "x", "SKILL.md"), "x");

    await uninstallWorkflow({ cwd, force: true });

    // .claude/ tree untouched — that's the responsibility of uninstallSkill / uninstallHook
    assert.equal(
      fs.existsSync(path.join(cwd, ".claude", "skills", "x", "SKILL.md")),
      true,
    );
  });

  test("onLog receives one line per action", async () => {
    const cwd = makeScratch("onlog");
    fs.writeFileSync(
      path.join(cwd, "AGENTS.md"),
      composeMarkedFile({ blockBody: "# auriga Workflow (v1.9.0)\nbody\n" }),
    );
    fs.symlinkSync("AGENTS.md", path.join(cwd, "CLAUDE.md"));

    const logs: string[] = [];
    await uninstallWorkflow({ cwd, force: true, onLog: (l) => logs.push(l) });

    // Two distinct log lines — one per file we manipulated
    assert.ok(
      logs.some((l) => /CLAUDE\.md/.test(l)),
      `missing CLAUDE.md log: ${logs.join(" | ")}`,
    );
    assert.ok(
      logs.some((l) => /AGENTS\.md/.test(l)),
      `missing AGENTS.md log: ${logs.join(" | ")}`,
    );
  });
});
