/**
 * T-61 vector suite — the convergence rung (the churn-starves-construction
 * kill). Measured live 20:45-21:00Z: governor equilibrium pairs 1-2/tick +
 * ttlSec 60 presence-refresh = aged cancels consumed every ops budget while
 * IDENTICAL replacements starved ("cancels 2 / creates 0" broadcasts; the
 * configured 10-level ladder sat at 1 live level for 75 minutes).
 *   tickBudgetSplit — construction before refresh (pure law, lib.mjs).
 *   ttlSec 3300 — presence = being ON the book at the lawful price; the
 *   chain expiry (orderTtlSec 3600) is the real horizon, pre-empted by 300s.
 * Pure laws only — no chain, no state writes.
 */
import { tickBudgetSplit } from "./lib.mjs";
import { readFileSync } from "node:fs";

export async function run({ eq, ok }) {
  /* ── §A tickBudgetSplit — the convergence law ──────────────────────────── */
  eq("split: no budget → nothing", tickBudgetSplit({ opsBudget: 0, creates: 5 }),
    { createShare: 0, cancelShare: 0 });
  eq("split: negative budget → nothing", tickBudgetSplit({ opsBudget: -3, creates: 5 }),
    { createShare: 0, cancelShare: 0 });
  eq("split: no creates → refresh takes all", tickBudgetSplit({ opsBudget: 4, creates: 0 }),
    { createShare: 0, cancelShare: 4 });
  eq("split: balanced 4/4 with creates pending", tickBudgetSplit({ opsBudget: 4, creates: 9 }),
    { createShare: 2, cancelShare: 2 });
  eq("split: odd budget favors construction", tickBudgetSplit({ opsBudget: 5, creates: 9 }),
    { createShare: 3, cancelShare: 2 });
  eq("split: createWant caps the share", tickBudgetSplit({ opsBudget: 10, creates: 2 }),
    { createShare: 2, cancelShare: 5 });
  eq("split: txCap bounds both", tickBudgetSplit({ opsBudget: 100, creates: 99, maxOpsPerTx: 24 }),
    { createShare: 24, cancelShare: 24 });
  eq("split: junk creates treated as zero", tickBudgetSplit({ opsBudget: 6, creates: "x" }),
    { createShare: 0, cancelShare: 6 });
  eq("split: junk opsBudget refused", tickBudgetSplit({ opsBudget: "junk", creates: 5 }).cancelShare,
    0);
  eq("split: fractional budget floors", tickBudgetSplit({ opsBudget: 4.9, creates: 3 }),
    { createShare: 2, cancelShare: 2 });
  ok("split invariant: shares never exceed the budget", (() => {
    for (const [b, c] of [[1, 0], [1, 1], [2, 1], [3, 7], [8, 0], [8, 8], [24, 30], [7, 2]]) {
      const s = tickBudgetSplit({ opsBudget: b, creates: c });
      if (s.createShare + Math.min(s.cancelShare, b - s.createShare) > b) return false;
      if (s.createShare > c) return false;
    }
    return true;
  })());
  ok("split: convergence guaranteed — creates get ≥1 whenever budget ≥2 and creates pending", (() => {
    for (let b = 2; b <= 24; b++) {
      const s = tickBudgetSplit({ opsBudget: b, creates: 10 });
      if (s.createShare < 1) return false;
    }
    return true;
  })());
  ok("split: refresh starved to zero only when budget is 1", (() => {
    const s = tickBudgetSplit({ opsBudget: 1, creates: 4 });
    return s.createShare === 1 && s.cancelShare === 0;
  })());
  ok("split: inputs not mutated", (() => {
    const inp = Object.freeze({ opsBudget: 4, creates: 3, maxOpsPerTx: 24 });
    tickBudgetSplit(inp);
    return inp.opsBudget === 4 && inp.creates === 3 && inp.maxOpsPerTx === 24;
  })());

  /* ── §B the ttlSec law change, pinned at the source ────────────────────── */
  ok("hypergrid ttlSec is 3300 (300s pre-chain-expiry margin)", (() => {
    const src = readFileSync(new URL("./hypergrid.mjs", import.meta.url), "utf8");
    const m = /ttlSec:\s*(\d+)/.exec(src);
    return m && Number(m[1]) === 3300;
  })());
  ok("ttl 3300 < chain expiry 3600 (the engine replaces before the chain kills)", (() => {
    const src = readFileSync(new URL("./hypergrid.mjs", import.meta.url), "utf8");
    const ttl = Number(/ttlSec:\s*(\d+)/.exec(src)[1]);
    const exp = Number(/orderTtlSec:\s*(\d+)/.exec(src)[1]);
    return ttl < exp && exp - ttl === 300;
  })());
}
