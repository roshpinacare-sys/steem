#!/usr/bin/env bash
# R253 (agentcraft-גל-3): conflict forecast — git merge-tree --write-tree dry-run.
# מנבא-מראש באילו-קבצים-יתנגשו HEAD מול origin/saos-cockpit לפני-ריקוד-ה-stash/rebase.
# ADVISORY-בלבד (מודפס-בסעיף-3.6 של sovereign-push; לעולם-לא-חוסם-לבדו).
# Exit: 0=נקי/אין-סטייה · 1=חזוי-קונפליקטים · 2=שגיאה-פנימית.
set -uo pipefail
cd "$(dirname "$0")/.."
TARGET="saos-cockpit"
export GIT_TERMINAL_PROMPT=0
git fetch origin "$TARGET" -q || { echo "FORECAST-ERROR: fetch failed"; exit 2; }
REMOTE_TIP=$(git rev-parse origin/"$TARGET")
LOCAL_HEAD=$(git rev-parse HEAD)
if [[ "$REMOTE_TIP" == "$LOCAL_HEAD" ]] || git merge-base --is-ancestor "$REMOTE_TIP" "$LOCAL_HEAD" 2>/dev/null; then
  echo "FORECAST: clean fast-forward — no conflict possible (origin synced or ancestor)"
  exit 0
fi
OUT="$(git merge-tree --write-tree "$LOCAL_HEAD" "$REMOTE_TIP" 2>/dev/null)"
RC=$?
if [[ $RC -eq 0 ]]; then
  echo "FORECAST: origin moved but merge-tree predicts NO conflicts — auto-reconcile (stash→rebase) is safe"
  exit 0
fi
if [[ $RC -eq 1 ]]; then
  echo "FORECAST: conflicts predicted between HEAD and origin/$TARGET:"
  echo "$OUT" | tail -n +2 | awk 'NF' | sed 's/^/  ! /'
  echo "FORECAST-ADVICE: קבצי-state-חיים → המקומי-מנצח · docs/worklog/npm → union-שלי · worklog → union"
  exit 1
fi
echo "FORECAST-ERROR: merge-tree exited rc=$RC"
exit 2
