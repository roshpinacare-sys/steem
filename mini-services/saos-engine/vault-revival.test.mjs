/**
 * vault-revival.test.mjs — T-588-R2 · LAWS OF THE ACCOUNT-CONTEXT HARVEST.
 * The harvest is the seam between the sealed vault and chain-judged custody:
 * these tests pin its shape-tolerance and its NO-BLEED laws. The chain
 * remains the only judge of any WIF — these laws judge the HARVEST ONLY.
 */
import { test, expect } from "bun:test";
import { harvestVaultAccounts } from "./vault-revival.mjs";

const NAMES = ["cashmachine", "haran", "israelnews", "headcorner"];
const WIF_A = "5JU6tpuGxwok3kn1yRM5EEwgVYzxqLfqLNicUxYiJMjJR2HsaiW"; /* synthetic-shaped, 51 chars */
const WIF_B = "5KiHYkAijZbkvwpSByAUCTbQoxcmMMN9KqUbWiRJPhSN9VkaWSB";
const WIF_C = "5Jys2qUn8QVBEw9Uo2s8AXTcBwiuPZMgjonmBYWD3kX3Vs6dueY";
const PUB = "STM7pLmx1oJAaAydVQjPGGPNYpFQGvxcaumannKqfMTNEH8wUonnn";

test("rot2 nested shape: accounts.<chain>.<account>.<role> harvests steem-only", () => {
  const vault = {
    format: "SAOS-ROT2-1", at: "2026-10-18T00:00:00Z",
    accounts: {
      steem: { cashmachine: { active: { wif: WIF_A, pub: PUB }, posting: { wif: WIF_B, pub: PUB }, memo: { wif: WIF_C, pub: PUB } } },
      hive: { cashmachine: { active: { wif: WIF_B, pub: PUB }, posting: { wif: WIF_C, pub: PUB } } },
    },
  };
  const out = harvestVaultAccounts(vault, NAMES);
  expect(Object.keys(out)).toEqual(["cashmachine"]);
  expect(out.cashmachine.wif).toBe(WIF_B); /* steem posting, NOT the hive posting */
  expect(out.cashmachine.activeWif).toBe(WIF_A);
  expect(out.cashmachine.memoWif).toBe(WIF_C);
  expect(out.cashmachine.pub).toBe(PUB);
});

test("hive subtree never bleeds onto a steem role the steem chain lacks", () => {
  const vault = {
    accounts: {
      steem: { haran: { posting: { wif: WIF_A, pub: PUB } } }, /* steem has NO active for haran */
      hive: { haran: { active: { wif: WIF_B, pub: PUB } } },
    },
  };
  const out = harvestVaultAccounts(vault, NAMES);
  expect(out.haran.wif).toBe(WIF_A);
  expect(out.haran.activeWif).toBeUndefined(); /* the pause stands — no cross-chain fill */
});

test("GEN flat shape: accounts[] with username + keys.steem.<role>", () => {
  const vault = { accounts: [
    { username: "headcorner", keys: { steem: { posting: { wif: WIF_A, pub: PUB }, active: { wif: WIF_B, pub: PUB }, memo: { wif: WIF_C, pub: PUB } } } },
    { username: "cashmachine", keys: { posting: { wif: WIF_B, pub: PUB } } },
  ] };
  const out = harvestVaultAccounts(vault, NAMES);
  expect(out.headcorner.wif).toBe(WIF_A);
  expect(out.headcorner.activeWif).toBe(WIF_B);
  expect(out.headcorner.memoWif).toBe(WIF_C);
  expect(out.cashmachine.wif).toBe(WIF_B); /* legacy keys.<role> fallback shape */
  expect(out.cashmachine.activeWif).toBeUndefined();
});

test("roster-scoped: unknown account names are ignored even when key-bearing", () => {
  const vault = { accounts: { steem: { outsider: { posting: { wif: WIF_A, pub: PUB } }, cashmachine: { posting: { wif: WIF_B, pub: PUB } } } } };
  const out = harvestVaultAccounts(vault, NAMES);
  expect(Object.keys(out)).toEqual(["cashmachine"]);
});

test("short/toy wifs are rejected (fail-closed, the chain never sees them)", () => {
  const vault = { accounts: { steem: { cashmachine: { posting: { wif: "5Jshort", pub: PUB }, active: { wif: WIF_A, pub: PUB } } } } };
  const out = harvestVaultAccounts(vault, NAMES);
  expect(out.cashmachine.wif).toBeUndefined();
  expect(out.cashmachine.activeWif).toBe(WIF_A);
});

test("empty/unshaped vault yields {} (upstream pull fails loud, never invents)", () => {
  expect(harvestVaultAccounts({}, NAMES)).toEqual({});
  expect(harvestVaultAccounts(null, NAMES)).toEqual({});
  expect(harvestVaultAccounts({ accounts: {} }, NAMES)).toEqual({});
});

test("depth bomb does not crash and yields no false account", () => {
  let deep = { posting: { wif: WIF_A, pub: PUB } };
  for (let i = 0; i < 40; i++) deep = { nested: deep };
  const vault = { accounts: { steem: { cashmachine: deep } } };
  const out = harvestVaultAccounts(vault, NAMES);
  expect(out.cashmachine?.wif === WIF_A || out.cashmachine?.wif === undefined).toBe(true);
});

test("harvest is deterministic (double run, byte-same verdict)", () => {
  const vault = { accounts: { steem: { cashmachine: { posting: { wif: WIF_A, pub: PUB } } } } };
  expect(JSON.stringify(harvestVaultAccounts(vault, NAMES))).toBe(JSON.stringify(harvestVaultAccounts(vault, NAMES)));
});
