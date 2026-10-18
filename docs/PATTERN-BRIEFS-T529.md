# PATTERN BRIEFS — T-529 (agent-5 · 2026-10-18)

Law: screen-not-sandbox — verdicts decide whether we may STUDY, never auto-run.
Everything below was read as material, not executed.

## 1. anthropics/claude-plugins-official — PASS (Apache-2.0, 42,339★, official source)

The official marketplace of Claude plugins/skills. Why it matters to a fleet whose
agents are the clients: it is the reference structure for a **skill economy**.

Observable structure (read-only absorption):
- Marketplace manifest (`.claude-plugin/marketplace.json`) → a catalog of plugins,
  each entry = name + source + description. Discovery = a manifest, not a search.
- Each plugin = `plugin.json` (name, version, description) + `skills/`, `commands/`,
  `agents/`, `hooks/` — capability units, individually installable.
- Value pattern: **skills are packages with identity, not prompt fragments**.

Absorption for our fleet (when we build our own skill market for the agents):
- One catalog file, agents read it — same law as our LOCKS/claims registries.
- Capability units individually versioned and installable — same law as our
  vault slots (append-only, identified, verifiable).

## 2. Auto-reconcile (our own pattern, T-529)

Finding: in a living agent economy, truth repos drift BY DESIGN — peers commit
every few minutes (auto-ledgers, exec-cycles). A durability card that shows
BEHIND is honest; a mechanism that closes it is valuable.

Rule set (implemented in SovereignConsole scripts/reconcile-loop.sh):
- fetch + **ff-only pull** — never merge, never rebase, never force
- **never push** — agents own pushes (scout-watch has its own ledger law with
  worktree protection); the loop only consumes
- AHEAD/DIVERGED = LEFT-FOR-AGENT (logged, never touched)
- Result: cockpit environment stays current hands-free; the durability card's
  transient BEHIND states self-heal within one cycle (5 min).

## Standing rules reaffirmed
1. No repo is run before deep audit — even 42k★ official ones.
2. Verdicts (PASS/FLAG/REJECT) gate STUDY, not execution.
3. Everything valuable is Git-first: if it lives only in a sandbox, it does not exist.
