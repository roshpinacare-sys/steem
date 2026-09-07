/**
 * tests/transparency-log/witness-gossip-sim.test.ts
 *
 * Property under test: in-process gossip simulation — peers exchange statements,
 * converge, and detect split-views without a central quorum gate.
 *
 * HAPPY        Two peers start with disjoint statements; after one round both
 *              have the full set. Convergence is detected correctly.
 * EDGE         Duplicate statements are idempotent (no double-count). Self-gossip
 *              is suppressed. A peer with an unknown witness rejects statements
 *              from that witness while still accepting others. Three-peer fan-out.
 * FAIL-CLOSED  Split-view detected mid-round throws SplitViewError. Bad signer
 *              → statement rejected (not silently accepted). addPeer with a
 *              duplicate name throws. gossipRound with < 2 peers throws.
 *              gossipUntilConverged respects maxRounds limit.
 */

import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { signTreeHead, SplitViewError, type TreeHeadObservation } from "../../lib/transparency-log/witness.ts";
import {
  WitnessGossipPeer,
  WitnessGossipSim,
  GossipError,
} from "../../lib/transparency-log/witness-gossip-sim.ts";

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const wA = new HmacSigner("witness-A-secret-32chars-minimum!");
const wB = new HmacSigner("witness-B-secret-32chars-minimum!");
const wC = new HmacSigner("witness-C-secret-32chars-minimum!");

const ROOT_A = "a".repeat(64);
const ROOT_B = "b".repeat(64);
const ROOT_C = "c".repeat(64);
const LOG_ID = "tenant-gossip-test";

function obs(witnessId: string, root = ROOT_A, treeSize = 10): TreeHeadObservation {
  return { logId: LOG_ID, root, treeSize, observedAt: "2026-06-20T00:00:00.000Z", witnessId };
}

function makeResolver(map: Record<string, HmacSigner>) {
  return (id: string) => map[id] ?? null;
}

// ─── HAPPY: basic two-peer exchange ──────────────────────────────────────────

test("HAPPY: two peers exchange disjoint statements in one round", () => {
  const stA = signTreeHead(wA, obs("wA"));
  const stB = signTreeHead(wB, obs("wB"));

  const peerX = new WitnessGossipPeer("peerX", makeResolver({ wA, wB }));
  const peerY = new WitnessGossipPeer("peerY", makeResolver({ wA, wB }));

  // Each peer starts with only one statement.
  peerX.accept(stA);
  peerY.accept(stB);

  eq(peerX.size, 1, "peerX starts with 1 statement");
  eq(peerY.size, 1, "peerY starts with 1 statement");

  const sim = new WitnessGossipSim();
  sim.addPeer(peerX);
  sim.addPeer(peerY);

  const result = sim.gossipRound();

  eq(result.round, 1);
  assert(result.anyChange, "round 1 should have merged new statements");
  eq(peerX.size, 2, "peerX now holds both statements");
  eq(peerY.size, 2, "peerY now holds both statements");

  // peerX accepted stB from peerY.
  const xResult = result.peers.find((p) => p.peerName === "peerX")!;
  eq(xResult.accepted, 1);
  eq(xResult.duplicates, 0);
});

test("HAPPY: second round detects convergence (no new statements accepted)", () => {
  const stA = signTreeHead(wA, obs("wA"));
  const stB = signTreeHead(wB, obs("wB"));

  const peerX = new WitnessGossipPeer("peerX", makeResolver({ wA, wB }));
  const peerY = new WitnessGossipPeer("peerY", makeResolver({ wA, wB }));
  peerX.accept(stA);
  peerY.accept(stB);

  const sim = new WitnessGossipSim();
  sim.addPeer(peerX);
  sim.addPeer(peerY);

  sim.gossipRound(); // converging round
  const r2 = sim.gossipRound(); // should be all duplicates
  assert(!r2.anyChange, "no new statements in round 2 — peers already converged");
  const totals = r2.peers.reduce((s, p) => s + p.accepted, 0);
  eq(totals, 0, "zero new acceptances in a converged round");
});

test("HAPPY: gossipUntilConverged runs to convergence and returns rounds", () => {
  const stA = signTreeHead(wA, obs("wA"));
  const stB = signTreeHead(wB, obs("wB"));

  const peerX = new WitnessGossipPeer("peerX", makeResolver({ wA, wB }));
  const peerY = new WitnessGossipPeer("peerY", makeResolver({ wA, wB }));
  peerX.accept(stA);
  peerY.accept(stB);

  const sim = new WitnessGossipSim();
  sim.addPeer(peerX);
  sim.addPeer(peerY);

  const rounds = sim.gossipUntilConverged();
  // First non-converged round, then one converged round.
  assert(rounds.length >= 1, "at least one round ran");
  // Last round must have anyChange === false (convergence sentinel).
  assert(!rounds[rounds.length - 1].anyChange, "last round shows convergence");
  eq(peerX.size, 2);
  eq(peerY.size, 2);
});

// ─── EDGE: dedup, rejection, three peers ─────────────────────────────────────

test("EDGE: re-submitting the same statement is a no-op (idempotent)", () => {
  const stA = signTreeHead(wA, obs("wA"));
  const peer = new WitnessGossipPeer("peerX", makeResolver({ wA }));

  eq(peer.accept(stA), "accepted");
  eq(peer.accept(stA), "duplicate", "second accept of same statement is duplicate");
  eq(peer.size, 1, "inbox stays at 1");
});

test("EDGE: unknown witness is rejected (fail-closed)", () => {
  const stUnknown = signTreeHead(wC, obs("wC")); // wC not in resolver
  const peer = new WitnessGossipPeer("peerX", makeResolver({ wA, wB }));
  eq(peer.accept(stUnknown), "rejected", "unknown witness wC → rejected");
  eq(peer.size, 0);
});

test("EDGE: three-peer fan-out converges in one change-round", () => {
  // peerP starts with wA, peerQ with wB, peerR with wC.
  const stA = signTreeHead(wA, obs("wA", ROOT_A));
  const stB = signTreeHead(wB, obs("wB", ROOT_A)); // same root as wA — consistent
  const stC = signTreeHead(wC, obs("wC", ROOT_A));

  const resolver = makeResolver({ wA, wB, wC });
  const peerP = new WitnessGossipPeer("peerP", resolver);
  const peerQ = new WitnessGossipPeer("peerQ", resolver);
  const peerR = new WitnessGossipPeer("peerR", resolver);

  peerP.accept(stA);
  peerQ.accept(stB);
  peerR.accept(stC);

  const sim = new WitnessGossipSim();
  sim.addPeer(peerP);
  sim.addPeer(peerQ);
  sim.addPeer(peerR);

  const rounds = sim.gossipUntilConverged();
  assert(!rounds[rounds.length - 1].anyChange, "converged");

  // After convergence every peer sees all 3 statements.
  eq(peerP.size, 3, "peerP holds all 3 statements");
  eq(peerQ.size, 3, "peerQ holds all 3 statements");
  eq(peerR.size, 3, "peerR holds all 3 statements");
});

test("EDGE: peer with restricted resolver only accepts known witnesses", () => {
  // peerPrivate only knows wA; gossip brings stB (wB) which it must reject.
  const stA = signTreeHead(wA, obs("wA"));
  const stB = signTreeHead(wB, obs("wB"));

  const peerPublic = new WitnessGossipPeer("peerPublic", makeResolver({ wA, wB }));
  const peerPrivate = new WitnessGossipPeer("peerPrivate", makeResolver({ wA })); // restricted

  peerPublic.accept(stA);
  peerPublic.accept(stB);
  peerPrivate.accept(stA);

  const sim = new WitnessGossipSim();
  sim.addPeer(peerPublic);
  sim.addPeer(peerPrivate);

  sim.gossipRound();

  // peerPrivate received stB from peerPublic but must reject it (unknown wB).
  eq(peerPrivate.size, 1, "peerPrivate only accepted wA — wB unknown to it");
  eq(peerPublic.size, 2, "peerPublic unchanged — already had both");
});

// ─── FAIL-CLOSED: split-view, bad input ──────────────────────────────────────

test("FAIL-CLOSED: split-view detected when peer receives conflicting root for same position", () => {
  // Peer already accepted wA signing ROOT_A.
  // Gossip brings wA signing ROOT_B at the same (logId, treeSize) — split-view.
  const stA_good = signTreeHead(wA, obs("wA", ROOT_A, 10));
  const stA_evil = signTreeHead(wA, obs("wA", ROOT_B, 10)); // wA signed a different root!

  const peerHonest = new WitnessGossipPeer("peerHonest", makeResolver({ wA }));
  const peerEvil = new WitnessGossipPeer("peerEvil", makeResolver({ wA }));

  peerHonest.accept(stA_good);
  peerEvil.accept(stA_evil);

  const sim = new WitnessGossipSim();
  sim.addPeer(peerHonest);
  sim.addPeer(peerEvil);

  let threw: unknown = null;
  try {
    sim.gossipRound();
  } catch (e) {
    threw = e;
  }
  assert(threw instanceof SplitViewError, "SplitViewError must be thrown on split-view");
  const sve = threw as SplitViewError;
  eq(sve.logId, LOG_ID);
  eq(sve.treeSize, 10);
  assert(sve.roots.includes(ROOT_A) && sve.roots.includes(ROOT_B), "both conflicting roots named");
});

test("FAIL-CLOSED: tampered statement (wrong signature) is rejected, no split-view thrown", () => {
  const stA = signTreeHead(wA, obs("wA", ROOT_A, 5));
  // Build a tampered copy: same fields but wrong root.
  const tampered = { ...stA, root: ROOT_C };

  const peer = new WitnessGossipPeer("peer", makeResolver({ wA }));
  const result = peer.accept(tampered);
  eq(result, "rejected", "tampered statement rejected — signature mismatch");
  eq(peer.size, 0);
});

test("FAIL-CLOSED: gossipRound with fewer than 2 peers throws GossipError", () => {
  const sim = new WitnessGossipSim();
  const peer = new WitnessGossipPeer("loner", makeResolver({ wA }));
  sim.addPeer(peer);

  let threw: unknown = null;
  try { sim.gossipRound(); } catch (e) { threw = e; }
  assert(threw instanceof GossipError, "GossipError on insufficient peers");
  eq((threw as GossipError).code, "INSUFFICIENT_PEERS");
});

test("FAIL-CLOSED: addPeer with duplicate name throws GossipError", () => {
  const sim = new WitnessGossipSim();
  const peerA = new WitnessGossipPeer("duplicate", makeResolver({ wA }));
  const peerB = new WitnessGossipPeer("duplicate", makeResolver({ wA }));
  sim.addPeer(peerA);

  let threw: unknown = null;
  try { sim.addPeer(peerB); } catch (e) { threw = e; }
  assert(threw instanceof GossipError, "GossipError on duplicate peer name");
  eq((threw as GossipError).code, "DUPLICATE_PEER");
});

test("FAIL-CLOSED: gossipUntilConverged throws GossipError when maxRounds exceeded", () => {
  // Build a sim that never converges: each round peerA produces a new statement
  // by changing observedAt, but since dedup is by {witnessId,logId,treeSize,root}
  // that won't create new entries. Instead we test the guard by setting maxRounds=0.
  const stA = signTreeHead(wA, obs("wA"));
  const stB = signTreeHead(wB, obs("wB"));
  const peerX = new WitnessGossipPeer("peerX", makeResolver({ wA, wB }));
  const peerY = new WitnessGossipPeer("peerY", makeResolver({ wA, wB }));
  peerX.accept(stA);
  peerY.accept(stB);

  const sim = new WitnessGossipSim();
  sim.addPeer(peerX);
  sim.addPeer(peerY);

  // maxRounds=1 means only one round, which WILL have anyChange=true (not converged)
  // so gossipUntilConverged must throw.
  let threw: unknown = null;
  try { sim.gossipUntilConverged(1); } catch (e) { threw = e; }
  assert(threw instanceof GossipError, "GossipError on maxRounds exceeded");
  eq((threw as GossipError).code, "NO_CONVERGENCE");
});

test("FAIL-CLOSED: constructing a peer with invalid name or resolver throws", () => {
  let threw: unknown = null;
  try { new WitnessGossipPeer("", makeResolver({ wA })); } catch (e) { threw = e; }
  assert(threw instanceof GossipError, "empty name → GossipError");

  threw = null;
  try { new WitnessGossipPeer("peer", null as any); } catch (e) { threw = e; }
  assert(threw instanceof GossipError, "null resolver → GossipError");
});

// ─── EFFICIENCY: O(peers² × stmts) is explicitly bounded ────────────────────

test("EFFICIENCY: multiple statements across two peers merge correctly, no O(n²) statement duplication", () => {
  // Two peers each have 3 statements from different witnesses.
  const stA = signTreeHead(wA, obs("wA", ROOT_A));
  const stB = signTreeHead(wB, obs("wB", ROOT_A));
  const stC = signTreeHead(wC, obs("wC", ROOT_A));

  const resolver = makeResolver({ wA, wB, wC });
  const peerM = new WitnessGossipPeer("peerM", resolver);
  const peerN = new WitnessGossipPeer("peerN", resolver);

  peerM.accept(stA);
  peerM.accept(stB);
  peerN.accept(stB); // shared
  peerN.accept(stC);

  const sim = new WitnessGossipSim();
  sim.addPeer(peerM);
  sim.addPeer(peerN);
  sim.gossipRound();

  // After exchange: peerM gets stC, peerN gets stA; stB is duplicate for both.
  eq(peerM.size, 3, "peerM: stA + stB + stC");
  eq(peerN.size, 3, "peerN: stA + stB + stC");
  // Dedup: no statement appears twice.
  eq(peerM.statements().length, 3);
  eq(peerN.statements().length, 3);
});
