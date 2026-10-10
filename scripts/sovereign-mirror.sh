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

# 1) NO API PROBE (R306-b): every request spends the plane's rate budget and
# Cloudflare throttles this datacenter IP probabilistically (measured: the
# same endpoint 200 then 403 within minutes, cf-ray HKG). The CAS ls-remote
# + the push itself are the only judges.

# 2) push with retry/backoff (the push itself is the mirror law)
# R303 · BOUNDED-PUSH LAW: every attempt is bounded at 240s.
# R306-b MIRROR-CAS LAW (measured live 11:45Z): the GitLab project carries
# PRE-EXISTING foreign history (remote saos-cockpit = 2d8a01cf, not an
# ancestor of the branch of record) — a mirror's law is CAS-overwrite:
# measure the remote sha, then force-with-lease against THAT exact value —
# safe against racing pushes, decisive against stale history.
# R306-b THROTTLE-AWARE LAW: ls-remote is retried (the plane 403s
# probabilistically — an empty read is NOT proof of absence), and push
# retries space out 45s/90s to respect the cooldown window.
RSHA=""
for i in 1 2 3; do
  RSHA=$(timeout 60 git ls-remote "$GL_URL" "refs/heads/$REF" 2>/dev/null | awk '{print $1}')
  [ -n "$RSHA" ] && break
  sleep 15
done
if [ -n "$RSHA" ]; then
  LEASE="--force-with-lease=refs/heads/$REF:$RSHA"
  echo "mirror: remote=$RSHA → CAS-overwrite"
else
  LEASE="--force-with-lease=:$REF"
  echo "mirror: remote read empty ×3 → create-if-absent"
fi
ok=0
for attempt in 1 2 3; do
  if timeout 240 git push "$GL_URL" "$REF:$REF" $LEASE 2>/tmp/mirror-git.err; then
    ok=1; break
  fi
  sleep $((attempt * 45))
done

if [ "$ok" = "1" ]; then
  echo "{\"ok\":true,\"verdict\":\"MIRRORED\",\"ref\":\"$REF\",\"remote\":\"gitlab.com/roshpinacare/steem\"}"
  exit 0
fi
echo "{\"ok\":false,\"reason\":\"push failed after 3 attempts\",\"tail\":\"$(tail -c 160 /tmp/mirror-git.err 2>/dev/null | tr '\n' ' ' | sed 's/oauth2:[^@]*@/oauth2:REDACTED@/g')\"}"
exit 1
