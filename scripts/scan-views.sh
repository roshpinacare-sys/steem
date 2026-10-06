#!/bin/bash
# סריקה שיטתית של כל המסכים — תועד שגיאות דף וקונסולה לכל מסך
# פלט: scan-results/*.txt לכל מסך

mkdir -p /home/z/my-project/scan-results
cd /home/z/my-project

declare -a ROUTES=(
  "#/gate" "#/array" "#/flywheel" "#/money-market" "#/games"
  "#/browser" "#/domains" "#/home"
  "#/network/dashboard" "#/network/webnet" "#/network/ledger"
  "#/network/anchor" "#/network/ecosystem" "#/network/plan"
  "#/agents/fleet" "#/agents/ledger"
  "#/exchange/dex" "#/exchange/market" "#/exchange/holdings"
  "#/knowledge/brain" "#/knowledge/sovereignty" "#/knowledge/evolution" "#/knowledge/doctrine"
  "#/admin/command" "#/admin/missions" "#/admin/server"
)

for r in "${ROUTES[@]}"; do
  name=$(echo "$r" | sed 's|#/||; s|/|_|g')
  [ -z "$name" ] && name="root"
  out="/home/z/my-project/scan-results/${name}.txt"
  agent-browser open "http://localhost:3000/$r" > /dev/null 2>&1
  sleep 3
  {
    echo "=== ROUTE: $r ==="
    echo "--- MAIN TEXT (first 400 chars) ---"
    agent-browser eval "document.querySelector('main')?.innerText.replace(/\\n+/g,' | ').slice(0,400) || 'MAIN EMPTY'" 2>/dev/null
    echo ""
    echo "--- PAGE ERRORS ---"
    agent-browser errors 2>/dev/null | grep -v "^stderr:" | grep -v "launched browser" || echo "(none)"
    echo "--- CONSOLE (errors/warnings only) ---"
    agent-browser console 2>/dev/null | grep -iE "error|warn|fail|cannot|unhandled" | head -8 || echo "(none)"
    echo "--- LOADING STUCK CHECK ---"
    agent-browser eval "(function(){const t=document.querySelector('main')?.innerText||'';return t.includes('טוען') && t.length<200 ? 'STUCK-LOADING' : 'ok'})()" 2>/dev/null
  } > "$out" 2>&1
  echo "done: $r"
done
echo "ALL DONE"
