// Shared API types between server (src/server.ts) and the Web UI frontend
// (ui/). All /api/* endpoints carry token + Origin auth. See spec
// docs/architecture/web-ui.md §6.2 for the contract these types encode.

export type ItemStatus = "installed" | "update-available" | "not-installed";

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
  hooks: HookState[];
  warnings: StateWarning[];
}

export interface WorkflowState {
  status: ItemStatus;
  currentVersion?: string;
  expectedVersion: string;
}

export interface SkillState {
  name: string;
  description: string;
  status: ItemStatus;
  isWorkflow: boolean;
  currentHash?: string;
  expectedHash: string;
}

export type ApplyAgent = "claude" | "codex";

export interface PluginState {
  id: string;
  description: string;
  status: ItemStatus;
  /** Which Agent runtimes this plugin can install into. Most plugins target
   *  a single agent; dual-Agent plugins (e.g. auriga-go) have both. When
   *  `agents.length === 2` the UI shows a BOTH badge and Apply installs to
   *  each agent in turn. Status is aggregated across all targeted agents:
   *  `installed` ⇔ all agents installed; `not-installed` ⇔ all not-installed;
   *  any partial state (one side installed, other not) → `update-available`
   *  so a single Apply backfills the missing side. */
  agents: ApplyAgent[];
  currentVersion?: string;
  expectedVersion?: string;
  versionSource: "upstream-live" | "catalog";
}

export interface HookState {
  name: string;
  description: string;
  status: ItemStatus;
  currentHash?: string;
  expectedHash: string;
}

export interface StateWarning {
  code: "claude-cli-missing" | "codex-cli-missing" | "marketplace-offline";
  message: string;
}

export type ApplyCategory =
  | "workflow"
  | "skill"
  | "recommended-skill"
  | "plugin"
  | "hook";

export type ApplyAction = "install" | "update" | "uninstall";

/**
 * Installer scope. Carried per-item so the Web UI can mix scopes within a
 * single apply batch.
 *
 * - workflow: no scope; field MUST be omitted.
 * - skill / recommended-skill / plugin: "project" | "user". Default project.
 * - hook: "project" | "user" for v0.1 (project-local deferred to v0.2).
 */
export type ApplyScope = "project" | "user";

/**
 * Workflow CLAUDE.md language variant.
 *
 * - "en":    English CLAUDE.md (the default).
 * - "zh-CN": Simplified Chinese CLAUDE.md (the localized variant).
 *
 * Only meaningful for `category === "workflow"`; rejected for other
 * categories so the API surface stays explicit.
 */
export type ApplyLang = "en" | "zh-CN";

export interface ApplyItemRef {
  category: ApplyCategory;
  name: string;
  action: ApplyAction;
  /** Installer scope. Omitted = "project" (back-compat default). The server
   *  rejects this field for category="workflow" because workflow has no
   *  scope concept (it's a single file at the project root). */
  scope?: ApplyScope;
  /** Workflow CLAUDE.md language variant. Omitted = "en" (back-compat
   *  default). The server rejects this field for any non-workflow
   *  category. */
  lang?: ApplyLang;
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
