// Shared host-protocol detection and I/O helpers for git lifecycle hooks.
//
// Claude Code, Codex, Cursor, and Grok share exit-code / stderr blocking and
// hookSpecificOutput context injection. Antigravity uses distinct payload
// fields (`workspacePaths`, `toolCall`, `artifactDirectoryPath`) and expects
// JSON permission decisions on PreToolUse (`{"decision":"allow"|"deny"}`)
// and `{}` on PostToolUse with exit code 0.

export function isAntigravity(data) {
  return Boolean(
    data &&
      typeof data === "object" &&
      (Array.isArray(data.workspacePaths) ||
        data.toolCall != null ||
        typeof data.artifactDirectoryPath === "string"),
  );
}

export function extractShellCommand(data) {
  const cmd =
    data?.tool_input?.command ??
    data?.toolInput?.command ??
    data?.toolCall?.args?.CommandLine;
  return typeof cmd === "string" ? cmd : null;
}

export function allowPreToolUse(antigravity) {
  if (antigravity) {
    process.stdout.write('{"decision":"allow"}\n');
  }
  process.exit(0);
}

export function blockPreToolUse(antigravity, prefix, reason) {
  if (antigravity) {
    process.stdout.write(
      JSON.stringify({ decision: "deny", reason: `${prefix}: ${reason}` }) +
        "\n",
    );
    process.exit(0);
  }
  process.stderr.write(`${prefix}: ${reason}\n`);
  process.exit(2);
}

export function injectPreToolUse(antigravity, message) {
  if (antigravity) {
    // Antigravity PreToolUse only supports allow/deny decisions, not
    // additionalContext injection.
    process.stdout.write('{"decision":"allow"}\n');
    process.exit(0);
  }
  const out = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: message,
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

export function noopPostToolUse() {
  process.stdout.write("{}\n");
  process.exit(0);
}
