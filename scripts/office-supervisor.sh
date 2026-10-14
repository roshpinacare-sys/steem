#!/usr/bin/env bash
# office-supervisor.sh — R321 orphan-revival law, bounded (R324-CONT-2).
# Measured root: the sandbox OOM-killer sweeps collateral office services
# (dmesg 2026-10-14: next-server 1.3GB RSS killed → metrics/builder died
# silently with it, twice). A standing office must not wait for a human —
# every dead office port gets respawned, rate-capped at 1/10min per service
# so an OOM storm can never become a spawn storm.
# Additive-only: touches nothing owned by other agents (keeper/engine files
# untouched; the engine's own single-instance pre-bind probe makes double
# spawn harmless).
# Run detached:  setsid nohup bash scripts/office-supervisor.sh >/dev/null 2>&1 &
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/.zscripts/office-supervisor.log"
# single-instance law (measured R324-CONT-2: a double spawn created two loops)
PIDFILE="/tmp/saos-office-supervisor.pid"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  echo "[$(date -u +%FT%TZ)] already running (pid $(cat "$PIDFILE")) — duplicate-exit" >> "$LOG"
  exit 0
fi
echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT
# port -> service dir (office map, measured R324-CONT-2; dex=3037 NOT 3046)
declare -A DIR=(
  [3037]=saos-dex
  [3040]=saos-engine
  [3041]=saos-custodian
  [3042]=saos-metrics
  [3043]=saos-builder
  [3047]=state-witness
)
declare -A LAST=( [3037]=0 [3040]=0 [3041]=0 [3042]=0 [3043]=0 [3047]=0 )
COOLDOWN=600   # max 1 respawn per service per 10 min
INTERVAL=60

echo "[$(date -u +%FT%TZ)] office-supervisor up (pid $$, interval ${INTERVAL}s, cooldown ${COOLDOWN}s)" >> "$LOG"
while true; do
  for p in 3037 3040 3041 3042 3043 3047; do
    # 4s budget: the engine's /health can be slow under load (false-DOWN measured)
    code="$(curl -s -o /dev/null -w '%{http_code}' -m 4 "http://127.0.0.1:$p/health" 2>/dev/null)"
    [ "$code" = "200" ] && continue
    now="$(date +%s)"
    [ $(( now - ${LAST[$p]} )) -le $COOLDOWN ] && continue
    LAST[$p]="$now"
    echo "[$(date -u +%FT%TZ)] port $p DOWN (probe=$code) — respawn ${DIR[$p]}" >> "$LOG"
    ( cd "$ROOT/mini-services/${DIR[$p]}" &&
      setsid nohup bun index.ts >> "$ROOT/.zscripts/mini-service-${DIR[$p]}.log" 2>&1 < /dev/null & )
  done
  sleep "$INTERVAL"
done
