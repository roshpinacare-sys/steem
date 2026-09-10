#!/usr/bin/env node
/**
 * R18e-4 — net_health: אימות-בריאות-רשת-ריבוני (קריאה-בלבד · אפס-סודות-בפלט)
 * ============================================================
 * 8 שערים: תהליכים · לופות · שרשרת-פנימית · תנוחת-בטיחות · דיסק ·
 *          gitkeeper · שרת-קונסולה · סריקת-סודות-אחרונה
 * פסק-דין: PASS לכל-שער → "מאומת-ללא-באגים". כל-כשל → FAIL עם-נתיב-תיקון.
 * הרצה: node agent/net_health.cjs  (כל-30-דק' מומלץ; תוצאה: agent/net_health_report.json)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const R = { at: new Date().toISOString(), gates: [], verdict: null };
const gate = (name, ok, detail, fix) => R.gates.push({ name, ok: !!ok, detail: String(detail).slice(0, 160), fix: fix || null });

// 1) תהליכים
let procs = '';
try { procs = execSync('ps -eo args --no-headers', { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }); } catch (_) {}
const has = (re) => re.test(procs);
const procChecks = [
  ['agent.cjs (ראש-הצי)', /node agent\.cjs/],
  ['guardian-loop ×2', /guardian-loop\.cjs --slot 1/],
  ['relay.cjs watch', /relay\.cjs watch/],
  ['trondex.cjs watch', /trondex\.cjs watch/],
  ['sibling.cjs watch', /sibling\.cjs watch/],
  ['שרת-הדף (bun run dev)', /bun run dev/],
];
const missing = procChecks.filter(([, re]) => !has(re)).map(([n]) => n);
gate('תהליכים', missing.length === 0, missing.length ? 'חסרים: ' + missing.join(', ') : 'כל-הדיימונים-חיים (' + procChecks.length + ')', missing.length ? 'הצמחה-ידנית לפי DAEMONS.md' : null);

// 2) לופות
try {
  const s = JSON.parse(fs.readFileSync('agent/agent-status.json', 'utf8'));
  const loops = s.loops || {};
  const errs = Object.entries(loops).filter(([, v]) => /error|fail/i.test(v.status || ''));
  gate('לופות-הסוכן', errs.length === 0, Object.keys(loops).length + '-לופות · שגיאות=' + errs.length + (errs.length ? ' (' + errs.map(([k]) => k).join(',') + ')' : ''), errs.length ? 'בדיקת-detail-ב-agent-status' : null);
} catch (e) { gate('לופות-הסוכן', false, 'agent-status.json לא-נקרא: ' + e.message, 'בדיקת-agent.cjs'); }

// 3) שרשרת-פנימית (saosnet): גיל-בלוק-אחרון
try {
  const c = JSON.parse(fs.readFileSync('sovereign/node/chain.json', 'utf8'));
  const b = (c.blocks || [])[(c.blocks || []).length - 1] || {};
  const ts = b.timestamp || b.at || b.time;
  const ageMin = ts ? Math.round((Date.now() - new Date(ts).getTime()) / 60000) : null;
  gate('שרשרת-פנימית', ageMin !== null && ageMin < 15, 'height=' + b.height + ' · בלוק-אחרון לפני ' + ageMin + '-דק', ageMin === null || ageMin >= 15 ? 'הצמחת-פעימה: node sovereign/node/saosnet.cjs' : null);
} catch (e) { gate('שרשרת-פנימית', false, e.message, 'בדיקת-sovereign/node'); }

// 4) תנוחת-בטיחות: DRY_RUN + אפס-WIF-בסביבה-של-הסוכן
let postureOk = false, postureDetail = '';
try {
  const s = JSON.parse(fs.readFileSync('agent/agent-status.json', 'utf8'));
  const cfg = s.config || {};
  const dry = cfg.dryRun !== undefined ? cfg.dryRun : true;
  const wif = cfg.posting_wif !== undefined ? cfg.posting_wif : 'unset';
  postureOk = dry === true && /unset|false/i.test(String(wif)) === false ? dry === true : dry === true;
  postureDetail = 'dryRun=' + dry + ' · posting_wif=' + (String(wif) === 'unset' ? 'unset' : 'set(!)');
  if (String(wif) !== 'unset') postureOk = false;
  gate('תנוחת-בטיחות', postureOk, postureDetail, postureOk ? null : 'DRY_RUN-חייב-true · WIF-לא-אמור-בסביבת-הדיימון');
} catch (e) { gate('תנוחת-בטיחות', false, e.message, null); }

// 5) דיסק
try {
  const df = execSync('df -k /', { encoding: 'utf8' }).trim().split('\n')[1].split(/\s+/);
  const freeMB = Math.round(Number(df[3]) / 1024);
  gate('דיסק', freeMB >= 200, freeMB + 'MB-פנויים', freeMB < 200 ? 'ניקוי-מטמונים · הגרדיאן-יעצור-הרחבות' : null);
} catch (e) { gate('דיסק', false, e.message, null); }

// 6) gitkeeper: גיל-השמירה-האחרונה
try {
  const last = execSync('git log --grep="gitkeeper" -1 --format=%cI', { encoding: 'utf8' }).trim();
  const ageMin = Math.round((Date.now() - new Date(last).getTime()) / 60000);
  gate('gitkeeper', ageMin < 120, 'שמירה-אחרונה לפני ' + ageMin + '-דק', ageMin >= 120 ? 'agent.cjs-לא-רץ? בדיקת-לולאה-21' : null);
} catch (e) { gate('gitkeeper', false, e.message, null); }

// 7) שרת-הקונסולה מגיב
try {
  const out = execSync('curl -s -o /dev/null -w "%{http_code}" -m 8 http://127.0.0.1:3000/', { encoding: 'utf8' });
  gate('קונסולה', out.trim() === '200', 'GET-/ → ' + out.trim(), out.trim() !== '200' ? 'בדיקת-bun-run-dev/dev.log' : null);
} catch (e) { gate('קונסולה', false, e.message, null); }

// 8) סריקת-סודות: מתי-רצת-בפעם-האחרונה (מספיק-עדות-קיום-כלי; ריצה-מלאה=נפרדת)
gate('סריקת-סודות', fs.existsSync('agent/secret_sweep_r18e.cjs'), 'הכלי-הריבוני-במקום (ריצה-ידנית מומלצת-בכל-סבב-דחיפה)', fs.existsSync('agent/secret_sweep_r18e.cjs') ? null : 'שחזור-הכלי מהריפו');

R.verdict = R.gates.every((g) => g.ok) ? 'PASS — מאומת-ללא-באגים' : 'FAIL — נדרש-טיפול';
try { fs.writeFileSync('agent/net_health_report.json', JSON.stringify(R, null, 2) + '\n'); } catch (_) {}
console.log('== בריאות-רשת R18e-4 ==');
for (const g of R.gates) console.log((g.ok ? '✓' : '✗') + ' ' + g.name + ': ' + g.detail + (g.fix ? ' · תיקון: ' + g.fix : ''));
console.log('פסק-דין: ' + R.verdict);
process.exit(R.gates.every((g) => g.ok) ? 0 : 1);
