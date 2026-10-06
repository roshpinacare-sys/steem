---
name: openreview-review
description: "Use when running, interpreting, or extending the SAOS self-review engine (the ביקורת plane) — the two-phase loop (phase-A skill-select over metadata-only review-skills, phase-B evidence-schema findings), the integrity-lock law (any drift in review-skills/*/SKILL.md vs review-skills-lock.json refuses the run fail-closed), the consent ledger (approved/rejected reactions), and the exact-match apply law (approved-only, src/** only, exactly-one occurrence of the old block else drift fail-closed, /tmp backup before write). Enforces the strix boundary wall (repo-tree only), scope caps 14 files / 64KB per-file / 384KB total, and the honest terminal vocabulary."
license: MIT
metadata:
  adapted-from: "vercel-labs/openreview — the open-source PR-review bot (measured exam: clone @672deb2, MIT; skills vendored from .agents/skills — 6 libs, 95 files, ~313KB; react-native lib SKIPPED honestly)"
  saos-adoption: "v114.0.0 ביקורת (openreview adoption) — docs/OPENREVIEW-ADOPTION.md (rebuild-v114 wave, restored from the recovery-v110 spec; version line stays v113.0.0)"
  code-level: "src/lib/saos/review-skills.ts — parseFrontmatter (openreview port) + listReviewSkills (metadata-only) + loadReviewSkill (path-jailed, Map-cached) + verifyReviewSkillsLock (sha256(path+NUL+content+NUL per sorted file), drift fail-closed) + buildSkillsPrompt · src/lib/saos/selfreview.ts — two-phase engine, budget 12 calls/180s, consent ledger, exact-match apply"
---

# OpenReview Review (SAOS adaptation)

The ביקורת plane turns "review our own code" into a **gated, measured, two-phase loop with a consent-gated apply path**. The engine reviews the house with the house's own vendored skills — and refuses to run at all if the skills' integrity lock drifted.

## What the wave adopted (the four laws)

1. **Progressive skill loading** (openreview `lib/skills.ts` semantics): the phase-A prompt embeds ONLY `{name, description}` of each vendored skill (`review-skills/*/SKILL.md`, 6 libs) — never bodies. `loadReviewSkill(name)` loads the full text on demand, path-jailed inside `review-skills/<name>/`, `.md` only, Map-cached. The model may request exactly one skill by name; abstention (`skill:null`) is an honest "no-skill-needed" path (phase-B then runs on the baseline law).
2. **Integrity lock** (`review-skills/review-skills-lock.json` — the lock lives INSIDE the dir; code reads exactly that path): for every skill, recompute sha256 over the concatenation of `(rootRelativePath + NUL + content + NUL)` per file, files sorted byte-wise ascending by root-relative path; compare `computedHash` + `fileCount` + `bytes`. ANY drift → `{ok:false, drifted:[names]}` and the self-review engine **refuses to run** (fail-closed, `blocked` terminal, `driftStatus:"drift"` persisted).
3. **Evidence schema with mandatory counterEvidence**: every finding must carry `{file (scoped set only), title, severity, evidence, poc?, confidence, rationale, counterEvidence (the strongest argument why this might be a false positive), severityChangeConditions?, fixEffort?, cwe?, fixSuggestion?}`. A finding missing counterEvidence is **rejected by the validator** — never silently dropped; it lands in `rejectedCount` (honest).
4. **Consent-gated exact-match apply** (openreview reactions → SAOS consent ledger): `applyFinding` requires `reaction === "approved"` (explicit owner consent — absence/refusal is NOT consent, 409 refusal), a non-empty exact-match block (`fixSuggestion` as JSON `{"old","new"}` or fenced `--- old ---/--- new ---`), target under `src/**` only, the old block present in EXACTLY ONE occurrence (0 or ≥2 → `driftStatus:"drift"`, nothing written), and a backup written to `/tmp/saos-review-backups/<ts>-<basename>` before the write. Only then `appliedAt` + `driftStatus:"applied"`.

## When to use

- Before/after a code wave: run `POST /api/saos/review {action:"run"}` (bearer or cookie) — default scope is smart (`git diff HEAD --name-only` filtered through the scope law; falls back to the freshest `src/lib/saos` files). Owner can pass explicit `files[]`.
- When a run reports findings: read each finding's counterEvidence FIRST — it is the built-in falsification path. React `approved`/`rejected` (`action:"react"`); apply only after approval (`action:"apply"`).
- When the board shows `integrity.ok:false`: do NOT run, do NOT hand-edit skills to "fix" hashes — re-vendor from source and regenerate the lock.

## Scope law & caps (refuse before touch)

Repo-tree paths only, via the strix wall (`assertInBoundary`/`inBoundary`). Excluded: node_modules · .git · .next · .secrets · upload · agent · db · mini-services · screenshots · public (covered by other gates) + cache/junk dirs + binary extensions + secret-named files (`.env*`, `*.pem`, `*.key`, …) are NEVER read. Caps: 14 files · 64KB per-file · 384KB total — over-cap is an honest `blocked` refusal naming the tripped cap (the per-file cap is 64KB, raised from the lost timeline's 48KB: version.ts measures 55.8KB and shell.tsx 49.9KB — at 48KB both core files were cut from review).

## Budget & honesty

≤12 LLM calls per run (phases + one JSON-repair), 180s wall budget enforced via Promise.race before each call; exceeded → `exhausted` terminal with a Hebrew reason. JSON extraction: first `{` … last `}` then parse; ONE budgeted repair call (max_tokens 2000); second strike → `fail`. Every run persists to `ReviewRun` (status, terminal, phaseAJson, scopeJson incl. rejected list, tokens from real SDK usage fields else 0, ms, driftStatus) and every surviving finding to `ReviewFinding`. Terminals: success · no-op · blocked · approval-required · exhausted · stagnated · fail (loop-discipline law; an error is never success).

## API

- `GET /api/saos/review` — public board: kpis, scopeLaw, evidenceLaw, caps, lastRun, recentRuns (10), findings (20), skills metadata, live integrity stamp. **Flat envelope** — payload at the top level (`{ok:true, ...}`), never nested `{ok, review:{…}}` (v112/v113 live lesson).
- `POST /api/saos/review` — requireAuth; 64KB body cap; 4s rate-limit; oplog+audit per POST including refusals. `run` (409 if already in-flight; 403 `refusedBeforeTouch` for boundary/cap/lock refusals) · `react` · `apply` (409 on consent/match refusals, 404 on unknown finding).

## Honest limits

The engine reviews what is IN the scoped files — no cross-repo reasoning, no running tests, no dependency CVE scan (that is other gates). Phase-A skill choice is one-shot and metadata-based; a wrong lens is possible — the rationale is persisted in `phaseAJson` for audit. The apply law is deliberately conservative: multi-occurrence and post-review drift both refuse; large refactors never apply automatically.

## Provenance & boundaries

Adapted from **vercel-labs/openreview** (MIT, @672deb2; skills originate from vercel-labs/next-skills + vercel-labs/agent-skills, MIT, vendored with provenance in the lock). Stolen: progressive disclosure, skills-lock integrity semantics, reactions→consent-gated application, suggestion-block exact-match discipline, metadata-only prompting. **Refused**: the on-Vercel-centric runtime (Sandbox/Workflow/KV), GitHub-App/webhook plumbing, the Claude-only model binding, the in-memory-fallback persistence. The vendored `review-skills/` assets are tracked with `review-skills-lock.json` as integrity canon; `skills/openreview-review/` is tracked as a house artifact (`.gitignore` exception).
