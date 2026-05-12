// Build the scan-time Catalog (the shape src/state.ts consumes) from
// auriga-cli's installed package state. This bridges the build-time
// `dist/catalog.json` (which carries names + descriptions for the menu)
// and the runtime scanner's need for expected hashes + versions.
//
// Inputs (all under packageRoot):
//   dist/catalog.json     — names + descriptions for 5 categories
//   skills-lock.json      — expected SHA256 for every vendored skill
//   .claude/plugins.json  — Claude plugin entries (agent = "claude")
//   .agents/plugins/install.json — Codex plugin entries (agent = "codex")
//   .claude/hooks/hooks.json — registers settingsEvents per hook (event /
//                           matcher / if) used by state.ts for drift
//                           detection in <scope>/.claude/settings.json
//   CLAUDE.md             — `# auriga Workflow (vX.Y.Z)` provides
//                           workflowVersion
//
// Anything missing is treated as "no expectation" (empty hash / version)
// rather than throwing; scanState will still produce a structurally valid
// StateReport — items just classify as not-installed or installed
// depending on whether the user-side data exists.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadCatalog } from "./catalog.js";
import type { Catalog as ScanCatalog } from "./state.js";

async function sha256SkillMd(skillsRoot: string, name: string): Promise<string> {
  try {
    const buf = await readFile(path.join(skillsRoot, name, "SKILL.md"));
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return "";
  }
}

const WORKFLOW_VERSION_RE = /^#\s*auriga Workflow\s*\(v([\d.]+)\)/m;

async function tryReadFile(p: string): Promise<string | null> {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

interface ClaudePluginsJson {
  plugins?: Array<{ name?: string }>;
}

interface CodexInstallJson {
  plugins?: Array<{ name?: string }>;
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

  // Workflow version: parse from auriga-cli's own CLAUDE.md template.
  // If missing, leave as empty string so workflow always classifies as
  // not-installed (no expectation set).
  const claudeMd = await tryReadFile(path.join(packageRoot, "CLAUDE.md"));
  const m = claudeMd ? WORKFLOW_VERSION_RE.exec(claudeMd) : null;
  const workflowVersion = m ? m[1] : "";

  // Skills + recommended: sha256 of each shipped SKILL.md. This is the same
  // hash the scanner computes for `<scope>/.claude/skills/<name>/SKILL.md`
  // at scan time, so a match means "user's installed copy is identical to
  // the version auriga-cli ships". skills-lock.json's `computedHash` field
  // hashes the entire skill directory (every file, sorted), which doesn't
  // line up with the scanner's per-file model — we deliberately ignore it.
  const skillsRoot = path.join(packageRoot, ".agents", "skills");
  const skills: ScanCatalog["skills"] = {};
  for (const entry of dist.workflowSkills) {
    skills[entry.name] = {
      description: entry.description,
      expectedHash: await sha256SkillMd(skillsRoot, entry.name),
      isWorkflow: true,
    };
  }
  const recommendedSkills: ScanCatalog["recommendedSkills"] = {};
  for (const entry of dist.recommendedSkills) {
    recommendedSkills[entry.name] = {
      description: entry.description,
      expectedHash: await sha256SkillMd(skillsRoot, entry.name),
    };
  }

  // Plugins: split by agent based on which config file lists them. A
  // plugin can appear in both registries (cross-agent plugins like
  // auriga-go); we represent it once per agent.
  const plugins: ScanCatalog["plugins"] = {};
  const claudePluginsText = await tryReadFile(
    path.join(packageRoot, ".claude", "plugins.json"),
  );
  const claudeNames = new Set<string>();
  if (claudePluginsText) {
    try {
      const parsed = JSON.parse(claudePluginsText) as ClaudePluginsJson;
      for (const p of parsed.plugins ?? []) {
        if (p.name) claudeNames.add(p.name);
      }
    } catch {
      /* ignore */
    }
  }
  const codexInstallText = await tryReadFile(
    path.join(packageRoot, ".agents", "plugins", "install.json"),
  );
  const codexNames = new Set<string>();
  if (codexInstallText) {
    try {
      const parsed = JSON.parse(codexInstallText) as CodexInstallJson;
      for (const p of parsed.plugins ?? []) {
        if (p.name) codexNames.add(p.name);
      }
    } catch {
      /* ignore */
    }
  }

  for (const entry of dist.plugins) {
    // Collect every agent that registers this plugin. A plugin can ship in
    // both registries (cross-agent plugins like auriga-go); we emit it as
    // a single multi-agent record so the UI shows one row + BOTH badge and
    // Apply installs to each side.
    const agents: ("claude" | "codex")[] = [];
    if (claudeNames.has(entry.name)) agents.push("claude");
    if (codexNames.has(entry.name)) agents.push("codex");
    if (agents.length === 0) agents.push("claude"); // unknown defaults to claude
    plugins[entry.name] = { description: entry.description, agents };
  }

  // Hooks: the scanner reads <scope>/.claude/settings.json and matches by
  // `_marker` (see state.ts scanHooks). Drift detection compares the
  // registered event / matcher / if values against the hook's canonical
  // settingsEvents[0] from .claude/hooks/hooks.json. We deliberately do NOT
  // hash index.mjs — the user's installed index.mjs lives at <scope>/.claude/
  // hooks/<name>/index.mjs and isn't part of the settings.json drift signal.
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
