#!/usr/bin/env bash
# disk-watchdog.sh — G13: the disk-full crisis (3x today) is a sandbox killer.
# Honest guard: frees regenerable caches ONLY (bun install cache). Never touches
# repos, vaults, or peer territory. Verdict-only stdout (valid JSON).
set -u
AVAIL_KB=$(df -k / | awk 'NR==2 {print $4}')
CLEANED=0; FREED=0
if [ "$AVAIL_KB" -lt 409600 ]; then
  B=$(du -sk /home/z/.bun/install/cache 2>/dev/null | cut -f1)
  rm -rf /home/z/.bun/install/cache 2>/dev/null
  if [ -n "${B:-}" ]; then CLEANED=1; FREED=$((B/1024)); fi
fi
AFTER_KB=$(df -k / | awk 'NR==2 {print $4}')
printf '{"availMB": %d, "cleanedSteps": %d, "freedMB": %d, "availAfterMB": %d}\n' "$((AVAIL_KB/1024))" "$CLEANED" "$FREED" "$((AFTER_KB/1024))"
