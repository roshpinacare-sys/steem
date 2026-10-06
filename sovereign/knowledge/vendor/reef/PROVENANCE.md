# PROVENANCE — vendored reef docs (r162)

- **Source**: https://github.com/Human-Agent-Society/reef
- **Commit**: `297af97ab0483d0e52169b364c1be70a239453e8` (2026-10-02, main)
- **License**: Apache-2.0 (see upstream `LICENSE`) — verbatim vendoring permitted with attribution.
- **Vendored by**: r162 wave, trace 1a0ffb0043d7ef41, operator pointed the repo
  ("אני חושב שזה גם מאוד רלוונטי תבדוק").
- **Measured at scout time**: 7.5k stars, 694 forks, Apache-2.0, Python 3.12+ (PyPI `reef-infra`),
  last commit 2026-10-02. "Infrastructure for continually self-improving agents" —
  the loop: Serve → Observe → Grow → Commit.

## Why these 5 docs — self-improvement-loop selection

Reef is the reference implementation of what this fleet does by hand: waves
(r-series) = propose; gates (census verdicts, tsc/eslint, init.sh) = evaluate;
git anchors + reverts = commit/revert. The two surfaces:

- **Model weights** (Slime/SGLang RL training) — needs a GPU stack → **out of sandbox scope**, not vendored.
- **Harness evolution** (prompts, rules, skills, control loop; model stays a fixed endpoint) — **exactly our surface** → vendored.

| Vendored doc | Source path (upstream) | Purpose here |
|---|---|---|
| `evolve-your-harness.rst` | docs/user-guide/evolve-your-harness.rst | The full harness-evolution doctrine: tree snapshot → mutation → **paired episodes** → publish-or-revert; selection policy ("candidate wins more than it loses by a margin"); failure-to-suite screens; periodic regression recheck; sandboxed episodes. |
| `write-a-harness-method.rst` | docs/developer-guide/write-a-harness-method.rst | The propose/evaluate contract — the minimal two callables a learning loop needs. |
| `recipes.rst` + `recipes-readme.md` | docs/user-guide/recipes.rst · recipes/README.md | The recipe catalog: what evolves (weights vs harness), what each method needs. Selection map for future learning waves. |
| `AGENTS.md` | AGENTS.md | Their agent-collaboration discipline (evidence-first, no speculative fixes, verification disclosure) — same law family as ours. |

## What the fleet ADOPTS as doctrine (r162, self-demonstrating)

`sovereign/knowledge/selfimprove-doctrine.json` — 7 LOOP rules distilled from the
vendored docs, mapped onto our existing systems. Applied to this very wave:
r162 declares its evaluator BEFORE the edit (census fresh scan unchanged-verdicts +
lint 0 + on-chain receipts preserved), matching LOOP-3.

## Honest non-adoption (this wave)

- Running `reef-infra` itself: needs an OpenAI-style inference endpoint we control
  (the z-ai SDK does not expose one) and another always-on Python service; our loop
  already exists in TypeScript. **Watchlist**, activation route recorded in the doctrine JSON.
- Weight-surface recipes (tttd, sdft, sdpo, sao, openclawrl…): GPU-bound → out of scope.
- Harness recipes needing reef-eval + local training: not runnable here today.
