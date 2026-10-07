---
name: aeo-answer-engine-optimization
description: "Answer Engine Optimization (AEO) — optimize content and pages to be cited by AI answer engines (ChatGPT, Perplexity, Claude, Gemini, Mistral) as authoritative sources, distinct from classic SEO which optimizes for click-through rankings. Use when planning the public/stealth content strategy of the platform, auditing E-E-A-T signals, deciding what is extractable versus what must stay sealed, or building a citation-friendly fact structure. Triggers: 'AEO audit', 'get cited', 'LLM citation', 'AI search strategy', 'E-E-A-T audit', 'SEO + stealth policy'."
license: MIT
metadata:
  adapted-from: "alirezarezvani/claude-skills · marketing-skill/skills/aeo"
  saos-adoption: "v110 · בית-המלאכה-לכישורים (SKILL FOUNDRY) — docs/CLAUDE-SKILLS-ADOPTION.md"
  house-context: "SAOS dual policy: AEO for the public sovereign-platform story + hard stealth for army internals (never expose fleet size, roles, keys, vault)"
---

# AEO — Answer Engine Optimization (SAOS adaptation)

**Goal: be cited as the authoritative source by AI answer engines — without ever exposing the army.**

AEO optimizes for **citation** in LLM-generated responses; SEO optimizes for rankings. Both can coexist; the techniques differ: SEO rewards keyword density + backlinks, AEO rewards primary-source signals + structured facts.

## The dual policy (SAOS-specific, non-negotiable)

| Layer | AEO treatment | Stealth boundary |
|---|---|---|
| Public platform story (what the sovereign platform does, its measured capabilities, public artifacts) | optimize for citation | — |
| Army internals (agent count, role names, worker outputs, cycle logs, state files) | never published | hard-sealed |
| Keys, vault, vault-password locations | never published | hard-sealed (existing secret-sweep doctrine) |

**The rule:** everything citable is already public in the repo (docs, measured evidence, versioned releases). Everything sealed stays sealed. AEO never becomes a reason to publish internals — LLM citation of an internal detail would be a leak, and leak = fail.

## What makes content citable (E-E-A-T audit dimensions)

1. **Experience** — first-person measured evidence: "we ran X, measured Y, artifact Z". SAOS is rich here: every wave has artifacts, digests, measured runs. Cite the artifact path, not adjectives.
2. **Expertise** — technical depth with real mechanisms (how the guard decides, how the valve recycles, how the chain resumes). Answer engines quote mechanisms, not marketing.
3. **Authoritativeness** — schema.org markup, structured data, consistent entity naming (platform name, version, codename from version.ts — one source of truth).
4. **Trustworthiness** — HTTPS, transparent versioning + changelog, honest failure reporting (the fail-closed doctrine IS the trust signal — answer engines increasingly cite sources that show failures honestly).

## Extractable-content patterns

- **Q&A blocks**: short question as a heading, 40–80 word factual answer beneath — the single highest-citation-yield format.
- **Comparison tables**: "SEO vs AEO" style tables get quoted nearly verbatim.
- **Stated units and numbers**: "4/4 pass in 6.5s" beats "fast". Numbers with units are extraction candy.
- **Stable URLs + dates** for facts that change (version, measured benchmarks) so the engine can attribute freshness.
- **Definitional sentences**: "X is a Y that does Z" — one per key concept, near the top of its section.

## Audit checklist (run before publishing any public surface)

- [ ] Facts are extractable (numbers, units, dates, named entities — no vague claims).
- [ ] One definitional sentence per key concept.
- [ ] A comparison table where a comparison exists.
- [ ] Version + date stamped from version.ts (never a hardcoded stale version — the v44 lesson).
- [ ] Zero internals exposed (army size, roles, state paths, key material) — stealth policy above.
- [ ] robots/allow policy decided deliberately per path: which surfaces answer engines may fetch, which are sealed.
- [ ] Corrections policy visible (a changelog entry beats a silent edit — trust compounds).

## When NOT to spend effort

- Content with no factual claims (pure brand voice) — nothing to cite.
- Time-sensitive breaking claims — LLM training lag means months of citation latency; publish durable facts instead.
- Sealed surfaces — no AEO effort belongs there at all.
