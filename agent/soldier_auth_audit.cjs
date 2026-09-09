#!/usr/bin/env node
/**
 * 117p6 — soldier-auth-audit (ציבורי-בלבד בהדפסות)
 * מה הוא עושה: לכל חייל ב-vault משווה את המפתחות הציבוריים שנגזרים מקומית
 * (לעולם לא מדפיס WIF — רק קידומת pubkey) מול הסמכויות החיות על השרשרת
 * (Steem + Hive). פלט: מטריצת תקינות לכל חייל/חשבון/תפקיד.
 * הרצה: node agent/soldier_auth_audit.cjs   (מה-root; steem נפתר מ-agent/node_modules)
 */
'use strict';
const steem = require('steem'); // נפתר אוטומטית מ-agent/node_modules (הסקריפט ב-agent/)
const fs = require('fs');

const VAULT = JSON.parse(fs.readFileSync('agent/keys/vault.json', 'utf8'));
const HIVE_NODES = ['https://api.hive.blog', 'https://anyx.io', 'https://api.openhive.network'];

function pk(wif) { try { return steem.auth.wifToPublic(wif); } catch (_) { return null; } }
function mask(k) { return k ? String(k).slice(0, 9) + '…' : '∅'; }

async function getAccount(node, name) {
  return new Promise((res) => {
    steem.api.setOptions({ url: node, useAppbaseApi: true });
    steem.api.getAccounts([name], (e, r) => res(e ? null : (r && r[0]) || null));
  });
}

async function main() {
  const rows = [];
  for (const a of VAULT.accounts) {
    const name = a.username;
    if (name === 'headcorner') continue; // כבר מאומת 8/8 ב-gate
    const ks = a.keys || {};
    const stWifs = (ks.posting && ks.posting.wif) ? ks : (ks.steem || ks); // תמיכה בשני מבנים
    const postingWif = (stWifs.posting && stWifs.posting.wif) || stWifs.posting || null;
    const activeWif  = (stWifs.active  && stWifs.active.wif)  || stWifs.active  || null;
    const ownerWif   = (stWifs.owner   && stWifs.owner.wif)   || stWifs.owner   || null;
    if (!postingWif && !activeWif) {
      /* 117p6 — חשבונות-ללא-מפתח-משלו (ynet): נבדק-בכל-זאת — האם-הראש-יושב-ב-posting-auth
       * (מסילת-via-head, הוכח-חי 117p6). כנות-מלאה במטריצה. */
      const st = await getAccount('https://api.steemit.com', name);
      const hv = await getAccount('https://api.hive.blog', name);
      const stRes = st ? { exists: true, posting: false, active: false, owner: false, headPosting: !!(st.posting && st.posting.account_auths.some(([acc]) => acc === 'headcorner')), chainPosting: st.posting && st.posting.key_auths.map(([k]) => mask(k)).join(',') } : { exists: false };
      const hvRes = hv ? { exists: true, posting: false, active: false, owner: false, headPosting: !!(hv.posting && hv.posting.account_auths.some(([acc]) => acc === 'headcorner')), chainPosting: hv.posting && hv.posting.key_auths.map(([k]) => mask(k)).join(',') } : { exists: false };
      rows.push({ name, viaHeadOnly: true, steem: stRes, hive: hvRes });
      console.log(`@${name} (no-wifs · via-head-only)`);
      console.log(`  STEEM  exists=${stRes.exists} head-in-posting=${stRes.headPosting} | chain-posting:${stRes.chainPosting || '∅'}`);
      console.log(`  HIVE   exists=${hvRes.exists} head-in-posting=${hvRes.headPosting} | chain-posting:${hvRes.chainPosting || '∅'}`);
      continue;
    }

    const derived = {
      posting: postingWif ? pk(postingWif) : null,
      active: activeWif ? pk(activeWif) : null,
      owner: ownerWif ? pk(ownerWif) : null,
    };

    // Steem
    const st = await getAccount('https://api.steemit.com', name);
    const stRes = st ? {
      exists: true,
      posting: !!(st.posting && st.posting.key_auths.some(([k]) => derived.posting && k === derived.posting)),
      active:  !!(st.active  && st.active.key_auths.some(([k]) => derived.active  && k === derived.active)),
      owner:   !!(st.owner   && st.owner.key_auths.some(([k]) => derived.owner   && k === derived.owner)),
      headPosting: !!(st.posting && st.posting.account_auths.some(([acc]) => acc === 'headcorner')),
      chainPosting: st.posting && st.posting.key_auths.map(([k]) => mask(k)).join(','),
    } : { exists: false };

    // Hive
    let hv = null;
    for (const n of HIVE_NODES) { hv = await getAccount(n, name); if (hv) break; }
    const hvRes = hv ? {
      exists: true,
      posting: !!(hv.posting && hv.posting.key_auths.some(([k]) => derived.posting && k === derived.posting)),
      active:  !!(hv.active  && hv.active.key_auths.some(([k]) => derived.active  && k === derived.active)),
      owner:   !!(hv.owner   && hv.owner.key_auths.some(([k]) => derived.owner   && k === derived.owner)),
      headPosting: !!(hv.posting && hv.posting.account_auths.some(([acc]) => acc === 'headcorner')),
      chainPosting: hv.posting && hv.posting.key_auths.map(([k]) => mask(k)).join(','),
    } : { exists: false };

    rows.push({ name, derived: { posting: mask(derived.posting), active: mask(derived.active), owner: mask(derived.owner) }, steem: stRes, hive: hvRes });
    console.log(`@${name}`);
    console.log(`  vault-derived: posting=${mask(derived.posting)} active=${mask(derived.active)} owner=${mask(derived.owner)}`);
    console.log(`  STEEM  exists=${stRes.exists} posting✓=${stRes.posting} active✓=${stRes.active} owner✓=${stRes.owner} head-in-posting=${stRes.headPosting} | chain-posting:${stRes.chainPosting || '∅'}`);
    console.log(`  HIVE   exists=${hvRes.exists} posting✓=${hvRes.posting} active✓=${hvRes.active} owner✓=${hvRes.owner} head-in-posting=${hvRes.headPosting} | chain-posting:${hvRes.chainPosting || '∅'}`);
  }
  fs.writeFileSync('agent/soldier_auth_audit.json', JSON.stringify(rows, null, 2));
  console.log('\nwrote agent/soldier_auth_audit.json');
}
main().catch((e) => { console.error('audit error:', e.message); process.exit(1); });
