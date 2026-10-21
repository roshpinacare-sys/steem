/**
 * soldiers.mjs — the fleet: additional accounts that run grids ALONGSIDE the
 * master, deepening our market presence on the internal STEEM/SBD market.
 *
 * T-12 operator order: "החיילים שלנו יבצעו גריד בנוסף אלינו כדי לחזק את
 * האחזקה בשוק שלנו ברשת שלנו ובעשיית השוק ברמה יותר גבוהה ושתלטנית
 * מתפשטת לפי הגדילה שלה".
 *
 * LIFECYCLE (all doctrine-capped, one atomic tx per stage, fail-closed):
 *   1. claim_account ×count      (RC-funded claims, fee 0.000 STEEM)
 *   2. create_claimed_account    (fresh per-soldier keys, master = creator)
 *   3. transfer funding          (steemEach STEEM + sbdEach SBD, one-time)
 *   4. every cycle: per-soldier ladder (same VF1/parity laws, soldier budgets)
 *
 * SECURITY: soldier passwords live ONLY in .secrets/soldiers.json (0600,
 * gitignored). State keeps pubkeys + fingerprints. Each soldier's keys are
 * independent of the master's — a soldier leak can never touch the master.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall, accountState, openOrders } from "./measure.mjs";
import { SEED_ORDERS, wifFor, derivePub, b58encode, fingerprint } from "./steemtx.mjs";
import { planLadder, inventorySkew, classifyStale } from "./lib.mjs";
import { executeAs, armedConf, execPaused, masterAccount, loadCredential, defaultArmedConf, verifyRoles, custodyOf } from "./signer.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const SECRETS = path.join(DIR, "..", "..", ".secrets");
const SOLDIERS_SECRET = path.join(SECRETS, "soldiers.json");
const SOLDIERS_STATE = path.join(STATE, "soldiers.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); }; /* R235: atomic — rename is the commit point */

function soldierConf() {
  return (armedConf().soldiers) ?? defaultArmedConf().soldiers;
}

function soldierName(idx) {
  const c = soldierConf();
  return `${c.prefix}${idx}`; // hcsoldier1..3
}

function newSoldierSecret(name) {
  // master password format "P"+base58 (same shape steem-js generates)
  const rnd = new Uint8Array(38);
  crypto.getRandomValues(rnd);
  const password = "P" + b58encode(Buffer.from(rnd));
  const compose = SEED_ORDERS["name+role+pw"];
  const keys = {};
  for (const role of ["owner", "active", "posting", "memo"]) {
    keys[role] = derivePub(compose(name, role, password));
  }
  return { name, password, keys, fingerprint: fingerprint(password) };
}

/** full deployment: claim → create → fund, ONE atomic tx (fail-closed).
 * T-80: DEPLOYMENT IS OPERATOR-GATED (T-76 law made structural) — creating
 * new accounts and moving funds to them can only ever happen with an explicit
 * operator.allowSoldierDeploy=true in the standing order. The measured bug
 * class (autonomous fleet expansion — accounts born and funded with nobody
 * holding their keys a day later) is dead at the source. */
export async function deploySoldiers() {
  const conf = soldierConf();
  const master = masterAccount();
  const st = readJson(SOLDIERS_STATE, { deployed: false, accounts: [], fundingTxid: null });
  if (st.deployed) return { ok: true, verdict: "ALREADY-DEPLOYED", accounts: st.accounts.map((a) => a.name) };
  if (execPaused()) return { ok: false, verdict: "OPERATOR-PAUSED" };
  const armedFull = armedConf();
  if (armedFull.operator?.allowSoldierDeploy !== true) {
    return { ok: false, verdict: "DEPLOY-OPERATOR-GATED", reason: "T-80: fleet deployment requires operator.allowSoldierDeploy=true in the standing order" };
  }
  // pre-check: no credential writes, no ops, unless the master key is PROVEN
  const ver = await verifyRoles(master);
  if (!ver.ok) return { ok: false, verdict: ver.verdict ?? "KEY-UNVERIFIED", reason: ver.reason ?? null, guidance: ver.guidance ?? null };

  const secs = [];
  for (let i = 1; i <= conf.count; i++) secs.push(newSoldierSecret(soldierName(i)));

  // resource-aware funding: fund what the master ACTUALLY has liquid — the
  // creation fee (3 STEEM/account) is part of the same atomic tx, and the
  // shared book may be heavily committed by the second writer (measured
  // 2026-10-06: 905 STEEM parked in asks left only 25.7 liquid). The deploy
  // scales funding down to what the body can afford; a too-thin liquid fails
  // TYPED and retries next cycle instead of burning failed broadcasts.
  const acc = await accountState(master);
  const liquidSteem = Math.max(0, acc.ok ? acc.steem ?? 0 : 0);
  const liquidSbd = Math.max(0, acc.ok ? acc.sbd ?? 0 : 0);
  const feeEach = 3.0; // account_create paid fee (RC-claim path measured RC-short)
  const floatReserve = 5; // master float, always kept
  const affordable = Math.floor(((liquidSteem - floatReserve) / conf.count - feeEach) * 1000) / 1000;
  const steemEach = Math.min(conf.steemEach, Math.max(0, affordable));
  const sbdEach = liquidSbd >= conf.count * conf.sbdEach + 0.5 ? conf.sbdEach : 0;
  const totalNeed = Math.round(conf.count * (feeEach + steemEach) * 1000) / 1000;
  if (steemEach < 1 || totalNeed > Math.round((liquidSteem - floatReserve) * 1000) / 1000) {
    return { ok: false, verdict: "INSUFFICIENT-LIQUID", liquidSteem, needed: totalNeed, note: "retries next cycle — the shared book's liquid must clear first" };
  }

  // persist credentials BEFORE broadcast (if broadcast lands but we crash,
  // keys must exist on our side — write-once, 0600)
  try {
    fs.mkdirSync(SECRETS, { recursive: true });
    fs.writeFileSync(SOLDIERS_SECRET, JSON.stringify({ created: new Date().toISOString(), creator: master, accounts: secs.map(({ name, password, fingerprint: fp }) => ({ name, password, fingerprint: fp })) }, null, 2), { mode: 0o600 });
  } catch (e) {
    return { ok: false, verdict: "SECRET-WRITE-FAIL", error: String(e?.message ?? e).slice(0, 120) };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const ops = [];
  for (let i = 0; i < conf.count; i++) {
    const s = secs[i];
    const auth = (pub) => ({ weight_threshold: 1, account_auths: [], key_auths: [[pub, 1]] });
    // direct paid creation (3.000 STEEM/account) — the RC-claim path was
    // measured live: 3 claims need 23.8T RC vs 6.1T held; paid fee is law
    ops.push(["account_create", {
      fee: "3.000 STEEM", creator: master, new_account_name: s.name,
      owner: auth(s.keys.owner), active: auth(s.keys.active), posting: auth(s.keys.posting),
      memo_key: s.keys.memo, json_metadata: "{}",
    }]);
    if (steemEach > 0) ops.push(["transfer", { from: master, to: s.name, amount: `${Number(steemEach).toFixed(3)} STEEM`, memo: "grid soldier funding" }]);
    if (sbdEach > 0) ops.push(["transfer", { from: master, to: s.name, amount: `${Number(sbdEach).toFixed(3)} SBD`, memo: "grid soldier funding" }]);
  }
  void nowSec;
  const res = await executeAs(master, ops, { tag: "soldier-deploy" });
  if (!res.ok) return { ...res, verdict: res.verdict ?? "DEPLOY-FAIL" };

  // verify on-chain before declaring victory
  const names = secs.map((s) => s.name);
  const check = await rpcCall("condenser_api.get_accounts", [names]);
  const found = (check.result ?? []).filter(Boolean);
  if (found.length !== conf.count) {
    return { ok: false, verdict: "DEPLOY-UNVERIFIED", txid: res.txid, found: found.length, wanted: conf.count };
  }
  /* T-90: self-custody proof — the fresh keys were chain-installed by THIS
   * deploy tx; wait one block, then verify each soldier immediately so the
   * custody gates open this era (the sweep re-proves after any restart). */
  await new Promise((r) => setTimeout(r, 5000));
  const custody = [];
  for (const s of secs) {
    try {
      const ver = await verifyRoles(s.name);
      custody.push({ name: s.name, verified: !!ver.ok, verdict: ver.ok ? "VERIFIED" : (ver.verdict ?? "MISMATCH") });
    } catch (e) {
      custody.push({ name: s.name, verified: false, verdict: "VERIFY-ERROR", reason: String(e?.message ?? e).slice(0, 100) });
    }
  }
  writeJson(SOLDIERS_STATE, {
    deployed: true, at: new Date().toISOString(),
    accounts: secs.map((s) => ({ name: s.name, fingerprint: s.fingerprint, pubkeys: s.keys })),
    custody,
    fundingTxid: res.txid, fundedEach: { steem: steemEach, sbd: sbdEach },
    sbdDeferred: sbdEach === 0 ? "SBD liquid was committed to master bids — soldier bid sides self-bootstrap from ask fills" : null,
  });
  return { ok: true, verdict: "DEPLOYED", txid: res.txid, accounts: names, steemEach, sbdEach, custody };
}

/* T-90 · SOLDIER SELF-CUSTODY SWEEP: .secrets/soldiers.json passwords are
 * 0600-held HERE; after deploy or an engine restart the in-memory key cache
 * is empty and every custody gate reads "keyed-unverified" — freezing live
 * soldiers forever. This sweep proves each stored credential against the
 * LIVE chain authorities (verifyRoles — the same fail-closed law as the
 * master): a match flips custody to "verified"; a mismatch stays frozen and
 * is journaled. Idempotent, bounded by the roster itself. */
export async function verifySoldierCustody() {
  const s = readJson(SOLDIERS_SECRET, null);
  const names = (s?.accounts ?? []).map((a) => a.name).slice(0, 8);
  const out = [];
  for (const name of names) {
    if (custodyOf(name) === "verified") { out.push({ name, verdict: "ALREADY-VERIFIED" }); continue; }
    try {
      const ver = await verifyRoles(name);
      out.push({ name, verdict: ver.ok ? "VERIFIED" : (ver.verdict ?? "MISMATCH"), reason: ver.reason ?? null });
    } catch (e) {
      out.push({ name, verdict: "VERIFY-ERROR", reason: String(e?.message ?? e).slice(0, 100) });
    }
  }
  return { ok: out.every((o) => o.verdict === "ALREADY-VERIFIED" || o.verdict === "VERIFIED"), out };
}

/** per-soldier ladder: same laws as the master (VF1 floor, skew, drag),
 * soldier-sized budgets; each soldier signs its OWN tx with its OWN key.
 * T-19: accepts the live book edges + chain anchor — each soldier's ladder
 * gets the flow tranche AT the market front (the multiplier: 3 soldiers ×
 * small front levels = 3 extra presences competing for the same measured
 * ~49 trades/day, without ever crossing the master's ladder — planLadder's
 * construction + the chain anchor keep every level lawful). */
export async function runSoldierGrids({ parity, spreadBps = 0, now, bestBid = null, bestAsk = null, feedAnchor = null, extraRoster = [] }) {
  const conf = soldierConf();
  const st = readJson(SOLDIERS_STATE, { deployed: false, accounts: [] });
  /* W23 (owner order trace 1a15937c02271931: "מסחר גריד בסטימיט של כל החשבונות"):
   * the grid pass is FLEET-WIDE — the verified army bodies (fleet-matrix
   * GRID-ACTIVE rows) join the legacy hcsoldier roster. The legacy
   * deployed-gate only governs the legacy roster itself; an extraRoster
   * present keeps the whole fleet trading even when no legacy soldier was
   * ever deployed. The T-80 custody fast-gate below still freezes any body
   * without a chain-verified credential — the gate is per-body, not
   * per-roster, so keyless names in the matrix cost one row, zero reads. */
  const legacy = st.deployed ? st.accounts : [];
  const seen = new Set(legacy.map((r) => r.name));
  const merged = [...legacy, ...(Array.isArray(extraRoster) ? extraRoster : []).filter((n) => typeof n === "string" && n && !seen.has(n)).map((n) => ({ name: n }))];
  if (!merged.length) return { ok: true, verdict: "NO-ROSTER", soldiers: [] };
  if (execPaused()) return { ok: false, verdict: "OPERATOR-PAUSED", soldiers: [] };
  if (!(parity > 0)) return { ok: true, verdict: "NO-PARITY", soldiers: [] };

  const out = [];
  /* W27-c TIERED FLEET BOOK (owner trace 1a15c67385c253b5 — "שוק חריף דווקא
   * על הדקס שלנו" · "גוף אחד חכם עם הרבה ידיים"): the roster order IS the
   * tier — body t quotes its value-ask ladder t×tierSpacingBps deeper
   * (clamped by planLadder's bookCap law) and spreads its front-presence
   * tranches with t×tierFlowBpsStep extra spacing, so the fleet forms a
   * WIDE two-sided book instead of N copies at one price. Ask side spreads
   * inside the G41 cap (clamps to the lawful front in a depressed book);
   * bid side staggers BELOW the common ceiling (always lawful — no body
   * ever pays more). Deep tiers beyond the anchor cap degrade gracefully
   * to the base ladder. */
  const tierMax = Math.max(1, conf.tierMax ?? 8);
  const tierSpacingBps = Math.max(0, conf.tierSpacingBps ?? 20);
  const tierFlowBpsStep = Math.max(0, conf.tierFlowBpsStep ?? 5);
  const baseFlowSpacing = conf.flowSpacingBps ?? 15;
  for (let mi = 0; mi < merged.length; mi++) {
    const rec = merged[mi];
    const tier = mi % tierMax;
    const name = rec.name;
    /* T-80 · CUSTODY FAST-GATE: a soldier without a chain-verified credential
     * gets ZERO network reads and ZERO ops — the measured rot (doomed
     * accountState + openOrders reads per cycle per keyless soldier, forever)
     * dies here. The signer's think-gate independently refuses signing. */
    if (custodyOf(name) !== "verified") {
      out.push({ name, verdict: "NO-CUSTODY-FROZEN", frozen: true });
      continue;
    }
    try {
      const [acc, oo] = await Promise.all([accountState(name), openOrders(name)]);
      if (!acc.ok || !oo.ok) { out.push({ name, verdict: "READ-FAIL" }); continue; }
      const live = oo.orders;
      const staleCls = classifyStale(live, parity);
      const skew = inventorySkew(acc.steem ?? 0, acc.sbd ?? 0, parity);
      const plan = planLadder({
        parity,
        askBudgetSteem: Math.max(0, (acc.steem ?? 0)),
        bidBudgetSbd: Math.max(0, (acc.sbd ?? 0) - 0.2),
        spreadBps, skew, levels: 3, minLevel: conf.minLevel ?? 0.2, now,
        bestBid, bestAsk, feedAnchor,
        flowTranchePct: conf.flowTranchePct ?? 0.5,
        flowSpacingBps: baseFlowSpacing + tier * tierFlowBpsStep,
        flowLevels: conf.flowLevels ?? 2,
        askParityBps: tier * tierSpacingBps,
        bidCeilingBps: tier * tierSpacingBps,
      });
      const ops = [];
      for (const o of staleCls.stale.slice(0, 3)) ops.push(["limit_order_cancel", { owner: name, orderid: o.orderid }]);
      let askSum = 0, bidSum = 0;
      const pushOrder = (lvl, kind) => {
        if (kind === "ask") { askSum += lvl.amountSteem; ops.push(["limit_order_create", { owner: name, orderid: (Math.floor(Date.now() / 1000) + ops.length) >>> 0, amount_to_sell: `${lvl.amountSteem.toFixed(3)} STEEM`, min_to_receive: `${(lvl.amountSteem * lvl.unit).toFixed(3)} SBD`, fill_or_kill: false, expiration: Math.floor(Date.now() / 1000) + 86400 }]); }
        else { bidSum += lvl.amountSbd; ops.push(["limit_order_create", { owner: name, orderid: (Math.floor(Date.now() / 1000) + ops.length + 500) >>> 0, amount_to_sell: `${lvl.amountSbd.toFixed(3)} SBD`, min_to_receive: `${(lvl.amountSbd / lvl.unit).toFixed(3)} STEEM`, fill_or_kill: false, expiration: Math.floor(Date.now() / 1000) + 86400 }]); }
      };
      for (const a of plan.asks) pushOrder(a, "ask");
      for (const b of plan.bids) pushOrder(b, "bid");
      for (const a of plan.flowAsks ?? []) pushOrder(a, "ask");   // T-19: front presence
      for (const b of plan.flowBids ?? []) pushOrder(b, "bid");
      void askSum; void bidSum;
      let res;
      if (!ops.length) res = { ok: true, verdict: "NO-OPS", ops: 0 };
      else res = await executeAs(name, ops, { tag: "soldier-grid" });
      out.push({ name, tier, verdict: res.verdict ?? "SENT", txid: res.txid ?? null, ops: ops.length, stale: staleCls.stale.length, live: live.length, steem: acc.steem, sbd: acc.sbd, error: res.error ?? null });
    } catch (e) {
      out.push({ name, verdict: "ERROR", error: String(e?.message ?? e).slice(0, 120) });
    }
  }
  return { ok: out.every((o) => !o.verdict || !["BROADCAST-FAIL", "ERROR", "READ-FAIL"].includes(o.verdict)), verdict: "SOLDIER-GRID-DONE", soldiers: out };
}

export function soldiersState() { return readJson(SOLDIERS_STATE, { deployed: false, accounts: [] }); }
export function soldiersPublic() {
  const st = soldiersState();
  const accounts = (st.accounts ?? []).map((a) => ({ name: a.name, fingerprint: a.fingerprint, custody: custodyOf(a.name) }));
  const allFrozen = accounts.length > 0 && accounts.every((a) => a.custody !== "verified");
  return {
    deployed: !!st.deployed, at: st.at ?? null,
    accounts,
    frozen: allFrozen,
    verdict: allFrozen ? "NO-CUSTODY-FROZEN" : null,
    t80: allFrozen ? "T-80 (דבר-מפעיל 04.10): חיילים חסרי-מפתח מוקפאים — אפס מימון, אפס גריד, אפס חתימה" : null,
    fundingTxid: st.fundingTxid ?? null, fundedEach: st.fundedEach ?? null,
  };
}
