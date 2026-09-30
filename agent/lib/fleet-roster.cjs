'use strict';
/**
 * fleet-roster.cjs — THE ONE ROSTER (Task 10 truth-unification, 2026-09-30; Task 11-c control flags, 2026-10-01).
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
 * Task 11-c (2026-10-01) — הנחיית-הבעלים "אין לי עוד מפתחות":
 *   כל-שורה (חשבון × שרשרת, 12×3=36) נושאת עתה דגלי-שליטה קריאים-למכונה:
 *     control       : "full" | "partial" | "operator-delegated" | "blocked-no-key"
 *     economicUse   : boolean — האם מותר/ניתן להשתמש בשורה כלכלית (מסחר/הנפקה/פעולות-ערך)
 *     blockedReason : string|null — סיבה-כנה כשאין-שליטה-מלאה
 *   הדגלים מתארים את-האמת-הקבועה-המאומתת (מטריצת-השליטה fleet_control_audit.json
 *   asOf 2026-09-30 + הנחיית-הבעלים 2026-10-01). כספת-ראשונה נשארת הסמכות:
 *   vaultKeyMaterial מסמן אם-לכספת החיה יש חומר-מפתח לחשבון (גוף-מפתח אחד-משותף
 *   לשלוש-השרשראות — נוכחות בכספת אינה-שולטת-בכל-שרשרת; השליטה נמדדת-מול-השרשרת).
 *   דוגמה-כנה: ל-tov יש חומר-בכספת ששולט-steem+blurt, אך tov-hive נשאר blocked-no-key.
 *
 * שימוש:  const { roster, rows, controlFor } = require('./lib/fleet-roster.cjs');
 *          const r = roster();            // { source, accounts, activeFleet, retired, warning, rows }
 *          r.accounts.forEach(a => ...);  // לאחור-תואם — לא-השתנה
 *          rows().forEach(row => ...);    // 36 שורות עם דגלי-השליטה
 * חוק-ברזל: אפס-סודות כאן. רק שמות-חשבון ציבוריים ודגלים.
 */
const fs = require('fs');
const path = require('path');

const AGENT_DIR = __dirname ? path.join(__dirname, '..') : 'agent';
const VAULT_PATH = path.join(AGENT_DIR, 'keys', 'vault.json');

/** הרישום הקבוע-המאומת: 12 חשבונות-שרשרת (היסטוריים) — מאומתים ב-empire_60.json (09-05)
 *  ו-energy_census.json (חי, 09-30).
 *  אמת-חיה: הצי-החי = 11 (ראש + 10 חיילים). ynet פרש בהחלטת-ריבון 2026-09-30
 *  ("אין לנו מפתח ynet — אנחנו מוותרים עליו"): אפס-מפתחות ב-8+ דורות-כספת,
 *  אפס-פעולות-אפשריות. הוא נשאר ברשימה רק כחשבון-שרשרת-היסטורי, מסומן-פרוש.
 *  כל-צרכן-פלטה חייב להציג activeFleet (11) — לא accounts (12) — בתור "הצי". */
const RETIRED_ACCOUNTS = Object.freeze(['ynet']);

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

const CHAINS = Object.freeze(['steem', 'hive', 'blurt']);

/** ברירת-המחדל לשורה-שאינה-חריגה: שליטה-מלאה (מאומתת במטריצת-השליטה asOf 2026-09-30:
 *  STEEM 11/12 · BLURT 11/12 · HIVE 9/12 — החריגים בלבד מפורטים ב-CONTROL_STATUS). */
const CONTROL_DEFAULT = Object.freeze({ control: 'full', economicUse: true, blockedReason: null });

/** חריגי-השליטה (Task 11-c, 2026-10-01) — הנחיית-הבעלים "אין לי עוד מפתחות":
 *  מה-שנמדד (fleet_control_audit.json 2026-09-30) + מה-שהבעלים קבע (2026-10-01).
 *  כל-שאר-השורות = CONTROL_DEFAULT. */
const OP_DELEGATED = Object.freeze({
  control: 'operator-delegated',
  economicUse: false,
  blockedReason: 'operator-delegated — no operator key material (retired by sovereign decision 2026-09-30); posting only via @headcorner account-auths; economic use false unless head explicitly acts',
});
const CONTROL_STATUS = Object.freeze({
  tov: Object.freeze({
    hive: Object.freeze({
      control: 'blocked-no-key',
      economicUse: false,
      blockedReason: 'keys lost — owner-held; owner confirmed 2026-10-01 no more keys exist; NO economic use',
    }),
  }),
  ynet: Object.freeze({
    steem: OP_DELEGATED,
    hive: OP_DELEGATED,
    blurt: OP_DELEGATED,
  }),
  headcorner: Object.freeze({
    hive: Object.freeze({
      control: 'partial',
      economicUse: false,
      blockedReason: 'different key material — operator hive keys not held by vault/master (measured fleet_control_audit.json 2026-09-30: hive 0/4)',
    }),
  }),
});

/** דגלי-השליטה של חשבון×שרשרת — השכבה-הקבועה-המאומתת (לא-תלוית-כספת). */
function controlFor(account, chain) {
  const over = CONTROL_STATUS[account] && CONTROL_STATUS[account][chain];
  return over ? Object.freeze({ ...CONTROL_DEFAULT, ...over }) : CONTROL_DEFAULT;
}

/** אילו-חשבונות יש-לכספת-החיה חומר-מפתח (גוף-אחד-משותף לשלוש-השרשראות).
 *  מחזיר null כשהכספת נעדרת. נוכחות ≠ שליטה-בכל-שרשרת (ראה header). */
function vaultKeyMaterialByAccount() {
  try {
    const v = JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8'));
    const map = {};
    for (const a of (v.accounts || [])) {
      const k = a.keys || {};
      map[String(a.username || '').toLowerCase()] = !!(k.posting || k.active || k.owner || k.memo);
    }
    return map;
  } catch (_) { return null; }
}

function resolveNames() {
  try {
    const v = JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8'));
    const accounts = (v.accounts || [])
      .map(a => (a.username || a.account || '').toLowerCase())
      .filter(Boolean);
    if (accounts.length) {
      return {
        source: 'vault',
        names: [...new Set([...accounts, 'headcorner'])].sort(),
        warning: null,
      };
    }
  } catch (_) { /* vault absent — fall through, loudly */ }
  return {
    source: 'fallback-constant',
    names: [...ROSTER_FALLBACK],
    warning:
      'agent/keys/vault.json absent — roster served from the chain-anchored fallback constant. ' +
      'Restore the vault (REVIVAL runbook) to switch this to source:vault.',
  };
}

/** 36 שורות (12 חשבונות × 3 שרשראות) עם דגלי-שליטה קריאים-למכונה. */
function rows() {
  const r = resolveNames();
  const material = vaultKeyMaterialByAccount();
  return r.names.flatMap(a => CHAINS.map(c => {
    const flags = controlFor(a, c);
    return {
      account: a,
      chain: c,
      retired: RETIRED_ACCOUNTS.includes(a),
      control: flags.control,
      economicUse: flags.economicUse,
      blockedReason: flags.blockedReason,
      vaultKeyMaterial: !!(material && material[a]),
    };
  }));
}

function roster() {
  const r = resolveNames();
  return {
    source: r.source,
    accounts: r.names,
    activeFleet: r.names.filter(n => !RETIRED_ACCOUNTS.includes(n)),
    retired: [...RETIRED_ACCOUNTS],
    warning: r.warning,
    rows: rows(),
  };
}

/** שם-אחד לא יכול להשתנות בטעות: האופרטור קבוע. */
const OPERATOR = 'headcorner';

module.exports = { roster, rows, controlFor, CONTROL_STATUS, CONTROL_DEFAULT, CHAINS, OPERATOR, ROSTER_FALLBACK, RETIRED_ACCOUNTS, VAULT_PATH };

if (require.main === module) {
  const r = roster();
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    source: r.source,
    accounts: r.accounts,
    activeFleet: r.activeFleet,
    retired: r.retired,
    warning: r.warning,
  }, null, 2));
  for (const row of r.rows) {
    console.log(
      row.account.padEnd(11) + ' ' + row.chain.padEnd(6) +
      ' control=' + row.control +
      ' economicUse=' + row.economicUse +
      ' vaultKeyMaterial=' + row.vaultKeyMaterial +
      (row.blockedReason ? ' · ' + row.blockedReason : '')
    );
  }
  console.error(`chain-accounts=${r.accounts.length} activeFleet=${r.activeFleet.length} retired=${r.retired.join(',') || 'none'} rows=${r.rows.length}`);
}
