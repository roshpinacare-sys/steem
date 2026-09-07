/**
 * tests/transparency-log/witness-registry.test.ts — WitnessRegistry (v388).
 *
 * The property under test: the registry only stores statements it has
 * independently verified against a registered witness key; quorum is
 * computed from exactly what's stored, tenant-isolated.
 *
 * HAPPY        register + signAndSubmit + list round-trips; submit() of an
 *              independently-built statement is accepted when the witness is
 *              registered and the signature verifies; quorumFor reaches with
 *              2 distinct registered witnesses.
 * EDGE         re-registering a witness replaces its key (rotation) rather
 *              than duplicating; list() is tenant-isolated; statements
 *              filtered correctly are still counted toward quorum even when
 *              other tenants' statements exist; hasWitnesses reflects state.
 * FAIL-CLOSED  submit() rejects (does not store) a statement from an
 *              unregistered witnessId; submit() rejects a statement whose
 *              signature does not verify against the registered key (forged);
 *              resolveSigner returns null for unknown witness/tenant;
 *              quorumFor throws SplitViewError on conflicting verified roots,
 *              and the conflicting statement is NOT silently dropped from
 *              future visibility (list() still shows it — registry doesn't
 *              hide evidence).
 */

import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { createHash } from "node:crypto";
import { WitnessRegistry, WitnessRegistryError } from "../../lib/transparency-log/witness-registry.ts";
import { SplitViewError, signTreeHead, type TreeHeadObservation } from "../../lib/transparency-log/witness.ts";

const root = (s: string): string => createHash("sha256").update(s).digest("hex");
const R8 = root("registry-tree-at-8");
const R8_FORK = root("registry-tree-at-8-fork");

const wA = new HmacSigner("witness-A-secret-32chars-minimum!");
const wB = new HmacSigner("witness-B-secret-32chars-minimum!");
const wEvil = new HmacSigner("evil-impersonator-secret-32-chars!");

function obs(witnessId: string, r = R8, treeSize = 8): TreeHeadObservation {
  return { logId: "tenant-a", root: r, treeSize, observedAt: "2026-06-20T00:00:00.000Z", witnessId };
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

test("HAPPY: register + signAndSubmit + list round-trips", () => {
  const reg = new WitnessRegistry();
  reg.registerWitness("t1", "wA", wA);
  const st = reg.signAndSubmit("t1", wA, obs("wA"));
  const stored = reg.list("t1");
  eq(stored.length, 1);
  eq(stored[0].witnessId, "wA");
  eq(stored[0].signature, st.signature);
});

test("HAPPY: submit() accepts an independently-built statement from a registered witness", () => {
  const reg = new WitnessRegistry();
  reg.registerWitness("t1", "wA", wA);
  const standalone = signTreeHead(wA, obs("wA")); // built without touching the registry
  const accepted = reg.submit("t1", standalone);
  assert(accepted !== null, "well-formed, verifiable statement should be accepted");
  eq(reg.list("t1").length, 1);
});

test("HAPPY: quorumFor reaches with 2 distinct registered witnesses", () => {
  const reg = new WitnessRegistry();
  reg.registerWitness("t1", "wA", wA);
  reg.registerWitness("t1", "wB", wB);
  reg.signAndSubmit("t1", wA, obs("wA"));
  reg.signAndSubmit("t1", wB, obs("wB"));
  const result = reg.quorumFor("t1", { logId: "tenant-a", root: R8, treeSize: 8 }, 2);
  assert(result.reached, "threshold 2 should be reached with wA + wB");
  eq(result.distinctWitnesses, 2);
});

// ─── EDGE ────────────────────────────────────────────────────────────────────

test("EDGE: re-registering a witness replaces its key rather than duplicating", () => {
  const reg = new WitnessRegistry();
  reg.registerWitness("t1", "wA", wA);
  const rotated = new HmacSigner("witness-A-ROTATED-secret-32-chars!");
  reg.registerWitness("t1", "wA", rotated);
  // Old key no longer verifies a fresh statement signed with the new key.
  const stOld = signTreeHead(wA, obs("wA"));
  const stNew = signTreeHead(rotated, obs("wA"));
  assert(reg.submit("t1", stOld) === null, "statement signed with the retired key should be rejected");
  assert(reg.submit("t1", stNew) !== null, "statement signed with the rotated key should be accepted");
});

test("EDGE: list() is tenant-isolated", () => {
  const reg = new WitnessRegistry();
  reg.registerWitness("t1", "wA", wA);
  reg.registerWitness("t2", "wA", wA);
  reg.signAndSubmit("t1", wA, obs("wA"));
  eq(reg.list("t1").length, 1);
  eq(reg.list("t2").length, 0);
});

test("EDGE: quorum only counts the target tenant's statements even when other tenants share a witnessId", () => {
  const reg = new WitnessRegistry();
  reg.registerWitness("t1", "wA", wA);
  reg.registerWitness("t2", "wA", wA);
  reg.signAndSubmit("t1", wA, obs("wA"));
  reg.signAndSubmit("t2", wA, obs("wA"));
  const result = reg.quorumFor("t1", { logId: "tenant-a", root: R8, treeSize: 8 }, 1);
  eq(result.distinctWitnesses, 1, "only t1's own statement should count toward t1's quorum");
});

test("EDGE: hasWitnesses reflects registration state", () => {
  const reg = new WitnessRegistry();
  assert(reg.hasWitnesses("t1") === false, "no witnesses registered yet");
  reg.registerWitness("t1", "wA", wA);
  assert(reg.hasWitnesses("t1") === true, "witness now registered");
  assert(reg.hasWitnesses("t2") === false, "other tenant unaffected");
});

// ─── FAIL-CLOSED ─────────────────────────────────────────────────────────────

test("FAIL-CLOSED: submit() rejects a statement from an unregistered witnessId", () => {
  const reg = new WitnessRegistry();
  // wEvil is never registered.
  const forged = signTreeHead(wEvil, obs("wEvil"));
  const accepted = reg.submit("t1", forged);
  assert(accepted === null, "unregistered witness statement must be rejected");
  eq(reg.list("t1").length, 0, "rejected statement must not be stored");
});

test("FAIL-CLOSED: submit() rejects a statement whose signature does not verify (impersonation)", () => {
  const reg = new WitnessRegistry();
  reg.registerWitness("t1", "wA", wA);
  // wEvil signs but claims to be wA.
  const impersonated = signTreeHead(wEvil, obs("wA"));
  const accepted = reg.submit("t1", impersonated);
  assert(accepted === null, "statement signed by a different key than the registered one must be rejected");
  eq(reg.list("t1").length, 0);
});

test("FAIL-CLOSED: resolveSigner returns null for unknown witness/tenant", () => {
  const reg = new WitnessRegistry();
  reg.registerWitness("t1", "wA", wA);
  assert(reg.resolveSigner("t1", "wDoesNotExist") === null, "unknown witnessId → null");
  assert(reg.resolveSigner("tDoesNotExist", "wA") === null, "unknown tenantId → null");
});

test("FAIL-CLOSED: quorumFor throws SplitViewError on conflicting verified roots", () => {
  const reg = new WitnessRegistry();
  reg.registerWitness("t1", "wA", wA);
  reg.registerWitness("t1", "wB", wB);
  reg.signAndSubmit("t1", wA, obs("wA", R8, 8));
  reg.signAndSubmit("t1", wB, obs("wB", R8_FORK, 8)); // same position, different root
  let threw = false;
  try {
    reg.quorumFor("t1", { logId: "tenant-a", root: R8, treeSize: 8 }, 1);
  } catch (e) {
    threw = e instanceof SplitViewError;
  }
  assert(threw, "conflicting verified roots at the same position must throw SplitViewError");
});

test("FAIL-CLOSED: registerWitness rejects empty tenantId/witnessId/invalid signer", () => {
  const reg = new WitnessRegistry();
  let threw1 = false, threw2 = false, threw3 = false;
  try { reg.registerWitness("", "wA", wA); } catch (e) { threw1 = e instanceof WitnessRegistryError; }
  try { reg.registerWitness("t1", "", wA); } catch (e) { threw2 = e instanceof WitnessRegistryError; }
  try { reg.registerWitness("t1", "wA", {} as any); } catch (e) { threw3 = e instanceof WitnessRegistryError; }
  assert(threw1 && threw2 && threw3, "empty/invalid inputs to registerWitness must throw WitnessRegistryError");
});

test("FAIL-CLOSED: a split-view statement is still visible via list() — registry does not hide evidence", () => {
  const reg = new WitnessRegistry();
  reg.registerWitness("t1", "wA", wA);
  reg.registerWitness("t1", "wB", wB);
  reg.signAndSubmit("t1", wA, obs("wA", R8, 8));
  reg.signAndSubmit("t1", wB, obs("wB", R8_FORK, 8));
  try {
    reg.quorumFor("t1", { logId: "tenant-a", root: R8, treeSize: 8 }, 1);
  } catch {
    // expected — SplitViewError, asserted in the prior test
  }
  eq(reg.list("t1").length, 2, "both conflicting statements remain stored and visible for audit");
});
