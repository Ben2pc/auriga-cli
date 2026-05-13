import fs from "node:fs";
import path from "node:path";
import { input, select } from "@inquirer/prompts";
import {
  LANGUAGES,
  fetchExtraContent,
  log,
  withEsc,
  type InstallOpts,
} from "./utils.js";

export async function installWorkflow(
  packageRoot: string,
  opts: InstallOpts,
): Promise<void> {
  const lang = opts.interactive
    ? await withEsc(select({
      message: "CLAUDE.md language:",
      choices: LANGUAGES.map((l) => ({ name: l.label, value: l.value })),
      default: "en",
    }))
    : (opts.lang ?? "en");

  const targetDir = opts.interactive
    ? await withEsc(input({
      message: "Workflow install target directory:",
      default: process.cwd(),
    }))
    : (opts.cwd ?? process.cwd());

  const resolved = path.resolve(targetDir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    const msg = `Not a valid directory: ${resolved}`;
    if (opts.interactive) { log.error(msg); return; }
    throw new Error(msg);
  }

  const langOpt = LANGUAGES.find((l) => l.value === lang)!;

  // Lazy fetch: only download non-default language file when needed
  if (langOpt.file !== "CLAUDE.md") {
    console.log(`Fetching ${langOpt.label} template...`);
    await fetchExtraContent(packageRoot, langOpt.file);
  }

  const sourceClaude = path.join(packageRoot, langOpt.file);
  const targetClaude = path.join(resolved, "CLAUDE.md");
  const targetAgents = path.join(resolved, "AGENTS.md");

  // Back up an existing CLAUDE.md before overwriting, but never clobber
  // a prior .bak.
  //
  // Two regressions to defend against:
  // 1. F1 (v1.19.0 Slice 0): re-install is the update path now, so a
  //    second install must not overwrite the user's pre-auriga .bak with
  //    our previous workflow version.
  // 2. Codex adversarial review: if the user later replaces an
  //    auriga-managed CLAUDE.md with foreign content (hand-paste, manual
  //    edits, etc.) and re-runs install, the foreign content must NOT
  //    be silently overwritten just because .bak already exists.
  //
  // Strategy: only consider the file "safe to overwrite without backup"
  // when its bytes match the packaged source (i.e. it's the workflow we
  // installed last time, untouched). Otherwise capture it — to .bak when
  // free, else to a timestamped slot so .bak stays canonical.
  if (fs.existsSync(targetClaude)) {
    const currentBytes = fs.readFileSync(targetClaude);
    const sourceBytes = fs.readFileSync(sourceClaude);
    const diverged = !currentBytes.equals(sourceBytes);
    if (diverged) {
      const bakPath = targetClaude + ".bak";
      if (fs.existsSync(bakPath)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const stampedPath = `${bakPath}.${stamp}`;
        fs.copyFileSync(targetClaude, stampedPath);
        log.warn(
          `CLAUDE.md.bak already exists; current CLAUDE.md backed up to ${path.basename(stampedPath)}`,
        );
      } else {
        fs.copyFileSync(targetClaude, bakPath);
        log.warn(`Existing CLAUDE.md backed up to CLAUDE.md.bak`);
      }
    }
  }

  fs.copyFileSync(sourceClaude, targetClaude);
  log.ok(`CLAUDE.md copied (${langOpt.label})`);

  // Create AGENTS.md symlink
  try {
    fs.lstatSync(targetAgents);
    fs.unlinkSync(targetAgents);
  } catch {
    // does not exist, proceed
  }
  fs.symlinkSync("CLAUDE.md", targetAgents);
  log.ok("AGENTS.md -> CLAUDE.md symlink created");
}

/**
 * Uninstall the workflow (CLAUDE.md + AGENTS.md) from `opts.cwd`.
 *
 * Safety contract:
 * - `opts.force` MUST be true. The CLI / server caller is responsible for
 *   confirming user intent BEFORE invoking this; we refuse otherwise.
 * - `AGENTS.md` is removed ONLY if it's a symlink (the install-time shape).
 *   A real-file AGENTS.md is left in place with a warning — the user has
 *   diverged from the install pattern and probably hand-edited it.
 * - Missing files are a no-op: callers can re-run uninstall idempotently.
 * - `.claude/` is not touched; skills / plugins / hooks have their own
 *   uninstall paths.
 *
 * `onLog`, when provided, receives one human-readable line per action so
 * the SSE caller (server.ts) can stream progress to the browser. Internal
 * `log.ok / warn / error` calls still go to stderr for the CLI path.
 */
export async function uninstallWorkflow(
  opts: { force?: boolean; cwd: string; onLog?: (line: string) => void },
): Promise<void> {
  if (opts.force !== true) {
    throw new Error("workflow uninstall requires force=true");
  }

  const resolved = path.resolve(opts.cwd);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Not a valid directory: ${resolved}`);
  }

  const emit = (line: string): void => {
    opts.onLog?.(line);
  };

  const targetClaude = path.join(resolved, "CLAUDE.md");
  const targetAgents = path.join(resolved, "AGENTS.md");

  // CLAUDE.md — flat file. lstat to avoid following a symlink (would be
  // unusual but we'd rather refuse to traverse than chase one out).
  if (fs.existsSync(targetClaude)) {
    fs.unlinkSync(targetClaude);
    log.ok("CLAUDE.md removed");
    emit("removed CLAUDE.md");
  } else {
    log.skip("CLAUDE.md not present");
    emit("CLAUDE.md not present");
  }

  // AGENTS.md — only remove symlinks (our install shape). lstatSync
  // refuses to follow the link so we inspect the link itself.
  try {
    const stat = fs.lstatSync(targetAgents);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(targetAgents);
      log.ok("AGENTS.md symlink removed");
      emit("removed AGENTS.md symlink");
    } else {
      // Real file (or directory) — user diverged from install. Don't
      // silently destroy their content; warn and leave it.
      log.warn("AGENTS.md is not a symlink; left in place");
      emit("AGENTS.md is not a symlink; left in place");
    }
  } catch {
    // ENOENT — already gone, idempotent no-op.
    log.skip("AGENTS.md not present");
    emit("AGENTS.md not present");
  }
}
