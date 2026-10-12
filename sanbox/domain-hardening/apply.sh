#!/usr/bin/env bash
# R313-A · החלת חיזוק-החשיפה על roshpinacare-sys/Domain (דורש token עם גישת Domain)
# שימוש: DOMAIN_TOKEN=... bash sanbox/domain-hardening/apply.sh
set -euo pipefail
: "${DOMAIN_TOKEN:?חובה DOMAIN_TOKEN עם גישת push לריפו Domain}"
WORK=$(mktemp -d)
git clone --depth 3 "https://x-access-token:${DOMAIN_TOKEN}@github.com/roshpinacare-sys/Domain.git" "$WORK/d"
cd "$WORK/d"
SRC="$(cd "$(dirname "$0")" && pwd)"
cp "$SRC/robots.txt" robots.txt
cp "$SRC/sitemap.xml" sitemap.xml
git add robots.txt sitemap.xml
if git diff --cached --quiet; then echo "no-op: כבר מוחל"; exit 0; fi
git commit -m "robots: disallow internal ops surfaces (agents/, archive/, mirror.json) + drop 404 from sitemap — R313 exposure hardening"
git fetch origin main
git rebase origin/main
git push origin main
echo "הוחל ונדחף. אימות: curl https://roshpinacare-sys.github.io/Domain/robots.txt"
