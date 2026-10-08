#!/usr/bin/env bash
# R258 witness: catches silent working-tree deletions of tracked state files.
# Logs every existence transition of the guarded files; runs until killed.
DIR=/home/z/my-project/mini-services/saos-engine/state
LOG=/tmp/witness-r258.log
prev=""
while true; do
  now=""
  for f in tasks.json decisions.json; do
    if [ -f "$DIR/$f" ]; then now+="$f=P "; else now+="$f=A "; fi
  done
  if [ "$now" != "$prev" ]; then
    echo "$(date -u +%FT%TZ) $now" >> "$LOG"
    prev="$now"
  fi
  sleep 2
done
