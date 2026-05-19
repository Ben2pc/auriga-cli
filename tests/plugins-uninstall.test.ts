import assert from "node:assert/strict";
import fs from "node:fs";
import { afterEach, describe, mock, test } from "node:test";

let importSerial = 0;

async function importPlugins(
  execImpl: (cmd: string, opts?: { cwd?: string; inherit?: boolean }) => string = () => "",
) {
  mock.module(new URL("../src/utils.js", import.meta.url), {
    namedExports: {
      atomicWriteFile: (filePath: string, content: string) => {
        fs.writeFileSync(filePath, content);
      },
      exec: execImpl,
      execAsync: async (cmd: string) => execImpl(cmd),
      fetchExtraContent: async () => {},
      readPackageVersion: () => "0.0.0-test",
      log: {
        ok: () => {},
        warn: () => {},
        error: () => {},
        skip: () => {},
      },
      withEsc: async <T>(prompt: Promise<T>) => prompt,
    },
  });
  mock.module("@inquirer/prompts", {
    namedExports: {
      checkbox: async () => [],
      select: async () => "claude",
    },
  });
  return import(new URL(`../src/plugins.js?case=${importSerial++}`, import.meta.url).href);
}

afterEach(() => {
  mock.restoreAll();
  delete process.env.CODEX_HOME;
});

describe("uninstallPlugin — input validation", () => {
  test("rejects an id missing the @marketplace suffix", async () => {
    const { uninstallPlugin } = await importPlugins();
    await assert.rejects(
      () => uninstallPlugin("auriga-go", "claude", { cwd: process.cwd() }),
      /invalid plugin id/,
    );
  });

  test("rejects ids with shell metachars in either segment", async () => {
    const { uninstallPlugin } = await importPlugins();
    await assert.rejects(
      () => uninstallPlugin("evil; rm -rf /@market", "claude", { cwd: process.cwd() }),
      /invalid plugin id/,
    );
    await assert.rejects(
      () => uninstallPlugin("plugin@market;pwn", "claude", { cwd: process.cwd() }),
      /invalid plugin id/,
    );
  });
});

describe("uninstallPlugin — Claude target", () => {
  test("shells out to `claude plugins uninstall <id>` and propagates errors", async () => {
    const calls: Array<{ cmd: string; inherit?: boolean }> = [];
    const { uninstallPlugin } = await importPlugins((cmd, opts) => {
      calls.push({ cmd, inherit: opts?.inherit });
      return "";
    });

    await uninstallPlugin("auriga-go@auriga-cli", "claude", { cwd: process.cwd() });

    assert.deepEqual(calls, [
      { cmd: "claude plugins uninstall auriga-go@auriga-cli", inherit: true },
    ]);
  });

  test("propagates exec failure verbatim", async () => {
    const { uninstallPlugin } = await importPlugins(() => {
      throw new Error("Command failed: claude plugins uninstall");
    });
    await assert.rejects(
      () => uninstallPlugin("auriga-go@auriga-cli", "claude", { cwd: process.cwd() }),
      /Command failed/,
    );
  });
});

describe("uninstallPlugin — Codex target", () => {
  test("removes the plugin via `codex plugin remove <id>`", async () => {
    const calls: Array<{ cmd: string; inherit?: boolean }> = [];
    const { uninstallPlugin } = await importPlugins((cmd, opts) => {
      calls.push({ cmd, inherit: opts?.inherit });
      return "";
    });

    await uninstallPlugin("auriga-go@auriga-cli", "codex", { cwd: process.cwd() });

    assert.deepEqual(calls, [
      { cmd: "codex plugin remove auriga-go@auriga-cli", inherit: true },
    ]);
  });

  test("does not remove the marketplace (other plugins may still depend on it)", async () => {
    const calls: string[] = [];
    const { uninstallPlugin } = await importPlugins((cmd) => {
      calls.push(cmd);
      return "";
    });

    await uninstallPlugin("auriga-go@auriga-cli", "codex", { cwd: process.cwd() });

    assert.deepEqual(calls.filter((c) => /marketplace/.test(c)), []);
  });

  test("propagates `codex plugin remove` failure verbatim", async () => {
    const { uninstallPlugin } = await importPlugins(() => {
      throw new Error("Command failed: codex plugin remove");
    });

    await assert.rejects(
      () => uninstallPlugin("auriga-go@auriga-cli", "codex", { cwd: process.cwd() }),
      /Command failed/,
    );
  });

  test("a second uninstall still issues codex plugin remove (idempotency is the Codex CLI's job)", async () => {
    const calls: string[] = [];
    const { uninstallPlugin } = await importPlugins((cmd) => {
      calls.push(cmd);
      return "";
    });

    await uninstallPlugin("auriga-go@auriga-cli", "codex", { cwd: process.cwd() });
    await uninstallPlugin("auriga-go@auriga-cli", "codex", { cwd: process.cwd() });

    assert.deepEqual(calls, [
      "codex plugin remove auriga-go@auriga-cli",
      "codex plugin remove auriga-go@auriga-cli",
    ]);
  });

  test("onLog stream surfaces the Codex removal", async () => {
    const logs: string[] = [];
    const { uninstallPlugin } = await importPlugins();

    await uninstallPlugin("auriga-go@auriga-cli", "codex", {
      cwd: process.cwd(),
      onLog: (l: string) => logs.push(l),
    });

    assert.ok(
      logs.some((l) => /removed auriga-go@auriga-cli from Codex/.test(l)),
      `missing Codex removal log: ${logs.join(" | ")}`,
    );
  });
});
