#!/usr/bin/env bash
# SOVEREIGN PUSH GATE — the ONLY sanctioned push procedure for this body (W1).
# Law: SOVEREIGN-WRITER-LAW.md — fast-forward ONLY; force is forbidden FOREVER.
# Usage: scripts/sovereign-push.sh            # push HEAD -> origin/saos-cockpit
# Exit codes: 0 pushed/synced | 2 divergence (abort, by law) | 3 law-violation attempt
# R220 clause 2.5: unsigned body-prefixed commits in the push range -> exit 3.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="saos-cockpit"
# --- LAW CLAUSE 1: only saos-cockpit, never extra args (no --force can ever pass) ---
if [[ "$#" -gt 0 && "$1" != "$TARGET" ]]; then
  echo "LAW-VIOLATION: pushes are restricted to $TARGET (got: $*)"; exit 3
fi
for a in "$@"; do
  case "$a" in
    *force*|*-f*) echo "LAW-VIOLATION: force flags are forbidden by SOVEREIGN-WRITER-LAW.md"; exit 3 ;;
  esac
done
export GIT_TERMINAL_PROMPT=0

# --- LAW CLAUSE 4: fetch-before-push ---
BEFORE=$(git rev-parse origin/"$TARGET" 2>/dev/null || echo "none")
git fetch origin "$TARGET" >/dev/null 2>&1 || { echo "FETCH-FAIL: cannot verify remote state — aborting by law (never push blind)"; exit 1; }
REMOTE_TIP=$(git rev-parse origin/"$TARGET")
LOCAL_HEAD=$(git rev-parse HEAD)
[[ "$BEFORE" != "none" && "$BEFORE" != "$REMOTE_TIP" ]] && echo "NOTICE: remote moved during run $BEFORE -> $REMOTE_TIP (re-checked below)"

# --- LAW CLAUSE 3.6 (R253): conflict forecast — ADVISORY ONLY (never blocks) ---
# agentcraft-distillation: know WHERE the parallel collision will hurt before the
# stash/rebase dance. Read-only prediction via merge-tree dry-run (wave-3 graft).
if [[ "$REMOTE_TIP" != "$LOCAL_HEAD" ]] && ! git merge-base --is-ancestor "$REMOTE_TIP" "$LOCAL_HEAD" 2>/dev/null; then
  bash scripts/conflict-forecast.sh || true
fi

# --- LAW CLAUSE 2: FF-only gate ---
if git merge-base --is-ancestor "$REMOTE_TIP" "$LOCAL_HEAD"; then
  : # fast-forward possible (or already synced)
else
  echo "DIVERGENCE-ABORT: remote tip $REMOTE_TIP is NOT an ancestor of local HEAD $LOCAL_HEAD"
  echo "LAW: never force. Reconcile by explicit decision: fetch + merge with worklog entry, or operator order."
  exit 2
fi

# --- LAW CLAUSE 3.5 (R250): GitHub compliance gate — secrets + ToS, fail-closed ---
# docs/GITHUB-COMPLIANCE.md: a leaked token once got this account suspended;
# no push may ever carry secret material or abuse API limits.
bash scripts/github-guard.sh

# --- LAW CLAUSE 3.7 (R267): the map must be true — doctrine-audit, fail-closed ---
# agent/DOCTRINE.md + agent/ATLAS.md + agent/COLD-START.md are the enforced
# self-knowledge layer; a push that moves reality while the map lies publishes
# a trap for the next agent (the 427-vectors class of rot). Same law as the
# guard above: gate failure = stop and document, never bypass.
if [[ -f scripts/doctrine-audit.mjs ]]; then
  bun scripts/doctrine-audit.mjs || { echo "LAW-VIOLATION: doctrine-audit failed — fix the docs in the same commit that moved reality"; exit 3; }
fi

# --- LAW CLAUSE 2.5 (R220): body-prefixed commits MUST be GPG-signed ---
# Unsigned commits with a body prefix (R2xx / SAOS-custodian) are a writer-law
# violation (identity clause 7) — the gate now REFUSES to publish them.
# Unsigned UUID-subject commits are environment checkpoint noise (see law v1.1)
# and pass. Detective control lives in the claims-auditor (git.bodySigned).
if [[ "$REMOTE_TIP" != "$LOCAL_HEAD" ]]; then
  UNSIGNED_BODY=$(git log --format='%G?|%s' "${REMOTE_TIP}..${LOCAL_HEAD}" \
    | awk -F'|' '$1 != "G" && ($2 ~ /^R2[0-9]+/ || $2 ~ /^SAOS-custodian/)')
  if [[ -n "${UNSIGNED_BODY:-}" ]]; then
    echo "LAW-VIOLATION: unsigned body commits in push range — refusing to publish:"
    echo "$UNSIGNED_BODY"
    exit 3
  fi
fi

git push origin "HEAD:refs/heads/$TARGET"
NEW_SHA=$(git rev-parse HEAD)
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# --- LAW CLAUSE 5: bounded-staleness custody record ---
TMP=$(mktemp)
printf '{\n  "lastPushedSha": "%s",\n  "pushedAt": "%s",\n  "branch": "%s",\n  "localHeadAtPush": "%s",\n  "method": "scripts/sovereign-push.sh (FF-only gate)",\n  "law": "SOVEREIGN-WRITER-LAW.md v1",\n  "note": "updated only by sovereign-push; engine should surface drift vs git rev-parse HEAD each cycle"\n}\n' \
  "$NEW_SHA" "$NOW" "$TARGET" "$LOCAL_HEAD" > "$TMP"
mkdir -p mini-services/saos-engine/state
mv "$TMP" mini-services/saos-engine/state/push-custody.json
echo "PUSHED $NEW_SHA -> $TARGET @ $NOW (custody recorded; FF-only law honored)"
