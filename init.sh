#!/usr/bin/env bash
# steem harness init — the standard verification entrypoint (LHE adoption, Task 19)
cd "$(dirname "$0")"   # location-independent
set -e

echo "[steem-init] structure"
test -d agent || { echo "FAIL: agent/ missing"; exit 1; }
test -f README.md || { echo "FAIL: README.md missing"; exit 1; }
test -f agent/agent.cjs || { echo "FAIL: agent/agent.cjs missing"; exit 1; }
test -f .gitleaksignore || { echo "FAIL: .gitleaksignore missing (triage layer)"; exit 1; }

echo "[steem-init] syntax gate on agent scripts (fails fast on corruption)"
shopt -s nullglob
count=0
for f in agent/*.cjs agent/*.mjs agent/*.js; do
  node --check "$f" >/dev/null
  count=$((count+1))
done
echo "  ok: ${count} scripts"

echo "[steem-init] receipts sanity"
ls agent/receipts/*.json >/dev/null 2>&1 || { echo "FAIL: no receipts"; exit 1; }
latest=$(ls -t agent/receipts/*.json | head -1)
echo "  latest receipt: ${latest}"

echo "[steem-init] lint/build (deps-installed only; org CI always runs them)"
if [ -d node_modules ]; then
  npm run lint --silent >/dev/null 2>&1 && echo "  lint ok" || { echo "FAIL: lint"; exit 1; }
else
  echo "  SKIP: node_modules absent (fresh clone) — org-selftests covers lint/build/type in CI"
fi

echo "STEEM-INIT-OK — restartable from AGENTS.md + README live-truth"
