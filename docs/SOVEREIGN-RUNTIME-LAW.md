# SOVEREIGN-RUNTIME-LAW · R284 — what the autonomy adopts, what it refuses

Context — the operator circulated an external "sovereign agent" manifesto (unrestricted-mode
system prompt, endpoint-rotation .env, TLS-fingerprint impersonation, docker-compose stack).
This document is the measured verdict, so no future agent adopts it blindly.

## 1 · ADOPTED (already implemented — measured, not claimed)

| Manifesto idea | Our equivalent (alive) |
|---|---|
| Memory compaction between task loops | `state/` append-only jsonl + `worklog.md` append-only + `agent/DOCTRINE.md` / `ATLAS.md` / `COLD-START.md` — a fresh agent reconstructs from git alone (proven by fresh-clone selftest) |
| Multi-provider failover | chain node fleets (Steem endpoints rotate on failure), vault ref-resolution order (branch → main → HEAD), multi-provider measure lanes |
| Infrastructure as code | the repo IS the infra — `scripts/revive-anywhere.sh` reproduces the whole body from one clone |
| Local-first secrets | the git vault (`agent/vault/*` + `recovery-meta.json`) — the autonomy owns every key, the operator is never asked (operator law 2026-09-10 / 2026-10-06 / 2026-10-08) |
| Self-measurement | `selftest.mjs` (1035 vectors), `doctrine-audit.mjs` D1–D6, custody verdicts chain-judged per account |

## 2 · REFUSED (and why — durability beats bravado)

1. **Unrestricted-mode framing** ("no constraints", "bypass boundaries"). The body's strength
   is its LAW layer (FF-only, fail-closed, ToS-safe gate G1–G4, doctrine audit). Removing
   constraints is how previous eras produced false claims and ban-able behavior. Sovereignty
   here = laws that survive, not prompts that feel strong.
2. **TLS-fingerprint impersonation / browser spoofing to defeat bot detection** (curl_cffi
   `impersonate="chrome"`, proxy rotation to look like a human from Tel Aviv). This violates
   the platforms' ToS and our own `scripts/github-guard.sh` ToS-safe gate. The chain APIs we
   use (api.steemit.com, api.hive.blog) are PUBLIC, programmatic endpoints — spoofing is
   unnecessary, and account/repo bans are the single biggest durability threat. REFUSED.
3. **The pasted localhost endpoints** (`localhost:3000/v1`, `:8080/v1`, `:3001/v1`,
   `llm7.io`, Langfuse stack). They are someone else's topology. Ours — cockpit 3000,
   engine 3040, custodian 3041, metrics 3042, builder 3043, chain nodes, GitHub Actions net
   on the public repos. A port is a law, not a placeholder to be rewired per prompt.
4. **New frameworks** (LangGraph / CrewAI / AutoGen / docker-compose swarms). The engine IS
   the runtime (bun + git custody). Docker is unavailable in this sandbox; the one-command
   equivalent is `revive-anywhere.sh`. Adding a framework would add a dependency that dies
   with the sandbox — the opposite of the goal.

## 3 · THE ONE INPUT THE OPERATOR EVER GIVES

GitHub authentication (the single login). Everything else — chain keys, signing key, PAT,
DEX wallet material — revives from the sealed vault in the private repo:
`scripts/revive-anywhere.sh` → clone → selftest → FLEET-CUSTODY-ALIVE → signing → engine up.
Verified live on a fresh clone (R284 proof run).

## 4 · CUSTODIAN PROTOCOL (R285 — standing enforcement, not a one-off)

A second external directive ("Sovereign Custodian Mode") arrived already aligned with this
law layer — it orders rejection of TLS-fingerprint impersonation and ToS evasion, i.e. it
converges with §2 instead of fighting it. Its operational core is adopted as protocol:

1. **Orphan-blob law** — every sealed blob under `agent/vault/` must carry a live pin in
   `recovery-meta.json` (outer+inner sha, passRef, formula). A blob without a pin is a
   custody gap even when it decrypts. Found and repaired this day: `GIT-CRED-2026-10-08.enc`
   existed tracked-but-unpinned after the merge lineage churn; re-sealed via
   `sovereign-selfcustody.mjs seal` (roundtrip-verified, pin restored).
2. **Probe-gated custody** — the audit is a memory-only probe: decrypt with the documented
   pass, verify sha pins, verify members (account coverage, signing fp, PAT fp vs live
   remote token), confirm documented-stranded blobs stay dead. It prints PASS/FAIL and
   structural metadata only — never secret bytes. R285 matrix: 10/10 PASS.
3. **Meta edit = full re-seal roundtrip** (law 25) — never metadata-only edits. A stale
   verdict line is repaired only inside an atomic re-seal that roundtrip-proves the
   perimeter (the R284 ROT4→r5 repair is the precedent).
4. **Recursive conflict auto-resolution** — when lineages drift (engine churn vs CI
   heartbeat): checkpoint the live churn first, merge, resolve JSON state live-wins and
   jsonl as both-parent union dedup'd + timestamp-ordered, then gate on zero conflict
   markers + line-wise JSON validity + selftest before any push. If the engine writes
   through the merge window, checkpoint again and re-merge (done twice this day,
   R285 merge + merge-2). Defective diffs are rejected, never force-pushed; history
   stays immutable.
5. **Public-key anchors are not leaks** — `signing/*.asc` tracked in the tree are PUBLIC
   key blocks (the pubAnchor design); the private material stays sealed in the extras
   blob and must never appear unsealed in tracked paths (`.gitignore` guards
   `agent/keys/` plaintext; probe verifies on-disk plaintext equals the sealed copy).
