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
import {
  composeMarkedFile,
  hasAurigaHeader,
  hashBlock,
  parseMarkers,
} from "./workflow-markers.js";

/**
 * Back up `filePath` once. The canonical `<file>.bak` slot is reserved for the
 * FIRST capture (the user's pre-auriga original) and is never overwritten — a
 * later capture spills to a timestamped `<file>.bak.<stamp>`. Returns the path
 * the backup was written to.
 *
 * `verbatimSymlinks` copies a symlink AS a symlink, preserving its literal
 * (possibly relative) target — a foreign AGENTS.md may be a symlink pointing
 * elsewhere, and we want the backup to preserve that target verbatim rather
 * than snapshot whatever it currently resolves to. A real file (CLAUDE.md)
 * copies as a real file. `lstat` (not `existsSync`) probes the `.bak` slot so
 * a backup that is itself a possibly-broken symlink still counts as present
 * and is not silently overwritten.
 */
function backupOnce(filePath: string): string {
  const bakPath = filePath + ".bak";
  let bakExists = true;
  try {
    fs.lstatSync(bakPath);
  } catch {
    bakExists = false;
  }
  const dest = bakExists
    ? `${bakPath}.${new Date().toISOString().replace(/[:.]/g, "-")}`
    : bakPath;
  fs.cpSync(filePath, dest, { verbatimSymlinks: true });
  return dest;
}

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

  // The packaged template is authored with managed-block markers. Extract its
  // managed block (the auriga workflow body) and its user-region placeholder.
  // Defensive fallback: if the template somehow lacks markers, treat the whole
  // file as the managed block with an empty user region.
  const sourceContent = fs.readFileSync(sourceClaude, "utf8");
  const sourceParsed = parseMarkers(sourceContent);
  const sourceBlock =
    sourceParsed.kind === "marked"
      ? sourceParsed.blockBody
      : sourceContent.endsWith("\n")
        ? sourceContent
        : sourceContent + "\n";
  const templateUserRegion =
    sourceParsed.kind === "marked" ? sourceParsed.userRegion : "";

  // Installing the workflow doc is one of five cases. The managed block is
  // always replaced with the packaged version; the cases differ in how the
  // project's own content (the user region) is preserved or backed up.
  if (!fs.existsSync(targetClaude)) {
    // 1. Fresh install — write the marked template as-is, no backup.
    fs.writeFileSync(
      targetClaude,
      composeMarkedFile({ blockBody: sourceBlock, userRegion: templateUserRegion, lang }),
    );
    log.ok(`CLAUDE.md installed (${langOpt.label})`);
  } else {
    const current = fs.readFileSync(targetClaude, "utf8");
    const parsed = parseMarkers(current);

    if (parsed.kind === "marked") {
      // 2. Upgrade — splice the managed block, preserve the user region.
      //    The END marker carries the block's hash. Three cases:
      //      - hash present and matches  → block untouched, no backup
      //      - hash present and mismatch → block hand-edited, back up + warn
      //      - hash absent               → unverifiable (e.g. the file was
      //        copied straight from the template, which ships a no-hash END
      //        marker). Can't prove the block is untouched, so back up
      //        conservatively rather than risk silently dropping an edit.
      if (parsed.endHash === null) {
        const bak = backupOnce(targetClaude);
        log.warn(
          `CLAUDE.md 的受管区块缺少校验标记,无法确认是否被改动;升级前已备份到 ${path.basename(bak)}`,
        );
      } else if (parsed.endHash !== hashBlock(parsed.blockBody)) {
        const bak = backupOnce(targetClaude);
        log.warn(
          `CLAUDE.md 的受管区块曾被手改;升级已整块覆盖该区块,改动前的文件见 ${path.basename(bak)}`,
        );
      }
      fs.writeFileSync(
        targetClaude,
        composeMarkedFile({
          prefix: parsed.prefix,
          blockBody: sourceBlock,
          userRegion: parsed.userRegion,
          lang,
        }),
      );
      log.ok(
        `CLAUDE.md upgraded (${langOpt.label}); your project section was preserved`,
      );
    } else if (parsed.kind === "unmarked" && hasAurigaHeader(current)) {
      // 3. Old-format migration — an auriga CLAUDE.md from before markers
      //    existed. The user region can't be recovered from an unmarked file,
      //    so back the whole thing up and install fresh.
      const bak = backupOnce(targetClaude);
      fs.writeFileSync(
        targetClaude,
        composeMarkedFile({ blockBody: sourceBlock, userRegion: templateUserRegion, lang }),
      );
      log.warn(
        `检测到旧版 CLAUDE.md(无受管标记);已备份到 ${path.basename(bak)}。` +
          `若你改过它,请从备份把工程定制手动迁移到 END 标记之后的用户区。`,
      );
      log.ok(`CLAUDE.md migrated to the managed-block format (${langOpt.label})`);
    } else if (parsed.kind === "unmarked") {
      // 4. Foreign first install — a CLAUDE.md from another tool. Keep its
      //    content in place as the user region; no backup needed.
      const foreign = current.endsWith("\n") ? current : current + "\n";
      fs.writeFileSync(
        targetClaude,
        composeMarkedFile({ blockBody: sourceBlock, userRegion: "\n" + foreign, lang }),
      );
      log.ok(
        `CLAUDE.md installed (${langOpt.label}); your existing content was kept below the managed block`,
      );
    } else {
      // 5. Malformed markers — can't locate the block boundaries safely.
      //    Back up and reinstall fresh rather than splice into a broken file.
      const bak = backupOnce(targetClaude);
      fs.writeFileSync(
        targetClaude,
        composeMarkedFile({ blockBody: sourceBlock, userRegion: templateUserRegion, lang }),
      );
      log.warn(
        `CLAUDE.md 的受管标记已损坏(${parsed.reason});已备份到 ${path.basename(bak)} 并重装。`,
      );
    }
  }

  // Point AGENTS.md at CLAUDE.md via a symlink (the install shape — Claude
  // Code and Codex then read the same workflow doc). If the path is already
  // occupied by something that ISN'T that symlink — a real file from another
  // tool, or a symlink pointing elsewhere — it holds content or intent we
  // must not silently destroy. Back it up first (symmetric with how a foreign
  // / hand-edited CLAUDE.md is preserved above), then replace.
  let agentsStat: fs.Stats | undefined;
  try {
    agentsStat = fs.lstatSync(targetAgents);
  } catch {
    // does not exist — nothing to preserve.
  }
  if (agentsStat) {
    const pointsToClaude =
      agentsStat.isSymbolicLink() &&
      fs.readlinkSync(targetAgents) === "CLAUDE.md";
    if (!pointsToClaude) {
      const bak = backupOnce(targetAgents);
      log.warn(
        `AGENTS.md 不是指向 CLAUDE.md 的软链;已备份到 ${path.basename(bak)} 后替换为软链。`,
      );
    }
    fs.unlinkSync(targetAgents);
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
