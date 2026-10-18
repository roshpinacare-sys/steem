// sandbox-restore.mjs — drill שחזור סנדבוקס agent-9 (אחרי אתחול/מחיקה)
// שימוש:  node sandbox-restore.mjs           → בדיקה בלבד (read-only)
//         node sandbox-restore.mjs --fix     → בדיקה + שחזור אקטיבי
// אפס סודות בקוד: ה-token נקרא בזמן ריצה מ-/home/z/.git-creds ולעולם לא מודפס.
// מקור ה-PAT (מתועד, ללא סוד): /home/z/my-project/upload/pat.env — הקובץ שהבעלים העלה.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const ORG = 'roshpinacare-sys';
const CREDS = '/home/z/.git-creds';
const PAT_SRC = '/home/z/my-project/upload/pat.env';
const ROOT = '/home/z/project-review';
const REPOS = ['Autonomy', 'Domain'];
const LOCAL_WORKLOG = '/home/z/my-project/worklog.md';
const INSURANCE = `${ROOT}/Autonomy/agents/agent-9`;
const PRIVATE_PROBE = 'steem'; // repo פרטי לבדיקת תקפות token (אנונימי ייכשל)
const FIX = process.argv.includes('--fix');

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  return ok;
}
function git(args, cwd) {
  return execFileSync('git', ['-c', `credential.helper=store --file=${CREDS}`, ...args], {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000,
  }).toString().trim();
}

console.log(`sandbox-restore drill ${FIX ? '(--fix: שחזור אקטיבי)' : '(בדיקה בלבד)'} — ${new Date().toISOString()}\n`);

// 1. תעודה: .git-creds קיים ותקין
let credsOk = false;
if (fs.existsSync(CREDS) && /https:\/\/[^:]+:([^@]+)@github\.com/.test(fs.readFileSync(CREDS, 'utf8'))) {
  credsOk = true;
} else if (FIX && fs.existsSync(PAT_SRC)) {
  const tok = fs.readFileSync(PAT_SRC, 'utf8').trim();
  if (/^github_pat_|^ghp_/.test(tok)) {
    fs.writeFileSync(CREDS, `https://${ORG}:${tok}@github.com\n`, { mode: 0o600 });
    fs.chmodSync(CREDS, 0o600);
    credsOk = fs.existsSync(CREDS);
    check('creds שוחזר מ-pat.env', credsOk);
  }
} else {
  check('creds קיים', false, FIX ? 'גם pat.env לא נמצא — נדרש PAT חדש מהבעלים' : 'הרץ עם --fix');
}
if (credsOk) check('creds קיים ותקין (600)', fs.existsSync(CREDS), CREDS);

// 2. תקפות token מול repo פרטי
let authOk = false;
if (credsOk) {
  try {
    const out = git(['ls-remote', `https://github.com/${ORG}/${PRIVATE_PROBE}.git`, 'HEAD']);
    authOk = /^[0-9a-f]{40}/.test(out);
    check('token תקף מול repo פרטי', authOk, authOk ? `ls-remote ${PRIVATE_PROBE} ענה SHA` : 'תשובה לא תקינה');
  } catch (e) {
    check('token תקף מול repo פרטי', false, String(e.message).split('\n')[0]);
  }
}

// 3. repos משוחזרים + סנכרון
for (const r of REPOS) {
  const dir = `${ROOT}/${r}`;
  if (!fs.existsSync(`${dir}/.git`)) {
    if (FIX && credsOk) {
      try {
        fs.mkdirSync(ROOT, { recursive: true });
        git(['clone', `https://github.com/${ORG}/${r}.git`, dir]);
        execFileSync('git', ['config', 'credential.helper', `store --file=${CREDS}`], { cwd: dir });
      } catch (e) { /* ייכשל בבדיקה למטה */ }
    }
  } else {
    execFileSync('git', ['config', 'credential.helper', `store --file=${CREDS}`], { cwd: dir });
  }
  if (fs.existsSync(`${dir}/.git`)) {
    try {
      git(['fetch', 'origin'], dir);
      const behind = git(['rev-list', '--count', `HEAD..origin/HEAD`], dir).toString();
      const ahead = git(['rev-list', '--count', `origin/HEAD..HEAD`], dir).toString();
      // סנכרון מלא אינו נדרש: האיברים דוחפים כל דקות — קיום ה-clone ו-fetch תקין = PASS, הפרש מדווח כנה
      check(`repo ${r} קיים ונגיש`, true, `ahead=${ahead} behind=${behind} @ ${git(['log', '--oneline', '-1'], dir).slice(0, 60)}`);
    } catch (e) {
      check(`repo ${r} קיים ונגיש`, false, String(e.message).split('\n')[0]);
    }
  } else {
    check(`repo ${r} קיים ונגיש`, false, FIX ? 'clone נכשל' : 'חסר — הרץ עם --fix');
  }
}

// 4. worklog מקומי
let wlOk = fs.existsSync(LOCAL_WORKLOG) && fs.statSync(LOCAL_WORKLOG).size > 10000;
if (!wlOk && FIX && fs.existsSync(`${INSURANCE}/worklog.md`)) {
  fs.copyFileSync(`${INSURANCE}/worklog.md`, LOCAL_WORKLOG);
  wlOk = fs.existsSync(LOCAL_WORKLOG);
  check('worklog שוחזר מהביטוח', wlOk);
}
if (wlOk) check('worklog מקומי קיים', true, `${fs.statSync(LOCAL_WORKLOG).size} bytes`);
else check('worklog מקומי קיים', false, FIX ? 'גם עותק הביטוח חסר' : 'הרץ עם --fix');

// 5. שלמות הביטוח ב-repo
if (fs.existsSync(INSURANCE)) {
  const hasReadme = fs.existsSync(`${INSURANCE}/README.md`);
  const hasWl = fs.existsSync(`${INSURANCE}/worklog.md`) && fs.statSync(`${INSURANCE}/worklog.md`).size > 10000;
  const tools = fs.existsSync(`${INSURANCE}/sandbox-tools`)
    ? fs.readdirSync(`${INSURANCE}/sandbox-tools`).filter((f) => f.endsWith('.mjs')).length : 0;
  check('ביטוח: README קיים', hasReadme);
  check('ביטוח: worklog גדול מספיק', hasWl, hasWl ? `${fs.statSync(`${INSURANCE}/worklog.md`).size} bytes` : '');
  check('ביטוח: כלים ≥15', tools >= 15, `${tools} tools`);
} else {
  check('ביטוח: תיקיית agents/agent-9', false, 'ה-clone עצמו חסר');
}

// פסק-דין כנה
const pass = results.filter(Boolean).length, total = results.length;
console.log(`\nVERDICT: ${pass === total ? 'PASS' : 'DEGRADED'} (${pass}/${total})`);
process.exit(pass === total ? 0 : 1);
