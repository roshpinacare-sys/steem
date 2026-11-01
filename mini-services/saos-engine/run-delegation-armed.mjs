/**
 * run-delegation-armed.mjs — ARMED R314 RUNNER (REVISIT-R314c, 2026-11-01).
 *
 * ONE PROCESS, IN ORDER (the rail's credential gate reads in-memory adoption):
 *   1. runAdopt()   — crown-vault custody adoption (chain-judged, fail-closed,
 *                     writes the honest army-custody verdict; R314b)
 *   2. CI_DELEGATION_ARMED=1 → runDelegationRail() — the R314 law does the
 *      rest: daily gate, custody gate (fresh verdict from step 1), credential
 *      gate (wif adopted in step 1), measured plan, capped, signed, ledgered.
 *
 * SCHEDULE: fired after the 00:00Z day rollover (the 2026-11-01 slot was
 * consumed by honest refusals; the daily gate is law, not bypassed).
 * Verdict-only output; key material never printed.
 */

process.env.CI_DELEGATION_ARMED = "1"; // operator standing order 2026-10-11: "יש לך אישור להכל"

const { runAdopt } = await import("./crown-vault-adopt.mjs");
const { runDelegationRail } = await import("./delegation-rail.mjs");

const adopt = await runAdopt({});
console.log(`step1-adopt: ${adopt.verdict} verified=${adopt.verified}/${adopt.total}${adopt.wounds.length ? ` wounds=[${adopt.wounds.join(",")}]` : ""}`);
if (!adopt.ok) { console.log("DELEGATION-RUN REFUSED: custody not whole — fail-closed"); process.exit(2); }

const out = await runDelegationRail({});
console.log(`step2-rail: ${out.verdict} ops=${out.ops ?? 0} totalSp=${out.totalSp ?? 0}${out.skipped?.length ? ` skipped=[${out.skipped.join(",")}]` : ""}${out.txid ? ` txid=${out.txid}` : ""}${out.reason ? ` reason=${out.reason}` : ""}`);
process.exit(["DELEGATED", "NO-OPS", "ALREADY-TODAY"].includes(out.verdict) ? 0 : 3);
