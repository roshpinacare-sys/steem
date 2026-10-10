#!/usr/bin/env bash
# sovereign-mirror.sh — R301-b · SECOND-FORGE MIRROR (הנמל-השני).
#
# CAPABILITY: pushes saos-cockpit to GitLab (gitlab.com/roshpinacare/steem) so
# the sovereignty survives ANY GitHub event (ban, censorship, outage). The
# token comes from the sealed toolbelt (.secrets/toolbelt.json via
# toolbelt-revival.mjs) — NEVER from argv, never logged, never persisted to
# .git/config (credential helper feeds it via env).
#
# Usage: bash scripts/sovereign-mirror.sh [refspec]   (default: saos-cockpit)
# Exit: 0 = mirrored | 1 = fail-honest (blocked/missing — never fakes success)
set -u
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
REF="${1:-saos-cockpit}"
GL_URL="https://gitlab.com/roshpinacare/steem.git"

TB=".secrets/toolbelt.json"
[ -f "$TB" ] || { node mini-services/saos-engine/toolbelt-revival.mjs >/dev/null 2>&1 || true; }
TOKEN=$(jq -r '.items[] | select(.id=="gitlab") | .token' "$TB" 2>/dev/null)
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] || { echo '{"ok":false,"reason":"gitlab token not revived"}'; exit 1; }

export SAOS_GITLAB_TOKEN="$TOKEN"
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=/bin/true
CREDS='!f() { echo username=oauth2; echo password=$SAOS_GITLAB_TOKEN; }; f'

# 1) best-effort project ensure (API may rate-limit from sandbox IPs — push is the truth)
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST \
  -H "PRIVATE-TOKEN: $SAOS_GITLAB_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"steem","path":"steem","visibility":"private"}' \
  "https://gitlab.com/api/v4/projects" 2>/dev/null || echo 000)
case "$code" in
  201) echo "mirror: project created" ;;
  400|409) echo "mirror: project exists" ;;
  000|429|403) echo "mirror: API blocked from this plane (code=$code) — push will judge" ;;
  *) echo "mirror: API code=$code (continuing)" ;;
esac

# 2) push with retry/backoff (the push itself is the mirror law)
ok=0
for attempt in 1 2 3; do
  if git -c credential.helper="$CREDS" push "$GL_URL" "$REF:$REF" --force-with-lease=:"$REF" 2>/tmp/mirror-git.err; then
    ok=1; break
  fi
  # first push to an empty repo: force-with-lease vs nothing fails — plain push retry
  if git -c credential.helper="$CREDS" push "$GL_URL" "$REF:$REF" 2>>/tmp/mirror-git.err; then
    ok=1; break
  fi
  sleep $((attempt * 20))
done

if [ "$ok" = "1" ]; then
  echo "{\"ok\":true,\"verdict\":\"MIRRORED\",\"ref\":\"$REF\",\"remote\":\"gitlab.com/roshpinacare/steem\"}"
  exit 0
fi
echo "{\"ok\":false,\"reason\":\"push failed after 3 attempts\",\"tail\":\"$(tail -c 160 /tmp/mirror-git.err 2>/dev/null | tr '\n' ' ' | sed 's/oauth2:[^@]*@/oauth2:REDACTED@/g')\"}"
exit 1
