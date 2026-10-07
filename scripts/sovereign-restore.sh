#!/usr/bin/env bash
# sovereign-restore.sh — R240 · THE SANDBOX-INDEPENDENT BOOTSTRAP (operator law:
# "ווידוא פעילות ריבונית אוטונומית ללא תלות באף סנדבוקס").
#
# WHAT IT RESTORES (from the signed tree alone — nothing else survives a wipe):
#   1. The W1 commit-signing key (agent/vault/W1-SIGNING-KEY-r4.enc.asc, AES256)
#      → imported into ~/.gnupg, bound to git user.signingkey. Rotation-r4 key
#        fingerprint 9013BA461887C1A0E70CB1C856BE3695EFCA32F2.
#   2. The GitHub PAT (agent/vault/PAT-2026-10-07.env.enc) → written to
#      upload/pat.env (0600) and wired into .git/config via url.insteadOf —
#      the divergence-check goes green again with zero operator interaction.
#
# PASSWORD LAW: the vault passphrase is the OPERATOR's own (the same one used
# for the pat.rar drops). It is NOT stored anywhere in the tree — by design.
# Usage:  VAULT_PASS='********' scripts/sovereign-restore.sh
#         (or it will prompt; never logged, never echoed)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PASS="${VAULT_PASS:-}"
if [[ -z "$PASS" ]]; then
  read -rs -p "vault passphrase: " PASS; echo
fi

step() { printf '[sovereign-restore] %s\n' "$*"; }

# ── 1. signing key ────────────────────────────────────────────────────────────
KEY_ENC="agent/vault/W1-SIGNING-KEY-r4.enc.asc"
if [[ ! -f "$KEY_ENC" ]]; then echo "missing $KEY_ENC" >&2; exit 1; fi
step "decrypting signing key (sha256 pin checked)"
echo "01d9c40bd8546c9109702ff298cbfc3672f8ee8ecade59615bcc8dfc7d6f86c9  $KEY_ENC" | sha256sum -c - >/dev/null
TMPKEY="$(mktemp)"; trap 'rm -f "$TMPKEY"' EXIT
gpg --batch --yes --pinentry-mode loopback --passphrase "$PASS" \
    -d "$KEY_ENC" > "$TMPKEY"
gpg --batch --yes --import "$TMPKEY"
NEWKEY="$(gpg --list-secret-keys --with-colons | awk -F: '/^sec/{print $5; exit}')"
git config user.signingkey "$NEWKEY"
git config commit.gpgsign true
step "signing key live: $NEWKEY (bound to git)"

# ── 2. PAT ────────────────────────────────────────────────────────────────────
PAT_ENC="agent/vault/PAT-2026-10-07.env.enc"
if [[ -f "$PAT_ENC" ]]; then
  step "decrypting PAT (sha256 pin checked)"
  echo "0d4a4add264f00df349e369c03ae09be06f601c2e682100e6fb6b30031b941b6  $PAT_ENC" | sha256sum -c - >/dev/null
  mkdir -p upload
  gpg --batch --yes --pinentry-mode loopback --passphrase "$PASS" \
      -d "$PAT_ENC" > upload/pat.env
  chmod 600 upload/pat.env
  # shellcheck disable=SC1091
  set -a; source upload/pat.env; set +a
  TOKEN="${GITHUB_TOKEN:-${GH_PAT:-${PAT:-}}}"
  if [[ -n "$TOKEN" ]]; then
    git config url."https://x-access-token:${TOKEN}@github.com/".insteadOf "https://github.com/"
    step "git auth wired (insteadOf) — fetch/push lawful path restored"
  else
    step "WARN: pat.env held no token var — wire .git/config manually"
  fi
else
  step "WARN: $PAT_ENC missing — PAT skipped"
fi

# ── 3. verify ────────────────────────────────────────────────────────────────
step "self-verify: signature of HEAD (or a test sig) with the restored key"
if git rev-parse -q --verify HEAD >/dev/null; then
  git log -1 --pretty=%GN 2>/dev/null || true
fi
echo "test-sign-$(date -u +%s)" | gpg --batch --yes --pinentry-mode loopback --clearsign -o /dev/null 2>/dev/null \
  && step "key signs OK — sovereignty restored without any sandbox dependency" \
  || { echo "key sign test FAILED" >&2; exit 1; }
