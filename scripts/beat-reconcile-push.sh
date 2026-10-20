#!/usr/bin/env bash
# beat-reconcile-push.sh — the beat target for the machine-local beat-keeper
# (replaces /home/z/audit/beat-keeper.sh which died with the audit wipe —
# measured exit=127 every 30min from 2026-10-19 to 2026-10-20 06:00Z).
# Law: snapshot live churn → reconcile (never force, union ledgers) → push → honest verdict.
set -uo pipefail
cd "$(dirname "$0")/.."

# LEDGER-ROTATION LAW (W22, measured 2026-10-20 08:2xZ: exec-log.jsonl crossed
# GitHub's 100MB hard limit → every push declined pre-receive, the 30min
# state-push rhythm died SILENTLY). Any tracked *.jsonl ≥50MB rotates:
# archived as <name>-<UTC-date>.jsonl.gz, fresh file born. The union law
# still holds — history keeps the archives, ledgers never lose a line.
rotate=""
while IFS= read -r f; do
  sz=$(stat -c%s "$f" 2>/dev/null || echo 0)
  if [ "$sz" -ge 52428800 ]; then
    d="${f%.jsonl}-$(date -u +%Y-%m-%d).jsonl"
    [ -f "$d.gz" ] || d="${f%.jsonl}-$(date -u +%Y-%m-%dT%H%M).jsonl"
    mv "$f" "$d" && touch "$f" && gzip -9 "$d" && rotate="$rotate $f"
  fi
done < <(git ls-files '*.jsonl' | grep -E 'state/|receipts/')
[ -n "$rotate" ] && echo "rotated:$rotate"

# R321 live-state-first: snapshot engine churn even when remote hasn't moved
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git add -A ':!upload' ':!.secrets' >/dev/null 2>&1 || true
  git -c commit.gpgsign=false commit -m "beat: live-state churn snapshot" >/dev/null 2>&1 || true
fi

out="$(bash scripts/auto-reconcile.sh 2>&1 | tail -1)"
rc=$?
if [ $rc -ne 0 ]; then echo "BEAT-RECONCILE-FAIL rc=$rc :: $out"; exit $rc; fi

ahead=$(git rev-list --count origin/saos-cockpit..HEAD 2>/dev/null || echo "?")
if [ "$ahead" != "0" ] && [ "$ahead" != "?" ]; then
  if git push origin saos-cockpit 2>/tmp/beat-push-err; then
    echo "BEAT-PUSHED $(git rev-parse --short HEAD) (+$ahead)"
  else
    echo "BEAT-PUSH-FAIL (state committed locally at $(git rev-parse --short HEAD), +$ahead) :: $(head -c 200 /tmp/beat-push-err | tr '\n' ' ')"
    exit 1
  fi
else
  echo "BEAT-IDLE $out"
fi
