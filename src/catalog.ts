import fs from "node:fs";
import path from "node:path";

export interface CatalogEntry {
  name: string;
  description: string;
  /** Build-time-baked agent map for plugin entries. Derived from
   *  `.claude/plugins.json` ∪ `.agents/plugins/install.json` — those config
   *  files are NOT shipped in the npm tarball, so the scanner can't read
   *  them at runtime. Baking here lets `/api/state` correctly classify
   *  dual-Agent plugins as `["claude","codex"]` for installed users.
   *  Absent on skill / hook entries. */
  agents?: ("claude" | "codex")[];
  /** True for plugins whose source lives in an UPSTREAM marketplace
   *  (skill-creator / claude-md-management / codex), not in this repo.
   *  Pure UI hint since v1.19.0 — the EXTERNAL badge tells users that
   *  upgrades go through `claude plugins update`, not us. */
  external?: boolean;
}

export interface Catalog {
  generatedAt: string;
  workflowSkills: CatalogEntry[];
  recommendedSkills: CatalogEntry[];
  plugins: CatalogEntry[];
  hooks: CatalogEntry[];
}

export function loadCatalog(packageRoot: string): Catalog {
  const catalogPath = path.join(packageRoot, "dist", "catalog.json");
  if (!fs.existsSync(catalogPath)) {
    throw new Error(
      `catalog missing at ${catalogPath}. Run 'npm run build' or reinstall the package.`,
    );
  }
  return JSON.parse(fs.readFileSync(catalogPath, "utf-8")) as Catalog;
}
