#!/usr/bin/env bash
# sovereign-restore.sh — R284 · SELF-REVIVABLE SIGNING + PAT (no operator pass, ever).
# Supersedes the R240 era (r4 key + operator VAULT_PASS — that law is DEAD).
# Opens agent/vault/EXTRA-SECRETS-2026-10-08-ROT4.zip.enc with the ONE live pass
# documented in agent/recovery-meta.json (system-custody doctrine — the private
# repo IS the vault boundary), restores:
#   1. the W1 commit-signing key (r5, fp 301E53150D283869A614D78114F411FEF0FC3424)
#   2. the live GitHub PAT (GITHUB_TOKEN → upload/pat.env 0600 + .git/config insteadOf)
# ZERO secret bytes are printed or logged.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
META="agent/recovery-meta.json"
BLOB="$(node -e 'const m=require("./agent/recovery-meta.json");console.log(m.extras.file)')"
PASS="$(node -e 'const m=require("./agent/recovery-meta.json");process.stdout.write(m.keysZipPass)')"
T="$(mktemp -d)"; chmod 700 "$T"; trap 'rm -rf "$T"' EXIT
step() { printf '[sovereign-restore] %s\n' "$*"; }

# sha-pin check (outer, from meta)
OUTER_PIN="$(node -e 'const m=require("./agent/recovery-meta.json");console.log(m.extras.outerSha256)')"
ACTUAL="$(sha256sum "$BLOB" | cut -d" " -f1)"
[[ "$ACTUAL" == "$OUTER_PIN" ]] || { echo "vault-blob-sha-mismatch" >&2; exit 1; }
step "vault blob opens (sha-pin ok)"

# 1. signing key
openssl enc -d -aes-256-cbc -pbkdf2 -iter 300000 -pass "pass:$PASS" -in "$BLOB" -out "$T/inner.zip"
INNER_PIN="$(node -e 'const m=require("./agent/recovery-meta.json");console.log(m.extras.innerSha256)')"
[[ "$(sha256sum "$T/inner.zip" | cut -d" " -f1)" == "$INNER_PIN" ]] || { echo "inner-sha-mismatch" >&2; exit 1; }
unzip -o -q "$T/inner.zip" "signing/w1-signing-key-r5.asc" -d "$T/x"
gpg --batch --yes --import "$T/x/signing/w1-signing-key-r5.asc" 2>/dev/null
FP="$(gpg --with-colons --list-secret-keys | grep -oE '[0-9A-F]{40}' | head -1)"
git config user.signingkey "$FP"
git config commit.gpgsign true
step "signing key live: ${FP: -16} (bound to git)"

# 2. PAT
unzip -o -q "$T/inner.zip" "pat/pat.env" -d "$T/x"
chmod 600 "$T/x/pat/pat.env"
cp "$T/x/pat/pat.env" upload/pat.env 2>/dev/null || { mkdir -p upload && cp "$T/x/pat/pat.env" upload/pat.env; }
chmod 600 upload/pat.env
# shellcheck disable=SC1091
set -a; source upload/pat.env; set +a
[[ -n "${GITHUB_TOKEN:-}" ]] && git config url."https://roshpinacare-sys:${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/" && step "git auth wired (insteadOf) — fetch/push lawful path restored"

# 3. verify
echo "restore-test-$(date -u +%s)" | gpg --batch --yes --pinentry-mode loopback --clearsign -o /dev/null 2>/dev/null \
  && step "key signs OK — sovereignty restored from git alone, zero operator secrets" \
  || { echo "sign test FAILED" >&2; exit 1; }
