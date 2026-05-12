import fs from "node:fs";
import path from "node:path";

export interface CatalogEntry {
  name: string;
  description: string;
  /** Build-time-baked plugin version. Set ONLY for plugin entries whose
   *  source lives in this repo's `plugins/<name>/` directory — the scanner
   *  uses it to surface "update-available" when the user's installed copy
   *  is older. Absent for skill / hook entries and for external-marketplace
   *  plugins (whose manifest lives upstream). Must be baked at build time
   *  because `plugins/<name>/.claude-plugin/plugin.json` is NOT shipped in
   *  the npm tarball (see `package.json` `files` field). */
  expectedVersion?: string;
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
