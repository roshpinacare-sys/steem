/**
 * selftest.mjs — deterministic offline vectors for the sovereign-local core.
 * Zero network, zero clock, zero randomness. RUN: bun selftest.mjs
 */
import {
  dragK, inventorySkew, planLadder, planConvert, planRedeploy, redeployBidCapSbd, redeployPacing, rebuildPacingFromEvents, classifyStale, pnlFromFills, guardDepth, parityVerdict,
  MIN_LEVEL, ASK_FLOOR_BPS,
  doctrineAccount, credentialGate, rcAnomaly, recruitRoles, aggregateRails,
  normalizeWebIntel, webIntelFresh,
  payoutWindow, rewardHistoryRollup, vpNow, x2Spectrum, weaveArbitration, weaveFresh, opTypeName,
  signalDigest, measuredLayers, redeployIntel, blockageLedger, organVerdict, meshVerdict,
} from "./lib.mjs";
import { sanitizeDraft, eligibleDrafts, PUBLISH_ELIGIBLE_SINCE } from "./content.mjs";
import { sanitizeReply, replyFresh, textSimilarity, pickColdPost, buildDaySchedule } from "./army-social.mjs";
import { spamVerdict, organicVerdict, crossChainVerdict, titleVerdict, tagVerdict, bodyVerdict, selfSimVerdict, groundingVerdict, frequencyVerdict, spamPhraseHits, dupSentenceRatio, jaccard, shingles, normalizeText, GATE_DEFAULTS } from "./spamgate.mjs";
import { buildBusMessage, busOp, parseBusEntry, filterInbox, busRateLimit, deliverInbox, BUS_TYPES, BUS_ID } from "./bus.mjs";
import { thinkGate } from "./signer.mjs";
import { tick, fold } from "./grid.mjs";
import { classifyAgent } from "./fleet.mjs";
import { PERSONAS, PERSONA_IDS, personaOf, arcStageOf, profileDoc, profileDiffers, mergeProfileMetadata, assignPersonas, personaBrief } from "./personas.mjs";
import { OP_IDS } from "./steemtx.mjs";

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja === jb) { pass++; }
  else { fail++; console.error(`FAIL ${name}\n  got: ${ja}\n  want: ${jb}`); }
};
const ok = (name, cond) => (cond ? pass++ : (fail++, console.error(`FAIL ${name}`)));

/* 1 · dragK monotone + clamped */
eq("dragK@0", dragK(0), 1);
eq("dragK@1000", dragK(1000), 1.5);
eq("dragK@99999", dragK(99999), 3);

/* 2 · inventory skew: rich-STEEM ⇒ bigger asks */
const skewRich = inventorySkew(900, 10, 0.107);
ok("skew rich asks>1", skewRich.askMult > 1);
ok("skew rich bids<1", skewRich.bidMult < 1);
const skewBalanced = inventorySkew(450, 450 * 0.107, 0.107); // T-8b inversion trap: SBD→STEEM units is ×parity, not ÷
ok("skew balanced ~0", Math.abs(skewBalanced.skew) < 1e-6);
const skewSbd = inventorySkew(10, 900 / 0.107, 0.107);
ok("skew sbd-rich asks<1", skewSbd.askMult < 1);

/* 3 · parity verdict + band refuse */
eq("band ok", parityVerdict(0.107, 0.1069).ok, true);
eq("band refuse", parityVerdict(0.5, 0.107).reason, "parity-band-refuse");
eq("no feed", parityVerdict(0.107, 0).reason, "no-internal-feed");

/* 4 · ladder law: floor/ceiling never violated; budgets respected BY CONSTRUCTION */
const P = 0.107;
const plan = planLadder({ parity: P, askBudgetSteem: 100, bidBudgetSbd: 50, now: "2026-01-01T00:00:00Z" });
eq("plan ready", plan.verdict, "OFFER-READY");
eq("asks 5", plan.asks.length, 5);
eq("bids 5", plan.bids.length, 5);
const floor = P * (1 + ASK_FLOOR_BPS / 10000);
ok("asks ≥ floor", plan.asks.every((a) => a.unit >= floor - 1e-12));
ok("bids ≤ ceiling", plan.bids.every((b) => b.unit <= plan.ceiling + 1e-12));
const sumA = Math.round(plan.asks.reduce((s, a) => s + a.amountSteem, 0) * 1e6) / 1e6;
ok("ask sum ≤ budget", sumA <= 100 + 1e-9);
const sumB = Math.round(plan.bids.reduce((s, b) => s + b.amountSbd, 0) * 1e6) / 1e6;
ok("bid sum ≤ budget", sumB <= 50 + 1e-9);

/* 5 · the T-5 rounding-blocker vector: 379.23 vs 379.229 must not block */
const plan2 = planLadder({ parity: P, askBudgetSteem: 379.229, bidBudgetSbd: 2.919, now: "2026-01-01T00:00:00Z" });
ok("rounding vector asks>0", plan2.asks.length > 0);
ok("rounding vector sum≤commitable", plan2.asks.reduce((s, a) => s + a.amountSteem, 0) <= 379.229 + 1e-9);

/* 6 · dust-break: below min-level ⇒ empty with honest blocker */
const plan3 = planLadder({ parity: P, askBudgetSteem: 0.3, bidBudgetSbd: 0.3, now: "2026-01-01T00:00:00Z" });
eq("dust asks", plan3.asks.length, 0);
eq("dust verdict", plan3.verdict, "OFFER-EMPTY");

/* 7 · min-fuel gate restored: budget ≥ minLevel but < minLevel×levels fills fewer levels */
const plan4 = planLadder({ parity: P, askBudgetSteem: 1.4, bidBudgetSbd: 0, now: "2026-01-01T00:00:00Z" });
eq("partial levels", plan4.asks.length, 2);

/* 8 · R245-b feed-vs-parity doctrine: SBD conversion pays at the witness feed
 * rate (1 SBD → 1/feed STEEM), NOT face-$1 (HBD model mis-ported in D-023).
 * True edge = marketParity/feed − 1. enter ≥ 150bps, hysteresis to 100bps. */
const mk = (edge) => ({ liquidSbd: 5, feedSbdPerSteem: P, marketSbdPerSteem: P * (1 + edge), previouslyArmed: false });
eq("psm below-enter", planConvert(mk(0.014)).verdict, "CONVERT-HOLD");
eq("psm enter", planConvert(mk(0.015)).verdict, "CONVERT-PLAN");
const armedHold = planConvert({ liquidSbd: 5, feedSbdPerSteem: P, marketSbdPerSteem: P * 1.011, previouslyArmed: true });
eq("psm hysteresis-hold", armedHold.verdict, "CONVERT-PLAN");
const armedExit = planConvert({ liquidSbd: 5, feedSbdPerSteem: P, marketSbdPerSteem: P * 1.009, previouslyArmed: true });
eq("psm hysteresis-exit", armedExit.verdict, "CONVERT-HOLD");
eq("psm dust", planConvert({ liquidSbd: 0.2, feedSbdPerSteem: P, marketSbdPerSteem: P * 1.02, previouslyArmed: false }).verdict, "CONVERT-HOLD");
const psmCap = planConvert({ liquidSbd: 50, feedSbdPerSteem: P, marketSbdPerSteem: P * 1.02, pendingSbd: 9.8, previouslyArmed: false });
eq("psm cap honest-hold (0.2<min dust)", psmCap.verdict, "CONVERT-HOLD");
eq("psm cap amount", psmCap.amountSbd, 0);
const psmCap2 = planConvert({ liquidSbd: 50, feedSbdPerSteem: P, marketSbdPerSteem: P * 1.02, pendingSbd: 8.5, previouslyArmed: false });
eq("psm cap partial", psmCap2.amountSbd, 1.5);

/* 8b · T-9 structural truth (R245-b extended): no external parity or no feed ⇒ honest HOLD */
eq("psm no-market honest-hold", planConvert({ liquidSbd: 50, feedSbdPerSteem: P, marketSbdPerSteem: null, previouslyArmed: false }).verdict, "CONVERT-HOLD");
eq("psm no-feed honest-hold", planConvert({ liquidSbd: 50, feedSbdPerSteem: 0, marketSbdPerSteem: P, previouslyArmed: false }).verdict, "CONVERT-HOLD");
eq("psm edge-neutral-hold", planConvert({ liquidSbd: 50, feedSbdPerSteem: P, marketSbdPerSteem: P, previouslyArmed: false }).verdict, "CONVERT-HOLD");

/* T-91 · redeployment doctrine — cashing out never stops the autonomy */
const rdFloor = planRedeploy({ liquidSteem: 4.9, liquidSbd: 1, now: "x" });
eq("redeploy at-floor-holds", rdFloor.verdict, "REDEPLOY-HOLD");
eq("redeploy at-floor-reason", rdFloor.reason, "at-or-below-floor");
eq("redeploy at-floor-zero", rdFloor.powerUpSteem, 0);
const rdBelow = planRedeploy({ liquidSteem: 8, liquidSbd: 1, now: "x" }); // excess 3 × 0.3 = 0.9 < min 5
eq("redeploy below-min-holds", rdBelow.verdict, "REDEPLOY-HOLD");
eq("redeploy below-min-reason", rdBelow.reason, "below-min-powerup");
eq("redeploy below-min-amount", rdBelow.powerUpSteem, 0.9);
const rdPlan = planRedeploy({ liquidSteem: 25.7, liquidSbd: 2, now: "x" }); // excess 20.7 × 0.3 = 6.21
eq("redeploy plan-verdict", rdPlan.verdict, "REDEPLOY-PLAN");
eq("redeploy plan-reason", rdPlan.reason, "doctrine-ratios");
eq("redeploy plan-3dp", rdPlan.powerUpSteem, 6.21);
eq("redeploy plan-excess", rdPlan.excessSteem, 20.7);
eq("redeploy ratios-echo", [rdPlan.ratios.buyBookPct, rdPlan.ratios.powerUpPct, rdPlan.ratios.reservePct], [0.5, 0.3, 0.2]);
eq("redeploy floors-echo", [rdPlan.floors.liquidSteemFloor, rdPlan.floors.liquidSbdFloor], [5, 0.5]);
ok("redeploy law-present", typeof rdPlan.law === "string" && rdPlan.law.includes("מימוש"));
ok("redeploy notes-present", typeof rdPlan.buyBookNote === "string" && typeof rdPlan.reserveNote === "string");
const rdBad = planRedeploy({ liquidSteem: 100, buyBookPct: 0.5, powerUpPct: 0.3, reservePct: 0.1, now: "x" });
eq("redeploy ratios-invalid-blocked", rdBad.verdict, "REDEPLOY-BLOCKED");
eq("redeploy ratios-invalid-reason", rdBad.reason, "ratios-invalid");
const rdCustom = planRedeploy({ liquidSteem: 10, buyBookPct: 1, powerUpPct: 0, reservePct: 0, minPowerUpSteem: 1, now: "x" });
eq("redeploy zero-powerup-share-holds", rdCustom.verdict, "REDEPLOY-HOLD");

/* T-91 R231 review · buy-book cap is law — the peg bid budget can never exceed it */
eq("redeploy bidcap basic", redeployBidCapSbd(82.144, 0.5, 0.5), 40.822);
eq("redeploy bidcap dust", redeployBidCapSbd(0.015, 0.5, 0.5), 0);
eq("redeploy bidcap below-floor", redeployBidCapSbd(0.4, 0.5, 0.5), 0);
eq("redeploy bidcap full-share", redeployBidCapSbd(10, 2, 1), 8);
eq("redeploy bidcap junk-pct", redeployBidCapSbd(10, 0.5, -1), 0);

/* T-91 R233 adversarial-review vectors — every battery finding became a law:
 * hostile inputs fail CLOSED (never crash, never leak NaN/Infinity) */
const HOSTILE = [NaN, Infinity, -Infinity, "30.749", "", null, {}, [], () => 5, Symbol("x")];
let hostileCrashes = 0, hostileLeak = 0;
for (const h of HOSTILE) {
  for (const field of ["liquidSteem", "liquidSbd", "buyBookPct", "powerUpPct", "reservePct", "liquidSteemFloor", "liquidSbdFloor", "minPowerUpSteem"]) {
    try {
      const r = planRedeploy({ liquidSteem: 30.749, liquidSbd: 0.015, [field]: h });
      if (!["REDEPLOY-PLAN", "REDEPLOY-HOLD", "REDEPLOY-BLOCKED"].includes(r?.verdict)) hostileLeak++;
    } catch { hostileCrashes++; }
  }
  try { if (!isFinite(redeployBidCapSbd(h, 0.5, 0.5)) || !isFinite(redeployBidCapSbd(10, h, 0.5)) || !isFinite(redeployBidCapSbd(10, 0.5, h))) hostileLeak++; } catch { hostileCrashes++; }
}
eq("redeploy hostile-zero-crashes", hostileCrashes, 0);
eq("redeploy hostile-zero-leaks", hostileLeak, 0);
eq("redeploy hostile-nan-liquid-holds", planRedeploy({ liquidSteem: NaN }).verdict, "REDEPLOY-HOLD");
eq("redeploy hostile-inf-liquid-holds", planRedeploy({ liquidSteem: Infinity }).verdict, "REDEPLOY-HOLD");
eq("redeploy hostile-symbol-pct-blocked", planRedeploy({ liquidSteem: 30, buyBookPct: Symbol("x") }).verdict, "REDEPLOY-BLOCKED");
eq("redeploy hostile-nan-cap-zero", redeployBidCapSbd(NaN, 0.5, 0.5), 0);
eq("redeploy hostile-inf-cap-zero", redeployBidCapSbd(Infinity, 0.5, 0.5), 0);
eq("redeploy hostile-obj-cap-zero", redeployBidCapSbd({}, 0.5, 0.5), 0);
eq("redeploy hostile-inf-pct-cap-zero", redeployBidCapSbd(10, 0.5, Infinity), 0);
/* R233: finite-but-huge inputs overflow the 3dp pipeline (1e308 × 1e6 → Infinity) — magnitude-clamped fail-closed */
eq("redeploy huge-liquid-holds", planRedeploy({ liquidSteem: 1e308 }).verdict, "REDEPLOY-HOLD");
eq("redeploy huge-sbd-cap-zero", redeployBidCapSbd(1e308, 0.5, 0.5), 0);
eq("redeploy huge-pct-cap-zero", redeployBidCapSbd(10, 0.5, 1e308), 0);
/* R233: PLAN must mean a broadcastable amount — min=0 + excess=0 was a lying PLAN/0 */
const rdZeroPlan = planRedeploy({ liquidSteem: 5, minPowerUpSteem: 0, now: "x" });
eq("redeploy no-plan-with-zero-amount", [rdZeroPlan.verdict, rdZeroPlan.powerUpSteem], ["REDEPLOY-HOLD", 0]);
/* R233: the ratio-sum law is a ±0.001 band (float-safe), stated and tested */
eq("redeploy band-0.9995-plans", planRedeploy({ liquidSteem: 30, buyBookPct: 0.4995, now: "x" }).verdict, "REDEPLOY-PLAN");
eq("redeploy band-1.0005-plans", planRedeploy({ liquidSteem: 30, buyBookPct: 0.5005, now: "x" }).verdict, "REDEPLOY-PLAN");
eq("redeploy band-0.9-blocked", planRedeploy({ liquidSteem: 30, buyBookPct: 0.4, powerUpPct: 0.3, reservePct: 0.2, now: "x" }).verdict, "REDEPLOY-BLOCKED");
eq("redeploy live-ratios-sum-exact", [0.5, 0.3, 0.2].reduce((a, b) => a + b, 0), 1); // IEEE754 truth: the live ratios sum EXACTLY to 1; the ±0.001 band is insurance for arbitrary operator decimals
ok("redeploy liquidBasis-stamped", typeof rdPlan.liquidBasis === "string" && rdPlan.liquidBasis.includes("free-balance"));
/* R233: pacing law as pure fn — boundary + corruption classes by design */
eq("redeploy pacing interval-blocks", redeployPacing({ verdict: "REDEPLOY-PLAN", sinceLastSec: 300 }).verdict, "interval");
eq("redeploy pacing exact-interval-allows", redeployPacing({ verdict: "REDEPLOY-PLAN", sinceLastSec: 3600 }).verdict, null);
eq("redeploy pacing day-cap-blocks", redeployPacing({ verdict: "REDEPLOY-PLAN", sinceLastSec: 7200, powerUpsToday: 12 }).verdict, "day-cap");
eq("redeploy pacing exact-day-cap-blocks", redeployPacing({ verdict: "REDEPLOY-PLAN", sinceLastSec: 7200, powerUpsToday: 12 }).verdict, "day-cap");
eq("redeploy pacing nan-since-open", redeployPacing({ verdict: "REDEPLOY-PLAN", sinceLastSec: NaN }).verdict, null);
eq("redeploy pacing negative-since-open", redeployPacing({ verdict: "REDEPLOY-PLAN", sinceLastSec: -500 }).verdict, null);
eq("redeploy pacing future-since-open", redeployPacing({ verdict: "REDEPLOY-PLAN", sinceLastSec: -99999 }).verdict, null);
eq("redeploy pacing non-plan-passthrough", redeployPacing({ verdict: "REDEPLOY-HOLD", sinceLastSec: 10 }).verdict, null);
eq("redeploy pacing day-cap-reason", redeployPacing({ verdict: "REDEPLOY-PLAN", sinceLastSec: 7200, powerUpsToday: 13, maxPerDay: 12 }).reason, "powerup-day-cap (13 >= 12 today)");
/* R233: convergence property — doctrine decays geometrically, never breaches floor */
{
  let liq = 82.144, n = 0, breach = false, endVerdict = "";
  while (n < 40) {
    const r = planRedeploy({ liquidSteem: liq, now: "x" });
    if (r.verdict !== "REDEPLOY-PLAN") { endVerdict = r.verdict; break; }
    liq -= r.powerUpSteem; n++;
    if (liq < 5 - 1e-9) { breach = true; break; }
  }
  eq("redeploy convergence-hold", endVerdict, "REDEPLOY-HOLD");
  eq("redeploy convergence-no-breach", breach, false);
  ok("redeploy convergence-bounded", n > 0 && n < 40);
}

/* T-91 R233 · think-gate law as unit vectors — R231 shipped clause 4 with
 * ZERO regression coverage (production evidence only). Every refusal class
 * of the gate is now a permanent vector (journal:false = zero state writes). */
const TG_ACC = "headcorner";
const tgVerified = { custodyOverride: "verified", journal: false };
const tgSelf = [["transfer_to_vesting", { from: TG_ACC, to: TG_ACC, amount: "7.724 STEEM" }]];
const tgPilfer = [["transfer_to_vesting", { from: TG_ACC, to: "hcs1", amount: "7.724 STEEM" }]];
/* 1 · custody-first: an unknown account is refused before any policy logic */
const tgNoCustody = thinkGate("no-such-acct-xyz", tgSelf, { journal: false, conf: { operator: { allowPowerUp: true } } });
eq("thinkgate custody-first-refused", tgNoCustody.verdict, "REFUSED");
ok("thinkgate custody-first-reason", (tgNoCustody.reasons[0] ?? "").includes("no credential"));
/* 2 · fresh-process master = keyed-but-unverified (deterministic offline) */
const tgFresh = thinkGate(TG_ACC, tgSelf, { journal: false, conf: { operator: { allowPowerUp: true } } });
eq("thinkgate unverified-master-refused", tgFresh.verdict, "REFUSED");
ok("thinkgate unverified-reason", (tgFresh.reasons[0] ?? "").includes("keyed-but-unverified"));
/* 3 · clause 4 armed + self-directed → ALLOW */
eq("thinkgate powerup-self-armed-allow", thinkGate(TG_ACC, tgSelf, { ...tgVerified, conf: { operator: { allowPowerUp: true } } }).verdict, "ALLOW");
/* 4 · clause 4: from≠to is REFUSED even when armed — value never leaves */
const tgPilferR = thinkGate(TG_ACC, tgPilfer, { ...tgVerified, conf: { operator: { allowPowerUp: true } } });
eq("thinkgate powerup-pilfer-refused", tgPilferR.verdict, "REFUSED");
ok("thinkgate pilfer-reason", (tgPilferR.reasons[0] ?? "").includes("self-directed"));
/* 5 · clause 4: unarmed (operator.allowPowerUp=false) → REFUSED */
const tgUnarmed = thinkGate(TG_ACC, tgSelf, { ...tgVerified, conf: { operator: { allowPowerUp: false } } });
eq("thinkgate powerup-unarmed-refused", tgUnarmed.verdict, "REFUSED");
ok("thinkgate unarmed-reason", (tgUnarmed.reasons[0] ?? "").includes("FORBIDDEN"));
/* 6 · clause 4: missing operator block entirely → REFUSED (safe-by-default) */
eq("thinkgate powerup-no-policy-refused", thinkGate(TG_ACC, tgSelf, { ...tgVerified, conf: {} }).verdict, "REFUSED");
/* 7 · policy class 2: outbound transfer outside allowlist → REFUSED */
const tgOut = thinkGate(TG_ACC, [["transfer", { from: TG_ACC, to: "random-stranger", amount: "1.000 STEEM" }]], { ...tgVerified, conf: { policy: { transferAllowlist: ["hcs1", "hcs2"] } } });
eq("thinkgate outbound-transfer-refused", tgOut.verdict, "REFUSED");
ok("thinkgate outbound-reason", (tgOut.reasons[0] ?? "").includes("FORBIDDEN"));
/* 8 · policy class 2: allowlisted recipient → ALLOW */
eq("thinkgate allowlisted-transfer-allow", thinkGate(TG_ACC, [["transfer", { from: TG_ACC, to: "hcs1", amount: "1.000 STEEM" }]], { ...tgVerified, conf: { policy: { transferAllowlist: ["hcs1"] } } }).verdict, "ALLOW");

/* R246 · clause 5 law: account_create is a value move — ONLY a live,
 * single-use, fee-capped, name-bound operator order arms it. */
const acctCreateOp = (fee, name) => [["account_create", { fee, creator: TG_ACC, new_account_name: name, owner: { weight_threshold: 1, account_auths: [], key_auths: [["STM7jA4xpCcN6Uwt6SmzK1MhTcmg7nmXrMEpiLok45GvqYLFQSSnX", 1]] }, active: { weight_threshold: 1, account_auths: [], key_auths: [["STM62FpckaXAdMmdD8abrFGhN8uE5wYm6tkUajmruJumrHNRNKfZL", 1]] }, posting: { weight_threshold: 1, account_auths: [], key_auths: [["STM8ZiWEgUYoYeQ3rWut6GKamgFsYccMCQ68QAR5WYQgvV9Aaihxb", 1]] }, memo_key: "STM5ncpsbHiHHhFJRZpmpQx8u5JwEjGUXmL45HRh6caC1NCZBTvwe", json_metadata: "" }]];
const goodOrder = { account: "hive-210001", maxFeeSteem: 5, used: false };
/* a · no order at all → REFUSED (fail-closed default) */
const tgNoOrder = thinkGate(TG_ACC, acctCreateOp("3.000 STEEM", "hive-210001"), { ...tgVerified, conf: {} });
eq("r246 accountcreate-no-order-refused", tgNoOrder.verdict, "REFUSED");
ok("r246 accountcreate-no-order-reason", (tgNoOrder.reasons[0] ?? "").includes("no operator order"));
/* b · live order + fee within cap + matching name → ALLOW */
eq("r246 accountcreate-ordered-allow", thinkGate(TG_ACC, acctCreateOp("3.000 STEEM", "hive-210001"), { ...tgVerified, conf: { policy: { operatorOrders: { account_create: goodOrder } } } }).verdict, "ALLOW");
/* c · fee above the order cap → REFUSED */
const tgFee = thinkGate(TG_ACC, acctCreateOp("7.000 STEEM", "hive-210001"), { ...tgVerified, conf: { policy: { operatorOrders: { account_create: goodOrder } } } });
eq("r246 accountcreate-fee-cap-refused", tgFee.verdict, "REFUSED");
ok("r246 accountcreate-fee-cap-reason", (tgFee.reasons[0] ?? "").includes("exceeds the operator-order cap"));
/* d · name mismatch → REFUSED (the order is bound to ONE account) */
const tgName = thinkGate(TG_ACC, acctCreateOp("3.000 STEEM", "hive-999999"), { ...tgVerified, conf: { policy: { operatorOrders: { account_create: goodOrder } } } });
eq("r246 accountcreate-name-mismatch-refused", tgName.verdict, "REFUSED");
ok("r246 accountcreate-name-mismatch-reason", (tgName.reasons[0] ?? "").includes("does not match"));
/* e · consumed order → REFUSED (single-use law; no re-arm) */
const tgUsed = thinkGate(TG_ACC, acctCreateOp("3.000 STEEM", "hive-210001"), { ...tgVerified, conf: { policy: { operatorOrders: { account_create: { ...goodOrder, used: true } } } } });
eq("r246 accountcreate-used-order-refused", tgUsed.verdict, "REFUSED");
ok("r246 accountcreate-used-order-reason", (tgUsed.reasons[0] ?? "").includes("already used"));

/* R246 · community op builders — the measured 3-community wire format */
import { accountCreateOp, setRoleOp, updatePropsOp, subscribeOp, communityPostMeta, generateAccountKeys } from "./community.mjs";
eq("r246 subscribeOp-wire", subscribeOp("hive-210001", "haran"), ["custom_json", { required_auths: [], required_posting_auths: ["haran"], id: "community", json: JSON.stringify(["subscribe", { community: "hive-210001" }]) }]);
eq("r246 setRoleOp-wire", setRoleOp("hive-210001", "headcorner", "admin"), ["custom_json", { required_auths: [], required_posting_auths: ["hive-210001"], id: "community", json: JSON.stringify(["setRole", { community: "hive-210001", account: "headcorner", role: "admin" }]) }]);
eq("r246 updatePropsOp-wire", updatePropsOp("hive-210001", { title: "T" }), ["custom_json", { required_auths: [], required_posting_auths: ["hive-210001"], id: "community", json: JSON.stringify(["updateProps", { community: "hive-210001", props: { title: "T" } }]) }]);
const acOp = accountCreateOp({ fee: "3.000 STEEM", creator: "headcorner", name: "hive-210001", keys: { owner: { pub: "STM7jA4xpCcN6Uwt6SmzK1MhTcmg7nmXrMEpiLok45GvqYLFQSSnX" }, active: { pub: "STM62FpckaXAdMmdD8abrFGhN8uE5wYm6tkUajmruJumrHNRNKfZL" }, posting: { pub: "STM8ZiWEgUYoYeQ3rWut6GKamgFsYccMCQ68QAR5WYQgvV9Aaihxb" }, memo: { pub: "STM5ncpsbHiHHhFJRZpmpQx8u5JwEjGUXmL45HRh6caC1NCZBTvwe" } } });
eq("r246 accountCreateOp-fee", acOp[1].fee, "3.000 STEEM");
eq("r246 accountCreateOp-name", acOp[1].new_account_name, "hive-210001");
ok("r246 accountCreateOp-authorities", acOp[1].owner.key_auths[0][0].startsWith("STM") && acOp[1].memo_key.startsWith("STM"));
eq("r246 communityPostMeta-contract", JSON.parse(communityPostMeta("hive-210001", ["ai", "life"])), { community: "hive-210001", tags: ["hive-210001", "ai", "life"], app: "saos-community-rail" });
const genKeys = generateAccountKeys();
ok("r246 genkeys-shape", genKeys.owner?.wif?.length >= 51 && genKeys.owner?.pub?.startsWith("STM") && genKeys.memo?.pub?.startsWith("STM") && genKeys.owner.wif !== genKeys.posting.wif && genKeys.active.wif !== genKeys.memo.wif);
eq("psm no-market reason", planConvert({ liquidSbd: 50, feedSbdPerSteem: P, marketSbdPerSteem: null, previouslyArmed: true }).reason, "no-market-parity");

/* 9 · stale classification: asks below floor / bids above ceiling (10bps tol) */
const orders = [
  { side: "ask", unit: P },                       // below floor ⇒ stale
  { side: "ask", unit: floor },                   // at floor ⇒ healthy
  { side: "bid", unit: P * 0.999 },               // above ceiling (ceiling=parity−20bps) ⇒ stale
  { side: "bid", unit: P * (1 - ASK_FLOOR_BPS / 10000) }, // at ceiling ⇒ healthy
];
const cls = classifyStale(orders, P);
eq("stale count", cls.stale.length, 2);
eq("stale sides", cls.stale.map((o) => o.side), ["ask", "bid"]);

/* 10 · P&L: avg-cost realized; unbased never profit */
const p1 = pnlFromFills([
  { side: "bid", steem: 10, sbd: 1.0 },           // avg 0.10
  { side: "ask", steem: 5, sbd: 0.6 },            // realized 0.6−0.5=+0.1
]);
eq("realized", p1.realizedSbd, 0.1);
eq("position", p1.positionSteem, 5);
const p2 = pnlFromFills([
  { side: "ask", steem: 10, sbd: 1.0 },           // no basis
]);
eq("unbased honest", p2.realizedSbd, 0);
eq("unbased qty", p2.unbasedSteem, 10);

/* 11 · guards */
eq("depth ok", guardDepth(8, 64).ok, true);
eq("depth cap", guardDepth(9, 0).reason, "depth-cap");
eq("fires cap", guardDepth(0, 65).reason, "fires-cap");

/* 12 · grid tick deterministic */
const t1 = tick({ refPrice: 0.107, internalFeed: 0.105, inventory: { steem: 10, sbd: 10 }, runCount: 0, now: "2026-01-01T00:00:00Z" }); // gap ~190bps ≥100 ⇒ arb signal
const t2 = tick({ refPrice: 0.107, internalFeed: 0.105, inventory: { steem: 10, sbd: 10 }, runCount: 0, now: "2026-01-01T00:00:00Z" });
eq("tick deterministic", t1, t2);
ok("tick emits anchor quote", t1.events.some((e) => e.type === "anchor.quote"));
ok("tick arb signal", t1.events.some((e) => e.type === "arb.signal"));
const st1 = fold({ runCount: 0 }, t1);
eq("fold runCount", st1.runCount, 1);

/* 13 · no-market fail-closed */
const t3 = tick({ refPrice: 0, internalFeed: 0, inventory: { steem: 10, sbd: 10 }, runCount: 1, now: "2026-01-01T00:00:00Z" });
ok("no-market event", t3.events.some((e) => e.type === "grid.no-market"));
eq("no-market fills", t3.fills.length, 0);

/* ── 14 · T-12 steemtx: crypto + serialization vectors (offline, throwaway seed) ── */
import { wifEncode, wifDecode, pubkeyFromSeed, serializeTx, buildTx, SEED_ORDERS, wifFor, derivePub, pubkeyBytes } from "./steemtx.mjs";
import { sha256 } from "@noble/hashes/sha256";
import * as secp from "@noble/secp256k1";

const seed32 = sha256(Buffer.from("saos-selftest-seed", "utf8"));
const wifT = wifEncode(seed32);
ok("wif roundtrip", Buffer.from(wifDecode(wifT)).equals(Buffer.from(seed32)));
ok("wif deterministic", wifEncode(seed32) === wifT);
const pubT = pubkeyFromSeed(seed32);
ok("pubkey STM format", pubT.startsWith("STM") && pubT.length === 53);
ok("pubkey bytes roundtrip", Buffer.from(pubkeyBytes(pubT)).equals(Buffer.from(secp.getPublicKey(Buffer.from(seed32), true))));
ok("seed order determinism", derivePub(SEED_ORDERS["name+role+pw"]("acc", "active", "pw")) === derivePub(SEED_ORDERS["name+role+pw"]("acc", "active", "pw")));
ok("seed order sensitivity", derivePub(SEED_ORDERS["name+role+pw"]("acc", "active", "pw")) !== derivePub(SEED_ORDERS["pw+role+name"]("acc", "active", "pw")));

const dgpoVec = { head_block_number: 92527123, head_block_id: "00bcdeff11223344556677889900aabbccddeeff" };
const txVec = buildTx({
  ops: [["limit_order_create", { owner: "headcorner", orderid: 123456, amount_to_sell: "0.001 STEEM", min_to_receive: "0.000 SBD", fill_or_kill: false, expiration: 1790000000 + 60 }]],
  dgpo: dgpoVec, wifs: [wifT], nowSec: 1790000000,
});
eq("tx ref_block_num", txVec.json.ref_block_num, 92527123 & 0xffff);
ok("tx ref_block_prefix", txVec.json.ref_block_prefix === Buffer.from("11223344", "hex").readUInt32LE(0));
eq("sig length 65B", txVec.json.signatures[0].length, 130);
ok("sig header compressed", parseInt(txVec.json.signatures[0].slice(0, 2), 16) >= 31 && parseInt(txVec.json.signatures[0].slice(0, 2), 16) <= 34);
ok("sig deterministic", buildTx({ ops: [["limit_order_create", { owner: "headcorner", orderid: 123456, amount_to_sell: "0.001 STEEM", min_to_receive: "0.000 SBD", fill_or_kill: false, expiration: 1790000000 + 60 }]], dgpo: dgpoVec, wifs: [wifT], nowSec: 1790000000 }).json.signatures[0] === txVec.json.signatures[0]);

// VESTS 6-dp: the digits themselves are the scaled uint64
const binV = serializeTx({ ref_block_num: 1, ref_block_prefix: 2, expiration: 3, operations: [["claim_reward_balance", { account: "headcorner", reward_steem: "0.000 STEEM", reward_sbd: "0.000 SBD", reward_vests: "96.123456 VESTS" }]] });
ok("vests 6dp serializes", binV.length > 40);
// cancel op deterministic size: 2+4+4 +1(opcount)+1(opid) +1+10(owner) +4(orderid) +1(ext) = 28
const binC = serializeTx({ ref_block_num: 1, ref_block_prefix: 2, expiration: 3, operations: [["limit_order_cancel", { owner: "headcorner", orderid: 42 }]] });
/* R245 node-canon: the op gained its trailing extensions varint (byte-proven
   * against condenser_api.get_transaction_hex — 28 was the pre-extensions size) */
eq("cancel op exact size", binC.length, 28);

/* vote op serializes (posting-authority op — T-13 curator rail) */
const binVote = serializeTx({ ref_block_num: 1, ref_block_prefix: 2, expiration: 3, operations: [["vote", { voter: "headcorner", author: "someone", permlink: "a-permlink", weight: 5000 }]] });
ok("vote op serializes", binVote.length > 30);
// negative weight (downvote) must serialize too — policy never emits it, chain accepts it
// (tiny names ⇒ 21 bytes total: 11 header + 1 count + 1 opid + 2+2+2 strs + 2 weight)
const binDown = serializeTx({ ref_block_num: 1, ref_block_prefix: 2, expiration: 3, operations: [["vote", { voter: "a", author: "b", permlink: "c", weight: -1000 }]] });
/* R245 node-canon: +1 byte for the op extensions varint (node-census proof) */
eq("vote negative weight size", binDown.length, 21);

/* ── 15 · T-13 curator: pure planner vectors (deterministic, offline) ── */
import { filterCandidates, weightForAge, vpEffPct, dayKeyOf, curatorPolicy } from "./curator.mjs";

const CP = curatorPolicy();
const NOW = Date.parse("2026-09-29T19:00:00Z");
const mkPost = (author, permlink, ageMin, extra = {}) => ({
  author, permlink, tag: "steem", createdMs: NOW - ageMin * 60000,
  title: `A reasonable title ${permlink}`, bodyLen: 900, pendingSbd: 0.5, archived: false, votedByUs: false, ...extra,
});
const posts = [
  mkPost("alice", "fresh", 30),
  mkPost("bob", "stale", 1300),                                    // too old
  mkPost("carol", "young", 5),                                     // too young
  mkPost("dave", "spam", 60, { bodyLen: 50 }),                     // short body
  mkPost("headcorner", "self", 60),                                // self-fleet
  mkPost("erin", "voted", 60, { votedByUs: true }),                // already voted on-chain
  mkPost("frank", "hot", 60, { pendingSbd: 99 }),                  // bandwagon
  mkPost("grace", "closed", 60, { archived: true }),               // payout closed
  mkPost("alice", "second", 60),                                   // author-cap (2nd alice)
  mkPost("heidi", "caps", 60, { title: "SCREAMING SPAM TITLE HERE" }), // spam-title
  mkPost("ivan", "ok1", 240),
  mkPost("judy", "ok2", 720),
];
const planC = filterCandidates({ posts, voter: "headcorner", policy: CP, nowMs: NOW });
eq("curator selected", planC.selected.map((v) => v.author), ["alice", "ivan", "judy"]);
eq("curator alice weight decays", planC.selected[0].weight, weightForAge(30, CP));
ok("curator fresh > old weight", planC.selected[0].weight > planC.selected[2].weight);
eq("curator weight in band", weightForAge(30, CP) <= CP.baseWeightPct * 100 && weightForAge(1300, CP) === CP.minWeightPct * 100, true);
ok("curator rejections honest", planC.rejected.some((r) => r.reason === "too-old") && planC.rejected.some((r) => r.reason === "short-body") && planC.rejected.some((r) => r.reason === "self-fleet") && planC.rejected.some((r) => r.reason === "already-voted") && planC.rejected.some((r) => r.reason === "bandwagon") && planC.rejected.some((r) => r.reason === "author-cap"));

/* day-cap: 10 already voted today ⇒ nothing new */
const capped = filterCandidates({ posts: [mkPost("kate", "late", 60)], voter: "x", policy: CP, nowMs: NOW, votesToday: 10 });
eq("curator day-cap", capped.selected.length, 0);
ok("curator day-cap reason", capped.rejected.some((r) => r.reason === "day-cap"));

/* determinism: same input twice ⇒ byte-identical plan */
const again = filterCandidates({ posts, voter: "headcorner", policy: CP, nowMs: NOW });
eq("curator deterministic", again.selected, planC.selected);

/* VP effective: mana/(vests×1e6) */
eq("vpEff math", vpEffPct(6.094470913801e12, 7123991.568646), 85.5);
eq("vpEff zero vests", vpEffPct(100, 0), null);
eq("day key", dayKeyOf("2026-09-29T19:00:00.000Z"), "2026-09-29");

/* ── 16 · T-14 learning + discovery: evidence-based lessons, hard-clamped tunings ── */
import {
  classifyCycleFailure, analyzeCycles, analyzeCurator, analyzeExec,
  deriveLessons, deriveTunings, LEARN_CLAMP,
} from "./learning.mjs";
import { rankTags, curationShareEstimate, scoreOpportunities } from "./discovery.mjs";

/* failure classification — the sovereign retry doctrine, mirrored pure */
eq("fail-class conn", classifyCycleFailure("fetch failed"), "conn");
eq("fail-class conn-reset", classifyCycleFailure("ECONNRESET while POST /cycle"), "conn");
eq("fail-class timeout", classifyCycleFailure("The operation was aborted due to timeout"), "timeout");
eq("fail-class http", classifyCycleFailure("HTTP 502 bad gateway"), "http");
eq("fail-class none", classifyCycleFailure(""), "none");
eq("fail-class unknown", classifyCycleFailure("weird thing"), "unknown");

/* cycle analytics: ok-rate + fail histogram from sovereign-events lines */
const evLines = [
  { kind: "cycle-ok(auto)", ms: 9800 },
  { kind: "cycle-error(auto)", ms: 12065, error: "fetch failed" },
  { kind: "cycle-ok(auto)", ms: 10098 },
  { kind: "cycle-fail(auto)", ms: 20000, error: "The operation was aborted due to timeout" },
  { kind: "heal-spawn", pid: 1 },           // non-cycle lines are ignored
  { kind: "cycle-ok(kick)", ms: 9000 },     // kick excluded — auto-window only
];
const cyc = analyzeCycles(evLines);
eq("cycles window", cyc.window, 4);
eq("cycles ok", cyc.oks, 2);
eq("cycles fail histogram", cyc.failReasons, { conn: 1, timeout: 1 });
eq("cycles okRate", cyc.okRate, 50);

/* lessons: evidence-based; empty history ⇒ zero invented lessons */
const lessons = deriveLessons({
  cycles: { window: 4, oks: 2, fails: 2, okRate: 50, failReasons: { conn: 2 }, msP50: 10000, msP90: 12000 },
  curator: { present: true, totalVotes: 10, window: 5, verdicts: { "DAY-CAP": 4 }, vpEff: 86, dayCapsInRow: 4, maxPerDay: 10 },
  exec: { window: 5, fails: 0, lastError: null },
});
ok("lesson conn-fail derived", lessons.some((l) => l.id === "cycle-conn-fails"));
ok("lesson daycap derived", lessons.some((l) => l.id === "curation-daycap-repeat"));
ok("lessons cite evidence", lessons.every((l) => typeof l.evidence === "string" && l.evidence.length > 10));
eq("no-invention empty", deriveLessons({ cycles: { window: 0, oks: 0, fails: 0, okRate: null, failReasons: {} }, curator: null, exec: { window: 0, fails: 0 } }).length, 0);

/* tunings: hard clamps — the learner cannot re-law itself */
const tuned = deriveTunings(lessons, { basePolicy: { baseWeightPct: 50, ageMinMinutes: 10, tags: ["steem"] }, discoveredTags: ["life", "photography"] });
ok("tuning baseWeight clamped", tuned.tunings.baseWeightPct >= LEARN_CLAMP.baseWeightPct[0] && tuned.tunings.baseWeightPct <= LEARN_CLAMP.baseWeightPct[1]);
ok("tuning evidence key present", tuned.applied.every((a) => a.because != null));
// crazy base policy (operator typo 500%) still clamps
const tunedCrazy = deriveTunings([{ id: "curation-daycap-repeat" }], { basePolicy: { baseWeightPct: 500, ageMinMinutes: 10, tags: [] }, discoveredTags: [] });
ok("tuning clamps wild input", tunedCrazy.tunings.baseWeightPct <= LEARN_CLAMP.baseWeightPct[1]);
// no-candidates lesson → ageMin may only DROP into [5,12], tags additive-only from discovery
const tunedNarrow = deriveTunings([{ id: "candidate-stream-narrow" }], { basePolicy: { baseWeightPct: 50, ageMinMinutes: 10, tags: ["a", "b", "c", "d", "e", "f", "g", "h"] }, discoveredTags: ["newtag"] });
ok("tuning ageMin bounded", tunedNarrow.tunings.ageMinMinutes === undefined || (tunedNarrow.tunings.ageMinMinutes >= 5 && tunedNarrow.tunings.ageMinMinutes <= 12));
ok("tuning tags capped at 8", tunedNarrow.tunings.tags === undefined || tunedNarrow.tunings.tags.length <= LEARN_CLAMP.tagsMax);
// zero lessons ⇒ zero tunings (nothing invented)
eq("tunings none without lessons", deriveTunings([], { basePolicy: { baseWeightPct: 50, ageMinMinutes: 10, tags: [] }, discoveredTags: ["x"] }).applied.length, 0);

/* curator analytics determinism + daycap streak */
const curAn = analyzeCurator({
  totalVotes: 12, vpEff: 85.5,
  voted: [{ ageMinutes: 31, tag: "steem" }, { ageMinutes: 45, tag: "crypto" }],
  history: [{ verdict: "VOTED" }, { verdict: "DAY-CAP" }, { verdict: "DAY-CAP" }],
});
eq("curator streak", curAn.dayCapsInRow, 2);
eq("curator meanAge", curAn.meanAgeMinutes, 38);

/* discovery: tag ranking deterministic with payout tiebreak */
const board1 = rankTags([
  { name: "beta", total_payouts: "120.500 SBD" },
  { name: "alpha", total_payouts: "120.500 SBD" },   // tie → name asc
  { name: "gamma", total_payouts: "930.250 SBD" },
  { name: "", total_payouts: "999 SBD" },            // empty tag dropped
]);
eq("tag board order", board1.map((t) => t.tag), ["gamma", "alpha", "beta"]);
eq("tag board parse", board1[0].payoutsSbd, 930.25);
ok("tag ranking deterministic", JSON.stringify(rankTags([{ name: "b", total_payouts: "2 SBD" }, { name: "a", total_payouts: "2 SBD" }])) === JSON.stringify(rankTags([{ name: "b", total_payouts: "2 SBD" }, { name: "a", total_payouts: "2 SBD" }])));

/* curation share estimator: honest ESTIMATED math + null-safety */
const est = curationShareEstimate({ rewardBalanceSteem: 9000, windowDays: 1 }, 0.00005);
eq("est math", est.estimatedSteemPerDay, Math.round((9000 * 0.00005) * 1e4) / 1e4);
ok("est labeled estimated", /ESTIMATED/.test(est.note));
eq("est null-safety", curationShareEstimate(null, 0.1), null);

/* opportunity scoring: measured > estimated > potential, all gated */
const ops = scoreOpportunities({
  tagBoard: [{ tag: "gamma", payoutsSbd: 930 }],
  depth: { ok: true, spreadBps: 19, bestAsk: 0.1033, bestBid: 0.1031 },
  vpEff: 85.5,
  curationEst: { dailyPoolSteem: 9000, voteVestsShare: 0.00005, estimatedSteemPerDay: 0.45, note: "ESTIMATED" },
  bookFills: { fills: 37, lastFillAt: new Date(Date.parse("2026-09-29T12:00:00Z")).toISOString() },
  soldiers: { deployed: true, accounts: [{ name: "hcsoldier1" }] },
});
ok("ops sorted by class", ops.findIndex((o) => o.id === "tags-realloc") < ops.findIndex((o) => o.id === "curation-share"));
ok("ops all carry class+gate", ops.every((o) => o.potentialClass && o.gate && o.evidence));
ok("wide-spread opportunity detected", scoreOpportunities({ tagBoard: [], depth: { ok: true, spreadBps: 400, bestAsk: 0.11, bestBid: 0.1 }, curationEst: null, bookFills: { fills: 0, lastFillAt: null }, soldiers: null }).some((o) => o.id === "spread-wide"));

/* T-15 · fleet classifier: deterministic liveness classes (measured, never claimed) */
const FLEET_NOW = Date.parse("2026-09-30T15:00:00Z");
eq("fleet alive-fresh", classifyAgent({ lastRunAt: "2026-09-30T14:55:00Z", nowMs: FLEET_NOW, freshnessMin: 15 }).status, "ALIVE");
eq("fleet alive-idle-verdict", classifyAgent({ lastRunAt: "2026-09-30T14:55:00Z", nowMs: FLEET_NOW, freshnessMin: 15, lastVerdict: "DAY-CAP", idleReasons: ["DAY-CAP"] }).status, "IDLE");
eq("fleet alive-but-blocked-wins", classifyAgent({ lastRunAt: "2026-09-30T14:55:00Z", nowMs: FLEET_NOW, freshnessMin: 15, blockedBy: "credential-missing" }).status, "BLOCKED");
eq("fleet stale-no-reason-is-dead", classifyAgent({ lastRunAt: "2026-09-30T13:00:00Z", nowMs: FLEET_NOW, freshnessMin: 15 }).status, "DEAD");
eq("fleet stale-with-idle-verdict-still-dead", classifyAgent({ lastRunAt: "2026-09-30T13:00:00Z", nowMs: FLEET_NOW, freshnessMin: 15, lastVerdict: "CONVERT-HOLD", idleReasons: ["CONVERT-HOLD"] }).status, "DEAD");
eq("fleet no-evidence-is-dead", classifyAgent({ lastRunAt: null, nowMs: FLEET_NOW, freshnessMin: 15 }).status, "DEAD");
eq("fleet boundary-at-window", classifyAgent({ lastRunAt: "2026-09-30T14:45:00Z", nowMs: FLEET_NOW, freshnessMin: 15 }).status, "ALIVE");
eq("fleet boundary-beyond-window", classifyAgent({ lastRunAt: "2026-09-30T14:44:00Z", nowMs: FLEET_NOW, freshnessMin: 15 }).status, "DEAD");
ok("fleet classifier carries age+blocked", (() => { const r = classifyAgent({ lastRunAt: "2026-09-30T14:50:00Z", nowMs: FLEET_NOW, freshnessMin: 15, blockedBy: "x" }); return r.ageMin === 10 && r.blockedBy === "x"; })());

/* ── 18 · T-16 cycle truth taxonomy: ok | blocked | fail (the 68.6% lie fix) ── */
import {
  cycleHealth, cycleFailureBreakdown, vpSpoilage, validateCredentialText,
} from "./lib.mjs";

eq("cycleHealth all-green", cycleHealth({ observe: { ok: true }, peg: { ok: true }, curate: { ok: true } }), "ok");
eq("cycleHealth empty", cycleHealth({}), "ok");
eq("cycleHealth only-cred-blocked", cycleHealth({
  observe: { ok: true }, curate: { ok: false, error: "CREDENTIAL-MISSING: .secrets/headcorner.key not found" },
  execute: { ok: false, error: "CREDENTIAL-MISSING: .secrets/headcorner.key not found" },
}), "blocked");
eq("cycleHealth real-fail", cycleHealth({
  observe: { ok: false, error: "fetch failed" }, curate: { ok: false, error: "CREDENTIAL-MISSING: x" },
}), "fail");
eq("cycleHealth mixed-fail", cycleHealth({
  observe: { ok: true }, peg: { ok: false, error: "HTTP 502" },
}), "fail");
const brk = cycleFailureBreakdown({
  observe: { ok: true },
  curate: { ok: false, error: "CREDENTIAL-MISSING: x" },
  execute: { ok: false, error: "CREDENTIAL-MISSING: x" },
  peg: { ok: false, error: "NO-PARITY" },
});
eq("failure breakdown blocked", brk.blockedSteps, ["curate", "execute"]);
eq("failure breakdown failed", brk.failedSteps, ["curate", "execute", "peg"]);

/* analyzeCycles: cycle-blocked counted separately — never again a fake "fail" */
const evLines16 = [
  { kind: "cycle-ok(auto)", ms: 5000 },
  { kind: "cycle-blocked(auto)", ms: 4200, blockedSteps: ["curate", "execute", "soldiers"] },
  { kind: "cycle-blocked(auto)", ms: 4300 },
  { kind: "cycle-fail(auto)", ms: 20000, error: "fetch failed" },
];
const cyc16 = analyzeCycles(evLines16);
eq("cycles16 window", cyc16.window, 4);
eq("cycles16 blocked", cyc16.blocked, 2);
eq("cycles16 fails-exclude-blocked", cyc16.fails, 1);
eq("cycles16 okRate", cyc16.okRate, 25);
eq("cycles16 blockedRate", cyc16.blockedRate, 50);
eq("cycles16 failReasons-only-real", cyc16.failReasons, { conn: 1 });
ok("lesson signing-cred-blocked derived", deriveLessons({
  cycles: { window: 3, oks: 1, fails: 0, blocked: 2, okRate: 33.3, blockedRate: 66.7, failReasons: {}, msP50: 4000, msP90: 4300 },
  curator: null, exec: { window: 0, fails: 0 },
}).some((l) => l.id === "signing-cred-blocked"));

/* vpSpoilage: measured days/votes + ESTIMATED steem (honest classes) */
const T0 = "2026-09-30T12:00:00.000Z";
const T2D = "2026-10-02T12:00:00.000Z";
const sp1 = vpSpoilage({ firstDownAt: T0, now: T2D, maxPerDay: 18, estSteemPerDay: 9.5 });
eq("spoilage 2d votes", sp1.votesForegone, 36);
eq("spoilage 2d days", sp1.daysBlocked, 2);
eq("spoilage est steem", sp1.estSteemForegone, 19);
eq("spoilage class", sp1.class, "estimated");
eq("spoilage no-estimate-class", vpSpoilage({ firstDownAt: T0, now: T2D, maxPerDay: 18 }).class, "measured");
eq("spoilage null-down", vpSpoilage({ firstDownAt: null, now: T2D, maxPerDay: 18 }), { daysBlocked: 0, votesForegone: 0, estSteemForegone: 0, class: "measured" });
eq("spoilage future-down-clamped", vpSpoilage({ firstDownAt: T2D, now: T0, maxPerDay: 18 }).votesForegone, 0);
eq("spoilage negative-cap-clamped", vpSpoilage({ firstDownAt: T0, now: T2D, maxPerDay: -5 }).votesForegone, 0);

/* validateCredentialText: pure adoption gate — shape only, never the secret */
eq("cred valid", validateCredentialText("headcorner my-master-password").ok, true);
eq("cred valid colon-form", validateCredentialText("headcorner:my-master-password").ok, true);
eq("cred valid wif-form", validateCredentialText("headcorner P5K...longkey").ok, true);
eq("cred empty", validateCredentialText(""), { ok: false, reason: "empty" });
eq("cred single-field", validateCredentialText("justapassword"), { ok: false, reason: "credential-format" });
eq("cred bad-account", validateCredentialText("!bad account pw"), { ok: false, reason: "bad-account" });
eq("cred oversize", validateCredentialText("acct " + "x".repeat(5000)), { ok: false, reason: "oversize" });
ok("cred never-echoes-secret-in-result", !JSON.stringify(validateCredentialText("headcorner sekrit-pw")).includes("sekrit-pw"));

/* ── 19 · T-17 signing-era throughput & concurrency truth (pure halves) ──── */
import {
  stickyNodeOrder, mergeVoteState, classifyMarker, countDayVotesFromHistory,
} from "./lib.mjs";

/* stickyNodeOrder: last-good first, deterministic, fault-tolerant */
eq("sticky moves-lastgood-first", stickyNodeOrder("b", ["a", "b", "c"]), ["b", "a", "c"]);
eq("sticky unknown-lastgood-unchanged", stickyNodeOrder("z", ["a", "b"]), ["a", "b"]);
eq("sticky null-lastgood-unchanged", stickyNodeOrder(null, ["a", "b"]), ["a", "b"]);
eq("sticky filters-falsy-nodes", stickyNodeOrder("b", ["a", null, "b", ""]), ["b", "a"]);
eq("sticky no-mutation-of-input", (() => { const inp = ["a", "b"]; stickyNodeOrder("b", inp); return JSON.stringify(inp); })(), JSON.stringify(["a", "b"]));

/* mergeVoteState: incremental crash-safe curator state (per landed vote) */
const DAY = "2026-09-30";
const prevEmpty = { day: null, votesToday: [], authorsToday: {}, totalVotes: 10, history: [{ at: "2026-09-29T19:45:00Z", day: "2026-09-29", verdict: "VOTED", n: 10, txid: "aa" }] };
const m1 = mergeVoteState(prevEmpty, DAY, { author: "alice", permlink: "p1", weight: 5000, at: "2026-09-30T17:00:00Z", txid: "tx1" });
eq("merge resets-votes-on-new-day", m1.votesToday.length, 1);
eq("merge keeps-totalVotes-across-days", m1.totalVotes, 11);
eq("merge appends-vote", m1.votesToday[0], { author: "alice", permlink: "p1", weight: 5000, at: "2026-09-30T17:00:00Z", txid: "tx1" });
eq("merge authors-count", m1.authorsToday, { alice: 1 });
eq("merge history-trimmed-30", m1.history.length, 2);
const m2 = mergeVoteState(m1, DAY, { author: "alice", permlink: "p2", weight: 4800, at: "2026-09-30T17:01:00Z", txid: "tx2" });
eq("merge same-day-accumulates", m2.votesToday.length, 2);
eq("merge same-author-counts", m2.authorsToday, { alice: 2 });
eq("merge totalVotes-grows", m2.totalVotes, 12);
ok("merge never-carries-yesterdays-votes", !JSON.stringify(m2.votesToday).includes("2026-09-29T19:45"));
const m3 = mergeVoteState(m2, DAY, { author: "bob", permlink: "p3", weight: 4900, at: "2026-09-30T17:02:00Z", txid: null }, "ALREADY-VOTED");
eq("merge collision-verdict-in-history", m3.history[m3.history.length - 1].verdict, "ALREADY-VOTED");
eq("merge collision-counts-for-budget", m3.totalVotes, 13);
eq("merge collision-no-txid", m3.votesToday[2].txid, null);

/* classifyMarker: the sovereign reads ENGINE truth, not an HTTP wait */
eq("marker running", classifyMarker({ running: true, startedAt: "2026-09-30T17:00:00Z" }), { state: "running", health: null });
eq("marker done-ok", classifyMarker({ running: false, health: "ok" }), { state: "done", health: "ok" });
eq("marker done-blocked", classifyMarker({ running: false, health: "blocked" }), { state: "done", health: "blocked" });
eq("marker done-fail", classifyMarker({ running: false, health: "fail" }), { state: "done", health: "fail" });
eq("marker garbage-health-is-fail", classifyMarker({ running: false, health: "weird" }), { state: "done", health: "fail" });
eq("marker absent-is-fail", classifyMarker(null), { state: "absent", health: "fail" });
eq("marker non-object-is-fail", classifyMarker("junk"), { state: "absent", health: "fail" });

/* ── 20 · T-18 chain-truth day budget (the split-brain killer, pure half) ── */
/* condenser shape: [[idx, {op:[type,value], timestamp}], …] — plus the
 * account_history_api nested shape {type,value} both accepted. */
const histRows = [
  [57200, { trx_id: "aa", timestamp: "2026-09-30T14:51:06", op: ["vote", { voter: "headcorner", author: "x1", weight: 2000 }] }],
  [57201, { trx_id: "ab", timestamp: "2026-09-30T15:52:39", op: ["vote", { voter: "headcorner", author: "x2", weight: 200 }] }],
  [57202, { trx_id: "ac", timestamp: "2026-09-30T16:00:00", op: ["fill_order", { current_owner: "headcorner" }] }],
  [57203, { trx_id: "ad", timestamp: "2026-09-30T16:30:00", op: ["vote", { voter: "someoneelse", author: "x3", weight: 5000 }] }],
  [57204, { trx_id: "ae", timestamp: "2026-09-29T19:45:00", op: ["vote", { voter: "headcorner", author: "yesterday", weight: 5000 }] }],
  [57205, { trx_id: "af", timestamp: "2026-10-01T00:00:30", op: ["vote", { voter: "headcorner", author: "tomorrow", weight: 5000 }] }],
  [57206, { trx_id: "ag", timestamp: "2026-09-30T17:00:00", op: ["custom_json", { id: "saos.weave.core.v1" }] }],
  [57207, { type: "vote", timestamp: "2026-09-30T17:05:00", value: { voter: "headcorner", author: "x4", weight: 4982 } }],
];
eq("chainDayVotes counts-ours-today-only", countDayVotesFromHistory(histRows, "headcorner", "2026-09-30"), 3);
eq("chainDayVotes other-voter-ignored", countDayVotesFromHistory(histRows, "someoneelse", "2026-09-30"), 1);
eq("chainDayVotes day-rollover-exact", countDayVotesFromHistory(histRows, "headcorner", "2026-10-01"), 1);
eq("chainDayVotes yesterday-untouched", countDayVotesFromHistory(histRows, "headcorner", "2026-09-29"), 1);
eq("chainDayVotes non-vote-ops-ignored", countDayVotesFromHistory([ [1, { timestamp: "2026-09-30T10:00:00", op: ["limit_order_create", {}] }], [2, { timestamp: "2026-09-30T10:00:01", op: ["transfer", {}] }] ], "headcorner", "2026-09-30"), 0);
eq("chainDayVotes empty-rows", countDayVotesFromHistory([], "headcorner", "2026-09-30"), 0);
eq("chainDayVotes null-rows", countDayVotesFromHistory(null, "headcorner", "2026-09-30"), null);
eq("chainDayVotes junk-rows-tolerated", countDayVotesFromHistory([null, "junk", [3, null], [4, {}]], "headcorner", "2026-09-30"), 0);
eq("chainDayVotes no-voter-null", countDayVotesFromHistory(histRows, "", "2026-09-30"), null);
eq("chainDayVotes bad-day-null", countDayVotesFromHistory(histRows, "headcorner", "x"), null);
ok(
  "lesson unclassified-fail-legacy derived",
  deriveLessons({ cycles: { window: 45, oks: 27, fails: 18, okRate: 60, blocked: 0, failReasons: { conn: 3, none: 15 }, msP50: 9691, msP90: 23051 }, curator: null, exec: { window: 0, fails: 0 } })
    .some((l) => l.id === "unclassified-fail-legacy" && l.severity === "medium")
);
ok(
  "lesson no-legacy-lesson-when-classified",
  !deriveLessons({ cycles: { window: 10, oks: 9, fails: 1, okRate: 90, blocked: 0, failReasons: { conn: 1 }, msP50: 4000, msP90: 4300 }, curator: null, exec: { window: 0, fails: 0 } })
    .some((l) => l.id === "unclassified-fail-legacy")
);

/* ── 21 · T-19 dual-tranche ladder (flow tranche at the live book front) ── */
/* backward compat: no book edges ⇒ no flow tranche, laws intact */
const p19 = planLadder({ parity: P, askBudgetSteem: 100, bidBudgetSbd: 50, now: "2026-01-01T00:00:00Z" });
eq("19 no-flow-without-book", p19.flow, null);
eq("19 no-flow-arrays", [p19.flowAsks.length, p19.flowBids.length], [0, 0]);
ok("19 value-law-intact", p19.asks.every((a) => a.unit >= (P * (1 + ASK_FLOOR_BPS / 10000)) - 1e-12));
/* with a live book: 20% flow tranche quotes AT the front, 80% keeps the floor */
const p19f = planLadder({
  parity: P, askBudgetSteem: 100, bidBudgetSbd: 50, now: "2026-01-01T00:00:00Z",
  bestBid: 0.1042, bestAsk: 0.104244, feedAnchor: 0.1041,
  flowTranchePct: 0.2, flowSpacingBps: 15, flowLevels: 4,
});
eq("19 flow-asks-4", p19f.flowAsks.length, 4);
eq("19 flow first-level ceil3-joins-front (one milli above bestAsk)", p19f.flowAsks[0]?.unit, 0.1044);
ok("19 flow-ask-real-is-sbdOut3-over-sell", p19f.flowAsks[0].unit === Math.ceil(5 * 0.104244 * 1000) / 1000 / 5);
ok("19 flow-asks-step-up", p19f.flowAsks[1].unit > p19f.flowAsks[0].unit);
ok("19 flow-asks-never-cross-best-bid", p19f.flowAsks.every((a) => a.unit > 0.1042));
ok("19 flow-asks-below-value-floor", p19f.flowAsks.every((a) => a.unit < p19f.floor));
ok("19 value-tranche-still-lawful", p19f.asks.every((a) => a.unit >= p19f.floor - 1e-12));
ok("19 flow-bids-join-within-one-steem-milli", Math.abs(p19f.flowBids[0]?.unit - 0.1042) < 0.0002);
ok("19 flow-bids-step-down", p19f.flowBids.every((b, i, arr) => i === 0 || b.unit < arr[i - 1].unit));
ok("19 flow-bids-under-ceiling", p19f.flowBids.every((b) => b.unit <= p19f.ceiling + 1e-12));
ok("19 no-self-cross", p19f.flowAsks[0].unit > p19f.flowBids[0].unit);
const faSum = p19f.flowAsks.reduce((s, a) => s + a.amountSteem, 0);
const vaSum = p19f.asks.reduce((s, a) => s + a.amountSteem, 0);
ok("19 flow-budget≤20%", faSum <= 100 * 0.2 + 1e-9);
/* dedup may collapse levels when 3bps spacing < milli-granularity (honest:
 * fewer REAL levels) — but at least two distinct levels must survive */
ok("19 flow-budget≥10% (dedup-tolerant)", faSum >= 100 * 0.1 - 1e-9);
ok("19 flow-levels-distinct", new Set(p19f.flowAsks.map((a) => a.unit)).size === p19f.flowAsks.length);
/* DEDUP LAW vector: sub-granularity spacing collapses honestly — 5-STEEM
 * levels carry 20bps-per-milli, 3bps targets merge to 2 distinct millis */
eq("19 dedup collapses-sub-granularity", planLadder({ parity: P, askBudgetSteem: 100, bidBudgetSbd: 0, now: "x", bestBid: 0.1042, bestAsk: 0.104244, feedAnchor: 0.1041, flowTranchePct: 0.2, flowSpacingBps: 3, flowLevels: 4 }).flowAsks.length, 2);
/* the chain anchor above the book ⇒ flow asks refuse to sell below the feed */
const p19a = planLadder({
  parity: P, askBudgetSteem: 100, bidBudgetSbd: 0, now: "2026-01-01T00:00:00Z",
  bestBid: 0.1042, bestAsk: 0.104244, feedAnchor: 0.1055, flowTranchePct: 0.2, flowLevels: 2,
});
eq("19 flow-ask-anchored-to-feed", p19a.flowAsks[0]?.unit, 0.1055);
/* degenerate inputs: no book, junk numbers — flow stays off, verdict honest */
eq("19 flow-off-zero-ask", planLadder({ parity: P, askBudgetSteem: 10, bidBudgetSbd: 10, bestAsk: 0, bestBid: 0.1042, now: "x" }).flow, null);
eq("19 flow-off-junk", planLadder({ parity: P, askBudgetSteem: 10, bidBudgetSbd: 10, bestAsk: "junk", bestBid: null, now: "x" }).flow, null);
ok("19 junk-verdict-still-offer", ["OFFER-READY", "OFFER-EMPTY", "OFFER-BLOCKED"].includes(planLadder({ parity: P, askBudgetSteem: 10, bidBudgetSbd: 10, bestAsk: "junk", bestBid: null, now: "x" }).verdict));

/* ── 20 · T-19b HYPER-GRID: measured RC economics + equilibrium governor ── */
import {
  RC_COSTS, rcEconomics, rcGovernor, countDayOrderOpsFromHistory,
  countDayFillsFromHistory, diffHyperTick,
} from "./lib.mjs";

/* rcEconomics: the measured probe numbers must reproduce the equilibrium */
const MAXRC = 6_138_717_856_759;
const econ = rcEconomics({ maxRc: MAXRC });
eq("econ regen 20pct", econ.regenPerDay, 1_227_743_571_351);
eq("econ pairCost", econ.pairCost, RC_COSTS.create + RC_COSTS.cancel);
ok("econ equilibrium 25k-40k ops/day (measured lung capacity)", econ.opsPerDay >= 25_000 && econ.opsPerDay <= 40_000);
eq("econ no-maxrc", rcEconomics({ maxRc: 0 }).reason, "no-max-rc");
eq("econ no-costs", rcEconomics({ maxRc: MAXRC, createCost: 0 }).reason, "no-costs");

/* rcGovernor: the equilibrium controller laws */
eq("gov no-evidence-burns-nothing", rcGovernor({ rcPct: null, maxRc: MAXRC }).pairs, 0);
eq("gov rc-floor-zero", rcGovernor({ rcPct: 20, floorPct: 25, maxRc: MAXRC }).reason, "rc-floor");
const gBurst = rcGovernor({ rcPct: 100, floorPct: 25, setpointPct: 50, burst: 3, tickMs: 3000, maxRc: MAXRC, opsDayCap: 32000, opsToday: 0 });
eq("gov headroom-clamped-to-burst", gBurst.headroom, 3);
const gMid = rcGovernor({ rcPct: 50, floorPct: 25, setpointPct: 50, burst: 3, tickMs: 3000, maxRc: MAXRC, opsDayCap: 32000, opsToday: 0 });
ok("gov setpoint≈equilibrium (≤3 pairs/3s ≈ regen)", gMid.pairs >= 0 && gMid.pairs <= 3);
const gCap = rcGovernor({ rcPct: 100, maxRc: MAXRC, opsDayCap: 100, opsToday: 99, tickMs: 3000 });
eq("gov cap-remaining-binds", gCap.reason, "ops-day-cap");
const gOpCap = rcGovernor({ rcPct: 99.9, maxRc: MAXRC, maxOpsPerTick: 4, tickMs: 3000, opsDayCap: 32000 });
ok("gov op-cap-binds (≤2 pairs)", gOpCap.pairs <= 2);

/* countDayOrderOpsFromHistory: T-18 chain-truth law applied to order ops */
const orderRows = [
  [1, { timestamp: "2026-09-30T09:00:00", op: ["limit_order_create", { owner: "headcorner", orderid: 1 }] }],
  [2, { timestamp: "2026-09-30T09:00:01", op: ["limit_order_create", { owner: "headcorner", orderid: 2 }] }],
  [3, { timestamp: "2026-09-30T09:00:02", op: ["limit_order_cancel", { owner: "headcorner", orderid: 1 }] }],
  [4, { timestamp: "2026-09-30T09:00:03", op: ["vote", { voter: "headcorner" }] }],
  [5, { timestamp: "2026-09-30T09:00:04", op: ["limit_order_create", { owner: "secondsigner", orderid: 9 }] }],
  [6, { timestamp: "2026-09-29T23:59:59", op: ["limit_order_cancel", { owner: "headcorner", orderid: 0 }] }],
  [7, { timestamp: "2026-10-01T00:00:01", op: ["limit_order_create", { owner: "headcorner", orderid: 3 }] }],
  [8, { timestamp: "2026-09-30T09:01:00", type: "limit_order_cancel", value: { owner: "headcorner", orderid: 2 } }],
];
eq("orderOps counts ours-today", countDayOrderOpsFromHistory(orderRows, "headcorner", "2026-09-30"), { creates: 2, cancels: 2, total: 4 });
eq("orderOps other-owner-ignored", countDayOrderOpsFromHistory(orderRows, "secondsigner", "2026-09-30"), { creates: 1, cancels: 0, total: 1 });
eq("orderOps rollover-exact", countDayOrderOpsFromHistory(orderRows, "headcorner", "2026-10-01"), { creates: 1, cancels: 0, total: 1 });
eq("orderOps yesterday-untouched", countDayOrderOpsFromHistory(orderRows, "headcorner", "2026-09-29"), { creates: 0, cancels: 1, total: 1 });
eq("orderOps nested-shape", countDayOrderOpsFromHistory([{ timestamp: "2026-09-30T10:00:00", type: "limit_order_create", value: { owner: "headcorner" } }], "headcorner", "2026-09-30"), { creates: 1, cancels: 0, total: 1 });
eq("orderOps vote-not-order", countDayOrderOpsFromHistory([[4, { timestamp: "2026-09-30T09:00:03", op: ["vote", { voter: "headcorner" }] }]], "headcorner", "2026-09-30"), { creates: 0, cancels: 0, total: 0 });
eq("orderOps empty-rows", countDayOrderOpsFromHistory([], "headcorner", "2026-09-30"), { creates: 0, cancels: 0, total: 0 });
eq("orderOps null-rows", countDayOrderOpsFromHistory(null, "headcorner", "2026-09-30"), null);
eq("orderOps junk-tolerated", countDayOrderOpsFromHistory([null, "junk", [3, null], [4, {}], [5, { timestamp: "2026-09-30T09:00:03", op: ["limit_order_cancel", { owner: "headcorner" }] }]], "headcorner", "2026-09-30"), { creates: 0, cancels: 1, total: 1 });
eq("orderOps bad-owner-null", countDayOrderOpsFromHistory(orderRows, "", "2026-09-30"), null);
eq("orderOps bad-day-null", countDayOrderOpsFromHistory(orderRows, "headcorner", "x"), null);

/* countDayFillsFromHistory: the honest trade journal (both sides, 3dp) */
const fillRows = [
  [1, { timestamp: "2026-09-30T10:00:00", op: ["fill_order", { current_owner: "headcorner", open_owner: "buyer1", current_pays: "10.000 STEEM", open_pays: "1.042 SBD" }] }],
  [2, { timestamp: "2026-09-30T10:05:00", op: ["fill_order", { current_owner: "headcorner", open_owner: "seller2", current_pays: "0.500 SBD", open_pays: "4.800 STEEM" }] }],
  [3, { timestamp: "2026-09-30T10:06:00", op: ["fill_order", { current_owner: "x", open_owner: "y", current_pays: "5.000 STEEM", open_pays: "0.520 SBD" }] }],
  [4, { timestamp: "2026-09-29T23:00:00", op: ["fill_order", { current_owner: "headcorner", open_owner: "buyer1", current_pays: "1.000 STEEM", open_pays: "0.104 SBD" }] }],
  [5, { timestamp: "2026-09-30T10:07:00", op: ["transfer", { from: "headcorner", amount: "1.000 STEEM" }] }],
];
eq("fills ours-both-sides", countDayFillsFromHistory(fillRows, "headcorner", "2026-09-30"), { fills: 2, steemIn: 4.8, steemOut: 10, sbdIn: 1.042, sbdOut: 0.5 });
eq("fills rollover-exact", countDayFillsFromHistory(fillRows, "headcorner", "2026-09-29"), { fills: 1, steemIn: 0, steemOut: 1, sbdIn: 0.104, sbdOut: 0 });
eq("fills other-day-untouched", countDayFillsFromHistory(fillRows, "headcorner", "2026-10-02"), { fills: 0, steemIn: 0, steemOut: 0, sbdIn: 0, sbdOut: 0 });
eq("fills null-rows", countDayFillsFromHistory(null, "headcorner", "2026-09-30"), null);
eq("fills junk-tolerated", countDayFillsFromHistory([null, "junk", [9, {}]], "headcorner", "2026-09-30"), { fills: 0, steemIn: 0, steemOut: 0, sbdIn: 0, sbdOut: 0 });
eq("fills bad-account-null", countDayFillsFromHistory(fillRows, "", "2026-09-30"), null);

/* diffHyperTick: dedup/TTL/replacement laws of the minimal honest diff */
const PLANNED = [
  { side: "ask", unit: 0.104244, amountSteem: 3.9 },
  { side: "ask", unit: 0.104442, amountSteem: 3.9 },
];
const LIVE = (o = {}) => ({ orderid: 2_100_000_001, side: "ask", unit: 0.104244, createdAtMs: 0, ...o });
const dHold = diffHyperTick({ planned: PLANNED, live: [LIVE(), LIVE({ orderid: 2_100_000_002, unit: 0.104442 })], epsBps: 2, ttlMs: 60_000, nowMs: 10_000 });
eq("diff unchanged-young-matching", dHold.unchanged, true);
const dMove = diffHyperTick({ planned: PLANNED, live: [LIVE({ unit: 0.1047 })], epsBps: 2, ttlMs: 60_000, nowMs: 10_000 });
eq("diff drift-cancel", dMove.cancelIds, [2_100_000_001]);
eq("diff drift-creates-both", dMove.creates.length, 2);
const dTtl = diffHyperTick({ planned: PLANNED, live: [LIVE(), LIVE({ orderid: 2_100_000_002, unit: 0.104442 })], epsBps: 2, ttlMs: 60_000, nowMs: 61_000 });
eq("diff ttl-cancels-all-aged", dTtl.cancelIds, [2_100_000_001, 2_100_000_002]);
eq("diff ttl-replaces-both", dTtl.creates.length, 2);
const dEps = diffHyperTick({ planned: [{ side: "ask", unit: 0.104244 }], live: [LIVE({ unit: 0.10425 })], epsBps: 2, ttlMs: 60_000, nowMs: 10_000 });
eq("diff within-eps-holds (2bps≈0.104244×2e-4)", dEps.unchanged, true);
const dEmpty = diffHyperTick({ planned: [], live: [LIVE()], epsBps: 2, ttlMs: 60_000, nowMs: 10_000 });
eq("diff empty-plan-cancels-live", dEmpty.cancelIds, [2_100_000_001]);
ok("diff ids-immutable-input", (() => { const live = [LIVE()]; diffHyperTick({ planned: [], live, epsBps: 2, ttlMs: 0, nowMs: 0 }); return live[0].orderid === 2_100_000_001; })());

/* ═════ T-21 · IDENTITY-INTEGRITY: doctrine account, adopt gate, RC anomaly ═════ */
eq("doctrine env-wins", doctrineAccount("hc2"), "hc2");
eq("doctrine default", doctrineAccount(""), "headcorner");
eq("doctrine file-NEVER-wins (the proven hijack)", doctrineAccount(undefined, "testuser"), "headcorner");
eq("gate same-account-allowed", credentialGate("headcorner", "headcorner").allow, true);
ok("gate foreign-refused", credentialGate("testuser", "headcorner").allow === false);
ok("gate foreign-reason-names-both", /testuser.*headcorner|headcorner.*testuser/.test(credentialGate("testuser", "headcorner").reason ?? ""));
ok("gate empty-account-refused", credentialGate("", "headcorner").allow === false);
ok("rcAnomaly first-read-ok", rcAnomaly(null, 6.1e12) === false);
ok("rcAnomaly stable-ok", rcAnomaly(6.1e12, 6.14e12) === false);
ok("rcAnomaly 10x-drop-blocks", rcAnomaly(6.1e12, 6.1e10) === true);
ok("rcAnomaly no-evidence-blocks", rcAnomaly(6.1e12, 0) === true);
ok("rcAnomaly growth-never-anomaly", rcAnomaly(6.1e12, 6.1e13) === false);

/* ═════ T-21 · RECRUITER: a role exists only with named evidence ═════ */
const full = recruitRoles({ evidence: { marketPulse: "m", rcEconomics: "r", fillAudit: "f", convert: "c", promo: "p", curation: "cu", selftest: "s", recruiter: "x", webIntel: "w", payouts: "py", weave: "wv" }, now: "2026-10-01T22:00:00Z", prior: {} });
eq("recruit full-verdict", full.verdict, "FULL-STRENGTH");
eq("recruit full-count", full.active, 11);
ok("recruit rows-carry-truth-contract", full.roster.every((r) => typeof r.truthContract === "string" && r.truthContract.length > 8));
ok("recruit rows-carry-evidence", full.roster.every((r) => r.status !== "active" || (r.evidence ?? "").length > 0));
const partial = recruitRoles({ evidence: { recruiter: "x", curation: "cu" }, now: "2026-10-01T22:00:00Z", prior: {} });
eq("recruit partial-verdict", partial.verdict, "RECRUITED");
eq("recruit partial-count", partial.active, 2);
ok("recruit missing-role-planned", partial.roster.find((r) => r.id === "market-analyst").status === "planned");
const demoted = recruitRoles({ evidence: { recruiter: "x" }, now: "2026-10-01T23:00:00Z", prior: partial });
ok("recruit stale-role-demoted", demoted.roster.find((r) => r.id === "curation-steward").status === "planned" && demoted.roster.find((r) => r.id === "curation-steward").priorStatus === "active");
ok("recruit recruitedAt-preserved", demoted.roster.find((r) => r.id === "curation-steward").recruitedAt === "2026-10-01T22:00:00Z");

/* ═════ T-22 · WEB-INTEL: no-source findings are not findings ═════ */
const rawIntel = [
  { url: "https://example.com/a", name: "Real finding", snippet: "s", host_name: "example.com", date: "2026-10-01" },
  { url: "https://example.com/b", name: "Second real finding", snippet: "s2", host_name: "example.com", date: "2026-10-01" },
  { url: "not-a-url", name: "bad url dropped" },
  null,
  { title: "no url dropped" },
];
const norm = normalizeWebIntel({ results: rawIntel, query: "q", fetchedAt: "2026-10-01T22:00:00Z" });
eq("webintel good-kept", norm.count, 2);
eq("webintel junk-dropped", norm.dropped, 3);
ok("webintel fields-cut", norm.findings[0].url === "https://example.com/a" && norm.findings[0].host === "example.com");
eq("webintel empty-input", normalizeWebIntel({ results: "junk" }).count, 0);
const freshOk = webIntelFresh({ fetchedAt: "2026-10-01T22:00:00Z", findings: norm.findings }, Date.parse("2026-10-02T00:00:00Z"));
ok("webintel fresh-2h", freshOk != null && freshOk.findings === 2);
ok("webintel stale-null", webIntelFresh({ fetchedAt: "2026-09-01T00:00:00Z", findings: norm.findings }, Date.parse("2026-10-02T00:00:00Z")) === null);
ok("webintel empty-findings-null", webIntelFresh({ fetchedAt: "2026-10-01T22:00:00Z", findings: [] }, Date.parse("2026-10-02T00:00:00Z")) === null);
ok("webintel scans-shape-counts", webIntelFresh({ fetchedAt: "2026-10-01T22:00:00Z", scans: [{ findings: norm.findings }, { findings: [null, { url: "https://x.y/c", title: "third" }] }] }, Date.parse("2026-10-02T00:00:00Z"))?.findings === 3);

/* ═════ T-22 · CONTENT OPS: the exposure law is enforced in pure code ═════ */
const goodDraft = sanitizeDraft({ title: "How RC economics shapes Steem trading tools", body: "x ".repeat(320), tags: ["steem", "rc", "trading"], angle: "educational" });
ok("content valid-draft-passes", goodDraft != null && goodDraft.tags.length === 3);
ok("content tags-normalized", sanitizeDraft({ title: "A title long enough here", body: "x ".repeat(320), tags: ["STEEM!", "Trading"] })?.tags.join(",") === "steem,trading");
ok("content stub-blocked", sanitizeDraft({ title: "short", body: "x", tags: ["a", "b"] }) === null);
ok("content too-few-tags-blocked", sanitizeDraft({ title: "A title long enough here", body: "x".repeat(150), tags: ["onlyone"] }) === null);
ok("content exposure-headcorner-blocked", sanitizeDraft({ title: "How headcorner trades the SBD book", body: "x".repeat(200), tags: ["a", "b"] }) === null);
ok("content exposure-army-blocked", sanitizeDraft({ title: "Our multi-account coordination story", body: "x".repeat(200), tags: ["a", "b"] }) === null);
ok("content exposure-profit-blocked", sanitizeDraft({ title: "Guaranteed profit method inside", body: "x".repeat(200), tags: ["a", "b"] }) === null);
ok("content null-input", sanitizeDraft(null) === null);

/* ═════ R243 · CONVERSATION INTELLIGENCE: no template praise, no echoes,
 * no self-monologues, no closed loops, no old stock — all in pure code ═════ */
ok("r243 template-opener-blocked", sanitizeReply("That's a great point about delegation economics! I really enjoyed how you explained the reward curve.") === null);
ok("r243 template-agree-blocked", sanitizeReply("I completely agree with what you said here, it mirrors my own experience with scheduling tools.") === null);
ok("r243 thanks-opener-blocked", sanitizeReply("Thanks for sharing this perspective on patience; it changed how I see slow work.") === null);
ok("r243 substantive-passes", sanitizeReply("The reward curve detail caught me off guard when I first tracked my own payouts. Did the timing shift change how you schedule?") !== null);
ok("r243 roster-name-blocked", sanitizeReply("When wog writes about tools the examples always land well for me.") === null);
ok("r243 too-short-blocked", sanitizeReply("nice one") === null);
ok("r243 similarity-identical", textSimilarity("the reward curve changed how I schedule posts", "the reward curve changed how I schedule posts") === 1);
ok("r243 similarity-unrelated", textSimilarity("the reward curve changed how I schedule posts", "cold morning air makes the walk feel shorter") < 0.05);
const saidToday = ["The reward curve detail caught me off guard when I first tracked my own payouts this month."];
ok("r243 repeat-fresh-veto", replyFresh("The reward curve detail caught me off guard when I first tracked my payouts last week.", saidToday) === false);
ok("r243 new-idea-passes", replyFresh("Cold mornings make my walking route feel half as long as it really is.", saidToday) === true);
ok("r243 freshness-empty-safe", replyFresh("", saidToday) === false);
const coldCandidates = [
  { key: "a/1", author: "a", permlink: "1", title: "t1", excerpt: "e", children: 12 },
  { key: "b/2", author: "b", permlink: "2", title: "t2", excerpt: "e", children: 3 },
  { key: "c/3", author: "c", permlink: "3", title: "t3", excerpt: "e", children: 3 },
];
ok("r243 cold-pick-least-commented", pickColdPost(coldCandidates, { seedNum: 0, index: 0 })?.key === "b/2");
ok("r243 cold-pick-rotates-in-tier", pickColdPost(coldCandidates, { seedNum: 0, index: 1 })?.key === "c/3");
ok("r243 cold-pick-excludes-seen", pickColdPost(coldCandidates, { seedNum: 0, index: 0, excludeKeys: ["b/2"] })?.key === "c/3");
ok("r243 cold-pick-empty-null", pickColdPost(coldCandidates, { seedNum: 0, excludeKeys: ["a/1", "b/2", "c/3"] }) === null);
ok("r243 old-stock-ineligible", eligibleDrafts([{ status: "drafted", draftedAt: "2026-10-01T22:20:24.431Z", id: "old" }]).length === 0);
ok("r243 eligible-since-anchored", PUBLISH_ELIGIBLE_SINCE === "2026-10-07T10:00:00.000Z");
ok("r243 new-stock-eligible", eligibleDrafts([{ status: "drafted", draftedAt: "2026-10-07T10:36:23.592Z", id: "new" }]).length === 1);
ok("r243 published-never-eligible", eligibleDrafts([{ status: "published", draftedAt: "2026-10-07T11:00:00.000Z", id: "spent" }]).length === 0);
const r243sched = buildDaySchedule(12345);
ok("r243 schedule-has-community-lane", r243sched.some((s) => s.kind === "community-comment"));
ok("r243 schedule-has-deepen-lane", r243sched.some((s) => s.kind === "deepen"));
ok("r243 schedule-deterministic", JSON.stringify(buildDaySchedule(12345)) === JSON.stringify(r243sched));

/* ═════ T-21 · MULTI-RAIL ECONOMICS: totals never merge across classes ═════ */
const econRails = aggregateRails({
  realizedSbdTotal: 3.0, realizedWindowDays: 7, sbdUsd: 0.64, steemUsd: 0.065,
  curationEstSteemPerDay: 9.68, convertEdgeBps: 6409, convertAmountSbd: 0, convertVerdict: "CONVERT-HOLD",
  promoPostsPerDay: 1, promoEstUsdPerPost: null, fuelUsdPerDay: 0.2, hyperOpsPerDay: 32086, parity: 0.1,
});
ok("econ measured-mm", econRails.rails.find((r) => r.id === "market-making").measuredUsdPerDay != null);
ok("econ curation-estimated", econRails.rails.find((r) => r.id === "curation").confidence === "estimated");
ok("econ convert-blocked-honest", econRails.rails.find((r) => r.id === "convert-arb").confidence === "blocked");
ok("econ hyper-presence-not-priced", econRails.rails.find((r) => r.id === "hyper-presence").measuredUsdPerDay === null);
ok("econ totals-separate", econRails.totalMeasuredUsdPerDay !== econ.totalEstUsdPerDay);
ok("econ measured-never-inflated-by-est", econRails.totalMeasuredUsdPerDay === Math.round(3 / 7 * 0.64 * 1e6) / 1e6);
const econNoData = aggregateRails({});
ok("econ empty-all-blocked", econNoData.blockedCount === econNoData.rails.length && econNoData.totalMeasuredUsdPerDay === 0 && econNoData.totalEstUsdPerDay === 0);
ok("econ junk-tolerated", aggregateRails({ realizedSbdTotal: "x", curationEstSteemPerDay: NaN }).rails.find((r) => r.id === "market-making").measuredUsdPerDay === null);

/* op shape law: the false-zero bug class, locked (measured live 2026-10-02:
 * account_history_api returns "vote_operation", condenser returns "vote") */
eq("opTypeName ah-shape", opTypeName({ type: "vote_operation", value: {} }), "vote");
eq("opTypeName condenser-shape", opTypeName(["curation_reward", {}]), "curation_reward");
eq("opTypeName junk", opTypeName(null), "");
eq("opTypeName no-suffix", opTypeName({ type: "transfer", value: {} }), "transfer");

/* ═════ T-23 · המדידה-הכלכלית-האמיתית + הגוף-האחד-החיצוני ═════ */

/* payout window: the T-18c clock */
const pw = payoutWindow({ firstVoteDay: "2026-09-30", now: "2026-10-01T00:00:00Z" });
ok("payout pre-phase-6d", pw.phase === "pre-payout" && pw.payoutDay === "2026-10-07" && pw.daysRemaining === 6);
ok("payout paid-phase", payoutWindow({ firstVoteDay: "2026-09-30", now: "2026-10-08T00:00:00Z" }).phase === "paid-window");
const pwPaid = payoutWindow({ firstVoteDay: "2026-09-30", now: "2026-10-08T00:00:00Z" });
ok("payout paid-non-negative", pwPaid.msRemaining === 0 && pwPaid.daysRemaining === 0);
ok("payout null-inputs", payoutWindow({ firstVoteDay: null, now: "2026-10-01" }) === null && payoutWindow({ firstVoteDay: "junk", now: "junk" }) === null);

/* reward history rollup: empty = honest blocked; rows = measured */
const rollupEmpty = rewardHistoryRollup({ rows: [] });
ok("rollup empty-blocked", rollupEmpty.opsCount === 0 && rollupEmpty.confidence === "blocked" && rollupEmpty.curationUsdPerDay === null);
const rewardRows = [
  [1, { op: ["curation_reward", { reward: "100.000000 VESTS" }], timestamp: "2026-10-07T12:00:00" }],
  [2, { op: ["curation_reward", { reward: "50.000000 VESTS" }], timestamp: "2026-10-08T12:00:00" }],
  [3, { op: ["author_reward", { sbd_payout: "2.000 SBD", steem_payout: "0.000 STEEM", vesting_payout: "10.000000 VESTS" }], timestamp: "2026-10-08T13:00:00" }],
  [4, { op: ["claim_reward_balance", { reward_steem: "1.000 STEEM" }], timestamp: "2026-10-08T14:00:00" }],
  [5, { op: ["transfer", { amount: "9.999 STEEM" }], timestamp: "2026-10-08T15:00:00" }], // non-reward row — ignored
  ["junk", null],
];
const rollup = rewardHistoryRollup({ rows: rewardRows, vestsToSteem: 0.5, steemUsd: 0.065, sbdUsd: 0.64 });
ok("rollup sums-measured", rollup.opsCount === 4 && rollup.curationVests === 150 && rollup.authorSbd === 2 && rollup.claims === 1);
ok("rollup vests-converted", rollup.curationUsdPerDay != null && rollup.windowDays >= 2 && rollup.confidence === "measured");
ok("rollup junk-tolerant", rewardHistoryRollup({ rows: "junk" }).opsCount === 0 && rewardHistoryRollup({ rows: [null, [1, {}]] }).opsCount === 0);

/* VP probe (T-18e) */
const vp = vpNow({ currentMana: 75000000000, maxMana: 100000000000, vests: "1000 VESTS", now: "2026-10-02T00:00:00Z" });
ok("vp pct+hrs", vp.pct === 75 && vp.hrsToFull === 30);
ok("vp junk-null", vpNow({ currentMana: "x", maxMana: 0 }) === null);

/* X-2 spectrum (T-18f): the capital path to the target */
const x2 = x2Spectrum({ currentUsdPerDay: 4.18, targetUsdPerDay: 1000, currentSp: 4034 });
ok("x2 factor", x2.factor === 239.3);
ok("x2 rows-reach", x2.rows.at(-1).reachesTarget === true && x2.rows[0].mult === 1 && x2.rows[0].usdPerDay === 4.18);
ok("x2 sp-scales", x2.rows[1].sp === 40340);
ok("x2 null-guards", x2Spectrum({ currentUsdPerDay: 0, currentSp: 100 }) === null && x2Spectrum({ currentUsdPerDay: 5, currentSp: null }) === null && x2Spectrum({ currentUsdPerDay: "x", currentSp: 1 }) === null);

/* weave arbitration + freshness (T-19f v1) */
const arb = weaveArbitration({ ourVotesToday: 10, theirVotesToday: 5, sharedDayCap: 18, ourOrderCount: 8, theirOrderCount: 3 });
ok("weave combined+remaining", arb.combined === 15 && arb.capRemaining === 3);
ok("weave cap-floored", weaveArbitration({ ourVotesToday: 20, theirVotesToday: 5, sharedDayCap: 18 }).capRemaining === 0);
ok("weave junk-votes", weaveArbitration({ ourVotesToday: "x", theirVotesToday: null }).voteLanes.ours === 0);
const wfFile = { protocol: "saos.weave.core.v1", observedAt: "2026-10-02T00:00:00Z", theirs: { votesToday: 4 } };
ok("weave fresh-ok", weaveFresh(wfFile, Date.parse("2026-10-02T06:00:00Z"))?.theirVotesToday === 4);
ok("weave stale-null", weaveFresh(wfFile, Date.parse("2026-10-04T00:00:00Z")) === null);
ok("weave protocol-gate", weaveFresh({ protocol: "other.v1", observedAt: "2026-10-02T00:00:00Z" }, Date.parse("2026-10-02T01:00:00Z")) === null);

/* measured curation wins over estimated in the rails (the estimated→measured flip) */
const econMeasured = aggregateRails({ curationEstSteemPerDay: 9.68, curationMeasuredUsdPerDay: 0.73, steemUsd: 0.065 });
const curRail = econMeasured.rails.find((r) => r.id === "curation");
ok("econ curation-measured-wins", curRail.confidence === "measured" && curRail.measuredUsdPerDay === 0.73 && curRail.estUsdPerDay === null);

/* the roster grew with evidence-bound stations (9 → 11) */
const roster23 = recruitRoles({ evidence: { payouts: "fresh", weave: "fresh", recruiter: "self" }, now: "2026-10-02T00:00:00Z" });
ok("roster 11-total", roster23.total === 11);
ok("roster payout-auditor-active", roster23.roster.find((r) => r.id === "payout-auditor")?.status === "active");
ok("roster weave-ambassador-active", roster23.roster.find((r) => r.id === "weave-ambassador")?.status === "active");
const roster23NoEvidence = recruitRoles({ evidence: { recruiter: "self" }, now: "2026-10-02T00:00:00Z" });
ok("roster new-stations-planned-without-evidence", roster23NoEvidence.roster.filter((r) => ["payout-auditor", "weave-ambassador"].includes(r.id)).every((r) => r.status === "planned"));

/* ── R234: property-based fuzz (seeded, deterministic) ─────────────────────
 * 100 random vectors × invariant classes, mulberry32 fixed seed — reproducible.
 * P1 verdict domain · P2 exact doctrine math · P3 never-above-share · P4 no-lying-PLAN
 * P5 3dp broadcastable · P6 at-floor ⇒ HOLD/0 · P7 hostile-in no-crash/no-leak · P8 determinism */
{
  let s = 0x5a05;
  const rnd = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const f3 = (x) => Math.floor((x + 1e-9) * 1000) / 1000;
  const fin = (x) => typeof x === "number" && isFinite(x);
  const DOM = ["REDEPLOY-PLAN", "REDEPLOY-HOLD", "REDEPLOY-BLOCKED"];
  let p1 = true, p2 = true, p3 = true, p4 = true, p5 = true, p6 = true, p7 = true, p8 = true;
  for (let i = 0; i < 100; i++) {
    const v = { liquidSteem: +(rnd() * 200 - 10).toFixed(3), liquidSbd: +(rnd() * 50).toFixed(3), buyBookPct: 0.5, powerUpPct: 0.3, reservePct: 0.2, liquidSteemFloor: 5, liquidSbdFloor: 0.5, minPowerUpSteem: 5, now: "2026-10-07T00:00:00.000Z" };
    const a = planRedeploy(v), b = planRedeploy(v);
    const excess = Math.max(0, v.liquidSteem - 5), want = f3(excess * 0.3), thr = Math.max(5, 0.001);
    p1 &&= DOM.includes(a.verdict);
    p2 &&= Math.abs(a.powerUpSteem - want) <= 1e-9;
    p3 &&= a.powerUpSteem <= excess * 0.3 + 1e-6;
    p4 &&= (a.verdict === "REDEPLOY-PLAN") === (a.powerUpSteem >= thr);
    p5 &&= Math.abs(a.powerUpSteem - Math.round(a.powerUpSteem * 1000) / 1000) <= 1e-9;
    p6 &&= (v.liquidSteem <= 5 ? a.verdict === "REDEPLOY-HOLD" && a.powerUpSteem === 0 : true);
    p8 &&= JSON.stringify(a) === JSON.stringify(b);
    for (const h of [NaN, Infinity, -Infinity, "x", {}, [], -1]) {
      const r = planRedeploy({ ...v, liquidSteem: h });
      p7 &&= DOM.includes(r.verdict) && fin(r.powerUpSteem) && fin(r.excessSteem);
    }
  }
  ok("fuzz P1 verdict-domain (100 vectors)", p1);
  ok("fuzz P2 exact-doctrine-math", p2);
  ok("fuzz P3 never-above-share", p3);
  ok("fuzz P4 no-lying-PLAN", p4);
  ok("fuzz P5 3dp-broadcastable", p5);
  ok("fuzz P6 at-floor-holds-zero", p6);
  ok("fuzz P7 hostile-no-crash-no-leak (700 inputs)", p7);
  ok("fuzz P8 deterministic", p8);
}

/* ── R235: pacing-state rebuild from the events journal (torn-write healing) */
{
  const T = "2026-10-07";
  const pu = (at) => ({ type: "redeploy.powerup-op", at, amountSteem: 5 });
  const empty = rebuildPacingFromEvents([], T);
  ok("rs-rebuild empty-journal", empty.powerUpsToday === 0 && empty.lastPowerUpAt === null && empty.rebuilt === "journal");
  const mixed = rebuildPacingFromEvents([pu("2026-10-07T00:13:06Z"), pu("2026-10-06T23:59:59Z"), { type: "redeploy.planned", at: "2026-10-07T01:00:00Z" }, null, "junk", pu("2026-10-07T01:25:00Z"), pu("2026-10-05T10:00:00Z"), { type: "redeploy.powerup-op", at: "not-a-date" }], T);
  ok("rs-rebuild mixed-journal", mixed.powerUpsToday === 2 && mixed.lastPowerUpAt === "2026-10-07T01:25:00Z");
  const unordered = rebuildPacingFromEvents([pu("2026-10-07T05:00:00Z"), pu("2026-10-07T01:00:00Z"), pu("2026-10-07T03:00:00Z")], T);
  ok("rs-rebuild order-independent", unordered.lastPowerUpAt === "2026-10-07T05:00:00Z" && unordered.powerUpsToday === 3);
  const hostile = rebuildPacingFromEvents(null, T);
  ok("rs-rebuild non-array-fail-closed", hostile.rebuilt === "fail-closed" && hostile.powerUpsToday === 0);
  const allYesterday = rebuildPacingFromEvents([pu("2026-10-06T10:00:00Z"), pu("2026-10-06T20:00:00Z")], T);
  ok("rs-rebuild yesterday-not-counted", allYesterday.powerUpsToday === 0 && allYesterday.lastPowerUpAt === null);
  /* the healed state must actually BLOCK the interval law right after a power-up */
  const healed = rebuildPacingFromEvents([pu(new Date(Date.now() - 60_000).toISOString())], new Date().toISOString().slice(0, 10));
  const healedSince = Math.round((Date.now() - Date.parse(healed.lastPowerUpAt)) / 1000);
  ok("rs-rebuild healed-state-blocks-interval", healed.powerUpsToday === 1 && redeployPacing({ verdict: "REDEPLOY-PLAN", sinceLastSec: healedSince, powerUpsToday: healed.powerUpsToday, minIntervalSec: 3600, maxPerDay: 12 }).verdict === "interval");
}

/* ═══════════ R237 · ARCHITECTURE ROUND ═══════════ */

/* R237-A · signalDigest: sim artifacts NEVER reach the live bus */
{
  const ev = [
    { type: "grid.tick", at: "t" },
    { type: "grid.fill", real: false, at: "t" },
    { type: "arb.signal", gapBps: 190, dir: "sell-external", at: "t" },
    { type: "fee.spawn", mu: 500, at: "t" },
    { type: "sweep.scan", at: "t" },
    { type: "anchor.quote", at: "t" },
  ];
  const d = signalDigest(ev);
  ok("signalDigest drops sim fills+fees", d.signals.length === 4 && d.retiredFills === 2);
  ok("signalDigest kinds counted", d.kinds["grid.tick"] === 1 && d.kinds["anchor.quote"] === 1);
  eq("signalDigest arb extracted", d.arbSignal, { gapBps: 190, dir: "sell-external" });
  const dEmpty = signalDigest(null);
  ok("signalDigest hostile-null safe", dEmpty.signals.length === 0 && dEmpty.retiredFills === 0 && dEmpty.arbSignal === null);
  const d2 = signalDigest(ev);
  eq("signalDigest deterministic", JSON.stringify(d), JSON.stringify(d2));
}

/* R237-A · measuredLayers: presence from REAL artifacts only, never a constant */
{
  const layers = measuredLayers({
    ourOrders: [{ id: 1, tranche: "value" }, { id: 2, tranche: "flow" }, { id: 3, tranche: "hyper" }, 4],
    hyper: { enabled: true, opsToday: 7 },
    soldiersVerified: 2,
  });
  eq("layers value+plain-id counted", layers[0].levels, 2);
  eq("layers flow", layers[1].levels, 1);
  ok("layers hyper measured", layers[2].active === true && layers[2].levels === 7);
  ok("layers soldiers measured", layers[3].active === true && layers[3].levels === 2);
  ok("layers all carry evidence", layers.every((l) => l.real === true && typeof l.evidence === "string"));
  const dark = measuredLayers({ ourOrders: [], hyper: { enabled: false, opsToday: 0 }, soldiersVerified: 0 });
  ok("layers dark → zero active", dark.every((l) => l.active === false));
  const hostile = measuredLayers(null);
  ok("layers hostile-null safe", hostile.length === 4 && hostile.every((l) => l.active === false));
}

/* R237-C · redeployIntel: doctrine share NEVER exceeded, protective scaling exact */
{
  /* full doctrine: liquid after power-up covers the ladder's ask need */
  const full = redeployIntel({ planned: 9, liquidSteem: 35.129, floorSteem: 5, askNeed: 10, rcPct: 61.5 });
  ok("intel full-doctrine", full.scale === 1 && full.verdict === "FULL-DOCTRINE");
  /* protective: liquid 50.9 → 25.9 above (floor+ask) → planned 30 → scale floor3dp(25.9/30)=0.863 */
  const scaled = redeployIntel({ planned: 30, liquidSteem: 50.9, floorSteem: 5, askNeed: 20, rcPct: 50 });
  ok("intel scaled exact floor3dp", scaled.scale === 0.863 && scaled.verdict === "GRID-PROTECT-SCALED");
  ok("intel executed ≤ doctrine", Math.floor(30 * scaled.scale * 1000) / 1000 <= 30);
  /* nothing can be spared → honest defer, scale 0 */
  const defer = redeployIntel({ planned: 10, liquidSteem: 20, floorSteem: 5, askNeed: 15 });
  ok("intel defer scale-0", defer.scale === 0 && defer.verdict === "GRID-PROTECT-DEFER");
  /* no ask need measured → nothing to starve */
  const noAsk = redeployIntel({ planned: 9, liquidSteem: 35, floorSteem: 5, askNeed: 0 });
  ok("intel no-ask full", noAsk.scale === 1 && noAsk.verdict === "FULL-DOCTRINE");
  /* planned ≤ 0 → nothing to scale */
  const nothing = redeployIntel({ planned: 0, liquidSteem: 100, floorSteem: 5, askNeed: 1 });
  ok("intel nothing-to-scale", nothing.scale === 0 && nothing.verdict === "NOTHING-TO-SCALE");
  /* hostile inputs fail closed (never crash, never fabricate) */
  const hostile = redeployIntel({ planned: NaN, liquidSteem: Infinity, floorSteem: -5, askNeed: "x" });
  ok("intel hostile fail-closed", hostile.verdict === "NOTHING-TO-SCALE" && hostile.scale === 0);
  /* rc urgency documented — but pacing law owns timing (scale untouched) */
  const urgent = redeployIntel({ planned: 9, liquidSteem: 90, floorSteem: 5, askNeed: 1, rcPct: 12.34 });
  ok("intel rc urgency noted", urgent.urgency != null && urgent.scale === 1);
  ok("intel rc normalized 1dp", urgent.factors.rcPct === 12.3);
  eq("intel deterministic", JSON.stringify(full), JSON.stringify(redeployIntel({ planned: 9, liquidSteem: 35.129, floorSteem: 5, askNeed: 10, rcPct: 61.5 })));
}

/* R237-D · blockageLedger: every block named + owned + lawful */
{
  const led = blockageLedger({
    steps: {
      soldiers: { verdict: "DISABLED-T80-OPERATOR-STOP", ok: true },
      redeploy: { verdict: "REDEPLOY-COOLDOWN", reason: "interval 1200/3600s" },
      execute: { verdict: "NO-OPS", ok: true },
      redeployDeferredForClaim: true,
    },
    conf: {},
  });
  ok("ledger soldiers owned by operator", led.some((b) => b.source === "soldiers" && b.owner === "operator" && b.lawful === true));
  ok("ledger pacing owned by law", led.some((b) => b.source === "redeploy" && b.owner === "law R231" && b.reason.includes("3600") || b.reason.includes("interval")));
  ok("ledger claim-defer structural", led.some((b) => b.source === "redeploy" && b.owner === "structural"));
  const clean = blockageLedger({ steps: { observe: { ok: true }, execute: { verdict: "BROADCAST", ok: true } }, conf: { soldiers: { enabled: false } } });
  ok("ledger no false positives when running", !clean.some((b) => b.source === "execute" || b.source === "redeploy"));
  const hostileLed = blockageLedger({ steps: null, conf: null });
  ok("ledger hostile-null safe", hostileLed.length === 0);
}

/* R237-B · council classification: measured verdicts, never assumed */
{
  eq("organ alive", organVerdict({ ok: true, ageMs: 1000 }), "ALIVE");
  eq("organ stale", organVerdict({ ok: true, ageMs: 40 * 60_000 }), "STALE");
  eq("organ down", organVerdict({ ok: false, ageMs: 0 }), "DOWN");
  eq("organ hostile", organVerdict({ ok: true, ageMs: NaN }), "ALIVE");
  eq("mesh all alive", meshVerdict([{ verdict: "ALIVE" }, { verdict: "ALIVE" }, { verdict: "ALIVE" }]), "MESH-ALIVE");
  eq("mesh partial", meshVerdict([{ verdict: "ALIVE" }, { verdict: "DOWN" }]), "MESH-PARTIAL");
  eq("mesh partial-stale", meshVerdict([{ verdict: "ALIVE" }, { verdict: "STALE" }]), "MESH-PARTIAL");
  eq("mesh dark", meshVerdict([{ verdict: "DOWN" }, { verdict: "DOWN" }]), "MESH-DARK");
  eq("mesh empty", meshVerdict([]), "MESH-DARK");
  eq("mesh hostile", meshVerdict(null), "MESH-DARK");
}

/* ── R243 · SPAMGATE (the measured @spaminator law) ───────────────────────── */
{
  eq("normalize strips links", normalizeText("see [x](https://a.b/c) now"), "see x now");
  ok("jaccard identical=1", jaccard(shingles("alpha beta gamma delta"), shingles("alpha beta gamma delta")) === 1);
  ok("jaccard disjoint=0", jaccard(shingles("alpha beta gamma"), shingles("delta epsilon zeta")) === 0);
  ok("dupSentences>0", dupSentenceRatio("This is a real sentence here. This is a real sentence here.") > 0);
  eq("dupSentences unique=0", dupSentenceRatio("one fine morning walk\nthen a quiet river bends"), 0);
  eq("bait hits", spamPhraseHits("Upvote me and follow me and get free crypto"), ["upvote me", "follow me and", "free crypto"]);
  eq("bait clean", spamPhraseHits("a careful measured analysis of market microstructure"), []);

  const tAllCaps = titleVerdict("MAKING FREE MONEY FAST HERE NOW");
  ok("title all-caps refused", !tAllCaps.ok && tAllCaps.reasons.includes("title-all-caps"));
  ok("title clickbait refused", !titleVerdict("You won't believe this trick").ok);
  ok("title ok", titleVerdict("A measured look at Steem market depth").ok);

  ok("tags too-many", !tagVerdict(["a", "b", "c", "d", "e", "f"]).ok);
  ok("tags banned", !tagVerdict(["crypto", "airdrop"]).ok);
  ok("tags dup", !tagVerdict(["life", "life"]).ok);
  ok("tags ok", tagVerdict(["steem", "markets"]).ok);

  ok("body thin post refused", !bodyVerdict("x ".repeat(150), { isComment: false }).ok); // 300 < 1200
  ok("body thin comment refused", !bodyVerdict("nice post!", { isComment: true }).ok);
  ok("comment ok at 220", bodyVerdict("I measured the order book depth before replying: the spread stayed wide all day and the fill quality changed after the parity shift.".padEnd(220, " "), { isComment: true }).ok);
  const linky = bodyVerdict("read https://a.very-long-domain.example/path/here and https://another-long-domain.example/x ".repeat(6), { isComment: false });
  ok("link-stuffing refused", !linky.ok && linky.reasons.some((r) => r.includes("link-stuffing")));
  ok("bait refused", !bodyVerdict("Claim your free airdrop now ".repeat(20), { isComment: true }).ok);

  const simSame = selfSimVerdict("one body about market depth measurements repeated", ["one body about market depth measurements repeated"], { isComment: false });
  ok("selfSim identical refused", !simSame.ok);
  const simDiff = selfSimVerdict("an entirely different topic about rivers and mountains and valleys", ["order books spreads parity fills and depth"], { isComment: false });
  ok("selfSim different ok", simDiff.ok);

  ok("grounding refused", !groundingVerdict({ groundedOn: [] }, { isComment: false }).ok);
  ok("grounding ok", groundingVerdict({ groundedOn: ["parity 0.0996 measured"] }, { isComment: false }).ok);
  ok("grounding n/a for comments", groundingVerdict({}, { isComment: true }).ok);

  ok("frequency cap", !frequencyVerdict(3, 3).ok);
  ok("frequency ok", frequencyVerdict(0, 3).ok);

  /* R254 LAW UPDATE: the operator re-armed HIVE as a measured trial — hive
   * is allowed with stricter gates, blurt stays refused. */
  ok("cross-chain hive allowed (R254 trial)", crossChainVerdict("hive").ok);
  ok("cross-chain blurt refused", !crossChainVerdict("blurt").ok);
  ok("cross-chain empty refused", !crossChainVerdict("").ok);
  ok("cross-chain steem ok", crossChainVerdict("steem").ok);

  const sentences = ["The order book stayed thin today.", "I measured the spread band across the whole window.", "Fill quality changed after the parity shift.", "Inventory skew law explains the ask pressure.", "The bid side stayed passive until the close.", "Depth snapshots came from the public node.", "The parity band held inside four basis points.", "Order placement followed the tranche partition.", "RC headroom bounded the operation count.", "The day cap kept churn inside doctrine.", "Every verdict was journaled with a timestamp.", "The summary stands on measured telemetry."];
  const fullBody = sentences.concat(sentences.map((s, i) => `${s} revisited in a second pass with fresh measurements (pass2-${i + 1})`)).join(" ");
  const goodDraft = { title: "A measured look at Steem market depth", body: fullBody, tags: ["steem", "markets"], groundedOn: ["parity 0.0996 measured 2026-10-07"] };
  const g1 = spamVerdict(goodDraft, { chain: "steem", ownRecentBodies: [], postsToday: 0, dayCap: 3 });
  ok("full gate good draft passes", g1.ok);
  const g2 = spamVerdict({ ...goodDraft, body: "thin", title: "hi" }, { chain: "steem" });
  ok("full gate thin refused", !g2.ok && g2.reasons.some((r) => r.includes("body-too-thin")));
  const g3 = spamVerdict(goodDraft, { chain: "blurt" });
  ok("full gate blurt refused", !g3.ok && g3.reasons[0].includes("operator-pause"));
  const g4 = spamVerdict(goodDraft, { chain: "hive" });
  ok("full gate hive runs trial gates (stricter min)", g4.trial === true && g4.checks.chainGate?.trial === true);
  ok("gate tightened min applies", spamVerdict({ ...goodDraft, body: "x".repeat(1300) }, { chain: "steem", g: { ...GATE_DEFAULTS, minPostChars: 1600 } }).ok === false);

  const ov1 = organicVerdict(Array.from({ length: 5 }, () => ({ outside: 0, flags: 0 })));
  ok("organic zero→tighten", ov1.tighten === true && ov1.verdict === "ZERO-ORGANIC-TIGHTEN");
  const ov2 = organicVerdict([{ outside: 0, flags: 1 }, { outside: 0, flags: 0 }, { outside: 0, flags: 0 }, { outside: 0, flags: 0 }, { outside: 0, flags: 0 }]);
  ok("organic flag→stop", ov2.ok === false && ov2.verdict === "FLAGGED-STOP");
  ok("organic no-signal", organicVerdict([{ outside: 0 }]).verdict === "NO-SIGNAL-YET");
  const ov3 = organicVerdict([{ outside: 2, flags: 0 }, { outside: 1, flags: 0 }, { outside: 0, flags: 0 }, { outside: 3, flags: 0 }, { outside: 1, flags: 0 }]);
  ok("organic ok", ov3.verdict === "ORGANIC-OK" && ov3.tighten === false);
}

/* ── R243 · AGENT-BUS (chain-native mail) ─────────────────────────────────── */
{
  const msg = buildBusMessage({ from: "headcorner", type: BUS_TYPES.CYCLE_RECEIPT, body: { ok: true } });
  eq("bus msg shape", [msg.v, msg.from, msg.to, msg.type], [1, "headcorner", "*", BUS_TYPES.CYCLE_RECEIPT]);
  let threw = false;
  try { buildBusMessage({ from: "x", type: "nope" }); } catch { threw = true; }
  ok("bus invalid type throws", threw);
  threw = false;
  try { buildBusMessage({ from: "x", type: BUS_TYPES.DIRECTIVE, body: { big: "y".repeat(600) } }); } catch { threw = true; }
  ok("bus body cap throws", threw);

  const op = busOp("headcorner", msg);
  eq("bus op id", op[0][1].id, BUS_ID);
  eq("bus op posting-auth", op[0][1].required_posting_auths, ["headcorner"]);

  const entry = parseBusEntry([7, { block: 100, op: ["custom_json", { id: BUS_ID, json: JSON.stringify(msg) } ] }]);
  ok("parse ok", entry && entry.from === "headcorner" && entry.block === 100);
  eq("parse foreign id", parseBusEntry([7, { op: ["custom_json", { id: "other", json: "{}" } ] }]), null);
  eq("parse garbage", parseBusEntry([7, { op: ["custom_json", { id: BUS_ID, json: "not-json" } ] }]), null);

  const inbox = filterInbox([msg, { ...msg, from: "hcs1" }, { ...msg, to: "hcs1", from: "hcs1" }], "headcorner");
  eq("inbox filter", inbox.length, 1); // own self-message excluded; to=hcs1 excluded

  ok("ratelimit first ok", busRateLimit({ sentAt: [] }, 1000000).allow);
  ok("ratelimit min-gap", !busRateLimit({ sentAt: [999990] }, 1000000).allow);
  ok("ratelimit hour-cap", !busRateLimit({ sentAt: [999100, 999200, 999300, 999400, 999500, 999600, 999700] }, 1000000).allow);

  const seen = [];
  const out = deliverInbox([msg, { ...msg, type: "mystery" }], { [BUS_TYPES.CYCLE_RECEIPT]: (m) => { seen.push(m.from); return { handled: true, note: "ok" }; } });
  ok("deliver handled", out.handled === 1 && seen.length === 1);
  ok("deliver unknown soft", out.unknown.length === 1);
  ok("deliver handler-error soft", deliverInbox([msg], { [BUS_TYPES.CYCLE_RECEIPT]: () => { throw new Error("boom"); } }).delivered[0].note.startsWith("handler-error"));
}

/* R244 · THE INTELLIGENCE ROUND: offline conversation pack, corpus floors,
 * monoculture veto. Chain truth that motivated these: 45 posts / 0 comments
 * in 72h; 100–220-word posts; three near-identical "Streamlining" titles. */
{
  const { detectTopic, anchorPhrases, synthesizeComment, synthesizeReply, TOPIC_MODULES, readCorpus } = await import("./intel-pack.mjs");
  const { wordCount, MIN_POST_WORDS, titleSimilarity } = await import("./content.mjs");

  /* word floor: the anti-shitpost law counts words */
  eq("wordCount basic", wordCount("one two  three\nfour"), 4);
  const stub = { title: "A Very Short Stub Post", body: "Too short. ".repeat(30).trim(), tags: ["life", "psychology"] };
  eq("300-word floor rejects stub", sanitizeDraft(stub), null);
  const longBody = Array.from({ length: 320 }, (_, i) => `word${i % 97}`).join(" ");
  const real = sanitizeDraft({ title: "A Real Post With Real Words", body: longBody, tags: ["life", "psychology"] });
  ok("300-word floor accepts real", !!real);

  /* corpus integrity: every hand-crafted pillar post IS a lawful draft */
  const corpus = readCorpus();
  ok("corpus non-empty (>=9)", corpus.length >= 9);
  for (const c of corpus) {
    const d = sanitizeDraft({ title: c.title, body: c.body, tags: c.tags, angle: c.angle, voice: c.voice });
    ok(`corpus lawful: ${c.id}`, !!d);
  }

  /* topic detection: the pack reads what it is about to answer */
  eq("detect food", detectTopic("A slow simmered soup recipe from my kitchen, the flavor of cumin").topic, "food");
  eq("detect psychology", detectTopic("habit and attention, how focus survives a stressful week").topic, "psychology");
  eq("detect travel", detectTopic("backpacking the mountain trail, crossing the border by bus").topic, "travel");
  eq("detect generic", detectTopic("lorem ipsum dolor sit amet consectetur").topic, "generic");

  /* anchoring: the parent's own words come back in the reply */
  const anchors = anchorPhrases("The Old Lighthouse Remembers Every Storm", "A lighthouse keeper logs storms; the lighthouse wall holds the marks of every storm season.", { n: 2 });
  ok("anchor picks parent words", anchors.some((a) => ["lighthouse", "storm", "storms", "keeper"].includes(a)));

  /* synthesis: lawful, anchored, deterministic, varied */
  const c1 = synthesizeComment({ postTitle: "What a plant hanger actually costs", postExcerpt: "Three meters of cotton cord, a metal ring, hours of knotting and untangling patience.", seed: 7 });
  ok("synthesizeComment lawful", !!c1 && c1.length >= 120 && c1.length <= 650);
  ok("synthesizeComment anchored", /cord|knot|ring|hours|hanger|cotton|patience/i.test(c1));
  eq("synthesizeComment deterministic", synthesizeComment({ postTitle: "What a plant hanger actually costs", postExcerpt: "Three meters of cotton cord, a metal ring, hours of knotting and untangling patience.", seed: 7 }), c1);
  const c2 = synthesizeComment({ postTitle: "What a plant hanger actually costs", postExcerpt: "Three meters of cotton cord, a metal ring, hours of knotting and untangling patience.", seed: 8 });
  ok("synthesizeComment varies by seed", c1 !== c2);
  const r1 = synthesizeReply({ postTitle: "The Waiting Room Is the Most Honest Building in Town", commentBody: "The part about the wrong clock being the most reliable one hit me, I never noticed that.", myPrior: "waiting rooms record what people do when nothing can be done", seed: 3 });
  ok("synthesizeReply lawful", !!r1 && r1.length >= 120 && r1.length <= 650);
  ok("synthesizeReply anchored on their words", /clock|reliable|hit/i.test(r1));

  /* module harmony: every synthesis path must satisfy the standing reply law */
  let allLawful = true;
  for (let s = 1; s <= 12; s++) {
    const t = synthesizeComment({ postTitle: "Walking Is How I Think: On Routes, Loops, and Ideas", postExcerpt: "walking the same loop around ordinary blocks, the mind rearranging, boredom as price of admission", seed: s });
    if (!t || !sanitizeReply(t)) { allLawful = false; break; }
  }
  ok("12 seeds × sanitizeReply harmony", allLawful);

  /* the monoculture veto: the chain-observed clones must be catchable */
  ok("monoculture: streamlining twins", titleSimilarity("Streamlining Your Steem Workflow", "Streamlining Your Steem Workflow: Tools for Efficiency") >= 0.5);
  ok("monoculture: myth-vs-fact twins", titleSimilarity("Myth vs Fact: Is Steem Truly Decentralized?", "Myth vs Fact: Steem Dollars Are Stable") >= 0.5);
  ok("monoculture: distinct titles pass", titleSimilarity("The Waiting Room Is the Most Honest Building in Town", "What a plant hanger actually costs") < 0.5);

  /* R244 · THE WORD-BOUNDARY LAW (root-cause of the comment drought): "wic"
   * must NOT match inside "twice" — but a real mention must still die. */
  const { mentionsAny } = await import("./intel-pack.mjs");
  ok("boundary: twice is clean", mentionsAny("I read your post twice and walked the loop twice too", ["wic"]) === false);
  ok("boundary: real wic mention dies", mentionsAny("say hi to wic for me", ["wic"]) === true);
  ok("boundary: capital WIC dies", mentionsAny("Say hi to WIC for me", ["wic"]) === true);
  ok("boundary: saos mention dies", mentionsAny("the saos crew strikes again", ["saos"]) === true);
  ok("boundary: same word different case clean", mentionsAny("SAOS is also a common typo word but standalone here only as saOs", []) === false);
  ok("sanitizeReply: twice survives the standing law", sanitizeReply("I have read this piece twice now and the second reading held up; what did you cut last?") !== null);

  /* amplified schedule: the R244 conversation capacity, proven */
  const sched = buildDaySchedule(12345, { publishWindow: [7, 23] });
  const count = (k) => sched.filter((s) => s.kind === k).length;
  eq("amplified fleet-vote slots", count("fleet-vote"), 3);
  eq("amplified fleet-comment slots", count("fleet-comment"), 2);
  eq("amplified reply slots", count("reply"), 3);
  eq("amplified community slots", count("community-comment"), 2);
  eq("amplified deepen slots", count("deepen"), 2);
  eq("publish cap stays anti-spam", count("publish"), 1);

  /* ── R245 · DEX-TAKEOVER GATE: the sandbox-distrust law, deterministic ── */
  const { dexTakeoverDue } = await import("./lib.mjs");
  const T0 = "2026-10-07T12:00:00.000Z";
  const ms = (s) => Date.parse(s);
  eq("takeover: fresh anchor = engine-alive standby", dexTakeoverDue({ now: T0, anchorAt: ms("2026-10-07T11:50:00.000Z") }).reason, "engine-alive");
  eq("takeover: stale anchor = due", dexTakeoverDue({ now: T0, anchorAt: ms("2026-10-07T09:50:00.000Z") }).reason, "anchor-stale");
  eq("takeover: missing anchor = due", dexTakeoverDue({ now: T0, anchorAt: null }).reason, "no-anchor");
  eq("takeover: unreadable anchor = due", dexTakeoverDue({ now: T0, anchorAt: "garbage" }).reason, "anchor-unreadable");
  eq("takeover: first takeover after stale has no gap block", dexTakeoverDue({ now: T0, anchorAt: ms("2026-10-07T09:50:00.000Z"), lastAt: null }).due, true);
  eq("takeover: gap blocks hammering", dexTakeoverDue({ now: T0, anchorAt: ms("2026-10-07T09:50:00.000Z"), lastAt: "2026-10-07T11:30:00.000Z" }).reason, "takeover-gap");
  eq("takeover: gap expires after 3h", dexTakeoverDue({ now: T0, anchorAt: ms("2026-10-07T09:50:00.000Z"), lastAt: "2026-10-07T08:00:00.000Z" }).due, true);
  eq("takeover: boundary 90min exactly = still alive", dexTakeoverDue({ now: T0, anchorAt: Date.parse(T0) - 90 * 60_000 }).reason, "engine-alive");
  eq("takeover: bad now never fires", dexTakeoverDue({ now: "not-a-time", anchorAt: null }).due, false);
  eq("takeover: numeric epoch anchor accepted", dexTakeoverDue({ now: Date.parse(T0), anchorAt: Date.parse(T0) - 91 * 60_000 }).due, true);
}

/* R245 · doctor — פסק-כשירות מדוד (מודל-REA: רק-scope_checks משפטים) */
{
  const { filterScope, verdictScope, runDoctor } = await import("./doctor.mjs");
  const checks = [
    { id: "git-divergence", scope: "git", ok: true, detail: "SYNCED 0 0" },
    { id: "selftest-last-run", scope: "selftest", ok: false, detail: "STALE", remedy: "run selftest" },
    { id: "engine-status", scope: "engine", ok: false, informational: true, detail: "offline" },
    { id: "actions-heartbeat", scope: "actions", ok: true, informational: true, detail: "no-token" },
  ];
  eq("filterScope all keeps everything", filterScope(checks, "all").checks.length, 4);
  eq("filterScope explicit narrows", filterScope(checks, "git").checks.map((c) => c.id), ["git-divergence"]);
  eq("filterScope unknown rejected", filterScope(checks, "nonsense").error, "unknown-scope");
  eq("verdictScope unknown-scope exit=2", verdictScope(checks, "nonsense").exit, 2);
  const allMode = verdictScope(checks, "all");
  eq("verdict all-mode unhealthy on real fail", allMode.healthy, false);
  eq("verdict all-mode exit=1 on real fail", allMode.exit, 1);
  eq("verdict all-mode failing ids", allMode.failing, ["selftest-last-run"]);
  const explicitGit = verdictScope(checks, "git");
  eq("explicit healthy scope ok", explicitGit.healthy, true);
  eq("explicit exit=0 scope ok", explicitGit.exit, 0);
  const explicitSelftest = verdictScope(checks, "selftest");
  eq("explicit unhealthy scope fail", explicitSelftest.healthy, false);
  eq("informational-only scope never blocks", verdictScope([{ id: "e", scope: "engine", ok: false, informational: true }], "engine").healthy, true);
  // ריצת-doctor אופליין-טהורה עם-פרובות-מזויפות (אפס-רשת, אפס-שעון-אמת)
  const now = "2026-10-07T18:00:00.000Z";
  const freshSelftest = JSON.stringify({ pass: 41, fail: 0, at: "2026-10-07T17:00:00.000Z" });
  const good = await runDoctor({ scope: "all", now, env: {}, probes: {
    git: async (args) => args.includes("--left-right") ? { code: 0, stdout: "0  0", stderr: "" } : { code: 0, stdout: "", stderr: "" },
    readFile: async () => freshSelftest,
    http: async (url) => { if (String(url).includes("3040")) return { ok: true, body: { ok: true, at: now } }; throw new Error("net"); },
  } });
  eq("doctor all-mode healthy (engine offline=informational)", good.healthy, true);
  eq("doctor all-mode exit=0", good.exit, 0);
  eq("doctor scope mode all", good.scope.mode, "all");
  const badGit = await runDoctor({ scope: "git", now, env: {}, probes: {
    git: async (args) => args.includes("--left-right") ? { code: 0, stdout: "131  0", stderr: "" } : { code: 0, stdout: "", stderr: "" },
    readFile: async () => freshSelftest,
    http: async () => { throw new Error("net"); },
  } });
  eq("doctor git-scope catches divergence", badGit.healthy, false);
  eq("doctor git-scope failing id", badGit.failing, ["git-divergence"]);
  eq("doctor git-scope carries remedy", badGit.checks[0].remedy.includes("reset --hard"), true);
  const staleRun = await runDoctor({ scope: "selftest", now, env: {}, probes: {
    readFile: async () => JSON.stringify({ pass: 41, fail: 0, at: "2026-10-05T00:00:00.000Z" }),
    git: async () => ({ code: 0, stdout: "", stderr: "" }),
    http: async () => { throw new Error("net"); },
  } });
  eq("doctor stale selftest dies", staleRun.healthy, false);
  eq("doctor stale detail honest", staleRun.checks.find((c) => c.id === "selftest-last-run").detail.startsWith("STALE"), true);
  const noToken = await runDoctor({ scope: "actions", now, env: {}, probes: { http: async () => { throw new Error("net"); }, git: async () => ({ code: 0, stdout: "", stderr: "" }), readFile: async () => freshSelftest } });
  eq("actions no-token = informational pass", noToken.healthy, true);
  eq("actions no-token honest detail", noToken.checks.find((c) => c.id === "actions-heartbeat").detail.includes("no-token"), true);
}

/* R245 · mcp — שער-הסוכנים (JSON-RPC, scrub, fail-closed) */
{
  const { makeHandler, makeTools, toolCatalog, scrubText, PROTOCOL_VERSION } = await import("./mcp.mjs");
  // scrub: כל-פורמט-מפתח-חי מת
  const WIF_LIKE = "5J8xYzDemoBase58Stringzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
  const PAT_LIKE = ["github_", "pat_11ABCDEFG0abcdefGHIJKL_tokenvalue123"].join("");
  const GHP_LIKE = ["gh", "p_0123456789abcdefghij0123"].join("");
  eq("scrub WIF", scrubText("keep " + WIF_LIKE + " safe"), "keep [REDACTED-WIF] safe");
  eq("scrub PAT", scrubText("token " + PAT_LIKE), "token [REDACTED-PAT]");
  eq("scrub ghp", scrubText(GHP_LIKE), "[REDACTED-TOKEN]");
  eq("scrub clean text untouched", scrubText("parity 0.0999 band-ok"), "parity 0.0999 band-ok");
  // קטלוג: 6-כלים עם-inputSchema-מלא
  const cat = toolCatalog();
  eq("catalog size", cat.length, 6);
  ok("catalog schemas are objects", cat.every((t) => t.inputSchema && t.inputSchema.type === "object"));
  ok("catalog names unique", new Set(cat.map((t) => t.name)).size === 6);
  ok("catalog has saos_pnl", cat.some((t) => t.name === "saos_pnl"));
  // handler עם-כלים-מזויפים (אופליין)
  const fakeTools = cat.map((t) => ({ ...t, run: async (args) => ({ tool: t.name, args: args ?? null, secret: "5J8xYzDemoBase58Stringzzzzzzzzzzzzzzzzzzzzzzzzzzzz" }) }));
  const handle = makeHandler(fakeTools);
  const init = await handle({ jsonrpc: "2.0", id: 1, method: "initialize" });
  eq("init protocol version", init.result.protocolVersion, PROTOCOL_VERSION);
  eq("init server name", init.result.serverInfo.name, "saos-mcp");
  eq("init id preserved", init.id, 1);
  eq("notification returns null", await handle({ method: "notifications/initialized" }), null);
  const list = await handle({ id: 2, method: "tools/list" });
  eq("tools/list count", list.result.tools.length, 6);
  ok("tools/list no run leaked", list.result.tools.every((t) => !("run" in t)));
  const call = await handle({ id: 3, method: "tools/call", params: { name: "saos_status", arguments: {} } });
  ok("tools/call returns text content", call.result.content[0].type === "text");
  ok("tools/call output scrubbed", call.result.content[0].text.includes("[REDACTED-WIF]"));
  ok("tools/call output has no raw WIF", !call.result.content[0].text.includes("5J8xYzExampleBase58String"));
  const unknownTool = await handle({ id: 4, method: "tools/call", params: { name: "nope" } });
  eq("unknown tool -32601", unknownTool.error.code, -32601);
  const unknownMethod = await handle({ id: 5, method: "roots/list" });
  eq("unknown method -32601", unknownMethod.error.code, -32601);
  const malformed = await handle(null);
  eq("malformed request -32600", malformed.error.code, -32600);
  // כלי-אמיתי: fail-closed-כנה (engine-offline + remedy) ואימוץ-scrub בשגיאה
  const realTools = makeTools({ http_: async () => { throw new Error("timeout"); }, readFile_: async () => { throw new Error("missing"); } });
  const st = await realTools.saos_status({});
  eq("status offline honest ok:false", st.ok, false);
  ok("status offline carries remedy", String(st.remedy || "").length > 5);
  const realHandle = makeHandler(cat.map((t) => ({ ...t, run: realTools[t.name] })));
  const realCall = await realHandle({ id: 6, method: "tools/call", params: { name: "saos_status", arguments: {} } });
  eq("real tools/call not error", realCall.result.isError, undefined);
  const join = await realTools.saos_join({});
  eq("join truth law", join.truth.includes("הגיט הוא האמת"), true);
  eq("join dead-soldier law", join.dead_soldiers.includes("T-80"), true);
  ok("join commands are runnable", join.session_open.every((c) => typeof c === "string" && c.length > 5));
}

/* R245-b · pnl-public — מדידת-תשואה-ציבורית (דפוס-Alpha-Arena: מדוד-מול-מוערך-ברזל) */
{
  const { buildPublicPnl, publicPnlMarkdown, anchorEvidence, STALE_MS } = await import("./pnl-public.mjs");
  eq("STALE_MS is 24h", STALE_MS, 24 * 60 * 60 * 1000);
  // fail-closed: state-חסר/שבור = אין-מספרים
  eq("no observe → honest", buildPublicPnl({}).measured, false);
  eq("no observe reason", buildPublicPnl({}).reason, "no-observe-state");
  eq("unreadable at → honest", buildPublicPnl({ observe: { at: "not-a-date" } }).reason, "observe-at-unreadable");
  eq("future at → honest", buildPublicPnl({ observe: { at: new Date(9e12).toISOString() }, now: 1e12 }).reason, "observe-at-in-future");
  const NOW = Date.parse("2026-10-07T18:00:00Z");
  const FRESH_AT = "2026-10-07T17:30:00Z";
  const STALE_AT = "2026-10-06T12:00:00Z";
  const staleRes = buildPublicPnl({ observe: { at: STALE_AT }, now: NOW });
  ok("stale 30h → honest reason", staleRes.reason.startsWith("observe-stale-") && staleRes.measured === false);
  // allowlist: שדה-לא-מוכר-לא-עובר-לעולם (אפס-דליפה)
  const obs = { at: FRESH_AT, account: "headcorner", pnl: { realizedSbd: 1.5, realizedUsd: 0.16 }, inventory: { steem: 19.069, sbd: 10.138, spOwn: 975.4, rcPct: 31 }, band: { ok: true, bps: -471 }, steemUsd: 0.05848, sbdUsd: 0.589584, secretField: "5J8xYzDemoBase58Stringzzzzzzzzzzzzzzzzzzzzzzzzzzzz", orders: [{ x: 1 }] };
  const econ = { rails: [
    { id: "a", label: "מדוד", confidence: "measured", measuredUsdPerDay: 2.0, note: "real fills" },
    { id: "b", label: "מוערך", confidence: "estimated", estUsdPerDay: 3.9, measuredUsdPerDay: 999, note: "est" },
    { id: "c", label: "חסום", confidence: "blocked", note: "no fills" },
  ] };
  const m = buildPublicPnl({ observe: obs, economics: econ, custodian: { head: { txid: "a955b5d7abcdef1234", block: 110230068, at: FRESH_AT } }, now: NOW });
  eq("fresh measured", m.measured, true);
  eq("allowlist drops secretField", "secretField" in m, false);
  eq("allowlist drops orders", "orders" in m, false);
  eq("pnl passthrough", m.pnl, { realizedSbd: 1.5, realizedUsd: 0.16 });
  eq("inventory passthrough", m.inventory.spOwn, 975.4);
  eq("band bps passthrough", m.parity.bps, -471);
  // מדוד-מול-מוערך: אף-ערבוב
  eq("totals measured only measured", m.totals.measuredUsdPerDay, 2.0);
  eq("totals estimated only estimated", m.totals.estimatedUsdPerDay, 3.9);
  eq("estimated rail measured forced null", m.rails[1].measuredUsdPerDay, null);
  eq("blocked rail both null", m.rails[2].measuredUsdPerDay === null && m.rails[2].estimatedUsdPerDay === null, true);
  eq("rail confidence enum", m.rails[2].confidence, "blocked");
  eq("anchor evidence", m.evidence, { txid: "a955b5d7abcdef12", block: 110230068, at: FRESH_AT });
  eq("anchorEvidence none", anchorEvidence(null), null);
  eq("anchorEvidence empty head", anchorEvidence({ head: {} }), null);
  // markdown: כנות בשני-המצבים
  ok("md no-measure honest", publicPnlMarkdown(buildPublicPnl({ now: NOW })).includes("אין-מדידה-פעילה"));
  ok("md no-measure no invented numbers", publicPnlMarkdown(buildPublicPnl({ now: NOW })).includes("fail-closed"));
  const md = publicPnlMarkdown(m);
  ok("md has account", md.includes("headcorner"));
  ok("md separates totals", md.includes("לא-מצטרף-למדוד"));
  ok("md table header", md.includes("| מסילה | תיוג-אמון |"));
  ok("md anchor txid", md.includes("a955b5d7abcdef12"));
}

/* R245-d · pnl evidence-per-output — עקרון-5.0.0 (REA): ראיה-מוצמדת לכל-פלט */
{
  const { buildPublicPnl, publicPnlMarkdown, buildEvidence, railEvidence, railEvidenceText } = await import("./pnl-public.mjs");
  const NOW = Date.parse("2026-10-07T19:00:00Z");
  const AT = "2026-10-07T18:30:00Z";
  // buildEvidence: chain מקובץ-עוגן (at-ms→ISO), commit מראש-string, push מ-push-custody
  const ev = buildEvidence({ custodian: { head: "3657d1c51abb8a58ea602ed7c3046b9fc2cd2817", at: AT }, custodyAnchor: { at: 1791392986790, txid: "9f507adbbc42346196659a4b96de67e123577b9e" }, pushCustody: { lastPushedSha: "3657d1c51abb8a58ea602ed7c3046b9fc2cd2817", pushedAt: "2026-10-07T18:31:59Z", branch: "saos-cockpit" } });
  ok("ev chain txid sliced+block-null", ev.chain.txid === "9f507adbbc423461" && ev.chain.block === null);
  ok("ev chain at ISO", ev.chain.at === new Date(1791392986790).toISOString());
  ok("ev commit sha12", ev.commit.sha === "3657d1c51abb" && ev.commit.at === AT);
  ok("ev push honest", ev.push.sha === "3657d1c51abb" && ev.push.branch === "saos-cockpit" && ev.push.pushedAt === "2026-10-07T18:31:59Z");
  // כשלים-כנים: משהו-שבור = null, אף-המצאה
  eq("ev all-missing → null", buildEvidence({}), null);
  eq("ev short txid dropped", buildEvidence({ custodyAnchor: { txid: "short" } }), null);
  eq("ev short sha dropped", buildEvidence({ pushCustody: { lastPushedSha: "abc" } }), null);
  // תאימות-לאחור: בלי-קבצי-עוגן → צורת-העוגן-הישנה-נשמרת
  const oldShape = buildPublicPnl({ observe: { at: AT }, custodian: { head: { txid: "a955b5d7abcdef1234", block: 110230068, at: AT } }, now: NOW });
  eq("backward-compat anchor shape", oldShape.evidence, { txid: "a955b5d7abcdef12", block: 110230068, at: AT });
  // קריאה-חדשה → עדות-מאגרת-עשירה
  const newShape = buildPublicPnl({ observe: { at: AT }, custodyAnchor: { txid: "9f507adbbc42346196659a4b96de67e123577b9e", at: 1791392986790 }, pushCustody: { lastPushedSha: "3657d1c51abb8a58ea602ed7c3046b9fc2cd2817", pushedAt: "2026-10-07T18:31:59Z", branch: "saos-cockpit" }, now: NOW });
  ok("new evidence rich", newShape.evidence.chain.txid === "9f507adbbc423461" && newShape.evidence.push.branch === "saos-cockpit");
  // railEvidence: meta→journal (allowlist-סגור) · בלי-meta→null · מפתח-זר/לא-מספרי נזרק
  eq("rail ev from meta", railEvidence({ meta: { fillsToday: 3, realizedSbdTotal: 0 } }), { source: "engine-journal", journal: { fillsToday: 3, realizedSbdTotal: 0 } });
  eq("rail ev ops", railEvidence({ meta: { opsPerDay: 10290 } }).journal.opsPerDay, 10290);
  eq("rail ev no-meta null", railEvidence({}), null);
  eq("rail ev empty-meta null", railEvidence({ meta: {} }), null);
  eq("rail ev foreign key dropped", railEvidence({ meta: { wif: "5JsecretDemoNotReal", fillsToday: 1 } }).journal.wif, undefined);
  eq("rail ev non-numeric dropped", railEvidence({ meta: { fillsToday: "three" } }), null);
  // טקסט-ראיה: "—" כנה כשאין-ראיה
  eq("evidence text honest dash", railEvidenceText(null), "—");
  ok("evidence text fills", railEvidenceText(railEvidence({ meta: { fillsToday: 3 } })).includes("fills=3"));
  ok("evidence text ops", railEvidenceText(railEvidence({ meta: { opsPerDay: 10290 } })).includes("ops=10290"));
  // markdown: עמודת-ראיה + שורות-עוגן + כנות
  const econ = { rails: [ { id: "mm", label: "mm", confidence: "blocked", note: "x", meta: { fillsToday: 3 } }, { id: "cu", label: "cu", confidence: "estimated", estUsdPerDay: 1, note: "y" } ] };
  const md2 = publicPnlMarkdown(buildPublicPnl({ observe: { at: AT }, economics: econ, custodyAnchor: { txid: "9f507adbbc42346196659a4b96de67e123577b9e", at: 1791392986790 }, pushCustody: { lastPushedSha: "3657d1c51abb8a58ea602ed7c3046b9fc2cd2817", pushedAt: "2026-10-07T18:31:59Z", branch: "saos-cockpit" }, now: NOW }));
  ok("md evidence column", md2.includes("| ראיה |"));
  ok("md rail with evidence", md2.includes("journal:fills=3"));
  ok("md rail honest dash", md2.split("\n").some((l) => l.includes("| cu ") && l.includes(" — ")));
  ok("md chain anchor", md2.includes("9f507adbbc423461"));
  ok("md push line", md2.includes("saos-cockpit @ 2026-10-07T18:31:59Z"));
  ok("md honesty footer", md2.includes("אין-ראיה-כנה"));
}

/* R245-b · saos-setup — התקנה-חוצת-סוכנים (תוכנית-קודם · idempotent · רק-שלנו) */
{
  const { agentTargets, buildPlan, planTarget, applyTarget, removeTarget, ENTRY_NAME } = await import("../../scripts/saos-setup.mjs");
  const HOME = "/h", ROOT2 = "/r";
  const targets = agentTargets(HOME, ROOT2);
  eq("targets count 8 agents", targets.length, 8);
  ok("codex is manual (TOML)", targets.find((t) => t.agent === "codex").entry === null);
  ok("target files distinct", new Set(targets.map((t) => t.file)).size === 8);
  const cmd = { command: "node", args: ["/r/mini-services/saos-engine/mcp.mjs"] };
  const read = (s) => () => s;
  // חסר → add
  eq("missing file → add", planTarget(targets[0], () => { throw new Error("no"); }).action, "add");
  // אחר-אחר קיים → add (רק-שלנו נוסף, של-אחרים-לא-נוגעים)
  eq("other server → add", planTarget(targets[0], read(JSON.stringify({ mcpServers: { other: { command: "x" } } }))).action, "add");
  // שלנו-זהה → none (idempotent)
  const same = JSON.stringify({ mcpServers: { other: { command: "x" }, [ENTRY_NAME]: cmd } });
  eq("identical → none", planTarget(targets[0], read(same)).action, "none");
  // שלנו-שונה → update
  eq("different → update", planTarget(targets[0], read(JSON.stringify({ mcpServers: { [ENTRY_NAME]: { command: "old" } } }))).action, "update");
  // JSON שבור → unreadable (לא-נוגעים)
  eq("broken json → unreadable", planTarget(targets[0], read("{oops")).action, "unreadable");
  // apply add: כותב-רק-שלנו, שומר-של-אחרים
  const writes = [];
  const ioAdd = { readFile: () => JSON.stringify({ mcpServers: { other: { command: "x" } } }), writeFile: (p, s) => writes.push(s) };
  const applied = applyTarget(targets[0], { action: "add" }, ioAdd);
  eq("apply add done", applied.done, true);
  const after = JSON.parse(writes[0]);
  eq("apply keeps other", after.mcpServers.other, { command: "x" });
  eq("apply writes ours", after.mcpServers[ENTRY_NAME], cmd);
  // apply none: לא-כותב (idempotent)
  const ioNone = { readFile: () => same, writeFile: () => { throw new Error("must-not-write"); } };
  eq("apply none no-write", applyTarget(targets[0], { action: "none" }, ioNone).done, false);
  // remove: מסיר-רק-שלנו
  const remWrites = [];
  const removed = removeTarget(targets[0], { readFile: () => same, writeFile: (p, s) => remWrites.push(s) });
  eq("remove done", removed.done, true);
  eq("remove keeps other", JSON.parse(remWrites[0]).mcpServers.other, { command: "x" });
  eq("remove drops ours", JSON.parse(remWrites[0]).mcpServers[ENTRY_NAME], undefined);
  eq("remove not-ours honest", removeTarget(targets[0], { readFile: () => JSON.stringify({ mcpServers: {} }), writeFile: () => {} }).note, "not-ours");
  // buildPlan מלא: תוכנית לכל-הסוכנים
  const plan = buildPlan(targets, () => { throw new Error("missing"); });
  eq("plan all add on empty host (non-codex)", plan.filter((p) => p.agent !== "codex").every((p) => p.action === "add"), true);
  eq("plan codex manual even empty", plan.find((p) => p.agent === "codex").action, "manual");
}

/* R249 · THE LINEAGE TRIPWIRE: selftest reads its own source and refuses to
 * pass if a custodian-style sweep downgrades it. The 95e90d2 regression
 * (1501→1260 lines, 115 vectors silently lost while still printing "PASS")
 * is the measured enemy: a smaller selftest that passes is a lie, not a
 * success. BY CONSTRUCTION: these vectors fail loud if any block is swept. */
{
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL(import.meta.url), "utf8");
  const has = (m) => src.includes(m);
  ok("lineage: evidence block present", has("railEvidence") && has("buildEvidence") && has("anchorEvidence"));
  ok("lineage: intelligence round present", has("INTELLIGENCE ROUND"));
  ok("lineage: dex-takeover gate present", has("DEX-TAKEOVER"));
  ok("lineage: spamgate graft present", has("spamVerdict"));
  ok("lineage: size floor (>=1450 lines)", src.split("\n").length >= 1450);
  const lineageCalls = (src.match(/^[ \t]*(?:eq|ok)\(/gm) ?? []).length;
  ok("lineage: vector-call floor (>=600)", lineageCalls >= 600);
}

/* R252 · WORKLOG-INTEL: טלמטריה-על-המצע-שלנו — ההשתלה-הראשונה-מזיקוק-agentcraft.
 * ה-worklog הוא-ה-ledger-האפנד-אונלי; מפרק-מדוד-שלו (בלוקים/סוכנים/כפילויות/
 * התכווצות) הוא-הערוץ-המכונתי-הראשון-של-הקונסול-החי. משפחת-ה-regressions
 * c60ebae/95e90d2 (דריסת-worklog, השתקת-selftest) היא-האויב-הנמדד:
 * detectAnomalies תופס-התכווצות BY CONSTRUCTION. מודול-טהור — אין-fs/רשת. */
{
  const wi = await import("./worklog-intel.mjs");
  const FIX = [
    "# WORKLOG",
    "",
    "---",
    "Task ID: T-1",
    "Agent: alpha",
    "Task: ראשון",
    "",
    "Work Log:",
    "- אחד",
    "- שניים",
    "פרוזה שאינה תבליט",
    "",
    "Stage Summary:",
    "- סיכום-א",
    "",
    "Task ID: T-1",
    "Agent: beta",
    "Task: כפול",
    "",
    "Work Log:",
    "- שלישי",
    "",
    "---",
    "Task ID: T-2",
    "Agent: alpha",
    "Task: שני",
    "",
  ].join("\n");
  const FIX2 = "---\nTask ID: OK-1\nAgent: alpha\nTask: נקי\n\nWork Log:\n- א\n\nStage Summary:\n- ב\n";
  const parsed = wi.parseWorklog(FIX);
  eq("worklog-intel: block count", parsed.blocks.length, 3);
  eq("worklog-intel: first taskId", parsed.blocks[0].taskId, "T-1");
  eq("worklog-intel: glued block parsed (no --- sep)", parsed.blocks[1].agent, "beta");
  eq("worklog-intel: bullets skip prose", parsed.blocks[0].workBullets.length, 2);
  eq("worklog-intel: summary bullets", parsed.blocks[0].summaryBullets.length, 1);
  eq("worklog-intel: hebrew intact", parsed.blocks[0].task, "ראשון");
  eq("worklog-intel: lineCount measured", parsed.lineCount, 27);
  const wiStats = wi.computeStats(parsed);
  eq("worklog-intel: perAgent alpha", wiStats.perAgent["alpha"], 2);
  eq("worklog-intel: perAgent beta", wiStats.perAgent["beta"], 1);
  eq("worklog-intel: duplicate flagged", (wiStats.duplicates[0] ?? {}).count, 2);
  eq("worklog-intel: missing summary count", wiStats.blocksMissingSummary, 2);
  eq("worklog-intel: topAgents sorted", wiStats.topAgents[0], { agent: "alpha", blocks: 2 });
  eq("worklog-intel: shrink violation caught", wi.detectAnomalies(wiStats, { text: FIX, previousLineCount: 999 }).some((a) => a.kind === "append-only-shrink"), true);
  eq("worklog-intel: floor violation caught", wi.detectAnomalies(wiStats, { text: FIX, minLines: 500 }).some((a) => a.kind === "below-floor"), true);
  eq("worklog-intel: trailing-newline caught", wi.detectAnomalies(wiStats, { text: FIX + "x" }).some((a) => a.kind === "no-trailing-newline"), true);
  eq("worklog-intel: empty worklog flagged", wi.detectAnomalies(wi.computeStats(wi.parseWorklog("")), { text: "" }).some((a) => a.kind === "no-blocks"), true);
  eq("worklog-intel: clean fixture zero anomalies", wi.detectAnomalies(wi.computeStats(wi.parseWorklog(FIX2)), { text: FIX2, previousLineCount: null }).length, 0);
  /* R257 · CRLF/CR-NORMALIZATION: קבצי-Windows (autocrlf) חייבים-להימדד, לא-רק-להזעיק —
   * ב-JS `$` לא-נחה-לפני-`\r` ו-`.` לא-צורך-אותו, אז-`^Task ID:` לא-היה-נפתח-אף-פעם (0-בלוקים-שקטים). */
  const FIXCRLF = "---\r\nTask ID: W-1\r\nAgent: alpha\r\nTask: win\r\n\r\nWork Log:\r\n- one\r\n\r\nStage Summary:\r\n- s\r\n";
  const pc = wi.parseWorklog(FIXCRLF);
  eq("worklog-intel: CRLF parses (windows autocrlf)", [pc.blocks.length, pc.blocks[0].taskId, pc.blocks[0].workBullets.length], [1, "W-1", 1]);
  eq("worklog-intel: CRLF clean file zero anomalies", wi.detectAnomalies(wi.computeStats(pc), { text: FIXCRLF, previousLineCount: null }).length, 0);
  eq("worklog-intel: CRLF lineCount measured", pc.lineCount, 11);
  eq("worklog-intel: bare CR parses (classic mac)", wi.parseWorklog("Task ID: M-1\rAgent: beta\rTask: mac\r\rWork Log:\r- x\r\rStage Summary:\r- y\r").blocks[0].taskId, "M-1");
  /* R258 · BOM: קובץ-UTF-8-BOM (פורמט-Notepad) איבד-את-הבלוק-הראשון-כשהוא-דבוק — `^Task ID:`-לא-נפתח-מאחורי- */
  const FIXBOM = "\uFEFFTask ID: B-1\nAgent: alpha\nTask: bom\n\nWork Log:\n- x\n\nStage Summary:\n- y\n";
  eq("worklog-intel: BOM stripped, first glued block opens", wi.parseWorklog(FIXBOM).blocks[0].taskId, "B-1");
  eq("worklog-intel: BOM file measures clean", wi.detectAnomalies(wi.computeStats(wi.parseWorklog(FIXBOM)), { text: FIXBOM, previousLineCount: null }).length, 0);
  /* R259 · מנוע-מוטציות (Stryker-style): 30-מוטנטים-נמדדו; 17-שרדו-את-הרשת-הקיימת → כל-וקטור-למטה
   * הורג-שורד-מדוד-אחד (kill-rate 43%→100%). וקטור-בלי-קורבן-מוטציה-הוא-נוי, לא-בדיקה. */
  const FIXAVG = "---\nTask ID: A-1\nAgent: a\nTask: avg\n\nWork Log:\n- one\n\nStage Summary:\n- s\n---\nTask ID: A-2\nAgent: a\nTask: avg\n\nWork Log:\n- one\n\nStage Summary:\n- s\n---\nTask ID: A-3\nAgent: a\nTask: avg\n\nWork Log:\n- one\n- two\n\nStage Summary:\n- s\n";
  eq("worklog-intel: avgWorkBullets rounds to 2 decimals (kills M03)", wi.computeStats(wi.parseWorklog(FIXAVG)).avgWorkBullets, 1.33);
  const FIXTOP = "Task ID: P-1\nAgent: beta\nTask: t\n\nWork Log:\n- x\n\nStage Summary:\n- s\nTask ID: P-2\nAgent: alpha\nTask: t\n\nWork Log:\n- x\n\nStage Summary:\n- s\nTask ID: P-3\nAgent: alpha\nTask: t\n\nWork Log:\n- x\n\nStage Summary:\n- s\n";
  eq("worklog-intel: topAgents sorted by blocks desc (kills M04)", wi.computeStats(wi.parseWorklog(FIXTOP)).topAgents[0], { agent: "alpha", blocks: 2 });
  const FIXDUP = "Task ID: T-B\nAgent: a\nTask: t\n\nStage Summary:\n- s\nTask ID: T-A\nAgent: a\nTask: t\n\nStage Summary:\n- s\nTask ID: T-B\nAgent: b\nTask: t\n\nStage Summary:\n- s\nTask ID: T-A\nAgent: b\nTask: t\n\nStage Summary:\n- s\n";
  eq("worklog-intel: duplicates tie-break taskId asc (kills M05)", wi.computeStats(wi.parseWorklog(FIXDUP)).duplicates.map((d) => d.taskId), ["T-A", "T-B"]);
  eq("worklog-intel: floor boundary equal is NOT below (kills M06)", wi.detectAnomalies(wiStats, { minLines: wiStats.lineCount }).some((a) => a.kind === "below-floor"), false);
  eq("worklog-intel: floor boundary minus-1 IS below", wi.detectAnomalies(wiStats, { minLines: wiStats.lineCount + 1 }).some((a) => a.kind === "below-floor"), true);
  const FIXMS1 = "Task ID: S-1\nAgent: a\nTask: t\n\nWork Log:\n- x\n";
  eq("worklog-intel: exactly-1 missing summary still fires (kills M07)", wi.detectAnomalies(wi.computeStats(wi.parseWorklog(FIXMS1)), { text: FIXMS1 }).some((a) => a.kind === "missing-stage-summary"), true);
  eq("worklog-intel: startLine 1-based exact (kills M08)", parsed.blocks.map((b) => b.startLine), [4, 16, 24]);
  eq("worklog-intel: endLine boundary exact (kills M09)", [parsed.blocks[0].endLine, parsed.blocks.at(-1).endLine], [15, 27]);
  const FIXNOAG = "Task ID: N-1\nTask: t\n\nStage Summary:\n- s\n";
  eq("worklog-intel: agentless block keyed (ללא-סוכן) (kills M10)", wi.computeStats(wi.parseWorklog(FIXNOAG)).perAgent["(ללא-סוכן)"], 1);
    eq("worklog-intel: taskId trimmed (kills M13)", wi.parseWorklog("Task ID:   T-9  \nAgent: a\nTask: t\n").blocks[0].taskId, "T-9");
  /* R259 · fuzz תפס: U+2028/U+2029 (מפרידי-שורה-של-ECMAScript — JSON.stringify פולט-אותם-גולמיים-מאז-ES2019)
   * דבוקים-לפני-כותרת השתיקו-בלוקים — אותה-משפחה-שקטה-של-CRLF/BOM; מנורמלים-עכשיו-כולם. */
  const FIXUSEP = "prose\u2028Task ID: U-1\nAgent: a\nTask: t\n\u2029Task ID: U-2\nAgent: b\nTask: t2\n";
  eq("worklog-intel: U+2028/U+2029 glued headers parse (fuzz class)", wi.parseWorklog(FIXUSEP).blocks.map((b) => b.taskId), ["U-1", "U-2"]);
  eq("worklog-intel: U+2028/U+2029 lineCount measured", wi.parseWorklog(FIXUSEP).lineCount, 9);
  const cliSrc = await (async () => {
    try {
      const fsx = await import("node:fs");
      return fsx.readFileSync(new URL("../../scripts/worklog-analytics.mjs", import.meta.url), "utf8");
    } catch {
      return "";
    }
  })();
  ok("worklog-intel: CLI module exists (scripts/worklog-analytics.mjs)", cliSrc.includes("--selftest") && cliSrc.includes("detectAnomalies"));
}

/* R253 · TASKGRAPH + DECISIONQUEUE: גל-2 של זיקוק-agentcraft — תיאום-סוכנים-מבני.
 * done-only-via-verified-push = התרופה-המבנית ל-custodian-sweeps (95e90d2); DecisionQueue =
 * פעולות-מפעיל יוצאות-כהחלטות-גלויות ולא-עוצרות-בשקט (הפטול של PAT-E403×3).
 * מודולים-טהורים — אין-fs/רשת; הראיות-האמיתיות מחושבות-רק-ב-CLI. */
{
  const tg = await import("./taskgraph.mjs");
  const dq = await import("./decisionqueue.mjs");

  const G = () => ({
    tasks: [
      tg.createTask({ id: "A", title: "ראשונה", priority: 5, createdAt: "2026-01-01T00:00:00Z" }),
      tg.createTask({ id: "B", title: "תלויה", priority: 3, deps: ["A"], createdAt: "2026-01-01T00:01:00Z" }),
      tg.createTask({ id: "C", title: "מקבילה", priority: 1, createdAt: "2026-01-01T00:02:00Z" }),
    ],
  });

  eq("taskgraph: legal transition", tg.canTransition("todo", "doing"), true);
  eq("taskgraph: terminal blocks all", tg.canTransition("done", "doing"), false);
  eq("taskgraph: review can done (gated)", tg.canTransition("review", "done"), true);
  eq("taskgraph: createTask defaults", [G().tasks[0].status, G().tasks[0].statusHistory.length], ["todo", 1]);
  eq("taskgraph: deps gate holds B", tg.ready(G()).map((t) => t.id), ["A", "C"]);
  eq("taskgraph: ready priority order", tg.ready(G()).map((t) => t.id)[0], "A");
  const g1 = G();
  tg.setStatus(g1, "A", "doing"); tg.setStatus(g1, "A", "review");
  eq("taskgraph: history trail", g1.tasks[0].statusHistory.map((h) => h.to), ["todo", "doing", "review"]);
  let caught = null;
  try { tg.setStatus(g1, "A", "done", { evidence: null }); } catch (e) { caught = e.code; }
  eq("taskgraph: done-gate refuses null evidence", caught, "DONE-GATE-REFUSED");
  caught = null;
  try { tg.setStatus(g1, "A", "done", { evidence: { selftestGreen: true, selftestFresh: false, pushRecorded: true, pushShas: [] } }); } catch (e) { caught = e.code; }
  eq("taskgraph: done-gate refuses stale selftest", caught, "DONE-GATE-REFUSED");
  const g2 = G();
  tg.setStatus(g2, "A", "doing"); tg.setStatus(g2, "A", "review");
  const sha = "sha-abc123";
  tg.setStatus(g2, "A", "done", { evidence: { selftestGreen: true, selftestFresh: true, pushRecorded: true, pushShas: [sha] }, commit: sha });
  eq("taskgraph: done passes via gate", g2.tasks[0].status, "done");
  eq("taskgraph: deps released after done", tg.ready(g2).map((t) => t.id), ["B", "C"]);
  const g3 = G();
  tg.setStatus(g3, "A", "doing");
  eq("taskgraph: progress mixed", tg.progress(g3), 0.133);
  const cyc = { tasks: [tg.createTask({ id: "X", title: "x", deps: ["Y"] }), tg.createTask({ id: "Y", title: "y", deps: ["X"] })] };
  eq("taskgraph: cycle detected", tg.validateGraph(cyc).ok, false);
  eq("taskgraph: unknown status caught", tg.validateGraph({ tasks: [{ id: "Z", status: "zap", deps: [] }] }).ok, false);
  eq("taskgraph: serialize roundtrip", tg.serialize(tg.deserialize(tg.serialize(g2))), tg.serialize(g2));
  const d1 = tg.runDrill(7);
  const d2 = tg.runDrill(7);
  eq("taskgraph: drill deterministic", [d1.ok, d1.steps.length === d2.steps.length], [true, true]);
  eq("taskgraph: drill exercises the gate", d1.steps.some((s) => s.includes("DONE-GATE-REFUSED")), true);

  const mk = () => ({ decisions: [dq.createDecision({ id: "D1", kind: "question", question: "לאיזה-כיוון?", options: ["כן", "לא"], createdAt: "2026-01-01T00:00:00Z" })] });
  const q1 = mk();
  eq("decisionqueue: recommended-first", q1.decisions[0].options.map((o) => o.recommended), [true, false]);
  eq("decisionqueue: match by index", dq.matchOption(q1.decisions[0].options, "2"), 1);
  eq("decisionqueue: match exact caseless", dq.matchOption(q1.decisions[0].options, "  לא "), 1);
  eq("decisionqueue: match unique prefix", dq.matchOption([{ label: "public" }, { label: "private" }], "pub"), 0);
  caught = null;
  try { dq.matchOption([{ label: "כן-עכשיו" }, { label: "כן-מחר" }], "כן"); } catch (e) { caught = e.code; }
  eq("decisionqueue: ambiguous prefix caught", caught, "AMBIGUOUS");
  caught = null;
  try { dq.matchOption(q1.decisions[0].options, "אולי"); } catch (e) { caught = e.code; }
  eq("decisionqueue: no-match caught", caught, "NO-MATCH");
  const q2 = mk();
  dq.answerDecision(q2, "D1", { by: "operator", optionIndex: 1 });
  eq("decisionqueue: answer recorded", [q2.decisions[0].status, q2.decisions[0].answer.option], ["answered", "לא"]);
  caught = null;
  try { dq.answerDecision(q2, "D1", { optionIndex: 1 }); } catch (e) { caught = e.code; }
  eq("decisionqueue: double-answer refused", caught, "NOT-OPEN");
  caught = null;
  try { dq.settleDecision(q2, "NOPE"); } catch (e) { caught = e.code; }
  eq("decisionqueue: settle unknown caught", caught, "NO-DECISION");
  const q3 = mk();
  caught = null;
  try { dq.settleDecision(q3, "D1"); } catch (e) { caught = e.code; }
  eq("decisionqueue: settle before answer refused", caught, "NOT-ANSWERED");
  dq.answerDecision(q3, "D1", { optionIndex: 1 });
  dq.settleDecision(q3, "D1");
  eq("decisionqueue: settle after answer", q3.decisions[0].status, "settled");
  dq.reopenDecision(q3, "D1", "Merge refused: סיבה-מתועדת");
  eq("decisionqueue: reopen restores open", [q3.decisions[0].status, q3.decisions[0].answer], ["open", null]);
  eq("decisionqueue: reopen reason in history", q3.decisions[0].statusHistory.at(-1).reason, "Merge refused: סיבה-מתועדת");
  const q4 = mk();
  dq.cancelDecision(q4, "D1", "מיותרת");
  eq("decisionqueue: cancel", q4.decisions[0].status, "cancelled");
  caught = null;
  try { dq.reopenDecision(q4, "D1", "x"); } catch (e) { caught = e.code; }
  eq("decisionqueue: no reopen after cancel", caught, "CANCELLED");
  const q5 = {
    decisions: [
      dq.createDecision({ id: "LATE", kind: "question", question: "שנייה", options: ["a"], createdAt: "2026-01-02T00:00:00Z" }),
      dq.createDecision({ id: "EARLY", kind: "merge", question: "ראשונה", options: ["b"], createdAt: "2026-01-01T00:00:00Z" }),
    ],
  };
  eq("decisionqueue: listOpen oldest-first", dq.listOpen(q5).map((d) => d.id), ["EARLY", "LATE"]);
  eq("decisionqueue: validate catches ghost answer", dq.validateDQ({ decisions: [{ ...dq.createDecision({ id: "G", kind: "question", question: "x", options: ["a"] }), status: "answered", answer: null }] }).ok, false);
  eq("decisionqueue: dq roundtrip", dq.serializeDQ(dq.deserializeDQ(dq.serializeDQ(q2))), dq.serializeDQ(q2));
  /* R259 · מנוע-המוטציות — הריגות-שנותרו-ב-taskgraph/decisionqueue: */
  const gr = G();
  tg.setStatus(gr, "A", "doing"); tg.setStatus(gr, "A", "review");
  eq("taskgraph: progress weights review=0.75 (kills M14)", tg.progress(gr), 0.25);
  eq("taskgraph: createTask dedupes deps (kills M17)", tg.createTask({ id: "DD", title: "d", deps: ["A", "A", "A"] }).deps, ["A"]);
  eq("taskgraph: validate catches duplicate id (kills M18)", tg.validateGraph({ tasks: [tg.createTask({ id: "D", title: "1" }), tg.createTask({ id: "D", title: "2" })] }).errors.some((e) => e.includes("כפילות-id")), true);
  caught = null;
  try { tg.createTask({ id: "SD", title: "s", deps: ["SD"] }); } catch (e) { caught = e.code; }
  eq("taskgraph: createTask refuses self-dep (kills M20)", caught, "SELF-DEP");
  eq("taskgraph: validate catches self-dep (kills M20b)", tg.validateGraph({ tasks: [{ id: "SD", title: "s", status: "todo", deps: ["SD"] }] }).errors.some((e) => e.includes("תלות-עצמית")), true);
  const gsh = G();
  tg.setStatus(gsh, "A", "doing"); tg.setStatus(gsh, "A", "review");
  gsh.tasks[0].commit = sha;
  caught = null;
  try { tg.setStatus(gsh, "A", "done", { evidence: { selftestGreen: true, selftestFresh: true, pushRecorded: true, pushShas: ["sha-OTHER"] }, commit: sha }); } catch (e) { caught = e.code; }
  eq("taskgraph: done-gate binds commit to push evidence (kills M21)", caught, "DONE-GATE-REFUSED");
  eq("taskgraph: mulberry32 coerces seed to uint32 (kills M22)", tg.mulberry32(2 ** 32)(), tg.mulberry32(0)());
  eq("decisionqueue: match caseless ascii (kills M23)", dq.matchOption([{ label: "APPROVE" }, { label: "DENY" }], "approve"), 0);
  caught = null;
  try { dq.matchOption([{ label: "A" }, { label: "B" }], "0"); } catch (e) { caught = e.code; }
  eq("decisionqueue: numeric 0 refused (kills M25)", caught, "NO-MATCH");
  /* ── R260 · סבב-הענקים: פרובות-חיות שהפכו-לחוק ──
   * P1 — תשובה-ריקה-שמתחזה: `decision-answer <id>` חשוף שמר answer={by,at} וסגר-החלטה
   * בשקט (נמדד-חי, rc=0). תשובה-חייבת-לומר-משהו. */
  caught = null;
  try { dq.answerDecision(mk(), "D1", {}); } catch (e) { caught = e.code; }
  eq("decisionqueue: bare answer (no option/text) refused — no silent pretense (R260 P1)", caught, "INVALID-DECISION");
  caught = null;
  try { dq.answerDecision(mk(), "D1", { text: "" }); } catch (e) { caught = e.code; }
  eq("decisionqueue: empty-string text is still no content (R260 P1)", caught, "INVALID-DECISION");
  /* P4 — חוזה-מיון-מכונה חף-מ-ICU: localeCompare("a","B") = -1 (ICU) אבל code-unit אומר B<a;
   * build-חף-ICU של node (או גרסת-ICU אחרת) מסדר-שוב. תור-המפעיל חוזה-מכונה — לא-תלות-סביבה. */
  const gIcu = { tasks: [
    tg.createTask({ id: "T-a", title: "a", createdAt: "2026-01-01T00:00:00Z" }),
    tg.createTask({ id: "T-B", title: "b", createdAt: "2026-01-01T00:00:00Z" }),
  ] };
  eq("taskgraph: ready tie-break is code-unit, ICU-free (B<a, not ICU's a<B) (R260 P4)", tg.ready(gIcu).map((t) => t.id), ["T-B", "T-a"]);
  eq("decisionqueue: listOpen tie-break code-unit (R260 P4)", dq.listOpen({ decisions: [
    dq.createDecision({ id: "b-1", kind: "question", question: "x", options: ["a"], createdAt: "2026-01-01T00:00:00Z" }),
    dq.createDecision({ id: "B-2", kind: "question", question: "y", options: ["a"], createdAt: "2026-01-01T00:00:00Z" }),
  ] }).map((d) => d.id), ["B-2", "b-1"]);
  /* P9 — state-פגום-מבנית נדחה-בשם (נמדד: עדיפות-חסרה רונדרה "Pundefined"; deps-מחרוזת
   * נאספה תו-תו; אפשרויות-חסרות קרסו ב-TypeError-גולמי-של-מנוע-הריצה) */
  eq("taskgraph: validateGraph refuses deps-as-string (R260 P9)", tg.validateGraph({ tasks: [{ id: "S", title: "s", status: "todo", deps: "AB", priority: 0 }] }).errors.some((e) => e.includes("deps-לא-מערך")), true);
  eq("taskgraph: validateGraph refuses junk priority (R260 P9)", tg.validateGraph({ tasks: [{ id: "S", title: "s", status: "todo", deps: [], priority: "high" }] }).errors.some((e) => e.includes("עדיפות-פגומה")), true);
  eq("taskgraph: validateGraph refuses empty title (R260 P9)", tg.validateGraph({ tasks: [{ id: "S", title: "", status: "todo", deps: [], priority: 0 }] }).errors.some((e) => e.includes("כותרת-פגומה")), true);
  eq("decisionqueue: validateDQ refuses missing options array (R260 P9)", dq.validateDQ({ decisions: [{ id: "X", kind: "question", question: "q", status: "open" }] }).errors.some((e) => e.includes("אפשרויות-פגומות")), true);
}

/* ── R254 · DASH-LAW + LEGAL IMAGES + SMART-REPLY + HIVE GATES + SLOTS ────── */
{
  const { normalizeDashes, sanitizeDraft: sd2, wordCount: wc2, MIN_POST_WORDS: mpw } = await import("./content.mjs");
  const { licenseOk, pickImage, creditLine, embedImage, queryFor } = await import("./illustrate.mjs");
  const { repFromRaw, replyTargetVerdict, fleetPublishMinutes } = await import("./army-social.mjs");
  const { flagPauseVerdict, chainGate } = await import("./spamgate.mjs");
  const { HIVE_CHAIN_ID, STEEM_CHAIN_ID } = await import("./steemtx.mjs");

  eq("dashes: spaced em → colon", normalizeDashes("a — b"), "a: b");
  eq("dashes: bare em → colon-space", normalizeDashes("a—b"), "a: b");
  eq("dashes: spaced en → colon", normalizeDashes("a – b"), "a: b");
  eq("dashes: bare en (range) → hyphen", normalizeDashes("5–7"), "5-7");
  eq("dashes: plain text untouched", normalizeDashes("a, b; c"), "a, b; c");

  const longBody = `The first frost always finds the small things first. ${"A sentence about the quiet work of a season and its long shadow. ".repeat(45)}`;
  const dashy = sd2({ title: "A season measured in small quiet things", body: `${longBody} It ships: one rule — ship it — under the hood. What do you keep?`, tags: ["life", "seasons"] });
  eq("dash-draft SURVIVES via normalizer", dashy ? dashy.title.slice(0, 10) : null, "A season m");
  eq("dash-draft has zero em-dashes", dashy ? dashy.body.includes("—") : true, false);
  const illegalImg = sd2({ title: "A season measured in small quiet things", body: longBody, tags: ["life", "seasons"], image: { url: "https://evil.example/x.png", alt: "x", credit: "x" } });
  eq("non-wikimedia image rejected", illegalImg?.image ?? null, null);
  eq("wordCount counts words", wc2("one two three"), 3);

  eq("license: CC0 ok", licenseOk("CC0 1.0"), true);
  eq("license: CC BY-SA ok", licenseOk("CC BY-SA 4.0"), true);
  eq("license: all-rights-reserved refused", licenseOk("© all rights reserved"), false);
  eq("license: empty refused", licenseOk(""), false);
  const picked = pickImage([
    { url: "https://upload.wikimedia.org/a.jpg", license: "fair use", width: 1200, height: 800 },
    { url: "https://upload.wikimedia.org/b.jpg", license: "CC BY 2.0", width: 1400, height: 900 },
  ], 1);
  eq("pickImage drops non-free", picked?.license, "CC BY 2.0");
  eq("creditLine names author+license", creditLine({ artist: "Ada", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:X" }).startsWith("Image: Ada, CC0"), true);
  const emb = embedImage("BODY", { url: "https://upload.wikimedia.org/b.jpg", alt: "alt text", artist: "Ada", license: "CC0", page: "" });
  eq("embedImage appends md+credit", emb.startsWith("BODY\n\n![alt text]("), true);
  eq("embedImage idempotent", embedImage(emb, { url: "https://upload.wikimedia.org/b.jpg", alt: "a", artist: "x", license: "CC0", page: "" }), emb);
  eq("queryFor prefers concrete tags", queryFor(null, ["food", "story", "culture"], "t"), "food culture");
  eq("queryFor skips abstract life", queryFor(null, ["life", "tools"], "t"), "tools");

  eq("rep: raw 1e9 = rep 25", repFromRaw(1e9), 25);
  eq("rep: raw 0 = rep 0", repFromRaw(0), 0);
  eq("reply: fleet always relevant", replyTargetVerdict({ author: "wog", repRaw: 0, body: "x", isFleet: true }).class, "fleet");
  eq("reply: bot name skipped", replyTargetVerdict({ author: "upvote-bot", repRaw: 1e12, body: "long enough comment body" }).class, "skip");
  eq("reply: low rep skipped", replyTargetVerdict({ author: "freshhuman", repRaw: 100, body: "long enough comment body here" }).reasons[0].startsWith("low-rep"), true);
  eq("reply: template-praise skipped", replyTargetVerdict({ author: "humanone", repRaw: 1e10, body: "that's a great post!" }).class, "skip");
  eq("reply: real human passes", replyTargetVerdict({ author: "humanone", repRaw: 1e10, body: "What did you use to measure the gap between the frames?" }).class, "human");

  const slots = fleetPublishMinutes("2026-10-07", ["a", "b", "c", "d"], { window: [11, 21] });
  eq("slots: 4 distinct minutes", new Set(Object.values(slots)).size, 4);
  eq("slots: inside window", Object.values(slots).every((m) => m >= 660 && m < 1260), true);
  eq("slots: deterministic", JSON.stringify(fleetPublishMinutes("2026-10-07", ["a", "b"], { window: [11, 21] })), JSON.stringify(fleetPublishMinutes("2026-10-07", ["a", "b"], { window: [11, 21] })));
  eq("schedule: publishMinute pinned", buildDaySchedule(42, { publishMinute: 777 })[0].minute, 777);

  eq("flagPause: none", flagPauseVerdict({ flags: 0 }).pause, false);
  eq("flagPause: one flag pauses", flagPauseVerdict({ flags: 1, author: "x", permlink: "p", chain: "hive" }).pause, true);
  eq("chainGate: hive = stricter trial", chainGate("hive").trial, true);
  eq("chainGate: hive minPostChars 1600", chainGate("hive").g.minPostChars, 1600);
  eq("chainGate: blurt refused", chainGate("blurt").ok, false);
  eq("chainGate: steem plain", chainGate("steem").trial, false);
  eq("crossChain: hive allowed", crossChainVerdict("hive").ok, true);
  eq("crossChain: blurt still refused", crossChainVerdict("blurt").ok, false);
  eq("hive chain id is beeab0de…", HIVE_CHAIN_ID.slice(0, 4).toString("hex"), "beeab0de");
  eq("steem chain id is 32 zero bytes", STEEM_CHAIN_ID.every((b) => b === 0), true);
}

/* ── R255 · THE PERSONA ENGINE (canon, arcs, profiles, assignment) ─────── */
{
  eq("personas: 14 canon voices", PERSONA_IDS.length, 14);
  eq("personas: roster covered", ["headcorner", ...["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"], "hcsoldier4", "hcsoldier5", "hcsoldier6"].every((a) => personaOf(a)), true);
  eq("personas: unknown = null", personaOf("spaminator"), null);
  eq("personas: register dials sum to 100", PERSONA_IDS.every((id) => PERSONAS[id].register.pro + PERSONAS[id].register.hood === 100), true);
  eq("personas: zero dashes in any field", PERSONA_IDS.every((id) => !JSON.stringify(PERSONAS[id]).includes("\u2014") && !JSON.stringify(PERSONAS[id]).includes("\u2013")), true);
  eq("personas: every voice owns topics + slang", PERSONA_IDS.every((id) => PERSONAS[id].owns.length >= 3 && PERSONAS[id].slang.length >= 3 && PERSONAS[id].traits.length === 3), true);
  eq("personas: arc stages = 4 for all", PERSONA_IDS.every((id) => PERSONAS[id].arc.length === 4), true);

  const st0 = arcStageOf("lsa", 0);
  const st1 = arcStageOf("lsa", 4);
  const st3 = arcStageOf("lsa", 18);
  eq("arc: stage 0 at zero posts", st0.index, 0);
  eq("arc: advances at threshold 4", st1.index, 1);
  eq("arc: top stage at 18", st3.index, 3);
  eq("arc: nextAt pointer", st1.nextAt, 10);
  eq("arc: negative clamps to 0", arcStageOf("lsa", -5).index, 0);
  eq("arc: unknown account = null", arcStageOf("spaminator", 9), null);

  const doc = profileDoc("macrame");
  ok("profileDoc: about bounded", doc && doc.about.length <= 200 && doc.name.length <= 40);
  ok("profileDoc: interests sanitized", doc && doc.interests.every((i) => /^[a-z0-9-]{1,24}$/.test(i)));
  eq("profileDoc: exposure-guard passes for canon", PERSONA_IDS.every((id) => profileDoc(id) !== null), true);

  const merged = mergeProfileMetadata('{"app":"x","profile":{"cover_image":"https://i.example/c.png"}}', { name: "N", about: "A", interests: ["a"] });
  ok("merge: unknown top-level keys survive", JSON.parse(merged).app === "x");
  ok("merge: unknown profile keys survive", JSON.parse(merged).profile.cover_image === "https://i.example/c.png");
  ok("merge: persona fields applied", JSON.parse(merged).profile.name === "N");
  eq("merge: garbage metadata tolerated", Object.keys(JSON.parse(mergeProfileMetadata("not-json-at-all", { name: "N", about: "A", interests: [] }))).length, 1);

  eq("diff: same profile = idempotent", profileDiffers(mergeProfileMetadata("{}", { name: "N", about: "A", interests: ["a"] }), { name: "N", about: "A", interests: ["a"] }), false);
  eq("diff: changed about differs", profileDiffers("{}", { name: "N", about: "A", interests: [] }), true);

  const assigned = assignPersonas([
    { title: "a", tags: ["repair"], groundedOn: ["repair"] },
    { title: "b", tags: ["craft"], groundedOn: ["craft"] },
    { title: "c", tags: ["life"], groundedOn: ["attention"] },
  ]);
  eq("assign: ownership match", [assigned[0].persona, assigned[1].persona], ["haran", "macrame"]);
  ok("assign: no voice twice in one batch", new Set(assigned.filter((d) => d.persona).map((d) => d.persona)).size === assigned.filter((d) => d.persona).length);
  eq("assign: explicit persona wins", assignPersonas([{ persona: "wic", tags: ["repair"], groundedOn: ["repair"] }])[0].persona, "wic");

  const brief = personaBrief("cashmachine", 5);
  ok("brief: contains lens + stage", brief.includes("counter") && brief.includes("development stage (2/4)"));
  ok("brief: carries personal slang", brief.includes("no free lunch"));
  eq("brief: unknown = null", personaBrief("spaminator", 0), null);

  /* R255 · the account_update2 chain-truth lock: op id 43 probed from the
   * node's own serialization (get_transaction_hex, 2026-10-07); the byte
   * shape is the regression guard for the phantom-write fix. */
  eq("account_update2 op-id = 43 (chain truth)", OP_IDS.account_update2, 43);
  const au2 = serializeTx({ ref_block_num: 0, ref_block_prefix: 0, expiration: 0, operations: [["account_update2", { account: "hcsoldier4", owner: null, active: null, posting: null, memo_key: "STM1111111111111111111111111111111114T1Anm", json_metadata: "{\"x\":1}", posting_json_metadata: "{\"x\":1}", extensions: [] }]], extensions: [] });
  eq("account_update2: op-count + op-id bytes", [au2[10], au2[11]], [1, 43]);
  eq("account_update2: account str then absent authorities varint(0)x3", [au2[12], au2[23], au2[24], au2[25]], [10, 0, 0, 0]);
  eq("account_update2: extensions terminator", au2[au2.length - 1], 0);
}

console.log(`\nSELFTEST ${pass}/${pass + fail} ${fail === 0 ? "PASS" : "FAIL"}`);
/* T-21 · last-run marker: the recruiter's evidence for the integrity-auditor
 * role — written ONLY on a full run, never by a partial import. */
try {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const STATE = path.join(path.dirname(new URL(import.meta.url).pathname), "state");
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(path.join(STATE, "selftest-last-run.json"), JSON.stringify({ pass, fail, at: new Date().toISOString(), vectors: pass + fail }, null, 2));
} catch { /* state dir may be read-only in CI — the verdict above stands */ }
process.exit(fail === 0 ? 0 : 1);
