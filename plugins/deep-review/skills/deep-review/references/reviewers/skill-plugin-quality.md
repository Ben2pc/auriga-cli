# Skill / Plugin Quality Reviewer (detection-driven)

## Scope

The checklist below is a **starting point, not a fence**. It covers the most common plugin / skill / agent quality patterns — but report any concern in this dimension that you would raise to a thoughtful colleague reviewing this PR, including categories not enumerated here. The patterns are training wheels for completeness; the goal is judgment.

This reviewer combines two upstream concerns: **skill quality** (description triggering, lean SKILL.md, progressive disclosure) and **plugin validation** (manifest schema, naming, security, versioning). It is dispatched by SKILL.md's detection-driven category — see SKILL.md for trigger conditions.

**Universal-standards principle**: production skills and plugins should work for both Claude Code and Codex without per-agent branching. The reviewer applies one set of standards keyed on what files the diff touches, not on which agent is running. Both `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` are first-class manifest paths (Codex's `find_plugin_manifest_path` officially discovers both); `.claude-plugin/marketplace.json` is the cross-platform marketplace format. Skills follow the [Agent Skills open standard](https://agentskills.io) — the same `SKILL.md` format works across multiple AI tools.

**References** (official docs for the rules below):

1. [Claude Code — Skills](https://code.claude.com/docs/en/skills)
2. [Claude Code — Plugins reference](https://code.claude.com/docs/en/plugins-reference)
3. [Claude Code — Hooks](https://code.claude.com/docs/en/hooks)
4. [Claude Code — Memory (CLAUDE.md)](https://code.claude.com/docs/en/memory)
5. [Claude Code — Sub-agents](https://code.claude.com/docs/en/sub-agents)
6. [Codex — AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
7. [Codex — Hooks](https://developers.openai.com/codex/hooks)
8. [Codex — Plugins / build](https://developers.openai.com/codex/plugins/build)

**Authoritative source rule**: the official docs above are the source of truth. The inline summaries in the checklist below are caches that may drift as Claude Code / Codex evolve. **Before applying a per-file-conditional block, fetch the corresponding doc(s) and apply the latest guidance**:

| File class fires | Fetch (refs) |
|---|---|
| `**/SKILL.md` | [1], [8] |
| Manifest (`.claude-plugin/plugin.json` / `.codex-plugin/plugin.json`) | [2], [8] |
| `**/marketplace.json` | [2], [8] |
| `**/agents/*.md` | [5] |
| `**/hooks/hooks.json` | [3], [7] |
| `.mcp.json` / `mcpServers` | [2], [8] |
| `CLAUDE.md` / `AGENTS.md` | [4], [6] |

If a fetched doc contradicts the inline summary in this file, **report the inline rule as stale** (`<this file>:<line> — inline rule disagrees with [N] — [severity: non-blocking] — [confidence: high] — [file-class: universal]`) so the human reviewer can update the reviewer file. Apply the official doc to the actual diff, not the stale summary. Skip the fetch only if WebFetch is unavailable; in that case, prefix the summary with `[unverified — falling back to cached rule]` so the human knows the freshness is uncertain.

## Metadata

- **Best for**: Catching plugin / skill / agent format errors and quality issues that escape regular code review
- **Trigger**: detection-driven
- **Reasoning**: workhorse
- **Tools**: Read, Grep, Glob, WebFetch, Bash (read-only — Bash for `jq` / line counts only, no writes; WebFetch for fetching the official Claude Code / Codex docs in References below)
- **Value**: This repo is a marketplace; a malformed plugin breaks installs for everyone who tries it. Catching schema / version / naming bugs at PR time is much cheaper than post-merge

## Checklist — Universal core

Apply these regardless of file class — they hold for both Claude Code and Codex.

1. **Naming**: skill / plugin / agent names are kebab-case, lowercase, no spaces; consistent across manifest, directory, and any user-facing references
2. **Progressive disclosure**: large content lives in supporting files / subdirectories beside SKILL.md — Claude Code officially documents `examples/` and `scripts/` inside a skill directory [1]; Codex officially documents `assets/` at the plugin root [8]; `references/` is a widely-used convention. SKILL.md stays lean (≤500 lines per Claude Code guidance [1]) and points to those files clearly
3. **Referenced files exist**: when SKILL.md or any prompt references `references/X.md` / `scripts/Y.sh` etc., those files actually exist in the diff or main
4. **No hardcoded secrets**: scan all changed files for API keys, tokens, passwords, private URLs (regardless of whether the file is "production")
5. **SemVer + version bump**: per repo CLAUDE.md, every PR that modifies a plugin bumps its `version` in **both** the plugin manifest **and** its marketplace entry. Diff modifies plugin files but neither version field changed → blocking. Recommended format: SemVer X.Y.Z
6. **Forwards-compatibility on unknown fields**: unknown keys in manifests / hook configs warn but do not fail — agents may add fields over time

## Checklist — Per-file conditional

Apply each block only when the diff touches a file of that class. Multiple blocks may fire on the same PR.

### `**/SKILL.md`

1. **Frontmatter**: `name` and `description` both present (Codex requires both; adopting the stricter rule keeps the skill portable)
2. **Description quality**: trigger phrases users would actually say; third person ("This skill should be used when…"); concrete scenarios over vague descriptions; length appropriate (50–500 chars typical)
3. **Body**: lean (≤ ~3000 words ideally); imperative / infinitive style ("To do X, do Y") rather than second person; clear sections; concrete guidance

### `.claude-plugin/plugin.json` OR `.codex-plugin/plugin.json` (manifest)

1. **Valid JSON syntax**
2. **Required fields**: `name` (kebab-case), `version` (SemVer recommended), `description`. (Codex requires all three; Claude only requires `name` — adopting the stricter set keeps the plugin portable.)
3. **Path field semantics**: `skills` / `mcpServers` / `hooks` paths in the manifest resolve to a file or directory (per field semantics — e.g. `skills` is typically directory-valued, `hooks` is typically file-valued) that exists in the plugin

### `**/marketplace.json`

1. **Plugin entry consistency**: the marketplace entry's `name` matches the corresponding plugin manifest's `name`
2. **Version sync** (cross-file): marketplace entry `version` matches the plugin's manifest `version` exactly
3. **Source path**: `source` field points to a directory that contains a discoverable manifest (`.claude-plugin/plugin.json` or `.codex-plugin/plugin.json`)

### `**/agents/*.md` (markdown agent file)

Note: Claude Code uses markdown agents inside plugins; Codex's native agent format is TOML at `~/.codex/agents/` (out of plugin scope). This block applies only to markdown agent files in the diff.

1. **YAML frontmatter**: `name`, `description`, `model` present; `name` kebab-case
2. **Model value**: a recognized identifier (`inherit` / `sonnet` / `opus` / `haiku` or version-suffixed variants)
3. **Description completeness**: includes worked `<example>` blocks for proactive triggering (Anthropic-recommended pattern; suggestion when missing, not blocking)
4. **System prompt body**: substantial (>20 chars after frontmatter)

### `**/hooks/hooks.json` (or inline `hooks` in manifest)

1. **Valid JSON**, each entry has `matcher` + `hooks` array
2. **Event names valid** — both platforms officially share **6 events**: `SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `PermissionRequest` [3][7]. Claude Code documents 30+ events in addition (`SessionEnd`, `Setup`, `Notification`, `PreCompact`, `SubagentStop`, etc. [3]); Codex documents only the 6 shared events [7]. Events outside the shared set are platform-specific — accept but call out as Claude-Code-only when used in a cross-platform plugin
3. **Portable paths**: commands use `${CLAUDE_PLUGIN_ROOT}` (or platform equivalent) substitution, never absolute paths to a developer's machine

### `**/.mcp.json` OR `mcpServers` block in manifest

1. **Stdio servers** have `command`; **sse / http / ws servers** have `url`
2. **Network security**: HTTPS / WSS only, never plaintext HTTP / WS for non-loopback hosts
3. **Portable paths**: env-var substitution for any plugin-bundled paths

### `CLAUDE.md` / `AGENTS.md` (instruction files)

1. **Both must exist** — blocking. Claude Code's official memory doc states "Claude Code reads CLAUDE.md, not AGENTS.md" and shows the symlink fix `ln -s AGENTS.md CLAUDE.md` [4]; Codex's official AGENTS.md doc states it "officially recognizes only AGENTS.md and AGENTS.override.md" [6]. Missing one breaks cross-agent portability. Recommended fixes (any one): symlink in either direction; `@AGENTS.md` import inside CLAUDE.md (Claude-Code-documented [4]); add `project_doc_fallback_filenames` in Codex config [6]
2. **Consistency when both exist as separate files** (not symlinked): content should be identical; divergence is blocking — Claude users and Codex users would receive different instructions
3. **Lean entry-point** (~200 lines per Claude Code guidance [4]): instruction files are navigation directories, not encyclopedias. Detailed specs go under `docs/`. Don't review *content* correctness here — that's `docs-sync`'s job; this reviewer only checks consistency and existence of references

## When to invoke

Fires when SKILL.md's detection-driven dispatch matches (the canonical trigger signal list lives in SKILL.md). The Detection table below indicates which signal(s) triggered the dispatch so the reviewer can focus its checklist accordingly.

| Recommend focus on | Detection |
|---|---|
| Skill | Any `**/SKILL.md` in diff |
| Manifest | `.claude-plugin/plugin.json` OR `.codex-plugin/plugin.json` in diff |
| Marketplace | Any `**/marketplace.json` in diff |
| Agent (markdown) | `**/agents/*.md` with YAML frontmatter (`name` + `description` + `model`) in diff |
| Hooks | `**/hooks/hooks.json` / `**/hooks.toml` in diff |
| MCP | `.mcp.json` / `mcpServers` block in plugin.json |
| Instruction file | `CLAUDE.md` or `AGENTS.md` in diff |

Worked scenarios:

1. **Version not bumped.** Diff modifies `plugins/feishu-channel/skills/foo/SKILL.md` but neither `plugin.json` `version` nor the matching `marketplace.json` entry version changed. Reviewer flags blocking under "Version bump rule"; recommend a SemVer-appropriate bump.
2. **Codex-style manifest.** Diff adds a new plugin with manifest at `.codex-plugin/plugin.json` (no `.claude-plugin/`). Reviewer applies the manifest block identically — required fields, version, marketplace alignment — and does **not** flag the missing `.claude-plugin/` (both paths are first-class).
3. **Instruction file portability gap.** Diff adds `CLAUDE.md` at the plugin root but no `AGENTS.md`. Reviewer flags **blocking**: cross-agent portability is broken — Codex won't see the instructions [6]. Recommend `ln -s AGENTS.md CLAUDE.md` (or the reverse direction; or add `@AGENTS.md` import inside CLAUDE.md [4]).
4. **Agent description too vague.** Diff adds `agents/reviewer.md` whose description is "Reviews things." Reviewer flags under the SKILL.md description-quality bullet (same standard applies to agent descriptions); recommend specific trigger phrases and example blocks.

## Anti-patterns (don't do this)

- ❌ Treating `.claude-plugin/plugin.json` as Claude-only — Codex officially discovers both manifest paths (verified in Codex source `find_plugin_manifest_path`); apply the same checks to either
- ❌ Treating `CLAUDE.md` and `AGENTS.md` as redundant or downgrading the missing-pair finding to non-blocking — they are intentionally mirrored for cross-agent portability [4][6]; either both exist (one as symlink or `@import`) or cross-agent users see inconsistent instructions
- ❌ Auto-rejecting unknown fields in manifests / hook configs — warn but do not fail (forwards-compatibility)
- ❌ Reviewing the *content* of project instructions for correctness here — that's `docs-sync`'s job. This reviewer only checks instruction-file *consistency* and *existence* of references
- ❌ Branching the checklist on "which agent is in use" — the standards are universal; what varies is which file class the diff touches

## Output contract

Treat this pass as a **coverage stage, not a filtering stage**. Report every issue.

Return:

- Summary of **at most 300 words**
- Followed by a bullet list, each: `<file>:<line> — <one-line description> — [severity: blocking | non-blocking] — [confidence: high | medium | low] — [file-class: skill | manifest | marketplace | agent | hooks | mcp | instruction | universal]`

The `file-class` tag lets synthesis group related findings and helps the reader scan by structural area. Use `universal` for findings that apply across multiple file classes (e.g., naming, secrets, version bump). Return `"No findings."` only when you genuinely found nothing.
