#!/usr/bin/env bash
# sanbox/commit-loop.sh — לולאת-התמדה: snapshot ניטרלי + דחיפה דרך השער (FF-only)
# חוק: נושא-ניטרלי בלבד (אין R2xx/SAOS-custodian — קומיטים-אלה לא-חתומים, סעיף 2.5)
# שימוש: commit-loop.sh start|stop|status|run-once|daemon
set -uo pipefail
SB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SB/.." && pwd)"
cd "$ROOT"
PIDF="$SB/state/commit-loop.pid"
LOG="$SB/state/commit-loop.log"
LOCK="$SB/state/commit-loop.lock"
INTERVAL="${SANBOX_COMMIT_INTERVAL:-300}"
mkdir -p "$SB/state"
log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG"; }
running() { [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF" 2>/dev/null)" 2>/dev/null; }

case "${1:-status}" in
  start)
    if running; then echo "commit-loop: כבר רץ (pid $(cat "$PIDF"))"; exit 0; fi
    nohup bash "$0" daemon >> "$LOG" 2>&1 &
    echo $! > "$PIDF"
    sleep 1
    if running; then echo "commit-loop: התחיל (pid $(cat "$PIDF"), כל ${INTERVAL}ש)"; exit 0; else echo "commit-loop: נכשל-העלאה — ראה $LOG"; exit 1; fi
    ;;
  stop)
    if running; then kill "$(cat "$PIDF")" 2>/dev/null; rm -f "$PIDF"; echo "commit-loop: נעצר"; else echo "commit-loop: לא רץ"; fi
    ;;
  status)
    if running; then echo "commit-loop: רץ (pid $(cat "$PIDF"))"; exit 0; else echo "commit-loop: לא רץ"; exit 1; fi
    ;;
  run-once) exec bash "$0" _tick ;;
  daemon)
    while true; do bash "$0" _tick >/dev/null 2>&1 || true; sleep "$INTERVAL"; done
    ;;
  _tick)
    (
      flock -n 9 || exit 0
      CHANGES=$(git status --porcelain -- sanbox worklog.md 2>/dev/null || true)
      if [ -n "$CHANGES" ]; then
        git add sanbox worklog.md 2>>"$LOG" || true
        if git -c commit.gpgsign=false commit -m "sanbox: autonomous persistence snapshot $(date -u +%FT%TZ)" >/dev/null 2>&1; then
          log "commit: snapshot (נושא-ניטרלי, לא-חתום — מותר לפי החוק, מתועד)"
        else
          log "commit: לא נוצר"
        fi
      fi
      AHEAD=$(git rev-list --count origin/saos-cockpit..HEAD 2>/dev/null || echo 0)
      if [ "${AHEAD:-0}" -gt 0 ]; then
        if bash scripts/sovereign-push.sh >> "$LOG" 2>&1; then
          log "push: OK (${AHEAD} קומיטים)"
        else
          RC=$?
          log "push: נדחה (exit=$RC) — סטייה/חוק; לא מאולץ; ממתין-הכרעה לפי AGENTS.md"
        fi
      fi
    ) 9>"$LOCK"
    ;;
  *)
    echo "שימוש: $0 start|stop|status|run-once|daemon"
    exit 2
    ;;
esac
