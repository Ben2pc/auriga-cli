import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { main } from "../src/cli.js";
import { renderGuide } from "../src/guide.js";

const ANSI_RE = /\u001b\[[0-9;]*m/g;

async function captureStderr(fn: () => Promise<number>): Promise<{ code: number; stderr: string }> {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    return { code: await fn(), stderr: chunks.join("") };
  } finally {
    process.stderr.write = original;
  }
}

// Covers spec §3.6 guide SOP template and §11 guide acceptance matrix.
describe("renderGuide", () => {
  // Covers spec §3.6 required Step 1-5 headings and Troubleshooting section.
  test("includes the full SOP headings in order", () => {
    const out = renderGuide({ color: false, version: "1.8.1" });
    for (const heading of [
      "## Step 1 — Prerequisite check",
      "## Step 2 — Read --help BEFORE installing",
      "## Step 3 — Install",
      "## Step 4 — Reload session (REQUIRED when installed non-interactively)",
      "## Step 5 — Verify install",
      "## Troubleshooting",
    ]) {
      assert.match(out, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  // Covers the "read --help first" emphasis (user-requested, not in the
  // original spec §3.6 wording). Agents must inspect the catalog before
  // deciding scope; --all is a preset, not the default path.
  test("Step 2 names --help as mandatory and covers per-type --help", () => {
    const out = renderGuide({ color: false, version: "1.8.1" });
    assert.match(out, /npx -y auriga-cli --help/);
    assert.match(out, /npx -y auriga-cli install workflow --help/);
    assert.match(out, /npx -y auriga-cli install skills --help/);
    assert.match(out, /npx -y auriga-cli install hooks --help/);
  });

  // Covers spec §3.6 command examples and graded-exit text embedded in the SOP body.
  test("mentions install, retry, and reload guidance in the body", () => {
    const out = renderGuide({ color: false, version: "1.8.1" });
    assert.match(out, /npx -y auriga-cli install --all/);
    assert.match(out, /npx -y auriga-cli install recommended/);
    assert.match(out, /0\s+— all requested categories installed/);
    assert.match(out, /2\s+— partial success/);
    assert.match(out, /Exit this session and start a new one/i);
  });

  // Covers spec §3.6 Step 5 verification checklist content.
  test("lists the expected install artifacts in the verification section", () => {
    const out = renderGuide({ color: false, version: "1.8.1" });
    assert.match(out, /CLAUDE\.md/);
    assert.match(out, /AGENTS\.md -> CLAUDE\.md/);
    assert.match(out, /\.agents\/skills\/<name>\//);
    assert.match(out, /\.claude\/plugins\.json/);
    assert.match(out, /\.claude\/settings\.json/);
  });

  // Covers spec §3.6 color contract when color output is disabled.
  test("does not emit ANSI escapes when color is false", () => {
    const out = renderGuide({ color: false, version: "1.8.1" });
    assert.doesNotMatch(out, ANSI_RE);
  });

  // Covers spec §3.6 color contract when color output is enabled.
  test("emits ANSI escapes when color is true", () => {
    const out = renderGuide({ color: true, version: "1.8.1" });
    assert.match(out, ANSI_RE);
  });
});

// Covers spec §3.6 trigger-form constraints and §11 `guide` arity rejection.
describe("main guide command", () => {
  // Covers spec §3.6 "guide takes no args" fail-fast behavior.
  test("returns non-zero when guide receives any extra args", async () => {
    const { code, stderr } = await captureStderr(() => main(["guide", "foo"]));
    assert.notEqual(code, 0);
    assert.match(stderr, /guide/i);
  });
});
