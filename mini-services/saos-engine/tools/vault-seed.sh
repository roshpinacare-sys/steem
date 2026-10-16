#!/usr/bin/env bash
# ============================================================================
# vault-seed.sh — נתיב-החייאה-הריבונית לאישור-החתימה (גל-90 · trace 1a1462462fc85fc1)
# ============================================================================
# נמדד (גל-90): קציר-קור-של-הסנדבוקס מוחק סודות-gitignored (".secrets/n not
# found — sandbox cold-reset wipes gitignored secrets") → SIGNING-DEAD → המנוע
# מסרב-לכל-פעולת-שרשרת (fail-closed-חוקי). עד-היום-זה היה פער-מבני שדרש
# העלאה-ידנית של המפעיל.
#
# הפתרון: סיסמת-האב חיה בכספת-האטומה (vault-home/intake/headcorner-master.txt.enc
# · AES-256-CBC · PBKDF2-200k · אותו-סיסמה-כמו keys.env.enc) ואת סיסמת-הפתיחה
# שומר auto-unseal.sh ב-.session-pass (0600) אחרי-פתיחה-מוצלחת דרך שכבות-האמון.
# הסקריפט הזה מזריע את המועמד ל-upload/headcorner.txt (0600) — והמנוע עצמו
# (T-12/T-78) מאמת אותו מול-השרשרת לפני-אימוץ, גונב אותו ל-.secrets (0600)
# ומוחק את עותק-ה-upload. אפס-סודות-על-stdout · אפס-סודות-בעץ-Git.
#
# חוק-כנות: אם אין session-pass או שהפתיחה נכשלת — יוצאים 1 בלי-לכתוב-כלום
# (fail-closed). המנוע נשאר SIGNING-DEAD כנה עד-שהמפעיל יעלה ידנית.
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STEEM="$(cd "$HERE/../.." && pwd)/.."                      # /home/z/estate/steem
STEEM="$(cd "$STEEM" && pwd)"
UPLOAD_KEY="$STEEM/upload/headcorner.txt"
SECRETS_DIR="$STEEM/.secrets"
KEY_FILE="$SECRETS_DIR/headcorner.key"
VAULT="/home/z/estate/vault-home"
ENC="$VAULT/intake/headcorner-master.txt.enc"
SESSION="$VAULT/.session-pass"

# כבר-חי? שום-דבר-לעשות (no-op)
[ -s "$KEY_FILE" ] && exit 0
[ -s "$UPLOAD_KEY" ] && exit 0

# חייבים חומר-אטום + סיסמת-פתיחה מקומית (מ-auto-unseal)
[ -s "$ENC" ] || { echo "[vault-seed] no sealed master in vault — fail-closed"; exit 1; }
[ -s "$SESSION" ] || { echo "[vault-seed] no .session-pass (run auto-unseal.sh first) — fail-closed"; exit 1; }

TMP="$(mktemp)"
chmod 600 "$TMP"
SESSIONX="$(cat "$SESSION")" || { rm -f "$TMP"; exit 1; }
if ! SESSIONX="$SESSIONX" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
     -in "$ENC" -out "$TMP" -pass env:SESSIONX 2>/dev/null; then
  rm -f "$TMP"
  echo "[vault-seed] decrypt failed — fail-closed (no key written)"
  exit 1
fi

# נרמול-צורה: "<account> <master|P-key>" — המנוע דורש שני-טוקנים
python3 - "$TMP" "$UPLOAD_KEY" << 'PYEOF'
import sys
raw = open(sys.argv[1]).read().strip()
if not raw:
    sys.exit(3)
toks = raw.split()
line = raw if toks[0] == "headcorner" else "headcorner " + raw
open(sys.argv[2], "w").write(line + "\n")
PYEOF
RC=$?
rm -f "$TMP"
if [ "$RC" != "0" ]; then echo "[vault-seed] empty/plainform failure — fail-closed"; exit 1; fi
chmod 600 "$UPLOAD_KEY"
mkdir -p "$SECRETS_DIR"; chmod 700 "$SECRETS_DIR"
echo "[vault-seed] seeded candidate at upload/headcorner.txt (0600) — engine will judge it against the chain and self-adopt (T-12)"
exit 0
