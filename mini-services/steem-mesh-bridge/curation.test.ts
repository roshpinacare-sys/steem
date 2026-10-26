// G77-h — steem-mesh-bridge · curation.test.ts
// Contract tests for the ALL-SOLDIER CURATION BEAT (owner directive §3.3):
//   · the curation readiness prover (curationGate): per-soldier honest verdict
//     from measured chain facts — reachable, authority-match, rc-above-floor,
//     wound-clean — deterministic, injected clock, zero network, zero keys;
//   · topic selection ported from the measured curator law (age window, tag
//     whitelist via candidate stream, body/payout/bandwagon/crowded gates,
//     per-author diversity, day budget = max(state, chain) T-18 law, seeded
//     shuffle — same seed ⇒ same plan ⇒ auditable);
//   · weight law (steem units 0 < w ≤ 10000 — the u16 overflow downvote bug
//     must stay dead), RC regen math, effective-vests truth, policy merge
//     fail-closed validation.
//
// RED→GREEN law: written before curation.ts existed; every test deterministic.
import { describe, expect, test } from "bun:test";
import {
  curationGate,
  countDayVotesFromHistory,
  dayKeyOf,
  effectiveVests,
  hashSeed,
  mergeCuratePolicy,
  normalizePost,
  rcPct,
  selectTopics,
  soldierCuratorPolicy,
  vpEffPct,
  weightForAge,
  type CandidatePost,
  type CurationPolicy,
  type SoldierCurationFacts,
} from "./curation";

const P = (): CurationPolicy => soldierCuratorPolicy();

const post = (over: Partial<CandidatePost>): CandidatePost => ({
  author: "alice",
  permlink: "p1",
  tag: "life",
  createdMs: 1_000_000_000_000,
  title: "a steady hand",
  bodyLen: 900,
  voteCount: 12,
  pendingSbd: 2,
  archived: false,
  votedByUs: false,
  ...over,
});

/* ── policy defaults (the measured curate params, single source of truth) ── */

describe("soldierCuratorPolicy — the existing curate params, unchanged", () => {
  test("carries the measured R290 army-curation numbers", () => {
    const p = P();
    expect(p.maxPerDay).toBe(20);
    expect(p.baseWeightPct).toBe(80);
    expect(p.minWeightPct).toBe(40);
    expect(p.maxVotesPerCycle).toBe(4);
    expect(p.fetchLimit).toBe(30);
    expect(p.minVpEffPct).toBe(35);
    expect(p.ageMinMinutes).toBe(10);
    expect(p.ageMaxMinutes).toBe(240);
    expect(p.maxPerAuthorPerDay).toBe(1);
    expect(p.minBodyChars).toBe(600);
    expect(p.maxPendingSbd).toBe(30);
    expect(p.maxPostVotes).toBe(100);
  });

  test("carries the measured RC floor + regen window + vote spacing laws", () => {
    const p = P();
    expect(p.rcFloorPct).toBeCloseTo(0.08); // hive_rc.cjs measured sovereign floor
    expect(p.regenWindowSec).toBe(5 * 86400); // 5-day RC regen
    expect(p.voteIntervalMs).toBe(3300); // STEEM_MIN_VOTE_INTERVAL_SEC measured + margin
  });

  test("external-content law: the full roster is excluded as author", () => {
    const p = P();
    for (const s of [
      "headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame",
      "siq", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6", "saos-0004",
    ]) {
      expect(p.excludeAccounts).toContain(s);
    }
  });
});

describe("mergeCuratePolicy — operator overrides, fail-closed validation", () => {
  test("null/undefined overrides keep the defaults", () => {
    expect(mergeCuratePolicy(null)).toEqual(P());
    expect(mergeCuratePolicy(undefined)).toEqual(P());
    expect(mergeCuratePolicy({})).toEqual(P());
  });

  test("known numeric overrides apply and stay finite", () => {
    const p = mergeCuratePolicy({ maxPerDay: 12, baseWeightPct: 70 });
    expect(p.maxPerDay).toBe(12);
    expect(p.baseWeightPct).toBe(70);
    expect(p.minWeightPct).toBe(P().minWeightPct);
  });

  test("unknown keys are refused (no silent config drift)", () => {
    expect(() => mergeCuratePolicy({ hackThePlanet: true })).toThrow(/unknown/i);
  });

  test("insane values are refused fail-closed", () => {
    expect(() => mergeCuratePolicy({ maxPerDay: -1 })).toThrow(/maxPerDay/);
    expect(() => mergeCuratePolicy({ baseWeightPct: 0 })).toThrow(/baseWeightPct/);
    expect(() => mergeCuratePolicy({ minWeightPct: 101 })).toThrow(/minWeightPct/);
    expect(() => mergeCuratePolicy({ rcFloorPct: 1.5 })).toThrow(/rcFloorPct/);
    expect(() => mergeCuratePolicy({ ageMaxMinutes: "soon" as unknown as number })).toThrow(/ageMaxMinutes/);
    expect(() => mergeCuratePolicy({ tags: "life" as unknown as string[] })).toThrow(/tags/);
  });

  test("weight sanity: min ≤ base after merge (decay would invert)", () => {
    expect(() => mergeCuratePolicy({ baseWeightPct: 30, minWeightPct: 50 })).toThrow(/weight/i);
  });
});

/* ── weight law (steem units — the u16 overflow bug stays dead) ──────────── */

describe("weightForAge — linear decay in steem units, band law", () => {
  test("ageMin → baseWeight units (pct × 100)", () => {
    const p = P();
    expect(weightForAge(p.ageMinMinutes, p)).toBe(p.baseWeightPct * 100);
  });

  test("ageMax → minWeight units", () => {
    const p = P();
    expect(weightForAge(p.ageMaxMinutes, p)).toBe(p.minWeightPct * 100);
  });

  test("midpoint age → midpoint weight", () => {
    const p = P();
    const mid = (p.ageMinMinutes + p.ageMaxMinutes) / 2;
    expect(weightForAge(mid, p)).toBe(((p.baseWeightPct + p.minWeightPct) / 2) * 100);
  });

  test("clamps outside the window (never below min, never above base)", () => {
    const p = P();
    expect(weightForAge(0, p)).toBe(p.baseWeightPct * 100);
    expect(weightForAge(100_000, p)).toBe(p.minWeightPct * 100);
  });

  test("every in-window age lands in the legal u16 band (0, 10000]", () => {
    const p = P();
    for (let age = 0; age <= p.ageMaxMinutes + 60; age += 7) {
      const w = weightForAge(age, p);
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThanOrEqual(10000);
      expect(Number.isInteger(w)).toBe(true);
    }
  });
});

/* ── battery math: effective vests + VP + RC regen ───────────────────────── */

describe("effectiveVests + vpEffPct — the T-85 meter-truth law", () => {
  test("effective vests = own + received − delegated-out", () => {
    expect(
      effectiveVests({
        vesting_shares: "943788.000000 VESTS",
        received_vesting_shares: "2000.000000 VESTS",
        delegated_vesting_shares: "500.000000 VESTS",
      }),
    ).toBeCloseTo(945288);
  });

  test("junk/missing → 0 (never NaN into a gate)", () => {
    expect(effectiveVests(null)).toBe(0);
    expect(effectiveVests({})).toBe(0);
    expect(effectiveVests({ vesting_shares: "garbage" })).toBe(0);
  });

  test("vpEffPct: mana / (vests × 1e6) in pct, one decimal", () => {
    // 50% of 1M vests (max mana = 1e12) → 50
    expect(vpEffPct(500_000_000_000, 1_000_000)).toBe(50);
  });

  test("vpEffPct guards: zero vests or negative mana → null (honest unknown)", () => {
    expect(vpEffPct(100, 0)).toBe(null);
    expect(vpEffPct(null, 100)).toBe(null);
    expect(vpEffPct(-5, 100)).toBe(null);
  });
});

describe("rcPct — the RC regen law (stored + elapsed regen, capped at max)", () => {
  const W = 5 * 86400; // regen window

  test("full mana → 1", () => {
    expect(rcPct(6832634692, 6832634692, 1000, 1000, W)).toBe(1);
  });

  test("regen accrues linearly with elapsed time and caps at 1", () => {
    // half-spent, no elapsed time
    expect(rcPct(1000, 500, 1000, 1000, W)).toBeCloseTo(0.5);
    // half-spent, half the regen window elapsed → back to full
    expect(rcPct(1000, 500, 1000, 1000 + W / 2, W)).toBe(1);
    // 60% spent, an eighth of the window elapsed → 52.5%
    expect(rcPct(1000, 400, 1000, 1000 + W / 8, W)).toBeCloseTo(0.525);
    // quarter spent, a full window elapsed → capped at full
    expect(rcPct(1000, 750, 1000, 1000 + W, W)).toBe(1);
  });

  test("clock skew (last_update in the future) never yields negative regen", () => {
    expect(rcPct(1000, 500, 2000, 1000, W)).toBeCloseTo(0.5);
  });

  test("zero max_rc → 0 (fail-closed, never divide-by-zero)", () => {
    expect(rcPct(0, 0, 0, 1000, W)).toBe(0);
  });
});

/* ── THE READINESS PROVER ────────────────────────────────────────────────── */

describe("curationGate — per-soldier honest verdict, precedence law", () => {
  const readyFacts = (): SoldierCurationFacts => ({
    reachable: true,
    chainPub: "STM59yWnydpWbgiW3zRWTGW8MeWduXSC6EdtpQuSu9R9XwNsUwMh1",
    vaultPubs: ["STM59yWnydpWbgiW3zRWTGW8MeWduXSC6EdtpQuSu9R9XwNsUwMh1"],
    woundOpen: false,
    rcPct: 0.9,
    vpEff: 87.5,
  });

  test("all-green facts → CURATION-READY", () => {
    expect(curationGate(readyFacts(), P())).toEqual({ verdict: "CURATION-READY", reason: "ok" });
  });

  test("unreachable beats everything (no chain read = no judgment)", () => {
    const g = curationGate({ ...readyFacts(), reachable: false, chainPub: null, rcPct: null, vpEff: null }, P());
    expect(g.verdict).toBe("SKIP-UNREACHABLE");
  });

  test("open custody wound is ABSOLUTE — outranks every other signal", () => {
    // even with vault matched, RC full, VP high: a wound is never attempted
    const g = curationGate({ ...readyFacts(), woundOpen: true }, P());
    expect(g.verdict).toBe("SKIP-WOUND");
  });

  test("wound beats authority-mismatch (custody law outranks key mismatch)", () => {
    const g = curationGate(
      { ...readyFacts(), woundOpen: true, vaultPubs: ["STM0000000000000000000000000000000000000000000000000"] },
      P(),
    );
    expect(g.verdict).toBe("SKIP-WOUND");
  });

  test("vault present but no matching gen → SKIP-AUTHORITY (custody refusal)", () => {
    const g = curationGate({ ...readyFacts(), vaultPubs: ["STM7zzixt1a2GrsTfNqJW8fQBxyea3V3tHvsnBje2ERssCvVMsy5v"] }, P());
    expect(g.verdict).toBe("SKIP-AUTHORITY");
  });

  test("vault present, gens empty for soldier → SKIP-AUTHORITY", () => {
    const g = curationGate({ ...readyFacts(), vaultPubs: [] }, P());
    expect(g.verdict).toBe("SKIP-AUTHORITY");
  });

  test("vault ABSENT on host → SKIP-VAULT-ABSENT (readiness not provable here)", () => {
    const g = curationGate({ ...readyFacts(), vaultPubs: null }, P());
    expect(g.verdict).toBe("SKIP-VAULT-ABSENT");
  });

  test("unreadable chain authority with vault present → SKIP-AUTHORITY (fail-closed)", () => {
    const g = curationGate({ ...readyFacts(), chainPub: null }, P());
    expect(g.verdict).toBe("SKIP-AUTHORITY");
  });

  test("RC below the measured floor → SKIP-RC-FLOOR", () => {
    const g = curationGate({ ...readyFacts(), rcPct: 0.079 }, P());
    expect(g.verdict).toBe("SKIP-RC-FLOOR");
  });

  test("RC exactly at floor is READY (floor is inclusive)", () => {
    const p = P();
    const g = curationGate({ ...readyFacts(), rcPct: p.rcFloorPct }, p);
    expect(g.verdict).toBe("CURATION-READY");
  });

  test("RC unmeasurable is honest-below-floor with distinct reason", () => {
    const g = curationGate({ ...readyFacts(), rcPct: null }, P());
    expect(g.verdict).toBe("SKIP-RC-FLOOR");
    expect(g.reason).toMatch(/unmeasurable/);
  });

  test("VP below the 35 floor → SKIP-VP-FLOOR", () => {
    const g = curationGate({ ...readyFacts(), vpEff: 34.9 }, P());
    expect(g.verdict).toBe("SKIP-VP-FLOOR");
  });

  test("VP unmeasurable → SKIP-VP-FLOOR with honest reason", () => {
    const g = curationGate({ ...readyFacts(), vpEff: null }, P());
    expect(g.verdict).toBe("SKIP-VP-FLOOR");
    expect(g.reason).toMatch(/unmeasurable/);
  });

  test("precedence: RC floor beats VP floor (cheapest signal first)", () => {
    const g = curationGate({ ...readyFacts(), rcPct: 0.01, vpEff: 1 }, P());
    expect(g.verdict).toBe("SKIP-RC-FLOOR");
  });

  test("precedence: authority beats RC (custody outranks resources)", () => {
    const g = curationGate({ ...readyFacts(), vaultPubs: [], rcPct: 0.01 }, P());
    expect(g.verdict).toBe("SKIP-AUTHORITY");
  });
});

/* ── topic selection (ported curator law, deterministic) ─────────────────── */

describe("selectTopics — the pure planner, all measured gates", () => {
  const nowMs = 1_000_000_000_000 + 60 * 60 * 1000; // 60min after the fixture post

  test("a clean in-window post is selected with in-band weight", () => {
    const r = selectTopics({
      posts: [post({})],
      voter: "tov",
      policy: P(),
      nowMs,
      votesToday: 0,
    });
    expect(r.selected).toHaveLength(1);
    expect(r.selected[0]!.author).toBe("alice");
    expect(r.selected[0]!.weight).toBeGreaterThan(0);
    expect(r.selected[0]!.weight).toBeLessThanOrEqual(10000);
    expect(r.selected[0]!.ageMinutes).toBe(60);
  });

  test("age window: too-young and too-old are rejected with named reasons", () => {
    const p = P();
    const r = selectTopics({
      posts: [
        post({ permlink: "young", createdMs: nowMs - (p.ageMinMinutes - 2) * 60_000 }),
        post({ permlink: "old", createdMs: nowMs - (p.ageMaxMinutes + 5) * 60_000 }),
      ],
      voter: "tov",
      policy: p,
      nowMs,
      votesToday: 0,
    });
    expect(r.selected).toHaveLength(0);
    const why = Object.fromEntries(r.rejected.map((x) => [x.key, x.reason]));
    expect(why["alice/young"]).toBe("too-young");
    expect(why["alice/old"]).toBe("too-old");
  });

  test("self-fleet law: roster authors are never curated", () => {
    const r = selectTopics({
      posts: [post({ author: "cashmachine" })],
      voter: "tov",
      policy: P(),
      nowMs,
      votesToday: 0,
    });
    expect(r.selected).toHaveLength(0);
    expect(r.rejected[0]!.reason).toBe("self-fleet");
  });

  test("already-voted (state + on-chain votedByUs) is rejected", () => {
    const r = selectTopics({
      posts: [post({ votedByUs: true }), post({ permlink: "p2" })],
      voter: "tov",
      policy: P(),
      nowMs,
      votedPermlinks: ["alice/p2"],
      votesToday: 0,
    });
    expect(r.selected).toHaveLength(0);
    const why = Object.fromEntries(r.rejected.map((x) => [x.key, x.reason]));
    expect(why["alice/p1"]).toBe("already-voted");
    expect(why["alice/p2"]).toBe("already-voted");
  });

  test("anti-spam gates: short body, spam title, bandwagon payout, crowded pool, archived", () => {
    const p = P();
    const r = selectTopics({
      posts: [
        post({ permlink: "a", bodyLen: p.minBodyChars - 1 }),
        post({ permlink: "b", title: "BUY CRYPTO NOW!!!".toUpperCase() }),
        post({ permlink: "c", pendingSbd: p.maxPendingSbd + 1 }),
        post({ permlink: "d", voteCount: p.maxPostVotes + 1 }),
        post({ permlink: "e", archived: true }),
      ],
      voter: "tov",
      policy: p,
      nowMs,
      votesToday: 0,
    });
    expect(r.selected).toHaveLength(0);
    const why = Object.fromEntries(r.rejected.map((x) => [x.key, x.reason]));
    expect(why["alice/a"]).toBe("short-body");
    expect(why["alice/b"]).toBe("spam-title");
    expect(why["alice/c"]).toBe("bandwagon");
    expect(why["alice/d"]).toBe("crowded");
    expect(why["alice/e"]).toBe("payout-closed");
  });

  test("per-author diversity cap (1/day) and day budget cap (T-18: max(state, chain) counted upstream)", () => {
    const p = P();
    const r = selectTopics({
      posts: [post({ permlink: "1" }), post({ permlink: "2" }), post({ permlink: "3" })],
      voter: "tov",
      policy: p,
      nowMs,
      votesToday: 0,
      authorsToday: { alice: 1 },
    });
    expect(r.selected).toHaveLength(0);
    expect(r.rejected.every((x) => x.reason === "author-cap")).toBe(true);

    const r2 = selectTopics({
      posts: [post({ permlink: "1" }), post({ permlink: "2" })],
      voter: "tov",
      policy: p,
      nowMs,
      votesToday: p.maxPerDay, // day budget already spent
    });
    expect(r2.selected).toHaveLength(0);
    expect(r2.rejected.every((x) => x.reason === "day-cap")).toBe(true);
    expect(r2.dayCapReached).toBe(true);
  });

  test("remaining budget = maxPerDay − votesToday, capped at maxVotesPerCycle", () => {
    const p = P();
    const posts = Array.from({ length: 10 }, (_, i) => post({ permlink: `p${i}`, author: `auth${i}` }));
    const r = selectTopics({ posts, voter: "tov", policy: p, nowMs, votesToday: p.maxPerDay - 10 });
    expect(r.selected).toHaveLength(p.maxVotesPerCycle);

    const r2 = selectTopics({ posts, voter: "tov", policy: p, nowMs, votesToday: p.maxPerDay - 2 });
    expect(r2.selected).toHaveLength(2);
  });

  test("seeded shuffle: same seed ⇒ same plan (auditable), different seed differs", () => {
    const posts = Array.from({ length: 12 }, (_, i) =>
      post({ permlink: `p${i}`, author: `auth${i}`, createdMs: 1_000_000_000_000 + i * 1000 }),
    );
    const a = selectTopics({ posts, voter: "tov", policy: P(), nowMs, votesToday: 0, jitterSeed: hashSeed("d|w|tov") });
    const b = selectTopics({ posts, voter: "tov", policy: P(), nowMs, votesToday: 0, jitterSeed: hashSeed("d|w|tov") });
    const c = selectTopics({ posts, voter: "tov", policy: P(), nowMs, votesToday: 0, jitterSeed: hashSeed("d|w|wic") });
    expect(a.selected.map((s) => s.author)).toEqual(b.selected.map((s) => s.author));
    expect(a.selected.map((s) => s.author)).not.toEqual(c.selected.map((s) => s.author));
  });

  test("duplicate post via two tags is deduped silently (single rejection trail)", () => {
    const r = selectTopics({
      posts: [post({}), post({ tag: "photography" })],
      voter: "tov",
      policy: P(),
      nowMs,
      votesToday: 0,
    });
    expect(r.selected).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });
});

/* ── normalizePost + chain-truth day budget (T-18) ───────────────────────── */

describe("normalizePost — raw condenser discussion → candidate", () => {
  const raw = {
    author: "bob",
    permlink: "post-x",
    created: "2026-10-26T10:00:00",
    title: "quiet machines",
    body: "x".repeat(700),
    active_votes: [{ voter: "tov" }, { voter: "someoneelse" }],
    pending_payout_value: "12.345 SBD",
    cashout_time: "2026-10-30T10:00:00",
  };

  test("normalizes with chain-truth dedup (votedByUs from active_votes)", () => {
    const n = normalizePost(raw, "life", "tov");
    expect(n).not.toBe(null);
    expect(n!.author).toBe("bob");
    expect(n!.createdMs).toBe(Date.parse("2026-10-26T10:00:00Z"));
    expect(n!.bodyLen).toBe(700);
    expect(n!.voteCount).toBe(2);
    expect(n!.pendingSbd).toBeCloseTo(12.345);
    expect(n!.archived).toBe(false);
    expect(n!.votedByUs).toBe(true);
  });

  test("another voter sees the same post as unvoted", () => {
    expect(normalizePost(raw, "life", "wic")!.votedByUs).toBe(false);
  });

  test("payout-closed cashout epochs mark archived", () => {
    for (const c of ["1969-12-31T23:59:59", "1970-01-01T00:00:00"]) {
      expect(normalizePost({ ...raw, cashout_time: c }, "life", "tov")!.archived).toBe(true);
    }
  });

  test("missing author/permlink/created → null (never a half candidate)", () => {
    expect(normalizePost({}, "life", "tov")).toBe(null);
    expect(normalizePost({ author: "bob" }, "life", "tov")).toBe(null);
    expect(normalizePost({ author: "bob", permlink: "p", created: "garbage" }, "life", "tov")).toBe(null);
  });
});

describe("countDayVotesFromHistory — the T-18 chain-truth day budget", () => {
  const mk = (ts: string, voter: string) => [0, { timestamp: ts, op: ["vote", { voter, author: "a", permlink: "p", weight: 1000 }] }];

  test("counts only the soldier's own vote ops on the exact day", () => {
    const rows = [
      mk("2026-10-26T01:00:00", "tov"),
      mk("2026-10-26T02:00:00", "tov"),
      mk("2026-10-26T03:00:00", "wic"), // someone else's vote
      mk("2026-10-25T23:59:59", "tov"), // yesterday
      mk("2026-10-27T00:00:01", "tov"), // tomorrow
      [0, { timestamp: "2026-10-26T04:00:00", op: ["comment", { author: "tov" }] }], // not a vote
    ];
    expect(countDayVotesFromHistory(rows, "tov", "2026-10-26")).toBe(2);
  });

  test("tolerates nested-op shape and junk rows; non-array → null", () => {
    expect(
      countDayVotesFromHistory([[0, { timestamp: "2026-10-26T01:00:00", type: "vote", value: { voter: "tov" } }]], "tov", "2026-10-26"),
    ).toBe(1);
    expect(countDayVotesFromHistory([[0, null], ["junk"], [0, {}]], "tov", "2026-10-26")).toBe(0);
    expect(countDayVotesFromHistory("nope" as unknown as unknown[], "tov", "2026-10-26")).toBe(null);
    expect(countDayVotesFromHistory([], "", "2026-10-26")).toBe(null);
  });
});

/* ── misc pure helpers ───────────────────────────────────────────────────── */

describe("dayKeyOf + hashSeed", () => {
  test("dayKeyOf takes the UTC date prefix", () => {
    expect(dayKeyOf("2026-10-26T23:59:59.000Z")).toBe("2026-10-26");
    expect(dayKeyOf(undefined)).toMatch(/^\d{4}-\d{2}-\d{2}$/); // injected "now" fallback keeps the law
  });

  test("hashSeed is FNV-1a-stable and uint32", () => {
    expect(hashSeed("day|window|soldier")).toBe(hashSeed("day|window|soldier"));
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
    expect(hashSeed("")).toBe(0x811c9dc5); // FNV offset basis
  });
});
