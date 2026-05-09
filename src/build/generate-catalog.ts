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
    pluginByName.set(p.name, { name: p.name, description: p.description });
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
        const relativeManifestPath = codexManifestPath(marketplacePlugin);
        const manifestPath = relativeManifestPath
          ? path.join(repoRoot, relativeManifestPath)
          : undefined;
        if (manifestPath && fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
            description?: unknown;
            interface?: { shortDescription?: unknown };
          };
          if (description === "Codex plugin") {
            description = typeof manifest.interface?.shortDescription === "string"
              ? manifest.interface.shortDescription
              : typeof manifest.description === "string" ? manifest.description
              : description;
          }
        }
      }

      pluginByName.set(p.name, {
        name: p.name,
        description: existing
          ? `(Claude/Codex) ${existing.description}`
          : `(Codex) ${description}`,
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

  return {
    generatedAt: new Date().toISOString(),
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
