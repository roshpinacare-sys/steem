import "../_flush.mjs";
/**
 * tests/release/persist-flag.test.ts — v114: the global persistence flag is fail-closed,
 * and the stack reports persistence HONESTLY (no "production-ish" illusion — deep-audit fix).
 */
import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";

test("TFA_PERSIST=pg without a pool → refuses to boot (fail-closed)", () => {
  let threw = false;
  try { buildSovereignStack(undefined, { persist: "pg" } as any); }
  catch (e: any) { threw = true; assert(String(e.message).includes("pool"), "error names the missing pool"); }
  eq(threw, true);
});

test("env TFA_PERSIST=pg without pool also refuses", () => {
  (globalThis as any).process.env.TFA_PERSIST = "pg";
  let threw = false;
  try { buildSovereignStack(); } catch { threw = true; }
  delete (globalThis as any).process.env.TFA_PERSIST;
  eq(threw, true);
});

test("dev default: builds, and persistenceReport tells the truth (all in-memory)", () => {
  const prev = process.env.NODE_ENV;
  delete process.env.NODE_ENV; // ensure not production so in-memory fallback is allowed
  try {
    const stack = buildSovereignStack();
    const rep = (stack as any).persistenceReport;
    assert(rep, "report present");
    eq(rep.audit, "in-memory");
    eq(rep.identities, "in-memory");
    eq(rep.apiKeys, "in-memory");
    // every key is one of the two honest values
    for (const v of Object.values(rep)) assert(v === "pg" || v === "in-memory", "honest values only");
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
});
