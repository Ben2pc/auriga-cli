// Shared API types between server (src/server.ts) and the Web UI frontend
// (ui/). All /api/* endpoints carry token + Origin auth. See spec
// docs/architecture/web-ui.md §6.2 for the contract these types encode.

export type ItemStatus = "installed" | "update-available" | "not-installed";

export interface StateReport {
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

export interface PluginState {
  id: string;
  description: string;
  status: ItemStatus;
  agent: "claude" | "codex";
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

export interface ApplyItemRef {
  category: ApplyCategory;
  name: string;
  action: ApplyAction;
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
