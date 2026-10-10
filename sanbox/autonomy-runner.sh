#!/usr/bin/env bash
# sanbox/autonomy-runner.sh — רץ-המשימות הריבוני (מבצע את תור autonomy/tasks.json)
# חוק: אין-מפעיל · אל-כשל · כנות (תוצאה-אמיתית בלבד, אף-המצאה)
# שימוש: autonomy-runner.sh start|stop|status|run-once|daemon
# רישום: sanbox/state/autonomy-runtime.json (אמת-חיה, git-ignored) · autonomy/state.json (בסיס)
set -uo pipefail
SB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SB/.." && pwd)"
cd "$ROOT"
INTERVAL="${SANBOX_AUTONOMY_INTERVAL:-900}"
PIDF="$SB/state/autonomy-runner.pid"
LOG="$SB/state/autonomy-runner.log"
LOCK="$SB/state/autonomy-runner.lock"
RUNTIME="$SB/state/autonomy-runtime.json"
BASE="$SB/autonomy/state.json"
TASKS="$SB/autonomy/tasks.json"
mkdir -p "$SB/state"
now() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
day() { date -u +"%Y-%m-%d"; }
log() { printf '[%s] %s\n' "$(now)" "$*" >> "$LOG"; }
running() { [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF" 2>/dev/null)" 2>/dev/null; }

case "${1:-status}" in
  start)
    if running; then echo "autonomy-runner: כבר-רץ (pid $(cat "$PIDF"))"; exit 0; fi
    nohup bash "$0" daemon >> "$LOG" 2>&1 &
    echo $! > "$PIDF"
    sleep 1
    if running; then echo "autonomy-runner: התחיל (pid $(cat "$PIDF"), כל ${INTERVAL}ש)"; exit 0; else echo "autonomy-runner: נכשל-העלאה — ראה $LOG"; exit 1; fi
    ;;
  stop)
    if running; then kill "$(cat "$PIDF")" 2>/dev/null; rm -f "$PIDF"; fi
    # R303 · ORPHAN-TICK LAW (measured 04:40→05:50 blackout: the daemon was
    # stopped but its in-flight _tick survived as an orphan STILL HOLDING the
    # flock — every future tick silently skipped (flock -n) and the autonomy
    # queue died with zero alerts for over an hour). A tick never outlives
    # its daemon: stop reaps running ticks so the lock dies with them.
    pkill -f "autonomy-runner.sh _tick" 2>/dev/null || true
    echo "autonomy-runner: נעצר"
    ;;
  status)
    if running; then echo "autonomy-runner: רץ (pid $(cat "$PIDF"))"; exit 0; else echo "autonomy-runner: לא-רץ"; exit 1; fi
    ;;
  run-once) exec bash "$0" _tick ;;
  daemon)
    SESSION=$(now)
    echo "$SESSION" > "$SB/state/autonomy-session.id"
    # R303 · BOUNDED-TICK LAW: a tick is bounded at 14min (+30s SIGKILL grace).
    # Measured disease: one hung task (mirror push to a blocked IP) froze the
    # tick holding the flock; with `flock -n || exit 0` every later tick
    # silently skipped — the queue died with zero alerts. Now a hang can only
    # cost one cycle: the lock dies with the timed-out tick and the loop
    # ALWAYS continues, with the bounded-exit recorded honestly in the log.
    while true; do
      timeout --kill-after=30 840 bash "$0" _tick >>"$LOG" 2>&1 \
        || log "tick: bounded-exit rc=$? (hang or error — loop continues)"
      sleep "$INTERVAL"
    done
    ;;
  _tick)
    (
      flock -n 9 || exit 0
      log "tick: מתחיל"  # R303 observability: a tick-start with no tick-done = a hung tick (provable from the log)
      # מגן-מיזוג: במהלך-מיזוג בלתי-פתור — לא מריצים-כלום (עצור-ותעד)
      if [ -f .git/MERGE_HEAD ]; then log "guard: מיזוג בעיצומו — tick נמנע"; exit 0; fi
      # מגן-קונפליקט: סימנים ב-sanbox — לא מריצים
      if rg -q '^(<{7} |={7}$|>{7} )' "$SB" 2>/dev/null; then log "guard: סימני-קונפליקט ב-sanbox — tick נמנע"; exit 0; fi

      SESSION=$(cat "$SB/state/autonomy-session.id" 2>/dev/null || echo "adhoc-$(now)")
      VERIFY_FAIL=0

      run_task() { # $1=id $2=cmd $3=expect
        local id="$1" cmd="$2" expect="$3" t0 t1 rc out
        t0=$(date +%s)
        out=$(bash -c "$cmd" 2>&1); rc=$?
        t1=$(date +%s)
        MS=$(( (t1 - t0) * 1000 ))
        local ok="false"
        case "$expect" in
          "exit 0") [ "$rc" -eq 0 ] && ok="true" ;;
          "FAIL=0") [ "$rc" -eq 0 ] && ok="true" ;;
          "pid alive") [ "$rc" -eq 0 ] && ok="true" ;;
          *) [ "$rc" -eq 0 ] && ok="true" ;;
        esac
        [ "$ok" = "false" ] && log "task $id: FAIL (exit=$rc) — $cmd"
        jq -n --arg id "$id" --arg at "$(now)" --argjson rc "$rc" --argjson ok "$ok" --argjson ms "$MS" --arg exp "$expect" --argjson base "$(cat "$RUNTIME" 2>/dev/null || echo '{}')" \
          '$base * {($id): {at:$at, exit:$rc, ok:$ok, ms:$ms, expect:$exp}}' \
          > "$RUNTIME.tmp" 2>/dev/null && mv "$RUNTIME.tmp" "$RUNTIME" || \
          printf '{"%s":{"at":"%s","exit":%s,"ok":%s,"ms":%s,"expect":"%s"}}\n' "$id" "$(now)" "$rc" "$ok" "$MS" "$expect" > "$RUNTIME"
        echo "$rc"
      }

      ensure_runtime() {
        [ -f "$RUNTIME" ] || printf '{}' > "$RUNTIME"
        jq -e . "$RUNTIME" >/dev/null 2>&1 || printf '{}' > "$RUNTIME"
      }
      ensure_runtime

      get() { jq -r "$1" "$RUNTIME" 2>/dev/null; }

      # ── SB-1 · אימות-ריבונות (per-session + חוק-ניסיון-חוזר R300-c:
      # כישלון-טרנזיטורי (מיזוג-בעיצומו / עוגן-טרם-נחסם) לא ננעל-עד-הפעלה-מחדש —
      # נמדד-חי 03:39Z: SB1 נכשל פעם-אחת בזמן-ריקון והסשן נעל אותו ל-נצח.
      # מריצים שוב בכל-tick עד-ירוק) ──
      SB1_LAST_SESSION=$(get '.SB1.session // ""')
      SB1_LAST_OK=$(get '.SB1.ok // false')
      if [ "$SB1_LAST_SESSION" != "$SESSION" ] || [ "$SB1_LAST_OK" != "true" ]; then
        RC=$(run_task SB1 "bash sanbox/verify.sh all" "exit 0")
        jq --arg s "$SESSION" '.SB1.session = $s' "$RUNTIME" > "$RUNTIME.tmp" && mv "$RUNTIME.tmp" "$RUNTIME"
        [ "$RC" != "0" ] && VERIFY_FAIL=1
      fi

      # ── SB-2 · הבטחת לולאת-התמדה (ensure-running — idempotent) ──
      run_task SB2 "bash sanbox/commit-loop.sh start" "pid alive" >/dev/null

      # ── SB-4 · סריקת-סודות (יומי) ──
      SB4_LAST_DAY=$(get '.SB4.day // ""')
      if [ "$SB4_LAST_DAY" != "$(day)" ]; then
        RC=$(run_task SB4 "bash sanbox/verify.sh secrets" "FAIL=0")
        jq --arg d "$(day)" '.SB4.day = $d' "$RUNTIME" > "$RUNTIME.tmp" && mv "$RUNTIME.tmp" "$RUNTIME"
      fi

      # ── SB-5 · אימות-עוגן-שרשרת (יומי) ──
      SB5_LAST_DAY=$(get '.SB5.day // ""')
      if [ "$SB5_LAST_DAY" != "$(day)" ]; then
        RC=$(run_task SB5 "bash sanbox/verify.sh chain" "FAIL=0")
        jq --arg d "$(day)" '.SB5.day = $d' "$RUNTIME" > "$RUNTIME.tmp" && mv "$RUNTIME.tmp" "$RUNTIME"
      fi

      # ── SB-6 · מראת-הנמל-השני (יומי · R302) ──
      # ריבונות-ששוקעת-בנמל-אחד אינה-ריבונות: המראה ל-GitLab מבטיחה שכל-קומיט
      # שרד-גם-מעבר-ל-GitHub (חסימה/צנזורה/השתתות). האסימון-מהכספת-החתומה
      # (toolbelt-revival, בתוך-הסקריפט), אפס-סוד-ב-argv/config/לוגים,
      # fail-honest — כישלון-נרשם-וחוזר-מחר (ולא-מזויף-כהצלחה).
      SB6_LAST_DAY=$(get '.SB6.day // ""')
      if [ "$SB6_LAST_DAY" != "$(day)" ]; then
        RC=$(run_task SB6 "bash scripts/sovereign-mirror.sh" "MIRRORED")
        jq --arg d "$(day)" '.SB6.day = $d' "$RUNTIME" > "$RUNTIME.tmp" && mv "$RUNTIME.tmp" "$RUNTIME"
      fi

      # ── SB-3 · חייאה (on-failure — רק כשאימות נכשל) ──
      if [ "$VERIFY_FAIL" = "1" ]; then
        log "SB3: verify נכשל — מריץ bootstrap (חייאה-עצמית)"
        run_task SB3 "bash sanbox/bootstrap.sh" "exit 0" >/dev/null
      fi

      # ── עדכון-בסיס: autonomy/state.json (lastVerify/lastBootstrap כשהשתנו) ──
      LASTV=$(get '.SB1.at // ""')
      if [ -n "$LASTV" ] && [ "$(jq -r '.lastVerify // ""' "$BASE" 2>/dev/null)" != "$LASTV" ]; then
        jq --arg v "$LASTV" --arg at "$(now)" '.lastVerify = $v | .updatedAt = $at' "$BASE" > "$BASE.tmp" && mv "$BASE.tmp" "$BASE"
        log "baseline: autonomy/state.json ← lastVerify=$LASTV"
      fi
      LASTB=$(get '.SB3.at // ""')
      if [ -n "$LASTB" ] && [ "$(jq -r '.lastBootstrap // ""' "$BASE" 2>/dev/null)" != "$LASTB" ]; then
        jq --arg b "$LASTB" --arg at "$(now)" '.lastBootstrap = $b | .updatedAt = $at' "$BASE" > "$BASE.tmp" && mv "$BASE.tmp" "$BASE"
        log "baseline: autonomy/state.json ← lastBootstrap=$LASTB"
      fi

      jq --arg at "$(now)" '.lastTick = $at' "$RUNTIME" > "$RUNTIME.tmp" && mv "$RUNTIME.tmp" "$RUNTIME"
      log "tick: הושלם"
    ) 9>"$LOCK"
    ;;
  *)
    echo "שימוש: $0 start|stop|status|run-once|daemon"
    exit 2
    ;;
esac
