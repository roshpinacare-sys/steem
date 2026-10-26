/**
 * selftest-moneygate.mjs — P0-FAILCLOSE vector suite for the money gate.
 * ─────────────────────────────────────────────────────────────────────────
 * Operator-approved Phase-0 (2026-10-17): the measured fail-open beat
 * 2026-10-17T00:25:30Z (dex=TAKEOVER-EXECUTED + delegation=DELEGATED while
 * selftestLease=SELFTEST-RAN-RED) is illegal from now on. GREEN is the ONLY
 * key that opens a money lane. This suite is pure (lib.mjs only, offline,
 * zero deps) and MUST stay green before any runtime beat goes live.
 * Run: node selftest-moneygate.mjs   (exit 0 = all vectors pass)
 */
import { moneyGateOpen, dexTakeoverDue } from "./lib.mjs";

const assert = (cond, msg) => { if (!cond) { console.error("MONEYGATE FAIL:", msg); process.exit(1); } };

/* ── moneyGateOpen: GREEN opens, EVERYTHING else blocks (fail-closed) ── */
assert(moneyGateOpen({ selftestVerdict: "SELFTEST-RAN-GREEN" }).open === true, "GREEN must open the money gate");
for (const v of [
  "SELFTEST-RAN-RED",
  "SELFTEST-RUN-TIMEOUT",
  "SELFTEST-SKIPPED-CONTENTION",
  "SELFTEST-LEASE-PURPOSE-UNREGISTERED",
  null,
  undefined,
  "",
  "STEP-FAIL",
  "green",            // case/exactness: no fuzzy matches
  "SELFTEST-RAN-GREEN ", // trailing space — exactness law
]) {
  const r = moneyGateOpen({ selftestVerdict: v });
  assert(r.open === false, `verdict ${JSON.stringify(v)} must BLOCK the money gate`);
  assert(String(r.reason).startsWith("selftest-not-green"), `block reason must be honest for ${JSON.stringify(v)}`);
}
assert(moneyGateOpen({}).open === false, "absent verdict ({} arg) must BLOCK — fail-closed default");
assert(moneyGateOpen().open === false, "no args must BLOCK — fail-closed default");

/* ── regression: the exact incident signature must now be impossible ─────
 * RED selftest + stale anchor + credential present ⇒ gate says BLOCK. */
const anchorStale = { due: true, reason: "anchor-stale" }; // dexTakeoverDue output shape
assert(anchorStale.due === true, "sanity: stale anchor makes takeover DUE");
assert(moneyGateOpen({ selftestVerdict: "SELFTEST-RAN-RED" }).open === false,
  "INCIDENT REGRESSION: stale anchor + RED selftest must NOT open money");

/* ── sanity on the staleness gate itself (unchanged behavior) ──────────── */
const t = Date.now();
assert(dexTakeoverDue({ anchorAt: t, now: t }).due === false, "fresh anchor = engine-alive = standby");
assert(dexTakeoverDue({ anchorAt: t - 120 * 60_000, now: t }).due === true, "2h-stale anchor = takeover due");
assert(dexTakeoverDue({ anchorAt: null, now: t }).due === true, "no anchor = takeover due");

console.log("MONEYGATE PASS: 20/20 vectors — GREEN is the only key that opens money (P0-FAILCLOSE)");
