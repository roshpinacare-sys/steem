#!/usr/bin/env bash
# restore.sh — פקודת-שחזור אחת לכל סשן agent-9 חדש / אחרי אתחול-סנדבוקס [t17]
# שימוש: bash /home/z/my-project/restore.sh
#   1) drill שחזור (ועם --fix אם משהו חסר — משחזר תעודה/repos/worklog לבד)
#   2) מקים את ה-watchdog החיצוני אם הוא אינו חי
#   3) מדפיס פסק-דין כנה
set -u
TOOLS=/home/z/project-review/Autonomy/agents/agent-9/sandbox-tools
echo "=== restore.sh — ${1:-בדיקה} ==="

# אם הכלים חסרים (אין clone) — drill --fix יבנה הכל מה-origin
if [ ! -d "$TOOLS" ]; then
  echo "כלים חסרים — מריץ drill --fix (מאתחל .git-creds מ-pat.env + clone)"
  # drill --fix צריך קודם עותק-מינימלי של ה-drill עצמו מה-origin:
  mkdir -p "$TOOLS"
  CREDS=/home/z/.git-creds
  if [ ! -f "$CREDS" ] && [ -f /home/z/my-project/upload/pat.env ]; then
    printf 'https://roshpinacare-sys:%s@github.com\n' "$(tr -d '\n\r ' < /home/z/my-project/upload/pat.env)" > "$CREDS"
    chmod 600 "$CREDS"; echo ".git-creds שוחזר מ-pat.env"
  fi
  git -c "credential.helper=store --file=$CREDS" clone --depth 1 \
    https://github.com/roshpinacare-sys/Autonomy.git /home/z/project-review/Autonomy 2>/dev/null || true
fi

echo "--- drill ---"
node "$TOOLS/sandbox-restore.mjs" || node "$TOOLS/sandbox-restore.mjs" --fix

echo "--- watchdog ---"
if pgrep -f 'node watchdog.mjs' > /dev/null; then
  echo "watchdog ALIVE ($(pgrep -f 'node watchdog.mjs' | head -1))"
else
  (nohup node /home/z/my-project/tmp/watchdog.mjs > /home/z/my-project/tmp/watchdog.log 2>&1 &)
  sleep 3
  pgrep -f 'node watchdog.mjs' > /dev/null && echo "watchdog חומש עכשיו" || echo "watchdog FAILED TO START — הרץ ידנית"
fi

echo "--- פסק-דין ---"
node "$TOOLS/sandbox-restore.mjs" 2>&1 | tail -1
