// Shared shape + validators for cross-Agent marketplace references.
// Used by:
//   - extra_plugin_configs.json external plugin refs
//   - Codex local marketplace materialization refs
//
// Both sides interpolate `<source>` into shell commands like
// `codex plugin marketplace add https://github.com/<source>.git` and
// `<plugin>@<name>` into TOML keys, so these regexes are the only thing
// standing between a compromised metadata source and arbitrary command
// execution. Tighten with care — a regression here is a shell-injection
// vector. The metadata files are fetched from raw GitHub at runtime.

export const MARKETPLACE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// GitHub `owner/repo` shape: exactly one `/`, both segments kebab-case-ish
// without leading punctuation. Tighter than the prior PLUGIN_SOURCE_RE
// which permitted multi-slash / `..` / trailing `.git` patterns and would
// compose into confusing git-layer errors like `https://github.com/a/../b.git`.
export const MARKETPLACE_SOURCE_RE =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface MarketplaceRef {
  name: string;
  source: string;
}

// Centralizes the marketplace field shape check so Claude and Codex plugin
// config paths stay in lockstep. `label` is interpolated into the thrown Error
// so the caller's file context survives.
export function validateMarketplaceField(
  label: string,
  raw: unknown,
): asserts raw is MarketplaceRef {
  if (!raw || typeof raw !== "object") {
    throw new Error(`${label}.marketplace must be an object`);
  }
  const mp = raw as Record<string, unknown>;
  if (typeof mp.name !== "string" || !MARKETPLACE_NAME_RE.test(mp.name)) {
    throw new Error(
      `${label}.marketplace.name ${JSON.stringify(mp.name)} does not match ${MARKETPLACE_NAME_RE}`,
    );
  }
  if (typeof mp.source !== "string" || !MARKETPLACE_SOURCE_RE.test(mp.source)) {
    throw new Error(
      `${label}.marketplace.source ${JSON.stringify(mp.source)} does not match ${MARKETPLACE_SOURCE_RE}`,
    );
  }
}
