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
  /** Build-time-baked agent map for plugin entries. Derived from
   *  `.claude/plugins.json` ∪ `.agents/plugins/install.json` — those config
   *  files are NOT shipped in the npm tarball, so the scanner can't read
   *  them at runtime. Baking here lets `/api/state` correctly classify
   *  dual-Agent plugins as `["claude","codex"]` for installed users.
   *  Absent on skill / hook entries. */
  agents?: ("claude" | "codex")[];
  /** True for plugins whose source lives in an UPSTREAM marketplace
   *  (skill-creator / claude-md-management / codex), not in this repo. The
   *  scanner uses this to disable update-available reporting — those
   *  plugins update through `claude plugins update`, not through us. UI
   *  surfaces an EXTERNAL badge so users know where to look. */
  external?: boolean;
}

export interface Catalog {
  generatedAt: string;
  /** Workflow content version baked from `CLAUDE.md`'s `# auriga Workflow (vX.Y.Z)`
   *  header at build time. MUST live here rather than be read at runtime
   *  because `CLAUDE.md` is NOT in the npm tarball — `package.json` `files`
   *  allowlists only `dist/`. Empty string when the header is unparseable;
   *  the scanner then degrades to "trust whatever the user has" rather than
   *  forcing phantom update-available against an empty expected value. */
  workflowVersion: string;
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
