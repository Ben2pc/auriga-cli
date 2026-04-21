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

This guide walks an Agent through installing the auriga harness
(CLAUDE.md + skills + plugins + hooks) into the current repository.

Run each step in order. If any step fails with exit 1, stop and report.
If exit 2, see stderr for per-category status and follow the "Retry"
hint.

${h("## Step 1 — Prerequisite check")}

Ensure these CLIs are in PATH:
  - node   (>= 18)
  - git
  - claude (required for plugins; see https://docs.claude.com/claude-code)

Optional (only if you'll push a PR): gh

Verify:
  ${cmd("node --version && git --version && claude --version")}

If \`claude\` is missing: install Claude Code first, then re-run this guide.

${h("## Step 2 — Install harness")}

Full install (workflow + skills + plugins + hooks):
  ${cmd("npx -y auriga-cli install --all")}

(The leading \`-y\` is npx's flag; it suppresses npx's "is it OK to
install this package?" prompt. Required for non-interactive sessions.)

Exit codes:
  0  — all categories installed
  1  — fatal error (parse / fetch / missing prerequisite). Read stderr;
       fix the root cause and re-run the SAME command.
  2  — partial success. stderr lists per-category status. Retry only the
       failed category, e.g.:
         ${cmd("npx -y auriga-cli install plugins")}
         ${cmd("npx -y auriga-cli install hooks")}

${h("## Step 3 — (Optional) Install recommended skills")}

Opt-in utility skills (claude-code-agent, codex-agent — cross-model
delegation helpers):
  ${cmd("npx -y auriga-cli install recommended")}

Skip if you don't need cross-model delegation.

${h("## Step 4 — Reload session (REQUIRED when installed non-interactively)")}

${warn("⚠")} CLAUDE.md, .agents/skills/, .claude/plugins.json, and hook
registrations are loaded at Claude Code session startup. If you ran
\`npx -y auriga-cli install\` inside an existing Claude Code session
(e.g., \`claude -p\` / \`claude -p --worktree\`), the current session
will NOT see the new harness.

Action:
  - Commit any in-flight work first
  - Exit this session and start a new one to pick up the harness
  - Resume the original task in the new session

${h("## Step 5 — Verify install")}

Expected artifacts:
  - CLAUDE.md                 (workflow manifesto)
  - AGENTS.md -> CLAUDE.md    (symlink)
  - .agents/skills/<name>/    (one per installed skill)
  - .claude/plugins.json
  - .claude/settings.json     (updated hook registrations, if hooks selected)

${h("## Catalog (for finer control)")}

For per-skill / per-plugin descriptions to decide what to install:
  ${cmd("npx -y auriga-cli --help")}

${h("## Troubleshooting")}

- Network error during fetch → retry; if persistent, check GitHub raw access
- "catalog missing" error → re-install the package (\`npx clear-npx-cache\`)
- \`claude plugins install\` hangs → abort, report; see known issue list
`;
}
