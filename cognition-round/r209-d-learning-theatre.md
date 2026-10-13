# R209-d · LEARNING THEATRE & LOAD-BEARING AUDIT (falsification round)

Agent: R209-d, adversary lens. Re-anchored 2026-10-05T16:40–16:55Z, live engine PID 15086 (bun --hot, restarted ~16:44 — 4th PID this round: 6127→11694→15086), cockpit :3000, engine :3040.
Method: read-only. Code read end-to-end (adaptations.mjs, signer.mjs executeAs path, learning.mjs, daily.mjs, lib.mjs cycleHealth, index.ts, src/app/api/saos/*, src/lib/sovereign.ts), live state read (adaptations.json sealed+intact, cycle-run.json 16:45:26Z fresh, daily-report.json 16:44:48Z, events.jsonl census, exec-log tail), live HTTP GET /exec-status + /status, grep census over engine + cockpit src. Zero writes to engine state.

Live pre-firing state at census time: adaptation ACTIVE (attempts 0, born 15:01:50.115Z, TTL 2026-10-07T15:01:50.115Z), evalCount 10, integrity seal verified by engine; exec-log last row 13:05:28Z (claim fail); **0 role-bearing exec rows, 0 prediction.recorded events, 0 adaptation.verified** — the firing is still chain-scheduled (pending rewards zero).

---

## 1 · THEATRE CENSUS v2 — writer→reader per signal

Legend: **LOAD-BEARING** = a reader whose behavior changes because of the signal · DISPLAY = human-visible, no branch · THEATRE = writer without any reader.

| # | Signal | Writer(s) | Reader(s) | Verdict |
|---|--------|-----------|-----------|---------|
| 1 | **adaptations.json store** (adaptation objects) | planAdaptations via evaluateAdaptations (learning step, 1/cycle; adaptations.mjs:332-346), noteAdaptationOutcome on ROLE-KEY-ABSENT (:286-298) | `resolveAdaptedRole` at the single broadcast choke point (signer.mjs:654 → adaptations.mjs:266-280) + planAdaptations itself next eval | **LOAD-BEARING** — the only T-84 signal with a behavior-changing consumer |
| 2 | **exec-log `role` field** per broadcast row | signer.mjs appendLine (:670-677, `role: part.role`) | planAdaptations rowRole/scoring (adaptations.mjs:55,100,110,179) + raw display in /status execLog→proxy execution.log | **LOAD-BEARING** (attribution artifact) |
| 3 | adaptation.proposed / .retired / .superseded / .declined events | adaptations.mjs appendEvent | cockpit event-log display only (index.ts /status last-20 events → route.ts:198 → page.tsx:948 generic badge+4-scalars render); learning.mjs:248 reads events.jsonl into an **unused variable** (dead read, persists since T-83) | DISPLAY only; no branch anywhere |
| 4 | **prediction.recorded** (R209 pre-action prediction) | recordPrediction via signer.mjs:671 before every adapted partition | **NONE.** Zero in-machine consumers. The predictionScore in adaptation.verified is recomputed by planAdaptations from exec rows — the journal prediction is never read back. 0 rows exist so far (never fired) | **THEATRE** (writer-without-reader; evidentiary value is for an *external* auditor only) |
| 5 | **predictionClass labels** (CONFIRMED/CONTRADICTED/UNRESOLVED) | adaptation.* events | none | **THEATRE** |
| 6 | **belief objects** (before/evidence/after/why) | adaptation.verified event payload | none programmatically; the cockpit event renderer **filters out non-scalar fields** (page.tsx:951 `typeof v !== 'object'`) so belief isn't even displayed | **THEATRE** |
| 7 | **contradiction RESOLVED transitions** | planAdaptations mutates `contradictions[]` inside sealed adaptations.json (:121-123); opening emits `contradiction.opened`, **resolution emits NO event at all** | **NONE.** grep: no consumer of contradictions[] outside adaptations.mjs/selftest; not exposed on any endpoint; not in learning.json | **PUREST THEATRE IN THE NEW LOOP** — self-model mutation, no journal entry, no reader |
| 8 | **layers.adaptive/.effective/.alive/.safe/.operational** (cycle-run.json:638-647) | daily.mjs stepWrap | **NONE.** hypergrid.mjs:233 reads `marker.running` (single-flight); lib.mjs classifyMarker (:452-459) reads health; sovereign.ts watchdog reads running/health/ms/step-count via /cycle-status (:285-390); cockpit proxy autonomy passes steps ok/skip/fail but **drops layers** (route.ts:117-127); page.tsx has zero matches for layers/adaptive | **THEATRE** — T-84 wrote honest layers into an already-unread file |
| 9 | **learning.json `adaptations` summary** (`active:["adapt-claim_reward_balance-posting"]`) | runLearning out.adaptations + learn.done event (learning.mjs:288,299-301) | daily.mjs:645 feeds layers.adaptive (itself unread, see #8); **cockpit proxy learningPublic drops the field entirely** (route.ts:142-158: verdict/at/runsTotal/lessons/tuningsApplied/tunings/lessonsTotal/cycleMetrics — no adaptations) | written → counted into a decorative layer → dropped by UI. Effectively THEATRE |
| 10 | **confidence field (0.5/0.8)** | set once at proposal (adaptations.mjs:216) | copied into prediction.recorded (:322), printed in verified belief (:116). **Never updated — no decrease path exists** | static decoration |
| 11 | contradiction.opened events | planAdaptations :233 | cockpit display only | DISPLAY |

**VERIFIED-vs-ACTIVE consumer delta (the mission's sharp question).** After the future VERIFIED flip, which consumer behaves differently? Full inventory:
- resolveAdaptedRoleFrom (:272): VERIFIED is **TTL-immortal** (`state==="VERIFIED" ||` ACTIVE-within-TTL; selftest:817 pins it) — lifetime change only, the resolved role is identical (posting either way);
- planAdaptations: VERIFIED is **excluded from outcome scoring** (`if (a.state !== "ACTIVE") continue`, :104) and **blocks re-proposal** (:175);
- layers.adaptive counts ACTIVE+VERIFIED identically (daily.mjs:645);
- recordPrediction matches VERIFIED identically (:310) — predictions keep being recorded;
- cockpit, daily-report surfaces, exec-status, /health, watchdog: **all VERIFIED-blind** (execStatus() in signer.mjs:524-550 exposes no adaptation state at all — the live API cannot answer "why is this signed with posting?").

So the only VERIFIED-exclusive semantics are **immunities**: never expires, never re-scored, never re-proposed. No consumer anywhere treats VERIFIED as *stronger* evidence; exactly one code path treats it as *untouchable* — and that path is the revision path. See §2.

---

## 2 · OPPOSITE-OUTCOME TEST (mission §X) — can the belief go DOWN?

### Paths that are REAL (while ACTIVE) — verified in code:
1. **Contradictory outcome → attempts++ → RETIRED at 3** (adaptations.mjs:125-150). ✓
2. **Chain names a DIFFERENT authority → superseded**: hypothesis rewritten, toRole updated, CONTRADICTED event (:130-137). This is genuine belief revision, sharper hypothesis, bounded. ✓
3. **Deterministic new failure class (config) → immediate RETIRED** (:139-143). ✓
4. **TTL 48h → RETIRED ttl-unverified** (:153-157). ✓
5. **ROLE-KEY-ABSENT → immediate retire, now incl. VERIFIED** (noteAdaptationOutcome :286-298; L-1a F1 fix confirmed present). ✓
6. **RETIRED → re-proposal from fresh evidence**: the existing-check skips only ACTIVE/VERIFIED (:175), so RETIRED allows a new proposal; resolver falls back to baseRole the moment no ACTIVE/VERIFIED matches (:272-273) → the rail returns to the safe baseline automatically. ✓ (verified by code read; matches L-1d's lab result)
7. No path to owner: blocked at proposal (:185), at resolve (:277), and noteAdaptationOutcome can only retire. ✓
8. Cosmetic wart: DECLINED→ACTIVE "promotion" is actually a **duplicate-id second entry** (same `adapt-{op}-{role}` id pushed at :211 while the DECLINED one stays) — functionally fine (find() picks the ACTIVE one), epistemically messy.

### Paths that are MISSING — the falsification findings:
- **VERIFIED + contradictory broadcast evidence = NO PATH DOWNWARD.** The scoring loop processes ACTIVE only (:104); a posting-signed claim failure after VERIFIED increments nothing, supersedes nothing, retires nothing. Re-proposal is suppressed while VERIFIED exists (:175). The contradiction cannot reopen: `if (!c)` (:231) skips when `rail:claim_reward_balance` already exists as RESOLVED — **RESOLVED is terminal**. If the chain's authority contract changes after verification (hard fork, operator moves claim rights), the machine re-signs posting **forever**, fails forever, `cycleHealth` stays **ok** (the execute step never sets `ok:false` on BROADCAST-FAIL — daily.mjs:412 returns verdict/error only; lib.mjs:319-325 counts only `s.ok === false` — the exact T-83 green-lie mechanism, unchanged), `layers.effective:false` is written and read by nobody, and the self-model says the rail is RESOLVED.
- **The code's own self-description is falsified by its code.** adaptations.mjs:50-53: *"SELF-CORRECTING: if a rail ever changes role, the inference produces an adaptation that fails under the learned role → bounded retire within 3 attempts — the loop itself catches the wrong lesson."* True for ACTIVE; **false for VERIFIED**, i.e. false for the permanent end-state every lesson converges to. Same overpromise in recordPrediction's `failureModeIfWrong` string (:320) — journaled as a prediction that the code will not honor post-verification.
- **Confidence never decreases.** Set once (0.5 at <4 evidence rows, 0.8 at ≥4; :216), never lowered on any contradiction, attempt, or retry. There is no graded belief strength in the system — beliefs are direction-arrows with a fixed initial magnitude.

**Verdict: opposite-outcome revision is REAL for ACTIVE (bounded, journaled, re-proposable, baseline-safe) and ABSENT for VERIFIED.** VERIFIED is a one-way ratchet: the only key that can remove it is physical key-loss (ROLE-KEY-ABSENT), not evidence. The architecture supports belief revision downward exactly up to the state it is supposed to reach — then bolts the door.

*(Bounded-harm footnote: the post-VERIFIED re-break fails safe in authority terms — same credential, same gates, failures visible in exec-log — but it is epistemically unbounded: an un-revisable "verified" belief plus a green health layer plus a RESOLVED self-model equals a machine that cannot notice its own regression on this rail.)*

---

## 3 · FUTURE-DECISION CHANGE PROOF (Nth-decision attribution)

What makes the days-later claim (2nd, 3rd, Nth) attributable to the lesson rather than to static code:
1. **exec-log `role` field per row** (signer.mjs:670-677) — every adapted partition is journaled with `role:"posting"`, Nth firing included. This is the primary attributable artifact and it persists for VERIFIED (resolveAdaptedRoleFrom matches VERIFIED).
2. **prediction.recorded per firing** (signer.mjs:671; recordPrediction matches VERIFIED too — adaptations.mjs:310) — pinned pre-broadcast with adaptationId, adaptationState, hypothesis, confidence. Fires for the Nth decision as long as `part.role !== baseRole`.
3. The sealed store keeps the verified lesson + evidence txids as the standing justification.

So YES — the observable future decision (signing under posting) is distinguishable from "static code" by per-row artifacts. **But two attribution gaps:**
- **Post-VERIFIED predictions are never scored.** No CONFIRMED classification is ever computed for Nth firings (scorer skips VERIFIED, :104). The stream of predictions after the flip is recorded and never folded back — and the one scenario where ongoing scoring matters (a post-verification failure) is exactly the one the scorer ignores (see §2).
- **The runtime API cannot explain its own behavior.** exec-status (/exec-status, the cockpit's authority surface) exposes zero adaptation fields; a human asking the live system "why posting?" gets an answer only by reading raw execLog rows in /status or the state file. The explanation exists in state, not in any served surface.

---

## 4 · THEATRE REGRESSION — did T-84 fix the old theatres?

**No. T-84 added new signals NEXT TO the old theatres.** Measured live today:

| Old theatre (T-83/C-1e finding) | Status now |
|---|---|
| learn.done `tunings:[]` fake learning | **INTACT — 175/175 learn.done events have `tunings:[]`** (census re-run; the tunings rail writer deriveTunings → reader learningTunings() → curator merge is a working pipeline carrying permanent zero). The new `adaptations` field was added beside it (11 events non-empty since 15:54). |
| think-log zero readers | **INTACT.** Writer signer.mjs:38,56; zero readers in engine AND cockpit src (grep verified). 700+ verdict rows unread. |
| cycle-run.json layers decorative | **INTACT.** Zero branch readers (see census #8). T-84 added `adaptive`/`effective` INTO the unread file. The watchdog still keys on hardcoded `/health ok:true` (index.ts:45; sovereign.ts:92) — liveness only. |
| learning.mjs events dead-read | **INTACT** (learning.mjs:248, variable `events` read and never used). |
| cockpit /api/saos/signer reads dead /home/z/audit path | **INTACT** (route.ts still points at /home/z/audit/saos-dex/grids/state/mover-log.jsonl — permanently "לא-זמין"). |
| content-ops WISH rail | **INTACT** (DRAFTS-QUEUED at 10:34Z today, 3 drafts, no broadcaster). |
| /health hardcoded ok:true+keyless:false | **INTACT** (index.ts:45). |
| promo "Soldier fleet deploying" fossil | **IMPROVED** — promo.mjs:42 now branches on intel `grids-live` decision instead of the static fossil (whether the underlying soldiers signal is chain-true is outside this lens). |

The one genuinely load-bearing pair remains what R-0/L-1b found: **adaptations.json ↔ resolveAdaptedRole at the single broadcast choke point** (signer.mjs:654). Everything else the new loop emits (predictions, classes, beliefs, resolved-contradictions, layers, learning.json summary) has at best a display reader and at worst none.

---

## 5 · THE SINGLE MOST LOAD-BEARING GAP

**If verdict A is "causal learning proven", the gap that lets an independent reviewer call it embellished is: the VERIFIED one-way ratchet — the system's only irreversible belief.**

The proof plan for A is: fire → VERIFIED → stay posting → next claim attributable. But VERIFIED is precisely the state where every revision path closes: not scored (:104), not re-proposable (:175), contradiction terminally RESOLVED (:231, no reopen, and no journal event is even emitted on resolution), confidence frozen, health still green on re-break, `layers.effective:false` written to a file nobody reads. The code comments and the journaled `failureModeIfWrong` promise "bounded retire within 3 attempts — the loop itself catches the wrong lesson" for a state where the loop has deleted its own catch. An independent reviewer's one-line kill: *"you demonstrated one directed edge of learning (ACTIVE→VERIFIED) and then froze the belief; the organism can acquire a reflex but cannot revise or discard it — that's conditioning with a saved file, not cognition."*

Runner-up (would each independently downgrade the claim): (a) contradiction RESOLVED transitions are the purest theatre in the new loop — mutated in sealed state, no event, no reader; (b) the machine's honest self-critique signals (layers.effective, contradiction OPEN) all have zero machine readers, so the self-model's only consumed signals are green ones.

**Minimal honest fix (proposal only, nothing written):** in planAdaptations step 1, score VERIFIED adaptations for posting-signed failure rows with the same bounded ledger as ACTIVE (attempts++ → supersede on chain-named authority → RETIRED on deterministic class/attempts-exhausted), emit `contradiction.reopened`/`contradiction.resolved` journal events, and let a re-proposal replace a retired VERIFIED. That single change converts the ratchet into the revision loop §X demands and makes the existing prediction.recorded stream load-bearing for Nth firings.

---

## RETURN ANSWERS (compressed)

1. **Signals still theatre (writer-without-reader):** prediction.recorded (0 rows yet, 0 consumers by design); predictionClass labels; belief objects (filtered out even by the cockpit renderer); contradiction RESOLVED transitions (no event, no reader — purest theatre); cycle-run.json layers incl. layers.adaptive/effective (hypergrid/classifyMarker/watchdog/proxy all read around them); learning.json adaptations summary (dropped by cockpit proxy, feeds only the unread layer); confidence field (never updated). Display-only (not branch-readers): adaptation.* events + contradiction.opened via the cockpit event log. Load-bearing: adaptations.json store and the exec-log role field.
2. **Opposite-outcome revision paths real? YES for ACTIVE — code-proven** (attempts++→RETIRED@3 :125-150; chain-named supersede :130-137; config-class retire :139-143; TTL :153-157; ROLE-KEY-ABSENT incl. VERIFIED :286-298; RETIRED→re-proposal since the existing-check skips only ACTIVE/VERIFIED :175; auto-fallback to baseRole :272-273). **NO for VERIFIED** — the one-way ratchet (no evidence-based downward path; only key-loss). Confidence never decreases anywhere. Self-description at adaptations.mjs:50-53 and :320 is falsified by the code for the VERIFIED state.
3. **Future-decision attribution gap:** the Nth decision IS attributable (role-tagged exec row + prediction.recorded per firing, both VERIFIED-aware) — but post-VERIFIED predictions are never scored (no CONFIRMED for Nth firings), and no served surface (/exec-status, /status) exposes the adaptation state that explains the behavior; attribution lives in files an external auditor reads, not in anything the machine or operator UI surfaces.
4. **Single most load-bearing gap for verdict A:** the VERIFIED ratchet (§5) — an un-revisable "verified" belief riding on a health layer that still reports ok through broadcast failures, with the self-model contradiction permanently RESOLVED. Fix is small and local (score VERIFIED like ACTIVE + journal resolution transitions); until then, verdict A should stay B: one verified reflex ≠ proven learning.

*Report ends. No engine state was modified; all reads were GET-only; PID 15086 alive at census close.*
