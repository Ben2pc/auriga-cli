# Session Instructions Loader

Codex reads `AGENTS.md` from the detected project root down to the current
working directory. The default project root marker is `.git`, so workspace-level
instructions above a Git repository can be skipped.

This plugin adds a `SessionStart` hook that injects additional instruction files
as context:

- it runs on session startup, resume, and the post-compaction `SessionStart`
  event so compacted threads regain the same supplemental instructions;
- inside a Git repository, it reads `AGENTS.md` files above the Git root;
- inside a Git worktree, it also reads `AGENTS.md` files above the original
  repository root referenced by the worktree `.git` file;
- outside Git, it reads parent directories above the current working directory;
- it stops ancestor discovery at Codex's own `.codex` state directory, so
  managed worktrees do not inherit `~/.codex/AGENTS.md`;
- it also reads repo-local files listed in
  `.agents/plugins/session-instructions-loader.json`;
- it never writes files and silently exits when no instruction file exists.

Example config:

```json
{
  "extraFiles": [
    ".claude/CLAUDE.md"
  ]
}
```

The injected context is capped at 64 KiB total to avoid oversized session-start
payloads.
