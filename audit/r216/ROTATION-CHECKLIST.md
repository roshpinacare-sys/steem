# PAT ROTATION CHECKLIST — operator runbook (deadline 2026-12-12)

**Owner:** operator (recorded 2026-10-05T22:43Z: "אני אטפל בטוקן").
**W1 role:** execute the swap + verification steps below when the operator
provides the new token, WITHOUT ever printing or storing the token anywhere
except `.secrets/github.pat` (mode 600).

## Current token facts (as probed R216)

- Type: fine-grained personal access token, repo `roshpinacare-sys/steem`.
- Expiry: **2026-12-12** (hard deadline — do not let it lapse).
- Permissions granted: repo Contents R/W + **Administration** (granted
  mid-R216 by operator: "פתחתי לך אדמין").
- Known limits: fine-grained PATs **cannot** register user GPG keys
  (`POST /user/gpg_keys` → 403; classic-scope `write:gpg` only).
- Branch protection is **plan-gated**, not permission-gated:
  `PUT /branches/saos-cockpit/protection` → 403 "Upgrade to GitHub Pro or
  make this repository public". No token fixes this; only a plan upgrade
  does. **Never** make the repo public to unlock it — `main` carries the
  vault-password legacy (Agent D finding) and must stay private.

## Recommended rotation target (operator decision)

| Need | Fine-grained PAT | Classic PAT |
|---|---|---|
| push/commit custody | ✅ Contents R/W | ✅ `repo` |
| branch protection API | ✅ Administration R/W (still needs GitHub **Pro plan**) | ✅ `repo` (still needs Pro plan) |
| GPG key registration (Verified badge) | ❌ not supported | ✅ `write:gpg` |

→ If Verified-badge commits are wanted, the rotation should mint a **classic
PAT** with `repo` + `write:gpg` (+ `workflow` only if Actions are ever used).
Otherwise a fresh fine-grained token with the same permission set suffices.

## Swap procedure (W1 executes, secrets never displayed)

1. Operator delivers the new token out-of-band (never into chat/logs).
2. W1 writes it to `.secrets/github.pat` (0600) replacing the old file.
3. W1 verifies, in order:
   - `git ls-remote origin` (credential helper picks the file up unchanged).
   - `GET /repos/roshpinacare-sys/steem` → 200.
   - Probe commit through the sovereign gate (`scripts/sovereign-push.sh`)
     → API-verify remote tip advanced.
4. W1 re-probes previously-blocked operations and records results:
   - `POST /user/gpg_keys` with `signing/w1-signing-key.asc` → expect 201
     on classic `write:gpg`, else 403 (documented, not a failure).
   - `PUT /branches/saos-cockpit/protection` → expect 200 **only if** the
     account plan was upgraded; ready command body is preserved in
     `audit/r216/HARDENING.md`.
5. W1 appends a round note to `worklog.md`; old token is then dead
   (operator revokes it on GitHub — nothing in the tree ever referenced it).

## Standing reminders

- The token file is the ONLY secret in the tree-scope; sweeps continue each
  round before any commit (R214 precedent: runbook draft carrying a password
  was caught and cleaned pre-commit).
- Expiry alarm: any round after 2026-11-12 (T-30) must surface "PAT rotation
  pending" in the daily report until done.
