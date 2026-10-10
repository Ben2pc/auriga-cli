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

describe("docent skill assets", () => {
  // Explicit-invocation-only is a machine-readable frontmatter contract.
  test("SKILL.md exists with valid frontmatter and explicit-only invocation", () => {
    const raw = read(`${SKILL_DIR}/SKILL.md`);
    const parsed = matter(raw);
    assert.equal(parsed.data.name, "docent", "frontmatter name must be docent");
    assert.equal(
      parsed.data["disable-model-invocation"],
      true,
      "docent must be explicit-invocation only (disable-model-invocation: true)",
    );
  });

  // Dual-agent portability conventions.
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

  // Bundled visual baseline reference, referenced by SKILL.md.
  test("design guidelines reference is bundled and wired into SKILL.md", () => {
    const ref = `${SKILL_DIR}/references/design-guidelines.md`;
    assert.ok(
      fs.existsSync(path.join(repoRoot, ref)),
      "docent must bundle references/design-guidelines.md",
    );
    const skill = read(`${SKILL_DIR}/references/report-workflow.md`);
    assert.ok(
      skill.includes("references/design-guidelines.md"),
      "SKILL.md must direct the report generator to the bundled design guidelines",
    );
  });

  // Component library lives under assets/ (standard skill layout: assets are
  // files used in the output, fetched by name and assembled mechanically —
  // never retyped through the model). references/components.md is the usage
  // guide that names each asset.
  test("component guide names its assets and SVG renderers work", () => {
    const guide = read(`${SKILL_DIR}/references/components.md`);
    for (const name of [
      "assets/tokens.css",
      "assets/components.css",
      "assets/renderers.js",
      "assets/bootstrap.js",
    ]) {
      assert.ok(guide.includes(name), `components.md must reference ${name} by name`);
    }

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
        { id: "cli", label: "CLI", anchor: "src/cli.ts:10", href: "#sec-cli" },
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
    assert.ok(seq.includes('href="#sec-cli"'), "participant nodes must link to their explanation section");

    const flow = exports.renderFlowSvg({
      layers: [
        [{ id: "a", label: "入口", anchor: "src/utils.ts:239", href: "#sec-entry" }],
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
    assert.ok(flow.includes('href="#sec-entry"'), "flow nodes must link to their explanation section");
    const unsafeLink = exports.renderFlowSvg({
      layers: [[{ id: "a", label: "A", href: "javascript:alert(1)" }]],
      edges: [],
    });
    assert.ok(!unsafeLink.includes("javascript:"), "diagram links must be limited to local fragments");
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

  test("figure bootstrap isolates one renderer failure from later figures", () => {
    const bootstrap = read(`${SKILL_DIR}/assets/bootstrap.js`);
    const source = {
      textContent: JSON.stringify([
        { target: "bad", type: "flow", data: { fail: true } },
        { target: "good", type: "flow", data: { fail: false } },
      ]),
    };
    const targets = new Map([
      ["bad", { innerHTML: "", textContent: "" }],
      ["good", { innerHTML: "", textContent: "" }],
    ]);
    const document = {
      getElementById(id: string) {
        if (id === "docent-figures") return source;
        return targets.get(id) ?? null;
      },
    };
    const errors: unknown[] = [];
    const fakeConsole = { error: (...args: unknown[]) => errors.push(args) };
    const run = new Function("document", "console", "renderSequenceSvg", "renderFlowSvg", bootstrap);

    assert.doesNotThrow(() =>
      run(document, fakeConsole, () => "<svg></svg>", (data: { fail: boolean }) => {
        if (data.fail) throw new Error("boom");
        return "<svg id=\"rendered\"></svg>";
      }),
    );
    assert.match(targets.get("bad")!.textContent, /渲染失败/);
    assert.match(targets.get("good")!.innerHTML, /rendered/);
    assert.equal(errors.length, 1, "the failed figure must still be diagnosable");
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
      const title = path.join(tmp, "title.txt");
      const figures = path.join(tmp, "figures.json");
      const out = path.join(tmp, "report.html");
      fs.writeFileSync(
        body,
        `<h1>冒烟</h1><section id="sec-entry"><div id="f"></div></section>`,
      );
      fs.writeFileSync(custom, "h1{color:var(--primary);mask-image:url( #local-mask)}");
      fs.writeFileSync(title, "冒烟标题");
      fs.writeFileSync(
        figures,
        JSON.stringify([
          {
            target: "f",
            type: "flow",
            data: {
              layers: [[{ id: "a", label: "节点", anchor: "src/a.ts:1", href: "#sec-entry" }]],
              edges: [],
            },
          },
        ]),
      );
      execFileSync("sh", [script, body, out, custom, title, "zh", figures]);

      const html = fs.readFileSync(out, "utf-8");
      assert.ok(html.startsWith("<!doctype html>"), "output must be a complete HTML document");
      assert.ok(html.includes("--primary:"), "output must inline the design tokens");
      assert.ok(html.includes("file-tree"), "output must inline the component CSS");
      assert.ok(
        html.includes("h1{color:var(--primary);mask-image:url( #local-mask)}"),
        "output must inline the custom CSS and allow local fragment URLs",
      );
      assert.ok(html.includes("冒烟标题"), "output must carry the title");
      assert.ok(
        html.indexOf("function renderFlowSvg") < html.indexOf("<h1>冒烟</h1>"),
        "renderers must be defined before the report body",
      );
      assert.ok(html.includes("function renderDocentFigures"), "output must inline the fixed figure bootstrap");
      assert.ok(
        html.includes('"href":"#sec-entry"'),
        "safe figure data must preserve the local explanation target for the fixed bootstrap",
      );
      assert.match(
        html,
        /Content-Security-Policy[^>]+script-src 'nonce-[a-f0-9]+'/,
        "output must constrain scripts with a per-report content-security-policy nonce",
      );
      assert.ok(!html.includes("script-src 'unsafe-inline'"), "report scripts must not rely on unsafe-inline");
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
      assert.throws(
        () => execFileSync("sh", [script, body, title, "", title], { stdio: "pipe" }),
        "output path equal to the title input must be rejected",
      );
      // defaults + escaping: no custom css, hostile title
      const out2 = path.join(tmp, "report2.html");
      const marker = path.join(tmp, "must-not-exist");
      fs.writeFileSync(title, `</title><script>alert(1)</script>$(touch ${marker})`);
      execFileSync("sh", [script, body, out2, "", title]);
      const html2 = fs.readFileSync(out2, "utf-8");
      assert.ok(html2.includes('lang="zh"'), "lang must default to zh");
      assert.ok(
        !html2.includes("</title><script>alert(1)</script>"),
        "title must be HTML-escaped, not injected verbatim",
      );
      assert.ok(html2.includes("&lt;/title&gt;"), "escaped title must survive in the output");
      assert.ok(!fs.existsSync(marker), "title contents must never be evaluated by the shell");
      assert.ok(html2.includes("max-width: 1120px"), "reports without custom CSS must include the page baseline");
      assert.ok(html2.includes("prefers-reduced-motion"), "the page baseline must respect reduced motion");

      const cspNonce = /script-src 'nonce-([^']+)'/.exec(html)?.[1];
      assert.ok(cspNonce, "the content-security-policy must declare a script nonce");
      const scriptNonces = [...html.matchAll(/<script\b[^>]*\bnonce="([^"]+)"/g)].map((m) => m[1]);
      assert.ok(scriptNonces.length >= 2, "the report must contain the fixed executable scripts");
      assert.ok(
        scriptNonces.every((nonce) => nonce === cspNonce),
        "every inline script must use the nonce declared by the content-security-policy",
      );

      // repository-derived text must be escaped by the generator. The assembler
      // fails closed when active HTML reaches the body fragment by mistake.
      const activeBody = path.join(tmp, "active-body.html");
      fs.writeFileSync(activeBody, '<p>bad</p><script>alert(1)</script>');
      assert.throws(
        () => execFileSync("sh", [script, activeBody, out], { stdio: "pipe" }),
        "body fragments containing scripts must be rejected",
      );
      fs.writeFileSync(activeBody, '<div onclick="alert(1)">bad</div>');
      fs.writeFileSync(out, "sentinel");
      assert.throws(
        () => execFileSync("sh", [script, activeBody, out], { stdio: "pipe" }),
        "body fragments containing event handlers must be rejected",
      );
      assert.equal(
        fs.readFileSync(out, "utf8"),
        "sentinel",
        "validation failure must leave an existing report unchanged",
      );

      fs.writeFileSync(
        activeBody,
        '<pre><code>button.onclick = handleTap;\nonboarding=enabled</code></pre><div id="f"></div>',
      );
      assert.doesNotThrow(
        () => execFileSync("sh", [script, activeBody, out, "", title, "zh", figures], { stdio: "pipe" }),
        "code evidence and ordinary text that contain on* substrings must remain valid",
      );

      fs.writeFileSync(activeBody, '<a href="https&#58;//example.com/leak">bad</a>');
      assert.throws(
        () => execFileSync("sh", [script, activeBody, out, "", title], { stdio: "pipe" }),
        "entity-encoded external links must be rejected",
      );

      const activeCss = path.join(tmp, "active.css");
      fs.writeFileSync(activeCss, '</style><script>alert(1)</script>');
      assert.throws(
        () => execFileSync("sh", [script, body, out, activeCss], { stdio: "pipe" }),
        "custom CSS must not be able to break out of the style element",
      );
      fs.writeFileSync(activeCss, 'main{background-image:url("https://example.com/leak.png")}');
      assert.throws(
        () => execFileSync("sh", [script, body, out, activeCss, title], { stdio: "pipe" }),
        "custom CSS must reject external resources",
      );

      const hostileFigures = path.join(tmp, "hostile-figures.json");
      fs.writeFileSync(
        hostileFigures,
        JSON.stringify([{ target: "f", type: "flow", data: { layers: [[{ id: "x", label: "</script><script>alert(1)</script>" }]], edges: [] } }]),
      );
      const out3 = path.join(tmp, "report3.html");
      fs.writeFileSync(title, "safe");
      execFileSync("sh", [script, body, out3, "", title, "zh", hostileFigures]);
      const html3 = fs.readFileSync(out3, "utf-8");
      assert.ok(
        !html3.includes("</script><script>alert(1)</script>"),
        "figure JSON must not terminate its inert script element",
      );
      assert.ok(html3.includes("\\u003c/script"), "hostile figure text must stay encoded as data");

      fs.writeFileSync(
        hostileFigures,
        JSON.stringify([{ target: "f", type: "flow", data: { layers: "oops", edges: [] } }]),
      );
      assert.throws(
        () => execFileSync("sh", [script, body, out3, "", title, "zh", hostileFigures], { stdio: "pipe" }),
        "malformed nested figure data must be rejected before browser rendering",
      );

      fs.writeFileSync(
        hostileFigures,
        JSON.stringify([
          { target: "f", type: "sequence", data: { participants: "oops", messages: [] } },
        ]),
      );
      assert.throws(
        () => execFileSync("sh", [script, body, out3, "", title, "zh", hostileFigures], { stdio: "pipe" }),
        "malformed sequence data must be rejected before browser rendering",
      );

      fs.writeFileSync(
        hostileFigures,
        JSON.stringify([{ target: "missing", type: "flow", data: { layers: [], edges: [] } }]),
      );
      assert.throws(
        () => execFileSync("sh", [script, body, out3, "", title, "zh", hostileFigures], { stdio: "pipe" }),
        "figure targets that are absent from the body must fail assembly",
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("docent distribution", () => {
  test("claude and codex plugin manifests share one summary", () => {
    const claude = JSON.parse(read("plugins/auriga-workflow/.claude-plugin/plugin.json"));
    const codex = JSON.parse(read("plugins/auriga-workflow/.codex-plugin/plugin.json"));
    assert.equal(
      codex.description,
      claude.description,
      "claude and codex plugin manifests must carry the same summary",
    );
  });

  test("marketplace entry summary stays synchronized with the plugin manifest", () => {
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
  });
});
