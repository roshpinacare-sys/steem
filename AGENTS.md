# AGENTS.md — steem (sovereign estate: key custody + receipts + chain legs)

> Task 19: full LHE harness protocol adopted from walkinglabs/learn-harness-engineering
> (five subsystems at this repo root). steem is the private estate repo: the sealed
> key vault, the agent scripts that sign, the receipts that prove, and the research
> corpus. Zero plaintext secrets at HEAD — gitleaks-proven (org CI, 16/16 head=0).

## Startup Workflow (before writing code)
1. **Before writing code**: run `./init.sh` — structure + syntax gate on the
   agent scripts; fix a red baseline before adding any new scope.
2. Read `README.md` — the live-truth header (fleet control matrix, latest
   receipts, doctrine pointers) and `FLEET-NOTE.md`.
3. Read `feature_list.json` — pick **one feature at a time**; check its
   dependencies and its evidence before claiming anything.
4. Check `progress.md` (Current State · Current Objective · Recommended Next
   Step) and `session-handoff.md` (Blockers · Files · Next Session).
5. Review recent commits `git log --oneline -5`; the bot lands receipts every
   10–15 min → always `git pull --rebase` before any push.

## Working rules (the law)
- **Zero secrets in any repo.** Keys live in the sealed vault
  (`agent/vault/KEYS-ZIP-*.enc`, AES-256-CBC pbkdf2-300k) and are opened
  in-memory only, wiped after run. A secret printed = owned incident +
  rotation recommendation. The owner's master key doctrine is in
  `agent/keys/hed-soldiers-source.txt` (2018 sheet) — never commit key
  material, only envelopes.
- **verify-then-sign.** Live posting-auth verification against the chain
  BEFORE any signature; chain read-back (txid/account-history/active_votes)
  AFTER. `CHAIN-RECONCILED` beats any book.
- **NEVER_TOUCH roster** (ynet*, tov-hive) and the full-control gate are hard
  caps — no exceptions without the owner.
- **Caps are load-bearing**: ≤12 votes/run, 1/account, cooldown, claims dust
  floor. The identical-vote skip is a healthy no-op, not a failure.
- **Rebase-first, never force.** Parallel runtimes land receipts constantly.

## Verification Commands
- `./init.sh` — the standard entrypoint (structure + `node --check` on scripts)
- `node agent/agent.cjs --dry` — dry pipeline (no signatures) when deps exist
- `cd agent && npm run test:pipeline` — pipeline self-test (deps installed)
- Static/build/lint gates run in org CI (org-selftests + gitleaks 16/16)

## Scope rules
- **One feature at a time** — exactly one unfinished feature from
  `feature_list.json` to done-with-evidence; no drive-by lanes.
- **Stay in scope** — never touch another runtime's lane (economy-engine
  receipts belong to Domain's workflow; books to their desks).

## Definition of Done
A change is done only when ALL of the following are true: behavior
implemented, verification actually ran (evidence recorded in
`feature_list.json` or `progress.md`), receipts appended where due, commit
pushed rebase-first, and the repo stays restartable from this file +
`./init.sh` for the next session.

## End of Session (before ending)
1. Update `progress.md` and `feature_list.json` (status + evidence).
2. Record unresolved risks in `session-handoff.md`.
3. Commit with a fact-bearing message; `git pull --rebase` then push.
4. Leave the tree clean and the next session able to run `./init.sh`.
