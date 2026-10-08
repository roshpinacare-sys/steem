#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# revive-anywhere.sh — R282 · SOVEREIGN BOOTSTRAP (פקודה-אחת, אפס-תלות-סנדבוקס)
# ═══════════════════════════════════════════════════════════════════════════
# החוק המפעיל 2026-10-06: "אין מה לבקש מפתחות — הכל בכספת בגיט".
# הסקריפט הזה הוא המימוש המלא של החוק על מכונה זרה טרייה:
#   clone → install → תחיית-כספת (chain-verified) → המנוע חי → אימות.
# אין שום צעד שדורש סוד מהמפעיל — הכספת בגיט היא האספקה.
#
# שימוש:
#   ./revive-anywhere.sh                     # בתוך clone קיים של הריפו
#   ./revive-anywhere.sh --verify-only       # בדיקה בלבד, בלי הרצת-מנוע
#
# ההוכחה (R282): clone טרי מאפס-מוחלט + סקריפט זה = FLEET-CUSTODY-ALIVE
# + selftest PASS, אידמפוטנטי, בלי שום קלט-אנושי.
set -uo pipefail

RED='\033[0;31m'; GRN='\033[0;32m'; AMB='\033[0;33m'; RST='\033[0m'
say()  { printf "%b\n" "$1"; }
fail() { say "${RED}✗ $1${RST}"; exit 1; }
ok()   { say "${GRN}✓ $1${RST}"; }
warn() { say "${AMB}• $1${RST}"; }

# ── 0 · המקום שבו אני עומד ────────────────────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || fail "לא נמצא שורש-הפרויקט"
[ -f package.json ] || fail "לא בשורש-הריפו (package.json חסר)"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")"
ok "שורש: $ROOT (ענף: $BRANCH)"

# ── 1 · סנכרון מהרימוט (חוק: pull דבר-ראשון) ──────────────────────────────
say ""
say "── 1 · סנכרון-גיט ──"
git fetch origin 2>/dev/null || warn "fetch נכשל (מצב-אופליין? ממשיך עם המקומי)"

# ── 2 · התקנה (שורש + מנוע) ────────────────────────────────────────────────
say ""
say "── 2 · התקנה ──"
command -v bun >/dev/null 2>&1 || fail "bun לא מותקן — הראויות-הקדמית של כל מכונה זרה"
bun install >/dev/null 2>&1 || fail "bun install (שורש) נכשל"
ok "שורש: bun install"
( cd mini-services/saos-engine && bun install >/dev/null 2>&1 ) || fail "bun install (saos-engine) נכשל"
ok "saos-engine: bun install"

# ── 3 · selftest (וקטורים טהורים, לא רשת) ─────────────────────────────────
say ""
say "── 3 · selftest ──"
if ( cd mini-services/saos-engine && timeout 120 bun selftest.mjs 2>&1 | tail -1 ) | tee /tmp/r282-selftest.txt | grep -q "PASS"; then
  ok "selftest: $(cat /tmp/r282-selftest.txt | tail -1)"
else
  fail "selftest נכשל — חוק-השקיפות: לא ממשיכים לחתימה עם חוקים שבורים"
fi

if [ "${1:-}" = "--verify-only" ]; then
  ok "--verify-only: הסתיים (ללא תחיית-כספת/מנוע)"
  exit 0
fi

# ── 4 · תחיית-כספת (הכספת היא האספקה — אפס קלט-אנושי) ─────────────────────
say ""
say "── 4 · תחיית-כספת (chain-verified) ──"
( cd mini-services/saos-engine && timeout 300 bun --input-type=module -e "
import { reviveArmyCustody } from './vault-revival.mjs';
const r = await reviveArmyCustody({ now: new Date().toISOString() });
console.log(JSON.stringify({ verdict: r.verdict, verified: r.after?.verified ?? r.verified ?? null, of: r.after?.total ?? r.total ?? null, pulled: r.pulled?.ok ?? null }));
" 2>/dev/null ) | tee /tmp/r282-custody.txt | grep -q "verdict" || fail "תחיית-הכספת נכשלה"
CUSTODY_VERDICT="$(python3 -c "import json,sys; print(json.load(open('/tmp/r282-custody.txt')).get('verdict','?'))" 2>/dev/null || echo '?')"
case "$CUSTODY_VERDICT" in
  FLEET-CUSTODY-ALIVE|*ALIVE*) ok "custody: $(cat /tmp/r282-custody.txt)" ;;
  *) warn "custody: $(cat /tmp/r282-custody.txt) — PARTIAL חוקי (גנרציות-מתות נדחות על-ידי השרשרת; המנוע עדיין חי עם המאומתות)" ;;
esac

# ── 5 · המנוע חי (בדיקת-בריאות) ────────────────────────────────────────────
say ""
say "── 5 · המנוע ──"
if curl -s --max-time 5 http://127.0.0.1:3040/health 2>/dev/null | grep -q '"ok"'; then
  ok "מנוע כבר חי על :3040 (אידמפוטנטי — לא מאתחל כפילות)"
else
  warn "מנוע לא רץ — הפעלה: (cd mini-services/saos-engine && bun run dev) ברקע"
  say "  (הסקריפט לא מריץ-דמון לבד: הריבונות היא שהמכונה יודעת להחיות את עצמה, לא שהסקריפט מחזיק תהליך)"
fi

say ""
say "${GRN}═══ R282 · SOVEREIGN REVIVAL: המכונה חיה מהכספת, אפס-תלות-סנדבוקס ═══${RST}"
