/**
 * t59c.vectors.mjs — Task 2-c · THE MACHINE FEEDS ITSELF (vector-locked).
 *
 * Two laws, one runner (bun t59runner.mjs t59c.vectors.mjs):
 *   1. THE SELF-FEED SEEDER (forge.mjs · forgeSeedTaskFromLesson, pure,
 *      fail-closed): empty queue + learning lessons → exactly ONE bounded
 *      task from the highest-severity open lesson (high>medium>low; tie →
 *      first); the task text carries ONLY the lesson's own words, ≤300
 *      chars, every digit-run traces into the lesson that produced them;
 *      typed refusals no-lessons / queue-not-empty / no-eligible-lesson.
 *   2. THE DISCOVERY STEER (content.mjs · discoveryTopicsSteer +
 *      withTopicsSteer + steerNumberGrounds, pure, fail-open): the top ≤5
 *      tagBoard tags (payoutsSbd desc) join the drafting prompt as context —
 *      missing/empty board → the payload is byte-identical; nothing else in
 *      the prompt mutates; the shown numbers stay NUMBER-TRUTH-lawful via
 *      the flat snapshot mirrors.
 */
import { forgeSeedTaskFromLesson } from "./forge.mjs";
import { discoveryTopicsSteer, withTopicsSteer, steerNumberGrounds, TOPICS_STEER_SOURCE, numbersGrounded } from "./content.mjs";

const NOW = "2026-10-03T19:30:00.000Z";

/* ── fixtures ── */
const LESSON_SMALL = {
  id: "loop-gap",
  severity: "medium",
  evidence: "window 30",
  lesson: "the loop never closes",
  action: "close the loop",
};

const LESSON_HIGH_LIVE = {
  id: "signing-cred-blocked",
  severity: "high",
  evidence: "cycle-blocked ×17/155 — ONLY credential-gated steps failing",
  lesson: "signing rails lawfully parked — VP regen above the cap burns unused",
  action: "operator revival: adopt the credential, chain-verify instantly",
};

const sub = (r) => (r.seeded ? { seeded: r.seeded, id: r.task.id, from: r.task.seededFromLesson, sev: r.task.severity } : { seeded: r.seeded, reason: r.reason });

export async function run({ eq, ok }) {
  /* ── §A · THE SEEDER: typed refusals (fail-closed) ── */
  eq("§A1 empty lessons array → typed no-lessons", forgeSeedTaskFromLesson({ lessons: [], existingTasks: [], now: NOW }), { seeded: false, reason: "no-lessons" });
  eq("§A2 lessons not an array (null read) → no-lessons", forgeSeedTaskFromLesson({ lessons: null, existingTasks: [], now: NOW }), { seeded: false, reason: "no-lessons" });
  eq("§A3 queue non-empty → no seed", forgeSeedTaskFromLesson({ lessons: [LESSON_HIGH_LIVE], existingTasks: [{ id: "op-1", task: "operator task" }], now: NOW }), { seeded: false, reason: "queue-not-empty" });
  eq("§A4 existingTasks not an array → fail-closed queue-not-empty", forgeSeedTaskFromLesson({ lessons: [LESSON_HIGH_LIVE], existingTasks: null, now: NOW }), { seeded: false, reason: "queue-not-empty" });
  eq("§A5 junk-only lessons (no eligible) → no-eligible-lesson", forgeSeedTaskFromLesson({ lessons: [{ severity: "high", lesson: "no id" }, { id: "no-sev", lesson: "words" }, { id: "bad-sev", severity: "critical", lesson: "words" }, { id: "no-words", severity: "low" }, null, 42], existingTasks: [], now: NOW }), { seeded: false, reason: "no-eligible-lesson" });

  /* ── §B · THE SEEDER: severity order, one bounded task, shape ── */
  const mixed = forgeSeedTaskFromLesson({
    lessons: [null, { id: "low-lesson", severity: "low", lesson: "low words" }, LESSON_HIGH_LIVE, { id: "med-lesson", severity: "medium", lesson: "medium words" }, 42],
    existingTasks: [],
    now: NOW,
  });
  eq("§B1 mixed severities + junk → the HIGH lesson wins", sub(mixed), { seeded: true, id: "seed-signing-cred-blocked", from: "signing-cred-blocked", sev: "high" });
  eq("§B2 tie on severity → the FIRST lesson wins", sub(forgeSeedTaskFromLesson({ lessons: [{ id: "a", severity: "high", lesson: "first words" }, { id: "b", severity: "high", lesson: "second words" }], existingTasks: [], now: NOW })), { seeded: true, id: "seed-a", from: "a", sev: "high" });
  ok("§B3 exactly ONE task — a single object, not a list", !Array.isArray(mixed.task) && typeof mixed.task === "object");
  eq("§B4 shape matches the runner-consumed schema + provenance", forgeSeedTaskFromLesson({ lessons: [LESSON_SMALL], existingTasks: [], now: NOW }), {
    seeded: true,
    task: {
      id: "seed-loop-gap",
      task: "SELF-ENGINEERING TASK (seeded from learning lesson \"loop-gap\" · severity medium) | LESSON: the loop never closes | ACTION: close the loop | EVIDENCE: window 30",
      seededFromLesson: "loop-gap",
      severity: "medium",
      seededAt: NOW,
    },
  });
  eq("§B5 no caller clock → honest null seededAt", forgeSeedTaskFromLesson({ lessons: [LESSON_SMALL], existingTasks: [], now: undefined }).task.seededAt, null);

  /* ── §C · THE SEEDER: the lesson's OWN words, bounded, number-truth ── */
  const live = forgeSeedTaskFromLesson({ lessons: [LESSON_HIGH_LIVE], existingTasks: [], now: NOW });
  ok("§C1 the task text is bounded (≤300 chars)", live.task.task.length <= 300);
  ok("§C2 the task text carries the lesson's OWN words (verbatim)", live.task.task.includes("signing rails lawfully parked — VP regen above the cap burns unused"));
  const blob = `${LESSON_HIGH_LIVE.id}${LESSON_HIGH_LIVE.severity}${LESSON_HIGH_LIVE.lesson}${LESSON_HIGH_LIVE.action}${LESSON_HIGH_LIVE.evidence}`;
  const runs = live.task.task.match(/\d+/g) ?? [];
  ok("§C3 no invented numbers — every digit-run traces into the lesson", runs.every((r) => blob.includes(r)));
  const long = forgeSeedTaskFromLesson({
    lessons: [{ id: "long-lesson", severity: "high", lesson: "L".repeat(400), action: "A".repeat(400), evidence: "E".repeat(400) }],
    existingTasks: [],
    now: NOW,
  });
  eq("§C4 a flood of words is capped at exactly 300 chars", long.task.task.length, 300);
  ok("§C5 the truncation is typed (ellipsis tail, LESSON first)", long.task.task.endsWith("…") && long.task.task.includes("LESSON: "));

  /* ── §D · THE SEEDER: only OPEN lessons are seedable ── */
  eq("§D1 a resolved/closed lesson is skipped → the open medium wins", sub(forgeSeedTaskFromLesson({
    lessons: [{ id: "resolved-high", severity: "high", lesson: "done words", resolved: true }, { id: "closed-high", severity: "high", lesson: "closed words", closed: true }, { id: "open-med", severity: "medium", lesson: "open words" }],
    existingTasks: [],
    now: NOW,
  })), { seeded: true, id: "seed-open-med", from: "open-med", sev: "medium" });

  /* ── §E · THE STEER: fail-open (no measured board → prompt UNCHANGED) ── */
  const PAYLOAD = {
    findings: [
      { title: "T1", url: "https://a.b/c", host: "a.b", snippet: "s1" },
      { title: "T2", url: "https://d.e/f", host: "d.e", snippet: "s2" },
    ],
    exposureLaw: ["law one", "law two"],
  };
  eq("§E1 empty tagBoard → payload byte-identical", withTopicsSteer(PAYLOAD, { tagBoard: [] }), PAYLOAD);
  eq("§E2 discovery read failed (null) → payload unchanged", withTopicsSteer(PAYLOAD, null), PAYLOAD);
  eq("§E3 tagBoard not an array → payload unchanged", withTopicsSteer(PAYLOAD, { tagBoard: "junk" }), PAYLOAD);
  eq("§E4 non-object payload → untouched (null)", withTopicsSteer(null, { tagBoard: [{ tag: "t", payoutsSbd: 1 }] }), null);
  eq("§E5 non-object payload → untouched (string)", withTopicsSteer("str", { tagBoard: [{ tag: "t", payoutsSbd: 1 }] }), "str");
  eq("§E6 direct law: empty board → no block, nothing invented", discoveryTopicsSteer({ tagBoard: [] }), null);

  /* ── §F · THE STEER: cap 5, ordered by payoutsSbd desc, exact block ── */
  const BOARD8 = [
    { tag: "kr", payoutsSbd: 2971.543 },
    { tag: "hive-129948", payoutsSbd: 6906.643 },
    { tag: "hive-150122", payoutsSbd: 1962.51 },
    { tag: "atomy", payoutsSbd: 821.996 },
    { tag: "steem", payoutsSbd: 1182.044 },
    { tag: "hive-166405", payoutsSbd: 1575.302 },
    { tag: "hive-196917", payoutsSbd: 1263.518 },
    { tag: "hive-180932", payoutsSbd: 1116.336 },
  ];
  const steered = withTopicsSteer(PAYLOAD, { tagBoard: BOARD8 });
  eq("§F1 8 tags → exactly 5 topics", steered.topicsSteer.topics.length, 5);
  eq("§F2 ordered by payoutsSbd descending", steered.topicsSteer.topics.map((t) => t.tag), ["hive-129948", "kr", "hive-150122", "hive-166405", "hive-196917"]);
  eq("§F3 each topic carries tag + payoutsSbd (rounded, 3dp)", steered.topicsSteer.topics[0], { tag: "hive-129948", payoutsSbd: 6906.643 });
  eq("§F4 rounding law: 6906.6429 → 6906.643", discoveryTopicsSteer({ tagBoard: [{ tag: "x-tag", payoutsSbd: 6906.6429 }] }).topics[0].payoutsSbd, 6906.643);
  eq("§F5 the source note is the measured-economy wording", steered.topicsSteer.source, "discovery tagBoard (measured, live tag economy)");
  eq("§F6 the constant itself is pinned", TOPICS_STEER_SOURCE, "discovery tagBoard (measured, live tag economy)");

  /* ── §G · THE STEER: nothing else in the prompt mutates ── */
  eq("§G1 findings ride through untouched", steered.findings, PAYLOAD.findings);
  eq("§G2 exposureLaw rides through untouched (law not edited)", steered.exposureLaw, PAYLOAD.exposureLaw);
  eq("§G3 exactly one key added", Object.keys(steered).filter((k) => !Object.keys(PAYLOAD).includes(k)), ["topicsSteer"]);
  const before = JSON.parse(JSON.stringify(BOARD8));
  discoveryTopicsSteer({ tagBoard: BOARD8 });
  eq("§G4 the caller's board is never mutated", BOARD8, before);
  eq("§G5 malformed rows dropped (junk board → only the lawful row)", discoveryTopicsSteer({ tagBoard: [null, { tag: "", payoutsSbd: 5 }, { tag: "good", payoutsSbd: 3.5 }, { tag: "bad", payoutsSbd: "9" }, { tag: "inf", payoutsSbd: Infinity }] }), { source: TOPICS_STEER_SOURCE, topics: [{ tag: "good", payoutsSbd: 3.5 }] });

  /* ── §H · THE STEER × NUMBER-TRUTH: shown numbers stay lawful ── */
  const oneSteer = discoveryTopicsSteer({ tagBoard: [{ tag: "hive-129948", payoutsSbd: 6906.643 }] });
  const grounds = steerNumberGrounds(oneSteer);
  eq("§H1 the mirrors carry the payouts AND the tag's own digits", grounds, { tagPayoutsSbd1: 6906.643, tagId1r1: 129948 });
  const withGrounds = { parity: 0.1041, topicsSteer: oneSteer, ...grounds };
  eq("§H2 a draft naming the community + quoting the payout traces", numbersGrounded("The hive-129948 community carried 6,906.643 SBD in measured payouts this window.", withGrounds).ok, true);
  eq("§H3 control — WITHOUT the mirrors the same sentence is ungrounded", numbersGrounded("The hive-129948 community carried 6,906.643 SBD in measured payouts this window.", { parity: 0.1041 }).ok, false);
}
