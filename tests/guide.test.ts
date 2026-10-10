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
