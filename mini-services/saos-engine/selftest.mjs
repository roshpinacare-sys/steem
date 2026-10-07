/**
 * selftest.mjs — deterministic offline vectors for the sovereign-local core.
 * Zero network, zero clock, zero randomness. RUN: bun selftest.mjs
 */
import {
  dragK, inventorySkew, planLadder, planConvert, planRedeploy, classifyStale, pnlFromFills, guardDepth, parityVerdict,
  MIN_LEVEL, ASK_FLOOR_BPS,
  doctrineAccount, credentialGate, rcAnomaly, recruitRoles, aggregateRails,
  normalizeWebIntel, webIntelFresh,
  payoutWindow, rewardHistoryRollup, vpNow, x2Spectrum, weaveArbitration, weaveFresh, opTypeName,
} from "./lib.mjs";
import { sanitizeDraft } from "./content.mjs";
import { tick, fold } from "./grid.mjs";
import { classifyAgent } from "./fleet.mjs";

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

/* 8 · PSM hysteresis: enter at 3000, stay armed down to 2000, exit below */
const mk = (edge) => ({ liquidSbd: 5, parity: P, marketSbdUsd: 1 / (1 + edge), previouslyArmed: false });
eq("psm below-enter", planConvert(mk(0.29)).verdict, "CONVERT-HOLD");
eq("psm enter", planConvert(mk(0.30)).verdict, "CONVERT-PLAN");
const armedHold = planConvert({ liquidSbd: 5, parity: P, marketSbdUsd: 1 / 1.22, previouslyArmed: true });
eq("psm hysteresis-hold", armedHold.verdict, "CONVERT-PLAN");
const armedExit = planConvert({ liquidSbd: 5, parity: P, marketSbdUsd: 1 / 1.19, previouslyArmed: true });
eq("psm hysteresis-exit", armedExit.verdict, "CONVERT-HOLD");
eq("psm dust", planConvert({ liquidSbd: 0.2, parity: P, marketSbdUsd: 0.6, previouslyArmed: false }).verdict, "CONVERT-HOLD");
const psmCap = planConvert({ liquidSbd: 50, parity: P, marketSbdUsd: 0.6, pendingSbd: 9.8, previouslyArmed: false });
eq("psm cap honest-hold (0.2<min dust)", psmCap.verdict, "CONVERT-HOLD");
eq("psm cap amount", psmCap.amountSbd, 0);
const psmCap2 = planConvert({ liquidSbd: 50, parity: P, marketSbdUsd: 0.6, pendingSbd: 8.5, previouslyArmed: false });
eq("psm cap partial", psmCap2.amountSbd, 1.5);

/* 8b · T-9 structural truth: no external SBD market ⇒ honest HOLD (never arm on proxy) */
eq("psm no-market honest-hold", planConvert({ liquidSbd: 50, parity: P, marketSbdUsd: 0, previouslyArmed: false }).verdict, "CONVERT-HOLD");

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
eq("psm no-market reason", planConvert({ liquidSbd: 50, parity: P, marketSbdUsd: 0, previouslyArmed: true }).reason, "no-market-price");

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
eq("cancel op exact size", binC.length, 28);

/* vote op serializes (posting-authority op — T-13 curator rail) */
const binVote = serializeTx({ ref_block_num: 1, ref_block_prefix: 2, expiration: 3, operations: [["vote", { voter: "headcorner", author: "someone", permlink: "a-permlink", weight: 5000 }]] });
ok("vote op serializes", binVote.length > 30);
// negative weight (downvote) must serialize too — policy never emits it, chain accepts it
// (tiny names ⇒ 21 bytes total: 11 header + 1 count + 1 opid + 2+2+2 strs + 2 weight)
const binDown = serializeTx({ ref_block_num: 1, ref_block_prefix: 2, expiration: 3, operations: [["vote", { voter: "a", author: "b", permlink: "c", weight: -1000 }]] });
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
const goodDraft = sanitizeDraft({ title: "How RC economics shapes Steem trading tools", body: "x".repeat(200), tags: ["steem", "rc", "trading"], angle: "educational" });
ok("content valid-draft-passes", goodDraft != null && goodDraft.tags.length === 3);
ok("content tags-normalized", sanitizeDraft({ title: "A title long enough here", body: "x".repeat(150), tags: ["STEEM!", "Trading"] })?.tags.join(",") === "steem,trading");
ok("content stub-blocked", sanitizeDraft({ title: "short", body: "x", tags: ["a", "b"] }) === null);
ok("content too-few-tags-blocked", sanitizeDraft({ title: "A title long enough here", body: "x".repeat(150), tags: ["onlyone"] }) === null);
ok("content exposure-headcorner-blocked", sanitizeDraft({ title: "How headcorner trades the SBD book", body: "x".repeat(200), tags: ["a", "b"] }) === null);
ok("content exposure-army-blocked", sanitizeDraft({ title: "Our multi-account coordination story", body: "x".repeat(200), tags: ["a", "b"] }) === null);
ok("content exposure-profit-blocked", sanitizeDraft({ title: "Guaranteed profit method inside", body: "x".repeat(200), tags: ["a", "b"] }) === null);
ok("content null-input", sanitizeDraft(null) === null);

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
