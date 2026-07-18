import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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

function sectionBetween(text: string, start: string, end: string): string {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing section start: ${start}`);
  assert.ok(endIndex > startIndex, `missing section end after ${start}: ${end}`);
  return text.slice(startIndex, endIndex);
}

describe("docent skill assets", () => {
  // VAL-DOCNT-001 — explicit invocation, one dedicated Agent, bounded fallback
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
    assert.match(parsed.content, /Claude Code[^。\n]*\/auriga-workflow:docent/);
    assert.match(parsed.content, /Codex[^。\n]*auriga-workflow:docent/);
    const execution = sectionBetween(parsed.content, "## 执行模型：单个专职子代理", "## 子代理工作流");
    assert.match(execution, /一个[^。\n]*专职子代理|单个专职子代理/);
    assert.match(execution, /全过程[^。\n]*子代理内部/);
    assert.match(execution, /不支持派遣子代理[\s\S]{0,180}主对话[\s\S]{0,180}提醒用户/);
  });

  // VAL-DOCNT-002..005 — keep the comprehension contract, but make history,
  // hands-on verification, search methods, and visual customization conditional.
  test("skill separates core report content from conditional tools and presentation", () => {
    const htmlAssets = listFilesRecursive(SKILL_DIR).filter((f) => f.endsWith(".html"));
    assert.deepEqual(htmlAssets, [], "docent must not ship a fixed HTML template asset");
    const text = read(`${SKILL_DIR}/SKILL.md`);
    const core = sectionBetween(text, "#### 核心内容", "#### 条件内容");
    for (const item of [
      "为什么存在",
      "入口与主流程",
      "代码地图",
      "数据或状态",
      "相邻契约",
      "阅读足迹",
      "如何验证理解",
    ]) {
      assert.ok(core.includes(item), `core report contract must retain: ${item}`);
    }
    assert.ok(
      /文件:行号/.test(text),
      "SKILL.md must require file:line anchors for code conclusions",
    );
    assert.ok(text.includes("自包含"), "SKILL.md must require a self-contained offline HTML");
    assert.ok(text.includes("阅读足迹"), "SKILL.md must require the reading-footprint section");
    assert.ok(
      /至少一张/.test(text) && /时序图|流程图|状态图/.test(text),
      "SKILL.md must hard-require at least one standard software-engineering diagram for the main flow",
    );
    assert.ok(
      text.includes("架构总览"),
      "SKILL.md must require an architecture overview diagram on the first screen",
    );
    assert.match(core, /可运行或可操作[\s\S]{0,120}端到端/);
    assert.match(core, /否则[\s\S]{0,140}(自动化测试|静态检查|人工核对)/);
    const conditional = sectionBetween(text, "#### 条件内容", "### 4. 生成 HTML 报告");
    assert.match(conditional, /历史演化[\s\S]{0,120}(按需|条件)/, "git history must be conditional");
    assert.match(
      conditional,
      /人工端到端体验[\s\S]{0,180}(可运行|可操作)/,
      "hands-on verification must require a runnable or operable entry point",
    );
    const locating = sectionBetween(text, "### 1. 定位", "### 2. 通读");
    assert.match(locating, /按问题从定位工具箱/, "search methods must be selected as needed");
    assert.match(locating, /不机械地全部执行/);
    assert.doesNotMatch(
      locating,
      /(?:必须|务必)[^。\n]*(?:全部执行|逐项执行)/,
      "the locating toolbox must not become a fixed checklist",
    );
    assert.ok(
      text.includes("references/components.md"),
      "SKILL.md must direct the report generator to the bundled component library",
    );

    const design = read(`${SKILL_DIR}/references/design-guidelines.md`);
    assert.doesNotMatch(
      design,
      /两份不同主题的报告不应该长得一样|每份报告.*不同/,
      "visual variety must not be a quality target",
    );
    assert.match(
      design,
      /默认.*(基线|组件|token)/,
      "design guidance must provide a stable default visual baseline",
    );
    const components = read(`${SKILL_DIR}/references/components.md`);
    const visualContract = `${text}\n${design}\n${components}`;
    assert.match(visualContract, /只有[^。\n]*改善[^。\n]*才[^。\n]*(定制|custom\.css)/);
    assert.doesNotMatch(visualContract, /先用文件编辑工具写出两个片段|配色与字体[^。\n]*而非默认值/);
  });

  // VAL-DOCNT-006 — dual-agent portability conventions
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

  // VAL-DOCNT-005 — bundled visual baseline reference, referenced by SKILL.md
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
    for (const baseline of ["body {", "max-width: 1120px", "h1, h2, h3, h4", "pre {", "@media (max-width: 720px)"]) {
      assert.ok(css.includes(baseline), `components.css must include default page baseline: ${baseline}`);
    }

    const guide = read(`${SKILL_DIR}/references/components.md`);
    for (const name of ["assets/tokens.css", "assets/components.css", "assets/renderers.js"]) {
      assert.ok(guide.includes(name), `components.md must reference ${name} by name`);
    }
    const skill = read(`${SKILL_DIR}/SKILL.md`);
    assert.ok(
      skill.includes("scripts/assemble.sh") && skill.includes("拼装"),
      "SKILL.md must direct assembly through scripts/assemble.sh instead of retyping assets",
    );

    const code = read(`${SKILL_DIR}/assets/renderers.js`);
    const exports = new Function(
      `${code}; return { renderSequenceSvg, renderFlowSvg, textWidth };`,
    )() as {
      renderSequenceSvg: (d: unknown) => string;
      renderFlowSvg: (d: unknown) => string;
      textWidth: (s: string) => number;
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
    assert.ok(
      seq.includes('stroke-dasharray="6 4"'),
      "return-kind messages must render as dashed arrows",
    );
    assert.ok(seq.includes("<title>src/cli.ts:10</title>"), "participant anchors must render as titles");

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
    assert.ok(
      flow.includes("var(--accent-amber"),
      "decision nodes must render with the amber accent stroke",
    );
    assert.ok(flow.includes("src/utils.ts:239"), "node anchors must render as a second line");
    // node width must accommodate the anchor line, not just the label
    const anchored = exports.renderFlowSvg({
      layers: [[{ id: "a", label: "A", anchor: "plugins/auriga-workflow/skills/docent/SKILL.md:81" }]],
      edges: [],
    });
    const anchorVb = /viewBox="[\d.-]+ [\d.-]+ ([\d.-]+)/.exec(anchored);
    assert.ok(
      Number(anchorVb![1]) >= exports.textWidth("plugins/auriga-workflow/skills/docent/SKILL.md:81") * 0.8,
      "node width and viewBox must account for the anchor text",
    );
  });

  // Invalid data must degrade visibly instead of throwing (which would kill
  // every later figure in the same inline script block) or emitting NaN /
  // -Infinity geometry silently.
  test("renderers degrade gracefully on invalid data", () => {
    const code = read(`${SKILL_DIR}/assets/renderers.js`);
    const exports = new Function(
      `${code}; return { renderSequenceSvg, renderFlowSvg };`,
    )() as {
      renderSequenceSvg: (d: unknown) => string;
      renderFlowSvg: (d: unknown) => string;
    };

    const emptyFlow = exports.renderFlowSvg({ layers: [], edges: [] });
    assert.ok(emptyFlow.startsWith("<svg"), "empty layers must yield a placeholder svg");
    assert.ok(!emptyFlow.includes("Infinity"), "empty layers must not emit -Infinity geometry");

    const emptySeq = exports.renderSequenceSvg({ participants: [], messages: [] });
    assert.ok(emptySeq.startsWith("<svg"), "empty participants must yield a placeholder svg");
    assert.ok(!emptySeq.includes("NaN"), "empty participants must not emit NaN geometry");

    const badFlow = exports.renderFlowSvg({
      layers: [[{ id: "a", label: "A" }], [{ id: "b", label: "B" }]],
      edges: [
        { from: "a", to: "b" },
        { from: "a", to: "typo", label: "bad" },
      ],
    });
    assert.ok(badFlow.includes("跳过"), "unknown edge ids must surface as a visible warning");
    assert.ok(!badFlow.includes("NaN"), "unknown edge ids must not emit NaN geometry");

    const badSeq = exports.renderSequenceSvg({
      participants: [{ id: "a", label: "A" }],
      messages: [{ from: "a", to: "ghost", label: "x" }],
    });
    assert.ok(badSeq.includes("跳过"), "unknown participant ids must surface as a visible warning");
    assert.ok(!badSeq.includes("NaN"), "unknown participant ids must not emit NaN geometry");
  });

  // Regression: edge-label collisions, viewBox clipping, and skip-layer edges
  // crossing nodes (found in the iOS learning-feature report).
  test("flow renderer avoids label collisions, clipping, and node crossings", () => {
    const code = read(`${SKILL_DIR}/assets/renderers.js`);
    const exports = new Function(
      `${code}; return { renderSequenceSvg, renderFlowSvg, textWidth };`,
    )() as {
      renderSequenceSvg: (d: unknown) => string;
      renderFlowSvg: (d: unknown) => string;
      textWidth: (s: string) => number;
    };

    // 1) two labelled edges sharing a midpoint must stagger vertically
    const collide = exports.renderFlowSvg({
      layers: [[{ id: "a", label: "answering" }], [{ id: "b", label: "feedback" }]],
      edges: [
        { from: "a", to: "b", label: "answerSubmitted 且判定通过" },
        { from: "a", to: "b", label: "最后一题且无反馈视频" },
      ],
    });
    const ys = [...collide.matchAll(/<text[^>]*class="edge-label"[^>]*y="([\d.-]+)"/g)].map(
      (m) => Number(m[1]),
    );
    assert.equal(ys.length, 2, "both edge labels must render");
    assert.ok(Math.abs(ys[0] - ys[1]) >= 12, "colliding edge labels must stagger vertically");

    // 2) edge labels must have a canvas halo so they stay readable over lines
    assert.ok(collide.includes("paint-order"), "edge labels must carry a halo (paint-order)");

    // 3) a long edge label must widen the viewBox instead of clipping
    const longLabel = "quizTriggered (boundary observer 精确回调登记契约触发)";
    const wide = exports.renderFlowSvg({
      layers: [[{ id: "a", label: "A" }], [{ id: "b", label: "B" }]],
      edges: [{ from: "a", to: "b", label: longLabel }],
    });
    const vb = /viewBox="([\d.-]+) [\d.-]+ ([\d.-]+)/.exec(wide);
    assert.ok(vb, "flow svg must carry a viewBox");
    assert.ok(
      Number(vb![2]) >= exports.textWidth(longLabel),
      "viewBox must be wide enough for the longest edge label",
    );

    // 4) skip-layer and backward edges must route along a right-side rail —
    // and their labels must sit beyond every node's right edge, never on a node
    const skip = exports.renderFlowSvg({
      layers: [
        [{ id: "a", label: "mainVideo" }],
        [{ id: "m", label: "preQuizVideo（题前互动视频）" }],
        [{ id: "c", label: "answering" }],
      ],
      edges: [
        { from: "a", to: "m" },
        { from: "m", to: "c" },
        { from: "a", to: "c", label: "无题前视频直接出题" },
        { from: "c", to: "a", label: "回跳" },
      ],
    });
    assert.ok(
      /<path[^>]*marker-end/.test(skip),
      "skip-layer edges must render as rail paths with arrowheads",
    );
    // 注意前置空格锚定 ` width=`，否则 [^>]* 贪婪回溯会匹配到 stroke-width
    const nodeRights = [...skip.matchAll(/<rect x="([\d.-]+)"[^>]*? width="([\d.-]+)"/g)].map(
      (m) => Number(m[1]) + Number(m[2]),
    );
    assert.ok(
      nodeRights.some((r) => r > 96),
      "node-right extraction must capture real widths, not stroke-width",
    );
    const maxNodeRight = Math.max(...nodeRights);
    const railLabels = [
      ...skip.matchAll(/<text[^>]*text-anchor="start"[^>]*x="([\d.-]+)"[^>]*>([^<]*)<\/text>/g),
    ].map((m) => ({ x: Number(m[1]), text: m[2] }));
    assert.equal(railLabels.length, 2, "both rail edge labels must render");
    for (const l of railLabels) {
      assert.ok(l.x > maxNodeRight, "rail labels must start beyond every node's right edge");
    }
    // each rail reserves its label's horizontal band — labels and rails of
    // different lanes must never overlap, even at identical mid-heights
    railLabels.sort((p, q) => p.x - q.x);
    assert.ok(
      railLabels[1].x >= railLabels[0].x + exports.textWidth(railLabels[0].text),
      "rail label bands must be horizontally disjoint",
    );
    assert.ok(skip.includes("<circle"), "rail edges must mark their departure point with a dot");
  });

  // The assembly is a mechanism, not a prompt: scripts/assemble.sh produces
  // the final single-file HTML so the model never retypes asset code.
  test("scripts/assemble.sh assembles a self-contained report from fragments", () => {
    const script = path.join(repoRoot, SKILL_DIR, "scripts", "assemble.sh");
    assert.ok(fs.existsSync(script), "scripts/assemble.sh must exist");
    assert.ok(fs.statSync(script).mode & 0o111, "assemble.sh must be executable");

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docent-assemble-"));
    try {
      const body = path.join(tmp, "body.html");
      const custom = path.join(tmp, "custom.css");
      const out = path.join(tmp, "report.html");
      fs.writeFileSync(
        body,
        `<h1>冒烟</h1><div id="f"></div><script>document.getElementById("f").innerHTML = renderFlowSvg({layers:[[{id:"a",label:"节点"}]],edges:[]});</script>`,
      );
      fs.writeFileSync(custom, "h1{color:var(--primary)}");
      execFileSync("sh", [script, body, out, custom, "冒烟标题"]);

      const html = fs.readFileSync(out, "utf-8");
      assert.ok(html.startsWith("<!doctype html>"), "output must be a complete HTML document");
      assert.ok(html.includes("--primary:"), "output must inline the design tokens");
      assert.ok(html.includes("file-tree"), "output must inline the component CSS");
      assert.ok(html.includes("h1{color:var(--primary)}"), "output must inline the custom CSS");
      assert.ok(html.includes("冒烟标题"), "output must carry the title");
      assert.ok(
        html.indexOf("function renderFlowSvg") < html.indexOf("<h1>冒烟</h1>"),
        "renderers must be defined in <head> before the body so inline calls work",
      );
      assert.ok(
        !/(?:src|href)\s*=\s*["']https?:\/\//.test(html),
        "output must stay offline self-contained",
      );

      // guard rails: output path colliding with an input must fail fast
      // (cat-ing the file being written would self-feed and fill the disk)
      assert.throws(
        () => execFileSync("sh", [script, body, body], { stdio: "pipe" }),
        "output path equal to body fragment must be rejected",
      );
      // a custom.css path that was given but does not exist must fail, not
      // silently produce an unstyled report
      assert.throws(
        () => execFileSync("sh", [script, body, out, path.join(tmp, "missing.css")], { stdio: "pipe" }),
        "missing custom css must fail fast",
      );
      // defaults + escaping: no custom css, hostile title
      const out2 = path.join(tmp, "report2.html");
      execFileSync("sh", [script, body, out2, "", '</title><script>alert(1)</script>']);
      const html2 = fs.readFileSync(out2, "utf-8");
      assert.ok(html2.includes('lang="zh"'), "lang must default to zh");
      assert.ok(
        !html2.includes("</title><script>alert(1)</script>"),
        "title must be HTML-escaped, not injected verbatim",
      );
      assert.ok(html2.includes("&lt;/title&gt;"), "escaped title must survive in the output");
      assert.ok(html2.includes("max-width: 1120px"), "reports without custom CSS must include the page baseline");
      assert.ok(html2.includes("prefers-reduced-motion"), "the page baseline must respect reduced motion");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("docent release sync", () => {
  test("plugin manifests include the docent modernization release and stay in lockstep", () => {
    const claude = JSON.parse(read("plugins/auriga-workflow/.claude-plugin/plugin.json"));
    const codex = JSON.parse(read("plugins/auriga-workflow/.codex-plugin/plugin.json"));
    const parts = String(claude.version).split(".").map(Number);
    const meetsMinimum =
      parts[0] > 4 ||
      (parts[0] === 4 && (parts[1] > 0 || (parts[1] === 0 && parts[2] >= 7)));
    assert.ok(
      meetsMinimum,
      `plugin version must include the docent modernization release (>= 4.0.7), got ${claude.version}`,
    );
    assert.equal(
      codex.version,
      claude.version,
      "claude and codex plugin manifests must carry the same version",
    );
    assert.equal(
      codex.description,
      claude.description,
      "claude and codex plugin manifests must carry the same summary",
    );
  });

  test("marketplace entry stays concise while plugin README enumerates docent", () => {
    const claudeMarketplace = JSON.parse(read(".claude-plugin/marketplace.json"));
    const claudeEntry = (
      claudeMarketplace.plugins as Array<{ name: string; description: string }>
    ).find((p) => p.name === "auriga-workflow");
    assert.ok(claudeEntry, ".claude-plugin/marketplace.json must list auriga-workflow");
    const claudeManifest = JSON.parse(
      read("plugins/auriga-workflow/.claude-plugin/plugin.json"),
    );
    assert.equal(
      claudeEntry!.description,
      claudeManifest.description,
      "marketplace and plugin manifest summaries must stay synchronized",
    );
    assert.ok(
      claudeEntry!.description.length <= 240,
      "marketplace description should summarize the plugin instead of enumerating every skill",
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

  test("formal review records bounded recovery decisions [VAL-DOCNT-007]", () => {
    const review = read(
      "docs/worklog/worklog-2026-07-15-refactor-simplify-docent-skill/docent-modernization/review.md",
    );
    for (const anchor of ["风险、观察信号与恢复条件", "首次深入评审", "接受并修复", "保留为后续候选"]) {
      assert.ok(review.includes(anchor), `review record must retain: ${anchor}`);
    }
    assert.match(review, /恢复条件/);
    assert.match(review, /不恢复|不把|只有[^。\n]*才/);
  });

  test("archived docent records stay linked from the compact long-running summary [VAL-DOCNT-009]", () => {
    const archive = "worklog-2026-07-15-refactor-simplify-docent-skill/docent-modernization";
    assert.ok(
      fs.existsSync(path.join(repoRoot, `docs/worklog/${archive}/validation-contract.md`)),
      "archived validation contract must exist",
    );
    assert.equal(
      listFilesRecursive("docs/specs").filter((file) => file.includes("docent-modernization")).length,
      0,
      "the active specs directory must not retain the docent child spec",
    );
    const summary = read("docs/long-running-specs/model-generation-workflow-upgrade/spec.md");
    assert.ok(summary.includes(`${archive}/validation-contract.md`));
    assert.ok(summary.includes(`${archive}/review.md`));
  });
});
