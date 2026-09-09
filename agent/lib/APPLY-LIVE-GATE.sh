#!/bin/sh
# APPLY-LIVE-GATE.sh — one-command re-assertion of the LIVE-GATE contract (Task 28-b).
# Why this exists: the external runtime auto-saver ("gitkeeper") snapshots its own disk
# over origin every ~30min; its disk does not carry the gates. Two documented wipes:
# Task 25-d gates (reverted) and Task 28-b gates (origin 38c4ec1, 2026-09-09T03:04Z).
# If a fresh snapshot reverts the gates, run from anywhere:
#   sh agent/lib/APPLY-LIVE-GATE.sh
set -e
cd "$(dirname "$0")/.."
git apply -3 agent/lib/live-gate-28b.patch
git add agent/
git commit -m "security: LIVE-GATE re-asserted (runtime-snapshot wipe — mechanism documented in DAEMONS.md)"
echo "[LIVE-GATE] re-asserted. Proof: grep -l live_gate agent/*.cjs | wc -l   (expect 66)"
echo "[LIVE-GATE] durable fix: apply the same patch on the RUNTIME's own clone (the snapshot source)."
