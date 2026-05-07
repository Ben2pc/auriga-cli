# Codex Plugin Install Support

## Scope Triage

scope triage -> full path: single install module and four acceptance bullets, but public CLI interface changes via `--agent`, so record the interface decision before implementation.

## Acceptance Criteria

- `install plugins` keeps the existing Claude Code behavior by default.
- Non-interactive `install plugins --agent codex` installs Codex plugins without requiring the `claude` CLI.
- Interactive plugin install asks which runtime to target: Claude Code, Codex, or both.
- Codex plugin install reads `.agents/plugins/marketplace.json`, adds the marketplace with `codex plugin marketplace add`, and enables selected plugins in `~/.codex/config.toml`; plugins with hooks also enable `features.plugin_hooks`.

## Interface

`--agent <claude|codex|both>` applies only to `install plugins` and `install --all`. The default is `claude` for backward compatibility. `both` runs the Claude Code installer and the Codex installer in sequence, reporting either side as a plugin category failure in non-interactive mode.

Codex plugins are machine-local because Codex reads plugin enablement from `CODEX_HOME` / `~/.codex`. `--scope` still controls the Claude Code side. For Codex-only installs, `--scope` is accepted but ignored so `install --all --scope user --agent codex` does not need special casing.
