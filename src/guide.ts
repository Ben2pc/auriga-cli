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

${h("## Step 2 — Read --help BEFORE installing (do not skip)")}

${warn("⚠")} Always inspect the catalog first so you know which skills,
plugins, and hooks are actually relevant for this project. Blindly
running \`install --all\` works as a turnkey preset, but for anything
beyond a greenfield bootstrap you should narrow scope.

Top-level catalog (every workflow skill / recommended skill / plugin /
hook with a short description):
  ${cmd("npx -y auriga-cli --help")}

Per-type detail (flags + only that category's catalog slice):
  ${cmd("npx -y auriga-cli install workflow --help")}
  ${cmd("npx -y auriga-cli install skills --help")}
  ${cmd("npx -y auriga-cli install recommended --help")}
  ${cmd("npx -y auriga-cli install plugins --help")}
  ${cmd("npx -y auriga-cli install hooks --help")}

${h("## Step 3 — Install")}

Preset — the full default-on set (workflow + skills + plugins + hooks;
recommended skills are NOT included):
  ${cmd("npx -y auriga-cli install --all")}

Targeted — single category, picking from the catalog surfaced in Step 2:
  ${cmd("npx -y auriga-cli install workflow --lang en")}
  ${cmd("npx -y auriga-cli install skills --skill brainstorming test-driven-development")}
  ${cmd("npx -y auriga-cli install plugins --plugin skill-creator codex --scope user")}
  ${cmd("npx -y auriga-cli install hooks --hook pr-ready-guard")}

Opt-in hooks: some hooks (e.g. \`notify\`) are NOT in the default set
because they have side effects (OS notifications, platform-gated deps).
Name them explicitly to install:
  ${cmd("npx -y auriga-cli install hooks --hook notify")}

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

${h("## Troubleshooting")}

- Network error during fetch → retry; if persistent, check GitHub raw access
- "catalog missing" error → re-install the package (\`npx clear-npx-cache\`)
- \`claude plugins install\` hangs → abort, report; see known issue list
`;
}
