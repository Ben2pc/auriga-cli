import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

import type { Catalog, CatalogEntry } from "../catalog.js";
import {
  codexManifestPath,
  validateCodexInstallConfig,
  validateCodexMarketplace,
  type CodexInstallConfig,
  type CodexMarketplace,
  type CodexMarketplacePlugin,
} from "../codex-plugin-config.js";
import type { PluginsConfig, SkillsLock } from "../utils.js";
import { WORKFLOW_SKILLS as WORKFLOW_SKILL_LIST, validateSkillsLock } from "../skills.js";
import { validatePluginsConfig } from "../plugins.js";

const WORKFLOW_SKILLS = new Set(WORKFLOW_SKILL_LIST);

interface HookEntry {
  name: string;
  description: string;
  defaultOn?: boolean;
}

interface HooksConfig {
  hooks: HookEntry[];
}

/**
 * English `--help` summaries for skills whose authoritative upstream
 * SKILL.md is non-English. The SKILL.md still drives runtime behavior;
 * this override only affects the one-line entry in `--help` so CI /
 * English-speaking Agents get a consistent reading experience.
 * Keep summaries ≤140 chars so the truncated help column stays tidy.
 */
const CATALOG_OVERRIDES: Record<string, string> = {
  "claude-code-agent":
    "Delegate coding, review, diagnosis, planning, and structured-output tasks to an independent Claude Code session via `claude -p` (Agent SDK).",
  "codex-agent":
    "Delegate coding, review, diagnosis, planning, and browser tasks to an independent Codex session via `codex exec` / resume / review.",
};

// Pulls a description from a local plugin's `.codex-plugin/plugin.json`
// (interface.shortDescription preferred, falling back to top-level
// description). Returns undefined when the manifest is absent or has
// neither field — caller falls back to the install.json description.
function readLocalCodexManifestDescription(
  repoRoot: string,
  plugin: CodexMarketplacePlugin,
): string | undefined {
  const relative = codexManifestPath(plugin);
  if (!relative) return undefined;
  const manifestPath = path.join(repoRoot, relative);
  if (!fs.existsSync(manifestPath)) return undefined;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
    description?: unknown;
    interface?: { shortDescription?: unknown };
  };
  if (typeof manifest.interface?.shortDescription === "string") {
    return manifest.interface.shortDescription;
  }
  if (typeof manifest.description === "string") {
    return manifest.description;
  }
  return undefined;
}

/** Read the owned plugin's manifest version (`.claude-plugin/plugin.json`
 *  preferred, `.codex-plugin/plugin.json` as fallback). Returns undefined
 *  when no in-tree manifest exists — for external-marketplace plugins
 *  (skill-creator etc.) that's correct: the source lives upstream, so we
 *  leave expectedVersion unset and the scanner trusts whatever's installed.
 *  This MUST run at build time because `plugins/<name>/` is not in the npm
 *  tarball's `files` allowlist — runtime scan-catalog cannot see it. */
function readPluginManifestVersion(
  repoRoot: string,
  name: string,
): string | undefined {
  const candidates = [
    path.join(repoRoot, "plugins", name, ".claude-plugin", "plugin.json"),
    path.join(repoRoot, "plugins", name, ".codex-plugin", "plugin.json"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.length > 0) {
        return parsed.version;
      }
    } catch {
      /* try next candidate */
    }
  }
  return undefined;
}

function readSkillDescription(repoRoot: string, name: string): string {
  const override = CATALOG_OVERRIDES[name];
  if (override) return override;
  const skillMd = path.join(repoRoot, ".agents", "skills", name, "SKILL.md");
  if (!fs.existsSync(skillMd)) {
    throw new Error(`generate-catalog: SKILL.md not found for '${name}' at ${skillMd}`);
  }
  const { data } = matter(fs.readFileSync(skillMd, "utf-8"));
  const desc = data.description;
  if (typeof desc !== "string" || desc.length === 0) {
    throw new Error(
      `generate-catalog: '${name}' has missing or non-string description frontmatter`,
    );
  }
  return desc;
}

export function generateCatalog(repoRoot: string): Catalog {
  // Route build-time reads through the same validators runtime uses.
  // skills-lock.json is in-tree so exposure is low, but the validator
  // exists to reject malformed shapes and the catalog bakes these
  // values into dist/catalog.json shipped to every user — keep
  // build and runtime on the same schema contract.
  const lockPath = path.join(repoRoot, "skills-lock.json");
  const lockRaw: unknown = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
  validateSkillsLock(lockRaw);
  const lock = lockRaw as SkillsLock;

  const workflowSkills: CatalogEntry[] = [];
  const recommendedSkills: CatalogEntry[] = [];
  for (const name of Object.keys(lock.skills).sort()) {
    const entry: CatalogEntry = { name, description: readSkillDescription(repoRoot, name) };
    if (WORKFLOW_SKILLS.has(name)) workflowSkills.push(entry);
    else recommendedSkills.push(entry);
  }

  const pluginsPath = path.join(repoRoot, ".claude", "plugins.json");
  const pluginsRaw: unknown = JSON.parse(fs.readFileSync(pluginsPath, "utf-8"));
  validatePluginsConfig(pluginsRaw);
  const pluginsCfg = pluginsRaw as PluginsConfig;
  const pluginByName = new Map<string, CatalogEntry>();
  for (const p of pluginsCfg.plugins) {
    const expectedVersion = readPluginManifestVersion(repoRoot, p.name);
    pluginByName.set(p.name, {
      name: p.name,
      description: p.description,
      ...(expectedVersion ? { expectedVersion } : {}),
    });
  }

  const codexMarketplacePath = path.join(repoRoot, ".agents", "plugins", "marketplace.json");
  const codexInstallPath = path.join(repoRoot, ".agents", "plugins", "install.json");
  if (fs.existsSync(codexMarketplacePath) && fs.existsSync(codexInstallPath)) {
    const codexMarketplaceRaw: unknown = JSON.parse(fs.readFileSync(codexMarketplacePath, "utf-8"));
    const codexInstallRaw: unknown = JSON.parse(fs.readFileSync(codexInstallPath, "utf-8"));
    validateCodexMarketplace(codexMarketplaceRaw);
    validateCodexInstallConfig(codexInstallRaw);
    const codexMarketplace = codexMarketplaceRaw as CodexMarketplace;
    const codexInstall = codexInstallRaw as CodexInstallConfig;
    const marketplaceByName = new Map(codexMarketplace.plugins.map((p) => [p.name, p]));
    for (const p of codexInstall.plugins) {
      const existing = pluginByName.get(p.name);
      let description = typeof p.description === "string" && p.description.length > 0
        ? p.description
        : "Codex plugin";

      // External-marketplace entries don't appear in our local marketplace.json;
      // their manifest lives at the upstream's .codex-plugin/plugin.json which
      // we deliberately don't fetch at build time. Description falls back to
      // install.json's own value (or "(Claude/Codex)" reuse when also listed
      // in .claude/plugins.json) — same shape humans / Agents see in --help.
      if (p.marketplace === undefined) {
        const marketplacePlugin = marketplaceByName.get(p.name);
        if (!marketplacePlugin) {
          throw new Error(`generate-catalog: Codex install plugin '${p.name}' missing from marketplace.json`);
        }
        if (description === "Codex plugin") {
          const manifestDescription = readLocalCodexManifestDescription(repoRoot, marketplacePlugin);
          if (manifestDescription) description = manifestDescription;
        }
      }

      // expectedVersion may have been set by the Claude pass; preserve it.
      // Otherwise read from this plugin's in-tree manifest (handles codex-only
      // plugins like session-instructions-loader).
      const expectedVersion = existing?.expectedVersion ?? readPluginManifestVersion(repoRoot, p.name);
      pluginByName.set(p.name, {
        name: p.name,
        description: existing
          ? `(Claude/Codex) ${existing.description}`
          : `(Codex) ${description}`,
        ...(expectedVersion ? { expectedVersion } : {}),
      });
    }
  }
  const plugins: CatalogEntry[] = [...pluginByName.values()];

  const hooksPath = path.join(repoRoot, ".claude", "hooks", "hooks.json");
  const hooksCfg = JSON.parse(fs.readFileSync(hooksPath, "utf-8")) as HooksConfig;
  const hooks: CatalogEntry[] = hooksCfg.hooks.map((h) => ({
    name: h.name,
    description: h.defaultOn === false ? `(opt-in) ${h.description}` : h.description,
  }));

  // Workflow content version. MUST be baked at build time because the user's
  // installed CLAUDE.md (the workflow product) and auriga-cli's own CLAUDE.md
  // template share the same filename but live at different paths, and the
  // npm tarball does not ship the template — `files` only allowlists `dist/`.
  // Without baking, scan-catalog at runtime can't compare versions and the
  // Web UI silently never shows "update-available" for workflow upgrades.
  const workflowMdPath = path.join(repoRoot, "CLAUDE.md");
  const workflowMd = fs.readFileSync(workflowMdPath, "utf-8");
  const headerMatch = /^#\s*auriga Workflow\s*\(v([\d.]+)\)/m.exec(workflowMd);
  const workflowVersion = headerMatch ? headerMatch[1] : "";

  return {
    generatedAt: new Date().toISOString(),
    workflowVersion,
    workflowSkills,
    recommendedSkills,
    plugins,
    hooks,
  };
}

function main(): void {
  // fileURLToPath (not URL.pathname) so the leading-slash Windows path
  // quirk doesn't break the build on non-POSIX runners.
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Script lives at dist/build/generate-catalog.js; repo root is two levels up.
  const repoRoot = path.resolve(here, "..", "..");
  const catalog = generateCatalog(repoRoot);
  const outPath = path.join(repoRoot, "dist", "catalog.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2) + "\n");
  console.log(
    `✓ catalog.json: ${catalog.workflowSkills.length} workflow / ${catalog.recommendedSkills.length} recommended / ${catalog.plugins.length} plugins / ${catalog.hooks.length} hooks`,
  );
}

// Execute when invoked as a script (not when imported by tests).
// Compare resolved paths so symlinks don't break the guard.
// fileURLToPath keeps the Windows leading-slash quirk out of the compare.
const invokedAsScript =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (invokedAsScript) {
  main();
}
