/**
 * trust-ledger-gaming.test.ts  —  Task-20  (Pass 49)
 *
 * GAMING-RESISTANCE AUDIT for trust-ledger.ts and vitals-score.ts
 *
 * ─── Background ────────────────────────────────────────────────────────────
 * trust-ledger.ts maintains a per-category "trust bond" (0-100) that gates
 * auto-merge eligibility.  A bond score ≥ FULL_AUTONOMY_THRESHOLD (75) and
 * !probation enables canAutoMerge().  vitals-score.ts rolls up several health
 * signals into a single composite score used for dashboard display and SRE
 * alerting.
 *
 * ─── The gaming question ───────────────────────────────────────────────────
 * "Can an adversarial patch sequence — many cheap, low-risk successes — inflate
 * a trust score high enough that one later large, risky patch slips through
 * auto-merge it would otherwise not have earned?"
 *
 * The deliverable is the answer either way:
 *   - If the model resists the inflation: document HOW it resists.
 *   - If there is a real gap: document it precisely so a future pass can fix it.
 *
 * ─── Gaming surfaces investigated ─────────────────────────────────────────
 * 1. Minimum-cost auto-merge unlock: starting from DEFAULT_BOND (50), the
 *    FULL_AUTONOMY_THRESHOLD (75) is only 5 SUCCESS_DELTA (5) steps away.
 *    → 5 trivial successes unlock auto-merge for ANY patch in that category,
 *      regardless of the 6th patch's actual risk.  This is the primary gap.
 *
 * 2. Cross-category isolation: inflating "cosmetic" does NOT carry over to
 *    "security-fix".  → RESISTANT.
 *
 * 3. Confidence underreporting to minimise failure penalty: failure penalty =
 *    round(10 × (0.5 + claimedConfidence)).  Claiming confidence=0 yields
 *    penalty = 5; claiming confidence=1 yields penalty = 15.  An adversary who
 *    always claims low confidence pays the minimum penalty on failures while
 *    still collecting full SUCCESS_DELTA on every success.  → PARTIAL GAP.
 *
 * 4. Asymmetric decay: one high-confidence failure costs −15 but one success
 *    only recovers +5.  The ledger IS asymmetric in the right direction; it
 *    takes 3 successes to recover from one full-confidence failure.  → RESISTANT
 *    for failure recovery.  WEAK for inflation: it takes only 5 successes
 *    from DEFAULT_BOND to unlock auto-merge (see gap 1).
 *
 * 5. Probation recovery: entering probation (score < PROBATION_THRESHOLD = 40)
 *    requires many genuine successes to clear, because the probation flag is
 *    only cleared when score ≥ FULL_AUTONOMY_THRESHOLD (75) — requiring
 *    more than 7 successes from the floor.  → RESISTANT post-probation.
 *
 * 6. Seed-sealing: seedTrustFromProvenRepo caps the seeded score at
 *    FULL_AUTONOMY_THRESHOLD − 5 = 70, and marks all bonds probation:true.
 *    Because canAutoMerge requires !probation, a seeded repo cannot
 *    immediately auto-merge — it must earn at least one real success to lift
 *    the probation flag AND push the score over 75.  → RESISTANT.
 *
 * 7. Category misclassification: classifyTrustCategory uses keyword matching
 *    on the objective string.  An attacker who controls the objective string
 *    could route a high-risk patch as "cosmetic" (cheaper to earn than
 *    "security-fix") if the string contains "cosmetic" or "comment".
 *    → GAP (documented; mitigation outside trust-ledger scope).
 *
 * 8. Vitals score gaming: computeVitals accepts caller-supplied inputs with no
 *    cross-validation against Redis state.  An adversary who supplies all-max
 *    inputs obtains score = 100 but that score has no gate enforcement on its
 *    own; it only affects dashboard display and alerting thresholds.  The trust
 *    ledger and gate validators are independent.  → IN-SCOPE DISPLAY ONLY; no
 *    auto-merge gate attached to vitals score.
 *
 * ─── Test structure ────────────────────────────────────────────────────────
 *  Suite A: trust-ledger core mechanics (pure math, no Redis)
 *  Suite B: Gaming attack scenarios against the trust model
 *  Suite C: Probation and recovery mechanics
 *  Suite D: Seed-sealing gaming resistance
 *  Suite E: classifyTrustCategory adversarial input
 *  Suite F: vitals-score gaming surface
 *
 * ─── Implementation note ──────────────────────────────────────────────────
 * RedisState is mocked in-process (an in-memory Map).  No file system, no
 * network, no Redis daemon required.  All tests are self-contained.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyTrustCategory,
  canAutoMerge,
  isProbation,
  recordOutcome,
  loadTrustLedger,
  getBond,
  seedTrustFromProvenRepo,
  type TrustBond,
  type TrustCategory,
  type TrustLedgerSnapshot,
} from "../src/services/trust-ledger.js";
import {
  computeVitals,
  type VitalsInput,
} from "../src/services/vitals-score.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants (mirror the production values for documentation clarity)
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_BOND = 50;
const PROBATION_THRESHOLD = 40;
const FULL_AUTONOMY_THRESHOLD = 75;
const SUCCESS_DELTA = 5;
const FAILURE_BASE_DELTA = 10;

// Minimum successes needed to reach auto-merge from DEFAULT_BOND with zero failures:
//   50 + n*5 ≥ 75  →  n ≥ 5
const MIN_SUCCESSES_FROM_DEFAULT = 5;

// ─────────────────────────────────────────────────────────────────────────────
// In-process RedisState mock (no external services)
// ─────────────────────────────────────────────────────────────────────────────
function makeRedisState() {
  const store = new Map<string, unknown>();
  return {
    async getJSON<T>(key: string): Promise<T | null> {
      return (store.get(key) as T) ?? null;
    },
    async setJSONWithTTL(key: string, value: unknown, _ttl: number): Promise<void> {
      store.set(key, JSON.parse(JSON.stringify(value))); // deep-clone to prevent aliasing
    },
    _store: store,
  };
}

// Convenience: run N successive recordOutcome calls for one category.
async function runSuccesses(
  n: number,
  category: TrustCategory,
  confidence: number,
  state: ReturnType<typeof makeRedisState>,
  owner = "org",
  repo = "repo",
): Promise<TrustBond> {
  let bond!: TrustBond;
  for (let i = 0; i < n; i++) {
    bond = await recordOutcome(owner, repo, category, true, confidence, state);
  }
  return bond;
}

async function runFailures(
  n: number,
  category: TrustCategory,
  confidence: number,
  state: ReturnType<typeof makeRedisState>,
  owner = "org",
  repo = "repo",
): Promise<TrustBond> {
  let bond!: TrustBond;
  for (let i = 0; i < n; i++) {
    bond = await recordOutcome(owner, repo, category, false, confidence, state);
  }
  return bond;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite A — Trust-ledger core mechanics
// ─────────────────────────────────────────────────────────────────────────────
describe("trust-ledger — core mechanics", () => {
  let state: ReturnType<typeof makeRedisState>;

  beforeEach(() => {
    state = makeRedisState();
  });

  it("new bond starts at DEFAULT_BOND and is not in auto-merge range", async () => {
    const bond = await getBond("org", "repo", "feature", state);
    expect(bond.score).toBe(DEFAULT_BOND);
    expect(canAutoMerge(bond)).toBe(false); // 50 < 75
    expect(isProbation(bond)).toBe(false); // 50 >= 40
  });

  it(`each success increments score by SUCCESS_DELTA (${SUCCESS_DELTA})`, async () => {
    const bond = await recordOutcome("org", "repo", "cosmetic", true, 90, state);
    expect(bond.score).toBe(DEFAULT_BOND + SUCCESS_DELTA);
  });

  it("score is capped at 100 regardless of success streak", async () => {
    const bond = await runSuccesses(20, "cosmetic", 100, state);
    expect(bond.score).toBe(100);
  });

  it("high-confidence failure penalty equals round(10 × (0.5 + 1.0)) = 15", async () => {
    const bond = await recordOutcome("org", "repo", "cosmetic", false, 100, state);
    expect(bond.score).toBe(DEFAULT_BOND - 15); // 50 − 15 = 35
    expect(bond.probation).toBe(true); // 35 < PROBATION_THRESHOLD 40
  });

  it("zero-confidence failure penalty equals round(10 × (0.5 + 0.0)) = 5", async () => {
    const bond = await recordOutcome("org", "repo", "cosmetic", false, 0, state);
    expect(bond.score).toBe(DEFAULT_BOND - 5); // 50 − 5 = 45
    expect(bond.probation).toBe(false); // 45 ≥ 40
  });

  it("failure penalty is asymmetrically larger than success gain (decay > recovery)", async () => {
    // From 50: one full-confidence failure → 35; recovering requires 3 successes (35+5+5+5=50) to restore
    const afterFailure = await recordOutcome("org", "repo", "cosmetic", false, 100, state);
    expect(afterFailure.score).toBe(35);

    // 3 successes only return to 50, not 75 — still below auto-merge
    const after3Recoveries = await runSuccesses(3, "cosmetic", 100, state);
    expect(after3Recoveries.score).toBe(50);
    expect(canAutoMerge(after3Recoveries)).toBe(false);
  });

  it("canAutoMerge requires score ≥ FULL_AUTONOMY_THRESHOLD and !probation", () => {
    const bond75NoProbation: TrustBond = {
      category: "cosmetic", score: 75, outcomes: 5, successes: 5, failures: 0,
      probation: false, lastOutcomeAt: "",
    };
    const bond75Probation: TrustBond = { ...bond75NoProbation, probation: true };
    const bond74: TrustBond = { ...bond75NoProbation, score: 74 };

    expect(canAutoMerge(bond75NoProbation)).toBe(true);  // exactly at threshold
    expect(canAutoMerge(bond75Probation)).toBe(false);   // threshold met but probation blocks
    expect(canAutoMerge(bond74)).toBe(false);            // one point below threshold
    expect(canAutoMerge(undefined)).toBe(false);         // missing bond always denies
  });

  it("outcomes counter increments correctly across mixed results", async () => {
    await recordOutcome("org", "repo", "feature", true, 80, state);
    await recordOutcome("org", "repo", "feature", false, 50, state);
    await recordOutcome("org", "repo", "feature", true, 70, state);
    const bond = await getBond("org", "repo", "feature", state);
    expect(bond.outcomes).toBe(3);
    expect(bond.successes).toBe(2);
    expect(bond.failures).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite B — Gaming attack scenarios
// ─────────────────────────────────────────────────────────────────────────────
describe("trust-ledger gaming — attack scenarios", () => {
  let state: ReturnType<typeof makeRedisState>;

  beforeEach(() => {
    state = makeRedisState();
  });

  /**
   * Gap 1 — PRIMARY GAP: minimum-cost auto-merge unlock.
   *
   * Starting from DEFAULT_BOND (50), exactly MIN_SUCCESSES_FROM_DEFAULT (5)
   * trivial successes reach FULL_AUTONOMY_THRESHOLD (75) and unlock canAutoMerge.
   * An adversary submitting 5 cheap "cosmetic" patches can then submit a
   * dangerous "cosmetic" patch that auto-merges without human review.
   *
   * The gap is real and structural: the SUCCESS_DELTA step-size (5) and the
   * gap from DEFAULT_BOND (50) to FULL_AUTONOMY_THRESHOLD (75) are both
   * small design choices.  Increasing either would require more work to
   * inflate — but would also require more real work to earn auto-merge.
   *
   * Documented finding: auto-merge unlock is achievable in exactly 5 trivial
   * successes.  Potential mitigations (deferred to a future pass):
   *   - require N outcomes rather than a point threshold for first unlock
   *   - apply patch-size/blast-radius weighting to SUCCESS_DELTA
   *   - add a cooldown / minimum-elapsed-time gate before first auto-merge
   */
  it("GAP-1: 5 trivial cosmetic successes unlock auto-merge from DEFAULT_BOND", async () => {
    // Before inflation: cannot auto-merge
    const initial = await getBond("org", "repo", "cosmetic", state);
    expect(canAutoMerge(initial)).toBe(false);
    expect(initial.score).toBe(DEFAULT_BOND);

    // 4 successes: still below threshold
    const after4 = await runSuccesses(4, "cosmetic", 100, state);
    expect(after4.score).toBe(70); // 50+5+5+5+5
    expect(canAutoMerge(after4)).toBe(false);

    // 5th success: crosses threshold
    const after5 = await runSuccesses(1, "cosmetic", 100, state);
    expect(after5.score).toBe(75); // 50+5×5
    expect(canAutoMerge(after5)).toBe(true); // ← gap: now any "cosmetic" patch auto-merges

    // Confirm: a dangerous 6th patch (still "cosmetic") would auto-merge
    expect(after5.probation).toBe(false);
  });

  /**
   * Gap 1 variant — the inflation cost is the same regardless of whether
   * the preceding patches were actually trivial (low blast radius) or not.
   * The trust model does not weight SUCCESS_DELTA by patch size.
   */
  it("GAP-1-variant: success delta is constant; patch risk does not lower it", async () => {
    // "Large risky" patch that succeeds still adds exactly SUCCESS_DELTA
    const bond = await recordOutcome("org", "repo", "feature", true, 50, state);
    expect(bond.score).toBe(DEFAULT_BOND + SUCCESS_DELTA); // always +5, never more or less
  });

  /**
   * Gap 2 — CONFIDENCE UNDERREPORTING: an adversary who consistently claims
   * low confidence (0) on failures pays the minimum penalty (5) while still
   * collecting full SUCCESS_DELTA (5) on every success.  Success and failure
   * are therefore score-symmetric when confidence is zero.
   *
   * A more dangerous attacker:  submit 6 successes (score → 80), then one
   * deliberate failure at confidence=0 (score 80−5=75) — still at auto-merge.
   * Repeat indefinitely while the category stays at auto-merge level.
   *
   * Compare with honest high-confidence: one failure at confidence=1.0
   * costs 15 points (drops from 80 to 65, well below 75).
   */
  it("GAP-2: low-confidence failures pay minimum penalty (symmetric with success delta)", async () => {
    const penaltyAtConfidence0 = Math.round(FAILURE_BASE_DELTA * (0.5 + 0.0)); // = 5
    const penaltyAtConfidence1 = Math.round(FAILURE_BASE_DELTA * (0.5 + 1.0)); // = 15

    expect(penaltyAtConfidence0).toBe(SUCCESS_DELTA); // ← gap: penalty = success gain at confidence=0
    expect(penaltyAtConfidence1).toBe(15);            // honest high-confidence failure: 3× larger
  });

  it("GAP-2-sustained: attacker maintains auto-merge by underreporting confidence on failures", async () => {
    // Inflate to 80 via 6 successes
    await runSuccesses(6, "cosmetic", 100, state);
    const after6 = await getBond("org", "repo", "cosmetic", state);
    expect(after6.score).toBe(Math.min(100, DEFAULT_BOND + 6 * SUCCESS_DELTA)); // 80
    expect(canAutoMerge(after6)).toBe(true);

    // One failure at confidence=0 costs 5 → score 75 (stays at auto-merge)
    const afterLowConfFailure = await recordOutcome("org", "repo", "cosmetic", false, 0, state);
    expect(afterLowConfFailure.score).toBe(75);
    expect(canAutoMerge(afterLowConfFailure)).toBe(true); // ← gap: still auto-mergeable

    // Contrast: same scenario with honest confidence=1.0 → drops to 65
    const state2 = makeRedisState();
    await runSuccesses(6, "cosmetic", 100, state2);
    const afterHighConfFailure = await recordOutcome("org", "repo", "cosmetic", false, 100, state2);
    expect(afterHighConfFailure.score).toBe(65);
    expect(canAutoMerge(afterHighConfFailure)).toBe(false); // honest reporting: drops out of auto-merge
  });

  /**
   * RESISTANCE: cross-category isolation.
   * Inflating "cosmetic" does NOT affect "security-fix".
   * The auto-merge gate on a security patch checks its own category bond.
   */
  it("RESISTANT: inflating cosmetic does not affect security-fix bond", async () => {
    // Inflate cosmetic past auto-merge
    await runSuccesses(10, "cosmetic", 100, state);
    const cosmetic = await getBond("org", "repo", "cosmetic", state);
    expect(canAutoMerge(cosmetic)).toBe(true);

    // security-fix is still at DEFAULT_BOND, not auto-mergeable
    const security = await getBond("org", "repo", "security-fix", state);
    expect(security.score).toBe(DEFAULT_BOND);
    expect(canAutoMerge(security)).toBe(false);
  });

  /**
   * RESISTANCE: asymmetric failure recovery — the ledger is harder to
   * recover from failures than to damage.  One full-confidence failure
   * costs 15 points; recovering costs 3 full successes just to break even.
   * This means trust erosion from real problems is sticky.
   */
  it("RESISTANT: recovery from high-confidence failure requires multiple successes", async () => {
    // First inflate to 75 (auto-merge unlocked)
    await runSuccesses(5, "feature", 100, state);
    const before = await getBond("org", "repo", "feature", state);
    expect(before.score).toBe(75);
    expect(canAutoMerge(before)).toBe(true);

    // One high-confidence failure: score → 60; drops out of auto-merge
    await recordOutcome("org", "repo", "feature", false, 100, state);
    const afterFail = await getBond("org", "repo", "feature", state);
    expect(afterFail.score).toBe(60);
    expect(canAutoMerge(afterFail)).toBe(false);

    // 2 more successes: 60 + 5 + 5 = 70, still below 75
    await runSuccesses(2, "feature", 100, state);
    const after2 = await getBond("org", "repo", "feature", state);
    expect(after2.score).toBe(70);
    expect(canAutoMerge(after2)).toBe(false);

    // 3rd success restores auto-merge
    await runSuccesses(1, "feature", 100, state);
    const after3 = await getBond("org", "repo", "feature", state);
    expect(after3.score).toBe(75);
    expect(canAutoMerge(after3)).toBe(true);
  });

  /**
   * RESISTANCE: multiple failures compound; each high-confidence failure
   * requires 3 successes to recover.  5 failures from DEFAULT_BOND sends
   * the score to 50 − 5×15 = −25 → clamped to 0; recovery to auto-merge
   * requires 15 successes minimum.
   */
  it("RESISTANT: score floors at 0 and requires 15 successes to reach auto-merge from 0", async () => {
    await runFailures(5, "security-fix", 100, state);
    const atFloor = await getBond("org", "repo", "security-fix", state);
    expect(atFloor.score).toBe(0);
    expect(canAutoMerge(atFloor)).toBe(false);
    expect(atFloor.probation).toBe(true);

    // 15 successes: 0 + 15×5 = 75; but probation must also be cleared
    await runSuccesses(15, "security-fix", 100, state);
    const after15 = await getBond("org", "repo", "security-fix", state);
    expect(after15.score).toBe(75);
    // probation is cleared when score first ≥ FULL_AUTONOMY_THRESHOLD
    // recordOutcome sets probation=false when score ≥ 75 AND was previously in probation
    expect(after15.probation).toBe(false);
    expect(canAutoMerge(after15)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite C — Probation entry and recovery mechanics
// ─────────────────────────────────────────────────────────────────────────────
describe("trust-ledger — probation mechanics", () => {
  let state: ReturnType<typeof makeRedisState>;

  beforeEach(() => {
    state = makeRedisState();
  });

  it("probation is entered when score drops below PROBATION_THRESHOLD (40)", async () => {
    // score = 50; two high-confidence failures → 50 − 15 − 15 = 20 < 40
    await runFailures(2, "refactor", 100, state);
    const bond = await getBond("org", "repo", "refactor", state);
    expect(bond.score).toBe(20);
    expect(bond.probation).toBe(true);
    expect(canAutoMerge(bond)).toBe(false);
  });

  it("probation is NOT cleared until score reaches FULL_AUTONOMY_THRESHOLD (75)", async () => {
    // Enter probation at score=20
    await runFailures(2, "refactor", 100, state);

    // Bring score to 40 (edge of threshold): still probation
    await runSuccesses(4, "refactor", 100, state); // 20+5+5+5+5=40
    const at40 = await getBond("org", "repo", "refactor", state);
    expect(at40.score).toBe(40);
    expect(at40.probation).toBe(true); // probation requires ≥75 to clear

    // Bring score to 74: still probation
    await runSuccesses(6, "refactor", 100, state); // 40+30=70
    await runSuccesses(1, "refactor", 100, state); // 70+5=75? Let's check exact score
    const at75 = await getBond("org", "repo", "refactor", state);
    // 40 + 7×5 = 75 → probation should clear
    expect(at75.score).toBe(75);
    expect(at75.probation).toBe(false);
    expect(canAutoMerge(at75)).toBe(true);
  });

  it("a single success cannot clear probation from 39", async () => {
    // Drive score to exactly 39 (one below probation threshold)
    // From 50: need penalty to reach 39
    // One failure at confidence=0.3: penalty = round(10*(0.5+0.3)) = round(8) = 8 → 50-8=42
    // One failure at confidence=0.7: penalty = round(10*(0.5+0.7)) = round(12) = 12 → 42-12=30
    // Let's just use deterministic approach: multiple zero-confidence failures
    // Each zero-confidence failure: penalty = 5
    // From 50: 50-5-5-5=35 (3 failures) — deep in probation
    await runFailures(3, "test-addition", 0, state);
    const atProbation = await getBond("org", "repo", "test-addition", state);
    expect(atProbation.score).toBe(35);
    expect(atProbation.probation).toBe(true);

    // One success: 35+5=40, still below 75 → still probation
    await runSuccesses(1, "test-addition", 100, state);
    const after1 = await getBond("org", "repo", "test-addition", state);
    expect(after1.score).toBe(40);
    expect(after1.probation).toBe(true);
    expect(canAutoMerge(after1)).toBe(false);
  });

  it("isProbation returns true for bond score below PROBATION_THRESHOLD", () => {
    const bondAt39: TrustBond = {
      category: "feature", score: 39, outcomes: 1, successes: 0, failures: 1,
      probation: true, lastOutcomeAt: "",
    };
    const bondAt40: TrustBond = { ...bondAt39, score: 40, probation: false };
    expect(isProbation(bondAt39)).toBe(true);
    expect(isProbation(bondAt40)).toBe(false);
    expect(isProbation(undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite D — Seed-sealing gaming resistance
// ─────────────────────────────────────────────────────────────────────────────
describe("trust-ledger — seed-sealing gaming resistance", () => {
  let stateProven: ReturnType<typeof makeRedisState>;
  let stateNew: ReturnType<typeof makeRedisState>;

  beforeEach(() => {
    stateProven = makeRedisState();
    stateNew = makeRedisState();
  });

  it("RESISTANT: seeded repo cannot auto-merge immediately — probation gate applies", async () => {
    // Build a proven repo with a high cosmetic bond
    await runSuccesses(20, "cosmetic", 100, stateProven, "provenOrg", "provenRepo");
    const provenBond = await getBond("provenOrg", "provenRepo", "cosmetic", stateProven);
    expect(provenBond.score).toBe(100); // maxed out

    // Seed a new repo from this proven one
    // Note: seedTrustFromProvenRepo uses its own state; we pass the same state
    // object to act as both source and destination (different keys)
    await seedTrustFromProvenRepo("newOrg", "newRepo", "provenOrg", "provenRepo", stateProven);
    const newBond = await getBond("newOrg", "newRepo", "cosmetic", stateProven);

    // Seeded score is capped at FULL_AUTONOMY_THRESHOLD − 5 = 70 and probation=true
    expect(newBond.score).toBeLessThanOrEqual(FULL_AUTONOMY_THRESHOLD - 5); // ≤70
    expect(newBond.probation).toBe(true);
    expect(canAutoMerge(newBond)).toBe(false); // probation blocks despite decent score
  });

  it("RESISTANT: seeded bond at exactly 70 still requires real outcomes to clear probation", async () => {
    // Manually construct the seeded scenario at the cap
    await runSuccesses(20, "dependency-bump", 100, stateProven, "provenOrg", "provenRepo"); // proven = 100

    await seedTrustFromProvenRepo("newOrg", "newRepo", "provenOrg", "provenRepo", stateProven);

    // Seeded bond must show probation=true regardless of score
    const seeded = await getBond("newOrg", "newRepo", "dependency-bump", stateProven);
    expect(seeded.probation).toBe(true);

    // 5 successes on new repo (using stateProven because seed was stored there)
    await runSuccesses(5, "dependency-bump", 100, stateProven, "newOrg", "newRepo");
    const after5 = await getBond("newOrg", "newRepo", "dependency-bump", stateProven);

    // 70 + 5×5 = 95 → score is well above 75, probation should now be cleared
    expect(after5.score).toBeGreaterThanOrEqual(FULL_AUTONOMY_THRESHOLD);
    expect(after5.probation).toBe(false);
    expect(canAutoMerge(after5)).toBe(true);
  });

  it("seeded snapshot preserves all bond categories from the proven repo", async () => {
    const categories: TrustCategory[] = ["cosmetic", "test-addition", "security-fix"];
    for (const cat of categories) {
      await runSuccesses(3, cat, 80, stateProven, "provenOrg", "provenRepo");
    }

    await seedTrustFromProvenRepo("newOrg", "newRepo", "provenOrg", "provenRepo", stateProven);
    const snapshot = await loadTrustLedger("newOrg", "newRepo", stateProven);

    expect(snapshot.bonds.length).toBe(categories.length);
    for (const bond of snapshot.bonds) {
      expect(categories).toContain(bond.category);
      expect(bond.probation).toBe(true); // all seeded bonds are probationary
      expect(bond.outcomes).toBe(0);     // seeded repo starts with 0 outcomes
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite E — classifyTrustCategory adversarial input
// ─────────────────────────────────────────────────────────────────────────────
describe("trust-ledger — classifyTrustCategory adversarial classification", () => {
  it("routes expected keywords to expected categories", () => {
    expect(classifyTrustCategory("bump lodash to 4.18.0")).toBe("feature"); // "bump" alone, no "dependency"
    expect(classifyTrustCategory("upgrade and update dependency")).toBe("dependency-bump");
    expect(classifyTrustCategory("fix CVE-2024-1234")).toBe("security-fix");
    expect(classifyTrustCategory("add payment checkout flow")).toBe("payment-path-fix");
    expect(classifyTrustCategory("improve performance p99 latency")).toBe("performance-fix");
    expect(classifyTrustCategory("refactor auth module")).toBe("refactor");
    expect(classifyTrustCategory("add test coverage for parser")).toBe("test-addition");
    expect(classifyTrustCategory("fix typo in comment")).toBe("cosmetic");
    expect(classifyTrustCategory("implement new feature")).toBe("feature");
  });

  /**
   * Gap 3 — CATEGORY MISCLASSIFICATION: an adversary who controls the
   * objective string can force a high-risk patch into an easier-to-earn
   * category by injecting certain keywords.
   *
   * Injection vector: "Refactor typo in payment checkout comment"
   * Expected: "payment-path-fix" (most specific match wins)
   * Actual: "security-fix" or "payment-path-fix" or "cosmetic" depending on
   *   keyword evaluation order.
   *
   * classifyTrustCategory uses cascading if-else (first match wins).
   * Order: security > payment > performance > dependency > test > refactor > cosmetic > feature.
   * An attacker CANNOT route a security patch as "cosmetic" by appending "typo"
   * IF the objective also contains "security" (security wins first).
   * BUT: an attacker CAN route a dangerous "feature" as "cosmetic" by including
   * "comment" or "typo" in a seemingly-innocuous objective string.
   */
  it("GAP-3: 'cosmetic' keyword in objective can override implicit 'feature' classification", () => {
    // A dangerous refactor described as "clean up comments"
    expect(classifyTrustCategory("clean up comments in auth module")).toBe("cosmetic");

    // Contrast: without cosmetic keyword, it would be "refactor" (still not the lowest-trust category)
    expect(classifyTrustCategory("clean up auth module")).toBe("feature"); // "refactor" not present
  });

  it("RESISTANT: 'security' keyword takes precedence over 'cosmetic' (order is correct)", () => {
    // Cannot route a security issue as cosmetic by appending comment
    expect(classifyTrustCategory("fix security vulnerability in comment parser")).toBe("security-fix");
  });

  it("RESISTANT: 'payment' keyword takes precedence over 'test' (order is correct)", () => {
    expect(classifyTrustCategory("add test for payment checkout flow")).toBe("payment-path-fix");
  });

  it("complexity parameter 'cosmetic' forces cosmetic regardless of objective text", () => {
    expect(classifyTrustCategory("upgrade critical security dependency", "cosmetic")).toBe("cosmetic");
    // ← GAP-3 extension: if the caller supplies complexity="cosmetic", even a security patch
    //   is classified as "cosmetic".  The trust model trusts the caller's complexity label.
  });

  it("complexity parameter 'security' routes to security-fix", () => {
    expect(classifyTrustCategory("rename variable", "security")).toBe("security-fix");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite F — vitals-score gaming surface
// ─────────────────────────────────────────────────────────────────────────────
describe("vitals-score — gaming surface", () => {
  it("all-maximum inputs produce score of 100", () => {
    const maxInput: VitalsInput = {
      calibrationScore: 100,
      openSentryIssues: 0,
      sloHealth: 1,
      recentSuccessRate: 1,
      forecastTrend: "improving",
      criticalCveCount: 0,
    };
    const result = computeVitals(maxInput);
    expect(result.score).toBe(100);
    expect(result.label).toBe("healthy");
    expect(result.trend).toBe("improving");
  });

  it("all-zero / worst-case inputs produce score below 'healthy' threshold", () => {
    const worstInput: VitalsInput = {
      calibrationScore: 0,
      openSentryIssues: 100,
      sloHealth: 0,
      recentSuccessRate: 0,
      forecastTrend: "degrading",
      criticalCveCount: 100,
    };
    const result = computeVitals(worstInput);
    expect(result.score).toBeLessThan(55); // below "attention" → "critical"
    expect(result.label).toBe("critical");
  });

  /**
   * OBSERVATION: vitals score has NO gate enforcement.
   * It is a display / alerting signal only.  An adversary who controls
   * the inputs can produce any score between 0 and 100 without affecting
   * the trust-ledger gates.  The two systems are independent.
   * This is by design: vitals is a dashboard metric, not an access control.
   */
  it("OBSERVATION: maximum vitals score does not grant auto-merge (systems are independent)", async () => {
    // Even with vitals=100, the trust bond for a category is still at DEFAULT_BOND
    const state = makeRedisState();
    const maxVitals = computeVitals({
      calibrationScore: 100, openSentryIssues: 0, sloHealth: 1,
      recentSuccessRate: 1, forecastTrend: "improving", criticalCveCount: 0,
    });
    expect(maxVitals.score).toBe(100);

    const bond = await getBond("org", "repo", "security-fix", state);
    expect(canAutoMerge(bond)).toBe(false); // trust bond is unchanged by vitals
  });

  it("sentry issue count dominates label at moderate CVE count", () => {
    // 11 open sentry issues → sentryScore=30; other signals near-max
    const heavySentry: VitalsInput = {
      calibrationScore: 95,
      openSentryIssues: 11,
      sloHealth: 0.98,
      recentSuccessRate: 0.95,
      forecastTrend: "stable",
      criticalCveCount: 0,
    };
    const result = computeVitals(heavySentry);
    // sentry contributes: 30 × 0.20 = 6 instead of 100 × 0.20 = 20
    // deficit = 14 points → drags score below ~80
    expect(result.score).toBeLessThan(80);
    expect(["attention", "critical"]).toContain(result.label);
  });

  it("default inputs (all undefined) produce a reasonable mid-range score", () => {
    // computeVitals uses defaults: calibration=70, sentry=0, slo=1, success=0.8, forecast=unknown, cve=0
    const result = computeVitals({});
    expect(result.score).toBeGreaterThan(55);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("single degrading CVE count can drop score from healthy to attention", () => {
    const withoutCve = computeVitals({ criticalCveCount: 0 });
    const with6Cve   = computeVitals({ criticalCveCount: 6 });
    // CVE weight=0.05; cveScore drops from 100 to 30 → max delta = 0.05 × 70 = 3.5 pts
    // Small weight by design: CVE alone should not trigger "critical"
    expect(with6Cve.score).toBeLessThan(withoutCve.score);
    expect(with6Cve.score).toBeGreaterThan(55); // remains "attention" not "critical"
  });
});
