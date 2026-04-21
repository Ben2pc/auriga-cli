import type { Catalog, CatalogEntry } from "./catalog.js";

/**
 * Renders the detailed `--help` output per spec §4. Agent-readable
 * catalog of every installable: Agent can decide what to pass to
 * `install <type>` without a second round-trip.
 */
export function renderHelp(catalog: Catalog, version: string): string {
  const col = (entries: CatalogEntry[]): string =>
    entries.map((e) => `  ${padRight(e.name, 30)} ${truncate(e.description, 50)}`).join("\n");

  return `auriga-cli v${version} — install Claude Code harness modules

USAGE
  npx auriga-cli guide                                   Agent bootstrap SOP (start here)
  npx auriga-cli install                                 (TTY only) checkbox menu
  npx auriga-cli install --all [--scope <s>]             workflow + skills + plugins + hooks
                                                         (excludes recommended — install separately)
  npx auriga-cli install <type> [type-specific flags]    single category
  npx auriga-cli --help

  For non-interactive (Agent) use, prepend npx's own -y flag:
    npx -y auriga-cli guide
    npx -y auriga-cli install --all

TYPES (exactly one with <type> form)
  workflow       CLAUDE.md + AGENTS.md (workflow manifesto)
  skills         Default-on workflow skills (listed below)
  recommended    Opt-in utility skills (listed below)
  plugins        Claude Code plugins (listed below)
  hooks          Project-level hooks for Claude Code (listed below)

TYPE-SPECIFIC FLAGS
  workflow:       --lang <code>    default en; available: en, zh-CN
                  --cwd <dir>      default current working directory
  skills:         --skill <names...>             space-separated; '*' = all
                  --scope <project|user>         default project
  recommended:    --recommended-skill <names...>
                  --scope <project|user>
  plugins:        --plugin <names...>
                  --scope <project|user>
  hooks:          --hook <names...>

TOP-LEVEL OPTIONS
  -h, --help                     show this help
  -v, --version                  show version

──────────────────────────────────────────────────────
CATALOG (what each category contains)
──────────────────────────────────────────────────────

Workflow skills (category: skills)  ← installed by --all
${col(catalog.workflowSkills)}

Recommended skills (category: recommended)  ← NOT installed by --all
${col(catalog.recommendedSkills)}

Plugins (category: plugins)
${col(catalog.plugins)}

Hooks (category: hooks)
${col(catalog.hooks)}

More: https://github.com/Ben2pc/auriga-cli
`;
}

function padRight(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function truncate(s: string, width: number): string {
  return s.length <= width ? s : s.slice(0, width - 1) + "…";
}
