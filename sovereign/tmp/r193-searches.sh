#!/bin/bash
# r193-a: 8 mandatory searches with backoff retry.
cd /tmp
declare -a QUERIES=(
  "Uniswap v4 hooks dynamic fee 2025"
  "intent based DEX UniswapX CoW Swap 1inch Fusion 2025"
  "ERC-7683 cross-chain intents adoption"
  "Hive-Engine BeDEX volume 2025"
  "Blurt blockchain exchange market liquidity"
  "Steem internal market SBD liquidity 2025"
  "AI agents x402 protocol trading 2025"
  "grid bot AMM pool rebalancing strategy"
)
LOG=/tmp/r193-search.log
echo "start $(date -u +%H:%M:%S)" > $LOG
for i in "${!QUERIES[@]}"; do
  N=$((i+1))
  OUT=/tmp/r193-s$N.json
  if [ -s "$OUT" ]; then echo "s$N exists, skip" >> $LOG; continue; fi
  ATTEMPT=0
  while [ $ATTEMPT -lt 40 ]; do
    ATTEMPT=$((ATTEMPT+1))
    z-ai function -n web_search -a "{\"query\": \"${QUERIES[$i]}\", \"num\": 6}" -o "$OUT" >/dev/null 2>&1
    if [ -s "$OUT" ]; then
      echo "s$N OK attempt $ATTEMPT $(date -u +%H:%M:%S)" >> $LOG
      break
    fi
    echo "s$N fail attempt $ATTEMPT $(date -u +%H:%M:%S)" >> $LOG
    sleep $((15 + RANDOM % 20))
  done
done
echo "done $(date -u +%H:%M:%S)" >> $LOG
