# Session Instructions Loader

Codex reads `AGENTS.md` from the detected project root down to the current
working directory. The default project root marker is `.git`, so workspace-level
instructions above a Git repository can be skipped.

This plugin adds a `SessionStart` hook that injects additional instruction files
as context:

- it runs on session startup, resume, clear, and the post-compaction
  `SessionStart` event so rebuilt threads regain the same supplemental
  instructions;
- inside a Git repository, it can read `AGENTS.md` files above the Git root;
- inside a Git worktree, it resolves the original repository root referenced by
  the worktree `.git` file and reads `AGENTS.md` files above that root;
- outside Git, it can read parent directories above the current working directory;
- it stops ancestor discovery at Codex's own `.codex` state directory, so
  managed worktrees do not inherit `~/.codex/AGENTS.md`;
- it also reads repo-local files listed in `.codex/session-instructions-loader.json`;
- `ancestorLevel` controls upward `AGENTS.md` discovery; it defaults to `0`
  which disables ancestor discovery, `1` means only the repository's parent
  directory is checked, and `-1` traverses up to the user's home directory;
- it never writes files and silently exits when no instruction file exists.

Example config:

```json
{
  "ancestorLevel": 1,
  "extraFiles": [
    ".claude/CLAUDE.md"
  ]
}
```

The injected context is capped at 64 KiB total to avoid oversized session-start
payloads.
