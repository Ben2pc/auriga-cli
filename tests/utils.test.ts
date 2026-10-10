import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { execAsync } from "../src/utils.js";

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
