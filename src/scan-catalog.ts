// Build the scan-time Catalog (the shape src/state.ts consumes) from the
// build-time `dist/catalog.json`. This module is intentionally a *thin
// adapter* — it must NOT read any file outside `dist/catalog.json`, because
// the npm tarball's `files` field allowlists only `dist/`. Reading from
// `packageRoot/CLAUDE.md`, `packageRoot/.claude/plugins.json`, or
// `packageRoot/.agents/skills/<name>/SKILL.md` succeeds in dev (where
// packageRoot === repoRoot) but silently returns empty for npm-installed
// users, leaving the scanner unable to surface real update signals.
//
// Anything the scanner needs beyond what's already in catalog.json must
// first be baked at build time in `src/build/generate-catalog.ts`.
//
// Scope of the current bake (covered fields):
//   - workflowVersion         — from CLAUDE.md header
//   - plugin agents map       — from .claude/plugins.json ∪ .agents/plugins/install.json
//   - plugin expectedVersion  — from plugins/<name>/.claude-plugin/plugin.json
//   - plugin external flag    — derived (no in-tree manifest = external)
//
// Out of scope for v1.18.4 (follow-up PRs):
//   - hook expectedEvent / expectedMatcher / expectedIf (from .claude/hooks/hooks.json)
//   - apply-time installer config (the install path reads .claude/plugins.json
//     directly — that needs runWebUi → fetchContentRoot rewire, not bake).

import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadCatalog } from "./catalog.js";
import type { Catalog as ScanCatalog } from "./state.js";

async function tryReadFile(p: string): Promise<string | null> {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

interface HookSettingsEvent {
  event?: string;
  matcher?: string;
  if?: string;
}

interface HooksJsonEntry {
  name?: string;
  settingsEvents?: HookSettingsEvent[];
}

interface HooksJson {
  hooks?: HooksJsonEntry[];
}

export async function buildScanCatalog(
  packageRoot: string,
): Promise<ScanCatalog> {
  const dist = loadCatalog(packageRoot);

  // Workflow version — baked from CLAUDE.md header at build time. See
  // module comment for the "no runtime reads outside dist/" rule.
  const workflowVersion = dist.workflowVersion ?? "";

  // Skills: drift detection deliberately deferred to `npx skills update
  // --project`, which already compares against the skill's own upstream
  // repo HEAD. Our catalog snapshot would only know "what auriga-cli
  // shipped at this CLI release" — at best a stale proxy that mis-reports
  // legitimate user-side updates as drift. Setting expectedHash to "" puts
  // classifySkillByFile into wildcard mode: row reports installed if
  // SKILL.md exists, not-installed otherwise; never update-available.
  const skills: ScanCatalog["skills"] = {};
  for (const entry of dist.workflowSkills) {
    skills[entry.name] = {
      description: entry.description,
      expectedHash: "",
      isWorkflow: true,
    };
  }
  const recommendedSkills: ScanCatalog["recommendedSkills"] = {};
  for (const entry of dist.recommendedSkills) {
    recommendedSkills[entry.name] = {
      description: entry.description,
      expectedHash: "",
    };
  }

  // Plugins: agents + expectedVersion + external all come from
  // dist/catalog.json now (baked in src/build/generate-catalog.ts). The
  // previous version of this module read .claude/plugins.json +
  // .agents/plugins/install.json at runtime — those files are NOT in the
  // npm tarball, so for installed users every plugin defaulted to a
  // ["claude"] agent classification (root cause of dual-Agent plugin
  // mis-classification in v1.18.x).
  const plugins: ScanCatalog["plugins"] = {};
  for (const entry of dist.plugins) {
    const agents: ("claude" | "codex")[] =
      Array.isArray(entry.agents) && entry.agents.length > 0
        ? [...entry.agents]
        : ["claude"]; // safety fallback: unknown shape defaults to claude
    plugins[entry.name] = {
      description: entry.description,
      agents,
      ...(typeof entry.expectedVersion === "string" && entry.expectedVersion.length > 0
        ? { expectedVersion: entry.expectedVersion }
        : {}),
      ...(entry.external === true ? { external: true } : {}),
    };
  }

  // Hooks: TODO follow-up — bake expectedEvent / expectedMatcher / expectedIf
  // into dist/catalog.json the same way agents are baked. Currently the
  // runtime read of packageRoot/.claude/hooks/hooks.json works in dev
  // (packageRoot === repoRoot) but fails silently for npm-installed users
  // — `package.json` `files` allowlist doesn't ship `.claude/`. So hook
  // drift detection is correct in dev and degraded (always "installed" if
  // marker present) in production. Follow-up bake closes the dev/prod gap.
  const hooksJsonPath = path.join(packageRoot, ".claude", "hooks", "hooks.json");
  const hooksJsonRaw = await tryReadFile(hooksJsonPath);
  const hooksJson: HooksJson = hooksJsonRaw ? JSON.parse(hooksJsonRaw) : {};
  const settingsEventsByName = new Map<string, HookSettingsEvent>();
  for (const h of hooksJson.hooks ?? []) {
    if (typeof h.name === "string" && h.settingsEvents?.length) {
      settingsEventsByName.set(h.name, h.settingsEvents[0]);
    }
  }
  const hooks: ScanCatalog["hooks"] = {};
  for (const entry of dist.hooks) {
    const ev = settingsEventsByName.get(entry.name);
    hooks[entry.name] = {
      description: entry.description,
      // Empty expectedHash flips state.ts into wildcard mode — drift judged
      // purely from the structured expected* fields below, not from a
      // settings-entry content hash.
      expectedHash: "",
      ...(typeof ev?.event === "string" ? { expectedEvent: ev.event } : {}),
      ...(typeof ev?.matcher === "string" ? { expectedMatcher: ev.matcher } : {}),
      ...(typeof ev?.if === "string" ? { expectedIf: ev.if } : {}),
    };
  }

  return {
    workflowVersion,
    skills,
    recommendedSkills,
    plugins,
    hooks,
  };
}
