#!/bin/bash
# ביקורת API: בדיקת גוף התשובה של כל נקודות הקצה הציבוריות (GET)
declare -a ENDPOINTS=(
  "/api/health"
  "/api/treasury"
  "/api/defi"
  "/api/ecosystem"
  "/api/agents"
  "/api/plan"
  "/api/saosnet"
  "/api/live/overview"
  "/api/live/attestations"
  "/api/live/checkpoints"
  "/api/live/dex"
  "/api/weave/state"
  "/api/weave/attestations"
  "/api/weave/checkpoints"
  "/api/weave/brain"
  "/api/weave/market"
  "/api/weave/registry"
  "/api/weave/verify"
  "/api/weave/evm3"
  "/api/weave/deploy-kit"
  "/api/weave/sovereignty"
  "/api/auth/session"
  "/api/domains"
)
echo "בדיקת 23 נקודות קצה:"
for ep in "${ENDPOINTS[@]}"; do
  resp=$(curl -s -w "\n%{http_code}" --max-time 15 "http://localhost:3000$ep")
  code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')
  len=${#body}
  # חיפוש סימני שגיאה בגוף
  bad=$(echo "$body" | head -c 2000 | grep -oE '"error"|"message":"[^"]*error|Internal Server Error|ECONNREFUSED|TypeError|Cannot read' | head -1)
  echo "$ep → $code · ${len}b ${bad:+· ⚠️ $bad}"
done
