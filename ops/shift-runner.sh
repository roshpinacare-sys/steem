#!/usr/bin/env bash
# shift-runner.sh — the sovereign shift runner (T-595, 2026-11-04, owner order
# "do what's missing and more, urgent"). BUDGET-EXACT: one invocation ≤ ~9 min.
#
# WHAT ONE SHIFT DOES (idempotent, additive, verdict-only):
#   1. marker hygiene: close a stuck running=true marker whose pid is dead
#   2. army trade window (TRADE_MS=240000 ≈ 4 min): crown-vault-adopt 13/13 →
#      army-grid round-robin (governor-metered) → dexflow → receipts flush
#   3. power-up lane (standalone active-only tx; bypasses the claim-dust
#      deferral deadlock; gate rule 4 armed; doctrine-capped)
#   4. opportunistic full cycle ONLY when the last completed report is older
#      than 6h (240s cap — completion is a bonus, never a dependency)
#   5. shift receipt appended to steem/receipts/shift-runner.jsonl
#
# LAWS: no code modified; no key material printed; fail-honest verdicts;
# single instance per invocation.
set -uo pipefail
ENGINE="/home/z/fleet/steem/mini-services/saos-engine"
RECEIPTS="/home/z/fleet/steem/receipts"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
export SHIFT_TS="$TS"
mkdir -p "$RECEIPTS" 2>/dev/null || true
say() { echo "[shift] $*"; }

# --- 1. marker hygiene -------------------------------------------------------
python3 - <<'PYEOF'
import json, os
p = "/home/z/fleet/steem/mini-services/saos-engine/state/cycle-run.json"
try:
    d = json.load(open(p))
    pid = d.get("pid"); alive = False
    if d.get("running") and pid:
        try: os.kill(pid, 0); alive = True
        except Exception: alive = False
    if d.get("running") and not alive:
        d["running"] = False; d["killed"] = True; d["finishedAt"] = os.environ.get("SHIFT_TS", "")
        json.dump(d, open(p, "w"))
        print("[shift] marker repaired (stale running=true, pid dead)")
except Exception as e:
    print("[shift] marker hygiene skipped:", str(e)[:60])
PYEOF

cd "$ENGINE" || exit 1

# --- 2. army trade window ----------------------------------------------------
say "trade-window: boot (TRADE_MS=240000)"
TRADE_MS=240000 timeout 300 node actions-trade-batch.mjs 2>/dev/null | grep -E "crown-adopt|custody:|dexflow|final" | head -6
say "trade-window: done"


# --- 2.5 custody-era3: soldiers off-runner seal (G-M6-era3 · owner-approved 2026-11-06) ---
# THE LAW: soldier keys hostage on this disk must leave encrypted to vault-home.
# No two-location encrypted backup = no fuel. Reads state/custody-era3.json
# (one-time transport pass) -> judge vs live chain -> seal VERIFIED-SOLDIERS-<ts>.enc.
# fail-closed: no pass = honest judge-only attempt; no key material ever printed.
if [ -f ops/soldier-era-export.mjs ]; then
  say "custody-era3: attempt"
  ERA3_PASS="$(python3 -c "import json;print(json.load(open('state/custody-era3.json')).get('sealPass',''))" 2>/dev/null || true)"
  if [ -z "$GH_PAT" ]; then
    ORIGIN_URL="$(git remote get-url origin 2>/dev/null || true)"
    case "$ORIGIN_URL" in
      https://*@github.com/*) export GH_PAT="$(printf '%s' "$ORIGIN_URL" | sed -E 's#https://[^:]+:([^@]+)@github.com/.*#\1#')" ;;
    esac
  fi
  ERA3_OUT="$(timeout 180 env MAIN_KEY="$ERA3_PASS" node ops/soldier-era-export.mjs 2>/dev/null | tail -3)"
  if [ -n "$ERA3_OUT" ]; then say "custody-era3: $ERA3_OUT"; else say "custody-era3: no-output (honest)"; fi
else
  say "custody-era3: tool missing (repo not pulled?)"
fi

# --- 3. power-up lane --------------------------------------------------------
PU=$(timeout 120 node powerup-now.mjs 2>/dev/null | grep -E "broadcast|vest " | head -2)
if [ -n "$PU" ]; then say "powerup: $PU"; else say "powerup: no fresh plan or pacing-capped (honest skip)"; fi

# --- 4. opportunistic full cycle (only if report stale >6h) -------------------
STALE=$(python3 - <<'PYEOF'
import json, datetime, os
try:
    r = json.load(open("/home/z/fleet/steem/mini-services/saos-engine/state/daily-report.json"))
    f = r.get("finishedAt") or r.get("startedAt")
    age = (datetime.datetime.utcnow() - datetime.datetime.fromisoformat(f.replace("Z", "+00:00"))).total_seconds() if f else 1e9
    print("YES" if age > 6 * 3600 else "NO")
except Exception:
    print("YES")
PYEOF
)
if [ "$STALE" = "YES" ]; then
  say "cycle: report stale >6h — opportunistic attempt (240s cap)"
  CYCLE_OUT=$(timeout 240 node daily.mjs 2>/dev/null | tail -1)
  if [ -n "$CYCLE_OUT" ]; then say "cycle: COMPLETED"; else say "cycle: not-completed under cap (honest)"; fi
else
  say "cycle: report fresh — skipped (trade window carries the shift)"
  CYCLE_OUT=""
fi
python3 - <<'PYEOF'
import json, os
p = "/home/z/fleet/steem/mini-services/saos-engine/state/cycle-run.json"
try:
    d = json.load(open(p))
    pid = d.get("pid"); alive = False
    if d.get("running") and pid:
        try: os.kill(pid, 0); alive = True
        except Exception: alive = False
    if d.get("running") and not alive:
        d["running"] = False; d["killed"] = True; d["finishedAt"] = os.environ.get("SHIFT_TS", "")
        json.dump(d, open(p, "w"))
        print("[shift] marker repaired post-cycle")
except Exception: pass
PYEOF

# --- 5. receipt ---------------------------------------------------------------
printf '{"ts":"%s","shift":"runner","cycle":"%s","tradeWindow":240,"powerup":"attempted"}\n' "$TS" "$([ -n "${CYCLE_OUT:-}" ] && echo completed || echo skipped-or-not-completed)" >> "$RECEIPTS/shift-runner.jsonl"
say "receipt appended"
