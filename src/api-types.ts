// Shared API types between server (src/server.ts) and the Web UI frontend
// (ui/). All /api/* endpoints carry token + Origin auth. See spec
// docs/architecture/web-ui.md §6.2 for the contract these types encode.

export type ItemStatus =
  | "installed"
  | "not-installed"
  /** Dual-Agent plugin where some target Agents have the plugin installed
   *  and some don't (e.g. Claude side installed, Codex side missing). The
   *  user-facing action is "install on the missing side"; the missing
   *  agents are enumerated in `PluginState.missingAgents`. */
  | "partial-install";

/**
 * Per-category scan scope. Each category (workflow / skills / plugins)
 * can be independently scanned in either user scope (~/.claude/, ~/.codex/)
 * or project scope (<proj>/.claude/). The Web UI's per-column scope picker
 * carries these through the `/api/state` query so the scanner reads the
 * right truth source per category. Codex plugins are user-scope only by
 * design and ignore this field.
 */
export type ScanScope = "user" | "project";

export interface StateReport {
  /** Absolute path to the project the server was launched against. Surfaced
   *  in the UI's top bar so users know where Apply will write project-scope
   *  changes. The path may be redacted (e.g. `~/...` home expansion) but the
   *  contract is "human-readable identifier for the current cwd". */
  cwd: string;
  workflow: WorkflowState;
  skills: SkillState[];
  recommendedSkills: SkillState[];
  plugins: PluginState[];
  warnings: StateWarning[];
}

export interface WorkflowState {
  status: ItemStatus;
  /** Which scope the scanner read to produce this row. Reflects the scope
   *  scanned, not where the file was found — e.g. when scope=user and
   *  ~/.claude/CLAUDE.md is absent, observedScope is still "user". The
   *  scanner ALWAYS sets this field at runtime; it is typed optional only
   *  so the mergePluginsById regression helper (which carries over from the
   *  pre-rewrite suite without an explicit scope) continues to compile. */
  observedScope?: ScanScope;
}

export interface SkillState {
  name: string;
  description: string;
  status: ItemStatus;
  isWorkflow: boolean;
  /** Scope the scanner read to produce this row. See WorkflowState comment. */
  observedScope?: ScanScope;
}

export type ApplyAgent = "claude" | "codex";

export interface PluginState {
  id: string;
  description: string;
  status: ItemStatus;
  /** Which Agent runtimes this plugin can install into. Most plugins target
   *  a single agent; dual-Agent plugins (e.g. auriga-workflow) have both. When
   *  `agents.length === 2` the UI shows a BOTH badge and Apply installs to
   *  each agent in turn. Status is aggregated across all targeted agents:
   *  `installed` ⇔ all agents installed; `not-installed` ⇔ all not-installed;
   *  mixed → `partial-install` (some installed, some not). */
  agents: ApplyAgent[];
  /** Agents that target this plugin but don't have it installed. Populated
   *  iff `status === "partial-install"`. Drives the "Missing on Codex"
   *  UI caption + tells the user exactly which side needs backfill. */
  missingAgents?: ApplyAgent[];
  /** Scope the scanner read to produce this row. Codex plugins are always
   *  "user" (Codex has no project-scope plugin concept). See WorkflowState
   *  comment on why this is typed optional. */
  observedScope?: ScanScope;
  /** True for plugins whose source lives in an upstream marketplace, not in
   *  this repo (skill-creator / claude-md-management / codex). Pure UI hint
   *  since v1.19.0 — the EXTERNAL badge tells users upgrades go through
   *  `claude plugins update`, not via auriga-cli. */
  external?: boolean;
}

export interface StateWarning {
  code:
    | "claude-cli-missing"
    | "codex-cli-missing"
    | "marketplace-offline"
    | "claude-code-not-installed"
    | "settings-unreadable"
    | "skill-malformed"
    /** Workflow instruction file is present but has no recognizable
     *  `# auriga Workflow (vX.Y.Z)` header. The row reports `not-installed`;
     *  install keeps the existing content in the user region before writing
     *  ours. */
    | "workflow-foreign-agentsmd"
    | "workflow-foreign-claudemd";
  message: string;
}

export type ApplyCategory =
  | "workflow"
  | "skill"
  | "recommended-skill"
  | "plugin"
  /** The curated preset (workflow doc + workflow skills + auriga-workflow
   *  plugin). A single apply item drives the whole installPreset
   *  orchestration; `name` is the sentinel "preset". */
  | "preset";

export type ApplyAction = "install" | "uninstall";

/**
 * Installer scope. Carried per-item so the Web UI can mix scopes within a
 * single apply batch.
 *
 * - workflow: no scope; field MUST be omitted.
 * - skill / recommended-skill / plugin: "project" | "user". Default project.
 */
export type ApplyScope = "project" | "user";

/**
 * Workflow AGENTS.md language variant.
 *
 * - "zh-CN": Simplified Chinese workflow template (the default).
 * - "en":    English workflow template.
 *
 * Only meaningful for `category === "workflow"`; rejected for other
 * categories so the API surface stays explicit.
 */
export type ApplyLang = "en" | "zh-CN";

/**
 * Preset install runtime target — Claude Code, Codex, or both.
 *
 * Only meaningful for `category === "preset"` (the preset's UI exposes an
 * agent control); the server rejects it for every other category, where
 * the per-plugin agent is derived from the catalog rather than supplied
 * by the client.
 */
export type ApplyPresetAgent = "claude" | "codex" | "both";

export interface ApplyItemRef {
  category: ApplyCategory;
  name: string;
  action: ApplyAction;
  /** Installer scope. Omitted = "project" (back-compat default), except
   *  for category="preset" where the handler defaults it to "user". The
   *  server rejects this field for category="workflow" because workflow
   *  has no scope concept (it's a single file at the project root). */
  scope?: ApplyScope;
  /** Workflow AGENTS.md language variant. Omitted = "zh-CN"
   *  default). The server accepts this field only for category="workflow"
   *  and category="preset" (the preset installs the workflow doc). */
  lang?: ApplyLang;
  /** Preset install runtime. Omitted = "both". The server accepts this
   *  field only for category="preset". */
  agent?: ApplyPresetAgent;
}

export interface ApplyRequest {
  items: ApplyItemRef[];
}

export interface ApplyResponse {
  jobId: string;
}

export type ProgressEvent =
  | { type: "item:start"; index: number; total: number; item: ApplyItemRef }
  | {
      type: "item:log";
      index: number;
      line: string;
      level: "info" | "warn" | "error";
    }
  | { type: "item:done"; index: number; success: boolean; error?: string }
  | { type: "all-done"; success: boolean; failedCount: number };
