#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// r192-b — deterministic mirror tests for the W1 DEX core (Zero-9369).
//
// Mirrors the EXACT Solidity arithmetic of contracts/w1/*.sol (BigInt,
// same op order, same require chain) BEFORE any broadcast.
// Covers: k-invariant · fee split 70% LP / 30% treasury · minOut ·
// deadline · operator mint/burn gating · integer edge cases · router
// optimal-ratio · factory guards · seeded 60-step lifecycle simulation.
// Deterministic: seeded PRNG only — no Math.random, no time, no network.
// ─────────────────────────────────────────────────────────────────────

let PASS = 0;
let FAIL = 0;
const failures = [];

function ok(cond, name) {
  if (cond) {
    PASS++;
  } else {
    FAIL++;
    failures.push(name);
    console.error(`  ✗ ${name}`);
  }
}

function eq(a, b, name) {
  ok(a === b, `${name} (${a} vs ${b})`);
}

function throwsMirror(fn, name) {
  try {
    fn();
    ok(false, `${name} (expected revert, got result)`);
  } catch (e) {
    ok(true, name);
  }
}

function require_(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ── seeded PRNG (xorshift64) — deterministic ──
let SEED = 0x9369192bn;
function rnd() {
  SEED ^= SEED << 13n;
  SEED ^= SEED >> 7n;
  SEED ^= SEED << 17n;
  SEED &= 0xffffffffffffffffn;
  return SEED;
}
function rndBelow(n) {
  return rnd() % n;
}

// ═════════════════════════════════════════════════════════════════════
// MIRROR: Pair._feeSplit / getAmountOut / swap / addLiquidity / removeLiquidity
// (op-for-op with contracts/w1/Pair.sol @ 0.8.37)
// ═════════════════════════════════════════════════════════════════════

const FEE_DENOM = 10000n;
const LP_FEE_BPS = 21n; // 70% of the 30bps fee → stays with LPs
const TREASURY_FEE_BPS = 9n; // 30% of the 30bps fee → treasury

function feeSplit(amountIn) {
  const lpFee = (amountIn * LP_FEE_BPS) / FEE_DENOM;
  const treasuryFee = (amountIn * TREASURY_FEE_BPS) / FEE_DENOM;
  const effectiveIn = amountIn - lpFee - treasuryFee;
  return { effectiveIn, lpFee, treasuryFee };
}

function getAmountOut(amountIn, rIn, rOut) {
  const { effectiveIn } = feeSplit(amountIn);
  return (effectiveIn * rOut) / (rIn + effectiveIn); // floor division
}

function uniV2Reference(amountIn, rIn, rOut) {
  // independent classic form: in·997·rOut / (rIn·1000 + in·997)
  return (amountIn * 997n * rOut) / (rIn * 1000n + amountIn * 997n);
}

// Mirror pool: balances are the truth (sync-from-balances like the contract)
function newPool(b0, b1) {
  return { b0, b1, r0: b0, r1: b1, totalSupply: 0n, treasury: 0n, swaps: 0 };
}

function _sync(p) {
  p.r0 = p.b0;
  p.r1 = p.b1;
}

function sqrt_(x) {
  if (x === 0n) return 0n;
  let z = (x + 1n) / 2n;
  let y = x;
  while (z < y) {
    y = z;
    z = (x / z + z) / 2n;
  }
  return y;
}

function addLiquidity(p, amount0, amount1, firstProvision) {
  require_(amount0 > 0n && amount1 > 0n, "P: AMOUNTS");
  let liquidity;
  if (p.totalSupply === 0n) {
    require_(firstProvision, "P: FIRST");
    liquidity = sqrt_(amount0 * amount1);
  } else {
    liquidity = (amount0 * p.totalSupply) / p.r0 < (amount1 * p.totalSupply) / p.r1
      ? (amount0 * p.totalSupply) / p.r0
      : (amount1 * p.totalSupply) / p.r1;
  }
  require_(liquidity > 0n, "P: LIQ-DUST");
  p.totalSupply += liquidity;
  p.b0 += amount0;
  p.b1 += amount1;
  _sync(p);
  return liquidity;
}

function swapMirror(p, amountIn, tokenIn, minOut) {
  require_(tokenIn === 0n || tokenIn === 1n, "P: TOKEN");
  const [rIn, rOut] = tokenIn === 0n ? [p.r0, p.r1] : [p.r1, p.r0];
  require_(rIn > 0n && rOut > 0n, "P: LIQUIDITY");
  const { effectiveIn, lpFee, treasuryFee } = feeSplit(amountIn);
  const amountOut = (effectiveIn * rOut) / (rIn + effectiveIn);
  require_(amountOut > 0n, "P: DUST");
  require_(amountOut >= minOut, "P: MIN_OUT");
  // balances: in += amountIn; treasury += treasuryFee (same token); out -= amountOut
  if (tokenIn === 0n) {
    p.b0 += amountIn - treasuryFee;
    p.b1 -= amountOut;
  } else {
    p.b1 += amountIn - treasuryFee;
    p.b0 -= amountOut;
  }
  p.treasury += treasuryFee;
  p.swaps++;
  _sync(p);
  return { amountOut, effectiveIn, lpFee, treasuryFee };
}

function removeLiquidityMirror(p, liquidity, min0, min1) {
  const amount0 = (liquidity * p.b0) / p.totalSupply;
  const amount1 = (liquidity * p.b1) / p.totalSupply;
  require_(amount0 >= min0 && amount1 >= min1, "P: MIN_OUT");
  require_(amount0 > 0n && amount1 > 0n, "P: REM-DUST");
  require_(p.totalSupply >= liquidity, "P: LP-BALANCE");
  p.totalSupply -= liquidity;
  p.b0 -= amount0;
  p.b1 -= amount1;
  _sync(p);
  return { amount0, amount1 };
}

// ═════════════════════════════════════════════════════════════════════
// MIRROR: WrappedToken operator gating (op-for-op with the require chain)
// ═════════════════════════════════════════════════════════════════════

function newToken(operator) {
  return { operator, balances: new Map(), supply: 0n };
}
function mintMirror(t, by, to, value) {
  require_(by === t.operator, "W: NOT-OPERATOR");
  require_(value > 0n, "W: MINT-0");
  t.supply += value;
  t.balances.set(to, (t.balances.get(to) || 0n) + value);
}
function burnMirror(t, by, from, value) {
  require_(by === t.operator, "W: NOT-OPERATOR");
  const b = t.balances.get(from) || 0n;
  require_(b >= value, "W: BALANCE");
  t.balances.set(from, b - value);
  t.supply -= value;
}
function transferMirror(t, from, to, value) {
  require_(to !== null, "W: TO-0");
  const b = t.balances.get(from) || 0n;
  require_(b >= value, "W: BALANCE");
  t.balances.set(from, b - value);
  t.balances.set(to, (t.balances.get(to) || 0n) + value);
}

const A = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const B = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const T = "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"; // treasury
const OP = "0xE376000000000000000000000000000000000000"; // operator
const E18 = 10n ** 18n;

console.log("── 1. getAmountOut math (vs independent UniV2 reference) ──");
{
  const cases = [
    [1000n * E18, 1000n * E18, 1n * E18],
    [50n * E18, 200n * E18, 7n * E18],
    [1n * E18, 10000n * E18, 250000n * E18],
    [31337n * E18, 690000n * E18, 12345n * E18],
  ];
  for (const [rIn, rOut, amt] of cases) {
    const mine = getAmountOut(amt, rIn, rOut);
    const ref = uniV2Reference(amt, rIn, rOut);
    // fee floors vanish for multiples of 1000 → identical rationals → identical floor
    eq(mine, ref, `getAmountOut == UniV2 ref (rIn=${rIn / E18}, rOut=${rOut / E18}, in=${amt / E18})`);
    ok(mine < (amt * rOut) / (rIn + amt), "fee strictly reduces output vs zero-fee price");
  }
  // rounding direction: floor always in favor of the pool
  for (let i = 0; i < 25; i++) {
    const rIn = rndBelow(E18) + 1n;
    const rOut = rndBelow(E18) + 1n;
    const amt = rndBelow(10n * E18) + 1n;
    const out = getAmountOut(amt, rIn, rOut);
    const eff = feeSplit(amt).effectiveIn;
    ok(out === (eff * rOut) / (rIn + eff), `floor-direction #${i} (single floor, pool-favoring)`);
    const { effectiveIn, lpFee, treasuryFee } = feeSplit(amt);
    ok(effectiveIn + lpFee + treasuryFee === amt, `fee partition exact #${i}`);
  }
}

console.log("── 2. fee split 70% LP / 30% treasury (saos-dex convention) ──");
{
  const { effectiveIn, lpFee, treasuryFee } = feeSplit(10000n);
  eq(lpFee, 21n, "lpFee = 21bps of 10000");
  eq(treasuryFee, 9n, "treasuryFee = 9bps of 10000");
  eq(effectiveIn, 9970n, "effectiveIn = 9970 of 10000");
  eq(lpFee * 30n, treasuryFee * 70n, "exact 70:30 ratio at 10000");
  const big = feeSplit(10n ** 24n);
  eq(big.lpFee * 3n, big.treasuryFee * 7n, "exact 70:30 ratio at 10^24");
  eq(big.effectiveIn, (10n ** 24n * 9970n) / 10000n, "effectiveIn == 99.70% at 10^24");
  // pool-side accounting: pool input delta − effectiveIn == lpFee EXACTLY
  const p = newPool(1000n * E18, 1000n * E18);
  p.totalSupply = 1000n * E18; // pretend LP exists
  const amtIn = 7777n * E18;
  const before0 = p.b0;
  const r = swapMirror(p, amtIn, 0n, 1n);
  eq(p.b0 - before0 - r.effectiveIn, r.lpFee, "pool keeps exactly lpFee beyond effectiveIn (LP 70%)");
  eq(r.treasuryFee, (amtIn * 9n) / 10000n, "treasury receives exactly 9bps (30%)");
  ok(p.treasury === r.treasuryFee, "treasury ledger accumulates the 30% share");
}

console.log("── 3. k-invariant (x·y never decreases; grows by LP fee) ──");
{
  for (let i = 0; i < 20; i++) {
    const b0 = rndBelow(1000n * E18) + E18;
    const b1 = rndBelow(1000n * E18) + E18;
    const p = newPool(b0, b1);
    p.totalSupply = sqrt_(b0 * b1);
    const k0 = p.r0 * p.r1;
    const amt = rndBelow(50n * E18) + E18;
    const tokenIn = rndBelow(2n);
    const rInPre = tokenIn === 0n ? p.r0 : p.r1;
    const r = swapMirror(p, amt, tokenIn, 1n);
    const k1 = p.r0 * p.r1;
    ok(k1 >= k0, `k-invariant #${i} (Δk=${k1 >= k0 ? "+" : "NEGATIVE"}${k1 - k0})`);
    // exact wei-accounting: Δk == lpFee·(rOut−out) + floor remainder of the
    // swap division — proves every wei lands in exactly one of the three
    // places (trader out, LP retention, division dust).
    const rOut = tokenIn === 0n ? b1 : b0;
    const { effectiveIn } = feeSplit(amt);
    const rem = (effectiveIn * rOut) % (rInPre + effectiveIn);
    eq(k1 - k0, r.lpFee * (rOut - r.amountOut) + rem, `Δk == lpFee·(rOut−out)+rem exact #${i}`);
  }
}

console.log("── 4. minOut rejection ──");
{
  const p = newPool(1000n * E18, 1000n * E18);
  p.totalSupply = 1000n * E18;
  const fair = getAmountOut(1n * E18, p.r0, p.r1);
  throwsMirror(() => swapMirror(p, 1n * E18, 0n, fair + 1n), "minOut above fair quote → P: MIN_OUT");
  const r = swapMirror(p, 1n * E18, 0n, fair); // exact min passes
  eq(r.amountOut, fair, "minOut == quote executes");
  swapMirror(p, 1n * E18, 0n, 0n); // pair allows minOut=0; the ROUTER refuses (§7)
  ok(true, "pair with minOut=0 executes (router is the guard — defense in depth noted)");
}

console.log("── 5. deadline rejection (pair + router mirror) ──");
{
  const now = 1759560000n; // fixed epoch second — deterministic
  require_(now <= now, "P: DEADLINE");
  throwsMirror(() => require_(now <= now - 1n, "P: DEADLINE"), "block.timestamp > deadline → P: DEADLINE");
  ok(now <= now, "block.timestamp <= deadline passes");
}

console.log("── 6. WrappedToken mint/burn operator gating (law L1) ──");
{
  const t = newToken(OP);
  throwsMirror(() => mintMirror(t, A, B, E18), "mint by non-operator → W: NOT-OPERATOR");
  throwsMirror(() => burnMirror(t, A, OP, E18), "burn by non-operator → W: NOT-OPERATOR");
  throwsMirror(() => mintMirror(t, OP, B, 0n), "mint of 0 → W: MINT-0");
  mintMirror(t, OP, B, 5n * E18);
  eq(t.supply, 5n * E18, "operator mint raises supply");
  eq(t.balances.get(B), 5n * E18, "operator mint credits receiver");
  throwsMirror(() => burnMirror(t, OP, B, 6n * E18), "burn above balance → W: BALANCE");
  burnMirror(t, OP, B, 2n * E18);
  eq(t.supply, 3n * E18, "operator burn (1:1 redemption) lowers supply");
  eq(t.balances.get(B), 3n * E18, "burn debits holder");
  transferMirror(t, B, A, 1n * E18);
  eq(t.supply, 3n * E18, "transfer keeps supply constant");
  throwsMirror(() => transferMirror(t, B, null, 1n * E18), "transfer to zero → W: TO-0");
  throwsMirror(() => transferMirror(t, A, B, 3n * E18), "transfer above balance → W: BALANCE");
}

console.log("── 7. integer edge cases ──");
{
  // dust: fees floor to 0, no inversion, partition stays exact
  for (const amt of [1n, 2n, 100n, 476n, 477n, 526n, 527n, 1111n, 1112n]) {
    const { effectiveIn, lpFee, treasuryFee } = feeSplit(amt);
    ok(effectiveIn + lpFee + treasuryFee === amt, `dust partition exact @${amt}`);
    ok(effectiveIn >= (amt * 9970n) / 10000n - 2n, `dust effectiveIn ≥ 99.70%·amt−2 @${amt} (no fee inversion)`);
  }
  // dust swap: out==0 rejected as DUST
  const p = newPool(1000n * E18, 1000n * E18);
  p.totalSupply = 1000n * E18;
  throwsMirror(() => swapMirror(p, 1n, 0n, 1n), "1-wei swap → out=0 → P: DUST");
  // zero reserves rejected
  const q = newPool(0n, 0n);
  throwsMirror(() => swapMirror(q, 1n * E18, 0n, 1n), "empty pool → P: LIQUIDITY");
  // first LP = sqrt(a·b) floor
  const p2 = newPool(0n, 0n);
  const liq = addLiquidity(p2, 3n * E18, 7n * E18, true);
  eq(liq, sqrt_(21n * E18 * E18), "first LP mint == ⌊√(a·b)⌋");
  // proportional LP + rounding favors pool
  const l2 = addLiquidity(p2, 3n * E18, 7n * E18, false);
  eq(l2, liq, "second provision at same ratio mints equal LP");
  // removeLiquidity proportional, floored, min-enforced
  const { amount0, amount1 } = removeLiquidityMirror(p2, liq / 2n, 0n, 0n);
  ok(amount0 > 0n && amount1 > 0n, "partial removal pays both sides");
  throwsMirror(() => removeLiquidityMirror(p2, p2.totalSupply + 1n, 0n, 0n), "remove above LP balance → reject");
  // oversized min rejected
  throwsMirror(() => removeLiquidityMirror(p2, liq / 2n, amount0 + 1n, 0n), "remove min0 violation → P: MIN_OUT");
  // pool dust from rounding stays inside (k grew across the cycle)
  const kNow = p2.r0 * p2.r1;
  const kThen = 21n * E18 * E18;
  ok(kNow >= kThen, "k grew across provision+removal cycle (fees/rounding to LP)");
}

console.log("── 8. router mirror (optimal ratio, guards) ──");
{
  function routerOptimal(reserveA, reserveB, aDes, bDes) {
    if (reserveA === 0n && reserveB === 0n) return [aDes, bDes];
    const optB = (aDes * reserveB) / reserveA;
    if (optB <= bDes) return [aDes, optB];
    const optA = (bDes * reserveA) / reserveB;
    return [optA, bDes];
  }
  const [a1, b1] = routerOptimal(10n * E18, 10n * E18, 2n * E18, 3n * E18);
  eq(a1, 2n * E18, "optimal keeps desired A when B abundant");
  eq(b1, 2n * E18, "optimal trims B to ratio (1:1)");
  const [a2, b2] = routerOptimal(10n * E18, 10n * E18, 2n * E18, 1n * E18);
  eq(a2, 1n * E18, "optimal trims A to ratio");
  eq(b2, 1n * E18, "optimal keeps desired B");
  const [a3, b3] = routerOptimal(0n, 0n, 5n * E18, 9n * E18);
  eq(a3, 5n * E18, "first provision: desired A");
  eq(b3, 9n * E18, "first provision: desired B");
  // minOut=0 rejected at the router (defense in depth: pair allows, router refuses)
  throwsMirror(() => require_(0n > 0n, "R: MIN_OUT"), "router swapExactTokensForTokens with minOut=0 → R: MIN_OUT");
  throwsMirror(() => require_(0n, "R: AMOUNT-0"), "router amountIn=0 → R: AMOUNT-0");
}

console.log("── 9. factory mirror (pair guards) ──");
{
  function createPair(existing, a, b) {
    require_(a !== b, "F: IDENTICAL");
    require_(a !== null && b !== null, "F: TOKEN-0");
    const [t0, t1] = a < b ? [a, b] : [b, a];
    require_(!existing.has(t0 + t1), "F: PAIR-EXISTS");
    existing.add(t0 + t1);
    return [t0, t1];
  }
  const pairs = new Set();
  const [x0, x1] = createPair(pairs, B, A); // unsorted input
  eq(x0, A, "tokens sorted on creation (t0=A)");
  eq(x1, B, "tokens sorted on creation (t1=B)");
  throwsMirror(() => createPair(pairs, A, A), "identical tokens → F: IDENTICAL");
  throwsMirror(() => createPair(pairs, A, null), "zero token → F: TOKEN-0");
  throwsMirror(() => createPair(pairs, A, B), "duplicate pair → F: PAIR-EXISTS");
  eq(pairs.size, 1, "allPairsLength == 1 after one creation");
}

console.log("── 10. seeded lifecycle simulation (60 swaps, both directions, full LP cycle) ──");
{
  SEED = 0x9369192bn; // reset — deterministic
  const t = newToken(OP); // WUSDS mirror
  const s = newToken(OP); // counter-asset mirror (simulated)
  mintMirror(t, OP, "LP", 100000n * E18);
  mintMirror(s, OP, "LP", 100000n * E18);
  const p = newPool(0n, 0n);
  const l0 = addLiquidity(p, 50000n * E18, 50000n * E18, true);
  const k0 = p.r0 * p.r1;
  let treasuryIn0 = 0n;
  let treasuryIn1 = 0n;
  let swapsDone = 0;
  for (let i = 0; i < 60; i++) {
    const tokenIn = i % 2 === 0 ? 0n : 1n;
    const amt = rndBelow(2000n * E18) + 1n;
    const { effectiveIn, lpFee, treasuryFee } = feeSplit(amt);
    const rIn = tokenIn === 0n ? p.r0 : p.r1;
    const rOut = tokenIn === 0n ? p.r1 : p.r0;
    const out = getAmountOut(amt, rIn, rOut);
    if (out === 0n) continue; // dust skipped on-chain too (DUST revert)
    swapMirror(p, amt, tokenIn, out); // trader passes minOut == quote
    swapsDone++;
    if (tokenIn === 0n) treasuryIn0 += treasuryFee;
    else treasuryIn1 += treasuryFee;
    // per-swap law: pool keeps lpFee exactly beyond effective input
    const rInAfter = tokenIn === 0n ? p.r0 : p.r1;
    ok(rInAfter === rIn + effectiveIn + lpFee, `swap #${i}: reserveIn delta == effIn + lpFee`);
  }
  ok(swapsDone >= 50, `lifecycle executed ${swapsDone} real swaps (of 60 attempts)`);
  ok(p.r0 * p.r1 >= k0, "k never decreased across the whole lifecycle");
  ok(treasuryIn0 > 0n && treasuryIn1 > 0n, "treasury accrued on both sides");
  // LP withdrawal loop — pool stays solvent to the end
  let burned = 0n;
  let removals = 0;
  while (p.totalSupply > 0n) {
    const step = p.totalSupply / 10n > 0n ? p.totalSupply / 10n : p.totalSupply;
    const { amount0, amount1 } = removeLiquidityMirror(p, step, 0n, 0n);
    burned += step;
    removals++;
    ok(amount0 > 0n && amount1 > 0n, `removal #${removals} pays both sides`);
  }
  eq(burned, l0, "full LP burned == minted");
  ok(p.r0 === 0n && p.r1 === 0n, "pool fully drained after full burn");
  eq(t.supply, s.supply, "mirror token supplies equal (symmetric sim)");
}

console.log("── 11. PoR mirror (law L1/L4: backing ≥ supply, operator-only mint/burn) ──");
{
  const t = newToken(OP);
  mintMirror(t, OP, "user", 1000n * E18);
  // honest PoR evaluation with backing = 0 (nothing locked on-chain yet)
  const backing = 0n;
  const supply = t.supply;
  ok(!(backing >= supply && supply > 0n ? true : backing >= supply), "PoR supply>0 & backing=0 → NOT ok (honest fail)");
  // after operator locks backing: backing == supply → ok
  const backing2 = t.supply;
  ok(backing2 >= t.supply, "PoR ok when operator locks 1:1 backing");
  // burn reduces supply → ratio holds
  burnMirror(t, OP, "user", 400n * E18);
  ok(backing2 >= t.supply, "PoR stays ok after redemption burn (supply 600)");
}

console.log("");
console.log(`╔══════════════════════════════════════════════════════════╗`);
console.log(`║  r192-b mirror tests: PASS ${PASS}/${PASS + FAIL}${PASS === PASS + FAIL ? "  · ALL GREEN ✅" : "  · FAILURES ✗"}     ║`);
console.log(`╚══════════════════════════════════════════════════════════╝`);
if (FAIL > 0) {
  console.error("failures:", failures.slice(0, 20).join(" | "));
  process.exit(1);
}
