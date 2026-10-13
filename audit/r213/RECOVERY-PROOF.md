# RECOVERY-PROOF — R211/R212 Git Sovereignty Audit

**Question (§XVII/§XVIII): can an INDEPENDENT sandbox reconstruct (a) the T-84 snapshot and (b) the current canonical state — from Git, without access to the original sandboxes?**

Executed by: orchestrator (after falsifier Agent C hit its context deadline — the task was completed per Agent C's own procedure, read-only, isolated in /tmp/R213-orch). Agent A performed an INDEPENDENT second clone and reached identical conclusions.

## (a) T-84 restoration — PROVEN (verified twice)

1. **Raw-content proof (orchestrator, pre-agent)**: fetched `worklog.md` and `mini-services/saos-engine/state/adaptations.json` from `raw.githubusercontent.com@e4cdfd6` → 206,976B (sha256 `3614c680ea468c55…`) and 2,929B (sha256 `9c6ca628b1c53a99…`) — byte-identical to both the /tmp/cockpit-backup clone and recovery/branch-saos-cockpit-e4cdfd6 archive (3-way match).
2. **Isolated clone proof**: fresh `git clone --branch saos-cockpit` → 71 objects, tip 927c7a5d; `git merge-base --is-ancestor e4cdfd6 HEAD` = **YES**; `git checkout e4cdfd6` → tree `5683bd28…` (matches remote commit object), both critical files present at exact sizes.
3. Content verified: source, cognition-round (13 artifacts), recovery archive, worklog (207KB), configuration, engine state — all reconstructible.

## (b) Current-state restoration — PROVEN (to the push-moment)

- Checkout 927c7a5d: worklog 159,036B ✓, adaptation.json 1,715B ✓, predictions.jsonl PRESENT, cognition-round 12 entries, recovery/ present, src/ complete (page.tsx 73,240B byte-identical to local).
- **Dependencies**: `bun install --frozen-lockfile` in mini-services/saos-engine → OK (2 packages, 4ms). Root install reproducible.
- **Cognitive-state continuity**: the learned rule (ADAPT-claim-role-posting-R209, posting-role adaptation), prediction ledger, trigger journal, exec evidence streams — all present in the tree.
- **Naming-generation note (critical for a recovering engine)**: the T-84 generation used `adaptations.mjs` → `adaptations.json` (PLURAL); the current generation uses `adaptation.mjs` → `adaptation.json` (SINGULAR). A recovery script must load the CURRENT module, not assume the T-84 layout. Both files are in their respective commits; the R211 recovery archive preserves the T-84 sealed store WITHOUT hot-injection.

## What Git does NOT contain (recovery dependencies)

| Dependency | Class | Holder |
|---|---|---|
| `.secrets/github.pat` | credential (GitHub ops) | disk-only, mode 600 — if lost, re-supply via operator |
| `.secrets/headcorner.key` | signing credential (engine self-adopts per doctrine; derivation from master password possible) | disk-only, arrived 20:32:44Z during audit |
| `upload/pat.rar`, `KEYS_BACKUP*.tar.enc` | operator-held encrypted archives | operator (vault-level recovery only) |
| `.env` DATABASE_URL absolute path | must be adjusted on a new machine | 1-line edit |
| `node_modules`, `.next` | generated | reproducible |
| Live process state (engine cycle, in-memory) | runtime-only | bounded loss by design — R212 bounded-staleness law |
| Latest engine state (since last push/auto-commit) | disk-only | bounded loss — remote always ≥1 commit stale |

## Verdict

**T-84: RESTORABLE. Current canonical state: RESTORABLE (push-moment) with 1 credential + 1 path edit.** No undocumented-outside-Git blocker exists for state reconstruction; credentials are the only true external dependency, and their doctrine (single master password → self-derivation) is documented in the repo itself (docs/ADOPTIONS.md, engine adoption flow).
