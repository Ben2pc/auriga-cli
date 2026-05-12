// scanState — read the user's project + (optionally) live CLIs to produce
// a tri-state report per category. Pure-ish: all external I/O is either
// injected via `ScanOptions` (for tests) or done through the default
// filesystem / child-process implementations declared at the bottom of
// this file. See docs/architecture/web-ui.md §6.3 + §10.4 for the judgment rules
// and tests/state.test.ts for the full behavioral contract.

import { createHash } from "node:crypto";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(execCallback);
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parse as parseToml } from "smol-toml";

import type {
  HookState,
  PluginState,
  SkillState,
  StateReport,
  StateWarning,
  WorkflowState,
} from "./api-types.js";

export interface Catalog {
  workflowVersion: string;
  skills: Record<string, { description: string; expectedHash: string; isWorkflow: boolean }>;
  recommendedSkills: Record<string, { description: string; expectedHash: string }>;
  plugins: Record<
    string,
    {
      description: string;
      agent: "claude" | "codex";
      expectedVersion?: string;
    }
  >;
  hooks: Record<string, { description: string; expectedHash: string }>;
}

export interface ScanOptions {
  execPluginList?: () => Promise<{ installed: any[]; available: any[] }>;
  readCodexConfig?: () => Promise<string | null>;
  readCodexPluginsDir?: () => Promise<Map<string, string>>;
}

// ---- IMPLEMENTATION GOES BELOW ----

export async function scanState(
  projectRoot: string,
  catalog: Catalog,
  opts: ScanOptions = {},
): Promise<StateReport> {
  const warnings: StateWarning[] = [];

  const workflow = scanWorkflow(projectRoot, catalog);
  const lock = readSkillsLock(projectRoot);
  const skills = scanSkills(catalog.skills, lock, /* isWorkflowDefault */ undefined);
  const recommendedSkills = scanRecommendedSkills(catalog.recommendedSkills, lock);
  const hooks = scanHooks(projectRoot, catalog.hooks);

  const claudePluginEntries = filterPluginsByAgent(catalog.plugins, "claude");
  const codexPluginEntries = filterPluginsByAgent(catalog.plugins, "codex");

  const claudePlugins = await scanClaudePlugins(
    claudePluginEntries,
    opts.execPluginList,
    warnings,
  );
  const codexPlugins = await scanCodexPlugins(
    codexPluginEntries,
    opts.readCodexConfig ?? defaultReadCodexConfig,
    opts.readCodexPluginsDir ?? defaultReadCodexPluginsDir,
    warnings,
  );

  return {
    workflow,
    skills,
    recommendedSkills,
    plugins: [...claudePlugins, ...codexPlugins],
    hooks,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

const WORKFLOW_HEADER_RE = /^#\s+auriga\s+Workflow\s*\(v(\d+\.\d+\.\d+)\)/;

function scanWorkflow(projectRoot: string, catalog: Catalog): WorkflowState {
  const expectedVersion = catalog.workflowVersion;
  const claudeMdPath = path.join(projectRoot, "CLAUDE.md");
  let content: string;
  try {
    content = fs.readFileSync(claudeMdPath, "utf8");
  } catch {
    return { status: "not-installed", expectedVersion };
  }
  // Match the canonical header anywhere in the first few lines; the spec
  // and tests put it on the first line, but tolerate leading blank lines /
  // BOM by scanning every line until we either find a match or run out.
  for (const line of content.split(/\r?\n/)) {
    const m = WORKFLOW_HEADER_RE.exec(line);
    if (m) {
      const currentVersion = m[1];
      const status = currentVersion === expectedVersion ? "installed" : "update-available";
      return { status, expectedVersion, currentVersion };
    }
    // Bail at the first non-blank line — the header must be a top heading.
    if (line.trim().length > 0) break;
  }
  // File exists but no parseable header → assumption #1 in state.test.ts:
  // prefer reinstall over false-positive "installed" with unknown version.
  return { status: "not-installed", expectedVersion };
}

// ---------------------------------------------------------------------------
// Skills + recommendedSkills
// ---------------------------------------------------------------------------

interface SkillsLockShape {
  skills?: Record<string, { computedHash?: string } | undefined>;
}

/** Return the parsed lockfile, or null if absent / unparseable. The "null"
 *  path is the degraded mode: skills still show up as catalog rows but their
 *  `currentHash` is undefined and they are reported as not-installed. */
function readSkillsLock(projectRoot: string): SkillsLockShape | null {
  const lockPath = path.join(projectRoot, "skills-lock.json");
  let text: string;
  try {
    text = fs.readFileSync(lockPath, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as SkillsLockShape;
    }
    return null;
  } catch {
    // Per state.test.ts "corrupt skills-lock" case: don't throw; degrade.
    return null;
  }
}

function classifySkill(
  expectedHash: string,
  lock: SkillsLockShape | null,
  name: string,
): { status: SkillState["status"]; currentHash?: string } {
  const entry = lock?.skills?.[name];
  const currentHash = entry?.computedHash;
  if (typeof currentHash !== "string" || currentHash.length === 0) {
    return { status: "not-installed" };
  }
  if (currentHash === expectedHash) {
    return { status: "installed", currentHash };
  }
  return { status: "update-available", currentHash };
}

function scanSkills(
  catalogSkills: Catalog["skills"],
  lock: SkillsLockShape | null,
  _unused: undefined,
): SkillState[] {
  const out: SkillState[] = [];
  for (const [name, entry] of Object.entries(catalogSkills)) {
    const cls = classifySkill(entry.expectedHash, lock, name);
    out.push({
      name,
      description: entry.description,
      status: cls.status,
      isWorkflow: entry.isWorkflow,
      currentHash: cls.currentHash,
      expectedHash: entry.expectedHash,
    });
  }
  return out;
}

function scanRecommendedSkills(
  catalogRec: Catalog["recommendedSkills"],
  lock: SkillsLockShape | null,
): SkillState[] {
  const out: SkillState[] = [];
  for (const [name, entry] of Object.entries(catalogRec)) {
    const cls = classifySkill(entry.expectedHash, lock, name);
    out.push({
      name,
      description: entry.description,
      status: cls.status,
      isWorkflow: false, // recommended skills are by definition opt-in utilities
      currentHash: cls.currentHash,
      expectedHash: entry.expectedHash,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plugins — Claude (live CLI query)
// ---------------------------------------------------------------------------

function filterPluginsByAgent(
  catalogPlugins: Catalog["plugins"],
  agent: "claude" | "codex",
): Array<[string, Catalog["plugins"][string]]> {
  return Object.entries(catalogPlugins).filter(([, def]) => def.agent === agent);
}

/** Normalize a version ref: "v1.2.3" → "1.2.3", "1.2.3" → "1.2.3".
 *  Anything that is not a strict semver-like triple is returned as-is so the
 *  caller can detect "this is a branch / tag, not a comparable version". */
function parseRef(ref: string | undefined | null): string | null {
  if (typeof ref !== "string" || ref.length === 0) return null;
  const m = /^v?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)$/.exec(ref);
  return m ? m[1] : null;
}

async function scanClaudePlugins(
  entries: Array<[string, Catalog["plugins"][string]]>,
  execPluginList: ScanOptions["execPluginList"],
  warnings: StateWarning[],
): Promise<PluginState[]> {
  if (entries.length === 0) return [];

  // Degraded path 1: no exec injected AND no default. We expose a default
  // implementation below that wraps `claude plugins list --available --json`,
  // but the test contract treats "execPluginList undefined" as "Claude CLI
  // missing" — we honor that by NOT silently falling back to the default
  // when the caller leaves it undefined. (server.ts will pass the default
  // explicitly when it confirms `claude` is on PATH.)
  if (!execPluginList) {
    warnings.push({
      code: "claude-cli-missing",
      message:
        "Claude CLI not available — plugin update detection disabled. Install `claude` to enable update checks.",
    });
    return entries.map(([id, def]) => degradedClaudeRow(id, def));
  }

  let payload: { installed: any[]; available: any[] };
  try {
    payload = await execPluginList();
  } catch (err) {
    warnings.push({
      code: "claude-cli-missing",
      message: `Claude CLI plugin list failed: ${(err as Error).message}`,
    });
    return entries.map(([id, def]) => degradedClaudeRow(id, def));
  }

  const installedById = new Map<string, any>();
  for (const item of payload.installed ?? []) {
    if (item && typeof item.id === "string") installedById.set(item.id, item);
  }
  const availableById = new Map<string, any>();
  for (const item of payload.available ?? []) {
    if (item && typeof item.id === "string") availableById.set(item.id, item);
  }

  const out: PluginState[] = [];
  for (const [id, def] of entries) {
    out.push(classifyClaudePlugin(id, def, installedById.get(id), availableById.get(id)));
  }
  return out;
}

function degradedClaudeRow(
  id: string,
  def: Catalog["plugins"][string],
): PluginState {
  return {
    id,
    description: def.description,
    status: "not-installed",
    agent: "claude",
    expectedVersion: def.expectedVersion,
    versionSource: "upstream-live",
  };
}

function classifyClaudePlugin(
  id: string,
  def: Catalog["plugins"][string],
  installed: any | undefined,
  available: any | undefined,
): PluginState {
  // Not installed at all — easy case.
  if (!installed || typeof installed.version !== "string") {
    return {
      id,
      description: def.description,
      status: "not-installed",
      agent: "claude",
      expectedVersion:
        typeof available?.source?.ref === "string" ? available.source.ref : def.expectedVersion,
      versionSource: "upstream-live",
    };
  }

  const installedVersion = installed.version as string;
  const ref = available?.source?.ref;
  const normalizedAvailable = parseRef(typeof ref === "string" ? ref : undefined);
  const normalizedInstalled = parseRef(installedVersion);

  // Fallback rule 1: installed version "unknown" → trust it's installed.
  // Fallback rule 2: available.ref is a branch / non-semver → trust it.
  // Fallback rule 3: available info is missing entirely → trust it (we know
  //   it's installed, we just can't say if there's a newer one).
  if (
    installedVersion === "unknown" ||
    normalizedAvailable === null ||
    !available
  ) {
    return {
      id,
      description: def.description,
      status: "installed",
      agent: "claude",
      currentVersion: installedVersion,
      expectedVersion: typeof ref === "string" ? ref : def.expectedVersion,
      versionSource: "upstream-live",
    };
  }

  // Both sides comparable.
  if (normalizedInstalled !== null && normalizedInstalled === normalizedAvailable) {
    return {
      id,
      description: def.description,
      status: "installed",
      agent: "claude",
      currentVersion: installedVersion,
      expectedVersion: typeof ref === "string" ? ref : undefined,
      versionSource: "upstream-live",
    };
  }
  return {
    id,
    description: def.description,
    status: "update-available",
    agent: "claude",
    currentVersion: installedVersion,
    expectedVersion: typeof ref === "string" ? ref : undefined,
    versionSource: "upstream-live",
  };
}

// ---------------------------------------------------------------------------
// Plugins — Codex (config.toml + cache directory)
// ---------------------------------------------------------------------------

async function scanCodexPlugins(
  entries: Array<[string, Catalog["plugins"][string]]>,
  readCodexConfig: () => Promise<string | null>,
  readCodexPluginsDir: () => Promise<Map<string, string>>,
  warnings: StateWarning[],
): Promise<PluginState[]> {
  if (entries.length === 0) return [];

  let tomlContent: string | null;
  try {
    tomlContent = await readCodexConfig();
  } catch (err) {
    warnings.push({
      code: "codex-cli-missing",
      message: `Codex config read failed: ${(err as Error).message}`,
    });
    return entries.map(([id, def]) => degradedCodexRow(id, def));
  }

  if (tomlContent === null) {
    warnings.push({
      code: "codex-cli-missing",
      message:
        "Codex config.toml not found — codex plugin state unknown. Install `codex` and run a plugin install once to initialize.",
    });
    return entries.map(([id, def]) => degradedCodexRow(id, def));
  }

  let enabledIds = new Set<string>();
  try {
    enabledIds = parseCodexEnabledPluginIds(tomlContent);
  } catch {
    // Corrupt TOML — surface a warning but keep classifying as not-installed
    // for each catalog entry rather than dropping rows.
    warnings.push({
      code: "codex-cli-missing",
      message: "Codex config.toml is unparseable — treating no plugins as installed",
    });
  }

  let fsVersions: Map<string, string>;
  try {
    fsVersions = await readCodexPluginsDir();
  } catch {
    fsVersions = new Map();
  }

  const out: PluginState[] = [];
  for (const [id, def] of entries) {
    out.push(classifyCodexPlugin(id, def, enabledIds.has(id), fsVersions.get(id)));
  }
  return out;
}

function degradedCodexRow(
  id: string,
  def: Catalog["plugins"][string],
): PluginState {
  return {
    id,
    description: def.description,
    status: "not-installed",
    agent: "codex",
    expectedVersion: def.expectedVersion,
    versionSource: "catalog",
  };
}

function classifyCodexPlugin(
  id: string,
  def: Catalog["plugins"][string],
  enabled: boolean,
  fsVersion: string | undefined,
): PluginState {
  const expectedVersion = def.expectedVersion;

  if (!enabled) {
    return {
      id,
      description: def.description,
      status: "not-installed",
      agent: "codex",
      expectedVersion,
      versionSource: "catalog",
    };
  }
  // Enabled in config but missing from fs — assumption #2 row contract:
  // row present, status is NOT "installed".
  if (!fsVersion) {
    return {
      id,
      description: def.description,
      status: "not-installed",
      agent: "codex",
      expectedVersion,
      versionSource: "catalog",
    };
  }
  // Compare fs version to catalog expectation. If catalog gives no
  // expectedVersion, trust it as installed.
  if (!expectedVersion || fsVersion === expectedVersion) {
    return {
      id,
      description: def.description,
      status: "installed",
      agent: "codex",
      currentVersion: fsVersion,
      expectedVersion,
      versionSource: "catalog",
    };
  }
  return {
    id,
    description: def.description,
    status: "update-available",
    agent: "codex",
    currentVersion: fsVersion,
    expectedVersion,
    versionSource: "catalog",
  };
}

/** Return the set of plugin ids whose `[plugins."<id>"]` table has
 *  `enabled = true` in the given TOML body. Per-plugin parse errors do not
 *  poison the batch — anything that doesn't shape-match is skipped silently. */
function parseCodexEnabledPluginIds(tomlContent: string): Set<string> {
  const parsed = parseToml(tomlContent) as Record<string, unknown>;
  const plugins = parsed.plugins;
  const ids = new Set<string>();
  if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) return ids;
  for (const [id, table] of Object.entries(plugins as Record<string, unknown>)) {
    if (table && typeof table === "object" && !Array.isArray(table)) {
      const enabled = (table as Record<string, unknown>).enabled;
      if (enabled === true) ids.add(id);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

interface HooksConfigShape {
  hooks?: Array<{ name?: string } | undefined>;
}

function readHooksConfig(projectRoot: string): {
  config: HooksConfigShape | null;
  corrupt: boolean;
} {
  const configPath = path.join(projectRoot, ".claude", "hooks", "hooks.json");
  let text: string;
  try {
    text = fs.readFileSync(configPath, "utf8");
  } catch {
    return { config: null, corrupt: false };
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { config: parsed as HooksConfigShape, corrupt: false };
    }
    return { config: null, corrupt: true };
  } catch {
    return { config: null, corrupt: true };
  }
}

function hashHookIndex(projectRoot: string, name: string): string | undefined {
  const indexPath = path.join(projectRoot, ".claude", "hooks", name, "index.mjs");
  try {
    const buf = fs.readFileSync(indexPath);
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return undefined;
  }
}

function scanHooks(projectRoot: string, catalogHooks: Catalog["hooks"]): HookState[] {
  const { config } = readHooksConfig(projectRoot);
  const registeredNames = new Set<string>();
  if (config?.hooks && Array.isArray(config.hooks)) {
    for (const entry of config.hooks) {
      if (entry && typeof entry.name === "string") registeredNames.add(entry.name);
    }
  }

  const out: HookState[] = [];
  for (const [name, def] of Object.entries(catalogHooks)) {
    if (!registeredNames.has(name)) {
      out.push({
        name,
        description: def.description,
        status: "not-installed",
        expectedHash: def.expectedHash,
      });
      continue;
    }
    const currentHash = hashHookIndex(projectRoot, name);
    if (currentHash === undefined) {
      // Registered but index.mjs missing — assumption #2: row present, not
      // "installed", currentHash undefined so the UI can prompt repair.
      out.push({
        name,
        description: def.description,
        status: "not-installed",
        expectedHash: def.expectedHash,
      });
      continue;
    }
    const status =
      currentHash === def.expectedHash ? "installed" : "update-available";
    out.push({
      name,
      description: def.description,
      status,
      currentHash,
      expectedHash: def.expectedHash,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Default external-I/O implementations (used when ScanOptions are not
// injected — server.ts wires these up in production).
// ---------------------------------------------------------------------------

/** Default: run `claude plugins list --json` and `claude plugins list
 *  --available --json`. Returns null is NOT an option here — server.ts
 *  decides whether to pass this function based on `which claude`. */
export async function defaultExecPluginList(): Promise<{
  installed: any[];
  available: any[];
}> {
  // Run both lookups in parallel via async exec so /api/state doesn't block
  // the event loop. `claude plugins list` can take several seconds on cold
  // marketplace fetches; sync exec would freeze heartbeats and other
  // concurrent /api requests.
  const [installedRes, availableRes] = await Promise.all([
    execAsync("claude plugins list --json", { encoding: "utf8" }),
    execAsync("claude plugins list --available --json", { encoding: "utf8" }),
  ]);
  const installed = parseJsonArray(installedRes.stdout);
  const available = parseJsonArray(availableRes.stdout);
  return { installed, available };
}

function parseJsonArray(text: string): any[] {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

export async function defaultReadCodexConfig(): Promise<string | null> {
  const configPath = path.join(codexHome(), "config.toml");
  try {
    return fs.readFileSync(configPath, "utf8");
  } catch {
    return null;
  }
}

/** Walk `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`, returning
 *  the highest-mtime version per `<plugin>@<marketplace>` id. The version
 *  semantics are catalog-pinned, so we surface the directory name verbatim
 *  rather than try to semver-sort. */
export async function defaultReadCodexPluginsDir(): Promise<Map<string, string>> {
  const cacheRoot = path.join(codexHome(), "plugins", "cache");
  const out = new Map<string, string>();
  let marketplaces: string[];
  try {
    marketplaces = fs.readdirSync(cacheRoot);
  } catch {
    return out;
  }
  for (const marketplace of marketplaces) {
    const marketplaceDir = path.join(cacheRoot, marketplace);
    let plugins: string[];
    try {
      plugins = fs.readdirSync(marketplaceDir);
    } catch {
      continue;
    }
    for (const plugin of plugins) {
      const pluginDir = path.join(marketplaceDir, plugin);
      let versions: string[];
      try {
        versions = fs.readdirSync(pluginDir);
      } catch {
        continue;
      }
      let best: { name: string; mtime: number } | null = null;
      for (const version of versions) {
        const versionDir = path.join(pluginDir, version);
        try {
          const stat = fs.statSync(versionDir);
          if (!stat.isDirectory()) continue;
          const mtime = stat.mtimeMs;
          if (!best || mtime > best.mtime) best = { name: version, mtime };
        } catch {
          // skip
        }
      }
      if (best) out.set(`${plugin}@${marketplace}`, best.name);
    }
  }
  return out;
}
