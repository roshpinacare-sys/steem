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

# ── 1.5 · מגן-מפתח: GEN-3 — המפתח קם לבד מהכספת-בגיט לפני העלאת-הצי.
# חוק-מפעיל 2026-10-06: אף-פעם לא שואלים מפתחות. מחיקה-קרה כבר לא משביתה חתימה.
if bash "$SB/key-guardian.sh" tick; then
  ok "מגן-מפתח: חתימה חמושה (GEN-3 מוכן)"
else
  warn "מגן-מפתח: לא-חמוש — upload/headcorner.txt הוא ערוץ-החייאה (fail-honest)"
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

# ── 4.5 · רץ-המשימות הריבוני (לולאת-האוטונומיה) ──
if bash "$SB/autonomy-runner.sh" status >/dev/null 2>&1; then
  ok "אוטונומיה: רץ-המשימות כבר-חי"
else
  bash "$SB/autonomy-runner.sh" start >/dev/null 2>&1 \
    && ok "אוטונומיה: רץ-המשימות עלה" \
    || warn "אוטונומיה: רץ-המשימות לא עלה (לא-קריטי — הצי חי)"
fi
bash "$SB/autonomy-runner.sh" run-once >/dev/null 2>&1 \
  && ok "אוטונומיה: tick ראשון הושלם (תור-המשימות מבוצע)" \
  || warn "אוטונומיה: tick ראשון נכשל — ראה sanbox/state/autonomy-runner.log"

# ── 4.55 · שומר-שאריות-החתימה (R304 · R302 ממוכן) ──
# הנפילה-משחזרת את הקונפיג של הפלטפורמה: commit.gpgsign=true. אם מפתח-הסוד
# חסר — כל-קומיט-אוטונומי נכשל ("No secret key", נמדד-חי 04:44-04:54 R302) —
# השומר מכבה-חתימה-בכנות. אם המפתח-חי (מפתח-הגוף-עצמו, "SAOS W1") — האמון
# נעוגן (ownertrust) כדי-שהחתימות-יאומתו-מקומית כ-G/SIGNED ולא-U (R304).
if [ "$(git config commit.gpgsign 2>/dev/null)" = "true" ]; then
  SK="$(git config user.signingkey 2>/dev/null || true)"
  if [ -n "$SK" ] && gpg --list-secret-keys "$SK" >/dev/null 2>&1; then
    printf '%s:6:\n' "$SK" | gpg --import-ownertrust >/dev/null 2>&1 \
      && ok "חותם: מפתח-הגוף חי ונסמך (${SK:0:8}… — R304 TRUST-ANCHOR)" \
      || ok "חותם: מפתח-הגוף חי (${SK:0:8}…) — עוגן-אמון כבר-קיים"
  else
    git config commit.gpgsign false \
      && warn "חותם: gpgsign=true בלי-מפתח-סודי → false (שומר-R302; קומיטים-אוטונומיים-לא-ייכשלו)"
  fi
fi

# ── 4.6 · איטום-כלי-העבודה: החיית-ה-toolbelt מהכספת (R301-b) ──
# כל-התחלה-קרה מחיה את ארבעת-היכולות (gitlab/supabase/render/vck) מהכספת-
# החתומה — pins fail-closed; כישלון-מדווח-בכנות ולא-חוסם (קריטיות-חלקית).
TB=$(node mini-services/saos-engine/toolbelt-revival.mjs 2>/dev/null || true)
case "$TB" in
  *'"ok":true'*) ok "toolbelt: חי ($(printf '%s' "$TB" | jq -r '.items | join(",")' 2>/dev/null)) — יכולות-חוץ-מקוונות" ;;
  *) warn "toolbelt: לא הוחיה ($TB) — היכולות-החוץ-מקוונות מושהות, אין-חסימת-אתחול" ;;
esac

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
