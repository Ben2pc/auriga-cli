import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkbox, select } from "@inquirer/prompts";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { TomlTable } from "smol-toml";
import {
  codexManifestPath,
  validateCodexInstallConfig,
  validateCodexMarketplace,
  type CodexInstallConfig,
  type CodexInstallPlugin,
  type CodexMarketplace,
  type CodexMarketplacePlugin,
} from "./codex-plugin-config.js";
import { exec, log, readPackageVersion, withEsc } from "./utils.js";
import type { InstallOpts, PluginAgent, PluginsConfig, PluginDef } from "./utils.js";

// Plugin names, marketplace names/sources, and plugin-package names all
// end up in `claude plugins ...` shell commands via string interpolation.
// .claude/plugins.json is fetched from raw GitHub at runtime, so every
// value must pass a conservative whitelist before composing the command.
// Without this a compromised plugins.json would execute arbitrary
// commands via shell metachar injection.
const PLUGIN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PLUGIN_SOURCE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;
const MARKETPLACE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PLUGIN_PACKAGE_RE = /^[A-Za-z0-9][A-Za-z0-9._@/-]{0,255}$/;

export function validatePluginsConfig(raw: unknown): asserts raw is PluginsConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("plugins.json: root must be an object");
  }
  const cfg = raw as Record<string, unknown>;
  if (!Array.isArray(cfg.plugins)) {
    throw new Error("plugins.json: .plugins must be an array");
  }
  cfg.plugins.forEach((p, i) => {
    if (!p || typeof p !== "object") {
      throw new Error(`plugins.json: plugins[${i}] must be an object`);
    }
    const plugin = p as Record<string, unknown>;
    if (typeof plugin.name !== "string" || !PLUGIN_NAME_RE.test(plugin.name)) {
      throw new Error(
        `plugins.json: plugins[${i}].name ${JSON.stringify(plugin.name)} does not match ${PLUGIN_NAME_RE}`,
      );
    }
    if (typeof plugin.package !== "string" || !PLUGIN_PACKAGE_RE.test(plugin.package)) {
      throw new Error(
        `plugins.json: plugins[${i}].package ${JSON.stringify(plugin.package)} does not match ${PLUGIN_PACKAGE_RE}`,
      );
    }
    if (plugin.marketplace !== undefined) {
      if (!plugin.marketplace || typeof plugin.marketplace !== "object") {
        throw new Error(`plugins.json: plugins[${i}].marketplace must be an object`);
      }
      const mp = plugin.marketplace as Record<string, unknown>;
      if (typeof mp.name !== "string" || !MARKETPLACE_NAME_RE.test(mp.name)) {
        throw new Error(
          `plugins.json: plugins[${i}].marketplace.name ${JSON.stringify(mp.name)} does not match ${MARKETPLACE_NAME_RE}`,
        );
      }
      if (typeof mp.source !== "string" || !PLUGIN_SOURCE_RE.test(mp.source)) {
        throw new Error(
          `plugins.json: plugins[${i}].marketplace.source ${JSON.stringify(mp.source)} does not match ${PLUGIN_SOURCE_RE}`,
        );
      }
    }
  });
}

interface PluginInfo {
  id: string;
  scope: string;
  projectPath?: string;
}

function getInstalledPlugins(): Map<string, string[]> {
  try {
    const output = exec("claude plugins list --json");
    const plugins: PluginInfo[] = JSON.parse(output);
    const cwd = process.cwd();
    const installed = new Map<string, string[]>();

    for (const p of plugins) {
      // project scope 只匹配当前目录
      if (p.scope === "project" && p.projectPath !== cwd) continue;

      const scopes = installed.get(p.id) || [];
      scopes.push(p.scope);
      installed.set(p.id, scopes);
    }

    return installed;
  } catch {
    return new Map();
  }
}

/**
 * Non-interactive selection resolver for plugins. Mirrors the skills
 * resolveSelected: `undefined` / `["*"]` = full set; explicit names =
 * filter. CLI parser validates names up-front.
 */
function resolvePluginSelection(
  all: PluginDef[],
  selected: string[] | undefined,
): PluginDef[] {
  if (!selected || (selected.length === 1 && selected[0] === "*")) return all;
  const byName = new Map(all.map((p) => [p.name, p]));
  const missing = selected.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(", ")} not available for Claude Code plugins; available: ${all.map((p) => p.name).join(", ")}`,
    );
  }
  return selected.map((name) => byName.get(name)!);
}

function getInstalledMarketplaces(): Set<string> {
  try {
    const output = exec("claude plugins marketplace list");
    const names = new Set<string>();
    for (const match of output.matchAll(/❯\s+(\S+)/g)) {
      names.add(match[1]);
    }
    return names;
  } catch {
    return new Set();
  }
}

function loadCodexMarketplace(packageRoot: string): CodexMarketplace | null {
  const marketplacePath = path.join(packageRoot, ".agents", "plugins", "marketplace.json");
  if (!fs.existsSync(marketplacePath)) return null;
  const raw: unknown = JSON.parse(fs.readFileSync(marketplacePath, "utf-8"));
  validateCodexMarketplace(raw);
  return raw;
}

function loadCodexInstallConfig(packageRoot: string): CodexInstallConfig | null {
  const installPath = path.join(packageRoot, ".agents", "plugins", "install.json");
  if (!fs.existsSync(installPath)) return null;
  const raw: unknown = JSON.parse(fs.readFileSync(installPath, "utf-8"));
  validateCodexInstallConfig(raw);
  return raw;
}

function resolveCodexPluginSelection(
  all: CodexInstallPlugin[],
  selected: string[] | undefined,
): CodexInstallPlugin[] {
  if (!selected) return all.filter((p) => p.defaultOn !== false);
  if (selected.length === 1 && selected[0] === "*") return all;
  const byName = new Map(all.map((p) => [p.name, p]));
  const missing = selected.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(", ")} not available for Codex plugins; available: ${all.map((p) => p.name).join(", ")}`,
    );
  }
  return selected.map((name) => byName.get(name)!);
}

function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function codexMarketplaceAddCommand(packageRoot: string): string {
  if (process.env.DEV === "1") {
    return `codex plugin marketplace add ${shellQuote(packageRoot)}`;
  }
  const ref = process.env.AURIGA_CONTENT_REF || `v${readPackageVersion()}`;
  return `codex plugin marketplace add Ben2pc/auriga-cli --ref ${shellQuote(ref)}`;
}

function pluginHasHooks(packageRoot: string, plugin: CodexMarketplacePlugin): boolean {
  const relativeManifestPath = codexManifestPath(plugin);
  if (!relativeManifestPath) return false;
  const manifestPath = path.join(packageRoot, relativeManifestPath);
  if (!fs.existsSync(manifestPath)) return false;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as { hooks?: unknown };
  return typeof manifest.hooks === "string" || Array.isArray(manifest.hooks);
}

function ensureTomlBoolean(content: string, section: string, key: string, value: boolean): string {
  const line = `${key} = ${value ? "true" : "false"}`;
  const header = `[${section}]`;
  const lines = content.length > 0 ? content.split(/\r?\n/) : [];
  const start = lines.findIndex((l) => l.trim() === header);
  if (start === -1) {
    const prefix = content.trimEnd();
    return `${prefix}${prefix ? "\n\n" : ""}${header}\n${line}\n`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const keyRe = new RegExp(`^\\s*${key}\\s*=`);
  for (let i = start + 1; i < end; i += 1) {
    if (keyRe.test(lines[i])) {
      lines[i] = line;
      return lines.join("\n");
    }
  }
  lines.splice(end, 0, line);
  return lines.join("\n");
}

function parseCodexConfigToml(content: string, configPath: string): TomlTable {
  if (content.trim().length === 0) return {};
  try {
    return parseToml(content) as TomlTable;
  } catch (e) {
    throw new Error(`Codex config.toml is invalid TOML at ${configPath}: ${(e as Error).message}`);
  }
}

function isTomlTable(value: unknown): value is TomlTable {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOrCreateTomlTable(parent: TomlTable, key: string, pathLabel: string): TomlTable {
  const existing = parent[key];
  if (existing === undefined) {
    const table: TomlTable = {};
    parent[key] = table;
    return table;
  }
  if (!isTomlTable(existing)) {
    throw new Error(`Codex config.toml: ${pathLabel} must be a TOML table`);
  }
  return existing;
}

function buildCodexPluginConfigToml(
  originalContent: string,
  configPath: string,
  pluginKeys: string[],
  needsPluginHooks: boolean,
): string {
  const parsed = parseCodexConfigToml(originalContent, configPath);
  const features = getOrCreateTomlTable(parsed, "features", "features");
  features.plugins = true;
  if (needsPluginHooks) {
    features.plugin_hooks = true;
  }

  const plugins = getOrCreateTomlTable(parsed, "plugins", "plugins");
  for (const pluginKey of pluginKeys) {
    const plugin = getOrCreateTomlTable(
      plugins,
      pluginKey,
      `plugins.${JSON.stringify(pluginKey)}`,
    );
    plugin.enabled = true;
  }

  return stringifyToml(parsed);
}

function tryMinimalCodexPluginConfigToml(
  originalContent: string,
  configPath: string,
  pluginKeys: string[],
  needsPluginHooks: boolean,
): string | null {
  let content = originalContent;
  content = ensureTomlBoolean(content, "features", "plugins", true);
  if (needsPluginHooks) {
    content = ensureTomlBoolean(content, "features", "plugin_hooks", true);
  }
  for (const pluginKey of pluginKeys) {
    content = ensureTomlBoolean(content, `plugins."${pluginKey}"`, "enabled", true);
  }

  try {
    parseToml(content);
    return content;
  } catch {
    // Existing configs may use legal TOML forms such as inline tables
    // (`features = { plugins = false }`). In that case, a local section
    // insertion would redefine the table, so fall back to structured output.
    parseCodexConfigToml(originalContent, configPath);
    return null;
  }
}

function enableCodexPluginConfig(
  configPath: string,
  pluginKeys: string[],
  needsPluginHooks: boolean,
): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const originalContent = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : "";
  const minimalContent = tryMinimalCodexPluginConfigToml(
    originalContent,
    configPath,
    pluginKeys,
    needsPluginHooks,
  );
  const content = minimalContent ?? buildCodexPluginConfigToml(
    originalContent,
    configPath,
    pluginKeys,
    needsPluginHooks,
  );
  fs.writeFileSync(configPath, content.endsWith("\n") ? content : `${content}\n`);
}

async function installCodexPlugins(
  packageRoot: string,
  opts: InstallOpts,
): Promise<void> {
  const marketplace = loadCodexMarketplace(packageRoot);
  if (!marketplace) {
    const msg = "No .agents/plugins/marketplace.json found";
    if (!opts.interactive) throw new Error(msg);
    log.warn(msg);
    return;
  }
  const installConfig = loadCodexInstallConfig(packageRoot);
  if (!installConfig) {
    const msg = "No .agents/plugins/install.json found";
    if (!opts.interactive) throw new Error(msg);
    log.warn(msg);
    return;
  }
  const marketplaceByName = new Map(marketplace.plugins.map((p) => [p.name, p]));

  const selected = opts.interactive
    ? await withEsc(checkbox({
      message: "Select Codex plugins to install:",
      choices: installConfig.plugins.map((p) => ({
        name: p.description ? `${p.name} — ${p.description}` : p.name,
        value: p,
        checked: p.defaultOn !== false,
      })),
    }))
    : resolveCodexPluginSelection(installConfig.plugins, opts.selected);

  if (selected.length === 0) {
    log.skip("No Codex plugins selected");
    return;
  }

  const failures: string[] = [];
  try {
    exec(codexMarketplaceAddCommand(packageRoot), { inherit: true });
    log.ok(`Codex marketplace ${marketplace.name} added`);
  } catch {
    log.error(`Failed to add Codex marketplace: ${marketplace.name}`);
    failures.push(`codex marketplace ${marketplace.name}`);
  }

  if (failures.length === 0) {
    const selectedMarketplacePlugins = selected.map((p) => {
      const plugin = marketplaceByName.get(p.name);
      if (!plugin) {
        throw new Error(`Codex install.json: plugin ${p.name} is not present in marketplace.json`);
      }
      return plugin;
    });
    const pluginKeys = selectedMarketplacePlugins.map((p) => `${p.name}@${marketplace.name}`);
    const needsPluginHooks = selectedMarketplacePlugins.some((p) => pluginHasHooks(packageRoot, p));
    enableCodexPluginConfig(
      path.join(codexHome(), "config.toml"),
      pluginKeys,
      needsPluginHooks,
    );
    for (const plugin of selected) {
      log.ok(`${plugin.name} enabled for Codex`);
    }
  }

  if (failures.length > 0 && !opts.interactive) {
    throw new Error(
      `${failures.length} Codex plugin operation(s) failed: ${failures.join(", ")}`,
    );
  }
}

export async function installPlugins(
  packageRoot: string,
  opts: InstallOpts,
): Promise<void> {
  const agent: PluginAgent = opts.interactive
    ? await withEsc(select<PluginAgent>({
      message: "Plugins target runtime:",
      choices: [
        { name: "Claude Code", value: "claude" },
        { name: "Codex", value: "codex" },
        { name: "Both", value: "both" },
      ],
    }))
    : opts.agent ?? "claude";

  // Non-interactive path already ran `precheckExternal(["plugins"])` in
  // cli.ts's runAll / runSingle before dispatching here, so rechecking
  // `which claude` would be a redundant subprocess on every install.
  // The interactive TTY menu doesn't have that precheck, so still
  // validate there — and fail soft (log-and-return) to match the menu's
  // continue-on-failure ergonomics.
  if (opts.interactive) {
    if (agent === "claude" || agent === "both") {
      try {
        exec("which claude");
      } catch {
        log.error("'claude' CLI not found. Please install Claude Code first.");
        return;
      }
    }
    if (agent === "codex" || agent === "both") {
      try {
        exec("which codex");
      } catch {
        log.error("'codex' CLI not found. Please install Codex first.");
        return;
      }
    }
  }

  if (agent === "codex") {
    await installCodexPlugins(packageRoot, opts);
    return;
  }

  const configPath = path.join(packageRoot, ".claude", "plugins.json");
  if (!fs.existsSync(configPath)) {
    log.warn("No .claude/plugins.json found");
    return;
  }

  const raw: unknown = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  validatePluginsConfig(raw);
  const config: PluginsConfig = raw;

  if (config.plugins.length === 0) {
    log.warn("No plugins defined in plugins.json");
    return;
  }

  type Scope = "project" | "user";
  const scope: Scope = opts.interactive
    ? await withEsc(select<Scope>({
      message: "Plugins installation scope:",
      choices: [
        { name: "User (user-level)", value: "user" },
        { name: "Project (current project)", value: "project" },
      ],
    }))
    : opts.scope ?? "project";

  const installed = getInstalledPlugins();

  const selected = opts.interactive
    ? await withEsc(checkbox({
      message: "Select plugins to install:",
      choices: config.plugins.map((p) => {
        const scopes = installed.get(p.package);
        const suffix = scopes ? ` (installed: ${scopes.join(", ")})` : "";
        return {
          name: `${p.name} — ${p.description}${suffix}`,
          value: p,
          checked: !scopes || !(scopes.includes("user") && scopes.includes("project")),
        };
      }),
    }))
    : resolvePluginSelection(config.plugins, opts.selected);

  if (selected.length === 0) {
    log.skip("No plugins selected");
    return;
  }

  // Install required marketplaces
  const existingMarketplaces = getInstalledMarketplaces();
  const marketplacesToAdd = new Map<string, string>();

  for (const plugin of selected) {
    if (plugin.marketplace && !existingMarketplaces.has(plugin.marketplace.name)) {
      marketplacesToAdd.set(plugin.marketplace.name, plugin.marketplace.source);
    }
  }

  const failures: string[] = [];

  for (const [name, source] of marketplacesToAdd) {
    console.log(`\nAdding marketplace: ${name}...`);
    try {
      exec(`claude plugins marketplace add ${source}`, { inherit: true });
      log.ok(`Marketplace ${name} added`);
    } catch {
      log.error(`Failed to add marketplace: ${name}`);
      failures.push(`marketplace ${name}`);
    }
  }

  // Install plugins
  for (const plugin of selected) {
    console.log(`\nInstalling ${plugin.name}...`);
    try {
      exec(`claude plugins install ${plugin.package} --scope ${scope}`, {
        inherit: true,
      });
      log.ok(`${plugin.name} installed`);
    } catch {
      log.error(`Failed to install: ${plugin.name}`);
      failures.push(plugin.name);
    }
  }

  if (failures.length > 0 && !opts.interactive && agent !== "both") {
    throw new Error(
      `${failures.length} plugin operation(s) failed: ${failures.join(", ")}`,
    );
  }

  if (agent === "both") {
    try {
      await installCodexPlugins(packageRoot, opts);
    } catch (e) {
      failures.push(`codex: ${(e as Error).message}`);
    }
    if (failures.length > 0 && !opts.interactive) {
      throw new Error(
        `${failures.length} plugin operation(s) failed: ${failures.join(", ")}`,
      );
    }
  }
}
