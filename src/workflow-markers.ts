// Managed-block markers for the installed CLAUDE.md.
//
// auriga-cli installs its workflow document wrapped in a pair of HTML-comment
// markers. Everything *between* the markers is the "managed block" — owned by
// auriga-cli, replaced wholesale on upgrade. Everything *outside* (notably the
// region after the END marker) is the project's own — auriga-cli never touches
// it. This lets a downstream project extend its CLAUDE.md while still
// receiving workflow upgrades.
//
// Markers are HTML comments so both Claude Code and Codex (which read the same
// file via the AGENTS.md → CLAUDE.md symlink) treat them as inert.
//
// This module is the single source of truth for the marker contract; it is
// imported by both src/workflow.ts (install / upgrade) and src/state.ts
// (presence detection). It deliberately has no heavy imports so state.ts /
// server.ts don't pull in @inquirer/prompts transitively.

import { createHash } from "node:crypto";

/** Marker schema version. Frozen contract — bump only with a migration plan. */
export const MARKER_SCHEMA = "v1";

/**
 * START marker line, one per template language. Only the prose differs — the
 * structural `AURIGA:WORKFLOW:v1 START` token is language-independent, so the
 * parser (`START_LINE_RE`) keys on the token alone and never needs to know the
 * language. The English `CLAUDE.md` gets the English marker; `CLAUDE.zh-CN.md`
 * gets the Chinese one, so a downstream file never carries a comment in the
 * wrong language for its document.
 */
const WORKFLOW_START_MARKERS: Record<string, string> = {
  en: `<!-- AURIGA:WORKFLOW:${MARKER_SCHEMA} START — Managed block, maintained by auriga-cli. Do not edit by hand; upgrades replace it wholesale. Put project-specific instructions after the END marker below. -->`,
  "zh-CN": `<!-- AURIGA:WORKFLOW:${MARKER_SCHEMA} START — 受管区块,由 auriga-cli 维护,请勿手改;升级会整块覆盖。工程专属规则写在下方 END 标记之后。 -->`,
};

/** The START marker line for the given template language. Unknown languages
 *  fall back to English. */
export function workflowStartMarker(lang?: string): string {
  return WORKFLOW_START_MARKERS[lang ?? "en"] ?? WORKFLOW_START_MARKERS.en;
}

/** Build the END marker line, embedding the managed-block content hash so a
 *  later upgrade can tell an untouched block from a hand-edited one. */
export function workflowEndMarker(hash: string): string {
  return `<!-- AURIGA:WORKFLOW:${MARKER_SCHEMA} END sha256=${hash} -->`;
}

// Marker line regexes (multiline — matched against the whole file body).
// START tolerates any trailing comment text after `START`; END optionally
// carries `sha256=<hex>`.
const START_LINE_RE = /^<!--\s*AURIGA:WORKFLOW:v1\s+START\b.*?-->[ \t]*$/m;
const END_LINE_RE =
  /^<!--\s*AURIGA:WORKFLOW:v1\s+END(?:\s+sha256=([0-9a-f]+))?[ \t]*-->[ \t]*$/m;

/** Matches the auriga workflow H1 header in either language
 *  (`# auriga Workflow (vX.Y.Z)` / `# auriga 工作流 (vX.Y.Z)`). */
export const WORKFLOW_HEADER_RE =
  /^#\s+auriga\s+(?:Workflow|工作流)\s*\(v\d+\.\d+\.\d+\)/;

/** sha256 of the managed-block body, truncated to 16 hex chars. Not a security
 *  primitive — just a tamper check to distinguish untouched from hand-edited. */
export function hashBlock(blockBody: string): string {
  return createHash("sha256").update(blockBody, "utf8").digest("hex").slice(0, 16);
}

export type MarkerParse =
  | { kind: "unmarked" }
  | { kind: "malformed"; reason: string }
  | {
      kind: "marked";
      /** Bytes before the START marker line (normally empty). */
      prefix: string;
      /** Bytes strictly between the START line and the END line — the managed
       *  block. Includes the trailing newline that precedes the END line. */
      blockBody: string;
      /** Bytes after the END marker line — the project's own user region. */
      userRegion: string;
      /** sha256 recorded in the END marker, or null if the marker carried none. */
      endHash: string | null;
    };

/**
 * Classify a CLAUDE.md body by its managed-block markers.
 *
 *  - `unmarked`   — neither marker present (fresh-target / foreign / old-format)
 *  - `malformed`  — exactly one marker, or END before START (can't safely splice)
 *  - `marked`     — a well-formed START…END pair
 */
export function parseMarkers(content: string): MarkerParse {
  const startMatch = START_LINE_RE.exec(content);
  const endMatch = END_LINE_RE.exec(content);

  if (!startMatch && !endMatch) return { kind: "unmarked" };
  if (!startMatch || !endMatch) {
    return {
      kind: "malformed",
      reason: startMatch ? "START marker without a matching END" : "END marker without a matching START",
    };
  }
  if (startMatch.index >= endMatch.index) {
    return { kind: "malformed", reason: "END marker precedes START marker" };
  }

  const startLineEnd = content.indexOf("\n", startMatch.index);
  if (startLineEnd < 0 || startLineEnd > endMatch.index) {
    return { kind: "malformed", reason: "START marker line is not terminated before END" };
  }
  const endLineEnd = content.indexOf("\n", endMatch.index);

  return {
    kind: "marked",
    prefix: content.slice(0, startMatch.index),
    blockBody: content.slice(startLineEnd + 1, endMatch.index),
    userRegion: endLineEnd < 0 ? "" : content.slice(endLineEnd + 1),
    endHash: endMatch[1] ?? null,
  };
}

/**
 * Build a marked CLAUDE.md from its three parts. The END marker hash is
 * computed from `blockBody` here, so callers never hand-maintain it.
 *
 * `blockBody` is expected to end with a newline (it is the content the START
 * line's newline leads into, up to the END line). `parseMarkers` and
 * `composeMarkedFile` are exact inverses for the block body and user region.
 *
 * `lang` selects the START marker's prose language (default English); it does
 * not affect the parser, which keys on the language-independent token.
 */
export function composeMarkedFile(opts: {
  prefix?: string;
  blockBody: string;
  userRegion?: string;
  lang?: string;
}): string {
  return (
    (opts.prefix ?? "") +
    workflowStartMarker(opts.lang) + "\n" +
    opts.blockBody +
    workflowEndMarker(hashBlock(opts.blockBody)) + "\n" +
    (opts.userRegion ?? "")
  );
}

/** True when the first non-blank line is an auriga workflow header. Used to
 *  tell an old-format (pre-marker) auriga CLAUDE.md from a foreign one. */
export function hasAurigaHeader(content: string): boolean {
  for (const line of content.split("\n")) {
    if (line.trim().length === 0) continue;
    return WORKFLOW_HEADER_RE.test(line);
  }
  return false;
}
