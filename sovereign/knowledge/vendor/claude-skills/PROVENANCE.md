# PROVENANCE — vendored claude-skills (r157)

- **Source**: https://github.com/alirezarezvani/claude-skills
- **Commit**: `19392f7a08264ed00486a251f5b2098321771f94` (2026-08-26, main)
- **License**: MIT (see `LICENSE`, © 2025 Alireza Rezvani) — verbatim vendoring permitted with attribution.
- **Vendored by**: r157 wave, trace 1a0ff79fb1b02135, operator pointed the repo ("מה לגבי זה").
- **Measured at scout time**: 388 `SKILL.md` files, 27.3k stars, 1,499 commits. Categories scanned locally via shallow clone.

## Why these 5 (out of 388) — revenue-path selection

Our current measured revenue path is Steem author rewards (content-factory posts, 7-day payout)
plus curation rewards. Post quality ↔ upvotes ↔ author reward $ is the one lever fully under our
control. Secondary: fleet loop robustness (guards/stopping) maps to our guard-pack doctrine.

| Vendored skill | Source path (upstream) | Purpose here |
|---|---|---|
| `copywriting` | marketing-skill/skills/copywriting | Writing quality rules: clarity>cleverness, specificity>vagueness, benefits>features, active voice, no fabricated stats (aligns with our evidence law). |
| `social-content` | marketing-skill/skills/social-content | Hook craft, platform format discipline, repurposing, engagement structure. |
| `content-strategy` | marketing-skill/skills/content-strategy | Searchable vs shareable decision rule; "if neither → don't write it" — a budget gate for post topics. |
| `marketing-psychology` | marketing-skill/skills/marketing-psychology | Honest persuasion models (social proof, loss aversion, framing) — applied only with real numbers, no fake urgency (hard rule 4 of the factory). |
| `loop-library` | loop-library/SKILL.md | Loop audit doctrine: bounded autonomy, verification per cycle, stopping conditions, unsafe-authority checks — maps 1:1 to our guard packs and fleet life policy. |

## Integration

- `sovereign/knowledge/writing-doctrine.json` — distilled, compact craft layer (English) derived
  from the 4 marketing skills; wired into `mini-services/content-factory/index.ts::systemPrompt()`
  as a fail-soft layer (same pattern as the r152 role-library layer). Cache 10 min; read failure =
  run without the layer, never blocks production.
- `loop-library` is doctrine reference only (not wired into any prompt this wave) — feeds future
  guard-pack audits (r158+ candidate).

## Integrity

- Files copied verbatim except path layout (`skills/<name>/SKILL.md` → `<category>/<name>/SKILL.md`).
- No edits to SKILL.md content. License file included verbatim.
