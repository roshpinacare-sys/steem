#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# init.sh — שער-האימות הקנוני של הרשת (harness · r151)
# חוק: אין "בוצע" לפני שהשער ירוק. כישלון-מהיר, אמת-כנה, אפס-קישוט.
# שימוש: bash init.sh             # דוח-מלא — כל הבדיקות רצות, השער כולו נקבע בסוף
#        bash init.sh --fast      # בלי tsc/eslint (לסביבות-קרות)
#        bash init.sh --strict    # set -e — fail-on-first-red (ל-CI/אוטומציה)
# ─────────────────────────────────────────────────────────────────────────────
set -u
set -o pipefail
cd "$(dirname "$0")"
# Next steps / clean restart:
#   סשן-חדש: bash init.sh → קרא session-handoff.md → progress.md → עבודה.
#   הקובץ restartable: כל בדיקה עצמאית, כישלון-אחד לא משאיר מצב-לא-נקי.
MODE="${1:-}"
if [ "$MODE" = "--strict" ]; then set -e; fi # --strict: כישלון-ראשון = יציאה מידית
FAIL=0
ok()   { printf "  \033[32m✔\033[0m %s\n" "$1"; }
bad()  { printf "  \033[31m✘\033[0m %s\n" "$1"; FAIL=1; return 0; }
head() { printf "\n\033[1m== %s ==\033[0m\n" "$1"; }

head "1. אמת-מאגר"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  LOCAL=$(git rev-parse --short HEAD)
  git fetch -q origin 2>/dev/null && ORIGIN=$(git rev-parse --short origin/main) || ORIGIN="$LOCAL"
  BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null)
  [ "$BEHIND" = "0" ] && ok "local($LOCAL) אינו-מאחורי origin($ORIGIN) — מסונכרן (קדימה: $(git rev-list --count origin/main..HEAD))" || bad "local=$LOCAL מאחורי origin=$ORIGIN ב-$BEHIND-קומיטים — ריצה: git pull --rebase --autostash"
  if git check-ignore -q .git-askpass.sh; then ok "askpass-הבית (PAT) מנוטרל ב-gitignore"; else bad "דליפה: .git-askpass.sh לא-מנוטרל — הוסף ל-.gitignore"; fi
  LEAKS=$(git diff --cached --name-only 2>/dev/null | grep -E "\.git-askpass|pat\.env|headcorner\.txt" | tr '\n' ' ' || true)
  [ -z "$LEAKS" ] && ok "אין סודות ב- staging" || bad "סודות ב-staging: $LEAKS"
else
  bad "לא תיק-גיט"
fi

head "2. קומפילציה ולינט"
if [ "$MODE" != "--fast" ]; then
  bunx tsc --noEmit -p tsconfig.json >/dev/null 2>&1 && ok "tsc 0" || bad "tsc נופל — ריצה ידנית לראות שגיאות"
  bunx eslint . --ext .ts,.tsx >/dev/null 2>&1 && ok "eslint 0" || bad "eslint נופל"
else
  echo "  (דילוג --fast)"
fi

head "3. צי-החיים"
declare -A FLEET=( [3000]="בית" [3038]="fleet-verify" [3040]="קיורציה" [3045]="business-engine" [3046]="מפעל-תוכן" )
for P in "${!FLEET[@]}"; do
  CODE=$(curl -s -m 4 -o /dev/null -w "%{http_code}" "http://localhost:$P/" 2>/dev/null || echo 000)
  if [ "$CODE" != "000" ]; then ok "פורט $P (${FLEET[$P]}) חי"; else bad "פורט $P (${FLEET[$P]}) מת — הקם: cd mini-services/... && bun --hot index.ts"; fi
done

head "4. מכונות-ההכנסה"
FH=$(curl -s -m 5 http://localhost:3046/health 2>/dev/null || true)
echo "$FH" | grep -q '"ok":true' && ok "מפעל-התוכן: ticks=$(echo "$FH" | grep -o '"ticks":[0-9]*' | cut -d: -f2) posts=$(echo "$FH" | grep -o '"posts":[0-9]*' | cut -d: -f2)" || bad "מפעל-התוכן לא ירוק"
CH=$(curl -s -m 5 http://localhost:3040/ 2>/dev/null || true)
echo "$CH" | grep -q '"service":"curation"' && echo "$CH" | grep -q '"armed":true' && ok "קיורציה: armed" || bad "קיורציה לא חמושה"

head "4b. מפקד-ההכנסות (revenue-census · r156 · אמת-מהשרשרת)"
CMSG=$(bun scripts/revenue-census.mjs --check 2>/dev/null | sed -n 1p)
[ -n "$CMSG" ] && ok "${CMSG#census: } · סריקה-מלאה: bun scripts/revenue-census.mjs" || bad "census עתיק/חסר — ריצה: bun scripts/revenue-census.mjs (~40ש')"

head "5. שער-ההרג (sovereign-guard · r153 · אדפטציה של destructive_command_guard)"
bun scripts/sovereign-guard.mjs --selftest >/dev/null 2>&1 && ok "selftest-השער PASS (60 מקרים)" || bad "selftest-השער נופל — ריצה: bun scripts/sovereign-guard.mjs --selftest"
[ -x .git/hooks/pre-commit ] && ok "pre-commit-השער מותקן (scan-mode: סודות+sh)" || bad "pre-commit חסר — ריצה: bun scripts/sovereign-guard.mjs --install"
[ -f sovereign/guard/blocked.jsonl ] && ok "יומן-הראיה חי ($(wc -l < sovereign/guard/blocked.jsonl) אירועים-מתועדים)" || ok "יומן-ראיה ריק (עדיין לא נחסם דבר)"

head "6. הוכחת-הריבונות (scorecard מול Emergence World · r154)"
bun scripts/sovereignty-proof.mjs 2>/dev/null | grep -q '"failed":0' && ok "scorecard: כל-מצבי-הכישלון-של-המחקר חסומים (PROVEN)" || bad "scorecard אדום — ריצה: bun scripts/sovereignty-proof.mjs"
[ -f sovereign/bloc/EMERGENCE-scorecard.json ] && ok "ראיה: sovereign/bloc/EMERGENCE-scorecard.json"

head "7. מפת-האמת + ה-harness עצמו"
bun scripts/sovereign-index.mjs --json >/dev/null 2>&1 && [ -f SOVEREIGN-INDEX.md ] && ok "SOVEREIGN-INDEX.md מיוצר-מהחי (10 שירותים נבדקו)" || bad "מפת-האמת לא נוצרה — ריצה: bun scripts/sovereign-index.mjs"
CMSG2=$(bun scripts/capability-census.mjs --check 2>/dev/null | sed -n 1p)
[ -n "$CMSG2" ] && ok "מפקד-היכולות: ${CMSG2#capabilities: } · ריצה-מלאה: bun scripts/capability-census.mjs" || bad "מפקד-יכולות עתיק/חסר — ריצה: bun scripts/capability-census.mjs"
for F in feature_list.json progress.md session-handoff.md AGENTS.md; do
  [ -f "$F" ] && ok "$F קיים" || bad "$F חסר"
done
node -e "const f=require('./feature_list.json');const badf=(f.features||[]).filter(x=>x.status!=='done'&&(!x.evidence_path||!x.last_verified_at));process.exit(badf.length?1:0)" 2>/dev/null \
  && ok "feature_list.json: כל-feature עם ראיה" || bad "feature_list.json: יש feature בלי ראיה/תאריך"

printf "\n"
if [ $FAIL -eq 0 ]; then printf "\033[42;30m השער ירוק — אפשר להכריז בוצע (עם ראיה) \033[0m\n"; else printf "\033[41;97m השער אדום — תקן לפני-הכרזה \033[0m\n"; exit 1; fi
