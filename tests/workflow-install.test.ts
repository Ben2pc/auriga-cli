import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { installWorkflow } from "../src/workflow.js";
import {
  workflowStartMarker,
  composeMarkedFile,
  hashBlock,
  parseMarkers,
  workflowEndMarker,
} from "../src/workflow-markers.js";

const REPO_ROOT = process.cwd();
const scratchDirs: string[] = [];

function makeScratch(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `auriga-install-wf-${label}-`));
  scratchDirs.push(dir);
  return dir;
}

const DEFAULT_BLOCK = "# auriga Workflow (v1.9.0)\nworkflow content line\n";
const DEFAULT_USER_REGION =
  "\n<!-- 工程专属规则写在这里;auriga 升级不会改动此区域。 -->\n";

/** A package root whose workflow templates are authored with managed markers. */
function makePackageRoot(block = DEFAULT_BLOCK, userRegion = DEFAULT_USER_REGION): string {
  const dir = makeScratch("pkg");
  fs.writeFileSync(
    path.join(dir, "AGENTS.md"),
    composeMarkedFile({
      blockBody: block.replace("# auriga Workflow", "# auriga 工作流"),
      userRegion,
      lang: "zh-CN",
    }),
  );
  fs.writeFileSync(
    path.join(dir, "AGENTS.en.md"),
    composeMarkedFile({ blockBody: block, userRegion }),
  );
  return dir;
}

/** Run installWorkflow while capturing everything written to console.error
 *  (log.warn / log.error go there). */
async function captureWarnings(fn: () => Promise<void>): Promise<string> {
  const orig = console.error;
  let buf = "";
  console.error = (...a: unknown[]) => {
    buf += a.map(String).join(" ") + "\n";
  };
  try {
    await fn();
  } finally {
    console.error = orig;
  }
  return buf;
}

function listBackups(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((n) =>
      n === "CLAUDE.md.bak" ||
      n.startsWith("CLAUDE.md.bak.") ||
      n === "AGENTS.md.bak" ||
      n.startsWith("AGENTS.md.bak.")
    );
}

after(() => {
  for (const d of scratchDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("installWorkflow — fresh install (VAL-WF-001, 002)", () => {
  test("VAL-FILE-001/002: writes AGENTS.md as the primary file and CLAUDE.md as compatibility symlink", async () => {
    const cwd = makeScratch("fresh-agents-primary");
    await installWorkflow(makePackageRoot(), { interactive: false, cwd, lang: "en" });

    const agentsPath = path.join(cwd, "AGENTS.md");
    const claudePath = path.join(cwd, "CLAUDE.md");
    assert.equal(fs.lstatSync(agentsPath).isSymbolicLink(), false);
    assert.equal(fs.lstatSync(claudePath).isSymbolicLink(), true);
    assert.equal(fs.readlinkSync(claudePath), "AGENTS.md");

    const parsed = parseMarkers(fs.readFileSync(agentsPath, "utf-8"));
    assert.equal(parsed.kind, "marked");
    assert.deepEqual(
      fs.readdirSync(cwd).filter((n) => n.endsWith(".bak") || n.includes(".bak.")),
      [],
    );
  });

  test("VAL-LANG-001: omitted lang defaults to the Chinese workflow template", async () => {
    const cwd = makeScratch("fresh-default-zh");
    await installWorkflow(makePackageRoot(), { interactive: false, cwd });

    const content = fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf-8");
    assert.match(content, /# auriga 工作流/);
    assert.match(content.split("\n")[0], /受管区块/);
  });

  test("VAL-WF-001: writes a marked file, header inside the block, START at the top", async () => {
    const cwd = makeScratch("fresh");
    await installWorkflow(makePackageRoot(), { interactive: false, cwd, lang: "en" });

    const content = fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf-8");
    const parsed = parseMarkers(content);
    assert.equal(parsed.kind, "marked");
    if (parsed.kind !== "marked") return;
    assert.ok(content.split("\n")[0].includes("AURIGA:WORKFLOW:v1 START"));
    assert.match(content.split("\n")[0], /Managed block/, "en install gets the English marker");
    assert.match(parsed.blockBody, /# auriga Workflow \(v\d+\.\d+\.\d+\)/);
    assert.equal(parsed.prefix.trim(), "", "no non-blank content before the START marker");
  });

  test("VAL-WF-002: a user region exists after the END marker", async () => {
    const cwd = makeScratch("fresh-userregion");
    await installWorkflow(makePackageRoot(), { interactive: false, cwd, lang: "en" });

    const parsed = parseMarkers(fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf-8"));
    assert.equal(parsed.kind, "marked");
    if (parsed.kind !== "marked") return;
    assert.ok(parsed.userRegion.includes("工程专属规则"), "template placeholder is the user region");
  });

  test("fresh install creates no backup", async () => {
    const cwd = makeScratch("fresh-nobak");
    await installWorkflow(makePackageRoot(), { interactive: false, cwd, lang: "en" });
    assert.deepEqual(listBackups(cwd), []);
  });
});

describe("installWorkflow — upgrade of a marked file (VAL-WF-003, 004)", () => {
  test("VAL-WF-003: managed block replaced, user region preserved byte-for-byte", async () => {
    const cwd = makeScratch("upgrade");
    await installWorkflow(makePackageRoot("# auriga Workflow (v1.0.0)\nold\n"), {
      interactive: false,
      cwd,
      lang: "en",
    });

    // Author a recognizable user-region edit.
    const claudePath = path.join(cwd, "CLAUDE.md");
    const userEdit = "## 我们工程的额外约定\n- 用 pnpm,不用 npm\n";
    fs.writeFileSync(claudePath, fs.readFileSync(claudePath, "utf-8") + userEdit);

    // Upgrade with a new workflow version.
    await installWorkflow(makePackageRoot("# auriga Workflow (v2.0.0)\nbrand new\n"), {
      interactive: false,
      cwd,
      lang: "en",
    });

    const parsed = parseMarkers(fs.readFileSync(claudePath, "utf-8"));
    assert.equal(parsed.kind, "marked");
    if (parsed.kind !== "marked") return;
    assert.match(parsed.blockBody, /brand new/, "block upgraded to the new version");
    assert.doesNotMatch(parsed.blockBody, /\bold\b/, "old block content gone");
    assert.ok(parsed.userRegion.includes(userEdit), "user-region edit preserved verbatim");
  });

  test("VAL-WF-004: upgrade of an unmodified marked file produces no backup", async () => {
    const cwd = makeScratch("upgrade-nobak");
    await installWorkflow(makePackageRoot("# auriga Workflow (v1.0.0)\na\n"), {
      interactive: false,
      cwd,
      lang: "en",
    });
    await installWorkflow(makePackageRoot("# auriga Workflow (v2.0.0)\nb\n"), {
      interactive: false,
      cwd,
      lang: "en",
    });
    assert.deepEqual(listBackups(cwd), []);
  });
});

describe("installWorkflow — hand-edited managed block (VAL-WF-005)", () => {
  test("VAL-WF-005: block replaced, whole old file backed up, warning emitted", async () => {
    const cwd = makeScratch("handedited");
    const claudePath = path.join(cwd, "CLAUDE.md");
    await installWorkflow(makePackageRoot("# auriga Workflow (v1.0.0)\nkeep\n"), {
      interactive: false,
      cwd,
      lang: "en",
    });

    // Hand-edit inside the managed block — the END hash now goes stale.
    const edited = fs.readFileSync(claudePath, "utf-8").replace("keep", "TAMPERED");
    fs.writeFileSync(claudePath, edited);

    const warnings = await captureWarnings(() =>
      installWorkflow(makePackageRoot("# auriga Workflow (v2.0.0)\nfresh\n"), {
        interactive: false,
        cwd,
        lang: "en",
      }),
    );

    const parsed = parseMarkers(fs.readFileSync(claudePath, "utf-8"));
    assert.equal(parsed.kind, "marked");
    if (parsed.kind !== "marked") return;
    assert.match(parsed.blockBody, /fresh/, "managed block still replaced");

    const backups = listBackups(cwd);
    assert.equal(backups.length, 1, "exactly one backup of the old file");
    assert.equal(
      fs.readFileSync(path.join(cwd, backups[0]), "utf-8"),
      edited,
      "backup holds the entire pre-upgrade file",
    );
    assert.match(warnings, /受管/, "a user-facing warning about the managed block");
  });
});

describe("installWorkflow — foreign first install (VAL-WF-006)", () => {
  test("VAL-WF-006: foreign content kept as the user region, no backup", async () => {
    const cwd = makeScratch("foreign");
    const claudePath = path.join(cwd, "CLAUDE.md");
    const foreign = "# 别的工具生成的 CLAUDE.md\n一些项目说明\n";
    fs.writeFileSync(claudePath, foreign);

    await installWorkflow(makePackageRoot(), { interactive: false, cwd, lang: "en" });

    const content = fs.readFileSync(claudePath, "utf-8");
    const parsed = parseMarkers(content);
    assert.equal(parsed.kind, "marked");
    if (parsed.kind !== "marked") return;
    assert.match(parsed.blockBody, /auriga Workflow/, "managed block installed");
    assert.ok(parsed.userRegion.includes(foreign), "foreign content preserved in the user region");
    assert.deepEqual(listBackups(cwd), [], "foreign first install needs no backup");
  });
});

describe("installWorkflow — old-format migration (VAL-WF-007, 008)", () => {
  test("VAL-WF-007: pre-marker auriga file backed up to .bak, fresh marked install, migration hint", async () => {
    const cwd = makeScratch("migrate");
    const claudePath = path.join(cwd, "CLAUDE.md");
    const oldFormat = "# auriga Workflow (v1.5.0)\n旧版工作流正文\n";
    fs.writeFileSync(claudePath, oldFormat);

    const warnings = await captureWarnings(() =>
      installWorkflow(makePackageRoot(), { interactive: false, cwd, lang: "en" }),
    );

    assert.equal(
      fs.readFileSync(path.join(cwd, "CLAUDE.md.bak"), "utf-8"),
      oldFormat,
      ".bak holds the whole old-format file",
    );
    assert.equal(parseMarkers(fs.readFileSync(claudePath, "utf-8")).kind, "marked");
    assert.match(warnings, /备份|迁移/, "a hint telling the user to migrate from the backup");
  });

  test("VAL-WF-008: a pre-existing .bak is preserved; the current file spills to a timestamped backup", async () => {
    const cwd = makeScratch("migrate-bakonce");
    const claudePath = path.join(cwd, "CLAUDE.md");
    const firstBak = "# 用户最早的原始 CLAUDE.md\n";
    const oldFormat = "# auriga Workflow (v1.5.0)\n旧版正文\n";
    fs.writeFileSync(path.join(cwd, "CLAUDE.md.bak"), firstBak);
    fs.writeFileSync(claudePath, oldFormat);

    await installWorkflow(makePackageRoot(), { interactive: false, cwd, lang: "en" });

    assert.equal(
      fs.readFileSync(path.join(cwd, "CLAUDE.md.bak"), "utf-8"),
      firstBak,
      "canonical .bak untouched (backup-once invariant)",
    );
    const stamped = fs
      .readdirSync(cwd)
      .filter((n) => n.startsWith("CLAUDE.md.bak.") && n !== "CLAUDE.md.bak");
    assert.equal(stamped.length, 1, "old-format file spilled to a timestamped backup");
    assert.equal(fs.readFileSync(path.join(cwd, stamped[0]), "utf-8"), oldFormat);
  });
});

describe("installWorkflow — malformed markers (VAL-WF-009)", () => {
  const cases: Array<[string, string]> = [
    ["only START", `${workflowStartMarker()}\n# auriga Workflow (v1.0.0)\nbody\n`],
    ["only END", `${workflowEndMarker("deadbeefcafe0123")}\nbody\n`],
    [
      "END before START",
      `${workflowEndMarker("deadbeefcafe0123")}\nmid\n${workflowStartMarker()}\nbody\n`,
    ],
  ];

  for (const [label, malformed] of cases) {
    test(`VAL-WF-009: ${label} → original backed up, fresh marked reinstall`, async () => {
      const cwd = makeScratch("malformed");
      const claudePath = path.join(cwd, "CLAUDE.md");
      fs.writeFileSync(claudePath, malformed);

      await installWorkflow(makePackageRoot(), { interactive: false, cwd, lang: "en" });

      const backups = listBackups(cwd);
      assert.equal(backups.length, 1, "original spilled to a backup");
      assert.equal(
        fs.readFileSync(path.join(cwd, backups[0]), "utf-8"),
        malformed,
        "backup holds the original malformed file verbatim",
      );
      const reinstalled = parseMarkers(fs.readFileSync(claudePath, "utf-8"));
      assert.equal(reinstalled.kind, "marked", "reinstalled file has a complete marker pair");
    });
  }
});

describe("installWorkflow — AGENTS.md primary with CLAUDE.md compatibility symlink (VAL-WF-010)", () => {
  test("VAL-FILE-004/005: old CLAUDE-primary install flips to AGENTS-primary and preserves user region", async () => {
    const cwd = makeScratch("old-shape-flip");
    const claudePath = path.join(cwd, "CLAUDE.md");
    const agentsPath = path.join(cwd, "AGENTS.md");
    fs.writeFileSync(
      claudePath,
      composeMarkedFile({
        blockBody: "# auriga Workflow (v1.0.0)\nold body\n",
        userRegion: "\n## 工程规则\n- keep this\n",
      }),
    );
    fs.symlinkSync("CLAUDE.md", agentsPath);

    await installWorkflow(makePackageRoot("# auriga Workflow (v2.0.0)\nnew body\n"), {
      interactive: false,
      cwd,
      lang: "en",
    });

    assert.equal(fs.lstatSync(agentsPath).isSymbolicLink(), false);
    assert.equal(fs.lstatSync(claudePath).isSymbolicLink(), true);
    assert.equal(fs.readlinkSync(claudePath), "AGENTS.md");

    const parsed = parseMarkers(fs.readFileSync(agentsPath, "utf-8"));
    assert.equal(parsed.kind, "marked");
    if (parsed.kind !== "marked") return;
    assert.match(parsed.blockBody, /new body/);
    assert.ok(parsed.userRegion.includes("keep this"));
  });

  test("VAL-FILE-006: a foreign real-file AGENTS.md is preserved before becoming the primary file", async () => {
    const cwd = makeScratch("agents-realfile-primary");
    const agentsPath = path.join(cwd, "AGENTS.md");
    const foreign = "# Another tool's AGENTS.md\nkeep me\n";
    fs.writeFileSync(agentsPath, foreign);

    const warnings = await captureWarnings(() =>
      installWorkflow(makePackageRoot(), { interactive: false, cwd, lang: "en" }),
    );

    const parsed = parseMarkers(fs.readFileSync(agentsPath, "utf-8"));
    assert.equal(parsed.kind, "marked");
    if (parsed.kind !== "marked") return;
    assert.ok(parsed.userRegion.includes(foreign));
    assert.equal(fs.readlinkSync(path.join(cwd, "CLAUDE.md")), "AGENTS.md");
    assert.match(warnings, /AGENTS\.md/);
  });

  test("VAL-WF-010: install creates CLAUDE.md as a compatibility symlink to AGENTS.md", async () => {
    const cwd = makeScratch("symlink");
    await installWorkflow(makePackageRoot(), { interactive: false, cwd, lang: "en" });

    assert.equal(fs.lstatSync(path.join(cwd, "AGENTS.md")).isSymbolicLink(), false);
    assert.equal(fs.lstatSync(path.join(cwd, "CLAUDE.md")).isSymbolicLink(), true);
    assert.equal(fs.readlinkSync(path.join(cwd, "CLAUDE.md")), "AGENTS.md");
  });

  test("a foreign real-file AGENTS.md is kept as the user region before becoming primary", async () => {
    const cwd = makeScratch("agents-realfile");
    const agentsPath = path.join(cwd, "AGENTS.md");
    const foreign = "# Another tool's AGENTS.md\nkeep me\n";
    fs.writeFileSync(agentsPath, foreign);

    const warnings = await captureWarnings(() =>
      installWorkflow(makePackageRoot(), { interactive: false, cwd, lang: "en" }),
    );

    const parsed = parseMarkers(fs.readFileSync(agentsPath, "utf-8"));
    assert.equal(parsed.kind, "marked");
    if (parsed.kind !== "marked") return;
    assert.ok(parsed.userRegion.includes(foreign), "foreign content survives in the user region");
    assert.equal(fs.readlinkSync(path.join(cwd, "CLAUDE.md")), "AGENTS.md");
    assert.match(warnings, /AGENTS\.md/);
  });

  test("a symlink AGENTS.md pointing elsewhere is backed up as a symlink before becoming primary", async () => {
    const cwd = makeScratch("agents-foreignlink");
    const agentsPath = path.join(cwd, "AGENTS.md");
    fs.writeFileSync(path.join(cwd, "other.md"), "elsewhere\n");
    fs.symlinkSync("other.md", agentsPath);

    await installWorkflow(makePackageRoot(), { interactive: false, cwd, lang: "en" });

    // The backup preserves the link nature + its original target.
    const bak = fs.lstatSync(path.join(cwd, "AGENTS.md.bak"));
    assert.equal(bak.isSymbolicLink(), true);
    assert.equal(fs.readlinkSync(path.join(cwd, "AGENTS.md.bak")), "other.md");
    assert.equal(fs.lstatSync(agentsPath).isSymbolicLink(), false);
    assert.equal(fs.readlinkSync(path.join(cwd, "CLAUDE.md")), "AGENTS.md");
  });

  test("a symlink CLAUDE.md pointing elsewhere is backed up as a symlink before becoming compatibility link", async () => {
    const cwd = makeScratch("claude-foreignlink");
    const claudePath = path.join(cwd, "CLAUDE.md");
    fs.writeFileSync(path.join(cwd, "shared.md"), "# Shared instructions\nkeep link\n");
    fs.symlinkSync("shared.md", claudePath);

    await installWorkflow(makePackageRoot(), { interactive: false, cwd, lang: "en" });

    const bak = fs.lstatSync(path.join(cwd, "CLAUDE.md.bak"));
    assert.equal(bak.isSymbolicLink(), true);
    assert.equal(fs.readlinkSync(path.join(cwd, "CLAUDE.md.bak")), "shared.md");
    assert.equal(fs.readlinkSync(claudePath), "AGENTS.md");
    assert.match(
      fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf-8"),
      /Shared instructions/,
    );
  });

  test("re-install over the new AGENTS.md primary shape does not create a backup", async () => {
    const cwd = makeScratch("agents-reinstall");
    await installWorkflow(makePackageRoot(), { interactive: false, cwd, lang: "en" });
    await installWorkflow(makePackageRoot(), { interactive: false, cwd, lang: "en" });

    assert.equal(
      fs.existsSync(path.join(cwd, "AGENTS.md.bak")),
      false,
      "an AGENTS.md primary file is our shape — no backup",
    );
    assert.equal(fs.readlinkSync(path.join(cwd, "CLAUDE.md")), "AGENTS.md");
  });
});

describe("installWorkflow — re-install preserves the original .bak (F1 regression)", () => {
  test("re-installing over a migrated file does not clobber the first .bak", async () => {
    const cwd = makeScratch("reinstall");
    const claudePath = path.join(cwd, "CLAUDE.md");
    // First: an old-format file migrates → its content lands in .bak.
    const oldFormat = "# auriga Workflow (v1.5.0)\n旧正文\n";
    fs.writeFileSync(claudePath, oldFormat);
    await installWorkflow(makePackageRoot(), { interactive: false, cwd, lang: "en" });
    assert.equal(fs.readFileSync(path.join(cwd, "CLAUDE.md.bak"), "utf-8"), oldFormat);

    // Second: a clean marked upgrade must not touch the canonical .bak.
    await installWorkflow(makePackageRoot("# auriga Workflow (v2.0.0)\nnew\n"), {
      interactive: false,
      cwd,
      lang: "en",
    });
    assert.equal(
      fs.readFileSync(path.join(cwd, "CLAUDE.md.bak"), "utf-8"),
      oldFormat,
      "canonical .bak still holds the user's original pre-auriga content",
    );
  });
});

describe("workflow templates — bilingual markers (VAL-WF-011)", () => {
  // The install splice logic is language-agnostic — it operates on file bytes,
  // not language. The only language-specific risk is whether each shipped
  // template carries the markers, so this is a repo-check on both templates.
  // (A real `lang:"zh-CN"` install can't be exercised hermetically: it routes
  // through fetchExtraContent → a live GitHub fetch of the tagged version.)
  for (const file of ["AGENTS.md", "AGENTS.en.md"]) {
    test(`VAL-WF-011: ${file} is shipped as a marked template`, () => {
      const parsed = parseMarkers(fs.readFileSync(path.join(REPO_ROOT, file), "utf-8"));
      assert.equal(parsed.kind, "marked", `${file} must carry a managed-block marker pair`);
      if (parsed.kind !== "marked") return;
      assert.match(parsed.blockBody, /# auriga (Workflow|工作流) \(v\d+\.\d+\.\d+\)/);
    });
  }
});

describe("installWorkflow — marked file with a hash-less END marker", () => {
  // A marked file whose END marker carries no `sha256=` (e.g. copied straight
  // from the shipped template, which ships a no-hash END marker). The upgrade
  // can't verify whether the managed block was edited, so it must back up
  // conservatively rather than risk silently dropping an edit.
  test("upgrade of a hash-less marked file backs up conservatively + warns", async () => {
    const cwd = makeScratch("nohash");
    const claudePath = path.join(cwd, "CLAUDE.md");
    const noHashFile =
      `${workflowStartMarker()}\n# auriga Workflow (v1.0.0)\nbody\n` +
      `<!-- AURIGA:WORKFLOW:v1 END -->\n## 我的规则\n- keep me\n`;
    fs.writeFileSync(claudePath, noHashFile);

    const warnings = await captureWarnings(() =>
      installWorkflow(makePackageRoot("# auriga Workflow (v2.0.0)\nfresh\n"), {
        interactive: false,
        cwd,
        lang: "en",
      }),
    );

    const parsed = parseMarkers(fs.readFileSync(claudePath, "utf-8"));
    assert.equal(parsed.kind, "marked");
    if (parsed.kind !== "marked") return;
    assert.match(parsed.blockBody, /fresh/, "managed block upgraded");
    assert.ok(parsed.userRegion.includes("keep me"), "user region preserved");
    assert.notEqual(parsed.endHash, null, "upgraded file now carries a verification hash");
    assert.equal(listBackups(cwd).length, 1, "hash-less file backed up conservatively");
    assert.match(warnings, /校验标记/, "warning names the missing verification marker");
  });
});

// Build-hash helper sanity: a hand-edited block really does change the hash
// the installer keys "hand-edited" detection on.
test("hashBlock distinguishes an edited block from the original", () => {
  assert.notEqual(
    hashBlock("# auriga Workflow (v1.0.0)\nkeep\n"),
    hashBlock("# auriga Workflow (v1.0.0)\nTAMPERED\n"),
  );
});
