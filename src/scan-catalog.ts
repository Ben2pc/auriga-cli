// Build the scan-time Catalog (the shape src/state.ts consumes) from the
// build-time `dist/catalog.json`. Thin adapter — reads dist/catalog.json
// only. v1.19.0 dropped all version / hash / event comparison from the
// scanner, so the build-time catalog is reduced to {description, agents?,
// external?} per entry; runtime reads outside dist/ are no longer needed.

import { loadCatalog } from "./catalog.js";
import type { Catalog as ScanCatalog } from "./state.js";


export async function buildScanCatalog(
  packageRoot: string,
): Promise<ScanCatalog> {
  const dist = loadCatalog(packageRoot);

  // v1.19.0 dropped update-available status. The scanner is now presence-
  // only: skills / hooks / plugins / workflow all report installed iff their
  // truth source exists, not-installed otherwise. No version / hash / event
  // comparison happens, so the build-time catalog is reduced to the bare
  // {description, agents?, external?} shape per entry.
  const skills: ScanCatalog["skills"] = {};
  for (const entry of dist.workflowSkills) {
    skills[entry.name] = {
      description: entry.description,
      isWorkflow: true,
    };
  }
  const recommendedSkills: ScanCatalog["recommendedSkills"] = {};
  for (const entry of dist.recommendedSkills) {
    recommendedSkills[entry.name] = {
      description: entry.description,
    };
  }
  const plugins: ScanCatalog["plugins"] = {};
  for (const entry of dist.plugins) {
    const agents: ("claude" | "codex")[] =
      Array.isArray(entry.agents) && entry.agents.length > 0
        ? [...entry.agents]
        : ["claude"]; // safety fallback: unknown shape defaults to claude
    plugins[entry.name] = {
      description: entry.description,
      agents,
      ...(entry.external === true ? { external: true } : {}),
    };
  }
  return { skills, recommendedSkills, plugins };
}
