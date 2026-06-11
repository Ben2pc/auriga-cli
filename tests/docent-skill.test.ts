import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import matter from "gray-matter";

const repoRoot = path.resolve(new URL(".", import.meta.url).pathname, "..", "..");

const SKILL_DIR = "plugins/auriga-workflow/skills/docent";

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf-8");
}

function listFilesRecursive(rel: string): string[] {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(abs);
  return out;
}

describe("docent skill assets", () => {
  // VAL-DCNT-001 — skill exists and is explicit-invocation only
  test("SKILL.md exists with valid frontmatter and explicit-only invocation", () => {
    const raw = read(`${SKILL_DIR}/SKILL.md`);
    const parsed = matter(raw);
    assert.equal(parsed.data.name, "docent", "frontmatter name must be docent");
    assert.ok(
      typeof parsed.data.description === "string" && parsed.data.description.length > 0,
      "frontmatter must have a non-empty description",
    );
    assert.equal(
      parsed.data["disable-model-invocation"],
      true,
      "docent must be explicit-invocation only (disable-model-invocation: true)",
    );
    assert.ok(
      /显式/.test(String(parsed.data.description)),
      "description must state the explicit-invocation-only boundary for runtimes that trigger by description",
    );
  });

  // VAL-DCNT-002 — no fixed HTML template asset; quality is constrained by
  // purpose + palette + hard constraints in prose
  test("skill ships no fixed HTML template; hard constraints live in SKILL.md", () => {
    const htmlAssets = listFilesRecursive(SKILL_DIR).filter((f) => f.endsWith(".html"));
    assert.deepEqual(htmlAssets, [], "docent must not ship a fixed HTML template asset");
    const text = read(`${SKILL_DIR}/SKILL.md`);
    assert.ok(text.includes("必答"), "SKILL.md must carry the mandatory-answers checklist");
    assert.ok(
      /文件:行号|`文件:行号`/.test(text),
      "SKILL.md must require file:line anchors for code conclusions",
    );
    assert.ok(text.includes("自包含"), "SKILL.md must require a self-contained offline HTML");
    assert.ok(text.includes("阅读足迹"), "SKILL.md must require the reading-footprint section");
    assert.ok(text.includes("不适用"), "SKILL.md must allow explicit N/A but forbid silent omission");
    assert.ok(
      /至少一张/.test(text) && /时序图|流程图|状态图/.test(text),
      "SKILL.md must hard-require at least one standard software-engineering diagram for the main flow",
    );
    assert.ok(
      text.includes("架构总览"),
      "SKILL.md must require an architecture overview diagram on the first screen",
    );
    assert.ok(
      text.includes("references/components.md"),
      "SKILL.md must direct the report generator to the bundled component library",
    );
  });

  // VAL-DCNT-003 — dual-agent portability conventions
  test("skill files follow agent-portability conventions", () => {
    const files = listFilesRecursive(SKILL_DIR).filter((f) => f.endsWith(".md"));
    assert.ok(files.length > 0, "docent skill files must exist");
    for (const file of files) {
      const text = fs.readFileSync(file, "utf-8");
      const rel = path.relative(repoRoot, file);
      if (text.includes("AskUserQuestion")) {
        assert.ok(
          text.includes("request_user_input"),
          `${rel}: Claude-only tool names must be paired with the Codex equivalent`,
        );
      }
      assert.ok(
        !text.includes(".claude/skills"),
        `${rel}: plugin assets must not depend on .claude/ symlinked paths`,
      );
    }
  });

  // VAL-DCNT-013 — bundled frontend design reference, referenced by SKILL.md
  test("design guidelines reference is bundled and wired into SKILL.md", () => {
    const ref = `${SKILL_DIR}/references/design-guidelines.md`;
    assert.ok(
      fs.existsSync(path.join(repoRoot, ref)),
      "docent must bundle references/design-guidelines.md",
    );
    const skill = read(`${SKILL_DIR}/SKILL.md`);
    assert.ok(
      skill.includes("references/design-guidelines.md"),
      "SKILL.md must direct the report generator to the bundled design guidelines",
    );
    const refText = read(ref);
    assert.ok(
      !refText.includes(".claude/"),
      "design guidelines must be self-contained, not a pointer into .claude/",
    );
    assert.ok(
      refText.includes("ASCII") && refText.includes("目录树"),
      "design guidelines must forbid ASCII-art directory trees and prescribe an HTML/CSS tree",
    );
    assert.ok(
      refText.includes("--primary") && refText.includes("design token"),
      "design guidelines must carry the recommended design-token palette",
    );
  });

  // Component library lives under assets/ (standard skill layout: assets are
  // files used in the output, fetched by name and assembled mechanically —
  // never retyped through the model). references/components.md is the usage
  // guide that names each asset.
  test("component assets bundle tokens, tree CSS, and working SVG renderers", () => {
    const tokens = read(`${SKILL_DIR}/assets/tokens.css`);
    assert.ok(tokens.includes("--primary"), "tokens.css must define the design tokens");
    const css = read(`${SKILL_DIR}/assets/components.css`);
    assert.ok(css.includes("file-tree"), "components.css must include the file-tree component");

    const guide = read(`${SKILL_DIR}/references/components.md`);
    for (const name of ["assets/tokens.css", "assets/components.css", "assets/renderers.js"]) {
      assert.ok(guide.includes(name), `components.md must reference ${name} by name`);
    }
    const skill = read(`${SKILL_DIR}/SKILL.md`);
    assert.ok(
      skill.includes("assets/") && skill.includes("拼装"),
      "SKILL.md must direct mechanical assembly of assets instead of retyping them",
    );

    const code = read(`${SKILL_DIR}/assets/renderers.js`);
    const exports = new Function(
      `${code}; return { renderSequenceSvg, renderFlowSvg };`,
    )() as {
      renderSequenceSvg: (d: unknown) => string;
      renderFlowSvg: (d: unknown) => string;
    };

    const seq = exports.renderSequenceSvg({
      participants: [
        { id: "cli", label: "CLI", anchor: "src/cli.ts:10" },
        { id: "gh", label: "GitHub <raw>" },
      ],
      messages: [
        { from: "cli", to: "gh", label: "GET v1.x" },
        { from: "gh", to: "cli", label: "404", kind: "return" },
      ],
    });
    assert.ok(seq.startsWith("<svg"), "sequence renderer must return an <svg> string");
    assert.ok(seq.includes("GET v1.x"), "sequence renderer must draw message labels");
    assert.ok(!seq.includes("GitHub <raw>"), "sequence renderer must XML-escape labels");
    assert.ok(seq.includes("GitHub &lt;raw&gt;"), "escaped label must survive");

    const flow = exports.renderFlowSvg({
      layers: [
        [{ id: "a", label: "入口", anchor: "src/utils.ts:239" }],
        [{ id: "b", label: "环境变量覆盖?", kind: "decision" }],
        [{ id: "c", label: "用 tag" }, { id: "d", label: "用 main" }],
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c", label: "否" },
        { from: "b", to: "d", label: "是" },
      ],
    });
    assert.ok(flow.startsWith("<svg"), "flow renderer must return an <svg> string");
    assert.ok(flow.includes("环境变量覆盖?"), "flow renderer must draw node labels");
  });
});

describe("docent release sync", () => {
  // VAL-DCNT-004 — plugin manifests bumped past 3.9.0 and kept in lockstep;
  // marketplace descriptions enumerate docent
  test("plugin manifests are bumped past 3.9.0 and stay in lockstep", () => {
    const claude = JSON.parse(read("plugins/auriga-workflow/.claude-plugin/plugin.json"));
    const codex = JSON.parse(read("plugins/auriga-workflow/.codex-plugin/plugin.json"));
    const [maj, min] = String(claude.version).split(".").map(Number);
    assert.ok(
      maj > 3 || (maj === 3 && min >= 10),
      `plugin version must be bumped past 3.9.0, got ${claude.version}`,
    );
    assert.equal(
      codex.version,
      claude.version,
      "claude and codex plugin manifests must carry the same version",
    );
    for (const [label, manifest] of [
      ["claude", claude],
      ["codex", codex],
    ] as const) {
      assert.ok(
        String(manifest.description).includes("docent"),
        `${label} plugin manifest description must enumerate docent`,
      );
    }
  });

  test("marketplace listings and plugin README enumerate docent", () => {
    const claudeMarketplace = JSON.parse(read(".claude-plugin/marketplace.json"));
    const claudeEntry = (
      claudeMarketplace.plugins as Array<{ name: string; description: string }>
    ).find((p) => p.name === "auriga-workflow");
    assert.ok(claudeEntry, ".claude-plugin/marketplace.json must list auriga-workflow");
    assert.ok(
      claudeEntry!.description.includes("docent"),
      ".claude-plugin/marketplace.json: auriga-workflow description must enumerate docent",
    );
    // The .agents marketplace carries no description field — the Codex-side
    // user-visible description lives in .codex-plugin/plugin.json (asserted
    // above). Here we only require the entry to keep pointing at the plugin.
    const agentsMarketplace = JSON.parse(read(".agents/plugins/marketplace.json"));
    const agentsEntry = (
      agentsMarketplace.plugins as Array<{ name: string; source: { path: string } }>
    ).find((p) => p.name === "auriga-workflow");
    assert.ok(agentsEntry, ".agents/plugins/marketplace.json must list auriga-workflow");
    assert.equal(agentsEntry!.source.path, "./plugins/auriga-workflow");
    assert.ok(
      read("plugins/auriga-workflow/README.md").includes("docent"),
      "plugin README skills table must list docent",
    );
  });
});
