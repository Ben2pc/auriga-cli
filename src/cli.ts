#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  exec,
  DEFAULT_WORKFLOW_LANG,
  fetchContentRoot,
  getPackageRoot,
  isNonInteractive,
  LANGUAGES,
  log,
  readPackageVersion,
  type PluginAgent,
  type InstallOpts,
} from "./utils.js";
import { installWorkflow } from "./workflow.js";
import { installSkills, installRecommendedSkills } from "./skills.js";
import { installPlugins } from "./plugins.js";
import {
  installPreset,
  installPresetPluginsSkills,
  type PresetStepResult,
} from "./preset.js";
import { loadCatalog } from "./catalog.js";
import { renderHelp, renderTypeHelp } from "./help.js";
import { renderGuide } from "./guide.js";
import { CATEGORY_NAMES, type CategoryName } from "./types.js";
export type { CategoryName } from "./types.js";

const RELOAD_REMINDER =
  "\n⚠ Reload your Agent session to pick up the new harness (AGENTS.md / skills / plugins are loaded at session startup).\n";
const SKILLS_PLUGINS_RELOAD_REMINDER =
  "\n⚠ Reload your Agent session to pick up the new skills / plugins (loaded at session startup).\n";

// ---------------------------------------------------------------------------
// parseArgs — pure argv parser (spec §3.5 / §5.2)
// ---------------------------------------------------------------------------

export interface InstallParsed {
  all: boolean;
  /** `--preset` — atomic install of the curated default set (workflow
   *  doc + workflow skills + auriga-workflow plugin). Mutually exclusive
   *  with `all` / `type` / `filter`. */
  preset?: boolean;
  /** `--preset-plugins-skills` — atomic install of the curated default
   *  set minus workflow docs: workflow skills + auriga-workflow plugin. */
  presetPluginsSkills?: boolean;
  type?: CategoryName;
  filter?: string[];
  lang?: string;
  cwd?: string;
  scope?: "project" | "user";
  agent?: PluginAgent;
}

export interface UiParsed {
  /** Override the default port (4747). When set, the fallback range is
   *  also skipped — we either succeed on this port or fail. */
  port?: number;
  /** Override ui-fetch; serve from this local directory instead. Useful
   *  for development against `ui/dist` without a release tag. */
  uiDir?: string;
  /** Skip opening the browser. Prints the URL only. */
  noOpen?: boolean;
}

export type ParsedArgs =
  | { command: "help"; helpType?: CategoryName }
  | { command: "version" }
  | { command: "guide" }
  | { command: "install"; install: InstallParsed }
  | { command: "web-ui"; ui: UiParsed };

const CATEGORY_SET = new Set<CategoryName>(CATEGORY_NAMES);

const TYPE_FOR_FILTER = {
  "--skill": "skills",
  "--recommended-skill": "recommended",
  "--plugin": "plugins",
} as const;

function parseErr(msg: string): never {
  throw new Error(msg);
}

// Sentinel thrown by parseInstall when `--help` / `-h` appears in the
// install subcommand argv. Caught in parseArgs and converted to a
// ParsedArgs of `{ command: "help", helpType }`. A sentinel class (vs.
// an error string) keeps the parse error path untouched by the help
// shortcut, so `install foo --help` still reports the real error.
class PerTypeHelpRequest {
  constructor(public readonly type: CategoryName | undefined) {}
}

function requireValue(argv: string[], i: number, flag: string): string {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("-")) {
    parseErr(`${flag} requires a value.`);
  }
  return v;
}

/**
 * Handle the `--flag=value` form for single-value flags (--lang, --cwd,
 * --scope). Returns [value, advance] where `advance` is how many
 * tokens to consume (1 for equals-form, 2 for space-form).
 * Rejects empty values (`--lang=`) consistently with requireValue.
 */
function readSingleValue(argv: string[], i: number, flag: string): [string, number] {
  const t = argv[i];
  const eqIdx = t.indexOf("=");
  if (eqIdx > 0) {
    const v = t.slice(eqIdx + 1);
    if (v.length === 0) parseErr(`${flag} requires a value.`);
    return [v, 1];
  }
  return [requireValue(argv, i, flag), 2];
}

// Consume values for a filter flag until the next flag-like token
// ("--..." / "-..."), the explicit "--" terminator, or end-of-argv.
// Returns [values, nextIndex].
function consumeFilter(argv: string[], start: number): [string[], number] {
  const values: string[] = [];
  let i = start;
  while (i < argv.length) {
    const t = argv[i];
    if (t === "--") { i += 1; break; }
    if (t.startsWith("-")) break;
    values.push(t);
    i += 1;
  }
  return [values, i];
}

export function parseArgs(argv: string[]): ParsedArgs {
  // Top-level verb / flag dispatch.
  //
  // Bare `npx auriga-cli` (empty argv) dispatches to the install bare
  // form, NOT to help — runInstall then picks TTY legacy-menu vs
  // non-TTY error hint. Routing here to help would break the documented
  // zero-arg entrypoint used by the interactive menu.
  if (argv.length === 0) return { command: "install", install: { all: false } };
  const head = argv[0];
  if (head === "--help" || head === "-h" || head === "help") return { command: "help" };
  if (head === "--version" || head === "-v") return { command: "version" };
  if (head === "guide") {
    // `guide --help` / `guide -h` is a universal affordance — route to
    // top-level help rather than reject. Anything else after `guide`
    // (positional, other flags) still fail-fasts per spec §3.6.
    if (argv.length === 2 && (argv[1] === "--help" || argv[1] === "-h")) {
      return { command: "help" };
    }
    if (argv.length > 1) {
      parseErr("guide takes no arguments. Run 'npx auriga-cli --help' for usage.");
    }
    return { command: "guide" };
  }
  if (head === "web-ui") {
    try {
      return { command: "web-ui", ui: parseUi(argv.slice(1)) };
    } catch (e) {
      if (e instanceof PerTypeHelpRequest) return { command: "help" };
      throw e;
    }
  }
  if (head !== "install") {
    parseErr(`unknown argument '${head}'. Run 'npx auriga-cli --help' for usage.`);
  }

  try {
    return { command: "install", install: parseInstall(argv.slice(1)) };
  } catch (e) {
    if (e instanceof PerTypeHelpRequest) {
      return e.type ? { command: "help", helpType: e.type } : { command: "help" };
    }
    throw e;
  }
}

function parseUi(argv: string[]): UiParsed {
  const out: UiParsed = {};
  let i = 0;
  while (i < argv.length) {
    const t = argv[i];
    if (t === "--help" || t === "-h") {
      // ui --help routes to the top-level help — keeps the parser narrow
      // and avoids a per-command help renderer for one subcommand.
      throw new PerTypeHelpRequest(undefined);
    }
    if (t === "--port" || t.startsWith("--port=")) {
      const [v, adv] = readSingleValue(argv, i, "--port");
      const n = Number.parseInt(v, 10);
      // 0 is a deliberate "OS-assigned ephemeral port" affordance used by
      // hermetic e2e tests (spec §8.1). Real users pass a normal port.
      if (!Number.isFinite(n) || n < 0 || n > 65535) {
        parseErr(`--port must be a port number in [0, 65535], got '${v}'`);
      }
      out.port = n;
      i += adv;
      continue;
    }
    if (t === "--ui-dir" || t.startsWith("--ui-dir=")) {
      const [v, adv] = readSingleValue(argv, i, "--ui-dir");
      out.uiDir = v;
      i += adv;
      continue;
    }
    if (t === "--no-open") {
      out.noOpen = true;
      i += 1;
      continue;
    }
    parseErr(`unknown argument '${t}' for 'web-ui'. Run 'npx auriga-cli --help' for usage.`);
  }
  return out;
}

function parseInstall(argv: string[]): InstallParsed {
  const out: InstallParsed = { all: false };
  let filterFlag: keyof typeof TYPE_FOR_FILTER | null = null;

  let i = 0;
  while (i < argv.length) {
    const t = argv[i];

    if (t === "--help" || t === "-h") {
      // Per-type help: `install <type> --help` routes to renderTypeHelp
      // at the main() dispatch level. parseInstall signals this via a
      // sentinel thrown up to parseArgs.
      throw new PerTypeHelpRequest(out.type);
    }

    if (t === "--all") {
      out.all = true;
      i += 1;
      continue;
    }

    // `--preset` is a boolean flag — it takes no value. Reject the
    // `--preset=...` equals form explicitly rather than letting it fall
    // through to the generic "unknown argument" branch, so the user gets
    // a message that names the actual mistake.
    if (t === "--preset") {
      out.preset = true;
      i += 1;
      continue;
    }
    if (t.startsWith("--preset=")) {
      parseErr("--preset takes no value.");
    }
    if (t === "--preset-plugins-skills") {
      out.presetPluginsSkills = true;
      i += 1;
      continue;
    }
    if (t.startsWith("--preset-plugins-skills=")) {
      parseErr("--preset-plugins-skills takes no value.");
    }

    // Accept both `--lang en` and `--lang=en` (and same for --cwd, --scope).
    // The equals form is a common CLI affordance; rejecting it confuses
    // users with any prior gnu-style / node util.parseArgs experience.
    if (t === "--lang" || t.startsWith("--lang=")) {
      const [v, advance] = readSingleValue(argv, i, "--lang");
      out.lang = v;
      i += advance;
      continue;
    }
    if (t === "--cwd" || t.startsWith("--cwd=")) {
      const [v, advance] = readSingleValue(argv, i, "--cwd");
      out.cwd = v;
      i += advance;
      continue;
    }
    if (t === "--scope" || t.startsWith("--scope=")) {
      const [v, advance] = readSingleValue(argv, i, "--scope");
      out.scope = v as "project" | "user";
      i += advance;
      continue;
    }
    if (t === "--agent" || t.startsWith("--agent=")) {
      const [v, advance] = readSingleValue(argv, i, "--agent");
      out.agent = v as PluginAgent;
      i += advance;
      continue;
    }

    // Object.hasOwn (not `in`) so Object.prototype keys like `toString` /
    // `constructor` don't slip into the filter-flag branch and produce a
    // misleading error.
    if (Object.hasOwn(TYPE_FOR_FILTER, t)) {
      if (filterFlag !== null) {
        // A second filter flag on the same install line used to silently
        // overwrite the first. Fail-fast so the user notices — one
        // install invocation gets one filter list.
        parseErr(`repeated ${t}: pass one ${t} list per install.`);
      }
      const [values, next] = consumeFilter(argv, i + 1);
      if (values.length === 0) {
        parseErr(`${t} requires at least one name (or '*' for all).`);
      }
      out.filter = values;
      filterFlag = t as keyof typeof TYPE_FOR_FILTER;
      i = next;
      continue;
    }

    if (CATEGORY_SET.has(t as CategoryName)) {
      if (out.type) parseErr("install takes one <type> at a time.");
      out.type = t as CategoryName;
      i += 1;
      continue;
    }

    // Any other positional (non-flag) while a type is already set is
    // the user trying to pass a second type or stray filter value — spec
    // §3.5 rule 1: one type at a time.
    if (!t.startsWith("-") && out.type) {
      parseErr("install takes one <type> at a time.");
    }

    parseErr(`unknown argument '${t}'. Run 'npx auriga-cli --help' for usage.`);
  }

  validateInstall(out, filterFlag);
  return out;
}

function validateInstall(out: InstallParsed, filterFlag: string | null): void {
  // Rule 1: preset flags are atomic. `--preset` installs the curated
  // default set (workflow doc + workflow skills + auriga-workflow plugin).
  // `--preset-plugins-skills` installs the same curated skills/plugins
  // surface without touching workflow docs.
  if (out.preset || out.presetPluginsSkills) {
    const flag = out.preset ? "--preset" : "--preset-plugins-skills";
    if (out.preset && out.presetPluginsSkills) {
      parseErr("--preset and --preset-plugins-skills are both atomic; pass only one.");
    }
    if (out.all) {
      parseErr(`${flag} and --all are both atomic; pass only one.`);
    }
    if (out.type) {
      parseErr(`${flag} is atomic; it cannot combine with the '${out.type}' type.`);
    }
    if (out.filter) {
      parseErr(
        `${flag} is atomic; it cannot combine with --skill/--recommended-skill/--plugin.`,
      );
    }
    if (out.cwd !== undefined) {
      parseErr(`${flag} does not accept --cwd.`);
    }
    if (out.presetPluginsSkills && out.lang !== undefined) {
      parseErr("--lang does not apply to --preset-plugins-skills.");
    }
    if (out.scope !== undefined) validateScopeValue(out.scope);
    if (out.agent !== undefined) validateAgentValue(out.agent);
    if (out.preset && out.lang !== undefined) {
      const valid = LANGUAGES.map((l) => l.value);
      if (!valid.includes(out.lang)) {
        parseErr(`unknown language '${out.lang}'; available: ${valid.join(", ")}`);
      }
    }
    return;
  }

  // Rule 2: --all is atomic.
  if (out.all) {
    if (out.type || out.filter || out.lang !== undefined || out.cwd !== undefined) {
      parseErr("--all is atomic; no extra types or filters allowed.");
    }
    // --all may combine with --scope.
    if (out.scope !== undefined) validateScopeValue(out.scope);
    if (out.agent !== undefined) validateAgentValue(out.agent);
    return;
  }

  // Rule 3: filter flag requires matching type.
  if (filterFlag) {
    const requiredType = TYPE_FOR_FILTER[filterFlag as keyof typeof TYPE_FOR_FILTER];
    if (out.type !== requiredType) {
      parseErr(`${filterFlag} requires 'install ${requiredType}'.`);
    }
  }

  // Rule 5: --lang / --cwd only for workflow.
  if ((out.lang !== undefined || out.cwd !== undefined) && out.type !== "workflow") {
    parseErr("--lang/--cwd only apply to workflow.");
  }

  // Rule 6: --scope only for skills / recommended / plugins.
  // workflow (single file + symlink) has no scope concept.
  if (out.scope !== undefined) {
    if (out.type === "workflow") {
      parseErr("--scope does not apply to workflow.");
    }
    validateScopeValue(out.scope);
  }

  if (out.agent !== undefined) {
    if (out.type !== "plugins") {
      parseErr("--agent only applies to plugins or --all.");
    }
    validateAgentValue(out.agent);
  }

  // Value validation for workflow.
  if (out.type === "workflow" && out.lang !== undefined) {
    const valid = LANGUAGES.map((l) => l.value);
    if (!valid.includes(out.lang)) {
      parseErr(`unknown language '${out.lang}'; available: ${valid.join(", ")}`);
    }
  }
  if (out.type === "workflow" && out.cwd !== undefined) {
    if (!fs.existsSync(out.cwd)) {
      parseErr(`--cwd directory does not exist: ${out.cwd}`);
    }
  }

  // Catalog-backed filter name validation (spec §7).
  if (out.filter && out.type) {
    validateFilterAgainstCatalog(out.type, out.filter);
  }
}

function validateFilterAgainstCatalog(type: CategoryName, filter: string[]): void {
  if (filter.length === 1 && filter[0] === "*") return;
  const catalogPath = path.join(getPackageRoot(), "dist", "catalog.json");
  if (!fs.existsSync(catalogPath)) return;
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
  const bucket =
    type === "skills" ? catalog.workflowSkills
    : type === "recommended" ? catalog.recommendedSkills
    : type === "plugins" ? catalog.plugins
    : null;
  if (!bucket) return;
  const available = bucket.map((e: { name: string }) => e.name);
  const singular = categorySingular(type);
  for (const name of filter) {
    if (!available.includes(name)) {
      const hint = migratedPluginHint(type, name);
      const hintText = hint ? ` ${hint}` : "";
      parseErr(`unknown ${singular} '${name}';${hintText} available: ${available.join(", ")}`);
    }
  }
}

function migratedPluginHint(type: CategoryName, name: string): string | undefined {
  if (
    type === "skills" &&
    [
      "incremental-impl",
      "test-designer",
      "session-compound",
      "systematic-debugging",
    ].includes(name)
  ) {
    return "This skill moved to the auriga-workflow plugin; install it with `install plugins --plugin auriga-workflow`.";
  }
  return undefined;
}

function categorySingular(type: CategoryName): string {
  return type === "recommended" ? "recommended skill"
    : type === "skills" ? "skill"
    : type.replace(/s$/, "");
}

function validateScopeValue(scope: string): void {
  if (scope !== "project" && scope !== "user") {
    parseErr(`unknown --scope value '${scope}'; expected 'project' or 'user'.`);
  }
}

function validateAgentValue(agent: string): void {
  if (agent !== "claude" && agent !== "codex" && agent !== "both") {
    parseErr(`unknown --agent value '${agent}'; expected 'claude', 'codex', or 'both'.`);
  }
}

// ---------------------------------------------------------------------------
// main — returns exit code (spec §5.3.1 / §7)
// ---------------------------------------------------------------------------

// --all is "install everything": every category, including the opt-in
// recommended skills. Order matches the menu / execution order
// (workflow → skills → recommended → plugins). The curated subset lives
// behind --preset (workflow doc + workflow skills + auriga-workflow).
const ALL_CATEGORIES: CategoryName[] = [
  "workflow",
  "skills",
  "recommended",
  "plugins",
];


export async function main(argv: string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    log.error((e as Error).message);
    return 1;
  }

  const version = readPackageVersion();

  if (parsed.command === "help") {
    try {
      const catalog = loadCatalog(getPackageRoot());
      const out = parsed.helpType
        ? renderTypeHelp(catalog, parsed.helpType, version)
        : renderHelp(catalog, version);
      process.stdout.write(out);
      return 0;
    } catch (e) {
      log.error((e as Error).message);
      return 1;
    }
  }

  if (parsed.command === "version") {
    process.stdout.write(`${version}\n`);
    return 0;
  }

  if (parsed.command === "guide") {
    const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
    process.stdout.write(renderGuide({ color, version }));
    return 0;
  }

  if (parsed.command === "web-ui") {
    return runUi(parsed.ui, version);
  }

  // install — catalog is required for filter validation and for the TTY
  // menu's category descriptions; fail-fast at entry rather than produce
  // a cryptic error mid-dispatch (spec §7 / §11 acceptance).
  // guide / --version deliberately skip this check — both are usable
  // before any build.
  try {
    loadCatalog(getPackageRoot());
  } catch (e) {
    log.error((e as Error).message);
    return 1;
  }
  return runInstall(parsed.install);
}

async function runInstall(p: InstallParsed): Promise<number> {
  // Bare `install` (no type, no --all, no preset flag, no filter):
  // TTY → menu, non-TTY → exit 1.
  if (!p.all && !p.preset && !p.presetPluginsSkills && !p.type) {
    if (isNonInteractive()) {
      log.error(
        "Interactive mode requires a TTY. Run 'npx auriga-cli --help' for non-interactive options.",
      );
      return 1;
    }
    return runLegacyMenu();
  }

  // --preset: curated default-set install (precheck + ordered fan-out).
  if (p.preset) {
    return runPreset(p);
  }

  if (p.presetPluginsSkills) {
    return runPresetPluginsSkills(p);
  }

  // --all: precheck + fan-out.
  if (p.all) {
    return runAll(p);
  }

  // Single-category install.
  return runSingle(p);
}

async function runPresetPluginsSkills(p: InstallParsed): Promise<number> {
  const agent: PluginAgent = p.agent ?? "both";
  const prep = await prepareInstall(["plugins"], agent);
  if ("exit" in prep) return prep.exit;
  const { packageRoot } = prep;

  const results = await installPresetPluginsSkills(packageRoot, {
    interactive: false,
    scope: p.scope ?? "user",
    agent,
  });

  const retryArgs = ["install", "--preset-plugins-skills"];
  if (p.scope) retryArgs.push("--scope", p.scope);
  if (p.agent) retryArgs.push("--agent", p.agent);
  return finishPresetInstall(results, retryArgs, SKILLS_PLUGINS_RELOAD_REMINDER);
}

/**
 * `install --preset` — installs the curated default set via the shared
 * `installPreset` orchestrator. Graded exit mirrors `runAll`: all steps
 * succeed → 0; any step fails → 2 with per-step status on stderr.
 *
 * The preset defaults differ from a category install — scope=user,
 * agent=both, lang=zh-CN — and are resolved here before handing off, so
 * `installPreset` itself stays default-free (the TUI / Web UI callers
 * resolve their own defaults the same way).
 */
async function runPreset(p: InstallParsed): Promise<number> {
  const agent: PluginAgent = p.agent ?? "both";
  const prep = await prepareInstall(["plugins"], agent);
  if ("exit" in prep) return prep.exit;
  const { packageRoot } = prep;

  const results = await installPreset(packageRoot, {
    interactive: false,
    scope: p.scope ?? "user",
    agent,
    lang: p.lang ?? DEFAULT_WORKFLOW_LANG,
  });

  // The preset is one atomic "install the right defaults" action — the
  // retry is the whole command again, not a per-category fan-out like
  // runAll's hint.
  const retryArgs = ["install", "--preset"];
  if (p.scope) retryArgs.push("--scope", p.scope);
  if (p.agent) retryArgs.push("--agent", p.agent);
  if (p.lang) retryArgs.push("--lang", p.lang);
  return finishPresetInstall(results, retryArgs, RELOAD_REMINDER);
}

function finishPresetInstall(
  results: PresetStepResult[],
  retryArgs: string[],
  reloadReminder: string,
): number {
  for (const r of results) {
    if (r.ok) {
      process.stderr.write(`[OK]   ${r.category}\n`);
    } else {
      process.stderr.write(`[FAIL] ${r.category} — ${r.err}\n`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    process.stderr.write(reloadReminder);
    return 0;
  }

  process.stderr.write(`\nRetry:\n  npx -y auriga-cli ${retryArgs.join(" ")}\n`);
  if (failed.length < results.length) {
    process.stderr.write(reloadReminder);
  }
  return 2;
}

/**
 * Precheck external prerequisites before touching any files.
 * Returns null if OK, or an error message.
 */
function precheckExternal(need: CategoryName[], agent: PluginAgent = "claude"): string | null {
  if (need.includes("plugins")) {
    if (agent === "claude" || agent === "both") {
      try { exec("which claude"); }
      catch { return "'claude' CLI not in PATH. Install Claude Code first (https://docs.claude.com/claude-code), then re-run."; }
    }
    if (agent === "codex" || agent === "both") {
      try { exec("which codex"); }
      catch { return "'codex' CLI not in PATH. Install Codex first, then re-run."; }
    }
  }
  return null;
}

async function safeFetchContentRoot(): Promise<{ root?: string; err?: string }> {
  try {
    return { root: await fetchContentRoot() };
  } catch (e) {
    return {
      err: `fetch failed: ${(e as Error).message}. Check network and retry; if persistent, the GitHub raw endpoint may be blocked in your region.`,
    };
  }
}

/**
 * Shared precheck + fetch skeleton for every non-interactive install
 * entry. Returns either a ready-to-use packageRoot or an exit code to
 * bubble up. Keeps runAll / runSingle from drifting apart as new
 * pre-install behavior accrues.
 */
async function prepareInstall(
  needs: CategoryName[],
  agent?: PluginAgent,
): Promise<{ packageRoot: string } | { exit: number }> {
  const pre = precheckExternal(needs, agent ?? "claude");
  if (pre) {
    log.error(pre);
    return { exit: 1 };
  }
  const fetched = await safeFetchContentRoot();
  if (fetched.err) {
    log.error(fetched.err);
    return { exit: 1 };
  }
  return { packageRoot: fetched.root! };
}

async function runAll(p: InstallParsed): Promise<number> {
  const prep = await prepareInstall(["plugins"], p.agent);
  if ("exit" in prep) return prep.exit;
  const { packageRoot } = prep;

  const status: { category: CategoryName; ok: boolean; err?: string }[] = [];
  for (const category of ALL_CATEGORIES) {
    // Forward `scope` only when the user actually passed one. Each
    // installer picks its own default for undefined so category-specific
    // defaults (skills/recommended/plugins all map undefined → project)
    // aren't flattened by a one-size-fits-all fallback here.
    const opts: InstallOpts = {
      interactive: false,
      scope: p.scope,
      agent: p.agent,
    };
    try {
      await dispatchInstaller(category, packageRoot, opts);
      status.push({ category, ok: true });
    } catch (e) {
      status.push({ category, ok: false, err: (e as Error).message });
    }
  }

  for (const s of status) {
    if (s.ok) {
      process.stderr.write(`[OK]   ${s.category}\n`);
    } else {
      process.stderr.write(`[FAIL] ${s.category} — ${s.err}\n`);
    }
  }

  const failed = status.filter((s) => !s.ok);
  if (failed.length === 0) {
    process.stderr.write(RELOAD_REMINDER);
    return 0;
  }

  // Retry hint must carry `--scope` forward for any scope-aware
  // category (see scopeCategory). Dropping it silently retries into
  // the default project scope and leaves the intended user-scope
  // install incomplete.
  const scopeSuffix = p.scope ? ` --scope ${p.scope}` : "";
  const agentSuffix = p.agent ? ` --agent ${p.agent}` : "";
  process.stderr.write("\nRetry:\n");
  for (const s of failed) {
    const suffix = [
      scopeCategory(s.category) ? scopeSuffix : "",
      s.category === "plugins" ? agentSuffix : "",
    ].join("");
    process.stderr.write(`  npx -y auriga-cli install ${s.category}${suffix}\n`);
  }
  // Partial success still installed assets that need a session reload
  // (AGENTS.md / skills / plugins load at startup). Without this hint
  // the user may retry the failed category and act on stale state.
  if (failed.length < status.length) {
    process.stderr.write(RELOAD_REMINDER);
  }
  return 2;
}

function scopeCategory(c: CategoryName): boolean {
  // Categories where `--scope` is a real flag. Only workflow ignores
  // it (single file + symlink, no scope concept).
  return c !== "workflow";
}

async function runSingle(p: InstallParsed): Promise<number> {
  const category = p.type as CategoryName;
  const prep = await prepareInstall(category === "plugins" ? ["plugins"] : [], p.agent);
  if ("exit" in prep) return prep.exit;
  const { packageRoot } = prep;

  const opts: InstallOpts = {
    interactive: false,
    lang: p.lang,
    cwd: p.cwd,
    scope: p.scope,
    agent: p.agent,
    selected: p.filter,
  };

  try {
    await dispatchInstaller(category, packageRoot, opts);
    process.stderr.write(RELOAD_REMINDER);
    return 0;
  } catch (e) {
    log.error((e as Error).message);
    return 1;
  }
}

async function dispatchInstaller(
  category: CategoryName,
  packageRoot: string,
  opts: InstallOpts,
): Promise<void> {
  switch (category) {
    case "workflow": return installWorkflow(packageRoot, opts);
    case "skills": return installSkills(packageRoot, opts);
    case "recommended": return installRecommendedSkills(packageRoot, opts);
    case "plugins": return installPlugins(packageRoot, opts);
  }
}

// ---------------------------------------------------------------------------
// `web-ui` subcommand — boots the local Web UI server (spec §4)
// ---------------------------------------------------------------------------

const UI_DEFAULT_PORT = 4747;
const UI_PORT_RANGE = 10; // 4747..4756
// 2 minutes covers Chrome's "intensive throttling" of background tabs
// (kicks in after ~5 min of being hidden, drops setInterval to ~1 ping/min).
// At 15s the browser tab being switched away for a moment would tear down
// the server — bad UX. Closing the browser now takes up to 2 min to release
// the port; users who care can ctrl+C the CLI for immediate exit.
const UI_HEARTBEAT_TIMEOUT_MS = 120_000;

async function runUi(p: UiParsed, version: string): Promise<number> {
  // Lazy-load the server-side deps so the install / guide paths stay light.
  const { randomBytes } = await import("node:crypto");
  const { startServer } = await import("./server.js");
  const { buildDefaultApplyHandlers } = await import("./apply-handlers.js");
  const { buildScanCatalog } = await import("./scan-catalog.js");
  const { ensureUiBundle } = await import("./ui-fetch.js");

  const cwd = process.cwd();
  // Two roots, two responsibilities (mirrors the TTY install path's pattern):
  //   - tarballRoot: where `dist/catalog.json` + the bundled DEV ui/dist live.
  //     Always read from the installed npm package; can't be fetched because
  //     dist/ is built artifact, not git content.
  //   - contentRoot: where the runtime install recipes live (workflow
  //     templates, marketplace manifests, extra_plugin_configs.json,
  //     skills-lock.json).
  //     These files are
  //     NOT in the npm tarball — the `files` allowlist only ships `dist/*`
  //     + npm defaults. They are fetched from GitHub, pinned to the CLI
  //     version tag, by fetchContentRoot(). Under DEV=1 fetchContentRoot
  //     short-circuits to the repo root so this is a no-op there.
  // Without the contentRoot fix, tarball-installed Web UI users hit ENOENT
  // on any plugin install (apply handlers read non-tarball install inputs
  // from packageRoot).
  const tarballRoot = getPackageRoot();
  let contentRoot: string;
  try {
    contentRoot = await fetchContentRoot();
  } catch (e) {
    log.error(`Failed to fetch content: ${(e as Error).message}`);
    return 1;
  }

  // 1. Resolve UI bundle directory.
  let uiDir: string;
  if (p.uiDir) {
    uiDir = path.resolve(p.uiDir);
    if (!fs.existsSync(path.join(uiDir, "index.html"))) {
      log.error(`--ui-dir does not contain index.html: ${uiDir}`);
      return 3;
    }
  } else if (process.env.DEV === "1") {
    // Dev convenience: prefer the locally-built ui/dist over a network fetch.
    const localDist = path.join(tarballRoot, "ui", "dist");
    if (fs.existsSync(path.join(localDist, "index.html"))) {
      uiDir = localDist;
    } else {
      log.error(
        "DEV mode: ui/dist not built. Run 'npm --prefix ui run build' or unset DEV to fetch from GitHub.",
      );
      return 3;
    }
  } else {
    try {
      uiDir = await ensureUiBundle({
        version,
        onLog: (line) => log.ok(line),
      });
    } catch (e) {
      log.error(
        `Failed to fetch UI bundle: ${(e as Error).message}\n` +
          `  Try again or pass --ui-dir <path> with a locally-built bundle.`,
      );
      return 3;
    }
  }

  // 2. Build scan catalog → ApplyCatalog + pluginAgentsByName.
  let scanCatalog: Awaited<ReturnType<typeof buildScanCatalog>>;
  try {
    // dist/catalog.json ships in the tarball — read from tarballRoot, not
    // the fetched content root (which doesn't carry build artifacts).
    scanCatalog = await buildScanCatalog(tarballRoot);
  } catch (e) {
    log.error(`Failed to build catalog: ${(e as Error).message}`);
    return 1;
  }

  const applyCatalog = {
    // Workflow is a singleton (one AGENTS.md per project); we pick the
    // sentinel name "workflow" to match what the Web UI's Dashboard sends
    // and to remain semantically self-describing. The handler ignores the
    // name argument either way.
    workflow: new Set<string>(["workflow"]),
    skill: new Set<string>(Object.keys(scanCatalog.skills)),
    "recommended-skill": new Set<string>(
      Object.keys(scanCatalog.recommendedSkills),
    ),
    plugin: new Set<string>(Object.keys(scanCatalog.plugins)),
    // Preset is a singleton apply target — the sentinel name "preset"
    // matches what the Dashboard's preset button sends.
    preset: new Set<string>(["preset"]),
  };
  const pluginAgentsByName = new Map<string, ("claude" | "codex")[]>();
  for (const [name, def] of Object.entries(scanCatalog.plugins)) {
    pluginAgentsByName.set(name, def.agents);
  }
  const applyHandlers = buildDefaultApplyHandlers({
    // contentRoot: install handlers read workflow templates, marketplace
    // manifests, extra_plugin_configs.json, and skills-lock.json — all
    // CONTENT_FILES.
    // Routing them at tarballRoot fails ENOENT for npm-installed users.
    packageRoot: contentRoot,
    cwd,
    pluginAgentsByName,
  });

  // 3. Token: 32 bytes hex per spec §4.4.
  const token = randomBytes(32).toString("hex");

  // 4. Bind port: try requested → otherwise 4747..4756 in sequence.
  // Use `!== undefined` so `--port 0` (OS-ephemeral) is honored. `0` is
  // falsy in JS; `p.port ? [p.port] : range` would silently fall back to
  // the default range and break hermetic e2e isolation.
  const ports = p.port !== undefined
    ? [p.port]
    : Array.from({ length: UI_PORT_RANGE }, (_, i) => UI_DEFAULT_PORT + i);
  let server: Awaited<ReturnType<typeof startServer>> | null = null;
  let lastErr: Error | null = null;
  for (const port of ports) {
    try {
      server = await startServer({
        port,
        token,
        cwd,
        // server reads dist/catalog.json (tarball-shipped) via
        // buildScanCatalog on each /api/state call; install-time content
        // (workflow templates, marketplace manifests, extra plugin config, …)
        // was already injected into applyHandlers above with contentRoot.
        packageRoot: tarballRoot,
        heartbeatTimeoutMs: UI_HEARTBEAT_TIMEOUT_MS,
        applyHandlers,
        applyCatalog,
        uiDir,
      });
      break;
    } catch (e) {
      lastErr = e as Error;
      // Only swallow address-in-use; everything else propagates.
      if (!/EADDRINUSE|EACCES/i.test(lastErr.message)) {
        log.error(`Failed to start server on port ${port}: ${lastErr.message}`);
        return 1;
      }
    }
  }
  if (!server) {
    log.error(
      `All ports occupied in range (${ports[0]}..${ports[ports.length - 1]}). ` +
        `Try '--port <n>' or 'npx auriga-cli' for the TTY menu. Last error: ${lastErr?.message ?? "unknown"}`,
    );
    return 2;
  }

  // 5. URL + browser open.
  const url = `http://127.0.0.1:${server.port}/?token=${token}`;
  process.stdout.write(
    `\n${highlight("auriga UI is live:")}  ${url}\n` +
      `   (closing the browser shuts the server down after ~${Math.round(UI_HEARTBEAT_TIMEOUT_MS / 1000)}s of inactivity)\n` +
      `   Note: the URL contains a per-session token — don't paste it into chats, CI logs, or screenshots.\n\n`,
  );
  if (!p.noOpen) {
    await openBrowser(url);
  }

  // 6. Block until the server fully stops. The heartbeat closes it after
  //    UI_HEARTBEAT_TIMEOUT_MS without a /api/ping; SIGINT triggers an
  //    explicit close().
  const onSig = (): void => {
    void server!.close();
  };
  process.once("SIGINT", onSig);
  process.once("SIGTERM", onSig);
  try {
    await server.closed;
  } finally {
    process.off("SIGINT", onSig);
    process.off("SIGTERM", onSig);
  }
  return 0;
}

/** Best-effort cross-platform browser open. Failure is non-fatal — the
 *  printed URL is still actionable. */
async function openBrowser(url: string): Promise<void> {
  const opener: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const { spawn } = await import("node:child_process");
    const proc = spawn(opener[0], opener[1], {
      stdio: "ignore",
      detached: true,
    });
    proc.on("error", () => {
      /* swallow: URL was already printed */
    });
    proc.unref();
  } catch {
    /* swallow */
  }
}

/** Bold + cyan when stdout is a TTY; otherwise plain. */
function highlight(text: string): string {
  if (!process.stdout.isTTY || process.env.NO_COLOR) return text;
  return `\x1b[1;36m${text}\x1b[0m`;
}

// ---------------------------------------------------------------------------
// Legacy checkbox menu — preserved for `npx auriga-cli install` in TTY
// and `npx auriga-cli` with no args.
// ---------------------------------------------------------------------------

type LegacyMenuValue = "preset" | "recommended" | "plugins";

/**
 * The TUI's three menu items, in fixed order. Lifted to a module-level
 * constant so VAL-TUI-001 / VAL-TUI-002 can assert the "exactly 3 items /
 * order / default-checked" contract without driving inquirer.
 *
 * Workflow + Skills are absorbed by the「推荐预设」item.
 * The preset label spells out the silent defaults (scope user / agent
 * both / lang zh-CN) so a TTY user knows what they're getting — fine-tuning
 * those goes through the non-interactive `install --preset` flags.
 */
export const LEGACY_MENU_CHOICES: ReadonlyArray<{
  value: LegacyMenuValue;
  name: string;
  checked: boolean;
}> = [
  {
    value: "preset",
    name: "Recommended preset — AGENTS.md/CLAUDE.md + workflow skills + auriga-workflow plugin (scope user · agent both · lang zh-CN)",
    checked: true,
  },
  {
    value: "recommended",
    name: "Optional skills — opt-in utility skills (claude-code-agent, codex-agent...)",
    checked: false,
  },
  {
    value: "plugins",
    name: "Other plugins — everything except auriga-workflow (auriga-notify, skill-creator, codex...)",
    checked: false,
  },
];

async function runLegacyMenu(): Promise<number> {
  // Lazy-load TTY-only deps so the non-interactive code path doesn't
  // force inquirer / printBanner / withEsc into the module graph.
  const { checkbox } = await import("@inquirer/prompts");
  const { printBanner, withEsc } = await import("./utils.js");

  const version = readPackageVersion();
  printBanner(version);
  console.log("");

  if (process.env.DEV === "1") {
    console.log("Using local content (DEV mode)\n");
  } else {
    console.log("Fetching latest content from GitHub...");
  }
  const packageRoot = await fetchContentRoot();
  if (process.env.DEV !== "1") console.log("");

  const picks = await withEsc(checkbox<LegacyMenuValue>({
    message: "Select what to install:",
    choices: LEGACY_MENU_CHOICES.map((c) => ({
      name: c.name,
      value: c.value,
      checked: c.checked,
    })),
  }));

  if (picks.length === 0) {
    console.log("Nothing selected. Bye!");
    return 0;
  }

  // 「推荐预设」silently uses the preset defaults (scope user / agent
  // both / lang zh-CN) — it does not prompt for them. The other two items
  // drill down into their category's per-item sub-selection as before.
  if (picks.includes("preset")) {
    console.log("\n--- Recommended preset ---\n");
    await installPreset(packageRoot, {
      interactive: true,
      scope: "user",
      agent: "both",
      lang: DEFAULT_WORKFLOW_LANG,
    });
  }
  if (picks.includes("recommended")) {
    console.log("\n--- Optional skills ---\n");
    await installRecommendedSkills(packageRoot, { interactive: true });
  }
  if (picks.includes("plugins")) {
    console.log("\n--- Other plugins ---\n");
    await installPlugins(packageRoot, {
      interactive: true,
      // auriga-workflow is already covered by the preset — keep it out
      // of this sub-selection (VAL-TUI-005).
      excludePlugins: ["auriga-workflow"],
    });
  }

  console.log("\n✨ Installation complete!\n");
  return 0;
}

// ---------------------------------------------------------------------------
// Script entrypoint
// ---------------------------------------------------------------------------

// Guard keeps `main()` from auto-running when a test imports this
// module. `.endsWith("cli.js")` looks simple but breaks for the
// canonical install surface: `npm install -g` / `npx` create a symlink
// at `node_modules/.bin/auriga-cli → .../dist/cli.js`, and the kernel
// passes the symlink path (basename `auriga-cli`, no `cli.js` suffix)
// as argv[1]. Under that check the CLI silently becomes a no-op.
// Compare realpaths instead — argv[1]'s symlink resolves to the real
// dist/cli.js, which matches `import.meta.url`'s file path exactly.
const invokedAsScript = (() => {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  main(process.argv.slice(2))
    .then((code) => { if (code !== 0) process.exit(code); })
    .catch((err) => {
      if (err instanceof Error && ["ExitPromptError", "CancelPromptError"].includes(err.name)) {
        console.log("\nCancelled.");
        process.exit(0);
      }
      console.error(err);
      process.exit(1);
    });
}
