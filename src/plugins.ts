import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkbox, select } from "@inquirer/prompts";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { TomlTable } from "smol-toml";
import {
  codexLocalPluginPath,
  codexManifestPath,
  validateCodexInstallConfig,
  validateCodexMarketplace,
  type CodexInstallConfig,
  type CodexInstallPlugin,
  type CodexMarketplace,
  type CodexMarketplacePlugin,
} from "./codex-plugin-config.js";
import { validateMarketplaceField, type MarketplaceRef } from "./marketplace.js";
import { atomicWriteFile, exec, execAsync, fetchExtraContent, log, withEsc } from "./utils.js";
import type { InstallOpts, PluginAgent, PluginsConfig, PluginDef } from "./utils.js";

// Plugin names and plugin-package names end up in `claude plugins ...`
// shell commands via string interpolation. .claude/plugins.json is
// fetched from raw GitHub at runtime, so every value must pass a
// conservative whitelist before composing the command. Without this a
// compromised plugins.json would execute arbitrary commands via shell
// metachar injection. Marketplace shape (name + source) lives in
// `./marketplace.js` so Claude and Codex sides share one validator.
const PLUGIN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PLUGIN_PACKAGE_RE = /^[A-Za-z0-9][A-Za-z0-9._@/-]{0,255}$/;
const MIGRATED_WORKFLOW_SKILLS = [
  "incremental-impl",
  "test-designer",
  "session-compound",
];
const NOTIFY_PLUGIN_NAME = "auriga-notify";
const WORKFLOW_SKILLS_PLUGIN_NAME = "auriga-workflow-skills";
const LEGACY_NOTIFY_MARKER = "auriga:notify";
const CODEX_PLUGIN_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
type PluginRuntime = "claude" | "codex";

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
      validateMarketplaceField(`plugins.json: plugins[${i}]`, plugin.marketplace);
    }
    if (plugin.defaultOn !== undefined && typeof plugin.defaultOn !== "boolean") {
      throw new Error(`plugins.json: plugins[${i}].defaultOn must be a boolean`);
    }
  });
}

interface PluginInfo {
  id: string;
  scope: string;
  projectPath?: string;
}

interface SettingsHookAction {
  _marker?: string;
  [key: string]: unknown;
}

interface SettingsHookGroup {
  hooks?: SettingsHookAction[];
  [key: string]: unknown;
}

interface SettingsFile {
  hooks?: Record<string, SettingsHookGroup[]>;
  [key: string]: unknown;
}

function getInstalledPlugins(cwd: string = process.cwd()): Map<string, string[]> {
  try {
    const output = exec("claude plugins list --json");
    const plugins: PluginInfo[] = JSON.parse(output);
    const installed = new Map<string, string[]>();

    for (const p of plugins) {
      // project scope 只匹配目标目录
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
 * Non-interactive selection resolver for plugins.
 * `undefined` = default-on set; `["*"]` = full set; explicit names =
 * exact filter. CLI parser validates names up-front.
 */
function resolvePluginSelection(
  all: PluginDef[],
  selected: string[] | undefined,
): PluginDef[] {
  if (!selected) return all.filter((p) => p.defaultOn !== false);
  if (selected.length === 1 && selected[0] === "*") return all;
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

function installTargetCwd(opts: InstallOpts): string {
  return path.resolve(opts.cwd ?? process.cwd());
}

function emitMigrationLog(opts: InstallOpts, line: string): void {
  opts.onLog?.(line, "stdout");
}

function runtimeSkillRoot(runtime: PluginRuntime): ".claude" | ".agents" {
  return runtime === "claude" ? ".claude" : ".agents";
}

function legacySkillDir(
  opts: InstallOpts,
  runtime: PluginRuntime,
  name: string,
): string {
  const cwd = installTargetCwd(opts);
  const scope = opts.scope ?? "project";
  const baseDir = scope === "user" ? os.homedir() : cwd;
  return path.join(baseDir, runtimeSkillRoot(runtime), "skills", name);
}

function isWorkflowPluginDevSymlink(skillPath: string, cwd: string, name: string): boolean {
  const stat = fs.lstatSync(skillPath, { throwIfNoEntry: false });
  if (!stat?.isSymbolicLink()) return false;
  const target = fs.readlinkSync(skillPath);
  const resolved = path.resolve(path.dirname(skillPath), target);
  const expected = path.resolve(cwd, "plugins", "auriga-workflow-skills", "skills", name);
  return resolved === expected;
}

function removeMigratedSkillFromLock(cwd: string, name: string, opts: InstallOpts): void {
  const lockPath = path.join(cwd, "skills-lock.json");
  if (!fs.existsSync(lockPath)) return;
  const raw = JSON.parse(fs.readFileSync(lockPath, "utf-8")) as {
    skills?: Record<string, unknown>;
    [key: string]: unknown;
  };
  if (!raw.skills || typeof raw.skills !== "object" || !(name in raw.skills)) return;
  const nextSkills = { ...raw.skills };
  delete nextSkills[name];
  atomicWriteFile(lockPath, JSON.stringify({ ...raw, skills: nextSkills }, null, 2) + "\n");
  emitMigrationLog(opts, `removed ${name} from skills-lock.json`);
}

function cleanupMigratedWorkflowSkillInstalls(
  opts: InstallOpts,
  runtimes: PluginRuntime[],
): void {
  const cwd = installTargetCwd(opts);
  const scope = opts.scope ?? "project";
  for (const name of MIGRATED_WORKFLOW_SKILLS) {
    for (const runtime of runtimes) {
      const dir = legacySkillDir(opts, runtime, name);
      const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
      if (!stat) continue;
      if (scope === "project" && isWorkflowPluginDevSymlink(dir, cwd, name)) {
        emitMigrationLog(opts, `preserved ${runtimeSkillRoot(runtime)}/skills/${name} development symlink`);
        continue;
      }
      fs.rmSync(dir, { recursive: true, force: true });
      emitMigrationLog(opts, `removed ${runtimeSkillRoot(runtime)}/skills/${name}`);
    }
    if (scope === "project") removeMigratedSkillFromLock(cwd, name, opts);
  }
}

function copyIfPresentWithoutOverwrite(src: string, dest: string): boolean {
  if (!fs.existsSync(src) || fs.existsSync(dest)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function removeMarkerFromSettings(settings: SettingsFile, marker: string): {
  settings: SettingsFile;
  removed: number;
} {
  const next: SettingsFile = JSON.parse(JSON.stringify(settings ?? {}));
  if (!next.hooks || typeof next.hooks !== "object" || Array.isArray(next.hooks)) {
    return { settings: next, removed: 0 };
  }
  let removed = 0;
  for (const event of Object.keys(next.hooks)) {
    const groups = next.hooks[event];
    if (!Array.isArray(groups)) continue;
    const nextGroups: SettingsHookGroup[] = [];
    for (const group of groups) {
      if (!Array.isArray(group.hooks)) {
        nextGroups.push(group);
        continue;
      }
      const hooks = group.hooks.filter((action) => {
        if (action?._marker === marker) {
          removed += 1;
          return false;
        }
        return true;
      });
      if (hooks.length > 0) nextGroups.push({ ...group, hooks });
    }
    if (nextGroups.length > 0) next.hooks[event] = nextGroups;
    else delete next.hooks[event];
  }
  return { settings: next, removed };
}

function cleanLegacyNotifySettings(settingsPaths: string[], opts: InstallOpts): boolean {
  let allReadable = true;
  for (const settingsPath of settingsPaths) {
    if (!fs.existsSync(settingsPath)) continue;
    let parsed: SettingsFile;
    try {
      parsed = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as SettingsFile;
    } catch {
      emitMigrationLog(opts, `skipped unreadable legacy notify settings: ${settingsPath}`);
      allReadable = false;
      continue;
    }
    const result = removeMarkerFromSettings(parsed, LEGACY_NOTIFY_MARKER);
    if (result.removed === 0) continue;
    atomicWriteFile(settingsPath, JSON.stringify(result.settings, null, 2) + "\n");
    emitMigrationLog(opts, `removed ${result.removed} legacy notify settings entries from ${settingsPath}`);
  }
  return allReadable;
}

function migrateLegacyNotifyConfig(opts: InstallOpts): void {
  const scope = opts.scope ?? "project";
  const cwd = installTargetCwd(opts);
  const home = os.homedir();
  const legacyBase = scope === "user" ? home : cwd;
  const legacyDir = path.join(legacyBase, ".claude", "hooks", "notify");
  const destDir = scope === "user"
    ? path.join(home, ".config", "auriga-cli", "notify")
    : path.join(cwd, ".claude", "auriga-notify");

  const copiedConfig = copyIfPresentWithoutOverwrite(
    path.join(legacyDir, "config.json"),
    path.join(destDir, "config.json"),
  );
  const copiedIcon = copyIfPresentWithoutOverwrite(
    path.join(legacyDir, "icon.png"),
    path.join(destDir, "icon.png"),
  );
  if (copiedConfig) emitMigrationLog(opts, `migrated legacy notify config to ${path.join(destDir, "config.json")}`);
  if (copiedIcon) emitMigrationLog(opts, `migrated legacy notify icon to ${path.join(destDir, "icon.png")}`);

  const settingsPaths = scope === "user"
    ? [path.join(home, ".claude", "settings.json")]
    : [
        path.join(cwd, ".claude", "settings.json"),
        path.join(cwd, ".claude", "settings.local.json"),
      ];
  const settingsCleaned = cleanLegacyNotifySettings(settingsPaths, opts);

  if (settingsCleaned && fs.existsSync(legacyDir)) {
    fs.rmSync(legacyDir, { recursive: true, force: true });
    emitMigrationLog(opts, `removed legacy notify hook directory ${legacyDir}`);
  } else if (!settingsCleaned && fs.existsSync(legacyDir)) {
    emitMigrationLog(opts, `kept legacy notify hook directory because settings cleanup was incomplete: ${legacyDir}`);
  }
}

function runPostInstallMigration(
  pluginName: string,
  opts: InstallOpts,
  runtimes: PluginRuntime[],
): void {
  if (pluginName === WORKFLOW_SKILLS_PLUGIN_NAME) {
    cleanupMigratedWorkflowSkillInstalls(opts, runtimes);
  }
  if (pluginName === NOTIFY_PLUGIN_NAME) {
    migrateLegacyNotifyConfig(opts);
  }
}

function codexMarketplaceAddCommand(packageRoot: string): string {
  if (process.env.DEV === "1") {
    return `codex plugin marketplace add ${shellQuote(packageRoot)}`;
  }
  return "codex plugin marketplace add https://github.com/Ben2pc/auriga-cli.git";
}

function codexExternalMarketplaceAddCommand(source: string): string {
  // `source` is validated by validateCodexInstallConfig against
  // MARKETPLACE_SOURCE_RE (alphanumerics + `._/-`) — no shell metachars
  // can reach this string. URL form deliberately mirrors
  // codexMarketplaceAddCommand's hardcoded production branch.
  return `codex plugin marketplace add https://github.com/${source}.git`;
}

function codexMarketplaceUpgradeCommand(marketplaceName: string): string {
  return `codex plugin marketplace upgrade ${shellQuote(marketplaceName)}`;
}

function commandErrorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts = [error.message];
  const withOutput = error as Error & { stdout?: unknown; stderr?: unknown };
  if (withOutput.stdout) parts.push(String(withOutput.stdout));
  if (withOutput.stderr) parts.push(String(withOutput.stderr));
  return parts.join("\n");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCodexMarketplaceAlreadyAdded(error: unknown, marketplaceName: string): boolean {
  const text = commandErrorText(error);
  const marketplacePattern = new RegExp(
    `marketplace ['"]?${escapeRegex(marketplaceName)}['"]? is already added`,
    "i",
  );
  return marketplacePattern.test(text)
    || /already added from a different source/i.test(text);
}

function pluginHasHooks(packageRoot: string, plugin: CodexMarketplacePlugin): boolean {
  const relativeManifestPath = codexManifestPath(plugin);
  if (!relativeManifestPath) return false;
  const manifestPath = path.join(packageRoot, relativeManifestPath);
  if (!fs.existsSync(manifestPath)) return false;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as { hooks?: unknown };
  return typeof manifest.hooks === "string" || Array.isArray(manifest.hooks);
}

function resolveSelectedCodexMarketplacePlugins(
  localMarketplace: CodexMarketplace,
  localSelected: CodexInstallPlugin[],
): CodexMarketplacePlugin[] {
  const localMpByName = new Map(
    localMarketplace.plugins.map((p) => [p.name, p]),
  );
  return localSelected.map((p) => {
    const plugin = localMpByName.get(p.name);
    if (!plugin) {
      throw new Error(`Codex install.json: plugin ${p.name} is not present in marketplace.json`);
    }
    return plugin;
  });
}

async function ensureCodexPluginManifests(
  packageRoot: string,
  plugins: CodexMarketplacePlugin[],
): Promise<void> {
  for (const plugin of plugins) {
    const manifestPath = codexManifestPath(plugin);
    if (!manifestPath) {
      throw new Error(`Codex marketplace.json: plugin ${plugin.name} must use a local source.path`);
    }
    if (fs.existsSync(path.join(packageRoot, manifestPath))) continue;
    await fetchExtraContent(packageRoot, manifestPath);
  }
}

function readCodexPluginVersion(packageRoot: string, plugin: CodexMarketplacePlugin): string {
  const manifestPath = codexManifestPath(plugin);
  if (!manifestPath) {
    throw new Error(`Codex marketplace.json: plugin ${plugin.name} must use a local source.path`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, manifestPath), "utf-8")) as {
    version?: unknown;
  };
  if (typeof manifest.version !== "string" || !CODEX_PLUGIN_VERSION_RE.test(manifest.version)) {
    throw new Error(`Codex plugin ${plugin.name} manifest must include a safe string version`);
  }
  return manifest.version;
}

function materializeLocalCodexPluginCache(
  packageRoot: string,
  marketplaceName: string,
  plugins: CodexMarketplacePlugin[],
): void {
  const cacheRoot = path.join(codexHome(), "plugins", "cache");
  for (const plugin of plugins) {
    const sourcePath = codexLocalPluginPath(plugin);
    if (!sourcePath) {
      throw new Error(`Codex marketplace.json: plugin ${plugin.name} must use a local source.path`);
    }
    const version = readCodexPluginVersion(packageRoot, plugin);
    const sourceDir = path.join(packageRoot, sourcePath);
    const destDir = path.join(cacheRoot, marketplaceName, plugin.name, version);
    const tmpDir = `${destDir}.tmp-${process.pid}-${Date.now()}`;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    fs.cpSync(sourceDir, tmpDir, { recursive: true });
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.renameSync(tmpDir, destDir);
    if (!fs.existsSync(path.join(destDir, ".codex-plugin", "plugin.json"))) {
      throw new Error(`Codex plugin ${plugin.name} cache materialization did not produce plugin.json`);
    }
  }
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
  atomicWriteFile(configPath, content.endsWith("\n") ? content : `${content}\n`);
}

async function addCodexMarketplaceWithRetry(
  marketplaceName: string,
  addCommand: string,
  opts: InstallOpts,
  marketplaceExecOpts: { inherit: true } | undefined,
  failures: string[],
): Promise<void> {
  try {
    exec(addCommand, marketplaceExecOpts);
    log.ok(`Codex marketplace ${marketplaceName} added`);
    return;
  } catch (e) {
    if (opts.interactive || isCodexMarketplaceAlreadyAdded(e, marketplaceName)) {
      try {
        exec(codexMarketplaceUpgradeCommand(marketplaceName), marketplaceExecOpts);
        log.ok(`Codex marketplace ${marketplaceName} upgraded`);
        return;
      } catch (upgradeErr) {
        // Surface the underlying upgrade error so a 6-month-out reader
        // can tell apart ENOENT / network / auth / git failures.
        log.error(
          `Failed to upgrade Codex marketplace: ${marketplaceName}\n${commandErrorText(upgradeErr)}`,
        );
        failures.push(`codex marketplace ${marketplaceName}`);
        return;
      }
    }
    // Same: surface the add error rather than masking ENOENT / network / auth.
    log.error(
      `Failed to add Codex marketplace: ${marketplaceName}\n${commandErrorText(e)}`,
    );
    failures.push(`codex marketplace ${marketplaceName}`);
  }
}

type ExternalSelection = CodexInstallPlugin & { marketplace: MarketplaceRef };

// Builds the `<name>@<marketplace>` config keys + decides whether
// features.plugin_hooks needs to flip on. Local plugins resolve through
// this repo's marketplace.json and require a manifest fetch + hooks
// inspection; external plugins emit a key directly from install.json
// (Codex CLI fetches the upstream manifest itself). External plugins do
// NOT flip plugin_hooks today — we don't have access to the upstream
// manifest at install time. Acceptable while no external plugin ships
// hooks; once one does, prefer fetching the manifest or adding an
// explicit `requiresPluginHooks: true` field on the install.json entry.
async function composeCodexPluginKeys(
  packageRoot: string,
  localMarketplace: CodexMarketplace | null,
  selectedMarketplacePlugins: CodexMarketplacePlugin[],
  externalSelected: ExternalSelection[],
): Promise<{ pluginKeys: string[]; needsPluginHooks: boolean }> {
  const pluginKeys: string[] = [];
  let needsPluginHooks = false;

  if (localMarketplace) {
    for (const plugin of selectedMarketplacePlugins) {
      pluginKeys.push(`${plugin.name}@${localMarketplace.name}`);
      if (pluginHasHooks(packageRoot, plugin)) needsPluginHooks = true;
    }
  }

  for (const p of externalSelected) {
    pluginKeys.push(`${p.name}@${p.marketplace.name}`);
  }

  return { pluginKeys, needsPluginHooks };
}

async function installCodexPlugins(
  packageRoot: string,
  opts: InstallOpts,
): Promise<void> {
  const installConfig = loadCodexInstallConfig(packageRoot);
  if (!installConfig) {
    const msg = "No .agents/plugins/install.json found";
    if (!opts.interactive) throw new Error(msg);
    log.warn(msg);
    return;
  }

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

  // Local plugins are described by this repo's .agents/plugins/marketplace.json
  // and need a manifest fetch + hooks-detection. External plugins point to a
  // different GitHub-hosted Codex marketplace and are resolved by Codex CLI
  // itself when the marketplace is added — we only need to register the
  // marketplace and emit the right `<name>@<marketplace>` plugin key.
  let localSelected = selected.filter((p) => p.marketplace === undefined);
  const externalSelected: ExternalSelection[] = selected.filter(
    (p): p is ExternalSelection => p.marketplace !== undefined,
  );

  let localMarketplace: CodexMarketplace | null = null;
  if (localSelected.length > 0) {
    localMarketplace = loadCodexMarketplace(packageRoot);
    if (!localMarketplace) {
      const msg = "No .agents/plugins/marketplace.json found";
      // External-only fallback: when the user also selected external
      // plugins (which don't depend on local marketplace.json), drop the
      // local set and proceed instead of bailing out — partial install is
      // strictly better than zero install. Throw / log-and-skip the
      // local-only case as before.
      if (externalSelected.length === 0) {
        if (!opts.interactive) throw new Error(msg);
        log.warn(msg);
        return;
      }
      log.warn(`${msg} — skipping ${localSelected.length} local plugin(s) but continuing with externals`);
      localSelected = [];
    }
  }

  const failures: string[] = [];
  const marketplaceExecOpts: { inherit: true } | undefined = opts.interactive
    ? { inherit: true }
    : undefined;

  if (localMarketplace) {
    await addCodexMarketplaceWithRetry(
      localMarketplace.name,
      codexMarketplaceAddCommand(packageRoot),
      opts,
      marketplaceExecOpts,
      failures,
    );
  }

  // Dedupe external marketplaces by name — multiple plugins from the same
  // upstream share a single `marketplace add` call.
  const uniqueExternalMarketplaces = new Map<string, MarketplaceRef>();
  for (const p of externalSelected) {
    uniqueExternalMarketplaces.set(p.marketplace.name, p.marketplace);
  }
  for (const mp of uniqueExternalMarketplaces.values()) {
    await addCodexMarketplaceWithRetry(
      mp.name,
      codexExternalMarketplaceAddCommand(mp.source),
      opts,
      marketplaceExecOpts,
      failures,
    );
  }

  if (failures.length === 0) {
    const selectedMarketplacePlugins = localMarketplace
      ? resolveSelectedCodexMarketplacePlugins(localMarketplace, localSelected)
      : [];
    await ensureCodexPluginManifests(packageRoot, selectedMarketplacePlugins);
    if (localMarketplace) {
      materializeLocalCodexPluginCache(
        packageRoot,
        localMarketplace.name,
        selectedMarketplacePlugins,
      );
    }
    const { pluginKeys, needsPluginHooks } = await composeCodexPluginKeys(
      packageRoot,
      localMarketplace,
      selectedMarketplacePlugins,
      externalSelected,
    );

    enableCodexPluginConfig(
      path.join(codexHome(), "config.toml"),
      pluginKeys,
      needsPluginHooks,
    );
    for (const plugin of [...localSelected, ...externalSelected]) {
      log.ok(`${plugin.name} enabled for Codex`);
      runPostInstallMigration(plugin.name, opts, ["codex"]);
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

  const failures: string[] = [];
  const configPath = path.join(packageRoot, ".claude", "plugins.json");
  let config: PluginsConfig | null = null;
  if (!fs.existsSync(configPath)) {
    log.warn("No .claude/plugins.json found");
    if (agent === "both") failures.push("Claude Code plugins config missing");
    else return;
  } else {
    const raw: unknown = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    validatePluginsConfig(raw);
    config = raw;

    if (config.plugins.length === 0) {
      log.warn("No plugins defined in plugins.json");
      if (agent === "both") failures.push("Claude Code plugins config empty");
      else return;
      config = null;
    }
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

  if (config) {
    const targetCwd = installTargetCwd(opts);
    const installed = getInstalledPlugins(targetCwd);

    let selected: PluginDef[];
    try {
      selected = opts.interactive
        ? await withEsc(checkbox({
          message: "Select plugins to install:",
          choices: config.plugins.map((p) => {
            const scopes = installed.get(p.package);
            const suffix = scopes ? ` (installed: ${scopes.join(", ")})` : "";
            const installedEverywhere = scopes?.includes("user") && scopes?.includes("project");
            return {
              name: `${p.name} — ${p.description}${suffix}`,
              value: p,
              checked: p.defaultOn !== false && !installedEverywhere,
            };
          }),
        }))
        : resolvePluginSelection(config.plugins, opts.selected);
    } catch (e) {
      if (agent !== "both") throw e;
      selected = [];
      failures.push(`Claude Code: ${(e as Error).message}`);
    }

    if (selected.length === 0) {
      log.skip("No plugins selected");
    } else {
      // Install or refresh required marketplaces. Already-present
      // marketplaces keep whatever marketplace.json was cached at the last
      // `add` — refresh them so upstream renames / additions become
      // visible without users manually re-adding. Same add-or-update
      // intent as the Codex path; simpler control flow here because
      // `getInstalledMarketplaces` pre-classifies into two buckets.
      const existingMarketplaces = getInstalledMarketplaces();
      const marketplacesToAdd = new Map<string, string>();
      const marketplacesToUpdate = new Set<string>();

      for (const plugin of selected) {
        if (!plugin.marketplace) continue;
        if (existingMarketplaces.has(plugin.marketplace.name)) {
          marketplacesToUpdate.add(plugin.marketplace.name);
        } else {
          marketplacesToAdd.set(plugin.marketplace.name, plugin.marketplace.source);
        }
      }

      for (const [name, source] of marketplacesToAdd) {
        console.log(`\nAdding marketplace: ${name}...`);
        try {
          const cmd = `claude plugins marketplace add ${source}`;
          if (opts.onLog) {
            opts.onLog(`▸ ${cmd}`, "stdout");
            await execAsync(cmd, { onLine: opts.onLog });
          } else {
            exec(cmd, { inherit: true });
          }
          log.ok(`Marketplace ${name} added`);
        } catch {
          log.error(`Failed to add marketplace: ${name}`);
          failures.push(`marketplace ${name}`);
        }
      }

      for (const name of marketplacesToUpdate) {
        console.log(`\nUpdating marketplace: ${name}...`);
        try {
          const cmd = `claude plugins marketplace update ${name}`;
          if (opts.onLog) {
            opts.onLog(`▸ ${cmd}`, "stdout");
            await execAsync(cmd, { onLine: opts.onLog });
          } else {
            exec(cmd, { inherit: true });
          }
          log.ok(`Marketplace ${name} updated`);
        } catch (e) {
          // Surface the underlying error so a 6-month-out reader can tell
          // ENOENT / network / auth / git failures apart — mirrors the
          // Codex side's commandErrorText usage in addCodexMarketplaceWithRetry.
          log.error(`Failed to update marketplace: ${name}\n${commandErrorText(e)}`);
          failures.push(`marketplace ${name}`);
        }
      }

      // Install or upgrade plugins. `claude plugins install` is a no-op
      // when the plugin is already installed at the target scope, so a
      // reinstall would silently skip the upgrade — even after the
      // marketplace was refreshed above. Branch to `claude plugins update`
      // for already-installed-at-target-scope plugins so the cached
      // version actually advances. Mirrors the marketplace add/update
      // branching right above.
      for (const plugin of selected) {
        const isUpdate = installed.get(plugin.package)?.includes(scope) ?? false;
        const action = isUpdate ? "update" : "install";
        console.log(`\n${isUpdate ? "Updating" : "Installing"} ${plugin.name}...`);
        try {
          const cmd = `claude plugins ${action} ${plugin.package} --scope ${scope}`;
          const cmdOpts = { cwd: targetCwd };
          if (opts.onLog) {
            opts.onLog(`▸ ${cmd}`, "stdout");
            await execAsync(cmd, { ...cmdOpts, onLine: opts.onLog });
          } else {
            exec(cmd, { ...cmdOpts, inherit: true });
          }
          log.ok(`${plugin.name} ${isUpdate ? "updated" : "installed"}`);
          runPostInstallMigration(plugin.name, { ...opts, scope }, ["claude"]);
        } catch (e) {
          log.error(`Failed to ${action}: ${plugin.name}\n${commandErrorText(e)}`);
          failures.push(plugin.name);
        }
      }
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

// --- Uninstall ----------------------------------------------------------------

// Plugin id format: `<plugin>@<marketplace>` (matches the Codex config.toml
// key shape and Claude Code's `claude plugins install ...` argument).
// Tightened with the same name regex used everywhere else in this file
// (PLUGIN_NAME_RE on the plugin side, MARKETPLACE_NAME_RE on the
// marketplace side, both anchored). `name` is interpolated into a shell
// command (Claude path) and used as a filesystem segment (Codex path);
// rejecting unsafe shapes here closes both attack surfaces in one place.
const PLUGIN_ID_RE = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127})@([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/;

function parsePluginId(id: string): { plugin: string; marketplace: string } {
  const m = PLUGIN_ID_RE.exec(id);
  if (!m) {
    throw new Error(
      `uninstallPlugin: invalid plugin id ${JSON.stringify(id)}; expected <plugin>@<marketplace>`,
    );
  }
  return { plugin: m[1], marketplace: m[2] };
}

/**
 * Remove `[plugins."<id>"]` from a parsed Codex config TOML tree.
 * Returns true if anything was removed. Idempotent: missing key → false.
 *
 * Pure function operating on the parsed tree — no I/O. Lets the test
 * harness assert tree shape without touching disk + lets the I/O wrapper
 * skip the atomic write when nothing changed.
 */
function removeCodexPluginFromConfig(
  parsed: TomlTable,
  pluginId: string,
): boolean {
  const plugins = parsed.plugins;
  if (!isTomlTable(plugins)) return false;
  if (!(pluginId in plugins)) return false;
  delete plugins[pluginId];
  return true;
}

/**
 * Uninstall a single plugin.
 *
 *   Claude side: shells out to `claude plugins uninstall <id>` (the
 *     canonical CLI path). Errors are propagated — the CLI sometimes
 *     surfaces nuanced failure modes (marketplace gone, network) that
 *     the caller needs to see verbatim.
 *
 *   Codex side: no `codex plugin uninstall` exists today (spec §10.4
 *     flagged this as v0.1 needs-confirm). We mimic the install path
 *     in reverse:
 *       1. Read + parse `~/.codex/config.toml`, delete `[plugins."<id>"]`,
 *          atomic write back. Throws on parse error (don't half-corrupt).
 *       2. rm `~/.codex/plugins/cache/<marketplace>/<plugin>/` directory.
 *     Both steps are idempotent — missing config / missing cache dir is
 *     a no-op (the user may have manually cleaned half of the install).
 *
 *     Caveat: we deliberately do NOT remove the marketplace itself. A
 *     single marketplace may host multiple plugins; tearing it down
 *     because one plugin left would break others. The user can
 *     `codex plugin marketplace remove` separately when they want.
 *
 * Validation happens before any I/O — a malformed id throws cleanly with
 * no side effects, so retries are safe.
 */
export async function uninstallPlugin(
  id: string,
  agent: "claude" | "codex",
  opts: { cwd: string; onLog?: (line: string) => void },
): Promise<void> {
  const { plugin, marketplace } = parsePluginId(id);
  const emit = (line: string): void => { opts.onLog?.(line); };

  if (agent === "claude") {
    // Note: scope is intentionally NOT specified. `claude plugins
    // uninstall <id>` operates against whatever scope the plugin is
    // installed in (user / project) — letting the CLI find it is
    // more robust than guessing wrong and silently no-op'ing.
    exec(`claude plugins uninstall ${id}`, { cwd: opts.cwd, inherit: true });
    log.ok(`${id} uninstalled from Claude Code`);
    emit(`uninstalled ${id} from Claude Code`);
    return;
  }

  // Codex path.
  const home = codexHome();
  const configPath = path.join(home, "config.toml");

  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, "utf-8");
    // Parse-then-mutate: any parse failure aborts BEFORE we touch the
    // filesystem (cache dir removal also gets skipped) so a damaged
    // config doesn't end up half-uninstalled. The test "config.toml
    // damaged → throw before mutation" locks this in.
    const parsed = parseCodexConfigToml(content, configPath);
    const removed = removeCodexPluginFromConfig(parsed, id);
    if (removed) {
      const next = stringifyToml(parsed);
      atomicWriteFile(configPath, next.endsWith("\n") ? next : `${next}\n`);
      log.ok(`${id} disabled in Codex config.toml`);
      emit(`removed ${id} from Codex config.toml`);
    } else {
      log.skip(`${id} not present in Codex config.toml`);
      emit(`${id} not present in Codex config.toml`);
    }
  } else {
    log.skip(`Codex config.toml not present`);
    emit(`Codex config.toml not present`);
  }

  // Cache dir: ~/.codex/plugins/cache/<marketplace>/<plugin>/
  // PLUGIN_ID_RE constrains both segments to a safe charset, so the
  // path can't escape via injection. rmSync with recursive+force is
  // the standard rm-rf idiom; missing dir is a no-op.
  const cacheDir = path.join(home, "plugins", "cache", marketplace, plugin);
  if (fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    log.ok(`${id} cache directory removed`);
    emit(`removed Codex cache directory for ${id}`);
  } else {
    log.skip(`${id} cache directory not present`);
    emit(`Codex cache directory for ${id} not present`);
  }
}
