#!/usr/bin/env bash
# R208-D — רץ-וקטורים (תהליך-אחד-לכל-וקטור: OBJ_DIR נלכד-ברמת-המודול)
set -u
LAB="/home/z/my-project/sovereign/tmp/r208/sensor-lab"
cd "$LAB"
rm -f results.jsonl errors.log
VECS="V1-stale-all-8d V1b-stale-options-only-8d V1c-fresh-6d23h V1d-stale-7d1s \
V2-falsifier-delta-missing V2b-falsifiers-empty \
V3-schema-v2 V3b-schema-absent \
V4-trace-removed V4b-law-removed V4c-builtAt-garbage \
V5-zero-fresh V5b-zero-stale-2h V5c-missing-measurement \
V6a-unit-USD/STEEM-3.5 V6b-unit-lowercase-usd-3.5 V6c-unit-empty-3.5 V6d-unit-absent-0.1041 V6e-unit-absent-3.5 \
V7-contradiction-3.5-vs-model-0.015 V7b-model-threshold-ignored \
V8-at-not-a-date-3.5 V8b-at-not-a-date-0 V8c-at-exactly-3600s V8d-at-3601s \
V9-nan V9b-infinity V9c-1e308 V9d-neg1e308 \
V10a-exactly-3.0 V10b-2.999 V15-traceability"
for v in $VECS; do
  if bun "$LAB/poison.mts" "$v" >> "$LAB/results.jsonl" 2>> "$LAB/errors.log"; then :; else
    echo "{\"vector\":\"$v\",\"process\":\"CRASHED\"}" >> "$LAB/results.jsonl"
  fi
done
echo "== done: $(grep -c '' "$LAB/results.jsonl") rows =="
