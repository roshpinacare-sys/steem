// ─────────────────────────────────────────────────────────────────────
// FLEET-VERIFY — מפעל האימות המקומי · הריבונות מהמכסה (R109)
//
// שורש הבעיה (נמדד ב-R106): מכסת ה-Actions של הארגון מתה — הרץ
// הפרטי מעולם לא מתחיל (12/12 ריפואים פרטיים, steps=[]). תשעת
// סוכני-האימות של הרשת — השכבה שמוכיחה שהמכשירים באמת עובדים —
// דעכו בין 16-20/09 ולא רצו מאז.
//
// הפתרון הריבוני: אותן בדיקות בדיוק — רצות מקומית. כל מאמת משכפל
// את הריפו לספריית-עבודה (טרי בכל ריצה, נקי מטוקן), מריץ את מלוא
// שלבי-האימות כפי שהוגדרו ב-workflow המקורי, וכותב פסק-דין כן
// לקובץ-האמת. הסמכות (PAT) נקראת מהכספת המקומית ומוזרקת דרך
// GIT_ASKPASS — הטוקן לעולם לא נכתב לשום .git/config, לא
// מודפס ולא נשמר במצב. הענן הוא גיבוי; הבית הוא כאן.
//
// R118 — חוק דחיפת פסק-הדין: הבדיקה בלי הפרסום היא חצי אמת. מ-20/09
// הריפואים בגיט קפואים — המפעל אימת מקומית אבל אגר את האמת
// בקובץ מקומי בלבד, והמפעיל ראה "אין עדכונים" בענן. מכאן: כל
// פסק-דין שנכתב (PASS או FAIL כאחד) מוחזר לגיט בזהות
// <job>[bot] ובהודעה "<job>: <VERDICT> at <ISO>" — בדיוק החוק
// שהענן עצמו כתב כשה-Actions שלו חיו. כמו-כן נוסף המאמת העשירי:
// foundry-selftest ל-saos-sovereign-foundry (מרקובת עשרת
// הריפואים הרדומים).
//
// חוקי-ברזל:
//   · פסק-דין נכתב רק מקובץ agent/status.json שהבדיקה עצמה ייצרה
//   · כישלון נרשם ככישלון — אין "נניח שהצליח"
//   · בילד ייצור מקומי = skipped-local (מדיניות סנדבוקס כנה) —
//     שער-האיכות המקומי: התקנה + ג'נרוט + בדיקת-טיפוסים
//   · הטוקן מוסתר מכל פלט ([REDACTED]) ומכל מצב
//   · משימה אחת בכל פעם; פסק-זמן מלא; כתיבת-מצב אטומית (חוק R107b)
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

// זמן-ריצה של Bun ללא חבילת טיפוסים בפרויקט — הצהרה מקומית נקייה
declare const Bun: {
  spawnSync: (cmd: string[], opts?: { cwd?: string; env?: Record<string, string>; stdout?: string; stderr?: string }) => { exitCode: number | null; stdout?: Buffer | null; stderr?: Buffer | null };
  serve: (opts: { port: number; hostname?: string; fetch: (req: Request) => Promise<Response> | Response }) => unknown;
};

const HOME = "/home/z/my-project";
const PORT = 3038;
const STATE_DIR = `${HOME}/sovereign/fleet-verify`;
const STATE_FILE = `${STATE_DIR}/state.json`;
const WORK_ROOT = `${STATE_DIR}/work`;
const ASKPASS = `${STATE_DIR}/.git-askpass.sh`;
const ORG = "roshpinacare-sys";

// ── הסמכות: PAT מהכספת המקומית; נפילה לחילוץ מה-remote ───────────
// r140 תיקון-שורש: הנתיב הקודם היה /home/z/upload/pat.env — נתיב שאינו
// קיים בסנדבוקס הנוכחי (הקובץ בתוך my-project) — מה שהשאיר את
// patAvailable=false ואת מפעל-האימות שקט מ-27/09 בלי שום ריצה.
// מעתה: נגזר מהתיקייה-החיה + נפילה מסודרת לנתיבים ההיסטוריים.
const PAT_CANDIDATES = [
  path.join(HOME, "upload", "pat.env"), // הנתיב האמיתי בסנדבוקס
  path.resolve(process.cwd(), "..", "..", "upload", "pat.env"), // נגזר ממקום-הריצה (עמיד למיחזור-סנדבוקס)
  "/home/z/upload/pat.env", // הנתיב ההיסטורי (סביבות ישנות)
];
function readPat(): string | null {
  for (const p of PAT_CANDIDATES) {
    try {
      const t = fs.readFileSync(p, "utf8").trim();
      if (t.length > 20) return t;
    } catch {
      /* הנתיב הבא */
    }
  }
  try {
    const url = spawnSyncText("git", ["-C", HOME, "remote", "get-url", "origin"]);
    const m = url.match(/x-access-token:([^@]+)@/);
    if (m && m[1].length > 20) return m[1];
  } catch {
    /* אין סמכות — יירשם בכנות */
  }
  return null;
}

function spawnSyncText(cmd: string, args: string[]): string {
  const r = Bun.spawnSync([cmd, ...args], { cwd: HOME });
  return r.stdout?.toString() ?? "";
}

const PAT = readPat();

const HOME_ASKPASS = `${HOME}/.git-askpass.sh`;

// ה-askpass: הטוקן חי רק בזיכרון-הריצה ובקובץ chmod-700 חד-פעמי
function ensureAskpass(): void {
  if (!PAT) return;
  const script = `#!/bin/sh\necho '${PAT.replace(/'/g, "'\\''")}'\n`;
  if (!fs.existsSync(ASKPASS)) {
    fs.writeFileSync(ASKPASS, script, { mode: 0o700 });
  }
  fs.chmodSync(ASKPASS, 0o700);
  // r150 — ריפוי-עצמי של askpass-הבית: .git/config (credential.helper)
  // מצביע עליו, והסנדבוקס מוחק אותו בכל-מיחזור (r140 שורש-1 · חזר 02/10).
  // אם חסר או שבור — נולד מחדש מהסמכות-החיה (upload/pat.env) בכל-ריצה.
  try {
    let broken = false;
    try {
      const cur = fs.readFileSync(HOME_ASKPASS, "utf8");
      broken = cur.trim().length < 10;
    } catch {
      broken = true;
    }
    if (broken) fs.writeFileSync(HOME_ASKPASS, script, { mode: 0o700 });
    else fs.chmodSync(HOME_ASKPASS, 0o700);
  } catch {
    /* fail-soft — ל-ASKPASS שלנו יש עותק חי */
  }
}

function gitEnv(): Record<string, string> {
  return {
    ...process.env,
    GIT_ASKPASS: ASKPASS,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    // R123 — חוק ההמתנה-החסומה, גם לגיט: spawnSync חסום — חיבור GitHub
    // שנתלה (בלי RST/FIN) היה קופא את המפעל כולו (single-threaded). גיט
    // עצמו ינתק חיבור HTTP שלא זז מעל 1KB/s במשך 60ש' — כישלון נראה,
    // לא תלייה שקטה (אותו חוק שנחקק ב-R112 ל-fetch-ים של הדיבונים).
    GIT_HTTP_LOW_SPEED_LIMIT: "1000",
    GIT_HTTP_LOW_SPEED_TIME: "60",
  };
}

// ── מניפסט המאמתים — מה-YAML אל הבית ──────────────────────────────
// כל סקריפט כותב agent/status.json (אותה מוסכמה כמו הענן) —
// הרץ קורא אותו ורושם פסק-דין. האמת נולדת בבדיקה עצמה.

interface JobDef {
  id: string;
  repo: string;
  titleHe: string;
  layer: string;
  roleHe: string;
  timeoutMin: number;
  startOffsetMin: number; // ההיסט בסבב הראשון — שהמפעל לא ייחנק
  script: string;
}

const JOBS: JobDef[] = [
  {
    id: "jumpper-tests",
    repo: "saos-jummper",
    titleHe: "מבחני הנוטריון חוצה-השרשרות",
    layer: "QA",
    roleHe: "JUMPPER הוא נוטריון ההוכחות של הרשת: כל טענה דיגיטלית הופכת לרשומה ציבורית זולה לאימות. המאמת מריץ את מלוא מבחני היחידה, קומפילציה מלאה והדמו החי מול שרשרות ציבוריות.",
    timeoutMin: 12,
    startOffsetMin: 1,
    script: `set -u
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERDICT="FAIL"
REASON="unit tests failed"
if [ -f requirements.txt ]; then
  pip install --quiet -r requirements.txt 2>/dev/null || pip install --quiet requests 2>/dev/null || true
else
  pip install --quiet requests 2>/dev/null || true
fi
pip install --quiet -e . 2>/dev/null || true
export PYTHONPATH="$PWD/src\${PYTHONPATH:+:\$PYTHONPATH}"
UNIT_OUT="$(python3 -m unittest discover -s tests -v 2>&1 || true)"
echo "$UNIT_OUT" | tail -12
UNIT_OK=0
echo "$UNIT_OUT" | grep -q '^OK' && UNIT_OK=1
TESTS_RAN="$(echo "$UNIT_OUT" | grep -oE 'Ran [0-9]+ tests? in' | grep -oE '[0-9]+' | head -1 || echo 0)"
COMPILE_OK=1
python3 -m compileall -q src 2>/dev/null || COMPILE_OK=0
DEMO="skipped"; DEMO_NOTE="demo script not found"
if [ -f scripts/demo_end_to_end.py ]; then
  DEMO_NOTE=""
  if python3 scripts/demo_end_to_end.py > .fv-demo.log 2>&1; then DEMO="pass"; else DEMO="failed"; DEMO_NOTE="live witness read failed - see the run log"; fi
fi
if [ "$UNIT_OK" = "1" ] && [ "$COMPILE_OK" = "1" ]; then VERDICT="PASS"; REASON="unit tests pass, package compiles"
elif [ "$UNIT_OK" = "1" ]; then VERDICT="FAIL"; REASON="package compile failed"; fi
mkdir -p agent
cat > agent/status.json <<EOF
{
 "agent": "jumpper-tests",
 "generatedAt": "$NOW",
 "verdict": "$VERDICT",
 "checks": {
  "unitTestsRan": $TESTS_RAN,
  "unitTestsOk": $UNIT_OK,
  "packageCompiles": $COMPILE_OK,
  "liveWitnessDemo": "$DEMO"
 },
 "reason": "$REASON\${DEMO_NOTE:+ · \$DEMO_NOTE}"
}
EOF
echo "verdict: $VERDICT ($REASON)"
[ "$VERDICT" = "PASS" ] || exit 1`,
  },
  {
    id: "wallet-verify",
    repo: "Saosmartwallet",
    titleHe: "שעת האיכות של הארנק",
    layer: "QA",
    roleHe: "Saosmartwallet הוא הארנק של הרשת: 7 רשתות חיות, כספת מפתחות ריבונית ושכבת גשרים. המאמת מתקין מהנעילה הקפואה, מג'נרט לקוח Prisma ומריץ בדיקת טיפוסים מלאה.",
    timeoutMin: 20,
    startOffsetMin: 14,
    script: `set -u
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERDICT="FAIL"
REASON=""
if [ ! -f package.json ]; then echo "no package.json"; exit 1; fi
# חוק המטמון: התקנה רק כשהנעילה/המניפסט השתנו מאז ההתקנה המוכחת האחרונה
NEED_INSTALL=1
if [ -d node_modules ] && [ -f .fv-install.stamp ]; then
  NEWER="$(find package.json bun.lock -newer .fv-install.stamp 2>/dev/null | head -1)"
  [ -z "$NEWER" ] && NEED_INSTALL=0
fi
INSTALL="cached"
if [ "$NEED_INSTALL" = "1" ]; then
  INSTALL="fail"
  if [ -f bun.lock ]; then
    bun install --frozen-lockfile > .fv-install.log 2>&1 && INSTALL="pass" || { tail -8 .fv-install.log; }
  else
    bun install > .fv-install.log 2>&1 && INSTALL="pass" || { tail -8 .fv-install.log; }
  fi
  [ "$INSTALL" = "pass" ] && touch .fv-install.stamp
fi
if [ "$INSTALL" = "fail" ]; then REASON="dependency install failed"; fi
PRISMA="skipped"
if { [ "$INSTALL" = "pass" ] || [ "$INSTALL" = "cached" ]; } && [ -f prisma/schema.prisma ]; then
  bunx prisma generate > .fv-prisma.log 2>&1 && PRISMA="pass" || PRISMA="fail"
fi
TSC="skipped"
if { [ "$INSTALL" = "pass" ] || [ "$INSTALL" = "cached" ]; } && [ -f tsconfig.json ]; then
  bunx tsc --noEmit > .fv-tsc.log 2>&1 && TSC="pass" || { TSC="fail"; tail -12 .fv-tsc.log; }
fi
BUILD="skipped-local"
if { [ "$INSTALL" = "pass" ] || [ "$INSTALL" = "cached" ]; } && [ "$TSC" != "fail" ] && [ "$PRISMA" != "fail" ]; then
  VERDICT="PASS"; REASON="install+typecheck pass (local gate: build skipped by sandbox policy)"
else
  REASON="install=\$INSTALL prisma=\$PRISMA tsc=\$TSC"
fi
mkdir -p agent
cat > agent/status.json <<EOF
{
 "agent": "wallet-verify",
 "generatedAt": "$NOW",
 "verdict": "$VERDICT",
 "checks": {
  "install": "$INSTALL",
  "prismaGenerate": "$PRISMA",
  "typecheck": "$TSC",
  "productionBuild": "$BUILD"
 },
 "reason": "$REASON"
}
EOF
echo "verdict: $VERDICT ($REASON)"
[ "$VERDICT" = "PASS" ] || exit 1`,
  },
  {
    id: "sdk-verify",
    repo: "Sdk",
    titleHe: "שלמות תוכן ה-SDK",
    layer: "QA",
    roleHe: "מאמת שכבת ה-SDK: מסמכים ושידורים קיימים, לא ריקים, ומניפסט SHA-256 נבנה על כל התוכן — שינוי נמדד בריצה הבאה.",
    timeoutMin: 5,
    startOffsetMin: 40,
    script: `set -u
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERDICT="PASS"
REASON="sdk content intact"
DOCS=0; BCASTS=0; DOCS_FILES=0; BC_FILES=0; ROOT_MD=0
[ -d docs ] && DOCS=1
[ -d broadcasts ] && BCASTS=1
DOCS_FILES="$({ find docs -type f 2>/dev/null || true; } | wc -l | tr -d ' ')"
BC_FILES="$({ find broadcasts -type f 2>/dev/null || true; } | wc -l | tr -d ' ')"
ROOT_MD="$({ find . -maxdepth 1 -name '*.md' || true; } | wc -l | tr -d ' ')"
if [ "$DOCS" -eq 0 ] && [ "$BCASTS" -eq 0 ]; then VERDICT="FAIL"; REASON="both docs and broadcasts missing"; fi
if [ "$DOCS" -eq 1 ] && [ "$DOCS_FILES" -eq 0 ]; then VERDICT="FAIL"; REASON="docs directory is empty"; fi
if [ "$BCASTS" -eq 1 ] && [ "$BC_FILES" -eq 0 ]; then VERDICT="FAIL"; REASON="broadcasts directory is empty"; fi
mkdir -p agent
find docs broadcasts -type f 2>/dev/null | LC_ALL=C sort | xargs -r sha256sum > agent/manifest.sha256 2>/dev/null || true
TOTAL_FILES="$((DOCS_FILES + BC_FILES))"
TOTAL_BYTES="$({ find docs broadcasts -type f 2>/dev/null -exec stat -c %s {} + || true; } | awk '{s+=$1} END {print s+0}')"
cat > agent/status.json <<EOF
{
 "agent": "sdk-verify",
 "generatedAt": "$NOW",
 "verdict": "$VERDICT",
 "checks": {
  "docsDir": $DOCS,
  "docsFiles": $DOCS_FILES,
  "broadcastsDir": $BCASTS,
  "broadcastFiles": $BC_FILES,
  "rootDocs": $ROOT_MD,
  "totalFiles": $TOTAL_FILES,
  "totalBytes": $TOTAL_BYTES
 },
 "reason": "$REASON"
}
EOF
echo "verdict: $VERDICT ($REASON)"
[ "$VERDICT" = "PASS" ] || exit 1`,
  },
  {
    id: "claims-guard",
    repo: "Adsmarket",
    titleHe: "שומר הטענות של השיווק",
    layer: "ENFORCEMENT",
    roleHe: "בודק שעמודי הנחיתה סגורים כראוי, שאין גליפים אסורים (אימוג'י/חצים/דינגבטים), ושקישורי הרשת שלנו חיים — קישור מת שלנו הוא כשל, חיצוני מדווח בכנות.",
    timeoutMin: 10,
    startOffsetMin: 70,
    script: `set -u
mkdir -p agent
python3 - <<'PY'
import glob, json, re, urllib.request, ssl, datetime

FORBIDDEN = [(0x2013,0x2015),(0x2190,0x21FF),(0x2600,0x27BF),(0x2B00,0x2BFF),(0x1F000,0x1FAFF),(0xFE0F,0xFE0F)]
verdict = "PASS"
reason = "all checks passed"

pages = sorted(glob.glob('*.html') + glob.glob('onepager/*.html') + glob.glob('deck/*.html') + glob.glob('content/*.html'))
closed = sum(1 for p in pages if '</html>' not in open(p, encoding='utf-8', errors='replace').read())
if not pages:
    verdict = "FAIL"; reason = "no landing pages found"
elif closed:
    verdict = "FAIL"; reason = str(closed) + " pages missing closing html tag"

glyphs = 0
for p in pages + sorted(glob.glob('*.md')):
    try:
        text = open(p, encoding='utf-8', errors='replace').read()
    except Exception:
        continue
    for ch in text:
        cp = ord(ch)
        for a, b in FORBIDDEN:
            if a <= cp <= b:
                glyphs += 1
                break
if glyphs:
    verdict = "FAIL"; reason = str(glyphs) + " forbidden glyphs in marketing files"

urls = set()
pat = re.compile(r'https?://[^"\\'<> )]+')
for p in pages:
    for u in pat.findall(open(p, encoding='utf-8', errors='replace').read()):
        u = u.rstrip('.,;')
        if 'localhost' in u or '127.0.0.1' in u:
            continue
        urls.add(u)
urls = sorted(urls)[:25]
ctx = ssl.create_default_context()
ok_l = own_dead = ext_dead = 0
for u in urls:
    try:
        req = urllib.request.Request(u, headers={'User-Agent': 'claims-guard'})
        with urllib.request.urlopen(req, timeout=10, context=ctx) as r:
            code = r.status
    except Exception as e:
        code = getattr(e, 'code', 0)
    if code in (200, 301, 302, 307, 308):
        ok_l += 1
    elif 'roshpinacare' in u or 'github.io' in u:
        own_dead += 1
    else:
        ext_dead += 1
if own_dead:
    verdict = "FAIL"; reason = str(own_dead) + " own-network links are dead"
elif ext_dead:
    reason = str(ext_dead) + " external links dead (reported, not a failure)"

receipts = 0
rx = re.compile(r'(0x[a-fA-F0-9]{64}|txid)')
for p in pages + sorted(glob.glob('*.md')):
    try:
        receipts += len(rx.findall(open(p, encoding='utf-8', errors='replace').read()))
    except Exception:
        pass

status = {
    "agent": "claims-guard",
    "verdict": verdict,
    "checks": {
        "landingPages": len(pages),
        "pagesMissingCloseTag": closed,
        "forbiddenGlyphs": glyphs,
        "linksChecked": len(urls),
        "linksAlive": ok_l,
        "ownNetworkDeadLinks": own_dead,
        "externalDeadLinks": ext_dead,
        "receiptMentions": receipts
    },
    "reason": reason
}
status["generatedAt"] = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
with open('agent/status.json', 'w', encoding='utf-8') as f:
    json.dump(status, f, indent=1, ensure_ascii=False)
print('verdict:', verdict, '|', reason)
PY
V=$?
if [ $V -ne 0 ]; then echo "python failed"; exit 1; fi
grep -q '"verdict": "PASS"' agent/status.json || exit 1`,
  },
  {
    id: "controls-audit",
    repo: "roshpina",
    titleHe: "מבקר הבקרות של רושפינה",
    layer: "ENFORCEMENT",
    roleHe: "הריפו מתעד אילו בקרות באמת קיימות ואת תדריך הסוכן. המאמת מוודה שהמסמכים קיימים, לא ריקים, שכל בקרה בסעיף משלה — וסופר את ארכיון השידורים.",
    timeoutMin: 6,
    startOffsetMin: 100,
    script: `set -u
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERDICT="PASS"
REASON="controls documented"
CONTROLS_EXIST=0; CONTROLS_BYTES=0; CONTROL_SECTIONS=0
if [ -f CONTROLS-THAT-EXIST.md ]; then
  CONTROLS_EXIST=1
  CONTROLS_BYTES="$(stat -c %s CONTROLS-THAT-EXIST.md)"
  CONTROL_SECTIONS="$(grep -c '^## ' CONTROLS-THAT-EXIST.md || true)"
fi
if [ "$CONTROLS_EXIST" -eq 0 ]; then VERDICT="FAIL"; REASON="CONTROLS-THAT-EXIST.md missing"; fi
if [ "$CONTROLS_EXIST" -eq 1 ] && [ "$CONTROLS_BYTES" -lt 500 ]; then VERDICT="FAIL"; REASON="controls document too small"; fi
BRIEFING=0; PATCHSPEC=0
[ -f AGENT-BRIEFING.md ] && BRIEFING=1
[ -f PATCH-SPEC-P10.md ] && PATCHSPEC=1
if [ "$BRIEFING" -eq 0 ]; then VERDICT="FAIL"; REASON="AGENT-BRIEFING.md missing"; fi
BC_FILES="$({ find broadcasts -type f 2>/dev/null || true; } | wc -l | tr -d ' ')"
BC_BAD="$(find broadcasts -type f 2>/dev/null | grep -v -E '/[0-9]{4}-[0-9]{2}-[0-9]{2}-' | grep -c . || true)"
mkdir -p agent
cat > agent/status.json <<EOF
{
 "agent": "controls-audit",
 "generatedAt": "$NOW",
 "verdict": "$VERDICT",
 "checks": {
  "controlsDocumentExists": $CONTROLS_EXIST,
  "controlsDocumentBytes": $CONTROLS_BYTES,
  "controlSections": $CONTROL_SECTIONS,
  "agentBriefingExists": $BRIEFING,
  "patchSpecExists": $PATCHSPEC,
  "broadcastFiles": $BC_FILES,
  "broadcastsBadNaming": $BC_BAD
 },
 "reason": "$REASON"
}
EOF
echo "verdict: $VERDICT ($REASON)"
[ "$VERDICT" = "PASS" ] || exit 1`,
  },
  {
    id: "control-center-build",
    repo: "saos-control-center",
    titleHe: "שער הבנייה של מרכז הבקרה",
    layer: "QA",
    roleHe: "מרכז הבקרה של הרשת: המאמת מתקין מהנעילה הקפואה, מג'נרט לקוח Prisma ומריץ בדיקת טיפוסים מלאה — השער לפני שכל שינוי רואה עולם.",
    timeoutMin: 18,
    startOffsetMin: 130,
    script: `set -u
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERDICT="FAIL"
REASON=""
if [ ! -f package.json ]; then echo "no package.json"; exit 1; fi
# חוק המטמון: התקנה רק כשהנעילה/המניפסט השתנו מאז ההתקנה המוכחת האחרונה
NEED_INSTALL=1
if [ -d node_modules ] && [ -f .fv-install.stamp ]; then
  NEWER="$(find package.json bun.lock -newer .fv-install.stamp 2>/dev/null | head -1)"
  [ -z "$NEWER" ] && NEED_INSTALL=0
fi
INSTALL="cached"
if [ "$NEED_INSTALL" = "1" ]; then
  INSTALL="fail"
  if [ -f bun.lock ]; then
    bun install --frozen-lockfile > .fv-install.log 2>&1 && INSTALL="pass" || { tail -8 .fv-install.log; }
  else
    bun install > .fv-install.log 2>&1 && INSTALL="pass" || { tail -8 .fv-install.log; }
  fi
  [ "$INSTALL" = "pass" ] && touch .fv-install.stamp
fi
if [ "$INSTALL" = "fail" ]; then REASON="dependency install failed"; fi
PRISMA="skipped"
if { [ "$INSTALL" = "pass" ] || [ "$INSTALL" = "cached" ]; } && [ -f prisma/schema.prisma ]; then
  bunx prisma generate > .fv-prisma.log 2>&1 && PRISMA="pass" || PRISMA="fail"
fi
TSC="skipped"
if { [ "$INSTALL" = "pass" ] || [ "$INSTALL" = "cached" ]; } && [ -f tsconfig.json ]; then
  bunx tsc --noEmit > .fv-tsc.log 2>&1 && TSC="pass" || { TSC="fail"; tail -12 .fv-tsc.log; }
fi
BUILD="skipped-local"
if { [ "$INSTALL" = "pass" ] || [ "$INSTALL" = "cached" ]; } && [ "$TSC" != "fail" ] && [ "$PRISMA" != "fail" ]; then
  VERDICT="PASS"; REASON="install+typecheck pass (local gate: build skipped by sandbox policy)"
else
  REASON="install=\$INSTALL prisma=\$PRISMA tsc=\$TSC"
fi
mkdir -p agent
cat > agent/status.json <<EOF
{
 "agent": "control-center-build",
 "generatedAt": "$NOW",
 "verdict": "$VERDICT",
 "checks": {
  "install": "$INSTALL",
  "prismaGenerate": "$PRISMA",
  "typecheck": "$TSC",
  "productionBuild": "$BUILD"
 },
 "reason": "$REASON"
}
EOF
echo "verdict: $VERDICT ($REASON)"
[ "$VERDICT" = "PASS" ] || exit 1`,
  },
  {
    id: "platform-selftest",
    repo: "saos-sovereign-platform",
    titleHe: "בחינה-עצמית של מנוע הקצה",
    layer: "QA",
    roleHe: "מנוע ההשקיה של הפלטפורמה הריבונית: המאמת מריץ את ה-selftest המלא, טוען את שכבת הכללים הקפואה ומריץ קומפילציה של רץ-הרקע.",
    timeoutMin: 10,
    startOffsetMin: 160,
    script: `set -u
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERDICT="FAIL"
REASON="selftest failed"
ST_EXIT=1; ST_PASS=0; ST_TOTAL=0
if [ -f python/irrigation_engine.py ]; then
  if python3 python/irrigation_engine.py selftest > .fv-selftest.log 2>&1; then ST_EXIT=0; fi
  tail -10 .fv-selftest.log
  ST_PASS="$(grep -oE '[0-9]+/[0-9]+' .fv-selftest.log | tail -1 | cut -d/ -f1 || echo 0)"
  ST_TOTAL="$(grep -oE '[0-9]+/[0-9]+' .fv-selftest.log | tail -1 | cut -d/ -f2 || echo 0)"
else
  REASON="irrigation_engine.py not found"
fi
RULES="skipped"
if [ -f python/irrigation_engine.py ]; then
  if python3 python/irrigation_engine.py rules > .fv-rules.log 2>&1; then RULES="pass"; else RULES="fail"; fi
  tail -6 .fv-rules.log
fi
RUNNER="skipped"
if [ -f python/edge_runner.py ]; then
  if python3 -m py_compile python/edge_runner.py 2>/dev/null; then RUNNER="compiles"; else RUNNER="compile-failed"; fi
fi
if [ "$ST_EXIT" = "0" ] && [ "$RULES" = "pass" ]; then
  VERDICT="PASS"; REASON="selftest \${ST_PASS}/\${ST_TOTAL}, rule layer loads"
elif [ "$ST_EXIT" = "0" ]; then
  VERDICT="FAIL"; REASON="selftest passed but rule layer failed to load"
fi
mkdir -p agent
cat > agent/status.json <<EOF
{
 "agent": "platform-selftest",
 "generatedAt": "$NOW",
 "verdict": "$VERDICT",
 "checks": {
  "selftestPassed": $ST_PASS,
  "selftestTotal": $ST_TOTAL,
  "selftestExitOk": $ST_EXIT,
  "ruleLayerLoad": "$RULES",
  "edgeRunnerCompile": "$RUNNER"
 },
 "reason": "$REASON"
}
EOF
echo "verdict: $VERDICT ($REASON)"
[ "$VERDICT" = "PASS" ] || exit 1`,
  },
  {
    id: "archive-keeper",
    repo: "Project-files",
    titleHe: "שומר הארכיונים",
    layer: "RECOVERY",
    roleHe: "כל ארכיון חייב להיפתח נקי: המאמת פותח-מבחן כל קובץ zip, בונה מניפסט SHA-256 ומדווח בכנות על כל ארכיון פגום.",
    timeoutMin: 15,
    startOffsetMin: 190,
    script: `set -u
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERDICT="PASS"
REASON="all archives open cleanly"
find . -name '*.zip' -not -path './.git/*' -print0 | while IFS= read -r -d '' z; do
  if unzip -tq "$z" > /dev/null 2>&1; then echo "OK $z"; else echo "CORRUPT $z"; fi
done > .fv-zipcheck.log
cat .fv-zipcheck.log | tail -15
TOTAL="$(grep -c . .fv-zipcheck.log || true)"
OKZ="$(grep -c '^OK ' .fv-zipcheck.log || true)"
CORRUPT="$(grep -c '^CORRUPT ' .fv-zipcheck.log || true)"
BYTES="$({ find . -name '*.zip' -not -path './.git/*' -exec stat -c %s {} + || true; } | awk '{s+=$1} END {print s+0}')"
ROOT_MD="$({ find . -maxdepth 1 -name '*.md' || true; } | wc -l | tr -d ' ')"
if [ "\${CORRUPT:-0}" -gt 0 ]; then VERDICT="FAIL"; REASON="$CORRUPT archives failed the open test"; fi
mkdir -p agent
find . -name '*.zip' -not -path './.git/*' -print0 | xargs -0 sha256sum > agent/archives.sha256 2>/dev/null || true
cat > agent/status.json <<EOF
{
 "agent": "archive-keeper",
 "generatedAt": "$NOW",
 "verdict": "$VERDICT",
 "checks": {
  "archivesTotal": \${TOTAL:-0},
  "archivesIntact": \${OKZ:-0},
  "archivesCorrupt": \${CORRUPT:-0},
  "archivesBytes": $BYTES,
  "rootDocuments": $ROOT_MD
 },
 "reason": "$REASON"
}
EOF
echo "verdict: $VERDICT ($REASON)"
[ "$VERDICT" = "PASS" ] || exit 1`,
  },
  {
    id: "baseline-integrity",
    repo: "anchor-baseline",
    titleHe: "שלמות קו-הבסיס",
    layer: "WITNESS",
    roleHe: "ההיסטוריה לא נמחקת לעולם: המאמת בונה מניפסט SHA-256 של כל תוכן ההיסטוריה, משווה לריצה הקודמת ופוסל אם קובץ הוסר. מוסכמת שמות השידורים נבדקת.",
    timeoutMin: 8,
    startOffsetMin: 220,
    script: `set -u
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERDICT="PASS"
REASON="baseline intact"
find broadcasts docs download -type f 2>/dev/null | LC_ALL=C sort | xargs -r sha256sum > .fv-manifest.new || true
FILES="$(wc -l < .fv-manifest.new | tr -d ' ')"
BYTES="$({ find broadcasts docs download -type f 2>/dev/null -exec stat -c %s {} + || true; } | awk '{s+=$1} END {print s+0}')"
ADDED=0; REMOVED=0; CHANGED=0
if [ -f agent/manifest.sha256 ]; then
  sort agent/manifest.sha256 > .fv-old.sorted
  sort .fv-manifest.new > .fv-new.sorted
  cut -d' ' -f3- .fv-old.sorted > .fv-old.paths
  cut -d' ' -f3- .fv-new.sorted > .fv-new.paths
  REMOVED="$(comm -23 .fv-old.paths .fv-new.paths | grep -c . || true)"
  ADDED="$(comm -13 .fv-old.paths .fv-new.paths | grep -c . || true)"
  CHANGED="$(comm -3 .fv-old.sorted .fv-new.sorted | grep -c . || true)"
fi
if [ "\${REMOVED:-0}" -gt 0 ]; then VERDICT="FAIL"; REASON="$REMOVED history files removed"; fi
BADNAME="$(find broadcasts -type f 2>/dev/null | grep -v -E '/[0-9]{4}-[0-9]{2}-[0-9]{2}-' | grep -c . || true)"
mkdir -p agent
cp .fv-manifest.new agent/manifest.sha256
cat > agent/status.json <<EOF
{
 "agent": "baseline-integrity",
 "generatedAt": "$NOW",
 "verdict": "$VERDICT",
 "checks": {
  "files": \${FILES:-0},
  "bytes": $BYTES,
  "added": $ADDED,
  "removed": $REMOVED,
  "changed": $CHANGED,
  "badNaming": \${BADNAME:-0}
 },
 "reason": "$REASON"
}
EOF
echo "verdict: $VERDICT ($REASON)"
[ "$VERDICT" = "PASS" ] || exit 1`,
  },
  {
    id: "foundry-selftest",
    repo: "saos-sovereign-foundry",
    titleHe: "בחינה-עצמית של בית-היציקה",
    layer: "QA",
    roleHe: "saos-sovereign-foundry הוא בית-היציקה של הרשת — הריפו שממנו נולדו הכלים והעדויות. מ-R109 עד R118 עמד מחוץ לכיסוי המפעל (המאמת העשירי). המאמת מתקין מהנעילה הקפואה, מג'נרט לקוח Prisma ומריץ בדיקת טיפוסים מלאה.",
    timeoutMin: 18,
    startOffsetMin: 250,
    script: `set -u
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERDICT="FAIL"
REASON=""
if [ ! -f package.json ]; then echo "no package.json"; exit 1; fi
# חוק המטמון: התקנה רק כשהנעילה/המניפסט השתנו מאז ההתקנה המוכחת האחרונה
NEED_INSTALL=1
if [ -d node_modules ] && [ -f .fv-install.stamp ]; then
  NEWER="$(find package.json bun.lock -newer .fv-install.stamp 2>/dev/null | head -1)"
  [ -z "$NEWER" ] && NEED_INSTALL=0
fi
INSTALL="cached"
if [ "$NEED_INSTALL" = "1" ]; then
  INSTALL="fail"
  if [ -f bun.lock ]; then
    bun install --frozen-lockfile > .fv-install.log 2>&1 && INSTALL="pass" || { tail -8 .fv-install.log; }
  else
    bun install > .fv-install.log 2>&1 && INSTALL="pass" || { tail -8 .fv-install.log; }
  fi
  [ "$INSTALL" = "pass" ] && touch .fv-install.stamp
fi
if [ "$INSTALL" = "fail" ]; then REASON="dependency install failed"; fi
PRISMA="skipped"
if { [ "$INSTALL" = "pass" ] || [ "$INSTALL" = "cached" ]; } && [ -f prisma/schema.prisma ]; then
  bunx prisma generate > .fv-prisma.log 2>&1 && PRISMA="pass" || PRISMA="fail"
fi
TSC="skipped"
if { [ "$INSTALL" = "pass" ] || [ "$INSTALL" = "cached" ]; } && [ -f tsconfig.json ]; then
  bunx tsc --noEmit > .fv-tsc.log 2>&1 && TSC="pass" || { TSC="fail"; tail -12 .fv-tsc.log; }
fi
BUILD="skipped-local"
if { [ "$INSTALL" = "pass" ] || [ "$INSTALL" = "cached" ]; } && [ "$TSC" != "fail" ] && [ "$PRISMA" != "fail" ]; then
  VERDICT="PASS"; REASON="install+typecheck pass (local gate: build skipped by sandbox policy)"
else
  REASON="install=\$INSTALL prisma=\$PRISMA tsc=\$TSC"
fi
mkdir -p agent
cat > agent/status.json <<EOF
{
 "agent": "foundry-selftest",
 "generatedAt": "$NOW",
 "verdict": "$VERDICT",
 "checks": {
  "install": "$INSTALL",
  "prismaGenerate": "$PRISMA",
  "typecheck": "$TSC",
  "productionBuild": "$BUILD"
 },
 "reason": "$REASON"
}
EOF
echo "verdict: $VERDICT ($REASON)"
[ "$VERDICT" = "PASS" ] || exit 1`,
  },
];

// ── המצב ────────────────────────────────────────────────────────────
interface JobState {
  id: string;
  repo: string;
  titleHe: string;
  layer: string;
  roleHe: string;
  verdict: "PENDING" | "RUNNING" | "PASS" | "FAIL" | "ERROR" | "TIMEOUT";
  lastRunAt: string | null;
  durationMs: number | null;
  checks: Record<string, unknown> | null;
  reason: string | null;
  outputTail: string[];
  nextDueAt: string;
  commit: string | null;
  runs: number;
  // R118 — חוק דחיפת פסק-הדין: האמת חוזרת לגיט. null = טרם נדחף
  push: { at: string; commit: string | null; verdict: string; detail: string } | null;
}

interface FleetState {
  service: string;
  version: string;
  bootedAt: string;
  beats: number;
  patAvailable: boolean;
  current: { id: string; startedAt: string } | null;
  jobs: JobState[];
  lastDecision: { at: string; kind: string; detail: string } | null;
  history: { at: string; id: string; verdict: string; detail: string }[];
  // r174 — היגיינת-דיסק: תיעוד-הסוויפ האחרון של ספריות-העבודה
  lastWorkSweep?: { at: string; pruned: number; freedBytes: number };
}

function boot(): FleetState {
  let prev: Partial<FleetState> = {};
  try {
    prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    /* מפעל חדש */
  }
  const now = new Date();
  const prevJobs = new Map((prev.jobs ?? []).map((j) => [j.id, j]));
  const jobs: JobState[] = JOBS.map((def) => {
    const old = prevJobs.get(def.id);
    // המשכיות פסקי-דין עבר + סדר-יום חדש למי שלא רץ מעולם
    const fresh = !old?.lastRunAt;
    return {
      id: def.id,
      repo: def.repo,
      titleHe: def.titleHe,
      layer: def.layer,
      roleHe: def.roleHe,
      verdict: old?.verdict === "RUNNING" ? "PENDING" : (old?.verdict ?? "PENDING"),
      lastRunAt: old?.lastRunAt ?? null,
      durationMs: old?.durationMs ?? null,
      checks: old?.checks ?? null,
      reason: old?.reason ?? null,
      outputTail: old?.outputTail ?? [],
      nextDueAt: fresh
        ? new Date(now.getTime() + def.startOffsetMin * 60_000).toISOString()
        : (old?.nextDueAt ?? new Date(now.getTime() + def.startOffsetMin * 60_000).toISOString()),
      commit: old?.commit ?? null,
      runs: old?.runs ?? 0,
      push: old?.push ?? null,
    };
  });
  return {
    service: "fleet-verify",
    version: "2.0.0",
    bootedAt: now.toISOString(),
    beats: 0,
    patAvailable: Boolean(PAT),
    current: null,
    jobs,
    lastDecision: prev.lastDecision ?? null,
    history: Array.isArray(prev.history) ? prev.history.slice(-60) : [],
  };
}

// המצב — סינגלטון globalThis ששורד טעינות-חמות + ריפוי-מזוג:
// כשהמודול מוערך מחדש, תוצאות חדשות מהקובץ (אם נכתבו) מתמזגות
// פנימה — הריצה החדשה מנצחת לפי lastRunAt. כך שום אמת לא אובדת.
const G = globalThis as {
  __FV_STATE__?: FleetState;
  __FV_TIMER__?: ReturnType<typeof setInterval>;
  __FV_SERVER__?: unknown;
  // R110 — פעימת-החיים של הטיימר: טיימר שקיים אך לא פועם הוא מת.
  // עריכת-קוד חיה (bun --hot) הקפיאה את הטיימר הישן ב-03:54 והשאירה
  // זומבי — HTTP עונה, פעימות קפואות. השעון נמדד לפי פעימות, לא קיום.
  __FV_HEARTBEAT__?: number;
  // r143-c — מתג-איש-המת (טיימר-יחיד, כמו __FV_TIMER__)
  __FV_DEADMAN__?: ReturnType<typeof setInterval>;
  // r174 — שער-הסוויפ האחרון (היגיינת-דיסק)
  __FV_LAST_SWEEP__?: number;
};
if (G.__FV_STATE__) {
  try {
    const file = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Partial<FleetState>;
    const fileJobs = new Map((file.jobs ?? []).map((j) => [j.id, j]));
    for (const mem of G.__FV_STATE__.jobs) {
      const f = fileJobs.get(mem.id);
      if (!f || !f.lastRunAt) continue;
      if (!mem.lastRunAt || Date.parse(f.lastRunAt) > Date.parse(mem.lastRunAt)) {
        if (mem.verdict !== "RUNNING") Object.assign(mem, f);
      }
    }
  } catch {
    /* אין קובץ — הזיכרון הוא האמת */
  }
} else {
  G.__FV_STATE__ = boot();
}
const state: FleetState = G.__FV_STATE__;

// R118 — חוק הכיסוי המלא: המניפסט (JOBS) הוא ההגדרה, המצב עוקב אחריו.
// נלמד חי ב-R118: טעינה-חמה של bun משאירה את המצב הישן ב-globalThis —
// מאמת עשירי חדש שהתווסף לקוד לעולם לא ייכנס לסבב הריצות, והריפו
// שלו יישאר רדום לנצח. התאמה: מוסיפים מאמתים חדשים כ-PENDING,
// משמרים אמת קיימת, ומנקים מאמתים שהוסרו מהמניפסט.
{
  const byId = new Map(state.jobs.map((j) => [j.id, j]));
  const nowMs = Date.now();
  state.jobs = JOBS.map((def) => {
    const old = byId.get(def.id);
    if (old) return old;
    return {
      id: def.id,
      repo: def.repo,
      titleHe: def.titleHe,
      layer: def.layer,
      roleHe: def.roleHe,
      verdict: "PENDING" as const,
      lastRunAt: null,
      durationMs: null,
      checks: null,
      reason: null,
      outputTail: [],
      nextDueAt: new Date(nowMs + def.startOffsetMin * 60_000).toISOString(),
      commit: null,
      runs: 0,
      push: null,
    };
  });
}

function saveState(): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  // R123 — תקרת-זיכרון כנה: history נחתך גם בזמן-ריצה (boot() חותך רק
  // בעלייה קרה; הסינגלטון ב-globalThis שורד טעינות-חמות — בלי חיתוך,
  // דחיות-זיכרון של מאמתים כבדים היו ממלאות אותו לנצח).
  state.history = state.history.slice(-60);
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

// ── סניטציה: הטוקן לעולם לא נכנס למצב ──────────────────────────────
function sanitize(text: string): string {
  if (!PAT) return text;
  return text.split(PAT).join("[REDACTED]");
}

// ── ספריית-העבודה: טרי בכל ריצה, נקי מטוקן ──────────────────────────
function ensureWorkdir(repo: string): { ok: boolean; commit: string | null; detail: string } {
  const dir = path.join(WORK_ROOT, repo);
  fs.mkdirSync(WORK_ROOT, { recursive: true });
  const url = `https://github.com/${ORG}/${repo}.git`;
  if (!fs.existsSync(path.join(dir, ".git"))) {
    const r = Bun.spawnSync(["git", "clone", "--depth", "1", "--single-branch", "--branch", "main", url, dir], {
      env: gitEnv(),
    });
    if (r.exitCode !== 0) {
      return { ok: false, commit: null, detail: `clone failed: ${sanitize((r.stderr?.toString() ?? "") + (r.stdout?.toString() ?? "")).slice(0, 300)}` };
    }
  } else {
    // רענון: fetch + reset — הבדיקה תמיד על ה-HEAD החי
    const f = Bun.spawnSync(["git", "fetch", "--depth", "1", "origin", "main"], { cwd: dir, env: gitEnv() });
    if (f.exitCode !== 0) {
      return { ok: false, commit: null, detail: `fetch failed: ${sanitize((f.stderr?.toString() ?? "")).slice(0, 300)}` };
    }
    Bun.spawnSync(["git", "reset", "--hard", "origin/main"], { cwd: dir });
    // חוק הזיכרון (נלמד מ-OOM חי): node_modules וחותמות-ההתקנה שורדים את
    // הניקוי — התקנה מחדש רק כשהנעילה באמת השתנתה. הליברה הרגה תהליכים
    // כשהמפעל התקין 55MB של תלויות בכל ריצה בכבדות.
    Bun.spawnSync(["git", "clean", "-fd", "-e", "node_modules", "-e", ".fv-*"], { cwd: dir });
  }
  const c = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: dir });
  const commit = c.stdout?.toString().trim() ?? null;
  return { ok: true, commit, detail: `workdir fresh @ ${commit}` };
}

// ── שומר הזיכרון (נלמד משני הריגי-OOM חיים) ────────────────────────
// הקופסה קטנה (4GB). next-dev לבדו ~1.8GB. כשמאמת מריץ tsc/prisma על
// ריפו כבד — הליברה הורגת את הגדול ביותר: את שרת-הייצור שלנו. החוק:
// לפני צעד כבד, נמדד זיכרון-פנוי. אין מספיק — המאמת נדחה בכנות
// ("deferred: low memory") וייסה למועד מאוחר יותר. חיי המערכת קודמים
// לריצת-אימות בודדת.
function availableMemMb(): number {
  try {
    const mi = fs.readFileSync("/proc/meminfo", "utf8");
    const m = mi.match(/MemAvailable:\s+(\d+) kB/);
    return m ? Math.round(Number(m[1]) / 1024) : 0;
  } catch {
    return 4096;
  }
}

const HEAVY_JOBS = new Set(["wallet-verify", "control-center-build", "platform-selftest", "foundry-selftest"]);
const MIN_AVAILABLE_MB = 900;

// ── חוק דחיפת פסק-הדין (R118) ─────────────────────────────────────
// האמת שלא חוזרת לגיט היא אמת שקטה: הריפו קפוא, המפעיל רואה "אין
// עדכונים" — אף על פי שהאימות רץ ועבר. החוק: אחרי כל פסק-דין
// (PASS או FAIL כאחד — הכישלון מפורסם באותה מידה), המפעל מחזיר
// את agent/status.json לגיט בזהות <job>[bot] ובהודעה שהענן עצמו
// כתב כשה-Actions שלו חיו: "<job>: <VERDICT> at <ISO>".
// הטוקן עובר רק דרך GIT_ASKPASS — מנוקה מכל פלט ומכל מצב.
function pushVerdict(
  def: JobDef,
  dir: string,
  verdict: string,
): { at: string; commit: string | null; verdict: string; detail: string } {
  const at = new Date().toISOString();
  const statusFile = path.join(dir, "agent", "status.json");
  if (!fs.existsSync(statusFile)) {
    return { at, commit: null, verdict: "NONE", detail: "לא נכתב קובץ-פסק-דין — אין מה לדחוף" };
  }
  const g = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: dir, env: gitEnv() });
  g(["config", "user.name", `${def.id}[bot]`]);
  g(["config", "user.email", `${def.id}[bot]@users.noreply.github.com`]);
  g(["add", "agent/status.json"]);
  // בלי שינוי מדיד — אין קומיט (אותו חוק של הענן המקורי)
  const staged = Bun.spawnSync(["git", "diff", "--cached", "--quiet", "--", "agent/status.json"], { cwd: dir, env: gitEnv() });
  if (staged.exitCode === 0) {
    const c = g(["rev-parse", "--short", "HEAD"]);
    return { at, commit: c.stdout?.toString().trim() ?? null, verdict: "UNCHANGED", detail: "פסק-דין זהה לקודם — אין קומיט" };
  }
  const stamp = at.replace(/\.\d+Z$/, "Z");
  const cm = g(["commit", "-m", `${def.id}: ${verdict} at ${stamp}`]);
  if (cm.exitCode !== 0) {
    return { at, commit: null, verdict, detail: `קומיט נכשל: ${sanitize(((cm.stderr?.toString() ?? "") + (cm.stdout?.toString() ?? "")).trim()).slice(0, 180)}` };
  }
  const pu = g(["push", "origin", "main"]);
  const sh = g(["rev-parse", "--short", "HEAD"]);
  const newCommit = sh.stdout?.toString().trim() ?? null;
  if (pu.exitCode === 0) {
    return { at, commit: newCommit, verdict, detail: `נדחף לגיט · ${def.repo}@${newCommit}` };
  }
  return {
    at,
    commit: null,
    verdict,
    detail: `דחיפה נכשלה: ${sanitize(((pu.stderr?.toString() ?? "") + (pu.stdout?.toString() ?? "")).trim()).slice(0, 200)}`,
  };
}

// ── הרצת מאמת ──────────────────────────────────────────────────────
async function runJob(def: JobDef): Promise<void> {
  const job = state.jobs.find((j) => j.id === def.id);
  if (!job) return;
  if (!PAT) {
    state.lastDecision = { at: new Date().toISOString(), kind: "WAIT", detail: "אין סמכות (PAT) — המפעל ממתין בכנות" };
    saveState();
    return;
  }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  ensureAskpass();

  // שומר הזיכרון: מאמת כבד בקופסה צפופה = הרג שרת-ייצור. דחייה כנה עד
  // שיהיה אוויר לנשום — המאמת ינסה שוב בעוד שעה.
  if (HEAVY_JOBS.has(def.id) && availableMemMb() < MIN_AVAILABLE_MB) {
    const avail = availableMemMb();
    job.nextDueAt = new Date(Date.now() + 3_600_000).toISOString();
    state.lastDecision = {
      at: new Date().toISOString(),
      kind: "DEFER",
      detail: `${def.id}: נדחה בכנות — זיכרון פנוי ${avail}MB מתחת לקו ${MIN_AVAILABLE_MB}MB · ניסיון חוזר בעוד שעה`,
    };
    state.history.push({
      at: new Date().toISOString(),
      id: def.id,
      verdict: "DEFER",
      detail: `low memory ${avail}MB`,
    });
    saveState();
    return;
  }

  const startedAt = new Date().toISOString();
  job.verdict = "RUNNING";
  state.current = { id: def.id, startedAt };
  state.lastDecision = { at: startedAt, kind: "RUN", detail: `${def.id} יוצא לדרך — ${def.repo}@main` };
  saveState();

  const t0 = Date.now();
  const dir = path.join(WORK_ROOT, def.repo);

  // 1) ספריית-עבודה
  const wd = ensureWorkdir(def.repo);
  if (!wd.ok) {
    job.verdict = "ERROR";
    job.reason = wd.detail;
    job.outputTail = [wd.detail];
    job.lastRunAt = startedAt;
    job.durationMs = Date.now() - t0;
    job.runs += 1;
    job.nextDueAt = new Date(Date.now() + 24 * 3_600_000).toISOString();
    state.current = null;
    state.history.push({ at: startedAt, id: def.id, verdict: "ERROR", detail: wd.detail.slice(0, 120) });
    state.lastDecision = { at: new Date().toISOString(), kind: "ERROR", detail: `${def.id}: ${wd.detail.slice(0, 100)}` };
    saveState();
    return;
  }
  job.commit = wd.commit;

  // 3) חוק פסק-הדין הטרי: קובץ-פסק-דין קודם נמחק לפני הריצה — הרץ קורא
  //    אך ורק קובץ שהבדיקה הזאת עצמה ייצרה. בלי זה, status.json ענני
  //    מת (מהקלון) יכול להתחזות לפסק-דין של ריצה שנכשלה (נתפס חי
  //    ב-claims-guard: סתירת "PASS" עתיק מול exit 1).
  try {
    fs.rmSync(path.join(dir, "agent", "status.json"), { force: true });
  } catch {
    /* אין קובץ — אין מה למחוק */
  }

  // 4) הבדיקה עצמה — bash עם פסק-זמן מלא
  const scriptPath = path.join(WORK_ROOT, `run-${def.id}.sh`);
  fs.writeFileSync(scriptPath, def.script, { mode: 0o700 });

  let exitCode = -1;
  let stdout = "";
  let stderr = "";
  try {
    const proc = spawn("bash", [scriptPath], {
      cwd: dir,
      env: { ...process.env, FLEET_VERIFY: "1", CI: "1", HOME: process.env.HOME ?? "/home/z" },
    });
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* כבר מת */
      }
    }, def.timeoutMin * 60_000);
    stdout = await new Promise<string>((res) => {
      let s = "";
      proc.stdout.on("data", (d) => (s += d.toString()));
      proc.stdout.on("end", () => res(s));
      proc.on("close", () => res(s));
    });
    stderr = await new Promise<string>((res) => {
      let s = "";
      proc.stderr.on("data", (d) => (s += d.toString()));
      proc.stderr.on("end", () => res(s));
      proc.on("close", () => res(s));
    });
    exitCode = await new Promise<number>((res) => {
      proc.on("close", (c) => res(c ?? -1));
    });
    clearTimeout(timer);
  } catch (e) {
    stderr += String(e);
  }

  const durationMs = Date.now() - t0;
  const output = sanitize(`${stdout}\n${stderr}`).trim();
  const tail = output.split("\n").filter(Boolean).slice(-14);

  // 5) פסק-הדין — נקרא רק מקובץ האמת שהבדיקה עצמה ייצרה (והוא טרי — נמחק לפני הריצה)
  let checks: Record<string, unknown> | null = null;
  let reason: string | null = null;
  let verdict: JobState["verdict"] = "ERROR";
  try {
    const st = JSON.parse(fs.readFileSync(path.join(dir, "agent", "status.json"), "utf8"));
    checks = st.checks ?? null;
    reason = typeof st.reason === "string" ? sanitize(st.reason) : null;
    if (st.verdict === "PASS" && exitCode === 0) verdict = "PASS";
    else if (st.verdict === "FAIL" || exitCode !== 0) verdict = "FAIL";
    else verdict = "ERROR";
  } catch {
    // חוק-הברזל: פסק-דין נכתב רק מ-status.json שהבדיקה עצמה ייצרה.
    // בלי הקובץ אין PASS — exit 0 בלי קבלה אינו הוכחה (הריצה לא
    // השאירה אמת מדידה; זו שגיאת בדיקה, לא הצלחה).
    verdict = "ERROR";
    reason = reason ?? `status.json לא נכתב — אין פסק-דין בלי קבלה (קוד-יציאה ${exitCode} נרשם לתצפית בלבד)`;
  }

  // 6) חוק דחיפת פסק-הדין (R118): האמת חוזרת לגיט. הבדיקה עברה —
  //    שהענן ידע. נכשלה — שהענן ידע גם כן. בלי השלב הזה הריפו קופא
  //    והמפעיל רואה "אין עדכונים" על ריפו שנבדק בכל יום.
  let push: JobState["push"] = null;
  if (verdict === "PASS" || verdict === "FAIL") {
    try {
      push = pushVerdict(def, dir, verdict);
    } catch (e) {
      push = { at: new Date().toISOString(), commit: null, verdict, detail: `חריגה בדחיפה: ${sanitize(String(e)).slice(0, 180)}` };
    }
  }
  job.push = push;

  job.verdict = verdict;
  job.lastRunAt = startedAt;
  job.durationMs = durationMs;
  job.checks = checks;
  job.reason = reason;
  job.outputTail = tail;
  job.runs += 1;
  job.nextDueAt = new Date(Date.now() + 24 * 3_600_000).toISOString();
  state.current = null;
  state.history.push({
    at: startedAt,
    id: def.id,
    verdict,
    detail: `${durationMs}ms · ${(reason ?? "").slice(0, 100)}${push ? ` · גיט: ${push.verdict === "PASS" || push.verdict === "FAIL" ? "נדחף" : push.verdict}` : ""}`,
  });
  state.lastDecision = {
    at: new Date().toISOString(),
    kind: verdict,
    detail: `${def.id}: ${verdict} · ${Math.round(durationMs / 1000)}ש' · ${(reason ?? "").slice(0, 120)}${push ? ` · ${push.detail.slice(0, 120)}` : ""}`,
  };
  saveState();
}

// ── מנוע הלולאה ────────────────────────────────────────────────────
let running = false;

// r174 — היגיינת-דיסק: ספריות-העבודה הן קלוני-אימות זמניים בלבד
// (ensureWorkdir עושה reclone אוטומטי על היעדר). נמדד ב-r173: 2.5G אשפה
// נצברה בלי-היגיינה והדיסק הגיע ל-95%. TTL + תקרה — בלי-לגעת בזרימה.
const WORK_TTL_MS = 6 * 60 * 60 * 1000; // ספרייה לא-נגעת 6 שעות → נמחקת
const WORK_MAX_TOTAL_BYTES = 3 * 1024 * 1024 * 1024; // תקרת-רוחב: 3GB
const WORK_SWEEP_INTERVAL_MS = 30 * 60 * 1000; // סוויפ כל 30 דק'

function workDirSize(dir: string): number {
  let total = 0;
  try {
    const entries = fs.readdirSync(dir, { recursive: true });
    for (const e of entries) {
      try {
        const st = fs.statSync(path.join(dir, String(e)));
        if (st.isFile()) total += st.size;
      } catch { /* נעלם בין-השורות — ממשיכים */ }
    }
  } catch { /* ספרייה נעלמה */ }
  return total;
}

// סוויפ-היגיינה: מוחק ספריות-עבודה ישנות (TTL) ואז לפי תקרה (הזקנים קודם).
// בטוח תמיד: רץ רק כשאין-עבודה בשידור (running=false), וקלון חסר = reclone אוטומטי.
function sweepWork(): { pruned: number; freedBytes: number } {
  G.__FV_LAST_SWEEP__ = Date.now();
  if (running || !fs.existsSync(WORK_ROOT)) return { pruned: 0, freedBytes: 0 };
  let names: string[] = [];
  try { names = fs.readdirSync(WORK_ROOT); } catch { return { pruned: 0, freedBytes: 0 }; }
  const now = Date.now();
  const cands: { dir: string; mtime: number; size: number }[] = [];
  for (const n of names) {
    const dir = path.join(WORK_ROOT, n);
    try {
      const st = fs.statSync(dir);
      if (!st.isDirectory()) continue; // קבצי run-*.sh — לא-נוגעים
      cands.push({ dir, mtime: st.mtimeMs, size: workDirSize(dir) });
    } catch { /* נעלם — ממשיכים */ }
  }
  let pruned = 0;
  let freedBytes = 0;
  const tryRm = (dir: string, size: number) => {
    try { fs.rmSync(dir, { recursive: true, force: true }); pruned += 1; freedBytes += size; } catch { /* תפוס — יינסה בסוויפ הבא */ }
  };
  // 1. TTL — מעבר לגיל
  for (const c of cands) if (now - c.mtime > WORK_TTL_MS) tryRm(c.dir, c.size);
  // 2. תקרה — הזקנים קודם, רק אם עדיין מעל הסף
  let live = cands.filter((c) => fs.existsSync(c.dir)).reduce((a, c) => a + c.size, 0);
  if (live > WORK_MAX_TOTAL_BYTES) {
    for (const c of [...cands].sort((a, b) => a.mtime - b.mtime)) {
      if (live <= WORK_MAX_TOTAL_BYTES) break;
      if (!fs.existsSync(c.dir)) continue;
      tryRm(c.dir, c.size);
      live -= c.size;
    }
  }
  if (pruned > 0) {
    state.lastWorkSweep = { at: new Date().toISOString(), pruned, freedBytes };
    saveState();
  }
  return { pruned, freedBytes };
}
// r143-c — חותמת-הפעימה האחרונה — מזינה את מתג-איש-המת בסוף-הקובץ
let lastFvBeatAt = Date.now();
async function tick(): Promise<void> {
  // פעימת-חיים תחילה — גם אם הריצה תיכשל, השעון הזה התקדם (חוק R110)
  G.__FV_HEARTBEAT__ = Date.now();
  state.beats += 1;
  lastFvBeatAt = Date.now(); // r143-c — הוכחת-החיים נמדדת כאן (מתקדמת בכל 60ש' גם בזמן-ריצות)
  if (running) return;
  // r174 — סוויפ-היגיינה על-גבי הפעימה הקיימת (בלי-טיימר נוסף)
  if (Date.now() - (G.__FV_LAST_SWEEP__ ?? 0) > WORK_SWEEP_INTERVAL_MS) sweepWork();
  if (!PAT) {
    state.lastDecision = { at: new Date().toISOString(), kind: "WAIT", detail: "אין סמכות (PAT) — המפעל ממתין בכנות" };
    saveState();
    return;
  }
  ensureAskpass();
  const due = state.jobs.find((j) => Date.parse(j.nextDueAt) <= Date.now() && j.verdict !== "RUNNING");
  if (!due) return;
  const def = JOBS.find((d) => d.id === due.id);
  if (!def) return;
  running = true;
  try {
    await runJob(def);
  } finally {
    running = false;
    saveState();
    sweepWork(); // r174 — אחרי כל עבודה: הזרימה רגועה, האשפה נשאפת מיד
  }
}

// ── HTTP — סינגלטון: שרת אחד לאורך כל החיים, גם בטעינות-חמות ─────
if (!G.__FV_SERVER__) {
  G.__FV_SERVER__ = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1", // R123 — המפעל נצרך מ-localhost בלבד; /run/* מריץ בדיקות ודוחף לגיט — לא נחשף לרשת החוץ
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      // חוק פעימת-החיים (R110): השרת-החי הוא המשקה של הטיימר.
      // השומר שואל כאן כל 30ש' — אם הטיימר קפא, השאלה עצמה מחייה אותו.
      ensureTimer();
      return Response.json({ ok: true, service: "fleet-verify", alive: true, beats: state.beats });
    }
    if (req.method === "POST" && url.pathname.startsWith("/run/")) {
      const id = url.pathname.slice("/run/".length);
      const def = JOBS.find((d) => d.id === id);
      if (!def) return Response.json({ ok: false, error: "מאמת לא קיים" }, { status: 404 });
      if (running) return Response.json({ ok: false, error: "מאמת אחר בדרך — המפעל עובד בטור" }, { status: 429 });
      running = true;
      runJob(def)
        .catch(() => {})
        .finally(() => {
          running = false;
          saveState();
          sweepWork(); // r174 — גם דחיפה-ידנית מנקה (סימטריה ללולאה)
        });
      return Response.json({ ok: true, started: id });
    }
    if (req.method === "POST" && url.pathname === "/run-next") {
      const due = state.jobs.find((j) => Date.parse(j.nextDueAt) <= Date.now() && j.verdict !== "RUNNING");
      if (!due) return Response.json({ ok: false, error: "אין מאמת שנכון לו עכשיו" }, { status: 409 });
      const def = JOBS.find((d) => d.id === due.id)!;
      if (running) return Response.json({ ok: false, error: "המפעל עובד" }, { status: 429 });
      running = true;
      runJob(def)
        .catch(() => {})
        .finally(() => {
          running = false;
          saveState();
          sweepWork(); // r174 — גם run-next מנקה (סימטריה ללולאה)
        });
      return Response.json({ ok: true, started: def.id });
    }
    // ברירת מחדל: מצב-האמת המלא (ok=true — חוק הצי: השומר דורש זאת בכל דיבון)
    return Response.json({ ok: true, ...state });
  },
  });
}

console.log(`[fleet-verify] מפעל האימות המקומי עלה · פורט ${PORT} · ${JOBS.length} מאמתים · PAT: ${PAT ? "כן" : "לא"} · R118: פסק-דין חוזר לגיט`);

// חוק הטיימר-היחיד (נלמד חי: טעינה-חמה של bun מעריכה את המודול מחדש
// אך לא מנקה טיימרים ישנים — שני טיימרים עם שני מצבים כתבו זה על זה
// ומחקו תוצאות אמיתיות מקובץ-האמת). globalThis שורד טעינות-חמות:
// טיימר אחד, מצב אחד, אמת אחת.
//
// R110 — הרחבה נלמדת-חי: השומר-מקורי (if !G.__FV_TIMER__) היה עיוור
// לטיימר מת: אחרי עריכת-קוד חיה הטיימר הישן קפא, המודול החדש ראה
// "טיימר קיים" ולא הקים חדש — זומבי מלא. החוק החדש: טיימר נמדד לפי
// פעימת-החיים שלו. קפוא מעל 3 מחזורים — מוחלף. השרת-החי (שעונה ל-HTTP)
// הוא המשקה: כל בקשת /health בודקת את השעון ומחייה אם צריך —
// המצב הזומבי עצמו (HTTP חי, טיימר מת) הופך לטריגר ההחייאה.
const HEARTBEAT_STALE_MS = 3 * 60_000; // 3 מחזורי-טיימר בלי פעימה = מת

function ensureTimer(): void {
  const last = G.__FV_HEARTBEAT__ ?? 0;
  const live = G.__FV_TIMER__ && Date.now() - last < HEARTBEAT_STALE_MS;
  if (live) return; // טיימר חי — אחד בלבד, אין כפילוּת
  if (G.__FV_TIMER__) {
    // טיימר זומבי קיים אך אינו פועם — מוחלף (חוק פעימת-החיים)
    try { clearInterval(G.__FV_TIMER__); } catch {}
    G.__FV_TIMER__ = undefined;
    state.lastDecision = {
      at: new Date().toISOString(),
      kind: "TIMER-REVIVED",
      detail: "טיימר קפוא הוחלף לפי חוק פעימת-החיים (R110) — השעון חוזר לפעום",
    };
    saveState();
  }
  G.__FV_TIMER__ = setInterval(() => {
    tick().catch((e) => {
      state.lastDecision = { at: new Date().toISOString(), kind: "ERROR", detail: sanitize(String(e)).slice(0, 200) };
      saveState();
    });
  }, 60_000);
  // פעימה ראשונה מיד — ופעימת-חיים ראשונה נרשמת בתוכה
  tick().catch(() => {});
}

ensureTimer();

// ── r143-c · מתג-איש-מת ─────────────────────────────────────
// זומבי חי שנמדד (keeper, r143): HTTP עונה בזמן שהפעימות קפואות.
// למפעל יש כבר חוק פעימת-חיים (R110 — טיימר קפוא מוחלף כששואלים /health)
// — זהו ההיגיון-הפנימי. מתג-איש-המת הוא ההגנה-בעומק שאינה תלויה במישהו
// ששואל: כל 60ש' נמדדת התקדמות-הלולאה; שתיקה מעל 10 דק' (10 מחזורי-טיימר
// — הרבה מעל 3 המחזורים של R110) ⇒ שורה כנה ביומן ויציאה (exit 1) —
// fleet-guard יקים תהליך-טרי. הפעימה מתקדמת בכל 60ש' גם בזמן ריצות-מאמת
// ארוכות (עד 20 דק' — async, לא חוסמת את הלופ), כך שריצה ארוכה אחת
// לעולם לא הורגת מפעל בריא.
const DEAD_MAN_TICK_MS = 60_000;
const DEAD_MAN_STALL_MS = 10 * 60_000;
const DEAD_MAN_LOG = `${HOME}/sovereign/keeper/logs/fleet-verify-daemon.log`;
const G_DM = globalThis as unknown as { __FV_DEADMAN__?: ReturnType<typeof setInterval> };
if (G_DM.__FV_DEADMAN__) clearInterval(G_DM.__FV_DEADMAN__);
G_DM.__FV_DEADMAN__ = setInterval(() => {
  if (Date.now() - lastFvBeatAt <= DEAD_MAN_STALL_MS) return;
  const msg = "dead-man: beats stalled >10min — exiting for revival";
  try {
    fs.mkdirSync(`${HOME}/sovereign/keeper/logs`, { recursive: true });
    fs.appendFileSync(DEAD_MAN_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
  console.log(msg);
  clearInterval(G_DM.__FV_DEADMAN__);
  process.exit(1);
}, DEAD_MAN_TICK_MS);
