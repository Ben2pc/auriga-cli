import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkbox, input, select } from "@inquirer/prompts";
import {
  exec,
  fetchExtraContentBinary,
  log,
  withEsc,
} from "./utils.js";

// --- Hook registry types ---

export interface HookDep {
  name: string;
  via: "brew";
  optional?: boolean;
}

export interface HookSettingsEvent {
  event: string;
  matcher?: string;
}

export interface HookDef {
  name: string;
  description: string;
  runtimePlatforms: string[];
  settingsEvents: HookSettingsEvent[];
  command: string;
  files: string[];
  preserveFiles?: string[];
  deps?: HookDep[];
  marker: string;
}

export interface HooksConfig {
  hooks: HookDef[];
}

// --- Claude Code settings.json shape ---

export interface SettingsHookAction {
  type: "command";
  command: string;
  _marker?: string;
}

export interface SettingsHookGroup {
  matcher?: string;
  hooks: SettingsHookAction[];
}

export interface SettingsFile {
  hooks?: Record<string, SettingsHookGroup[]>;
  [key: string]: unknown;
}

// --- Registry validation ---
// hooks.json is fetched at runtime from raw.githubusercontent.com, so any
// downstream code that interpolates registry values into shell commands or
// filesystem paths is one force-push away from RCE / arbitrary-file-write
// for every user running `npx auriga-cli`. Validate every untrusted value
// once at load time, then trust it through the rest of the install flow.

const HOOK_NAME_RE = /^[a-z][a-z0-9-]*$/;
const DEP_NAME_RE = /^[a-z0-9][a-z0-9._+-]*$/;

function isSafeRelativePath(file: unknown): boolean {
  if (typeof file !== "string" || file.length === 0) return false;
  if (file.startsWith("/") || file.startsWith("\\")) return false;
  if (file.includes("\0")) return false;
  const normalized = path.posix.normalize(file);
  if (normalized !== file) return false;
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) return false;
  return true;
}

function validateHookEntry(hook: unknown, idx: number): void {
  if (!hook || typeof hook !== "object") {
    throw new Error(`hooks.json: hooks[${idx}] is not an object`);
  }
  const h = hook as Record<string, unknown>;
  if (typeof h.name !== "string" || !HOOK_NAME_RE.test(h.name)) {
    throw new Error(
      `hooks.json: hooks[${idx}].name must match ${HOOK_NAME_RE} (got ${JSON.stringify(h.name)})`,
    );
  }
  if (!Array.isArray(h.files)) {
    throw new Error(`hooks.json: hooks[${idx}].files must be an array`);
  }
  for (const f of h.files) {
    if (!isSafeRelativePath(f)) {
      throw new Error(
        `hooks.json: hooks[${idx}].files contains unsafe path ${JSON.stringify(f)}`,
      );
    }
  }
  if (h.preserveFiles !== undefined) {
    if (!Array.isArray(h.preserveFiles)) {
      throw new Error(`hooks.json: hooks[${idx}].preserveFiles must be an array`);
    }
    for (const f of h.preserveFiles) {
      if (!isSafeRelativePath(f)) {
        throw new Error(
          `hooks.json: hooks[${idx}].preserveFiles contains unsafe path ${JSON.stringify(f)}`,
        );
      }
    }
  }
  if (h.deps !== undefined) {
    if (!Array.isArray(h.deps)) {
      throw new Error(`hooks.json: hooks[${idx}].deps must be an array`);
    }
    for (const d of h.deps) {
      if (!d || typeof d !== "object") {
        throw new Error(`hooks.json: hooks[${idx}].deps entry is not an object`);
      }
      const dn = (d as Record<string, unknown>).name;
      if (typeof dn !== "string" || !DEP_NAME_RE.test(dn)) {
        throw new Error(
          `hooks.json: hooks[${idx}].deps name must match ${DEP_NAME_RE} (got ${JSON.stringify(dn)})`,
        );
      }
    }
  }
  if (!Array.isArray(h.runtimePlatforms)) {
    throw new Error(`hooks.json: hooks[${idx}].runtimePlatforms must be an array`);
  }
  if (!Array.isArray(h.settingsEvents)) {
    throw new Error(`hooks.json: hooks[${idx}].settingsEvents must be an array`);
  }
  if (typeof h.command !== "string" || h.command.length === 0) {
    throw new Error(`hooks.json: hooks[${idx}].command must be a non-empty string`);
  }
  if (typeof h.marker !== "string" || h.marker.length === 0) {
    throw new Error(`hooks.json: hooks[${idx}].marker must be a non-empty string`);
  }
}

/**
 * Pure, idempotent settings merge. Deep-clones input, dedupes by sentinel
 * `_marker` (NOT command-string equality) so re-running across path drift
 * never produces duplicate hook entries. The marker is the only identifier
 * the future uninstall command will use, so it must round-trip through
 * Claude Code's settings reader unchanged (Claude Code ignores unknown
 * fields on hook actions, which is how we get away with it).
 */
export function addHookToSettings(
  settings: SettingsFile,
  event: string,
  command: string,
  marker: string,
): { settings: SettingsFile; mutated: boolean } {
  const next: SettingsFile = JSON.parse(JSON.stringify(settings ?? {}));
  if (!next.hooks || typeof next.hooks !== "object") next.hooks = {};
  const list: SettingsHookGroup[] = Array.isArray(next.hooks[event])
    ? (next.hooks[event] as SettingsHookGroup[])
    : [];

  for (const group of list) {
    if (!group?.hooks || !Array.isArray(group.hooks)) continue;
    for (const action of group.hooks) {
      if (action && action._marker === marker) {
        next.hooks[event] = list;
        return { settings: next, mutated: false };
      }
    }
  }

  list.push({
    hooks: [{ type: "command", command, _marker: marker }],
  });
  next.hooks[event] = list;
  return { settings: next, mutated: true };
}

type Scope = "project-local" | "project" | "user";

interface ScopeResolved {
  scope: Scope;
  hookDir: string;
  settingsPath: string;
  commandHookDir: string;
}

const settingsBackedUp = new Set<string>();

function resolveScope(scope: Scope, projectBase: string, hookName: string): ScopeResolved {
  if (scope === "user") {
    const home = os.homedir();
    const dir = path.join(home, ".claude", "hooks", hookName);
    return {
      scope,
      hookDir: dir,
      settingsPath: path.join(home, ".claude", "settings.json"),
      commandHookDir: dir,
    };
  }
  const projectClaude = path.join(projectBase, ".claude");
  return {
    scope,
    hookDir: path.join(projectClaude, "hooks", hookName),
    settingsPath:
      scope === "project-local"
        ? path.join(projectClaude, "settings.local.json")
        : path.join(projectClaude, "settings.json"),
    commandHookDir: `$CLAUDE_PROJECT_DIR/.claude/hooks/${hookName}`,
  };
}

function scopeChoices(): { name: string; value: Scope }[] {
  return [
    {
      name: "Project local — files in ./.claude/hooks/, settings in ./.claude/settings.local.json (per-developer, not committed)",
      value: "project-local",
    },
    {
      name: "Project — files in ./.claude/hooks/, settings in ./.claude/settings.json (committed, shared with team)",
      value: "project",
    },
    {
      name: "User — files in ~/.claude/hooks/, settings in ~/.claude/settings.json (global, all your projects)",
      value: "user",
    },
  ];
}

function depReady(dep: HookDep): boolean {
  try {
    exec(`which ${dep.name}`);
    return true;
  } catch {
    return false;
  }
}

function brewAvailable(): boolean {
  try {
    exec("which brew");
    return true;
  } catch {
    return false;
  }
}

function installDep(dep: HookDep): boolean {
  // Defense-in-depth: the registry validator already enforced this regex,
  // but re-check here so a future code path that constructs a HookDep
  // outside the validator still can't shell-inject through this function.
  if (!DEP_NAME_RE.test(dep.name)) {
    log.error(`refusing to install dep with unsafe name: ${JSON.stringify(dep.name)}`);
    return false;
  }
  console.log(`  Installing ${dep.name} via Homebrew (may prompt for password)...`);
  // argv form, NOT shell-interpolated — registry compromise can't escape into a shell command.
  const result = spawnSync("brew", ["install", dep.name], { stdio: "inherit" });
  return result.status === 0;
}

/**
 * Pre-flight: ensure all deps are present (or gracefully degraded) before
 * touching any files. Returns false to hard-abort the hook install.
 */
function preflightDeps(hook: HookDef): boolean {
  for (const dep of hook.deps ?? []) {
    if (depReady(dep)) {
      log.ok(`${dep.name} ready`);
      continue;
    }
    if (dep.via === "brew") {
      if (brewAvailable()) {
        if (installDep(dep)) {
          log.ok(`${dep.name} installed`);
          continue;
        }
        if (dep.optional) {
          log.warn(`${dep.name} install failed; runtime fallback will be used`);
          continue;
        }
        log.error(`${dep.name} install failed (required); aborting`);
        return false;
      }
      if (dep.optional) {
        log.warn(
          `Homebrew not found; ${dep.name} will be skipped. Runtime fallback will be used (no brand icon). Install brew at https://brew.sh and re-run for full features.`,
        );
        continue;
      }
      log.error(
        `Homebrew not found and ${dep.name} is required. Install brew at https://brew.sh, then re-run.`,
      );
      return false;
    }
  }
  return true;
}

async function ensureHookFilesFetched(hook: HookDef, packageRoot: string): Promise<void> {
  if (process.env.DEV === "1") return;
  for (const file of hook.files) {
    const repoPath = path.posix.join(".claude/hooks", hook.name, file);
    const localPath = path.join(packageRoot, repoPath);
    if (fs.existsSync(localPath)) continue;
    await fetchExtraContentBinary(packageRoot, repoPath);
  }
}

function copyHookFiles(
  hook: HookDef,
  packageRoot: string,
  destDir: string,
): { written: number; preserved: number } {
  fs.mkdirSync(destDir, { recursive: true });
  const preserve = new Set(hook.preserveFiles ?? []);
  let written = 0;
  let preserved = 0;
  for (const file of hook.files) {
    const dest = path.join(destDir, file);
    if (preserve.has(file) && fs.existsSync(dest)) {
      preserved++;
      continue;
    }
    const src = path.join(packageRoot, ".claude", "hooks", hook.name, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    written++;
  }
  return { written, preserved };
}

function backupOnce(filePath: string): void {
  if (settingsBackedUp.has(filePath)) return;
  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, filePath + ".bak");
  }
  settingsBackedUp.add(filePath);
}

function mergeHookIntoSettings(
  resolved: ScopeResolved,
  hook: HookDef,
): { ok: boolean; mutated: boolean; reason?: string } {
  let settings: SettingsFile = {};
  if (fs.existsSync(resolved.settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(resolved.settingsPath, "utf8")) as SettingsFile;
    } catch (e) {
      return {
        ok: false,
        mutated: false,
        reason: `${resolved.settingsPath} is not valid JSON: ${(e as Error).message}`,
      };
    }
  }

  let mutated = false;
  let next = settings;
  for (const evt of hook.settingsEvents) {
    const cmd = hook.command.replace(/\$HOOK_DIR/g, resolved.commandHookDir);
    const result = addHookToSettings(next, evt.event, cmd, hook.marker);
    if (result.mutated) mutated = true;
    next = result.settings;
  }

  if (mutated) {
    backupOnce(resolved.settingsPath);
    fs.mkdirSync(path.dirname(resolved.settingsPath), { recursive: true });
    atomicWriteFile(resolved.settingsPath, JSON.stringify(next, null, 2) + "\n");
  }
  return { ok: true, mutated };
}

/**
 * Write `content` to `filePath` atomically and TOCTOU-safely.
 *
 * A predictable tmp name like `settings.json.tmp` lets a local attacker
 * pre-create that path as a symlink pointing at, say, ~/.ssh/authorized_keys
 * — the next install would then clobber the link target. Defenses: random
 * suffix so the tmp name can't be predicted, plus O_CREAT|O_EXCL so we
 * refuse to open the path at all if anything (file or symlink) exists
 * there. Restrictive 0o600 perms in case the parent directory is
 * world-writable. Final rename(2) is the atomic step.
 */
function atomicWriteFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const suffix = crypto.randomBytes(8).toString("hex");
  const tmp = path.join(dir, `.${base}.${suffix}.tmp`);
  const fd = fs.openSync(
    tmp,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
    0o600,
  );
  try {
    fs.writeSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

export function loadHooksConfig(packageRoot: string): HooksConfig {
  const configPath = path.join(packageRoot, ".claude", "hooks", "hooks.json");
  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as { hooks?: unknown };
  if (!raw || !Array.isArray(raw.hooks)) {
    throw new Error(`${configPath} must have a "hooks" array at the top level`);
  }
  raw.hooks.forEach((h, i) => validateHookEntry(h, i));
  return raw as HooksConfig;
}

function relativeFromCwd(absPath: string): string {
  const rel = path.relative(process.cwd(), absPath);
  return rel.startsWith("..") ? absPath : rel;
}

export interface InstallHookResult {
  hook: string;
  written: number;
  preserved: number;
  scope: Scope;
  hookDir: string;
  settingsPath: string;
  settingsMutated: boolean;
  settingsError?: string;
  aborted?: string;
}

/**
 * Non-interactive single-hook install. Driven by installHooks (which
 * collects user choices via prompts) and by tools/verify-hooks.mjs (which
 * exercises the install path end-to-end without prompts).
 */
export async function installHook(
  hook: HookDef,
  scope: Scope,
  projectBase: string,
  packageRoot: string,
): Promise<InstallHookResult> {
  const resolved = resolveScope(scope, projectBase, hook.name);
  const base: InstallHookResult = {
    hook: hook.name,
    written: 0,
    preserved: 0,
    scope,
    hookDir: resolved.hookDir,
    settingsPath: resolved.settingsPath,
    settingsMutated: false,
  };

  if (!preflightDeps(hook)) {
    return { ...base, aborted: "deps preflight failed" };
  }

  await ensureHookFilesFetched(hook, packageRoot);
  const { written, preserved } = copyHookFiles(hook, packageRoot, resolved.hookDir);

  const merge = mergeHookIntoSettings(resolved, hook);
  return {
    ...base,
    written,
    preserved,
    settingsMutated: merge.mutated,
    settingsError: merge.ok ? undefined : merge.reason,
  };
}

export async function installHooks(packageRoot: string): Promise<void> {
  const config = loadHooksConfig(packageRoot);

  const compatible = config.hooks.filter((h) =>
    h.runtimePlatforms.includes(process.platform),
  );
  if (compatible.length === 0) {
    log.warn(
      `No hooks available for your platform (${process.platform}). Skipping.`,
    );
    return;
  }

  const projectBase = await withEsc(
    input({
      message: "Hooks install target directory (used for project-scoped hooks):",
      default: process.cwd(),
    }),
  );
  const projectBaseResolved = path.resolve(projectBase);
  if (
    !fs.existsSync(projectBaseResolved) ||
    !fs.statSync(projectBaseResolved).isDirectory()
  ) {
    log.error(`Not a valid directory: ${projectBaseResolved}`);
    return;
  }

  const selected = await withEsc(
    checkbox<HookDef>({
      message: "Select hooks to install:",
      choices: compatible.map((h) => ({
        name: `${h.name} — ${h.description}`,
        value: h,
        checked: true,
      })),
    }),
  );

  if (selected.length === 0) {
    log.skip("No hooks selected");
    return;
  }

  for (const hook of selected) {
    console.log(`\n· ${hook.name}`);

    const scope = await withEsc(
      select<Scope>({
        message: `Where to install the ${hook.name} hook?`,
        choices: scopeChoices(),
        default: "project-local",
      }),
    );

    let result: InstallHookResult;
    try {
      result = await installHook(hook, scope, projectBaseResolved, packageRoot);
    } catch (e) {
      log.error(`${hook.name}: ${(e as Error).message}`);
      continue;
    }

    if (result.aborted) {
      log.error(`${hook.name} aborted: ${result.aborted}`);
      continue;
    }

    const settingsRel = relativeFromCwd(result.settingsPath);
    const dirRel = relativeFromCwd(result.hookDir);
    const summary = result.preserved > 0
      ? `${hook.name} hook installed at ${dirRel} (${result.written} written, ${result.preserved} preserved)`
      : `${hook.name} hook installed at ${dirRel}`;
    log.ok(summary);

    if (result.settingsError) {
      log.error(`${hook.name}: ${result.settingsError}`);
      log.warn(`Files were copied to ${dirRel} but settings not updated. Add the hook entry manually if you want it active.`);
    } else if (result.settingsMutated) {
      log.ok(`registered in ${settingsRel}`);
    } else {
      log.skip(`already registered in ${settingsRel}`);
    }
  }

  console.log("\nCustomize:");
  console.log("  • Sound  → edit <hook-dir>/config.json  (e.g. \"sound\": \"Submarine\")");
  console.log("  • Icon   → replace <hook-dir>/icon.png with your own 512×512 PNG");
  console.log("  • Docs   → see <hook-dir>/README.md");
}
