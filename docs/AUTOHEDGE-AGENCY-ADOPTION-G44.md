# G44 · RESEARCH ADOPTION — AutoHedge + agency-agents → the sovereign stack
**Owner mandate (trace web-d6bba2fd, 2026-10-21):** "בחן את אלו ונצל מה שניתן בהתאמה לריבונות האוטונומית שלנו שיביא לנו ערך ככל הניתן · בחן תכנן בצע דחוף"
Sources studied (shallow clones, static full-read analysis):
- `github.com/The-Swarm-Corporation/AutoHedge` @ c549c79 (MIT)
- `github.com/msitarzewski/agency-agents` @ 4e3ac3c (MIT)

## 1. Honest verdicts on the sources

### AutoHedge — LLM-advise-only prototype, execution never wired
The 4-agent LLM pipeline (Sentiment→Quant→Risk→Execution under a Director) produces TEXT only:
`workers.py` output_type="str", zero JSON validation, zero kill-switch, the "Solana execution"
tools are registered but never attached to any agent (`tools_registry.py` vs `workers.py`).
The genuinely valuable code is `experimental/market_making.py` (a real, simple, capped
market-making loop) and the two-phase unsigned-quote→local-gate→sign pattern in
`ultra_tools.py`. **We adopt the patterns; we reject the LLM-in-the-loop.**

### agency-agents — prompt-persona library + NEXUS doctrine (no runtime)
267 agent .md personas across 18 divisions, a 7-phase pipeline doctrine with named gate
keepers, evidence tables, retry budgets, and catalog-integrity CI. **We adopt the doctrine
patterns into our fleet coordination; we reject the installer/SaaS coupling.**

## 2. Adopted NOW into the engine (this commit)

| # | Pattern (source) | Landed as | Law |
|---|---|---|---|
| A1 | Typed strategy config with named caps (`market_making.py:15-31`) | Already superior here — `takeLaw` + `SHARP_DEFAULTS` (edge/band/notional/day caps in bps) | selftest 2032/2032 |
| A2 | Error backoff cadence — never a retry-storm, never a stop (`market_mapping.py:267-294` lesson) | `backoffDelayMs` in `lib.mjs` + wired into the hyper-grid tick (skip-window, zero scheduler surgery, journaled `hyper.tick-error`/`hyper.backoff-cleared`) | base·2^k cap 60s, garbage→base fail-closed |
| A3 | Append-only execution journal with PnL-on-close convention (`market_making.py:74-87,223-252`) | Already our `events.jsonl` discipline; the sharp taker journals take/take-fail/skip on verdict-change | bounded noise law |
| A4 | Feed degradation chain — but REPAIRED fail-closed (their silent synthetic fallback at `market_making.py:148-155` is exactly what we must never do) | Already ours: `external-quotes.mjs` W27-c (Poloniex/Bithumb/Gecko, stale stays labeled, venue failure never corrupts the anchor) | keyless, per-venue honesty |
| A5 | Two-phase execution: unsigned intent → local gate → local sign (`ultra_tools.py:85-235`) | Already ours: `takeLaw` verdict → `executeOps` (armed/pause/RC-floor/verify inside the signer). G44 adds the master-rail `masterTakeOp` op-builder in its own id partition | FOK always, partition [1.7e9,1.79e9) |
| A6 | Double-cap sizing before order creation (`market_making.py:157-183`) | takeLaw caps notional × hand/master free balances × reserve, in code, BEFORE the op exists | ≤2 SBD/take, dayCap 60 |
| A7 | Router record `{agent_name, task, reasoning}` mandatory-reasoning (swarms handoffs) | Our verdicts already carry reasons; doctrine note: every law change in worklog/LOCKS carries the WHY (adopted as convention) | auditability |

**G44's real activation** (the owner's blanket approval executed where custody lives):
`sharp-taker.mjs` — the dislocation taker on the MASTER rail. The per-hand taker
(manyhands, G43) is custody-blocked (active keys match no held WIF — measured); the
master has 64+ proven fills. One law (`takeLaw` imported from manyhands — ZERO
duplication), own id partition, FOK, capped, standing-order gated
(`exec-armed.json: sharpTaker.enabled=true` — reversible by one flag), armed live
2026-10-21. Verdict at arm: `SKIP:NO-EDGE` (book tight — honest).

## 3. Adopted NOW into the fleet coordination (coordination repo, same wave)

| # | Pattern (source) | Landed as |
|---|---|---|
| B1 | Canonical JSON + cross-check CI (`divisions.json`+`check-divisions.sh`) | `lanes.json` + `scripts/lanes-check.sh` — one lane→owner→repo map, cross-checked against LOCKS.md lock headers |
| B2 | Fail-closed auditor persona — default NEEDS-WORK, perfect scores are a red flag (`testing/testing-reality-checker.md`) | `personas/auditor-failclosed.md` |
| B3 | Filesystem-as-ledger, grep-verifiable state (`specialized/agents-orchestrator.md`) | `lanes.json` + worklog handoff blocks shaped for `grep` |
| B4 | Standardized handoff documents ×7 (`strategy/coordination/handoff-templates.md`) | `HANDOFF-TEMPLATE.md` (standard · qa-pass · qa-fail · escalation · phase-gate · incident · claim-transfer) |
| B5 | Retry budget 3 + structured escalation with root-cause + decision menu (`nexus-strategy.md` §11.3) | codified in `HANDOFF-TEMPLATE.md` escalation template |
| B6 | Agent definition template as the unit of doctrine (`CONTRIBUTING.md` schema) | `personas/` — operator-lane · auditor-failclosed · witness-evidence · economy-core-risk |
| B7 | Zero-trust delegation + append-only evidence (`specialized/agentic-identity-trust.md`) | mirrored in witness-evidence persona (git signed history = the evidence chain) |

## 4. Explicitly REJECTED (with the law that rejects it)

| Rejected | Why |
|---|---|
| LLM inside the trading loop (AutoHedge pipeline) | decisions on money go through the numeric constitution; LLM at most legislates WITH schema enforcement — never ticks |
| Free-text "Risk Manager" (`prompts.py:85-118`) | our caps are code-enforced numbers, not prose wishes |
| Silent synthetic price fallback | fail-closed: a stale feed STOPS the layer, never invents a price |
| Single-key env signing with no spend cap (`ultra_tools.py:57-67`) | multi-layer caps + RC governor + allowlist policy live in the signer |
| Payment-rail failover without re-verdict (agency-agents `accounts-payable-agent.md`) | anti-fail-closed; money rails change state only through a new measured verdict |
| Their installer/SaaS/MCP-memory dependencies | cloud-free sovereignty; git IS the memory |
| Unsourced stats (`EXECUTIVE-BRIEF.md`) | claims ledger only admits measured numbers |

## 5. Alignment with the peers (no overwrites, mutual reinforcement)
- G41 lane (exec-cycle + army CI + FF custody): untouched — their keys/locks stay theirs.
- Peer's W119 reinforcement (exec-armed.json 04:03): untouched — `sharpTaker` added as a
  NEW disjoint key; their keys byte-identical.
- `lanes.json` declares the lanes so the NEXT wave starts aligned instead of archaeology.

*Written and committed under R316/R319 custody law: GPG-signed, zero secrets in the
canon (fingerprints only), claims measured before claimed.*
