#!/usr/bin/env bash
# PUBLISH to GitHub Packages — @roshpinacare-sys/saos-agents (R250).
# Refuses fine-grained tokens on a User account (proven E403 x3 — see docs/GITHUB-COMPLIANCE.md §3).
# Classic token source, in order: upload/pat-classic.env, then upload/pat.env (if ghp_).
# Zero secrets in git: token only via NODE_AUTH_TOKEN env for one npm invocation.
set -euo pipefail
cd "$(dirname "$0")/.."

read_tok() { tr -d '"[:space:]' < "$1" | head -1; }

TOK=""; SRC=""
if [[ -f upload/pat-classic.env ]]; then
  T="$(read_tok upload/pat-classic.env)"
  if [[ "$T" == ghp_* ]]; then TOK="$T"; SRC="upload/pat-classic.env"; fi
fi
if [[ -z "$TOK" && -f upload/pat.env ]]; then
  T="$(read_tok upload/pat.env)"
  if [[ "$T" == ghp_* ]]; then TOK="$T"; SRC="upload/pat.env"; fi
fi

if [[ -z "$TOK" ]]; then
  echo "ABORT: no classic (ghp_) token available."
  echo "  - fine-grained PAT on a User account CANNOT publish to GitHub Packages (E403 x3, proven)."
  echo "  - Fix: docs/OPERATOR-PAT-STEPS.md → save classic token to upload/pat-classic.env"
  exit 1
fi
echo "token source: $SRC (classic)"

# fail-closed package sanity before any network publish
python3 - <<'EOF'
import json
d = json.load(open("npm/saos-agents/package.json"))
assert d["name"] == "@roshpinacare-sys/saos-agents", d["name"]
assert d.get("publishConfig", {}).get("registry") == "https://npm.pkg.github.com", "registry mismatch"
print("package sanity OK:", d["name"], d["version"])
EOF

cd npm/saos-agents
# --access public: GH-npm packages default to private; open distribution needs explicit access.
NODE_AUTH_TOKEN="$TOK" npm publish --access public
echo "PUBLISHED — live verify (authed; GH registry requires token even to view):"
NODE_AUTH_TOKEN="$TOK" npm view "@roshpinacare-sys/saos-agents" version --registry https://npm.pkg.github.com && echo "VERIFY OK"
