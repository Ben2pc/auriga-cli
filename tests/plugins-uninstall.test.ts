import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, mock, test } from "node:test";
import { parse as parseToml } from "smol-toml";

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
  function makeCodexHome(): string {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-uninst-"));
    process.env.CODEX_HOME = home;
    return home;
  }

  function writeCodexConfig(home: string, content: string): void {
    fs.writeFileSync(path.join(home, "config.toml"), content);
  }

  test("removes plugin entry from config.toml and cache dir", async () => {
    const home = makeCodexHome();
    writeCodexConfig(
      home,
      `[features]
plugins = true
plugin_hooks = true

[plugins."auriga-go@auriga-cli"]
enabled = true

[plugins."session-instructions-loader@auriga-cli"]
enabled = true
`,
    );
    // Seed a cache dir for the plugin we're removing
    const cacheRoot = path.join(home, "plugins", "cache", "auriga-cli", "auriga-go", "v1");
    fs.mkdirSync(cacheRoot, { recursive: true });
    fs.writeFileSync(path.join(cacheRoot, "plugin.json"), "{}");
    // Seed a sibling cache dir that must NOT be touched
    const siblingCache = path.join(home, "plugins", "cache", "auriga-cli", "session-instructions-loader", "v1");
    fs.mkdirSync(siblingCache, { recursive: true });
    fs.writeFileSync(path.join(siblingCache, "plugin.json"), "{}");

    const { uninstallPlugin } = await importPlugins();
    await uninstallPlugin("auriga-go@auriga-cli", "codex", { cwd: process.cwd() });

    // config.toml: target gone, sibling preserved, features kept
    const parsed = parseToml(fs.readFileSync(path.join(home, "config.toml"), "utf-8")) as {
      features?: { plugins?: boolean; plugin_hooks?: boolean };
      plugins?: Record<string, { enabled?: boolean }>;
    };
    assert.equal(parsed.plugins?.["auriga-go@auriga-cli"], undefined);
    assert.equal(parsed.plugins?.["session-instructions-loader@auriga-cli"]?.enabled, true);
    assert.equal(parsed.features?.plugins, true);

    // Cache: target dir gone, sibling intact
    assert.equal(fs.existsSync(path.join(home, "plugins/cache/auriga-cli/auriga-go")), false);
    assert.ok(fs.existsSync(siblingCache));
  });

  test("plugin not in config.toml → no-op on config, cache still cleaned if present", async () => {
    const home = makeCodexHome();
    writeCodexConfig(home, `[features]\nplugins = true\n`);
    // Cache present even though config doesn't mention it (partial-state user)
    const cache = path.join(home, "plugins/cache/auriga-cli/auriga-go/v1");
    fs.mkdirSync(cache, { recursive: true });

    const { uninstallPlugin } = await importPlugins();
    await uninstallPlugin("auriga-go@auriga-cli", "codex", { cwd: process.cwd() });

    assert.equal(fs.existsSync(path.join(home, "plugins/cache/auriga-cli/auriga-go")), false);
    // Config still parses, untouched
    const parsed = parseToml(fs.readFileSync(path.join(home, "config.toml"), "utf-8")) as {
      features?: { plugins?: boolean };
    };
    assert.equal(parsed.features?.plugins, true);
  });

  test("config.toml absent → cache cleanup still runs (full no-op when both absent)", async () => {
    const home = makeCodexHome();
    // No config.toml, no cache — must NOT throw
    const { uninstallPlugin } = await importPlugins();
    await uninstallPlugin("auriga-go@auriga-cli", "codex", { cwd: process.cwd() });

    // Nothing got auto-created
    assert.equal(fs.existsSync(path.join(home, "config.toml")), false);
    assert.equal(fs.existsSync(path.join(home, "plugins")), false);
  });

  test("damaged config.toml throws BEFORE mutating the filesystem", async () => {
    const home = makeCodexHome();
    writeCodexConfig(home, `[features\nplugins = true\n`); // broken header
    const cache = path.join(home, "plugins/cache/auriga-cli/auriga-go/v1");
    fs.mkdirSync(cache, { recursive: true });

    const { uninstallPlugin } = await importPlugins();
    await assert.rejects(
      () => uninstallPlugin("auriga-go@auriga-cli", "codex", { cwd: process.cwd() }),
      /invalid TOML/i,
    );

    // Cache MUST still be present — failure-atomic guarantee
    assert.ok(fs.existsSync(cache), "cache must not be deleted before config parses");
  });

  test("idempotent: second uninstall is a no-op", async () => {
    const home = makeCodexHome();
    writeCodexConfig(
      home,
      `[features]\nplugins = true\n\n[plugins."auriga-go@auriga-cli"]\nenabled = true\n`,
    );
    const cache = path.join(home, "plugins/cache/auriga-cli/auriga-go/v1");
    fs.mkdirSync(cache, { recursive: true });

    const { uninstallPlugin } = await importPlugins();
    await uninstallPlugin("auriga-go@auriga-cli", "codex", { cwd: process.cwd() });
    // Second call: target already gone, must succeed
    await uninstallPlugin("auriga-go@auriga-cli", "codex", { cwd: process.cwd() });

    const parsed = parseToml(fs.readFileSync(path.join(home, "config.toml"), "utf-8")) as {
      plugins?: Record<string, unknown>;
    };
    assert.equal(parsed.plugins?.["auriga-go@auriga-cli"], undefined);
  });

  test("marketplace registration is NOT removed (other plugins may still depend on it)", async () => {
    const home = makeCodexHome();
    writeCodexConfig(
      home,
      `[features]\nplugins = true\n\n[plugins."auriga-go@auriga-cli"]\nenabled = true\n`,
    );

    const calls: string[] = [];
    const { uninstallPlugin } = await importPlugins((cmd) => {
      calls.push(cmd);
      return "";
    });
    await uninstallPlugin("auriga-go@auriga-cli", "codex", { cwd: process.cwd() });

    // No `codex plugin marketplace remove ...` was invoked
    assert.deepEqual(calls.filter((c) => /marketplace/.test(c)), []);
  });

  test("onLog stream surfaces both config + cache steps", async () => {
    const home = makeCodexHome();
    writeCodexConfig(
      home,
      `[features]\nplugins = true\n\n[plugins."auriga-go@auriga-cli"]\nenabled = true\n`,
    );
    fs.mkdirSync(path.join(home, "plugins/cache/auriga-cli/auriga-go/v1"), { recursive: true });

    const logs: string[] = [];
    const { uninstallPlugin } = await importPlugins();
    await uninstallPlugin("auriga-go@auriga-cli", "codex", {
      cwd: process.cwd(),
      onLog: (l: string) => logs.push(l),
    });

    assert.ok(logs.some((l) => /config\.toml/.test(l)), `missing config log: ${logs.join(" | ")}`);
    assert.ok(logs.some((l) => /cache/i.test(l)), `missing cache log: ${logs.join(" | ")}`);
  });
});
