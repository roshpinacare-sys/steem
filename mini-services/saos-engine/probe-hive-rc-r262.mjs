/**
 * probe-hive-rc-r262.mjs — R262 live measurement pass (read-only):
 * for each HIVE_ROSTER account: max_rc, current mana, regen-available now,
 * delta to the measured 2.3B post cost, HBD/HIVE/HP balances, RC manabar
 * last_update, and current profile json_metadata (what the world sees).
 * NO keys, NO broadcasts. Truth first.
 */
import { rpcHive, HIVE_ROSTER } from "./hive.mjs";

const POST_RC_COST = 2_300_000_000;

async function jget(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return r.json();
}

const out = [];
for (const account of HIVE_ROSTER) {
  const rc = await rpcHive("rc_api.find_rc_accounts", { accounts: [account] });
  const a = rc?.result?.rc_accounts?.[0];
  const acc = await rpcHive("condenser_api.get_accounts", [[account]]);
  const g = acc?.result?.[0];
  if (!a || !g) { out.push({ account, error: "probe-failed" }); continue; }
  const cur = Number(a.rc_manabar?.current_mana ?? 0);
  const max = Number(a.max_rc ?? 0);
  const upd = Number(a.rc_manabar?.last_update_time ?? 0);
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - upd);
  const available = Math.min(max, cur + (max * Math.min(elapsed, 432000)) / 432000);
  const hp = String(g.vesting_shares ?? "0").replace(" VESTS", "");
  out.push({
    account,
    rc: {
      maxB: +(max / 1e9).toFixed(3),
      curB: +(cur / 1e9).toFixed(3),
      availB: +(available / 1e9).toFixed(3),
      deficitToPostB: +((POST_RC_COST - available) / 1e9).toFixed(3),
      canPostNow: available >= POST_RC_COST,
      regenFullHours: max > 0 ? +(((max - cur) / max * 120).toFixed(1)) : null,
      lastUpdateAgeH: +(elapsed / 3600).toFixed(1),
    },
    balances: {
      hive: g.balance ?? "?",
      hbd: g.hbd_balance ?? "?",
      hpVests: hp,
      reputation: g.reputation ?? "?",
    },
    profile: (() => { try { return JSON.parse(g.posting_json_metadata || g.json_metadata || "{}")?.profile ?? null; } catch { return null; } })(),
    lastPost: null,
  });
}
/* last post date per account */
const blogs = await Promise.all(HIVE_ROSTER.map((a) => rpcHive("condenser_api.get_discussions_by_blog", [{ tag: a, limit: 1 }])));
blogs.forEach((b, i) => {
  const p = b?.result?.[0];
  if (p && p.author === HIVE_ROSTER[i]) out[i].lastPost = { created: p.created, permlink: `${p.author}/${p.permlink}`, title: p.title?.slice(0, 60) };
});
console.log(JSON.stringify({ at: new Date().toISOString(), roster: out }, null, 1));
