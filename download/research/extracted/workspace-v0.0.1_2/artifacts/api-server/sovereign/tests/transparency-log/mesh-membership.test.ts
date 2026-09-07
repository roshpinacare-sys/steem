/**
 * tests/transparency-log/mesh-membership.test.ts — trust-mesh membership proofs.
 *
 * The property under test: a member proves it belongs to a mesh WITHOUT
 * revealing the other members, and the verifier recomputes the leaf (zero trust
 * in the prover).
 *
 * HAPPY        valid membership verifies; mesh root is order-independent;
 *              every member can prove membership.
 * EDGE         single-member mesh; two members; proof carries no other identity.
 * FAIL-CLOSED  non-member build throws; wrong root, tampered identity/root,
 *              wrong version, malformed proof → false; empty/invalid input throws.
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  computeMeshRoot,
  buildMeshMembershipProof,
  verifyMeshMembershipProof,
  meshMemberLeaf,
  MeshMembershipError,
  MESH_MEMBER_LEAF_VERSION,
  type MeshMember,
  type MeshMembershipProof,
} from "../../lib/transparency-log/mesh-membership.ts";

const MEMBERS: MeshMember[] = [
  { logId: "org.acme/audit", identity: "did:web:acme.com" },
  { logId: "org.beta/audit", identity: "did:web:beta.io" },
  { logId: "org.gamma/audit", identity: "spiffe://gamma.net/log" },
  { logId: "org.delta/audit", identity: "did:web:delta.org" },
  { logId: "org.epsilon/audit", identity: "did:web:epsilon.co" },
];

// ─── HAPPY ─────────────────────────────────────────────────────────────────────

test("HAPPY: every member can prove membership against the mesh root", () => {
  const root = computeMeshRoot(MEMBERS);
  for (const m of MEMBERS) {
    const proof = buildMeshMembershipProof(MEMBERS, m);
    assert(verifyMeshMembershipProof(proof, root), `member ${m.logId} verifies`);
    eq(proof.meshSize, MEMBERS.length, "meshSize matches");
    eq(proof.meshRoot, root, "proof carries the mesh root");
  }
});

test("HAPPY: mesh root is order-independent (a set commitment)", () => {
  const r1 = computeMeshRoot(MEMBERS);
  const r2 = computeMeshRoot([...MEMBERS].reverse());
  const r3 = computeMeshRoot([MEMBERS[2], MEMBERS[0], MEMBERS[4], MEMBERS[1], MEMBERS[3]]);
  eq(r1, r2, "reversed order → same root");
  eq(r1, r3, "shuffled order → same root");
});

// ─── EDGE ──────────────────────────────────────────────────────────────────────

test("EDGE: single-member mesh", () => {
  const one = [MEMBERS[0]];
  const root = computeMeshRoot(one);
  const proof = buildMeshMembershipProof(one, MEMBERS[0]);
  assert(verifyMeshMembershipProof(proof, root), "lone member verifies");
  eq(proof.meshSize, 1);
});

test("EDGE: two-member mesh", () => {
  const two = [MEMBERS[0], MEMBERS[1]];
  const root = computeMeshRoot(two);
  assert(verifyMeshMembershipProof(buildMeshMembershipProof(two, MEMBERS[1]), root));
});

test("EDGE (privacy): a membership proof reveals no other member's identity", () => {
  const target = MEMBERS[2];
  const proof = buildMeshMembershipProof(MEMBERS, target);
  const blob = JSON.stringify(proof);
  for (const other of MEMBERS) {
    if (other === target) continue;
    assert(!blob.includes(other.identity), `proof must not leak ${other.identity}`);
    assert(!blob.includes(other.logId), `proof must not leak ${other.logId}`);
  }
  // The proof DOES contain the target's own identity (the verifier recomputes its leaf).
  assert(blob.includes(target.identity), "proof contains the target's own identity");
});

// ─── FAIL-CLOSED ────────────────────────────────────────────────────────────────

test("FAIL-CLOSED: building a proof for a non-member throws", () => {
  let caught: unknown = null;
  try {
    buildMeshMembershipProof(MEMBERS, { logId: "org.evil/audit", identity: "did:web:evil.com" });
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof MeshMembershipError, "non-member must throw MeshMembershipError");
  eq((caught as MeshMembershipError).code, "NOT_A_MEMBER");
});

test("FAIL-CLOSED: a proof does not verify against the wrong mesh root", () => {
  const proof = buildMeshMembershipProof(MEMBERS, MEMBERS[1]);
  // A different mesh (subset) → different root.
  const otherRoot = computeMeshRoot([MEMBERS[0], MEMBERS[1]]);
  assert(!verifyMeshMembershipProof(proof, otherRoot), "wrong root rejected");
  assert(!verifyMeshMembershipProof(proof, meshMemberLeaf(MEMBERS[0])), "arbitrary hash rejected");
});

test("FAIL-CLOSED: tampering with the proven identity breaks verification", () => {
  const root = computeMeshRoot(MEMBERS);
  const proof = buildMeshMembershipProof(MEMBERS, MEMBERS[2]);
  // Attacker swaps in a different identity but keeps the inclusion path.
  const tampered: MeshMembershipProof = {
    ...proof,
    member: { logId: MEMBERS[2].logId, identity: "did:web:imposter.com" },
  };
  assert(!verifyMeshMembershipProof(tampered, root), "tampered identity must fail");
});

test("FAIL-CLOSED: wrong version, root mismatch, and malformed proof are rejected", () => {
  const root = computeMeshRoot(MEMBERS);
  const proof = buildMeshMembershipProof(MEMBERS, MEMBERS[0]);
  assert(!verifyMeshMembershipProof({ ...proof, version: "tfa-mesh-member-v0" } as any, root), "wrong version rejected");
  assert(!verifyMeshMembershipProof({ ...proof, meshRoot: meshMemberLeaf(MEMBERS[1]) }, root), "internal root mismatch rejected");
  assert(!verifyMeshMembershipProof(null as any, root), "null proof → false");
  assert(!verifyMeshMembershipProof({ ...proof, inclusion: null } as any, root), "missing inclusion → false");
  assert(!verifyMeshMembershipProof(proof, "not-a-hex-root"), "invalid expected root → false");
});

test("FAIL-CLOSED: computeMeshRoot/build reject empty and invalid members", () => {
  let a = false, b = false, c = false;
  try { computeMeshRoot([]); } catch (e) { a = e instanceof MeshMembershipError; }
  try { computeMeshRoot([{ logId: "", identity: "x" } as MeshMember]); } catch (e) { b = e instanceof MeshMembershipError; }
  try { buildMeshMembershipProof([], MEMBERS[0]); } catch (e) { c = e instanceof MeshMembershipError; }
  assert(a, "empty members throws");
  assert(b, "member with empty logId throws");
  assert(c, "empty mesh build throws");
});

test("leaf derivation is deterministic and version-tagged", () => {
  const a = meshMemberLeaf(MEMBERS[0]);
  const b = meshMemberLeaf({ identity: MEMBERS[0].identity, logId: MEMBERS[0].logId });
  eq(a, b, "leaf is order-independent over object keys");
  eq(MESH_MEMBER_LEAF_VERSION, "tfa-mesh-member-v1");
});
