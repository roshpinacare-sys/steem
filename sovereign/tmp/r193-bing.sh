#!/bin/bash
# r193-a: Bing fallback searches (z-ai web_search hard-429'd).
cd /tmp
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
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
LOG=/tmp/r193-bing.log
echo "start $(date -u +%H:%M:%S)" > $LOG
rm -f /tmp/r193-cj.txt
for i in "${!QUERIES[@]}"; do
  N=$((i+1))
  ENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "${QUERIES[$i]}")
  curl -s -L -m 25 -c /tmp/r193-cj.txt -b /tmp/r193-cj.txt -A "$UA" \
    "https://www.bing.com/search?q=${ENC}&count=10&setlang=en" -o /tmp/r193-bingraw-$N.html
  echo "s$N fetch $(date -u +%H:%M:%S) size=$(stat -c%s /tmp/r193-bingraw-$N.html 2>/dev/null)" >> $LOG
  sleep $((3 + RANDOM % 5))
done
echo "done $(date -u +%H:%M:%S)" >> $LOG
