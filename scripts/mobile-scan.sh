#!/bin/bash
# בדיקת מובייל 390 וטאבלט 768: גלישה אופקית + צילומים אחרי גלילה
agent-browser set viewport 390 844 > /dev/null 2>&1
declare -a ROUTES=("#/gate" "#/array" "#/flywheel" "#/money-market" "#/games" "#/domains" "#/home" "#/network/dashboard" "#/network/webnet" "#/network/ledger" "#/exchange/dex" "#/exchange/market" "#/exchange/holdings" "#/knowledge/brain" "#/agents/fleet" "#/browser")
mkdir -p /home/z/my-project/scan-results/mobile
for r in "${ROUTES[@]}"; do
  name=$(echo "$r" | sed 's|#/||; s|/|_|g')
  agent-browser open "http://localhost:3000/$r" > /dev/null 2>&1
  sleep 2.5
  OVR=$(agent-browser eval "document.documentElement.scrollWidth > document.documentElement.clientWidth + 1" 2>/dev/null)
  SW=$(agent-browser eval "document.documentElement.scrollWidth" 2>/dev/null)
  echo "$name overflow=$OVR scrollW=$SW"
  agent-browser screenshot "/home/z/my-project/scan-results/mobile/${name}.png" > /dev/null 2>&1
done
echo "MOBILE-DONE"
