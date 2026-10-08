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
