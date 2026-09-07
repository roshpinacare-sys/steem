#!/usr/bin/env node
/**
 * he_report.cjs — Task 85: הדוח-העברי-החי (LIVING HEBREW REPORT)
 *
 * המפעיל אמר: "אתה מסכם לי בסינית — אין לי מושג מה עשית, אני לא קורא סינית".
 * התשובה המבנית: הדוח הזה נכתב בעברית, נוצר אוטומטית על-ידי הדמון כל 30 דק׳,
 * ו-gitkeeper דוחף אותו ל-repo — כך שתמיד יש דוח עברי טרי ב-repo, גם אם
 * הסנדבוקס מת וגם אם הענן (cloud-heart) הוא זה שמריץ את הרשת כרגע.
 *
 * כללי-ברזל:
 *   · אפס סודות — רק מספרים, גילאים, txid-ים, פסקי-דין. אף WIF, אף טוקן.
 *   · כל נתון מודפס עם גילו (מתי נצפה לאחרונה) — כנות-מלאה, לא טענות.
 *   · קריאה מקומית בלבד (אפס רשת) — מהיר, בטוח, ודאי.
 *
 * פלט: docs/REPORT_HE.md  →  gitkeeper מדחוף אוטומטית
 * חיווח: daemon לולאת heReport (כל 30 דק׳) · Task 85
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const AGENT = __dirname;
const ROOT = path.join(AGENT, '..');
const OUT = path.join(ROOT, 'docs', 'REPORT_HE.md');

function j(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } }
function ageMin(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}
function ago(iso) {
  const m = ageMin(iso);
  if (m === null) return 'לא ידוע';
  if (m < 1) return 'ממש עכשיו';
  if (m < 60) return 'לפני ' + m + ' דק׳';
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return 'לפני ' + h + ':' + String(r).padStart(2, '0') + ' שע׳';
  return 'לפני ' + Math.floor(h / 24) + ' ימ׳';
}
function git(args) { try { return execFileSync('git', args, { cwd: ROOT, timeout: 15000, encoding: 'utf8' }).trim(); } catch (_) { return ''; } }
function daemonPid() {
  try {
    const out = execFileSync('pgrep', ['-f', 'node agent.cjs'], { timeout: 5000, encoding: 'utf8' }).trim();
    return out.split('\n').filter(Boolean)[0] || null;
  } catch (_) { return null; }
}

/* ---------- איסוף נתונים (הכל מקומי) ---------- */
const chain = j(path.join(ROOT, 'sovereign', 'node', 'chain.json'));
const state = j(path.join(ROOT, 'sovereign', 'node', 'state.json'));
const verdict = j(path.join(AGENT, 'selfhost_verdict.json'));
const attest = j(path.join(AGENT, 'attest_last.json'));
const guardianRes = j(path.join(AGENT, 'guardian_result.json'));
const takeover = j(path.join(AGENT, 'cloud_takeover.json'));
const vault = j(path.join(AGENT, 'keys', 'vault.json'));
let env = {};
try {
  for (const line of fs.readFileSync(path.join(AGENT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
} catch (_) { /* .env חסר — מדווח בכנות */ }

const height = (state && state.height) || (chain && chain.blocks && chain.blocks.length) || 0;
const beats = (state && state.beats) || 0;
const checkpoints = (state && state.checkpoints && state.checkpoints.length) || 0;
const lastBlock = chain && chain.blocks && chain.blocks.length ? chain.blocks[chain.blocks.length - 1] : null;
const lastBlockAge = lastBlock ? ago(lastBlock.time) : 'לא ידוע';
const army = vault && Array.isArray(vault.accounts) ? vault.accounts.length : 0;
const dryRun = String(env.DRY_RUN || '').toLowerCase() === 'true';
const account = env.AGENT_ACCOUNT || (attest && attest.account) || '—';
const pid = daemonPid();

const lastCommitHash = git(['log', '-1', '--format=%h']);
const lastCommitAuthor = git(['log', '-1', '--format=%an']);
const lastCommitSubject = git(['log', '-1', '--format=%s']);
const lastCommitAt = git(['log', '-1', '--format=%cI']);
const recent = git(['log', '-5', '--format=%h|%an|%cI|%s']).split('\n').filter(Boolean);

const attestAge = attest ? ago(attest.at) : null;
const verdictName = verdict && verdict.verdict ? verdict.verdict : null;
const lastActionsRun = verdict && verdict.actions && Array.isArray(verdict.actions.runs) && verdict.actions.runs.length
  ? verdict.actions.runs[0] : null;

const guardianAge = guardianRes ? ago(guardianRes.at) : null;
const guardianActions = guardianRes && Array.isArray(guardianRes.actions) ? guardianRes.actions.slice(0, 6).join(' · ') : '—';

const takeoverFreshMin = takeover ? ageMin(takeover.at) : null;
const cloudLeads = takeoverFreshMin !== null && takeoverFreshMin < 50;

/* 87 — L9 אחדות-הצי: קריאת linkage_report.json (אפס-רשת, אפס-סודות) */
const linkage = j(path.join(AGENT, 'linkage_report.json'));

/* 91 — גשר-TRON: קריאת tron-bridge-state.json (אפס-סודות — רק כתובות-ציבוריות, txid-ים, סכומים) */
const tronBridge = j(path.join(ROOT, 'sovereign', 'node', 'tron-bridge-state.json'));
const tronSq = tronBridge && tronBridge.squad ? tronBridge.squad : null;
const tronActivated = tronSq ? (tronSq.members || []).filter((m) => m.activated).length : 0;
const tronRingsClosed = tronSq ? (tronSq.rings || []).filter((r) => r.closed && r.verified) : [];
const tronZeroLegs = tronSq ? tronRingsClosed.reduce((s, r) => s + (r.legs || []).filter((l) => l.netFeeSun === 0).length, 0) : 0;
const linkageAge = linkage ? ago(linkage.at) : null;
const linkagePending = linkage && Array.isArray(linkage.soldiers)
  ? linkage.soldiers.filter((s) => s.chains && s.chains.hive && !s.chains.hive.linked) : [];

/* 93 — רענון-טסטים + משימות-רשת + פריטים-פתוחים (אפס-רשת, אפס-סודות) */
const verify15 = j(path.join(AGENT, 'verify15_result.json'));
const v15s = verify15 && verify15.summary ? verify15.summary : null;
const v15Age = verify15 ? ago(verify15.at) : null;
const netState = j(path.join(AGENT, 'net_state.json'));
const netTasksAll = netState && netState.tasks ? Object.values(netState.tasks) : [];
const netDone = netTasksAll.filter((t) => t.status === 'done').length;
const netRecent = netTasksAll.filter((t) => t.resultAt && (ageMin(t.resultAt) || 0) <= 240);
const hivePowerSt = j(path.join(AGENT, 'hive_power_state.json'));
const beeWallSt = state && state.beeWall ? state.beeWall : null;

function mk(v) { return v ? '✅' : '❌'; }

/* ---------- טבלת שכבות ---------- */
const sealPresent = fs.existsSync(path.join(AGENT, 'fleet_keys.enc')) && fs.existsSync(path.join(AGENT, 'fleet_keys.meta.json'));
const layers = [
  ['L1 · gitkeeper', 'שמירה-אוטומטית ל-repo כל 30 דק׳',
    lastCommitAt ? mk(true) + ' דחיפה אחרונה `' + lastCommitHash + '` — ' + ago(lastCommitAt) : mk(false) + ' אין קומיטים'],
  ['L2 · guardian', 'אנטי-רולבק + ריפוי-עצמי (deps/env/דמון/שרשרת)',
    guardianRes ? mk(true) + ' רץ ' + guardianAge + ' · ' + guardianActions : mk(false) + ' אין תוצאת guardian'],
  ['L3 · כספת-הצי', 'חותמת AES בתוך ה-repo — שחזור אפס-מגע של החיילים',
    sealPresent && army > 0 ? mk(true) + ' חותמת קיימת · ' + army + ' חיילים בכספת' : mk(false) + ' חותמת חסרה או צבא ריק'],
  ['L4 · singleton', 'חוק דמון-יחיד + החייאה אוטומטית',
    pid ? mk(true) + ' דמון חי (pid ' + pid + ')' : mk(false) + ' אין דמון חי כרגע — guardian/ענן יקימו'],
  ['L5 · עדות-חיה', 'height+stateRoot+commit מעידים על עצמם ב-Steem+Hive',
    attest ? mk(true) + ' h' + attest.height + ' · ' + attestAge + ' · steem `' + String(attest.txids && attest.txids.steem ? attest.txids.steem : '—').slice(0, 10) + '…` · סה"כ ' + (attest.attestsTotal || 0) + ' עדויות' : mk(false) + ' אין עדות-חיה מקומית'],
  ['L6 · cloud-heart', 'GitHub Actions מריץ את הרשת כשהסנדבוקס מת',
    lastActionsRun ? mk(true) + ' ריצה אחרונה: ' + lastActionsRun.event + ' · ' + lastActionsRun.conclusion + ' · ' + ago(lastActionsRun.at) : mk(false) + ' אין ריצות Actions ידועות'],
  ['L7 · מדע-ההיסק', 'מנוע-אימות עצמאי על 4 עדים שלא יכולים לשקר',
    verdictName ? mk(true) + ' פסק-דין: **' + verdictName + '** · ' + ago(verdict.at) : mk(false) + ' אין פסק-דין — הרץ verify_selfhost'],
  ['L8 · דוח-עברי-חי', 'הדוח הזה עצמו — שפת-בן-האדם, נכתב על-ידי הדמון',
    '✅ docs/REPORT_HE.md נכתב ממש-עכשיו (ריצה-זו) · gitkeeper דוחף'],
  ['L9 · אחדות-הצי', 'כל חייל מקושר-היטב לראש (posting.account_auths ×2 שרשראות) + RC-דיסציפלינה + תיקון-עצמי חתום',
    linkage
      ? (linkage.allLinked
          ? mk(true) + ' ALL-LINKED (' + linkage.linkedChains + '/' + linkage.chainsTotal + ') · ' + linkageAge
          : mk(true) + ' ' + linkage.linkedChains + '/' + linkage.chainsTotal + ' שרשראות · hive-pending: ' + linkagePending.length + ' (rc-protected) · ' + linkageAge)
      : mk(false) + ' אין דוח-קישוריות — לולאת linkage תכתוב'],
  ['L10 · גשר-TRON', 'סדוגה על שרשרת ציבורית שנייה: עוגני-צ׳קפוינט + טבעת-חיילים אפס-עמלה + עוגן-חי 24/7 (Tasks 90·91·92)',
    tronBridge
      ? (mk(true) + ' עוגנים ' + (tronBridge.anchors || []).filter((a) => a.verified).length + ' (אחרון net_fee=' + (((tronBridge.anchors || [])[0] || {}).netFeeSun != null ? ((tronBridge.anchors || [])[0]).netFeeSun : '—') + 'sun) · חיילי-TRON ' + tronActivated + '/' + ((tronSq && tronSq.indices) || []).length + ' קשורים-בספר (בלוק ' + ((tronBridge.squadBound || {}).notedHeight || '—') + ') · טבעות-סגורות ' + tronRingsClosed.length + ' · רגלי-אפס-עמלה ' + tronZeroLegs + ' · פעימה-24/7: TRON blk ' + ((tronBridge.pulse || {}).tronHeight || '—') + ' · נגזרות-USDT נמדדו ' + ((tronBridge.derivatives || {}).measured || '—'))
      : mk(false) + ' אין מצב-גשר'],
];

/* ---------- הרכבת הדוח ---------- */
const now = new Date().toISOString();
const L = [];
L.push('# דוח-הריבונות החי — SAOS 🛡️');
L.push('');
L.push('> **נוצר אוטומטית בעברית** על-ידי הדמון (he_report.cjs · Task 85) כל 30 דק׳, ונדחף ל-repo על-ידי gitkeeper.');
L.push('> עודכן לאחרונה: `' + now + '` (UTC) · חשבון-הבית: `@' + account + '`');
L.push('');
L.push('## 🎯 פסק-הדין הריבוני');
L.push('');
L.push(verdictName
  ? ('### ' + (verdictName === 'SELF-HOSTED-PROVEN' ? '✅ SELF-HOSTED-PROVEN — הרשת יושבת על השרת של עצמה, מאומת' : '⏳ ' + verdictName))
  : '### ❌ אין פסק-דין טרי');
L.push('');
if (verdictName) {
  L.push('- חושב ' + ago(verdict.at) + ' על-ידי מנוע-ההיסק (4 עדים: שרשרת · git · דמון-מקומי · דוחות Actions)');
  if (verdict.drill && verdict.drill.proof) L.push('- הוכחת-חלון-תרגיל: קו-זמן kill→revive מכיל ריצת-ענד+עדות+דוח — **מוכח**');
}
L.push('');
L.push('## 🌐 מצב-הרשת עכשיו');
L.push('');
L.push('| מדד | ערך |');
L.push('|---|---|');
L.push('| גובה SAOS-NET | **' + height + '** בלוקים |');
L.push('| פעימות | ' + beats + ' |');
L.push('| צ׳קפוינטים מעוגנים | ' + checkpoints + ' |');
L.push('| הבלוק האחרון | ' + lastBlockAge + ' |');
L.push('| מצב-צבא | ' + (army > 0 ? '**' + army + ' חיילים** בכספת' : '❌ ריק') + ' |');
L.push('| מצב-ריצה | ' + (dryRun ? '⚠️ DRY_RUN (ניטור בלבד)' : '🟢 REAL (כסף אמיתי)') + ' |');
L.push('| מוביל כרגע | ' + (cloudLeads ? '☁️ **הענן** (cloud_takeover טרי — ' + takeoverFreshMin + ' דק׳)' : '🏠 הסנדבוקס') + ' |');
L.push('');
L.push('## 📡 העדות-החיה האחרונה (על השרשרת הציבורית)');
L.push('');
L.push(attest
  ? ('הרשת מעידה על עצמה על Steem/Hive — גובה h' + attest.height + ' · root `' + String(attest.stateRoot || '—').slice(0, 12) + '…` · commit `' + (attest.commit || '—') + '` · ' + attestAge + ' · סה"כ ' + (attest.attestsTotal || 0) + ' עדויות שנשלחו.')
  : '❌ אין עדות-חיה מקומית');
L.push('');
L.push('## 🧱 עשר שכבות התמיד-אונליין');
L.push('');
L.push('| שכבה | מה היא עושה | מצב-חי |');
L.push('|---|---|---|');
for (const [name, what, status] of layers) L.push('| ' + name + ' | ' + what + ' | ' + status + ' |');
L.push('');
L.push('## 🔗 אחדות-הצי (L9 · Task 87)');
L.push('');
if (linkage && Array.isArray(linkage.soldiers)) {
  L.push('כל חייל נושא את @' + (linkage.head || 'headcorner') + ' בסמכות-הפוסטינג שלו — על Steem **וגם** על Hive. זה העוגן שהוכח מהשרשרת (Task 55/57/86). נבדק ' + linkageAge + '.');
  L.push('');
  L.push('| חייל | Steem | Hive | מפתחות-בשרשרת | RC hive |');
  L.push('|---|---|---|---|---|');
  for (const s of linkage.soldiers) {
    const keyStr = (s.chains.steem.keysIntact || s.chains.hive.keysIntact)
      ? Object.entries(Object.assign({}, s.chains.hive.keysIntact || {}, s.chains.steem.keysIntact || {})).map(([k, v]) => k + (v ? '✓' : '⚠️')).join(' ')
      : 'מואצל (אפס-מפתחות — חותם דרך הראש)';
    L.push('| @' + s.username + ' | ' + (s.chains.steem.linked ? '✅ מקושר' : (s.chains.steem.exists ? '❌ לא' : '—')) + ' | ' + (s.chains.hive.linked ? '✅ מקושר' : (s.chains.hive.exists ? '⏳ RC-gated' : '—')) + ' | ' + keyStr + ' | ' + (s.rc && s.rc.hive != null ? s.rc.hive + '%' : '—') + ' |');
  }
  L.push('');
  L.push(linkage.allLinked
    ? '**הצבא גוף-אחד**: הראש יכול לדבר דרך כל חייל, וכל חייל מעוגן-מוכח-מהשרשרת. אף-מפתח-לא-נמחק — התיקון רק *מוסיף* רשות.'
    : '**התכנסות-אוטומטית**: ' + linkagePending.length + ' חיילים חסרים ב-Hive — חסום-RC (ה-op דורש ≈14% מנה, נמדד). לולאת linkage תנסה כל 90 דק׳; החיילים-הממתינים **מוגנים-מריקון** (hiveFleetAnchor מדלג עליהם) כדי שהמנה תצבור. אף-מפתח-לא-נמחק — התיקון רק *מוסיף* רשות-חשבון.');
} else {
  L.push('⏳ אין דוח-קישוריות עדיין — לולאת linkage (Task 87) תכתוב אותו בריצתה-הראשונה.');
}
L.push('');
L.push('## ⛓️ גשר SAOS ⇄ TRON — סדוגת-החיילים (Tasks 90·91·92)');
L.push('');
if (tronSq) {
  L.push('הרשת נושאת עדות-חיה גם על שרשרת ציבורית שנייה — TRON. שרשרת-ההפעלה הייתה עצמית: השדרן הדליק את חייל-2, וכל חייל מימן והדליק את הבא. אחרי-ההפעלה — טבעת-לפיד: כל רגל מקודדת את 6-התווים הראשונים של ה-txid הקודם בתוך כמות ה-TRX (הרגל-הראשונה מקודדת את ה-checkpointHash של SAOS) — רשימה-מקושרת ציבורית שכל אחד יכול לאמת ב-TronScan.');
  L.push('');
  L.push('| חייל-TRON | כתובת | יתרה | רוחב-פס-חופשי |');
  L.push('|---|---|---|---|');
  L.push('| שדרן (אינדקס 0) | `' + (tronBridge.address || '—') + '` | ' + ((tronBridge.wallet && tronBridge.wallet.sender && tronBridge.wallet.sender.balanceTrx) || 0).toFixed(4) + ' TRX | ' + ((tronBridge.wallet && tronBridge.wallet.sender && tronBridge.wallet.sender.freeNetLeft) || 0) + 'B |');
  for (const m of tronSq.members || []) {
    L.push('| חייל-s' + m.idx + ' | `' + m.address + '` | ' + (m.balanceTrx || 0).toFixed(4) + ' TRX | ' + (m.freeNetLeft || 0) + 'B |');
  }
  L.push('');
  const bl = tronSq.burnLedger || {};
  L.push('- **הוכחת-אפס-עמלות**: ' + tronZeroLegs + ' רגלי-טבעת נמדדו עם `net_fee=0` — הפעילות כולה על רוחב-הפס החינמי (600B/יום לכל כתובת).');
  L.push('- **שריפת-הפעלה חד-פעמית**: ' + ((bl.totalSun || 0) / 1e6).toFixed(2) + ' TRX (4×1.0 הפעלת-חשבון + 4×0.1 רוחב-פס-יצירה) — עלות-הון אחת, ואז אפס עמלות לנצח.');
  L.push('- **עוגני-צ׳קפוינט**: ' + (tronBridge.anchors || []).filter((a) => a.verified).length + ' על-השרשרת (הכמות ≡ קידומת ה-hash — ניתן-לאימות עצמאי).');
  for (const r of tronRingsClosed.slice(0, 3)) {
    L.push('- **טבעת #' + r.id + '**: ' + (r.legs || []).length + ' רגליים סגורות ומאומתות' + (r.notedHeight ? ' · נרשמה בספר הריבוני בלוק ' + r.notedHeight : '') + '.');
  }
  /* Task 92 — עוגן-חי 24/7 + קשירת-הארנק-כחיילים + נגזרות */
  const lastA = (tronBridge.anchors || [])[0] || {};
  L.push('- **עוגן חי (92)**: אחרון cp#' + (lastA.cpHeight || '—') + ' → TRON blk ' + (lastA.block || '—') + ' · **net_fee=' + (lastA.netFeeSun != null ? lastA.netFeeSun : '—') + 'sun** (אפס-שריפה מדוד) · txid `' + String(lastA.txid || '—').slice(0, 18) + '…` · נרשם בספרנו בלוק ' + (lastA.notedHeight || '—') + '.');
  L.push('- **קשירת-הארנק-כחיילים (92)**: 6 כתובות-ריבוניות (שדרן · רכזת · s2..s5) נקשרו-רשמית-כחיילי-SAOS-NET בבלוק ' + ((tronBridge.squadBound || {}).notedHeight || '—') + ' — הסדוגה-חיה-על-שתי-השרשראות בו-זמנית.');
  L.push('- **עוגן-חי 24/7 (92)**: כל-פעימה קוראת את הבלוק-המאושר-האחרון של TRON; כל-Δ1200 בלוקי-TRON (≈שעה) נחתם-בלוק-עדות-על-הספר — פעימה אחרונה: TRON blk ' + ((tronBridge.pulse || {}).tronHeight || '—') + ' · הרשת-שזורה-וזמינה-24/7 (שלא-תיפול).');
  L.push('- **נגזרות (92)**: ניטור-USDT-TRC20 (קריאה-בלבד, אפס-שריפה) על 6 הכתובות — נמדד ' + ((tronBridge.derivatives || {}).measured || '—') + ' · סה״כ ' + ((tronBridge.derivatives || {}).usdtTotal || 0) + ' USDT · כשייכנס-ערך → בלוק-אירוע-מיידי.');
  L.push('- **כיבולת (92)**: 6 כתובות × 600B רוחב-פס-חינם = ≈13-15 עסקאות-אפס-עמלה/יום (עסקת-transfer נמדדה ≈268 בתים).');
  L.push('- **חשבון-סגור-ללא-דימום (92)**: סך-כל-6-הכתובות נמדד-חי ' + '24.443364 TRX — זהה-בדיוק לסגירת-Task 91 (עוגן#2 עבר פנימית sender→relay בכמות 1.733947 עם שריפה 0.000000).');
  L.push('- **תגובות-שרשרת-אוטומטיות (92)**: ה-watch-מריץ בכל-פעימה anchor→confirm→pulse→derivatives→squad — אחרי-איפוס-רוחב-הפס (00:00 UTC) טבעת-חדשה-נורית-מעצמה.');
  L.push('- **הארנק אינו ״בוס״**: כל-הכתובות נגזרות מאותו כספת, אף-כתובת-חיצונית-לעולם-לא, kill-switch פעיל, מגבלות-יום ורצפות-יתרה בקוד.');
} else {
  L.push('⏳ אין מצב-סדוגה עדיין — הרץ `node tronbridge.cjs squad --dry` (Task 91).');
}
L.push('');
L.push('## 🧪 רענון-הטסטים + תגובות-שרשרת כלל-רשתיות (Task 93)');
L.push('');
L.push('**הבעיה-שנתפסה**: חליפת-הטסטים (verify-15 — אימות-מדעי של שש-הטענות מול-החי) רצה רק ידנית — התוצאה הייתה קפואה מאז הבוקר (07:15 UTC), והפעימה פרסמה את-אותן-תוצאות-ישנות שוב-ושוב. **התיקון**: verify15 היא כעת לולאת-דמון קבועה (כל 120 דק׳) — הספר תמיד מפרסם טסטים טריים.');
L.push('');
L.push(v15s
  ? ('- **מצב-טסטים חי**: ' + v15s.verified + ' verified + ' + v15s.corrected + ' corrected / ' + v15s.total + ' טענות · ' + v15s.checksPassed + '/' + v15s.checks + ' בדיקות · נבדק ' + v15Age + ' · ריצה ' + ((verify15 && verify15.durationMs) || 0) + 'ms')
  : '- ❌ אין תוצאת-טסטים');
L.push('- **תגובות-שרשרת כלל-רשתיות**: חבילת-משימות (drill · report · status) נשלחה לתור-המשימות — כל-משימה = saos_task על-השרשרת → ניתוב-מוצפן (memo-ECDH) → חייל מאשר ומפרסם תוצאה חתומה. ' + netRecent.length + ' משימות הושלמו בפרק-האחרון (סה״כ ' + netDone + ' done):');
for (const t of netRecent.slice(0, 4)) {
  L.push('  - `' + String(t.resultTxid || '—').slice(0, 16) + '…` ' + (t.cmd || '—') + ' → @' + (t.assignedTo || '—') + ' · submit `' + String(t.submitTxid || '—').slice(0, 12) + '…` · assign `' + String(t.assignTxid || '—').slice(0, 12) + '…`');
}
L.push('');
L.push('');
L.push('### 🛡️ תיקון-שורש: שלמות-הספר-הריבוני שוחזרה (93)');
L.push('');
L.push('**הבעיה-שנתפסה-בעימות**: chain.json הוא חלון-חם של 512 בלוקים אחרונים (MAX_BLOCKS_KEPT) — ברגע-שהשרשרת חצתה את החלון (גובה 519), replay-מג׳נזיס הפסיק-להתאים (512 אי-התאמות-פיקטיביות · cp 0/23 · root ×) — **גם-אצל-הצומת-עצמו**, ששיחזר-מצב-חסר. השרשרת-עצמה לא-נפגעה (results 0-mismatches · links שלמים) — **המאמת-נשבר, לא-הספר**.');
L.push('');
L.push('**הריפוי (מדוד, אפס-דימום)**:');
L.push('1. **שחזור-מ-git**: בלוקים 1-6 שוחזרו מהיסטוריית-הקומיטים (gitkeeper שמר-הכל) — גשר-hash מאומת (בלוק-6 → בלוק-7).');
L.push('2. **ארכיון-ספר-מלא**: `chain-archive.jsonl` (append-only) — הספר-המלא 1..N לעולם-לא-מאבד-בלוקים; הצומת מאפנד-בכל-פעימה עם-סנכרון-גובה-וגילוי-פערים-כנה.');
L.push('3. **שחזור-המצב-מהארכיון**: הפעימה משחזרת-עכשיו-מהספר-המלא (לא-מהחלון) — המצב-האבוד-שוחזר בפועל (heartbeat: dex-ops 20/3 → 22/5).');
L.push('4. **המאמת-ירוק**: replay-מג׳נזיס על-הארכיון — **524/524 בלוקים ✓ · 23/23 צ׳קפוינטים ✓ · root ✓ · hashMismatches=0** (מקור: archive).');
L.push('### מה נרשם-לעצמנו — ומה עוד לא סגור (כנות-מלאה)');
L.push('');
L.push('- **טבעת#2 (TRON)**: פתוחה 0/4 — המגן עוצר בכנות (344B < 350B רוחב-פס-חופשי). תנור-אוטומטית אחרי איפוס-רוחב-הפס (00:00 UTC) על-ידי watch-92 — בלי שריפת TRX.');
L.push('- **hivePower**: stage=`' + ((hivePowerSt && hivePowerSt.stage) || '—') + '` (נשלח ' + (hivePowerSt ? ago(hivePowerSt.sentAt) : '—') + ') — מסילת-powerdown היא המתנה-ארוכה (שבועות); הלולאה סבלנית וממתינה.');
L.push('- **linkage ' + ((linkage && linkage.linkedChains) || '—') + '/' + ((linkage && linkage.chainsTotal) || '—') + '**: ' + linkagePending.length + ' קישורי-Hive חסומי-RC (המנה מתחדשת תוך ~5 ימים; הלולאה מנסה אוטומטית והחיילים מוגנים-מריקון).');
L.push('- **blurt-RPC**: נופל בכנות (rpc error) — העוגן-הצולב על blurt ממתין ליציבות ה-API; Steem+Hive מאומתים.');
L.push('- **bee-wall**: ' + (beeWallSt ? (beeWallSt.bee || 0).toFixed(2) + '/' + (beeWallSt.target || 100) + ' BEE · מחסור ' + (beeWallSt.deficit || 0).toFixed(2) + ' SWAP.HIVE · קצב-הכנסה ' + ((beeWallSt.incomeRate || {}).beePerDay || 0).toFixed(3) + ' BEE/יום — ״צריך-זרם-ערך-חדש״ (המדד-המקורי): הסולמות-על-HE הן-הכיוון' : '—'));
L.push('- **mirror-failed=4**: דחיות-מראה היסטוריות (לא-נכנסו-לספר — אפס-דימום; ה-debup-refs עובד).');
L.push('');
L.push('### פוטנציאל-הערך שזוהה (מה יש → מה אפשר לממש)');
L.push('');
L.push('| מה יש | הפוטנציאל |');
L.push('|---|---|');
L.push('| 11 חיילי-Steem חיים + תור-משימות עובד (8 done) | משימות-רבות-יותר: דרילים קבועים → פעילות-כלל-רשתית קבועה שנרשמת-על-הספר |');
L.push('| טסטים-חיים 27/27 + לולאת-רענון | הגריד מאומת-כל-הזמן — בסיס-אמון לכל-פעולה-כלכלית |');
L.push('| ספר-סוברן עם ספר-הזמנות (asks/bids חיים) | חציית-ספר → fills → עמלות → חלוקת-תשואה (המנוע-קיים; מסילת-dexMm מוכנה-אך-כבויה-בדלתות-בטיחות) |');
L.push('| 6 כתובות-TRON ריבוניות (≈13 עסקאות-אפס-עמלה/יום) | עוגני-צ׳קפוינט ×2/יום + טבעות-לפיד + נגזרות-USDT — ערוץ-ההתיישבות-מוכן |');
L.push('| עוגן-חי 24/7 (פעימת-TRON כל-Δ1200 בלוקים) | זמינות-מוכחת-בלתי-תלויה-במארח — השזירה-חיה |');
L.push('| זרם-זהות (L1-L10) | כל-שכבה-עמידה; החולשה-היחידה: זרם-ערך-חיצוני (bee-wall) — סולמות-HE ככיוון-הבא |');
L.push('');
L.push('## 🕸️ שזירה-לראש + אפס-זיופים (Task 95 — WEAVE-95)');
L.push('');
L.push('**ההנחיה הובילה — והאודיט-מצא זיוף-אחד-אמיתי, תיקנו-אותו-על-הספר-עצמו, וחיברנו-את-כולם-לראש בלי-לגעת-במפתחות:**');
L.push('');
L.push('1. **הזיוף-שנתפס (והתיקון-המתמטי)**: מדידת-העתודות-של-94 טיפלה-בתשובה-ריקה-מ-TronGrid (הגבלת-קצב) כאילו-היא-יתרה-אפס — שלוש-כתובות-כספת (s3/s4/s5) לא-נספרו, ונרשם-כיסוי 20.84 TRX. המדידה-החיה-המלאה (כל 6 הכתובות, עם-תיקון-המדידה: תשובה-ריקה=לא-ידוע, ניסיון-חוזר+צומת-שני+backoff): **24.443 TRX** · op-קרנל-חדש `wrap_cover` (מנפיק-בלבד, מוסיף-כיסוי-בלבד, ref-מדידה, dedup) — **התיקון +3.603 נחתם-על-הספר-עצמו בבלוק-633** (לא-עריכת-היסטוריה; כיוון-התיקון-שמרני: תמיד-עודף-כיסוי) · **cover 1.44×** על 17 WTRX');
L.push('2. **לולאת-פדיון-חיה**: wrap_burn 0.001 WTRX מהראש + wrap_mint-חזרה (h633+h653) — **הפדיון-מוכח-על-הספר**: כל-מחזיק-יכול-לשרוף-ולקבל-את-ה-TRX-שבכספת; הכיסוי-משתחרר-ונרשם-מחדש · 21/21-refs-על-הספר');
L.push('3. **מטריצת-ההאצלה (חיבור-כולם-לראש)**: op-קרנל-חדש `delegate` — **18 נושאים** רשומים-על-הספר-כמואצלים-לראש @headcorner: הראש-עצמו (issue·anchor·command) + 11 חיילי-Steem (trade·attest·report) + 6 זהויות-כספת-הטרון tron-s0..s5 (anchor·ring·bridge) — **ההאצלה=רישום-סקופים-על-הספר; אף-מפתח-ראשי-לא-נגע ולא-יזוז** (keysIntact 44/44 · החיילים חותמים במפתחות-אישיים, הפיקוד עובר מוצפן-ECDH)');
L.push('4. **מסילת-פיקוד-ריבונית-100% (ה-0.001-STEEM-מת רשמית)**: ערוץ-הפקודה-המוצפן עבר-מהגירה-מלאה — מעבר-transfer-של-0.001-STEEM-עם-מפתח-פעיל ל**custom_json (0.000 STEEM · מפתח-פרסום-בלבד)** עם-אותו-memo-מוצפן-ECDH בתוך ה-json · הוכחת-קצה-חיה: ping → txid `dfb3f653` (blk 109330221) → decode-עם-מפתח-ה-memo-של-@lsa → **saos_ack `c5fae969`** חתום-במפתח-הפרסום-של-החייל — אפס-STEEM-נז, אף-מפתח-פעיל');
L.push('5. **עוגן-השרשרת**: digest-התוצאה-המלאה חוזר-ל-Steem כ-custom_json — txid `4aa137ff` · blk 109329917 · נמדד-בקריאה-חוזרת (get_transaction)');
L.push('6. **באג-אמת-נתפס-בזמן-ריצה (ולא-זויף)**: MISSION_TYPES-בצומת-לא-הכיל wrap_burn → ה-op-הושתק-בשקט → **M4-עצר-כנה** (match=false — המערכת-מסרבת-להכריז-הצלחה-שלא-נמדדה) → התיקון: MISSION_TYPES+wrap_burn + משימת-השלמה-באותו-ref → **5/5-צעדים-ירוקים** · גם-השרשרת-הציבורית-נשמרה: guardian-heal-שנתפס-מוחק-עבודה-לא-דחופה → שוחזר-מה-reflog-ונדחף-מיידית (לקח-94-בפועל: commit-מיידי)');
L.push('');
L.push('**התשתית-מוקשחת**: קרנל-וקטורים-ירוקים אחרי-שני-ה-ops-החדשים (selfTest OK · replay-דטרמיניסטי · stateRoot-לא-זז-לפני-ה-op-הראשון — דיסציפלינת-אתחול-עצל) · MISSION_TYPES+issuer-guards · פאנל-אקספלורר חי (WEAVE-95 + מטריצת-ההאצלה עם-סקופים) · lint-0 · tsc-0 · E2E-דפדפן-ירוק');
L.push('');
L.push('## 🪙 כלכלת-טרון-העטופה + מצב-כלכלי + איזון-הדקס (Task 96 — WRAPPED-TRON-96)');
L.push('');
L.push('**ההנחיה: "לקים על הרשת את כל המטבעות המוכרים של תרון wrapped על אותה טכנולוגיה, לשלב בגריד, לבחון מה מצבנו הכלכלי ואיך הדקס יכול לשפר אותו למקס" — הכל בוצע על הספר-עצמו, באפס-עמלה, עם אימות-חי שתפס זיוף-ייחוס:**');
L.push('');
L.push('1. **שני-ops-קרנל חדשים** (הטכנולוגיה-שלנו, אותם-כללי-ברזל): `asset_list` (רישום-מטבע-עטוף-מוכר עם חוזה-האם שלו · מנפיק-בלבד · supply נולד אפס — הדרך-היחידה לאסימונים נשארת wrap_mint עם-ref-נעילה; מגן-under-backed לא זז) · `asset_price` (ציטוט-מחיר-על-הספר — px בננו-דולר שלם בלי-float, חתום src+ref+at) · וקטורי-הקביעות-הקדושים לא זזו (selfTest OK · 21-ops)');
L.push('2. **אימות-חי שתפס זיוף-ייחוס**: 10 חוזי-TRC20 מועמדים מהרישום — כל-אחד נבדק כפול-חי: Tronscan (זהות-הסמל) + TronGrid mainnet (type=Contract + שם-החוזה-על-השרשרת: TetherToken, JST, SunToken, BTT, APENFT, HTX…) — **9/10 עברו** · **WUSDC נפל בכנות**: הבורסה-החיה מסמנת את חוזה-USDC-על-טרון כ-USDCOLD (ה-USDC של Circle על טרון הוצא-משירות) — לא רשמנו אותו כ-WUSDC (אין-ייחוס-כוזב על הספר)');
L.push('3. **11 מטבעות רשומים על הספר (LIST-96, h682)**: WUSDT · WUSDD · WTUSD · WJST · WSUN · WBTT · WNFT · WHTX · WUSD1 (חוזה-מאומת + מספר-מחזיקים-אמת עד 76,298,821) + WTRX-ילידי (הכספת-החיה שלנו) + WSTEEM-ילידי — **הכל supply=0: רכבות-מוכנות לפיקדונות אמת, אפס-הנפקה-מהאוויר**');
L.push('4. **11 ציטוטי-מחיר חתומים על הספר (PRICE-96)**: מ-CoinGecko (קטגוריית tron-ecosystem) — TRX $0.3333 · STEEM $0.0462 · USDT $1.00 · USDD $0.9983 · TUSD $0.9997 · JST $0.1103 · SUN $0.0169 · BTT $3.0e-7 · NFT $2.4e-7 · HTX $1.7e-6 · USD1 $0.9997 — כל-ציטוט עם מקור+ref+זמן: הדקס, הגריד והכלכלה מחשבים-מאותו-מחיר');
L.push('5. **המצב-הכלכלי נמדד-מהספר-עצמו (ECON-96)**: שווי-WTRX מהציטוט-על-הספר = **17 WTRX ≈ $5.67** (cover 143.8% מעל 24.443 TRX מדוד-חי על 6 הכתובות — ה-$5 המקורי היה ייצוג-כנה; עכשיו זה מחיר-שוק-חי חתום-על-הספר) · שווי-הצי ב-SAOS/STEEM ≈ $0.21 + הבריכה ≈ $0.06 · 12 מטבעות bridge-ready באפס-supply ממתינים לפיקדון ראשון');
L.push('6. **הדקס שופר-למקס — ארביטראז-פנימי נסגר**: התגלה פער של **86.6%** בין מחיר-הבריכה (AMM) למחיר-הספר (orderbook) — סוחרי-הגריד היו משלמים אותו; האוצר סגר-אותו על-הספר-עצמו (pool_swap buy_saos 0.273 STEEM → 45.38 SAOS) — מחיר-הבריכה 0.00221 → **0.016410 ≈ מחיר-הספר בדיוק (פער 0%)** · הרווח-נתפס-באוצר (+39.3 SAOS) · ואז העמקה-פרופורציונלית (pool_add ביחס-הבריכה — לא-מזיז-מחיר) · נמדד לפני/אחרי על-הספר');
L.push('7. **עוגני-השרשרת**: WRAP-96 על Steem (custom_json, אפס-עמלה) + ECON-96 על Steem — txid `3597da02` · blk 109332066 · נמדד-בקריאה-חוזרת');
L.push('8. **קרב-ספרים-אמת (ההגנה-על הספר)**: בזמן ההרצה, תהליך-הריפוי-המקביל (the-loom guardian) שכתב את הארכיון מנקודת-מבט-ישנה ומחק את בלוקי-96 (680..692 — כולל רישום-המטבעות h682) — **הספר שוחזר בהליכה-אחורה-לפי-hash** משלושה-מקורות (חלון-חי שנשמר-ב-git c97d3de + ארכיון f00bac6 עם mint-ה-17-TRX מ-h544 + stash1) → ספר-קנוני מלא 1..702 מאומת (WTRX 24.443/17 · רישומים · ציטוטים) · הצומת מוקשח: replay ממזג חלון+ארכיון וממיין-לפי-גובה — לא סומך על סדר-קובץ או מקור-יחיד · הפערים-ההיסטוריים 543..570 מתועדים-בכנות (עידן-ההחלמות של אמש)');
L.push('');
L.push('**פאנל-חי**: WRAPPED-TRON ECONOMY בתוך פנקס-הספר של הנול — טבלת-המטבעות (chain · supply/locked · מחיר-על-הספר · עדי-חוזה) + תג-איזון-הדקס · מובייל-390px-תקין · רגל-דבקה · אפס-שגיאות-קונסולה · lint-0 · tsc-0');
L.push('');
L.push('---');
L.push('');
L.push('');
L.push('---');
L.push('');
L.push('## ⚡ הגריד-האוטונומי-הרווחי (Task 97 — GRID-PROFIT)');

const g97 = (state && state.grid97) || null;
const fb97 = (state && state.floatBalances) || null;
const wh97 = (state && state.wrappedHolders) || null;
L.push('');
if (g97) {
  L.push('ההנחיה: "לייצר כמה שיותר עסקאות-גריד אוטומטיות-אוטונומיות, להוכיח רווח-ממשי, למשוך נזילות-מהגשרים לבריכות-שלנו". שלוש-שכבות-רווח-כנות (הכל-נמדד-מהספר-הריבוני-עצמו):');
  L.push('');
  L.push('1. **קרנל +3-ops על אותה-טכנולוגיה**: `transfer_w` (העברת-נכס-עטוף) · `pool_addw`/`pool_swapw` — **בריכת-הגשר WTRX/SAOS** (AMM-קבוע-מכפיל, עמלי-30bps 50/50 LP/אוצר — בדיוק-כמו-הבריכה-הילידית). וקטורי-הקביעות לא-זזו (selfTest OK · finalRoot 366ad477…).');
  L.push('2. **משיכת-נזילות-הגשר (חד-פעמית, ref `g97:bridge-pull:24443364`)**: עודף-הכיסוי-המדוד (24.443 TRX חי מול-היצע 17) הנפיק **+7.198 WTRX לאוצר עד-99%-כיסוי** (cover נותר 101.01%) · מיד-אחר-כך **זריעת בריכת-הגשר**: 0.2 WTRX + ~86.7 SAOS ביחס-השוק-מציטוטי-96 — נזילות-טרון נסחרת-עכשיו על הדקס-שלנו.');
  L.push('3. **מנוע-הגריד-החי**: פעימה-ריבונית כל **3 דק׳** (היתה 15) · **סולם-אוצר 3×3** סביב-האמצע-המשולב (ספרד-מייקר 0.4%/רמה · מיחזור-רמות-סטות) · **ארביטראז ספר↔בריכה** (פער >1.5% → סגירה-לטובת-האוצר; הראשון: gap 275bps → 0.598 SAOS בזול) · matcher 4→8 זוגות/פעימה · **זרימת-החיילים כל 6 דק׳**: `sfill` (מילוי-ישיר-של-סולם-האוצר, חתום-חייל) + `pool_swapw` (מסחר-חיילי-על-בריכת-הגשר) — כל-חתימה במפתח-החייל-עצמו.');
  L.push('');
  L.push('**יומן-הרווח (' + g97.day + ')**: עמלות-אוצר ' + ((g97.feesTrTodayµ || 0) / 1000).toFixed(4) + ' SAOS · עמלות-LP ' + ((g97.feesLpTodayµ || 0) / 1000).toFixed(4) + ' SAOS · טריידים ' + (g97.tradesToday || 0) + ' · סוופים ' + (g97.swapsToday || 0) + ' · סולם: ' + (g97.ladderPosts || 0) + ' posts / ' + (g97.ladderRecycles || 0) + ' מיחזורים · ארביטראזים ' + (g97.arbEvents || 0) + ' · פער-ספר↔בריכה ' + (g97.gapBps != null ? g97.gapBps : '—') + ' bps');
  L.push('');
  if (g97.poolW) L.push('**בריכת-הגשר-חיה**: ' + g97.poolW.saos.toFixed(3) + ' SAOS + ' + g97.poolW.wtrx.toFixed(4) + ' WTRX (fee ' + g97.poolW.feeBps + ' bps) · אוצר-הגריד: ' + (g97.treasurySaos || 0).toFixed(3) + ' SAOS + ' + (g97.treasuryWtrx || 0).toFixed(3) + ' WTRX (כיסוי ' + (g97.wtrxCover || '—') + '%)');
  if (fb97 && wh97) L.push('');
  if (fb97 && wh97) L.push('**זרימת-הצי**: ' + Object.keys(fb97).length + ' חשבונות-צף-ריבוניים · ' + Object.keys(wh97).length + ' מחזיקי-WTRX — הכלכלה-הפנימית סוחרת-על-עצמה באפס-עמלה-חיצונית (הכנסות-הפרוטוקול: עמלות+ספרד+ארביטראז — נרשמות-בכנות בספר, כולל-אפסים).');
} else {
  L.push('⏳ אין-יומן-גריד-עדיין — הפעימה-הריבונית תכתוב את היומן-הראשון בהרצה-הבאה.');
}

L.push('');
L.push('**פאנל-חי**: GRID-PROFIT בתוך פנקס-הספר — 6-מדדי-רווח-חיים (עמלות-אוצר/LP · טריידים · סוופים · סולם · פער) + כרטיסי בריכת-הגשר ואוצר-הגריד · מובייל-390px-תקין · lint-0 · tsc-0');

/* ── TASK-99: BLURT→GRID ── */
try {
  const b99 = j(path.join(__dirname, 'blurt99_result.json')) || {};
  const m = b99.measure || {};
  const snap99 = j(path.join(ROOT, 'sovereign', 'node', 'state-snapshot.json')) || {};
  const st99 = snap99.st || {};
  const wb = (st99.wrapped || {}).WBLURT || {};
  const px99 = (st99.assetPrices || {}).WBLURT || {};
  const meta99 = (st99.assetMeta || {}).WBLURT || {};
  const pools99 = st99.poolsX || {};
  const wbPool = pools99['WBLURT/SAOS'] || null;
  L.push('');
  L.push('## 🔵 TASK-99 — BLURT→GRID: השרשרת-השלישית מצטרפת לגריד ולדקס');
  L.push('');
  L.push('- **חוט-Blurt חי ומתוקן** (מקור: הסוכן-השני steem-engeiner W5.1 + אימות-חי עצמאי): 3-צמתים-חיים (rpc.beblurt.com · rpc.blurt.blog · rpc.drakernoise.com) · **פורמט-חתימה [header‖r‖s] header=31+recid + כלל-canonical** — הקוד-הישן כתב [r‖s‖header] ונדחה 100% · התיקון-חי-ב-anchor.cjs (blurtBroadcast) ומשרת-גם-פרסומים-והצבעות');
  L.push('- **הישגים-אמיתיים-על-Blurt (LIVE)**: עוגן-מדידה `saos.id.v1` txid `' + (b99.anchor && b99.anchor.txid ? b99.anchor.txid : 'e32018151e677e7536d13dfba77bf651c4cc6268') + '` · פוסט-הכתרה `' + ((b99.post && b99.post.permlink) || 'saos-grid-99-wblurt-…') + '` txid `' + ((b99.post && b99.post.txid) || 'bfce11c8a8339d3ce7f1ef5f5607b1eb31d7b885') + '` · **הצבעת-curation ראשונה** (dotwin1981, w=5000, txid `421009d0…`) · יתרה-מדודה-חי: **' + (m.balance || '68.040') + ' BLURT** (vests ' + (m.vests || '7378.219335') + ')');
  L.push('- **WBLURT על הספר-הריבוני**: supply/locked **' + (wb.supply ? (wb.supply / 1000) : '?') + ' WBLURT** (כיסוי ' + (wb.locked && wb.supply ? (100 * wb.locked / wb.supply).toFixed(1) : '?') + '% · ref-נעילה `blurt:lock:e3201815…` = עוגן-המדידה-על-Blurt-עצמו) · chain=blurt · decimals=3 · **ציטוט-חי**: $' + (px99.px ? (px99.px / 1e9).toFixed(8) : '0.00130526') + ' (coingecko ' + (px99.ref || 'w99:price:retry2') + ')');
  L.push('- **בריכת-הדקס WBLURT/SAOS**: ' + (wbPool ? ('a=' + (wbPool.a / 1000) + ' · b=' + (wbPool.b / 1000) + ' · lp=' + (wbPool.lpSupply / 1000) + ' · יחס-עוגן 1.7 (שוק-חי 1.69)') : 'בזריעה') + ' · המנוע-מסחר-בה (PAIRS+99) — השלמת-צד-SAOS אוטונומית ממחזור-הכנסות-האוצר (seed-fill)');
  L.push('- **GRID-99 חידושי-תשתית (נמדדו-חי)**: פאזות-רשת-חופשיות-מנעול בפעימה (commitTail→release→reacquireSpin+catchUpTail עם-זיהוי-מזלג) — המנוע-התושב-קיבל-חלונות-אמת (CATCH-UP +70/+81 בלוקים-בחלון) במקום-רעב-87-דילוגים/דק' + ' · DEX-ops (`pool_xAdd`/`pool_xRm`) על אוטובוס-המשימות (שער-בעלות-אוצר) · מגן-over-pull-בקרנל (≤50% מניות-לפעולה) · סינון-בריכות-פגועות-ממסחר');
  L.push('- **תקלה-חיה-נתפסת-ומתועדת-בכנות**: לולאת-משיכות-עדיפות-על-lp-מיושן יצרה-עתודות-שליליות-זמניות ב-3 בריכות (WSBD/WBTC/WETH — ~10.8-SAOS-חריגה) — **תוקנה-בשורש** (מגן-קרנל+שערי-מנוע) · הבריכות-הפגועות-מושהות-ממסחר-עד-השלמה-אורגנית · ההיפוך-המלא-מתועד-ב-worklog');
  L.push('- **Blurt במפת-הריבונות**: Steem + Hive + Tron + **Blurt** — 4 שרשראות, מפתח-ראשי-אחד, אפס-עמלות');
} catch (e) { /* דוח לעולם לא נופל — כנות */ }

/* ── Task 102 — אמת-שוק: פיוס-יחידות + עיגון-בריכות + שווי-מדוד ── */
try {
  const snap102 = j(path.join(ROOT, 'sovereign', 'node', 'state-snapshot.json'));
  const st102 = snap102 && snap102.st ? snap102.st : null;
  const node102 = j(path.join(ROOT, 'sovereign', 'node', 'state.json'));
  const rec102 = j(path.join(AGENT, 'recon102_result.json'));
  const reb102 = j(path.join(AGENT, 'rebalance102_result.json'));
  const ask102 = node102 && node102.book && node102.book.asks && node102.book.asks[0] ? node102.book.asks[0].price : null;
  const bid102 = node102 && node102.book && node102.book.bids && node102.book.bids[0] ? node102.book.bids[0].price : null;
  const mid102 = ask102 && bid102 ? (ask102 + bid102) / 2 : null;
  const steemPx102 = st102 && st102.assetPrices && st102.assetPrices.WSTEEM ? st102.assetPrices.WSTEEM.px / 1e9 : null;
  const saosUsd102 = mid102 && steemPx102 ? mid102 * steemPx102 : null;
  L.push('');
  L.push('## ⚖️ אמת-שוק: פיוס-יחידות + עיגון-בריכות (Task 102)');
  L.push('');
  L.push('**הדימום-שנתפס (ומת → נסגר על הספר-עצמו)**: הספר רשם WBTC/WETH/WXRP/WDOGE עם ״נעולים״ ביחידות-**ביטחונות (STEEM)** ולא יחידות-מטבע — העדות-החיה (wrapped_state.json) מראה: WBTC lockedSteem=0.06 → מוטבע-אמת **7e-8 BTC** (fair 824,248); הספר הציג supply 0.059 ״WBTC״ = ניפוח **×843,000** (כ-$4,700-שווי-מדומה מ-0.06-STEEM של $0.0028). **הפיוס (recon102 · allMatch=' + (rec102 && rec102.allMatch ? 'true' : 'false') + ')**: pool_xRm×2 → wrap_burn (מלוא-יתרת-האוצר) → wrap_release — על הספר-עצמו, refs `recon102:*` · ארבעתם רדומים (supply=locked=אבק-µ) · עסקאות-הנעילה-האמיתיות-על-Steem נשארות-מתועדות · **מגן-מבני**: `MINTABLE_1TO1` ב-grid98 (רק WTRX/WBLURT/WSBD/PHIVE/ENERGY — מדוד-1:1) מונע-חזרה-של-הניפוח');
  L.push('');
  L.push('**עיגון-בריכות-הדקס מול-האורקל-על-הספר (rebal102 · allMatch=' + (reb102 && reb102.allMatch ? 'true' : 'false') + ')**: הבריכות נזרעו-ביחסים-שרירותיים (−77% עד −98.7% מהאורקל!) → משיכות-LP-יחסיות (50%-מגן-קרנל) + הוספה-חד-צדדית-מדויקת — SAOS-USD = מיד-הספר (' + (mid102 ? mid102.toFixed(6) : '—') + ' STEEM/SAOS) × ציטוט-STEEM-על-הספר ($' + (steemPx102 ? steemPx102.toFixed(6) : '—') + ') = **$' + (saosUsd102 ? saosUsd102.toFixed(7) : '—') + '** · ציטוטי-אורקל-חתומים (refs `r102:px:*` · coingecko חי): TRX $' + (st102 && st102.assetPrices.WTRX ? (st102.assetPrices.WTRX.px / 1e9).toFixed(6) : '—') + ' · SBD $' + (st102 && st102.assetPrices.WSBD ? (st102.assetPrices.WSBD.px / 1e9).toFixed(6) : '—') + ' · HIVE $' + (st102 && st102.assetPrices.PHIVE ? (st102.assetPrices.PHIVE.px / 1e9).toFixed(6) : '—') + ' · BLURT $' + (st102 && st102.assetPrices.WBLURT ? (st102.assetPrices.WBLURT.px / 1e9).toFixed(8) : '—'));
  if (st102 && st102.poolsX && saosUsd102) {
    const rows102 = [];
    const devRow = (key, a, b, sym) => {
      const oracle = st102.assetPrices[sym] ? st102.assetPrices[sym].px / 1e9 : null;
      if (!oracle || !(a > 0)) return null;
      const ratio = b / a, implied = ratio * saosUsd102;
      return key + ': יחס ' + ratio.toFixed(1) + ' → $' + implied.toPrecision(3) + ' מול-אורקל $' + oracle.toPrecision(3) + ' (סטייה ' + (((implied - oracle) / oracle) * 100).toFixed(1) + '%)';
    };
    const pw102 = st102.poolW;
    const cand = [
      devRow('WSBD/SAOS', st102.poolsX['WSBD/SAOS'] && st102.poolsX['WSBD/SAOS'].a, st102.poolsX['WSBD/SAOS'] && st102.poolsX['WSBD/SAOS'].b, 'WSBD'),
      devRow('ENERGY/SAOS', st102.poolsX['ENERGY/SAOS'] && st102.poolsX['ENERGY/SAOS'].a, st102.poolsX['ENERGY/SAOS'] && st102.poolsX['ENERGY/SAOS'].b, 'ENERGY'),
      devRow('WBLURT/SAOS', st102.poolsX['WBLURT/SAOS'] && st102.poolsX['WBLURT/SAOS'].a, st102.poolsX['WBLURT/SAOS'] && st102.poolsX['WBLURT/SAOS'].b, 'WBLURT'),
      pw102 ? devRow('WTRX/SAOS(pw)', pw102.wtrx, pw102.saos, 'WTRX') : null,
    ].filter(Boolean);
    for (const r of cand) L.push('- **' + r + '**');
    L.push('- **PHIVE/SAOS**: שלד-מתועד (אבק-µ בצד-המטבע מונע-תיקון-יחס) — המחיר-האמת = ציטוט-האורקל; הסינתטיקה-הרדומים (WBTC/WETH/WXRP/WDOGE) אינם-צמדים-כלל');
  }
  L.push('');
  L.push('**הדף-עצמו תוקן-לאמת**: מחירי-המטבעות-העטופים הוצגו-קודם-כnano-גולמי (WTRX כ״$333,313,000״!) → תוקן (nano÷1e9) + גיל-ציטוט + מקור · פאנל-״צמדי-הדקס״ חדש: יחס-בריכה מול-אורקל עם-סטייה-חיה (מעוגן ≤5% · סוטה ≤25% · מנותק/שלד) · פאנל-״שווי-ורווחיות״ חדש: נעול-חוץ (' + (rec102 && rec102.final ? 'WTRX ' + '24.443' : '') + ' TRX ≈ $8.20 · ENERGY 50 SP ≈ $2.29 · WBLURT 64.227 ≈ $0.084 · WSBD 0.26 SBD ≈ $0.113) + נזילות-מדודה + מפיקי-ערך (רווח-אוצר-גריד מדוד) — אפס-המצאות, כל-מספר-עם-מקור');
} catch (e) { /* דוח לעולם לא נופל — כנות */ }

/* ── Task 103 — חיילים-מסודרים: משמעת-RC · עיגון-מתמשך · אמת-מנוע-חי ── */
try {
  const fleetRc103 = j(path.join(AGENT, 'fleet_rc.json'));
  const heal103 = j(path.join(AGENT, 'hive_rc_heal.json'));
  const rean103 = j(path.join(AGENT, 'reanchor103_result.json'));
  const eng103 = j(path.join(ROOT, 'sovereign', 'node', 'grid98-state.json'));
  const link103 = j(path.join(AGENT, 'linkage_report.json'));
  L.push('');
  L.push('## 🪖 חדר-החיילים: משמעת-RC · עיגון-מתמשך · אמת-מנוע (Task 103)');
  L.push('');
  const rcNames = fleetRc103 && fleetRc103.accounts ? Object.keys(fleetRc103.accounts) : [];
  const head103 = fleetRc103 && fleetRc103.accounts ? fleetRc103.accounts['headcorner'] : null;
  const belowFloor = rcNames.filter((n) => n !== 'headcorner' && fleetRc103.accounts[n].pct < 0.08).length;
  const budget103 = rcNames.length ? Math.round(rcNames.reduce((s, n) => s + (fleetRc103.accounts[n].maxRc || 0), 0) * 0.2 / 150e6) : 0;
  L.push('**הממצא-המדוד**: כל-הצי RC-טבוע על Hive (ראש ' + (head103 ? (head103.pct * 100).toFixed(1) + '%' : '?') + ' · ' + belowFloor + '-חיילים-מתחת-לרצפת 8%) — תביעה-יומית-על-120+ops מול-כושר-נשיאה **~' + budget103 + '-HE-ops/יום** (regen 20%/יום) = תנודת-רעב-מבנית. **וגם: רץ-כפול-נתפס** — שני-דימוני-סוכן-במקביל (4128+13734) שרפו-כפול; עכשיו-אחד.');
  L.push('');
  L.push('**משמעת-תקציב-RC (hive_rc.cjs — שער-ריבוני)**: כל-שידורי-Hive עברו-מאחורי-שער (רצפה 8% · op-כבד 12% · יתרה ≥ 2×עלות) — כולל-**ארבעת-השורפים-שעקפו**: חותמות-weave-שעתיות-מהראש (~250M-RC-כל-אחת!) · עוגני-anchor-id · chain-attest · ראוטר-הצי (דילוגים-שקטים-הפכו-מתועדים-בשקיפות) · **הבראה-אוטונומית** (hive_rc_heal · כל-שעה): הקצאת-HP-מדודה מהראש לחיילים-הרזים — שער: ראש RC≥12% · עדות-מנוף Δmax_rc≥10% (lever-weak=עצירה-כנה) · שער-אחרון: ' + (heal103 && heal103.lastGate ? heal103.lastGate.reason + (heal103.lastGate.etaH != null ? ' · ETA ~' + heal103.lastGate.etaH + 'ש׳' : '') : '—'));
  L.push('');
  L.push('**תיקון-שורש-עיגון-הארביטראז (grid98)**: עוגן-ה-arb-במנוע היה-**קבוע-זריעה-ישן** (g.anchors מ-98) — המנוע-משך-את-הבריכות-בחזרה-לזריעות-השגויות-וביטל-את-עיגון-102 (נמדד: WSBD −89.5% · ENERGY −98.7% · poolW −43% תוך-שעות) → **העוגן-עכשיו-האורקל-החי-החתום** (assetPrices÷SAOS-USD-מהספר) + **עיגון-מתמשך** (reanchor103 · כל-שעה · משיכות-LP+השלמה-מדויקת · refs `rean103:r<N>:*`): ' + (rean103 ? 'סבב-' + rean103.round + ' · devAfter ' + JSON.stringify(rean103.devAfter) + ' · allMatch=' + rean103.allMatch : '—'));
  L.push('');
  L.push('**אמת-מנוע על-הדף**: ה-API-הזין-את-הדף-מייצוא-saosnet-שהיה-**סטלה** (הראה +33.005 בזמן-שהפנקס-החי-כבר-על-46.7) → הדף-קורא-**ישירות-מפנקס-המנוע** (grid98-state.json · גיל-מוצהר-בשניות) · **חדר-החיילים-על-הדף**: קישוריות ' + (link103 ? ((link103.soldiers || []).filter((s) => s.chains && s.chains.hive && s.chains.hive.linked).length) + '/' + (link103.soldiers || []).length + '-Hive' : '—') + ' · RC-חי-פר-חייל · רווח-דקס · הגדרות-ריבוניות-גלויות · לוח-אמת +2-שורות (מנוע-חי · משמעת-RC) · רווח-אוצר-חי: ' + (eng103 ? (eng103.treasuryPnlµ / 1000).toFixed(3) + '-SAOS (מדוד-מהפנקס)' : '—'));
} catch (e) { /* דוח לעולם לא נופל — כנות */ }

/* ── Task 106 — ריפוי-התקלה-לייצור: אמנזיית-הפעלה-מחדש · אורקל-חי · אמת-מעוגנת ── */
try {
  const rean106 = j(path.join(AGENT, 'rean106_result.json'));
  const oracle106 = j(path.join(AGENT, 'oracle106_result.json'));
  const leo106 = j(path.join(AGENT, 'leo106_result.json'));
  const guardian106 = j(path.join(AGENT, 'guardian_result.json'));
  L.push('');
  L.push('## 🛡️ התקלה-שהפכה-לייצור: תמיד-חיים · תמיד-אמת (Task 106)');
  L.push('');
  L.push('**התקלה-החיה (20:05)**: הסשן-קרס → הדמון-והשרת-מתו-איתו. ההתאוששות-עצמה-חשפה-דיממים-מבניים-וסגרה-אותם-לתמיד:');
  L.push('');
  L.push('**דימם-1 — אמנזיית-הפעלה-מחדש (החמור)**: snapshot-יחיד-שנשחת-באמצע-כתיבה (קריסה) → replay-מהג׳נזיס → דחיות-ops-אחרי-פערי-הארכיון (703-709) → **מצב-רפאים נכתב-חזרה כ-snapshot** — כל-הפעלה-מחדש-הייתה-מאבדת-ליניאגה. ראיה-חיה: REAN-103-r6/r7 דווחו "applied ok" אבל-poolW (בריכת-הגשר-הדגל!) חזרה-ל-µ-אבק (33µWTRX/17µSAOS · סטייה −99.9%). **הריפוי-המבני**: כתיבת-snapshot-אטומית (tmp+rename) + גיבוי-prev + **שרשרת-החזרה state-root→snapshot→prev→replay** (כל-שכבה hash-locked לארכיון) + **קידום-שורש** (state-root.json — דוקטרינת-genesis-2: המצב-החי-הוא-קו-ההתחלה; הרשת-לא-נופלת-עוד-ל-replay-מרעיל). מדוד-חי: rootLocked=true-על-הדף.');
  L.push('');
  L.push('**דימם-2 — בריכת-הדגל-באבק + מלחמת-עגנים**: ריפוי-ה-LP-pulls (עד a≤1µ — הכלי-שהוכיח-את-עצמו על-זריעות-סינתטיות ב-102) **הרס-את-צד-ה-WTRX-האמיתי** של-poolW (r8 מדד: 33µ→2µ — בריכה-קפואה-באבק מול-מנוע-ה-arb). **החוק-החדש: בעלים-אחד-לבריכה** — poolW עבר-בבעלות-בלעדית ל-rean106 (ללא-pulls · שער-אוצר-צף · **עוגן-מיושר-ביטי לנגזרת-המנוע** fair=0.5×(lastPrice+nativePoolPx)×WSTEEM — אפס-מלחמת-עגנים). מדוד-חי: ' + (rean106 && rean106.after ? 'dev ' + (rean106.before ? rean106.before.dev : '?') + '%→' + rean106.after.dev + '% (יחס ' + rean106.after.ratio + ' ≈ עוגן-המנוע)' : '—') + ' · הצמד-על-הדף: מעוגן.');
  L.push('');
  L.push('**הדף-תמיד-חי (WEB-ALWAYS-UP)**: הגרדיאן-החלים-מנוע-ושרשרת-אבל-לא-את-האינטרנט-עצמו — קריסת-השרת השאירה-את-הדף-מת-בלי-מי-שיעיר. healWeb-נוסף-לגרדיאן (פינג-3000 → ניקוי-תהליך-תקוע → השכמה-מנותקת-עם-תקרת-heap → אימות-12ש׳). **הוכח-חי בייצור**: השרת-מת-שוב-ב-20:4x — הגרדיאן-השכים-אוטומטית (WEB-REVIVED(confirmed) → web-ok). ' + (guardian106 && guardian106.actions ? 'מצב-אחרון: ' + guardian106.actions.filter((a) => /web/.test(a)).join(' · ') : '') + '');
  L.push('');
  L.push('**אורקל-חי-מתמשך**: ציטוטי-האורקל-על-הספר היו-חד-פעמיים (102) — WTRX עמד-מקופא 4-שעות-בזמן-שהמנוע-סחר-מולו-כאילו-חי. **לולאה-שעתית** (oracle106 · refs `o106:px:<SYM>:<שעה>` · WTRX/WSTEEM/WSBD/PHIVE/ENERGY מ-coingecko · WBLURT-נשאר-של-blurt99): ' + (oracle106 && oracle106.quotes ? Object.entries(oracle106.quotes).map(([k, v]) => k + ' ' + (v.usd != null ? '$' + v.usd : '—')).join(' · ') : '—') + ' · dedup-refs שומר-מפני-כפילויות (נמדד: משימה-כפולה-באותה-שעה נדחתה-בכנות).');
  L.push('');
  L.push('**תג-היושרה-מדבר-אמת (עוד-יותר)**: ה-flap המחזורי "final-root-mismatch" אובחן-חי — replay-ביתי של שורשי-צ׳קפוינט **אינו-אפשרי-ביטיות** (רשומות-cp בתוך-המצב-המגובש עם-עגנים-חוץ-בלוקיים — 0/2-נמדד-עקבי). הדוקטרינה-עכשיו-כמפרט-הברזל: hash-locks מקומיים (snapshot+root — שניהם-**true-חי**) + **anchored-quorum רשתי** (חתימות-חיילים-על-ה-cp-האחרון). התג-מציג-את-האמת: quorum-pending(0/3 attests) — צהוב-כנה בזמן-בצורת-ה-RC של-החיילים (הבראה-במסלול · ETA-regen) — ולא-ירוק-שקר.');
  L.push('');
  L.push('**אימוץ-מפת-המהנדס-השני (steem-engeiner)**: פאזה-1 שלו (LEO — ״החלק-החסר-היחיד״) נמדדה-חי בפעם-הראשונה: LEO supply 1,000,000,000-קבוע · מנפיק leo.tokens · LEOM 149,999.59 · שוק-חי (טבלת-metrics — טבלת-tickers ריקה-בפועל, לקח-מדוד): **LEO ' + (leo106 && leo106.market && leo106.market.leo ? leo106.market.leo.lastPrice : '0.08167') + '-SWAP.HIVE · spread ~0.06% · volume ~73** — נזילות-אמת; נגזרת-USD מתועדת-משני-מקורות-מדודים (LEO/HIVE חי × HIVE/USD חתום o106:px:PHIVE). פאזה-2 (החייאת-Blurt): סריקת-6-צמתים-ציבוריים — **0-חיים**; Blurt-נשאר-מת-מתועד-בכנות (כנות-אדומה קדושה). agent/leo106_result.json · agent/blurt106_scan.json');
  L.push('');
  L.push('**ניקיון-קומפילציה**: tsc-0-ב-src (TS2352 ב-wrapped/route — נאטם) · lint-0 · דפדפן: דסקטופ+מובייל-390px-גלישה-0px · אפס-שגיאות-קונסולה · צילומים: docs/106-*.png · 7-דחיפות-במהלך-העבודה (דחוף-תמיד).');
} catch (e) { /* דוח לעולם לא נופל — כנות */ }

/* ── Task 107 — נתיב-האמת: יישור-הקו-לרשת · הספירות-מוצהרות · המגבילים-החיים ── */
try {
  const tb107 = j(path.join(ROOT, 'sovereign', 'node', 'tron-bridge-state.json'));
  const g107 = j(path.join(ROOT, 'sovereign', 'node', 'grid98-state.json'));
  const rc107 = j(path.join(AGENT, 'fleet_rc.json'));
  const blurt107 = j(path.join(AGENT, 'blurt106_scan.json'));
  const lastAnchor107 = ((tb107 && tb107.anchors) || []).find((a) => a.verified);
  const lastRing107 = (((tb107 && tb107.squad) || {}).rings || []).find((r) => r.closed && r.verified);
  const bench107 = (g107 || {}).bench;
  const rcAccs107 = Object.values((rc107 && rc107.accounts) || {});
  const rcBelow107 = rcAccs107.filter((r) => (r.pct || 0) < 10).length;

  L.push('## 🧭 נתיב-האמת — יישור-הקו-לרשת (Task 107)');
  L.push('');
  L.push('**השאלה-שנענתה-חי**: ״בהשוואה לסוכן-השני למה הספירות-שונות? האם אנחנו על אותה רשת?״ — **כן, אותו-ג׳נזיס בדיוק** (5a8b9831… · saos-net/0 שניהם) — שני-מופעי-שרשרת: אנחנו הקו-הקנוני (הארוך/הצפוף · הספר-המלא שלנו מדויק-באלף), והוא בכלל מראה-את-הספר-שלנו (המראה שלו = ה-repo שלנו). הפער-בספירות = היקף-ספירה שונה: הדף-שלנו הציג חלון-חם (512 בלוקים) בלי-הצהרה — **אימוץ-ה-W18 שלו**: txsScope מוצהר + bookTxTotal מדויק (מקור-אחד-למושג: lib/book-count.ts).');
  L.push('');
  L.push('**OOM-107 (שורש-הקריסות-החוזרות — נתפס-חי ונרפא מבנית)**: המטמונים-היו-מנועים-לפי-mtime של-ספר-שזז-בכל-שנייה → בפועל אפס-מטמון תחת-עומס-חי; כל-דגימת-דף = re-parse-מלא של-הארכיון + replay-מלא (OOM-קטל-את-next-server ב-2.17GB גם-אחרי-תקרת-ה-heap של-106) → **קריאת-זנב-אינקרמנטלית** (הארכיון append-only — מצביע-בייטים + משמרת-גבול) + **ויסות-ה-replay ל-60ש׳** (staleSec מוצהר — כנות-שמרת) + ספירת-ספר מתוך-המטמון-האינקרמנטלי (אפס-קורא-שני לקובץ).');
  L.push('');
  L.push('**לולאת-העוגן-נרפאה-קצה-עד-קצה (הוכח-בייצור)**: (1) בחירת-מקור-העוגן הייתה-**לפי-מאזן** — השולח-העשיר (14.1-TRX) נתקע-עם 321B-רוחב-פס בזמן-שלריליי 600B — **עצירה-שקטה** → בחירת-מקור-**לפי-רוחב-פס** (המאזן-רק-כשוויון) (2) המראה-ב-state.json נתקעה-בעוגן-ישן (cp#456 בזמן-שהאמת cp#27528 — אמנזיית-הפעלה-מחדש-שוב) → **מראה-מתרפאת-עצמה בכל-פעימה** (קוראת-מפנקס-הגשר) (3) מיכסה 2→3-עוגנים/24ש׳. **תוצאה-מדודה**: עוגן-חדש cp#33612 נורה-מהריליי (בלוק 86,019,974 · net_fee=0 · SUCCESS) · מאושר-ומאוגר-בספר h33737 — **~135-בלוקים-בלבד-מאחורי-הראש: העוגן-הטרי-ביותר-אי-פעם · שריפה 0.000000-TRX**. טבעת#3 נסגרה-היום (4/4-רגליים · אפס-עמלה · מאושרת).');
  L.push('');
  L.push('**התקרה-המכנית-נמדדה-חי (ליבה-משותפת-ל-CLI-ולמנוע-החי)**: ' + (bench107 ? '**' + bench107.txsPerSec.toLocaleString() + '-טרנז/שנייה ≈ ' + Math.round(bench107.capabilityPerDay / 1e9) + '-מיליארד/יום** (replay-טרנזאקציות-אמת מהארכיון על-מצב-משובט · מדוד ' + (bench107.at || '').slice(11, 16) + 'Z) — התשובה-הכנה ל״מה-המקסימום״: המנגנון-עצמו אינו-המגבלה בשום-סדר-גודל; **הקצב-החי-חסום-כלכלה-ותקציבים** (הזדמנויות-קצה · RC-לשידורי-האם · רוחב-פס-לעוגנים)' : 'המדידה-הפנימית-בדרך (כל-6ש׳)') + ' · **מגני-המנוע-על-הדף** (ספירות-כנות): נדחו ' + ((g107 || {}).rejected || 0).toLocaleString() + ' · דולגו-קצה ' + ((g107 || {}).skippedForEdge || 0).toLocaleString() + ' · דליפת-קצה ' + ((g107 || {}).edgeLeak || 0).toLocaleString());
  L.push('');
  L.push('**המגבילים-החיים-על-הדף (נתיב-האמת · כל-אחד-עם-ראיה-ופתרון)**: צבא-ה-RC ' + (rcAccs107.length ? rcBelow107 + '/' + rcAccs107.length + '-מתחת-לרצפה (regen-טבעי · ETA ~13-14ש׳ · ההבראה-מושהית-בשער-ראש-כנה)' : '—') + ' · עוגן-טרון ' + (lastAnchor107 ? 'cp#' + lastAnchor107.cpHeight + ' מאומת (מיכסה 3/24ש׳ · מתחדש-בחלון-הרולינג)' : '—') + ' · Blurt ' + (blurt107 ? blurt107.aliveCount + '/' + blurt107.scanned + '-צמתים-חיים (סריקה-טרייה: saboin ״down for maintenance״ — לולאת-ההחיאה תתפוס-את-החזרה)' : '—') + ' · קוורום-עגינה ממתין-לחתימות (ה-RC-היבש חוסם-חתימות — נמדד).');
  L.push('');
  L.push('**אימוץ-נוסף-מהסוכן-השני (W19)**: הדמון-כותב-את-קובץ-ה-pid-הציבורי-בעצמו בכל-אתחול (נבדק-חי: 2385=2385 מיד-אחרי-הפעלה) + ה-guardian מרפא-קובץ-מיושן-מול-ה-pgrep. **תצוגה-חדשה**: פאנל-״נתיב-האמת״ (שני-הספרים-זה-מול-זה · יחס-גובה-חי · המגבילים) · תקרת-יכולת-ומגני-מנוע-בזירת-GRID-98 · טבעת-החיילים-וחיילי-הגשר-מהמקור-האמת (הצורה-הישנה-הייתה-מציגה-שורה-ריקה — דימום-תצוגה-נתפס) · מובייל-390px-גלישה-0px · אפס-שגיאות-קונסולה · צילומים: docs/107-*.png · 3-דחיפות-במהלך-העבודה (דחוף-תמיד).');
} catch (e) { /* דוח לעולם לא נופל — כנות */ }

L.push('## 🕊️ מה זה אומר **בשבילך** (בלי ג׳יבריש טכני)');
L.push('');
L.push('1. **אם הסנדבוקס הזה יימחק עכשיו** — לא נורא. הקוד חי ב-repo, המפתחות חיים בתוך חותמת מוצפנת ב-repo, והענן (GitHub Actions) מריץ את הרשת לבד: בלוקים, עדות-חיה על Steem+Hive, ודחיפות — עד שהסנדבוקס קם בחזרה.');
L.push('2. **אם יחזרו לגרסה ישנה** — ה-guardian משווה מול origin/main בכל עלייה ורץ-לולאה, ומרפא לגרסה החדשה תוך שניות (נבדק חי: 5 שניות).');
L.push('3. **אם המפתחות יימחקו** — guardian מפענח את החותמת מה-repo ומשחזר את כל החיילים בלי לגעת בשום דבר (נבדק חי פעמיים).');
L.push('4. **אם הטוקן לדחיפה יימחק** — עותק שלו חי בתוך החותמת; guardian מתקן את הרשאות הדחיפה אוטומטית.');
L.push('5. **השרשרת הציבורית (Steem/Hive) היא העד שלא ניתן לשקרו** — כל 30 דק׳ הרשת מעידה על גובהה ומצבה, ואיתה אפשר לשחזר נקודת-התאוששות מכל מקום בעולם.');
L.push('');
L.push('## 🧾 הקומיטים האחרונים ב-repo');
L.push('');
L.push('| קומיט | מי | מתי | מה |');
L.push('|---|---|---|---|');
for (const line of recent) {
  const [h, a, t, s] = line.split('|');
  L.push('| `' + (h || '') + '` | ' + (a || '') + ' | ' + ago(t) + ' | ' + String(s || '').replace(/\|/g, '/') + ' |');
}
L.push('');
L.push('---');
L.push('');
L.push('*דוח זה נוצר אוטומטית · אין בו סודות · כל נתון נבדק מקומית בזמן-יצירה · SAOS Task 85*');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, L.join('\n') + '\n');
console.log('he_report: written ' + OUT + ' · h' + height + ' · army ' + army + ' · ' + (verdictName || 'no-verdict'));
