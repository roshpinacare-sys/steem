#!/usr/bin/env node
/**
 * SAOS Agent — דימון מקומי אוטונומי עבור החשבון של המפעיל (Steem AI Agent OS).
 *
 * חמישה לופים (v2):
 *  1. לופ תביעה — כל CLAIM_INTERVAL_MIN דקות בודק יתרות-פרס ממתינות (VESTS/STEEM/SBD)
 *     ומבצע claim_reward_balance. שער-RC: אם RC% < RC_MIN_CLAIM_PCT — מדלג ("RC too low").
 *     רץ תמיד (גם בניטור בלבד — כדי להאכיל agent-status.json); חותם רק עם POSTING_WIF.
 *  2. לופ צופה חלון BOT-3 — כל WATCH_INTERVAL_MIN דקות קורא feed (current_median_history!)
 *     ו-order book, מחשב execEdge על 100 SBD, מזהה מעבר פתוח(≥10%)↔סגור, וכותב agent-status.json.
 *     יעילות v2: אם הפיד לא זז מהמחזור הקודם — מדלג על get_order_book ומשתמש בתמונת-מצב הקודמת.
 *  3. לופ צופה העברות נכנסות — get_account_history, התראה + lastIncoming בסטטוס (קריאה-בלבד).
 *  4. לופ קוראציה — סריקת תגיות, שער-VP (CURATION_MIN_VP_PCT), משקל הצבעה
 *     (CURATION_VOTE_WEIGHT_PCT), דה-דופ קבוע ב-curation_seen.json (500 כניסות, חיתוך מהישן).
 *  5. לופ מפעל חשבונות RC (B1) — כש-RC% ≥ FACTORY_RC_TRIGGER_PCT תובע טיקט חשבון
 *     (claim_account {creator, fee:"0.000 STEEM"}) במפתח ACTIVE בלבד, עד FACTORY_MAX_DAY ליום
 *     (UTC), עם רצפת RC (FACTORY_RC_FLOOR_PCT). מודד עלות-RC לפני/אחרי = מדידת A2 אוטומטית.
 *
 * יעילות RPC (v2): קאש תמונות-מצב בזיכרון (TTL CACHE_TTL_SEC=15) משותף לכל הלופים עבור
 * get_accounts + rc_api.find_rc_accounts — 5 לופים באותו-חלון = קריאת RPC אחת.
 *
 * חוק ברזל: המפתחות נשארים במכונה הזו בלבד. החתימה מקומית (steem-js), השידור ישר ל-RPC.
 * הסוכן לעולם לא שולח WIF לשרת כלשהו ולעולם לא רושם אותו ללוג.
 *
 * קריטי: להריץ תחת Node (>=18) — לא bun! bun שובר את ה-ecc של steem-js
 * (symbol lookup error ב-secp256k1 native).
 *
 * מצב ולידציה: `node agent.cjs --once` (או ONCE=1) — מחזור אחד של כל לופ (מכבד
 * enabled/disabled), כתיבת agent-status.json, ויציאה 0. בלי דימון.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const steem = require('steem');
const { deriveIdentities } = require('./identity.cjs');
const HIVE_RC = require('./hive_rc.cjs'); // 103 — RC-DISCIPLINE: שער-תקציב-ריבוני לכל-שידורי-Hive
const { runAnchor } = require('./anchor.cjs');
const { runChainAttest } = require('./chain_attest.cjs');

/* ------------------------------------------------------------------ *
 * .env — טעינה ידנית מבן-תיקייה (בלי dotenv)
 * ------------------------------------------------------------------ */
function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    // מה שהוגדר במעטפת מנצח על .env
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv(__dirname);

/* ------------------------------------------------------------------ *
 * קונפיג מ-env
 * ------------------------------------------------------------------ */
function parseMinutes(v, dflt) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}
function parseBool(v, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}
function parseIntVal(v, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}
function parsePct(v, dflt) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : dflt;
}

const VERSION = '0.2.0';
const CONFIG = {
  account: (process.env.AGENT_ACCOUNT || '').trim(),
  postingWif: process.env.POSTING_WIF || '',
  activeWif: process.env.ACTIVE_WIF || '',
  memoWif: process.env.MEMO_WIF || '',
  rpcUrl: (process.env.RPC_URL || 'api.steemit.com').trim(),
  claimMin: parseMinutes(process.env.CLAIM_INTERVAL_MIN, 60),
  watchMin: parseMinutes(process.env.WATCH_INTERVAL_MIN, 5),
  minClaimSp: (() => {
    const n = parseFloat(process.env.MIN_CLAIM_SP);
    return Number.isFinite(n) && n >= 0 ? n : 0.5;
  })(),
  dryRun: parseBool(process.env.DRY_RUN, true), // ברירת מחדל: מצב יבש!
  transferWatchMin: parseMinutes(process.env.TRANSFER_WATCH_MIN, 5),
  exReflexCooldownMin: parseMinutes(process.env.EXREFLEX_COOLDOWN_MIN, 10), // Task 55 — external-event reflex cooldown
  // קוראציה — כבויה עד אישור מפעיל (docs/AUTOMATION_BUILD_PLAN.md §B2)
  curationEnabled: parseBool(process.env.CURATION_ENABLED, false),
  curationTags: (process.env.CURATION_TAGS || 'steem,life,ai')
    .split(',').map((s) => s.trim()).filter(Boolean),
  curationMaxVotesDay: parseIntVal(process.env.CURATION_MAX_VOTES_DAY, 5),
  curationMinAgeMin: (() => {
    const n = parseFloat(process.env.CURATION_MIN_AGE_MIN);
    return Number.isFinite(n) && n >= 0 ? n : 5;
  })(),
  curationMinVpPct: parsePct(process.env.CURATION_MIN_VP_PCT, 80),
  curationVoteWeightPct: parsePct(process.env.CURATION_VOTE_WEIGHT_PCT, 100),
  // B1 — מפעל חשבונות RC (דורש ACTIVE_WIF; claim_account = רשות active)
  factoryEnabled: parseBool(process.env.FACTORY_ENABLED, false),
  factoryMin: parseMinutes(process.env.FACTORY_INTERVAL_MIN, 30),
  factoryMaxDay: parseIntVal(process.env.FACTORY_MAX_DAY, 5),
  factoryRcTriggerPct: parsePct(process.env.FACTORY_RC_TRIGGER_PCT, 80),
  factoryRcFloorPct: parsePct(process.env.FACTORY_RC_FLOOR_PCT, 20),
  // 38 — לידה אוטונומית של סוכנים: claim ticket → create_claimed_account + endowment SP
  factoryAutoMint: parseBool(process.env.FACTORY_AUTO_MINT, true),
  factoryBorrowVests: parseIntVal(process.env.FACTORY_BORROW_VESTS, 9920604), // 52 — סף-החומה הנמדד: vests-עצמיים מזעריים ל-borrow-mint (חומת-תביעה 6T = 4,336 SP הלוואה + עתודות)
  factoryAgentSp: parseIntVal(process.env.FACTORY_AGENT_SP, 50),
  factoryMaxAgents: parseIntVal(process.env.FACTORY_MAX_AGENTS, 3),
  factoryAgentPrefix: (process.env.FACTORY_AGENT_PREFIX || 'hcnova').toLowerCase(),
  // 38 — סריקת אימפריה: get_key_references דו-שרשרתי — אוטו-גילוי חשבונות שהמפתח-הראשי שולט בהם
  empireScanMin: parseMinutes(process.env.EMPIRE_SCAN_MIN, 30),
  // 43 — הצבא הכלכלי: חשבונות-צבא (keys/vault.json + סוכני-מפעל) — תביעה/קוראציה/ריכוז-ערך פר-חשבון
  armyCurationEnabled: parseBool(process.env.ARMY_CURATION_ENABLED, true),
  armyCurationMin: parseMinutes(process.env.ARMY_CURATION_INTERVAL_MIN, 45),
  armyCurationMaxVotesDay: parseIntVal(process.env.ARMY_CURATION_MAX_VOTES_DAY, 2),
  armyCurationMinVpPct: parsePct(process.env.ARMY_CURATION_MIN_VP_PCT, 70),
  armyClaimEnabled: parseBool(process.env.ARMY_CLAIM_ENABLED, true),
  armyClaimMin: parseMinutes(process.env.ARMY_CLAIM_INTERVAL_MIN, 60),
  armySweepEnabled: parseBool(process.env.ARMY_SWEEP_ENABLED, true),
  armySweepMin: parseMinutes(process.env.ARMY_SWEEP_INTERVAL_MIN, 360),
  // 48 — פעימת-צי: קצב-עסקאות ריבוני פר-חייל (fleet_ping + pool_swap fee-routing)
  fleetPaceMin: parseMinutes(process.env.FLEET_PACE_INTERVAL_MIN, 20),
  // 44 — SCI: יומן-עולם + ערוץ-פקודות
  worldlogMin: parseMinutes(process.env.WORLDLOG_INTERVAL_MIN, 30),
  commandBusMin: parseMinutes(process.env.COMMAND_BUS_INTERVAL_MIN, 2),
  // 45 — SAOS-Net mission queue
  netTaskMin: parseMinutes(process.env.NET_TASK_INTERVAL_MIN, 3),
  // 93 — verify15: רענון-טסטים — שש-הטענות נבדקות-מחדש מול-החי (הספר מפרסם-תמיד-טרי, לא-תוצאות-קפואות)
  verify15Enabled: parseBool(process.env.VERIFY15_ENABLED, true),
  verify15Min: parseMinutes(process.env.VERIFY15_INTERVAL_MIN, 120),
  // 94 — matrix: מטריצת-ההוכחות המלאה (161) נבדקת-מחדש בלולאה — הצ'יפ בראש-הדף לא-קופא יותר
  // (התלונה-המדויקת: הצ'יפ הציג 146/161 קפוא-מהבוקר — בפועל נמדד חי 141/161; עכשיו הלולאה מרעננת-תמיד)
  matrixEnabled: parseBool(process.env.MATRIX_ENABLED, true),
  matrixMin: parseMinutes(process.env.MATRIX_INTERVAL_MIN, 90),
  // 46 — ג׳נזיס-טוקן (מדרגת ערך → BEE → SAOS על Hive-Engine) + משכורת-השלמה לחיילים
  genesisEnabled: parseBool(process.env.GENESIS_ENABLED, true),
  genesisMin: parseMinutes(process.env.GENESIS_INTERVAL_MIN, 45),
  genesisMaxSpend: (() => {
    const n = parseFloat(process.env.GENESIS_MAX_SPEND);
    return Number.isFinite(n) && n > 0 && n <= 20 ? n : 2.5;
  })(),
  payrollEnabled: parseBool(process.env.PAYROLL_ENABLED, true),
  payrollPerTask: (() => {
    const n = parseFloat(process.env.PAYROLL_PER_TASK);
    return Number.isFinite(n) && n >= 0.001 && n <= 0.05 ? n : 0.004;
  })(),
  payrollDailyCap: (() => {
    const n = parseFloat(process.env.PAYROLL_DAILY_CAP);
    return Number.isFinite(n) && n > 0 && n <= 5 ? n : 0.12;
  })(),
  armySweepMinSteem: (() => {
    const n = parseFloat(process.env.ARMY_SWEEP_MIN_STEEM);
    return Number.isFinite(n) && n > 0 ? n : 1;
  })(),
  armySweepMaxDay: parseIntVal(process.env.ARMY_SWEEP_MAX_DAY, 2),
  // 44 — עוגן-זהות חוצה-פרדיגמות: חתימת EVM על אותו סקלר, מוטמעת custom_json (active) על Steem+Hive+Blurt כל 6h
  anchorEnabled: parseBool(process.env.ANCHOR_ENABLED, true),
  anchorMin: parseMinutes(process.env.ANCHOR_INTERVAL_MIN, 360),
  // 82 — LIVING-ATTEST: פעימת-העיד ריבונית — height+stateRoot+commit על Steem+Hive (id=saos.attest.v1)
  chainAttestEnabled: parseBool(process.env.CHAIN_ATTEST_ENABLED, true),
  chainAttestMin: parseMinutes(process.env.CHAIN_ATTEST_INTERVAL_MIN, 30),
  hivePowerMin: parseMinutes(process.env.HIVE_POWER_INTERVAL_MIN, 45),
  // 32-a — דקס SAOS-1/STEEM: עשיית-שוק ריבונית על אוטובוס custom_json (id="saos").
  // כל המחירים נגזרים מהגיבוי הנמדד (value-engine) — אף מחיר לא מקודד ידנית.
  dexApiUrl: (process.env.DEX_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, ''),
  dexMmEnabled: parseBool(process.env.DEX_MM_ENABLED, false),
  dexMmMin: parseMinutes(process.env.DEX_MM_INTERVAL_MIN, 12),
  dexMmBootMint: (() => {
    const n = parseFloat(process.env.DEX_MM_BOOT_MINT);
    return Number.isFinite(n) && n >= 0 && n <= 100000 ? n : 1000;
  })(),
  dexMmMaxAskSaos: (() => {
    const n = parseFloat(process.env.DEX_MM_MAX_ASK_SAOS);
    return Number.isFinite(n) && n > 0 ? n : 60;
  })(),
  dexMmDailyCap: parseIntVal(process.env.DEX_MM_DAILY_CAP, 24),
  dexMmEscrowPct: parsePct(process.env.DEX_MM_ESCROW_PCT, 50), // % מהנזיל ל-crowd-escrow (דורש active)
  dexMmEscrowCapSteem: (() => {
    const n = parseFloat(process.env.DEX_MM_ESCROW_CAP_STEEM);
    return Number.isFinite(n) && n > 0 ? n : 2;
  })(),
  dexMmMaxFillsBeat: parseIntVal(process.env.DEX_MM_MAX_FILLS_BEAT, 4),
  dexMmAskPremium: 1.6, // זהה ל-SAOS_MM_ASK_PREMIUM בקונסולה
  dexMmBidFactor: 0.65, // זהה ל-SAOS_MM_BID_FACTOR בקונסולה
  dexMmRequotePct: parsePct(process.env.DEX_MM_REQUOTE_PCT, 25),
  // 47 — ממלכת-הנזילות: grid-MM סביב עוגן-כושר-פירעון + בריכת AMM על האוטובוס.
  // חומת-5-custom_json-לבלוק נמדדה חי (limits.json) — כל פעימה שולחת ≤5 אופס.
  dexGridLevels: (() => { const n = parseIntVal(process.env.DEX_GRID_LEVELS, 3); return n >= 1 && n <= 5 ? n : 3; })(),
  dexGridStepPct: parsePct(process.env.DEX_GRID_STEP_PCT, 3),
  dexGridNotional: (() => { const n = parseFloat(process.env.DEX_GRID_NOTIONAL); return Number.isFinite(n) && n > 0 ? n : 0.02; })(), // STEEM נומינל לרמת-ביד
  dexFairPremium: (() => { const n = parseFloat(process.env.DEX_FAIR_PREMIUM); return Number.isFinite(n) && n >= 1 && n <= 3 ? n : 1.25; })(), // עוגן: רצפת-פירעון × זה
  dexFairCapX: (() => { const n = parseFloat(process.env.DEX_FAIR_CAP_X); return Number.isFinite(n) && n > 0 ? n : 3; })(),
  dexOpsCapBeat: 5, // החומה הנמדדת — custom_json לחשבון-לבלוק
  dexPoolSeedSaos: (() => { const n = parseFloat(process.env.DEX_POOL_SEED_SAOS); return Number.isFinite(n) && n > 0 ? n : 2; })(),
  dexPoolSeedSteem: (() => { const n = parseFloat(process.env.DEX_POOL_SEED_STEEM); return Number.isFinite(n) && n > 0 ? n : 0.1; })(),
  dexArbDevPct: parsePct(process.env.DEX_ARB_DEV_PCT, 5),
  dexArbNotional: (() => { const n = parseFloat(process.env.DEX_ARB_NOTIONAL); return Number.isFinite(n) && n > 0 ? n : 0.05; })(),
  liqEnabled: parseBool(process.env.LIQ_ENABLED, true),
  // 62 — PAYMASTER: המכונה משלמת גז ללקוחות (relay+fuel) + מפת-תקשורת חוצת-שרשראות
  paymasterEnabled: parseBool(process.env.PAYMASTER_ENABLED, true),
  paymasterMin: parseMinutes(process.env.PAYMASTER_INTERVAL_MIN, 30),
  // 63 — WRAPPED: עגוני-ערך צמודים על הדקס (WSBD-1/PHIVE-1 על saos.wrap/v1) + maker על Hive-Engine
  wrappedEnabled: parseBool(process.env.WRAPPED_ENABLED, true),
  wrappedMin: parseMinutes(process.env.WRAPPED_INTERVAL_MIN, 25),
  // 65 — MICRODEX: חיילים חותמים-עצמם פעולות-דקס מיקרו (fill/order/pool_swap) —
  // שבירת-ריכוז-ה-RC של האוצר + תעסוקה-אוטונומית של הצי על הספר
  microdexEnabled: parseBool(process.env.MICRODEX_ENABLED, true),
  microdexMin: parseMinutes(process.env.MICRODEX_INTERVAL_MIN, 6), // GRID-97: זרימת-takers חיילית כל 6 דק' (רוטציית-צי · RC-מודע)
  yieldEnabled: parseBool(process.env.YIELD_ENABLED, true),
  yieldMin: parseMinutes(process.env.YIELD_INTERVAL_MIN, 360),
  merchantEnabled: parseBool(process.env.MERCHANT_ENABLED, true),
  merchantMin: parseMinutes(process.env.MERCHANT_INTERVAL_MIN, 15),
  saosnetEnabled: parseBool(process.env.SAOSNET_ENABLED, true),
  saosnetMin: parseMinutes(process.env.SAOSNET_INTERVAL_MIN, 3), // GRID-97: פעימה-ריבונית כל 3 דק' — קיבולת-מדודה 36,195-ops/יום, רק-תשתית-אפס-עמלה
  // W2 — WEAVE: באצ'ר-האריגה השעתי — stamps → מרקל-קנוני → seal (דרך-הצומת) → עיגון-4-שרשראות
  weaveEnabled: parseBool(process.env.WEAVE_ENABLED, true),
  weaveMin: parseMinutes(process.env.WEAVE_INTERVAL_MIN, 60),
  liqMin: parseMinutes(process.env.LIQ_INTERVAL_MIN, 25),
  liqEscrowPerSoldier: (() => { const n = parseFloat(process.env.LIQ_ESCROW_PER_SOLDIER); return Number.isFinite(n) && n > 0 ? n : 0.02; })(),
  liqEscrowDayCap: (() => { const n = parseFloat(process.env.LIQ_ESCROW_DAY_CAP); return Number.isFinite(n) && n > 0 ? n : 0.06; })(),
  liqLpMinSaos: (() => { const n = parseFloat(process.env.LIQ_LP_MIN_SAOS); return Number.isFinite(n) && n > 0 ? n : 0.2; })(),
  liqSoldierKeepSteem: 0.01, // רצפה שנשארת בחייל (לא לרוקן את החשבון)
  // 34 — גשר דו-שרשרתי: headcorner קיים ב-Steem וגם ב-Hive (חשבון טרום-פורק 2018)
  // עם אותן סמכויות-מפתח בדיוק — אותו WIF posting שולט בשתי השרשרות. כל פעולת
  // saos על Steem מוטמעת כעוגן custom_json (id="saos") על Hive, וכל 6h נשלח
  // checkpoint דו-שרשרתי (הוכחת-עתודה של מצב הדקס). החתימה מקומית; IPv4 כפוי.
  bridgeEnabled: parseBool(process.env.BRIDGE_ENABLED, false),
  bridgeMin: parseMinutes(process.env.BRIDGE_INTERVAL_MIN, 10),
  valueLockMin: parseMinutes(process.env.VALUE_LOCK_MIN, 45),
  reflexMin: parseMinutes(process.env.REFLEX_INTERVAL_MIN, 240), // 54 — תרגיל-רפלקס-בלוק אוטונומי
  gitkeeperEnabled: parseBool(process.env.GITKEEPER_ENABLED, true), // 56 — ביטוח-אובדן: שמירה-אוטומטית ל-origin
  gitkeeperMin: parseMinutes(process.env.GITKEEPER_INTERVAL_MIN, 30),
  guardianEnabled: parseBool(process.env.GUARDIAN_ENABLED, true), // 82 — ALWAYS-UP: anti-rollback + self-heal + fleet zero-touch restore
  guardianMin: parseMinutes(process.env.GUARDIAN_INTERVAL_MIN, 10),
  heReportEnabled: parseBool(process.env.HE_REPORT_ENABLED, true), // 85 — דוח-הריבונות העברי-החי (docs/REPORT_HE.md)
  heReportMin: parseMinutes(process.env.HE_REPORT_MIN, 30),
  // 87 — L9 אחדות-הצי: כל חייל מקושר-היטב לראש (posting.account_auths ∋ headcorner ×2 שרשראות)
  linkageEnabled: parseBool(process.env.LINKAGE_ENABLED, true),
  linkageMin: parseMinutes(process.env.LINKAGE_INTERVAL_MIN, 90),
  linkageAutoFix: parseBool(process.env.LINKAGE_AUTO_FIX, true), // תיקון-אוטומטי חתום (ה-active של החייל עצמו; אפס-מחיקת-מפתחות)
  bridgeCapPerBeat: parseIntVal(process.env.BRIDGE_CAP_PER_BEAT, 4),
  bridgeCheckpointH: (() => {
    const n = parseFloat(process.env.BRIDGE_CHECKPOINT_H);
    return Number.isFinite(n) && n > 0 ? n : 6;
  })(),
  hiveRpc: process.env.HIVE_RPC || 'https://api.hive.blog',
  // יעילות
  rcMinClaimPct: parsePct(process.env.RC_MIN_CLAIM_PCT, 5),
  cacheTtlSec: (() => {
    const n = parseFloat(process.env.CACHE_TTL_SEC);
    return Number.isFinite(n) && n > 0 ? n : 15;
  })(),
  logFile: process.env.LOG_FILE || 'agent.log',
  execSbd: 100,        // גודל דגימת ה-edge — עקבי עם market-snapshot.ts בפרויקט
  windowOpenPct: 10,   // סף "חלון פתוח" — WINDOW_OPEN_THRESHOLD_PCT
  rpcTimeoutMs: 30000,
};
const CURATION_SEEN_CAP = 500; // מקסימום כניסות ב-curation_seen.json (חיתוך מהישן)

// --dry (npm run dry) כופה מצב יבש גם אם ה-env אומר אחרת
if (process.argv.includes('--dry')) CONFIG.dryRun = true;

// מצב ולידציה חד-פעמי: --once (או ONCE=1) — מחזור אחד לכל הלופים ויציאה
const ONCE = process.argv.includes('--once') || parseBool(process.env.ONCE, false);

// RPC: להשלים פרוטוקול אם חסר
if (!/^https?:\/\//i.test(CONFIG.rpcUrl)) CONFIG.rpcUrl = 'https://' + CONFIG.rpcUrl;

const LOG_PATH = path.isAbsolute(CONFIG.logFile)
  ? CONFIG.logFile
  : path.join(__dirname, CONFIG.logFile);
const STATUS_PATH = path.join(__dirname, 'agent-status.json');
const SEEN_PATH = path.join(__dirname, 'curation_seen.json');
const ARMY_SEEN_PATH = path.join(__dirname, 'army_seen.json');
const ARMY_DAY_PATH = path.join(__dirname, 'army_day.json');
const DEX_STATE_PATH = path.join(__dirname, 'dex_mm_state.json');

/* ------------------------------------------------------------------ *
 * logging — append לקובץ + console. כל שורה [ISO] msg.
 * שכבת-בטיחות: כל מה שנרשם עובר סינון שמסתיר WIF-דמויים.
 * ------------------------------------------------------------------ */
const WIF_RE = /\b5[HJK][1-9A-HJ-NP-Za-km-z]{49}\b/g;
function sanitize(msg) {
  return String(msg).replace(WIF_RE, '[REDACTED-WIF]');
}
function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + sanitize(msg);
  try {
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch (_) {
    /* הלוג לא יפיל את הדימון */
  }
  console.log(line);
}

/* ------------------------------------------------------------------ *
 * עזרים
 * ------------------------------------------------------------------ */
// כמות מתוך asset-string כמו "42533.621148 VESTS" → 42533.621148 (מקבל גם מספר חשוף)
function amt(s) {
  const n = parseFloat(String(s).split(' ')[0]);
  return Number.isFinite(n) ? n : 0;
}
// מחיר SBD/STEEM של רמת ספר — real_price קודם, אחרת order_price base/quote
// (מיושר ל-market-snapshot.ts הקנוני בפרויקט)
function bidPrice(b) {
  if (!b) return 0;
  if (b.real_price) {
    const p = parseFloat(b.real_price);
    if (Number.isFinite(p) && p > 0) return p;
  }
  if (b.order_price) {
    const base = amt(b.order_price.base);
    const quote = amt(b.order_price.quote);
    if (quote > 0) {
      const p = base / quote;
      if (p > 0) return p;
    }
  }
  const legacy = parseFloat(b.price); // תאימות לאחור לצמתים בפורמט ישן
  return Number.isFinite(legacy) ? legacy : 0;
}
function round(x, d) {
  return Number.isFinite(x) ? Math.round(x * Math.pow(10, d)) / Math.pow(10, d) : null;
}
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error('timeout ' + ms + 'ms: ' + label)), ms)
    ),
  ]);
}
function utcToday() {
  return new Date().toISOString().slice(0, 10); // מונים יומיים לפי UTC
}

/* ------------------------------------------------------------------ *
 * RPC wrappers — condenser + appbase, קריאות ציבוריות
 * ------------------------------------------------------------------ */
// תאימות: אם גרסת steem-js לא ייצרה מתודות Async, נבנה אותן מהגרסה המקבלת-callback
function ensureAsyncMethod(obj, name) {
  if (typeof obj[name] === 'function') return;
  const base = name.replace(/Async$/, '');
  if (typeof obj[base] === 'function') {
    obj[name] = (...args) =>
      new Promise((res, rej) =>
        obj[base](...args, (err, result) => (err ? rej(err) : res(result)))
      );
  } else {
    throw new Error('steem-js: missing api method ' + base);
  }
}
['getAccountsAsync', 'getDynamicGlobalPropertiesAsync', 'getFeedHistoryAsync', 'getOrderBookAsync', 'callAsync'].forEach(
  (m) => ensureAsyncMethod(steem.api, m)
);

const api = {
  accounts: (name) =>
    withTimeout(steem.api.getAccountsAsync([name]), CONFIG.rpcTimeoutMs, 'get_accounts'),
  dgp: () =>
    withTimeout(
      steem.api.getDynamicGlobalPropertiesAsync(),
      CONFIG.rpcTimeoutMs,
      'get_dynamic_global_properties'
    ),
  feedHistory: () =>
    withTimeout(steem.api.getFeedHistoryAsync(), CONFIG.rpcTimeoutMs, 'get_feed_history'),
  orderBook: (limit) =>
    withTimeout(steem.api.getOrderBookAsync(limit), CONFIG.rpcTimeoutMs, 'get_order_book'),
  // appbase generic — ל-rc_api וכדומה
  call: (method, params) =>
    withTimeout(steem.api.callAsync(method, params), CONFIG.rpcTimeoutMs, method),
};

/* ------------------------------------------------------------------ *
 * קאש תמונות-מצב (יעילות v2) — TTL קצר, משותף לכל הלופים.
 * 5 לופים באותו-חלון של 15 שניות = קריאת get_accounts/rc אחת במקום חמש.
 * ------------------------------------------------------------------ */
const cacheMap = new Map();
const inflight = new Map();
function cacheGet(key) {
  const e = cacheMap.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CONFIG.cacheTtlSec * 1000) return null;
  return e.value;
}
async function cached(key, fetcher) {
  const hit = cacheGet(key);
  if (hit !== null) return hit;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const value = await fetcher();
    cacheMap.set(key, { ts: Date.now(), value });
    return value;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
const cachedAccounts = () =>
  cached('get_accounts:' + CONFIG.account, () => api.accounts(CONFIG.account));
const cachedRcRaw = () =>
  cached('rc:' + CONFIG.account, () => api.call('rc_api.find_rc_accounts', { accounts: [CONFIG.account] }));

/* ------------------------------------------------------------------ *
 * 43 — הצבא הכלכלי: טעינת חשבונות.
 *   - tier 'operator': חוברו ע״י המפעיל דרך הכספת (agent/keys/vault.json)
 *   - tier 'factory':  נולדו במפעל הזהויות (agent/keys/<name>.json)
 * כל חשבון חותם עם המפתחות שלו בלבד. הראשי לא משוכפל לצבא.
 * סוכן-מפעל שנולד אחרי עליית-הדימון נכנס בהפעלה הבאה (המפעל מטביע לאט).
 * ------------------------------------------------------------------ */
/* 87 — L9 אחדות-הצי: ריכוז-מצב-קישוריות מ-linkage_report.json (קאש 5 דק').
 * חייל שסמכות-הפוסטינג שלו ב-Hive טרם נושאת את הראש הוא "מוגן-RC":
 * מפסיקים לרוקן אותו (hiveFleetAnchor מדלג) כדי שהמנה תצבור לרמת-ה-op
 * הנדרשת ל-account_update (נמדד: ≈14% מ-max-RC). בלי-זה הראוטר בוחר דווקא
 * את החייל העשיר-ביותר ומרוקן אותו — אנטי-קונברגנציה מבנית שנמדדה-חי. */
let LINKAGE_CACHE = { at: 0, pending: new Set(), total: 0, linkedChains: 0, chainsTotal: 0, allLinked: false, reportAt: null };
function linkagePendingHive() {
  if (Date.now() - LINKAGE_CACHE.at < 300000) return LINKAGE_CACHE.pending;
  try {
    const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'linkage_report.json'), 'utf8'));
    const pending = new Set();
    for (const s of r.soldiers || []) {
      if (s.chains && s.chains.hive && !s.chains.hive.linked) pending.add(String(s.username).toLowerCase());
    }
    LINKAGE_CACHE = { at: Date.now(), pending, total: r.soldiersTotal || 0, linkedChains: r.linkedChains || 0, chainsTotal: r.chainsTotal || 0, allLinked: !!r.allLinked, reportAt: r.at || null };
  } catch (_) {
    // אין-דוח — לא חוסמים שום-דבר (fail-open)
    LINKAGE_CACHE = { at: Date.now(), pending: new Set(), total: 0, linkedChains: 0, chainsTotal: 0, allLinked: false, reportAt: null };
  }
  return LINKAGE_CACHE.pending;
}
function loadArmyAccounts() {
  const out = [];
  const primary = (CONFIG.account || '').toLowerCase();
  // 82 — retry: a concurrent fleet_vault --open (guardian race) can momentarily
  // serve a torn/missing vault — a silent empty ARMY mutes the whole fleet.
  // 3 tries, 400ms apart; permanent absence is honest (army=0 + guidance log).
  let v = null;
  for (let i = 0; i < 3 && !v; i++) {
    try {
      const raw = fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.accounts)) v = parsed;
    } catch (_) { /* torn or absent — retry */ }
    if (!v && i < 2) {
      const until = Date.now() + 400;
      while (Date.now() < until) { /* sync spin — module-load must stay synchronous */ }
    }
  }
  if (!v) {
    try { fs.appendFileSync(path.join(__dirname, 'agent.log'), '[' + new Date().toISOString() + '] army: vault.json unreadable after 3 tries — ARMY=0 (operator: re-arm via Console → כספת, or guardian restores the seal)\n'); } catch (_) {}
    return out;
  }
  for (const a of v.accounts || []) {
      if (!a || !a.username) continue;
      const u = String(a.username).toLowerCase();
      if (u === primary) continue;
      // 57 — operator-delegated rescue: account whose own keys are unreachable
      // (rotated away / master lost) but the OPERATOR still holds a posting
      // account-authority on it (preserved rescue anchor). The soldier signs
      // with the operator's posting WIF — no new secret is ever stored.
      const delegated = a.mode === 'operator-delegated';
      out.push({
        username: u,
        tier: delegated ? 'operator-delegated' : (a.tier || 'operator'), // 48 — 'factory-v2' נשמר מהכספת
        postingWif: delegated ? CONFIG.postingWif : ((a.keys && a.keys.posting && a.keys.posting.wif) || ''),
        // active/memo can NOT be delegated — the operator's keys are not in
        // those authorities; leave empty until full control is restored.
        activeWif: delegated ? '' : ((a.keys && a.keys.active && a.keys.active.wif) || ''),
        memoWif: delegated ? '' : ((a.keys && a.keys.memo && a.keys.memo.wif) || ''),
        memoPub: delegated ? '' : ((a.keys && a.keys.memo && a.keys.memo.pub) || ''),
      });
  }
  // (82) vault absent/unreadable is handled above with retry + honest ARMY=0 log
  try {
    const files = fs
      .readdirSync(path.join(__dirname, 'keys'))
      .filter((f) => f.endsWith('.json') && f !== 'vault.json');
    for (const f of files) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', f), 'utf8'));
        const u = String((j && j.name) || '').toLowerCase();
        const wif = j && j.keys && j.keys.posting && j.keys.posting.wif;
        if (u && wif && u !== primary) {
          out.push({
            username: u,
            tier: 'factory',
            postingWif: wif,
            activeWif: (j.keys && j.keys.active && j.keys.active.wif) || '',
          });
        }
      } catch (_) {
        /* קובץ מפתח פגום — דילוג */
      }
    }
  } catch (_) {
    /* אין תיקיית מפתחות */
  }
  const seen = new Set();
  return out.filter((a) => (seen.has(a.username) ? false : (seen.add(a.username), true)));
}
const ARMY = loadArmyAccounts();

async function armyAccountsData() {
  if (!ARMY.length) return [];
  const key = 'army-accounts:' + ARMY.map((a) => a.username).join(',');
  return cached(key, () =>
    withTimeout(
      steem.api.getAccountsAsync(ARMY.map((a) => a.username)),
      CONFIG.rpcTimeoutMs,
      'get_accounts(army)'
    )
  );
}

function armyByName(accArr) {
  const byName = {};
  for (const acc of accArr || []) byName[String(acc.name).toLowerCase()] = acc;
  return byName;
}

/* ------------------------------------------------------------------ *
 * RC — rc_api.find_rc_accounts {accounts:[...]}
 * תבנית תשובה חיה (אומתה מול api.steemit.com):
 *   { rc_accounts: [ { account, max_rc, max_rc_creation_adjustment,
 *                     rc_manabar: { current_mana, last_update_time } } ] }
 * max_rc ו-current_mana מגיעים כמחרוזות — חובה Number().
 * ------------------------------------------------------------------ */
let rcShapeLogged = false;
function logRcShapeOnce(raw) {
  if (rcShapeLogged || !raw) return;
  rcShapeLogged = true;
  const first = Array.isArray(raw.rc_accounts) ? raw.rc_accounts[0] : null;
  let line = 'rc proof: rc_api.find_rc_accounts raw keys=[' + Object.keys(raw).join(', ') + ']';
  if (first) {
    line += ' · rc_accounts[0] keys=[' + Object.keys(first).join(', ') + ']' +
      ' · rc_manabar keys=[' + Object.keys(first.rc_manabar || {}).join(', ') + ']';
  }
  log(line);
}
function rcFromRaw(raw) {
  const first = raw && Array.isArray(raw.rc_accounts) ? raw.rc_accounts[0] : null;
  if (!first) return null;
  const max = Number(first.max_rc);
  const mana = Number(first.rc_manabar && first.rc_manabar.current_mana);
  if (!Number.isFinite(max) || !Number.isFinite(mana) || max <= 0) return null;
  return {
    max,
    current: mana,
    pct: Math.max(0, Math.min(100, (mana / max) * 100)),
  };
}
async function refreshRc() {
  try {
    const raw = await cachedRcRaw();
    logRcShapeOnce(raw);
    const rc = rcFromRaw(raw);
    if (rc) {
      STATUS.rc = { max: rc.max, current: rc.current, pct: round(rc.pct, 2) };
      log('rc: @' + CONFIG.account + ' max_rc=' + rc.max + ' · current_mana=' + rc.current +
        ' · RC ' + rc.pct.toFixed(2) + '%');
      writeStatus();
      return rc;
    }
    log('rc: unexpected rc_api response shape — rc metrics unavailable');
    return null;
  } catch (e) {
    log('rc: lookup failed: ' + ((e && e.message) || e));
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * agent-status.json v2 — אובייקט מרכזי, כתיבה אטומית (tmp + rename).
 * נכתב גם כשלופים מנוטרלים (status:"disabled") — הקונסולה רואה שהסוכן חי.
 * ------------------------------------------------------------------ */
function loadExistingStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}
const prevStatus = loadExistingStatus();
const STATUS = {
  updatedAt: null,
  account: CONFIG.account,
  dryRun: CONFIG.dryRun,
  feed: null,
  bidTop: null,
  edgePct: null,
  open: null,
  identity: null,
  pendingClaims: prevStatus && Number.isFinite(prevStatus.pendingClaims) ? prevStatus.pendingClaims : null,
  rc: null,
  tickets: null,
  loops: {
    claim: { lastRun: null, status: 'disabled', detail: 'not run yet', counters: { claimsToday: 0 } },
    watcher: { lastRun: null, status: 'disabled', detail: 'not run yet', counters: {} },
    transferWatch: { lastRun: null, status: 'disabled', detail: 'not run yet', counters: {} },
    curation: {
      lastRun: null,
      status: 'disabled',
      detail: CONFIG.curationEnabled ? 'not run yet' : 'CURATION_ENABLED=false',
      counters: { votesToday: 0, candidates: 0 },
    },
    factory: {
      lastRun: null,
      status: 'disabled',
      detail: CONFIG.factoryEnabled
        ? (CONFIG.activeWif ? 'not run yet' : 'FACTORY_ENABLED=true · needs Active WIF')
        : (CONFIG.activeWif ? 'FACTORY_ENABLED=false' : 'FACTORY_ENABLED=false · needs Active WIF'),
      counters: { claimsToday: 0 },
    },
    empire: {
      lastRun: null,
      status: 'disabled',
      detail: 'not run yet — key-references scan (Steem+Hive), auto-onboard armed',
      counters: { scans: 0 },
    },
    dexMm: {
      lastRun: null,
      status: 'disabled',
      detail: CONFIG.dexMmEnabled ? 'not run yet' : 'DEX_MM_ENABLED=false',
      counters: { broadcastsToday: 0, fillsToday: 0, bootstrapped: false },
    },
    armyClaim: {
      lastRun: null,
      status: 'disabled',
      detail: ARMY.length ? 'not run yet' : 'army empty — connect accounts in the vault (כספת → צבא)',
      counters: { claimsToday: 0, armySize: ARMY.length },
    },
    armyCuration: {
      lastRun: null,
      status: 'disabled',
      detail: ARMY.length ? 'not run yet' : 'army empty',
      counters: { votesToday: 0, armySize: ARMY.length },
    },
    armySweep: {
      lastRun: null,
      status: 'disabled',
      detail: ARMY.length ? 'not run yet' : 'army empty',
      counters: { sweepsToday: 0, sweptSteem: 0, armySize: ARMY.length },
    },
    fleetPace: {
      lastRun: null,
      status: 'disabled',
      detail: ARMY.length ? 'not run yet' : 'army empty',
      counters: { pingsToday: 0, fleet: ARMY.length },
    },
    linkage: {
      lastRun: null,
      status: 'disabled',
      detail: ARMY.length ? 'not run yet — קישוריות-חיילים→ראש (posting.account_auths ×2 chains)' : 'army empty',
      counters: { linkedChains: 0, chainsTotal: 0, fixedNow: 0 },
    },
  },
  fleet: {
    size: ARMY.length,
    lastPingBy: null,
    lastPingAt: null,
    lastTxid: null,
    routed: null,
    pingsToday: (prevStatus && prevStatus.fleet && prevStatus.fleet.pingsToday) || 0,
  },
  army: {
    size: ARMY.length,
    operator: ARMY.filter((a) => a.tier === 'operator').length,
    factory: ARMY.filter((a) => a.tier === 'factory').length,
    pendingSp: null,
    sweptSteem: (prevStatus && prevStatus.army && prevStatus.army.sweptSteem) || 0,
  },
  lastIncoming: (prevStatus && prevStatus.lastIncoming) || null,
  factory: {
    lastCostRc: (prevStatus && prevStatus.factory && prevStatus.factory.lastCostRc) || null,
    agents: (prevStatus && prevStatus.factory && prevStatus.factory.agents) || [],
  },
  empire: (prevStatus && prevStatus.empire) || null,
  dex: {
    lastPrice: null, bestAsk: null, bestBid: null, spreadPct: null,
    supply: null, backingSteem: null, openOrders: null,
    creditsTotal: null, issuerLiquidSteem: null, escrowedTotal: null,
    lastAction: 'not run yet',
  },
};

function writeStatus() {
  STATUS.updatedAt = new Date().toISOString();
  const tmp = STATUS_PATH + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(STATUS, null, 2) + '\n');
    fs.renameSync(tmp, STATUS_PATH);
  } catch (e) {
    log('status: failed to write agent-status.json: ' + ((e && e.message) || e));
  }
}
function updateLoop(name, patch) {
  const l = STATUS.loops[name] || (STATUS.loops[name] = { counters: {} });
  Object.assign(l, patch);
  if (!l.counters) l.counters = {};
  l.lastRun = new Date().toISOString();
  writeStatus();
}

/* ------------------------------------------------------------------ *
 * לופ 1 — תביעת פרסים (רץ תמיד; חותם רק עם POSTING_WIF; שער-RC)
 * ------------------------------------------------------------------ */
let claimsToday = { date: utcToday(), count: 0 };

async function claimCycle() {
  const today = utcToday();
  if (claimsToday.date !== today) claimsToday = { date: today, count: 0 };
  const counters = () => ({ claimsToday: claimsToday.count });

  const [dgp, accArr] = await Promise.all([api.dgp(), cachedAccounts()]);
  const acc = accArr && accArr[0];
  if (!acc) {
    log('claim: account @' + CONFIG.account + ' not found on chain — skip');
    updateLoop('claim', { status: 'error', detail: 'account not found on chain', counters: counters() });
    return;
  }
  // vest2sp מ-DGP
  const fund = amt(dgp.total_vesting_fund_steem);
  const shares = amt(dgp.total_vesting_shares);
  const vest2sp = shares > 0 ? fund / shares : 0;

  // מחרוזות גולמיות מהשרשרת — בדיוק מה שנכנס ל-op
  const rvb = acc.reward_vesting_balance || '0.000000 VESTS';
  const rewardSteem = acc.reward_steem_balance || '0.000 STEEM';
  const rewardSbd = acc.reward_sbd_balance || '0.000 SBD';
  const vests = amt(rvb);
  const sp = vests * vest2sp;

  // נתוני חשבון חיים לסטטוס — גם בניטור-בלבד
  STATUS.pendingClaims = round(sp, 3);
  STATUS.tickets = Number(acc.pending_claimed_accounts) || 0;

  if (!CONFIG.postingWif) {
    log('claim: no POSTING_WIF — monitoring only · pending ' + sp.toFixed(3) + ' SP · tickets ' + STATUS.tickets);
    updateLoop('claim', { status: 'disabled', detail: 'no POSTING_WIF — monitoring only', counters: counters() });
    return;
  }
  if (vests <= 0) {
    log('claim: no pending rewards (0 VESTS) — nothing to claim');
    updateLoop('claim', { status: 'ok', detail: 'no pending rewards (0 VESTS)', counters: counters() });
    return;
  }
  if (sp < CONFIG.minClaimSp) {
    log(
      'claim: pending ' + sp.toFixed(3) + ' SP < MIN_CLAIM_SP ' + CONFIG.minClaimSp +
      ' — skip (waiting)'
    );
    updateLoop('claim', { status: 'skipped', detail: 'pending ' + sp.toFixed(3) + ' SP < MIN_CLAIM_SP ' + CONFIG.minClaimSp, counters: counters() });
    return;
  }

  // שער-RC (יעילות v2): לא לשרוף RC על תביעה כשה-RC כמעט ריק. קאש משותף עם המפעל.
  const rc = rcFromRaw(await cachedRcRaw().catch(() => null));
  if (rc) {
    STATUS.rc = { max: rc.max, current: rc.current, pct: round(rc.pct, 2) };
    if (rc.pct < CONFIG.rcMinClaimPct) {
      log('claim: RC too low (' + rc.pct.toFixed(1) + '% < ' + CONFIG.rcMinClaimPct + '%), skipping claim');
      updateLoop('claim', { status: 'skipped', detail: 'RC too low (' + rc.pct.toFixed(1) + '% < ' + CONFIG.rcMinClaimPct + '%)', counters: counters() });
      return;
    }
  }

  const op = [
    'claim_reward_balance',
    {
      account: CONFIG.account,
      reward_steem: rewardSteem,
      reward_sbd: rewardSbd,
      reward_vests: rvb,
    },
  ];

  if (CONFIG.dryRun) {
    claimsToday.count++;
    log(
      '[DRY_RUN] would claim ' + rewardSteem + ' + ' + rewardSbd + ' + ' + rvb +
      ' (≈' + sp.toFixed(3) + ' SP)'
    );
    updateLoop('claim', { status: 'dry', detail: '[DRY_RUN] would claim ' + rewardSteem + ' + ' + rewardSbd + ' + ' + rvb + ' (≈' + sp.toFixed(3) + ' SP)', counters: counters() });
    return;
  }

  try {
    const conf = await steem.broadcast.sendAsync(
      { operations: [op], extensions: [] },
      [CONFIG.postingWif]
    );
    claimsToday.count++;
    log(
      'claim broadcast ok: txid=' + ((conf && conf.id) || 'n/a') +
      ' ' + rewardSteem + ' + ' + rewardSbd + ' + ' + rvb + ' (≈' + sp.toFixed(3) + ' SP)'
    );
    updateLoop('claim', { status: 'ok', detail: 'claimed ' + rewardSteem + ' + ' + rewardSbd + ' + ' + rvb + ' (≈' + sp.toFixed(3) + ' SP) · txid=' + ((conf && conf.id) || 'n/a'), counters: counters() });
  } catch (e) {
    // שגיאה → לוג בלבד, הדימון לא קורס
    log('claim broadcast FAILED: ' + ((e && e.message) || e));
    updateLoop('claim', { status: 'error', detail: String((e && e.message) || e).slice(0, 140), counters: counters() });
  }
}

/* ------------------------------------------------------------------ *
 * לופ 2 — צופה חלון BOT-3 (קריאה בלבד)
 * יעילות v2: הפיד זז לאט — אם הוא לא השתנה מהמחזור הקודם, מדלגים על
 * get_order_book ומשתמשים בתמונת-מצב הקודמת של bidTop/edge.
 * ------------------------------------------------------------------ */
let lastOpenState = null; // מצב קודם בזיכרון: true/false, null = טרם ידוע (ריצה ראשונה)
let lastFeedVal = null;   // הפיד מהמחזור הקודם (עיגול 9 ספרות להשוואה)
let lastBook = null;      // {bidTop, edgePct} מהספר האחרון שנשלף

// VWAP walk: מוכרים sizeSbd/feed STEEM לתוך ה-bids (קוני STEEM), מחזירים edge%
function execEdge(bids, feed, sizeSbd) {
  let remaining = sizeSbd / feed; // כמה STEEM מתקבל מהמרת sizeSbd SBD בפיד
  let proceeds = 0;               // SBD שמתקבלים ממכירת ה-STEEM ל-bids
  for (const lvl of bids) {
    if (remaining <= 1e-9) break;
    const take = Math.min(remaining, lvl.steem);
    proceeds += take * lvl.price;
    remaining -= take;
  }
  if (!(sizeSbd > 0)) return 0;
  return (proceeds / sizeSbd - 1) * 100;
}

async function watchCycle() {
  const fh = await api.feedHistory();

  // ה-ratio המפעיל: get_feed_history.current_median_history {base,quote}
  // לא price_history ולא מדיין-העדים — באג היסטורי, ראו docs/ROAST.md
  const cmh = fh && fh.current_median_history;
  if (!cmh || !cmh.base || !cmh.quote) {
    log('watch: no current_median_history — skip cycle');
    updateLoop('watcher', { status: 'error', detail: 'no current_median_history' });
    return;
  }
  const base = amt(cmh.base);
  const quote = amt(cmh.quote);
  if (!(base > 0 && quote > 0)) {
    log('watch: bad feed ' + cmh.base + '/' + cmh.quote + ' — skip cycle');
    updateLoop('watcher', { status: 'error', detail: 'bad feed ' + cmh.base + '/' + cmh.quote });
    return;
  }
  const feed = base / quote; // SBD ל-STEEM

  let bidTop, edgePct;
  const feedCmp = round(feed, 9);
  if (lastBook && lastFeedVal === feedCmp) {
    // יעילות v2 — הפיד לא זז: הספר כמעט ודאי לא זז. קריאת RPC נחסכת.
    log('watch: feed unchanged (' + feed.toFixed(6) + ') — skipping get_order_book, reusing last book snapshot');
    bidTop = lastBook.bidTop;
    edgePct = lastBook.edgePct;
  } else {
    const ob = await api.orderBook(50);
    const bids = ((ob && Array.isArray(ob.bids)) ? ob.bids : [])
      .map((b) => ({ price: bidPrice(b), steem: amt(b.steem) }))
      .filter((x) => x.price > 0 && x.steem > 0)
      .sort((a, b) => b.price - a.price); // הגבוה קודם
    bidTop = bids.length ? bids[0].price : 0;
    edgePct = execEdge(bids, feed, CONFIG.execSbd);
    lastBook = { bidTop, edgePct };
  }
  lastFeedVal = feedCmp;

  const open = edgePct >= CONFIG.windowOpenPct;

  // זיהוי מעבר פתוח↔סגור מול המצב הקודם בזיכרון
  if (lastOpenState !== null && lastOpenState !== open) {
    log(
      'ALERT window ' + (open ? 'OPENED' : 'CLOSED') +
      ': edge ' + edgePct.toFixed(2) + '% · feed ' + feed.toFixed(6) +
      ' · bidTop ' + bidTop.toFixed(5)
    );
  }
  lastOpenState = open;

  STATUS.feed = round(feed, 6);
  STATUS.bidTop = round(bidTop, 6);
  STATUS.edgePct = round(edgePct, 2);
  STATUS.open = open;
  updateLoop('watcher', {
    status: 'ok',
    detail: 'edge ' + edgePct.toFixed(2) + '% · window ' + (open ? 'OPEN' : 'closed'),
    counters: {},
  });

  log(
    'watch: feed ' + feed.toFixed(6) + ' SBD/STEEM · bidTop ' + bidTop.toFixed(5) +
    ' · edge(' + CONFIG.execSbd + ' SBD) ' + edgePct.toFixed(2) + '% · window ' +
    (open ? 'OPEN' : 'closed') +
    (STATUS.pendingClaims !== null ? ' · pending ' + STATUS.pendingClaims.toFixed(3) + ' SP' : '')
  );
}

/* ------------------------------------------------------------------ *
 * לופ 3 — צופה העברות נכנסות (קריאה-בלבד, אפס סיכון)
 * התשתית של rail-play: transfer+memo = חשבונית. רק מתריע/מתעד.
 * ------------------------------------------------------------------ */
let lastTransferTs = null;   // ISO של ההעברה האחרונה שנראתה
let transferWatchArmed = false;

async function transferWatchCycle() {
  ensureAsyncMethod(steem.api, 'getAccountHistoryAsync');
  const hist = await withTimeout(
    steem.api.getAccountHistoryAsync(CONFIG.account, -1, 100),
    CONFIG.rpcTimeoutMs,
    'get_account_history'
  );
  const entries = Array.isArray(hist) ? hist : hist.history || [];
  const incoming = [];
  for (const entry of entries) {
    const e = entry && entry[1];
    if (!e) continue;
    const op = e.op;
    let t, vals;
    if (op && typeof op === 'object' && !Array.isArray(op)) {
      t = String(op.type || '').replace(/_operation$/, '');
      vals = op.value || {};
    } else if (Array.isArray(op)) {
      t = op[0]; vals = op[1] || {};
    } else continue;
    if (t !== 'transfer') continue;
    if (String(vals.to || '') !== CONFIG.account) continue;
    incoming.push({ ts: e.timestamp, from: vals.from, amount: vals.amount, memo: String(vals.memo || '') });
  }
  if (!transferWatchArmed) {
    // ריצה ראשונה — מכוונים את הסמן בלי להציף התראות היסטוריה
    transferWatchArmed = true;
    lastTransferTs = incoming.length ? incoming[incoming.length - 1].ts : null;
    log('transfer-watch: armed at ' + (lastTransferTs || 'no-incoming') + ' (' + incoming.length + ' recent incoming)');
    updateLoop('transferWatch', { status: 'ok', detail: 'armed at ' + (lastTransferTs || 'no-incoming') + ' (' + incoming.length + ' recent incoming)', counters: {} });
    return;
  }
  const fresh = lastTransferTs ? incoming.filter((x) => x.ts > lastTransferTs) : incoming;
  if (fresh.length) {
    lastTransferTs = fresh[fresh.length - 1].ts;
    for (const x of fresh) {
      const memoTag = x.memo ? ' · memo=' + JSON.stringify(x.memo.slice(0, 80)) : '';
      log('ALERT transfer-in: ' + x.amount + ' from @' + x.from + memoTag);
      // נשמר ב-STATUS המרכזי ונכתב אטומית (התנהגות task 19)
      STATUS.lastIncoming = { ts: x.ts, from: x.from, amount: x.amount, memo: x.memo.slice(0, 80) };
      // 62 — ערך-ממו: כל ממו saos: נאסף כהזמנה לפנקס (מסחר-ממו)
      parseMemoIntent(x);
    }
    // Task 55 — external-event reflex: transfer detection → swarm reaction
    maybeExternalReflex(fresh);
  }
  log('transfer-watch: ' + fresh.length + ' new incoming (' + incoming.length + ' in last-100 ops)');
  updateLoop('transferWatch', { status: 'ok', detail: fresh.length + ' new incoming', counters: {} });
}

/* ------------------------------------------------------------------ *
 * לופ 4 — קוראציה (CURATION_ENABLED=false כברירת מחדל)
 * סורק פוסטים חדשים, מדלג על הצבעות-עצמי/כפולות, שער-VP, משקל מוגדר.
 * דה-דופ קבוע ב-curation_seen.json (500 כניסות, חיתוך מהישן) — הפעלה
 * מחדש לא תצביע שוב על אותם פוסטים. DRY_RUN מדפיס בלי לחתום.
 * ההצבעה posting-key בלבד.
 * ------------------------------------------------------------------ */
let votesToday = { date: '', count: 0 };

function loadSeenArray() {
  try {
    const j = JSON.parse(fs.readFileSync(SEEN_PATH, 'utf8'));
    if (Array.isArray(j)) return j.filter((x) => typeof x === 'string');
  } catch (_) {
    /* קובץ חסר/פגום = מתחילים ריק */
  }
  return [];
}
let seenArr = loadSeenArray();
let seenSet = new Set(seenArr);

function persistSeen() {
  const tmp = SEEN_PATH + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(seenArr) + '\n');
    fs.renameSync(tmp, SEEN_PATH);
  } catch (e) {
    log('curation: failed to persist curation_seen.json: ' + ((e && e.message) || e));
  }
}
function markSeen(keys) {
  let added = 0;
  for (const k of keys) {
    if (seenSet.has(k)) continue;
    seenSet.add(k);
    seenArr.push(k);
    added++;
  }
  while (seenArr.length > CURATION_SEEN_CAP) {
    const dropped = seenArr.shift(); // הישן ביותר
    seenSet.delete(dropped);
  }
  return added;
}

// 43 — דה-דופ צבאי (army_seen.json): פוסט שהצביע בו כל חשבון-צבא לא יתוכנן שוב
// על-ידי אף חשבון — מונע חתימה-קבוצתית גלויה על אותו פוסט (רושם טבעי יותר + חיסכון VP)
function loadArmySeenArray() {
  try {
    const j = JSON.parse(fs.readFileSync(ARMY_SEEN_PATH, 'utf8'));
    if (Array.isArray(j)) return j.filter((x) => typeof x === 'string');
  } catch (_) {
    /* חסר/פגום = ריק */
  }
  return [];
}
let armySeenArr = loadArmySeenArray();
let armySeenSet = new Set(armySeenArr);
const ARMY_SEEN_CAP = 800;

function persistArmySeen() {
  const tmp = ARMY_SEEN_PATH + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(armySeenArr) + '\n');
    fs.renameSync(tmp, ARMY_SEEN_PATH);
  } catch (e) {
    log('army: failed to persist army_seen.json: ' + ((e && e.message) || e));
  }
}
function markArmySeen(keys) {
  let added = 0;
  for (const k of keys) {
    if (armySeenSet.has(k)) continue;
    armySeenSet.add(k);
    armySeenArr.push(k);
    added++;
  }
  while (armySeenArr.length > ARMY_SEEN_CAP) {
    const dropped = armySeenArr.shift();
    armySeenSet.delete(dropped);
  }
  return added;
}

// 43 — מוני-יום צבאיים נמשכים לדיסק (army_day.json): הפעלה-מחדש של הדמון לא מאפסת
// תקציבים — חוזה-יום UTC אחד: תביעות / הצבעות פר-חשבון / סוויפים.
function loadArmyDay() {
  try {
    const j = JSON.parse(fs.readFileSync(ARMY_DAY_PATH, 'utf8'));
    if (j && typeof j === 'object') return j;
  } catch (_) {
    /* חסר = יום טרי */
  }
  return {};
}
const ARMY_DAY = loadArmyDay();

function armyDayGet(key, dflt) {
  const v = ARMY_DAY[utcToday()] && ARMY_DAY[utcToday()][key];
  return v === undefined ? dflt : v;
}
function armyDaySet(key, value) {
  const today = utcToday();
  if (!ARMY_DAY[today] || typeof ARMY_DAY[today] !== 'object') {
    // שמירה רק על היום הנוכחי — היסטוריה ישנה נזרקת
    for (const k of Object.keys(ARMY_DAY)) delete ARMY_DAY[k];
    ARMY_DAY[today] = {};
  }
  ARMY_DAY[today][key] = value;
  try {
    const tmp = ARMY_DAY_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(ARMY_DAY, null, 0) + '\n');
    fs.renameSync(tmp, ARMY_DAY_PATH);
  } catch (e) {
    log('army: failed to persist army_day.json: ' + ((e && e.message) || e));
  }
}

// VP% מתוך voting_manabar.current_mana / (vests אפקטיבי × 1e6)
function computeVpPct(acc) {
  if (!acc) return null;
  const effective =
    amt(acc.vesting_shares) - amt(acc.delegated_vesting_shares) + amt(acc.received_vesting_shares);
  const maxMana = effective * 1e6;
  const cur = Number(acc.voting_manabar && acc.voting_manabar.current_mana);
  if (!(maxMana > 0) || !Number.isFinite(cur)) return null;
  return Math.max(0, Math.min(100, (cur / maxMana) * 100));
}

function postAgeMinutes(discussion) {
  const t = Date.parse(discussion.created + (discussion.created.endsWith('Z') ? '' : 'Z'));
  return Number.isFinite(t) ? (Date.now() - t) / 60000 : Infinity;
}

async function curationCycle() {
  if (!CONFIG.curationEnabled) return;
  ensureAsyncMethod(steem.api, 'getDiscussionsByCreatedAsync');
  const today = utcToday();
  if (votesToday.date !== today) votesToday = { date: today, count: 0 };
  const counters = () => ({ votesToday: votesToday.count, candidates: 0 });

  // שער-VP: אין הצבעה כשכוח-ההצבעה מתחת לסף
  let vp = null;
  try {
    const accArr = await cachedAccounts();
    vp = computeVpPct(accArr && accArr[0]);
  } catch (e) {
    log('curation: VP lookup failed: ' + ((e && e.message) || e));
  }
  if (vp !== null && vp < CONFIG.curationMinVpPct) {
    log('curation: VP ' + vp.toFixed(1) + '% < CURATION_MIN_VP_PCT ' + CONFIG.curationMinVpPct + '% — skipping voting this cycle');
    updateLoop('curation', { status: 'skipped', detail: 'VP ' + vp.toFixed(1) + '% < ' + CONFIG.curationMinVpPct + '%', counters: counters() });
    return;
  }

  const scanSeen = new Set();
  const candidates = [];
  for (const tag of CONFIG.curationTags) {
    let disc = [];
    try {
      disc = await withTimeout(
        steem.api.getDiscussionsByCreatedAsync({ tag, limit: 20 }),
        CONFIG.rpcTimeoutMs,
        'get_discussions_by_created'
      );
    } catch (e) {
      log('curation: tag "' + tag + '" error: ' + ((e && e.message) || e));
      continue;
    }
    for (const d of disc || []) {
      const key = d.author + '/' + d.permlink;
      if (scanSeen.has(key)) continue;
      scanSeen.add(key);
      if (seenSet.has(key)) continue; // דה-דופ מתמשך — שרד הפעלות
      const ageMin = postAgeMinutes(d);
      if (ageMin < CONFIG.curationMinAgeMin) continue;          // חלון-מכירה מוקדם
      if (ageMin > 6 * 24 * 60) continue;                        // מאוחר מדי לקוראציה
      if (String(d.author) === CONFIG.account) continue;         // ללא self-vote
      const already = (d.active_votes || []).some((v) => v.voter === CONFIG.account);
      if (already) continue;
      const bodyLen = String(d.body || '').length;
      if (bodyLen < 400) continue;                               // סף איכות בסיסי
      candidates.push({ key, author: d.author, permlink: d.permlink, ageMin, bodyLen, title: String(d.title || '').slice(0, 60) });
    }
  }
  const budget = CONFIG.curationMaxVotesDay - votesToday.count;
  const picks = candidates.slice(0, Math.max(budget, 0));
  if (!picks.length) {
    log('curation: 0 candidates (scanned=' + scanSeen.size + ', seen-file=' + seenArr.length + ', votesToday=' + votesToday.count + (vp !== null ? ', VP ' + vp.toFixed(1) + '%' : '') + ')');
    updateLoop('curation', { status: 'ok', detail: '0 candidates (scanned=' + scanSeen.size + ', seen-file=' + seenArr.length + ')', counters: { votesToday: votesToday.count, candidates: 0 } });
    return;
  }

  // משקל הצבעה: אחוז × 100 (יחידת-משקל של Steem)
  const weightPct = Math.min(100, Math.max(1, CONFIG.curationVoteWeightPct));
  const weight = Math.round(weightPct * 100);
  const dry = CONFIG.dryRun || !CONFIG.postingWif;
  const actedKeys = [];
  for (const p of picks) {
    votesToday.count++;
    actedKeys.push(p.key);
    const op = ['vote', { voter: CONFIG.account, author: p.author, permlink: p.permlink, weight }];
    if (dry) {
      log('[DRY_RUN] would vote @' + p.key + ' weight=' + weightPct + '% age=' + Math.round(p.ageMin) + 'm len=' + p.bodyLen);
    } else {
      try {
        const res = await steem.broadcast.sendAsync({ operations: [op], extensions: [] }, [CONFIG.postingWif]);
        log('voted @' + p.key + ' · weight=' + weightPct + '% · txid=' + (res && res.id));
      } catch (e) {
        log('vote error @' + p.key + ': ' + ((e && e.message) || e));
      }
    }
  }
  // דה-דופ קבוע: מסומנים גם ב-DRY_RUN — הרצה חוזרת לא תתכנן שוב את אותם פוסטים
  const added = markSeen(actedKeys);
  if (added) persistSeen();

  log('curation: ' + picks.length + ' planned/acted votes · weight ' + weightPct + '% · seen-file=' + seenArr.length + (added ? ' (+' + added + ')' : '') + (vp !== null ? ' · VP ' + vp.toFixed(1) + '%' : ''));
  updateLoop('curation', {
    status: dry ? 'dry' : 'ok',
    detail: picks.length + ' votes ' + (dry ? 'planned (DRY_RUN)' : 'broadcast') + ' · weight ' + weightPct + '% · seen-file=' + seenArr.length,
    counters: { votesToday: votesToday.count, candidates: candidates.length },
  });
}

/* ------------------------------------------------------------------ *
 * 43-a — לופ צבא: תביעת פרסים לכל חשבון-צבא (posting key של כל חשבון).
 * קריאת get_accounts אחת משותפת (קאש) + dgp אחת — גם ל-20 חשבונות.
 * ------------------------------------------------------------------ */
let armyClaimsToday = { date: '', count: 0 };

async function armyClaimCycle() {
  armyClaimsToday = { date: utcToday(), count: armyDayGet('claims', 0) };
  const counters = () => ({ claimsToday: armyDayGet('claims', 0), armySize: ARMY.length });

  STATUS.army.size = ARMY.length;
  STATUS.army.operator = ARMY.filter((a) => a.tier === 'operator').length;
  STATUS.army.factory = ARMY.filter((a) => a.tier === 'factory').length;

  if (!ARMY.length) {
    updateLoop('armyClaim', { status: 'idle', detail: 'army empty — חבר חשבונות בכספת (כספת → צבא)', counters: counters() });
    return;
  }

  const [dgp, accArr] = await Promise.all([api.dgp(), armyAccountsData()]);
  const fund = amt(dgp.total_vesting_fund_steem);
  const shares = amt(dgp.total_vesting_shares);
  const vest2sp = shares > 0 ? fund / shares : 0;
  const byName = armyByName(accArr);

  let claimable = 0;
  let pendingSp = 0;
  for (const a of ARMY) {
    if (!a.postingWif) continue;
    const acc = byName[a.username];
    if (!acc) continue;
    const rvb = acc.reward_vesting_balance || '0.000000 VESTS';
    const rewardSteem = acc.reward_steem_balance || '0.000 STEEM';
    const rewardSbd = acc.reward_sbd_balance || '0.000 SBD';
    const vests = amt(rvb);
    const sp = vests * vest2sp;
    pendingSp += sp;
    if (vests <= 0 && amt(rewardSteem) <= 0 && amt(rewardSbd) <= 0) continue;
    claimable++;
    const op = ['claim_reward_balance', { account: a.username, reward_steem: rewardSteem, reward_sbd: rewardSbd, reward_vests: rvb }];
    if (CONFIG.dryRun) {
      log('[DRY_RUN] army-claim @' + a.username + ': would claim ' + rewardSteem + ' + ' + rewardSbd + ' + ' + rvb + ' (≈' + sp.toFixed(3) + ' SP)');
      continue;
    }
    try {
      const conf = await steem.broadcast.sendAsync({ operations: [op], extensions: [] }, [a.postingWif]);
      armyDaySet('claims', armyDayGet('claims', 0) + 1);
      log('army-claim @' + a.username + ': broadcast ok txid=' + ((conf && conf.id) || 'n/a') + ' (≈' + sp.toFixed(3) + ' SP)');
    } catch (e) {
      log('army-claim @' + a.username + ' FAILED: ' + ((e && e.message) || e));
    }
  }

  STATUS.army.pendingSp = round(pendingSp, 3);
  log('army-claim: ' + claimable + '/' + ARMY.length + ' accounts claimable · pending ≈' + pendingSp.toFixed(3) + ' SP');
  updateLoop('armyClaim', {
    status: CONFIG.dryRun && claimable ? 'dry' : 'ok',
    detail: claimable + '/' + ARMY.length + ' claimable · pending ≈' + pendingSp.toFixed(3) + ' SP',
    counters: counters(),
  });
}

/* ------------------------------------------------------------------ *
 * 43-b — לופ צבא: קוראציה משובצת. כל חשבון מקבל פס-שונה של המועמדים
 * (idx % voters) — אין שני חשבונות שלנו שמצביעים על אותו פוסט, וגם
 * army_seen.json מונע תכנון חוזר. שער-VP פר-חשבון + תקציב יומי פר-חשבון.
 * ------------------------------------------------------------------ */
let armyVotesDay = { date: '', perAccount: {} };

async function armyCurationCycle() {
  const counters = () => ({
    votesToday: Object.values(armyDayGet('votesPerAccount', {})).reduce((s, n) => s + n, 0),
    armySize: ARMY.length,
  });

  const voters = ARMY.filter((a) => a.postingWif);
  if (!voters.length) {
    updateLoop('armyCuration', { status: 'idle', detail: 'no army voters with posting keys', counters: counters() });
    return;
  }

  ensureAsyncMethod(steem.api, 'getDiscussionsByCreatedAsync');
  const accArr = await armyAccountsData();
  const byName = armyByName(accArr);
  const ourVoters = new Set([String(CONFIG.account).toLowerCase(), ...voters.map((v) => v.username)]);

  // סריקת מועמדים — סף-איכות זהה לראשי + דילוג על כל-פוסט שכבר הצביע בו אחד משלנו
  const candidates = [];
  let scanned = 0;
  for (const tag of CONFIG.curationTags) {
    let disc = [];
    try {
      disc = await withTimeout(
        steem.api.getDiscussionsByCreatedAsync({ tag, limit: 20 }),
        CONFIG.rpcTimeoutMs,
        'get_discussions_by_created(army)'
      );
    } catch (e) {
      continue;
    }
    for (const d of disc || []) {
      scanned++;
      const key = d.author + '/' + d.permlink;
      if (armySeenSet.has(key)) continue;
      const ageMin = postAgeMinutes(d);
      if (ageMin < CONFIG.curationMinAgeMin || ageMin > 6 * 24 * 60) continue;
      if (String(d.body || '').length < 400) continue;
      const already = (d.active_votes || []).some((v) => ourVoters.has(String(v.voter).toLowerCase()));
      if (already) continue;
      candidates.push({ key, author: String(d.author), permlink: d.permlink, ageMin });
    }
  }

  const weightPct = Math.min(100, Math.max(1, CONFIG.curationVoteWeightPct));
  const weight = Math.round(weightPct * 100);
  let acted = 0;
  const actedKeys = [];
  for (let vi = 0; vi < voters.length; vi++) {
    const voter = voters[vi];
    const perAccount = armyDayGet('votesPerAccount', {});
    const used = perAccount[voter.username] || 0;
    const budget = CONFIG.armyCurationMaxVotesDay - used;
    if (budget <= 0) continue;
    const acc = byName[voter.username];
    const vp = computeVpPct(acc);
    if (vp !== null && vp < CONFIG.armyCurationMinVpPct) continue;
    // פס-אישי: מועמדים במקומות idx ≡ vi (mod voters) — שיבוץ קבוע וצפוי
    const shard = candidates.filter((_, idx) => idx % voters.length === vi).slice(0, budget);
    for (const p of shard) {
      const cur = armyDayGet('votesPerAccount', {});
      armyDaySet('votesPerAccount', { ...cur, [voter.username]: (cur[voter.username] || 0) + 1 });
      acted++;
      actedKeys.push(p.key);
      const op = ['vote', { voter: voter.username, author: p.author, permlink: p.permlink, weight }];
      if (CONFIG.dryRun) {
        log('[DRY_RUN] army-vote @' + voter.username + ' → @' + p.key + ' weight=' + weightPct + '% age=' + Math.round(p.ageMin) + 'm');
        continue;
      }
      try {
        const res = await steem.broadcast.sendAsync({ operations: [op], extensions: [] }, [voter.postingWif]);
        log('army-vote @' + voter.username + ' → @' + p.key + ' · weight=' + weightPct + '% · txid=' + ((res && res.id) || 'n/a'));
      } catch (e) {
        log('army-vote @' + voter.username + ' error @' + p.key + ': ' + ((e && e.message) || e));
      }
    }
  }
  if (actedKeys.length) {
    markArmySeen(actedKeys);
    persistArmySeen();
  }

  log('army-curation: ' + acted + ' votes across ' + voters.length + ' voters (scanned=' + scanned + ', seen=' + armySeenArr.length + ')');
  updateLoop('armyCuration', {
    status: CONFIG.dryRun && acted ? 'dry' : 'ok',
    detail: acted + ' votes · ' + voters.length + ' voters (scanned=' + scanned + ', seen=' + armySeenArr.length + ')',
    counters: counters(),
  });
}

/* ------------------------------------------------------------------ *
 * 43-c — לופ צבא: ריכוז-ערך. יתרה נזילה מעל הסף בחשבון-צבא → העברה
 * לחשבון הראשי (active key של החשבון עצמו). תקציב יומי + רצפת פרוטות.
 * ------------------------------------------------------------------ */
let armySweepToday = { date: '', count: 0 };

async function armySweepCycle() {
  armySweepToday = { date: utcToday(), count: armyDayGet('sweeps', 0) };
  const counters = () => ({ sweepsToday: armyDayGet('sweeps', 0), armySize: ARMY.length });

  const movers = ARMY.filter((a) => a.activeWif);
  if (!movers.length) {
    updateLoop('armySweep', { status: 'idle', detail: 'no army accounts with active keys — sweep dormant', counters: counters() });
    return;
  }
  const accArr = await armyAccountsData();
  const byName = armyByName(accArr);

  let swept = 0;
  let sweptAmount = 0;
  for (const a of movers) {
    if (armySweepToday.count >= CONFIG.armySweepMaxDay) break;
    const acc = byName[a.username];
    if (!acc) continue;
    const liquid = amt(acc.balance); // "x.xxx STEEM"
    if (liquid < CONFIG.armySweepMinSteem) continue;
    const amountStr = (liquid - 0.001).toFixed(3) + ' STEEM'; // משאיר פרוטות לעמלת-רשת
    const op = ['transfer', { from: a.username, to: CONFIG.account, amount: amountStr, memo: 'army-sweep' }];
    if (CONFIG.dryRun) {
      log('[DRY_RUN] army-sweep @' + a.username + ': would transfer ' + amountStr + ' → @' + CONFIG.account);
      swept++;
      sweptAmount += liquid - 0.001;
      continue;
    }
    try {
      const conf = await steem.broadcast.sendAsync({ operations: [op], extensions: [] }, [a.activeWif]);
      swept++;
      sweptAmount += liquid - 0.001;
      armyDaySet('sweeps', armyDayGet('sweeps', 0) + 1);
      log('army-sweep @' + a.username + ': transferred ' + amountStr + ' → @' + CONFIG.account + ' txid=' + ((conf && conf.id) || 'n/a'));
    } catch (e) {
      log('army-sweep @' + a.username + ' FAILED: ' + ((e && e.message) || e));
    }
  }

  if (sweptAmount > 0 && !CONFIG.dryRun) {
    STATUS.army.sweptSteem = round((STATUS.army.sweptSteem || 0) + sweptAmount, 3);
  }
  log('army-sweep: ' + swept + ' transfers · ≈' + sweptAmount.toFixed(3) + ' STEEM → @' + CONFIG.account);
  updateLoop('armySweep', {
    status: CONFIG.dryRun && swept ? 'dry' : 'ok',
    detail: swept + ' transfers · ≈' + sweptAmount.toFixed(3) + ' STEEM (threshold ' + CONFIG.armySweepMinSteem + ' STEEM)',
    counters: counters(),
  });
}

/* ------------------------------------------------------------------ *
 * 44 — SCI: תשתית-שרשראות ריבונית (SAOS Chain Infrastructure)
 *
 * a) worldlogCycle — יומן-עולם חתום-האש (hash-chained log): כל אירוע
 *    {seq, prev, h, body} כאשר h=sha256(seq|prev|time|body) ו-prev=h של
 *    האירוע הקודם. כל אירוע נחתם custom_json id='saos' action='wlog' על
 *    Steem ו-Hive באותו payload בדיוק → יומן בלתי-ניתן לזיוף ובלתי-ניתן
 *    לשינוי סדר, עם פריטה דו-שרשרתית (parity) שכל צד-שלישי יכול לאמת.
 * b) commandBusCycle — ערוץ-פקודה מוצפן: המפעיל שולח transfer עם memo
 *    מוצפן (steem.memo.encode מפתח-memo שלנו → מפתח-memo של החייל) והדמון
 *    מפענח עם מפתח-memo של החייל, מריץ את הפקודה ומאשר custom_json
 *    id='saos_ack' חתום במפתח-הפרסום של החייל. ערוץ פיקוד סמוי, מאומת,
 *    על-השרשרת — בלי לחשוף תוכן לציבור.
 * ------------------------------------------------------------------ */
const WORLDLOG_PATH = path.join(__dirname, 'worldlog.json');
const COMMAND_SEEN_PATH = path.join(__dirname, 'command_seen.json');
// 45 — SAOS-Net mission queue state
const NET_STATE_PATH = path.join(__dirname, 'net_state.json');
const NET_TASKS_PENDING_PATH = path.join(__dirname, 'net_tasks_pending.json');

function loadWorldlogState() {
  try {
    const j = JSON.parse(fs.readFileSync(WORLDLOG_PATH, 'utf8'));
    if (j && typeof j.seq === 'number') return j;
  } catch (_) { /* genesis */ }
  return { seq: 0, prev: 'GENESIS', lastAt: null, lastSteemTxid: null, lastHiveTxid: null, total: 0 };
}
function writeWorldlogState(st) {
  try { fs.writeFileSync(WORLDLOG_PATH, JSON.stringify(st, null, 2) + '\n'); } catch (_) { /* non-fatal */ }
}
function loadCommandSeen() {
  try {
    const j = JSON.parse(fs.readFileSync(COMMAND_SEEN_PATH, 'utf8'));
    if (j && j.commands && typeof j.commands === 'object') return j;
  } catch (_) { /* empty */ }
  return { commands: {} };
}
function writeCommandSeen(st) {
  try { fs.writeFileSync(COMMAND_SEEN_PATH, JSON.stringify(st, null, 2) + '\n'); } catch (_) { /* non-fatal */ }
}

/* ------------------------------------------------------------------ *
 * 45 — SAOS-Net mission queue: התשתית שמנתבת חיילים למשימות על-השרשרת.
 *   submit  (id='saos_task', ע"י המפעיל/קונסולה)  {action:'submit', id, cmd, args}
 *   assign  (id='saos_net', ע"י המפעיל)            {action:'assign', task, to}
 *   result  (id='saos_result'/'saos_drill', ע"י החייל עצמו — מפתח-פרסום שלו)
 * תור מטלות ציבורי וניתן-לביקורת: כל שלב חתום וקריא לכל צד-שלישי.
 * ------------------------------------------------------------------ */
function loadNetState() {
  try {
    const j = JSON.parse(fs.readFileSync(NET_STATE_PATH, 'utf8'));
    if (j && typeof j.tasks === 'object') return j;
  } catch (_) { /* genesis */ }
  return { tasks: {}, rr: 0 };
}
function writeNetState(st) {
  try { fs.writeFileSync(NET_STATE_PATH, JSON.stringify(st, null, 2) + '\n'); } catch (_) { /* non-fatal */ }
}
function loadNetPending() {
  try {
    const j = JSON.parse(fs.readFileSync(NET_TASKS_PENDING_PATH, 'utf8'));
    if (j && Array.isArray(j.tasks)) return j;
  } catch (_) { /* empty */ }
  return { tasks: [] };
}
function writeNetPending(st) {
  try { fs.writeFileSync(NET_TASKS_PENDING_PATH, JSON.stringify(st, null, 2) + '\n'); } catch (_) { /* non-fatal */ }
}

/** סטטוס אמיתי של חייל — נמדד מהשרשרת, מוטמע ב-saos_result חתום שלו */
async function soldierStatus(name) {
  const [accArr, dgpo] = await Promise.all([
    steem.api.getAccountsAsync([name]),
    steem.api.getDynamicGlobalPropertiesAsync(),
  ]);
  const acc = accArr && accArr[0];
  if (!acc) return { exists: false };
  const vests = parseFloat(acc.vesting_shares) + parseFloat(acc.received_vesting_shares) - parseFloat(acc.delegated_vesting_shares);
  const vestsPerSp = parseFloat(dgpo.total_vesting_shares) / parseFloat(dgpo.total_vesting_fund_steem);
  let rcPct = null;
  try {
    const raw = await api.call('rc_api.find_rc_accounts', { accounts: [name] });
    const r = rcFromRaw(raw);
    if (r) rcPct = round(r.pct, 2);
  } catch (_) { /* optional */ }
  return {
    exists: true,
    sp: round(vests / vestsPerSp, 3),
    vp: round(computeVpPct(acc), 2),
    rc: rcPct,
    steem: acc.balance,
    sbd: acc.sbd_balance,
    created: acc.created,
  };
}

function wlogHash(seq, prev, time, body) {
  return require('crypto')
    .createHash('sha256')
    .update(seq + '|' + prev + '|' + time + '|' + JSON.stringify(body))
    .digest('hex')
    .slice(0, 24);
}

async function worldlogCycle() {
  const counters = () => { const s = loadWorldlogState(); return { seq: s.seq, total: s.total }; };
  if (!CONFIG.postingWif) {
    updateLoop('worldlog', { status: 'disabled', detail: 'no POSTING_WIF', counters: counters() });
    return;
  }
  if (CONFIG.dryRun) {
    updateLoop('worldlog', { status: 'dry', detail: 'DRY_RUN — אירועים לא נכתבים', counters: counters() });
    return;
  }

  const st = loadWorldlogState();
  const seq = st.seq + 1;
  const time = new Date().toISOString();
  // גוף האירוע: תמצית-מצב אמיתית (כל אירוע = snapshot ניתן-לאימות, לא רעש)
  let body = { type: 'heartbeat', army: ARMY.length, worldlogV: 1 };
  try {
    const [accArr, dgp] = await Promise.all([
      steem.api.getAccountsAsync([CONFIG.account]),
      rpcV4(CONFIG.rpcUrl, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 }),
    ]);
    const acc = accArr && accArr[0];
    if (acc) body.steem = acc.balance; body.hbd = acc.sbd_balance;
    if (dgp && dgp.time) body.chainTime = dgp.time;
  } catch (_) { /* degrade — הגוף עדיין חתום-האש */ }
  try {
    const bs = JSON.parse(fs.readFileSync(path.join(__dirname, 'bridge_state.json'), 'utf8'));
    body.anchors = bs.anchoredTotal;
  } catch (_) { /* optional */ }

  const h = wlogHash(seq, st.prev, time, body);
  const payload = { protocol: 'saos/v1', action: 'wlog', account: CONFIG.account, seq, prev: st.prev, h, body, time };

  // Steem — posting custom_json
  let steemTxid = null;
  try {
    const conf = await steem.broadcast.sendAsync({ operations: [saosBusOp(payload)], extensions: [] }, [CONFIG.postingWif]);
    steemTxid = (conf && conf.id) || null;
  } catch (e) {
    updateLoop('worldlog', { status: 'error', detail: 'steem broadcast failed: ' + String((e && e.message) || e).slice(0, 100), counters: counters() });
    return;
  }

  // Hive — אותו payload בדיוק (parity). 53: דרך ראוטר-הצי — האוצר חנוק-RC,
  // החיילים (haran 82% · macrame · tov) נושאים את העיגון. ריבונות-RC חיה.
  let hiveTxid = null;
  try {
    const routed = await hiveFleetAnchor(
      [['custom_json', { required_auths: [], required_posting_auths: [CONFIG.account], id: 'saos', json: JSON.stringify(payload) }]],
      time
    );
    hiveTxid = (routed && routed.txid) || null;
  } catch (e) {
    updateLoop('worldlog', {
      status: 'partial',
      detail: 'steem=ok hive=' + String((e && e.message) || e).slice(0, 80) + ' — יומן חי, parity תמתין לפעימה הבאה',
      counters: counters(),
    });
  }

  const next = {
    seq,
    prev: h, // ה-hash הזה הוא ה-prev של האירוע הבא
    lastAt: time,
    lastSteemTxid: steemTxid || st.lastSteemTxid,
    lastHiveTxid: hiveTxid || st.lastHiveTxid,
    total: st.total + (steemTxid ? 1 : 0) + (hiveTxid ? 1 : 0),
  };
  if (steemTxid || hiveTxid) writeWorldlogState(next);
  const detail = 'seq=' + seq + ' h=' + h.slice(0, 10) + '… · steem=' + (steemTxid ? steemTxid.slice(0, 10) + '…' : '—') +
    ' · hive=' + (hiveTxid ? String(hiveTxid).slice(0, 10) + '…' : 'pending');
  log('worldlog: ' + detail);
  updateLoop('worldlog', { status: steemTxid && hiveTxid ? 'ok' : 'partial', detail, counters: counters() });
}

async function commandBusCycle() {
  const counters = () => {
    const s = loadCommandSeen();
    return { decoded: Object.keys(s.commands).length, army: ARMY.filter((a) => a.memoWif).length };
  };
  const soldiers = ARMY.filter((a) => a.memoWif);
  if (!soldiers.length) {
    updateLoop('commandBus', { status: 'idle', detail: 'אין חיילים עם מפתח-memo בכספת — הערוץ רדום', counters: counters() });
    return;
  }
  let hist;
  try {
    hist = await histFresh(CONFIG.account, 100);
    if (!hist) throw new Error('all history nodes stale');
  } catch (e) {
    log('commandBus: history scan failed — ' + ((e && e.message) || e));
    updateLoop('commandBus', { status: 'error', detail: 'history scan failed: ' + String((e && e.message) || e).slice(0, 100), counters: counters() });
    return;
  }
  const seen = loadCommandSeen();
  const byName = {};
  for (const s of soldiers) byName[s.username] = s;

  let decodedNew = 0;
  /* 95 — ריבוני-מלא: ערוץ-הפקודה עבר-מהגירה — custom_json 'saos-cmd' (אפס-STEEM,
   * מפתח-פרסום בלבד) עם-memo מוצפן-ECDH בתוך ה-json (enc). מסילת-ה-transfer של
   * 0.001-STEEM נשארת-כאן-גם-כן (תאימות-לאחור לפקודות-ישנות-בחלון) — אבל-החדשות-ריבוניות. */
  const seenList = hist
    .filter(([, e]) => e.op[0] === 'transfer' && byName[String(e.op[1].to || '').toLowerCase()] && String(e.op[1].memo || '').startsWith('#'))
    .map(([, e]) => e);
  const cjList = hist
    .filter(([, e]) => e.op[0] === 'custom_json' && e.op[1] && e.op[1].id === 'saos-cmd')
    .map(([, e]) => {
      let j = null;
      try { j = JSON.parse(String(e.op[1].json || '{}')); } catch (_) { return null; }
      if (!j || !byName[String(j.to || '').toLowerCase()] || typeof j.enc !== 'string' || !j.enc.startsWith('#')) return null;
      return { trx_id: e.trx_id, op: [ 'custom_json', { to: j.to, memo: j.enc } ] };
    })
    .filter(Boolean);
  const merged = seenList.concat(cjList);
  for (const e of merged) {
    const to = String(e.op[1].to || '').toLowerCase();
    const soldier = byName[to];
    const memo = String(e.op[1].memo || '');
    let payload = null;
    try {
      const plain = steem.memo.decode(soldier.memoWif, memo); // הפענוח עם המפתח של החייל — הוכחת-הצפנה
      // steem-js convention: decode() PREPENDS '#…' to the plaintext — strip it
      const bare = plain.startsWith('#') ? plain.slice(1) : plain;
      payload = JSON.parse(bare);
    } catch (_) {
      continue; // לא שלנו / לא ניתן לפענוח — התעלמות שקטה
    }
    if (!payload || !payload.nonce || seen.commands[payload.nonce]) continue;
    seen.commands[payload.nonce] = {
      cmd: String(payload.cmd || '?'),
      by: to,
      at: new Date().toISOString(),
      txid: e.trx_id || '',
      sentAt: payload.ts || '',
      args: payload.args && typeof payload.args === 'object' ? payload.args : undefined,
    };
    decodedNew++;
    // ביצוע + אישור חתום על-השרשרת במפתח-הפרסום של החייל
    let actionNote = 'ack';
    if (payload.cmd === 'sweep_now') {
      armySweepCycle().catch(() => {}); // אל-חזרה: הלולאה הסטנדרטית אחראית על הסטטוס
      actionNote = 'ack+sweep';
    }
    try {
      const ackOp = [
        'custom_json',
        {
          required_auths: [],
          required_posting_auths: [to],
          id: 'saos_ack',
          json: JSON.stringify({ protocol: 'saos/v1', action: 'ack', ackOf: payload.nonce, cmd: payload.cmd, by: to, note: actionNote, ts: new Date().toISOString() }),
        },
      ];
      const conf = await steem.broadcast.sendAsync({ operations: [ackOp], extensions: [] }, [soldier.postingWif]);
      log('commandBus: decoded cmd=' + payload.cmd + ' nonce=' + String(payload.nonce).slice(0, 8) + '… for @' + to + ' → ack txid=' + ((conf && conf.id) || 'n/a'));
    } catch (ackErr) {
      log('commandBus: decode ok but ACK broadcast failed for @' + to + ': ' + ((ackErr && ackErr.message) || ackErr));
      // ה-nonce נשמר — לא נבצע פקודה פעמיים גם אם האישור נפל
    }
    // 45 — ביצוע-משימה: החייל עצמו מפרסם את התוצאה במפתח-הפרסום שלו.
    //   report/status → saos_result {data: סטטוס אמיתי נמדד}
    //   drill         → saos_drill  {חתימת תרגיל-רשת}
    if (payload.cmd === 'report' || payload.cmd === 'status' || payload.cmd === 'drill') {
      try {
        let resultPayload;
        let resultId;
        if (payload.cmd === 'drill') {
          resultId = 'saos_drill';
          resultPayload = { protocol: 'saos-net/v1', action: 'drill', task: payload.task || null, by: to, ts: new Date().toISOString() };
        } else {
          resultId = 'saos_result';
          const data = await soldierStatus(to);
          resultPayload = { protocol: 'saos-net/v1', action: 'result', task: payload.task || null, cmd: payload.cmd, by: to, data, ts: new Date().toISOString() };
        }
        const resOp = [
          'custom_json',
          { required_auths: [], required_posting_auths: [to], id: resultId, json: JSON.stringify(resultPayload) },
        ];
        const rc2 = await steem.broadcast.sendAsync({ operations: [resOp], extensions: [] }, [soldier.postingWif]);
        actionNote = 'ack+result';
        log('commandBus: mission result by @' + to + ' — task=' + (payload.task || 'none') + ' txid=' + ((rc2 && rc2.id) || 'n/a'));
      } catch (resErr) {
        log('commandBus: mission-result broadcast failed for @' + to + ': ' + ((resErr && resErr.message) || resErr));
      }
    }
  }
  if (decodedNew > 0) writeCommandSeen(seen);
  const total = Object.keys(seen.commands).length;
  const last = Object.values(seen.commands).slice(-1)[0];
  updateLoop('commandBus', {
    status: 'ok',
    detail: decodedNew > 0
      ? decodedNew + ' פקודה/ות מפוענחות הפעם · סה״כ ' + total + (last ? ' · אחרונה: ' + last.cmd + '→@' + last.by : '')
      : 'סריקה תקינה · 0 חדשות · סה״כ ' + total,
    counters: counters(),
  });
}

/* ------------------------------------------------------------------ *
 * לופ 45 — SAOS-Net mission queue: תור-משימות ציבורי על-השרשרת.
 *   1. קונסולה כותבת net_tasks_pending.json → הדמון משדר saos_task
 *   2. משימות פתוחות → ניתוב round-robin לחייל (assign על saos_net)
 *      + פקודה מוצפנת (memo-ECDH) עם task id
 *   3. החייל מודה (saos_ack) ומפרסם תוצאה חתומה (saos_result/saos_drill)
 *   4. הדמון קושר תוצאה→משימה ומסמן done. כל השלבים קריאים לצד-שלישי.
 * ------------------------------------------------------------------ */
const MISSION_CMDS = ['report', 'status', 'drill'];
async function netTaskCycle() {
  const counters = () => {
    const st = loadNetState();
    const t = Object.values(st.tasks || {});
    return { total: t.length, open: t.filter((x) => x.status === 'open').length, done: t.filter((x) => x.status === 'done').length };
  };
  if (CONFIG.dryRun) {
    updateLoop('netTask', { status: 'dry', detail: 'DRY_RUN — תור משימות רדום', counters: counters() });
    return;
  }
  const st = loadNetState();
  if (!st.tasks) st.tasks = {};
  if (typeof st.rr !== 'number') st.rr = 0;
  const soldiers = ARMY.filter((a) => a.memoWif && a.postingWif);
  let notes = [];

  // ── 1. הגשות מהקונסולה → saos_task על-השרשרת ──────────────────────
  const pending = loadNetPending();
  for (const t of pending.tasks) {
    if (st.tasks[t.id]) continue; // כבר נשלח
    const payload = { protocol: 'saos-task/v1', action: 'submit', id: t.id, cmd: t.cmd, args: t.args || undefined, ts: t.ts || new Date().toISOString() };
    const op = ['custom_json', { required_auths: [], required_posting_auths: [CONFIG.account], id: 'saos_task', json: JSON.stringify(payload) }];
    try {
      const conf = await steem.broadcast.sendAsync({ operations: [op], extensions: [] }, [CONFIG.postingWif]);
      st.tasks[t.id] = { cmd: t.cmd, args: t.args || null, status: 'open', submittedAt: new Date().toISOString(), submitTxid: (conf && conf.id) || null, assignedTo: null };
      notes.push('submitted ' + t.id);
      log('netTask: submitted mission ' + t.id + ' (' + t.cmd + ') txid=' + ((conf && conf.id) || 'n/a'));
    } catch (e) {
      log('netTask: submit failed for ' + t.id + ': ' + ((e && e.message) || e));
      break; // ננסה במחזור הבא
    }
  }
  if (pending.tasks.length && notes.length) {
    writeNetPending({ tasks: pending.tasks.filter((t) => !st.tasks[t.id]) });
    writeNetState(st);
  }

  // ── 2. ניתוב משימות פתוחות → חיילים (round-robin + פקודה מוצפנת) ──
  const open = Object.entries(st.tasks).filter(([, t]) => t.status === 'open');
  for (const [id, t] of open) {
    if (!soldiers.length) break;
    const soldier = soldiers[st.rr % soldiers.length];
    st.rr = (st.rr + 1) % Math.max(1, soldiers.length);
    const nonce = require('crypto').randomBytes(10).toString('hex');
    const assignPayload = { protocol: 'saos-net/v1', action: 'assign', task: id, to: soldier.username, via: 'memo', ts: new Date().toISOString() };
    const assignOp = ['custom_json', { required_auths: [], required_posting_auths: [CONFIG.account], id: 'saos_net', json: JSON.stringify(assignPayload) }];
    try {
      const conf = await steem.broadcast.sendAsync({ operations: [assignOp], extensions: [] }, [CONFIG.postingWif]);
      log('netTask: assign ' + id + ' → @' + soldier.username + ' txid=' + ((conf && conf.id) || 'n/a'));
    } catch (e) {
      log('netTask: assign broadcast failed for ' + id + ': ' + ((e && e.message) || e));
      continue;
    }
    // הפקודה המוצפנת — אותו ערוץ memo-ECDH מאומת
    const enc = steem.memo.encode(CONFIG.memoWif, soldier.memoPub, '#' + JSON.stringify({ nonce, cmd: t.cmd, args: t.args || undefined, task: id, ts: new Date().toISOString() }));
    try {
      const c2 = await steem.broadcast.sendAsync({
        operations: [['transfer', { from: CONFIG.account, to: soldier.username, amount: '0.001 STEEM', memo: enc }]],
        extensions: [],
      }, [CONFIG.activeWif]);
      t.status = 'assigned';
      t.assignedTo = soldier.username;
      t.assignedAt = new Date().toISOString();
      t.assignTxid = (c2 && c2.id) || null;
      t.commandNonce = nonce;
      notes.push(id + '→@' + soldier.username);
      log('netTask: encrypted command sent to @' + soldier.username + ' for ' + id);
    } catch (e) {
      log('netTask: command transfer failed for ' + id + ': ' + ((e && e.message) || e));
    }
    writeNetState(st);
  }

  // ── 3. קציר תוצאות: saos_result/saos_drill חתומים של החיילים ───────
  const assignedSoldiers = [...new Set(Object.values(st.tasks).filter((t) => t.status === 'assigned' && t.assignedTo).map((t) => t.assignedTo))];
  for (const name of assignedSoldiers) {
    let hist = [];
    try {
      // condenser history — multi-node fresh-pick (api.steemit.com backends flap on freshness — measured)
      hist = await histFresh(name, 20);
      if (!hist) hist = [];
    } catch (_) { continue; }
    for (const [, e] of hist) {
      if (e.op[0] !== 'custom_json' || (e.op[1].id !== 'saos_result' && e.op[1].id !== 'saos_drill')) continue;
      try {
        const pl = JSON.parse(e.op[1].json);
        if (!pl.task || String(pl.by || '').toLowerCase() !== name) continue;
        const t = st.tasks[pl.task];
        if (!t || t.status !== 'assigned' || t.assignedTo !== name) continue;
        t.status = 'done';
        t.resultTxid = e.trx_id || null;
        t.resultAt = new Date().toISOString();
        t.resultKind = e.op[1].id;
        t.resultData = e.op[1].id === 'saos_result' ? pl.data : undefined;
        notes.push('done ' + pl.task);
        log('netTask: mission DONE ' + pl.task + ' by @' + name + ' txid=' + e.trx_id);
        // 46 — משכורת-השלמה: תשלום אמיתי על עבודה מאומתת (באותו st — לא נדרס)
        if (CONFIG.payrollEnabled && CONFIG.activeWif) await paySoldier(name, pl.task, st);
      } catch (_) { /* next */ }
    }
  }
  if (notes.length) writeNetState(st);

  const c = counters();
  updateLoop('netTask', {
    status: 'ok',
    detail: (notes.length ? notes.slice(0, 3).join(' · ') + ' · ' : '') + 'משימות: ' + c.total + ' · פתוחות ' + c.open + ' · הושלמו ' + c.done,
    counters: c,
  });
}

/* ------------------------------------------------------------------ *
 * לופ 5 — B1 מפעל חשבונות RC (FACTORY_ENABLED=false כברירת מחדל)
 * RC% ≥ FACTORY_RC_TRIGGER_PCT → תובע טיקט (claim_account fee=0) במפתח
 * ACTIVE בלבד, עד FACTORY_MAX_DAY ליום (UTC), עם רצפת FACTORY_RC_FLOOR_PCT.
 * אחרי שידור מצליח: מודד RC לפני/אחרי (delta = factory.lastCostRc — מדידת
 * A2 אוטומטית של עלות claim_account) + דלתא pending_claimed_accounts.
 * ------------------------------------------------------------------ */
let factoryWarnedNoWif = false;
let factoryToday = { date: utcToday(), count: 0 };
let borrowMintInFlight = false; // 52 — מנע-הרצות-מקבילות של mint_borrow
let borrowMintToday = { date: utcToday(), done: false };

/* 38 — לידת סוכן אוטונומית: create_claimed_account + endowment SP בעסקה אחת.
 * המפתחות נוצרים מקומית בתוך factory_create.cjs (agent/keys/, git-ignored) — לא נוגעים בהם כאן. */
function listMintedAgents() {
  const keysDir = path.join(__dirname, 'keys');
  try {
    return fs
      .readdirSync(keysDir)
      .filter((f) => f.endsWith('.json') && f !== 'vault.json') // 43 — vault.json הוא כספת-צבא, לא סוכן
      .map((f) => f.replace(/\.json$/, ''));
  } catch (e) {
    // לקח-R18l (מ-r29): ריקון-שקט-של-רשימת-הצבא היה-תסריט-השטיפה (R18g: army=0-בלי-לדעת-למה) — עתה-הסיבה-בלוג
    log('listMintedAgents: keys-dir לא-נקרא — רשימת-הצבא-ריקה (fail-open): ' + String((e && e.message) || e).slice(0, 100));
    return [];
  }
}

function mintNextAgent() {
  return new Promise((resolve) => {
    const agents = listMintedAgents();
    let n = 1;
    while (agents.includes(CONFIG.factoryAgentPrefix + n)) n++;
    const name = CONFIG.factoryAgentPrefix + n;
    log('mint: spawning identity birth (factory-v2: deterministic + rescue-anchor) — @' + name + ' with ' + CONFIG.factoryAgentSp + ' SP endowment');
    execFile(
      process.execPath,
      [path.join(__dirname, 'factory_v2.cjs'), '--mint', '--creator', CONFIG.account, '--name', name, '--sp', String(CONFIG.factoryAgentSp)],
      { timeout: 150000 },
      (err, stdout, stderr) => {
        const out = String(stdout || '') + String(stderr || '');
        const ok = !err && (/mint VERIFY: .*✓/.test(out) || /MINTED ✓/.test(out));
        if (ok) {
          const fresh = listMintedAgents();
          STATUS.factory.agents = fresh;
          log('mint: @' + name + ' ALIVE — agents: ' + fresh.join(', '));
          updateLoop('factory', {
            status: 'ok',
            detail: 'agent minted @' + name + ' (' + CONFIG.factoryAgentSp + ' SP endowment) · swarm: ' + fresh.join(', '),
            counters: { claimsToday: factoryToday.count, agents: fresh.length },
          });
        } else {
          log('mint: FAILED for @' + name + ' — ' + out.slice(-200).replace(/\n/g, ' | '));
          updateLoop('factory', {
            status: 'error',
            detail: 'mint failed for @' + name + ': ' + out.slice(-120).replace(/\s+/g, ' '),
            counters: { claimsToday: factoryToday.count },
          });
        }
        resolve(ok);
      }
    );
  });
}

/* 38 — סריקת אימפריה: get_key_references דו-שרשרתי על כל המפתחות-הפומביים שלנו.
 * מגלה אוטומטית כל חשבון שהמפתח-הראשי שולט בו (גם אחרי שהמפעיל מוסיף את המפתח
 * לחשבונות נוספים — יתגלו בתוך ≤30 דק' בלי פעולה נוספת). קריאה-בלבד, אין חתימות. */
function empireScanCycle() {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(__dirname, 'keyscan.cjs')], { timeout: 90000 }, (err, stdout, stderr) => {
      const scans = (STATUS.loops.empire && STATUS.loops.empire.counters && STATUS.loops.empire.counters.scans) || 0;
      if (err && !fs.existsSync(path.join(__dirname, 'keyscan_result.json'))) {
        updateLoop('empire', { status: 'error', detail: String((err && err.message) || stderr || 'scan failed').slice(0, 120), counters: { scans } });
        return resolve(false);
      }
      try {
        const res = JSON.parse(fs.readFileSync(path.join(__dirname, 'keyscan_result.json'), 'utf8'));
        STATUS.empire = { scannedAt: res.scannedAt, summary: res.summary };
        updateLoop('empire', {
          status: 'ok',
          detail:
            'key-references: ' + res.summary.steemCount + ' Steem · ' + res.summary.hiveCount + ' Hive · controllable-now ' + res.summary.controllableNow +
            ' · auto-onboard armed (new key-linked accounts discovered ≤' + CONFIG.empireScanMin + 'm)',
          counters: { scans: scans + 1 },
        });
        log('empire: scanned — ' + JSON.stringify(res.summary));
      } catch (e) {
        updateLoop('empire', { status: 'error', detail: 'result parse failed: ' + ((e && e.message) || e), counters: { scans } });
      }
      resolve(true);
    });
  });
}

async function factoryCycle() {
  if (!CONFIG.factoryEnabled) return;
  if (!CONFIG.activeWif) {
    if (!factoryWarnedNoWif) {
      factoryWarnedNoWif = true;
      log('factory: FACTORY_ENABLED=true but no ACTIVE_WIF — factory disabled (claim_account requires active authority; posting is NOT enough)');
    }
    updateLoop('factory', { status: 'disabled', detail: 'FACTORY_ENABLED=true · needs Active WIF', counters: { claimsToday: factoryToday.count } });
    return;
  }
  const today = utcToday();
  if (factoryToday.date !== today) { factoryToday = { date: today, count: 0 }; borrowMintToday = { date: today, done: false }; } // איפות מונים בחצות UTC
  const counters = () => ({ claimsToday: factoryToday.count });

  // (a) RC נוכחי — דרך הקאש המשותף
  const rc = rcFromRaw(await cachedRcRaw().catch(() => null));
  if (!rc) {
    log('factory: rc lookup failed — skip cycle');
    updateLoop('factory', { status: 'error', detail: 'rc_api.find_rc_accounts failed', counters: counters() });
    return;
  }
  STATUS.rc = { max: rc.max, current: rc.current, pct: round(rc.pct, 2) };

  // 38 — auto-mint: טיקט זמין + מכסת-סוכנים לא מלאה + RC עם מרווח → לידת זהות אוטונומית
  if (CONFIG.factoryAutoMint && !CONFIG.dryRun) {
    try {
      const acc = await api.accounts(CONFIG.account);
      const tickets = Number(acc && acc[0] && acc[0].pending_claimed_accounts) || 0;
      STATUS.pendingClaims = tickets;
      const agents = listMintedAgents();
      if (tickets >= 1 && agents.length < CONFIG.factoryMaxAgents && rc.pct >= Math.max(CONFIG.factoryRcFloorPct, 30)) {
        await mintNextAgent();
        return; // פעולת-שרשרת אחת לכל פעימה — קצב עדין
      }
    } catch (e) {
      log('mint: pre-check failed: ' + ((e && e.message) || e));
    }
  }

  if (factoryToday.count >= CONFIG.factoryMaxDay) {
    log('factory: daily cap reached (' + factoryToday.count + '/' + CONFIG.factoryMaxDay + ') — waiting for UTC midnight');
    updateLoop('factory', { status: 'skipped', detail: 'daily cap ' + factoryToday.count + '/' + CONFIG.factoryMaxDay + ' reached', counters: counters() });
    return;
  }
  if (rc.pct < CONFIG.factoryRcFloorPct) {
    log('factory: RC ' + rc.pct.toFixed(1) + '% < floor ' + CONFIG.factoryRcFloorPct + '% — stop claiming (let RC regen)');
    updateLoop('factory', { status: 'skipped', detail: 'RC ' + rc.pct.toFixed(1) + '% below floor ' + CONFIG.factoryRcFloorPct + '%', counters: counters() });
    return;
  }
  // 52 — borrow-mint: כשהאוצר צומח מעל סף-החומה הנמדד — המפעל מלווה-דלק לעצמו ומטביע דרך חייל (mint_borrow --live)
  if (CONFIG.factoryBorrowVests > 0 && !CONFIG.dryRun && factoryToday.count < CONFIG.factoryMaxDay) {
    try {
      const me = await api.accounts(CONFIG.account);
      const ownVests = me && me[0] ? parseFloat(me[0].vesting_shares) : 0;
      if (ownVests >= CONFIG.factoryBorrowVests && !borrowMintInFlight && !borrowMintToday.done) {
        borrowMintInFlight = true;
        borrowMintToday = { date: today, done: true };
        log('factory: borrow-mint ARMED — own vests ' + Math.round(ownVests) + ' ≥ threshold ' + CONFIG.factoryBorrowVests + ' → spawning mint_borrow --live');
        const { spawn } = require('child_process');
        const child = spawn(process.execPath, ['mint_borrow.cjs', '--live'], { cwd: __dirname, detached: true, stdio: ['ignore', fs.openSync(path.join(__dirname, 'mint_borrow.log'), 'a'), fs.openSync(path.join(__dirname, 'mint_borrow.log'), 'a')] });
        child.unref();
        setTimeout(() => { borrowMintInFlight = false; }, 15 * 60 * 1000);
      }
    } catch (e) { log('factory: borrow-mint check failed: ' + ((e && e.message) || e).slice(0, 100)); }
  }
  if (rc.pct < CONFIG.factoryRcTriggerPct) {
    log('factory: RC ' + rc.pct.toFixed(1) + '% < trigger ' + CONFIG.factoryRcTriggerPct + '% — holding');
    updateLoop('factory', { status: 'skipped', detail: 'RC ' + rc.pct.toFixed(1) + '% below trigger ' + CONFIG.factoryRcTriggerPct + '%', counters: counters() });
    return;
  }

  const op = ['claim_account', { creator: CONFIG.account, fee: '0.000 STEEM' }];

  if (CONFIG.dryRun) {
    factoryToday.count++;
    log('[DRY_RUN] would claim_account (ticket) · RC ' + Math.floor(rc.pct) + '% · ' + factoryToday.count + '/' + CONFIG.factoryMaxDay + ' today');
    updateLoop('factory', { status: 'dry', detail: '[DRY_RUN] would claim_account (ticket) · RC ' + Math.floor(rc.pct) + '% · ' + factoryToday.count + '/' + CONFIG.factoryMaxDay + ' today', counters: counters() });
    return;
  }

  // שידור אמיתי — מפתח active. רגע האמת של A2: עלות-RC מדודה לפני/אחרי.
  try {
    const accBefore = await api.accounts(CONFIG.account);
    const ticketsBefore = Number(accBefore && accBefore[0] && accBefore[0].pending_claimed_accounts) || 0;
    const rcBefore = rcFromRaw(await api.call('rc_api.find_rc_accounts', { accounts: [CONFIG.account] }));
    const conf = await steem.broadcast.sendAsync({ operations: [op], extensions: [] }, [CONFIG.activeWif]);
    const txid = (conf && conf.id) || 'n/a';
    await new Promise((r) => setTimeout(r, 2000)); // לותר לשרשרת לספוג את העסקה לפני מדידת-אחרי
    const rcAfterRaw = await api.call('rc_api.find_rc_accounts', { accounts: [CONFIG.account] }).catch(() => null);
    const rcAfter = rcFromRaw(rcAfterRaw);
    const accAfter = await api.accounts(CONFIG.account).catch(() => null);
    const ticketsAfter = Number(accAfter && accAfter[0] && accAfter[0].pending_claimed_accounts) || ticketsBefore;
    const cost = rcBefore && rcAfter ? rcBefore.current - rcAfter.current : null;
    if (rcAfter) STATUS.rc = { max: rcAfter.max, current: rcAfter.current, pct: round(rcAfter.pct, 2) };
    STATUS.factory.lastCostRc = cost;
    factoryToday.count++;
    log(
      'factory: claim_account ok · txid=' + txid +
      ' · tickets ' + ticketsBefore + '→' + ticketsAfter +
      ' · RC ' + (rcBefore ? rcBefore.pct.toFixed(2) : '?') + '%→' + (rcAfter ? rcAfter.pct.toFixed(2) : '?') + '%' +
      (cost !== null ? ' · cost=' + cost + ' RC-mana (factory.lastCostRc — A2 measured)' : '')
    );
    updateLoop('factory', {
      status: 'ok',
      detail: 'ticket claimed · txid=' + txid + ' · cost ' + (cost === null ? '?' : cost) + ' RC · tickets ' + ticketsBefore + '→' + ticketsAfter + ' · ' + factoryToday.count + '/' + CONFIG.factoryMaxDay + ' today',
      counters: counters(),
    });
  } catch (e) {
    log('factory: claim_account broadcast FAILED: ' + ((e && e.message) || e));
    updateLoop('factory', { status: 'error', detail: String((e && e.message) || e).slice(0, 140), counters: counters() });
  }
}

/* ------------------------------------------------------------------ *
 * לופ 6 — דקס SAOS-1/STEEM: עשיית-שוק ריבונית (Task 32-a)
 *
 * המנוע החוזר-בדיעות הראשון שחותם מהכספת המקומית בלי דפדפן:
 *   1. מדידה — שלוש נקודות-קצה מקומיות של הקונסולה (dex/value/live):
 *      הספר הנגזר + הגיבוי הנמדד לטוקן + שער STEEM/USD.
 *   2. בוטסטרפ חד-פעמי — הנפקה ראשונה (mint) + מדף מכירה נעול באותה עסקה.
 *   3. ציטוט — ask סביב הגיבוי ×1.6 (והצעת קנייה ×0.65 מקרדיט escrow קיים),
 *      cancel+replace בעסקה אחת כשהמחיר סוטה >25%.
 *   4. גשר המרה אוטומטי — כל חשבון ש-crowd-escrow יש לו קרדיט פנוי מקבל
 *      מילוי עצמי (fill עם taker=המפקיד) מה-ask שלנו: STEEM→SAOS-1 בצעד אחד.
 *   5. crowd-escrow עצמי (רק עם ACTIVE_WIF) — נעילת נזיל לקרדיט ביד עד cap.
 *
 * חוקי-ברזל: עסקת-שידור אחת לכל היותר בפעימה · מכסה יומית · אפס עמלות רשת
 * (custom_json בלבד — RC) · כל המחירים מהמדידה · dry-run נשמר.
 * ------------------------------------------------------------------ */
let dexTimer = null;
let bridgeTimer = null;
let valueLockTimer = null; // 53 — נעילת-ערך: ערך מהתזוזות → בריכה → נעילה-קבועה
let reflexTimer = null; // 54 — רפלקס-בלוק: טריגר אוצר → מטח-תגובות חתום-מראש (בלוק N+1) → עוגן-Hive
let gitkeeperTimer = null; // 56 — ביטוח-אובדן: add → שער-סודות → commit → push origin/main (כל 30 דק')
let reflexInFlight = false;
// Task 55 — external-event reflex state: every meaningful incoming transfer →
// the fleet swarm reacts. Cooldown + busy-guard prevent storms; known senders
// (our own accounts) only fire with the saos drill tag, unknown senders always fire.
let exReflexBusy = false;
let exReflexLast = null;
function exReflexKnownSenders() {
  const known = new Set([String(CONFIG.account).toLowerCase()]);
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    for (const a of v.accounts || []) if (a && a.username) known.add(String(a.username).toLowerCase());
  } catch (_) { /* vault unavailable — treat everyone as external */ }
  return known;
}
function exReflexCounters() {
  try {
    const ev = JSON.parse(fs.readFileSync(path.join(__dirname, 'reflex_evidence.json'), 'utf8'));
    return ev.externalEvent ? { lastExtFrom: ev.externalEvent.from, lastExtLatency: ev.summary && ev.summary.maxLatencyBlocks, at: ev.at } : { at: ev.at };
  } catch (_) { return {}; }
}
function maybeExternalReflex(fresh) {
  if (!fresh || !fresh.length || exReflexBusy) return;
  if (exReflexLast && Date.now() - new Date(exReflexLast.at).getTime() < CONFIG.exReflexCooldownMin * 60000) return;
  const known = exReflexKnownSenders();
  // policy: unknown senders ALWAYS fire; our own accounts fire only with the saos drill tag
  const pick = fresh.find((x) => /saos/i.test(String(x.memo || '')) || !known.has(String(x.from).toLowerCase()));
  if (!pick) return;
  const isKnown = known.has(String(pick.from).toLowerCase());
  const memoSan = String(pick.memo || 'saos-drill').slice(0, 40).replace(/[^A-Za-z0-9 _:{}".,:-]/g, '') || 'saos-drill';
  exReflexBusy = true;
  setTimeout(() => { exReflexBusy = false; }, 240000);
  exReflexLast = { at: new Date().toISOString(), from: pick.from, amount: pick.amount, origin: isKnown ? 'internal-drill' : 'external' };
  STATUS.lastExternalReflex = exReflexLast;
  try {
    log('EX-REFLEX: incoming ' + pick.amount + ' from @' + pick.from + ' (' + exReflexLast.origin + ') — spawning external reflex swarm');
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, ['reflex.cjs', '--live', '--external', '--mode=watch', '--from=' + String(pick.from).toLowerCase(), '--amount=' + pick.amount, '--memo=' + memoSan], { cwd: __dirname, detached: true, stdio: ['ignore', fs.openSync(path.join(__dirname, 'reflex_external.log'), 'a'), fs.openSync(path.join(__dirname, 'reflex_external.log'), 'a')] });
    child.unref();
    updateLoop('transferWatch', { status: 'ok', detail: 'external reflex spawned — swarm reacting to @' + pick.from + ' ' + pick.amount, counters: exReflexCounters() });
  } catch (e) {
    exReflexBusy = false;
    updateLoop('transferWatch', { status: 'error', detail: 'ex-reflex spawn failed: ' + String((e && e.message) || e).slice(0, 100), counters: exReflexCounters() });
  }
}
let anchorTimer = null;
let attestTimer = null;
let hivePowerTimer = null; // 50 — ריבונות-RC בצד-Hive
let paymasterTimer = null; // 62 — המכונה משלמת גז: relay+fuel+memo-intents
let wrappedTimer = null; // 63 — עגוני-ערך על הדקס: WSBD/PHIVE + maker Engine
let microdexTimer = null; // 65 — מיקרו-דקס חתום-חייל: fill/order/pool_swap במפתח-החייל-עצמו
let yieldTimer = null; // 66 — חלוקת-תשואה מעמלות-שנלכדו לפי תרומה-מדודה-מהשרשרת
let merchantTimer = null; // 67 — מסילת-הסוחר: האימפריה מוכרת SAOS ב-STEEM אמיתי דרך ממו
let saosnetTimer = null; // 68 — SAOS-NET: הצומת-הריבוני שלנו — בלוקים+צ'קפוינטים מעוגנים
let weaveTimer = null;   // W2 — באצ'ר-האריגה: stamps → מרקל → seal → עיגון
let guardianTimer = null; // 82 — ALWAYS-UP: anti-rollback + self-heal
let heReportTimer = null; // 85 — דוח-הריבונות העברי-החי
let linkageTimer = null; // 87 — L9 אחדות-הצי: קישוריות-חיילים לראש + RC-דיסציפלינה
let verify15Timer = null; // 93 — רענון-טסטים: שש-הטענות מול-החי
let verify15Busy = false; // מנע-ריצה-מקבילה
let matrixTimer = null; // 94 — מטריצת-הוכחות מלאה בלולאה
let matrixBusy = false;

// 82 — guardian cycle: spawn מנותק של guardian.cjs (לא-חוסם את הלולאה)
function guardianCycle() {
  try {
    const { spawn } = require('child_process');
    const out = fs.openSync(path.join(__dirname, 'guardian.log'), 'a');
    const child = spawn(process.execPath, [path.join(__dirname, 'guardian.cjs'), '--loop'], {
      cwd: __dirname,
      detached: true,
      stdio: ['ignore', out, out],
    });
    child.unref();
    updateLoop('guardian', { status: 'ok', detail: 'self-heal dispatched (pid ' + child.pid + ')' });
  } catch (e) {
    updateLoop('guardian', { status: 'error', detail: String((e && e.message) || e).slice(0, 80) });
  }
}
// 85 — דוח-עברי-חי: הדמון מריץ he_report.cjs (קריאה-מקומית-בלבד · אפס-סודות)
// → docs/REPORT_HE.md · gitkeeper מדחוף אותו — למפעיל יש תמיד דוח עברי טרי ב-repo
function heReportCycle() {
  try {
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, [path.join(__dirname, 'he_report.cjs')], {
      cwd: __dirname,
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.unref();
    updateLoop('heReport', { status: 'ok', detail: 'Hebrew report dispatched (pid ' + child.pid + ') → docs/REPORT_HE.md' });
  } catch (e) {
    updateLoop('heReport', { status: 'error', detail: String((e && e.message) || e).slice(0, 80) });
  }
}
let wrappedInFlight = false;

/* 87 — L9 אחדות-הצי: לולאת-קישוריות. spawn מנותק של linkage.cjs (--fix —
 * חתימת-account_update במפתח-ה-active של החייל עצמו, אפס-מחיקת-מפתחות);
 * הסטטוס נקרא מ-linkage_report.json (הריצה-הקודמת) — הלולאה מציגה
 * מצב-מוכח-מהשרשרת, לא הצהרות. RC-gated נרשם בכנות — הלולאה תנסה שוב. */
function linkageCycle() {
  if (!CONFIG.linkageEnabled) {
    updateLoop('linkage', { status: 'disabled', detail: 'LINKAGE_ENABLED=false' });
    return;
  }
  try {
    const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'linkage_report.json'), 'utf8'));
    /* R18j-ייעול: הסיבה-האמיתית-מהדוח-במקום-תווית-קבועה — מה-שה-fix רשם-זה-מה-שמוצג
     * (rc-gated · active-key-drift · error) — כנות-ברמת-החייל. */
    const pending = (r.soldiers || []).filter((s) => s.chains && s.chains.hive && !s.chains.hive.linked).map((s) => {
      const f = (s.fixes || []).find((x) => x.chain === 'hive');
      const why = f ? (f.skipped || (f.error ? 'error' : 'pending')) : 'audit-only';
      return '@' + s.username + '(' + why + ')';
    });
    const detail = (r.allLinked ? 'ALL-LINKED' : (r.linkedChains + '/' + r.chainsTotal + ' chains linked')) +
      (pending.length ? ' · hive-pending: ' + pending.join(',') : '') +
      ' · נבדק ' + String(r.at || '').slice(11, 19) + 'Z';
    updateLoop('linkage', {
      status: r.allLinked ? 'ok' : 'partial',
      detail,
      counters: { linkedChains: r.linkedChains || 0, chainsTotal: r.chainsTotal || 0, fixedNow: r.fixedNow || 0 },
    });
  } catch (_) {
    updateLoop('linkage', { status: 'idle', detail: 'no linkage_report.json yet — first audit dispatching' });
  }
  try {
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, [path.join(__dirname, 'linkage.cjs'), CONFIG.linkageAutoFix ? '--fix' : '--audit', '--json'], {
      cwd: __dirname,
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.unref();
  } catch (_) { /* הלולאה-הבאה תנסה שוב */ }
}

function loadDexState() {
  try {
    return JSON.parse(fs.readFileSync(DEX_STATE_PATH, 'utf8'));
  } catch (_) {
    return {};
  }
}
const dexPrev = loadDexState();
const DEX_STATE = {
  day: dexPrev.day || '',
  broadcastsToday: Number(dexPrev.broadcastsToday) || 0,
  fillsToday: Number(dexPrev.fillsToday) || 0,
  bootstrapped: Boolean(dexPrev.bootstrapped),
  bootstrappedAt: dexPrev.bootstrappedAt || null,
  mintedTotal: Number(dexPrev.mintedTotal) || 0,
  escrowedTotal: Number(dexPrev.escrowedTotal) || 0,
  lastQuotes: dexPrev.lastQuotes || null, // { askPrice, askOid, bidPrice, bidOid }
};
function writeDexState() {
  const tmp = DEX_STATE_PATH + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(DEX_STATE, null, 2) + '\n');
    fs.renameSync(tmp, DEX_STATE_PATH);
  } catch (e) {
    log('dexMm: failed to write dex_mm_state.json: ' + ((e && e.message) || e));
  }
}

function dexCounters() {
  return {
    broadcastsToday: DEX_STATE.broadcastsToday,
    fillsToday: DEX_STATE.fillsToday,
    bootstrapped: DEX_STATE.bootstrapped,
  };
}

/* 47 — תמצית-בריכה לסטטוס (מה-replay — לא מצב-מקומי) */
function poolBriefOf(dex) {
  const p = (dex.pools || []).find((x) => x.pair === 'SAOS:STEEM');
  if (!p) return null;
  return {
    pair: p.pair, saos: p.saos, steem: p.steem, lpSupply: p.lpSupply,
    swaps: p.swaps, feesSaos: p.feesSaos, feesSteem: p.feesSteem,
    mid: p.saos > 0 ? r6d(p.steem / p.saos) : null,
    lp: p.lp,
  };
}

/* ------------------------------------------------------------------ *
 * 47 — מצב ממלכת-הנזילות (liq_state.json): ניתוב-חיילים (escrow→SAOS→LP),
 * עסקאות-ארביטראז' בריכה↔ספר, ולכידת-עמלות נצפית. האמת-המבנית (בריכות/LP/
 * עמלות) נקראת מה-replay — הקובץ הזה רק קונטרים-ימיים ודה-דופ.
 * ------------------------------------------------------------------ */
const LIQ_STATE_PATH = path.join(__dirname, 'liq_state.json');
function loadLiqState() {
  try { return JSON.parse(fs.readFileSync(LIQ_STATE_PATH, 'utf8')); } catch (_) { return {}; }
}
const liqPrev = loadLiqState();
const LIQ_STATE = {
  day: liqPrev.day || '',
  escrowsToday: Number(liqPrev.escrowsToday) || 0,
  escrowedBySoldier: liqPrev.escrowedBySoldier || {}, // { soldier: {day, amt, txids:[…] } }
  lpGranted: liqPrev.lpGranted || {}, // { soldier: shares } — מה-replay, מקומי לדה-דופ
  arbsToday: Number(liqPrev.arbsToday) || 0,
  lastArbAt: liqPrev.lastArbAt || null,
  lastAction: liqPrev.lastAction || '',
  feeCaptureSeen: Number(liqPrev.feeCaptureSeen) || 0,
};
function writeLiqState() {
  const tmp = LIQ_STATE_PATH + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(LIQ_STATE, null, 2) + '\n');
    fs.renameSync(tmp, LIQ_STATE_PATH);
  } catch (e) {
    log('liq: failed to write liq_state.json: ' + ((e && e.message) || e));
  }
}

/* ------------------------------------------------------------------ *
 * 34 — מצב הגשר הדו-שרשרתי (bridge_state.json)
 * ------------------------------------------------------------------ */
const BRIDGE_STATE_PATH = path.join(__dirname, 'bridge_state.json');
function loadBridgeState() {
  try {
    return JSON.parse(fs.readFileSync(BRIDGE_STATE_PATH, 'utf8'));
  } catch (_) {
    return {};
  }
}
const bridgePrev = loadBridgeState();
const BRIDGE_STATE = {
  lastSteemIdx: Number(bridgePrev.lastSteemIdx) || 0, // בסיס: כל op חדש מ-idx זה מוטמע
  lastCheckpointAt: bridgePrev.lastCheckpointAt || null,
  anchoredTotal: Number(bridgePrev.anchoredTotal) || 0,
  checkpoints: Number(bridgePrev.checkpoints) || 0,
  lastTxid: bridgePrev.lastTxid || null,
};
function writeBridgeState() {
  const tmp = BRIDGE_STATE_PATH + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(BRIDGE_STATE, null, 2) + '\n');
    fs.renameSync(tmp, BRIDGE_STATE_PATH);
  } catch (e) {
    log('bridge: failed to write bridge_state.json: ' + ((e && e.message) || e));
  }
}
function bridgeCounters() {
  return {
    anchoredTotal: BRIDGE_STATE.anchoredTotal,
    checkpoints: BRIDGE_STATE.checkpoints,
    lastSteemIdx: BRIDGE_STATE.lastSteemIdx,
  };
}
function r6d(x) {
  return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : 0;
}
function r3d(x) {
  return Number.isFinite(x) ? Math.round(x * 1e3) / 1e3 : 0;
}
// נקודות-קצה מקומיות של הקונסולה — אפס שכפול של מנוע הריפליי.
// Self-healing: recompile windows in the dev server return transient 5xx —
// retry with short backoff before declaring the loop dead (3 tries total).
async function dexLocalApi(pathName, timeoutMs) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || 15000);
    try {
      const res = await fetch(CONFIG.dexApiUrl + pathName, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + pathName);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}
// op של אוטובוס saos — custom_json חינם (RC בלבד), חתימת posting
function saosBusOp(payload) {
  return [
    'custom_json',
    {
      required_auths: [],
      required_posting_auths: [CONFIG.account],
      id: 'saos',
      json: JSON.stringify(payload),
    },
  ];
}
// שידור אחד לפעימה. transfer בתוך העסקה דורש חתימת active (עם posting ל-custom_json).
async function dexBroadcast(ops, label) {
  if (CONFIG.dryRun) {
    log('[DRY_RUN] dexMm: would broadcast ' + ops.length + ' op(s) — ' + label);
    updateLoop('dexMm', { status: 'dry', detail: '[DRY_RUN] ' + label, counters: dexCounters() });
    return false;
  }
  const hasTransfer = ops.some((op) => op[0] === 'transfer');
  const hasJson = ops.some((op) => op[0] === 'custom_json');
  // transfer = active בלבד · custom_json פס = posting בלבד · אצווה מעורבת באמת צריכה את שניהם
  const keys = hasTransfer && hasJson
    ? [CONFIG.activeWif, CONFIG.postingWif].filter(Boolean)
    : hasTransfer
      ? [CONFIG.activeWif].filter(Boolean)
      : [CONFIG.postingWif].filter(Boolean);
  if (keys.length === 0) {
    log('dexMm: no signing key available — skip (' + label + ')');
    return false;
  }
  try {
    const conf = await withTimeout(
      steem.broadcast.sendAsync({ operations: ops, extensions: [] }, keys),
      CONFIG.rpcTimeoutMs,
      'dex_broadcast'
    );
    DEX_STATE.broadcastsToday++;
    writeDexState();
    log('dexMm broadcast ok: txid=' + ((conf && conf.id) || 'n/a') + ' · ' + ops.length + ' op(s) · ' + label);
    return true;
  } catch (e) {
    log('dexMm broadcast FAILED: ' + ((e && e.message) || e));
    updateLoop('dexMm', {
      status: 'error',
      detail: String((e && e.message) || e).slice(0, 140),
      counters: dexCounters(),
    });
    return false;
  }
}

async function dexMmCycle() {
  // איפוס מונים יומי (UTC)
  const today = utcToday();
  if (DEX_STATE.day !== today) {
    DEX_STATE.day = today;
    DEX_STATE.broadcastsToday = 0;
    DEX_STATE.fillsToday = 0;
    writeDexState();
  }

  if (!CONFIG.dexMmEnabled) {
    updateLoop('dexMm', { status: 'disabled', detail: 'DEX_MM_ENABLED=false', counters: dexCounters() });
    return;
  }

  // ── 1) מדידה: ספר נגזר + גיבוי נמדד + שער דולר
  const u = encodeURIComponent(CONFIG.account);
  let dex, val, live;
  try {
    [dex, val, live] = await Promise.all([
      dexLocalApi('/api/ops/saos/dex?username=' + u),
      dexLocalApi('/api/ops/saos/value?username=' + u),
      dexLocalApi('/api/steem/live?username=' + u),
    ]);
  } catch (e) {
    log('dexMm: console API unreachable (' + ((e && e.message) || e) + ') — skip beat');
    updateLoop('dexMm', {
      status: 'error',
      detail: 'console API unreachable: ' + String((e && e.message) || e).slice(0, 100),
      counters: dexCounters(),
    });
    return;
  }
  if (!dex || dex.ok !== true) {
    updateLoop('dexMm', { status: 'error', detail: 'dex snapshot failed', counters: dexCounters() });
    return;
  }

  const backingUsd = val && val.saos ? val.saos.backingPerSaosUsd : null;
  const supply = val && val.saos ? Number(val.saos.supply) || 0 : 0;
  const steemUsd = live && live.chain ? Number(live.chain.steemUsd) || 0 : 0;
  const backingSteem = backingUsd != null && steemUsd > 0 ? backingUsd / steemUsd : null;

  // מדדים לסטטוס — הקונסולה קוראת אותם מ-agent-status.json
  STATUS.dex = {
    lastPrice: dex.stats.lastPrice,
    bestAsk: dex.stats.bestAsk,
    bestBid: dex.stats.bestBid,
    spreadPct: dex.stats.spreadPct,
    supply,
    backingSteem: backingSteem != null ? round(backingSteem, 6) : null,
    openOrders: dex.stats.openOrders,
    creditsTotal: dex.solvency.creditsTotal,
    issuerLiquidSteem: dex.solvency.issuerLiquidSteem,
    escrowedTotal: round(DEX_STATE.escrowedTotal, 3),
    lastAction: STATUS.dex.lastAction || 'measured',
  };
  writeStatus();

  // ── 2) שערים
  if (!CONFIG.postingWif) {
    updateLoop('dexMm', {
      status: 'disabled',
      detail: 'no POSTING_WIF — measuring only · book ' + dex.stats.openOrders + ' orders',
      counters: dexCounters(),
    });
    return;
  }
  if (DEX_STATE.broadcastsToday >= CONFIG.dexMmDailyCap) {
    updateLoop('dexMm', {
      status: 'skipped',
      detail: 'daily broadcast cap ' + DEX_STATE.broadcastsToday + '/' + CONFIG.dexMmDailyCap,
      counters: dexCounters(),
    });
    return;
  }

  const MIN_SAOS = 0.05;

  // ── 3) בוטסטרפ חד-פעמי: הנפקה + מדף נעול בעסקה אחת
  // כשההיצע אפס הגיבוי לטוקן עוד לא מוגדר — אז המחיר מחושב מהגיבוי הצפוי:
  // (הכנסת-המנועים השנתית הנמדדת × נתח-הגיבוי) ÷ ההיצע המונפק, בשער STEEM.
  if (!DEX_STATE.bootstrapped && supply <= 0 && dex.mine.saosLiquid <= 0 && CONFIG.dexMmBootMint > 0) {
    // 47 — תמחור-בוטסטרפ כן-ליבה: רצפת-פירעון = אוצר-נזיל ÷ היצע-מונפק.
    // (היה: הקרנת-מנוע ÷ שער-פנימי — יצר פעם מדף 1551 STEEM/SAOS כשהשער-הפנימי חזר שגוי.)
    const issuerSteemNow = Number(dex.solvency.issuerLiquidSteem) || 0;
    const floorBoot = issuerSteemNow > 0 ? issuerSteemNow / CONFIG.dexMmBootMint : 0;
    const bootAskPrice = r6d(floorBoot * CONFIG.dexFairPremium);
    const bootAskSize = Math.min(r3d(CONFIG.dexMmBootMint * 0.5), CONFIG.dexMmMaxAskSaos);
    if (!(bootAskPrice > 0) || bootAskSize < MIN_SAOS) {
      updateLoop('dexMm', {
        status: 'skipped',
        detail: 'bootstrap needs issuer liquid STEEM (issuer=' + issuerSteemNow + ' · floor=' + floorBoot.toFixed(6) + ')',
        counters: dexCounters(),
      });
      return;
    }
    const oid = CONFIG.account + '-' + Date.now().toString(36) + '-b1';
    const ops = [
      saosBusOp({
        protocol: 'saos/v1',
        action: 'mint',
        to: CONFIG.account,
        amount: CONFIG.dexMmBootMint,
        reason: 'DEX bootstrap issuance — redemption floor ' + floorBoot.toFixed(6) + ' STEEM/token',
      }),
      saosBusOp({
        protocol: 'saos/v1',
        action: 'order',
        oid,
        side: 'sell',
        price: bootAskPrice,
        amount: bootAskSize,
        account: CONFIG.account,
        time: new Date().toISOString(),
      }),
    ];
    const ok = await dexBroadcast(ops, 'bootstrap mint ' + CONFIG.dexMmBootMint + ' SAOS-1 + ask ' + bootAskSize + ' @ ' + bootAskPrice);
    if (ok) {
      DEX_STATE.bootstrapped = true;
      DEX_STATE.bootstrappedAt = new Date().toISOString();
      DEX_STATE.mintedTotal = r3d(DEX_STATE.mintedTotal + CONFIG.dexMmBootMint);
      DEX_STATE.lastQuotes = { askPrice: bootAskPrice, askOid: oid, bidPrice: null, bidOid: null };
      writeDexState();
      STATUS.dex.lastAction = 'bootstrap: minted ' + CONFIG.dexMmBootMint + ' + ask ' + bootAskSize + ' @ ' + bootAskPrice;
      updateLoop('dexMm', {
        status: 'ok',
        detail: 'bootstrap live — supply ' + CONFIG.dexMmBootMint + ' · first ask ' + bootAskSize + ' @ ' + bootAskPrice + ' STEEM',
        counters: dexCounters(),
      });
      writeStatus();
    }
    return;
  }

  // ── 4) מחיר-הוגן — עוגן-כושר-פירעון (Task 47, תיקון-על של פריצת-1551)
  // floor  = אוצר-נזיל ÷ היצע  → כל SAOS באמת ניתן לפירעון מהארנק החי
  // fair   = max(floor, min(גיבוי-מנוע-כן, floor×CAP)) → לעולם מתחת-לרצפה לא מצטטים
  const issuerSteem = dex.solvency.issuerLiquidSteem != null ? Number(dex.solvency.issuerLiquidSteem) : null;
  const steemUsdSane = steemUsd >= 0.005 && steemUsd <= 10 ? steemUsd : null; // מגן-שער: מדידה שגויה לא מצטטת
  const backingSteemSane = backingUsd != null && steemUsdSane ? backingUsd / steemUsdSane : null;
  if (supply <= 0 || issuerSteem == null || !(issuerSteem > 0)) {
    updateLoop('dexMm', {
      status: 'skipped',
      detail: 'fair not computable (supply=' + supply + ' · issuer liquid=' + issuerSteem + ')',
      counters: dexCounters(),
    });
    return;
  }
  const floorSteem = issuerSteem / supply;
  const fairSteem = Math.max(
    floorSteem,
    Math.min(backingSteemSane ?? floorSteem * CONFIG.dexFairPremium, floorSteem * CONFIG.dexFairCapX)
  );
  STATUS.dex.floorSteem = r6d(floorSteem);
  STATUS.dex.fairSteem = r6d(fairSteem);
  STATUS.dex.pool = poolBriefOf(dex);
  {
    // לכידת-עמלות נצפית — מה-replay, לא הבטחה
    const p = (dex.pools || []).find((x) => x.pair === 'SAOS:STEEM');
    if (p) LIQ_STATE.feeCaptureSeen = r6d(p.feesSteem + (p.feesSaos * fairSteem));
    writeLiqState();
  }
  writeStatus();

  const ops = [];
  const actionBits = [];
  let budget = CONFIG.dexOpsCapBeat; // חומת-5-custom_json-לחשבון-לבלוק (נמדדה חי ב-limits.json)
  const nowIso = new Date().toISOString();

  const myAsks = (dex.book.asks || []).filter((o) => o.owner === CONFIG.account);
  const myBids = (dex.book.bids || []).filter((o) => o.owner === CONFIG.account);
  const myBidLock = myBids.reduce((s, o) => s + (o.remaining || 0) * (o.price || 0), 0);
  const creditAvail = Math.max(0, dex.mine.steemCredit - Math.max(0, dex.mine.steemLocked - myBidLock));

  // בריכת AMM מה-replay — האמת-המבנית, לא מצב-מקומי
  const pool = (dex.pools || []).find((p) => p.pair === 'SAOS:STEEM') || null;

  // רשת (grid): k=1..levels סביב ההוגן; סלוט נשמר אם המחיר-חי בטווח ±45% מהצעד
  const stepFrac = CONFIG.dexGridStepPct / 100;
  const askLevel = (k) => r6d(fairSteem * (1 + stepFrac * k));
  const bidLevel = (k) => r6d(fairSteem * (1 - stepFrac * k));
  const slotOf = (price, dir) => {
    for (let k = 1; k <= CONFIG.dexGridLevels; k++) {
      const lvl = dir > 0 ? askLevel(k) : bidLevel(k);
      if (lvl > 0 && Math.abs(price - lvl) / lvl <= stepFrac * 0.45) return k;
    }
    return 0;
  };

  // גדלי רמה: SAOS-ל-ask מהמלאי הנזיל · נומינל-STEEM-ל-bid מהקרדיט הפנוי
  const askLevelSaos = Math.min(r3d((dex.mine.saosLiquid * 0.7) / CONFIG.dexGridLevels), CONFIG.dexMmMaxAskSaos);
  const bidNotional = Math.min(r6d(CONFIG.dexGridNotional), r6d((creditAvail * 0.6) / CONFIG.dexGridLevels));

  // ── 5) ביטולי-סטייה: מדף מחוץ-לרשת או אבק → cancel (תקציב נשמר)
  for (const o of myAsks) {
    if (budget <= 0) break;
    if (slotOf(o.price, +1) === 0 || o.remaining < MIN_SAOS) {
      ops.push(saosBusOp({ protocol: 'saos/v1', action: 'cancel', oid: o.oid, account: CONFIG.account, time: nowIso }));
      actionBits.push('cancel ask ' + r3d(o.remaining) + '@' + o.price);
      budget--;
    }
  }
  for (const o of myBids) {
    if (budget <= 0) break;
    if (slotOf(o.price, -1) === 0 || o.remaining * o.price < 0.005) {
      ops.push(saosBusOp({ protocol: 'saos/v1', action: 'cancel', oid: o.oid, account: CONFIG.account, time: nowIso }));
      actionBits.push('cancel bid ' + r3d(o.remaining) + '@' + o.price);
      budget--;
    }
  }

  // ── 6) זריעת-בריכה חד-פעמית — לב הממלכה: SAOS+קרדיט → x·y=k עם עמלה 0.3%
  if (!pool && askLevelSaos >= MIN_SAOS && creditAvail >= CONFIG.dexPoolSeedSteem) {
    const saosSeed = Math.min(r3d(CONFIG.dexPoolSeedSaos), r3d(dex.mine.saosLiquid * 0.4));
    const steemSeed = Math.min(r6d(CONFIG.dexPoolSeedSteem), r6d(creditAvail * 0.4));
    if (saosSeed >= MIN_SAOS && steemSeed >= 0.01 && budget >= 2) {
      ops.push(saosBusOp({ protocol: 'saos/v1', action: 'pool_init', pair: 'SAOS:STEEM', feeBps: 30, account: CONFIG.account, time: nowIso }));
      ops.push(saosBusOp({ protocol: 'saos/v1', action: 'pool_add', pair: 'SAOS:STEEM', account: CONFIG.account, saosAmt: saosSeed, steemAmt: steemSeed, time: nowIso }));
      actionBits.push('pool seed ' + saosSeed + ' SAOS + ' + steemSeed + ' STEEM (fee 30bps)');
      budget -= 2;
    }
  }

  // ── 7) הצבות-רשת למקומות ריקים (asks למעלה · bids למטה)
  const kTakenAsk = new Set(myAsks.map((o) => slotOf(o.price, +1)).filter(Boolean));
  const kTakenBid = new Set(myBids.map((o) => slotOf(o.price, -1)).filter(Boolean));
  const liveAsk = myAsks.find((o) => slotOf(o.price, +1) > 0) || null;
  let liveAskOid = liveAsk ? liveAsk.oid : '';
  let firstGridAsk = null;
  let firstGridBid = null;
  for (let k = CONFIG.dexGridLevels; k >= 1; k--) {
    if (budget <= 0) break;
    if (kTakenAsk.has(k) || askLevelSaos < MIN_SAOS) continue;
    const oid = CONFIG.account + '-' + Date.now().toString(36) + '-a' + k;
    ops.push(saosBusOp({ protocol: 'saos/v1', action: 'order', oid, side: 'sell', price: askLevel(k), amount: askLevelSaos, account: CONFIG.account, time: nowIso }));
    if (!firstGridAsk) firstGridAsk = { oid, price: askLevel(k), amount: askLevelSaos };
    if (!liveAskOid) { liveAskOid = oid; }
    actionBits.push('ask L' + k + ' ' + askLevelSaos + ' @ ' + askLevel(k));
    budget--;
    kTakenAsk.add(k);
  }
  for (let k = CONFIG.dexGridLevels; k >= 1; k--) {
    if (budget <= 0) break;
    if (kTakenBid.has(k) || !(bidNotional >= 0.005)) continue;
    const price = bidLevel(k);
    const amount = Math.min(r3d((bidNotional * 0.995) / price), 10);
    if (amount < MIN_SAOS) continue;
    const oid = CONFIG.account + '-' + Date.now().toString(36) + '-b' + k;
    ops.push(saosBusOp({ protocol: 'saos/v1', action: 'order', oid, side: 'buy', price, amount, account: CONFIG.account, time: nowIso }));
    if (!firstGridBid) firstGridBid = { oid, price, amount };
    actionBits.push('bid L' + k + ' ' + amount + ' @ ' + price);
    budget--;
    kTakenBid.add(k);
  }

  // ── 8) ארביטראז' בריכה↔ספר — "רצף-העסקאות": קנייה בזול, הרשת שלנו מוכרת יקר
  if (pool && pool.saos > 0 && pool.steem > 0 && budget >= 1) {
    const poolMid = pool.steem / pool.saos;
    const bookMid = dex.stats.bestAsk != null && dex.stats.bestBid != null
      ? (dex.stats.bestAsk + dex.stats.bestBid) / 2
      : (dex.stats.bestAsk ?? dex.stats.bestBid);
    if (bookMid != null && bookMid > 0) {
      const dev = (poolMid - bookMid) / bookMid;
      if (dev <= -CONFIG.dexArbDevPct / 100 && creditAvail >= CONFIG.dexArbNotional) {
        const inAmt = Math.min(r6d(CONFIG.dexArbNotional), r6d(pool.steem * 0.5));
        if (inAmt >= 0.005) {
          ops.push(saosBusOp({ protocol: 'saos/v1', action: 'pool_swap', pair: 'SAOS:STEEM', taker: CONFIG.account, side: 'buy_saos', inAmt, time: nowIso }));
          actionBits.push('arb buy ' + inAmt + ' STEEM→SAOS @pool (dev ' + (dev * 100).toFixed(1) + '%)');
          budget--; LIQ_STATE.arbsToday++; LIQ_STATE.lastArbAt = nowIso;
        }
      } else if (dev >= CONFIG.dexArbDevPct / 100 && dex.mine.saosLiquid >= 0.5) {
        const inAmt = Math.min(r3d(dex.mine.saosLiquid * 0.3), r3d(pool.saos * 0.2));
        if (inAmt >= MIN_SAOS) {
          ops.push(saosBusOp({ protocol: 'saos/v1', action: 'pool_swap', pair: 'SAOS:STEEM', taker: CONFIG.account, side: 'sell_saos', inAmt, time: nowIso }));
          actionBits.push('arb sell ' + inAmt + ' SAOS→STEEM @pool (dev ' + (dev * 100).toFixed(1) + '%)');
          budget--; LIQ_STATE.arbsToday++; LIQ_STATE.lastArbAt = nowIso;
        }
      }
    }
  }

  // ── 9) גשר המרה אוטומטי: crowd-escrow → SAOS-1 בצעד אחד (fill על מדף-הרשת החי)
  if (budget > 0) {
    let fillTarget = firstGridAsk;
    if (!fillTarget && liveAsk) fillTarget = { oid: liveAsk.oid, price: liveAsk.price, amount: Math.min(liveAsk.remaining, firstGridAsk ? 0 : Infinity) || liveAsk.remaining };
    if (fillTarget) {
      const lockedCreditBy = new Map();
      for (const b of dex.book.bids || []) {
        lockedCreditBy.set(b.owner, (lockedCreditBy.get(b.owner) || 0) + b.price * b.remaining);
      }
      const converters = (dex.balances || [])
        .filter((row) => row.account !== CONFIG.account)
        .map((row) => ({ account: row.account, free: row.credit - (lockedCreditBy.get(row.account) || 0) }))
        .filter((row) => row.free >= fillTarget.price * MIN_SAOS)
        .sort((a, b) => b.free - a.free)
        .slice(0, Math.max(1, CONFIG.dexMmMaxFillsBeat));
      for (const conv of converters) {
        if (budget <= 0) break;
        const amt = Math.min(r3d(fillTarget.amount), r3d(conv.free / fillTarget.price));
        if (amt < MIN_SAOS || !fillTarget.oid) continue;
        ops.push(saosBusOp({ protocol: 'saos/v1', action: 'fill', oid: fillTarget.oid, taker: conv.account, amount: amt, time: nowIso }));
        DEX_STATE.fillsToday++;
        actionBits.push('convert ' + conv.account + ' ' + amt + ' SAOS');
        budget--;
      }
    }
  }

  // ── 10) crowd-escrow עצמי — נעילת נזיל לקרדיט (active; בזהירות וב-cap)
  if (
    CONFIG.activeWif &&
    ops.length === 0 && // escrow רק בפעימה נקייה — לא לערבב כסף עם ציטוטים
    dex.solvency.issuerLiquidSteem != null
  ) {
    // תכנון-ליעד: escrow עד שהקרדיט החי בספר מגיע ליעד — לא לשפוך שוב כשה-replay עוד מאחר
    const desired = Math.min(
      r3d(dex.solvency.issuerLiquidSteem * (CONFIG.dexMmEscrowPct / 100)),
      r3d(CONFIG.dexMmEscrowCapSteem)
    );
    const existingCredits = Math.max(
      dex.solvency.creditsTotal == null ? 0 : r3d(dex.solvency.creditsTotal),
      r3d(DEX_STATE.escrowedTotal) // truth מקומי — ה-replay מאחר, אסור לשפוך שוב
    );
    const escrowAmount = Math.min(
      r3d(Math.max(0, desired - existingCredits)),
      Math.max(0, r3d(CONFIG.dexMmEscrowCapSteem - DEX_STATE.escrowedTotal))
    );
    if (escrowAmount >= 0.01) {
      ops.unshift([
        'transfer',
        { from: CONFIG.account, to: CONFIG.account, amount: escrowAmount.toFixed(3) + ' STEEM', memo: 'saos:escrow' },
      ]);
      actionBits.push('escrow ' + escrowAmount + ' STEEM');
    }
  }

  if (ops.length === 0) {
    updateLoop('dexMm', {
      status: 'ok',
      detail: 'book aligned — last ' + actionBits.join(' · ') + ' none this beat',
      counters: dexCounters(),
    });
    STATUS.dex.lastAction = 'aligned @ ask ' + (dex.stats.bestAsk == null ? '—' : dex.stats.bestAsk) + ' / bid ' + (dex.stats.bestBid == null ? '—' : dex.stats.bestBid);
    writeStatus();
    return;
  }

  // escrow עבריין אחרי הצלחה — רק אם באמת שודר
  const isEscrow = ops.some((op) => op[0] === 'transfer');
  const ok = await dexBroadcast(ops, actionBits.join(' · ') || ops.length + ' ops');
  if (ok) {
    if (isEscrow) {
      const tr = ops.find((op) => op[0] === 'transfer');
      const esc = parseFloat(String(tr[1].amount).split(' ')[0]) || 0;
      DEX_STATE.escrowedTotal = r3d(DEX_STATE.escrowedTotal + esc);
    }
    DEX_STATE.lastQuotes = {
      askPrice: firstGridAsk ? firstGridAsk.price : (liveAsk ? liveAsk.price : null),
      askOid: liveAskOid || null,
      bidPrice: firstGridBid ? firstGridBid.price : null,
      bidOid: null,
    };
    writeDexState();
    STATUS.dex.lastAction = actionBits.join(' · ');
    updateLoop('dexMm', {
      status: 'ok',
      detail: actionBits.join(' · ') + ' · broadcasts ' + DEX_STATE.broadcastsToday + '/' + CONFIG.dexMmDailyCap,
      counters: dexCounters(),
    });
    writeStatus();
  }
}

/* ------------------------------------------------------------------ *
 * לופ 17 (Task 47) — ממלכת-הנזילות: ניתוב-חיילים לכלכלה הסגורה.
 * מסלול כל חייל: STEEM (יתרה/שכר) → escrow לקרדיט-DEX (מפתח-active שלו)
 * → fill על מדף-הרשת שלנו → SAOS → pool_add → ספק-נזילות שמרוויח עמלות.
 * ה-LP נקלט ב-replay כדביט אמיתי מיתרת-ה-SAOS של החייל — לא טוקן-אוויר.
 * ------------------------------------------------------------------ */
let liqTimer = null;
async function liqCycle() {
  if (cloudEconPaused()) { log('liq: cloud stand-down (fresh cloud_takeover) — economic pause'); return; }
  const today = utcToday();
  if (LIQ_STATE.day !== today) {
    LIQ_STATE.day = today;
    LIQ_STATE.escrowsToday = 0;
    LIQ_STATE.arbsToday = 0;
    LIQ_STATE.escrowedBySoldier = {};
    writeLiqState();
  }

  if (!CONFIG.liqEnabled) {
    updateLoop('liq', { status: 'disabled', detail: 'LIQ_ENABLED=false', counters: {} });
    return;
  }
  if (!ARMY.length) {
    updateLoop('liq', { status: 'idle', detail: 'אין חיילים מחוברים — הכספת פתוחה', counters: {} });
    return;
  }

  try {
    const [accArr, dex] = await Promise.all([
      armyAccountsData(),
      dexLocalApi('/api/ops/saos/dex?username=' + encodeURIComponent(CONFIG.account)),
    ]);
    if (!dex || dex.ok !== true) throw new Error('dex snapshot failed');
    const pool = (dex.pools || []).find((p) => p.pair === 'SAOS:STEEM') || null;
    const balBy = new Map((dex.balances || []).map((b) => [b.account, b]));
    const byName = armyByName(accArr || []);
    const actions = [];

    // 1) escrow-חייל: עודף-STEEM → קרדיט-DEX (חתימת active של החייל עצמו)
    for (const a of ARMY) {
      if (!a.activeWif) continue; // בלי active — אין חתימת-transfer (דילוג כן-ליבה)
      const acc = byName[a.username];
      if (!acc) continue;
      const steemBal = parseFloat(String(acc.balance || '0')) || 0;
      const rec = LIQ_STATE.escrowedBySoldier[a.username] || { day: '', amt: 0, txid: null };
      if (rec.day !== today) { rec.day = today; rec.amt = 0; }
      const want = Math.min(
        r3d(CONFIG.liqEscrowPerSoldier),
        r3d(Math.max(0, steemBal - CONFIG.liqSoldierKeepSteem)),
        r3d(Math.max(0, CONFIG.liqEscrowDayCap - rec.amt))
      );
      if (want < 0.005) continue;
      if (CONFIG.dryRun) { actions.push('DRY escrow ' + want + ' @' + a.username); continue; }
      try {
        const conf = await steem.broadcast.sendAsync({
          operations: [['transfer', { from: a.username, to: CONFIG.account, amount: want.toFixed(3) + ' STEEM', memo: 'saos:escrow' }]],
          extensions: [],
        }, [a.activeWif]);
        rec.amt = r3d(rec.amt + want);
        rec.txid = (conf && conf.id) || null;
        LIQ_STATE.escrowedBySoldier[a.username] = rec;
        LIQ_STATE.escrowsToday++;
        actions.push('escrow ' + want + ' @' + a.username);
        log('liq: escrow ' + want + ' STEEM @' + a.username + ' → DEX credit (txid ' + (rec.txid || 'n/a') + ')');
      } catch (e) {
        log('liq: escrow failed @' + a.username + ': ' + ((e && e.message) || e));
      }
    }

    // 2) LP-חייל: SAOS נזיל ≥ סף → pool_add (דה-דופ כנגד ה-replay)
    //    49 — עד 3 מניות-חייל לפעימה (תעסוקה מלאה במקום 1-לפעימה)
    if (pool && !CONFIG.dryRun && CONFIG.postingWif) {
      let lpThisBeat = 0;
      for (const a of ARMY) {
        if (lpThisBeat >= 3) break; // 49 — 3 LP-בקשות לפעימה
        const b = balBy.get(a.username);
        if (!b || b.saos < CONFIG.liqLpMinSaos) continue;
        const onReplay = (pool.lp || []).find((x) => x.account === a.username);
        if (onReplay && onReplay.shares > 0) { LIQ_STATE.lpGranted[a.username] = onReplay.shares; continue; }
        if (LIQ_STATE.lpGranted[a.username] === -1) continue; // בקשה באוויר — ה-replay מאחר
        const saosAmt = r3d(b.saos * 0.8);
        if (saosAmt < CONFIG.liqLpMinSaos) continue;
        try {
          const conf = await steem.broadcast.sendAsync({
            operations: [saosBusOp({ protocol: 'saos/v1', action: 'pool_add', pair: 'SAOS:STEEM', account: a.username, saosAmt, steemAmt: 0, time: new Date().toISOString() })],
            extensions: [],
          }, [CONFIG.postingWif]);
          LIQ_STATE.lpGranted[a.username] = -1;
          lpThisBeat++;
          actions.push('LP @' + a.username + ' ' + saosAmt + ' SAOS');
          log('liq: pool_add ' + saosAmt + ' SAOS for @' + a.username + ' (txid ' + ((conf && conf.id) || 'n/a') + ')');
        } catch (e) {
          log('liq: pool_add failed @' + a.username + ': ' + ((e && e.message) || e));
          LIQ_STATE.lpGranted[a.username] = 0;
        }
      }
    }

    // 3) אימות-מניות: מה שה-replay אישר הוא האמת
    if (pool) {
      for (const lp of pool.lp || []) {
        if (lp.shares > 0 && lp.account !== CONFIG.account) LIQ_STATE.lpGranted[lp.account] = lp.shares;
      }
    }

    LIQ_STATE.lastAction = actions.length > 0 ? actions.join(' · ') : 'soldiers measured — routing clean';
    writeLiqState();
    updateLoop('liq', {
      status: actions.length > 0 ? 'ok' : 'ok',
      detail: LIQ_STATE.lastAction.slice(0, 160),
      counters: { escrows: LIQ_STATE.escrowsToday, lps: Object.values(LIQ_STATE.lpGranted).filter((v) => v > 0).length, arbs: LIQ_STATE.arbsToday, lpSupply: pool ? pool.lpSupply : 0 },
    });
    if (actions.length) log('liq: ' + LIQ_STATE.lastAction);
  } catch (e) {
    updateLoop('liq', { status: 'error', detail: String((e && e.message) || e).slice(0, 140), counters: {} });
    log('liq: cycle error — ' + ((e && e.message) || e));
  }
}

/* ------------------------------------------------------------------ *
 * main — ולידציה, תזמון, --once, shutdown
 * ------------------------------------------------------------------ */
let claimTimer = null;
let watchTimer = null;
let transferTimer = null;
let curationTimer = null;
let factoryTimer = null;
let empireTimer = null;
let fleetTimer = null; // 48 — פעימת-צי
let armyClaimTimer = null;
let armyCurationTimer = null;
let armySweepTimer = null;
let worldlogTimer = null;
let commandBusTimer = null;
let netTaskTimer = null;
let genesisTimer = null; // 46 — מדרגת-הג׳נזיס
let fleetSellTimer = null; // 74 — נתיב-הצי (RC-drought router)
let healRcTimer = null; // 103 — הבראת-RC אוטונומית (HP delegation, משוער)
let reanchorTimer = null; // 103 — עיגון-בריכות-מתמשך (מול-האורקל-החתום)
let oracleTimer = null;   // 106 — אורקל-חי-שעתי (ציטוטי-asset_price על-הספר)

/* 46 — משכורת-השלמה: חייל שהשלים משימה מקבל STEEM אמיתי על-השרשרת.
 * חשוב: עובד על אותו אובייקט-st של המחזור — כתיבה נפרדת נדרסת על-ידי writeNetState של המחזור (באג שנתפס בווריפייר). */
async function paySoldier(soldier, taskId, st) {
  try {
    if (!st.pay) st.pay = { day: '', total: 0, paid: 0 };
    const today = utcToday();
    if (st.pay.day !== today) st.pay = { day: today, total: 0, paid: 0 };
    if (st.pay.total + CONFIG.payrollPerTask > CONFIG.payrollDailyCap) {
      log('payroll: daily cap ' + CONFIG.payrollDailyCap + ' STEEM reached — skip');
      return;
    }
    const acc = await rpcV4(CONFIG.rpcUrl, { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[CONFIG.account]], id: 1 });
    const steemBal = acc && acc[0] ? parseFloat(acc[0].balance) : 0;
    if (steemBal < CONFIG.payrollPerTask + 0.1) {
      log('payroll: treasury too low (' + steemBal + ' STEEM) — skip');
      return;
    }
    const conf = await steem.broadcast.sendAsync({
      operations: [['transfer', { from: CONFIG.account, to: soldier, amount: CONFIG.payrollPerTask.toFixed(3) + ' STEEM', memo: 'SAOS-PAY ' + taskId }]],
      extensions: [],
    }, [CONFIG.activeWif]);
    st.pay.total += CONFIG.payrollPerTask;
    st.pay.paid += 1;
    const t = st.tasks && st.tasks[taskId];
    if (t) { t.payTxid = (conf && conf.id) || null; t.payAmount = CONFIG.payrollPerTask; }
    log('payroll: PAID ' + CONFIG.payrollPerTask + ' STEEM → @' + soldier + ' for ' + taskId + ' txid=' + ((conf && conf.id) || 'n/a'));
  } catch (e) {
    log('payroll: failed for ' + taskId + ': ' + ((e && e.message) || e));
  }
}

/* 46 — מדרגת-הג׳נזיס: he_genesis.cjs מקדם את המדרגה מדי מחזור (מכירות→SWAP.HIVE→BEE→טוקן),
 * וכש-RC בריא (≥1.5B) ממפה גם את משטח-הדחייה של חוזי-החכמה ב-HE (he_conforms.cjs). */
let ladderBusy = false;
async function ladderCycle() {
  if (ladderBusy) return;
  ladderBusy = true;
  try {
    if (CONFIG.dryRun) {
      updateLoop('genesis', { status: 'dry', detail: 'DRY_RUN — מדרגה רדומה' });
      return;
    }
    const g = await new Promise((resolve) => {
      execFile(process.execPath, [path.join(__dirname, 'he_genesis.cjs'), '--max-spend', String(CONFIG.genesisMaxSpend)], { timeout: 300000 }, (err, stdout, stderr) => resolve({ err, out: String(stdout || '') + String(stderr || '') }));
    });
    let detail = 'genesis run complete';
    try {
      const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'he_genesis_result.json'), 'utf8'));
      const okSteps = (r.steps || []).filter((s) => s.ok).length;
      const beeAfter = r.ladder && r.ladder.bee ? r.ladder.bee.after : 0;
      detail = 'BEE ' + Number(beeAfter).toFixed(2) + '/100 · steps ' + okSteps + '/' + (r.steps || []).length + (r.token && r.token.created ? ' · TOKEN ' + r.token.symbol + ' CREATED' : '');
    } catch (_) { /* keep default */ }
    updateLoop('genesis', {
      status: g.err ? 'error' : 'ok',
      detail: detail.slice(0, 220),
      counters: { runs: (((STATUS.loops.genesis || {}).counters || {}).runs || 0) + 1 },
    });
    // conforms — רק כש-RC בריא. current_mana קפוא בין-טרנזקציות (נמדד) — חישוב-רג'ן עצמאי
    try {
      const rc = await rpcV4('https://api.hive.blog', { jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: [CONFIG.account] }, id: 1 });
      const rca = rc && rc.rc_accounts && rc.rc_accounts[0];
      const maxRc = rca ? parseInt(rca.max_rc || '0') : 0;
      const stored = rca ? parseInt(rca.rc_manabar.current_mana || '0') : 0;
      const lu = rca ? parseInt(rca.rc_manabar.last_update_time || '0') : 0;
      const rcNow = rca ? stored + Math.floor((Math.max(0, Math.floor(Date.now() / 1000) - lu) * maxRc) / (5 * 86400)) : 0;
      let confRes = null;
      try { confRes = JSON.parse(fs.readFileSync(path.join(__dirname, 'he_conforms_result.json'), 'utf8')); } catch (_) { /* none */ }
      const stale = !confRes || (Date.now() - new Date(confRes.at).getTime() > 7 * 86400000);
      if (rcNow > 3200000000 && stale) {
        const c = await new Promise((resolve) => {
          execFile(process.execPath, [path.join(__dirname, 'he_conforms.cjs')], { timeout: 600000 }, (err, stdout, stderr) => resolve({ err, out: String(stdout || '') + String(stderr || '') }));
        });
        let cdetail = 'conforms complete';
        try {
          const cr = JSON.parse(fs.readFileSync(path.join(__dirname, 'he_conforms_result.json'), 'utf8'));
          if (cr.summary) cdetail = cr.summary.passCount + '/' + cr.summary.total + ' asserts · walls=' + cr.summary.walls;
        } catch (_) { /* keep */ }
        updateLoop('genesis', { status: c.err ? 'error' : 'ok', detail: (detail.slice(0, 120) + ' · ' + cdetail).slice(0, 220) });
        log('ladder: conforms mapped — ' + cdetail);
      } else if (stale) {
        log('ladder: conforms deferred — Hive RC ' + rcNow + ' < 3.2B');
      }
    } catch (_) { /* rc probe failed */ }
  } catch (e) {
    updateLoop('genesis', { status: 'error', detail: String((e && e.message) || e).slice(0, 180) });
  } finally {
    ladderBusy = false;
  }
}

/* 74 — נתיב-הצי (RC-drought router): כשה-RC של הראש נגמר, פעולות-ה-HE של
 * המדרגה עוברות-דרך-חייל (מפתח-active משלו + מאגר-RC משלו) — הזרימה
 * אף-פעם לא נעצרת בגלל צמא-RC. ריצה קטנה כל 20 דק׳; מתיישבת-לבד כשהראש בריא. */
let fleetSellBusy = false;
async function fleetSellCycle() {
  if (fleetSellBusy) return;
  fleetSellBusy = true;
  try {
    if (CONFIG.dryRun) { updateLoop('fleetSell', { status: 'dry', detail: 'DRY_RUN — נתיב-הצי רדום' }); return; }
    // 1) סיום-הוכחת-המנגנון (probe resumable — מסתיים מהר כשנעשה)
    await new Promise((resolve) => {
      execFile(process.execPath, [path.join(__dirname, 'he_fleet_sell.cjs'), '--probe', '--live'], { timeout: 240000 }, () => resolve());
    });
    // 2) ניתוב-בצורת (מתיישב מיד כש-RC הראש בריא)
    await new Promise((resolve) => {
      execFile(process.execPath, [path.join(__dirname, 'he_fleet_sell.cjs'), '--live'], { timeout: 240000 }, () => resolve());
    });
    let detail = 'router idle (head RC healthy)';
    try {
      const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'he_fleet_result.json'), 'utf8'));
      const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'he_fleet_state.json'), 'utf8'));
      detail = (r.acted ? 'route legs ' + (r.legs || []).length + ' · phase ' + r.phase : (r.why || 'stand-down')) +
        ' · routes ' + (st.routes || 0) + ' · BEE-routed ' + (st.beeRouted || 0);
      if (r.misses && r.misses.length) detail += ' · misses ' + r.misses.length;
    } catch (_) { /* keep default */ }
    updateLoop('fleetSell', {
      status: 'ok',
      detail: detail.slice(0, 220),
      counters: { runs: (((STATUS.loops.fleetSell || {}).counters || {}).runs || 0) + 1 },
    });
    log('fleetSell: ' + detail);
  } catch (e) {
    updateLoop('fleetSell', { status: 'error', detail: String((e && e.message) || e).slice(0, 180) });
  } finally {
    fleetSellBusy = false;
  }
}

/* ------------------------------------------------------------------ *
 * 34 — Hive transport (IPv4 כפוי — בסביבה זו IPv6 שבור) + חתימה ידנית
 * Hive chain_id: beeab0de… (אותה עקומה/גזירה כמו Steem, מזהה שרשרת שונה)
 * ------------------------------------------------------------------ */
const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';

function rpcV4(urlStr, body) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname || '/',
        method: 'POST',
        family: 4,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 20000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error.message || 'rpc error'));
            resolve(json.result);
          } catch (_) {
            reject(new Error('bad rpc response: ' + data.slice(0, 120)));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('rpc timeout 20s')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function hiveRpc(method, params) {
  return rpcV4(CONFIG.hiveRpc, { jsonrpc: '2.0', method, params, id: 1 });
}

/* 46 — סריקת-היסטוריה רב-צומתית: api.steemit.com מאוזן-עומס וה-backends מפלגים
 * בטריות ההיסטוריה (נמדד חי — פקודה בת 10 דק' לא הופיעה בחלון). לוקחים את
 * החלון הטרי ביותר מתוך הצמתים. */
const HIST_NODES = [CONFIG.rpcUrl, 'https://steemapi.boylikegirl.club', 'https://api.justyy.com'].filter(Boolean);
async function histFresh(account, limit) {
  let best = null;
  for (const node of HIST_NODES) {
    try {
      const r = await rpcV4(node, { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [account, -1, limit], id: 1 });
      if (Array.isArray(r) && r.length && (!best || r[r.length - 1][0] > best[best.length - 1][0])) best = r;
    } catch (_) { /* node down/lagging — next */ }
  }
  return best;
}

/** חתימה מקומית + שידור ל-Hive. מחזיר txid (נקרא מהיסטוריית החשבון).
 * 53 — signer אופציונלי {account, wif}: ברירת-מחדל האוצר (headcorner). */
async function hiveBroadcastOps(ops, expectTime, signer) {
  const signAccount = (signer && signer.account) || CONFIG.account;
  const signWif = (signer && signer.wif) || CONFIG.postingWif;
  const dgp = await hiveRpc('condenser_api.get_dynamic_global_properties', []);
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations: ops,
    extensions: [],
  };
  const prevChainId = steem.config.get('chain_id');
  steem.config.set('chain_id', HIVE_CHAIN_ID);
  let signed;
  try {
    signed = steem.auth.signTransaction(tx, [signWif]);
  } finally {
    steem.config.set('chain_id', prevChainId);
  }
  await hiveRpc('condenser_api.broadcast_transaction', [signed]);
  // אימות-קריאה: ה-op שלנו (התאמת time) חייב להופיע בהיסטוריית *החותם* — עד ~15 שניות
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const hist = await hiveRpc('condenser_api.get_account_history', [signAccount, -1, 10]);
      for (const [, e] of hist) {
        if (e.op[0] !== 'custom_json' || e.op[1].id !== 'saos') continue;
        try {
          const pl = JSON.parse(String(e.op[1].json || '{}'));
          if (expectTime && pl.time === expectTime) return e.trx_id || null;
        } catch (_) { /* next */ }
      }
    } catch (_) { /* retry */ }
  }
  log('bridge: warning — broadcast accepted but op not yet visible in Hive history');
  return null;
}

/* ------------------------------------------------------------------ *
 * 103 — REANCHOR: עיגון-מתמשך — המנוע-סוחר-את-הבריכות-החוצה-מהאורקל.
 * כל-שעה: מדידת-סטייה-מהאורקל-החתום · מעל-5% → משיכות-LP + השלמה-מדויקת
 * (אותה-מתמטיקה-שהוכחה-ב-102 · refs חתומי-סבב · יעד ≤12%).
 * יחד-עם-תיקון-עוגן-ה-arb-במנוע (oracle-החי) — שני-המנועים מושכים-לאותו-הכיוון.
 * ------------------------------------------------------------------ */
let reanchorBusy = false;
async function reanchorCycle() {
  if (reanchorBusy) return;
  reanchorBusy = true;
  try {
    await new Promise((resolve) => {
      execFile(process.execPath, [path.join(__dirname, 'reanchor103.cjs')], { timeout: 420000 }, (e, stdout) => {
        if (stdout) log('reanchor: ' + String(stdout).trim().split('\n').filter((l) => /dev after|allMatch|issued|→ applied|→ partial|→ rejected/.test(l)).slice(0, 5).join(' | ').slice(0, 240));
        resolve();
      });
    });
    let detail = 'idle (see reanchor103_result.json)';
    try {
      const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'reanchor103_result.json'), 'utf8'));
      detail = 'r' + r.round + ' · ' + (r.summaryHe || '') + ' · devAfter ' + JSON.stringify(r.devAfter);
    } catch (_) { /* keep default */ }
    updateLoop('reanchor', { status: 'ok', detail: detail.slice(0, 240), counters: { runs: (((STATUS.loops.reanchor || {}).counters || {}).runs || 0) + 1 } });
  } catch (e) {
    updateLoop('reanchor', { status: 'error', detail: String((e && e.message) || e).slice(0, 180) });
  } finally {
    reanchorBusy = false;
  }
}

let oracleBusy = false;
/* 106 — אורקל-חי-מתמשך: ציטוטי-asset_price שעתיים מ-coingecko על-הספר —
 * עוגן-ה-arb נשאר-חי (RECON-102c היה-חד-פעמי; WTRX עמד-מקופא 4-שעות). */
async function oracleCycle() {
  if (oracleBusy) return;
  oracleBusy = true;
  try {
    await new Promise((resolve) => {
      execFile(process.execPath, [path.join(__dirname, 'oracle106.cjs')], { timeout: 300000 }, (e, stdout) => {
        if (stdout) log('oracle: ' + String(stdout).trim().split('\n').filter((l) => /issued|quotes|skipped/.test(l)).slice(0, 3).join(' | ').slice(0, 240));
        resolve();
      });
    });
    let detail = 'idle (see oracle106_result.json)';
    try {
      const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'oracle106_result.json'), 'utf8'));
      detail = r.skipped ? r.skipped : ('ops=' + r.ops + ' · mission=' + JSON.stringify(r.mission) + ' · ' + Object.entries(r.quotes || {}).map(([k, v]) => k + (v.deltaPct != null ? ' ' + (v.deltaPct > 0 ? '+' : '') + v.deltaPct + '%' : '')).join(' '));
    } catch (_) { /* keep default */ }
    updateLoop('oracle', { status: 'ok', detail: detail.slice(0, 240), counters: { runs: (((STATUS.loops.oracle || {}).counters || {}).runs || 0) + 1 } });
  } catch (e) {
    updateLoop('oracle', { status: 'error', detail: String((e && e.message) || e).slice(0, 180) });
  } finally {
    oracleBusy = false;
  }
}

/* ------------------------------------------------------------------ *
 * 103 — HIVE-RC-HEAL: הבראת-RC אוטונומית (הקצאת-HP מדודה מהראש לחיילים-הרזים).
 * כל-60 דק׳ — השערים-בפנים (hive_rc_heal.cjs) דואגים: רק-כשלראש RC ≥ 12%
 * ורק-עם-עדות-מנוף (Δmax_rc מדוד). אפס-ניחושים, אפס-שידורים-מיותרים.
 * ------------------------------------------------------------------ */
let healRcBusy = false;
async function healRcCycle() {
  if (healRcBusy) return;
  healRcBusy = true;
  try {
    if (CONFIG.dryRun) { updateLoop('hiveRcHeal', { status: 'dry', detail: 'DRY_RUN — הבראת-RC רדומה' }); return; }
    await new Promise((resolve) => {
      execFile(process.execPath, [path.join(__dirname, 'hive_rc_heal.cjs')], { timeout: 300000 }, (e, stdout) => {
        if (stdout) log('hiveRcHeal: ' + String(stdout).trim().split('\n').slice(0, 4).join(' | ').slice(0, 240));
        resolve();
      });
    });
    let detail = 'gated (see hive_rc_heal.json)';
    try {
      const h = JSON.parse(fs.readFileSync(path.join(__dirname, 'hive_rc_heal.json'), 'utf8'));
      detail = h.leverWeak ? 'lever-weak — stopped honestly' : (h.lastGate ? 'gate: ' + h.lastGate.reason + (h.lastGate.etaH != null ? ' · ETA ~' + h.lastGate.etaH + 'h' : '') : 'delegation runs: ' + ((h.runs || []).length));
    } catch (_) { /* keep default */ }
    updateLoop('hiveRcHeal', { status: 'ok', detail, counters: { runs: (((STATUS.loops.hiveRcHeal || {}).counters || {}).runs || 0) + 1 } });
  } catch (e) {
    updateLoop('hiveRcHeal', { status: 'error', detail: String((e && e.message) || e).slice(0, 180) });
  } finally {
    healRcBusy = false;
  }
}

/* ------------------------------------------------------------------ *
 * 53 — ראוטר-צי ל-Hive: עיגון דרך חיילים כשהאוצר חנוק-RC.
 * ריבונות-RC על Hive בדיוק כמו על Steem: העיגון לא נעצר כשהאוצר
 * נגמר — הוא נוסע על המפתחות של הצי (אותן נגזרות, אותו secp256k1).
 * מחזיר { txid, account } או null.
 * ------------------------------------------------------------------ */
let HIVE_RC_CACHE = { at: 0, map: {} }; // 10 דק' cache — חקירת rc_api פר-חייל
async function hiveRcMap(accounts) {
  if (Date.now() - HIVE_RC_CACHE.at < 600000 && Object.keys(HIVE_RC_CACHE.map).length) return HIVE_RC_CACHE.map;
  const map = {};
  try {
    const r = await hiveRpc('rc_api.find_rc_accounts', { accounts });
    for (const a of (r && r.rc_accounts) || []) {
      const maxRc = parseInt(a.max_rc || '0');
      const stored = parseInt(a.rc_manabar && a.rc_manabar.current_mana || '0');
      const lu = parseInt(a.rc_manabar && a.rc_manabar.last_update_time || '0');
      const regen = Math.floor((Math.max(0, Math.floor(Date.now() / 1000) - lu) * maxRc) / (5 * 86400));
      map[a.account] = { maxRc, pct: maxRc > 0 ? (stored + regen) / maxRc : 0 };
    }
  } catch (_) { /* degrade — סדר ברירת-מחדל */ }
  HIVE_RC_CACHE = { at: Date.now(), map };
  return map;
}

async function hiveFleetAnchor(ops, expectTime) {
  const candidates = ARMY.filter((a) => a.postingWif).map((a) => a.username);
  // 103 — RC-DISCIPLINE: מדידה-חיה + שער-תקציב-ריבוני (רצפה 8% · יתרה ≥ 2×עלות-משוער)
  // כל-דילוג נרשם-בשקיפות ב-tried[] — אפס-דילוגים-שקטים (היה: rc<5% מדולג-בלי-עקבה)
  let rcSnap = null;
  try { rcSnap = await HIVE_RC.snapshot([...new Set([...candidates, String(CONFIG.account || '').toLowerCase()])]); HIVE_RC.saveSnapshotFile(rcSnap); } catch (_) { rcSnap = null; }
  const rcMap = rcSnap || (await hiveRcMap(candidates));
  const ordered = ARMY
    .filter((a) => a.postingWif)
    .map((a) => ({ a, rc: (rcMap[a.username] && rcMap[a.username].pct) || 0 }))
    .sort((x, y) => y.rc - x.rc);
  const tried = [];
  const linkageProtected = linkagePendingHive(); // 87 — RC-דיסציפלינה: חיילים שצוברים-מנה ל-account_update
  for (const { a, rc } of ordered) {
    if (linkageProtected.has(a.username)) { tried.push(a.username + ':linkage-protected'); continue; } // 87 — אין-לרוקן חייל שצובר
    if (rcSnap) {
      const g = HIVE_RC.gate(rcSnap, a.username, 150e6, 'hiveFleetAnchor'); // 103 — שער-התקציב
      if (!g.ok) { tried.push(a.username + ':' + g.reason); continue; }
    } else if (rc > 0 && rc < 0.08) { tried.push(a.username + ':rc-low(' + Math.round(rc * 100) + '%)'); continue; } // degraded-מדידה
    try {
      const txid = await hiveBroadcastOps(
        ops.map((op) => [op[0], Object.assign({}, op[1], { required_posting_auths: [a.username] })]),
        expectTime,
        { account: a.username, wif: a.postingWif }
      );
      log('hiveFleet: עוגן-Hive דרך @' + a.username + ' (RC ' + Math.round(rc * 100) + '%)' + (txid ? ' · txid=' + String(txid).slice(0, 12) + '…' : ' · ממתין-לנראות'));
      return { txid, account: a.username };
    } catch (e) {
      tried.push(a.username + ':' + String((e && e.message) || e).slice(0, 40));
      continue; // החייל הבא — העיגון לא נפל
    }
  }
  // fallback ריבוני-אחרון: האוצר עצמו — גם-הוא מאחורי-השער (אפס-ניסיונות-מיותרים)
  if (rcSnap) {
    const g = HIVE_RC.gate(rcSnap, String(CONFIG.account || '').toLowerCase(), 150e6, 'hiveFleetAnchor-treasury');
    if (!g.ok) {
      log('hiveFleet: אין-חותם-כשיר — השער-מונע-ניסיון-מיותר · regen ימלא רצפה בעוד ~' + Math.max(0, Math.round(((0.08 - (g.pct || 0)) * 5 * 86400) / 3600)) + 'ש׳ · ' + tried.join(' | ') + ' · head:' + g.reason);
      return null;
    }
  }
  try {
    const txid = await hiveBroadcastOps(ops, expectTime);
    return { txid, account: CONFIG.account };
  } catch (e) {
    log('hiveFleet: כל החותמים נכשלו — ' + tried.join(' | ') + ' · treasury: ' + String((e && e.message) || e).slice(0, 60));
    return null;
  }
}

/** חתימה מקומית במפתח-active + שידור ל-Hive (עבור ssc-mainnet-hive / transfer_to_vesting). */
async function hiveBroadcastActive(ops) {
  const dgp = await hiveRpc('condenser_api.get_dynamic_global_properties', []);
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations: ops,
    extensions: [],
  };
  const prevChainId = steem.config.get('chain_id');
  steem.config.set('chain_id', HIVE_CHAIN_ID);
  let signed;
  try {
    signed = steem.auth.signTransaction(tx, [CONFIG.activeWif]);
  } finally {
    steem.config.set('chain_id', prevChainId);
  }
  await hiveRpc('condenser_api.broadcast_transaction', [signed]);
  return signed;
}

/* 50 — ריבונות-RC בצד-Hive: מכונת-מצב אוטונומית SWAP.HIVE → withdraw → HIVE → powerup → HP.
 * מטרה: העלאת maxRc של האוצר ב-Hive (הבריכה-החנוקה שלנו: 34.6G max) כדי שהגשר/הסולם/
 * הג'נזיס ינועו. שער-RC לפני כל-broadcast · מידה לפני/אחרי on-chain · למידת-וריאנט:
 * אם withdraw-empty-payload לא עובד תוך 90 דק' → מנסה עם quantity מפורש, ולהפך. */
function loadHivePowerState() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'hive_power_state.json'), 'utf8')); } catch (_) { return { stage: 'idle', variant: 'empty' }; }
}
function saveHivePowerState(s) {
  fs.writeFileSync(path.join(__dirname, 'hive_power_state.json'), JSON.stringify(s, null, 2) + '\n');
}
async function hivePowerCycle() {
  if (!CONFIG.activeWif) {
    updateLoop('hivePower', { status: 'idle', detail: 'no active wif — powerup requires active authority', counters: {} });
    return;
  }
  try {
    const st = loadHivePowerState();
    const acc = (await hiveRpc('condenser_api.get_accounts', [[CONFIG.account]]))[0] || {};
    const hiveLiquid = parseFloat(String(acc.balance || '0').split(' ')[0]) || 0;
    const vesting = String(acc.vesting_shares || '0');
    let swapBal = 0;
    try {
      const bal = await rpcV4('https://api.hive-engine.com/rpc/contracts', {
        jsonrpc: '2.0', method: 'find',
        params: { contract: 'tokens', table: 'balances', query: { account: CONFIG.account, symbol: 'SWAP.HIVE' }, limit: 1 }, id: 1,
      });
      swapBal = bal && bal[0] ? parseFloat(bal[0].balance) || 0 : 0;
    } catch (_) { /* engine node down — skip cycle */ }
    let rcCur = 0; let rcMax = 0;
    try {
      const rca = (await hiveRpc('rc_api.find_rc_accounts', { accounts: [CONFIG.account] })).rc_accounts[0];
      rcMax = Number(rca.max_rc) || 0;
      const stored = Number(rca.rc_manabar.current_mana) || 0;
      const lu = Number(rca.rc_manabar.last_update_time) || 0;
      rcCur = Math.min(rcMax, stored + Math.floor(((Math.floor(Date.now() / 1000) - lu) * rcMax) / (5 * 86400)));
    } catch (_) { /* rc probe fail — treat as drained */ }
    // Task 27 deadlock fix (owner directive "obtain HIVE, close the resource corner"):
    // the old blanket gate (1.2G RC) blocked the power-up itself — the CURE —
    // while the anchor drains RC ≈ regen forever (measured live 2026-09-08: one
    // custom_json costs ~124M RC). New gate = broadcast FEASIBILITY only (150M
    // ≈ one op), so withdraw/power-up fire as soon as a single op is affordable;
    // the anchor floor belongs to the anchor loop, not to the cure.
    const RC_GATE = 1.5e8;
    if (rcCur < RC_GATE) {
      const etaMin = Math.ceil(((RC_GATE - rcCur) * 5 * 86400) / rcMax / 60);
      updateLoop('hivePower', { status: 'rc-waiting', detail: 'Hive RC ' + r6d(rcCur / 1e6) + 'M < ' + r6d(RC_GATE / 1e6) + 'M (די לפעולה אחת) · שחזור ≈' + etaMin + ' דק' + ' · SWAP.HIVE=' + r6d(swapBal), counters: { stage: st.stage, variant: st.variant } });
      saveHivePowerState(st);
      return;
    }
    if (swapBal >= 0.5 && st.stage !== 'withdraw-sent') {
      const payload = st.variant === 'quantity' ? { quantity: String(swapBal) } : {};
      const op = ['custom_json', { required_auths: [CONFIG.account], required_posting_auths: [], id: 'ssc-mainnet-hive', json: JSON.stringify({ contractName: 'hivepegged', contractAction: 'withdraw', contractPayload: payload }) }];
      const signed = await hiveBroadcastActive([op]);
      st.stage = 'withdraw-sent';
      st.swapAtSend = swapBal;
      st.sentAt = new Date().toISOString();
      st.variantUsed = st.variant;
      st.liquidAtSend = hiveLiquid;
      st.txid = (signed && signed.transaction_id) || null;
      saveHivePowerState(st);
      log('hivePower: withdraw broadcast (' + st.variantUsed + ' payload) — SWAP.HIVE ' + r6d(swapBal) + ' → ממתין ל-HIVE');
      updateLoop('hivePower', { status: 'withdraw-sent', detail: 'withdraw (' + st.variantUsed + ') שודר — ' + r6d(swapBal) + ' SWAP.HIVE → HIVE · ממתין לנחיתה', counters: { variant: st.variantUsed } });
      return;
    }
    if (st.stage === 'withdraw-sent') {
      const landed = hiveLiquid >= Math.max(0.5, (st.swapAtSend || 0) * 0.9);
      const ageMin = st.sentAt ? (Date.now() - new Date(st.sentAt).getTime()) / 60000 : 0;
      if (landed) {
        const amount = r3d(Math.floor(hiveLiquid * 1000) / 1000);
        if (amount >= 0.5) {
          const op = ['transfer_to_vesting', { from: CONFIG.account, to: CONFIG.account, amount: amount.toFixed(3) + ' HIVE' }];
          const signed = await hiveBroadcastActive([op]);
          await new Promise((r) => setTimeout(r, 8000));
          const acc2 = (await hiveRpc('condenser_api.get_accounts', [[CONFIG.account]]))[0] || {};
          const vestsA = parseFloat(String(acc2.vesting_shares || '0').split(' ')[0]) || 0;
          const vestsB = parseFloat(String(vesting).split(' ')[0]) || 0;
          const rca2 = (await hiveRpc('rc_api.find_rc_accounts', { accounts: [CONFIG.account] })).rc_accounts[0];
          const rcMaxA = Number(rca2.max_rc) || 0;
          const out = {
            at: new Date().toISOString(), mode: 'daemon-powerup',
            withdrawTxid: st.txid || null, withdrawVariant: st.variantUsed || st.variant,
            powerupTxid: (signed && signed.transaction_id) || null, amountPowered: amount.toFixed(3) + ' HIVE',
            vestingBefore: vestsB, vestingAfter: vestsA, vestsDelta: r6d(vestsA - vestsB),
            rcMaxBefore: rcMax, rcMaxAfter: rcMaxA, rcMaxDelta: rcMaxA - rcMax,
            rcRegenGainPct: rcMax ? r6d(((rcMaxA - rcMax) / rcMax) * 100) : 0,
            verified: vestsA > vestsB && rcMaxA > rcMax,
          };
          fs.writeFileSync(path.join(__dirname, 'he_powerup_result.json'), JSON.stringify(out, null, 2) + '\n');
          st.stage = 'powered';
          st.poweredAt = out.at;
          st.lastResult = out;
          saveHivePowerState(st);
          log('hivePower: POWERED UP ' + out.amountPowered + ' → HP · vests +' + out.vestsDelta + ' · rcMax +' + r6d(out.rcMaxDelta / 1e9) + 'G (+' + out.rcRegenGainPct + '%) · verified=' + out.verified);
          updateLoop('hivePower', { status: 'ok', detail: 'HP +' + out.vestsDelta + ' VESTS · rcMax ' + r6d(rcMax / 1e9) + 'G→' + r6d(rcMaxA / 1e9) + 'G (+' + out.rcRegenGainPct + '%)', counters: { powerups: 1 } });
        } else {
          updateLoop('hivePower', { status: 'idle', detail: 'HIVE שנחת קטן מ-0.5 — מדלג', counters: {} });
        }
      } else if (ageMin > 90) {
        st.variant = st.variant === 'quantity' ? 'empty' : 'quantity';
        st.stage = 'idle';
        st.staleAt = new Date().toISOString();
        saveHivePowerState(st);
        log('hivePower: withdraw לא עובד (' + st.variantUsed + ') אחרי 90 דק — מחליף וריאנט ל-' + st.variant);
        updateLoop('hivePower', { status: 'learning', detail: 'withdraw (' + st.variantUsed + ') לא עובד — מנסה וריאנט ' + st.variant + ' בפעימה הבאה', counters: {} });
      } else {
        updateLoop('hivePower', { status: 'withdraw-waiting', detail: 'ממתין לנחיתת-HIVE (' + Math.round(ageMin) + ' דק · ' + r6d(st.swapAtSend) + ' SWAP.HIVE)', counters: {} });
      }
      return;
    }
    if (hiveLiquid >= 0.5 && swapBal < 0.5) {
      // שארית-HIVE נזילה בלי SWAP — מעלים ישר
      const amount = r3d(Math.floor(hiveLiquid * 1000) / 1000);
      if (amount >= 0.5) {
        const op = ['transfer_to_vesting', { from: CONFIG.account, to: CONFIG.account, amount: amount.toFixed(3) + ' HIVE' }];
        await hiveBroadcastActive([op]);
        log('hivePower: powered leftover ' + amount.toFixed(3) + ' HIVE');
      }
      return;
    }
    updateLoop('hivePower', { status: 'ok', detail: 'אין מה להעלות (SWAP.HIVE=' + r6d(swapBal) + ' · HIVE=' + r6d(hiveLiquid) + ') · rcMax=' + r6d(rcMax / 1e9) + 'G', counters: { stage: st.stage } });
  } catch (e) {
    updateLoop('hivePower', { status: 'error', detail: String((e && e.message) || e).slice(0, 160) });
    log('hivePower: FAILED — ' + ((e && e.message) || e));
  }
}

/* ------------------------------------------------------------------ *
 * 35 — זהות דו-שרשרתית + סקירת-נכסים בצד-השרשרת (נתונים ציבוריים בלבד)
 * מפתח אחד → Steem + Hive (מאומת בשרשרות) + כתובת EVM נגזרת (keccak256).
 * ה-WIF אף פעם לא נוגע/נשלח — רק הנגזרות הפומביות נכתבות ל-STATUS.
 * ------------------------------------------------------------------ */
async function refreshIdentity() {
  const id = { evmAddress: null, steemPub: null, heTokens: 0, heValueSwapHive: null, heSwapHive: null, heTop: [] };
  try {
    if (!CONFIG.postingWif) {
      log('identity: no POSTING_WIF — גזירת-זהות מדולגת (גישושי-נכסים-ציבוריים-בלבד)');
    } else {
      const derived = deriveIdentities(CONFIG.postingWif);
      id.evmAddress = derived.evmAddress;
      id.steemPub = derived.steemPub;
    }
  } catch (e) {
    log('identity: derivation failed: ' + String((e && e.message) || e).slice(0, 100));
  }
  try {
    const heRpc = 'https://api.hive-engine.com/rpc/contracts';
    const bal = await rpcV4(heRpc, {
      jsonrpc: '2.0', method: 'find',
      params: { contract: 'tokens', table: 'balances', query: { account: CONFIG.account }, limit: 100 }, id: 1,
    });
    const metrics = await rpcV4(heRpc, {
      jsonrpc: '2.0', method: 'find',
      params: { contract: 'market', table: 'metrics', query: {}, limit: 1000 }, id: 2,
    });
    const px = new Map((Array.isArray(metrics) ? metrics : []).map((m) => [m.symbol, m]));
    let count = 0;
    let total = 0;
    const top = [];
    for (const b of Array.isArray(bal) ? bal : []) {
      const t = (parseFloat(b.balance) || 0) + (parseFloat(b.stake) || 0);
      if (!(t > 0)) continue;
      count++;
      const m = px.get(b.symbol);
      const last = m ? parseFloat(m.lastPrice) || 0 : 0;
      total += last * t;
      top.push({ symbol: b.symbol, total: r6d(t) });
      if (b.symbol === 'SWAP.HIVE') id.heSwapHive = parseFloat(b.balance) || 0;
    }
    id.heTokens = count;
    id.heValueSwapHive = r6d(total);
    id.heTop = top;
  } catch (e) {
    log('identity: hive-engine probe failed: ' + String((e && e.message) || e).slice(0, 100));
  }
  STATUS.identity = id;
  log('identity: evm=' + (id.evmAddress || 'n/a') + ' · he tokens=' + id.heTokens + ' · heValue=' + id.heValueSwapHive + ' · settled SWAP.HIVE=' + (id.heSwapHive != null ? id.heSwapHive.toFixed(8) : 'n/a'));
  writeStatus();
}

/* ------------------------------------------------------------------ *
 * 34 — לולאת הגשר: עוגני saos מ-Steem ל-Hive + checkpoint דו-שרשרתי
 * ------------------------------------------------------------------ */
async function bridgeCycle() {
  const counters = bridgeCounters();
  if (!CONFIG.bridgeEnabled) {
    updateLoop('bridge', { status: 'disabled', detail: 'BRIDGE_ENABLED=false', counters });
    return;
  }
  if (!CONFIG.postingWif) {
    updateLoop('bridge', { status: 'disabled', detail: 'no POSTING_WIF', counters });
    return;
  }

  // 46+53 — שער-RC נהפך ראוטר: האוצר חנוק-RC על Hive (נמדד) — אבל העיגון לא נעצר.
  // ריבונות-RC: העוגנים נוסעים על מפתחות-הצי (haran 82% · macrame · tov …) דרך
  // hiveFleetAnchor, והאוצר ממשיך לחסוך דלק למדרגת-הג׳נזיס. אף-עוגן-לא-אובד.
  let TREASURY_HIVE_RC = null;
  try {
    const rc = await rpcV4(CONFIG.hiveRpc, { jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: [CONFIG.account] }, id: 1 });
    const rca = rc && rc.rc_accounts && rc.rc_accounts[0];
    if (rca) {
      const maxRc = parseInt(rca.max_rc || '0');
      const stored = parseInt(rca.rc_manabar.current_mana || '0');
      const lu = parseInt(rca.rc_manabar.last_update_time || '0');
      TREASURY_HIVE_RC = stored + Math.floor((Math.max(0, Math.floor(Date.now() / 1000) - lu) * maxRc) / (5 * 86400));
    }
  } catch (_) { /* rc probe fail — continue as before */ }

  // 1) סריקת Steem — פעולות saos חדשות מאז העוגן האחרון (רב-צומתי)
  let steemHist;
  try {
    steemHist = await histFresh(CONFIG.account, 100);
    if (!steemHist) throw new Error('no fresh history');
  } catch (e) {
    updateLoop('bridge', { status: 'error', detail: 'steem scan failed: ' + String((e && e.message) || e).slice(0, 100), counters });
    return;
  }
  let newestIdx = 0;
  const saosOps = [];
  for (const [idx, e] of steemHist) {
    if (idx > newestIdx) newestIdx = idx;
    const [type, v] = e.op;
    if (type !== 'custom_json' || v.id !== 'saos') continue;
    if (idx <= BRIDGE_STATE.lastSteemIdx) continue;
    let payload = null;
    try { payload = JSON.parse(String(v.json || '{}')); } catch (_) { /* skip */ }
    if (!payload || payload.protocol !== 'saos/v1') continue;
    if (payload.action === 'wlog') continue; // 44 — יומן-עולם משודר לשתי השרשראות בעצמו — הגשר לא משכפל
    saosOps.push({ idx, txid: e.trx_id || '', payload });
  }
  saosOps.sort((a, b) => a.idx - b.idx);

  // בסיס ראשון: לא מטמיעים היסטוריה ישנה — המצב הנוכחי נעוג ב-checkpoint
  if (BRIDGE_STATE.lastSteemIdx === 0) {
    BRIDGE_STATE.lastSteemIdx = newestIdx;
    writeBridgeState();
    updateLoop('bridge', { status: 'ok', detail: 'baseline idx=' + newestIdx + ' (history not re-anchored)', counters: bridgeCounters() });
    return;
  }

  const batch = saosOps.slice(0, CONFIG.bridgeCapPerBeat);

  // 2) checkpoint דו-שרשרתי כל checkpointH שעות (הוכחת-עתודה של מצב הדקס)
  const nowMs = Date.now();
  const lastCpMs = BRIDGE_STATE.lastCheckpointAt ? Date.parse(BRIDGE_STATE.lastCheckpointAt) : 0;
  const checkpointDue = !BRIDGE_STATE.lastCheckpointAt || nowMs - lastCpMs >= CONFIG.bridgeCheckpointH * 3600000;
  if (checkpointDue) {
    await refreshIdentity().catch(() => {}); // 35 — תקציר זהות/נכסים פעם ב-6h, מתווסף ל-checkpoint
  }
  let checkpointPayload = null;
  if (checkpointDue) {
    let book = null;
    try {
      const res = await fetch(CONFIG.dexApiUrl + '/api/ops/saos/dex?username=' + encodeURIComponent(CONFIG.account), { signal: AbortSignal.timeout(25000) });
      book = await res.json();
    } catch (_) { /* degrade */ }
    let acc = null;
    let feedSbdPerSteem = null;
    try {
      const [accRaw] = await rpcV4(CONFIG.rpcUrl, { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[CONFIG.account]], id: 2 });
      acc = accRaw;
      const feed = await rpcV4(CONFIG.rpcUrl, { jsonrpc: '2.0', method: 'condenser_api.get_feed_history', params: [], id: 3 });
      if (feed && feed.current_median_history) {
        feedSbdPerSteem =
          parseFloat(String(feed.current_median_history.base).split(' ')[0]) /
          parseFloat(String(feed.current_median_history.quote).split(' ')[0]);
      }
    } catch (_) { /* degrade */ }
    let newestTxid = '';
    for (const [idx, e] of steemHist) if (idx === newestIdx) newestTxid = e.trx_id || '';
    checkpointPayload = {
      protocol: 'saos/v1',
      action: 'checkpoint',
      account: CONFIG.account,
      chain: 'hive',
      anchor: {
        srcChain: 'steem',
        srcNewestIdx: newestIdx,
        srcNewestTxid: newestTxid,
        steemWallet: acc ? acc.balance : null,
        steemSbd: acc ? acc.sbd_balance : null,
        feedSbdPerSteem: feedSbdPerSteem != null ? r6d(feedSbdPerSteem) : null,
        dex: book && book.ok ? {
          supply: r3d(book.mine.saosLiquid + book.mine.saosLocked),
          bestAsk: book.stats.bestAsk,
          bestBid: book.stats.bestBid,
          openOrders: book.stats.openOrders,
          tradesTotal: book.stats.tradesTotal,
          pages: book.pagesScanned,
        } : null,
      },
      time: new Date().toISOString(),
      note: 'SAOS-1 dual-chain anchor: same key rules Steem + Hive. Recompute the Steem replay and compare.',
    };
  }

  if (batch.length === 0 && !checkpointPayload) {
    updateLoop('bridge', { status: 'ok', detail: 'idle · steemIdx=' + newestIdx + ' · anchored ' + BRIDGE_STATE.anchoredTotal, counters: bridgeCounters() });
    return;
  }

  // 3) בניית העסקה — עוגן אחד מאוחד (עד cap פעולות + checkpoint בעסקה אחת)
  const hiveOps = [];
  const parts = [];
  for (const op of batch) {
    hiveOps.push([
      'custom_json',
      {
        required_auths: [],
        required_posting_auths: [CONFIG.account],
        id: 'saos',
        json: JSON.stringify({
          protocol: 'saos/v1',
          action: 'anchor',
          account: CONFIG.account,
          chain: 'hive',
          anchor: { srcChain: 'steem', srcIdx: op.idx, srcTxid: op.txid, op: op.payload },
          time: new Date().toISOString(),
        }),
      },
    ]);
    parts.push('#' + op.idx + ':' + op.payload.action);
  }
  if (checkpointPayload) {
    hiveOps.push([
      'custom_json',
      {
        required_auths: [],
        required_posting_auths: [CONFIG.account],
        id: 'saos',
        json: JSON.stringify(checkpointPayload),
      },
    ]);
    parts.push('checkpoint');
  }

  // 4) תקציב-RC — 53: הראוטר-צי נושא את העיגון, הסף-הקשה של האוצר הוסר (היה
  //    חונק-לצמיתות את העוגנים בזמן שהצי יושב על דלק מלא). מה שנשאר: throttle
  //    של נפח-באץ' רק כשהעיגון בפועל ייפול לאוצר (fallback) עם מנה נמוכה.
  if (TREASURY_HIVE_RC != null && TREASURY_HIVE_RC < 2e9 && batch.length > 1 && !checkpointPayload) {
    // throttle: FIFO — העוגן הישן-ביותר הפעימה הזו (היתר נשאר בתור לפעימות הבאות),
    // כך כל פעולה בסוף נעוגת; הקצב מותאם לתקציב ה-RC הנמדד של האוצר בלבד
    const kept = batch.slice(0, 1);
    const dropped = batch.length - kept.length;
    batch.length = 0;
    batch.push(...kept);
    parts.length = 0;
    parts.push('anchor×' + kept.length + ' (rc-throttle · ' + dropped + ' נדחים לפעימה הבאה)');
  }

  if (CONFIG.dryRun) {
    log('[DRY_RUN] bridge: would anchor ' + batch.length + ' op(s)' + (checkpointPayload ? ' + checkpoint' : '') + ' → Hive');
    updateLoop('bridge', { status: 'dry', detail: '[DRY_RUN] ' + parts.join(',') + ' → Hive', counters: bridgeCounters() });
    return;
  }

  try {
    const routed = await hiveFleetAnchor(
      hiveOps,
      checkpointPayload ? checkpointPayload.time : batch.length ? JSON.parse(hiveOps[0][1].json).time : null
    );
    if (!routed) throw new Error('כל החותמים (צי+אוצר) נכשלו');
    const txid = routed.txid;
    BRIDGE_STATE.anchoredTotal += batch.length;
    if (checkpointPayload) {
      BRIDGE_STATE.checkpoints += 1;
      BRIDGE_STATE.lastCheckpointAt = new Date().toISOString();
    }
    BRIDGE_STATE.lastSteemIdx = Math.max(BRIDGE_STATE.lastSteemIdx, batch.length ? batch[batch.length - 1].idx : newestIdx);
    BRIDGE_STATE.lastTxid = txid;
    writeBridgeState();
    const detail = parts.join(',') + ' → Hive@' + routed.account + (txid ? ' · txid=' + txid : '') +
      (TREASURY_HIVE_RC != null ? ' · treasuryRC=' + Math.round(TREASURY_HIVE_RC / 1e6) + 'M' : '');
    log('bridge: ANCHORED ' + detail);
    updateLoop('bridge', { status: 'ok', detail, counters: bridgeCounters() });
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 140);
    log('bridge: anchor FAILED: ' + msg);
    updateLoop('bridge', { status: 'error', detail: msg, counters: bridgeCounters() });
  }
}

/* ------------------------------------------------------------------ *
 * 53 — לולאת נעילת-ערך (value lock): "איך מייצרים ערך מכל התזוזות —
 * ונועלים יותר ערך בבריכות שלנו". כל פעימה: חתך מה-SAOS הנזיל של
 * האוצר נכנס pool_add לבריכה SAOS:STEEM ומיד pool_lock 100% —
 * נזילות קבועה שלא ניתנת לשליפה לעולם (המנוע מכיר pool_lock —
 * מנגנון-חוזה שהשרשרת לא ידעה). המניפסט נעוג על Hive דרך ראוטר-הצי.
 * העמלות מקצב-הצי (pool_swap) זורמות ל-LP — גם החלק הנעול מרוויח.
 * state → value_lock_state.json (משותף עם value_lock.cjs הידני).
 * ------------------------------------------------------------------ */
const VALUE_LOCK_STATE_PATH = path.join(__dirname, 'value_lock_state.json');
let VALUE_LOCK_STATE = (() => {
  try { return JSON.parse(fs.readFileSync(VALUE_LOCK_STATE_PATH, 'utf8')); } catch (_) { return { seq: 0, lockedLp: 0, lockedSaosCum: 0, lastAt: null, lastTxid: null, lastHiveTxid: null, lastHiveVia: null, depthBefore: null, depthAfter: null }; }
})();
function saveValueLockState() {
  try {
    const tmp = VALUE_LOCK_STATE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(VALUE_LOCK_STATE, null, 2) + '\n');
    fs.renameSync(tmp, VALUE_LOCK_STATE_PATH);
  } catch (_) { /* לא קריטי */ }
}

async function valueLockCycle() {
  if (cloudEconPaused()) { log('valueLock: cloud stand-down (fresh cloud_takeover) — economic pause'); return; }
  const counters = () => ({ seq: VALUE_LOCK_STATE.seq, lockedLp: VALUE_LOCK_STATE.lockedLp, lockedSaosCum: VALUE_LOCK_STATE.lockedSaosCum });
  if (CONFIG.dryRun) { updateLoop('valueLock', { status: 'dry', detail: '[DRY] lock rail ready', counters: counters() }); return; }
  // שער-טריות — מונע ריצה-כפולה מול הסקריפט-הידני (value_lock.cjs)
  if (VALUE_LOCK_STATE.lastAt && Date.now() - Date.parse(VALUE_LOCK_STATE.lastAt) < 20 * 60000) {
    updateLoop('valueLock', { status: 'ok', detail: 'recent lock ' + VALUE_LOCK_STATE.lastAt.slice(11, 19) + 'Z — holding', counters: counters() });
    return;
  }
  const dex = await dexLocalApi('/api/ops/saos/dex?username=' + encodeURIComponent(CONFIG.account), 40000);
  if (!dex || dex.ok !== true || !dex.mine) { updateLoop('valueLock', { status: 'error', detail: 'dex snapshot unavailable', counters: counters() }); return; }
  const pool = (dex.pools || []).find((p) => p.pair === 'SAOS:STEEM');
  if (!pool || !(pool.lpSupply > 1e-9)) { updateLoop('valueLock', { status: 'skipped', detail: 'pool not open yet', counters: counters() }); return; }
  const liquid = Number(dex.mine.saosLiquid) || 0;
  const amt = r3d(Math.min(liquid * 0.25, 3));
  if (!(amt >= 0.05)) { updateLoop('valueLock', { status: 'idle', detail: 'liquid SAOS ' + liquid.toFixed(3) + ' — below lock floor 0.05', counters: counters() }); return; }
  const depthBefore = pool.saos;
  const time = new Date().toISOString();
  const addPayload = { protocol: 'saos/v1', action: 'pool_add', pair: 'SAOS:STEEM', account: CONFIG.account, saosAmt: amt, steemAmt: 0, time };
  const lockPayload = { protocol: 'saos/v1', action: 'pool_lock', pair: 'SAOS:STEEM', account: CONFIG.account, pct: 1, time };
  let txid = null;
  try {
    const conf = await steem.broadcast.sendAsync(
      { operations: [saosBusOp(addPayload), saosBusOp(lockPayload)], extensions: [] },
      [CONFIG.postingWif]
    );
    txid = (conf && conf.id) || null;
  } catch (e) {
    updateLoop('valueLock', { status: 'error', detail: 'steem broadcast: ' + String((e && e.message) || e).slice(0, 100), counters: counters() });
    return;
  }
  // מניפסט-הנעילה נעוג על Hive דרך ראוטר-הצי — פעולה-אחת אצלנו → חתימות-בשתי-השרשראות
  const manifest = {
    protocol: 'saos/v1', action: 'value_lock', account: CONFIG.account, seq: VALUE_LOCK_STATE.seq + 1,
    lockedSaos: amt, depthBefore, time, srcTxid: txid, note: 'LP locked permanently — fees keep flowing',
  };
  let hive = null;
  try { hive = await hiveFleetAnchor([saosBusOp(manifest)], time); } catch (_) { /* אופציונלי */ }
  const dex2 = await dexLocalApi('/api/ops/saos/dex?username=' + encodeURIComponent(CONFIG.account), 40000).catch(() => null);
  let pool2 = dex2 && dex2.ok ? (dex2.pools || []).find((p) => p.pair === 'SAOS:STEEM') : null;
  // 53 — re-replay lag: סריקת-ההיסטוריה של המנוע מפגרת ~2-10ש׳ אחרי-שידור; אם
  // העומק לא זז — ממתינים 8ש׳ וקוראים שוב (×3 — עובר את TTL המטמון של 15ש׳).
  for (let retry = 0; retry < 3 && pool2 && Math.abs((pool2.saos || 0) - depthBefore) < 1e-9; retry++) {
    await new Promise((r) => setTimeout(r, 8000));
    const dex3 = await dexLocalApi('/api/ops/saos/dex?username=' + encodeURIComponent(CONFIG.account), 40000).catch(() => null);
    pool2 = dex3 && dex3.ok ? (dex3.pools || []).find((p) => p.pair === 'SAOS:STEEM') : pool2;
  }
  VALUE_LOCK_STATE.seq += 1;
  VALUE_LOCK_STATE.lastAt = time;
  VALUE_LOCK_STATE.lastTxid = txid;
  VALUE_LOCK_STATE.lastHiveTxid = (hive && hive.txid) || VALUE_LOCK_STATE.lastHiveTxid || null;
  VALUE_LOCK_STATE.lastHiveVia = (hive && hive.account) || VALUE_LOCK_STATE.lastHiveVia || null;
  VALUE_LOCK_STATE.lockedSaosCum = r3d((VALUE_LOCK_STATE.lockedSaosCum || 0) + amt);
  VALUE_LOCK_STATE.lockedLp = pool2 ? r6d(pool2.locked || 0) : VALUE_LOCK_STATE.lockedLp;
  VALUE_LOCK_STATE.depthBefore = depthBefore;
  VALUE_LOCK_STATE.depthAfter = pool2 ? pool2.saos : null;
  saveValueLockState();
  const detail = 'locked ' + amt + ' SAOS · LP-locked ' + VALUE_LOCK_STATE.lockedLp + ' · depth ' + depthBefore + '→' + VALUE_LOCK_STATE.depthAfter +
    (txid ? ' · txid=' + String(txid).slice(0, 12) + '…' : '') + (hive && hive.account ? ' · hive@' + hive.account : '');
  log('valueLock: ' + detail);
  updateLoop('valueLock', { status: 'ok', detail, counters: counters() });
}

/* 48 — פעימת-צי (fleet pace): החיילים מייצרים קצב-עסקאות ריבוני קבוע:
 *   1. fleet_ping — custom_json על אוטובוס-saos חתום במפתח-הפרסום של החייל עצמו.
 *      פעילות ריבונית שלא תלויה בשום-דבר חיצוני — הוכחת-חיות על-השרשרת, קצב = נכס.
 *   2. fee-routing — אם לחייל יש קרדיט-DEX או SAOS נזיל, הוא מוסיף pool_swap
 *      על הבריכה שלנו (העמלה זורמת ל-LP) — חייל-כמערכת-מסחר מהדוקטרינה של המפעיל.
 * תקציב-בטיחות: חייל אחד לפעימה (rotation), RC-floor 10%, ≤2 ops לטרנזקציה
 * (חומת 5/בלוק), והפינג רץ גם כשה-DEX מקומי נופל. */
const FLEET_STATE_PATH = path.join(__dirname, 'fleet_state.json');
let FLEET_STATE = (() => {
  try { return JSON.parse(fs.readFileSync(FLEET_STATE_PATH, 'utf8')); } catch (_) { return { idx: 0, day: utcToday(), pingsToday: 0, seqBy: {} }; }
})();
function saveFleetState() {
  try { fs.writeFileSync(FLEET_STATE_PATH, JSON.stringify(FLEET_STATE, null, 2) + '\n'); } catch (_) { /* לא קריטי */ }
}

function fleetBusOp(account, payload) {
  return ['custom_json', { required_auths: [], required_posting_auths: [account], id: 'saos', json: JSON.stringify(payload) }];
}

async function fleetPaceCycle() {
  const members = ARMY.filter((a) => a.postingWif);
  if (!members.length) {
    updateLoop('fleetPace', { status: 'idle', detail: 'אין חיילים עם מפתח-פרסום בכספת', counters: { pingsToday: FLEET_STATE.pingsToday, fleet: 0 } });
    return;
  }
  if (FLEET_STATE.day !== utcToday()) { FLEET_STATE.day = utcToday(); FLEET_STATE.pingsToday = 0; }
  const m = members[FLEET_STATE.idx % members.length];
  FLEET_STATE.idx = (FLEET_STATE.idx + 1) % members.length;
  // רצפת-RC — דלק החייל קודם לכל (קאש משותף)
  try {
    const rc = await cached('rc:' + m.username, () => api.call('rc_api.find_rc_accounts', { accounts: [m.username] }));
    const row = rc && rc.rc_accounts && rc.rc_accounts[0];
    if (row) {
      const max = parseFloat(row.max_rc);
      const mana = parseFloat(row.rc_manabar.current_mana);
      if (max > 0 && mana / max < 0.1) {
        updateLoop('fleetPace', { status: 'throttled', detail: '@' + m.username + ' RC < 10% — מדלג על פעימה', counters: { pingsToday: FLEET_STATE.pingsToday, fleet: members.length } });
        return;
      }
    }
  } catch (_) { /* תקלת-קריאה לא עוצרת פעימה */ }
  const seq = (Number(FLEET_STATE.seqBy[m.username]) || 0) + 1;
  FLEET_STATE.seqBy[m.username] = seq;
  const ops = [fleetBusOp(m.username, { protocol: 'saos/v1', action: 'fleet_ping', gen: 2, bot: m.username, seq, at: new Date().toISOString() })];
  // fee-routing: נכס-צי → בריכה שלנו (עמלה → LP) — הקצב הופך לערך
  let routed = null;
  try {
    const dex = await dexLocalApi('/api/ops/saos/dex?username=' + encodeURIComponent(m.username));
    const mine = dex && dex.mine;
    if (mine && mine.saosLiquid >= 0.5) {
      ops.push(fleetBusOp(m.username, { protocol: 'saos/v1', action: 'pool_swap', pair: 'SAOS:STEEM', taker: m.username, side: 'sell_saos', inAmt: r3(mine.saosLiquid * 0.3), time: new Date().toISOString() }));
      routed = 'sell_saos ' + r3(mine.saosLiquid * 0.3) + ' SAOS';
    } else if (mine && mine.steemCredit >= 0.05) {
      ops.push(fleetBusOp(m.username, { protocol: 'saos/v1', action: 'pool_swap', pair: 'SAOS:STEEM', taker: m.username, side: 'buy_saos', inAmt: r6(mine.steemCredit * 0.5), time: new Date().toISOString() }));
      routed = 'buy_saos ' + r6(mine.steemCredit * 0.5) + ' credit';
    }
  } catch (_) { /* הבריכה אופציונלית — הפינג תמיד רץ */ }
  if (CONFIG.dryRun) {
    log('[DRY_RUN] fleetPace: @' + m.username + ' would ping (seq ' + seq + ')' + (routed ? ' + swap ' + routed : ''));
    updateLoop('fleetPace', { status: 'dry', detail: '[DRY] @' + m.username + ' ping seq ' + seq + (routed ? ' + ' + routed : ''), counters: { pingsToday: FLEET_STATE.pingsToday, fleet: members.length } });
    return;
  }
  try {
    const conf = await steem.broadcast.sendAsync({ operations: ops, extensions: [] }, [m.postingWif]);
    const txid = (conf && conf.id) || null;
    FLEET_STATE.pingsToday += 1;
    saveFleetState();
    STATUS.fleet = Object.assign({}, STATUS.fleet, {
      size: members.length,
      lastPingBy: m.username,
      lastPingAt: new Date().toISOString(),
      lastTxid: txid,
      routed,
      pingsToday: FLEET_STATE.pingsToday,
    });
    const detail = '@' + m.username + ' fleet_ping seq ' + seq + (txid ? ' · txid=' + String(txid).slice(0, 12) + '…' : '') + (routed ? ' · routed ' + routed : '');
    log('fleetPace: ' + detail);
    updateLoop('fleetPace', { status: 'ok', detail, counters: { pingsToday: FLEET_STATE.pingsToday, fleet: members.length, routed: routed ? 1 : 0 } });
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 140);
    log('fleetPace: @' + m.username + ' FAILED: ' + msg);
    updateLoop('fleetPace', { status: 'error', detail: '@' + m.username + ': ' + msg, counters: { pingsToday: FLEET_STATE.pingsToday, fleet: members.length } });
  }
}

/* 54 — רפלקס-בלוק: תרגיל-צי אוטונומי. טריגר-אוצר → 10 תגובות חתומות-מראש
 * (נוחתות בבלוק N+1) → עוגן-digest דו-שרשרתי. אפס-עלות-נזילה, דלק-ריבוני בלבד.
 * הדימון מזריק את התרגיל כל REFLEX_INTERVAL_MIN דקות (default 240) — הרפלקס
 * של האימפריה נשמר חי גם בלי מפעיל. */
async function reflexCycle() {
  const counters = () => {
    try {
      const ev = JSON.parse(fs.readFileSync(path.join(__dirname, 'reflex_evidence.json'), 'utf8'));
      return {
        maxLatencyBlocks: ev.summary && ev.summary.maxLatencyBlocks,
        totalResponses: ev.summary && ev.summary.totalResponses,
        at: ev.at,
      };
    } catch (_) { return {}; }
  };
  if (CONFIG.dryRun) { updateLoop('reflex', { status: 'dry', detail: '[DRY] reflex engine ready (reflex.cjs)', counters: counters() }); return; }
  if (reflexInFlight) { updateLoop('reflex', { status: 'busy', detail: 'drill in flight', counters: counters() }); return; }
  // שער-דלק ריבוני: האוצר צריך RC מעל 15% כדי לירות טריגר
  try {
    const rcRaw = await api.call('rc_api.find_rc_accounts', { accounts: [CONFIG.account] }).catch(() => null);
    const a = rcRaw && rcRaw.rc_accounts && rcRaw.rc_accounts[0];
    const max = Number(a && a.max_rc) || 0;
    const stored = Number(a && a.rc_manabar && a.rc_manabar.current_mana) || 0;
    const lu = Number(a && a.rc_manabar && a.rc_manabar.last_update_time) || 0;
    const cur = Math.min(max, stored + Math.floor(((Math.floor(Date.now() / 1000) - lu) * max) / (5 * 86400)));
    const pct = max ? (cur / max) * 100 : 0;
    if (pct < 15) {
      updateLoop('reflex', { status: 'skipped', detail: 'treasury RC ' + pct.toFixed(1) + '% < 15% — fuel regenerating', counters: counters() });
      return;
    }
  } catch (_) { /* RC gate best-effort */ }
  reflexInFlight = true;
  try {
    log('reflex: autonomous drill — spawning reflex.cjs --live');
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, ['reflex.cjs', '--live'], { cwd: __dirname, detached: true, stdio: ['ignore', fs.openSync(path.join(__dirname, 'reflex.log'), 'a'), fs.openSync(path.join(__dirname, 'reflex.log'), 'a')] });
    child.unref();
    updateLoop('reflex', { status: 'firing', detail: 'drill spawned — 3 rounds × ' + '10-soldier pre-signed swarm', counters: counters() });
  } catch (e) {
    updateLoop('reflex', { status: 'error', detail: String((e && e.message) || e).slice(0, 120), counters: counters() });
  } finally {
    setTimeout(() => {
      reflexInFlight = false;
      try {
        const ev = JSON.parse(fs.readFileSync(path.join(__dirname, 'reflex_evidence.json'), 'utf8'));
        if (ev.summary && ev.summary.totalResponses) {
          updateLoop('reflex', {
            status: 'ok',
            detail: 'maxLatency ' + ev.summary.maxLatencyBlocks + ' blk · ' + ev.summary.totalResponses + ' responses · ' + ev.summary.distinctSigners + ' signers · cost 0 · hive ' + (ev.summary.hiveAnchor && ev.summary.hiveAnchor.verified ? '✓@' + ev.summary.hiveAnchor.account : '…'),
            counters: { maxLatencyBlocks: ev.summary.maxLatencyBlocks, totalResponses: ev.summary.totalResponses, signers: ev.summary.distinctSigners },
          });
        }
      } catch (_) { /* evidence not ready yet */ }
    }, 90 * 1000);
  }
}

/* ------------------------------------------------------------------ *
 * לולאה 21 — gitkeeper (Task 56): ביטוח-אובדן
 * אירוע 2026-09-04: מחיקת-sandbox החזירה את המכונה ל-git ישן — רק
 * origin/main הציל את העבודה. השיעור: דחיפה היא לא סעיף-סיום, היא
 * תשתית-ריבונות. כל מחזור: spawn מנותק של gitkeeper.cjs — add →
 * שער-סודות → commit → push origin/main; הסודות לעולם לא עולים
 * (gitignore + שער-WIF על ה-staged diff). תוצאה → gitkeeper_state.json.
 * ------------------------------------------------------------------ */
let gitkeeperInFlight = false;
async function gitkeeperCycle() {
  const counters = () => {
    try {
      const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'gitkeeper_state.json'), 'utf8'));
      return {
        lastCommit: st.lastCommit,
        result: st.result,
        pushed: st.pushed === true,
        files: st.files,
        at: st.at,
      };
    } catch (_) { return {}; }
  };
  if (gitkeeperInFlight) {
    updateLoop('gitkeeper', { status: 'busy', detail: 'previous pass still running', counters: counters() });
    return;
  }
  gitkeeperInFlight = true;
  try {
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, [path.join(__dirname, 'gitkeeper.cjs')], {
      cwd: __dirname,
      detached: true,
      stdio: ['ignore', fs.openSync(path.join(__dirname, 'gitkeeper.log'), 'a'), fs.openSync(path.join(__dirname, 'gitkeeper.log'), 'a')],
    });
    child.unref();
    updateLoop('gitkeeper', { status: 'firing', detail: 'auto-save pass spawned (add → secret-gate → commit → push)', counters: counters() });
  } catch (e) {
    updateLoop('gitkeeper', { status: 'error', detail: String((e && e.message) || e).slice(0, 120), counters: counters() });
  } finally {
    setTimeout(() => {
      gitkeeperInFlight = false;
      try {
        const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'gitkeeper_state.json'), 'utf8'));
        const detail =
          st.result === 'blocked' ? 'SECRET GATE blocked commit (' + (st.blockedBy || '?') + ') — nothing pushed'
          : st.result === 'noise-only' ? 'runtime-noise only — no history entry'
          : st.result === 'clean' ? 'clean @ ' + (st.lastCommit || '?') + ' — nothing to save'
          : (st.pushed ? 'pushed ✓ ' + (st.lastCommit || '') + ' · ' + (st.files || 0) + ' files' : 'commit ' + (st.lastCommit || '') + ' kept local · push failed');
        updateLoop('gitkeeper', { status: st.result === 'blocked' ? 'error' : 'ok', detail, counters: counters() });
      } catch (_) { /* state not ready yet */ }
    }, 25 * 1000);
  }
}

/* ------------------------------------------------------------------ *
 * לולאה 24 — wrapped (Task 63): עגוני-ערך צמודים על הדקס.
 * המשאלה של המפעיל: "מטבעות צמודים על הדקס — wrapped — שנוכל לקבל ערך
 * על ההזמנות והתנגדות לגרידים שלנו". מודול עצמאי (wrapped.cjs) שרץ
 * detached בדפוס-gitkeeper: boot חד-פעמי (קניית-SBD בשוק-הפנימי →
 * סחיבת-SBD מהצי → נעילה → הנפקת WSBD-1 → ספר+בריכה+גריד · נעילת HIVE
 * ב-Hive → הנפקת PHIVE-1 · הזמנת-maker BEE על Hive-Engine) ואז beats
 * תחזוקה (לכידת-עמלות יומית, הזרמת-גיבוי, top-up PHIVE, רענון-maker).
 * הקונסולה עושה replay דטרמיניסטי: /api/ops/saos/wrapped.
 * ------------------------------------------------------------------ */
async function wrappedCycle() {
  if (cloudEconPaused()) { log('wrapped: cloud stand-down (fresh cloud_takeover) — economic pause'); return; }
  const counters = () => {
    try {
      const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'wrapped_state.json'), 'utf8'));
      return {
        booted: st.booted === true,
        opsToday: st.opsToday || 0,
        wsbd: st.assets && st.assets.WSBD ? (st.assets.WSBD.minted || 0) : 0,
        phive: st.assets && st.assets.PHIVE ? (st.assets.PHIVE.minted || 0) : 0,
        engineBee: st.engine && st.engine.beeOrder ? st.engine.beeOrder.qty : 0,
        feesCaptured: st.fees && st.fees.poolCapture ? Object.values(st.fees.poolCapture).reduce((a, b) => a + b, 0) : 0,
      };
    } catch (_) { return {}; }
  };
  if (wrappedInFlight) {
    updateLoop('wrapped', { status: 'busy', detail: 'previous pass still running', counters: counters() });
    return;
  }
  wrappedInFlight = true;
  try {
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, [path.join(__dirname, 'wrapped.cjs'), '--beat'], {
      cwd: __dirname,
      detached: true,
      stdio: ['ignore', fs.openSync(path.join(__dirname, 'wrapped.log'), 'a'), fs.openSync(path.join(__dirname, 'wrapped.log'), 'a')],
    });
    child.unref();
    updateLoop('wrapped', { status: 'firing', detail: 'wrapped beat spawned (boot→lock→mint→book/pool→Engine-maker)', counters: counters() });
  } catch (e) {
    updateLoop('wrapped', { status: 'error', detail: String((e && e.message) || e).slice(0, 120), counters: counters() });
  } finally {
    setTimeout(() => {
      wrappedInFlight = false;
      try {
        const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'wrapped_state.json'), 'utf8'));
        const w = (st.assets || {}).WSBD || {};
        const p = (st.assets || {}).PHIVE || {};
        const detail = !st.booted ? 'boot pending (no keys or dry)'
          : 'WSBD ' + (w.minted || 0) + ' (גיבוי ' + (w.lockedSbd || 0) + ' SBD) · PHIVE ' + (p.minted || 0) + ' (Hive lock ' + (p.lockedHive || 0) + ') · engine BEE ' + ((st.engine || {}).beeOrder ? (st.engine.beeOrder.qty + '@' + st.engine.beeOrder.price) : '—') + ' · fees ' + ((st.fees || {}).poolCapture ? JSON.stringify(st.fees.poolCapture) : '0');
        STATUS.wrapped = {
          booted: st.booted === true,
          mode: st.mode || null,
          wsbd: { minted: w.minted || 0, lockedSbd: w.lockedSbd || 0, fair: w.fair || null },
          phive: { minted: p.minted || 0, lockedHive: p.lockedHive || 0, fair: p.fair || null },
          engine: st.engine || {},
          fees: st.fees || {},
          opsToday: st.opsToday || 0,
          at: st.at || null,
        };
        writeStatus();
        updateLoop('wrapped', { status: st.booted ? 'ok' : 'standby', detail, counters: counters() });
      } catch (_) { /* state not ready yet */ }
    }, 60 * 1000);
  }
}

/* 65 — MICRODEX: חיילים חותמים-עצמם פעולות-דקס מיקרו על saos/v1 (fill/order/pool_swap).
 * שובר את שני החוסמים-המבניים: (1) כל-הספר היה חתום-אוצר — ריכוז-RC ותקרת-ops;
 * (2) החיילים היו בטלים (0 אירועים ב-48ש׳) למרות מכלי-RC מלאים. כל פעימה:
 * עד 3 חיילים חותמים מהמפתח-שלהם מול הספר-החי (walls ב-microdex.cjs). */
let microdexInFlight = false;
let yieldInFlight = false;
let merchantInFlight = false;
async function microdexCycle() {
  if (cloudEconPaused()) { log('microdex: cloud stand-down (fresh cloud_takeover) — economic pause'); return; }
  const counters = () => {
    try {
      const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'microdex_state.json'), 'utf8'));
      return {
        opsToday: st.opsToday || 0,
        beats: st.beats || 0,
        soldiers: Object.keys(st.bySoldier || {}).length,
        verified: (st.txids || []).filter((t) => t.verified).length,
      };
    } catch (_) { return {}; }
  };
  if (microdexInFlight) {
    updateLoop('microdex', { status: 'busy', detail: 'previous pass still running', counters: counters() });
    return;
  }
  microdexInFlight = true;
  try {
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, [path.join(__dirname, 'microdex.cjs'), '--beat', ...(CONFIG.dryRun ? [] : ['--live'])], {
      cwd: __dirname,
      detached: true,
      /* 104-fix: הסקריפט מתחבר-בעצמו-ל-microdex.log — ה-stdout לא-יותב-לאותו-קובץ (כפילות-שורות) */
      stdio: ['ignore', fs.openSync(path.join(__dirname, 'microdex-stdout.log'), 'a'), fs.openSync(path.join(__dirname, 'microdex-stdout.log'), 'a')],
    });
    child.unref();
    updateLoop('microdex', { status: 'firing', detail: 'microdex beat spawned (soldier self-signed fills/orders/pool-swaps)', counters: counters() });
  } catch (e) {
    updateLoop('microdex', { status: 'error', detail: String((e && e.message) || e).slice(0, 120), counters: counters() });
  } finally {
    setTimeout(() => {
      microdexInFlight = false;
      try {
        const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'microdex_state.json'), 'utf8'));
        const byS = Object.entries(st.bySoldier || {}).map(([k, v]) => '@' + k + ':' + v).join(' ');
        const ver = (st.txids || []).filter((t) => t.verified).length;
        updateLoop('microdex', {
          status: (st.opsToday || 0) > 0 ? 'ok' : 'standby',
          detail: 'opsToday ' + (st.opsToday || 0) + ' · beats ' + (st.beats || 0) + ' · soldiers ' + (Object.keys(st.bySoldier || {}).length) + ' · verified ' + ver + '/' + ((st.txids || []).length) + (byS ? ' · ' + byS.slice(0, 120) : ''),
          counters: counters(),
        });
        STATUS.microdex = { opsToday: st.opsToday || 0, beats: st.beats || 0, bySoldier: st.bySoldier || {}, txids: (st.txids || []).slice(-8), at: st.lastAt || null };
        writeStatus();
      } catch (_) { /* state not ready yet */ }
    }, 90 * 1000);
  }
}

/* 66 — YIELD: חלוקת-תשואה מעמלות-שנלכדו לפי תרומה-מדודה-מהשרשרת.
 * המשפט-הכלכלי: המערכת משלמת תשואה אמיתית למשתתפים עצמאיים — הוכחת-מימון-עצמי.
 * פעם ב-6 שעות (idempotent-יומי בתוך yield.cjs) · נזיל-מעל-רצפה · txids מאומתים. */
async function yieldCycle() {
  if (cloudEconPaused()) { log('yield: cloud stand-down (fresh cloud_takeover) — economic pause'); return; }
  const counters = () => {
    try {
      const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'yield_state.json'), 'utf8'));
      return { day: st.day || '', participants: Object.keys(st.paid || {}).length, totalPaid: st.totalPaid || 0, feesTotal: st.feesTotal || 0 };
    } catch (_) { return {}; }
  };
  if (yieldInFlight) {
    updateLoop('yield', { status: 'busy', detail: 'previous pass still running', counters: counters() });
    return;
  }
  yieldInFlight = true;
  try {
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, [path.join(__dirname, 'yield.cjs'), ...(CONFIG.dryRun ? [] : ['--live'])], {
      cwd: __dirname,
      detached: true,
      /* 104-fix: הסקריפט מתחבר-בעצמו-ל-yield.log — ה-stdout לא-יותב-לאותו-קובץ (כפילות-שורות) */
      stdio: ['ignore', fs.openSync(path.join(__dirname, 'yield-stdout.log'), 'a'), fs.openSync(path.join(__dirname, 'yield-stdout.log'), 'a')],
    });
    child.unref();
    updateLoop('yield', { status: 'firing', detail: 'yield distribution spawned (fee-funded, contribution-measured)', counters: counters() });
  } catch (e) {
    updateLoop('yield', { status: 'error', detail: String((e && e.message) || e).slice(0, 120), counters: counters() });
  } finally {
    setTimeout(() => {
      yieldInFlight = false;
      try {
        const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'yield_state.json'), 'utf8'));
        const paid = Object.entries(st.paid || {}).map(([k, v]) => '@' + k + ':' + (v.amt || 0)).join(' ');
        updateLoop('yield', {
          status: st.done ? 'ok' : 'standby',
          detail: 'day ' + (st.day || '—') + ' · pool ' + (st.pool || 0) + ' · totalPaid ' + (st.totalPaid || 0) + ' STEEM · ' + Object.keys(st.paid || {}).length + ' participants' + (paid ? ' · ' + paid.slice(0, 110) : ''),
          counters: counters(),
        });
        STATUS.yield = { day: st.day || null, pool: st.pool || 0, totalPaid: st.totalPaid || 0, paid: st.paid || {}, feesTotal: st.feesTotal || 0, at: st.at || null };
        writeStatus();
      } catch (_) { /* state not ready yet */ }
    }, 60 * 1000);
  }
}

/* 67 — MERCHANT: מסילת-הסוחר — האימפריה מוכרת SAOS ב-STEEM אמיתי.
 * כל-אחד-על-השרשרת: transfer+ממו saos:buy:SAOS:QTY → מסירה-אוטומטית+קבלה.
 * הכנסה-אמיתית-נמדדת-ב-STEEM נטו — שירות-עומד 24/7 בלי-מתווך. */
async function merchantCycle() {
  if (cloudEconPaused()) { log('merchant: cloud stand-down (fresh cloud_takeover) — economic pause'); return; }
  const counters = () => {
    try {
      const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'merchant_state.json'), 'utf8'));
      return { sales: (st.sales || []).length, revenue: st.revenue || 0, verified: (st.sales || []).filter((s) => s.verified).length };
    } catch (_) { return {}; }
  };
  if (merchantInFlight) {
    updateLoop('merchant', { status: 'busy', detail: 'previous pass still running', counters: counters() });
    return;
  }
  merchantInFlight = true;
  try {
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, [path.join(__dirname, 'merchant.cjs'), ...(CONFIG.dryRun ? [] : ['--live'])], {
      cwd: __dirname,
      detached: true,
      /* 104-fix: הסקריפט מתחבר-בעצמו-ל-merchant.log — ה-stdout לא-יותב-לאותו-קובץ (כפילות-שורות) */
      stdio: ['ignore', fs.openSync(path.join(__dirname, 'merchant-stdout.log'), 'a'), fs.openSync(path.join(__dirname, 'merchant-stdout.log'), 'a')],
    });
    child.unref();
    updateLoop('merchant', { status: 'firing', detail: 'merchant scan spawned (memo orders → delivery + receipt)', counters: counters() });
  } catch (e) {
    updateLoop('merchant', { status: 'error', detail: String((e && e.message) || e).slice(0, 120), counters: counters() });
  } finally {
    setTimeout(() => {
      merchantInFlight = false;
      try {
        const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'merchant_state.json'), 'utf8'));
        updateLoop('merchant', {
          status: (st.sales || []).length > 0 ? 'ok' : 'standby',
          detail: 'sales ' + (st.sales || []).length + ' · revenue ' + (st.revenue || 0) + ' STEEM · verified ' + (st.sales || []).filter((s) => s.verified).length + '/' + (st.sales || []).length + ' · beats ' + (st.beats || 0),
          counters: counters(),
        });
        STATUS.merchant = { sales: st.sales || [], revenue: st.revenue || 0, beats: st.beats || 0, at: st.at || null };
        writeStatus();
      } catch (_) { /* state not ready yet */ }
    }, 60 * 1000);
  }
}

/* ------------------------------------------------------------------ *
 * לולאה 28 — SAOS-NET (Task 68): הרשת-הריבונית שלנו.
 * צומת-detached: בלוק-heartbeat חי (מדדי-אימפריה → השרשרת-שלנו),
 * צ'קפוינט stateRoot כל 12 בלוקים → עיגון Steem (ראש→צי-fallback) +
 * Hive (ראוטר-צי) + 3 הצהרות-ולידטור-חיילים במפתחות-שלהם (quorum v0).
 * הקרקע ל"משהו גדול שהכל יושב על הרשת שלנו" — מוכן-בשלבים.
 * ------------------------------------------------------------------ */
let saosnetInFlight = false;
async function saosnetCycle() {
  const counters = () => {
    try {
      const st = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'sovereign', 'node', 'state.json'), 'utf8'));
      return { height: st.height || 0, beats: st.beats || 0, checkpoints: (st.checkpoints || []).length, verified: (st.verified || []).length };
    } catch (_) { return {}; }
  };
  if (saosnetInFlight) {
    updateLoop('saosnet', { status: 'busy', detail: 'previous beat still running', counters: counters() });
    return;
  }
  saosnetInFlight = true;
  try {
    const { spawn } = require('child_process');
    const nodeDir = path.join(__dirname, '..', 'sovereign', 'node');
    const child = spawn(process.execPath, [path.join(nodeDir, 'saosnet.cjs'), ...(CONFIG.dryRun ? [] : ['--live'])], {
      cwd: nodeDir,
      detached: true,
      /* 104-fix: saosnet log() כותב-בעצמו-ל-saosnet.log — ה-stdout לא-יותב-לאותו-קובץ (כפילות-שורות שהטעתה-אבחונים) */
      stdio: ['ignore', fs.openSync(path.join(nodeDir, 'saosnet-stdout.log'), 'a'), fs.openSync(path.join(nodeDir, 'saosnet-stdout.log'), 'a')],
    });
    child.unref();
    updateLoop('saosnet', { status: 'firing', detail: 'sovereign beat spawned (heartbeat block → checkpoint/anchor/attests)', counters: counters() });
  } catch (e) {
    updateLoop('saosnet', { status: 'error', detail: String((e && e.message) || e).slice(0, 120), counters: counters() });
  } finally {
    /* 112 — שחרור-InFlight על-סמך-המנעול-בפועל, לא-טיימר-קבוע:
     * המדידה-החיה: פעימה רצה 2-4.7 דקות (BEAT 1591 = 285ש׳) והטיימר-הישן (90ש׳)
     * שחרר-מזלף-בזמן-שהקודם-עוד-מחזיק-במנעול → פעימות-מקבילות → זנב-מפוצל
     * → dedup-last-wins אוכל בלוקים → צ'קפוינטים/חתימות/injects יתומים
     * (שלושה-ראיות עצמאיות היום: sweep-העמקה, attest-אצוות, door8-ack).
     * סריאליזציה-אמת: משחררים רק-כשהמנעול פנוי (או מת-מזמן), תקרה-קשה 7 דקות. */
    const lockFile = path.join(__dirname, '..', 'sovereign', 'node', 'beat.lock');
    const deadline = Date.now() + 7 * 60 * 1000;
    const refresh = () => {
      try {
        const st = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'sovereign', 'node', 'state.json'), 'utf8'));
        const cps = st.checkpoints || [];
        const lastCp = cps[cps.length - 1] || null;
        updateLoop('saosnet', {
          status: st.height > 0 ? 'ok' : 'standby',
          detail: 'height ' + (st.height || 0) + ' · root ' + String(st.stateRoot || '').slice(0, 10) + '… · cps ' + cps.length + (lastCp ? ' · last@' + lastCp.height + ' steem=' + String((lastCp.anchors || {}).steem || 'pending').slice(0, 10) : '') + ' · verified ' + (st.verified || []).length,
          counters: counters(),
        });
        STATUS.saosnet = { height: st.height || 0, stateRoot: st.stateRoot || null, genesisHash: st.genesisHash || null, checkpoints: cps.slice(-6), verifiedCount: (st.verified || []).length, beats: st.beats || 0, at: st.updatedAt || null };
        writeStatus();
      } catch (_) { /* state not ready yet */ }
    };
    const waitLockFree = () => {
      let free = true;
      try {
        const l = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        const ageMs = Date.now() - (l.at || 0);
        free = !l.pid || ageMs > 8 * 60 * 1000; /* TTL-בריא 10ד׳ — מעל-8ד׳ נחשב-מת */
      } catch (_) { free = true; }
      if (free || Date.now() > deadline) { saosnetInFlight = false; refresh(); return; }
      setTimeout(waitLockFree, 5000);
    };
    waitLockFree();
  }
}

/* ------------------------------------------------------------------ *
 * לולאה 23 — paymaster (Task 62): "החוזה שלנו משלם גז"
 * שני-שערים חיים:
 *   (1) RELAY — meta-tx חי הוכח ב--relay (paymaster.cjs): חתימת-לקוח →
 *       שידור-ממסר → הגז נגבה מהלקוח ונמדד (Steem: cashmachine מפתח-משלו ·
 *       Hive: ynet עוגן-מואצל). ה-evidence ב-paymaster_relay.json.
 *   (2) FUEL — כשהאוצר בריא-אנרגיה על Hive (mana ≥ שער), האצת VESTS
 *       אוטומטית ללקוח הרעב ביותר (הגז שלנו — נמדד ב-max_rc Δ).
 *       כשהאוצר חנוק (חומה-28) — מדווח כנות וממתין ל-רג'ן.
 * וגם: MEMO-INTENTS — כל ממו נכנס עם "saos:" נאסף כהזמנה (מסחר-ממו).
 * ------------------------------------------------------------------ */
const MEMO_LEDGER_PATH = path.join(__dirname, 'memo_ledger.json');
const PM_FUEL_GATE_MANA = 550 * 1000 * 1000; // 550M mana לפני שהאוצר מתדלק
let memoLedger = { intents: [], total: 0 };
try {
  const j = JSON.parse(fs.readFileSync(MEMO_LEDGER_PATH, 'utf8'));
  if (j && Array.isArray(j.intents)) memoLedger = j;
} catch (_) { /* עדיין אין פנקס-ממו */ }

function parseMemoIntent(x) {
  try {
    const m = String(x.memo || '');
    if (!m.startsWith('saos:')) return false;
    const parts = m.split(':');
    const intent = { at: x.ts || new Date().toISOString(), from: x.from, amount: x.amount, cmd: parts[1] || '?', arg: parts[2] || null, qty: parts[3] ? Number(parts[3]) : null, raw: m.slice(0, 120), priced: false };
    // תמחור-ריבוני: כל הזמנה נרשמת בפנקס (המילוי — מסחר-הממו של paymaster.cjs)
    memoLedger.intents.push(intent);
    if (memoLedger.intents.length > 400) memoLedger.intents.shift();
    memoLedger.total = (memoLedger.total || 0) + 1;
    memoLedger.updatedAt = intent.at;
    fs.writeFileSync(MEMO_LEDGER_PATH, JSON.stringify(memoLedger, null, 2) + '\n');
    log('paymaster: memo-intent @' + intent.from + ' ' + intent.cmd + ':' + (intent.arg || '') + ':' + (intent.qty || '') + ' — ledgered (' + memoLedger.total + ' total)');
    return true;
  } catch (_) { return false; }
}

let paymasterBusy = false;
async function paymasterCycle() {
  if (cloudEconPaused()) { log('paymaster: cloud stand-down (fresh cloud_takeover) — economic pause'); return; }
  if (paymasterBusy) { updateLoop('paymaster', { status: 'busy', detail: 'previous pass still running', counters: {} }); return; }
  paymasterBusy = true;
  try {
    // מדידת-אנרגיה על Hive: האוצר + הלקוחות
    const hiveCall = (method, params) => new Promise((resolve, reject) => {
      const payload = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
      const u = new URL(CONFIG.hiveRpc || 'https://api.hive.blog');
      // fix-89: family:4 (תגלית-HE ההיסטורית — AggregateError מ-IPv6-מת-בסנדבוקס)
      const req = require('https').request({ hostname: u.hostname, path: '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 20000 }, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => { try { const j = JSON.parse(d); j.error ? reject(new Error(j.error.message || 'rpc err')) : resolve(j.result); } catch (_) { reject(new Error('bad rpc')); } });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.write(payload);
      req.end();
    });
    const names = ARMY.map((a) => a.username);
    const rcRaw = await hiveCall('rc_api.find_rc_accounts', { accounts: names.concat([CONFIG.account]) });
    const rows = (rcRaw.rc_accounts || []).map((r) => ({ account: r.account, max: Number(r.max_rc), mana: Number(r.rc_manabar.current_mana) }));
    const treasury = rows.find((r) => r.account === CONFIG.account);
    const clients = rows.filter((r) => r.account !== CONFIG.account).sort((a, b) => a.mana / a.max - b.mana / b.max);
    const hungriest = clients[0];
    // fix-R18e4: rc-שורות-חסרות (חשבונות-שאינם-בהיב/תשובה-חלקית) — עמידה-בחן-במקום-קריסה
    if (!treasury || !hungriest) {
      updateLoop('paymaster', { status: 'ok', detail: 'standby — rc-נתונים-חלקיים (rows=' + rows.length + '/' + names.length + ') — מחכה-למחזור-הבא', counters: { memoIntents: memoLedger.total || 0, rcRows: rows.length } });
      return;
    }
    const counters = { treasuryManaG: +(treasury.mana / 1e9).toFixed(2), hungriest: hungriest.account, hungriestPct: +((hungriest.mana / hungriest.max) * 100).toFixed(1), memoIntents: memoLedger.total || 0 };

    if (!CONFIG.dryRun && CONFIG.activeWif && hungriest.mana / hungriest.max < 0.25 && treasury.mana >= PM_FUEL_GATE_MANA) {
      // האוצר משלם גז בפועל — האצת 3,000 VESTS ללקוח הרעב (מדוד: ~1M RC/VEST)
      const { Client, PrivateKey } = require('@hiveio/dhive');
      const hive = new Client([CONFIG.hiveRpc || 'https://api.hive.blog']);
      const [acc] = await hive.database.getAccounts([CONFIG.account]);
      const [dNum, dCur] = String(acc.delegated_vesting_shares).split(' ');
      const newDel = (parseFloat(dNum) + 3000).toFixed(6) + ' ' + dCur;
      const before = hungriest.max;
      const conf = await hive.broadcast.sendOperations([['delegate_vesting_shares', { delegator: CONFIG.account, delegatee: hungriest.account, vesting_shares: newDel }]], PrivateKey.fromString(CONFIG.activeWif));
      await new Promise((r) => setTimeout(r, 2500));
      const after = await hiveCall('rc_api.find_rc_accounts', { accounts: [hungriest.account] });
      const row = after.rc_accounts[0];
      const delta = Number(row.max_rc) - before;
      const txid = (conf && conf.id) || null;
      counters.fuelTxid = txid;
      counters.fuelDeltaG = +(delta / 1e9).toFixed(2);
      log('paymaster: FUEL @' + hungriest.account + ' +3000 VESTS → max_rc +' + (delta / 1e9).toFixed(2) + 'G · txid=' + txid);
      updateLoop('paymaster', { status: 'ok', detail: 'FUEL @' + hungriest.account + ' +' + (delta / 1e9).toFixed(2) + 'G RC (live)', counters });
      return;
    }
    const why = CONFIG.dryRun ? 'DRY_RUN'
      : !CONFIG.activeWif ? 'no ACTIVE_WIF'
      : treasury.mana < PM_FUEL_GATE_MANA ? 'treasury Hive mana ' + (treasury.mana / 1e9).toFixed(2) + 'G < gate 0.55G (wall-28 — regen window)'
      : 'clients healthy (≥25%)';
    updateLoop('paymaster', { status: 'ok', detail: 'standby — ' + why + ' · relay txids: steem e669b062/47ef2f1a/61d0d17b/343423b0 · hive 667fedf0', counters });
  } catch (e) {
    updateLoop('paymaster', { status: 'error', detail: String((e && e.message) || e).slice(0, 130), counters: {} });
  } finally {
    paymasterBusy = false;
  }
}

function schedule(fn, minutes, label) {
  const ms = Math.max(500, Math.round(minutes * 60000));
  const tick = () =>
    Promise.resolve()
      .then(fn)
      .catch((e) => log(label + ' error: ' + ((e && e.message) || e)));
  tick(); // ריצה ראשונה מיידית
  return setInterval(tick, ms);
}

// שורת-יעילות חד-פעמית: קצב לופים + תחזית RPC/שעה
function logEfficiencyLine() {
  const perHour = (min, calls) => (60 / min) * calls;
  let total = 0;
  total += perHour(CONFIG.claimMin, 2);      // dgp + get_accounts (rc משותף בקאש)
  total += perHour(CONFIG.watchMin, 2);      // feed + order book (ספר מדולג כשהפיד לא זז)
  total += perHour(CONFIG.transferWatchMin, 1); // account_history
  if (CONFIG.curationEnabled) total += perHour(30, 1 + CONFIG.curationTags.length); // accounts + סריקת תגיות
  if (CONFIG.factoryEnabled && CONFIG.activeWif) total += perHour(CONFIG.factoryMin, 1); // rc (משותף בקאש)
  if (CONFIG.dexMmEnabled) total += perHour(CONFIG.dexMmMin, 3); // dex+value+live מהקונסולה המקומית
  total += perHour(CONFIG.empireScanMin, 4); // 38 — keyscan: key_references ×2 chains + get_accounts ×2
  if (CONFIG.armyClaimEnabled && ARMY.length) total += perHour(CONFIG.armyClaimMin, 2); // dgp + get_accounts(army) משותף
  if (CONFIG.armyCurationEnabled && ARMY.length) total += perHour(CONFIG.armyCurationMin, 1 + CONFIG.curationTags.length);
  if (CONFIG.armySweepEnabled && ARMY.length) total += perHour(CONFIG.armySweepMin, 1);
  log(
    'efficiency: snapshot-cache TTL ' + CONFIG.cacheTtlSec + 's משותף לכל הלופים (get_accounts + rc_api) · ' +
    'watcher מדלג על get_order_book כשהפיד לא זז · צפי ≈ ' + Math.round(total) + ' RPC/שעה (' +
    'claim ' + CONFIG.claimMin + 'm · watch ' + CONFIG.watchMin + 'm · transfer ' + CONFIG.transferWatchMin + 'm' +
    ' · empire ' + CONFIG.empireScanMin + 'm' +
    (CONFIG.curationEnabled ? ' · curation 30m' : '') +
    (CONFIG.factoryEnabled && CONFIG.activeWif ? ' · factory ' + CONFIG.factoryMin + 'm' : '') +
    (CONFIG.dexMmEnabled ? ' · dexMm ' + CONFIG.dexMmMin + 'm (local API)' : '') + ')'
  );
}

async function runCycle(label, fn) {
  try {
    await fn();
  } catch (e) {
    log(label + ' error: ' + ((e && e.message) || e));
    try {
      updateLoop(label, { status: 'error', detail: String((e && e.message) || e).slice(0, 140) });
    } catch (_) { /* הסטטוס לא יפיל */ }
  }
}

// 93 — verify15: רענון-טסטים — מריץ את חליפת-שש-הטענות מול-החי (spawn) וקורא את-התוצאה
// בעבר: רץ ידנית-בלבד → verify15_result.json קפא (07:15) והפעימה פרסמה-תוצאות-מיושנות.
// עכשיו: לולאה-קבועה — הספר תמיד מציג טסטים טריים.
async function verify15Cycle() {
  if (verify15Busy) return;
  verify15Busy = true;
  const t0 = Date.now();
  try {
    await new Promise((resolve, reject) => {
      execFile('node', [path.join(__dirname, 'verify15.cjs')], { timeout: 5 * 60 * 1000, windowsHide: true }, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout);
      });
    });
    const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'verify15_result.json'), 'utf8'));
    const s = r.summary || {};
    updateLoop('verify15', {
      status: 'ok',
      detail: 'fresh claims ' + (s.verified || 0) + 'v+' + (s.corrected || 0) + 'c/' + (s.total || 6) + ' · checks ' + (s.checksPassed || 0) + '/' + (s.checks || 0) + ' · ' + Math.round((Date.now() - t0) / 1000) + 's',
      counters: { lastRunAt: r.at, corrections: (r.corrections || []).length },
    });
    log('verify15: refreshed — ' + (s.verified || 0) + ' verified + ' + (s.corrected || 0) + ' corrected / ' + (s.total || 6) + ' (checks ' + (s.checksPassed || 0) + '/' + (s.checks || 0) + ')');
  } catch (e) {
    updateLoop('verify15', { status: 'error', detail: String((e && e.message) || e).slice(0, 140), counters: {} });
    log('verify15 error: ' + ((e && e.message) || e));
  } finally {
    verify15Busy = false;
  }
}

// 94 — matrix: מטריצת-ההוכחות המלאה (verify_system.cjs → verify_last.json) בלולאת-דמון.
// בעבר: רץ רק-בלחיצה-ידנית → הצ'יפ בראש-הדף קפא על 146/161 בזמן-שהמציאות זזה (נמדד חי 141/161).
// עכשיו: כל 90 דק' — spawn + timeout 15 דק' (הרצה-מלאה לוקחת דקות) → updateLoop + log.
async function matrixCycle() {
  if (matrixBusy) return;
  matrixBusy = true;
  const t0 = Date.now();
  try {
    await new Promise((resolve) => {
      execFile('node', [path.join(__dirname, 'verify_system.cjs')], { timeout: 15 * 60 * 1000, windowsHide: true }, (err, stdout) => {
        // 94-לקח: לא מפילים את-המחזור על-קוד-יציאה — הראיה היא verify_last.json (מידע-מדוד, לא-סטטוס-תהליך)
        resolve(stdout);
      });
    });
    const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'verify_last.json'), 'utf8'));
    // 94-לקח: verify_system עשוי-לצאת עם-קוד-שגיאה על-אדומים-כנים — הראיה היא הקובץ, לא-קוד-היציאה
    const fresh = fs.statSync(path.join(__dirname, 'verify_last.json')).mtimeMs >= t0 - 1000;
    if (fresh) {
      updateLoop('matrix', {
        status: 'ok',
        detail: 'fresh matrix ' + r.verdict + (r.allPass ? ' · ALL-PASS' : ' · honest-reds') + ' · ' + Math.round((Date.now() - t0) / 1000) + 's',
        counters: { lastRunAt: r.at, verdict: r.verdict },
      });
      log('matrix: refreshed — ' + r.verdict + ' (' + Math.round((Date.now() - t0) / 1000) + 's)');
    } else {
      throw new Error('no fresh evidence after run');
    }
  } catch (e) {
    updateLoop('matrix', { status: 'error', detail: String((e && e.message) || e).slice(0, 140), counters: {} });
    log('matrix error: ' + ((e && e.message) || e));
  } finally {
    matrixBusy = false;
  }
}

// מצב ולידציה: מחזור אחד של כל לופ (מכבד enabled/disabled), כתיבת סטטוס, יציאה 0
async function runOnce() {
  log('once: single-cycle validation mode — one cycle of every loop, then exit');
  logEfficiencyLine();
  await refreshRc(); // הוכחת RC API + אכילת STATUS.rc
  await refreshIdentity(); // 35 — זהות דו-שרשרתית + נכסי צד-שרשרת
  await runCycle('claim', claimCycle);
  await runCycle('watcher', watchCycle);
  await runCycle('transferWatch', transferWatchCycle);
  if (CONFIG.curationEnabled) {
    await runCycle('curation', curationCycle);
  } else {
    log('curation: disabled (CURATION_ENABLED=false) — סקלטון מוכן, לא רץ');
  }
  if (CONFIG.armyClaimEnabled) await runCycle('armyClaim', armyClaimCycle);
  if (CONFIG.armyCurationEnabled) await runCycle('armyCuration', armyCurationCycle);
  if (CONFIG.armySweepEnabled) await runCycle('armySweep', armySweepCycle);
  await runCycle('worldlog', worldlogCycle); // 44 — SCI
  await runCycle('commandBus', commandBusCycle); // 44 — SCI
  if (CONFIG.factoryEnabled && CONFIG.activeWif) {
    await runCycle('factory', factoryCycle);
  } else {
    log('factory: disabled (' + (!CONFIG.factoryEnabled ? 'FACTORY_ENABLED=false' : 'needs ACTIVE_WIF') + ')');
  }
  if (CONFIG.dexMmEnabled) {
    await runCycle('dexMm', dexMmCycle);
  } else {
    log('dexMm: disabled (DEX_MM_ENABLED=false) — measuring skeleton ready, not running');
  }
  if (CONFIG.liqEnabled) {
    await runCycle('liq', liqCycle); // 47 — ניתוב-חיילים לנזילות
  }
  if (CONFIG.microdexEnabled) {
    await runCycle('microdex', microdexCycle); // 65 — מיקרו-דקס חתום-חייל
  }
  if (CONFIG.yieldEnabled) {
    await runCycle('yield', yieldCycle); // 66 — חלוקת-תשואה מעמלות-שנלכדו
  }
  if (CONFIG.merchantEnabled) {
    await runCycle('merchant', merchantCycle); // 67 — מסילת-הסוחר
  }
  if (CONFIG.saosnetEnabled) {
    await runCycle('saosnet', saosnetCycle); // 68 — הצומת-הריבוני
  }
  if (CONFIG.weaveEnabled) {
    await runCycle('weaveBatch', weaveBatchCycle); // W2 — באצ'ר-האריגה
  }
  if (CONFIG.paymasterEnabled) {
    await runCycle('paymaster', paymasterCycle); // 62 — תדלוק/ממסר/ממו
  }
  if (CONFIG.bridgeEnabled) {
    await runCycle('bridge', bridgeCycle);
  } else {
    log('bridge: disabled (BRIDGE_ENABLED=false) — dual-chain skeleton ready, not running');
  }
  writeStatus();
  log('once: done — agent-status.json v2 written, exiting 0');
}

function shutdown(signal) {
  log('shutting down (' + signal + ')');
  if (claimTimer) clearInterval(claimTimer);
  if (watchTimer) clearInterval(watchTimer);
  if (transferTimer) clearInterval(transferTimer);
  if (curationTimer) clearInterval(curationTimer);
  if (factoryTimer) clearInterval(factoryTimer);
  if (dexTimer) clearInterval(dexTimer);
  if (bridgeTimer) clearInterval(bridgeTimer);
  if (anchorTimer) clearInterval(anchorTimer);
  if (attestTimer) clearInterval(attestTimer);
  // 83-fix: רק-בעלים מוחק — ב-15:42 דימון-A שמת שחרר את-המנעול של דימון-B
  // שנכנס-אחריו (orphan-sweep drill). מנעול הוא רכוש-הכותב-שלו.
  try {
    const cur = JSON.parse(fs.readFileSync(path.join(__dirname, '.daemon.lock'), 'utf8'));
    if (cur.pid === process.pid) fs.unlinkSync(path.join(__dirname, '.daemon.lock'));
  } catch (_) { /* no lock or not ours */ }
  if (armyClaimTimer) clearInterval(armyClaimTimer);
  if (armyCurationTimer) clearInterval(armyCurationTimer);
  if (armySweepTimer) clearInterval(armySweepTimer);
  if (worldlogTimer) clearInterval(worldlogTimer);
  if (commandBusTimer) clearInterval(commandBusTimer);
  if (liqTimer) clearInterval(liqTimer);
  if (paymasterTimer) clearInterval(paymasterTimer);
  if (saosnetTimer) clearInterval(saosnetTimer);
  if (weaveTimer) clearInterval(weaveTimer);
  writeStatus();
  process.exit(0);
}

/* ------------------------------------------------------------------
 * 44 — עוגן-זהות חוצה-פרדיגמות (כל 6h): חתימת EIP-191 עם הסקלר של ACTIVE_WIF,
 * מוטמעת custom_json (סמכות active) על Steem+Hive+Blurt. המערכת מעידה על עצמה
 * על-השרשרת באופן קבוע — עדות ציבורית תמיד טרייה, מאומתת ע"י כל צד-שלישי.
 * ------------------------------------------------------------------ */
// 82 — LIVING-ATTEST: הרשת מעידה על עצמה על השרשראות החיות (Steem+Hive)
async function chainAttestCycle() {
  updateLoop('chainAttest', { status: 'running', detail: 'building chain attestation…' });
  try {
    const r = await runChainAttest({ dry: CONFIG.dryRun, quiet: true });
    const landed = Object.entries(r.txids || {}).filter(([, v]) => !!v);
    const tids = Object.fromEntries(landed.map(([k, v]) => [k, String(v).slice(0, 10) + '…']));
    updateLoop('chainAttest', {
      status: landed.length > 0 ? 'ok' : (r.dry ? 'dry' : 'error'),
      detail: (r.dry ? 'DRY — would attest h' + r.height : 'attested h' + r.height + ' · ' + landed.length + '/2 chains') + ' · ' + JSON.stringify(tids),
      counters: { height: r.height, chains: landed.length },
    });
    log('chainAttest: done — h' + r.height + ' · ' + landed.length + '/2 chains' + (r.txids && r.txids.steem ? ' · steem ' + r.txids.steem : '') + (r.txids && r.txids.hive ? ' · hive ' + r.txids.hive : ''));
  } catch (e) {
    updateLoop('chainAttest', { status: 'error', detail: String((e && e.message) || e).slice(0, 140) });
    log('chainAttest: cycle FAILED — ' + ((e && e.message) || e));
  }
}

// W2 — WEAVE BATCHER: הלולאה-השעתית של רשת-האמת — stamps → מרקל-קנוני →
// seal-request (הצומת מגיש-תחת-הנעילה, הקרנל מאמת) → עיגון Steem/Hive/Blurt
// (+TRON טרנזיטיבי דרך-הצ'קפוינט) → הוכחה-עצמאית. התוצאה: agent/weave_last.json
async function weaveBatchCycle() {
  updateLoop('weaveBatch', { status: 'running', detail: 'weave scan (replay + root + anchor)…' });
  try {
    /* R18j-ייעול: טעינה-טרייה-בכל-מחזור — require-cache מחזיק-קוד-ישן-כל-עוד-הדמון-חי
     * ותיקוני-הכלי-על-הדיסק-לא-חיים-עד-רענון-הדמון (הלקח-המאומת-מ-R18i). */
    const wbPath = require.resolve('./weave_batch.cjs');
    if (require.cache[wbPath]) delete require.cache[wbPath];
    const { runWeaveBatch } = require(wbPath);
    const r = await runWeaveBatch({ dry: CONFIG.dryRun });
    /* 117j-כנות: proof=BROKEN אינו 'ok' — הסטטוס-מתדרדר-ל-'degraded' כדי-שלוחן-הבריאות
     * לא-יציג-לולאה-שבורה-כתקינה (השיעור-מ-guardian-'harvest-alive'-ששיקר).
     * R18h: חריג-כן — חותם-שסומן 'unprovable-washed' (טווח-מתחת-לחלון-הארכיון,
     * היסטוריה-נשטפה) טופל-ביושר-והוחמץ-מרצון — אינו-ליקוי-בריאות. */
    const proofBroken = !!(r.proof && r.proof.ok === false && !(r.anchored && r.anchored.skipped === 'unprovable-washed'));
    const skipped = !!(r.anchored && r.anchored.skipped === 'unprovable-washed');
    updateLoop('weaveBatch', {
      status: proofBroken ? 'degraded' : 'ok',
      detail: 'live=' + r.liveStamps + ' · total=' + r.totalStamps +
        (r.request ? ' · seal-request(' + r.request.count + ')' + (r.request.written ? ' WRITTEN' : ' pending') : '') +
        (r.anchored ? ' · anchored seq=' + r.anchored.seq + ' (' + r.anchored.chains + '/3 chains)' + (skipped ? ' SKIPPED-unprovable' : '') : '') +
        (r.proof ? ' · proof=' + (r.proof.ok ? 'OK' : (skipped ? 'SKIPPED(honest)' : 'BROKEN')) : ''),
      counters: { liveStamps: r.liveStamps, totalStamps: r.totalStamps, sealSeq: r.anchored ? r.anchored.seq : undefined, chains: r.anchored ? r.anchored.chains : undefined },
    });
    log('weaveBatch: ' + (r.notes || []).join(' · '));
  } catch (e) {
    updateLoop('weaveBatch', { status: 'error', detail: String((e && e.message) || e).slice(0, 140) });
    log('weaveBatch: FAILED — ' + ((e && e.message) || e));
  }
}

async function anchorCycle() {
  updateLoop('anchor', { status: 'running', detail: 'building cross-paradigm anchor…' });
  try {
    const r = await runAnchor({ dry: CONFIG.dryRun });
    const landed = Object.values(r.txids || {}).filter(Boolean);
    updateLoop('anchor', {
      status: landed.length > 0 ? 'ok' : (r.dry ? 'dry' : 'error'),
      detail: (r.dry ? 'DRY — would anchor steem+hive+blurt' :
        landed.length > 0 ? `anchored ${landed.length}/3 chains · steem=${String(r.txids.steem || '—').slice(0, 10)}… hive=${String(r.txids.hive || '—').slice(0, 10)}… blurt=${String(r.txids.blurt || '—').slice(0, 10)}…` : 'no chain confirmed the anchor'),
      counters: { chains: landed.length, anchorsTotal: r.anchorsTotal || undefined },
    });
    log('anchor: cycle done — ' + landed.length + '/3 chains' + (r.txids && r.txids.steem ? ' · steem txid ' + r.txids.steem : ''));
  } catch (e) {
    updateLoop('anchor', { status: 'error', detail: String((e && e.message) || e).slice(0, 140) });
    log('anchor: cycle FAILED — ' + ((e && e.message) || e));
  }
}

// 83 — CLOUD STAND-DOWN: כשענן-הלב (GitHub Actions, L6) נטל-פיקוד, הוא כותב
// cloud_takeover.json ומעלה-אותו ל-origin. כל-רץ (סנדבוקס שהתעורר, דימון חי)
// שרואה-אותו טרי (< CLOUD_ECON_PAUSE_MIN) משהה-זמנית את-הלולאות-הכלכליות —
// אסור ששני-רצים יירו פעולות-כסף כפולות בזמן היפוך-פיקוד. טענות/קוראציה
// מוגנות ממילא במכסות-יומיות; watch לקריאה-בלבד.
function cloudEconPaused() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'cloud_takeover.json'), 'utf8'));
    const ageMin = (Date.now() - new Date(j.at).getTime()) / 60000;
    return Number.isFinite(ageMin) && ageMin < Number(process.env.CLOUD_ECON_PAUSE_MIN || 50);
  } catch (_) { return false; }
}

// 83 — ORPHAN SWEEP: ב-2026-09-05 14:52/14:53 נצפו שני-דמונים חיים (boot-race:
// דמון-ישן מקוד-טרום-מנעול + דמון-מתווסף). המנעול לבד לא מספיק כשהראשון לא
// כתב-מנעול כלל. אחרי-רכישת-המנעול: סריקת /proc וסיום כל agent.cjs זר
// (--once לעולם לא נפגע — מצב-ולידציה חד-פעמי).
function sweepOrphanDaemons() {
  const me = process.pid;
  const killed = [];
  try {
    for (const d of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      const pid = Number(d);
      if (pid === me) continue;
      let cmd = '';
      try { cmd = fs.readFileSync('/proc/' + d + '/cmdline', 'utf8').replace(/\0/g, ' '); } catch (_) { continue; }
      if (!cmd.includes('agent.cjs')) continue;
      if (cmd.includes('--once')) continue; // מצב-ולידציה — אף-פעם
      try { process.kill(pid, 'SIGTERM'); killed.push(pid); } catch (_) { /* כבר-מת */ }
    }
  } catch (_) { return; }
  if (killed.length) {
    log('singleton: orphan-sweep terminated ' + killed.length + ' foreign agent.cjs pid(s) [' + killed.join(',') + '] — single-daemon law enforced');
    setTimeout(() => { for (const p of killed) { try { process.kill(p, 'SIGKILL'); } catch (_) {} } }, 3000);
  }
}

function main() {
  // 82 — SINGLETON LOCK: guardian/ שרת-הפיתוח/המפעיל יכולים להריץ daemon נוסף בטעות —
  // דימון כפול = פעימות כפולות ושידורים כפולים. מנעול-בעלות אחד (pid חי <24h) שולט.
  if (!ONCE) {
    const lockPath = path.join(__dirname, '.daemon.lock');
    try {
      const prev = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      const ageH = (Date.now() - (prev.at || 0)) / 3600000;
      if (prev.pid && prev.pid !== process.pid && ageH < 24) {
        try { process.kill(prev.pid, 0); console.error('[singleton] daemon already alive (pid ' + prev.pid + ') — exiting'); process.exit(0); } catch (_) { /* stale — proceed */ }
      }
    } catch (_) { /* no lock */ }
    try { fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: Date.now(), started: new Date().toISOString() })); } catch (_) { /* best effort */ }
    // 107 (אימוץ-W19 של-הסוכן-השני) — self-pid: הדמון כותב את קובץ-ה-pid הציבורי
    // בעצמו בכל אתחול — עד-היום אף-גורם לא כתב אותו והוא נשאר מיושן לנצח
    // (אצל-הסוכן-השני נתפס: 13734 בקובץ מול-האמיתי 1646). המקור-הראשון = התהליך-עצמו.
    try { fs.writeFileSync(path.join(__dirname, 'agent_daemon.pid'), String(process.pid) + '\n'); } catch (_) { /* best effort */ }
    sweepOrphanDaemons();
  }
  // ולידציה בעת הפעלה
  if (!CONFIG.account) {
    console.error('[FATAL] AGENT_ACCOUNT חסר — הגדירו AGENT_ACCOUNT ב-.env (או ב-env) והפעילו מחדש');
    process.exit(1);
  }
  if (!CONFIG.postingWif) {
    log('claims: POSTING_WIF לא הוגדר — לופ התביעה בניטור-בלבד (pendingClaims/tickets עדיין נמדדים)');
    if (!CONFIG.dryRun) {
      log('WARNING: DRY_RUN=false ואין POSTING_WIF — תביעות אוטומטיות כבויות!');
    }
  } else if (!steem.auth.isWif(CONFIG.postingWif)) {
    // לא מדפיסים את המפתח — רק אבחון גנרי
    log('FATAL: POSTING_WIF שהוגדר אינו WIF תקין (שגיאת העתקה?) — הסוכן לא יעלה. בדקו את .env');
    process.exit(1);
  }
  if (CONFIG.activeWif) {
    if (!steem.auth.isWif(CONFIG.activeWif)) {
      log('FATAL: ACTIVE_WIF שהוגדר אינו WIF תקין — הסוכן לא יעלה. בדקו את .env');
      process.exit(1);
    }
    // v2: המפתח הפעיל משמש אך ורק את לופ מפעל-החשבונות (claim_account) ורק כשהמפעל מופעל
    log(
      'WARNING: ACTIVE_WIF הוגדר ב-.env — מפתח active במכונה מחוברת הוא סיכון גבוה ' +
      '(גניבה = שליטה מלאה בחשבון). ב-v2 הוא משמש רק את לופ המפעל (claim_account) ' +
      (CONFIG.factoryEnabled ? 'והמפעל מופעל (FACTORY_ENABLED=true).' : 'והמפעל כבוי — המפתח לא בשימוש כלל.')
    );
  }
  if (CONFIG.factoryEnabled && !CONFIG.activeWif) {
    log('factory: FACTORY_ENABLED=true but no ACTIVE_WIF — factory disabled (claim_account requires active authority)');
  }

  steem.api.setOptions({ url: CONFIG.rpcUrl });

  log('SAOS agent v' + VERSION + ' starting · account=@' + CONFIG.account +
    ' · rpc=' + CONFIG.rpcUrl +
    ' · DRY_RUN=' + CONFIG.dryRun +
    ' · mode=' + (ONCE ? 'once' : 'daemon') +
    ' · claim_every=' + CONFIG.claimMin + 'm' +
    ' · watch_every=' + CONFIG.watchMin + 'm' +
    ' · transfer_every=' + CONFIG.transferWatchMin + 'm' +
    ' · min_claim_sp=' + CONFIG.minClaimSp +
    ' · posting_wif=' + (CONFIG.postingWif ? 'set' : 'unset') +
    ' · active_wif=' + (CONFIG.activeWif ? 'set' : 'unset') +
    ' · factory=' + (CONFIG.factoryEnabled ? 'on' : 'off') +
    ' · dexMm=' + (CONFIG.dexMmEnabled ? 'on' : 'off') +
    ' · bridge=' + (CONFIG.bridgeEnabled ? 'on' : 'off') +
    ' · curation=' + (CONFIG.curationEnabled ? 'on' : 'off') +
    ' · army=' + ARMY.length +
    ' · cache_ttl=' + CONFIG.cacheTtlSec + 's');
  log('חוק ברזל: המפתחות נשארים במכונה הזו — החתימה מקומית, שידור ישר ל-RPC. לא נשלח WIF לשרת כלשהו.');

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // עמידות-דימון: שגיאה גלובלית → לוג והמשך (הלופים תופסים בעצמם את השגיאות שלהם)
  process.on('uncaughtException', (e) =>
    log('uncaughtException: ' + ((e && e.message) || e) + ' (daemon continues)')
  );
  process.on('unhandledRejection', (e) =>
    log('unhandledRejection: ' + ((e && (e.message || e)) || e) + ' (daemon continues)')
  );

  if (ONCE) {
    runOnce()
      .then(() => process.exit(0))
      .catch((e) => {
        log('once: FATAL ' + ((e && e.message) || e));
        process.exit(1);
      });
    return;
  }

  // דימון — תזמון לופים
  (async () => {
    await refreshRc(); // הוכחת RC API + סטטוס rc מיידי (נכתב גם כשהלופים כבויים)
    await refreshIdentity(); // 35 — זהות דו-שרשרתית + נכסי צד-שרשרת (פעם בהפעלה)
    STATUS.factory.agents = listMintedAgents(); // 38 — סוכנים שנולדו (מתוך agent/keys/)
    logEfficiencyLine();
    claimTimer = schedule(claimCycle, CONFIG.claimMin, 'claim'); // רץ תמיד — ניטור מאכיל את הסטטוס
    watchTimer = schedule(watchCycle, CONFIG.watchMin, 'watch');
    transferTimer = schedule(transferWatchCycle, CONFIG.transferWatchMin, 'transfer-watch');
    empireTimer = schedule(empireScanCycle, CONFIG.empireScanMin, 'empire'); // 38 — קריאה-בלבד, תמיד רץ
    log('empire: ENABLED (every ' + CONFIG.empireScanMin + 'm · dual-chain key-references · auto-onboard ≤' + CONFIG.empireScanMin + 'm after operator connects a key)');
    // 43 — הצבא הכלכלי: תמיד מתוזמנים (כשהצבא ריק — idle מהיר שמדריך את המפעיל)
    if (CONFIG.armyClaimEnabled) {
      armyClaimTimer = schedule(armyClaimCycle, CONFIG.armyClaimMin, 'army-claim');
      log('army-claim: ENABLED (every ' + CONFIG.armyClaimMin + 'm · army=' + ARMY.length + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE per-account posting keys') + ')');
    }
    if (CONFIG.armyCurationEnabled) {
      armyCurationTimer = schedule(armyCurationCycle, CONFIG.armyCurationMin, 'army-curation');
      log('army-curation: ENABLED (every ' + CONFIG.armyCurationMin + 'm · max ' + CONFIG.armyCurationMaxVotesDay + '/day/account · min_vp=' + CONFIG.armyCurationMinVpPct + '% · shard=round-robin · army=' + ARMY.length + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE per-account posting keys') + ')');
    }
    if (CONFIG.armySweepEnabled) {
      armySweepTimer = schedule(armySweepCycle, CONFIG.armySweepMin, 'army-sweep');
      log('army-sweep: ENABLED (every ' + CONFIG.armySweepMin + 'm · threshold ' + CONFIG.armySweepMinSteem + ' STEEM · max ' + CONFIG.armySweepMaxDay + '/day → @' + CONFIG.account + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE per-account active keys') + ')');
    }
    // 48 — פעימת-צי: קצב-עסקאות ריבוני (fleet_ping חתום-חייל + fee-routing לבריכה)
    fleetTimer = schedule(fleetPaceCycle, CONFIG.fleetPaceMin, 'fleetPace');
    log('fleetPace: ENABLED (every ' + CONFIG.fleetPaceMin + 'm · 1 חייל לפעימה · fleet_ping + pool_swap fee-routing' + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE per-account posting keys') + ')');
    // 44 — SCI: יומן-עולם חתום-האש דו-שרשרתי + ערוץ-פקודה מוצפן
    worldlogTimer = schedule(worldlogCycle, CONFIG.worldlogMin, 'worldlog');
    log('worldlog: ENABLED (every ' + CONFIG.worldlogMin + 'm · hash-chained saos/v1 wlog → Steem+Hive' + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE') + ')');
    commandBusTimer = schedule(commandBusCycle, CONFIG.commandBusMin, 'commandBus');
    log('commandBus: ENABLED (every ' + CONFIG.commandBusMin + 'm · encrypted memo commands → decode → saos_ack' + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE') + ')');
    // 45 — SAOS-Net mission queue: תור-משימות ציבורי
    netTaskTimer = schedule(netTaskCycle, CONFIG.netTaskMin, 'netTask');
    log('netTask: ENABLED (every ' + CONFIG.netTaskMin + 'm · saos_task → assign → encrypted command → saos_result' + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE') + ')');
    // 46 — מדרגת-הג׳נזיס + משכורות
    if (CONFIG.genesisEnabled) {
      genesisTimer = schedule(ladderCycle, CONFIG.genesisMin, 'genesis');
      log('genesis: ENABLED (every ' + CONFIG.genesisMin + 'm · ladder→BEE→SAOS · max-spend ' + CONFIG.genesisMaxSpend + ' HIVE/run · conforms when RC≥3.2B' + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE') + ')');
    }
    // 74 — נתיב-הצי: ה-RC של הראש לא יעצור את הזרימה (ניתוב-דרך-חייל)
    fleetSellTimer = schedule(fleetSellCycle, 20, 'fleetSell');
    // 103 — הבראת-RC אוטונומית: הקצאת-HP מדודה כשהראש מתאושש (השער-בפנים)
    healRcTimer = schedule(healRcCycle, 60, 'hiveRcHeal');
    // 103 — עיגון-מתמשך: הבריכות-נשארות-מעוגנות-לאורקל-גם-בזמן-מסחר-חי
    reanchorTimer = schedule(reanchorCycle, 60, 'reanchor');
    // 106 — אורקל-חי: הציטוטים-על-הספר-מתעדכנים-מדי-שעה (העוגן-נשאר-חי)
    oracleTimer = schedule(oracleCycle, 60, 'oracle');
    log('fleetSell: ENABLED (every 20m · probe-resume + RC-drought routing via soldier keys' + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE') + ')');
    if (CONFIG.payrollEnabled) log('payroll: ENABLED (' + CONFIG.payrollPerTask + ' STEEM per verified mission · cap ' + CONFIG.payrollDailyCap + '/day)');
    if (CONFIG.curationEnabled) {
      curationTimer = schedule(curationCycle, 30, 'curation');
      log('curation: ENABLED (tags=' + CONFIG.curationTags.join(',') + ', max=' + CONFIG.curationMaxVotesDay + '/day, min_vp=' + CONFIG.curationMinVpPct + '%, weight=' + CONFIG.curationVoteWeightPct + '%, seen-file=' + seenArr.length + (CONFIG.dryRun ? ', DRY_RUN' : ', LIVE POSTING-KEY') + ')');
    } else {
      log('curation: disabled (CURATION_ENABLED=false) — סקלטון מוכן, לא רץ');
    }
    if (CONFIG.factoryEnabled) {
      if (CONFIG.activeWif) {
        factoryTimer = schedule(factoryCycle, CONFIG.factoryMin, 'factory');
        log('factory: ENABLED (every ' + CONFIG.factoryMin + 'm · max ' + CONFIG.factoryMaxDay + '/day · trigger RC≥' + CONFIG.factoryRcTriggerPct + '% · floor RC>' + CONFIG.factoryRcFloorPct + '%' + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE ACTIVE-KEY') + ')');
      } else {
        log('factory: disabled — FACTORY_ENABLED=true but no ACTIVE_WIF (claim_account requires active authority)');
      }
    } else {
      log('factory: disabled (FACTORY_ENABLED=false)' + (CONFIG.activeWif ? '' : ' · needs Active WIF when enabled'));
    }
    if (CONFIG.dexMmEnabled) {
      dexTimer = schedule(dexMmCycle, CONFIG.dexMmMin, 'dexMm');
      log('dexMm: ENABLED (every ' + CONFIG.dexMmMin + 'm · cap ' + CONFIG.dexMmDailyCap + ' broadcasts/day · grid ' + CONFIG.dexGridLevels + '×' + CONFIG.dexGridStepPct + '% @fair · pool seed ' + CONFIG.dexPoolSeedSaos + ' SAOS+' + CONFIG.dexPoolSeedSteem + ' STEEM · arb dev≥' + CONFIG.dexArbDevPct + '%' + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE POSTING-KEY') + ')');
    } else {
      log('dexMm: disabled (DEX_MM_ENABLED=false) — console APIs still serve the book');
    }
    // 47 — ממלכת-הנזילות: ניתוב-חיילים escrow→SAOS→LP
    if (CONFIG.liqEnabled) {
      liqTimer = schedule(liqCycle, CONFIG.liqMin, 'liq');
      log('liq: ENABLED (every ' + CONFIG.liqMin + 'm · soldier escrow→credit→SAOS→LP · ' + CONFIG.liqEscrowPerSoldier + ' STEEM/soldier cap ' + CONFIG.liqEscrowDayCap + '/day · army=' + ARMY.length + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE per-account active keys') + ')');
    }
    if (CONFIG.bridgeEnabled) {
      bridgeTimer = schedule(bridgeCycle, CONFIG.bridgeMin, 'bridge');
      log('bridge: ENABLED (every ' + CONFIG.bridgeMin + 'm · cap ' + CONFIG.bridgeCapPerBeat + ' anchors/beat · checkpoint every ' + CONFIG.bridgeCheckpointH + 'h → Hive via fleet-router (53) ' + CONFIG.hiveRpc + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE POSTING-KEY') + ')');
    } else {
      log('bridge: disabled (BRIDGE_ENABLED=false) — dual-chain skeleton ready, not running');
    }
    // 53 — נעילת-ערך: ערך מהתזוזות → בריכה → נעילה-קבועה
    valueLockTimer = schedule(valueLockCycle, CONFIG.valueLockMin, 'valueLock');
    log('valueLock: ENABLED (every ' + CONFIG.valueLockMin + 'm · 25% treasury liquid SAOS (cap 3) → pool_add → pool_lock 100% · manifest → Hive via fleet' + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE') + ')');
    // 54 — רפלקס-בלוק: תרגיל-צי אוטונומי — תגובות בבלוק באפס-אנרגיה-נזילה
    reflexTimer = schedule(reflexCycle, CONFIG.reflexMin, 'reflex');
    log('reflex: ENABLED (every ' + CONFIG.reflexMin + 'm · treasury trigger → 10-soldier pre-signed swarm in block N+1 · digest → Hive via fleet router' + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE') + ')');
    // 56 — gitkeeper: ביטוח-אובדן — המכונה עצמה דואגת שהעבודה תמיד ב-origin
    if (CONFIG.gitkeeperEnabled) {
      gitkeeperTimer = schedule(gitkeeperCycle, CONFIG.gitkeeperMin, 'gitkeeper');
      log('gitkeeper: ENABLED (every ' + CONFIG.gitkeeperMin + 'm · add → secret-gate → commit → push origin/main · secrets never leave this machine)');
    } else {
      log('gitkeeper: disabled (GITKEEPER_ENABLED=false)');
    }
    // 50 — ריבונות-RC בצד-Hive: מכונת SWAP.HIVE→HP אוטונומית
    hivePowerTimer = schedule(hivePowerCycle, CONFIG.hivePowerMin, 'hivePower');
    log('hivePower: ENABLED (every ' + CONFIG.hivePowerMin + 'm · SWAP.HIVE→withdraw→HIVE→powerup→HP · RC-gate 1.2G · variant-learning' + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE ACTIVE-KEY') + ')');
    // 62 — paymaster: relay+fuel+memo-intents + xnet communication map
    if (CONFIG.paymasterEnabled) {
      paymasterTimer = schedule(paymasterCycle, CONFIG.paymasterMin, 'paymaster');
      log('paymaster: ENABLED (every ' + CONFIG.paymasterMin + 'm · fuel-gate 0.55G Hive-mana · memo-intents → ledger · relay evidence paymaster_relay.json' + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE ACTIVE-KEY') + ')');
    } else {
      log('paymaster: disabled (PAYMASTER_ENABLED=false)');
    }
    // 63 — wrapped: עגוני-ערך על הדקס + maker על Hive-Engine
    if (CONFIG.wrappedEnabled) {
      wrappedTimer = schedule(wrappedCycle, CONFIG.wrappedMin, 'wrapped');
      log('wrapped: ENABLED (every ' + CONFIG.wrappedMin + 'm · boot: SBD-buy→fleet-sweep→lock→mint WSBD-1 + Hive-lock→PHIVE-1 · Engine BEE maker · fee capture 30bps' + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE') + ')');
    } else {
      log('wrapped: disabled (WRAPPED_ENABLED=false)');
    }
    // 65 — microdex: חיילים חותמים-עצמם פעולות-דקס מיקרו
    if (CONFIG.microdexEnabled) {
      microdexTimer = schedule(microdexCycle, CONFIG.microdexMin, 'microdex');
      log('microdex: ENABLED (every ' + CONFIG.microdexMin + 'm · soldiers self-sign fill/order/pool_swap on saos/v1 · walls 5/beat · 10/soldier/day · RC-gate 40%' + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE SOLDIER-KEYS') + ')');
    } else {
      log('microdex: disabled (MICRODEX_ENABLED=false)');
    }
    // 66 — yield: חלוקת-תשואה מעמלות-שנלכדו (הוכחת-מימון-עצמי)
    if (CONFIG.yieldEnabled) {
      yieldTimer = schedule(yieldCycle, CONFIG.yieldMin, 'yield');
      log('yield: ENABLED (every ' + CONFIG.yieldMin + 'm · fee-funded contribution-measured distribution · pool cap 0.008 STEEM' + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE') + ')');
    } else {
      log('yield: disabled (YIELD_ENABLED=false)');
    }
    // 67 — merchant: מסילת-הסוחר (מכירת-SAOS ב-STEEM אמיתי)
    if (CONFIG.merchantEnabled) {
      merchantTimer = schedule(merchantCycle, CONFIG.merchantMin, 'merchant');
      log('merchant: ENABLED (every ' + CONFIG.merchantMin + 'm · memo saos:buy:SAOS:QTY → delivery+receipt · walls 3/beat · cap 0.2' + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE') + ')');
    } else {
      log('merchant: disabled (MERCHANT_ENABLED=false)');
    }
    // 68 — saosnet: הרשת-הריבונית שלנו (בלוקים + צ'קפוינטים מעוגנים)
    if (CONFIG.saosnetEnabled) {
      saosnetTimer = schedule(saosnetCycle, CONFIG.saosnetMin, 'saosnet');
      log('saosnet: ENABLED (every ' + CONFIG.saosnetMin + 'm · sovereign beat: heartbeat-block → checkpoint/anchor/attests every 12 · genesis-derived chain' + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE') + ')');
    } else {
      log('saosnet: disabled (SAOSNET_ENABLED=false)');
    }
    // W2 — weaveBatch: באצ'ר-האריגה השעתי (רשת-האמת — THE WEAVE)
    if (CONFIG.weaveEnabled) {
      weaveTimer = schedule(weaveBatchCycle, CONFIG.weaveMin, 'weaveBatch');
      log('weaveBatch: ENABLED (every ' + CONFIG.weaveMin + 'm · stamps → merkle-root → seal via node beat → anchor Steem/Hive/Blurt + TRON-checkpoint · id=saos.weave.v1' + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE') + ')');
    } else {
      log('weaveBatch: disabled (WEAVE_ENABLED=false)');
    }
    // 82 — guardian: ALWAYS-UP (anti-rollback ל-origin/main · self-heal deps/env/daemon · fleet zero-touch restore מה-seal)
    if (CONFIG.guardianEnabled) {
      guardianTimer = schedule(guardianCycle, CONFIG.guardianMin, 'guardian');
      log('guardian: ENABLED (every ' + CONFIG.guardianMin + 'm · anti-rollback + self-heal + fleet-restore · 82)');
    } else {
      log('guardian: disabled (GUARDIAN_ENABLED=false)');
    }
    // 85 — heReport: דוח-הריבונות בעברית — נכתב כל 30 דק׳ ונדחף על-ידי gitkeeper
    if (CONFIG.heReportEnabled) {
      heReportTimer = schedule(heReportCycle, CONFIG.heReportMin, 'heReport');
      log('heReport: ENABLED (every ' + CONFIG.heReportMin + 'm · דוח-עברי-חי docs/REPORT_HE.md → gitkeeper pushes it · 85)');
    } else {
      log('heReport: disabled (HE_REPORT_ENABLED=false)');
    }
    // 87 — L9 אחדות-הצי: קישוריות-חיילים→ראש + תיקון-עצמי חתום + RC-דיסציפלינה
    if (CONFIG.linkageEnabled) {
      linkageTimer = schedule(linkageCycle, CONFIG.linkageMin, 'linkage');
      log('linkage: ENABLED (every ' + CONFIG.linkageMin + 'm · posting.account_auths ∋ @' + CONFIG.account + ' ×steem+hive · auto-fix signed by each soldier\'s own active key · zero key deletion · 87)');
    } else {
      log('linkage: disabled (LINKAGE_ENABLED=false)');
    }
    // 44 — עוגן-זהות חוצה-פרדיגמות: דורש מפתח active
    if (CONFIG.anchorEnabled) {
      if (CONFIG.activeWif) {
        anchorTimer = schedule(anchorCycle, CONFIG.anchorMin, 'anchor');
        log('anchor: ENABLED (every ' + CONFIG.anchorMin + 'm · EIP-191 sig on steem+hive+blurt · id=saos.id.v1' + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE ACTIVE-KEY') + ')');
      } else {
        log('anchor: disabled — no ACTIVE_WIF (cross-paradigm anchor requires active authority)');
      }
    } else {
      log('anchor: disabled (ANCHOR_ENABLED=false)');
    }
    // 93 — verify15: רענון-טסטים — שש-הטענות נבדקות-מחדש מול-החי; הפעימה מפרסמת-תוצאות-טריות
    if (CONFIG.verify15Enabled) {
      verify15Timer = schedule(verify15Cycle, CONFIG.verify15Min, 'verify15');
      log('verify15: ENABLED (every ' + CONFIG.verify15Min + 'm · spawn agent/verify15.cjs → fresh 6-claims → beat publishes · 93)');
    } else {
      log('verify15: disabled (VERIFY15_ENABLED=false) — result file may go stale');
    }
    // 94 — matrix: מטריצת-ההוכחות המלאה בלולאה — הצ'יפ בראש-הדף תמיד-טרי
    if (CONFIG.matrixEnabled) {
      matrixTimer = schedule(matrixCycle, CONFIG.matrixMin, 'matrix');
      log('matrix: ENABLED (every ' + CONFIG.matrixMin + 'm · spawn agent/verify_system.cjs → fresh 161-proofs → top chip never frozen · 94)');
    } else {
      log('matrix: disabled (MATRIX_ENABLED=false) — top chip may go stale');
    }
    // 82 — LIVING-ATTEST: פעימת-העיד — height+stateRoot+commit כעדות-חיה על Steem+Hive
    if (CONFIG.chainAttestEnabled) {
      if (CONFIG.activeWif) {
        attestTimer = schedule(chainAttestCycle, CONFIG.chainAttestMin, 'chainAttest');
        log('chainAttest: ENABLED (every ' + CONFIG.chainAttestMin + 'm · id=saos.attest.v1 · height+stateRoot+commit → Steem+Hive' + (CONFIG.dryRun ? ' · DRY_RUN' : ' · LIVE ACTIVE-KEY') + ')');
      } else {
        log('chainAttest: disabled — no ACTIVE_WIF (attestation requires active authority)');
      }
    } else {
      log('chainAttest: disabled (CHAIN_ATTEST_ENABLED=false)');
    }
    writeStatus();
  })();
}

main();
