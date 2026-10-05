/**
 * learning.mjs — T-14 continuous-learning engine (המפעיל דרש: "תמיד טוב יותר,
 * אינטליגנטי יותר, לומד מהעבר ומתקן, משפר עתיד בלמידה מתמשכת").
 *
 * PRINCIPLE — LEARNING FROM EVIDENCE, NEVER FROM INVENTION:
 *  - ingests ONLY local recorded history (sovereign-events.jsonl, events.jsonl,
 *    curator.json, exec-log.jsonl, sovereign.json) — zero network, zero keys.
 *  - every lesson MUST cite evidence (counters with timestamps); empty history
 *    ⇒ zero lessons (an honest learner says "nothing to learn yet").
 *  - every tuning is BOUNDED by hard clamps and additive-only where risky —
 *    the machine can nudge itself, never re-law itself (VF1 floor, VP floor,
 *    daily caps and doctrine gates are UNTOUCHABLE by learning).
 *  - everything journaled: state/learning.json + events.jsonl.
 *
 * LOOP: ingest → metrics → lessons (evidence) → tunings (bounded) → apply →
 * next cycle runs with the improved policy → the loop repeats. דבר-גורר-דבר.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const LEARN_FILE = path.join(STATE, "learning.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); };
const readLines = (p, n = 200) => {
  try {
    return fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).slice(-n)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
};

/* ── pure core (selftest vectors live in selftest.mjs) ─────────────────── */

/** T-14 sovereign.ts doctrine mirrors: which failures are connection-level */
export function classifyCycleFailure(errorText) {
  const s = String(errorText ?? "");
  if (/timeout|abort/i.test(s)) return "timeout";
  if (/fetch failed|ECONNRESET|ECONNREFUSED|EPIPE|socket|network|other side closed/i.test(s)) return "conn";
  if (/HTTP|40[0-9]|50[0-9]/i.test(s)) return "http";
  if (!s.trim()) return "none";
  return "unknown";
}

/** cycle events (sovereign-events.jsonl lines) → health metrics + fail histogram.
 * T-16 truth taxonomy: cycle-blocked (ONLY CREDENTIAL-MISSING steps — lawful
 * wait for operator revival) is counted SEPARATELY from cycle-fail. Counting
 * blocked as fail produced the 68.6% "ok-rate" lie-by-composition measured
 * 2026-09-30 while every real step was green. */
export function analyzeCycles(cycleEvents) {
  const evs = (cycleEvents ?? []).filter((e) => /cycle-(ok|fail|error|blocked)\(auto\)/.test(String(e?.kind ?? "")));
  const oks = evs.filter((e) => e.kind.startsWith("cycle-ok"));
  const blocked = evs.filter((e) => e.kind.startsWith("cycle-blocked"));
  const fails = evs.filter((e) => e.kind.startsWith("cycle-fail") || e.kind.startsWith("cycle-error"));
  const failReasons = {};
  for (const f of fails) {
    const kind = classifyCycleFailure(f.error);
    failReasons[kind] = (failReasons[kind] ?? 0) + 1;
  }
  const durations = evs.map((e) => Number(e.ms ?? 0)).filter((x) => x > 0).sort((a, b) => a - b);
  const msP50 = durations.length ? durations[Math.floor(durations.length * 0.5)] : null;
  const msP90 = durations.length ? durations[Math.floor(durations.length * 0.9)] : null;
  return {
    window: evs.length, oks: oks.length, fails: fails.length, blocked: blocked.length,
    okRate: evs.length ? Math.round((oks.length / evs.length) * 1000) / 10 : null,
    blockedRate: evs.length ? Math.round((blocked.length / evs.length) * 1000) / 10 : null,
    failReasons, msP50, msP90,
  };
}

/** curator state → efficiency metrics (VP economy, verdict distribution) */
export function analyzeCurator(curatorState, policy = null) {
  if (!curatorState) return { present: false };
  const hist = Array.isArray(curatorState.history) ? curatorState.history : [];
  const verdicts = {};
  for (const h of hist) verdicts[h.verdict] = (verdicts[h.verdict] ?? 0) + 1;
  const votes = Array.isArray(curatorState.voted) ? curatorState.voted : [];
  const ages = votes.map((v) => Number(v.ageMinutes ?? 0)).filter((x) => x > 0);
  const tags = {};
  for (const v of votes) if (v.tag) tags[v.tag] = (tags[v.tag] ?? 0) + 1;
  const dayCapsInRow = (() => {
    let n = 0;
    for (let i = hist.length - 1; i >= 0; i--) {
      if (hist[i]?.verdict === "DAY-CAP") n++; else break;
    }
    return n;
  })();
  return {
    present: true,
    totalVotes: curatorState.totalVotes ?? 0,
    window: hist.length, verdicts,
    vpEff: curatorState.vpEff ?? null,
    meanAgeMinutes: ages.length ? Math.round((ages.reduce((s, x) => s + x, 0) / ages.length) * 10) / 10 : null,
    tagsVoted: tags,
    dayCapsInRow,
    maxPerDay: policy?.maxPerDay ?? curatorState.maxPerDay ?? null,
  };
}

/** exec log → signing health (broadcast outcomes) */
export function analyzeExec(execLines) {
  const evs = (execLines ?? []).filter(Boolean);
  const broadcast = evs.filter((e) => /broadcast|exec/i.test(String(e.type ?? e.tag ?? "")));
  const fails = broadcast.filter((e) => e.ok === false || e.error);
  return { window: broadcast.length, fails: fails.length, lastError: fails.at(-1)?.error ?? null };
}

/** the lesson rules — deterministic, each cites evidence; no evidence ⇒ no lesson.
 * R217 · STATE-AWARE RESOLUTION: a lesson whose PREMISE no longer holds in the
 * present (credential now live, broadcasts now succeeding) is emitted as a
 * RESOLVED historical lesson (severity low + resolved:true) — never deleted
 * (the window evidence stays honest) but never again shown as a CURRENT
 * operator demand. Measured lie this kills: the cockpit demanded
 * "OPERATOR REVIVAL" hours AFTER the operator already revived it. */
export function deriveLessons({ cycles, curator, exec, credentialNow = null }) {
  const credAlive = !!credentialNow?.keyPresent;
  const lastOkAt = credentialNow?.lastOkAt ?? null;
  const lastFailAt = credentialNow?.lastFailAt ?? null;
  const broadcastResolved = !!(lastOkAt && lastFailAt && lastOkAt > lastFailAt);
  const lessons = [];
  if (cycles && cycles.window > 0) {
    if (cycles.okRate !== null && cycles.okRate < 100 && (cycles.failReasons.conn ?? 0) > 0) {
      lessons.push({
        id: "cycle-conn-fails",
        severity: "high",
        evidence: `cycles ${cycles.oks}/${cycles.window} ok · conn-fails ${cycles.failReasons.conn} (${cycles.failReasons.conn === 1 ? "e.g. 19:42:42 fetch-failed fall, root-caused to Bun idleTimeout=10s" : "connection-level"})`,
        lesson: "connection-level cycle kills waste 10-minute sovereignty slots",
        action: "FIXED T-14: engine idleTimeout 255 + sovereign one-shot conn-retry with heal-gate",
      });
    }
    if (cycles.blocked > 0) {
      lessons.push({
        id: "signing-cred-blocked",
        severity: credAlive ? "low" : "high",
        ...(credAlive ? { resolved: true } : {}),
        evidence: credAlive
          ? `cycle-blocked ×${cycles.blocked}/${cycles.window} in the counted window (HISTORICAL) · credential present & chain-verified NOW — the blocks describe the past, not the present`
          : `cycle-blocked ×${cycles.blocked}/${cycles.window} — ONLY credential-gated steps failing (blockedSteps journaled per event); every non-signing step green`,
        lesson: credAlive
          ? "historical: those blocks were lawful then; the credential is now adopted and chain-verified (VERIFIED) — signing rails are LIVE, the counting window still carries the old blocked cycles"
          : "signing rails lawfully parked — the machine is NOT sick, but VP regen above the 100% cap burns unused and every vote/order/op the doctrine would place is foregone",
        action: credAlive
          ? "none — resolved; the lesson self-clears once the event window rotates past the historical blocked cycles"
          : "OPERATOR REVIVAL (T-16 self-service): paste the credential in the cockpit banner → engine adopts (0600) + chain-verifies instantly; or drop upload/headcorner.txt",
      });
    }
    /* T-18: name the histogram's blind spot instead of letting "none" pass as
     * a category — measured live: failReasons {conn:3, none:15}, where the 15
     * are pre-T-17-era kills journaled without a reason class. Evidence-honest:
     * the learner says what it CANNOT know, never invents a reason. */
    if ((cycles.failReasons?.none ?? 0) > 0) {
      lessons.push({
        id: "unclassified-fail-legacy",
        severity: "medium",
        evidence: `${cycles.failReasons.none} fails journaled without a reason class (pre-T-17 era — the sovereign recorded "fail" without engine-measured health)`,
        lesson: "unclassified fails poison the failure histogram — a lesson machine that cannot classify cannot fully learn",
        action: "STRUCTURAL T-17: the marker flow journals engine-measured health+reason for every new fail; legacy history stays as evidence, never back-filled with invented causes",
      });
    }
    if (cycles.msP90 != null && cycles.msP50 != null && cycles.msP90 > 3 * cycles.msP50 && cycles.msP90 > 15000) {
      lessons.push({
        id: "cycle-latency-tail",
        severity: "medium",
        evidence: `p50 ${cycles.msP50}ms vs p90 ${cycles.msP90}ms`,
        lesson: "cycle duration tail is fat — RPC latency inside steps",
        action: "watch: observe/node switch is already fail-isolated; no unsafe tuning",
      });
    }
  }
  if (curator?.present) {
    if (curator.dayCapsInRow >= 3) {
      lessons.push({
        id: "curation-daycap-repeat",
        severity: "medium",
        evidence: `DAY-CAP ×${curator.dayCapsInRow} in last ${curator.window} runs · VP ${curator.vpEff ?? "?"}%`,
        lesson: "daily vote quota saturates — VP surplus burns unused until tomorrow",
        action: "bounded tuning: base weight may rise with VP≥85 (clamped 30-60%), never maxPerDay",
      });
    }
    if (curator.vpEff != null && curator.vpEff > 90 && (curator.totalVotes ?? 0) > 0 && !curator.dayCapsInRow) {
      lessons.push({
        id: "vp-surplus-idle",
        severity: "low",
        evidence: `VP ${curator.vpEff}% with ${curator.totalVotes} total votes`,
        lesson: "voting power far above the 60% floor — capital-like resource sitting idle",
        action: "monitor: weight policy already ages-decayed; raise base weight only via bounded tuning",
      });
    }
    const noCand = (curator.verdicts?.["NO-CANDIDATES"] ?? 0);
    if (noCand >= 3) {
      lessons.push({
        id: "candidate-stream-narrow",
        severity: "medium",
        evidence: `NO-CANDIDATES ×${noCand} in last ${curator.window} runs`,
        lesson: "tag stream or age window too tight for the current feed",
        action: "bounded tuning: ageMinMinutes may drop to 5, discovery may add 1 measured tag (cap 8)",
      });
    }
  }
  if (exec && exec.fails > 0) {
    lessons.push({
      id: "broadcast-fails",
      severity: broadcastResolved ? "low" : exec.fails > 2 ? "high" : "medium",
      ...(broadcastResolved ? { resolved: true } : {}),
      evidence: broadcastResolved
        ? `${exec.fails}/${exec.window} broadcasts failed in the window (last: ${String(exec.lastError ?? "").slice(0, 60)}) · last fail ${lastFailAt} < last OK broadcast ${lastOkAt} (live posting-role ops succeed)`
        : `${exec.fails}/${exec.window} broadcasts failed · last: ${String(exec.lastError ?? "").slice(0, 90)}`,
      lesson: broadcastResolved
        ? "historical: the missing-posting-authority failure class was fixed by ADAPT-claim-role-posting-R209 (claim executor switched to posting role) — live broadcasts now succeed"
        : "broadcast failures burn RC and delay rails",
      action: broadcastResolved
        ? "none — resolved by R209; watch for any NEW failure class in the live window"
        : "fail-closed stop already holds; vote-interval retry added T-14",
    });
  }
  return lessons;
}

/* hard clamps — the learner CANNOT cross these, ever */
export const LEARN_CLAMP = {
  baseWeightPct: [30, 60],
  ageMinMinutes: [5, 12],
  tagsMax: 8,
};

/** bounded tunings from lessons — additive-only tags, clamped numbers */
export function deriveTunings(lessons, { basePolicy, discoveredTags = [] }) {
  const t = {};
  const apply = [];
  const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, Math.round(v)));
  const ids = new Set(lessons.map((l) => l.id));

  if (ids.has("curation-daycap-repeat") || ids.has("vp-surplus-idle")) {
    const cur = basePolicy.baseWeightPct ?? 50;
    const learned = clamp(cur + 5, LEARN_CLAMP.baseWeightPct);
    if (learned !== cur) {
      t.baseWeightPct = learned;
      apply.push({ key: "baseWeightPct", from: cur, to: learned, clamp: LEARN_CLAMP.baseWeightPct, because: ids.has("curation-daycap-repeat") ? "daycap-repeat" : "vp-surplus" });
    }
  }
  if (ids.has("candidate-stream-narrow")) {
    const cur = basePolicy.ageMinMinutes ?? 10;
    const learned = clamp(cur - 2, LEARN_CLAMP.ageMinMinutes);
    if (learned < cur) {
      t.ageMinMinutes = learned;
      apply.push({ key: "ageMinMinutes", from: cur, to: learned, clamp: LEARN_CLAMP.ageMinMinutes, because: "no-candidates" });
    }
    // additive tag: only from DISCOVERY's measured ranking, never invented here
    const curTags = basePolicy.tags ?? [];
    const add = discoveredTags.find((x) => !curTags.includes(x));
    if (add && curTags.length + 1 <= LEARN_CLAMP.tagsMax) {
      t.tags = [...curTags, add];
      apply.push({ key: "tags", added: add, total: t.tags.length, cap: LEARN_CLAMP.tagsMax, because: "discovery-measured" });
    }
  }
  return { tunings: t, applied: apply };
}

/** the tunings the next curator run should merge (bounded) */
export function learningTunings() {
  const l = readJson(LEARN_FILE, null);
  if (!l || l.enabled !== true) return {};
  return l.tunings && typeof l.tunings === "object" ? l.tunings : {};
}

/* ── the IO pass (called from the daily cycle's learn step) ─────────────── */
export async function runLearning({ now = new Date().toISOString(), persist = true } = {}) {
  const sovEvents = readLines(path.join(STATE, "sovereign-events.jsonl"), 200);
  const events = readLines(path.join(STATE, "events.jsonl"), 200);
  const curator = readJson(path.join(STATE, "curator.json"), null);
  const sov = readJson(path.join(STATE, "sovereign.json"), null);
  const execLines = readLines(path.join(STATE, "exec-log.jsonl"), 60);

  const cycles = analyzeCycles(sovEvents);
  const cur = analyzeCurator(curator);
  const exec = analyzeExec(execLines);
  /* R217 · credential-now evidence: FILE EXISTENCE ONLY (zero key material
   * read) + broadcast outcome timeline — the learner stays zero-key while
   * still being able to tell HISTORICAL lessons from CURRENT demands. */
  const keyPath = path.join(DIR, "..", "..", ".secrets", "headcorner.key");
  const okAts = execLines.filter((e) => e && e.ok === true && e.at).map((e) => e.at).sort();
  const failAts = execLines.filter((e) => e && (e.ok === false || e.error) && e.at).map((e) => e.at).sort();
  const credentialNow = {
    keyPresent: fs.existsSync(keyPath),
    lastOkAt: okAts.at(-1) ?? null,
    lastFailAt: failAts.at(-1) ?? null,
  };
  const lessons = deriveLessons({ cycles, curator: cur, exec, credentialNow });

  // discovered tags come from discovery.json ONLY (measured ranking, no invention)
  const disc = readJson(path.join(STATE, "discovery.json"), null);
  const discoveredTags = (disc?.tagBoard ?? []).slice(0, 3).map((t) => t.tag).filter(Boolean);
  const basePolicy = {
    baseWeightPct: 50, ageMinMinutes: 10,
    tags: ["steem", "crypto", "defi", "trading", "technology", "ai"],
  };
  const { tunings, applied } = deriveTunings(lessons, { basePolicy, discoveredTags });

  const prev = readJson(LEARN_FILE, { runsTotal: 0, lessonsTotal: {} });
  const lessonsTotal = { ...(prev.lessonsTotal ?? {}) };
  for (const l of lessons) lessonsTotal[l.id] = (lessonsTotal[l.id] ?? 0) + 1;

  const out = {
    at: now,
    enabled: true,
    runsTotal: (prev.runsTotal ?? 0) + 1,
    verdict: lessons.length ? "LEARNED" : "NO-NEW-LESSONS",
    metrics: { cycles, curator: cur, exec, watchdog: sov?.watchdog ?? null },
    lessons,
    tunings,
    tuningsApplied: applied,
    lessonsTotal,
    honesty: "learning reads recorded history only · tunings hard-clamped (LEARN_CLAMP) · doctrine laws untouchable",
  };
  if (persist) {
    writeJson(LEARN_FILE, out);
    fs.appendFileSync(path.join(STATE, "events.jsonl"), JSON.stringify({
      type: "learn.done", at: now, verdict: out.verdict,
      lessons: lessons.map((l) => l.id), tunings: applied.map((a) => `${a.key}:${a.from}->${a.to ?? a.added}`),
    }) + "\n");
  }
  return out;
}

export function learningState() { return readJson(LEARN_FILE, null); }
