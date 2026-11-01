#!/usr/bin/env bash
# beat-loop.sh — sovereign grid beat, one beat per invocation (restored 2026-11-01).
#
# Documented contract (Job 492740 + observed runs 20:01/20:15 + dex-grid.yml header):
#   1) custody check via steem/mini-services/saos-engine/master-judge.mjs
#   2) dispatch Domain workflow dex-grid.yml (workflow_dispatch, ref main); HTTP 204 = accepted
#   3) verdict line: ARMED-LIVE | ARMED-WAITING | DISARMED
# Receipt appended to steem/receipts/grid-beat.jsonl, format preserved:
#   {"ts":"...","beat":"grid","verdict":"...","dispatch":NNN,"takeover":0}
# takeover=0 while this local source is healthy (the Domain workflow's own guard
# decides takeover by source health; per its header the source died on minutes
# quota — this script runs once per beat, not on a minute quota).
# Never prints key material; token is read from file and used in-place only.
set -u
FLEET="${FLEET_ROOT:-/home/z/fleet}"
ENGINE="$FLEET/steem/mini-services/saos-engine"
RECEIPTS="$FLEET/steem/receipts"
TOKEN_FILE="/home/z/my-project/upload/Titi.secret"
mkdir -p "$RECEIPTS" 2>/dev/null || true

# --- 1) custody judge -------------------------------------------------------
if [ ! -f "$ENGINE/master-judge.mjs" ]; then
  echo "DISARMED (engine missing at $ENGINE)"
  exit 0
fi
judge_out="$(cd "$ENGINE" && node master-judge.mjs 2>&1)"
verdict_judge="$(printf '%s\n' "$judge_out" | grep -oE 'CUSTODY-(ALIVE|EMPTY)' | head -1)"
judge_line="$(printf '%s\n' "$judge_out" | grep VERDICT | head -1)"
echo "beat=start judge=[$judge_line]"

if [ "$verdict_judge" != "CUSTODY-ALIVE" ]; then
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"ts":"%s","beat":"grid","verdict":"DISARMED","dispatch":0,"takeover":0}\n' "$ts" >> "$RECEIPTS/grid-beat.jsonl"
  echo "DISARMED"
  exit 0
fi

# --- 2) dispatch dex-grid on Domain (freshness-aware) ------------------------
last_ts="$(grep -oE '"ts":"[^"]+"' "$RECEIPTS/grid-beat.jsonl" 2>/dev/null | tail -1 | cut -d'"' -f4)"
age_h="n/a"
if [ -n "${last_ts:-}" ]; then
  age_h="$(python3 -c "
from datetime import datetime, timezone
try:
    t=datetime.strptime('$last_ts','%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    print(f'{(datetime.now(timezone.utc)-t).total_seconds()/3600:.2f}')
except Exception: print('n/a')" 2>/dev/null || echo "n/a")"
fi
dispatch_code=0
TOKEN="$(tr -d '\n\r ' < "$TOKEN_FILE" 2>/dev/null)"
if [ -n "$TOKEN" ]; then
  dispatch_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
    -X POST \
    -H "Authorization: token $TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/roshpinacare-sys/Domain/actions/workflows/dex-grid.yml/dispatches" \
    -d '{"ref":"main"}')"
fi
unset TOKEN

# --- 3) verdict --------------------------------------------------------------
takeover=0
if [ "$dispatch_code" = "204" ] || [ "$dispatch_code" = "200" ]; then
  VERDICT="ARMED-LIVE"
else
  VERDICT="ARMED-WAITING"
fi
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"ts":"%s","beat":"grid","verdict":"%s","dispatch":%s,"takeover":%s}\n' \
  "$ts" "$VERDICT" "$dispatch_code" "$takeover" >> "$RECEIPTS/grid-beat.jsonl"
echo "dispatch=Domain-dex-grid(HTTP $dispatch_code, last=${last_ts:-none} ${age_h}h-old) takeover=$takeover"
echo "$VERDICT"
