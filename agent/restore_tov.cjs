#!/usr/bin/env node
/**
 * 117p8 — restore_tov.cjs — השבת @tov למפתחות-המאסטר (Vault-v2) דרך recover_account
 * ═══════════════════════════════════════════════════════════════════════════════════
 * העובדות (נמדדו-חי):
 *  · מאסטר-המפעיל גוזר 4/4 את מפתחות-הכספת של tov (mode=master-derive, 2026-09-05).
 *  · היסטוריית-בעלות-חיה: הבעלים-בשרשרת עד 2026-09-08 21:34 היה מפתח-הכספת (STM8FFj1o…)
 *    — אז הוחלף-ע"י-הרוטציה-המורדת (אותה-יד: ראש 21:17 · tov 21:34).
 *  · חוק-השרשרת: recover_account אפשרי עם מפתח-בעלות-שהיה-תקף-ב-60-הימים-האחרונים
 *    — יש לנו את ה-WIF בכספת. חלון-ההתאוששות חי!
 *
 * מהלך:
 *  A. recover_account (שתי-השרשראות): בעלות-חדשה=בעלות-אחרונה=מפתח-הכספת (owner).
 *     חתימה: WIF-הבעלות-מהכספת (מספק-את-שתי-הסמכויות — new+recent).
 *  B. account_update2: active/posting/memo → מפתחות-כספת + headcorner-in-posting
 *     (טופולוגיית-צי) · owner-לא-נוגעים · json_metadata-נשמר.
 *  C. אימות-חי 8/8 מול שתי-השרשראות → vault-sync → דוח-עדות (txids · מוסתר).
 *
 * Task 11-c (2026-10-01) — הנחיית-הבעלים "אין לי עוד מפתחות":
 *   · tov-hive = BLOCKED-NO-KEY — מפתחות-אבודו, מוחזקים-אצל-הבעלים, הבעלים אישר
 *     2026-10-01 שאין-עוד-מפתחות — אפס-שימוש-כלכלי. הכלי-הזה יכול לפעול על-Hive
 *     רק-אם-הבעלים ישיב-את-החומר-השולט-לכספת.
 *   · סירוב-סגור-כשל (fail-closed) על-חומר-ממוסמך: ההיבטים-של-Hive מסורבים --live
 *     אלא-אם agent/fleet_control_audit.json (האמת-הנגזרת-החיה) מראה
 *     chains.hive.tov.vault.owner=true — כלומר הכספת אכן מחזיקה חומר ששולט
 *     בבעלות-החיה-על-השרשרת. אין-קביעה-מקודדת-שקרית: אם-הבעלים ישיב-מפתח
 *     והאודיט-ייבדק-מחדש — השער-ייפתח מעצמו. צד-Steem לא-השתנה (הכספת שולטת
 *     שם — נמדד 2026-09-30: steem 4/4 בכספת).
 *
 * שימוש: node agent/restore_tov.cjs [--dry] [--live]   (ברירת-מחדל: dry)
 * אף-סוד לא נדפס — WIF/מאסטר נשארים בכספת-בלבד.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const steem = require('steem');

const DRY_PRE = !process.argv.includes('--live');
const ACCOUNT = 'tov';
const STEEM_RPC = 'https://api.steemit.com';
const HIVE_RPC = 'https://api.hive.blog';
const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
const HEAD = 'headcorner';

const log = (m) => console.log('[' + new Date().toISOString() + '] ' + m);
const mask = (p) => (p ? String(p).slice(0, 10) + '…' : '∅');

// 10-d-3 (2026-09-30) — LIVE-GATE before ANY key loading (owner-authority mutation — highest priority):
// broadcast needs --live (or HE_LIVE=1) AND HE_LIVE_CONFIRM=tov. Dry stays runnable, fail-closed default.
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT });
const DRY = GATE.dry || DRY_PRE;
announceGate(GATE, log);
if (GATE.dry) log('[restore_tov] gate dry — recover/account_update will NOT broadcast (arm: --live + HE_LIVE_CONFIRM=' + ACCOUNT + ')');

// Task 11-c (2026-10-01) — owner directive "אין לי עוד מפתחות": tov-hive status + fail-closed material gate.
// Resolved-material check (NOT a hard-coded claim): the live generated truth in fleet_control_audit.json
// must show chains.hive.tov.vault.owner=true before any Hive-side --live aspect may arm.
const HIVE_BLOCK_REASON = 'BLOCKED-NO-KEY: keys lost — owner-held; owner confirmed 2026-10-01 no more keys exist; NO economic use';
const HIVE_UNBLOCK_PATH = 'only if the owner restores controlling material into the vault AND agent/fleet-control-audit.cjs is re-run showing chains.hive.tov.vault.owner=true (resolved material presence, fail-closed)';
function hiveMaterialResolved() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'fleet_control_audit.json'), 'utf8'));
    const row = j.chains && j.chains.hive && j.chains.hive[ACCOUNT];
    return !!(row && row.exists && row.vault && row.vault.owner === true);
  } catch (_) { return false; } // audit absent/unreadable → fail-closed
}
const HIVE_MATERIAL_OK = hiveMaterialResolved();
log('[restore_tov] tov-hive status: ' + HIVE_BLOCK_REASON);
if (!HIVE_MATERIAL_OK) log('[restore_tov] hive aspects refuse --live ' + HIVE_UNBLOCK_PATH + (DRY ? ' (dry run unaffected)' : ' — LIVE hive refused'));

// ── מצב-ההדבקה (117p8f): WIF-הבעלים-הנוכחי-על-השרשרת (מהשיחה-שבה-הוחלף-הטוקן) ──
// אם-המפעיל-מניח-אותו-ב-/tmp/.tovowner (0600) — מדלגים-על-recover_account לגמרי:
// account_update2-אחד-חתום-במפתח-הבעלים-הקיים מיישר-את-כל-4-התפקידים-למפתחות-המאסטר.
let PASTE_WIF = null;
try {
  const s = fs.readFileSync('/tmp/.tovowner', 'utf8').trim();
  if (s) { PASTE_WIF = s; log('מצב-הדבקה: WIF-בעלים-נטען-מ-/tmp/.tovowner · pub=' + mask(steem.auth.wifToPublic(PASTE_WIF))); }
} catch (_) {}

const VAULT_PATH = path.join(__dirname, 'keys', 'vault.json');
const VAULT = JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8'));
const entry = (VAULT.accounts || []).find((a) => String(a.username).toLowerCase() === ACCOUNT);
if (!entry || !entry.keys || !entry.keys.owner || !entry.keys.owner.wif) {
  log('FATAL: אין-WIF-בעלות בכספת עבור @' + ACCOUNT);
  process.exit(1);
}
const OWNER_WIF = entry.keys.owner.wif;
const OWNER_PUB = steem.auth.wifToPublic(OWNER_WIF);
const PUBS = {
  owner: OWNER_PUB,
  active: steem.auth.wifToPublic(entry.keys.active.wif),
  posting: steem.auth.wifToPublic(entry.keys.posting.wif),
  memo: steem.auth.wifToPublic(entry.keys.memo.wif),
};

function api(node) { steem.api.setOptions({ url: node, useAppbaseApi: true }); }
function getAcc(node, name) {
  const prev = steem.api.options.url; api(node);
  return new Promise((res, rej) => steem.api.getAccounts([name], (e, r) => { api(prev); e ? rej(e) : res(r && r[0]); }));
}
function ownerHist(node, name) {
  const prev = steem.api.options.url; api(node);
  return new Promise((res) => steem.api.call('condenser_api.get_owner_history', [name], (e, r) => { api(prev); res(e ? [] : r || []); }));
}
function dgp(node) {
  const prev = steem.api.options.url; api(node);
  return new Promise((res, rej) => steem.api.getDynamicGlobalProperties((e, r) => { api(prev); e ? rej(e) : res(r); }));
}
function bcast(node, signed) {
  const prev = steem.api.options.url; api(node);
  return new Promise((res, rej) => steem.api.call('condenser_api.broadcast_transaction', [signed], (e, r) => { api(prev); e ? rej(e) : res(r); }));
}
function makeTx(d, ops) {
  return {
    ref_block_num: d.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(d.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(d.time + 'Z').getTime() + 90000).toISOString().slice(0, 19),
    operations: ops,
    extensions: [],
  };
}
const auth1 = (pub, accountAuths) => ({ weight_threshold: 1, account_auths: accountAuths || [], key_auths: [[pub, 1]] });
function signFor(chain, tx, wifs) {
  if (chain === 'hive') {
    const prev = steem.config.get('chain_id');
    try { steem.config.set('chain_id', HIVE_CHAIN_ID); return steem.auth.signTransaction(tx, wifs); }
    finally { steem.config.set('chain_id', prev); }
  }
  return steem.auth.signTransaction(tx, wifs);
}

async function main() {
  log('=== restore_tov ' + (DRY ? '[DRY]' : '[LIVE]') + ' ===');
  log('מפתחות-יעד מהכספת (master-derive): owner=' + mask(PUBS.owner) + ' active=' + mask(PUBS.active) + ' posting=' + mask(PUBS.posting) + ' memo=' + mask(PUBS.memo));

  // ── אימות-מקדים: מפתח-הכספת אכן היה הבעלים-הקודם בשתי-השרשראות ──
  const accounts = {};
  const history = {};
  for (const chain of ['steem', 'hive']) {
    const node = chain === 'hive' ? HIVE_RPC : STEEM_RPC;
    // Task 11-c — fail-closed: without audit-resolved controlling material, hive aspects do not run at all
    if (chain === 'hive' && !HIVE_MATERIAL_OK) {
      log('HIVE ' + HIVE_BLOCK_REASON + ' — pre-check skipped (' + HIVE_UNBLOCK_PATH + ')');
      continue;
    }
    const acc = await getAcc(node, ACCOUNT);
    if (!acc) { log('FATAL: @' + ACCOUNT + ' לא-נמצא-על ' + chain); process.exit(1); }
    accounts[chain] = acc;
    const h = await ownerHist(node, ACCOUNT);
    history[chain] = h;
    const lastPrev = h[0] && h[0].previous_owner_authority && h[0].previous_owner_authority.key_auths[0][0];
    const curOwner = acc.owner.key_auths[0][0];
    log(chain.toUpperCase() + ': בעלים-נוכחי=' + mask(curOwner) + ' · בעלים-קודם=' + mask(lastPrev) + ' (' + (h[0] ? h[0].last_valid_time : '∅') + ')');
    if (curOwner === OWNER_PUB) { log(chain.toUpperCase() + ': כבר-משוחזר! (owner=מפתח-כספת)'); continue; }
    if (lastPrev !== OWNER_PUB) {
      log('FATAL: מפתח-הכספת אינו הבעלים-הקודם ב-' + chain + ' — recover_account-לא-אפשרי-מהכספת');
      process.exit(1);
    }
  }

  const evidence = { at: new Date().toISOString(), account: ACCOUNT, mode: 'recover_account→master-derive', chains: {} };

  for (const chain of ['steem', 'hive']) {
    const node = chain === 'hive' ? HIVE_RPC : STEEM_RPC;
    // Task 11-c — fail-closed: no recover/account_update broadcast on hive without resolved material
    if (chain === 'hive' && !HIVE_MATERIAL_OK) {
      log('HIVE ' + HIVE_BLOCK_REASON + ' — recover/account_update refused');
      evidence.chains[chain] = { blocked: 'no-key', blockedReason: HIVE_BLOCK_REASON };
      continue;
    }
    const acc = accounts[chain];
    if (acc.owner.key_auths[0][0] === OWNER_PUB) { evidence.chains[chain] = { already: true }; continue; }

    // ── A. recover_account — רק-אם-אין-מפתח-הדבקה ──
    const pastePub = PASTE_WIF ? steem.auth.wifToPublic(PASTE_WIF) : null;
    if (PASTE_WIF && pastePub !== acc.owner.key_auths[0][0]) {
      log(chain.toUpperCase() + ' FATAL: WIF-ההדבקה לא שולט על הבעלות-הנוכחית (' + mask(pastePub) + '≠' + mask(acc.owner.key_auths[0][0]) + ') — דרוש-WIF-הבעלים-המדויק-מהשיחה');
      evidence.chains[chain] = { paste: false, error: 'paste-wif-not-owner' };
      continue;
    }
    if (!PASTE_WIF) {
    // (מסלול-recover_account — חסום-כרגע: דורש-בקשת-שותף. נשאר-בקוד-למקרה-שיחלף-שותף-ההתאוששות)
    const recOp = ['recover_account', {
      account_to_recover: ACCOUNT,
      new_owner_authority: auth1(OWNER_PUB, [[HEAD, 1]]),
      recent_owner_authority: auth1(OWNER_PUB),
      extensions: [],
    }];
    const d = await dgp(node);
    const recTx = makeTx(d, [recOp]);
    const recSigned = signFor(chain, recTx, [OWNER_WIF]);
    log(chain.toUpperCase() + ' A/recover: מוכן (חתימה-מקומית-תקינה) · new=מאסטר+head · recent=' + mask(OWNER_PUB));
    if (DRY) { log(chain.toUpperCase() + ' [DRY] לא-משדר'); evidence.chains[chain] = { dry: true }; continue; }
    try {
      await bcast(node, recSigned);
      log(chain.toUpperCase() + ' A/recover ✓ משודר');
      await new Promise((r) => setTimeout(r, 4500));
    } catch (e) {
      const msg = String((e && e.message) || e).slice(0, 200);
      log(chain.toUpperCase() + ' A/recover FAILED: ' + msg);
      evidence.chains[chain] = { recover: false, error: msg };
      continue;
    }
    } else {
      log(chain.toUpperCase() + ' A/paste-mode: דילוג-על-recover — עדכון-ישיר-במפתח-הבעלים-שנמסר');
    }

    // ── B. account_update2 — נרמול-הבעלים (מאסטר-טהור) + active/posting/memo + head-in-posting ──
    const updOp = ['account_update2', {
      account: ACCOUNT,
      memo_key: PUBS.memo,
      posting: auth1(PUBS.posting, [[HEAD, 1]]),
      active: auth1(PUBS.active, []),
      owner: auth1(OWNER_PUB, []),
      json_metadata: acc.json_metadata || '',
    }];
    const d2 = await dgp(node);
    const updTx = makeTx(d2, [updOp]);
    const updSigned = signFor(chain, updTx, PASTE_WIF ? [PASTE_WIF] : [OWNER_WIF]);
    try {
      await bcast(node, updSigned);
      log(chain.toUpperCase() + ' B/update ✓ משודר (owner/active/posting/memo → מפתחות-מאסטר + head-in-posting)');
      await new Promise((r) => setTimeout(r, 4500));
    } catch (e) {
      const msg = String((e && e.message) || e).slice(0, 200);
      log(chain.toUpperCase() + ' B/update FAILED: ' + msg);
      evidence.chains[chain] = { recover: true, update: false, error: msg };
      continue;
    }

    // ── אימות-חי 4/4 ──
    const after = await getAcc(node, ACCOUNT);
    const got = {
      owner: after.owner.key_auths[0][0] === PUBS.owner,
      active: after.active.key_auths[0][0] === PUBS.active,
      posting: after.posting.key_auths[0][0] === PUBS.posting,
      memo: after.memo_key === PUBS.memo,
      headPosting: !!(after.posting && after.posting.account_auths.some(([a]) => a === HEAD)),
    };
    const ok = Object.values(got).every(Boolean);
    log(chain.toUpperCase() + ' VERIFY: owner=' + got.owner + ' active=' + got.active + ' posting=' + got.posting + ' memo=' + got.memo + ' head-in-posting=' + got.headPosting + ' ⇒ ' + (ok ? '4/4+טופולוגיה ✓' : 'חלקי ✗'));
    evidence.chains[chain] = { recover: true, update: true, verified: ok, detail: got };
  }

  // ── C. vault-sync ──
  if (!DRY) {
    entry.syncedAt = new Date().toISOString();
    entry.restoredAt = new Date().toISOString();
    entry.restore = { via: 'recover_account', derivedFrom: 'operator-master (vault v2)' };
    fs.writeFileSync(VAULT_PATH, JSON.stringify(VAULT, null, 2));
    fs.writeFileSync(path.join(__dirname, 'restore_tov_evidence.json'), JSON.stringify(evidence, null, 2));
    log('vault-synced + evidence → agent/restore_tov_evidence.json');
  }
  const done = Object.values(evidence.chains).filter((c) => c.verified || c.already).length;
  log('=== סיום: ' + done + '/2 שרשראות מאומתות ' + (DRY ? '(dry)' : '') + ' ===');
}

main().catch((e) => { log('FATAL: ' + String((e && e.message) || e)); process.exit(1); });
