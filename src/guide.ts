export interface GuideOpts {
  color: boolean;
  version: string;
}

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function c(color: boolean, code: string, text: string): string {
  return color ? `${code}${text}${RESET}` : text;
}

/**
 * Renders the Agent-bootstrap SOP per spec §3.6. Plain-text when
 * `color: false`; adds ANSI escapes for headings / command examples
 * / warnings when `color: true`. Color detection happens at the call
 * site (`process.stdout.isTTY && !process.env.NO_COLOR`); this
 * function just renders what it's told.
 */
export function renderGuide(opts: GuideOpts): string {
  const h = (s: string) => c(opts.color, BOLD + CYAN, s);
  const cmd = (s: string) => c(opts.color, DIM, s);
  const warn = (s: string) => c(opts.color, YELLOW, s);

  return `${h(`# auriga-cli bootstrap SOP (v${opts.version})`)}

This guide helps an interactive Agent install the auriga harness
(AGENTS.md + skills + plugins) into the current repository.

It is meant to be read by an Agent after the user asks it to install
Auriga from an interactive session.

Run each step in order. If any step fails with exit 1, stop and report.
If exit 2, see stderr for per-category status and follow the "Retry"
hint.

${h("## Step 1 — Prerequisite check")}

Ensure these CLIs are in PATH:
  - node   (>= 18)
  - git
  - claude (required for plugins; see https://docs.claude.com/claude-code)
  - codex  (required only for plugins installed with --agent codex or --agent both)

Optional (only if you'll push a PR): gh

Verify:
  ${cmd("node --version && git --version && claude --version")}

If \`claude\` is missing: install Claude Code first, then re-run this guide.
If you plan to install Codex plugins, also verify \`codex --version\`.

${h("## Step 2 — Read --help BEFORE installing (do not skip)")}

${warn("⚠")} Always inspect the catalog first so you know which skills
and plugins are actually relevant for this project. Blindly
running \`install --preset\` works as a turnkey bootstrap, but for
anything beyond a greenfield setup you should narrow scope.

Top-level catalog (every workflow skill / recommended skill / plugin
with a short description):
  ${cmd("npx -y auriga-cli --help")}

Per-type detail (flags + only that category's catalog slice):
  ${cmd("npx -y auriga-cli install workflow --help")}
  ${cmd("npx -y auriga-cli install skills --help")}
  ${cmd("npx -y auriga-cli install recommended --help")}
  ${cmd("npx -y auriga-cli install plugins --help")}

${h("## Step 3 — Install")}

Recommended — the curated workflow preset (AGENTS.md/CLAUDE.md +
workflow skills + the auriga-workflow plugin). Defaults: scope user,
agent both (Claude Code + Codex), lang zh-CN. Scope applies to skills
and plugins; the workflow doc always writes to the current project:
  ${cmd("npx -y auriga-cli install --preset")}

Everything — workflow + skills + recommended skills + default plugins:
  ${cmd("npx -y auriga-cli install --all")}

Targeted — single category, picking from the catalog surfaced in Step 2:
  ${cmd("npx -y auriga-cli install workflow --lang en")}
  ${cmd("npx -y auriga-cli install skills --skill systematic-debugging test-driven-development")}
  ${cmd("npx -y auriga-cli install plugins --plugin skill-creator codex --scope user")}
  ${cmd("npx -y auriga-cli install plugins --agent codex --plugin session-instructions-loader")}

Opt-in plugins (\`defaultOn: false\`) are NOT in the default \`install --all\`
set because they have side effects or platform-specific behavior. For example,
the macOS notification plugin is explicit opt-in:
  ${cmd("npx -y auriga-cli install plugins --plugin auriga-notify")}

Opt-in recommended skills (cross-model delegation helpers —
claude-code-agent, codex-agent):
  ${cmd("npx -y auriga-cli install recommended")}

(The leading \`-y\` is npx's flag; it suppresses the "is it OK to install
this package?" prompt. Required for non-interactive sessions.)

Exit codes:
  0  — all requested categories installed
  1  — fatal error (parse / fetch / missing prerequisite). Read stderr;
       fix the root cause and re-run the SAME command.
  2  — partial success. stderr lists per-category status. Retry only the
       failed category (the retry line is printed verbatim on stderr).

${h("## Step 4 — Reload session after install")}

${warn("⚠")} AGENTS.md, .agents/skills/, and plugin enablement /
registrations are loaded at session startup. If you installed Auriga
from an existing Agent session, the current session may NOT see the new
harness.

Action:
  - Commit any in-flight work first
  - Exit this session and start a new one to pick up the harness
  - Resume the original task in the new session

${h("## Step 5 — Verify install")}

Expected artifacts/checks:
  - AGENTS.md                 (workflow manifesto, Chinese by default)
  - CLAUDE.md -> AGENTS.md    (Claude Code compatibility symlink)
  - .agents/skills/<name>/    (one per installed skill)
  - claude plugins list       (shows Claude plugins, if Claude plugins selected)
  - ~/.codex/config.toml      (Codex plugin enablement, if Codex plugins selected)
  - .claude/settings.json     (updated plugin registrations, if selected)
  - .claude/auriga-notify/    (project notify config, if auriga-notify selected)

${h("## Troubleshooting")}

- Network error during fetch → retry; if persistent, check GitHub raw access
- "catalog missing" error → re-install the package (\`npx clear-npx-cache\`)
- \`claude plugins install\` hangs → abort, report; see known issue list
`;
}
