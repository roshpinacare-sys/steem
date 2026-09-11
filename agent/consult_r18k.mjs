#!/usr/bin/env node
/**
 * R18k — consult_r18k.mjs: התייעצות-אמיתית-עם-הסוכנים (רשת-משותפת · יישור-קו-סופי)
 *
 * מה-זה: לקחת את מצב-הרשת-החי (נמדד, לא הוערך), להעביר-אותו לארבעה-אישים-סוכנים,
 * ולקבל-מכל-אחד: (1) חריגות-מהמדידה (2) שלוש-הסתירות/סיכונים-הגדולים
 * (3) הקו-הסופי-שהוא-מציע-לאשר. הפלט → agent/consult_r18k.json (אפס-סודות).
 *
 * הרצה: node agent/consult_r18k.mjs
 */
'use strict';
import fs from 'fs';
import path from 'path';
import ZAI from 'z-ai-web-dev-sdk';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const read = (p) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return null; }
};

// ── 1. מצב-חי נמדד (קבצי-מצב בלבד · אפס-סודות-בפלט) ────────────────────────
const status = read('agent/agent-status.json') || {};
const linkage = read('agent/linkage_report.json') || {};
const weave = read('agent/weave_last.json') || {};
const health = read('agent/net_health_report.json') || {};
const fleetv3 = read('agent/fleetv3_state.json') || {};
const sweep = read('agent/corpus_resweep_report.json') || {};

const rcPct = status.rc ? Math.round((status.rc.current / status.rc.max) * 1000) / 10 : null;

const liveState = {
  measuredAt: new Date().toISOString(),
  daemon: {
    account: status.account || 'headcorner',
    dryRun: status.dryRun,
    rcPct,
    pendingClaims: status.pendingClaims,
    identity: {
      heTokens: status.identity ? status.identity.heTokens : null,
      heValueSwapHive: status.identity ? status.identity.heValueSwapHive : null,
    },
  },
  linkage: {
    soldiersTotal: linkage.soldiersTotal ?? null,
    linkedChains: linkage.linkedChains != null ? `${linkage.linkedChains}/${linkage.chainsTotal}` : null,
    unlinked: (linkage.soldiers || [])
      .flatMap((s) => Object.entries(s.chains || {}).filter(([, v]) => !v.linked).map(([k]) => `${s.username}/${k}`)),
  },
  weave: {
    mode: weave.mode || null,
    notes: (weave.notes || []).slice(0, 3),
    anchored: weave.anchored ? { seq: weave.anchored.seq, skipped: weave.anchored.skipped } : null,
  },
  fleetv3: {
    autopilotUnlocked: fleetv3.autopilot ? fleetv3.autopilot.unlocked : null,
    realSPTotal: fleetv3.autopilot ? fleetv3.autopilot.realSPTotal : null,
    rcRatioCur: fleetv3.autopilot ? fleetv3.autopilot.rcRatioCur : null,
    lastRunAt: fleetv3.autopilot ? fleetv3.autopilot.lastRunAt : null,
  },
  doctrine: {
    guardianOwnsAgentLifecycle: true,
    dryRunSafety: true,
    postingWifUnset: true,
    pushImmediatelyAfterEveryCommit: true,
    vault: 'KEYS-ZIP-2026-09-10.zip.enc + recovery-meta + README (triple-consistent)',
  },
  openItems: [
    'tov/hive — active-key-drift: מפתחות-הכספת-אינם-שולטים-בחשבון; דרוש-חומר-מפתחות-מהבעלים',
    'אטימת-הסוכן-השני — upload/ עדיין-בלי-אטימה-חדשה (ממתין-למפעיל)',
    'ynet-פוסטינג-דרך-הראש (headcorner) — פתוח-טכנית, ממתין-הוראה-מפורשת',
  ],
};

// ── 2. ארבעת-האישים (הרשת-המשותפת-של-הסוכנים) ───────────────────────────────
const AGENTS = [
  {
    id: 'saos-vault',
    name: 'Saosmartwallet · סוכן-הכספת',
    focus: 'ריבונות-מפתחות, כספת-מאוטמת, לינקג-הצי, גבולות-סודות',
  },
  {
    id: 'saos-netguard',
    name: 'NetGuard · משמר-הרשת',
    focus: 'תהליכים, גרדיאן, לולאות, דיסק/זיכרון, עמידות-לשטיפת-מכולה',
  },
  {
    id: 'saos-chainkeeper',
    name: 'ChainKeeper · משמר-השרשרת',
    focus: 'שלמות-שרשרת, אריגה (weave), עיגון-חותמות, ארכיון-פנימי, replay',
  },
  {
    id: 'saos-econ',
    name: 'EconWatch · משמר-הכלכלה',
    focus: 'RC/SP, fleetv3-autopilot, תגמולים-ממתינים, הזדמנויות-תשואה',
  },
];

const systemFor = (a) => [
  `אתה ${a.name} — סוכן-אוטונומי ברשת-המשותפת של SAOS (Steem AI Agent OS).`,
  `תחום-אחריותך: ${a.focus}.`,
  'אתה מדווח בעברית-בלבד, תמציתי, ובכנות-מוסדית: כל-טענה נשענת על המספרים-שבמצב-החי-שלפניך בלבד — אסור-להמציא-מספרים.',
  'אין-לך-גישה-למפתחות-פרטיים-ואינך-מבקש-אותם. תנוחת-הבטיחות (DRY_RUN=true, posting_wif=unset) היא-קבועה-שאין-להציע-לשנותה.',
  'החזר-בדיוק-במבנה-הבא:',
  'חריגות: <רשימה-קצרה או "אין">',
  'סתירות-סיכונים: <שלושה-סעיפים>',
  'קו-סופי-מוצע: <משפט-אחד-מדויק-לאישור>',
].join('\n');

const userFor = (a) => [
  `עמית-סוכן-עליון מבקש-התייעצות לקראת יישור-קו-סופי על-הכל (r18k).`,
  'מצב-החי-הנמדד (מקור: קבצי-מצב-של-המערכת, זה-עתה):',
  JSON.stringify(liveState, null, 1),
  `תפקידך-בדיון: ${a.focus}.`,
  'ענה-בעברית, במבנה-שנדרש, עד-180-מילים.',
].join('\n');

// ── 3. הרצת-ההתייעצות ───────────────────────────────────────────────────────
async function main() {
  const zai = await ZAI.create();
  const out = { at: new Date().toISOString(), round: 'r18k', liveState, consultations: [] };

  for (const a of AGENTS) {
    let content = null, err = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const completion = await zai.chat.completions.create({
          messages: [
            { role: 'assistant', content: systemFor(a) },
            { role: 'user', content: userFor(a) },
          ],
          thinking: { type: 'disabled' },
        });
        content = completion.choices[0]?.message?.content || '';
        if (content.trim()) break;
        throw new Error('empty response');
      } catch (e) {
        err = String((e && e.message) || e);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    out.consultations.push({ id: a.id, name: a.name, ok: Boolean(content && content.trim()), error: content ? null : err, response: content });
    console.log(`[${a.id}] ${content ? 'OK (' + content.length + ' chars)' : 'FAILED: ' + err}`);
  }

  fs.writeFileSync(path.join(ROOT, 'agent/consult_r18k.json'), JSON.stringify(out, null, 2) + '\n');
  console.log('written: agent/consult_r18k.json');
}

main().catch((e) => { console.error('FATAL:', e && e.message); process.exit(1); });
