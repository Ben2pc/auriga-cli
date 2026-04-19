#!/usr/bin/env bash
# Unit tests for skills/auriga-go/scripts/ship-loop.sh.
#
# Runs each scenario in an isolated tempdir with hand-crafted fixtures
# (state file, transcript JSONL, hook-input JSON), then asserts the
# hook's exit code, stdout, and state-file aftermath.
#
# Usage: bash tests/ship-loop.test.sh

set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$HERE/../skills/auriga-go/scripts/ship-loop.sh"
SESSION_ID="test-session-abc"

if [[ ! -x "$HOOK" ]]; then
  echo "FATAL: $HOOK not found or not executable" >&2
  exit 1
fi

PASS=0
FAIL=0
CURRENT=""

# ---- helpers ----------------------------------------------------------

start() {
  CURRENT=$1
  TMP=$(mktemp -d)
  cd "$TMP"
  mkdir .claude
}

finish_ok() {
  echo "  ✓ $CURRENT"
  PASS=$((PASS + 1))
  cd /
  rm -rf "$TMP"
}

finish_fail() {
  echo "  ✗ $CURRENT — $1" >&2
  echo "    tmp: $TMP (preserved for inspection)" >&2
  FAIL=$((FAIL + 1))
  cd /
}

# Build a minimal JSONL transcript with one assistant message containing $1 as the text.
# Optional second arg = path (default ./transcript.jsonl).
make_transcript() {
  local text=$1
  local path=${2:-./transcript.jsonl}
  jq -n --arg t "$text" '{
    role: "assistant",
    message: { content: [ { type: "text", text: $t } ] }
  }' -c > "$path"
  echo "$path"
}

make_state() {
  local iter=$1 max=$2 session=${3:-$SESSION_ID}
  cat > .claude/auriga-go-ship.local.md <<EOF
---
active: true
iteration: $iter
max_iterations: $max
session_id: $session
started_at: 2026-04-19T00:00:00Z
---

Continue ship mode. This prompt body is what the hook re-feeds.
EOF
}

make_hook_input() {
  local transcript=$1 session=${2:-$SESSION_ID}
  jq -n --arg s "$session" --arg t "$transcript" '{
    session_id: $s,
    transcript_path: $t
  }'
}

run_hook() {
  "$HOOK" 2>stderr.log
}

# ---- scenarios -------------------------------------------------------

echo "ship-loop.sh unit tests"

# ---- 1. no state file → no-op (the blast-radius guardrail for auto/step) ----
start "no state file → no-op"
stdout=$(echo '{"session_id":"any"}' | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -n "$stdout" ]]; then
  finish_fail "expected empty stdout, got: $stdout"
elif [[ -s stderr.log ]]; then
  finish_fail "expected empty stderr, got: $(cat stderr.log)"
else
  finish_ok
fi

# ---- 2. session_id mismatch → no-op ----
start "session mismatch → no-op, state preserved"
make_state 3 30 "other-session"
make_transcript "nothing here" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ ! -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file was removed but shouldn't have been"
elif [[ -n "$stdout" ]]; then
  finish_fail "expected empty stdout, got: $stdout"
else
  finish_ok
fi

# ---- 3. iteration field corrupt → cleanup + exit ----
start "corrupt iteration → state removed"
cat > .claude/auriga-go-ship.local.md <<'EOF'
---
iteration: not-a-number
max_iterations: 30
session_id: test-session-abc
---

body
EOF
make_transcript "x" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed"
elif [[ -n "$stdout" ]]; then
  finish_fail "expected empty stdout, got: $stdout"
else
  finish_ok
fi

# ---- 4. max_iterations field corrupt → cleanup + exit ----
start "corrupt max_iterations → state removed"
cat > .claude/auriga-go-ship.local.md <<'EOF'
---
iteration: 1
max_iterations: foo
session_id: test-session-abc
---

body
EOF
make_transcript "x" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed"
else
  finish_ok
fi

# ---- 5. iteration >= max → forced Blocked exit (state cleared) ----
start "iter >= max → forced exit, state removed"
make_state 30 30
make_transcript "nothing" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed"
elif [[ -n "$stdout" ]]; then
  finish_fail "expected empty stdout, got: $stdout"
else
  finish_ok
fi

# ---- 6. transcript path missing → cleanup + exit ----
start "transcript missing → state removed"
make_state 1 30
stdout=$(make_hook_input ./no-such-file.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed"
else
  finish_ok
fi

# ---- 7. <ship-done>Ready</ship-done> detected → exit + state removed ----
start "Ready marker → state removed, allow exit"
make_state 5 30
make_transcript "some output then <ship-done>Ready</ship-done> goodbye" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed"
elif [[ -n "$stdout" ]]; then
  finish_fail "expected empty stdout, got: $stdout"
else
  finish_ok
fi

# ---- 8. <ship-done>Blocked</ship-done> detected → exit + state removed ----
start "Blocked marker → state removed, allow exit"
make_state 7 30
make_transcript "comment posted. <ship-done>Blocked</ship-done>" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed"
else
  finish_ok
fi

# ---- 9. no marker, budget remaining → block + re-feed, iter incremented ----
start "no marker, under budget → block+re-feed, iter+1"
make_state 3 30
make_transcript "just a status line, no marker yet" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc (stderr: $(cat stderr.log))"
elif [[ ! -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should still exist"
elif ! echo "$stdout" | jq -e '.decision == "block"' > /dev/null 2>&1; then
  finish_fail "stdout missing decision:block — got: $stdout"
elif ! echo "$stdout" | jq -e '.reason | contains("This prompt body")' > /dev/null 2>&1; then
  finish_fail "stdout reason missing expected prompt text — got: $(echo "$stdout" | jq -r .reason)"
else
  new_iter=$(grep '^iteration:' .claude/auriga-go-ship.local.md | sed 's/iteration: *//')
  if [[ "$new_iter" != "4" ]]; then
    finish_fail "expected iteration=4, got iteration=$new_iter"
  else
    finish_ok
  fi
fi

# ---- 10. no prompt body → cleanup + exit ----
start "empty prompt body → state removed"
cat > .claude/auriga-go-ship.local.md <<'EOF'
---
iteration: 1
max_iterations: 30
session_id: test-session-abc
---
EOF
make_transcript "no marker" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed"
else
  finish_ok
fi

# ---- 11. marker across multiple content blocks (transcript has earlier text + marker later) ----
start "marker in multi-line text block"
make_state 2 30
# Transcript contains two assistant lines; marker is in the LAST.
jq -n '{
  role: "assistant",
  message: { content: [ { type: "text", text: "early assistant text without marker" } ] }
}' -c > ./transcript.jsonl
jq -n '{
  role: "assistant",
  message: { content: [ { type: "text", text: "final block.\n<ship-done>Ready</ship-done>" } ] }
}' -c >> ./transcript.jsonl
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed (marker in final block)"
else
  finish_ok
fi

# ---- summary ----

echo ""
echo "─────────────────────────"
echo " $PASS passed, $FAIL failed"
echo "─────────────────────────"

[[ $FAIL -eq 0 ]]
