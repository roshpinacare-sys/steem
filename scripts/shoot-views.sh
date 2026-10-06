#!/bin/bash
# צילום כל המסכים לבדיקה חזותית
mkdir -p /home/z/my-project/scan-results/shots
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
  agent-browser open "http://localhost:3000/$r" > /dev/null 2>&1
  sleep 3
  agent-browser screenshot --full "/home/z/my-project/scan-results/shots/${name}.png" > /dev/null 2>&1
  echo "shot: $name"
done
echo "DONE"
