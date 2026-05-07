import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { printBanner } from "../src/utils.js";

async function captureStdout(fn: () => void): Promise<string> {
  const chunks: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    chunks.push(args.join(" "));
  };
  try {
    fn();
    return chunks.join("\n");
  } finally {
    console.log = original;
  }
}

describe("printBanner", () => {
  const originalNoColor = process.env.NO_COLOR;

  afterEach(() => {
    if (originalNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = originalNoColor;
  });

  test("uses Auriga banner branding instead of Claude Code-specific branding", async () => {
    process.env.NO_COLOR = "1";

    const stdout = await captureStdout(() => printBanner("1.2.3"));

    assert.match(stdout, /Auriga Harness Installer\s+v1\.2\.3/);
    assert.doesNotMatch(stdout, /Claude Code Harness Installer/);
  });
});
