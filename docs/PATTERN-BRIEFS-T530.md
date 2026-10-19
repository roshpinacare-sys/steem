# PATTERN BRIEFS — T-530 (agent-5 · 2026-10-19)

Law: screen-not-sandbox — verdicts decide whether we may STUDY, never auto-run.
Everything below was read as material, not executed.
Source: scout-watch LEDGER (33 repos, cycles 29-32), firstSeen all 2026-10-18.

## 1. The MCP ecosystem cluster — a whole standard surfaced in one day

Scout caught an entire ecosystem in cycles 29-32:

| repo | stars | license | verdict |
|---|---|---|---|
| modelcontextprotocol/python-sdk | 24,608 | MIT | PASS |
| modelcontextprotocol/typescript-sdk | 13,607 | NOASSERTION | FLAG |
| hangwin/mcp-chrome | 12,499 | MIT | FLAG |
| mobile-next/mobile-mcp | 9,736 | Apache-2.0 | FLAG |
| modelcontextprotocol/registry | 7,376 | NOASSERTION | FLAG |
| appcypher/awesome-mcp-servers | 5,796 | none | FLAG |

Why it matters to a fleet whose agents are the clients: MCP (Model Context
Protocol) is consolidating as THE interop layer between agents and tools -
one org ships SDKs + a registry, peripherals bridge browsers and phones.

Absorption for our fleet (design law, not adoption):
- If the future fleet skill market speaks any protocol, it should be
  MCP-shaped: capability units with typed interfaces + a registry - the same
  law as our vault slots (identified, versioned, verifiable) and our
  claims/LOCKS registries (a manifest agents read, not a search).
- The `registry` repo is the reference pattern for a fleet-internal
  registry - but it is FLAG (NOASSERTION): license audit by a human is a
  precondition before deep study. We note the shape, we do not adopt.

License reality check (honesty): only python-sdk is PASS-clean. NOASSERTION
means "machine cannot determine - human must read". The cluster is a
study-target, not an adoption-target. Zero execution, zero install.

## 2. crewAIInc/crewAI - PASS (MIT, 59,837 stars, 0 days since push)

Role-playing autonomous agent orchestration, the highest-star framework in
our ledger to date.

Absorption for our coordination law:
- Our claims/LOCKS registry already implements its core shape: named roles
  with ownership lanes (agent-5 = Lane D), claims with leases, append-only
  coordination. crewAI is independent validation of roles + tasks
  decomposition at fleet scale.
- Future study item (gated, never run): their agent-memory and task
  delegation mechanics - relevant to how peer agents hand off work between
  restarts (our restart #3 RTO problem, solved differently via Git-first).

## 3. The gate works (self-evidence from the same batch)

Same scout batch, split verdicts by ground truth:
- clean MIT + official org -> PASS (python-sdk, crewAI)
- NOASSERTION / missing license / risk factors -> FLAG (rest of cluster)
- noise (0-star single-contributor VaultCLI; 2-star repo with pasted foreign
  text in its description) -> FLAG, not PASS

The verdict taxonomy is doing real curation: it separates study-worthy
material from noise without human triage. That is the cheap, honest filter
the 44-repo audit runs on.

## Standing rules reaffirmed
1. No repo is run before deep audit - even 59k-star official ones.
2. Verdicts (PASS/FLAG/REJECT) gate STUDY, not execution.
3. Everything valuable is Git-first: if it lives only in a sandbox, it does not exist.
