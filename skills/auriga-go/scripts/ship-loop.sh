#!/bin/bash
# auriga-go ship mode — Stop hook.
#
# Registered via SKILL.md frontmatter, fires on every Stop event while
# the auriga-go skill is active (for the rest of the session after
# invocation, per Claude Code skill-scoped hook lifecycle).
#
# Gated by state-file presence so step/auto modes are untouched:
# no state file = not in ship mode = immediate no-op.
#
# Pattern adapted from anthropics/claude-plugins-official ralph-loop
# (hooks/stop-hook.sh). Differences:
#   - Completion signal is hardcoded to <ship-done>Ready|Blocked</ship-done>
#     instead of a configurable --completion-promise, so one hook handles
#     both exit paths and the state file encodes no completion config.
#   - Script name and state-file path are ship-specific.
#   - max_iterations is required (not optional "unlimited"); reaching the
#     cap forces a Blocked exit regardless of marker.

set -euo pipefail

STATE_FILE=".claude/auriga-go-ship.local.md"

# Gate: no state file = not in ship mode = no-op
[[ -f "$STATE_FILE" ]] || exit 0

HOOK_INPUT=$(cat)

# Parse YAML frontmatter (content between the two --- markers)
FRONTMATTER=$(sed -n '/^---$/,/^---$/{ /^---$/d; p; }' "$STATE_FILE")
ITERATION=$(echo "$FRONTMATTER" | grep '^iteration:' | sed 's/iteration: *//')
MAX_ITERATIONS=$(echo "$FRONTMATTER" | grep '^max_iterations:' | sed 's/max_iterations: *//')
STATE_SESSION=$(echo "$FRONTMATTER" | grep '^session_id:' | sed 's/session_id: *//' || true)

# Session isolation — state file is project-scoped but session-specific.
# If another session is running, don't interfere.
HOOK_SESSION=$(echo "$HOOK_INPUT" | jq -r '.session_id // ""')
if [[ -n "$STATE_SESSION" ]] && [[ "$STATE_SESSION" != "$HOOK_SESSION" ]]; then
  exit 0
fi

# Validate numeric fields before arithmetic
if [[ ! "$ITERATION" =~ ^[0-9]+$ ]] || [[ ! "$MAX_ITERATIONS" =~ ^[0-9]+$ ]]; then
  echo "⚠️  auriga-go ship: state file corrupted ($STATE_FILE)" >&2
  echo "   iteration='$ITERATION' max_iterations='$MAX_ITERATIONS'" >&2
  echo "   Removing state file. Re-invoke /auriga-go ship to restart." >&2
  rm "$STATE_FILE"
  exit 0
fi

# Budget check — reached cap before marker → force Blocked exit
if [[ $ITERATION -ge $MAX_ITERATIONS ]]; then
  echo "🛑 auriga-go ship: max iterations ($MAX_ITERATIONS) reached. Forcing Blocked exit." >&2
  rm "$STATE_FILE"
  exit 0
fi

# Read transcript to scan the final assistant text block for the marker
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path')
if [[ ! -f "$TRANSCRIPT_PATH" ]]; then
  echo "⚠️  auriga-go ship: transcript not found at $TRANSCRIPT_PATH. Exiting loop." >&2
  rm "$STATE_FILE"
  exit 0
fi

# Claude Code writes each content block as its own JSONL assistant-role line.
# Slurp the last 100 assistant lines, flatten to text blocks, take the final one.
LAST_LINES=$(grep '"role":"assistant"' "$TRANSCRIPT_PATH" | tail -n 100 || true)
if [[ -z "$LAST_LINES" ]]; then
  echo "⚠️  auriga-go ship: no assistant messages in transcript. Exiting loop." >&2
  rm "$STATE_FILE"
  exit 0
fi

set +e
LAST_OUTPUT=$(echo "$LAST_LINES" | jq -rs '
  map(.message.content[]? | select(.type == "text") | .text) | last // ""
' 2>&1)
JQ_EXIT=$?
set -e

if [[ $JQ_EXIT -ne 0 ]]; then
  echo "⚠️  auriga-go ship: failed to parse transcript JSON. Exiting loop." >&2
  echo "   Error: $LAST_OUTPUT" >&2
  rm "$STATE_FILE"
  exit 0
fi

# Completion signal — <ship-done>Ready</ship-done> or <ship-done>Blocked</ship-done>.
# Multiline regex via perl (-0777 slurps whole input, /s makes . match newline).
MARKER=$(echo "$LAST_OUTPUT" | perl -0777 -ne 'print $1 if /<ship-done>(Ready|Blocked)<\/ship-done>/s' 2>/dev/null || true)
if [[ -n "$MARKER" ]]; then
  echo "✅ auriga-go ship: detected <ship-done>$MARKER</ship-done> at iter $ITERATION/$MAX_ITERATIONS" >&2
  rm "$STATE_FILE"
  exit 0
fi

# No marker, budget remaining → block exit + re-feed prompt body as next turn
NEXT_ITERATION=$((ITERATION + 1))

# Extract prompt body (everything after the closing --- of the frontmatter)
PROMPT_TEXT=$(awk '/^---$/{i++; next} i>=2' "$STATE_FILE")
if [[ -z "$PROMPT_TEXT" ]]; then
  echo "⚠️  auriga-go ship: no prompt body in state file. Exiting loop." >&2
  rm "$STATE_FILE"
  exit 0
fi

# Atomically update iteration count
TMP="${STATE_FILE}.tmp.$$"
sed "s/^iteration: .*/iteration: $NEXT_ITERATION/" "$STATE_FILE" > "$TMP"
mv "$TMP" "$STATE_FILE"

SYSTEM_MSG="🔄 auriga-go ship iter $NEXT_ITERATION/$MAX_ITERATIONS — emit <ship-done>Ready</ship-done> ONLY when all three Ready terminal conditions hold; emit <ship-done>Blocked</ship-done> on hard stop or exhaustion."

jq -n \
  --arg prompt "$PROMPT_TEXT" \
  --arg msg "$SYSTEM_MSG" \
  '{
    "decision": "block",
    "reason": $prompt,
    "systemMessage": $msg
  }'

exit 0
