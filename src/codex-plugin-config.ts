import path from "node:path";

import { MARKETPLACE_NAME_RE } from "./marketplace.js";

const PLUGIN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

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
