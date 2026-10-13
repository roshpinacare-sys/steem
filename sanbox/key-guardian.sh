#!/usr/bin/env bash
# sanbox/key-guardian.sh — מגן-המפתח: הריבונות לא נופלת על מחיקה. פעם-אחת-ולתמיד.
# חוק מפעיל 2026-10-06: אף-פעם לא שואלים מפתחות. סדר-החייאה:
#   1. .secrets/headcorner.key קיים → חמוש, אין-פעולה
#   2. upload/headcorner.txt קיים → המנוע יאמץ לבד (T-12), אין-התערבות
#   3. אחרת → GEN-3 unlock מהכספת-בגיט (shard רנטימי — לעולם לא בגיט)
#      ואז בעיטה למנוע לאימות-שרשרת מיידי.
# שימוש: key-guardian.sh tick|status
set -uo pipefail
SB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SB/.." && pwd)"
cd "$ROOT"
LOG="$SB/state/key-guardian.log"
mkdir -p "$SB/state"
log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG"; }

case "${1:-tick}" in
  tick)
    if [ -r ".secrets/headcorner.key" ]; then exit 0; fi
    if [ -r "upload/headcorner.txt" ]; then
      log "key: absent — upload present, engine T-12 will self-adopt (no-touch)"
      exit 0
    fi
    OUT=$(bun scripts/gen3-vault.mjs unlock 2>>"$LOG") || { log "guardian: unlock errored"; exit 1; }
    if printf '%s' "$OUT" | rg -q '"verdict":"revived"'; then
      log "guardian: KEY REVIVED from GEN-3 git vault (0600) — kicking engine verify"
      # kick the engine so verifyRoles → syncCredential run without waiting a cycle
      curl -s -m 15 http://127.0.0.1:3040/status >/dev/null 2>&1 || true
      log "guardian: revival complete — cred chain re-verifies on engine read"
    elif printf '%s' "$OUT" | rg -q '"verdict":"already-armed"'; then
      exit 0
    else
      log "guardian: unlock did not revive ($OUT) — fail-honest, upload remains the operator channel"
      exit 1
    fi
    ;;
  status)
    bun scripts/gen3-vault.mjs status
    if [ -r ".secrets/headcorner.key" ]; then echo "key: ARMED (0600)"; else echo "key: ABSENT"; fi
    ;;
  *) echo "usage: key-guardian.sh tick|status"; exit 2 ;;
esac
