import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

import type { Catalog, CatalogEntry } from "../catalog.js";
import {
  codexManifestPath,
  validateCodexMarketplace,
  type CodexMarketplace,
  type CodexMarketplacePlugin,
} from "../codex-plugin-config.js";
import type { SkillsLock } from "../utils.js";
import { WORKFLOW_SKILLS as WORKFLOW_SKILL_LIST, validateSkillsLock } from "../skills.js";
import {
  applyExtraPluginFields,
  extraAppliesTo,
  extraByNameForRuntime,
  loadClaudeMarketplace,
  loadExtraPluginConfigs,
} from "../plugins.js";

const WORKFLOW_SKILLS = new Set(WORKFLOW_SKILL_LIST);

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
// neither field — caller falls back to marketplace / extra config metadata.
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

/** Heuristic for "this plugin's source lives in this repo, not upstream".
 *  Used to set the `external` flag — true when no in-tree manifest exists
 *  under `plugins/<name>/`, meaning the plugin is published through an
 *  upstream marketplace (skill-creator / claude-md-management / codex) and
 *  the EXTERNAL badge tells users to defer to `claude plugins update`. */
function pluginHasLocalManifest(repoRoot: string, name: string): boolean {
  const candidates = [
    path.join(repoRoot, "plugins", name, ".claude-plugin", "plugin.json"),
    path.join(repoRoot, "plugins", name, ".codex-plugin", "plugin.json"),
  ];
  return candidates.some((p) => fs.existsSync(p));
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

  const extraConfigs = loadExtraPluginConfigs(repoRoot);
  const claudeExtraByName = extraByNameForRuntime(extraConfigs, "claude");
  const pluginByName = new Map<string, CatalogEntry>();
  const claudeMarketplace = loadClaudeMarketplace(repoRoot);
  if (claudeMarketplace) {
    for (const marketplacePlugin of claudeMarketplace.plugins) {
      const p = applyExtraPluginFields<{
        name: string;
        description: string;
        defaultOn?: boolean;
      }>({
        name: marketplacePlugin.name,
        description: marketplacePlugin.description ?? marketplacePlugin.name,
      }, claudeExtraByName.get(marketplacePlugin.name));
      pluginByName.set(p.name, {
        name: p.name,
        description: p.defaultOn === false ? `(opt-in) ${p.description}` : p.description,
        agents: ["claude"],
      });
    }
  }
  for (const p of extraConfigs.plugins) {
    if (!extraAppliesTo(p, "claude") || !p.claude?.package) continue;
    pluginByName.set(p.name, {
      name: p.name,
      description: p.defaultOn === false
        ? `(opt-in) ${p.description ?? p.name}`
        : p.description ?? p.name,
      agents: ["claude"],
      external: true,
    });
  }

  const codexMarketplacePath = path.join(repoRoot, ".agents", "plugins", "marketplace.json");
  if (fs.existsSync(codexMarketplacePath)) {
    const codexMarketplaceRaw: unknown = JSON.parse(fs.readFileSync(codexMarketplacePath, "utf-8"));
    validateCodexMarketplace(codexMarketplaceRaw);
    const codexMarketplace = codexMarketplaceRaw as CodexMarketplace;
    const codexExtraByName = extraByNameForRuntime(extraConfigs, "codex");
    for (const marketplacePlugin of codexMarketplace.plugins) {
      const p = applyExtraPluginFields<{
        name: string;
        description: string;
        defaultOn?: boolean;
      }>({
        name: marketplacePlugin.name,
        description: readLocalCodexManifestDescription(repoRoot, marketplacePlugin)
          ?? marketplacePlugin.name,
      }, codexExtraByName.get(marketplacePlugin.name));
      const existing = pluginByName.get(p.name);
      const description = p.description;

      // Agent map: if existing came from the Claude pass it's ["claude"]; this
      // pass adds "codex". Codex-only entries get ["codex"].
      const agents: ("claude" | "codex")[] = existing
        ? ["claude", "codex"]
        : ["codex"];
      // external flag: true when no in-tree manifest in this repo's plugins/.
      // The Claude pass may have already set it; respect either signal —
      // a plugin we don't own on either Agent side stays external.
      const external = !pluginHasLocalManifest(repoRoot, p.name);
      pluginByName.set(p.name, {
        name: p.name,
        description: existing
          ? `(Claude/Codex) ${existing.description}`
          : `(Codex) ${description}`,
        agents,
        ...(external ? { external: true } : {}),
      });
    }
  }
  for (const p of extraConfigs.plugins) {
    if (!extraAppliesTo(p, "codex") || !p.codex?.marketplace) continue;
    const existing = pluginByName.get(p.name);
    pluginByName.set(p.name, {
      name: p.name,
      description: existing
        ? `(Claude/Codex) ${existing.description}`
        : `(Codex) ${p.description ?? p.name}`,
      agents: existing ? ["claude", "codex"] : ["codex"],
      external: true,
    });
  }
  const plugins: CatalogEntry[] = [...pluginByName.values()];

  return {
    generatedAt: new Date().toISOString(),
    workflowSkills,
    recommendedSkills,
    plugins,
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
    `✓ catalog.json: ${catalog.workflowSkills.length} workflow / ${catalog.recommendedSkills.length} recommended / ${catalog.plugins.length} plugins`,
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
