#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_TOTAL_BYTES = 64 * 1024;
const AGENTS_FILENAME = "AGENTS.md";
const CONFIG_PATH = path.join(".codex", "session-instructions-loader.json");
const TOOL_STATE_BOUNDARY_DIRS = new Set([".codex"]);

function readStdin() {
  return fs.readFileSync(0, "utf8");
}

function parsePayload(input) {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function existingDirectory(candidate) {
  if (typeof candidate !== "string" || candidate.trim() === "") return null;
  try {
    const resolved = fs.realpathSync(candidate);
    const stat = fs.statSync(resolved);
    return stat.isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function parentOf(dir) {
  const parent = path.dirname(dir);
  return parent === dir ? null : parent;
}

function markerExists(dir, markerName) {
  try {
    fs.statSync(path.join(dir, markerName));
    return true;
  } catch {
    return false;
  }
}

function findGitRoot(cwd) {
  for (let dir = cwd; dir; dir = parentOf(dir)) {
    if (markerExists(dir, ".git")) return dir;
  }
  return null;
}

function gitDirFromFile(gitRoot) {
  const gitMarker = path.join(gitRoot, ".git");
  try {
    if (!fs.statSync(gitMarker).isFile()) return null;
    const match = fs.readFileSync(gitMarker, "utf8").match(/^gitdir:\s*(.+)\s*$/m);
    if (!match) return null;
    const gitDir = match[1].trim();
    return path.resolve(gitRoot, gitDir);
  } catch {
    return null;
  }
}

function worktreeRepositoryRootFromGitDir(gitDir) {
  const worktreesDir = path.dirname(gitDir);
  if (path.basename(worktreesDir) !== "worktrees") return null;

  const commonGitDir = path.dirname(worktreesDir);
  if (path.basename(commonGitDir) === ".git") {
    const repositoryRoot = parentOf(commonGitDir);
    return existingDirectory(repositoryRoot);
  }

  return null;
}

function homeBoundaryFor(startDir) {
  const home = existingDirectory(process.env.HOME || os.homedir());
  if (!home) return null;
  return startDir === home || startDir.startsWith(`${home}${path.sep}`) ? home : null;
}

function ancestorDirsFrom(startDir, ancestorLevel = 0) {
  if (ancestorLevel === 0) return [];

  const dirs = [];
  const stopDir = ancestorLevel === -1 ? homeBoundaryFor(startDir) : null;
  for (let dir = startDir; dir; dir = parentOf(dir)) {
    dirs.push(dir);
    if (ancestorLevel > 0 && dirs.length >= ancestorLevel) break;
    if (ancestorLevel === -1 && !stopDir) break;
    if (stopDir && dir === stopDir) break;
  }
  const rootToLeaf = dirs.reverse();
  const boundaryIndex = rootToLeaf.findLastIndex((dir) =>
    TOOL_STATE_BOUNDARY_DIRS.has(path.basename(dir)),
  );
  return boundaryIndex === -1 ? rootToLeaf : rootToLeaf.slice(boundaryIndex + 1);
}

function repositoryContextFor(cwd) {
  const gitRoot = findGitRoot(cwd);
  if (!gitRoot) return { projectRoot: cwd, ancestorStart: parentOf(cwd) };

  const gitDir = gitDirFromFile(gitRoot);
  const originalRepoRoot = gitDir ? worktreeRepositoryRootFromGitDir(gitDir) : null;
  const projectRoot = originalRepoRoot && originalRepoRoot !== gitRoot ? originalRepoRoot : gitRoot;
  return { projectRoot, ancestorStart: parentOf(projectRoot) };
}

function configuredAncestorLevel(config) {
  const value = config?.ancestorLevel;
  if (value === -1) return -1;
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function readableAgentsFiles(context, config) {
  const ancestorLevel = configuredAncestorLevel(config);
  if (!context.ancestorStart) return [];

  const files = [];
  for (const dir of ancestorDirsFrom(context.ancestorStart, ancestorLevel)) {
    const candidate = path.join(dir, AGENTS_FILENAME);

    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) files.push(candidate);
    } catch {
      // Missing or unreadable files are not fatal for a context hook.
    }
  }
  return files;
}

function readConfig(projectRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, CONFIG_PATH), "utf8"));
  } catch {
    return null;
  }
}

function resolveProjectFile(projectRoot, relativePath) {
  if (typeof relativePath !== "string" || relativePath.trim() === "") return null;
  if (path.isAbsolute(relativePath)) return null;

  const resolved = path.resolve(projectRoot, relativePath);
  const withinProject = resolved === projectRoot || resolved.startsWith(`${projectRoot}${path.sep}`);
  if (!withinProject) return null;

  try {
    const realProjectRoot = fs.realpathSync(projectRoot);
    const realFile = fs.realpathSync(resolved);
    const realWithinProject =
      realFile === realProjectRoot || realFile.startsWith(`${realProjectRoot}${path.sep}`);
    if (!realWithinProject) return null;

    const stat = fs.statSync(realFile);
    return stat.isFile() ? realFile : null;
  } catch {
    return null;
  }
}

function configuredExtraFiles(projectRoot, config) {
  if (!Array.isArray(config?.extraFiles)) return [];

  const files = [];
  for (const entry of config.extraFiles) {
    const file = resolveProjectFile(projectRoot, entry);
    if (file) files.push(file);
  }
  return files;
}

function readFilesWithinBudget(files, outputOrder = files) {
  let remaining = MAX_TOTAL_BYTES;
  const loadedByFile = new Map();

  for (const file of files) {
    if (remaining <= 0) break;

    let data;
    try {
      data = fs.readFileSync(file);
    } catch {
      continue;
    }

    let truncated = false;
    if (data.byteLength > remaining) {
      data = data.subarray(0, remaining);
      truncated = true;
    }

    const text = data.toString("utf8").trim();
    if (text !== "") {
      loadedByFile.set(file, { file, text, truncated });
      remaining -= data.byteLength;
    }
  }

  return outputOrder.flatMap((file) => loadedByFile.get(file) ?? []);
}

function buildAdditionalContext(loaded) {
  if (loaded.length === 0) return "";

  const parts = [
    "# Additional session instructions",
    "",
    "The following instruction files may not have been included by Codex's built-in discovery.",
  ];

  for (const item of loaded) {
    parts.push(
      "",
      `## ${item.file}`,
      "",
      "<INSTRUCTIONS>",
      item.text,
      item.truncated ? "\n[truncated by session-instructions-loader]" : "",
      "</INSTRUCTIONS>",
    );
  }

  return parts.join("\n").trim();
}

function outputAdditionalContext(additionalContext) {
  if (additionalContext === "") return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext,
      },
    }),
  );
}

const payload = parsePayload(readStdin());
const cwd = existingDirectory(payload?.cwd);
if (cwd) {
  const context = repositoryContextFor(cwd);
  const config = readConfig(context.projectRoot);
  const ancestorFiles = readableAgentsFiles(context, config);
  const extraFiles = configuredExtraFiles(context.projectRoot, config);
  const outputOrder = [...ancestorFiles, ...extraFiles];
  const readPriority = [...ancestorFiles].reverse().concat(extraFiles);
  outputAdditionalContext(buildAdditionalContext(readFilesWithinBudget(readPriority, outputOrder)));
}
