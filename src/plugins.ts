import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkbox, select } from "@inquirer/prompts";
import { parse as parseToml } from "smol-toml";
import type { TomlTable } from "smol-toml";
import {
  validateCodexMarketplace,
  type CodexMarketplace,
  type CodexMarketplacePlugin,
} from "./codex-plugin-config.js";
import { validateMarketplaceField, type MarketplaceRef } from "./marketplace.js";
import { atomicWriteFile, exec, execAsync, log, withEsc } from "./utils.js";
import type { InstallOpts, PluginAgent, PluginsConfig, PluginDef } from "./utils.js";

// Plugin names and plugin-package names end up in `claude plugins ...`
// shell commands via string interpolation. Marketplace and extra config
// files are fetched from raw GitHub at runtime, so every value must pass a
// conservative whitelist before composing the command. Without this a
// compromised config would execute arbitrary commands via shell
// metachar injection. Marketplace shape (name + source) lives in
// `./marketplace.js` so Claude and Codex sides share one validator.
const PLUGIN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PLUGIN_PACKAGE_RE = /^[A-Za-z0-9][A-Za-z0-9._@/-]{0,255}$/;
const LOCAL_MARKETPLACE_SOURCE = "Ben2pc/auriga-cli";
const MIGRATED_WORKFLOW_SKILLS = [
  "incremental-impl",
  "test-designer",
  "session-compound",
  "systematic-debugging",
];
const NOTIFY_PLUGIN_NAME = "auriga-notify";
const WORKFLOW_SKILLS_PLUGIN_NAME = "auriga-workflow";
const LEGACY_NOTIFY_MARKER = "auriga:notify";
export type PluginRuntime = "claude" | "codex";

export interface ClaudeMarketplacePlugin {
  name: string;
  description?: string;
  source?: string;
}

export interface ClaudeMarketplace {
  name: string;
  plugins: ClaudeMarketplacePlugin[];
}

export interface ExtraPluginConfig {
  name: string;
  agents?: PluginRuntime[];
  description?: string;
  defaultOn?: boolean;
  claude?: {
    package?: string;
    marketplace?: MarketplaceRef;
  };
  codex?: {
    marketplace?: MarketplaceRef;
  };
}

export interface ExtraPluginConfigs {
  plugins: ExtraPluginConfig[];
}

interface CodexInstallPlugin {
  name: string;
  description?: string;
  defaultOn?: boolean;
  marketplace?: MarketplaceRef;
}

interface CodexInstallConfig {
  plugins: CodexInstallPlugin[];
}

function validateClaudeMarketplace(raw: unknown): asserts raw is ClaudeMarketplace {
  if (!raw || typeof raw !== "object") {
    throw new Error("Claude marketplace.json: root must be an object");
  }
  const cfg = raw as Record<string, unknown>;
  if (typeof cfg.name !== "string" || !PLUGIN_NAME_RE.test(cfg.name)) {
    throw new Error("Claude marketplace.json: root must include a safe name");
  }
  if (!Array.isArray(cfg.plugins)) {
    throw new Error("Claude marketplace.json: .plugins must be an array");
  }
  cfg.plugins.forEach((p, i) => {
    if (!p || typeof p !== "object") {
      throw new Error(`Claude marketplace.json: plugins[${i}] must be an object`);
    }
    const plugin = p as Record<string, unknown>;
    if (typeof plugin.name !== "string" || !PLUGIN_NAME_RE.test(plugin.name)) {
      throw new Error(
        `Claude marketplace.json: plugins[${i}].name ${JSON.stringify(plugin.name)} does not match ${PLUGIN_NAME_RE}`,
      );
    }
    if (plugin.description !== undefined && typeof plugin.description !== "string") {
      throw new Error(`Claude marketplace.json: plugins[${i}].description must be a string`);
    }
  });
}

export function validateExtraPluginConfigs(raw: unknown): asserts raw is ExtraPluginConfigs {
  if (!raw || typeof raw !== "object") {
    throw new Error("extra_plugin_configs.json: root must be an object");
  }
  const cfg = raw as Record<string, unknown>;
  if (!Array.isArray(cfg.plugins)) {
    throw new Error("extra_plugin_configs.json: .plugins must be an array");
  }
  cfg.plugins.forEach((p, i) => {
    if (!p || typeof p !== "object") {
      throw new Error(`extra_plugin_configs.json: plugins[${i}] must be an object`);
    }
    const plugin = p as Record<string, unknown>;
    if (typeof plugin.name !== "string" || !PLUGIN_NAME_RE.test(plugin.name)) {
      throw new Error(
        `extra_plugin_configs.json: plugins[${i}].name ${JSON.stringify(plugin.name)} does not match ${PLUGIN_NAME_RE}`,
      );
    }
    if (plugin.agents !== undefined) {
      if (!Array.isArray(plugin.agents) || !plugin.agents.every((agent) => agent === "claude" || agent === "codex")) {
        throw new Error(`extra_plugin_configs.json: plugins[${i}].agents must contain only claude/codex`);
      }
    }
    if (plugin.description !== undefined && typeof plugin.description !== "string") {
      throw new Error(`extra_plugin_configs.json: plugins[${i}].description must be a string`);
    }
    if (plugin.defaultOn !== undefined && typeof plugin.defaultOn !== "boolean") {
      throw new Error(`extra_plugin_configs.json: plugins[${i}].defaultOn must be a boolean`);
    }
    for (const runtime of ["claude", "codex"] as const) {
      const runtimeCfg = plugin[runtime];
      if (runtimeCfg === undefined) continue;
      if (!runtimeCfg || typeof runtimeCfg !== "object") {
        throw new Error(`extra_plugin_configs.json: plugins[${i}].${runtime} must be an object`);
      }
      const runtimeRecord = runtimeCfg as Record<string, unknown>;
      if (runtime === "claude" && runtimeRecord.package !== undefined) {
        if (typeof runtimeRecord.package !== "string" || !PLUGIN_PACKAGE_RE.test(runtimeRecord.package)) {
          throw new Error(
            `extra_plugin_configs.json: plugins[${i}].claude.package ${JSON.stringify(runtimeRecord.package)} does not match ${PLUGIN_PACKAGE_RE}`,
          );
        }
      }
      if (runtimeRecord.marketplace !== undefined) {
        validateMarketplaceField(`extra_plugin_configs.json: plugins[${i}].${runtime}`, runtimeRecord.marketplace);
      }
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
 * Drops `exclude`-named plugins from a candidate list. The TUI's
 *「其他插件」menu item passes `["auriga-workflow"]` so the plugin already
 * installed by the preset isn't offered again (VAL-TUI-005). A pure,
 * order-preserving filter — `undefined` / empty `exclude` is a no-op.
 */
export function excludeByName<T extends { name: string }>(
  plugins: T[],
  exclude: readonly string[] | undefined,
): T[] {
  if (!exclude || exclude.length === 0) return plugins;
  const drop = new Set(exclude);
  return plugins.filter((p) => !drop.has(p.name));
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

export function loadExtraPluginConfigs(packageRoot: string): ExtraPluginConfigs {
  const configPath = path.join(packageRoot, "extra_plugin_configs.json");
  if (!fs.existsSync(configPath)) return { plugins: [] };
  const raw: unknown = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  validateExtraPluginConfigs(raw);
  return raw;
}

export function extraAppliesTo(extra: ExtraPluginConfig, runtime: PluginRuntime): boolean {
  return extra.agents === undefined || extra.agents.includes(runtime);
}

export function extraByNameForRuntime(
  extras: ExtraPluginConfigs,
  runtime: PluginRuntime,
): Map<string, ExtraPluginConfig> {
  return new Map(
    extras.plugins
      .filter((extra) => extraAppliesTo(extra, runtime))
      .map((extra) => [extra.name, extra]),
  );
}

export function applyExtraPluginFields<T extends { name: string; description?: string; defaultOn?: boolean }>(
  plugin: T,
  extra: ExtraPluginConfig | undefined,
): T {
  if (!extra) return plugin;
  return {
    ...plugin,
    ...(extra.description !== undefined ? { description: extra.description } : {}),
    ...(extra.defaultOn !== undefined ? { defaultOn: extra.defaultOn } : {}),
  };
}

export function loadClaudeMarketplace(packageRoot: string): ClaudeMarketplace | null {
  const marketplacePath = path.join(packageRoot, ".claude-plugin", "marketplace.json");
  if (!fs.existsSync(marketplacePath)) return null;
  const raw: unknown = JSON.parse(fs.readFileSync(marketplacePath, "utf-8"));
  validateClaudeMarketplace(raw);
  return raw;
}

function loadClaudePluginsConfig(packageRoot: string): PluginsConfig | null {
  const extras = loadExtraPluginConfigs(packageRoot);
  const extraByName = extraByNameForRuntime(extras, "claude");
  const marketplace = loadClaudeMarketplace(packageRoot);
  const plugins = new Map<string, PluginDef>();

  if (marketplace) {
    for (const plugin of marketplace.plugins) {
      plugins.set(
        plugin.name,
        applyExtraPluginFields({
          name: plugin.name,
          package: `${plugin.name}@${marketplace.name}`,
          description: plugin.description ?? plugin.name,
          marketplace: { name: marketplace.name, source: LOCAL_MARKETPLACE_SOURCE },
        }, extraByName.get(plugin.name)),
      );
    }
  }

  for (const extra of extras.plugins) {
    if (!extraAppliesTo(extra, "claude") || !extra.claude?.package) continue;
    plugins.set(extra.name, {
      name: extra.name,
      package: extra.claude.package,
      description: extra.description ?? extra.name,
      ...(extra.defaultOn !== undefined ? { defaultOn: extra.defaultOn } : {}),
      ...(extra.claude.marketplace ? { marketplace: extra.claude.marketplace } : {}),
    });
  }

  return plugins.size > 0 ? { plugins: [...plugins.values()] } : null;
}

function loadCodexMarketplace(packageRoot: string): CodexMarketplace | null {
  const marketplacePath = path.join(packageRoot, ".agents", "plugins", "marketplace.json");
  if (!fs.existsSync(marketplacePath)) return null;
  const raw: unknown = JSON.parse(fs.readFileSync(marketplacePath, "utf-8"));
  validateCodexMarketplace(raw);
  return raw;
}

function loadCodexInstallConfig(packageRoot: string): CodexInstallConfig | null {
  const extras = loadExtraPluginConfigs(packageRoot);
  const extraByName = extraByNameForRuntime(extras, "codex");
  const marketplace = loadCodexMarketplace(packageRoot);
  const plugins = new Map<string, CodexInstallPlugin>();

  if (marketplace) {
    for (const plugin of marketplace.plugins) {
      plugins.set(
        plugin.name,
        applyExtraPluginFields({
          name: plugin.name,
        }, extraByName.get(plugin.name)),
      );
    }
  }

  for (const extra of extras.plugins) {
    if (!extraAppliesTo(extra, "codex") || !extra.codex?.marketplace) continue;
    plugins.set(extra.name, {
      name: extra.name,
      description: extra.description,
      ...(extra.defaultOn !== undefined ? { defaultOn: extra.defaultOn } : {}),
      marketplace: extra.codex.marketplace,
    });
  }

  return plugins.size > 0 ? { plugins: [...plugins.values()] } : null;
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
  const expected = path.resolve(cwd, "plugins", "auriga-workflow", "skills", name);
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

// Source string Codex CLI records in `~/.codex/config.toml`
// `[marketplaces.<name>].source` after `marketplace add` succeeds. Used for
// exact-string compare against the registered marketplace's source to detect
// same-name-different-source hijack attempts before running `upgrade`.
function codexLocalMarketplaceSource(packageRoot: string): string {
  if (process.env.DEV === "1") return packageRoot;
  return "https://github.com/Ben2pc/auriga-cli.git";
}

function codexExternalMarketplaceSource(source: string): string {
  // `source` is validated by validateExtraPluginConfigs against
  // MARKETPLACE_SOURCE_RE (alphanumerics + `._/-`) — no shell metachars
  // can reach this string.
  return `https://github.com/${source}.git`;
}

function codexMarketplaceAddCommand(packageRoot: string): string {
  const source = codexLocalMarketplaceSource(packageRoot);
  // DEV-mode local paths may contain spaces; URLs need no shell quoting.
  return process.env.DEV === "1"
    ? `codex plugin marketplace add ${shellQuote(source)}`
    : `codex plugin marketplace add ${source}`;
}

function codexExternalMarketplaceAddCommand(source: string): string {
  return `codex plugin marketplace add ${codexExternalMarketplaceSource(source)}`;
}

function codexMarketplaceUpgradeCommand(marketplaceName: string): string {
  return `codex plugin marketplace upgrade ${shellQuote(marketplaceName)}`;
}

// Capability probe for the native `codex plugin add` command. Older Codex
// versions expose `codex plugin marketplace` but not `add`; probing the
// subcommand's `--help` is version-number-agnostic — it needs no knowledge
// of which Codex release introduced `add`, so it can't rot the way a
// hardcoded minimum-version compare would. `--help` prints and exits 0
// when the subcommand exists, and exits non-zero (throwing here) when it
// doesn't.
function codexSupportsPluginAdd(): boolean {
  try {
    exec("codex plugin add --help");
    return true;
  } catch {
    return false;
  }
}

// `--enable plugins` turns on the global Codex plugins feature; `--enable
// plugin_hooks` turns on the global plugin-hooks feature. Both are plain
// Codex feature toggles (`-c features.<name>=true`), not per-plugin state —
// `plugin_hooks` is appended for first-party plugins, which ship hooks, and
// is harmless for any that don't (the feature simply has no hooks to run).
// We do not inspect plugin payload to decide this: Codex owns plugin
// content via `codex plugin add`, and the published CLI never fetches the
// payload anyway. The plugin key (`<name>@<marketplace>`) is validated
// upstream (PLUGIN_NAME_RE / MARKETPLACE_NAME_RE), so no shell
// metacharacter can reach this interpolated command.
function codexPluginAddCommand(pluginKey: string, hasHooks: boolean): string {
  const enable = hasHooks
    ? "--enable plugins --enable plugin_hooks"
    : "--enable plugins";
  return `codex plugin add ${pluginKey} ${enable}`;
}

function commandErrorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts = [error.message];
  const withOutput = error as Error & { stdout?: unknown; stderr?: unknown };
  if (withOutput.stdout) parts.push(String(withOutput.stdout));
  if (withOutput.stderr) parts.push(String(withOutput.stderr));
  return parts.join("\n");
}

// Codex CLI records every added marketplace as `[marketplaces.<name>]` in
// `~/.codex/config.toml` with a `source` field. Returns that stored source
// for an exact-string compare against the source we would `add`, or null
// when the marketplace isn't registered or the entry is malformed.
//
// Why config.toml is the authoritative signal: Codex's `add` command is
// silently idempotent for an already-added marketplace (exit 0, prints to
// stdout, no error), so we can't detect already-added by catching an
// `add` failure. The stored source also lets us guard against same-name
// hijack — a fork registered under our marketplace name would be invisible
// to a presence-only check.
function readCodexMarketplaceSource(marketplaceName: string): string | null {
  const configPath = path.join(codexHome(), "config.toml");
  if (!fs.existsSync(configPath)) return null;
  try {
    const parsed = parseToml(fs.readFileSync(configPath, "utf-8")) as TomlTable;
    const marketplaces = parsed.marketplaces;
    if (typeof marketplaces !== "object" || marketplaces === null || Array.isArray(marketplaces)) {
      return null;
    }
    const entry = (marketplaces as Record<string, unknown>)[marketplaceName];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const source = (entry as Record<string, unknown>).source;
    return typeof source === "string" ? source : null;
  } catch {
    return null;
  }
}

function isCodexMarketplaceDifferentSource(error: unknown): boolean {
  return /already added from a different source/i.test(commandErrorText(error));
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
      throw new Error(`Codex plugin ${p.name} is selected but not present in marketplace.json`);
    }
    return plugin;
  });
}

async function addCodexMarketplaceWithRetry(
  marketplaceName: string,
  addCommand: string,
  expectedSource: string,
  opts: InstallOpts,
  marketplaceExecOpts: { inherit: true } | undefined,
  failures: string[],
): Promise<void> {
  const registeredSource = readCodexMarketplaceSource(marketplaceName);
  if (registeredSource !== null) {
    if (registeredSource !== expectedSource) {
      // Supply-chain guard: a same-name marketplace pointing at a different
      // source (e.g. a fork URL) must not be silently `upgrade`d — its
      // content would be cached under our name and consumed downstream.
      const msg = `Codex marketplace ${marketplaceName} is already added from a different source`;
      log.error(
        `${msg}\n  registered: ${registeredSource}\n  expected:   ${expectedSource}`,
      );
      failures.push(msg);
      return;
    }
    try {
      exec(codexMarketplaceUpgradeCommand(marketplaceName), marketplaceExecOpts);
      log.ok(`Codex marketplace ${marketplaceName} upgraded`);
    } catch (e) {
      // Surface the underlying upgrade error so a 6-month-out reader
      // can tell apart ENOENT / network / auth / git failures.
      log.error(
        `Failed to upgrade Codex marketplace: ${marketplaceName}\n${commandErrorText(e)}`,
      );
      failures.push(`codex marketplace ${marketplaceName}`);
    }
    return;
  }
  try {
    exec(addCommand, marketplaceExecOpts);
    log.ok(`Codex marketplace ${marketplaceName} added`);
  } catch (e) {
    if (isCodexMarketplaceDifferentSource(e)) {
      // Defense-in-depth: config.toml didn't claim the name but Codex CLI
      // refused with "different source" — rare divergence between Codex
      // internal state and config.toml.
      const msg = `Codex marketplace ${marketplaceName} is already added from a different source`;
      log.error(`${msg}\n${commandErrorText(e)}`);
      failures.push(msg);
      return;
    }
    // Surface the add error rather than masking ENOENT / network / auth.
    log.error(
      `Failed to add Codex marketplace: ${marketplaceName}\n${commandErrorText(e)}`,
    );
    failures.push(`codex marketplace ${marketplaceName}`);
  }
}

type ExternalSelection = CodexInstallPlugin & { marketplace: MarketplaceRef };

interface CodexPluginAdd {
  // `<name>@<marketplace>` selector passed to `codex plugin add`.
  key: string;
  // Plugin name, for post-install migration bookkeeping.
  name: string;
  // Whether to pass `--enable plugin_hooks` (a global Codex feature toggle).
  hasHooks: boolean;
}

// Builds the `codex plugin add` work list: one entry per selected plugin.
// Local (first-party) plugins always enable `plugin_hooks` — they ship
// hooks, and the flag is a harmless global toggle for any that don't. We
// deliberately do not inspect plugin payload to decide this: Codex owns
// plugin content via `codex plugin add`, and the published CLI never
// fetches the payload. External plugins emit a key straight from
// extra_plugin_configs.json (Codex CLI fetches the upstream manifest
// itself) and never set `hasHooks` — acceptable while no external plugin
// ships hooks; once one does, add an explicit flag to the extra config entry.
function composeCodexPluginAdds(
  localMarketplace: CodexMarketplace | null,
  selectedMarketplacePlugins: CodexMarketplacePlugin[],
  externalSelected: ExternalSelection[],
): CodexPluginAdd[] {
  const adds: CodexPluginAdd[] = [];
  if (localMarketplace) {
    for (const plugin of selectedMarketplacePlugins) {
      adds.push({
        key: `${plugin.name}@${localMarketplace.name}`,
        name: plugin.name,
        hasHooks: true,
      });
    }
  }
  for (const p of externalSelected) {
    adds.push({
      key: `${p.name}@${p.marketplace.name}`,
      name: p.name,
      hasHooks: false,
    });
  }
  return adds;
}

async function installCodexPlugins(
  packageRoot: string,
  opts: InstallOpts,
): Promise<void> {
  const installConfig = loadCodexInstallConfig(packageRoot);
  if (!installConfig) {
    const msg = "No Codex plugins found in .agents/plugins/marketplace.json or extra_plugin_configs.json";
    if (!opts.interactive) throw new Error(msg);
    log.warn(msg);
    return;
  }

  // `excludePlugins` (set by the TUI's「其他插件」item) keeps preset-owned
  // plugins out of the offered set.
  const offered = excludeByName(installConfig.plugins, opts.excludePlugins);
  const selected = opts.interactive
    ? await withEsc(checkbox({
      message: "Select Codex plugins to install:",
      choices: offered.map((p) => ({
        name: p.description ? `${p.name} — ${p.description}` : p.name,
        value: p,
        checked: p.defaultOn !== false,
      })),
    }))
    : resolveCodexPluginSelection(offered, opts.selected);

  if (selected.length === 0) {
    log.skip("No Codex plugins selected");
    return;
  }

  // Version gate: native `codex plugin add` materializes the plugin cache
  // and writes the enable config itself. Without it there is no supported
  // install path — fail fast with an actionable upgrade hint rather than
  // falling back to a hand-rolled cache/config mechanism. Under `--agent
  // both` this throw is caught by installPlugins' aggregator, so the
  // Claude-side install still completes (the Codex side is recorded as a
  // failure).
  if (!codexSupportsPluginAdd()) {
    const msg = "Codex CLI does not support `codex plugin add` — upgrade the Codex CLI and retry";
    if (!opts.interactive) throw new Error(msg);
    log.error(msg);
    return;
  }

  // Local plugins are described by this repo's .agents/plugins/marketplace.json.
  // External plugins come from extra_plugin_configs.json and are resolved by
  // Codex CLI itself when their marketplace is added — we only need to
  // register that marketplace and emit the right `<name>@<marketplace>` key.
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
      codexLocalMarketplaceSource(packageRoot),
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
      codexExternalMarketplaceSource(mp.source),
      opts,
      marketplaceExecOpts,
      failures,
    );
  }

  if (failures.length === 0) {
    // The plugin payload is materialized by `codex plugin add` from the
    // marketplace snapshot registered above — no manual cache copy, and no
    // local manifest inspection. A plugin missing from the snapshot surfaces
    // as a `codex plugin add` failure, already caught and aggregated below.
    const selectedMarketplacePlugins = localMarketplace
      ? resolveSelectedCodexMarketplacePlugins(localMarketplace, localSelected)
      : [];
    const pluginAdds = composeCodexPluginAdds(
      localMarketplace,
      selectedMarketplacePlugins,
      externalSelected,
    );
    for (const entry of pluginAdds) {
      try {
        exec(codexPluginAddCommand(entry.key, entry.hasHooks), marketplaceExecOpts);
        log.ok(`Codex plugin ${entry.key} added`);
        runPostInstallMigration(entry.name, opts, ["codex"]);
      } catch (e) {
        log.error(`Failed to add Codex plugin ${entry.key}\n${commandErrorText(e)}`);
        failures.push(`codex plugin ${entry.key}`);
      }
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
  let config: PluginsConfig | null = loadClaudePluginsConfig(packageRoot);
  if (!config) {
    log.warn("No Claude plugins found in .claude-plugin/marketplace.json or extra_plugin_configs.json");
    if (agent === "both") failures.push("Claude Code plugins config missing");
    else return;
  } else {
    if (config.plugins.length === 0) {
      log.warn("No Claude plugins defined");
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
    // `excludePlugins` (set by the TUI's「其他插件」item) keeps
    // preset-owned plugins out of the offered set.
    config = { ...config, plugins: excludeByName(config.plugins, opts.excludePlugins) };
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
 * Uninstall a single plugin.
 *
 *   Claude side: shells out to `claude plugins uninstall <id>` (the
 *     canonical CLI path). Errors are propagated — the CLI sometimes
 *     surfaces nuanced failure modes (marketplace gone, network) that
 *     the caller needs to see verbatim.
 *
 *   Codex side: shells out to `codex plugin remove <id>`, which deletes
 *     the plugin from Codex's local config and cache. We deliberately do
 *     NOT remove the marketplace itself — a single marketplace may host
 *     multiple plugins, and tearing it down because one plugin left would
 *     break the others. The user can `codex plugin marketplace remove`
 *     separately when they want. Errors are propagated like the Claude
 *     side; idempotency (removing an already-absent plugin) is the Codex
 *     CLI's responsibility.
 *
 * `parsePluginId` validates the id shape — and rejects shell
 * metacharacters in either segment — before any command runs, so a
 * malformed id throws cleanly with no side effects and retries are safe.
 */
export async function uninstallPlugin(
  id: string,
  agent: "claude" | "codex",
  opts: { cwd: string; onLog?: (line: string) => void },
): Promise<void> {
  parsePluginId(id);
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

  // Codex path: `codex plugin remove` deletes the plugin from Codex's
  // local config and cache. `id` was validated above, so it carries no
  // shell metacharacter.
  exec(`codex plugin remove ${id}`, { cwd: opts.cwd, inherit: true });
  log.ok(`${id} removed from Codex`);
  emit(`removed ${id} from Codex`);
}
