#!/usr/bin/env bash
# sanbox/bootstrap.sh — חייאה-מלאה בפקודה-אחת (idempotent, אל-כשל, כנה)
# סדר: גיט → התקנה → צי (3040-3043) → אתר-מפעיל (3046) → בריאות
set -uo pipefail
SB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SB/.." && pwd)"
cd "$ROOT"
mkdir -p "$SB/state"
LOG="$SB/state/bootstrap.log"
now() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
say()  { printf '%s\n' "$*"; }
ok()   { say "  OK $*"; }
warn() { say "  WARN $*"; }
bad()  { say "  FAIL $*"; }
port_ok() { curl -s -o /dev/null -m 3 "http://127.0.0.1:$1$2"; }
CRIT_FAIL=0

say "── sanbox/bootstrap @ $(now) ──" | tee -a "$LOG"

# ── 1 · גיט: סנכרון FF בלבד, בלי למחוק עבודה ──
git fetch origin saos-cockpit >/dev/null 2>&1 || warn "fetch נכשל (אופליין? ממשיך מקומי)"
BEHIND=$(git rev-list --count HEAD..origin/saos-cockpit 2>/dev/null || echo 0)
if [ "${BEHIND:-0}" -gt 0 ]; then
  # רק שינויים-נעקבים בשני-הנתיבים (untracked לא נוגעים — שלא ייעלמו!)
  if [ -n "$(git status --porcelain --untracked-files=no -- sanbox worklog.md)" ]; then
    git stash push -m "sanbox prebootstrap $(now)" -- sanbox worklog.md >/dev/null 2>&1 \
      && warn "שינויים-נעקבים ב-sanbox/worklog אורכבו ל-stash (לא נמחקו)"
  fi
  if git merge --ff-only origin/saos-cockpit >/dev/null 2>&1; then
    ok "גיט: סונכרן לטיפ origin (FF, ${BEHIND} קומיטים)"
  else
    warn "גיט: FF נחסם (סטייה) — טיפול-ידני לפי AGENTS.md; לא מאולץ"
  fi
else
  ok "גיט: מסונכרן"
fi

# ── 2 · התקנה (רק אם חסר) ──
[ -d node_modules ] || { bun install >/dev/null 2>&1 && ok "התקנה: שורש" || bad "התקנה: שורש"; }
[ -d mini-services/saos-engine/node_modules ] || { (cd mini-services/saos-engine && bun install >/dev/null 2>&1) && ok "התקנה: engine" || warn "התקנה: engine"; }

# ── 3 · הצי ──
start_svc() { # $1 שם-שירות  $2 פורט
  if port_ok "$2" /health; then ok "צי: $1 כבר-חי (:$2)"; return 0; fi
  (cd "mini-services/$1" && nohup bun index.ts >> "$LOG" 2>&1 &)
  sleep 4
  if port_ok "$2" /health; then ok "צי: $1 עלה (:$2)"; return 0; fi
  bad "צי: $1 לא עלה (:$2)"; return 1
}
start_svc saos-engine    3040 || CRIT_FAIL=1
start_svc saos-custodian 3041 || CRIT_FAIL=1
start_svc saos-metrics   3042 || CRIT_FAIL=1
start_svc saos-builder   3043 || CRIT_FAIL=1

# ── 4 · אתר-מפעיל ──
if port_ok 3046 /health; then
  ok "אתר-מפעיל: כבר-חי (:3046)"
else
  (cd "$SB/operator-site" && nohup bun index.ts >> "$LOG" 2>&1 &)
  sleep 3
  if port_ok 3046 /health; then ok "אתר-מפעיל: עלה (:3046)"; else bad "אתר-מפעיל: לא עלה"; CRIT_FAIL=1; fi
fi

# ── 5 · בריאות + קוקפיט (לא-קריטי) ──
if port_ok 3000 /; then ok "קוקפיט: חי (:3000)"; else warn "קוקפיט: לא חי (:3000) — מנוהל על-ידי dev-daemon, לא-קריטי"; fi

HEALTH=$(printf '{"at":"%s","engine":%s,"custodian":%s,"metrics":%s,"builder":%s,"operator":%s}' \
  "$(now)" \
  "$(port_ok 3040 /health && echo true || echo false)" \
  "$(port_ok 3041 /health && echo true || echo false)" \
  "$(port_ok 3042 /health && echo true || echo false)" \
  "$(port_ok 3043 /health && echo true || echo false)" \
  "$(port_ok 3046 /health && echo true || echo false)")
printf '%s\n' "$HEALTH" | jq . > "$SB/state/last-bootstrap.json" 2>/dev/null || printf '%s\n' "$HEALTH" > "$SB/state/last-bootstrap.json"

if [ "$CRIT_FAIL" -eq 0 ]; then
  ok "BOOTSTRAP: PASS — הגוף חי (sanbox/state/last-bootstrap.json)"
  exit 0
else
  bad "BOOTSTRAP: PARTIAL/FAIL — הרץ שוב או בדוק $LOG"
  exit 1
fi
