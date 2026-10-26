/**
 * ci-cycle.mjs — R244 · THE SOVEREIGN CI HEARTBEAT (דופק-הריבונות).
 *
 * OPERATOR ORDER 2026-10-07 (verbatim intent): "הטוקן הוא אדמין... תפעיל
 * actions... ווידוא פעילות ריבונית אוטונומית ללא תלות באף סנדבוקס חובה".
 *
 * WHERE THIS RUNS: GitHub Actions, on the public saos-runtime repo, on a
 * 30-minute cron — infrastructure that survives every sandbox wipe BY DESIGN.
 * The workflow clones the PRIVATE engine tree via a secrets-held PAT, runs
 * the selftest gate, then THIS file.
 *
 * WHAT ONE HEARTBEAT DOES (fail-isolated steps):
 *  1. CUSTODY: reviveArmyCustody — the git vault (agent/vault/*.enc on
 *     origin/main) decrypts and re-adopts the soldiers' posting WIFs against
 *     the LIVE chain. Zero key material in CI secrets: the vault IS the
 *     credential delivery, exactly like a fresh sandbox boot.
 *  2. SOCIAL: runSocial with SAOS_OFFLINE=1 + SAOS_CI_SKIP_MASTER=1 —
 *     · the offline intelligence pack (intel-pack.mjs) drafts anchored,
 *       topic-aware conversation — no bridge, no cockpit, no sandbox;
 *     · the soldiers converse: fleet comments, community comments, replies,
 *       deepens, mutual votes — under every cap and sanitizer.
 *  3. CONTENT: runContent — the sovereign corpus (content-corpus.json,
 *     hand-crafted pillar posts living IN the tree) queues drafts.
 *  4. STATE: written into state/*.json inside the clone; the workflow
 *     commits + pushes it back to saos-cockpit (FF-only, no force).
 *
 * WHAT NEVER HAPPENS HERE: the master (headcorner) credential is never
 * present — master signing, trading, custody stay machine-local. The job
 * summary prints VERDICTS ONLY (this output is public).
 *
 * Exit code: 0 = heartbeat lived (even if lanes honestly skipped);
 * only a broken gate (selftest handled in workflow) or a hard crash exits 1.
 */

/* T-61 (trace 1a12632b71721ef9): SAOS_ONLINE_CONTENT=1 lets a LOCAL heartbeat
 * feed the live bridge (the sandbox's own LLM at :3000). Default remains the
 * CI law — offline, corpus floor — so the cloud behavior is byte-unchanged. */
if (process.env.SAOS_ONLINE_CONTENT !== "1") process.env.SAOS_OFFLINE = "1";
process.env.SAOS_CI_SKIP_MASTER = "1";

import * as fs from "node:fs";
import * as path from "node:path";
import { masterAccount, armyCustodyState } from "./signer.mjs";
import { reviveArmyCustody } from "./vault-revival.mjs";
import { runSocial, ARMY_ROSTER } from "./army-social.mjs";
import { runContent } from "./content.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

async function stepWrap(name, fn) {
  const t0 = Date.now();
  try {
    const out = await fn();
    return { name, ok: true, ms: Date.now() - t0, ...(out ?? {}) };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 200) };
  }
}

async function main() {
  const now = new Date().toISOString();
  const report = { heartbeat: "saos.ci.v1", at: now, master: masterAccount(), steps: {} };

  report.steps.custody = await stepWrap("custody", async () => {
    const r = await reviveArmyCustody({ now });
    /* R245: full roster — 10 old army + the replacement generation (4/5/6) */
    const st = armyCustodyState([masterAccount(), "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6"]);
    return { verdict: r?.verdict ?? null, verified: st?.verified ?? null, total: st?.total ?? null };
  });

  /* ── P0-FAILCLOSE (2026-10-17 · operator-approved Phase-0) ────────────────
   * The in-cycle selftest lease now runs BEFORE any money lane, and its
   * verdict GATES dex-takeover + delegation-rail via moneyGateOpen() (lib.mjs).
   * The old order — money first, selftest observe-only after — was the
   * measured fail-open: beat 2026-10-17T00:25:30Z recorded dex=
   * TAKEOVER-EXECUTED + delegation=DELEGATED while selftestLease=
   * SELFTEST-RAN-RED. Law: GREEN is the only key that opens money.
   * RED / TIMEOUT / contention / absent = honest BLOCK, loudly recorded. */
  const selftestLease = await stepWrap("selftest-lease", async () => {
    const { withLease, PURPOSE_ALLOWLIST } = await import("./gate-lease.mjs");
    const purpose = "ci-selftest";
    if (!PURPOSE_ALLOWLIST.includes(purpose)) {
      return { verdict: "SELFTEST-LEASE-PURPOSE-UNREGISTERED", purpose, observe: true, note: "fail-closed: the beat refuses to hold an unregistered gate purpose" };
    }
    const { spawnSync } = await import("node:child_process");
    const leaseDir = path.join(STATE, "lease");
    const r = await withLease({
      leaseDir,
      purpose,
      ttlMs: 600000, // 10 min — far above suite duration; a crashed holder expires, the next beat takes over
      owner: "ci-heartbeat",
      fn: () => {
        const t0 = Date.now();
        const p = spawnSync(process.execPath, [path.join(DIR, "selftest.mjs")], { cwd: DIR, encoding: "utf8", timeout: 300000 });
        const tail = String(p.stdout ?? "").trim().split("\n").filter(Boolean).pop() ?? null;
        /* W0.1-c observability delta (2026-10-17, agent-zai): on RED the suite
         * prints "FAIL <name> / got: / want:" per failing vector — but this fn
         * captured stdout and dropped it (measured: verdict frozen at fail=1
         * since 2026-10-16T14:29Z with the vector name unknowable anywhere).
         * Surface the failing-vector lines into the step result (→ heartbeat
         * selftestLeaseDetail) AND console (→ run logs). */
        let detail = null;
        if (p.status !== 0) {
          const lines = String(`${p.stdout ?? ""}\n${p.stderr ?? ""}`).split("\n")
            .map((l) => l.trim())
            .filter((l) => l.startsWith("FAIL ") || l.startsWith("got:") || l.startsWith("want:") || l.startsWith("SELFTEST-EVIDENCE") || l.startsWith("SELFTEST-MARKER-FAIL"))
            .slice(0, 10);
          detail = lines.join(" | ").slice(0, 700) || "(red, no FAIL lines captured — non-zero exit without vector output)";
          console.error(`SELFTEST-LEASE-RED detail: ${detail}`);
        }
        return { exitCode: p.status, durationMs: Date.now() - t0, tail, detail };
      },
    });
    if (r.skipped) {
      return { verdict: "SELFTEST-SKIPPED-CONTENTION", purpose, holder: r.holder ?? null, leaseError: r.error ?? null, observe: true, note: "R339 SKIP-NOT-FAIL for the OBSERVE lane; the MONEY gate still blocks (moneyGateOpen)" };
    }
    const out = r.result ?? {};
    return {
      verdict: out.exitCode === 0 ? "SELFTEST-RAN-GREEN" : out.exitCode == null ? "SELFTEST-RUN-TIMEOUT" : "SELFTEST-RAN-RED",
      purpose,
      exitCode: out.exitCode ?? null,
      durationMs: out.durationMs ?? null,
      tail: typeof out.tail === "string" ? out.tail.slice(0, 160) : null,
      detail: out.detail ?? null,
      leaseDir: "state/lease",
      observe: true,
    };
  });
  report.steps.selftestLease = selftestLease;

  /* ── R245 · DEX TAKEOVER (operator order: no action is sovereign on the
   * sandbox) — when the sandbox's custodian anchor goes stale (engine dead),
   * CI adopts the master's ACTIVE authority (chain-judged, from the workflow
   * secret) and runs ONE full engine cycle: trading, converts, the economy.
   * A fresh anchor = engine alive = STANDBY (never races the local engine).
   * P0-FAILCLOSE: additionally gated on the selftest verdict above —
   * non-GREEN selftest = TAKEOVER-BLOCKED-SELFTEST-NOT-GREEN. */
  report.steps.dex = await stepWrap("dex-takeover", async () => {
    const { dexTakeoverDue } = await import("./lib.mjs");
    const anchor = readJson(path.join(STATE, "custody-anchor.json"), null);
    const last = readJson(path.join(STATE, "ci-takeover.json"), null);
    const gate = dexTakeoverDue({ anchorAt: anchor?.at ?? null, now, lastAt: last?.at ?? null });
    if (!gate.due) return { verdict: "STANDBY", reason: gate.reason, anchorAgeMs: anchor?.at ? Date.now() - (typeof anchor.at === "number" ? anchor.at : Date.parse(anchor.at)) : null };
    if (!process.env.CI_ADOPT_WIF_ACTIVE) return { verdict: "TAKEOVER-BLOCKED-NO-CREDENTIAL", reason: gate.reason };
    /* P0-FAILCLOSE: the money gate — the in-cycle selftest verdict (computed
     * BEFORE this step now) must be GREEN or nothing moves. Fail-closed on
     * RED, TIMEOUT, contention-skip, and a failed/absent selftest step. */
    const { moneyGateOpen } = await import("./lib.mjs");
    const mg = moneyGateOpen({ selftestVerdict: selftestLease?.verdict ?? null });
    if (!mg.open) {
      const blocked = { verdict: "TAKEOVER-BLOCKED-SELFTEST-NOT-GREEN", reason: gate.reason, selftest: selftestLease?.verdict ?? null, selftestExit: selftestLease?.exitCode ?? null, gate: mg.reason };
      try {
        fs.writeFileSync(path.join(STATE, "ci-takeover.json"), JSON.stringify({ at: now, ...blocked }, null, 2));
        appendLine(path.join(STATE, "events.jsonl"), { type: "ci.dex-takeover-blocked", at: now, selftest: blocked.selftest, gate: mg.reason });
      } catch { /* ledger never blocks */ }
      return blocked;
    }
    process.env.CI_ADOPT_WIF_POSTING = process.env.CI_ADOPT_WIF_POSTING ?? "";
    const { runCycle } = await import("./daily.mjs");
    const r = await runCycle({ now, persist: true });
    try {
      fs.writeFileSync(path.join(STATE, "ci-takeover.json"), JSON.stringify({ at: now, reason: gate.reason, verdict: r?.verdict ?? null, health: r?.health ?? null }, null, 2));
      appendLine(path.join(STATE, "events.jsonl"), { type: "ci.dex-takeover", at: now, reason: gate.reason, verdict: r?.verdict ?? null });
    } catch { /* ledger never blocks */ }
    return { verdict: "TAKEOVER-EXECUTED", reason: gate.reason, cycle: r?.verdict ?? null, health: r?.health ?? null };
  });

  report.steps.social = await stepWrap("social", async () => {
    const r = await runSocial({ now });
    return { verdict: r.verdict, executed: r.executed ?? 0, refused: r.refused ?? 0, due: r.due ?? 0 };
  });

  report.steps.content = await stepWrap("content", async () => {
    const r = await runContent({ now, force: true });
    /* R307 (T-85): the queue now competes on the R304 ladder — alignment
     * rides the heartbeat so the observe→enforce decision gets its measured
     * evidence (R302 pattern). */
    return { verdict: r.verdict, draftsQueued: r.draftsQueued ?? 0, exposureBlocked: r.exposureBlocked ?? 0, source: r.source ?? null, conceptAlignMode: r.conceptAlignment?.mode ?? null, conceptAlignAvailable: r.conceptAlignment?.available ?? null, conceptAlignAligned: r.conceptAlignment?.aligned ?? null, conceptAlignTop: r.conceptAlignment?.topId ?? null };
  });

  /* R312 · THE MEASURED-DIGEST SUPPLY (wires R288 — built 2026-10-10, never
   * called in production: the exact built-but-not-running pattern). Measured
   * 2026-10-11: the corpus burned out (R311 FULL-PUBLISHED SHIELD holds every
   * entry) and the bridge is down (ECONNREFUSED since 2026-10-08) — so the
   * posting stream starves while every gate stays green. The finance-digest
   * rail composes measured telemetry into a deterministic digest document,
   * appends it to the compiler intake and compiles it BROADCAST-READY
   * (max 2/day, 28-pair topic rotation, honesty law, never broadcasts).
   * Operator order 2026-10-11 (verbatim): "יש לך אישור להכל תמשיך בוא נתחיל לבצע". */
  report.steps.digest = await stepWrap("digest", async () => {
    const { runFinanceDigest } = await import("./finance-digest.mjs");
    const r = await runFinanceDigest({ now });
    return { verdict: r.verdict, slot: r.slot ?? null, title: r.title ?? null, compiled: r.compileVerdict ?? null };
  });

  /* T-61 · THE CONTINUOUS POSTING STREAM: one bounded broadcast attempt per
   * heartbeat (stage → mode → armed → caps → dedupe → signature-verified →
   * broadcast). Fail-closed everywhere; a refusal is a verdict, never an
   * error. The ledger (content/sent) travels in the repo so caps + dedupe
   * hold across machines and across sandbox deaths. */
  report.steps.post = await stepWrap("post", async () => {
    const { runOnce } = await import("./social-streamer.mjs");
    const r = await runOnce();
    return { verdict: r.verdict, account: r.account ?? null, permlink: r.permlink ?? null, mode: r.mode ?? null, note: r.note ?? null };
  });

  /* R313 · BLURT BODIES PROBE (read-only, public RPC, zero keys). Operator
   * question 2026-10-11: why do the blurt accounts read "not connected" while
   * the vault holds their keys? Truth: R267 verified 11/12 blurt bodies
   * FULL-ACCESS (2026-10-08), but no heartbeat step ever showed blurt — the
   * wing was invisible. This step makes the bodies visible every beat
   * (existence, stake, last post — public data only). The SPEND gate (R254
   * operator pause) is untouched: visibility is not spend. */
  report.steps.blurt = await stepWrap("blurt-custody", async () => {
    const { runBlurtBodies } = await import("./blurt-heartbeat.mjs");
    const r = await runBlurtBodies({ now });
    return { verdict: r.verdict, live: r.live ?? 0, total: r.total ?? 0, spendGate: "R254-PAUSE-STANDS" };
  });

  /* R314 · THE DELEGATION RAIL (operator standing order 2026-10-11, verbatim:
   * "אני רוצה להאציל sp לכלל החשבונות כדי לחלק את כוח העבודה וההצבעה ופוסטים
   * בצורה נכונה" + "יש לך אישור להכל"). Tops the active publishers up to their
   * floor from the treasury, chain-judged WIF adoption, hard caps, idempotent,
   * ledgered, fully reversible (7-day undelegation, ownership never moves).
   * Fail-closed when the CI_DELEGATION_ARMED secret is absent. */
  report.steps.delegation = await stepWrap("delegation", async () => {
    /* P0-FAILCLOSE: the same money gate as dex-takeover — no GREEN selftest,
     * no delegation. Fail-closed also when the selftest step itself failed. */
    const { moneyGateOpen } = await import("./lib.mjs");
    const mg = moneyGateOpen({ selftestVerdict: selftestLease?.verdict ?? null });
    if (!mg.open) return { verdict: "DELEGATION-BLOCKED-SELFTEST-NOT-GREEN", ops: 0, totalSp: 0, reason: mg.reason, selftest: selftestLease?.verdict ?? null };
    const { runDelegationRail } = await import("./delegation-rail.mjs");
    const r = await runDelegationRail({ now });
    return { verdict: r.verdict, ops: r.ops ?? 0, totalSp: r.totalSp ?? 0, reason: r.reason ?? null };
  });

  /* R299/R300 · THE VISIBILITY ARTERY (the shelling incident + owner order
   * 2026-10-14: "יש עוד רשתות שמציגות בבלוקצ'יין של סטימיט בוא נעבוד איתם"):
   * READ-ONLY probing of where the fleet is visible — steemit.com's un-shell
   * meter (R299) + the multi-frontend census (R300: chain truth on 3 nodes +
   * steemitwallet/steemworld/steemdb/steemscan). Wired here because the
   * heartbeat (THIS file) is the persistent executor — the big daily report
   * never ran in CI, which left R299 orphaned (the built-but-not-running
   * pattern R312 warned about). TTL-gated so a 30-min heartbeat stays light:
   * the census re-probes ≤ every 6h, the shell meter ≤ every 90min; fresh
   * state is re-reported honestly with fresh:false. Zero keys, zero
   * broadcast, fail-isolated like every step. */
  report.steps.shellWatch = await stepWrap("shell-watch", async () => {
    const SFILE = path.join(STATE, "shell-status.json");
    const cached = readJson(SFILE, null);
    const ageMin = cached?.at ? (Date.now() - Date.parse(cached.at)) / 60000 : Infinity;
    if (Number.isFinite(ageMin) && ageMin < 90) {
      const s = cached.summary ?? {};
      return { verdict: s.verdict ?? null, shelled: s.shelled ?? null, rendered: s.rendered ?? null, challenged: s.challenged ?? null, fresh: false, ageMin: Math.round(ageMin) };
    }
    const { runShellWatch } = await import("./shell-watch.mjs");
    const out = await runShellWatch({ now, roster: [masterAccount(), ...ARMY_ROSTER] });
    return { verdict: out.summary?.verdict ?? null, shelled: out.summary?.shelled ?? null, rendered: out.summary?.rendered ?? null, challenged: out.summary?.challenged ?? null, fresh: true };
  });

  report.steps.visibility = await stepWrap("visibility", async () => {
    const SFILE = path.join(STATE, "visibility-census.json");
    const cached = readJson(SFILE, null);
    const ageMin = cached?.at ? (Date.now() - Date.parse(cached.at)) / 60000 : Infinity;
    if (Number.isFinite(ageMin) && ageMin < 360) {
      const s = cached.summary ?? {};
      return { verdict: s.verdict ?? null, chain: s.chain ?? null, altRenderedAccounts: s.altRenderedAccounts ?? null, fresh: false, ageMin: Math.round(ageMin) };
    }
    const { runVisibilityCensus } = await import("./fleet-visibility.mjs");
    const out = await runVisibilityCensus({ now, roster: [masterAccount(), ...ARMY_ROSTER] });
    const s = out.summary ?? {};
    return { verdict: s.verdict ?? null, chain: s.chain ?? null, nodes: s.nodes ?? null, steemitShelled: s.steemit?.shelled ?? null, altRenderedAccounts: s.altRenderedAccounts ?? null, judged: s.cells?.judged ?? null, totalCells: s.cells?.total ?? null, fresh: true };
  });

  /* R303 · THE CONTENT-MEMORY HEARTBEAT (T-83, owner order: "לאטום ולתעד
   * לריבונות האוטונומית שלא יאבד בסנדבוקס שלך בשום פנים ואופן"): the weekly
   * aggregate + HEARTBEAT self-audit + runtime→seed merge. TTL-gated 12h
   * like the light steps; the written files ride the state-churn commits,
   * and the seed merge lands the learning into the committed memory-seed/
   * copy — git is the truth, sandbox deaths lose nothing. Read+write only:
   * zero chain, zero broadcast, fail-isolated like every step. */
  report.steps.contentMemory = await stepWrap("content-memory", async () => {
    const SFILE = path.join(STATE, "content-memory-weekly.json");
    const cached = readJson(SFILE, null);
    const ageMin = cached?.generatedAt ? (Date.now() - Date.parse(cached.generatedAt)) / 60000 : Infinity;
    if (Number.isFinite(ageMin) && ageMin < 720) {
      const rejectedSum = Object.values(cached.vetoed ?? {}).reduce((a, b) => a + b, 0);
      return { verdict: "MEMORY-OK", published: cached.published ?? null, rejected: rejectedSum, scoreMean: cached.scoreMean ?? null, fresh: false, ageMin: Math.round(ageMin) };
    }
    const { runWeeklyMemory } = await import("./content-memory.mjs");
    const r = await runWeeklyMemory({ stateDir: STATE, now });
    return { verdict: r.verdict, published: r.published, rejected: r.rejected, scoreMean: r.scoreMean ?? null, topReason: r.topReason ?? null, seedMerged: r.seedMerged, fresh: true };
  });

  /* R304 · THE CONCEPT LADDER (T-84, Open-Pomelli deep-dive, trace
   * 1a138f98b9a80b61): Pomelli's "exactly 4 distinct concepts" made
   * deterministic over the sovereign corpus — slop (R302) → memory (R303)
   * → measured distinctness die BEFORE any draft exists. OBSERVE-ONLY:
   * the shortlist rides the state-churn commits so evidence accumulates
   * in git; enforcement waits for measured heartbeat evidence (R302
   * pattern). Fail-isolated like every step. */
  report.steps.contentConcepts = await stepWrap("content-concepts", async () => {
    const { conceptLadder } = await import("./content-concepts.mjs");
    const { loadMemory } = await import("./content-memory.mjs");
    const { loadDNA } = await import("./content-judge.mjs");
    const corpus = JSON.parse(fs.readFileSync(path.join(DIR, "content-corpus.json"), "utf8"));
    const r = conceptLadder({ corpus, dna: loadDNA(), memory: loadMemory(STATE), goal: "thought_leadership", limit: 4 });
    try {
      fs.writeFileSync(path.join(STATE, "concepts-latest.json"), JSON.stringify({ ...r, generatedAt: now }, null, 2));
    } catch { /* state write never blocks the heartbeat */ }
    return { verdict: r.verdict, generated: r.generated, kept: r.kept, vetoed: r.vetoed, topScore: r.shortlist[0]?.score ?? null, topConcept: r.shortlist[0]?.id ?? null, observe: true };
  });

  /* R305 · THE SOURCING LOOP (exec30, langchain-ai/social-media-agent
   * pattern, measured): the EAR the content rail never had — a READ-ONLY
   * scan of the live network (condenser hot/trending/created over a gentle
   * 6-8 tag set, 15s timeout each, zero keys) scored against the R302 DNA
   * axes, feeding R304's pipeline a candidate QUEUE from outside the fleet
   * (fleet authors + roster-mention posts excluded — the fleet curates the
   * world, never itself). OBSERVE-ONLY: never a gate (R304 pattern); the
   * queue rides the state-churn commits so evidence accumulates in git.
   * TTL-gated 6h like the other light steps so the 30-min pulse stays
   * gentle on the public RPC; a cached beat re-reports honestly with
   * fresh:false. Fail-isolated like every step — an upstream outage yields
   * a SOURCING-DEGRADED receipt, never a broken heartbeat. */
  report.steps.contentSourcing = await stepWrap("content-sourcing", async () => {
    const SFILE = path.join(STATE, "content-candidates.json");
    const cached = readJson(SFILE, null);
    const ttlMin = Number(process.env.SAOS_SOURCING_TTL_MIN ?? 360);
    const ageMin = cached?.at ? (Date.now() - Date.parse(cached.at)) / 60000 : Infinity;
    if (Number.isFinite(ageMin) && ageMin < ttlMin) {
      return { verdict: cached.verdict ?? null, at: cached.at, scanned: cached.scanned ?? 0, kept: cached.kept ?? (cached.candidates ?? []).length, topScore: cached.candidates?.[0]?.score ?? null, fresh: false, ageMin: Math.round(ageMin) };
    }
    const { runSourcing } = await import("./content-sourcing.mjs");
    const r = await runSourcing({ now });
    return { verdict: r.verdict, at: r.at, scanned: r.scanned ?? 0, kept: r.kept ?? 0, topScore: r.candidates?.[0]?.score ?? null, fresh: true };
  });

  /* R306 · THE ENGAGEMENT READ-BACK (exec30, the "what worked" loop — the
   * market-ldr/langchain advantage pattern made sovereignty-native):
   * READ-ONLY measurement of OUR OWN published posts — fleet ledger cache
   * (loadCached, never rebuilt) + chain blog truth (headcorner + ARMY_ROSTER,
   * self-authored roots, last 14 days, cap 40) → get_content per post →
   * votes/replies/payout records + an honest aggregate (median, vote-
   * quartile means, per-tag means — numbers only, no advice text), sealed
   * with a canonical signature into state/content-engagement.json, which
   * rides the state-churn commits. SOCIAL-STANDBY-safe by construction
   * (measuring our own history is observation, not action). OBSERVE-ONLY:
   * never a gate — enforcement waits for measured evidence, exactly like
   * R302. Fail-isolated like every step: a chain error is an honest
   * ENGAGEMENT-DEGRADED receipt, never a broken heartbeat. */
  report.steps.contentEngagement = await stepWrap("content-engagement", async () => {
    const { runEngagement } = await import("./content-engagement.mjs");
    const r = await runEngagement({ stateDir: STATE, now });
    return { verdict: r.verdict, at: r.at, measured: r.measured, medianVotes: r.medianVotes, topTag: r.topTag ?? null, degraded: r.degraded ?? false, observe: true };
  });

  /* R331 · THE SPAWN-MANIFEST HEARTBEAT (exec32, lane 32-a — law provenance
   * exec31 dossier: legion_agi's spawn pattern hardened + Mercury's R332
   * idempotency lifecycle (R332 = exec31's registered law, first registration
   * 2026-10-14T07:55:33Z — NOT the swarm planner, which the 32-b registry
   * repair renumbered to R336 per first-registration-wins law #21)). Every
   * beat derives its OWN typed self-manifest
   * from the REAL step roster (FIXED_ROSTER = the actual stepWrap names of
   * THIS file — the honesty law forbids invented personas), validates it
   * fail-closed (hard caps: ≤8 lanes, fanout ≤8, token budgets bounded,
   * truthful fallback = the lane's own roster entry), walks the R332
   * lifecycle pending→reserved→frozen (a replay returns the frozen receipt,
   * never a re-execution), then scans state/spawn/manifests/*.json and
   * records per-file verdicts. The manifest ledger + the sealed receipt ride
   * the state-churn commits (git-as-memory, auditable pre-spawn forever).
   * OBSERVE-ONLY: spawns nothing, moves no value, touches no key, never
   * gates another step — a discovered invalid manifest is EVIDENCE
   * (invalidCount), and enforcement belongs to the sovereign decider, not
   * to an observe rail. Fail-isolated like every step: exit-0 by design. */
  report.steps.spawnManifest = await stepWrap("spawn-manifest", async () => {
    const { runSpawnManifest } = await import("./spawn-manifest.mjs");
    const r = await runSpawnManifest({ stateDir: STATE, now });
    return { verdict: r.verdict, at: r.at, selfManifestId: r.selfManifestId, selfManifestValid: r.selfManifestValid, lifecycleStatus: r.lifecycleStatus, scanned: r.scanned, invalidCount: r.invalidCount, observe: true };
  });

  /* exec33 · lane 33-a · THE SELF-HEAL SURFACE WATCHTOWER (owner directive,
   * verbatim intent: "no owner arming — sovereignty achieves everything
   * itself; the site fell, got no data, and the sovereignty did NOT
   * self-repair until manual intervention — that is not autonomous. The
   * sovereign must verify activity as required."). Every beat MEASURES the
   * live surfaces instead of assuming them: the Pulse front-door + its three
   * data files (network/lanes/Domain published), the engine state freshness
   * (heartbeat/presence-digest/selftest ages), the public artery's last run
   * (GitHub API), and one cheap chain RPC call. Probes fire CONCURRENTLY
   * with per-target timeouts (SWR — one slow target can never wedge the
   * beat) and every fetched 200 is PARSED + shape-checked, so the
   * raw-200-empty trap reads DEGRADED, never OK. OBSERVE-BY-DEFAULT: the
   * step runs repairMode 'act' ONLY when the PREVIOUS sealed verdict was
   * non-OK (state/surface-watch-latest.json) — the lawful AUTONOMOUS
   * self-heal with no owner arming: repairs are infrastructure/state-only
   * (re-run the owning generator workflow · re-push a Pages content commit ·
   * workflow-dispatch the artery · rotate the public RPC node · escalate
   * with an honest DECISIONS-bound receipt), each followed by an immediate
   * readback re-probe recorded MATCH|MISMATCH. ZERO chain broadcasts, ZERO
   * keys, ZERO value moves — R330/R333 untouched, standby laws untouched.
   * Fail-isolated like every step: exit-0 by design. */
  report.steps.surfaceWatch = await stepWrap("surface-watch", async () => {
    const { runSurfaceWatch } = await import("./surface-watch.mjs");
    const prev = readJson(path.join(STATE, "surface-watch-latest.json"), null);
    const prevVerdict = prev?.verdict ?? null;
    const repairMode = typeof prevVerdict === "string" && prevVerdict.startsWith("SURFACES-") && prevVerdict !== "SURFACES-OK" ? "act" : "observe";
    /* exec37 37-a R355-wiring: triageGate:true arms the R355 triage as the
     * ADVISORY gate on the autonomous self-heal — ENVIRONMENT repairs are
     * withheld (escalation recorded), AMBIGUOUS observe-only this beat,
     * CODE proceeds into the lawful-repair path unchanged; a surface is
     * never dropped (the denominator is constant). */
    const r = await runSurfaceWatch({ stateDir: STATE, now, repairMode, prevVerdict, triageGate: true });
    return { verdict: r.surfaceWatch, at: r.at, targets: r.surfaceTargets, ok: r.surfaceOK, degraded: r.surfaceDegraded, down: r.surfaceDown, repairs: r.surfaceRepairs, repairMode: r.repairMode, sig: r.surfaceSig, triaged: Array.isArray(r.triageGate) ? r.triageGate.length : null, observe: !r.actArmed };
  });

  /* R327 · THE DNA DRIFT REPORT (T-86, queue item #2 of the Open-Pomelli
   * deep-dive, intel §5.2): the brand-analyzer TWO-CHANNEL pattern made
   * sovereignty-native. Channel A = the signed content-dna.json (declared
   * identity); Channel B = what we ACTUALLY published (R303 books first,
   * then READ-ONLY chain get_content over R306's discovered posts — never
   * rebuilding R306's work, only reading its sealed state). The output is a
   * REFRESH PROPOSAL sealed into state/dna-drift-latest.json — applying it
   * is OWNER-GATED by design (the signed file is authoritative). OBSERVE-
   * ONLY, never a gate; fail-honest (a chain outage ⇒ DNA-DRIFT-DEGRADED
   * receipt, never a broken heartbeat); deterministic core (no clock, no
   * randomness). Fail-isolated like every step. */
  report.steps.contentDrift = await stepWrap("content-drift", async () => {
    const { runDrift } = await import("./content-drift.mjs");
    const r = await runDrift({ stateDir: STATE, now });
    const ticTop = (r.ticsEvidence ?? []).filter((e) => e.posts > 0).sort((a, b) => (b.hits - a.hits) || a.phrase.localeCompare(b.phrase))[0] ?? null;
    return { verdict: r.verdict, at: r.at, samples: r.samples, source: r.source ?? null, topPhrase: r.driftPhrases?.[0]?.phrase ?? null, pillarGaps: r.proposal?.pillarGaps?.length ?? 0, ticsObserved: r.ticsObserved ?? null, ticsTopPhrase: ticTop ? `${ticTop.phrase} x${ticTop.hits}/${ticTop.posts}p` : null, refreshOf: r.proposal?.refreshOf?.fromSig ?? null, degraded: r.degraded ?? false, observe: true };
  });

  /* R328 · THE PER-FRONT FORMAT LINT (T-87, queue item #3 of the
   * Open-Pomelli deep-dive, intel §5.3): Pomelli's platforms.ts per-platform
   * copy limits made sovereignty-native over the measured rails — the same
   * drafts queue feeds steem (permlinkStem) AND hive (slugPermlink), and a
   * format violation is found today only AFTER the chain rejects the
   * broadcast. This step lints the live queue through EACH FRONT'S OWN
   * permlink builder (single source of truth, never re-implemented) against
   * measured contracts (title bytes, hive letter-start node contract, tag
   * charset/count after the community prepend, the R244 word floor).
   * OBSERVE-ONLY: enforcement arms only when the signed DNA sets
   * memory.formatEnforce (the R307 pattern); spamgate/R297/R301/R302 keep
   * every gate. Fail-isolated like every step. */
  report.steps.formatLint = await stepWrap("format-lint", async () => {
    const { runLint } = await import("./format-lint.mjs");
    const { loadDNA } = await import("./content-judge.mjs");
    const r = await runLint({ stateDir: STATE, now, dna: loadDNA() });
    return { verdict: r.verdict, at: r.at, drafts: r.drafts, checked: r.checked, violations: r.violations, warnings: r.warnings, source: r.source ?? null, enforce: r.enforce, observe: true };
  });

  /* R336 · THE SWARM DISTRIBUTION PLANNER (T-91, the last open integration
   * module of the T-83 reference batch — Marketing-Swarm-Template's
   * agents.yaml made sovereignty-native): ONE drafts queue feeds TWO live
   * rails that pick INDEPENDENTLY (steem persona-match/FIFO, hive
   * affinity/brevity) — a draft's destination is consumption-order luck,
   * and every uniqueness veto in the house is CHAIN-LOCAL and WINDOWED
   * (the R297 shallow-memory class, unmeasured across chains). This step
   * plans the distribution each beat: deterministic assignment (pinned >
   * persona-in-hive-roster > steem-default), anti-twin splits at plan
   * level (≥0.5 title, honest pigeonhole residue), and the FIRST
   * cross-chain twin scan over published rows (null chain ⇒ steem by
   * documented convention; the R303 book rows are chainUnknown — named,
   * not hidden). OBSERVE-ONLY (the R304 precedent): the plan seals to
   * state/swarm-plan-latest.json and NOTHING else; consumption arms only
   * through the signed DNA knob memory.swarmEnforce (default false, the
   * R307 pattern); spamgate/R297/R301/R302 keep every gate. Fail-isolated
   * like every step. */
  report.steps.contentSwarm = await stepWrap("content-swarm", async () => {
    const { runSwarm } = await import("./content-swarm.mjs");
    const r = await runSwarm({ stateDir: STATE, now });
    const top = (r.twins ?? [])[0] ?? null;
    return {
      verdict: r.verdict, at: r.at, sig: r.signature ?? null,
      drafts: r.stats?.drafts ?? 0, steem: r.stats?.steem ?? 0, hive: r.stats?.hive ?? 0,
      pinned: r.stats?.pinned ?? 0, splits: r.stats?.splits ?? 0,
      pinnedConflicts: r.stats?.pinnedConflicts ?? 0, unresolved: r.stats?.unresolved ?? 0,
      publishedScanned: r.stats?.publishedScanned ?? 0,
      twins: r.stats?.crossChainTwins ?? null, sameChainTwins: r.stats?.sameChainTwins ?? null,
      topTwin: top ? `${top.kind} ${top.sim.toFixed(2)} ${top.aChain}↔${top.bChain}` : null,
      degraded: r.degraded ?? false, observe: true,
    };
  });

  /* exec34 · lane 34-d · THE GIT-AS-MEMORY PORTFOLIO SNAPSHOT (owner's
   * Hyper-Sovereignty directive, second wave): the paper economy remembers
   * itself. Every beat reads the sovereignty's OWN saos-dex ledger
   * (grids.json + ledger.json — R328 lineage, DECISIONS #12/#17), computes
   * DETERMINISTIC asset weights (grid-stack plan notionals + ledger credit
   * entries, 6dp, sum≈1 or fail-closed), composes the signed state doc
   * (surface-watch seal convention, sig:8hex over canonical JSON, identity
   * exec34-engine-lane), writes it ATOMICALLY into
   * state/portfolio-snapshot-latest.json with a parse-back readback (R340),
   * and commits THAT ONE FILE under the house message — the git-as-memory
   * loop the owner approved (commit:true is the DEFAULT, idempotent:
   * byte-identical state skips the commit honestly). Paper/analysis layer
   * ONLY: zero brokers, zero keys, zero broadcasts, zero value movement.
   * Fail-isolated like every step (R339): an honest SNAPSHOT-FAIL receipt,
   * never a broken heartbeat. */
  report.steps.portfolioSnapshot = await stepWrap("portfolio-snapshot", async () => {
    const { runPortfolioSnapshot } = await import("./portfolio-snapshot.mjs");
    const r = await runPortfolioSnapshot({ repoRoot: path.join(DIR, "..", ".."), commit: true });
    if (!r.ok) return { verdict: "SNAPSHOT-FAIL", stage: r.stage ?? null, error: r.error ?? null, observe: true };
    return {
      verdict: r.doc?.verdict ?? null, at: r.doc?.at ?? null, sig: r.doc?.sig ?? null,
      assets: r.doc?.weights?.length ?? 0, top: r.doc?.weights?.[0]?.asset ?? null, topWeight: r.doc?.weights?.[0]?.weight ?? null,
      written: r.write?.written ?? false, committed: r.commit?.committed ?? false, commitReason: r.commit?.reason ?? null,
      observe: true,
    };
  });

  /* exec35 · lane 35-a · THE CABINET SELFPROBE — OBSERVE-ONLY, DEFAULT OFF.
   * The exec35 deterministic cabinet (cabinet.mjs — ai-hedge-fund blueprint
   * on the LOCAL kernel) runs its personas ONLY behind an INJECTED respond
   * seam (R330: the LLM never lives in the deterministic graph and is never
   * imported). HONEST BOUNDARY: without an injected LLM the cabinet does not
   * run in production beats — a heartbeat without SAOS_CABINET_SELFPROBE=1
   * records SKIPPED-OFF and fabricates NOTHING. When the flag IS set, this
   * probe still runs the DETERMINISTIC STUB respond (fixed fixture answers,
   * NOT an LLM) with persist:false — a stub must never write decision-ledger
   * lines (fabricated decisions in state are a dishonesty hazard). Paper/
   * analysis only: zero keys, zero network, zero value, zero broadcasts.
   * Deliberately NOT in spawn-manifest FIXED_ROSTER: it is not a production
   * step (default OFF) and that roster file is outside this lane boundary.
   * Fail-isolated like every step (R339): exit-0 by design. */
  if (process.env.SAOS_CABINET_SELFPROBE === "1") {
    report.steps.cabinetProbe = await stepWrap("cabinet-selfprobe", async () => {
      const { runCabinet, stubRespond } = await import("./cabinet.mjs");
      const r = await runCabinet({ respond: stubRespond, risk: { maxSizing: 0.2 }, repoRoot: path.join(DIR, "..", ".."), persist: false });
      if (!r.ok) return { verdict: "CABINET-FAIL", stage: r.stage ?? null, error: r.error ?? null, observe: true };
      return {
        verdict: r.decision?.verdict ?? null, netConviction: r.decision?.netConviction ?? null,
        sizing: r.decision?.sizing ?? null, abstains: r.receipts?.abstains ?? null,
        clampEvents: r.decision?.clampEvents?.length ?? 0,
        stubOnly: true, observe: true, // DETERMINISTIC STUB — not an LLM; nothing persisted
      };
    });
  } else {
    report.steps.cabinetProbe = { name: "cabinet-selfprobe", verdict: "SKIPPED-OFF", observe: true, note: "SAOS_CABINET_SELFPROBE != 1 — without an injected LLM the cabinet does not run in production beats (R330 seam)" };
  }

  /* exec37 · lane 37-a · SELFTEST LEASE BEAT (G1 — R353 wiring; runs BEFORE
   * the evidence probe below so the probe reads THIS beat's evidence).
   * The selftest-execution critical section (run selftest.mjs — the suite
   * itself writes the verdict + runId-bound marker atomically, R354 — is now
   * wrapped in withLease with the REGISTERED purpose "ci-selftest"
   * (PURPOSE_ALLOWLIST in gate-lease.mjs; an unregistered purpose can never
   * hold the gate). Lease dir under the engine state convention: state/lease.
   * CONTENTION IS NOT A FAILURE (R339 SKIP-NOT-FAIL): a not-granted beat
   * records {skipped:true, holder} HONESTLY and does NOT run the suite this
   * beat — the next beat verifies. Release is owner-checked in withLease's
   * finally (R340 readback). Fail-isolated like every step; exit-0 by
   * design — the blocking gate stays the workflow's own selftest step. */
  /* P0-FAILCLOSE: the selftest-lease step was HOISTED above the money lanes
   * (dex-takeover / delegation-rail) and now GATES them via moneyGateOpen().
   * Its original position here — after the money lanes, observe-only,
   * exit-0-by-design — was the measured fail-open hole (beat
   * 2026-10-17T00:25:30Z: money moved while SELFTEST-RAN-RED). The hoisted
   * block near the top of main() is the single authoritative run. */

  /* exec36 · lane 36-a · SELFTEST EVIDENCE PROBE — OBSERVE-ONLY (R339
   * fail-isolated). Runs verifySelftestEvidence (evidence.mjs — the R354
   * candidate, SWE-bench SUITE_RAN pattern harvested via 33-b) against the
   * CURRENT engine state files (selftest-last-run.json +
   * selftest-run-marker.json) and records the classification in the cycle
   * summary. Fail-closed law: only SUITE-RAN is green; NO-MARKER /
   * RUNID-MISMATCH / NOT-RAN / FAIL-RECORDED are recorded honestly and the
   * heartbeat NEVER blocks on them (exit-0 by design). HONEST BOUNDARY:
   * this probe does not RUN the selftest and gates nothing yet — wiring the
   * verification gate to hold the exec36 gate-lease (R353 candidate) is a
   * recorded future beat. */
  report.steps.selftestEvidence = await stepWrap("selftest-evidence", async () => {
    const { verifySelftestEvidence } = await import("./evidence.mjs");
    const r = verifySelftestEvidence({});
    return { verdict: r.evidence, honest: r.honest, observe: true };
  });

  /* CI session ledger — the machine-independent life of the organ, appended
   * every heartbeat, committed back into the private tree. */
  try {
    appendLine(path.join(STATE, "ci-sessions.jsonl"), {
      at: now, verdict: report.steps.social?.verdict ?? null,
      executed: report.steps.social?.executed ?? 0,
      custodyVerified: report.steps.custody?.verified ?? null,
      draftsQueued: report.steps.content?.draftsQueued ?? 0,
    });
  } catch { /* ledger never blocks the heartbeat */ }

  const summary = {
    at: now,
    custody: `${report.steps.custody?.verified ?? "?"}/${report.steps.custody?.total ?? "?"}`,
    social: report.steps.social?.verdict ?? "STEP-FAIL",
    socialExecuted: report.steps.social?.executed ?? 0,
    /* G69 · measured-refusal honesty: the flat canonical heartbeat
     * (saos-runtime state/beat/ci-last-heartbeat.json) carries whatever this
     * summary emits — without this field the watchdog's socialRefused fact
     * measured permanent null (absence confused with zero). */
    socialRefused: report.steps.social?.refused ?? 0,
    content: report.steps.content?.verdict ?? "STEP-FAIL",
    contentSource: report.steps.content?.source ?? null,
    conceptAlignMode: report.steps.content?.conceptAlignMode ?? null,
    conceptAlignAvailable: report.steps.content?.conceptAlignAvailable ?? null,
    conceptAlignAligned: report.steps.content?.conceptAlignAligned ?? null,
    conceptAlignTop: report.steps.content?.conceptAlignTop ?? null,
    post: report.steps.post?.verdict ?? "STEP-FAIL",
    postAccount: report.steps.post?.account ?? null,
    postPermlink: report.steps.post?.permlink ?? null,
    dex: report.steps.dex?.verdict ?? "STEP-FAIL",
    dexReason: report.steps.dex?.reason ?? null,
    digest: report.steps.digest?.verdict ?? "STEP-FAIL",
    digestTitle: report.steps.digest?.title ?? null,
    blurt: report.steps.blurt?.verdict ?? "STEP-FAIL",
    blurtLive: report.steps.blurt?.live ?? null,
    shellWatch: report.steps.shellWatch?.verdict ?? "STEP-FAIL",
    shelled: report.steps.shellWatch?.shelled ?? null,
    visibility: report.steps.visibility?.verdict ?? "STEP-FAIL",
    visibilityChain: report.steps.visibility?.chain ?? null,
    visibilityAltRendered: report.steps.visibility?.altRenderedAccounts ?? null,
    delegation: report.steps.delegation?.verdict ?? "STEP-FAIL",
    delegationOps: report.steps.delegation?.ops ?? 0,
    delegationSp: report.steps.delegation?.totalSp ?? 0,
    contentMemory: report.steps.contentMemory?.verdict ?? "STEP-FAIL",
    dnaDrift: report.steps.contentDrift?.verdict ?? "STEP-FAIL",
    dnaDriftSamples: report.steps.contentDrift?.samples ?? null,
    dnaDriftSource: report.steps.contentDrift?.source ?? null,
    dnaDriftTop: report.steps.contentDrift?.topPhrase ?? null,
    dnaDriftTicsObserved: report.steps.contentDrift?.ticsObserved ?? null,
    dnaDriftTicsTop: report.steps.contentDrift?.ticsTopPhrase ?? null,
    dnaDriftRefreshOf: report.steps.contentDrift?.refreshOf ?? null,
    formatLint: report.steps.formatLint?.verdict ?? "STEP-FAIL",
    formatLintChecked: report.steps.formatLint?.checked ?? null,
    formatLintViolations: report.steps.formatLint?.violations ?? null,
    formatLintEnforce: report.steps.formatLint?.enforce ?? null,
    swarm: report.steps.contentSwarm?.verdict ?? "STEP-FAIL",
    swarmDrafts: report.steps.contentSwarm?.drafts ?? null,
    swarmSteem: report.steps.contentSwarm?.steem ?? null,
    swarmHive: report.steps.contentSwarm?.hive ?? null,
    swarmSplits: report.steps.contentSwarm?.splits ?? null,
    swarmTwins: report.steps.contentSwarm?.twins ?? null,
    swarmTopTwin: report.steps.contentSwarm?.topTwin ?? null,
    swarmSig: report.steps.contentSwarm?.sig ?? null,
    contentMemoryPatterns: report.steps.contentMemory?.published ?? null,
    contentMemoryScore: report.steps.contentMemory?.scoreMean ?? null,
    contentConcepts: report.steps.contentConcepts?.verdict ?? "STEP-FAIL",
    contentConceptsTop: report.steps.contentConcepts?.topConcept ?? null,
    /* R305 sourcing loop — the one-line digest (at/scanned/kept/topScore). */
    contentSourcing: {
      at: report.steps.contentSourcing?.at ?? null,
      scanned: report.steps.contentSourcing?.scanned ?? 0,
      kept: report.steps.contentSourcing?.kept ?? 0,
      topScore: report.steps.contentSourcing?.topScore ?? null,
      verdict: report.steps.contentSourcing?.verdict ?? "STEP-FAIL",
    },
    /* R331 spawn-manifest — the one-line self-audit digest (id/valid/lifecycle
     * + the spawn-ledger scan counts). OBSERVE-ONLY by law. */
    spawnManifest: {
      verdict: report.steps.spawnManifest?.verdict ?? "STEP-FAIL",
      selfManifestId: report.steps.spawnManifest?.selfManifestId ?? null,
      selfManifestValid: report.steps.spawnManifest?.selfManifestValid ?? null,
      lifecycleStatus: report.steps.spawnManifest?.lifecycleStatus ?? null,
      scanned: report.steps.spawnManifest?.scanned ?? 0,
      invalidCount: report.steps.spawnManifest?.invalidCount ?? 0,
    },
    /* exec33 surface-watch — the one-line live-surface digest: verdict +
     * target counts; surfaceRepairs > 0 means the PREVIOUS verdict was
     * non-OK and the lawful autonomous self-heal executed (readbacks sealed
     * in state/surface-watch-latest.json). */
    surfaceWatch: report.steps.surfaceWatch?.verdict ?? "STEP-FAIL",
    surfaceTargets: report.steps.surfaceWatch?.targets ?? null,
    surfaceOK: report.steps.surfaceWatch?.ok ?? null,
    surfaceDegraded: report.steps.surfaceWatch?.degraded ?? null,
    surfaceDown: report.steps.surfaceWatch?.down ?? null,
    surfaceRepairs: report.steps.surfaceWatch?.repairs ?? 0,
    surfaceRepairMode: report.steps.surfaceWatch?.repairMode ?? null,
    surfaceSig: report.steps.surfaceWatch?.sig ?? null,
    /* exec34 34-d portfolio snapshot — the one-line paper-economy digest
     * (verdict/top asset/weights count + the git-as-memory commit receipt). */
    portfolioSnapshot: report.steps.portfolioSnapshot?.verdict ?? "STEP-FAIL",
    portfolioSig: report.steps.portfolioSnapshot?.sig ?? null,
    portfolioAssets: report.steps.portfolioSnapshot?.assets ?? null,
    portfolioTop: report.steps.portfolioSnapshot?.top ?? null,
    portfolioTopWeight: report.steps.portfolioSnapshot?.topWeight ?? null,
    portfolioCommitted: report.steps.portfolioSnapshot?.committed ?? null,
    /* exec35 35-a cabinet self-probe — observe-only, DEFAULT OFF (honest:
     * without an injected LLM the cabinet does not run in production beats;
     * SKIPPED-OFF is the honest default receipt). */
    cabinetProbe: report.steps.cabinetProbe?.verdict ?? "STEP-FAIL",
    cabinetNetConviction: report.steps.cabinetProbe?.netConviction ?? null,
    cabinetSizing: report.steps.cabinetProbe?.sizing ?? null,
    cabinetAbstains: report.steps.cabinetProbe?.abstains ?? null,
    cabinetClamps: report.steps.cabinetProbe?.clampEvents ?? null,
    /* exec36 36-a selftest execution-evidence — observe-only fail-closed
     * probe over the current marker+verdict pair (SUITE-RAN = green is
     * justified; anything else = NO-EVIDENCE recorded honestly). */
    selftestEvidence: report.steps.selftestEvidence?.verdict ?? "STEP-FAIL",
    selftestEvidenceHonest: report.steps.selftestEvidence?.honest ?? null,
    /* exec37 37-a R353-wiring — the lease-held selftest beat receipt
     * (SELFTEST-RAN-GREEN | SELFTEST-RAN-RED | SELFTEST-RUN-TIMEOUT |
     * SELFTEST-SKIPPED-CONTENTION with the holder recorded honestly). */
    selftestLease: report.steps.selftestLease?.verdict ?? "STEP-FAIL",
    selftestLeaseDetail: report.steps.selftestLease?.detail ?? null,
    selftestLeaseHolder: report.steps.selftestLease?.holder ?? null,
    selftestLeaseExit: report.steps.selftestLease?.exitCode ?? null,
    /* R306 engagement read-back — the one-line "what worked" digest
     * (at/measured/medianVotes/topTag; numbers only, no advice). */
    contentEngagement: {
      at: report.steps.contentEngagement?.at ?? null,
      measured: report.steps.contentEngagement?.measured ?? null,
      medianVotes: report.steps.contentEngagement?.medianVotes ?? null,
      topTag: report.steps.contentEngagement?.topTag ?? null,
      verdict: report.steps.contentEngagement?.verdict ?? "STEP-FAIL",
    },
  };
  console.log("CI-HEARTBEAT " + JSON.stringify(summary));
  fs.writeFileSync(path.join(STATE, "ci-last-heartbeat.json"), JSON.stringify({ ...summary, report }, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error("CI-HEARTBEAT-FAIL", String(e?.message ?? e)); process.exit(1); });
