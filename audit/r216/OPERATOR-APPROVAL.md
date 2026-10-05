# R216-b · OPERATOR APPROVAL RECORD

**Recorded (UTC):** 2026-10-05T22:43Z
**Channel:** zai-web · session web-f26e225d-8a06-4a10-9f71-e2fbdcac7e46

## Operator message (verbatim)

> מאשר אני אטפל בטוקן בהמשך לגבי ה12 12

(Translation: "Approved. I will handle the token later, regarding the 12/12.")

## Interpretation (recorded by W1)

1. **Approval** — of the R216 hardening report and its compensation stack
   (signed commits, Steem custody witness, proposed single-writer law draft).
2. **PAT rotation ownership transferred to operator** — the GitHub PAT
   (fine-grained, expires **2026-12-12**) will be rotated/handled by the
   operator; no date was committed beyond "later". The organism records this
   as an open operator-gated item with a hard deadline of 2026-12-12.
3. **NOT declared:** the single-writer law (PROPOSED-SINGLE-WRITER-LAW.md)
   remains a *draft* — operator did not explicitly declare it in force.
   W1 continues to self-bind under SOVEREIGN-WRITER-LAW v1 as before.

## Consequences recorded in the ledger

- Custody chain continues under FF-law; no new authority claimed by W1.
- Rotation checklist for the operator: `audit/r216/ROTATION-CHECKLIST.md`.

## Incident discovered while recording this approval (same hour)

- **Custodian death observed live**: the R215 custodian (:3041) had been
  reaped by the sandbox after its 22:13:39Z tick (commit b3b075c) — loss
  window silently unbounded again. Ad-hoc tool-session launches do not
  survive; only the next-server process tree does.
- **Root fix executed 22:49Z**: custodian supervision folded into the
  SovereignCore watchdog (gen-2), spawn path = next-server child
  (idempotent route `/api/saos/spawn-custodian`), two-strike detection +
  heal-verify loop, custody heals even under pause (custody ≠ on-chain act).
- Deliberate-kill heal drill: executed immediately after arming (see
  sovereign-events.jsonl `custodian-down` → `custodian-heal-verified`).
