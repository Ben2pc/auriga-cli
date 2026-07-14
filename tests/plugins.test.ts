import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
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
  for (const name of [
    "incremental-impl",
    "test-designer",
    "session-compound",
    "systematic-debugging",
  ]) {
    const skillDir = path.join(root, "plugins", "auriga-workflow", "skills", name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillFixture(name));
  }
  return root;
}

function claudeWorkflowPluginList(packageRoot: string, cwd: string, scope: "project" | "user"): string {
  return JSON.stringify([{
    id: "auriga-workflow@auriga-cli",
    version: "3.13.0",
    scope,
    enabled: true,
    ...(scope === "project" ? { projectPath: cwd } : {}),
    installPath: path.join(packageRoot, "plugins", "auriga-workflow"),
  }]);
}

function codexWorkflowPluginList(packageRoot: string): string {
  return JSON.stringify({
    installed: [{
      pluginId: "auriga-workflow@auriga-cli",
      installed: true,
      enabled: true,
      source: { path: path.join(packageRoot, "plugins", "auriga-workflow") },
    }],
  });
}

function seedLegacySkill(cwd: string, name: string): void {
  for (const agentDir of [".claude", ".agents"]) {
    const dir = path.join(cwd, agentDir, "skills", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), skillFixture(name));
  }
}

function seedHistoricallyLinkedSkill(cwd: string, name: string): void {
  const agentsDir = path.join(cwd, ".agents", "skills", name);
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(path.join(agentsDir, "SKILL.md"), skillFixture(name));

  const claudeLink = path.join(cwd, ".claude", "skills", name);
  fs.mkdirSync(path.dirname(claudeLink), { recursive: true });
  fs.symlinkSync(path.join("..", "..", ".agents", "skills", name), claudeLink);
}

const MIGRATED_SKILL_SOURCES: Record<string, string> = {
  "incremental-impl": "Ben2pc/auriga-cli",
  "test-designer": "Ben2pc/auriga-cli",
  "session-compound": "Ben2pc/auriga-cli",
  "systematic-debugging": "obra/superpowers",
};

function skillFixture(name: string): string {
  return `---\nname: ${name}\ndescription: Test fixture for ${name}.\n---\n\n# ${name}\n`;
}

function skillFixtureHash(name: string): string {
  return crypto.createHash("sha256")
    .update("SKILL.md")
    .update(skillFixture(name))
    .digest("hex");
}

function migratedSkillLock(names: string[]): Record<string, unknown> {
  return Object.fromEntries(
    names.map((name) => [
      name,
      {
        source: MIGRATED_SKILL_SOURCES[name],
        sourceType: "github",
        computedHash: skillFixtureHash(name),
      },
    ]),
  );
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
    logError?: (line: string) => void;
    logOk?: (line: string) => void;
    logWarn?: (line: string) => void;
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
        ok: overrides.logOk ?? (() => {}),
        warn: overrides.logWarn ?? (() => {}),
        error: overrides.logError ?? (() => {}),
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
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    process.env.HOME = home;
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
      skills: {
        ...migratedSkillLock([
          "incremental-impl",
          "test-designer",
          "session-compound",
          "systematic-debugging",
        ]),
        "planning-with-files": {
          source: "OthmanAdi/planning-with-files",
          sourceType: "github",
          computedHash: "x",
        },
      },
    });
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") {
        return claudeWorkflowPluginList(packageRoot, cwd, "project");
      }
      if (cmd === "codex plugin list --json") return codexWorkflowPluginList(packageRoot);
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

    for (const name of [
      "incremental-impl",
      "test-designer",
      "session-compound",
      "systematic-debugging",
    ]) {
      assert.equal(fs.existsSync(path.join(cwd, ".claude", "skills", name)), false);
      assert.equal(fs.existsSync(path.join(cwd, ".agents", "skills", name)), false);
    }
    for (const name of ["planning-with-files"]) {
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
    assert.deepEqual(Object.keys(lock.skills).sort(), ["planning-with-files"]);
  });

  test("auriga-workflow cleanup preserves a same-name custom skill when lock provenance differs", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-custom-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    seedLegacySkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: {
        "systematic-debugging": {
          source: "example/custom-debugging",
          sourceType: "github",
          computedHash: "custom",
        },
      },
    });
    const warnings: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return "[]";
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    }, { logWarn: (line) => warnings.push(line) });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "both",
      selected: ["auriga-workflow"],
      cwd,
      scope: "project",
    });

    assert.equal(fs.existsSync(path.join(cwd, ".claude", "skills", "systematic-debugging")), true);
    assert.equal(fs.existsSync(path.join(cwd, ".agents", "skills", "systematic-debugging")), true);
    const lock = JSON.parse(fs.readFileSync(path.join(cwd, "skills-lock.json"), "utf-8")) as {
      skills: Record<string, unknown>;
    };
    assert.ok("systematic-debugging" in lock.skills);
    assert.ok(
      warnings.some((line) => /provenance does not match/i.test(line)),
      `custom provenance must produce a visible preservation reason: ${warnings.join(" | ")}`,
    );
  });

  test("auriga-workflow cleanup preserves locally modified content from a managed source", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-modified-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    process.env.HOME = home;
    seedHistoricallyLinkedSkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    fs.appendFileSync(
      path.join(cwd, ".agents", "skills", "systematic-debugging", "SKILL.md"),
      "\nLocal customization that must survive migration.\n",
    );
    const warnings: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return claudeWorkflowPluginList(packageRoot, cwd, "project");
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    }, { logWarn: (line) => warnings.push(line) });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "claude",
      selected: ["auriga-workflow"],
      cwd,
      scope: "project",
    });

    assert.match(
      fs.readFileSync(path.join(cwd, ".agents", "skills", "systematic-debugging", "SKILL.md"), "utf-8"),
      /Local customization/,
    );
    assert.ok(
      warnings.some((line) => /content.*(?:changed|hash)|hash.*content/i.test(line)),
      `modified managed content must produce a visible preservation reason: ${warnings.join(" | ")}`,
    );
  });

  test("auriga-workflow cleanup preserves a skill whose lock source is missing", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-missing-source-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    process.env.HOME = home;
    seedLegacySkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: { "systematic-debugging": { computedHash: "unknown" } },
    });
    const warnings: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return claudeWorkflowPluginList(packageRoot, cwd, "project");
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    }, { logWarn: (line) => warnings.push(line) });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "claude",
      selected: ["auriga-workflow"],
      cwd,
      scope: "project",
    });

    assert.ok(fs.existsSync(path.join(cwd, ".claude", "skills", "systematic-debugging", "SKILL.md")));
    assert.ok(warnings.some((line) => /provenance does not match/i.test(line)));
  });

  test("auriga-workflow user install removes managed user and shadowing project copies", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-user-project-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-user-home-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    seedLegacySkill(home, "systematic-debugging");
    seedLegacySkill(cwd, "systematic-debugging");
    writeJson(path.join(home, ".agents", ".skill-lock.json"), {
      version: 3,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") {
        return claudeWorkflowPluginList(packageRoot, cwd, "user");
      }
      if (cmd === "codex plugin list --json") return codexWorkflowPluginList(packageRoot);
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "both",
      selected: ["auriga-workflow"],
      cwd,
      scope: "user",
    });

    for (const base of [home, cwd]) {
      assert.equal(fs.existsSync(path.join(base, ".claude", "skills", "systematic-debugging")), false);
      assert.equal(fs.existsSync(path.join(base, ".agents", "skills", "systematic-debugging")), false);
    }
    for (const lockPath of [
      path.join(home, ".agents", ".skill-lock.json"),
      path.join(cwd, "skills-lock.json"),
    ]) {
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8")) as {
        skills: Record<string, unknown>;
      };
      assert.equal("systematic-debugging" in lock.skills, false);
    }
  });

  test("auriga-workflow Codex-only install preserves Claude legacy fallback", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-codex-only-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.CODEX_HOME = codexHome;
    const migratedNames = [
      "incremental-impl",
      "test-designer",
      "session-compound",
      "systematic-debugging",
    ];
    for (const name of migratedNames) {
      seedHistoricallyLinkedSkill(cwd, name);
    }
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(migratedNames),
    });
    const workflowPluginRoot = path.join(packageRoot, "plugins", "auriga-workflow");
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "codex plugin list --json") {
        return JSON.stringify({
          installed: [{
            pluginId: "auriga-workflow@auriga-cli",
            source: { path: workflowPluginRoot },
          }],
        });
      }
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "codex",
      selected: ["auriga-workflow"],
      cwd,
      scope: "project",
    });

    for (const name of migratedNames) {
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
      assert.equal(
        fs.lstatSync(path.join(cwd, ".claude", "skills", name)).isSymbolicLink(),
        false,
        `${name} must be materialized for Claude before the shared Codex target is removed`,
      );
    }
    const lock = JSON.parse(fs.readFileSync(path.join(cwd, "skills-lock.json"), "utf-8")) as {
      skills: Record<string, unknown>;
    };
    assert.deepEqual(Object.keys(lock.skills).sort(), [...migratedNames].sort());
  });

  test("auriga-workflow Claude-only install preserves the historical Codex skill target", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-claude-only-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.CODEX_HOME = codexHome;
    seedHistoricallyLinkedSkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") {
        return claudeWorkflowPluginList(packageRoot, cwd, "project");
      }
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "claude",
      selected: ["auriga-workflow"],
      cwd,
      scope: "project",
    });

    assert.equal(fs.existsSync(path.join(cwd, ".claude", "skills", "systematic-debugging")), false);
    assert.equal(
      fs.existsSync(path.join(cwd, ".agents", "skills", "systematic-debugging", "SKILL.md")),
      true,
      "Codex must keep the shared target when only the Claude plugin was enabled",
    );
    const lock = JSON.parse(fs.readFileSync(path.join(cwd, "skills-lock.json"), "utf-8")) as {
      skills: Record<string, unknown>;
    };
    assert.ok("systematic-debugging" in lock.skills);
  });

  test("auriga-workflow cleanup recognizes the original g-claude-code-plugins provenance", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-original-source-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    for (const name of ["test-designer", "session-compound"]) seedLegacySkill(cwd, name);
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: {
        "test-designer": {
          source: "Ben2pc/g-claude-code-plugins",
          sourceType: "github",
          computedHash: skillFixtureHash("test-designer"),
        },
        "session-compound": {
          source: "Ben2pc/g-claude-code-plugins",
          sourceType: "github",
          computedHash: skillFixtureHash("session-compound"),
        },
      },
    });
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") {
        return claudeWorkflowPluginList(packageRoot, cwd, "project");
      }
      if (cmd === "codex plugin list --json") return codexWorkflowPluginList(packageRoot);
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

    for (const name of ["test-designer", "session-compound"]) {
      assert.equal(fs.existsSync(path.join(cwd, ".claude", "skills", name)), false);
      assert.equal(fs.existsSync(path.join(cwd, ".agents", "skills", name)), false);
    }
    const lock = JSON.parse(fs.readFileSync(path.join(cwd, "skills-lock.json"), "utf-8")) as {
      skills: Record<string, unknown>;
    };
    assert.equal("test-designer" in lock.skills, false);
    assert.equal("session-compound" in lock.skills, false);
  });

  test("auriga-workflow keeps standalone skills when the Claude marketplace refresh fails", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-stale-cache-"));
    seedHistoricallyLinkedSkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const commands: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      commands.push(cmd);
      if (cmd === "claude plugins list --json") {
        return JSON.stringify([{
          id: "auriga-workflow@auriga-cli",
          version: "3.12.1",
          scope: "project",
          projectPath: cwd,
        }]);
      }
      if (cmd === "claude plugins marketplace list") return "❯ auriga-cli\n";
      if (cmd === "claude plugins marketplace update auriga-cli") {
        throw new Error("marketplace unavailable");
      }
      return "";
    });

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "claude",
        selected: ["auriga-workflow"],
        cwd,
        scope: "project",
      }),
      /plugin operation/i,
    );

    assert.ok(
      commands.includes("claude plugins update auriga-workflow@auriga-cli --scope project"),
      "the cached plugin update attempt remains independent from migration eligibility",
    );
    assert.equal(
      fs.existsSync(path.join(cwd, ".claude", "skills", "systematic-debugging", "SKILL.md")),
      true,
      "failed marketplace refresh must preserve Claude's only known-good standalone skill",
    );
  });

  test("auriga-workflow keeps standalone skills when the installed Claude plugin lacks them", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const stalePluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-stale-workflow-plugin-"));
    for (const name of ["incremental-impl", "test-designer", "session-compound"]) {
      const skillDir = path.join(stalePluginRoot, "skills", name);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), `# ${name}\n`);
    }
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-stale-payload-"));
    seedHistoricallyLinkedSkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const errors: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") {
        return JSON.stringify([{
          id: "auriga-workflow@auriga-cli",
          version: "3.12.1",
          scope: "project",
          projectPath: cwd,
          installPath: stalePluginRoot,
        }]);
      }
      if (cmd === "claude plugins marketplace list") return "❯ auriga-cli\n";
      return "";
    }, { logError: (line) => errors.push(line) });

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "claude",
        selected: ["auriga-workflow"],
        cwd,
        scope: "project",
      }),
      /migration/i,
    );

    assert.equal(
      fs.existsSync(path.join(cwd, ".claude", "skills", "systematic-debugging", "SKILL.md")),
      true,
      "an installed plugin without the migrated skill must not replace the standalone copy",
    );
    assert.ok(
      errors.some((line) => /installed.*migration failed/i.test(line)),
      `the result must distinguish plugin success from migration failure: ${errors.join(" | ")}`,
    );
  });

  test("auriga-workflow keeps standalone skills when the installed plugin is disabled", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-disabled-plugin-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    process.env.HOME = home;
    seedHistoricallyLinkedSkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") {
        const plugins = JSON.parse(claudeWorkflowPluginList(packageRoot, cwd, "project"));
        plugins[0].enabled = false;
        return JSON.stringify(plugins);
      }
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    });

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "claude",
        selected: ["auriga-workflow"],
        cwd,
        scope: "project",
      }),
      /migration/i,
    );
    assert.ok(fs.existsSync(path.join(cwd, ".claude", "skills", "systematic-debugging", "SKILL.md")));
  });

  test("auriga-workflow keeps standalone skills when the installed Codex plugin is disabled", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-disabled-codex-plugin-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    seedLegacySkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "codex plugin list --json") {
        const list = JSON.parse(codexWorkflowPluginList(packageRoot));
        list.installed[0].enabled = false;
        return JSON.stringify(list);
      }
      return "";
    });

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "codex",
        selected: ["auriga-workflow"],
        cwd,
        scope: "project",
      }),
      /migration/i,
    );
    assert.ok(fs.existsSync(path.join(cwd, ".agents", "skills", "systematic-debugging", "SKILL.md")));
  });

  test("auriga-workflow never migrates legacy skills when Claude plugin installation fails", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-failed-claude-install-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    process.env.HOME = home;
    seedLegacySkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins marketplace list") return "";
      if (cmd.startsWith("claude plugins install auriga-workflow@auriga-cli")) {
        throw new Error("plugin install failed");
      }
      return "[]";
    });

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "claude",
        selected: ["auriga-workflow"],
        cwd,
        scope: "project",
      }),
      /plugin operation/i,
    );
    assert.ok(fs.existsSync(path.join(cwd, ".claude", "skills", "systematic-debugging", "SKILL.md")));
  });

  test("auriga-workflow never migrates legacy skills when Codex plugin installation fails", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-failed-codex-install-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    seedLegacySkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd.startsWith("codex plugin add auriga-workflow@auriga-cli")) {
        throw new Error("plugin add failed");
      }
      return "";
    });

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "codex",
        selected: ["auriga-workflow"],
        cwd,
        scope: "project",
      }),
      /plugin operation/i,
    );
    assert.ok(fs.existsSync(path.join(cwd, ".agents", "skills", "systematic-debugging", "SKILL.md")));
  });

  test("auriga-workflow reports lock-write failure as migration failure after plugin success", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-lock-write-failure-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    seedLegacySkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const errors: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return claudeWorkflowPluginList(packageRoot, cwd, "project");
      if (cmd === "codex plugin list --json") return codexWorkflowPluginList(packageRoot);
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    }, {
      atomicWriteFile: () => { throw new Error("lock write failed"); },
      logError: (line) => errors.push(line),
    });

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "both",
        selected: ["auriga-workflow"],
        cwd,
        scope: "project",
      }),
      /migration/i,
    );
    assert.ok(
      errors.some((line) => /installed but migration failed[\s\S]*lock write failed/i.test(line)),
      `plugin success and migration failure must be distinguishable: ${errors.join(" | ")}`,
    );
  });

  test("auriga-workflow keeps standalone skills when a replacement SKILL.md is empty", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    fs.writeFileSync(
      path.join(packageRoot, "plugins", "auriga-workflow", "skills", "systematic-debugging", "SKILL.md"),
      "",
    );
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-empty-payload-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    process.env.HOME = home;
    seedHistoricallyLinkedSkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return claudeWorkflowPluginList(packageRoot, cwd, "project");
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    });

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "claude",
        selected: ["auriga-workflow"],
        cwd,
        scope: "project",
      }),
      /migration/i,
    );
    assert.ok(fs.existsSync(path.join(cwd, ".claude", "skills", "systematic-debugging", "SKILL.md")));
  });

  test("auriga-workflow keeps standalone skills when replacement frontmatter is invalid", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    fs.writeFileSync(
      path.join(packageRoot, "plugins", "auriga-workflow", "skills", "systematic-debugging", "SKILL.md"),
      "# missing required frontmatter\n",
    );
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-invalid-frontmatter-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    process.env.HOME = home;
    seedHistoricallyLinkedSkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return claudeWorkflowPluginList(packageRoot, cwd, "project");
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    });

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "claude",
        selected: ["auriga-workflow"],
        cwd,
        scope: "project",
      }),
      /migration/i,
    );
    assert.ok(fs.existsSync(path.join(cwd, ".agents", "skills", "systematic-debugging", "SKILL.md")));
  });

  test("auriga-workflow removes a dangling unselected runtime link and its stale lock", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-dangling-link-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    const claudeLink = path.join(cwd, ".claude", "skills", "systematic-debugging");
    fs.mkdirSync(path.dirname(claudeLink), { recursive: true });
    fs.symlinkSync("../../.agents/skills/systematic-debugging", claudeLink);
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return claudeWorkflowPluginList(packageRoot, cwd, "project");
      if (cmd === "codex plugin list --json") return codexWorkflowPluginList(packageRoot);
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

    assert.equal(fs.lstatSync(claudeLink, { throwIfNoEntry: false }), undefined);
    const lock = JSON.parse(fs.readFileSync(path.join(cwd, "skills-lock.json"), "utf-8"));
    assert.equal("systematic-debugging" in lock.skills, false);
  });

  test("auriga-workflow preserves a non-dangling link whose target has no readable skill", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-incomplete-link-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    process.env.HOME = home;
    const customTarget = path.join(cwd, "custom-systematic-debugging");
    fs.mkdirSync(customTarget, { recursive: true });
    fs.writeFileSync(path.join(customTarget, "local-note.txt"), "must survive\n");
    const claudeLink = path.join(cwd, ".claude", "skills", "systematic-debugging");
    fs.mkdirSync(path.dirname(claudeLink), { recursive: true });
    fs.symlinkSync(customTarget, claudeLink);
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const warnings: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return claudeWorkflowPluginList(packageRoot, cwd, "project");
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    }, { logWarn: (line) => warnings.push(line) });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "claude",
      selected: ["auriga-workflow"],
      cwd,
      scope: "project",
    });

    assert.ok(fs.lstatSync(claudeLink).isSymbolicLink());
    assert.equal(fs.readFileSync(path.join(customTarget, "local-note.txt"), "utf-8"), "must survive\n");
    const lock = JSON.parse(fs.readFileSync(path.join(cwd, "skills-lock.json"), "utf-8"));
    assert.ok("systematic-debugging" in lock.skills);
    assert.ok(warnings.some((line) => /incomplete or unreadable/i.test(line)));
  });

  test("auriga-workflow restores the Claude link when materialized-copy replacement fails", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-materialize-rollback-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    seedHistoricallyLinkedSkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "codex plugin list --json") return codexWorkflowPluginList(packageRoot);
      return "";
    });
    const originalRename = fs.renameSync.bind(fs);
    mock.method(fs, "renameSync", ((oldPath: fs.PathLike, newPath: fs.PathLike) => {
      if (String(oldPath).endsWith(".staged")) {
        throw new Error("injected materialized-copy rename failure");
      }
      return originalRename(oldPath, newPath);
    }) as typeof fs.renameSync);

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "codex",
        selected: ["auriga-workflow"],
        cwd,
        scope: "project",
      }),
      /migration/i,
    );

    const claudeDir = path.join(cwd, ".claude", "skills", "systematic-debugging");
    assert.ok(fs.lstatSync(claudeDir).isSymbolicLink(), "the original Claude entry must be restored");
    assert.ok(fs.existsSync(path.join(claudeDir, "SKILL.md")), "the restored link must remain usable");
  });

  test("auriga-workflow restores content replaced after validation but before removal", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-removal-race-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    seedLegacySkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const codexDir = path.join(cwd, ".agents", "skills", "systematic-debugging");
    const skillFile = path.join(codexDir, "SKILL.md");
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "codex plugin list --json") return codexWorkflowPluginList(packageRoot);
      return "";
    });
    const originalRename = fs.renameSync.bind(fs);
    mock.method(fs, "renameSync", ((oldPath: fs.PathLike, newPath: fs.PathLike) => {
      if (String(oldPath) === codexDir && String(newPath).includes(".auriga-remove-")) {
        fs.appendFileSync(skillFile, "\nlocal concurrent change\n");
      }
      return originalRename(oldPath, newPath);
    }) as typeof fs.renameSync);

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "codex",
        selected: ["auriga-workflow"],
        cwd,
        scope: "project",
      }),
      /migration/i,
    );

    assert.match(fs.readFileSync(skillFile, "utf-8"), /local concurrent change/);
    const lock = JSON.parse(fs.readFileSync(path.join(cwd, "skills-lock.json"), "utf-8"));
    assert.ok("systematic-debugging" in lock.skills);
  });

  test("auriga-workflow recovers a verified removal left behind by an interrupted run", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-removal-recovery-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    seedLegacySkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const codexDir = path.join(cwd, ".agents", "skills", "systematic-debugging");
    const token = "0123456789abcdef";
    const prefix = path.join(path.dirname(codexDir), `.systematic-debugging.auriga-remove-${token}`);
    const trash = `${prefix}.trash`;
    const journal = `${prefix}.journal`;
    fs.renameSync(codexDir, trash);
    fs.writeFileSync(journal, JSON.stringify({
      version: 1,
      token,
      skillName: "systematic-debugging",
      expectedHash: skillFixtureHash("systematic-debugging"),
    }) + "\n");
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "codex plugin list --json") return codexWorkflowPluginList(packageRoot);
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "codex",
      selected: ["auriga-workflow"],
      cwd,
      scope: "project",
    });

    assert.equal(fs.lstatSync(trash, { throwIfNoEntry: false }), undefined);
    assert.equal(fs.lstatSync(journal, { throwIfNoEntry: false }), undefined);
    assert.equal(fs.lstatSync(codexDir, { throwIfNoEntry: false }), undefined);
    assert.ok(fs.existsSync(path.join(cwd, ".claude", "skills", "systematic-debugging", "SKILL.md")));
  });

  test("auriga-workflow recovers an interrupted materialization before deleting the shared target", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-materialize-recovery-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    seedHistoricallyLinkedSkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const claudeDir = path.join(cwd, ".claude", "skills", "systematic-debugging");
    const token = "0123456789abcdef";
    const prefix = path.join(path.dirname(claudeDir), `.systematic-debugging.auriga-${token}`);
    const interruptedBackup = `${prefix}.original`;
    const journal = `${prefix}.journal`;
    fs.renameSync(claudeDir, interruptedBackup);
    fs.writeFileSync(journal, JSON.stringify({
      version: 1,
      token,
      skillName: "systematic-debugging",
    }) + "\n");
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "codex plugin list --json") return codexWorkflowPluginList(packageRoot);
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "codex",
      selected: ["auriga-workflow"],
      cwd,
      scope: "project",
    });

    assert.ok(fs.lstatSync(claudeDir).isDirectory(), "Claude must receive a durable materialized copy");
    assert.ok(fs.existsSync(path.join(claudeDir, "SKILL.md")));
    assert.equal(fs.lstatSync(interruptedBackup, { throwIfNoEntry: false }), undefined);
    assert.equal(fs.lstatSync(journal, { throwIfNoEntry: false }), undefined);
  });

  test("auriga-workflow preserves a managed skill when nested symlinks make its hash unverifiable", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-nested-link-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    seedHistoricallyLinkedSkill(cwd, "systematic-debugging");
    const codexDir = path.join(cwd, ".agents", "skills", "systematic-debugging");
    const externalFile = path.join(cwd, "private-note.txt");
    fs.writeFileSync(externalFile, "must not be copied\n");
    fs.symlinkSync(externalFile, path.join(codexDir, "private-note-link"));
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const warnings: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return claudeWorkflowPluginList(packageRoot, cwd, "project");
      if (cmd === "codex plugin list --json") return codexWorkflowPluginList(packageRoot);
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    }, { logWarn: (line) => warnings.push(line) });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "both",
      selected: ["auriga-workflow"],
      cwd,
      scope: "project",
    });

    const claudeLink = path.join(cwd, ".claude", "skills", "systematic-debugging");
    assert.ok(fs.lstatSync(claudeLink).isSymbolicLink(), "the unselected runtime link must remain intact");
    assert.ok(fs.lstatSync(path.join(codexDir, "private-note-link")).isSymbolicLink());
    assert.equal(fs.readFileSync(externalFile, "utf-8"), "must not be copied\n");
    const lock = JSON.parse(fs.readFileSync(path.join(cwd, "skills-lock.json"), "utf-8"));
    assert.ok("systematic-debugging" in lock.skills);
    assert.ok(warnings.some((line) => /excluded from the managed hash/i.test(line)));
  });

  test("auriga-workflow does not treat unjournaled migration-like names as owned artifacts", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-unowned-artifact-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    process.env.HOME = home;
    seedHistoricallyLinkedSkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const claudeDir = path.join(cwd, ".claude", "skills", "systematic-debugging");
    const userBackup = `${claudeDir}.auriga-original`;
    const userStaging = `${claudeDir}.auriga-migration`;
    fs.mkdirSync(userBackup, { recursive: true });
    fs.mkdirSync(userStaging, { recursive: true });
    fs.writeFileSync(path.join(userBackup, "note.txt"), "user backup\n");
    fs.writeFileSync(path.join(userStaging, "note.txt"), "user staging\n");
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "codex plugin list --json") return codexWorkflowPluginList(packageRoot);
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "codex",
      selected: ["auriga-workflow"],
      cwd,
      scope: "project",
    });

    assert.equal(fs.readFileSync(path.join(userBackup, "note.txt"), "utf-8"), "user backup\n");
    assert.equal(fs.readFileSync(path.join(userStaging, "note.txt"), "utf-8"), "user staging\n");
  });

  test("auriga-workflow preserves a non-symlink legacy directory with an unreadable skill entry", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-incomplete-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    process.env.HOME = home;
    const incompleteDir = path.join(cwd, ".agents", "skills", "systematic-debugging");
    fs.mkdirSync(incompleteDir, { recursive: true });
    fs.writeFileSync(path.join(incompleteDir, "local-note.txt"), "must survive\n");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const warnings: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return claudeWorkflowPluginList(packageRoot, cwd, "project");
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    }, { logWarn: (line) => warnings.push(line) });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "claude",
      selected: ["auriga-workflow"],
      cwd,
      scope: "project",
    });

    assert.equal(fs.readFileSync(path.join(incompleteDir, "local-note.txt"), "utf-8"), "must survive\n");
    assert.ok(warnings.some((line) => /incomplete or unreadable/i.test(line)));
  });

  test("auriga-workflow refuses concurrent migration of the same target", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-concurrent-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    process.env.HOME = home;
    seedLegacySkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    fs.writeFileSync(path.join(cwd, ".auriga-plugin-migration.lock"), `${process.pid}\n`);
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return claudeWorkflowPluginList(packageRoot, cwd, "project");
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    });

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "claude",
        selected: ["auriga-workflow"],
        cwd,
        scope: "project",
      }),
      /migration/i,
    );
    assert.ok(fs.existsSync(path.join(cwd, ".agents", "skills", "systematic-debugging", "SKILL.md")));
  });

  test("auriga-workflow ignores plugin payloads installed for another project", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-wrong-project-"));
    const otherProject = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-other-project-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    process.env.HOME = home;
    seedHistoricallyLinkedSkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return claudeWorkflowPluginList(packageRoot, otherProject, "project");
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    });

    await assert.rejects(
      () => installPlugins(packageRoot, {
        interactive: false,
        agent: "claude",
        selected: ["auriga-workflow"],
        cwd,
        scope: "project",
      }),
      /migration/i,
    );
    assert.ok(fs.existsSync(path.join(cwd, ".agents", "skills", "systematic-debugging", "SKILL.md")));
  });

  test("auriga-workflow matches project plugin paths through filesystem aliases", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const realCwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-real-project-"));
    const aliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-alias-root-"));
    const cwdAlias = path.join(aliasRoot, "project");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    process.env.HOME = home;
    fs.symlinkSync(realCwd, cwdAlias);
    seedHistoricallyLinkedSkill(realCwd, "systematic-debugging");
    writeJson(path.join(realCwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return claudeWorkflowPluginList(packageRoot, realCwd, "project");
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "claude",
      selected: ["auriga-workflow"],
      cwd: cwdAlias,
      scope: "project",
    });

    assert.equal(fs.existsSync(path.join(realCwd, ".claude", "skills", "systematic-debugging")), false);
  });

  test("auriga-workflow reports successful migration without an onLog callback", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-visible-success-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-"));
    process.env.HOME = home;
    seedLegacySkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const successes: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return claudeWorkflowPluginList(packageRoot, cwd, "project");
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    }, { logOk: (line) => successes.push(line) });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "claude",
      selected: ["auriga-workflow"],
      cwd,
      scope: "project",
    });

    assert.ok(
      successes.some((line) => /removed.*systematic-debugging/i.test(line)),
      `successful migration must be independently visible: ${successes.join(" | ")}`,
    );
  });

  test("auriga-workflow preserves a custom project skill when HOME and cwd share one directory", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-home-is-project-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.HOME = cwd;
    process.env.CODEX_HOME = codexHome;
    seedLegacySkill(cwd, "systematic-debugging");
    writeJson(path.join(cwd, ".agents", ".skill-lock.json"), {
      version: 3,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: {
        "systematic-debugging": { source: "example/custom-debugging", computedHash: "custom" },
      },
    });
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "codex plugin list --json") return codexWorkflowPluginList(packageRoot);
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "codex",
      selected: ["auriga-workflow"],
      cwd,
      scope: "project",
    });

    assert.ok(fs.existsSync(path.join(cwd, ".agents", "skills", "systematic-debugging", "SKILL.md")));
    assert.ok(fs.existsSync(path.join(cwd, ".claude", "skills", "systematic-debugging", "SKILL.md")));
  });

  test("auriga-workflow reports an unreadable lock and preserves the standalone skill", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-broken-lock-"));
    seedLegacySkill(cwd, "systematic-debugging");
    fs.writeFileSync(path.join(cwd, "skills-lock.json"), "{not-json\n");
    const warnings: string[] = [];
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "claude plugins list --json") return "[]";
      if (cmd === "claude plugins marketplace list") return "";
      return "";
    }, { logWarn: (line) => warnings.push(line) });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "claude",
      selected: ["auriga-workflow"],
      cwd,
      scope: "project",
    });

    assert.equal(fs.existsSync(path.join(cwd, ".claude", "skills", "systematic-debugging")), true);
    assert.ok(
      warnings.some((line) => /unreadable.*skills-lock\.json/i.test(line)),
      `expected an actionable unreadable-lock warning, got: ${warnings.join(" | ")}`,
    );
  });

  test("Codex plugin install cleans managed user copies even when CLI scope is project", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-codex-project-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-codex-home-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    seedLegacySkill(home, "systematic-debugging");
    seedLegacySkill(cwd, "systematic-debugging");
    writeJson(path.join(home, ".agents", ".skill-lock.json"), {
      version: 3,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    writeJson(path.join(cwd, "skills-lock.json"), {
      version: 1,
      skills: migratedSkillLock(["systematic-debugging"]),
    });
    const workflowPluginRoot = path.join(packageRoot, "plugins", "auriga-workflow");
    const { installPlugins } = await importPlugins((cmd) => {
      if (cmd === "codex plugin list --json") {
        return JSON.stringify({
          installed: [{
            pluginId: "auriga-workflow@auriga-cli",
            source: { path: workflowPluginRoot },
          }],
        });
      }
      return "";
    });

    await installPlugins(packageRoot, {
      interactive: false,
      agent: "codex",
      selected: ["auriga-workflow"],
      cwd,
      scope: "project",
    });

    assert.equal(fs.existsSync(path.join(cwd, ".agents", "skills", "systematic-debugging")), false);
    assert.equal(fs.existsSync(path.join(home, ".agents", "skills", "systematic-debugging")), false);
    const userLock = JSON.parse(
      fs.readFileSync(path.join(home, ".agents", ".skill-lock.json"), "utf-8"),
    ) as { skills: Record<string, unknown> };
    assert.equal(
      "systematic-debugging" in userLock.skills,
      true,
      "the shared lock remains while the unselected Claude runtime still has a standalone copy",
    );
  });

  test("auriga-workflow cleanup preserves repo development symlinks", async () => {
    const packageRoot = makeMigratedAssetsPluginPackage();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-migrated-skills-dev-symlink-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-codex-home-"));
    process.env.CODEX_HOME = codexHome;
    const migratedNames = [
      "incremental-impl",
      "test-designer",
      "session-compound",
      "systematic-debugging",
    ];
    for (const name of migratedNames) {
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

    for (const name of migratedNames) {
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
