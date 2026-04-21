import fs from "node:fs";
import path from "node:path";

export interface CatalogEntry {
  name: string;
  description: string;
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
