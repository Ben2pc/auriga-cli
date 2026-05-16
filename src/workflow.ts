import fs from "node:fs";
import path from "node:path";
import { input, select } from "@inquirer/prompts";
import {
  DEFAULT_WORKFLOW_LANG,
  DEFAULT_WORKFLOW_TEMPLATE_FILE,
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
import {
  LEGACY_AGENTS_SYMLINK_TARGET,
  WORKFLOW_COMPAT_FILE,
  WORKFLOW_COMPAT_SYMLINK_TARGET,
  WORKFLOW_PRIMARY_FILE,
} from "./workflow-docs.js";

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

function lstatMaybe(filePath: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(filePath);
  } catch {
    return undefined;
  }
}

function isSymlinkTo(filePath: string, target: string): boolean {
  const stat = lstatMaybe(filePath);
  return !!stat?.isSymbolicLink() && fs.readlinkSync(filePath) === target;
}

export async function installWorkflow(
  packageRoot: string,
  opts: InstallOpts,
): Promise<void> {
  const lang = opts.interactive
    ? await withEsc(select({
      message: "Workflow language:",
      choices: LANGUAGES.map((l) => ({ name: l.label, value: l.value })),
      default: DEFAULT_WORKFLOW_LANG,
    }))
    : (opts.lang ?? DEFAULT_WORKFLOW_LANG);

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

  // Lazy fetch: only download non-default language files when needed.
  if (langOpt.file !== DEFAULT_WORKFLOW_TEMPLATE_FILE) {
    console.log(`Fetching ${langOpt.label} template...`);
    await fetchExtraContent(packageRoot, langOpt.file);
  }

  const sourceWorkflow = path.join(packageRoot, langOpt.file);
  const targetPrimary = path.join(resolved, WORKFLOW_PRIMARY_FILE);
  const targetCompat = path.join(resolved, WORKFLOW_COMPAT_FILE);

  // The packaged template is authored with managed-block markers. Extract its
  // managed block (the auriga workflow body) and its user-region placeholder.
  // Defensive fallback: if the template somehow lacks markers, treat the whole
  // file as the managed block with an empty user region.
  const sourceContent = fs.readFileSync(sourceWorkflow, "utf8");
  const sourceParsed = parseMarkers(sourceContent);
  const sourceBlock =
    sourceParsed.kind === "marked"
      ? sourceParsed.blockBody
      : sourceContent.endsWith("\n")
        ? sourceContent
        : sourceContent + "\n";
  const templateUserRegion =
    sourceParsed.kind === "marked" ? sourceParsed.userRegion : "";

  const primaryStat = lstatMaybe(targetPrimary);
  const compatStat = lstatMaybe(targetCompat);
  const legacyShape =
    primaryStat?.isSymbolicLink() === true &&
    fs.readlinkSync(targetPrimary) === LEGACY_AGENTS_SYMLINK_TARGET &&
    compatStat?.isFile() === true;
  const primaryForeignSymlink =
    primaryStat?.isSymbolicLink() === true &&
    fs.readlinkSync(targetPrimary) !== LEGACY_AGENTS_SYMLINK_TARGET;
  const compatIsCurrentPrimary =
    !primaryStat &&
    compatStat !== undefined &&
    !isSymlinkTo(targetCompat, WORKFLOW_COMPAT_SYMLINK_TARGET);
  const currentPath =
    primaryStat && !primaryStat.isSymbolicLink()
      ? targetPrimary
      : legacyShape || compatIsCurrentPrimary
        ? targetCompat
        : undefined;

  let wrotePrimary = false;
  const writePrimary = (content: string): void => {
    if (primaryStat?.isSymbolicLink()) {
      if (primaryForeignSymlink) {
        const bak = backupOnce(targetPrimary);
        log.warn(
          `AGENTS.md 是指向其它目标的软链;已备份到 ${path.basename(bak)} 后改为主文件。`,
        );
      }
      fs.unlinkSync(targetPrimary);
    }
    fs.writeFileSync(targetPrimary, content);
    wrotePrimary = true;
  };

  // Installing the workflow doc is one of five cases. The managed block is
  // always replaced with the packaged version; the cases differ in how the
  // project's own content (the user region) is preserved or backed up.
  if (!currentPath) {
    // 1. Fresh install — write the marked template as-is, no backup.
    writePrimary(
      composeMarkedFile({ blockBody: sourceBlock, userRegion: templateUserRegion, lang }),
    );
    log.ok(`AGENTS.md installed (${langOpt.label})`);
  } else {
    const current = fs.readFileSync(currentPath, "utf8");
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
        const bak = backupOnce(currentPath);
        log.warn(
          `工作流文档的受管区块缺少校验标记,无法确认是否被改动;升级前已备份到 ${path.basename(bak)}`,
        );
      } else if (parsed.endHash !== hashBlock(parsed.blockBody)) {
        const bak = backupOnce(currentPath);
        log.warn(
          `工作流文档的受管区块曾被手改;升级已整块覆盖该区块,改动前的文件见 ${path.basename(bak)}`,
        );
      }
      writePrimary(
        composeMarkedFile({
          prefix: parsed.prefix,
          blockBody: sourceBlock,
          userRegion: parsed.userRegion,
          lang,
        }),
      );
      log.ok(
        `AGENTS.md upgraded (${langOpt.label}); your project section was preserved`,
      );
    } else if (parsed.kind === "unmarked" && hasAurigaHeader(current)) {
      // 3. Old-format migration — an auriga CLAUDE.md from before markers
      //    existed. The user region can't be recovered from an unmarked file,
      //    so back the whole thing up and install fresh.
      const bak = backupOnce(currentPath);
      writePrimary(
        composeMarkedFile({ blockBody: sourceBlock, userRegion: templateUserRegion, lang }),
      );
      log.warn(
        `检测到旧版工作流文档(无受管标记);已备份到 ${path.basename(bak)}。` +
          `若你改过它,请从备份把工程定制手动迁移到 END 标记之后的用户区。`,
      );
      log.ok(`AGENTS.md migrated to the managed-block format (${langOpt.label})`);
    } else if (parsed.kind === "unmarked") {
      // 4. Foreign first install — a workflow doc from another tool. Keep its
      //    content in place as the user region; no backup needed.
      const foreign = current.endsWith("\n") ? current : current + "\n";
      writePrimary(
        composeMarkedFile({ blockBody: sourceBlock, userRegion: "\n" + foreign, lang }),
      );
      log.ok(
        `AGENTS.md installed (${langOpt.label}); your existing content was kept below the managed block`,
      );
      if (currentPath === targetPrimary) {
        log.warn("AGENTS.md already existed; its content was kept below the managed block.");
      }
    } else {
      // 5. Malformed markers — can't locate the block boundaries safely.
      //    Back up and reinstall fresh rather than splice into a broken file.
      const bak = backupOnce(currentPath);
      writePrimary(
        composeMarkedFile({ blockBody: sourceBlock, userRegion: templateUserRegion, lang }),
      );
      log.warn(
        `工作流文档的受管标记已损坏(${parsed.reason});已备份到 ${path.basename(bak)} 并重装。`,
      );
    }
  }

  // Point CLAUDE.md at AGENTS.md via a compatibility symlink. If CLAUDE.md was
  // the old primary file and its content was migrated above, replacing it with
  // the symlink is safe. Otherwise preserve any real file or foreign symlink
  // before replacing it.
  const latestCompatStat = lstatMaybe(targetCompat);
  if (latestCompatStat) {
    const pointsToPrimary = isSymlinkTo(targetCompat, WORKFLOW_COMPAT_SYMLINK_TARGET);
    const migratedFromCompat = currentPath === targetCompat && wrotePrimary;
    if (!pointsToPrimary && !migratedFromCompat) {
      const bak = backupOnce(targetCompat);
      log.warn(
        `CLAUDE.md 不是指向 AGENTS.md 的软链;已备份到 ${path.basename(bak)} 后替换为软链。`,
      );
    }
    fs.unlinkSync(targetCompat);
  }
  fs.symlinkSync(WORKFLOW_COMPAT_SYMLINK_TARGET, targetCompat);
  log.ok("CLAUDE.md -> AGENTS.md symlink created");
}

/**
 * Uninstall the workflow (AGENTS.md + CLAUDE.md) from `opts.cwd`.
 *
 * Safety contract:
 * - `opts.force` MUST be true. The CLI / server caller is responsible for
 *   confirming user intent BEFORE invoking this; we refuse otherwise.
 * - Real files are removed only when they are recognizable auriga workflow
 *   files. Foreign instruction files are left in place with a warning.
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

  const isAurigaWorkflowFile = (filePath: string): boolean => {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      return parseMarkers(content).kind === "marked" || hasAurigaHeader(content);
    } catch {
      return false;
    }
  };

  const removeWorkflowPath = (filePath: string, name: string): void => {
    try {
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(filePath);
        log.ok(`${name} symlink removed`);
        emit(`removed ${name} symlink`);
      } else if (stat.isFile() && isAurigaWorkflowFile(filePath)) {
        fs.unlinkSync(filePath);
        log.ok(`${name} removed`);
        emit(`removed ${name}`);
      } else {
        log.warn(`foreign ${name} left in place`);
        emit(`foreign ${name} left in place`);
      }
    } catch {
      log.skip(`${name} not present`);
      emit(`${name} not present`);
    }
  };

  // Remove AGENTS.md first because it is the current primary. lstatSync refuses
  // to follow symlinks, so the legacy AGENTS.md -> CLAUDE.md shape is handled
  // without deleting CLAUDE.md through the link.
  removeWorkflowPath(targetAgents, "AGENTS.md");
  removeWorkflowPath(targetClaude, "CLAUDE.md");
}
