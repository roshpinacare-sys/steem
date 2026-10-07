# THE ANTI-SPAM LAW (R243) — saos-spamgate-v1

**Operator directive 2026-10-07:** "we are still at absolute shitpost level;
networks have bots that hunt and kill spam (e.g. @spaminator). Learn what they
flag, publish WITHOUT spam, run experiments on Steem first."

## 1 · The measured threat (2026-10-07, api.hive.blog, @spaminator last 1000 ops)

| measurement | value |
|---|---|
| downvotes / all ops | 466 / 1000 (46.6% — half his life is killing spam) |
| flag weight | −25, every single one |
| self-description | "Proactive Spam & Exploitation Interception" |
| flagged top-level posts | 327 — body from **283 chars** (thin content) |
| flagged comments | 139 — body from **8 chars** (engagement farming) |
| repeat offenders | hunted per-author (one account flagged 18× in one scan) |

**Our own network verdict** (Domain STATE-REPORT 2026-10-07): every recent
fleet post carries ~10 fleet votes and **0 outside votes** — zero organic
reach. The network is already judging the output as spam. This law is the
structural answer.

## 2 · The gate (code: `mini-services/saos-engine/spamgate.mjs`)

Nothing publishes — post or comment — without clearing ALL of:

| check | threshold (post) | threshold (comment) | measured source |
|---|---|---|---|
| body depth | ≥ 1200 chars | ≥ 200 chars | victims at 283 / 8 chars |
| bait phrases | 0 hits | 0 hits | "free crypto / upvote me / claim your airdrop…" |
| link-stuffing | link chars ≤ 15% | same | link-farming profile |
| self-duplication | dup sentences ≤ 15% | same | thin-shuffling |
| emoji flood | ≤ 10 | same | — |
| self-repetition | 3-gram jaccard ≤ 30% vs own last 10 chain posts | ≤ 50% | repeat-offender hunting |
| grounding | ≥ 1 measured ref (`groundedOn`) | n/a | no free-floating word salad |
| title | 8–100 chars, no ALL-CAPS, no clickbait | n/a | — |
| tags | 1–5, unique, none banned | n/a | tag abuse profile |
| frequency | chain-counted posts today < day-cap | same | flooding profile |
| **cross-chain** | **STEEM-ONLY (operator pause, in code)** | same | the stop order |

A refusal is **fail-closed, journaled** (`spamgate.refused` event, draft marked
`refused-spam` with reasons) — the draft is spent, never retried, never
broadcast.

## 3 · The organic-verdict learning loop

After every social run, `runOrganicWatch` reads the last 5 published posts
from the chain (fleet votes vs outside votes, flags, replies) and rules:

- **ORGANIC-OK** — outside votes present → gate stays at baseline.
- **ZERO-ORGANIC-TIGHTEN** — 5/5 posts with zero outside votes → minimum body
  depth tightens to 1600 chars (the network is calling us spam; deepen).
- **FLAGGED-STOP** — any downvote-flag on our posts → publishing stops until
  the operator reviews (the one signal that must never be ignored).

State: `state/spamwatch.json` (verdict-only, committed).

## 4 · The Steem-first experiment protocol

Per the operator: experiments run on **Steem only**; Hive/Blurt publishing
stays **frozen** (code-enforced `REFUSED-CROSS-CHAIN-PAUSE`; the vault-revival
HIVE/BLURT law stands; Domain's blurt-curate is votes-only and STASIS-frozen).

1. One probe post/day max, through the gate, from a custody-verified account.
2. The observer (`runOrganicWatch`) scores it after 24h: outside votes, flags,
   replies, pending payout.
3. Success criteria (48h): ≥1 outside vote AND 0 flags AND ≥1 organic reply.
4. Failure = gate tightens (§3); two consecutive failed probes = the rail
   pauses and the operator is notified with the measured reasons.
5. Only after 3 consecutive successful probes does any cross-chain re-arm
   question even reach the operator.

## 5 · Verification vectors

52 deterministic selftest vectors (R243) cover every check, the cross-chain
refusal, the organic loop, and the full gate integration: SELFTEST 479/479.
