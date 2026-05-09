import path from "node:path";

const PLUGIN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MARKETPLACE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// External marketplace source: GitHub-style `owner/repo` slug; reused
// by the Codex install path to compose `https://github.com/<source>.git`.
// Identical shape to PLUGIN_SOURCE_RE in src/plugins.ts.
const MARKETPLACE_SOURCE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;

export interface CodexMarketplacePlugin {
  name: string;
  source?: {
    source?: string;
    path?: string;
  } | string;
}

export interface CodexMarketplace {
  name: string;
  plugins: CodexMarketplacePlugin[];
}

export interface CodexInstallExternalMarketplace {
  name: string;
  source: string;
}

export interface CodexInstallPlugin {
  name: string;
  description?: string;
  defaultOn?: boolean;
  // Set when the plugin lives in an external Codex marketplace (e.g.
  // `Ben2pc/g-claude-code-plugins`). Local plugins from this repo's
  // own `.agents/plugins/marketplace.json` omit this field. Mirrors the
  // shape of `PluginDef.marketplace` in src/utils.ts (Claude side) so
  // the two installers stay symmetric.
  marketplace?: CodexInstallExternalMarketplace;
}

export interface CodexInstallConfig {
  plugins: CodexInstallPlugin[];
}

export function validateCodexMarketplace(raw: unknown): asserts raw is CodexMarketplace {
  if (!raw || typeof raw !== "object") {
    throw new Error("Codex marketplace.json: root must be an object");
  }
  const cfg = raw as Record<string, unknown>;
  if (typeof cfg.name !== "string" || !MARKETPLACE_NAME_RE.test(cfg.name)) {
    throw new Error("Codex marketplace.json: root must include a safe name");
  }
  if (!Array.isArray(cfg.plugins)) {
    throw new Error("Codex marketplace.json: .plugins must be an array");
  }
  for (const [i, plugin] of cfg.plugins.entries()) {
    if (!plugin || typeof plugin !== "object") {
      throw new Error(`Codex marketplace.json: plugins[${i}] must be an object`);
    }
    const p = plugin as Record<string, unknown>;
    if (typeof p.name !== "string" || !PLUGIN_NAME_RE.test(p.name)) {
      throw new Error(
        `Codex marketplace.json: plugins[${i}].name ${JSON.stringify(p.name)} does not match ${PLUGIN_NAME_RE}`,
      );
    }
  }
}

export function validateCodexInstallConfig(raw: unknown): asserts raw is CodexInstallConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("Codex install.json: root must be an object");
  }
  const cfg = raw as Record<string, unknown>;
  if (!Array.isArray(cfg.plugins)) {
    throw new Error("Codex install.json: .plugins must be an array");
  }
  for (const [i, plugin] of cfg.plugins.entries()) {
    if (!plugin || typeof plugin !== "object") {
      throw new Error(`Codex install.json: plugins[${i}] must be an object`);
    }
    const p = plugin as Record<string, unknown>;
    if (typeof p.name !== "string" || !PLUGIN_NAME_RE.test(p.name)) {
      throw new Error(
        `Codex install.json: plugins[${i}].name ${JSON.stringify(p.name)} does not match ${PLUGIN_NAME_RE}`,
      );
    }
    if (p.description !== undefined && typeof p.description !== "string") {
      throw new Error(`Codex install.json: plugins[${i}].description must be a string`);
    }
    if (p.defaultOn !== undefined && typeof p.defaultOn !== "boolean") {
      throw new Error(`Codex install.json: plugins[${i}].defaultOn must be a boolean`);
    }
    if (p.marketplace !== undefined) {
      if (!p.marketplace || typeof p.marketplace !== "object") {
        throw new Error(`Codex install.json: plugins[${i}].marketplace must be an object`);
      }
      const mp = p.marketplace as Record<string, unknown>;
      if (typeof mp.name !== "string" || !MARKETPLACE_NAME_RE.test(mp.name)) {
        throw new Error(
          `Codex install.json: plugins[${i}].marketplace.name ${JSON.stringify(mp.name)} does not match ${MARKETPLACE_NAME_RE}`,
        );
      }
      if (typeof mp.source !== "string" || !MARKETPLACE_SOURCE_RE.test(mp.source)) {
        throw new Error(
          `Codex install.json: plugins[${i}].marketplace.source ${JSON.stringify(mp.source)} does not match ${MARKETPLACE_SOURCE_RE}`,
        );
      }
    }
  }
}

export function codexLocalPluginPath(plugin: CodexMarketplacePlugin): string | undefined {
  const sourcePath = typeof plugin.source === "object" && plugin.source?.source === "local"
    ? plugin.source.path
    : undefined;
  if (typeof sourcePath !== "string" || sourcePath.length === 0) return undefined;
  if (sourcePath.startsWith("/") || sourcePath.startsWith("\\") || sourcePath.includes("\0")) {
    throw new Error(`Codex marketplace.json: plugin ${plugin.name} has unsafe source.path`);
  }
  if (sourcePath.includes("\\")) {
    throw new Error(`Codex marketplace.json: plugin ${plugin.name} source.path must use POSIX separators`);
  }
  const withoutDot = sourcePath.startsWith("./") ? sourcePath.slice(2) : sourcePath;
  const normalized = path.posix.normalize(withoutDot);
  if (
    normalized !== withoutDot ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`Codex marketplace.json: plugin ${plugin.name} has unsafe source.path`);
  }
  return normalized;
}

export function codexManifestPath(plugin: CodexMarketplacePlugin): string | undefined {
  const sourcePath = codexLocalPluginPath(plugin);
  return sourcePath ? path.posix.join(sourcePath, ".codex-plugin", "plugin.json") : undefined;
}
