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
  /** Resolves plugin name → the list of agents this plugin can install
   *  into. Built at boot from the same scan catalog the /api/state route
   *  uses. dual-Agent plugins (e.g. `auriga-go`) yield `["claude","codex"]`
   *  and the handler iterates the list, installing to each agent in turn.
   *  Names not in the map default to `["claude"]` (existing CLI default). */
  pluginAgentsByName: Map<string, ("claude" | "codex")[]>;
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

  const workflow: ApplyHandler = async (
    action,
    _name,
    { onLog, lang: requestedLang },
  ) => {
    assertAction(action);
    // Per-item lang overrides the ctx default (the UI now drives this via
    // the Workflow column's EN/ZH-CN picker). Falls back to ctx lang for
    // CLI-mode callers that don't pass it.
    const installLang = requestedLang ?? lang;
    if (action === "install" || action === "update") {
      await installWorkflow(packageRoot, {
        interactive: false,
        cwd,
        lang: installLang,
      });
      onLog(`workflow installed (${installLang})`, "info");
      return;
    }
    // uninstall
    await uninstallWorkflow({
      force: true,
      cwd,
      onLog: (line) => onLog(line, "info"),
    });
  };

  // Adapter from InstallOpts.onLog (stdout|stderr) → handler's onLog
  // (info|warn|error). stderr lines surface as warnings; the SSE consumer
  // can decide whether to render them differently.
  const streamLog = (
    onLog: (line: string, level: "info" | "warn" | "error") => void,
  ) =>
    (line: string, stream: "stdout" | "stderr"): void => {
      onLog(line, stream === "stderr" ? "warn" : "info");
    };

  const skill: ApplyHandler = async (action, name, { onLog, scope }) => {
    assertAction(action);
    const installScope = scope ?? "project";
    if (action === "install" || action === "update") {
      await installSkills(packageRoot, {
        interactive: false,
        cwd,
        selected: [name],
        scope: installScope,
        onLog: streamLog(onLog),
      });
      onLog(`skill ${name} installed (${installScope})`, "info");
      return;
    }
    await uninstallSkill(name, {
      cwd,
      scope: installScope,
      onLog: (line) => onLog(line, "info"),
    });
  };

  const recommendedSkill: ApplyHandler = async (action, name, { onLog, scope }) => {
    assertAction(action);
    const installScope = scope ?? "project";
    if (action === "install" || action === "update") {
      await installRecommendedSkills(packageRoot, {
        interactive: false,
        cwd,
        selected: [name],
        scope: installScope,
        onLog: streamLog(onLog),
      });
      onLog(`recommended skill ${name} installed (${installScope})`, "info");
      return;
    }
    // Uninstall path is the same regardless of workflow vs recommended —
    // both live in skills-lock.json + .claude/skills/<name>.
    await uninstallSkill(name, {
      cwd,
      scope: installScope,
      onLog: (line) => onLog(line, "info"),
    });
  };

  const plugin: ApplyHandler = async (action, name, { onLog, scope }) => {
    assertAction(action);
    const agents = pluginAgentsByName.get(name) ?? ["claude"];
    const installScope = scope ?? "project";
    // dual-Agent plugins (length === 2) install into each agent in turn.
    // Per-agent try/catch: if Claude install fails, still try Codex so
    // partial coverage is visible to the user. Failures are aggregated
    // and thrown at the end → SSE marks the item failed but onLog
    // shows both agent outcomes.
    const failures: Array<{ agent: string; error: Error }> = [];
    for (const agent of agents) {
      try {
        if (action === "install" || action === "update") {
          await installPlugins(packageRoot, {
            interactive: false,
            cwd,
            agent,
            selected: [name],
            scope: installScope,
            onLog: streamLog(onLog),
          });
          onLog(`plugin ${name} installed (${agent}, ${installScope})`, "info");
        } else {
          await uninstallPlugin(name, agent, {
            cwd,
            onLog: (line) => onLog(`[${agent}] ${line}`, "info"),
          });
          onLog(`plugin ${name} uninstalled (${agent})`, "info");
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        failures.push({ agent, error });
        onLog(
          `plugin ${name} ${action} failed (${agent}): ${error.message}`,
          "error",
        );
      }
    }
    if (failures.length > 0) {
      const summary = failures
        .map((f) => `${f.agent}: ${f.error.message}`)
        .join("; ");
      throw new Error(`plugin ${name} ${action} failed for ${failures.length} agent(s) — ${summary}`);
    }
  };

  const hook: ApplyHandler = async (action, name, { onLog, scope }) => {
    assertAction(action);
    const installScope = scope ?? "project";
    if (action === "uninstall") {
      await uninstallHook(name, {
        cwd,
        scope: installScope,
        onLog: (line) => onLog(line, "info"),
      });
      return;
    }
    // install + update both run installHook with the requested scope. The
    // hook installer is idempotent — re-running == "update". Look up the
    // HookDef in the bundled registry; unknown name → loud throw so the
    // SSE caller surfaces it as item:done success=false.
    const config = loadHooksConfig(packageRoot);
    const hookDef = config.hooks.find((h) => h.name === name);
    if (!hookDef) {
      throw new Error(`hook not found in registry: ${name}`);
    }
    // installHook takes a wider Scope union ("project"|"user"|"project-local");
    // v0.1 only exposes "project"|"user" via the API. Cast is safe.
    await installHook(hookDef, scope ?? "project", cwd, packageRoot);
    onLog(`hook ${name} installed (${scope ?? "project"})`, "info");
  };

  return {
    workflow,
    skill,
    "recommended-skill": recommendedSkill,
    plugin,
    hook,
  };
}
