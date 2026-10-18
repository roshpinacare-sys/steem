# PATTERN-BRIEFS — Sovereign Discovery Absorption (T-526)

> Doctrine: **discover → screen → study → re-implement as our own original**.
> The Bytebase precedent (T-523) is the model: we absorbed three sharp ideas
> (database-as-code, drift detection, audit) and SURPASSED the source by
> anchoring audit to the public chain. We never swallow code raw.
>
> The scout ledger (`mini-services/saos-engine/scout-state/LEDGER.json`,
> Git-pushed by scout-watch every cycle) is the living candidate memory.
> Verdicts are a SCREEN, not proof: `PASS` = safe to STUDY, `FLAG` = study
> metadata/README only, `REJECT` = do not touch. Deep audit before running
> anything stays mandatory — forever.

## Study queue highlights (from live ledger, 2026-10-18)

### 1. crewAIInc/crewAI — PASS · ~59.8k★ · MIT · 1087d
- What: role-based agent crews — agents with roles/goals/backstories, tasks
  delegated in sequence/hierarchy, tools injected per-agent.
- Pattern worth absorbing: **role+goal+backstory as a declarative agent spec**,
  and task-flows as explicit typed objects instead of ad-hoc prompt chains.
- Our own version (original, no code copied): our `army.mjs` marines already
  have roles; brief says: formalize role specs as data (JSON) in Git, keep
  execution entirely ours. Nothing imported.

### 2. MervinPraison/PraisonAI — PASS · MIT · multi-agent + MCP
- What: low-code multi-agent orchestration with MCP (Model Context Protocol)
  integration.
- Pattern worth absorbing: **MCP as the tool-surface standard** — our engines
  expose capabilities as HTTP routes; an MCP-shaped façade over existing
  routes would make sovereign tools consumable by ANY MCP client without new
  trust (routes stay zero-secret, chain-anchored).
- Our own version: describe-route → MCP manifest generator, ~50 lines, no
  dependency on PraisonAI itself.

### 3. EnvoyMesh — FLAG (no identified license + postinstall hook) · ~3.1k★
- **Do not run.** Postinstall hook + missing license = the exact dropper
  pattern the screen exists for. Metadata/README study only, never clone-exec.
- Signal extracted (idea-level): agent-mesh coordination via shared ledgers —
  we already do this better with chain-anchored heartbeats; note confirms our
  direction, no absorption needed.

### 4. The owner-curated channel (pinoyfreecoder github-finds)
- Status: origin serving CF 522 (down/unstable) at 2026-10-18 — verified via
  two independent read-proxies + Turnstile-gated direct + headless click
  attempt (honest failure recorded). The channel stays in rotation inside
  scout.mjs and self-heals when the site revives. No manual step required.

## Standing absorption rule
1. Candidate enters ledger (auto, screened).
2. Pattern brief (this file, append-only) when a candidate shows a reusable IDEA.
3. Implementation is always a NEW original module in our stack, reviewed like
   any other engine change, secrets never involved.
4. Credit ideas in briefs; code stays 100% ours.
