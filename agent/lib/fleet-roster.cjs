'use strict';
/**
 * fleet-roster.cjs — THE ONE ROSTER (Task 10 truth-unification, 2026-09-30).
 *
 * הבעיה שנסגרת כאן: היו 4+ שכבות-רישום מתחרות —
 *   agent/keys/vault.json   (הקנוני-לפי-תכנון, אך חסר-בדיסק אחרי-איפוס-סביבה)
 *   fleet_census.cjs NAMES  (קבוע-מקודד)
 *   empire_60.cjs ACCOUNTS  (קבוע-מקודד)
 *   agents-registry.json    (סטאב "ops-agent-1" — שער-סוכנים 117p, לא-פליטה)
 * וכל צרכן נפל לשכבה-שלו → מספרים-סותרים בדפים ובדוחות.
 *
 * החוק מעתה: כל-צרכן-פליטה מייבא מכאן. מקור-האמת:
 *   1) agent/keys/vault.json (כספת חיה — אם קיימת)
 *   2) ROSTER_FALLBACK (הקבוע המאומת בשרשרת: wallets-public.json digest 4442c2b9,
 *      עוגן 9f593bdc; census 09-05 + census חי 09-30 שניהם מאשרים את אותם 12)
 * הפלט תמיד חושף מאיזה-מקור נגזר — כדי שאף-מספר-פליטה לא יוצג כ"חי" כשהוא צל.
 *
 * שימוש:  const { roster } = require('./lib/fleet-roster.cjs');
 *          const r = roster();            // { source, accounts, warning }
 *          r.accounts.forEach(a => ...);
 * חוק-ברזל: אפס-סודות כאן. רק שמות-חשבון ציבוריים.
 */
const fs = require('fs');
const path = require('path');

const AGENT_DIR = __dirname ? path.join(__dirname, '..') : 'agent';
const VAULT_PATH = path.join(AGENT_DIR, 'keys', 'vault.json');

/** הרישום הקבוע-המאומת (12): headcorner + 11 חיילים.
 *  מאומת: empire_60.json (09-05) ו-energy_census.json (חי, 09-30) — אותם 12 שמות. */
const ROSTER_FALLBACK = Object.freeze([
  'headcorner',
  'cashmachine',
  'haran',
  'israelnews',
  'lsa',
  'macrame',
  'siq',
  'tov',
  'wic',
  'wog',
  'woq',
  'ynet',
]);

function roster() {
  try {
    const v = JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8'));
    const accounts = (v.accounts || [])
      .map(a => (a.username || a.account || '').toLowerCase())
      .filter(Boolean);
    if (accounts.length) {
      const names = [...new Set([...accounts, 'headcorner'])].sort();
      return { source: 'vault', accounts: names, warning: null };
    }
  } catch (_) { /* vault absent — fall through, loudly */ }
  return {
    source: 'fallback-constant',
    accounts: [...ROSTER_FALLBACK],
    warning:
      'agent/keys/vault.json absent — roster served from the chain-anchored fallback constant. ' +
      'Restore the vault (REVIVAL runbook) to switch this to source:vault.',
  };
}

/** שם-אחד לא יכול להשתנות בטעות: האופרטור קבוע. */
const OPERATOR = 'headcorner';

module.exports = { roster, OPERATOR, ROSTER_FALLBACK, VAULT_PATH };

if (require.main === module) {
  const r = roster();
  console.log(JSON.stringify({ at: new Date().toISOString(), ...r }, null, 2));
}
