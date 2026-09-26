#!/usr/bin/env bash
# SessionStart hook: make sure the review branch watcher runs. `start` returns
# at once when it already does, so every session can call it. Stays silent:
# SessionStart output lands in the session's context.
script="${CLAUDE_PROJECT_DIR:-.}/.claude/skills/review-branch/review.sh"
[ -x "$script" ] && "$script" start >/dev/null 2>&1
exit 0
