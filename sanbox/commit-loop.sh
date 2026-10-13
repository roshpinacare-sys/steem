#!/usr/bin/env bash
# sanbox/commit-loop.sh — לולאת-התמדה: snapshot ניטרלי + דחיפה דרך השער (FF-only)
# חוק: נושא-ניטרלי בלבד (אין R2xx/SAOS-custodian — קומיטים-אלה לא-חתומים, סעיף 2.5)
# שימוש: commit-loop.sh start|stop|status|run-once|daemon
set -uo pipefail
SB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# R318 · SELF-PATH LAW: daemons hold their own ABSOLUTE path — "$0" breaks
# when re-executed after a sandbox revival (relative cwd is gone). Measured
# live 2026-10-13: both loops died on revival until re-started by hand.
SELF="$SB/$(basename "${BASH_SOURCE[0]}")"
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
    nohup bash "$SELF" daemon >> "$LOG" 2>&1 &
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
  run-once) exec bash "$SELF" _tick ;;
  daemon)
    while true; do bash "$SELF" _tick >/dev/null 2>&1 || true; sleep "$INTERVAL"; done
    ;;
  _tick)
    (
      flock -n 9 || exit 0
      # מגן-מפתח: GEN-3 — המפתח קם לבד מהכספת-בגיט. חוק-מפעיל 2026-10-06:
      # לעולם לא שואלים מפתחות. כל-טיק מאמת שהחתימה חמושה — לפני כל-דבר אחר.
      bash "$SB/key-guardian.sh" tick || true
      # מגן-פרסום: אסור ליצור קומיט-התמדה על עץ עם סימני-קונפליקט (עצור-ותעד)
      if rg -q '^(<{7} |={7}$|>{7} )' sanbox worklog.md 2>/dev/null; then
        log "guard: סימני-קונפליקט ב-sanbox/worklog — snapshot נמנע (עצור-ותעד)"
        exit 0
      fi
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
          # R312 · SELF-RECONCILE LAW: remote moved (parallel agents + CI
          # heartbeats — measured 3 moves in 20 minutes). DIVERGENCE-ABORT is
          # not a terminal state for a standing agent: reconcile honestly
          # (merge, union ledgers, alive-wins state) and retry ONCE.
          if bash scripts/auto-reconcile.sh >> "$LOG" 2>&1; then
            if bash scripts/sovereign-push.sh >> "$LOG" 2>&1; then
              log "push: OK-אחרי-רקונסיליאציה (${AHEAD} קומיטים, R312)"
            else
              log "push: נדחה-גם-אחרי-רקונסיליאציה — ממתין-הכרעה (fail-honest)"
            fi
          else
            log "push: נדחה (exit=$RC) — רקונסיליאציה-אוטומטית נכשלה; הכרעה-ידנית לפי AGENTS.md"
          fi
        fi
      fi
    ) 9>"$LOCK"
    ;;
  *)
    echo "שימוש: $0 start|stop|status|run-once|daemon"
    exit 2
    ;;
esac
