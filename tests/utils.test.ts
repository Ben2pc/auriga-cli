import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { execAsync, printBanner } from "../src/utils.js";

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

describe("execAsync", () => {
  test("streams stdout line-by-line via onLine", async () => {
    const lines: Array<{ line: string; stream: "stdout" | "stderr" }> = [];
    await execAsync("printf 'first\\nsecond\\nthird\\n'", {
      onLine: (line, stream) => lines.push({ line, stream }),
    });
    assert.deepEqual(
      lines,
      [
        { line: "first", stream: "stdout" },
        { line: "second", stream: "stdout" },
        { line: "third", stream: "stdout" },
      ],
    );
  });

  test("captures stderr separately", async () => {
    const lines: Array<{ line: string; stream: "stdout" | "stderr" }> = [];
    await execAsync("printf 'oops\\n' 1>&2", {
      onLine: (line, stream) => lines.push({ line, stream }),
    });
    assert.deepEqual(lines, [{ line: "oops", stream: "stderr" }]);
  });

  test("rejects with stderr-carrying Error on non-zero exit", async () => {
    await assert.rejects(
      () =>
        execAsync("printf 'bad\\n' 1>&2; exit 5", {
          onLine: () => {},
        }),
      (err: Error & { stderr?: string; status?: number }) => {
        assert.match(err.message, /Command failed/);
        assert.equal(err.status, 5);
        assert.match(err.stderr ?? "", /bad/);
        return true;
      },
    );
  });
});
