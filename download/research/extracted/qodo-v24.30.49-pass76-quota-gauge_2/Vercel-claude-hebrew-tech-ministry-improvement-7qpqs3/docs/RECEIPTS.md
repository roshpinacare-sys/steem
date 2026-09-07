# Verifiable Autonomy Receipts (`qodo.receipt/v1`)

Every agent run — success, halt, or failure — issues a **receipt**: a portable
JSON artifact proving the run happened *under controls*. Where SLSA provenance
answers "how was this artifact built?", an autonomy receipt answers the
question AI-governed engineering actually gets asked:

> **Who approved this AI-written change, under which controls, at what cost?**

## What a receipt claims

| Block | Claim |
|---|---|
| `subject` | repo, PR, commit sha, **sha256 of the unified diff**, files touched |
| `run` | run id, timestamps, duration, outcome (`done` / `halted` / `failed`) |
| `controls.policy` | the governing `.qodo/policy.yml` — its trunk path and **sha256 of the raw file** (a PR cannot loosen its own guardrails; the receipt proves which policy was in force) |
| `controls.approval` | approval mode (manual / trust / auto / mentor-forced) and the recorded decision event |
| `controls.gates` | the 5-gate validator verdicts (lockfile, blast-radius, DOM-xray, shadow-traffic, chaos) + tests + contract guard, and the aggregate `gateOpen` |
| `controls.budget` | spend in cents vs. the policy cap, with the `exceeded` flag |
| `controls.trust` | trust-ledger category, bond score, auto-merge eligibility |
| `evidence` | the audit-chain head (seq + hash) at issuance, entry count, chain validity |
| `rehearsal` *(optional)* | the **$0 pre-flight**: envelope sha256, phases walked, gate verdict, files predicted by the in-process simulation that ran before any spend |
| `signature` *(optional)* | HMAC-SHA256 over the canonical receipt body, with a key id |

## Mutual anchoring

The receipt and the hash-chained audit log (`.audit-log.ndjson`) anchor each
other, in this order:

1. The receipt records the chain head (`evidence.auditHead`) as it stood.
2. `receipt.json` is written.
3. A `receipt-issued` event carrying `sha256(canonicalJson(receipt))` is
   appended to the chain.

So the chain proves the receipt (an attacker must re-forge the chain to swap
receipts) and the receipt pins the chain (truncating the log breaks the head
reference). Canonical JSON = recursively sorted keys, no whitespace —
receipt hashing is whitespace-independent; the audit chain itself keeps its
original insertion-order hashing untouched.

## Rehearsal binding (`--rehearse`)

With `--rehearse` (or `QODO_REHEARSE=true`) the ENTIRE real pipeline first
runs **in-process at $0**: deterministic offline LLM simulator, in-memory
Redis/R2/GitHub — the same machinery as `--eval`. The rehearsal distills a
timestamp-free envelope (phases walked, gate verdict, files predicted) whose
sha256 is embedded in the run's receipt and recorded on the chain
(`rehearsal-completed`). Identical rehearsals hash identically.

`QODO_REHEARSE_ENFORCE=true` upgrades evidence to enforcement: a rehearsal
whose gate stays CLOSED halts the real run before any spend
(`rehearsal-blocked`, exit code 2). Default is evidence-only — a broken
rehearsal never blocks delivery.

## Lineage across relay hops

*(added Pass 74, task-55)* A single receipt proves one run happened under
controls. A **relay** — where one hop's output ZIP becomes the next hop's
input, with no shared memory between hops — needs more: proof that hop N
really followed hop N-1, using only what travels inside the ZIP.

`lineage` is an optional receipt block:

```json
"lineage": {
  "hopIndex": 3,
  "parentReceiptSha256": "<sha256 of hop 2's canonical receipt>",
  "genesis": "<the same hash — this hop's audit chain was seeded with it>"
}
```

Instead of every hop's `.audit-log.ndjson` starting from the fixed all-zero
genesis, a hop that continues a lineage seeds its first entry's `prevHash`
with the **previous hop's own receipt hash**. `appendAuditEntry` and
`verifyAuditChain` (`services/audit-log.ts`) both take this as an optional
last argument; omitting it reproduces the exact prior all-zero behavior —
existing standalone runs and existing receipts are untouched.

**Why this solves composability, not just chaining:** a verifier at hop N
does not trust hop N-1's claim about what came before. It is handed the
*actual* parent receipt bytes (also inside the ZIP, or supplied separately)
and **recomputes** `sha256(canonicalJson(parentReceipt))` itself. Only if
that independent recomputation matches `lineage.genesis` — which is also
what the audit-chain walk uses as its starting point — does the hop verify.
Editing the parent receipt after handoff, even by one byte, breaks the
lineage check and, independently, breaks the child's chain walk (wrong
genesis), so a forged intermediary can't paper over tampering by only
touching the log it controls.

This composes across arbitrarily many hops: hop N's verifier only ever
needs hop N-1's receipt to check hop N, but nothing stops a stricter
verifier from walking the whole lineage back to hop 1 by repeating the same
one-hop check at each link — no hop in the middle needs to be trusted,
only re-hashed.

```bash
node scripts/verify-receipt.mjs hop2-receipt.json \
  --audit hop2-audit.ndjson --parent-receipt hop1-receipt.json
```

**Scope of Pass 74:** the primitive (schema, chain-genesis override,
verification, both verifiers) was implemented and independently exercised
with the real `sha256`/`canonicalJson` algorithm outside vitest (see the
pass-74 audit note). **Pass 75 (task-56)** closed the remaining gap:
`pipeline/relay-lineage.ts` now reads an incoming `.relay-parent-receipt
.json` at pipeline start on its own and threads its hash through as the
run's genesis (`helpers.ts`'s `audit()`) and into the emitted receipt's
`lineage` block (`receipt-emitter.ts`'s `emitReceipt()`) — no manual step.
See `docs/history/audits/75-V24-AUDIT-PASS-75.md`.

## Verifying a receipt

Anyone holding the receipt can verify it offline; the audit log and the key
strengthen the verdict:

```bash
# Zero install — a single dependency-free script:
node scripts/verify-receipt.mjs receipt.json \
  --audit .audit-log.ndjson --key "$QODO_RECEIPT_KEY"

# Or via the agent CLI:
node packages/agent/dist/cli.js --receipt-verify receipt.json --audit .audit-log.ndjson

# Or on the phone: Mission Control → Governance → Autonomy receipts
# (fetches receipt-* CI artifacts, or paste the JSON).
```

Checks performed: schema · gate/verdict consistency · budget consistency ·
HMAC signature (when the key is provided) · lineage (when a parent receipt
is provided) · full chain walk · chain-head match · `receipt-issued` mutual
anchor.

In CI, every `workflow_dispatch` agent run uploads `receipt-<run_id>` (90
days) beside `audit-log-<run_id>` (30 days). Set the `QODO_RECEIPT_KEY`
secret to get signed receipts; without it receipts are unsigned but still
chain-anchored.

## Threat model — honest edition

**Detected:**
- Editing any field of a receipt (canonical-hash + signature mismatch; the
  chain's `receipt-issued` hash no longer matches).
- Editing, reordering, or truncating the audit log (hash-chain walk fails or
  the head reference breaks).
- Replaying a receipt against a different run's log (no `receipt-issued`
  event carries its sha256).
- Forging a signed receipt without the key.
- *(Pass 74)* Editing a **parent** receipt in a relay lineage after handoff
  — the child's `lineage.genesis` was fixed at issuance and no longer
  matches the parent's recomputed hash, independent of the child's own
  chain (which stays internally valid — the break shows up specifically as
  a `lineage` failure, not a false "everything's fine").

**NOT covered — say it plainly:**
- A **compromised runner at generation time** can fabricate a consistent
  receipt+chain pair from scratch. Generation-time trust is the job of CI
  provenance (SLSA, reusable-workflow attestations); receipts compose with
  it — they attest the *controls*, provenance attests the *environment*.
  This also bounds lineage: a compromised hop can still forge BOTH a fake
  parent and a consistent child at generation time. Lineage stops silent
  post-hoc edits to an already-issued parent; it is not a substitute for
  trusting the environment each hop ran in.
- **Unsigned receipts** (no `QODO_RECEIPT_KEY`) rely solely on chain
  anchoring: an attacker holding write access to BOTH artifacts can rewrite
  history. The HMAC key closes this; keep it in a secret store.
- HMAC is a *shared-secret* scheme: anyone who can verify can also sign.
  Asymmetric signatures (ed25519 / Sigstore) are the planned v2 for
  third-party-verifiable trust without sharing the key.
- **Automatic lineage wiring is best-effort, read-only pickup — not a
  substitute for trusting the relay orchestrator that places the parent
  file.** (Pass 75, task-56.) `pipeline/relay-lineage.ts` reads
  `.relay-parent-receipt.json` if present; it never validates that the
  orchestrator placing that file is itself trustworthy. That's still the
  generation-time-compromise gap above, one layer up: a relay script that
  hands the wrong (or no) parent file gets a chain that's internally
  consistent but doesn't actually reflect the intended lineage. `lineage`
  proves "this hop followed the receipt it was handed," never "the hop
  was handed the receipt it should have been."

## Schema reference

See `packages/agent/src/services/receipt.ts` — the `AutonomyReceipt` type is
the schema; `verifyReceipt()` is the reference verifier (browser-safe, used
verbatim by the phone app); `scripts/verify-receipt.mjs` is the independent
re-implementation for third parties.
