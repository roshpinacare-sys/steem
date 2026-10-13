# R211-R212-GIT-SOVEREIGNTY — Master Audit Report

**Mandate**: Does the repository currently provide a trustworthy, reconstructible, single source of truth for the organism — and if not, exactly where does sovereignty break?
**Executed**: 2026-10-05, 20:10–20:55Z, by the SAOS cockpit orchestrator + 4 completed falsifier agents (A/B/D/E; C deadline-failed, task completed by orchestrator per its procedure).
**Method**: epistemic reset (§I) — every prior claim treated as evidence only; re-established by direct observation (local git, GitHub API, raw content fetches, two independent clones, empirical capability tests on an isolated branch).

---

## Verdict

| Dimension | Result |
|---|---|
| **Verdict class (§XXIX)** | **B — SOVEREIGNTY PARTIAL** |
| **Memory class (§XXXI)** | **CONTESTED MEMORY** |
| **Multi-writer level (§XXVI)** | **3** (capability-based; Agent E dissent → 2, recorded) |
| **Security (§XIV)** | **CLEAN** — 0 real secrets anywhere (dual independent scans) |
| **Recovery (§XVII/§XVIII)** | **PROVEN** — T-84 (2 methods) + current state (clone+deps) |
| **F override** | not triggered — no secret exposed, no capital/signing change, no destructive rewrite |

**Where sovereignty breaks — precisely**: at the WRITE BOUNDARY. Not at recovery (proven), not at history (complete, T-84 byte-preserved), not at secrets (clean). Four verified breaks: (1) one shared GitHub account fronts ≥3 machine lineages + ~17 bots → push identity unattributable; (2) all checked branches protected=false with force-push EMPIRICALLY PROVEN → any PAT holder can silently redefine canonical state; (3) the live body has no remote/upstream → divergence invisible locally; (4) commit identity (author string) is forgeable and ≠ push identity ≠ authority identity.

## Chain-of-custody answer (§II)

**If the live organism died NOW**: an independent process holding the credential reconstructs the organism to the last push (927c7a5, 20:04:23Z) + the last local commit ONLY if it has this disk (4ef4448 is unpushed). It would know WHICH sandbox was authoritative via the lineage itself (927c7a5 descends from both, tree = current generation's adaptation.mjs naming). Reconstruction is proven — but the LAST minutes of cognitive state always live only on disk. **Repository sovereignty is therefore INCOMPLETE but REAL: recoverable, attributable-within-lineage, history-preserving — yet not single-source (two live branches on one repo) and not write-governed.**

## Key facts (all OBSERVED, with method)

1. **Remote tip verified**: steem@saos-cockpit = 927c7a5 (20:04:23Z), parents [a9156a9, e4cdfd6], 5 key files byte-identical remote↔local-pushed-commit (worklog 159,036B; adaptation.json 1,715B; TODO 2,929B; page.tsx 73,240B; ESTATE-INVENTORY 5,708B).
2. **T-84 preserved**: e4cdfd6 tree 5683bd2833c1 unchanged; worklog 206,976B + sealed adaptations.json 2,929B match across GitHub-raw, backup clone, and recovery archive (3-way). Reachable as 2nd parent. No force-push ever touched the branch.
3. **Graph forensics**: single shared root 48d7b0e; merge-base(a9156a9, e4cdfd6) = 815eb2d → **R212's "unrelated histories" claim REFUTED and corrected** (the `-s ours` merge itself was correct — tree identity proven). Amends: 10 events/8 logical commits, all superseded variants, no canonical tip rewritten. 3 dangling objects, all harmless.
4. **Writers (§VIII/§IX)**: W1 this sandbox (z@container), W2 T-84 (saos@cockpit.local, dead), W3 R30-lineage (cognition@saos.local, **wrote steem@main DURING the audit**, + unresolved ref-activity 20:40:52Z), W4 money-mover (roshpinacare@gmail.com), W5 fleet ticks, W6 ~17 CI bots. ALL pushes = actor `roshpinacare-sys`. **MULTI-WRITER.**
5. **Split-brain (§X) — empirical**: on an isolated branch (created, tested, deleted): divergent non-FF push → REJECTED (visible); force-push → SUCCEEDED. Non-force concurrency is safe; force is not.
6. **Force capability (§XI)**: exists for every PAT holder on every checked branch (protection=false, live-verified twice). Documented; NEVER practiced on canonical history.
7. **Secrets (§XIV/§XV)**: dual independent scans — 0 real secrets in tree (1,348 files), 72-commit history, T-84 content, pushed worklog; .env = DATABASE_URL only; credentials confined to git-ignored .secrets/ (PAT + headcorner WIF, both mode 600). Org-level pre-existing flag: operator's password-adjacent vault docs on steem@main (not our introduction).
8. **State matrix (§VII/§XIX)**: zero UNEXPLAINED divergences across LIVE/DISK/GIT/REMOTE/RECOVERY — everything is classified expected-mutation, push-lag, or by-design disk-only.
9. **Worklog integrity (§XX)**: append-only verified (0 removed lines across 3 hops); every R211/R212 Git claim independently verified; 1 wording correction (above), logged rather than hidden.
10. **Canonicality (§XXI/§XXII)**: repo steem = de facto; branch saos-cockpit = de facto for the cockpit, but steem@main simultaneously carries W3's live R30 truth → **canonicality contested, WRITER GOVERNANCE UNDEFINED** (no policy found; none invented).

## Live event during the audit (§VII)

**20:32:44Z — custody restoration**: `.secrets/headcorner.key` appeared on disk; engine verified the credential (credentialAccount=headcorner, foreignCredential=false, fingerprint **c056922c** — the same chain-verified posting credential as the T-84 era), verdict VERIFIED, signing ARMED. Provenance: no writer-registry entry claims it; most plausible = the operator (cockpit paste / drop), consistent with his evening activity. This closes R210/R211's operator-gated blocker #1 (signing) — the organism can now fire its first posting-signed claim when the chain next drips pending rewards. Git-audit impact: none (credential is by-design outside Git).

## Answers to the final sovereign questions (§XXX) — compact

1. Canonical repo? **roshpinacare-sys/steem** (de facto, undeclared). 2. Canonical branch? **saos-cockpit** (de facto; contested by main). 3. Commit representing reality? **927c7a5 — only at push-moment; live reality is permanently ahead**. 4. Independent reconstruction? **Yes** (credential + 1-line .env fix + reproducible deps). 5. T-84 reconstructible? **Yes — proven twice**. 6/7/8. Who can write/push/rewrite? **Every PAT holder — all three, silently, on any branch**. 9. Can two writers silently diverge? **Non-FF: no (rejected); force: yes; cross-branch: yes by default**. 10. Can one erase another? **Yes — force-push, undetected pre-hoc**. 11. Current writer dies? **Lineage survives to last push; recovery proven; bounded loss = minutes of state**. 12. Stale writer returns? **Non-FF rejected → cheapest autonomous action is force of its stale world — behavior undefined (governance gap)**. 13. Outside Git? **Credentials, operator archives, latest engine state, absolute .env path, node_modules, process memory**. 14. Authority for canonical truth? **None operational — last-force-wins is the de facto law**. 15. Still requires operator? **Branch protection, single-writer law, credential rotation, vault archive passwords, real-world triggers**.

## Repairs performed (§XXIII — minimal, reversible, within authority)

1. Audit artifacts committed under `audit/r213/` (this report + 7 artifacts).
2. Nothing deleted, no force-push, no history rewrite, no credential action, no governance invented.
3. Test branch `audit-splitbrain-tmp` created and DELETED after the capability test.

## Required operator decisions (outside machine authority)

1. **Enable branch protection on saos-cockpit** (block force-push + deletion; optionally restrict pushers) — the single gate between Level 3 and Level 1.
2. **Single-writer law** — declare the authoritative writer for saos-cockpit and the protocol for stale writers.
3. **Credential boundary** — per-writer fine-grained tokens and/or rotation (chat-exposure open since T-79).

*Machine-side mitigations queued (within authority, next rounds): upstream+fetch monitor, pre-push divergence gate, bounded-staleness surfacing per engine cycle.*

---

*Artifacts: writer-registry.json · commit-lineage.json · STATE-INTEGRITY.json · SECRET-AUDIT.json · WRITER-CONFLICTS.json · RECOVERY-PROOF.md · FALSIFIER-REPORT.md · VERDICT.json — all in audit/r213/.*
