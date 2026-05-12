import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkbox, select } from "@inquirer/prompts";
import { atomicWriteFile, exec, execAsync, log, withEsc } from "./utils.js";
import type { InstallOpts, SkillEntry, SkillsLock } from "./utils.js";

// Curated default-on set: skills that the workflow in the root CLAUDE.md
// directly references. Anything else in skills-lock.json is surfaced via
// installRecommendedSkills as an opt-in utility.
export const WORKFLOW_SKILLS = [
  "brainstorming",
  "parallel-implementation",
  "planning-with-files",
  "playwright-cli",
  "session-compound",
  "systematic-debugging",
  "test-designer",
  "test-driven-development",
  "verification-before-completion",
];

// Skill names and npm-style sources are interpolated into the shell
// command we hand to `exec()`. The lock file is fetched from raw GitHub
// at runtime, so every value must pass a conservative whitelist before
// we compose the command. Without this a compromised skills-lock.json
// would execute arbitrary commands via shell metachar injection.
const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SKILL_SOURCE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;

export function validateSkillsLock(raw: unknown): asserts raw is SkillsLock {
  if (!raw || typeof raw !== "object") {
    throw new Error("skills-lock.json: root must be an object");
  }
  const lock = raw as Record<string, unknown>;
  if (!lock.skills || typeof lock.skills !== "object") {
    throw new Error("skills-lock.json: .skills must be an object");
  }
  for (const [name, entry] of Object.entries(lock.skills as Record<string, unknown>)) {
    if (!SKILL_NAME_RE.test(name)) {
      throw new Error(`skills-lock.json: skill name ${JSON.stringify(name)} does not match ${SKILL_NAME_RE}`);
    }
    if (!entry || typeof entry !== "object") {
      throw new Error(`skills-lock.json: .skills[${name}] must be an object`);
    }
    const src = (entry as Record<string, unknown>).source;
    if (typeof src !== "string" || !SKILL_SOURCE_RE.test(src)) {
      throw new Error(
        `skills-lock.json: .skills[${name}].source ${JSON.stringify(src)} does not match ${SKILL_SOURCE_RE}`,
      );
    }
  }
}

function loadLock(packageRoot: string): SkillsLock {
  const raw: unknown = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "skills-lock.json"), "utf-8"),
  );
  validateSkillsLock(raw);
  return raw;
}

// Deterministic: selection order is preserved; the first occurrence of
// each source fixes its position in the returned array.
export function planSkillInstallCommands(
  selected: string[],
  lock: SkillsLock["skills"],
  globalFlag: string,
): { source: string; skills: string[]; command: string }[] {
  const bySource = new Map<string, string[]>();
  for (const name of selected) {
    const entry = lock[name];
    if (!entry) continue;
    const bucket = bySource.get(entry.source);
    if (bucket) bucket.push(name);
    else bySource.set(entry.source, [name]);
  }

  return [...bySource].map(([source, skills]) => ({
    source,
    skills,
    command: `npx -y skills add ${source}${globalFlag} --skill ${skills.join(" ")} --agent claude-code codex --yes`,
  }));
}

async function installSelected(
  entries: [string, SkillEntry][],
  defaultChecked: boolean,
  opts: InstallOpts,
): Promise<void> {
  if (entries.length === 0) {
    log.warn("No skills found");
    return;
  }

  // scope mapping: spec §5.5 — outer `user` → internal `global`.
  type Scope = "project" | "global";
  const scope: Scope = opts.interactive
    ? await withEsc(select<Scope>({
      message: "Skills installation scope:",
      choices: [
        { name: "Project (current directory)", value: "project" },
        { name: "Global (user-level)", value: "global" },
      ],
    }))
    : opts.scope === "user" ? "global" : "project";

  const availableNames = entries.map(([name]) => name);
  const selected = opts.interactive
    ? await withEsc(checkbox({
      message: "Select skills to install:",
      choices: entries.map(([name, entry]) => ({
        name: `${name} (${entry.source})`,
        value: name,
        checked: defaultChecked,
      })),
    }))
    : resolveSelected(opts.selected, availableNames);

  if (selected.length === 0) {
    log.skip("No skills selected");
    return;
  }

  const globalFlag = scope === "global" ? " -g" : "";
  const lock = Object.fromEntries(entries);
  const batches = planSkillInstallCommands(selected, lock, globalFlag);

  const failures: string[] = [];
  for (const batch of batches) {
    console.log(`\nInstalling ${batch.skills.join(", ")} from ${batch.source}...`);
    try {
      if (opts.onLog) {
        // Web UI / non-TTY path — stream stdout/stderr through the per-line
        // callback so SSE subscribers see install progress in real time
        // (spec §6.4).
        opts.onLog(`▸ ${batch.command}`, "stdout");
        await execAsync(batch.command, { onLine: opts.onLog });
      } else {
        exec(batch.command, { inherit: true });
      }
      for (const name of batch.skills) log.ok(`${name}: installed`);
    } catch {
      log.error(`${batch.source}: failed to install (${batch.skills.join(", ")})`);
      failures.push(batch.source);
    }
  }
  if (failures.length > 0 && !opts.interactive) {
    throw new Error(
      `${failures.length} skill batch(es) failed: ${failures.join(", ")}`,
    );
  }
}

/**
 * Resolves the non-interactive `opts.selected` filter against the set
 * of names available in the current category. Semantics match spec
 * §3.2: `undefined` = all; `["*"]` = all; any other list = that list.
 * The CLI parser is responsible for rejecting unknown names up-front
 * (so installers can trust the list).
 */
function resolveSelected(
  selected: string[] | undefined,
  available: string[],
): string[] {
  if (!selected || (selected.length === 1 && selected[0] === "*")) {
    return available;
  }
  return selected;
}

export async function installSkills(
  packageRoot: string,
  opts: InstallOpts,
): Promise<void> {
  const lock = loadLock(packageRoot);
  const entries = Object.entries(lock.skills).filter(
    ([name]) => WORKFLOW_SKILLS.includes(name),
  );
  await installSelected(entries, true, opts);
}

export async function installRecommendedSkills(
  packageRoot: string,
  opts: InstallOpts,
): Promise<void> {
  const lock = loadLock(packageRoot);
  const entries = Object.entries(lock.skills).filter(
    ([name]) => !WORKFLOW_SKILLS.includes(name),
  );
  await installSelected(entries, false, opts);
}

// --- Uninstall ----------------------------------------------------------------

/**
 * Detect "unknown subcommand" style failures from the upstream
 * `npx skills` CLI so we can fall back to the manual cleanup path.
 *
 * Substring match instead of a strict regex: the upstream tool's error
 * wording varies across versions (`Unknown command remove`,
 * `unrecognized command 'remove'`, `error: invalid argument 'remove'`).
 * We keep the filter broad so a CLI rename doesn't lock the fallback
 * shut on the next minor release; safer to fall back on a recognized
 * not-supported signal than to mask a different failure mode.
 *
 * If the upstream CLI ever stops emitting the substring `remove` in its
 * "unsupported subcommand" path, this check will incorrectly propagate
 * the error instead of falling back — at that point the user gets a
 * loud failure (good), and we tighten the matcher.
 */
function isSkillsRemoveUnsupported(err: unknown): boolean {
  const text = err instanceof Error
    ? `${err.message}\n${(err as Error & { stderr?: string }).stderr ?? ""}`
    : String(err);
  return /unknown command|unrecognized command|invalid argument|unknown option|unsupported/i.test(text)
    && /remove/i.test(text);
}

const SKILL_NAME_RE_STRICT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Uninstall a single skill by name. Strategy:
 *   1. Try `npx -y skills remove <name>` (the canonical path; future-proof
 *      against upstream-internal cleanup we don't know about).
 *   2. If the CLI doesn't support `remove`, fall back to manual cleanup:
 *      - rm `<cwd>/.claude/skills/<name>` (Claude Code view)
 *      - rm `<cwd>/.agents/skills/<name>` (Codex / other agents view)
 *      - remove the entry from `<cwd>/skills-lock.json` if present
 *
 * Idempotent: missing files / unknown skill names are no-ops, NOT errors.
 * A repeated uninstall must succeed silently so the SSE caller can replay
 * the request without special-casing.
 */
export async function uninstallSkill(
  name: string,
  opts: {
    cwd: string;
    scope?: "project" | "user";
    onLog?: (line: string) => void;
  },
): Promise<void> {
  // Defensive: the CLI parser pre-validates skill names against the
  // catalog before dispatch, but the server route doesn't, and we
  // interpolate `name` into a shell command + filesystem path. Reject
  // anything that didn't pass the install-side regex so a malformed
  // input can't escape via either vector.
  if (!SKILL_NAME_RE_STRICT.test(name)) {
    throw new Error(`uninstallSkill: invalid skill name ${JSON.stringify(name)}`);
  }

  const cwd = path.resolve(opts.cwd);
  const scope = opts.scope ?? "project";
  // Install side maps outer `user` → internal `-g` (global). Mirror that
  // on remove so user-scope skills aren't silently no-op'd.
  const globalFlag = scope === "user" ? " -g" : "";
  const emit = (line: string): void => {
    opts.onLog?.(line);
  };

  try {
    exec(`npx -y skills remove ${name}${globalFlag}`, { cwd });
    log.ok(`${name}: removed via skills CLI`);
    emit(`removed ${name} via skills CLI`);
    return;
  } catch (err) {
    if (!isSkillsRemoveUnsupported(err)) {
      throw err;
    }
    log.warn(`skills CLI doesn't support 'remove'; falling back to manual cleanup`);
    emit(`skills CLI doesn't support 'remove'; falling back to manual cleanup`);
  }

  await uninstallSkillManual(name, cwd, emit, scope);
}

/**
 * Manual fallback used when `npx skills remove` is unavailable. Exported
 * for test coverage (the exec-success path doesn't exercise it).
 *
 * Steps (each idempotent):
 *   - rm-rf `<cwd>/.claude/skills/<name>` if present
 *   - rm-rf `<cwd>/.agents/skills/<name>` if present
 *   - update `<cwd>/skills-lock.json` (drop the `.skills[name]` key,
 *     atomic write) if present and the key exists
 */
export async function uninstallSkillManual(
  name: string,
  cwd: string,
  onLog?: (line: string) => void,
  scope: "project" | "user" = "project",
): Promise<void> {
  if (!SKILL_NAME_RE_STRICT.test(name)) {
    throw new Error(`uninstallSkillManual: invalid skill name ${JSON.stringify(name)}`);
  }
  const emit = (line: string): void => { onLog?.(line); };

  // User scope cleans `~/.claude/skills/<name>` + `~/.agents/skills/<name>`.
  // Project scope cleans `<cwd>/.claude/...` + `<cwd>/.agents/...`.
  // The lockfile is per-project; user-scope uninstall never mutates it.
  const baseDir = scope === "user" ? os.homedir() : cwd;
  const claudeDir = path.join(baseDir, ".claude", "skills", name);
  const agentsDir = path.join(baseDir, ".agents", "skills", name);

  for (const [label, dir] of [
    [".claude/skills", claudeDir] as const,
    [".agents/skills", agentsDir] as const,
  ]) {
    if (fs.existsSync(dir) || fs.lstatSync(dir, { throwIfNoEntry: false })) {
      fs.rmSync(dir, { recursive: true, force: true });
      log.ok(`${label}/${name} removed`);
      emit(`removed ${label}/${name}`);
    } else {
      log.skip(`${label}/${name} not present`);
    }
  }

  if (scope === "user") {
    // No `~/skills-lock.json` to mutate.
    return;
  }

  const lockPath = path.join(cwd, "skills-lock.json");
  if (!fs.existsSync(lockPath)) {
    emit(`skills-lock.json not present`);
    return;
  }

  // Read + validate so we don't silently corrupt a hand-edited lockfile.
  // If the user damaged it before calling us, throw — the install side's
  // contract is "lockfile is authoritative", and writing back a partial
  // tree would amplify their damage.
  const raw: unknown = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
  validateSkillsLock(raw);

  if (!(name in raw.skills)) {
    emit(`${name} not in skills-lock.json`);
    return;
  }

  // Build a shallow copy so we don't mutate `raw` in case the caller
  // holds a reference. Object spread preserves insertion order of
  // remaining keys (deterministic test output).
  const nextSkills = { ...raw.skills };
  delete nextSkills[name];
  const next = { ...raw, skills: nextSkills };
  atomicWriteFile(lockPath, JSON.stringify(next, null, 2) + "\n");
  log.ok(`${name} removed from skills-lock.json`);
  emit(`removed ${name} from skills-lock.json`);
}
