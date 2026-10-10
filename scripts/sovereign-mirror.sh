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
# R306-b TRANSPORT LAW (measured live 11:05-11:15Z, seven probes — the
# chronic SB6 killer found and closed): the "!f(){...};f" credential-helper
# idiom NEVER worked in this plane — /bin/sh is dash and rejects it with
# "Syntax error: Bad function name", so git ran ANONYMOUS and GitLab answered
# 403 "HTTP Basic: Access denied" — misread for two rounds as an IP block
# (the old API probe hitting the projects COLLECTION endpoint reinforced it).
# Measured further: the token was ALWAYS valid (62-char dot-segment form,
# API /user 200, scopes full incl. write_repository); curl basic-auth with a
# generic username passes both info/refs and git-receive-pack.
# WORKING TRANSPORT (measured ls-remote 200): HTTP Basic via GIT_CONFIG_*
# environment config — zero secret in argv, files, or logs. The API judges;
# the push is the law.
AUTH=$(printf 'x:%s' "$SAOS_GITLAB_TOKEN" | base64 -w0)
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=http.extraheader
export GIT_CONFIG_VALUE_0="Authorization: Basic $AUTH"
unset AUTH

# 1) best-effort project ensure — R306-b: probe the SCOPED project endpoint
# (measured 200) instead of the collection endpoint (403 red herring).
# The push itself remains the only judge.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
  -H "PRIVATE-TOKEN: $SAOS_GITLAB_TOKEN" \
  "https://gitlab.com/api/v4/projects/roshpinacare%2Fsteem" 2>/dev/null || echo 000)
case "$code" in
  200) echo "mirror: project exists" ;;
  404) c2=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST \
        -H "PRIVATE-TOKEN: $SAOS_GITLAB_TOKEN" -H "Content-Type: application/json" \
        -d '{"name":"steem","path":"steem","visibility":"private"}' \
        "https://gitlab.com/api/v4/projects" 2>/dev/null || echo 000) \
       echo "mirror: project ensure code=$c2" ;;
  *) echo "mirror: API code=$code (informational) — push will judge" ;;
esac

# 2) push with retry/backoff (the push itself is the mirror law)
# R303 · BOUNDED-PUSH LAW: a push to a blocked/hostile plane used to hang on
# TCP connect for minutes per attempt — measured live: it froze the runner's
# tick for 15min and (via the then-unbounded tick) blacked out the autonomy
# queue for an hour. Every attempt is now bounded at 240s.
ok=0
for attempt in 1 2 3; do
  if timeout 240 git push "$GL_URL" "$REF:$REF" --force-with-lease=:"$REF" 2>/tmp/mirror-git.err; then
    ok=1; break
  fi
  # first push to an empty repo: force-with-lease vs nothing fails — plain push retry
  if timeout 240 git push "$GL_URL" "$REF:$REF" 2>>/tmp/mirror-git.err; then
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
