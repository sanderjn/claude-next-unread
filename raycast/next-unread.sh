#!/bin/bash

# @raycast.schemaVersion 1
# @raycast.title Next unread Claude thread
# @raycast.mode silent
# @raycast.packageName Claude
# @raycast.icon 🟠

sessions="$HOME/Library/Application Support/Claude/claude-code-sessions"

field() {
  local value
  value=$(plutil -extract "$1" raw -o - "$2" 2>/dev/null) && printf '%s' "$value"
}

oldest=
oldest_at=

for marker in "$HOME"/.claude/next-unread/*/*.json; do
  [ -e "$marker" ] || continue

  id=$(basename "$marker" .json)
  org=$(basename "$(dirname "$marker")")
  session=$(ls "$sessions"/*/"$org"/"$id".json 2>/dev/null | head -1)
  at=$(field at "$marker")
  focused=$(field lastFocusedAt "$session")

  if [ -z "$session" ] || [ "$(field isArchived "$session")" = true ] || [ "${focused:-0}" -gt "${at:-0}" ]; then
    rm -f "$marker"
    continue
  fi

  if [ -z "$oldest" ] || [ "$at" -lt "$oldest_at" ]; then
    oldest=$marker
    oldest_at=$at
  fi
done

if [ -z "$oldest" ]; then
  echo "No unread threads"
  exit 0
fi

open "claude://claude.ai/epitaxy/$(basename "$oldest" .json)"
rm -f "$oldest"
