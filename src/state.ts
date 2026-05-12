// Stub for test designer's red phase. The real implementation must
// replace this body. Tests in tests/state.test.ts exercise behavioral
// contracts defined in docs/specs/web-ui.md §6.3 and §10.4.
//
// The stub returns a structurally valid but trivially wrong StateReport
// (all categories empty, workflow not-installed regardless of input) so
// `import { scanState } from "../src/state.js"` compiles + the tests
// produce real assertion-mismatch failures (not "cannot find module"
// fake-red failures). The implementer should delete everything below
// the `// ---- IMPLEMENTATION GOES BELOW ----` line.

import type { StateReport } from "./api-types.js";

export interface Catalog {
  workflowVersion: string;
  skills: Record<string, { description: string; expectedHash: string; isWorkflow: boolean }>;
  recommendedSkills: Record<string, { description: string; expectedHash: string }>;
  plugins: Record<
    string,
    {
      description: string;
      agent: "claude" | "codex";
      expectedVersion?: string;
    }
  >;
  hooks: Record<string, { description: string; expectedHash: string }>;
}

export interface ScanOptions {
  execPluginList?: () => Promise<{ installed: any[]; available: any[] }>;
  readCodexConfig?: () => Promise<string | null>;
  readCodexPluginsDir?: () => Promise<Map<string, string>>;
}

// ---- IMPLEMENTATION GOES BELOW ----

export async function scanState(
  _projectRoot: string,
  catalog: Catalog,
  _opts?: ScanOptions,
): Promise<StateReport> {
  return {
    workflow: { status: "not-installed", expectedVersion: catalog.workflowVersion },
    skills: [],
    recommendedSkills: [],
    plugins: [],
    hooks: [],
    warnings: [],
  };
}
