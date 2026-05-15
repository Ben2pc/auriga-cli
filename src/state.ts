// scanState — produce a presence-only install report for every category,
// reading the *actual* Claude Code install locations rather than auriga-cli's
// own dev-repo layout. The truth sources:
//
//   Workflow:  ~/.claude/CLAUDE.md                          (user scope)
//              <proj>/CLAUDE.md                             (project scope)
//   Skills:    ~/.claude/skills/<name>/SKILL.md             (user scope)
//              <proj>/.claude/skills/<name>/SKILL.md        (project scope)
//   Plugins(Claude): execPluginList(scope) + settings.json enabledPlugins
//   Plugins(Codex):  ~/.codex/config.toml + ~/.codex/plugins/cache (user only)
//   Hooks:     <scope>/.claude/settings.json `hooks` segment, matched by _marker
//
// Scanner is presence-only: states are `installed` / `not-installed` /
// `partial-install` (dual-Agent half-install). v1.19.0 dropped
// `update-available` — re-running install is the update path for every
// category; the scanner no longer compares versions or hashes.
//
// External I/O is either injected via ScanOptions (tests) or done through the
// default implementations at the bottom of the file (server.ts production
// wiring). See tests/state.test.ts for the full behavioral contract.

import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(execCallback);
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parse as parseToml } from "smol-toml";

import type {
  ApplyAgent,
  HookState,
  ItemStatus,
  PluginState,
  ScanScope,
  SkillState,
  StateReport,
  StateWarning,
  WorkflowState,
} from "./api-types.js";

export interface Catalog {
  skills: Record<string, { description: string; isWorkflow: boolean }>;
  recommendedSkills: Record<string, { description: string }>;
  plugins: Record<
    string,
    {
      description: string;
      /** Agents this plugin can install into. Length 1 or 2. */
      agents: ("claude" | "codex")[];
      /** True for plugins whose source lives in an upstream marketplace
       *  (skill-creator / claude-md-management / codex). Drives the UI's
       *  EXTERNAL badge — upgrades go through `claude plugins update`, not us.
       *  Pure UI hint since v1.19.0 (used to also gate update-available
       *  reporting; that surface was removed). */
      external?: boolean;
    }
  >;
  hooks: Record<string, { description: string }>;
}

export interface ScanOptions {
  /** Run `claude plugins list` for the given scope. The scope argument is
   *  required so server.ts can pass --user / --project through to the CLI
   *  per opts.scopes.plugins. Implementations may accept a zero-arg legacy
   *  form for back-compat but MUST honor a scope argument when given.
   *
   *  Returns just the installed records — v1.19.0 dropped the parallel
   *  `--available` fetch since the scanner no longer compares versions. */
  execPluginList?: (
    scope: ScanScope,
  ) => Promise<{ installed: any[] }>;
  readCodexConfig?: () => Promise<string | null>;
  readCodexPluginsDir?: () => Promise<Map<string, string>>;
  /** Per-category scope picker. Each field is independently routed to the
   *  right truth source. Defaults match the Web UI's per-column picker:
   *    workflow = 'project', skills = 'project',
   *    plugins  = 'user',    hooks  = 'user'. */
  scopes?: {
    workflow?: ScanScope;
    skills?: ScanScope;
    plugins?: ScanScope;
    hooks?: ScanScope;
  };
  /** Test-time HOME override. When unset the scanner reads os.homedir()
   *  (which itself consults process.env.HOME / USERPROFILE), so tests that
   *  redirect HOME via env vars also work. */
  homeDir?: string;
}

/**
 * Shorten an absolute path by replacing the user's $HOME with `~`. Avoids
 * leaking the full username in screenshots and keeps the TopBar label
 * readable. Falls back to the original path when HOME is unset or the path
 * doesn't sit under it.
 */
function homeReducedPath(p: string, home: string): string {
  if (!home) return p;
  if (p === home) return "~";
  // Use path-segment boundary so /Users/pangcheng-foo is NOT matched.
  if (p.startsWith(home + path.sep)) {
    return "~" + p.slice(home.length);
  }
  return p;
}

const DEFAULT_SCOPES: Required<NonNullable<ScanOptions["scopes"]>> = {
  workflow: "project",
  skills: "project",
  plugins: "user",
  hooks: "user",
};

export async function scanState(
  projectRoot: string,
  catalog: Catalog,
  opts: ScanOptions = {},
): Promise<StateReport> {
  const warnings: StateWarning[] = [];
  const home = opts.homeDir ?? os.homedir();
  const scopes = { ...DEFAULT_SCOPES, ...(opts.scopes ?? {}) };

  const workflow = scanWorkflow(scopes.workflow, projectRoot, home, warnings);
  const skills = scanSkills(
    scopes.skills,
    projectRoot,
    home,
    catalog.skills,
    /* recommended */ false,
    warnings,
  );
  const recommendedSkills = scanRecommendedSkills(
    scopes.skills,
    projectRoot,
    home,
    catalog.recommendedSkills,
    warnings,
  );
  const hooks = scanHooks(scopes.hooks, projectRoot, home, catalog.hooks, warnings);

  const claudePluginEntries = filterPluginsByAgent(catalog.plugins, "claude");
  const codexPluginEntries = filterPluginsByAgent(catalog.plugins, "codex");

  const claudePlugins = await scanClaudePlugins(
    scopes.plugins,
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

  // Aggregate `claude-code-not-installed`: emit ONCE if neither ~/.claude/
  // nor <proj>/.claude/ exists, regardless of how many user-scope categories
  // were scanned. We check after the per-category scans so we can detect the
  // condition just once at the end.
  if (!dirExists(path.join(home, ".claude")) && !dirExists(path.join(projectRoot, ".claude"))) {
    if (!warnings.some((w) => w.code === "claude-code-not-installed")) {
      warnings.push({
        code: "claude-code-not-installed",
        message:
          "No Claude Code install detected (~/.claude/ and <project>/.claude/ both absent). Install Claude Code first.",
      });
    }
  }

  return {
    cwd: homeReducedPath(projectRoot, home),
    workflow,
    skills,
    recommendedSkills,
    plugins: mergePluginsById([...claudePlugins, ...codexPlugins]),
    hooks,
    warnings,
  };
}

function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Dedupe plugins by `id`, merging dual-Agent records into a single
 * multi-agent row. Aggregation rules:
 *
 *   agents:  union of all agent arrays for this id (claude before codex).
 *   status:  installed       ⇔ every agent's record is installed
 *            not-installed   ⇔ every agent's record is not-installed
 *            otherwise       → partial-install (some agents have it, some
 *                              don't). One Apply backfills all gaps because
 *                              the handler iterates `agents`.
 *
 * The description field comes from the first record we see (catalog-
 * driven; both sides report the same value today).
 */
interface PerAgentRecord {
  agent: ApplyAgent;
  status: ItemStatus;
}

export function mergePluginsById(records: PluginState[]): PluginState[] {
  const byId = new Map<string, PluginState>();
  const perAgentByIdEntries = new Map<string, PerAgentRecord[]>();
  for (const rec of records) {
    // Pre-merge records are per-agent: their `agents[]` array contains the
    // single Agent this row was scanned for. The merge step below unions
    // those into the final dual-Agent record.
    const recAgent = rec.agents[0];
    const perAgentEntry: PerAgentRecord | null = recAgent
      ? { agent: recAgent, status: rec.status }
      : null;
    const existing = byId.get(rec.id);
    if (!existing) {
      byId.set(rec.id, { ...rec });
      perAgentByIdEntries.set(rec.id, perAgentEntry ? [perAgentEntry] : []);
      continue;
    }
    const seen = new Set(existing.agents);
    for (const a of rec.agents) {
      if (!seen.has(a)) {
        existing.agents = [...existing.agents, a];
        seen.add(a);
      }
    }
    if (perAgentEntry) {
      perAgentByIdEntries.get(rec.id)!.push(perAgentEntry);
    }
  }
  for (const [id, perAgent] of perAgentByIdEntries) {
    const rec = byId.get(id);
    if (!rec) continue;
    const aggregated = aggregateStatus(perAgent);
    rec.status = aggregated.status;
    if (aggregated.missingAgents && aggregated.missingAgents.length > 0) {
      rec.missingAgents = aggregated.missingAgents;
    } else {
      delete rec.missingAgents;
    }
  }
  return Array.from(byId.values());
}

function aggregateStatus(
  records: Array<{ agent: ApplyAgent; status: ItemStatus }>,
): { status: ItemStatus; missingAgents?: ApplyAgent[] } {
  if (records.length === 0) return { status: "not-installed" };
  if (records.every((r) => r.status === "installed")) return { status: "installed" };
  if (records.every((r) => r.status === "not-installed")) return { status: "not-installed" };
  // Mixed: dual-Agent plugin with some agents installed and some not.
  // User-facing action is "install on the missing side".
  const missingAgents = records
    .filter((r) => r.status === "not-installed")
    .map((r) => r.agent);
  return { status: "partial-install", missingAgents };
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

const WORKFLOW_HEADER_RE = /^#\s+auriga\s+Workflow\s*\(v\d+\.\d+\.\d+\)/;

function workflowPathsForScope(scope: ScanScope, projectRoot: string, home: string): string[] {
  if (scope === "user") {
    return [path.join(home, ".claude", "CLAUDE.md")];
  }
  // Project: only `<proj>/CLAUDE.md` — the auriga workflow installer
  // (src/workflow.ts) writes here and never to `<proj>/.claude/CLAUDE.md`.
  // The old fallback collapsed onto `$HOME/.claude/CLAUDE.md` when
  // projectRoot === $HOME (user runs `web-ui` from home dir), leaking
  // user-scope content into the project-scope row.
  return [path.join(projectRoot, "CLAUDE.md")];
}

function scanWorkflow(
  scope: ScanScope,
  projectRoot: string,
  home: string,
  warnings: StateWarning[],
): WorkflowState {
  const candidates = workflowPathsForScope(scope, projectRoot, home);

  let content: string | null = null;
  for (const candidate of candidates) {
    try {
      content = fs.readFileSync(candidate, "utf8");
      break;
    } catch {
      // try next candidate
    }
  }

  if (content === null) {
    return { status: "not-installed", observedScope: scope };
  }

  // Walk the first non-blank lines looking for the auriga header. We only
  // need to know "is this our CLAUDE.md or foreign" — the actual version
  // string is unused since v1.19.0 dropped update-available status.
  for (const line of content.split(/\r?\n/)) {
    if (WORKFLOW_HEADER_RE.test(line)) {
      return { status: "installed", observedScope: scope };
    }
    if (line.trim().length > 0) break;
  }

  // CLAUDE.md exists but no recognizable auriga marker. The file is foreign
  // — not our workflow. Report `not-installed` honestly; the install path
  // (src/workflow.ts) protects user content by backing it up to
  // `CLAUDE.md.bak` (backup-once: never clobbers a prior .bak).
  warnings.push({
    code: "workflow-foreign-claudemd",
    message: `Foreign CLAUDE.md detected at the workflow path — no auriga-workflow header. Install will back up to CLAUDE.md.bak.`,
  });
  return { status: "not-installed", observedScope: scope };
}

// ---------------------------------------------------------------------------
// Skills + recommendedSkills
// ---------------------------------------------------------------------------

function skillsRoot(scope: ScanScope, projectRoot: string, home: string): string {
  if (scope === "user") return path.join(home, ".claude", "skills");
  return path.join(projectRoot, ".claude", "skills");
}

/** Classify a single skill by presence of its SKILL.md. Returns
 *  `installed` if SKILL.md is readable, `not-installed` otherwise.
 *  `malformedSeen` is mutated when a skill dir exists but SKILL.md is
 *  missing/unreadable — the caller emits ONE skill-malformed warning per
 *  scan. */
function classifySkillByFile(
  name: string,
  rootDir: string,
  malformedSeen: Set<string>,
): ItemStatus {
  const skillDir = path.join(rootDir, name);
  const skillMd = path.join(skillDir, "SKILL.md");

  try {
    fs.readFileSync(skillMd);
    return "installed";
  } catch {
    if (dirExists(skillDir)) {
      // skill dir present but SKILL.md missing → malformed; row stays
      // "installed" so the user can repair, plus a warning.
      malformedSeen.add(name);
      return "installed";
    }
    return "not-installed";
  }
}

function scanSkills(
  scope: ScanScope,
  projectRoot: string,
  home: string,
  catalogSkills: Catalog["skills"],
  _recommended: boolean,
  warnings: StateWarning[],
): SkillState[] {
  const rootDir = skillsRoot(scope, projectRoot, home);
  const malformed = new Set<string>();
  const out: SkillState[] = [];
  for (const [name, entry] of Object.entries(catalogSkills)) {
    out.push({
      name,
      description: entry.description,
      status: classifySkillByFile(name, rootDir, malformed),
      isWorkflow: entry.isWorkflow,
      observedScope: scope,
    });
  }
  if (malformed.size > 0) {
    warnings.push({
      code: "skill-malformed",
      message: `Skill directory present but SKILL.md missing or unreadable: ${[...malformed].join(", ")}`,
    });
  }
  return out;
}

function scanRecommendedSkills(
  scope: ScanScope,
  projectRoot: string,
  home: string,
  catalogRec: Catalog["recommendedSkills"],
  warnings: StateWarning[],
): SkillState[] {
  const rootDir = skillsRoot(scope, projectRoot, home);
  const malformed = new Set<string>();
  const out: SkillState[] = [];
  for (const [name, entry] of Object.entries(catalogRec)) {
    out.push({
      name,
      description: entry.description,
      status: classifySkillByFile(name, rootDir, malformed),
      isWorkflow: false,
      observedScope: scope,
    });
  }
  if (malformed.size > 0) {
    warnings.push({
      code: "skill-malformed",
      message: `Skill directory present but SKILL.md missing or unreadable: ${[...malformed].join(", ")}`,
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
  return Object.entries(catalogPlugins).filter(([, def]) =>
    def.agents.includes(agent),
  );
}

async function scanClaudePlugins(
  scope: ScanScope,
  entries: Array<[string, Catalog["plugins"][string]]>,
  execPluginList: ScanOptions["execPluginList"],
  warnings: StateWarning[],
): Promise<PluginState[]> {
  if (entries.length === 0) return [];

  // Degraded path 1: no exec injected. The default implementation runs
  // `claude plugins list`; server.ts decides whether to pass it based on
  // `which claude`. When undefined → assume `claude` is missing.
  if (!execPluginList) {
    warnings.push({
      code: "claude-cli-missing",
      message:
        "Claude CLI not available — plugin presence detection disabled. Install `claude` to enable.",
    });
    return entries.map(([id, def]) => degradedClaudeRow(id, def, scope));
  }

  let payload: { installed: any[] };
  try {
    payload = await execPluginList(scope);
  } catch (err) {
    warnings.push({
      code: "claude-cli-missing",
      message: `Claude CLI plugin list failed: ${(err as Error).message}`,
    });
    return entries.map(([id, def]) => degradedClaudeRow(id, def, scope));
  }

  // claude plugins list emits ids in `<plugin>@<marketplace>` form (e.g.
  // `auriga-workflow@auriga-cli`). The auriga-cli catalog tracks plugins by bare
  // name. Index both forms so lookups succeed regardless of which side the
  // suffix is on.
  const installedById = new Map<string, any>();
  for (const item of payload.installed ?? []) {
    if (!item || typeof item !== "object") continue;
    const key = typeof item.id === "string" ? item.id : null;
    if (!key) continue;
    installedById.set(key, item);
    const at = key.indexOf("@");
    if (at > 0) installedById.set(key.slice(0, at), item);
  }

  const out: PluginState[] = [];
  for (const [id, def] of entries) {
    out.push(classifyClaudePlugin(id, def, installedById.get(id), scope));
  }
  return out;
}

function degradedClaudeRow(
  id: string,
  def: Catalog["plugins"][string],
  scope: ScanScope,
): PluginState {
  return {
    id,
    description: def.description,
    status: "not-installed",
    agents: ["claude"],
    observedScope: scope,
    ...(def.external === true ? { external: true as const } : {}),
  };
}

function classifyClaudePlugin(
  id: string,
  def: Catalog["plugins"][string],
  installed: any | undefined,
  scope: ScanScope,
): PluginState {
  const externalFlag = def.external === true ? { external: true as const } : {};
  // Presence-only since v1.19.0: any matching installed record counts.
  // Don't require a `version` field — the field may go away in a future
  // `claude plugins list --json` shape and we no longer compare versions.
  const status: ItemStatus = installed ? "installed" : "not-installed";
  return {
    id,
    description: def.description,
    status,
    agents: ["claude"],
    observedScope: scope,
    ...externalFlag,
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

  // Mirror the Claude side: catalog tracks bare names (e.g. "auriga-workflow") but
  // ~/.codex/config.toml [plugins.*] sections and defaultReadCodexPluginsDir
  // both emit `<plugin>@<marketplace>` keys (e.g. "auriga-workflow@auriga-cli").
  // Without dual indexing every dual-Agent plugin reports `not-installed` on
  // the Codex side, which `mergePluginsById` then folds into a permanent
  // `partial-install` even when both sides are genuinely installed.
  const lookupEnabled = (catalogId: string): boolean => {
    if (enabledIds.has(catalogId)) return true;
    for (const id of enabledIds) {
      const at = id.indexOf("@");
      if (at > 0 && id.slice(0, at) === catalogId) return true;
    }
    return false;
  };
  const lookupFsVersion = (catalogId: string): string | undefined => {
    const direct = fsVersions.get(catalogId);
    if (direct) return direct;
    for (const [id, v] of fsVersions) {
      const at = id.indexOf("@");
      if (at > 0 && id.slice(0, at) === catalogId) return v;
    }
    return undefined;
  };

  const out: PluginState[] = [];
  for (const [id, def] of entries) {
    out.push(classifyCodexPlugin(id, def, lookupEnabled(id), lookupFsVersion(id)));
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
    agents: ["codex"],
    observedScope: "user",
    ...(def.external === true ? { external: true as const } : {}),
  };
}

function classifyCodexPlugin(
  id: string,
  def: Catalog["plugins"][string],
  enabled: boolean,
  fsVersion: string | undefined,
): PluginState {
  const externalFlag = def.external === true ? { external: true as const } : {};
  const status: ItemStatus = enabled && fsVersion ? "installed" : "not-installed";
  return {
    id,
    description: def.description,
    status,
    agents: ["codex"],
    observedScope: "user",
    ...externalFlag,
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
// Hooks — read from <scope>/.claude/settings.json `hooks` segment, matched by
// `_marker` sentinel against catalog hook names. Settings.json shape (Claude
// Code convention):
//
//   {
//     "hooks": {
//       "<EventName>": [
//         {
//           "matcher": "<pattern>",
//           "if": "<optional Claude-Code filter>",
//           "hooks": [
//             { "type": "command", "command": "...", "_marker": "<name>" }
//           ]
//         }
//       ]
//     }
//   }
//
// ---------------------------------------------------------------------------

function settingsPathForScope(scope: ScanScope, projectRoot: string, home: string): string {
  if (scope === "user") return path.join(home, ".claude", "settings.json");
  return path.join(projectRoot, ".claude", "settings.json");
}

/** Returns the set of `_marker` sentinel values present in the settings
 *  `hooks` segment. Malformed sub-shapes are skipped silently. v1.19.0
 *  reduced this from a full {event, matcher, if, command} record (used for
 *  drift detection) to a presence-only Set — re-install is the update
 *  path now, so the scanner doesn't need to compare entry shapes. */
function indexSettingsMarkers(settings: unknown): Set<string> {
  const out = new Set<string>();
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return out;
  const hooksSeg = (settings as Record<string, unknown>).hooks;
  if (!hooksSeg || typeof hooksSeg !== "object" || Array.isArray(hooksSeg)) return out;
  for (const blocks of Object.values(hooksSeg as Record<string, unknown>)) {
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (!block || typeof block !== "object" || Array.isArray(block)) continue;
      const actions = (block as Record<string, unknown>).hooks;
      if (!Array.isArray(actions)) continue;
      for (const action of actions) {
        if (!action || typeof action !== "object" || Array.isArray(action)) continue;
        const marker = (action as Record<string, unknown>)._marker;
        if (typeof marker === "string") out.add(marker);
      }
    }
  }
  return out;
}

function scanHooks(
  scope: ScanScope,
  projectRoot: string,
  home: string,
  catalogHooks: Catalog["hooks"],
  warnings: StateWarning[],
): HookState[] {
  const settingsPath = settingsPathForScope(scope, projectRoot, home);
  let settingsRaw: string | null = null;
  let settingsErr: "absent" | "unreadable" | null = null;
  try {
    settingsRaw = fs.readFileSync(settingsPath, "utf8");
  } catch (err: any) {
    if (err && err.code === "ENOENT") {
      settingsErr = "absent";
    } else {
      settingsErr = "unreadable";
    }
  }

  let parsed: unknown = null;
  if (settingsRaw !== null) {
    try {
      parsed = JSON.parse(settingsRaw);
    } catch {
      settingsErr = "unreadable";
      parsed = null;
    }
  }

  if (settingsErr === "unreadable") {
    warnings.push({
      code: "settings-unreadable",
      message: `Settings file unreadable or corrupt JSON: ${settingsPath}`,
    });
  }

  const markers = indexSettingsMarkers(parsed);
  const out: HookState[] = [];
  for (const [name, def] of Object.entries(catalogHooks)) {
    out.push({
      name,
      description: def.description,
      status: markers.has(name) ? "installed" : "not-installed",
      observedScope: scope,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Default external-I/O implementations (used when ScanOptions are not
// injected — server.ts wires these up in production).
// ---------------------------------------------------------------------------

/** Default: run `claude plugins list --json` (no scope flag — the CLI
 *  doesn't expose one), then filter the installed records to the requested
 *  scope (and current projectRoot for project-scope) client-side. Server.ts
 *  decides whether to pass this function based on `which claude`.
 *
 *  v1.19.0 dropped the parallel `--available` fetch — the scanner no longer
 *  compares versions, so there's no use for the upstream-live ref. */
export async function defaultExecPluginList(
  scope: ScanScope = "user",
  projectRoot?: string,
): Promise<{ installed: any[] }> {
  // Async exec so /api/state doesn't block the event loop. `claude plugins
  // list` can take several seconds on cold marketplace fetches; sync exec
  // would freeze heartbeats and other concurrent /api requests. Note:
  // `claude plugins list` does NOT support `--user` / `--project`; each
  // record carries its own `scope` field which we filter on below.
  const { stdout } = await execAsync(`claude plugins list --json`, { encoding: "utf8" });
  const allInstalled = parseJsonArray(stdout);
  const installed = allInstalled.filter((rec) => {
    if (!rec || typeof rec !== "object") return false;
    if (rec.scope !== scope) return false;
    // Project-scope records may match multiple projects (`projectPath`
    // differs). If projectRoot was provided, narrow to records bound to
    // the current cwd. When omitted, fall back to "any project-scope
    // record" — better than dropping all project records on a malformed
    // call.
    if (scope === "project" && projectRoot && typeof rec.projectPath === "string") {
      return path.resolve(rec.projectPath) === path.resolve(projectRoot);
    }
    return true;
  });
  return { installed };
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
