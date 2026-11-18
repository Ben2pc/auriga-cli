// Shared workspace-root resolution for git lifecycle hooks.
//
// Cursor runs plugin hooks with cwd = the plugin cache, not the user
// repo, and names the workspace via `workspace_roots[0]`.
// Grok and Antigravity name the command working directory via
// `workspaceRoot` / `cwd`, checked before `workspacePaths` so an
// outer aggregate workspace directory does not shadow the actual
// sub-repo or worktree in `cwd`. When `cwd` is absent or invalid,
// `workspacePaths` is scanned for the first existing directory,
// followed by env vars and process.cwd() as the last fallback.

import { existsSync, statSync } from "node:fs";

function existingDir(candidate) {
  if (typeof candidate !== "string" || candidate.length === 0) return null;
  try {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

export function resolveRepoRoot(
  payload,
  env = process.env,
  fallbackCwd = process.cwd(),
) {
  const roots = payload?.workspace_roots;
  if (Array.isArray(roots) && roots.length > 0) {
    const first = existingDir(roots[0]);
    if (first) return first;
  }

  for (const key of ["workspaceRoot", "cwd"]) {
    const found = existingDir(payload?.[key]);
    if (found) return found;
  }

  const workspacePaths = payload?.workspacePaths;
  if (Array.isArray(workspacePaths)) {
    for (const candidate of workspacePaths) {
      const found = existingDir(candidate);
      if (found) return found;
    }
  }

  for (const key of [
    "CLAUDE_PROJECT_DIR",
    "CURSOR_PROJECT_DIR",
    "GROK_WORKSPACE_ROOT",
  ]) {
    const found = existingDir(env[key]);
    if (found) return found;
  }

  return fallbackCwd;
}
