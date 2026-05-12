// Builds the default ApplyHandlers map that wires the Web UI's /api/apply
// route to the real installers in workflow.ts / skills.ts / plugins.ts /
// hooks.ts. Tests inject their own mock handlers; CLI mode (the `ui`
// subcommand) calls `buildDefaultApplyHandlers` at boot.
//
// Per-item dispatch is layered on top of the existing bulk installers via
// `opts.selected = [name]`. The recipe per category:
//
//   workflow:           installWorkflow(packageRoot, …) ─┐
//   workflow:           uninstallWorkflow({force:true,…})│  no name needed
//   skill:              installSkills(…, selected:[name])│
//   skill:              uninstallSkill(name, …)          │
//   recommended-skill:  installRecommendedSkills(…)      │
//   recommended-skill:  uninstallSkill(name, …)          │  same store
//   plugin:             installPlugins(…, agent, sel:[]) │  per-name
//   plugin:             uninstallPlugin(name, agent, …)  │
//   hook:               installHook(hookDef, "project",…)│  needs HookDef
//   hook:               uninstallHook(name, …)           │
//
// Spec: docs/architecture/web-ui.md §6.4 (apply execution model).

import type { ApplyAction } from "./api-types.js";
import { installHook, loadHooksConfig, uninstallHook } from "./hooks.js";
import {
  installPlugins,
  uninstallPlugin,
} from "./plugins.js";
import {
  installRecommendedSkills,
  installSkills,
  uninstallSkill,
} from "./skills.js";
import type {
  ApplyHandler,
  ApplyHandlers,
} from "./server.js";
import { installWorkflow, uninstallWorkflow } from "./workflow.js";

export interface ApplyHandlerContext {
  /** Where auriga-cli lives — source of skills-lock.json + .claude config. */
  packageRoot: string;
  /** Target project directory. Installers write here. */
  cwd: string;
  /** Resolves plugin name → "claude" | "codex" so uninstall + install know
   *  which agent's marketplace to use. Built at boot from the same scan
   *  catalog the /api/state route uses. Names not in the map default to
   *  "claude" (existing CLI default). */
  pluginAgentsByName: Map<string, "claude" | "codex">;
  /** Workflow language for install. Defaults to "en". */
  workflowLang?: string;
}

const ALL_ACTIONS: ReadonlySet<ApplyAction> = new Set<ApplyAction>([
  "install",
  "update",
  "uninstall",
]);

function assertAction(action: ApplyAction): void {
  // Defense in depth — the server validates the shape already, but the
  // adapter must not silently fall through if a new action is added later.
  if (!ALL_ACTIONS.has(action)) {
    throw new Error(`unsupported action: ${action}`);
  }
}

export function buildDefaultApplyHandlers(
  ctx: ApplyHandlerContext,
): ApplyHandlers {
  const { packageRoot, cwd, pluginAgentsByName } = ctx;
  const lang = ctx.workflowLang ?? "en";

  const workflow: ApplyHandler = async (action, _name, { onLog }) => {
    assertAction(action);
    if (action === "install" || action === "update") {
      await installWorkflow(packageRoot, { interactive: false, cwd, lang });
      onLog("workflow installed", "info");
      return;
    }
    // uninstall
    await uninstallWorkflow({
      force: true,
      cwd,
      onLog: (line) => onLog(line, "info"),
    });
  };

  const skill: ApplyHandler = async (action, name, { onLog }) => {
    assertAction(action);
    if (action === "install" || action === "update") {
      await installSkills(packageRoot, {
        interactive: false,
        cwd,
        selected: [name],
      });
      onLog(`skill ${name} installed`, "info");
      return;
    }
    await uninstallSkill(name, {
      cwd,
      onLog: (line) => onLog(line, "info"),
    });
  };

  const recommendedSkill: ApplyHandler = async (action, name, { onLog }) => {
    assertAction(action);
    if (action === "install" || action === "update") {
      await installRecommendedSkills(packageRoot, {
        interactive: false,
        cwd,
        selected: [name],
      });
      onLog(`recommended skill ${name} installed`, "info");
      return;
    }
    // Uninstall path is the same regardless of workflow vs recommended —
    // both live in skills-lock.json + .claude/skills/<name>.
    await uninstallSkill(name, {
      cwd,
      onLog: (line) => onLog(line, "info"),
    });
  };

  const plugin: ApplyHandler = async (action, name, { onLog }) => {
    assertAction(action);
    const agent = pluginAgentsByName.get(name) ?? "claude";
    if (action === "install" || action === "update") {
      await installPlugins(packageRoot, {
        interactive: false,
        cwd,
        agent,
        selected: [name],
      });
      onLog(`plugin ${name} installed (${agent})`, "info");
      return;
    }
    await uninstallPlugin(name, agent, {
      cwd,
      onLog: (line) => onLog(line, "info"),
    });
  };

  const hook: ApplyHandler = async (action, name, { onLog }) => {
    assertAction(action);
    if (action === "uninstall") {
      await uninstallHook(name, {
        cwd,
        onLog: (line) => onLog(line, "info"),
      });
      return;
    }
    // install + update both run installHook with scope=project. The hook
    // installer is idempotent — re-running == "update". Look up the
    // HookDef in the bundled registry; unknown name → loud throw so the
    // SSE caller surfaces it as item:done success=false.
    const config = loadHooksConfig(packageRoot);
    const hookDef = config.hooks.find((h) => h.name === name);
    if (!hookDef) {
      throw new Error(`hook not found in registry: ${name}`);
    }
    await installHook(hookDef, "project", cwd, packageRoot);
    onLog(`hook ${name} installed`, "info");
  };

  return {
    workflow,
    skill,
    "recommended-skill": recommendedSkill,
    plugin,
    hook,
  };
}
