// Shared host-protocol detection and I/O helpers for git lifecycle hooks.
//
// Claude Code, Codex, Cursor, and Grok share exit-code / stderr blocking and
// hookSpecificOutput context injection. Antigravity uses distinct payload
// fields (`workspacePaths`, `toolCall`, `artifactDirectoryPath`, `conversationId`)
// and expects `{}` on PreToolUse allow / PostToolUse no-op (preserving host
// permission policy) and `{"decision":"deny","reason":...}` on PreToolUse block
// with exit code 0.

export function isAntigravity(data, env = process.env) {
  if (data?.tool_input != null || data?.toolInput != null) {
    return false;
  }
  if (data && typeof data === "object") {
    return (
      Array.isArray(data.workspacePaths) ||
      typeof data.artifactDirectoryPath === "string" ||
      typeof data.conversationId === "string" ||
      (typeof data.toolCall === "object" &&
        data.toolCall !== null &&
        !Array.isArray(data.toolCall) &&
        typeof data.toolCall.name === "string")
    );
  }
  if (data == null) {
    return Boolean(env?.PLUGIN_ROOT && !env?.CLAUDE_PLUGIN_ROOT);
  }
  return false;
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
    process.stdout.write("{}\n");
  }
  process.exitCode = 0;
}

export function blockPreToolUse(antigravity, prefix, reason) {
  if (antigravity) {
    process.stdout.write(
      JSON.stringify({ decision: "deny", reason: `${prefix}: ${reason}` }) +
        "\n",
    );
    process.exitCode = 0;
    return;
  }
  process.stderr.write(`${prefix}: ${reason}\n`);
  process.exitCode = 2;
}

export function injectPreToolUse(antigravity, message) {
  if (antigravity) {
    // Antigravity PreToolUse does not support additionalContext injection;
    // return `{}` so host default permission prompts stay intact.
    process.stdout.write("{}\n");
    process.exitCode = 0;
    return;
  }
  const out = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: message,
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.exitCode = 0;
}

export function noopPostToolUse() {
  process.stdout.write("{}\n");
  process.exitCode = 0;
}
