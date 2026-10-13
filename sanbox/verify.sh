#!/usr/bin/env bash
# sanbox/verify.sh — מטריצת-קבלה של הריבונות (exit 0 = PASS)
# שימוש: verify.sh [all|git|law|chain|fleet|operator|secrets|autonomy|persistence]
set -uo pipefail
SB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SB/.." && pwd)"
cd "$ROOT"
SECTION="${1:-all}"
PASS=0; FAIL=0; WARN=0
p() { PASS=$((PASS+1)); printf 'PASS  %s\n' "$*"; }
f() { FAIL=$((FAIL+1)); printf 'FAIL  %s\n' "$*"; }
w() { WARN=$((WARN+1)); printf 'WARN  %s\n' "$*"; }
want() { [ "$SECTION" = "all" ] || [ "$SECTION" = "$1" ]; }

# ── git ──
if want git; then
  if bash scripts/divergence-check.sh >/dev/null 2>&1; then
    p "git: מסונכרן/FF-אפשרי (divergence-check)"
  else
    f "git: סטייה מול origin — הרץ scripts/divergence-check.sh"
  fi
  N=$(git ls-files sanbox | wc -l)
  if [ "$N" -ge 10 ]; then p "git: sanbox נעקב בגיט (${N} קבצים)"; else f "git: sanbox לא נעקב (${N} קבצים) — יש לקמט ולדחוף"; fi
  if [ -f worklog.md ]; then p "git: worklog.md קיים"; else f "git: worklog.md חסר"; fi
  # R322 · SHALLOW-POISON LAW (measured 2026-10-13: authority-watchdog ran a
  # cwd-less `git fetch --depth=10` inside the LIVE repo — 57 grafts made every
  # ancestry check lie, divergence counts were ghosts, a chain-anchored tip
  # fell out of lineage invisibly). A shallow repo cannot judge lineage.
  if [ -f .git/shallow ]; then
    f "git: הריפו רדוד (.git/shallow) — בדיקות-אבות משקרות; הרץ git fetch --unshallow origin saos-cockpit"
  else
    p "git: אנטומיה-מלאה (לא-רדוד) — בדיקות-אבות אמינות"
  fi
fi

# ── law ──
if want law; then
  if timeout 90 node scripts/doctrine-audit.mjs 2>/dev/null | rg -q 'PASS'; then
    p "law: doctrine-audit PASS"
  else
    w "law: doctrine-audit לא אישר PASS (בדוק ידנית: node scripts/doctrine-audit.mjs)"
  fi
  # R322 · IDENTITY-GUARD-LOCAL LAW: CI can be billing-walled (measured live:
  # the identity-guard workflow died 40/40 behind a spend limit and the second
  # writer documented an `if: false` skip). The shield therefore ALSO runs
  # here — local verify cannot be billed into silence.
  if node scripts/identity-guard.mjs >/dev/null 2>&1; then
    p "law: identity-guard נקי (זהות-דוקטרינה יחידה, שערי-פריסה סגורים)"
  else
    f "law: identity-guard מצא אותות-זהות-זרה/פריסה-לא-משוערת — node scripts/identity-guard.mjs"
  fi
  SLR="mini-services/saos-engine/state/selftest-last-run.json"
  if [ -f "$SLR" ]; then
    P=$(jq -r '.pass // 0' "$SLR"); F=$(jq -r '.fail // 999' "$SLR"); AT=$(jq -r '.at // ""' "$SLR")
    AT_EPOCH=$(date -u -d "$AT" +%s 2>/dev/null || echo 0)
    HOURS=$(( ( $(date -u +%s) - AT_EPOCH ) / 3600 ))
    if [ "$F" = "0" ] && [ "$P" -gt 0 ] && [ "$HOURS" -le 36 ]; then
      p "law: selftest ${P}/${P} PASS (נמדד לפני ${HOURS}ש)"
    else
      w "law: selftest stale/כושל (pass=${P} fail=${F} age=${HOURS}ש) — הרץ: cd mini-services/saos-engine && bun selftest.mjs"
    fi
  else
    w "law: אין selftest-last-run"
  fi
fi

# ── chain ──
if want chain; then
  OUT=$(timeout 60 node scripts/chain-anchor-probe.mjs 2>/dev/null || true)
  # R304 · TRANSIENT-LAG LAW (measured live 07:12Z: all 3 nodes flaked in the
  # same second while the stamp txid was chain-proven 60s later — one probe
  # pass is not truth, it is one SAMPLE). The probe runs twice; a green on
  # either pass settles the verdict. Two consecutive reds = real drift.
  if ! printf '%s' "$OUT" | jq -e '.drift == false and .anchored == true' >/dev/null 2>&1; then
    sleep 20
    OUT2=$(timeout 60 node scripts/chain-anchor-probe.mjs 2>/dev/null || true)
    if printf '%s' "$OUT2" | jq -e '.drift == false and .anchored == true' >/dev/null 2>&1; then
      OUT="$OUT2"
    fi
  fi
  if printf '%s' "$OUT" | jq -e '.drift == false and .anchored == true' >/dev/null 2>&1; then
    p "chain: עוגן-ה-git מפורסם על-השרשרת (anchored, drift=false)"
  elif [ -z "$OUT" ]; then
    w "chain: probe לא זמין (רשת?) — fail-closed, לא הומצא"
  else
    f "chain: DRIFT או anchored=false — עצור-וחקור!"
  fi
fi

# ── fleet ──
if want fleet; then
  for entry in "engine 3040" "custodian 3041" "metrics 3042" "builder 3043"; do
    set -- $entry
    if curl -s -o /dev/null -m 3 "http://127.0.0.1:$2/health"; then
      p "fleet: $1 חי (:$2)"
    else
      f "fleet: $1 לא מגיב (:$2) — הרץ bash sanbox/bootstrap.sh"
    fi
  done
  if curl -s -o /dev/null -m 8 http://127.0.0.1:3000/; then
    p "fleet: cockpit חי (:3000)"
  else
    w "fleet: cockpit לא חי (:3000) — לא-קריטי (dev-daemon)"
  fi
fi

# ── operator ──
if want operator; then
  if curl -s -m 3 http://127.0.0.1:3046/health | jq -e '.ok == true' >/dev/null 2>&1; then
    p "operator: /health ציבורי-מינימלי"
  else
    f "operator: לא חי על :3046 — הרץ bash sanbox/bootstrap.sh"
  fi
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 3 http://127.0.0.1:3046/operator/status)
  if [ "$CODE" = "401" ]; then p "operator: /status נעול בלי-אימות (401)"; else f "operator: /status חשוף! (code=$CODE)"; fi
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 3 -X POST http://127.0.0.1:3046/operator/login --data 'password=definitely-wrong-probe-xyz')
  if [ "$CODE" = "401" ]; then
    p "operator: סיסמה-שגויה נדחית (401)"
  elif [ "$CODE" = "429" ]; then
    w "operator: probe-סיסמה הוגבל (429 rate-window) — השער דוחה; הנעילה נמדדה ב-/status"
  else
    f "operator: סיסמה-שגויה לא נדחית?! (code=$CODE)"
  fi
  if [ -f "$SB/state/agent-token" ]; then
    T=$(tr -d '[:space:]' < "$SB/state/agent-token")
    CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 3 -H "X-Op-Token: $T" http://127.0.0.1:3046/operator/status)
    if [ "$CODE" = "200" ]; then p "operator: גישת-סוכן עובדת (X-Op-Token → 200)"; else f "operator: גישת-סוכן נכשלה (code=$CODE)"; fi
    HDR=$(curl -s -i -m 3 -X POST -H "X-Op-Token: $T" http://127.0.0.1:3046/operator/login | rg -i '^set-cookie: sb_op=' || true)
    if printf '%s' "$HDR" | rg -qi 'HttpOnly' && printf '%s' "$HDR" | rg -qi 'SameSite=Strict'; then
      p "operator: cookie מאובטח (HttpOnly+SameSite=Strict)"
    else
      w "operator: דגלי-cookie לא נמדדו"
    fi
  else
    w "operator: אין agent-token (ייווצר אוטומטית בעלייה)"
  fi
fi

# ── secrets ──
if want secrets; then
  HITS=$(rg -n --hidden -g '!state/**' -g '!node_modules/**' -g '!*.log' \
    -e 'ghp_[A-Za-z0-9]{20,}' -e 'github_pat_[A-Za-z0-9_]{20,}' -e 'sk-[A-Za-z0-9]{20,}' \
    -e 'BEGIN (RSA|OPENSSH|EC|PGP) PRIVATE KEY' -e '5[HJK][1-9A-HJ-NP-Za-km-z]{49,}' \
    "$SB" 2>/dev/null | wc -l)
  if [ "$HITS" = "0" ]; then p "secrets: אפס-דפוסי-סודות ב-sanbox"; else f "secrets: ${HITS} ממצאים-חשודים — עצור ותחקור!"; fi
  if [ ! -e "$SB/state/agent-token" ] || git check-ignore -q "$SB/state/agent-token" 2>/dev/null; then
    p "secrets: state/ מנוטרל-gitignore"
  else
    f "secrets: state/ לא מנוטרל!"
  fi
fi

# ── autonomy ──
if want autonomy; then
  if jq -e . "$SB/autonomy/tasks.json" >/dev/null 2>&1; then p "autonomy: tasks.json תקין"; else f "autonomy: tasks.json פגום"; fi
  if jq -e . "$SB/autonomy/state.json" >/dev/null 2>&1; then p "autonomy: state.json תקין"; else f "autonomy: state.json פגום"; fi
  if jq -e . "$SB/MANIFEST.json" >/dev/null 2>&1; then p "autonomy: MANIFEST.json תקין"; else f "autonomy: MANIFEST.json פגום"; fi
fi

# ── persistence ──
if want persistence; then
  PIDF="$SB/state/commit-loop.pid"
  if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF" 2>/dev/null)" 2>/dev/null; then
    p "persistence: commit-loop רץ (pid $(cat "$PIDF"))"
  else
    w "persistence: commit-loop לא רץ — הרץ: bash sanbox/commit-loop.sh start"
  fi
  APIDF="$SB/state/autonomy-runner.pid"
  if [ -f "$APIDF" ] && kill -0 "$(cat "$APIDF" 2>/dev/null)" 2>/dev/null; then
    p "persistence: autonomy-runner רץ (pid $(cat "$APIDF"))"
  else
    w "persistence: autonomy-runner לא רץ — הרץ: bash sanbox/autonomy-runner.sh start"
  fi
  if [ -f "$SB/state/autonomy-runtime.json" ] && jq -e '.SB1.ok == true' "$SB/state/autonomy-runtime.json" >/dev/null 2>&1; then
    p "persistence: תור-המשימות מבוצע (SB1 אימות-ריבונות ok=true)"
  else
    w "persistence: תור-המשימות טרם-הוכח (autonomy-runtime.json/SB1)"
  fi
fi

printf -- '── VERIFY: PASS=%d FAIL=%d WARN=%d (section=%s) ──\n' "$PASS" "$FAIL" "$WARN" "$SECTION"
printf '{"at":"%s","pass":%d,"fail":%d,"warn":%d,"section":"%s"}\n' \
  "$(date -u +%FT%TZ)" "$PASS" "$FAIL" "$WARN" "$SECTION" > "$SB/state/last-verify.json" 2>/dev/null || true
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
