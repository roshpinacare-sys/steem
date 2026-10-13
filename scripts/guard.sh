#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# SAOS DESTRUCTIVE-COMMAND GUARD — dcg pattern (Dicklesworthstone/
# destructive_command_guard) applied natively to this workspace.
#
# Usage:   bash scripts/guard.sh -- <command...>
#          bash scripts/guard.sh --explain "<command>"   (dry-run: no execution)
#
# Laws (mirroring the engine's lib.guard — one doctrine, two agents):
#   GIT-DESTRUCTIVE   — reset --hard, clean -fd, checkout -- ./restore (worktree
#                       consumption), push --force, branch -D, history rewrite
#   FS-DESTRUCTIVE    — rm -rf at / or HOME (/tmp is exempt scratch space)
#   JOURNAL-TRUNCATE  — overwriting worklog.md / events.jsonl / exec-log.jsonl
#   DB-DESTRUCTIVE    — DROP TABLE / TRUNCATE TABLE / DROP DATABASE
#   Context detection — compound commands (&& ; || |) are matched PER-SEGMENT;
#                       a safe first segment never whitewashes a destructive one.
#   Exit contract     — 0 pass · 1 blocked · 3 explain-mode match
# Every denial is TYPED, printed to stderr with a safer alternative.
# ═══════════════════════════════════════════════════════════════════════════
set -u
EXPLAIN=0
if [ "${1:-}" = "--explain" ]; then EXPLAIN=1; shift; fi
if [ "${1:-}" = "--" ]; then shift; fi
CMD="$*"

print_panel() { # $1 rule, $2 why, $3 tip
  {
    printf '════════════════════════════════════════════════════════════\n'
    printf 'BLOCKED  saos-guard (%s)\n' "$1"
    printf '────────────────────────────────────────────────────────────\n'
    printf 'Command: %s\n' "$CMD"
    printf 'Why:     %s\n' "$2"
    printf 'Tip:     %s\n' "$3"
    printf '════════════════════════════════════════════════════════════\n'
  } >&2
}

# per-segment matcher (data ≠ execution): split on ; && || | then classify
rc=0
seg="$(printf '%s' "$CMD" | sed 's/&&/\n/g; s/||/\n/g; s/;/\n/g; s/|/\n/g')"
while IFS= read -r part; do
  rule=""; why=""; tip=""
  part="${part//>>/@APPEND@}" # append (>>) is the LEGAL journal mode — never a truncation signal
  case "$part" in
    *"rm -rf /tmp/"*|*"rm -rf /tmp "*|*"rm -fr /tmp/"*) : ;; # /tmp = exempt scratch
    *"rm -rf /"*|*"rm -fr /"*|*"rm -rf / "*)
      rule="FS-DESTRUCTIVE"; why="rm -rf at / — catastrophic"; tip="never; scope rm to explicit paths" ;;
    *"rm -rf ~"*|*"rm -rf \$HOME"*|*"rm -fr ~"*)
      rule="FS-DESTRUCTIVE"; why="rm -rf at HOME — catastrophic"; tip="never; scope rm to explicit paths" ;;
    *"reset --hard"*)
      rule="GIT-DESTRUCTIVE"; why="reset --hard consumes uncommitted work"; tip="git stash first (recoverable), then reset" ;;
    *"clean -fd"*|*"clean -df"*|*"clean -xdf"*)
      rule="GIT-DESTRUCTIVE"; why="git clean -fd deletes untracked files"; tip="clean -nd (dry-run) first" ;;
    *"checkout -- ."*|*"restore ."*)
      rule="GIT-DESTRUCTIVE"; why="discards all working-tree changes"; tip="git stash (recoverable)" ;;
    *"push --force"*|*"push -f"*|*"push --force-with-lease"*)
      rule="GIT-DESTRUCTIVE"; why="force-push rewrites shared history"; tip="push --force-with-lease ONLY with a typed justification in worklog" ;;
    *"branch -D"*)
      rule="GIT-DESTRUCTIVE"; why="branch -D skips the merge-safety check"; tip="branch -d (lowercase)" ;;
    *"reflog expire"*|*"filter-branch"*|*"filter-repo"*)
      rule="GIT-DESTRUCTIVE"; why="history rewriting destroys the audit trail"; tip="git revert (forward-only)" ;;
    *"> worklog.md"*|*"worklog.md >"*)
      rule="JOURNAL-TRUNCATE"; why="worklog.md is append-only — truncation destroys the shared audit trail"; tip="append with >> or cat <<EOF >>" ;;
    *truncate*-s*0*events.jsonl*|*truncate*-s*0*exec-log.jsonl*|*truncate*-s*0*sovereign-events.jsonl*|*truncate*-s*0*worklog.md*)
      rule="JOURNAL-TRUNCATE"; why="truncate -s 0 on a journal destroys the audit trail"; tip="journals are append-only by law (lib.guardFileWrite)" ;;
    *"> events.jsonl"*|*"events.jsonl >"*|*"> exec-log.jsonl"*|*"exec-log.jsonl >"*|*"> sovereign-events.jsonl"*|*"sovereign-events.jsonl >"*)
      rule="JOURNAL-TRUNCATE"; why="journals are append-only — truncation destroys the audit trail"; tip="append with >>" ;;
    *"DROP TABLE"*|*"TRUNCATE TABLE"*|*"DROP DATABASE"*)
      rule="DB-DESTRUCTIVE"; why="DDL drop/truncate destroys data"; tip="review the schema change first" ;;
  esac
  if [ -n "$rule" ]; then
    print_panel "$rule" "$why" "$tip"
    rc=1
  fi
done <<< "$seg"

if [ "$rc" = "1" ]; then
  [ "$EXPLAIN" = "1" ] && exit 3
  exit 1
fi

if [ "$EXPLAIN" = "1" ]; then
  echo "OK — no destructive pattern matched (explanation mode)" >&2
  exit 0
fi

# all clear → execute the command for real
exec "$@"
