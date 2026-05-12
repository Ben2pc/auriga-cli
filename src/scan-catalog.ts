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
//   .claude/hooks/<name>/index.mjs — runtime SHA256 = expected hash
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

const WORKFLOW_VERSION_RE = /^#\s*auriga Workflow\s*\(v([\d.]+)\)/m;

async function tryReadFile(p: string): Promise<string | null> {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

async function sha256File(p: string): Promise<string> {
  const bytes = await readFile(p);
  return createHash("sha256").update(bytes).digest("hex");
}

interface SkillsLock {
  skills?: Record<string, { computedHash?: string }>;
}

interface ClaudePluginsJson {
  plugins?: Array<{ name?: string }>;
}

interface CodexInstallJson {
  plugins?: Array<{ name?: string }>;
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

  // Skills + recommended: hashes from skills-lock.json.
  let lock: SkillsLock = {};
  const lockText = await tryReadFile(path.join(packageRoot, "skills-lock.json"));
  if (lockText) {
    try {
      lock = JSON.parse(lockText) as SkillsLock;
    } catch {
      // corrupted lock → no expectations; user state still classifies safely
    }
  }

  const skills: ScanCatalog["skills"] = {};
  for (const entry of dist.workflowSkills) {
    skills[entry.name] = {
      description: entry.description,
      expectedHash: lock.skills?.[entry.name]?.computedHash ?? "",
      isWorkflow: true,
    };
  }
  const recommendedSkills: ScanCatalog["recommendedSkills"] = {};
  for (const entry of dist.recommendedSkills) {
    recommendedSkills[entry.name] = {
      description: entry.description,
      expectedHash: lock.skills?.[entry.name]?.computedHash ?? "",
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

  // Hooks: runtime SHA256 of each hook's index.mjs serves as the expected
  // hash. If the file can't be read, leave the expectation empty so the
  // hook classifies as not-installed.
  const hooks: ScanCatalog["hooks"] = {};
  for (const entry of dist.hooks) {
    const hookEntry = path.join(
      packageRoot,
      ".claude",
      "hooks",
      entry.name,
      "index.mjs",
    );
    let expectedHash = "";
    try {
      expectedHash = await sha256File(hookEntry);
    } catch {
      /* missing or unreadable hook payload; leave hash empty */
    }
    hooks[entry.name] = { description: entry.description, expectedHash };
  }

  return {
    workflowVersion,
    skills,
    recommendedSkills,
    plugins,
    hooks,
  };
}
