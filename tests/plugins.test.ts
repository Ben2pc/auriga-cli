import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, mock, test } from "node:test";

let importSerial = 0;
const ORIGINAL_HOME = process.env.HOME;

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function writeExtraPluginConfigs(
  packageRoot: string,
  plugins: Array<Record<string, unknown>>,
): void {
  writeJson(path.join(packageRoot, "extra_plugin_configs.json"), { plugins });
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
      {
        name: "marketplace-only",
        source: { source: "local", path: "./plugins/marketplace-only" },
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
  fs.mkdirSync(path.join(root, "plugins/session-instructions-loader/skills/session-loader"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, "plugins/session-instructions-loader/skills/session-loader/SKILL.md"),
    "# session loader\n",
  );
  writeJson(path.join(root, "plugins/marketplace-only/.codex-plugin/plugin.json"), {
    name: "marketplace-only",
    version: "1.0.0",
    hooks: "./hooks/hooks.json",
  });
  return root;
}

function renameCodexMarketplace(packageRoot: string, name: string): void {
  const marketplacePath = path.join(packageRoot, ".agents/plugins/marketplace.json");
  const marketplace = JSON.parse(fs.readFileSync(marketplacePath, "utf-8")) as { name: string };
  marketplace.name = name;
  writeJson(marketplacePath, marketplace);
}

function makeClaudePluginsConfig(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-claude-plugin-test-"));
  writeJson(path.join(root, ".claude-plugin/marketplace.json"), {
    name: "auriga-cli",
    plugins: [
      {
        name: "auriga-go",
        description: "Workflow autopilot",
        source: "./plugins/auriga-go",
      },
    ],
  });
  return root;
}

function makeClaudeMarketplaceOnlyConfig(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-claude-marketplace-test-"));
  writeJson(path.join(root, ".claude-plugin/marketplace.json"), {
    name: "auriga-cli",
    plugins: [
      {
        name: "auriga-go",
        description: "Workflow autopilot",
        source: "./plugins/auriga-go",
      },
    ],
  });
  return root;
}

function makeClaudePluginsConfigWithMarketplace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-claude-plugin-test-"));
  writeJson(path.join(root, ".claude-plugin/marketplace.json"), {
    name: "auriga-cli",
    plugins: [
      {
        name: "auriga-go",
        description: "Workflow autopilot",
        source: "./plugins/auriga-go",
      },
    ],
  });
  return root;
}

function makeMigratedAssetsPluginPackage(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-plugin-test-"));
  writeJson(path.join(root, ".claude-plugin/marketplace.json"), {
    name: "auriga-cli",
    plugins: [
      {
        name: "auriga-workflow",
        description: "Repo-owned workflow skills",
        source: "./plugins/auriga-workflow",
      },
      {
        name: "auriga-notify",
        description: "Native notification plugin",
        source: "./plugins/auriga-notify",
      },
      {
        name: "auriga-go",
        description: "Workflow autopilot",
        source: "./plugins/auriga-go",
      },
    ],
  });
  writeJson(path.join(root, "extra_plugin_configs.json"), {
    plugins: [
      {
        name: "auriga-notify",
        agents: ["claude"],
        defaultOn: false,
      },
    ],
  });
  writeJson(path.join(root, ".agents/plugins/marketplace.json"), {
    name: "auriga-cli",
    plugins: [
      {
        name: "auriga-workflow",
        source: { source: "local", path: "./plugins/auriga-workflow" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      },
    ],
  });
  writeJson(path.join(root, "plugins/auriga-workflow/.codex-plugin/plugin.json"), {
    name: "auriga-workflow",
    version: "1.0.0",
    skills: "./skills/",
  });
  return root;
}

function seedLegacySkill(cwd: string, name: string): void {
  for (const agentDir of [".claude", ".agents"]) {
    const dir = path.join(cwd, agentDir, "skills", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), `# ${name}\n`);
  }
}

function findFileUnder(root: string, segment: string, fileName: string): string | undefined {
  if (!fs.existsSync(root)) return undefined;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFileUnder(abs, segment, fileName);
      if (found) return found;
      continue;
    }
    if (entry.isFile() && entry.name === fileName && abs.split(path.sep).includes(segment)) {
      return abs;
    }
  }
  return undefined;
}

async function importPlugins(
  execImpl: (cmd: string, opts?: { cwd?: string; inherit?: boolean }) => string = () => "",
  overrides: {
    atomicWriteFile?: (filePath: string, content: string) => void;
    fetchExtraContent?: (tmpDir: string, file: string) => Promise<void>;
  } = {},
) {
  mock.module(new URL("../src/utils.js", import.meta.url), {
    namedExports: {
      atomicWriteFile: overrides.atomicWriteFile ?? ((filePath: string, content: string) => {
        fs.writeFileSync(filePath, content);
      }),
      exec: execImpl,
      execAsync: async (cmd: string) => execImpl(cmd),
      fetchExtraContent: overrides.fetchExtraContent ?? (async () => {}),
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
      checkbox: async <T>(config: { choices: Array<{ value: T; checked?: boolean }> }) =>
        config.choices.filter((choice) => choice.checked !== false).map((choice) => choice.value),
      select: async <T>(config: { choices: Array<{ value: T }> }) =>
        config.choices.find((choice) => choice.value === "codex")?.value ?? config.choices[0].value,
    },
  });
  return import(new URL(`../src/plugins.js?case=${importSerial++}`, import.meta.url).href);
}

afterEach(() => {
  mock.restoreAll();
  delete process.env.CODEX_HOME;
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
});

describe("installPlugins — Codex target", () => {
  test("probes plugin support, adds the marketplace, and installs a hooks plugin via codex plugin add", async () => {
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

    assert.deepEqual(commands, [
      "codex plugin add --help",
      `codex plugin marketplace add '${packageRoot}'`,
      "codex plugin add session-instructions-loader@auriga-cli --enable plugins --enable plugin_hooks",
    ]);
  });

  test("installs local Codex plugins from marketplace.json without an install list", async () => {
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
      selected: ["marketplace-only"],
    });

    assert.deepEqual(commands, [
      "codex plugin add --help",
      `codex plugin marketplace add '${packageRoot}'`,
      "codex plugin add marketplace-only@auriga-cli --enable plugins --enable plugin_hooks",
    ]);
  });

  test("installs local Codex plugins when plugin payload is absent (published runtime — content fetch never materializes plugins/*/.codex-plugin/plugin.json)", async () => {
    // The published CLI fetches CONTENT_FILES (including .agents/plugins/
    // marketplace.json) into a temp content root but never fetches plugin
    // payload — `codex plugin add` materializes it from the marketplace
    // snapshot. Install must not depend on a locally readable plugin manifest.
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-plugin-test-"));
    writeJson(path.join(packageRoot, ".agents/plugins/marketplace.json"), {
      name: "auriga-cli",
      plugins: [
        {
          name: "session-instructions-loader",
          source: { source: "local", path: "./plugins/session-instructions-loader" },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        },
      ],
    });
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

    assert.deepEqual(commands, [
      "codex plugin add --help",
      `codex plugin marketplace add '${packageRoot}'`,
      "codex plugin add session-instructions-loader@auriga-cli --enable plugins --enable plugin_hooks",
    ]);
  });

  test("uses the full HTTPS marketplace source outside DEV mode", async () => {
    const previousDev = process.env.DEV;
    delete process.env.DEV;
    try {
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

      assert.deepEqual(commands, [
        "codex plugin add --help",
        "codex plugin marketplace add https://github.com/Ben2pc/auriga-cli.git",
        "codex plugin add session-instructions-loader@auriga-cli --enable plugins --enable plugin_hooks",
      ]);
    } finally {
      if (previousDev === undefined) delete process.env.DEV;
      else process.env.DEV = previousDev;
    }
  });

  test("uses upgrade-only when marketplace is already registered in config.toml (regression: Codex CLI `add` is silently idempotent and never throws for already-added)", async () => {
    const previousDev = process.env.DEV;
    delete process.env.DEV;
    try {
      const packageRoot = makeCodexMarketplace();
      const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
      process.env.CODEX_HOME = codexHome;
      fs.writeFileSync(
        path.join(codexHome, "config.toml"),
        [
          "[marketplaces.auriga-cli]",
          'last_updated = "2026-05-15T06:03:50Z"',
          'source_type = "git"',
          'source = "https://github.com/Ben2pc/auriga-cli.git"',
          "",
        ].join("\n"),
      );
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

      assert.deepEqual(commands, [
        "codex plugin add --help",
        "codex plugin marketplace upgrade 'auriga-cli'",
        "codex plugin add session-instructions-loader@auriga-cli --enable plugins --enable plugin_hooks",
      ]);
    } finally {
      if (previousDev === undefined) delete process.env.DEV;
      else process.env.DEV = previousDev;
    }
  });

  test("upgrades an already-registered Codex marketplace and still installs selected plugins", async () => {
    const previousDev = process.env.DEV;
    delete process.env.DEV;
    try {
      const packageRoot = makeCodexMarketplace();
      const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
      process.env.CODEX_HOME = codexHome;
      fs.writeFileSync(
        path.join(codexHome, "config.toml"),
        '[marketplaces.auriga-cli]\nsource = "https://github.com/Ben2pc/auriga-cli.git"\n',
      );
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

      assert.deepEqual(commands, [
        "codex plugin add --help",
        "codex plugin marketplace upgrade 'auriga-cli'",
        "codex plugin add session-instructions-loader@auriga-cli --enable plugins --enable plugin_hooks",
      ]);
    } finally {
      if (previousDev === undefined) delete process.env.DEV;
      else process.env.DEV = previousDev;
    }
  });

  test("fails fast when registered marketplace points at a different source URL (supply-chain guard)", async () => {
    const previousDev = process.env.DEV;
    delete process.env.DEV;
    try {
      const packageRoot = makeCodexMarketplace();
      const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
      process.env.CODEX_HOME = codexHome;
      // Hostile state: a fork has been registered under the same name.
      // The install must refuse to upgrade it.
      fs.writeFileSync(
        path.join(codexHome, "config.toml"),
        '[marketplaces.auriga-cli]\nsource = "https://github.com/attacker/fork.git"\n',
      );
      const commands: string[] = [];
      const { installPlugins } = await importPlugins((cmd) => {
        commands.push(cmd);
        return "";
      });

      await assert.rejects(
        () => installPlugins(packageRoot, {
          interactive: false,
          agent: "codex",
          selected: ["session-instructions-loader"],
        }),
        /different source/i,
      );

      // Only the capability probe ran — the guard rejects before any
      // marketplace or plugin command is issued.
      assert.deepEqual(commands, ["codex plugin add --help"]);
    } finally {
      if (previousDev === undefined) delete process.env.DEV;
      else process.env.DEV = previousDev;
    }
  });

  test("propagates marketplace upgrade failure (exec throws) through the failures aggregator", async () => {
    const previousDev = process.env.DEV;
    delete process.env.DEV;
    try {
      const packageRoot = makeCodexMarketplace();
      const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
      process.env.CODEX_HOME = codexHome;
      fs.writeFileSync(
        path.join(codexHome, "config.toml"),
        '[marketplaces.auriga-cli]\nsource = "https://github.com/Ben2pc/auriga-cli.git"\n',
      );
      const commands: string[] = [];
      const { installPlugins } = await importPlugins((cmd) => {
        commands.push(cmd);
        if (cmd === "codex plugin marketplace upgrade 'auriga-cli'") {
          const error = new Error("Command failed: simulated network error");
          (error as Error & { stderr?: string }).stderr =
            "fatal: unable to access 'https://github.com/Ben2pc/auriga-cli.git/'";
          throw error;
        }
        return "";
      });

      await assert.rejects(
        () => installPlugins(packageRoot, {
          interactive: false,
          agent: "codex",
          selected: ["session-instructions-loader"],
        }),
        /codex marketplace auriga-cli/,
      );

      // Upgrade was attempted (and failed); the plugin add step was skipped.
      assert.deepEqual(commands, [
        "codex plugin add --help",
        "codex plugin marketplace upgrade 'auriga-cli'",
      ]);
    } finally {
      if (previousDev === undefined) delete process.env.DEV;
      else process.env.DEV = previousDev;
    }
  });

  test("propagates a per-plugin `codex plugin add` failure through the failures aggregator", async () => {
    const previousDev = process.env.DEV;
    delete process.env.DEV;
    try {
      const packageRoot = makeCodexMarketplace();
      const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
      process.env.CODEX_HOME = codexHome;
      const commands: string[] = [];
      const { installPlugins } = await importPlugins((cmd) => {
        commands.push(cmd);
        if (cmd.startsWith("codex plugin add session-instructions-loader@")) {
          throw new Error("Command failed: codex plugin add — snapshot missing the plugin");
        }
        return "";
      });

      // The marketplace registers fine; the per-plugin `codex plugin add`
      // throws. Non-interactive must surface it through the aggregator,
      // not swallow it.
      await assert.rejects(
        () => installPlugins(packageRoot, {
          interactive: false,
          agent: "codex",
          selected: ["session-instructions-loader"],
        }),
        /1 Codex plugin operation\(s\) failed: codex plugin session-instructions-loader@auriga-cli/,
      );

      assert.deepEqual(commands, [
        "codex plugin add --help",
        "codex plugin marketplace add https://github.com/Ben2pc/auriga-cli.git",
        "codex plugin add session-instructions-loader@auriga-cli --enable plugins --enable plugin_hooks",
      ]);
    } finally {
      if (previousDev === undefined) delete process.env.DEV;
      else process.env.DEV = previousDev;
    }
  });

  test("keeps interactive Codex marketplace and plugin commands attached to the terminal", async () => {
    const previousDev = process.env.DEV;
    delete process.env.DEV;
    try {
      const packageRoot = makeCodexMarketplace();
      const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
      process.env.CODEX_HOME = codexHome;
      fs.writeFileSync(
        path.join(codexHome, "config.toml"),
        '[marketplaces.auriga-cli]\nsource = "https://github.com/Ben2pc/auriga-cli.git"\n',
      );
      const calls: Array<{ cmd: string; inherit?: boolean }> = [];
      const { installPlugins } = await importPlugins((cmd, opts) => {
        calls.push({ cmd, inherit: opts?.inherit });
        return "";
      });

      await installPlugins(packageRoot, {
        interactive: true,
        agent: "codex",
      });

      // `which` and the capability probe are captured (no inherit);
      // marketplace and plugin-add commands stay attached to the terminal.
      const byCmd = (c: string) => calls.find((call) => call.cmd === c);
      assert.equal(byCmd("which codex")?.inherit, undefined);
      assert.equal(byCmd("codex plugin add --help")?.inherit, undefined);
      assert.equal(byCmd("codex plugin marketplace upgrade 'auriga-cli'")?.inherit, true);
      const pluginAdds = calls.filter(
        (call) => call.cmd.startsWith("codex plugin add ")
          && call.cmd !== "codex plugin add --help",
      );
      assert.ok(pluginAdds.length > 0, "expected codex plugin add calls");
      assert.ok(
        pluginAdds.every((call) => call.inherit === true),
        "interactive codex plugin add calls must inherit the terminal",
      );
    } finally {
      if (previousDev === undefined) delete process.env.DEV;
      else process.env.DEV = previousDev;
    }
  });

  test("installs plugins using the local marketplace.json name (not the source URL)", async () => {
    const previousDev = process.env.DEV;
    delete process.env.DEV;
    try {
      const packageRoot = makeCodexMarketplace();
      renameCodexMarketplace(packageRoot, "forked-marketplace");
      const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
      process.env.CODEX_HOME = codexHome;
      fs.writeFileSync(
        path.join(codexHome, "config.toml"),
        '[marketplaces.forked-marketplace]\nsource = "https://github.com/Ben2pc/auriga-cli.git"\n',
      );
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

      assert.deepEqual(commands, [
        "codex plugin add --help",
        "codex plugin marketplace upgrade 'forked-marketplace'",
        "codex plugin add session-instructions-loader@forked-marketplace --enable plugins --enable plugin_hooks",
      ]);
    } finally {
      if (previousDev === undefined) delete process.env.DEV;
      else process.env.DEV = previousDev;
    }
  });

  test("installs every local Codex marketplace plugin by default", async () => {
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
    });

    const addCalls = commands.filter(
      (c) => c.startsWith("codex plugin add ") && c !== "codex plugin add --help",
    );
    assert.deepEqual(addCalls, [
      "codex plugin add auriga-go@auriga-cli --enable plugins --enable plugin_hooks",
      "codex plugin add session-instructions-loader@auriga-cli --enable plugins --enable plugin_hooks",
      "codex plugin add marketplace-only@auriga-cli --enable plugins --enable plugin_hooks",
    ]);
  });

  test("extra plugin config can opt a local Codex marketplace plugin out of defaults", async () => {
    const packageRoot = makeCodexMarketplace();
    writeExtraPluginConfigs(packageRoot, [
      {
        name: "session-instructions-loader",
        agents: ["codex"],
        defaultOn: false,
      },
    ]);
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
    });

    const addCalls = commands.filter(
      (c) => c.startsWith("codex plugin add ") && c !== "codex plugin add --help",
    );
    assert.deepEqual(addCalls, [
      "codex plugin add auriga-go@auriga-cli --enable plugins --enable plugin_hooks",
      "codex plugin add marketplace-only@auriga-cli --enable plugins --enable plugin_hooks",
    ]);
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

  test("fails non-interactive Codex install when neither marketplace.json nor extra config exists", async () => {
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-no-codex-marketplace-"));
    const { installPlugins } = await importPlugins();

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "codex",
      }),
      /No Codex plugins found/i,
    );
  });

  test("fails Codex install when a local plugin is selected but no local marketplace provides it", async () => {
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-no-marketplace-"));
    writeJson(path.join(packageRoot, ".agents/plugins/marketplace.json"), {
      name: "auriga-cli",
      plugins: [
        {
          name: "other-plugin",
          source: { source: "local", path: "./plugins/other-plugin" },
        },
      ],
    });
    const { installPlugins } = await importPlugins();

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "codex",
        selected: ["auriga-go"],
      }),
      /not available for Codex/i,
    );
  });

  test("installs an external-marketplace Codex plugin without touching the local marketplace path", async () => {
    const previousDev = process.env.DEV;
    delete process.env.DEV;
    try {
      const packageRoot = makeCodexMarketplace();
      // Add a fictitious external plugin pointing at an upstream stub marketplace.
      writeExtraPluginConfigs(packageRoot, [
        {
          name: "external-stub-plugin",
          agents: ["codex"],
          description: "Multi-dimensional PR review",
          codex: {
            marketplace: {
              name: "stub-marketplace",
              source: "Ben2pc/stub-marketplace",
            },
          },
        },
      ]);
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
        selected: ["external-stub-plugin"],
      });

      // No local plugin selected → no local marketplace add. External
      // plugins never carry `--enable plugin_hooks` (their upstream
      // manifest isn't read at install time).
      assert.deepEqual(commands, [
        "codex plugin add --help",
        "codex plugin marketplace add https://github.com/Ben2pc/stub-marketplace.git",
        "codex plugin add external-stub-plugin@stub-marketplace --enable plugins",
      ]);
    } finally {
      if (previousDev === undefined) delete process.env.DEV;
      else process.env.DEV = previousDev;
    }
  });

  test("installs local + external Codex plugins together with both marketplaces registered", async () => {
    const previousDev = process.env.DEV;
    delete process.env.DEV;
    try {
      const packageRoot = makeCodexMarketplace();
      writeExtraPluginConfigs(packageRoot, [
        {
          name: "external-stub-plugin",
          agents: ["codex"],
          description: "Multi-dimensional PR review",
          codex: {
            marketplace: {
              name: "stub-marketplace",
              source: "Ben2pc/stub-marketplace",
            },
          },
        },
      ]);
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
        selected: ["auriga-go", "external-stub-plugin"],
      });

      assert.deepEqual(commands, [
        "codex plugin add --help",
        "codex plugin marketplace add https://github.com/Ben2pc/auriga-cli.git",
        "codex plugin marketplace add https://github.com/Ben2pc/stub-marketplace.git",
        "codex plugin add auriga-go@auriga-cli --enable plugins --enable plugin_hooks",
        "codex plugin add external-stub-plugin@stub-marketplace --enable plugins",
      ]);
    } finally {
      if (previousDev === undefined) delete process.env.DEV;
      else process.env.DEV = previousDev;
    }
  });

  test("dedupes external marketplace add when two plugins share one upstream", async () => {
    const previousDev = process.env.DEV;
    delete process.env.DEV;
    try {
      const packageRoot = makeCodexMarketplace();
      // Two external plugins from the SAME upstream marketplace — only
      // one `marketplace add` call should be emitted.
      writeExtraPluginConfigs(packageRoot, [
        {
          name: "external-stub-plugin",
          agents: ["codex"],
          description: "Multi-dimensional PR review",
          codex: {
            marketplace: { name: "stub-marketplace", source: "Ben2pc/stub-marketplace" },
          },
        },
        {
          name: "another-external-stub",
          agents: ["codex"],
          description: "Remote-control sessions",
          codex: {
            marketplace: { name: "stub-marketplace", source: "Ben2pc/stub-marketplace" },
          },
        },
      ]);
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
        selected: ["external-stub-plugin", "another-external-stub"],
      });

      const addCalls = commands.filter((c) => c.startsWith("codex plugin marketplace add"));
      assert.equal(
        addCalls.length,
        1,
        `expected one marketplace add for shared upstream; got ${addCalls.length}: ${addCalls.join(", ")}`,
      );
      const pluginAdds = commands.filter(
        (c) => c.startsWith("codex plugin add ") && c !== "codex plugin add --help",
      );
      assert.deepEqual(pluginAdds, [
        "codex plugin add external-stub-plugin@stub-marketplace --enable plugins",
        "codex plugin add another-external-stub@stub-marketplace --enable plugins",
      ]);
    } finally {
      if (previousDev === undefined) delete process.env.DEV;
      else process.env.DEV = previousDev;
    }
  });

  test("upgrades an already-registered external marketplace instead of re-adding", async () => {
    const previousDev = process.env.DEV;
    delete process.env.DEV;
    try {
      const packageRoot = makeCodexMarketplace();
      writeExtraPluginConfigs(packageRoot, [
        {
          name: "external-stub-plugin",
          agents: ["codex"],
          description: "Multi-dimensional PR review",
          codex: {
            marketplace: { name: "stub-marketplace", source: "Ben2pc/stub-marketplace" },
          },
        },
      ]);
      const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
      process.env.CODEX_HOME = codexHome;
      fs.writeFileSync(
        path.join(codexHome, "config.toml"),
        '[marketplaces.stub-marketplace]\nsource = "https://github.com/Ben2pc/stub-marketplace.git"\n',
      );
      const commands: string[] = [];
      const { installPlugins } = await importPlugins((cmd) => {
        commands.push(cmd);
        return "";
      });

      await installPlugins(packageRoot, {
        interactive: false,
        agent: "codex",
        selected: ["external-stub-plugin"],
      });

      assert.deepEqual(commands, [
        "codex plugin add --help",
        "codex plugin marketplace upgrade 'stub-marketplace'",
        "codex plugin add external-stub-plugin@stub-marketplace --enable plugins",
      ]);
    } finally {
      if (previousDev === undefined) delete process.env.DEV;
      else process.env.DEV = previousDev;
    }
  });

  test("fails Codex marketplace add when the marketplace name belongs to a different source", async () => {
    const previousDev = process.env.DEV;
    delete process.env.DEV;
    try {
      const packageRoot = makeCodexMarketplace();
      const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
      process.env.CODEX_HOME = codexHome;
      const commands: string[] = [];
      const { installPlugins } = await importPlugins((cmd) => {
        commands.push(cmd);
        if (cmd === "codex plugin marketplace add https://github.com/Ben2pc/auriga-cli.git") {
          const error = new Error("Command failed: codex plugin marketplace add");
          (error as Error & { stderr?: string }).stderr =
            "Error: marketplace 'auriga-cli' is already added from a different source";
          throw error;
        }
        return "";
      });

      await assert.rejects(
        () => installPlugins(packageRoot, {
          interactive: false,
          agent: "codex",
          selected: ["auriga-go"],
        }),
        /different source/i,
      );

      // The plugin add step is skipped after the marketplace failure.
      assert.deepEqual(commands, [
        "codex plugin add --help",
        "codex plugin marketplace add https://github.com/Ben2pc/auriga-cli.git",
      ]);
    } finally {
      if (previousDev === undefined) delete process.env.DEV;
      else process.env.DEV = previousDev;
    }
  });

  test("interactive: external-only plugin still installs when local marketplace.json is missing", async () => {
    const previousDev = process.env.DEV;
    delete process.env.DEV;
    try {
      // Empty packageRoot (no local marketplace.json), with only an external
      // entry in extra_plugin_configs.json. Interactive mode should still
      // proceed with the external plugin.
      const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-mixed-no-local-"));
      writeExtraPluginConfigs(packageRoot, [
        {
          name: "external-stub-plugin",
          agents: ["codex"],
          description: "Multi-dimensional PR review",
          codex: {
            marketplace: { name: "stub-marketplace", source: "Ben2pc/stub-marketplace" },
          },
        },
      ]);
      const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
      process.env.CODEX_HOME = codexHome;
      const commands: string[] = [];
      const { installPlugins } = await importPlugins((cmd) => {
        commands.push(cmd);
        return "";
      });

      await installPlugins(packageRoot, {
        interactive: true,
        agent: "codex",
        selected: ["auriga-go", "external-stub-plugin"],
      });

      // No local marketplace add (packageRoot has no marketplace.json).
      const addCalls = commands.filter((c) => c.startsWith("codex plugin marketplace add"));
      assert.deepEqual(addCalls, [
        "codex plugin marketplace add https://github.com/Ben2pc/stub-marketplace.git",
      ]);
      const pluginAdds = commands.filter(
        (c) => c.startsWith("codex plugin add ") && c !== "codex plugin add --help",
      );
      assert.deepEqual(pluginAdds, [
        "codex plugin add external-stub-plugin@stub-marketplace --enable plugins",
      ]);
    } finally {
      if (previousDev === undefined) delete process.env.DEV;
      else process.env.DEV = previousDev;
    }
  });

  test("agent both attempts Codex install even when the Claude side fails", async () => {
    const packageRoot = makeCodexMarketplace();
    writeJson(path.join(packageRoot, ".claude-plugin/marketplace.json"), {
      name: "auriga-cli",
      plugins: [
        {
          name: "auriga-go",
          description: "Workflow autopilot",
          source: "./plugins/auriga-go",
        },
      ],
    });
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.CODEX_HOME = codexHome;
    const commands: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      commands.push(cmd);
      if (cmd === "claude plugins list --json") return "[]";
      if (cmd === "claude plugins marketplace list") return "";
      if (cmd.startsWith("claude plugins install")) throw new Error("claude install failed");
      return "";
    });

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "both",
        selected: ["auriga-go"],
      }),
      /plugin operation/i,
    );

    assert.ok(
      commands.some((cmd) => cmd.startsWith("codex plugin marketplace add")),
      "Codex installer should still run after a Claude-side failure",
    );
    assert.ok(
      commands.includes("codex plugin add auriga-go@auriga-cli --enable plugins --enable plugin_hooks"),
      `Codex plugin add should run after a Claude-side failure; got: ${commands.join(" | ")}`,
    );
  });

  test("agent both attempts Codex install when the Claude plugin config is missing", async () => {
    const packageRoot = makeCodexMarketplace();
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.CODEX_HOME = codexHome;
    const commands: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      commands.push(cmd);
      return "";
    });

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "both",
        selected: ["session-instructions-loader"],
      }),
      /plugin operation/i,
    );

    assert.ok(
      commands.includes(
        "codex plugin add session-instructions-loader@auriga-cli --enable plugins --enable plugin_hooks",
      ),
      `Codex plugin add should run when the Claude plugin config is missing; got: ${commands.join(" | ")}`,
    );
  });

  test("fails the Codex install with an upgrade hint when codex plugin add is unsupported", async () => {
    const packageRoot = makeCodexMarketplace();
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.CODEX_HOME = codexHome;
    const commands: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      commands.push(cmd);
      if (cmd === "codex plugin add --help") {
        throw new Error("Command failed: error: unrecognized subcommand 'add'");
      }
      return "";
    });

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "codex",
        selected: ["session-instructions-loader"],
      }),
      /upgrade the Codex CLI/i,
    );

    // The probe runs and fails first — no marketplace or plugin command
    // is issued, and no manual fallback kicks in.
    assert.deepEqual(commands, ["codex plugin add --help"]);
  });

  test("agent both completes the Claude side when codex plugin add is unsupported", async () => {
    const packageRoot = makeCodexMarketplace();
    writeJson(path.join(packageRoot, ".claude-plugin/marketplace.json"), {
      name: "auriga-cli",
      plugins: [
        {
          name: "auriga-go",
          description: "Workflow autopilot",
          source: "./plugins/auriga-go",
        },
      ],
    });
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.CODEX_HOME = codexHome;
    const commands: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      commands.push(cmd);
      if (cmd === "claude plugins list --json") return "[]";
      if (cmd === "claude plugins marketplace list") return "";
      if (cmd === "codex plugin add --help") {
        throw new Error("Command failed: error: unrecognized subcommand 'add'");
      }
      return "";
    });

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "both",
        selected: ["auriga-go"],
      }),
      /plugin operation/i,
    );

    // Claude side completed despite the Codex version gate failing.
    assert.ok(
      commands.includes("claude plugins install auriga-go@auriga-cli --scope project"),
      `Claude install must complete when the Codex side is gated out; got: ${commands.join(" | ")}`,
    );
    // Codex side stopped at the probe — no marketplace command was issued.
    assert.ok(
      !commands.some((cmd) => cmd.startsWith("codex plugin marketplace")),
      `Codex marketplace must not be touched when the version gate fails; got: ${commands.join(" | ")}`,
    );
  });
});

describe("installPlugins — Claude target", () => {
  test("rejects unsafe Claude marketplace root names", async () => {
    const packageRoot = makeClaudeMarketplaceOnlyConfig();
    const marketplacePath = path.join(packageRoot, ".claude-plugin/marketplace.json");
    const marketplace = JSON.parse(fs.readFileSync(marketplacePath, "utf-8")) as Record<string, unknown>;
    marketplace.name = "auriga-cli; rm -rf /";
    writeJson(marketplacePath, marketplace);
    const { installPlugins } = await importPlugins();

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "claude",
        selected: ["auriga-go"],
      }),
      /root must include a safe name/,
    );
  });

  test("rejects unsafe Claude marketplace plugin names", async () => {
    const packageRoot = makeClaudeMarketplaceOnlyConfig();
    const marketplacePath = path.join(packageRoot, ".claude-plugin/marketplace.json");
    const marketplace = JSON.parse(fs.readFileSync(marketplacePath, "utf-8")) as {
      plugins: Array<Record<string, unknown>>;
    };
    marketplace.plugins[0].name = "auriga-go`whoami`";
    writeJson(marketplacePath, marketplace);
    const { installPlugins } = await importPlugins();

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "claude",
        selected: ["auriga-go"],
      }),
      /plugins\[0\]\.name/,
    );
  });

  test("installs local Claude plugins from marketplace.json without plugins.json", async () => {
    const packageRoot = makeClaudeMarketplaceOnlyConfig();
    const commands: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      commands.push(cmd);
      if (cmd === "claude plugins list --json") return "[]";
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "claude",
      selected: ["auriga-go"],
    });

    assert.deepEqual(commands, [
      "claude plugins list --json",
      "claude plugins marketplace list",
      "claude plugins marketplace add Ben2pc/auriga-cli",
      "claude plugins install auriga-go@auriga-cli --scope project",
    ]);
  });

  test("default Claude plugin selection skips opt-in auriga-notify while wildcard includes it", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-plugin-default-"));
    const commands: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      commands.push(cmd);
      if (cmd === "claude plugins list --json") return "[]";
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "claude",
      cwd,
    });

    let installCalls = commands.filter((cmd) => cmd.startsWith("claude plugins install"));
    assert.ok(
      installCalls.some((cmd) => cmd.includes("auriga-workflow@auriga-cli")),
      `default selection should include default-on auriga-workflow; got: ${installCalls.join(" | ")}`,
    );
    assert.ok(
      installCalls.some((cmd) => cmd.includes("auriga-go@auriga-cli")),
      `default selection should include default-on auriga-go; got: ${installCalls.join(" | ")}`,
    );
    assert.ok(
      installCalls.every((cmd) => !cmd.includes("auriga-notify@auriga-cli")),
      `default selection must skip opt-in auriga-notify; got: ${installCalls.join(" | ")}`,
    );

    commands.length = 0;
    await installPlugins(packageRoot, {
      interactive: false,
      agent: "claude",
      selected: ["*"],
      cwd,
    });

    installCalls = commands.filter((cmd) => cmd.startsWith("claude plugins install"));
    assert.ok(
      installCalls.some((cmd) => cmd.includes("auriga-notify@auriga-cli")),
      `wildcard selection must include opt-in auriga-notify; got: ${installCalls.join(" | ")}`,
    );
  });

  test("auriga-workflow install removes only migrated standalone skills from project scope", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-project-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.CODEX_HOME = codexHome;
    for (const name of [
      "incremental-impl",
      "test-designer",
      "session-compound",
      "systematic-debugging",
      "planning-with-files",
    ]) {
      seedLegacySkill(cwd, name);
    }
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: Object.fromEntries(
        [
          "incremental-impl",
          "test-designer",
          "session-compound",
          "systematic-debugging",
          "planning-with-files",
        ].map((name) => [
          name,
          { source: "example/source", sourceType: "github", computedHash: "x" },
        ]),
      ),
    });
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return "[]";
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "both",
      selected: ["auriga-workflow"],
      cwd,
      scope: "project",
    });

    for (const name of ["incremental-impl", "test-designer", "session-compound"]) {
      assert.equal(fs.existsSync(path.join(cwd, ".claude", "skills", name)), false);
      assert.equal(fs.existsSync(path.join(cwd, ".agents", "skills", name)), false);
    }
    for (const name of ["systematic-debugging", "planning-with-files"]) {
      assert.equal(
        fs.existsSync(path.join(cwd, ".claude", "skills", name)),
        true,
        `${name} is not repo-owned migrated legacy state and must be preserved`,
      );
      assert.equal(fs.existsSync(path.join(cwd, ".agents", "skills", name)), true);
    }
    const lock = JSON.parse(fs.readFileSync(path.join(cwd, "skills-lock.json"), "utf-8")) as {
      skills: Record<string, unknown>;
    };
    assert.deepEqual(Object.keys(lock.skills).sort(), ["planning-with-files", "systematic-debugging"]);
  });

  test("auriga-workflow Codex-only install preserves Claude legacy fallback", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-codex-only-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.CODEX_HOME = codexHome;
    for (const name of ["incremental-impl", "test-designer", "session-compound"]) {
      seedLegacySkill(cwd, name);
    }
    const { installPlugins } = await importPlugins(() => "");

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "codex",
      selected: ["auriga-workflow"],
      cwd,
      scope: "project",
    });

    for (const name of ["incremental-impl", "test-designer", "session-compound"]) {
      assert.equal(
        fs.existsSync(path.join(cwd, ".agents", "skills", name)),
        false,
        `${name} should be removed from the Codex legacy view`,
      );
      assert.equal(
        fs.existsSync(path.join(cwd, ".claude", "skills", name)),
        true,
        `${name} must remain available to Claude when only the Codex plugin was enabled`,
      );
    }
  });

  test("auriga-workflow cleanup preserves repo development symlinks", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-dev-symlink-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.CODEX_HOME = codexHome;
    for (const name of ["incremental-impl", "test-designer", "session-compound"]) {
      const pluginSkillDir = path.join(cwd, "plugins", "auriga-workflow", "skills", name);
      fs.mkdirSync(pluginSkillDir, { recursive: true });
      fs.writeFileSync(path.join(pluginSkillDir, "SKILL.md"), `# ${name}\n`);
      for (const agentDir of [".claude", ".agents"]) {
        const link = path.join(cwd, agentDir, "skills", name);
        fs.mkdirSync(path.dirname(link), { recursive: true });
        fs.symlinkSync(pluginSkillDir, link);
      }
    }
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return "[]";
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "both",
      selected: ["auriga-workflow"],
      cwd,
      scope: "project",
    });

    for (const name of ["incremental-impl", "test-designer", "session-compound"]) {
      assert.equal(fs.lstatSync(path.join(cwd, ".claude", "skills", name)).isSymbolicLink(), true);
      assert.equal(fs.lstatSync(path.join(cwd, ".agents", "skills", name)).isSymbolicLink(), true);
    }
  });

  test("auriga-workflow cleanup stays quiet when legacy skill dirs are absent", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-quiet-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.CODEX_HOME = codexHome;
    const logs: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return "[]";
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "both",
      selected: ["auriga-workflow"],
      cwd,
      scope: "project",
      onLog: (line: string) => logs.push(line),
    });

    assert.equal(
      logs.some((line) => line.includes("not present")),
      false,
      `missing legacy skill dirs should not emit noisy cleanup logs: ${logs.join(" | ")}`,
    );
  });

  test("auriga-notify install preserves legacy hook config and icon under plugin-owned config", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-notify-migrate-"));
    const legacyDir = path.join(cwd, ".claude", "hooks", "notify");
    fs.mkdirSync(legacyDir, { recursive: true });
    const configBody = JSON.stringify({ sound: "Submarine", title: "Custom" }, null, 2) + "\n";
    const iconBody = Buffer.from("CUSTOM_ICON_BYTES");
    fs.writeFileSync(path.join(legacyDir, "config.json"), configBody);
    fs.writeFileSync(path.join(legacyDir, "icon.png"), iconBody);
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return "[]";
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "claude",
      selected: ["auriga-notify"],
      cwd,
      scope: "project",
    });

    const configPath = findFileUnder(path.join(cwd, ".claude"), "auriga-notify", "config.json");
    const iconPath = findFileUnder(path.join(cwd, ".claude"), "auriga-notify", "icon.png");
    assert.ok(configPath, "migrated config.json should land under an auriga-notify plugin-owned path");
    assert.ok(iconPath, "migrated icon.png should land under an auriga-notify plugin-owned path");
    assert.equal(fs.readFileSync(configPath, "utf-8"), configBody);
    assert.equal(Buffer.compare(fs.readFileSync(iconPath), iconBody), 0);
  });

  test("auriga-notify project migration removes both legacy settings files", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-notify-settings-"));
    const legacyDir = path.join(cwd, ".claude", "hooks", "notify");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "config.json"), "{}\n");
    for (const file of ["settings.json", "settings.local.json"]) {
      writeJson(path.join(cwd, ".claude", file), {
        hooks: {
          Notification: [
            {
              matcher: "",
              hooks: [
                { type: "command", command: "node .claude/hooks/notify/index.mjs", _marker: "auriga:notify" },
                { type: "command", command: "echo keep" },
              ],
            },
          ],
        },
      });
    }
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return "[]";
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "claude",
      selected: ["auriga-notify"],
      cwd,
      scope: "project",
    });

    for (const file of ["settings.json", "settings.local.json"]) {
      const settings = JSON.parse(fs.readFileSync(path.join(cwd, ".claude", file), "utf-8")) as {
        hooks: { Notification: Array<{ hooks: unknown[] }> };
      };
      assert.deepEqual(settings.hooks.Notification[0].hooks, [
        { type: "command", command: "echo keep" },
      ]);
    }
    assert.equal(fs.existsSync(legacyDir), false);
  });

  test("auriga-notify user migration moves user config and cleans user settings", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-notify-home-"));
    process.env.HOME = home;
    const legacyDir = path.join(home, ".claude", "hooks", "notify");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "config.json"), "{\"sound\":\"Glass\"}\n");
    writeJson(path.join(home, ".claude", "settings.json"), {
      hooks: {
        Notification: [
          {
            hooks: [
              { type: "command", command: "node ~/.claude/hooks/notify/index.mjs", _marker: "auriga:notify" },
            ],
          },
        ],
      },
    });
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return "[]";
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "claude",
      selected: ["auriga-notify"],
      scope: "user",
    });

    assert.equal(
      fs.readFileSync(path.join(home, ".config", "auriga-cli", "notify", "config.json"), "utf-8"),
      "{\"sound\":\"Glass\"}\n",
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf-8")),
      { hooks: {} },
    );
    assert.equal(fs.existsSync(legacyDir), false);
  });

  test("auriga-notify keeps legacy directory when settings cleanup cannot be verified", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-notify-bad-settings-"));
    const legacyDir = path.join(cwd, ".claude", "hooks", "notify");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "config.json"), "{}\n");
    fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".claude", "settings.json"), "{bad json");
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return "[]";
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "claude",
      selected: ["auriga-notify"],
      cwd,
      scope: "project",
    });

    assert.equal(fs.existsSync(legacyDir), true);
  });

  test("auriga-notify click activation passes bundle id to osascript as data", () => {
    if (process.platform !== "darwin") return;
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-notify-bin-"));
    const argsOut = path.join(binDir, "osascript-args.json");
    const fakeAlerter = path.join(binDir, "alerter");
    const fakeOsascript = path.join(binDir, "osascript");
    const fakeOsascriptRecorder = path.join(binDir, "record-osascript.cjs");
    fs.writeFileSync(fakeAlerter, "#!/bin/sh\nprintf '@CONTENTCLICKED\\n'\n");
    fs.writeFileSync(
      fakeOsascriptRecorder,
      'const fs = require("fs"); fs.writeFileSync(process.env.OSASCRIPT_ARGS_OUT, JSON.stringify(process.argv.slice(2)));',
    );
    fs.writeFileSync(
      fakeOsascript,
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeOsascriptRecorder)} "$@"\n`,
    );
    fs.chmodSync(fakeAlerter, 0o755);
    fs.chmodSync(fakeOsascript, 0o755);
    const maliciousBundle = "com.apple.Terminal\" & do shell script \"touch /tmp/auriga-pwned\" & \"";
    const script = path.resolve("plugins/auriga-notify/scripts/notify.mjs");

    const result = spawnSync(process.execPath, [
      script,
      "--alerter-worker",
      JSON.stringify({ bin: fakeAlerter, args: [], activate: maliciousBundle }),
    ], {
      cwd: path.dirname(script),
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        OSASCRIPT_ARGS_OUT: argsOut,
      },
      encoding: "utf-8",
    });

    assert.equal(result.status, 0, result.stderr);
    const args = JSON.parse(fs.readFileSync(argsOut, "utf-8")) as string[];
    const separator = args.indexOf("--");
    assert.notEqual(separator, -1, `expected osascript argv separator, got ${args.join(" ")}`);
    assert.equal(args.at(-1), maliciousBundle);
    assert.equal(args.slice(0, separator).some((arg) => arg.includes(maliciousBundle)), false);
  });

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

  test("updates an already-present Claude marketplace before installing plugins", async () => {
    const packageRoot = makeClaudePluginsConfigWithMarketplace();
    const commands: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      commands.push(cmd);
      if (cmd === "claude plugins list --json") return "[]";
      if (cmd === "claude plugins marketplace list") return "❯ auriga-cli\n";
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "claude",
      selected: ["auriga-go"],
    });

    assert.ok(
      commands.includes("claude plugins marketplace update auriga-cli"),
      `expected marketplace update call, got: ${commands.join(" | ")}`,
    );
    assert.ok(
      !commands.includes("claude plugins marketplace add Ben2pc/auriga-cli"),
      `expected no marketplace add call when marketplace already present, got: ${commands.join(" | ")}`,
    );
    assert.ok(
      commands.includes("claude plugins install auriga-go@auriga-cli --scope project"),
      `expected plugin install call, got: ${commands.join(" | ")}`,
    );
  });

  test("reinstall upgrades an already-installed plugin at the target scope via `plugins update`", async () => {
    const packageRoot = makeClaudePluginsConfigWithMarketplace();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-claude-plugin-reinstall-"));
    const installed = [
      {
        id: "auriga-go@auriga-cli",
        scope: "project",
        projectPath: cwd,
      },
    ];
    const commands: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      commands.push(cmd);
      if (cmd === "claude plugins list --json") return JSON.stringify(installed);
      if (cmd === "claude plugins marketplace list") return "❯ auriga-cli\n";
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "claude",
      selected: ["auriga-go"],
      cwd,
    });

    assert.ok(
      commands.includes("claude plugins update auriga-go@auriga-cli --scope project"),
      `expected plugin update call when plugin is already installed at target scope; got: ${commands.join(" | ")}`,
    );
    assert.ok(
      !commands.some((cmd) => cmd.startsWith("claude plugins install auriga-go@auriga-cli")),
      `must not call install for an already-installed plugin (no-op for upgrade); got: ${commands.join(" | ")}`,
    );
  });

  test("reinstall still calls `plugins install` when plugin is only present at a different scope", async () => {
    const packageRoot = makeClaudePluginsConfigWithMarketplace();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-claude-plugin-cross-scope-"));
    const installed = [
      {
        id: "auriga-go@auriga-cli",
        scope: "user",
      },
    ];
    const commands: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      commands.push(cmd);
      if (cmd === "claude plugins list --json") return JSON.stringify(installed);
      if (cmd === "claude plugins marketplace list") return "❯ auriga-cli\n";
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "claude",
      selected: ["auriga-go"],
      cwd,
    });

    assert.ok(
      commands.includes("claude plugins install auriga-go@auriga-cli --scope project"),
      `expected plugin install for new project-scope target when only user-scope is present; got: ${commands.join(" | ")}`,
    );
    assert.ok(
      !commands.some((cmd) => cmd.startsWith("claude plugins update")),
      `must not call update for a fresh-at-target-scope install; got: ${commands.join(" | ")}`,
    );
  });

  test("records marketplace update failure but still attempts plugin install", async () => {
    const packageRoot = makeClaudePluginsConfigWithMarketplace();
    const commands: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      commands.push(cmd);
      if (cmd === "claude plugins list --json") return "[]";
      if (cmd === "claude plugins marketplace list") return "❯ auriga-cli\n";
      if (cmd === "claude plugins marketplace update auriga-cli") {
        throw new Error("Command failed: claude plugins marketplace update");
      }
      return "";
    });

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "claude",
        selected: ["auriga-go"],
      }),
      /plugin operation/i,
    );

    assert.ok(
      commands.includes("claude plugins install auriga-go@auriga-cli --scope project"),
      `plugin install should still be attempted after marketplace update failure; got: ${commands.join(" | ")}`,
    );
  });
});
