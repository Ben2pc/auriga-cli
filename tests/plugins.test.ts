import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, mock, test } from "node:test";
import { parse } from "smol-toml";

let importSerial = 0;

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function makeCodexMarketplace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-plugin-test-"));
  writeJson(path.join(root, ".agents/plugins/marketplace.json"), {
    name: "auriga-cli",
    plugins: [
      {
        name: "auriga-go",
        source: { source: "local", path: "./plugins/auriga-go" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      },
      {
        name: "session-instructions-loader",
        source: { source: "local", path: "./plugins/session-instructions-loader" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      },
    ],
  });
  writeJson(path.join(root, "plugins/auriga-go/.codex-plugin/plugin.json"), {
    name: "auriga-go",
    version: "1.0.0",
    hooks: "./hooks/hooks.json",
  });
  writeJson(path.join(root, "plugins/session-instructions-loader/.codex-plugin/plugin.json"), {
    name: "session-instructions-loader",
    version: "1.0.0",
    hooks: "./hooks/hooks.json",
  });
  return root;
}

function makeClaudePluginsConfig(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-claude-plugin-test-"));
  writeJson(path.join(root, ".claude/plugins.json"), {
    plugins: [
      {
        name: "auriga-go",
        package: "auriga-go@auriga-cli",
        description: "Workflow autopilot",
      },
    ],
  });
  return root;
}

async function importPlugins(execImpl: (cmd: string) => string = () => "") {
  mock.module(new URL("../src/utils.js", import.meta.url), {
    namedExports: {
      exec: execImpl,
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
  return import(new URL(`../src/plugins.js?case=${importSerial++}`, import.meta.url).href);
}

afterEach(() => {
  mock.restoreAll();
  delete process.env.CODEX_HOME;
});

describe("installPlugins — Codex target", () => {
  test("adds the Codex marketplace and enables selected plugins plus plugin hooks", async () => {
    const packageRoot = makeCodexMarketplace();
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.CODEX_HOME = codexHome;
    const commands: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      commands.push(cmd);
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "codex",
      selected: ["session-instructions-loader"],
    });

    assert.deepEqual(commands, [`codex plugin marketplace add '${packageRoot}'`]);
    const config = fs.readFileSync(path.join(codexHome, "config.toml"), "utf-8");
    assert.match(config, /\[features\]\n(?:.*\n)*plugins = true/);
    assert.match(config, /plugin_hooks = true/);
    assert.match(config, /\[plugins\."session-instructions-loader@auriga-cli"\]\nenabled = true/);
    assert.doesNotMatch(config, /auriga-go@auriga-cli/);
  });

  test("keeps Codex config valid when existing TOML uses inline tables", async () => {
    const packageRoot = makeCodexMarketplace();
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.CODEX_HOME = codexHome;
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      'features = { plugins = false }\n\n[profiles.default]\nmodel = "gpt-5"\n',
    );
    const { installPlugins } = await importPlugins(() => "");

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "codex",
      selected: ["session-instructions-loader"],
    });

    const config = fs.readFileSync(path.join(codexHome, "config.toml"), "utf-8");
    const parsed = parse(config) as {
      features?: { plugins?: boolean; plugin_hooks?: boolean };
      plugins?: Record<string, { enabled?: boolean }>;
      profiles?: { default?: { model?: string } };
    };
    assert.equal(parsed.features?.plugins, true);
    assert.equal(parsed.features?.plugin_hooks, true);
    assert.equal(parsed.plugins?.["session-instructions-loader@auriga-cli"]?.enabled, true);
    assert.equal(parsed.profiles?.default?.model, "gpt-5");
  });

  test("fails non-interactive Codex install when selected plugin is not in the Codex marketplace", async () => {
    const packageRoot = makeCodexMarketplace();
    const { installPlugins } = await importPlugins();

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "codex",
        selected: ["missing"],
      }),
      /not available for Codex/i,
    );
  });
});

describe("installPlugins — Claude target", () => {
  test("fails when a Codex-only plugin is explicitly selected for Claude Code", async () => {
    const packageRoot = makeClaudePluginsConfig();
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return "[]";
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    });

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "claude",
        selected: ["session-instructions-loader"],
      }),
      /not available for Claude Code/i,
    );
  });
});
