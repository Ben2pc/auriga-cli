#!/usr/bin/env node
// pr-create-guard — PreToolUse hook for `gh pr create`.
//
// Block only on structural signals (no text regex of PR content):
//   - No body source flag at all (Agent forgot --body/--body-file/--template)
//   - --body "" literal empty
//   - --body-file <path> with non-existent file
//
// Filter (additionalContext) otherwise: extract body (best-effort — simple
// quotes + --body-file read), scan ^## / ^### headings, report what was
// found. Never diagnose "missing X" — Agent interprets.

import fs from "node:fs";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    const cmd = data?.tool_input?.command;
    if (typeof cmd !== "string") return exitSilent();
    // Require `gh pr create` as a token sequence (boundary-aware) to avoid
    // matching things like `git log --grep='gh pr create'` in a commit msg.
    if (!/\bgh\s+pr\s+create\b/.test(cmd)) return exitSilent();
    handle(cmd);
  } catch {
    // Never block on our own parse errors — staying out of the way beats
    // false positives.
    exitSilent();
  }
});

function handle(cmd) {
  const { tokens, unclosed } = tokenize(cmd);
  if (unclosed) {
    return inject(
      "[pr-create-guard] Unmatched quote in command; could not parse. Verify PR body covers scope / acceptance / risks / TODO.",
    );
  }

  // B1: no body source flag at all
  const BODY_FLAGS = ["--body", "-b", "--body-file", "--template"];
  const hasFlag = tokens.some(
    (t) => BODY_FLAGS.includes(t) || BODY_FLAGS.some((f) => t.startsWith(f + "=")),
  );
  if (!hasFlag) {
    return block(
      "No body source. Pass --body, --body-file, or --template. PR body must include scope / acceptance criteria / risks / remaining TODO.",
    );
  }

  const bodyFile = getFlag(tokens, "--body-file");
  const template = getFlag(tokens, "--template");
  const body = getFlag(tokens, "--body") ?? getFlag(tokens, "-b");

  // B3: body-file path that doesn't exist (structural)
  if (bodyFile !== undefined && bodyFile !== "" && !fs.existsSync(bodyFile)) {
    return block(`--body-file ${JSON.stringify(bodyFile)} not found.`);
  }

  // Extract body text from the first available source.
  let bodyText = null;
  let source = null;
  if (bodyFile !== undefined && bodyFile !== "") {
    try {
      bodyText = fs.readFileSync(bodyFile, "utf8");
      source = `--body-file ${bodyFile}`;
    } catch {
      bodyText = null;
      source = `--body-file ${bodyFile} (unreadable)`;
    }
  } else if (template !== undefined) {
    // gh --template either picks a named template under .github/
    // or the default .github/pull_request_template.md. We don't try
    // to resolve it — just acknowledge and skip heading scan.
    return inject(
      `[pr-create-guard] PR body source: --template ${template}. Heading scan skipped. Verify scope / acceptance / risks / TODO are covered by the template content.`,
    );
  } else if (body !== undefined) {
    // B2: empty --body literal (structural)
    if (body === "") {
      return block(
        "Empty --body. PR body must include scope / acceptance criteria / risks / remaining TODO.",
      );
    }
    bodyText = body;
    source = "--body";
  }

  if (bodyText === null) {
    // Shouldn't reach here given the flag-presence check, but fail open.
    return exitSilent();
  }

  // Fallback detection: if the command contains `$(...)` or heredoc markers
  // AND our extracted body looks like the literal substitution syntax
  // itself (rather than expanded content), tokenization captured the
  // unsubstituted form. Be honest about it.
  if (
    source === "--body" &&
    (/\$\(/.test(bodyText) || /<<[-]?\s*['"]?\w+/.test(bodyText))
  ) {
    return inject(
      "[pr-create-guard] Body source detected but not statically parseable (likely heredoc or subshell). Verify scope / acceptance / risks / TODO are covered.",
    );
  }

  // Scan markdown headings (## or ###). This is structural extraction —
  // we only report what we found, never diagnose what's missing. The
  // Agent already holds the "scope / acceptance / risks / TODO" contract
  // in context and can compare for itself.
  const headings = bodyText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^#{2,3}\s+\S/.test(l));

  if (headings.length === 0) {
    return inject(
      `[pr-create-guard] PR body (${bodyText.length} chars from ${source}) has no markdown headings. Verify scope / acceptance / risks / TODO are covered.`,
    );
  }

  const listed = headings.map((h) => `  - ${h}`).join("\n");
  inject(
    `[pr-create-guard] PR body headings found (${source}):\n${listed}\nConsider whether scope / acceptance criteria / risks / remaining TODO are covered.`,
  );
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

// Minimal shell-like tokenizer: handles single/double quotes with a
// backslash escape inside double-quoted runs (matches bash's behavior
// closely enough for `gh pr ...` call sites). Returns { tokens, unclosed }.
// Unclosed signals a quote imbalance — upstream treats that as "can't
// parse, bail to filter message" rather than blocking.
function tokenize(cmd) {
  const out = [];
  let buf = "";
  let quote = null;
  let i = 0;
  const flush = () => {
    if (buf.length > 0 || quote !== null) out.push(buf);
    buf = "";
  };
  while (i < cmd.length) {
    const c = cmd[i];
    if (quote) {
      if (c === quote) {
        // closing quote: keep token open; empty run still counts as ""
        out.push(buf);
        buf = "";
        quote = null;
        i++;
        continue;
      }
      if (c === "\\" && quote === '"' && i + 1 < cmd.length) {
        buf += cmd[i + 1];
        i += 2;
        continue;
      }
      buf += c;
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      flush();
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  if (quote !== null) return { tokens: out, unclosed: true };
  if (buf.length > 0) out.push(buf);
  return { tokens: out, unclosed: false };
}

// Find the value for a CLI flag. Supports `--flag value` and `--flag=value`.
// Returns undefined if the flag is absent (caller distinguishes "absent"
// from "empty string" because those have different block semantics).
function getFlag(tokens, flag) {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === flag) return tokens[i + 1] ?? "";
    if (tokens[i].startsWith(flag + "=")) return tokens[i].slice(flag.length + 1);
  }
  return undefined;
}

function block(reason) {
  process.stderr.write(`pr-create-guard: ${reason}\n`);
  process.exit(2);
}

function inject(message) {
  const out = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: message,
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

function exitSilent() {
  process.exit(0);
}
