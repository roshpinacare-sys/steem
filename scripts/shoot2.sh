#!/bin/bash
# צילום מתוקן: גלילה מלאה דרך העמוד (מפעיל whileInView) ואז צילום מלא
shoot_with_scroll() {
  local route="$1" name="$2"
  agent-browser open "http://localhost:3000/$route" > /dev/null 2>&1
  sleep 3
  # גלילה הדרגתית לתחתית — מפעילה את כל האנימציות
  agent-browser eval "window.scrollTo(0, 600)" > /dev/null 2>&1; sleep 0.5
  agent-browser eval "window.scrollTo(0, 1400)" > /dev/null 2>&1; sleep 0.5
  agent-browser eval "window.scrollTo(0, 2200)" > /dev/null 2>&1; sleep 0.5
  agent-browser eval "window.scrollTo(0, 3200)" > /dev/null 2>&1; sleep 0.5
  agent-browser eval "window.scrollTo(0, 4200)" > /dev/null 2>&1; sleep 0.5
  agent-browser eval "window.scrollTo(0, 5200)" > /dev/null 2>&1; sleep 0.5
  agent-browser eval "window.scrollTo(0, document.body.scrollHeight)" > /dev/null 2>&1; sleep 1
  agent-browser eval "window.scrollTo(0, 0)" > /dev/null 2>&1; sleep 1
  agent-browser screenshot --full "/home/z/my-project/scan-results/shots2/${name}.png" > /dev/null 2>&1
  echo "shot2: $name"
}
mkdir -p /home/z/my-project/scan-results/shots2
shoot_with_scroll "#/gate" gate
shoot_with_scroll "#/array" array
shoot_with_scroll "#/flywheel" flywheel
shoot_with_scroll "#/money-market" money-market
shoot_with_scroll "#/exchange/dex" exchange_dex
shoot_with_scroll "#/exchange/holdings" exchange_holdings
shoot_with_scroll "#/network/dashboard" network_dashboard
shoot_with_scroll "#/network/webnet" network_webnet
shoot_with_scroll "#/network/ecosystem" network_ecosystem
shoot_with_scroll "#/domains" domains
shoot_with_scroll "#/knowledge/evolution" knowledge_evolution
shoot_with_scroll "#/knowledge/doctrine" knowledge_doctrine
shoot_with_scroll "#/admin/command" admin_command
echo "DONE"
