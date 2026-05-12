// scanState — produce a tri-state install report (installed / update-available /
// not-installed) for every category, reading the *actual* Claude Code install
// locations rather than auriga-cli's own dev-repo layout. The truth sources
// (per docs/specs/web-ui-scanner-redesign.md):
//
//   Workflow:  ~/.claude/CLAUDE.md                          (user scope)
//              <proj>/CLAUDE.md, fallback .claude/CLAUDE.md (project scope)
//   Skills:    ~/.claude/skills/<name>/SKILL.md             (user scope)
//              <proj>/.claude/skills/<name>/SKILL.md        (project scope)
//   Plugins(Claude): execPluginList(scope) + settings.json enabledPlugins
//   Plugins(Codex):  ~/.codex/config.toml + ~/.codex/plugins/cache (user only)
//   Hooks:     <scope>/.claude/settings.json `hooks` segment, matched by _marker
//
// External I/O is either injected via ScanOptions (tests) or done through the
// default implementations at the bottom of the file (server.ts production
// wiring). See tests/state.test.ts for the full behavioral contract.

import { createHash } from "node:crypto";
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
  workflowVersion: string;
  skills: Record<string, { description: string; expectedHash: string; isWorkflow: boolean }>;
  recommendedSkills: Record<string, { description: string; expectedHash: string }>;
  plugins: Record<
    string,
    {
      description: string;
      /** Agents this plugin can install into. Length 1 or 2. */
      agents: ("claude" | "codex")[];
      expectedVersion?: string;
      /** When true, this plugin is published in an UPSTREAM marketplace
       *  (skill-creator / claude-md-management / codex), not in this repo.
       *  Classifier MUST NOT report `update-available` for external plugins —
       *  those upgrade through `claude plugins update`, not us. The UI surfaces
       *  an EXTERNAL badge so users know to defer to the upstream tool. */
      external?: boolean;
    }
  >;
  hooks: Record<
    string,
    {
      description: string;
      /** Coarse drift signal. The current production scan-catalog still
       *  populates this with sha256(index.mjs) for back-compat with the v0.x
       *  scanner that hashed the user's installed script. The new
       *  settings.json-based scanner ignores it for drift comparison unless
       *  the catalog also exposes the structured expected* fields below. */
      expectedHash: string;
      /** Settings.json event name (e.g. "PostToolUse", "Notification"). When
       *  set, the scanner flags drift if the on-disk settings entry registers
       *  under a different event. Optional; left undefined the scanner trusts
       *  whatever event the marker was found under. */
      expectedEvent?: string;
      /** Settings.json `matcher` field (e.g. "Write|Edit" for PostToolUse).
       *  Empty string means "no matcher" (e.g. Notification hooks). When set,
       *  the scanner flags drift if the on-disk value differs. */
      expectedMatcher?: string;
      /** Settings.json `if` field (Claude-Code-specific filter expression).
       *  Same drift semantics as expectedMatcher. */
      expectedIf?: string;
    }
  >;
}

/** Wildcard sentinel for the catalog hook `expectedHash` field. A value
 *  equal to this string (or the empty string) is treated as "no drift
 *  expectation, trust marker presence" — useful when the catalog hasn't yet
 *  been populated with a real settings-entry signature. The test suite uses
 *  this sentinel explicitly (see tests/state.test.ts assumption A7). */
const WILDCARD_EXPECTED_HASH = "any";

export interface ScanOptions {
  /** Run `claude plugins list` for the given scope. The scope argument is
   *  required so server.ts can pass --user / --project through to the CLI
   *  per opts.scopes.plugins. Implementations may accept a zero-arg legacy
   *  form for back-compat but MUST honor a scope argument when given. */
  execPluginList?: (
    scope: ScanScope,
  ) => Promise<{ installed: any[]; available: any[] }>;
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

  const workflow = scanWorkflow(scopes.workflow, projectRoot, home, catalog, warnings);
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
 *   status:  installed     ⇔ every agent's record is installed
 *            not-installed ⇔ every agent's record is not-installed
 *            otherwise     → update-available (partial install or any agent
 *                            with a pending update). One Apply covers all
 *                            gaps because the handler iterates `agents`.
 *
 * Non-status fields (description, currentVersion, expectedVersion,
 * versionSource) come from the first record we see. Today both sides report
 * the same description (catalog-driven) and the same versions for any
 * registry-pinned plugin, so this is safe; if a future divergence appears
 * we'll need a deliberate merge policy.
 */
interface PerAgentRecord {
  agent: ApplyAgent;
  status: ItemStatus;
  currentVersion?: string;
}

export function mergePluginsById(records: PluginState[]): PluginState[] {
  const byId = new Map<string, PluginState>();
  // Per-agent (agent, status, version) tuples preserved across the fold so
  // the aggregation step can emit `partial-install` + `missingAgents` when
  // one side is installed and the other isn't, AND pick the *stale* side's
  // currentVersion when status === "update-available" (otherwise the merge
  // inherited Claude's version, producing the misleading `vX → vX` display
  // in the v1.18.4 verification).
  const perAgentByIdEntries = new Map<string, PerAgentRecord[]>();
  for (const rec of records) {
    // Pre-merge records are per-agent: their `agents[]` array contains the
    // single Agent this row was scanned for. The merge step below unions
    // those into the final dual-Agent record.
    const recAgent = rec.agents[0];
    const perAgentEntry: PerAgentRecord | null = recAgent
      ? { agent: recAgent, status: rec.status, currentVersion: rec.currentVersion }
      : null;
    const existing = byId.get(rec.id);
    if (!existing) {
      byId.set(rec.id, { ...rec });
      perAgentByIdEntries.set(rec.id, perAgentEntry ? [perAgentEntry] : []);
      continue;
    }
    // Union agents preserving order: existing first, then any new ones.
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
  // Fold per-agent tuples into the aggregated status, missingAgents, and
  // (when applicable) the corrected currentVersion.
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
    // When status is update-available, surface the version of the *stale*
    // agent (one whose own status was update-available). Otherwise we'd
    // keep whichever agent's version was merged first — Claude's, which
    // may already be at the expected version, producing a `vX → vX`
    // pseudo-upgrade display.
    if (rec.status === "update-available") {
      const stale = perAgent.find((r) => r.status === "update-available");
      if (stale?.currentVersion) {
        rec.currentVersion = stale.currentVersion;
      }
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
  // Mixed. If ANY agent reports not-installed, the row is partially installed
  // — the user-facing action is "install on the missing side". Surfaces as a
  // distinct status from version-drift `update-available` so the UI doesn't
  // render misleading `vX → vX` upgrades (the v1.18.4 deep-review symptom).
  const missingAgents = records
    .filter((r) => r.status === "not-installed")
    .map((r) => r.agent);
  if (missingAgents.length > 0) {
    return { status: "partial-install", missingAgents };
  }
  // Otherwise version drift on at least one targeted agent — single Apply
  // upgrades the stale side(s).
  return { status: "update-available" };
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

const WORKFLOW_HEADER_RE = /^#\s+auriga\s+Workflow\s*\(v(\d+\.\d+\.\d+)\)/;

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
  catalog: Catalog,
  warnings: StateWarning[],
): WorkflowState {
  const expectedVersion = catalog.workflowVersion;
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
    return { status: "not-installed", expectedVersion, observedScope: scope };
  }

  // Walk the first non-blank lines looking for the auriga header.
  for (const line of content.split(/\r?\n/)) {
    const m = WORKFLOW_HEADER_RE.exec(line);
    if (m) {
      const currentVersion = m[1];
      // Empty expectedVersion means scan-catalog couldn't extract the
      // shipped workflow's header (auriga-cli's own CLAUDE.md missing or
      // malformed at build time). Trust the installed version rather than
      // forcing a phantom "update-available" against the empty string.
      const status: ItemStatus =
        !expectedVersion || currentVersion === expectedVersion ? "installed" : "update-available";
      return { status, expectedVersion, currentVersion, observedScope: scope };
    }
    if (line.trim().length > 0) break;
  }

  // CLAUDE.md exists but no recognizable auriga marker. The file is foreign
  // — not our workflow. Report `not-installed` honestly; the install path
  // (src/workflow.ts) already protects user content by backing it up to
  // `CLAUDE.md.bak` before overwriting. Conflating "something exists here"
  // with "auriga workflow installed" caused the v1.18.4 verification bug
  // where running web-ui from `~` reported the user's `# Global`-headed
  // `~/.claude/CLAUDE.md` as an installed workflow.
  warnings.push({
    code: "workflow-foreign-claudemd",
    message: `Foreign CLAUDE.md detected at the workflow path — no auriga-workflow header. Install will back up to CLAUDE.md.bak.`,
  });
  return { status: "not-installed", expectedVersion, observedScope: scope };
}

// ---------------------------------------------------------------------------
// Skills + recommendedSkills
// ---------------------------------------------------------------------------

function skillsRoot(scope: ScanScope, projectRoot: string, home: string): string {
  if (scope === "user") return path.join(home, ".claude", "skills");
  return path.join(projectRoot, ".claude", "skills");
}

/** Classify a single skill by reading its SKILL.md from the scope's skills
 *  dir. Returns the status + (when readable) the on-disk content hash. The
 *  `malformedSeen` set is mutated when a skill dir exists but SKILL.md is
 *  missing/unreadable — the caller emits ONE skill-malformed warning per
 *  scan. */
function classifySkillByFile(
  name: string,
  expectedHash: string,
  rootDir: string,
  malformedSeen: Set<string>,
): { status: ItemStatus; currentHash?: string } {
  const skillDir = path.join(rootDir, name);
  const skillMd = path.join(skillDir, "SKILL.md");

  let buf: Buffer;
  try {
    buf = fs.readFileSync(skillMd);
  } catch {
    // SKILL.md unreadable. Two sub-cases:
    //   (a) skill dir also missing → simply not installed.
    //   (b) skill dir present but SKILL.md missing → malformed; row stays
    //       "installed" so the user can repair, plus a warning.
    if (dirExists(skillDir)) {
      malformedSeen.add(name);
      return { status: "installed" };
    }
    return { status: "not-installed" };
  }

  const currentHash = createHash("sha256").update(buf).digest("hex");
  if (
    expectedHash === "" ||
    expectedHash === WILDCARD_EXPECTED_HASH ||
    currentHash === expectedHash
  ) {
    return { status: "installed", currentHash };
  }
  return { status: "update-available", currentHash };
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
    const cls = classifySkillByFile(name, entry.expectedHash, rootDir, malformed);
    out.push({
      name,
      description: entry.description,
      status: cls.status,
      isWorkflow: entry.isWorkflow,
      currentHash: cls.currentHash,
      expectedHash: entry.expectedHash,
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
    const cls = classifySkillByFile(name, entry.expectedHash, rootDir, malformed);
    out.push({
      name,
      description: entry.description,
      status: cls.status,
      isWorkflow: false,
      currentHash: cls.currentHash,
      expectedHash: entry.expectedHash,
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

/** Normalize a version ref: "v1.2.3" → "1.2.3", "1.2.3" → "1.2.3".
 *  Anything that is not a strict semver-like triple is returned as-is so the
 *  caller can detect "this is a branch / tag, not a comparable version". */
function parseRef(ref: string | undefined | null): string | null {
  if (typeof ref !== "string" || ref.length === 0) return null;
  const m = /^v?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)$/.exec(ref);
  return m ? m[1] : null;
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
        "Claude CLI not available — plugin update detection disabled. Install `claude` to enable update checks.",
    });
    return entries.map(([id, def]) => degradedClaudeRow(id, def, scope));
  }

  let payload: { installed: any[]; available: any[] };
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
  // `auriga-go@auriga-cli`). The auriga-cli catalog tracks plugins by bare
  // name. Index both forms so lookups succeed regardless of which side the
  // suffix is on. Same trick for availables — note that the `--available`
  // payload uses `pluginId` rather than `id`, so accept both as the key.
  const indexBoth = (map: Map<string, any>, item: any): void => {
    if (!item || typeof item !== "object") return;
    const key =
      typeof item.id === "string"
        ? item.id
        : typeof item.pluginId === "string"
          ? item.pluginId
          : null;
    if (!key) return;
    map.set(key, item);
    const at = key.indexOf("@");
    if (at > 0) map.set(key.slice(0, at), item);
  };
  const installedById = new Map<string, any>();
  for (const item of payload.installed ?? []) indexBoth(installedById, item);
  const availableById = new Map<string, any>();
  for (const item of payload.available ?? []) indexBoth(availableById, item);

  const out: PluginState[] = [];
  for (const [id, def] of entries) {
    out.push(
      classifyClaudePlugin(id, def, installedById.get(id), availableById.get(id), scope),
    );
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
    expectedVersion: def.expectedVersion,
    versionSource: "upstream-live",
    observedScope: scope,
    ...(def.external === true ? { external: true as const } : {}),
  };
}

function classifyClaudePlugin(
  id: string,
  def: Catalog["plugins"][string],
  installed: any | undefined,
  available: any | undefined,
  scope: ScanScope,
): PluginState {
  // `external` propagates onto every return below so the UI can surface the
  // EXTERNAL badge regardless of install state.
  const externalFlag = def.external === true ? { external: true as const } : {};

  if (!installed || typeof installed.version !== "string") {
    return {
      id,
      description: def.description,
      status: "not-installed",
      agents: ["claude"],
      expectedVersion:
        typeof available?.source?.ref === "string" ? available.source.ref : def.expectedVersion,
      versionSource: "upstream-live",
      observedScope: scope,
      ...externalFlag,
    };
  }

  const installedVersion = installed.version as string;

  // External plugin short-circuit: we don't own these, so we don't claim
  // authority on "what version they should be at". `claude plugins update`
  // is the right channel — the scanner just confirms presence. Status stays
  // "installed" even if installed.version differs from any signal we have.
  // The catalog deliberately omits `expectedVersion` for externals, but we
  // double-down with this guard so a future regression that accidentally
  // populates expectedVersion still can't flip externals to update-available.
  if (def.external === true) {
    return {
      id,
      description: def.description,
      status: "installed",
      agents: ["claude"],
      currentVersion: installedVersion,
      // Don't surface any "expected" on externals — the upstream tool owns
      // the version conversation.
      versionSource: "upstream-live",
      observedScope: scope,
      ...externalFlag,
    };
  }

  const ref = available?.source?.ref;
  const normalizedAvailable = parseRef(typeof ref === "string" ? ref : undefined);
  const normalizedInstalled = parseRef(installedVersion);

  // Pick the comparison target. The marketplace-live ref wins when it's a
  // parseable semver — that's the freshest signal. Otherwise fall back to
  // the build-time-baked `def.expectedVersion` (populated from
  // plugins/<name>/.claude-plugin/plugin.json by scan-catalog for owned
  // plugins). Without the fallback, the common upgrade case is invisible:
  // `claude plugins list --available --json` excludes already-installed
  // plugins from `.available[]`, so for any plugin the user already has,
  // `ref` is undefined and the scanner can't tell whether a newer version
  // ships in the marketplace.
  const hasLiveRef = normalizedAvailable !== null && typeof ref === "string";
  const expectedRaw = hasLiveRef ? (ref as string) : def.expectedVersion;
  const expectedNormalized = hasLiveRef
    ? normalizedAvailable
    : parseRef(def.expectedVersion);
  const versionSource: "upstream-live" | "catalog" = hasLiveRef
    ? "upstream-live"
    : "catalog";

  // Fallback rules (no comparable expected version, or unknown installed):
  //   - installed version "unknown" → trust it's installed.
  //   - effective expected is null (branch ref + no baked version) → trust installed.
  if (installedVersion === "unknown" || expectedNormalized === null) {
    return {
      id,
      description: def.description,
      status: "installed",
      agents: ["claude"],
      currentVersion: installedVersion,
      expectedVersion: expectedRaw,
      versionSource,
      observedScope: scope,
      ...externalFlag,
    };
  }

  if (normalizedInstalled !== null && normalizedInstalled === expectedNormalized) {
    return {
      id,
      description: def.description,
      status: "installed",
      agents: ["claude"],
      currentVersion: installedVersion,
      expectedVersion: expectedRaw,
      versionSource,
      observedScope: scope,
      ...externalFlag,
    };
  }
  return {
    id,
    description: def.description,
    status: "update-available",
    agents: ["claude"],
    currentVersion: installedVersion,
    expectedVersion: expectedRaw,
    versionSource,
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

  // Mirror the Claude side: catalog tracks bare names (e.g. "auriga-go") but
  // ~/.codex/config.toml [plugins.*] sections and defaultReadCodexPluginsDir
  // both emit `<plugin>@<marketplace>` keys (e.g. "auriga-go@auriga-cli").
  // Without dual indexing every dual-Agent plugin reports `not-installed` on
  // the Codex side, which `mergePluginsById` then folds into a permanent
  // `update-available` even when both sides are genuinely installed.
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
    expectedVersion: def.expectedVersion,
    versionSource: "catalog",
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
  const expectedVersion = def.expectedVersion;
  const externalFlag = def.external === true ? { external: true as const } : {};

  if (!enabled) {
    return {
      id,
      description: def.description,
      status: "not-installed",
      agents: ["codex"],
      expectedVersion,
      versionSource: "catalog",
      observedScope: "user",
      ...externalFlag,
    };
  }
  if (!fsVersion) {
    return {
      id,
      description: def.description,
      status: "not-installed",
      agents: ["codex"],
      expectedVersion,
      versionSource: "catalog",
      observedScope: "user",
      ...externalFlag,
    };
  }
  // External plugin short-circuit, same rationale as classifyClaudePlugin:
  // we defer authority to `codex plugin marketplace update` and never flag
  // update-available for upstream-owned plugins.
  if (def.external === true) {
    return {
      id,
      description: def.description,
      status: "installed",
      agents: ["codex"],
      currentVersion: fsVersion,
      versionSource: "catalog",
      observedScope: "user",
      ...externalFlag,
    };
  }
  if (!expectedVersion || fsVersion === expectedVersion) {
    return {
      id,
      description: def.description,
      status: "installed",
      agents: ["codex"],
      currentVersion: fsVersion,
      expectedVersion,
      versionSource: "catalog",
      observedScope: "user",
      ...externalFlag,
    };
  }
  return {
    id,
    description: def.description,
    status: "update-available",
    agents: ["codex"],
    currentVersion: fsVersion,
    expectedVersion,
    versionSource: "catalog",
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

interface SettingsHookEntry {
  /** Top-level event name (e.g. "PostToolUse"). */
  event: string;
  /** Outer block's matcher pattern. May be undefined. */
  matcher?: string;
  /** Outer block's `if` filter. May be undefined. */
  ifExpr?: string;
  /** The inner action's command string. */
  command?: string;
}

/** Walk every settings hook action, returning a map keyed by the action's
 *  `_marker` sentinel value. Malformed sub-shapes are skipped silently. */
function indexSettingsHooksByMarker(
  settings: unknown,
): Map<string, SettingsHookEntry> {
  const out = new Map<string, SettingsHookEntry>();
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return out;
  const hooksSeg = (settings as Record<string, unknown>).hooks;
  if (!hooksSeg || typeof hooksSeg !== "object" || Array.isArray(hooksSeg)) return out;

  for (const [event, blocks] of Object.entries(hooksSeg as Record<string, unknown>)) {
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (!block || typeof block !== "object" || Array.isArray(block)) continue;
      const b = block as Record<string, unknown>;
      const matcher = typeof b.matcher === "string" ? b.matcher : undefined;
      const ifExpr = typeof b.if === "string" ? b.if : undefined;
      const actions = b.hooks;
      if (!Array.isArray(actions)) continue;
      for (const action of actions) {
        if (!action || typeof action !== "object" || Array.isArray(action)) continue;
        const a = action as Record<string, unknown>;
        const marker = typeof a._marker === "string" ? a._marker : undefined;
        if (!marker) continue;
        out.set(marker, {
          event,
          matcher,
          ifExpr,
          command: typeof a.command === "string" ? a.command : undefined,
        });
      }
    }
  }
  return out;
}

/** Compute a coarse sha256 signature over a settings hook entry's drift-
 *  relevant fields (event, matcher, if). Used to fall back to a single-
 *  field comparison when the catalog hasn't been upgraded to expose
 *  structured expectedMatcher / expectedEvent / expectedIf. */
function signatureForSettingsEntry(entry: SettingsHookEntry): string {
  const canonical = JSON.stringify({
    event: entry.event,
    matcher: entry.matcher ?? "",
    if: entry.ifExpr ?? "",
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Returns true when the catalog's expectedHash is a wildcard sentinel
 *  (empty string or the literal "any" placeholder). Wildcard means "no
 *  drift expectation for this hook — trust marker presence." */
function isWildcardExpectedHash(expectedHash: string): boolean {
  return expectedHash === "" || expectedHash === WILDCARD_EXPECTED_HASH;
}

function detectHookDrift(
  catalogEntry: Catalog["hooks"][string],
  settingsEntry: SettingsHookEntry,
): boolean {
  // Preferred drift path: structured expectations from catalog.
  if (
    typeof catalogEntry.expectedMatcher === "string" &&
    (settingsEntry.matcher ?? "") !== catalogEntry.expectedMatcher
  ) {
    return true;
  }
  if (
    typeof catalogEntry.expectedEvent === "string" &&
    settingsEntry.event !== catalogEntry.expectedEvent
  ) {
    return true;
  }
  if (
    typeof catalogEntry.expectedIf === "string" &&
    (settingsEntry.ifExpr ?? "") !== catalogEntry.expectedIf
  ) {
    return true;
  }
  // Fallback drift signal via expectedHash. When the catalog hasn't been
  // populated with structured expected* fields (yet), expectedHash doubles
  // as a coarse signature: if non-empty and non-wildcard, the implementation
  // computes its own signature over the settings entry and treats any
  // divergence as drift. Production scan-catalog.ts can populate this with
  // a real settings-entry signature; until then, an explicit non-wildcard
  // placeholder in tests (e.g. "expected-new-matcher-signature") deliberately
  // triggers drift since it can never equal a sha256 hex digest.
  if (!isWildcardExpectedHash(catalogEntry.expectedHash)) {
    const sig = signatureForSettingsEntry(settingsEntry);
    if (sig !== catalogEntry.expectedHash) return true;
  }
  return false;
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

  const byMarker = indexSettingsHooksByMarker(parsed);

  const out: HookState[] = [];
  for (const [name, def] of Object.entries(catalogHooks)) {
    const settingsEntry = byMarker.get(name);
    if (!settingsEntry) {
      out.push({
        name,
        description: def.description,
        status: "not-installed",
        expectedHash: def.expectedHash,
        observedScope: scope,
      });
      continue;
    }
    const drift = detectHookDrift(def, settingsEntry);
    out.push({
      name,
      description: def.description,
      status: drift ? "update-available" : "installed",
      // Surface a coarse current signature so the UI can show diff details
      // if it wants. The exact format is "sha256 of normalized settings
      // entry" — opaque to the UI, used only for drift detection.
      currentHash: signatureForSettingsEntry(settingsEntry),
      expectedHash: def.expectedHash,
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
 *  doesn't expose one) plus the `--available` variant, then filter the
 *  installed records to the requested scope (and current projectRoot for
 *  project-scope) client-side. Server.ts decides whether to pass this
 *  function based on `which claude`. */
export async function defaultExecPluginList(
  scope: ScanScope = "user",
  projectRoot?: string,
): Promise<{ installed: any[]; available: any[] }> {
  // Run both lookups in parallel via async exec so /api/state doesn't block
  // the event loop. `claude plugins list` can take several seconds on cold
  // marketplace fetches; sync exec would freeze heartbeats and other
  // concurrent /api requests. Note: `claude plugins list` does NOT support
  // `--user` / `--project`; each record carries its own `scope` field which
  // we filter on below.
  const [installedRes, availableRes] = await Promise.all([
    execAsync(`claude plugins list --json`, { encoding: "utf8" }),
    execAsync(`claude plugins list --available --json`, { encoding: "utf8" }),
  ]);
  const allInstalled = parseJsonArray(installedRes.stdout);
  // `claude plugins list --available --json` returns a wrapped object
  // `{ installed: [...], available: [...] }`, NOT a flat array. parseJsonArray
  // alone would return `[]` and silently lose every marketplace ref → the
  // scanner could never surface "update-available" from upstream-live data.
  // Pull `.available` out of the wrapper; tolerate the flat-array form too
  // in case Claude CLI's shape regresses.
  const available = extractAvailableArray(availableRes.stdout);
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

/** Pull the available-plugins array out of `claude plugins list --available
 *  --json`'s response. Empirically the CLI returns `{ installed, available }`;
 *  if a future version regresses to a flat array we keep working. Returns
 *  `[]` on malformed JSON. */
function extractAvailableArray(text: string): any[] {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.available)) {
      return parsed.available;
    }
    return [];
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
