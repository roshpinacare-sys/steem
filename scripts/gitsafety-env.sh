#!/usr/bin/env bash
# R253 (agentcraft-גל-4): gitsafety-env — שכבה-רביעית-מתחת-ל-guard.
# השאלה-שהמפעיל-שאל-ב-R250 ("שיזהרו-שלא-יחסמו-את-החשבון") במבחן-המכונה: כל-process
# שסוכן-מריץ-מקבל-סביבת-git שבה **הטרנספורטים-נדחים-BY-CONSTRUCTION** — גם-אם-קוד-
# ספרייה-מנסה-ls-remote/fetch/push/clone מהרשת, git-עצמו-מסרב-לפני-שהחבילה-נוצרת.
# ה-guard (G1–G4) בודק-תוכן-יוצא; השכבה-הזאת מונעת-יציאה-בלתי-מורשית מבפנים.
#
# שימוש:
#   bash scripts/gitsafety-env.sh <command...>   # מריץ-את-הפקודה-עם-env-מוקשה (exec)
#   source scripts/gitsafety-env.sh              # מקשיח-את-ה-env-של-המעטפת-הנוכחית
set -u
gitsafety_env() {
  # 1) ניתוק-שרשראות-סביבה שמאפשרות-הפניה-של-git-למקום-אחר
  unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES 2>/dev/null || true
  # 2) אין-טרנספורטים: הרשימה-המותרת-היא-שם-שלא-קיים
  export GIT_ALLOW_PROTOCOL="agentcraft-none"
  export GIT_TERMINAL_PROMPT="0"
  # 3) חוזה-פרוטוקולים דרך-env-config (בלי-לכתוב-ל-.git/config — אפס-מוטציה-לריפו)
  export GIT_CONFIG_COUNT="4"
  export GIT_CONFIG_KEY_0="protocol.allow"        GIT_CONFIG_VALUE_0="never"
  export GIT_CONFIG_KEY_1="protocol.https.allow"  GIT_CONFIG_VALUE_1="never"
  export GIT_CONFIG_KEY_2="protocol.http.allow"   GIT_CONFIG_VALUE_2="never"
  export GIT_CONFIG_KEY_3="protocol.file.allow"   GIT_CONFIG_VALUE_3="user"
}
if [[ $# -gt 0 ]]; then
  gitsafety_env
  exec "$@"
else
  gitsafety_env
fi
