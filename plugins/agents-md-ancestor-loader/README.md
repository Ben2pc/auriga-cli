# AGENTS.md Ancestor Loader

Codex reads `AGENTS.md` from the detected project root down to the current
working directory. The default project root marker is `.git`, so workspace-level
instructions above a Git repository can be skipped.

This plugin adds a `SessionStart` hook that injects those ancestor files as
additional context:

- inside a Git repository, it reads `AGENTS.md` files above the Git root;
- outside Git, it reads parent directories above the current working directory;
- it never writes files and silently exits when no ancestor file exists.

The injected context is capped at 64 KiB total to avoid oversized session-start
payloads.
