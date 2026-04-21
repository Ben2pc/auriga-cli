#!/usr/bin/env node

import { createRequire } from "node:module";
import {
  exec,
  fetchContentRoot,
  isNonInteractive,
  LANGUAGES,
  log,
  type InstallOpts,
} from "./utils.js";
import { installWorkflow } from "./workflow.js";
import { installSkills, installRecommendedSkills } from "./skills.js";
import { installPlugins } from "./plugins.js";
import { installHooks } from "./hooks.js";
import { loadCatalog } from "./catalog.js";
import { renderHelp } from "./help.js";
import { renderGuide } from "./guide.js";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// parseArgs — pure argv parser (spec §3.5 / §5.2)
// ---------------------------------------------------------------------------

export type CategoryName = "workflow" | "skills" | "recommended" | "plugins" | "hooks";

export interface InstallParsed {
  all: boolean;
  type?: CategoryName;
  filter?: string[];
  lang?: string;
  cwd?: string;
  scope?: "project" | "user";
}

export type ParsedArgs =
  | { command: "help" }
  | { command: "version" }
  | { command: "guide" }
  | { command: "install"; install: InstallParsed };

const CATEGORY_SET = new Set<CategoryName>([
  "workflow",
  "skills",
  "recommended",
  "plugins",
  "hooks",
]);

const FILTER_FOR_TYPE = {
  skills: "--skill",
  recommended: "--recommended-skill",
  plugins: "--plugin",
  hooks: "--hook",
} as const;

const TYPE_FOR_FILTER = {
  "--skill": "skills",
  "--recommended-skill": "recommended",
  "--plugin": "plugins",
  "--hook": "hooks",
} as const;

function parseErr(msg: string): never {
  throw new Error(msg);
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
  if (argv.length === 0) return { command: "help" };
  const head = argv[0];
  if (head === "--help" || head === "-h" || head === "help") return { command: "help" };
  if (head === "--version" || head === "-v") return { command: "version" };
  if (head === "guide") {
    if (argv.length > 1) {
      parseErr("guide takes no arguments. Run 'npx auriga-cli --help' for usage.");
    }
    return { command: "guide" };
  }
  if (head !== "install") {
    parseErr(`unknown argument '${head}'. Run 'npx auriga-cli --help' for usage.`);
  }

  return { command: "install", install: parseInstall(argv.slice(1)) };
}

function parseInstall(argv: string[]): InstallParsed {
  const out: InstallParsed = { all: false };
  let filterFlag: keyof typeof TYPE_FOR_FILTER | null = null;

  let i = 0;
  while (i < argv.length) {
    const t = argv[i];

    if (t === "--all") {
      out.all = true;
      i += 1;
      continue;
    }

    if (t === "--lang") {
      out.lang = argv[i + 1];
      i += 2;
      continue;
    }
    if (t === "--cwd") {
      out.cwd = argv[i + 1];
      i += 2;
      continue;
    }
    if (t === "--scope") {
      out.scope = argv[i + 1] as "project" | "user";
      i += 2;
      continue;
    }

    if (t in TYPE_FOR_FILTER) {
      const [values, next] = consumeFilter(argv, i + 1);
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
  // Rule 2: --all is atomic.
  if (out.all) {
    if (out.type || out.filter || out.lang !== undefined || out.cwd !== undefined) {
      parseErr("--all is atomic; no extra types or filters allowed.");
    }
    // --all may combine with --scope.
    if (out.scope !== undefined) validateScopeValue(out.scope);
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
  if (out.scope !== undefined) {
    if (out.type === "workflow" || out.type === "hooks") {
      parseErr("--scope only applies to skills / recommended / plugins.");
    }
    validateScopeValue(out.scope);
  }

  // Value validation for workflow.
  if (out.type === "workflow" && out.lang !== undefined) {
    const valid = LANGUAGES.map((l) => l.value);
    if (!valid.includes(out.lang)) {
      parseErr(`unknown language '${out.lang}'; available: ${valid.join(", ")}`);
    }
  }
  if (out.type === "workflow" && out.cwd !== undefined) {
    const fs = require("node:fs");
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
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const pkgRoot = getPackageRootSync();
  const catalogPath = path.join(pkgRoot, "dist", "catalog.json");
  if (!fs.existsSync(catalogPath)) return; // build artifact missing — defer to runtime error
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
  const bucket =
    type === "skills" ? catalog.workflowSkills
    : type === "recommended" ? catalog.recommendedSkills
    : type === "plugins" ? catalog.plugins
    : type === "hooks" ? catalog.hooks
    : null;
  if (!bucket) return;
  const available = bucket.map((e: { name: string }) => e.name);
  const singular = type === "recommended" ? "recommended skill"
    : type === "skills" ? "skill"
    : type.replace(/s$/, "");
  for (const name of filter) {
    if (!available.includes(name)) {
      parseErr(`unknown ${singular} '${name}'; available: ${available.join(", ")}`);
    }
  }
}

function getPackageRootSync(): string {
  // Mirror utils.ts getPackageRoot but inlined so parseArgs stays purely
  // synchronous — utils' other exports pull in runtime dependencies.
  const path = require("node:path") as typeof import("node:path");
  const url = require("node:url") as typeof import("node:url");
  const here = url.fileURLToPath(import.meta.url);
  // dist/cli.js or dist-test/src/cli.js → walk up to package root.
  let dir = path.dirname(here);
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, "package.json");
    try {
      const fs = require("node:fs") as typeof import("node:fs");
      if (fs.existsSync(candidate)) {
        const pkg = JSON.parse(fs.readFileSync(candidate, "utf-8"));
        if (pkg.name === "auriga-cli") return dir;
      }
    } catch { /* ignore */ }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function validateScopeValue(scope: string): void {
  if (scope !== "project" && scope !== "user") {
    parseErr(`unknown --scope value '${scope}'; expected 'project' or 'user'.`);
  }
}

// ---------------------------------------------------------------------------
// main — returns exit code (spec §5.3.1 / §7)
// ---------------------------------------------------------------------------

type Category = "workflow" | "skills" | "recommended" | "plugins" | "hooks";

const ALL_CATEGORIES: Category[] = ["workflow", "skills", "plugins", "hooks"];

function readVersion(): string {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const pkg = JSON.parse(fs.readFileSync(path.join(getPackageRootSync(), "package.json"), "utf-8"));
  return pkg.version as string;
}

export async function main(argv: string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 1;
  }

  const version = readVersion();

  if (parsed.command === "help") {
    // `--help` is a detail view; print full catalog.
    try {
      const root = isNonInteractive() || process.env.DEV === "1"
        ? process.cwd()
        : await fetchContentRoot();
      // The catalog lives under the package (dist/catalog.json), not
      // the fetch root, so we point loadCatalog at the package root.
      const pkgRoot = require("./utils.js").getPackageRoot();
      const catalog = loadCatalog(pkgRoot);
      process.stdout.write(renderHelp(catalog, version));
      // `root` isn't actually used for help — keeping the fetch for
      // parity with future callers that might want it.
      void root;
      return 0;
    } catch (e) {
      process.stderr.write(`${(e as Error).message}\n`);
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

  // install
  return runInstall(parsed.install);
}

async function runInstall(p: InstallParsed): Promise<number> {
  // Bare `install` (no type, no --all, no filter): TTY → menu, non-TTY → exit 1.
  if (!p.all && !p.type) {
    if (isNonInteractive()) {
      process.stderr.write(
        "Interactive mode requires a TTY. Run 'npx auriga-cli --help' for non-interactive options.\n",
      );
      return 1;
    }
    return runLegacyMenu();
  }

  // --all: precheck + fan-out.
  if (p.all) {
    return runAll(p);
  }

  // Single-category install.
  return runSingle(p);
}

/**
 * Precheck external prerequisites before touching any files.
 * Returns null if OK, or an error message.
 */
function precheckExternal(need: Category[]): string | null {
  if (need.includes("plugins")) {
    try { exec("which claude"); }
    catch { return "'claude' CLI not in PATH. Install Claude Code first (https://docs.claude.com/claude-code), then re-run."; }
  }
  return null;
}

/**
 * Resolve a filter list through the catalog for a specific category.
 * Returns the validated list, or throws with a helpful message.
 */
function validateFilter(
  category: Category,
  filter: string[] | undefined,
  available: string[],
): string[] | undefined {
  if (!filter) return undefined;
  if (filter.length === 1 && filter[0] === "*") return undefined;
  const known = new Set(available);
  for (const name of filter) {
    if (!known.has(name)) {
      const categoryKey = category === "recommended" ? "recommended skill" : category.replace(/s$/, "");
      throw new Error(`unknown ${categoryKey} '${name}'; available: ${available.join(", ")}`);
    }
  }
  return filter;
}

async function runAll(p: InstallParsed): Promise<number> {
  const pre = precheckExternal(["plugins"]);
  if (pre) {
    process.stderr.write(`${pre}\n`);
    return 1;
  }

  const packageRoot = await fetchContentRoot();
  const status: { category: Category; ok: boolean; err?: string }[] = [];

  for (const category of ALL_CATEGORIES) {
    const opts: InstallOpts = {
      interactive: false,
      scope: p.scope ?? "project",
    };
    try {
      await dispatchInstaller(category, packageRoot, opts);
      status.push({ category, ok: true });
    } catch (e) {
      status.push({ category, ok: false, err: (e as Error).message });
    }
  }

  // Report per-category status to stderr.
  for (const s of status) {
    if (s.ok) {
      process.stderr.write(`[OK]   ${s.category}\n`);
    } else {
      process.stderr.write(`[FAIL] ${s.category} — ${s.err}\n`);
    }
  }

  const failed = status.filter((s) => !s.ok);
  if (failed.length === 0) {
    process.stderr.write(
      "\n⚠ Reload your Claude Code session to pick up the new harness (CLAUDE.md / skills / plugins are loaded at session startup).\n",
    );
    return 0;
  }

  process.stderr.write("\nRetry:\n");
  for (const s of failed) {
    process.stderr.write(`  npx auriga-cli install ${s.category}\n`);
  }
  return 2;
}

async function runSingle(p: InstallParsed): Promise<number> {
  const category = p.type as Category;
  const pre = precheckExternal(category === "plugins" ? ["plugins"] : []);
  if (pre) {
    process.stderr.write(`${pre}\n`);
    return 1;
  }

  const pkgRoot = require("./utils.js").getPackageRoot();

  // Catalog-backed filter validation.
  let filter = p.filter;
  try {
    const cat = loadCatalog(pkgRoot);
    if (category === "skills") filter = validateFilter("skills", p.filter, cat.workflowSkills.map((e) => e.name));
    else if (category === "recommended") filter = validateFilter("recommended", p.filter, cat.recommendedSkills.map((e) => e.name));
    else if (category === "plugins") filter = validateFilter("plugins", p.filter, cat.plugins.map((e) => e.name));
    else if (category === "hooks") filter = validateFilter("hooks", p.filter, cat.hooks.map((e) => e.name));
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 1;
  }

  const packageRoot = await fetchContentRoot();
  const opts: InstallOpts = {
    interactive: false,
    lang: p.lang,
    cwd: p.cwd,
    scope: p.scope ?? "project",
    selected: filter,
  };

  try {
    await dispatchInstaller(category, packageRoot, opts);
    process.stderr.write(
      "\n⚠ Reload your Claude Code session to pick up the new harness (CLAUDE.md / skills / plugins are loaded at session startup).\n",
    );
    return 0;
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 1;
  }
}

async function dispatchInstaller(
  category: Category,
  packageRoot: string,
  opts: InstallOpts,
): Promise<void> {
  switch (category) {
    case "workflow": return installWorkflow(packageRoot, opts);
    case "skills": return installSkills(packageRoot, opts);
    case "recommended": return installRecommendedSkills(packageRoot, opts);
    case "plugins": return installPlugins(packageRoot, opts);
    case "hooks": return installHooks(packageRoot, opts);
  }
}

// ---------------------------------------------------------------------------
// Legacy checkbox menu — preserved for `npx auriga-cli install` in TTY
// and `npx auriga-cli` with no args.
// ---------------------------------------------------------------------------

async function runLegacyMenu(): Promise<number> {
  // Lazy-load TTY-only deps so the non-interactive code path doesn't
  // force inquirer / printBanner / withEsc into the module graph.
  const { checkbox } = await import("@inquirer/prompts");
  const { printBanner, withEsc } = await import("./utils.js");

  const version = readVersion();
  printBanner(version);
  console.log("");

  if (process.env.DEV === "1") {
    console.log("Using local content (DEV mode)\n");
  } else {
    console.log("Fetching latest content from GitHub...");
  }
  const packageRoot = await fetchContentRoot();
  if (process.env.DEV !== "1") console.log("");

  const moduleTypes = await withEsc(checkbox({
    message: "Select module types to install:",
    choices: [
      { name: "Workflow — CLAUDE.md + AGENTS.md", value: "workflow" as const, checked: true },
      { name: "Skills — Development process skills (brainstorming, TDD, debugging...)", value: "skills" as const, checked: true },
      { name: "Recommended Skills — Extra utility skills (claude-code-agent, codex-agent...)", value: "recommended" as const, checked: true },
      { name: "Plugins — Claude Code plugins (skill-creator, claude-md-management, codex...)", value: "plugins" as const, checked: true },
      { name: "Hooks — Claude Code hooks (notifications, etc.)", value: "hooks" as const, checked: true },
    ],
  }));

  if (moduleTypes.length === 0) {
    console.log("Nothing selected. Bye!");
    return 0;
  }

  const interactiveOpts: InstallOpts = { interactive: true };

  if (moduleTypes.includes("workflow")) {
    console.log("\n--- Workflow ---\n");
    await installWorkflow(packageRoot, interactiveOpts);
  }
  if (moduleTypes.includes("skills")) {
    console.log("\n--- Skills ---\n");
    await installSkills(packageRoot, interactiveOpts);
  }
  if (moduleTypes.includes("recommended")) {
    console.log("\n--- Recommended Skills ---\n");
    await installRecommendedSkills(packageRoot, interactiveOpts);
  }
  if (moduleTypes.includes("plugins")) {
    console.log("\n--- Plugins ---\n");
    await installPlugins(packageRoot, interactiveOpts);
  }
  if (moduleTypes.includes("hooks")) {
    console.log("\n--- Hooks ---\n");
    await installHooks(packageRoot, interactiveOpts);
  }

  console.log("\n✨ Installation complete!\n");
  return 0;
}

// ---------------------------------------------------------------------------
// Script entrypoint
// ---------------------------------------------------------------------------

const invokedAsScript = process.argv[1]
  && process.argv[1].endsWith("cli.js");

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

void log;
