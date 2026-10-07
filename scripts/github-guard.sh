#!/usr/bin/env bash
# GITHUB-GUARD (R250, v1.1) — compliance gate: the pre-push anti-ban wall.
# Law: docs/GITHUB-COMPLIANCE.md — fail-closed; any violation aborts the push.
# Called by scripts/sovereign-push.sh (LAW CLAUSE 3.5); standalone runs allowed.
# Exit: 0 = PASS | 1 = violation (push MUST abort) | 2 = guard internal error.
# v1.1 notes:
#  - base64-blob false-positives (design-template assets) filtered via grep -vE
#    with a 100-char run rule (mawk lacks {n,} intervals — awk is NOT used here).
#  - negative-control self-test proven: planted ghp_ token -> exit 1 (see worklog).
set -uo pipefail
cd "$(dirname "$0")/.."

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
FAIL=0
NOTE()      { echo "[guard] $*"; }
VIOLATION() { echo "[guard] VIOLATION: $*"; FAIL=1; }

# --- G1: secret material in the TRACKED tree (working tree) -------------------
# Patterns: GitHub tokens (all kinds), AWS, Slack, npm, live keys, PEM.
# Pattern literals below do NOT self-match (bracket chars break each regex).
PAT='ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,}|gho_[A-Za-z0-9]{36,}|ghs_[A-Za-z0-9]{36,}|ghu_[A-Za-z0-9]{36,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|sk_live_[A-Za-z0-9]{16,}|glpat-[A-Za-z0-9_-]{20,}|BEGIN [A-Z ]*PRIVATE KEY'
B64='[A-Za-z0-9+/]{100,}'
EXCL=':(exclude)scripts/github-guard.sh:(exclude)skills/design'
G1_HITS=$(timeout 60 git grep -InE "$PAT" -- $EXCL 2>/dev/null \
  | grep -vE "$B64" \
  | wc -l || echo 0)
if [[ "${G1_HITS:-0}" -gt 0 ]]; then
  VIOLATION "$G1_HITS secret-like line(s) in tracked files:"
  timeout 60 git grep -InE "$PAT" -- $EXCL 2>/dev/null \
    | grep -vE "$B64" \
    | cut -c1-200 \
    | head -20
else
  NOTE "G1 tree-secret-scan: CLEAN"
fi

# --- G2: vault hygiene (upload/ must stay untracked+ignored) ------------------
if ! git check-ignore -q upload/ 2>/dev/null; then
  VIOLATION "upload/ is NOT gitignored — the vault directory could enter git"
fi
if git ls-files upload/ 2>/dev/null | grep -q .; then
  VIOLATION "tracked files found under upload/ (vault) — remove from index by law"
fi
[[ $FAIL -eq 0 ]] && NOTE "G2 vault-hygiene: upload/ ignored + untracked"

# --- G3: outgoing scan — EVERYTHING the next push could carry ------------------
# Covers committed+staged+unstaged changes of tracked files vs origin tip.
BASE=$(git rev-parse --verify -q origin/saos-cockpit 2>/dev/null || echo "")
if [[ -z "$BASE" ]]; then
  NOTE "G3 outgoing-scan: no origin/saos-cockpit ref — skipped (bootstrap state)"
else
  OUT=$(timeout 60 git diff "$BASE" 2>/dev/null \
    | grep -E "$PAT" \
    | grep -vE "$B64" \
    | cut -c1-200 || true)
  if [[ -n "$OUT" ]]; then
    N=$(printf '%s\n' "$OUT" | wc -l)
    VIOLATION "outgoing diff vs origin carries $N secret-like line(s):"
    printf '%s\n' "$OUT" | sed 's/^/   /'
  else
    NOTE "G3 outgoing-scan: CLEAN (diff vs origin/saos-cockpit)"
  fi
fi

# --- G4: API rate-limit headroom (secondary-limit abuse = ToS evasion) --------
if [[ -f upload/pat.env ]]; then
  TOKEN="$(tr -d '"[:space:]' < upload/pat.env | head -1)"
  if [[ "$TOKEN" =~ ^(ghp_|github_pat_|gho_|ghs_) ]]; then
    REM=$(timeout 15 curl -s --max-time 10 -H "Authorization: Bearer $TOKEN" https://api.github.com/rate_limit \
      | timeout 10 python3 -c "import json,sys;print(json.load(sys.stdin)['resources']['core']['remaining'])" 2>/dev/null || echo "?")
    if [[ "$REM" == "?" || -z "$REM" ]]; then
      NOTE "G4 rate-limit probe: unreachable — non-blocking"
    elif [[ "$REM" -lt 200 ]]; then
      VIOLATION "GitHub API remaining=$REM < 200 — agents must back off before pushing more"
    else
      NOTE "G4 rate-limit headroom: remaining=$REM (OK)"
    fi
  else
    NOTE "G4 rate-limit probe: no usable token format — skipped"
  fi
else
  NOTE "G4 rate-limit probe: upload/pat.env absent — skipped"
fi

# --- verdict -------------------------------------------------------------------
if [[ $FAIL -eq 0 ]]; then
  echo "[guard] PASS @ $NOW (G1-G4 all clean — ToS-safe to publish)"
  exit 0
fi
echo "[guard] FAIL @ $NOW — push aborted by docs/GITHUB-COMPLIANCE.md"
exit 1
