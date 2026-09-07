# RECON — Project-files (roshpinacare-sys) — 9-zip investigation

Investigated: 2025 (sandbox recon, read-only). Source: GitHub repo `roshpinacare-sys/Project-files`.
Scope: the 9 zips other than `steem-main (1).zip` (already downloaded separately).
All zips downloaded via the GitHub contents API `download_url`s and extracted to
`/home/z/my-project/download/research/extracted/<short-name>/`. **All 9 downloads and extracts succeeded.**
No project code was executed; no installs were performed. No credentials are stored in this file.

Method: read README/package.json/docs, counted files/tests, sampled core modules
(ledger, rails, custody, audit, policy, escrow), checked CI workflows and release-evidence dirs.

---

## 1. TITAI_v18_VERIFIED_INSTALLER_WITH_ARCHITECTURE (3).zip
- Purpose: **Titai — Canonical Agent Platform v18**. A local-first studio for designing, running, inspecting, governing and recovering AI-agent work: Mission Control + live execution canvas, Evidence Ledger, governed memory, policy-gated tools, human approvals, deterministic zero-key simulation, signed "Sovereign Capability Foundry" packages, Mission Compiler, multi-agent handoffs.
- Stack: Next.js 15, React 19, TypeScript, Tailwind v4, Drizzle ORM + SQLite (better-sqlite3), Auth.js (next-auth 5 beta), next-intl (i18n), React Flow, SSE, Vitest, Playwright.
- Size/structure: 2,340 files; 207 src files, **82 test/e2e files**, docs (ARCHITECTURE, DEPLOY, SKILLS, canonical/sovereignty/reports), installer suite (install/repair/restore/backup/verify/uninstall/start/stop), `.github/workflows/ci.yml` + pilot-validation, SBOM/release evidence. Quality: **8.5/10** — the most "real product" of the ten.
- Most valuable assets: tamper-evident audit chain with `verify-audit` script; **encrypted app backup (AES-256-GCM, atomic restore, overwrite protection, negative tests)**; governed memory ledger (provenance, sensitivity, deletion, expiry); policy compilation + deny-by-default tool gating; durability core (leases, checkpoints, side-effect receipts, reconciliation); installer/repair/restore lifecycle — rare to find this complete.
- Profit logic found: none built-in (it is an internal tool; "commercial model adapters" mentioned, no billing/pricing/marketplace code).
- Protection mechanisms found: audit chain, AES-256-GCM snapshots, context-bound secret encryption, SSRF defenses, CSP/security headers, closed registration, bounded tool schemas, secret scanning, license/model inventories.
- Validation evidence: CI workflows, 82 tests + Playwright e2e, "VERIFIED INSTALLER" naming backed by verify-package.mjs, release evidence PDFs (v11/v12), canonical validation scripts.
- Red flags: enormous scope for one operator; heavy internal "canonical process" overhead (English-only validation, roast checks); version branding v18 vs package 2.2.0; no money logic — value is infrastructure, not revenue.
- Verdict as platform base: **8.5/10** — the most complete, testable, installable product shell; ideal as the console/UX/governance layer of a platform, missing the profit engine.

## 2. V33_30_controlled_human_ux_pilot_instrumentation_patch (2).zip
- Purpose: A **patch release for unified-platform v33.30** ("controlled human UX pilot instrumentation"): comparative human study of Chat/Push governed action with pseudonymous consent, role separation (participant/researcher/instrumentation/observer/verifier), fixed pass thresholds (5 participants, ≥70% step reduction, ≤1 median approval, ≤10 s comprehension, 100% task success), pilot-kit runbooks, consent template, external execution checklist.
- Stack: TypeScript, `node:test`, zero runtime deps.
- Size/structure: 42 files; src patch + docs + release-evidence + pilot kits; bilingual (English/Hebrew) handoff docs. Quality: 6/10 for what it is (a patch), not a standalone product.
- Most valuable assets: the **human-UX-pilot methodology kit** (consent, roles, thresholds, evidence handling) — reusable for any platform's first external users.
- Profit logic found: none.
- Protection mechanisms found: privacy-minimized consent, withdrawal-excludes-evidence handling, signed raw events.
- Validation evidence: release-evidence execution ledger; local proof with 5 synthetic participants; honest verdict `HUMAN_UX_PILOT_REQUIRED` (external participants: zero).
- Red flags: valueless outside the unified-platform context; the pilot never actually ran with humans.
- Verdict as platform base: **3/10** — not a base; harvest the pilot-kit methodology when onboarding real users.

## 3. ecos_v568_canonical.zip
- Purpose: **ecos-b2b-persisted-core v568** — a B2B AI-agent platform with a full "sovereign economy": BigInt microcent fiat ledger, ECOS Credits (1 ⊙ = 10,000 μ¢), pluggable PaymentRails (manual/bank/Stripe/crypto), embedded wallets with custody providers, marketMaker token composite scoring, solvency federation (hash-chained attestation bundles, checkpoint replay trends, dispute alerts, pin continuity), royalties for knowledge patches, compliance proxy.
- Stack: Vanilla Node.js (CommonJS), zero npm deps except `pg`; custom per-version test runners; API-server "wiring" patches.
- Size/structure: 2,474 files; `src/lib` = 731 files of which ~602 are numbered re-iterations of the same modules (marketMaker298→563, embeddedWallet265→268, …); 208 test files; CHANGELOGs V135→V568. Quality: 4/10 structure (an AI-iteration treadmill), 7/10 ideas.
- Most valuable assets: **the economy design docs + primitives** — BigInt-only money math, PaymentRail abstraction (deposit/withdraw chokepoints above the ledger), credit/royalty model backed by real costs, solvency federation attestation chains, embedded-wallet custody interface, composite token health scoring (kurtosis/outlierZ/autocorr/entropy).
- Profit logic found: **yes, extensively** — credits, Stripe/bank/crypto rails, marketplace/royalty economy, marketMaker, payout notifier, escrow (payForProofEscrow209). All simulated/local, none wired to real money.
- Protection mechanisms found: audit chains, solvency proofs, compliance proxy, custody-provider health checks, rate guards in wallets.
- Validation evidence: 208 test files and self-claimed "140 pass / 19 cannotRun / 0 realFail" audits — but its own description admits "meta-test circularity" fixes, i.e. partially self-referential evidence.
- Red flags: massive duplication (39+ marketMaker versions), synthetic economics, self-graded evidence, no real deployment, hard to untangle value from the version treadmill.
- Verdict as platform base: **5/10** — a rich *idea mine* for economy/token/rail design; poor as an actual codebase to build on.

## 4. qodo-v24.30.49-pass76-quota-gauge (2).zip
- Purpose: **Qodo — self-healing, privacy-aware AI agent for autonomous software delivery**: GitHub webhook → Architect → Coder → 5-gate validator (lockfile, blast-radius, DOM, shadow-traffic, chaos-monkey) → Ghost Commit (PR branch) → canary (5% traffic) → merge + SRE auto-revert. Phase checkpointing to Upstash Redis; kill switch (`QODO_HALT`); hash-chained audit log; SHA-pinned "sacred files"; per-category trust ledger; Three.js mission-control dashboard (desktop + Android shell).
- Stack: TypeScript npm workspaces, vitest (~1,139 tests claimed; 90 test files found), React + Three.js dashboard, Cloudflare Workers (telemetry proxy, webhook receiver, AST parser), k6 load/soak tests, k8s/Dockerfile, GitHub Actions CI (`agent-pipeline.yml`).
- Size/structure: 471 files; agent core ≈ 20.5k LOC; apps/mission-control + worker + packages; RUNBOOK/docs incl. verified claims history. Quality: 7.5/10.
- Most valuable assets: the **autonomous delivery pipeline with canary + auto-revert**; **quota-guardian** — tracks free-tier headroom across 13+ AI providers (groq, openrouter, gemini, cerebras…) so the router picks capacity up-front → converts 429s into scheduling = direct cost/margin protection; multi-provider routing; blast-radius validation; ghost-commit audit flow.
- Profit logic found: none direct (devtool), but quota optimization + provider routing is real cost-capture logic; platform-izable as "agent ops as a service".
- Protection mechanisms found: kill switch, secret/path guards, sacred-file SHA pinning, hash-chained audit log, trust ledger, dry-run mode that halts before destructive ops.
- Validation evidence: CI workflow exercising typecheck/tests/build per README; 90 test files; k6 scripts; explicitly quarantines unverified docs into `docs/history/` (good honesty signal).
- Red flags: ~70 env vars across GitHub/Groq/Upstash; README claims need runtime confirmation; directory renamed (Vercel-claude-hebrew-tech-ministry-improvement-7qpqs3) suggesting generated provenance.
- Verdict as platform base: **7.5/10** — the best *intelligence/execution engine*: proven-pattern autonomous pipeline with cost control; needs a product surface and money layer around it.

## 5. srs_sovereign_runtime_substrate_v8.2.0 (2).zip
- Purpose: **Sovereign Runtime Substrate (SRS) 7.0/8.2** — a minimal runtime expressing a 7-primitive taxonomy (Compression, Adaptivity, Scheduling, Verification, Execution, Advice, Quantum) as executable Python modules; self-tests, benchmark table, TLA+ TemporalBankerScheduler spec, plus v6.42→v6.47 program docs (CLOSURE_THEOREM, BULLETPROOF, PROGRAM_CONCLUSION), eBPF/`bpf`, helm deploy, Rust kernel dir.
- Stack: Python 3.9+ stdlib only (srs_runtime ≈ 1,612 LOC), Makefile/Docker/helm artifacts, TLA+.
- Size/structure: 523 files but dominated by docs/evidence; actual runtime is small (11 modules, 2 test files ≈ 20 tests). Quality: 4/10 (doc-to-code ratio heavily skewed).
- Most valuable assets: the **advice-table self-improvement pattern** (2nd run: 0 queries — advice hit), sound verification with ε ≤ 2⁻⁵, 14× compression benchmark, TLA+ banker scheduler spec — good theoretical garnish, not a product.
- Profit logic found: none.
- Protection mechanisms found: verification primitive w/ soundness claims; HOSTILE_AUDIT.md (self-audit doc).
- Validation evidence: self-test/bench results quoted in README; small real pytest suite exists.
- Red flags: grandiose naming (Quantum primitive has "no advantage on identify" by its own admission — BBBV); version inflation; most substance is documentation of prior AI iterations.
- Verdict as platform base: **4/10** — harvest 2–3 ideas (advice tables, verification budgeting), don't build on it.

## 6. tfa-evolution-studio-validated (2).zip
- Purpose: **TFA Evolution Studio v32** — a Next.js platform that takes a project ZIP + an engineering prompt and autonomously plans, executes, validates and packages a new release with evidence: 7-stage evidence-mandated multi-agent debate, persistent engineering memory graph, soak testing, architecture-fitness enforcement, compiler-intelligence pipeline, self-evaluation with multi-pass critique, release-truth gates.
- Stack: Next.js/React, openai SDK, adm-zip, fast-glob; custom script test suites (v22→v32-tests.mjs), smoke-test, self-audit, coherence:check.
- Size/structure: 454 files; 148 src files (app/components/lib), no standard vitest/jest tests (script suites only), `.skills` library (spec-driven documentation, data-analysis refs). Quality: 5.5/10.
- Most valuable assets: the **recursive evolution loop** (ZIP in → verified release ZIP out) — exactly the harness that produced `workspace-v0.0.1`; the evidence-mandated debate protocol; skills library.
- Profit logic found: none direct.
- Protection mechanisms found: security hardening pass (v31.1.0), release-truth and self-critique gates, cross-ZIP audit.
- Validation evidence: "validated" in name; soak/architecture/regression suites scripted; but tests are self-authored scripts, not an independent framework.
- Red flags: meta-loop orientation (builds tools that build tools); no standard test framework; quality of generated outputs depends on the loop itself.
- Verdict as platform base: **5.5/10** — keep as an automation pattern; its best output is the workspace TFA backend (see below).

## 7. unified-platform-v33.56-custody-authority-persistence (2).zip
- Purpose: **"Sovereign Evidence-Carrying Execution Fabric" v33.56** — turns objectives into governed, durable, evidence-carrying work: replicated ledger, fenced leases, authority rotation, containment, emergency quorum, custody ceremonies (HSM threshold recovery, external-custody-ceremony), dependency capsules (hermetic, signed provenance, 3-voter revocation, rollback), transparency prefixes, external-qualification framework. Production authority explicitly `NONE`; promotion blocked by design until external qualification.
- Stack: TypeScript (245 src files, 241 test files, `node:test`), zero runtime deps, TSC build; web/ + web-v20 + web-v33_6 UI dirs; infra (CNCF "sovereign cell", private-server), isolation (WASM-core/WASI/container), verifier-only builds, release-evidence JSONs (14-axis scorecard), 56+ CLAUDE_HANDOFF docs + Hebrew execution reports.
- Size/structure: 3,524 files. Quality: 6.5/10 engineering discipline, 3/10 product usability.
- Most valuable assets: **the protection pattern library** — durable/fenced lease authority daemons, Postgres durable authority, HSM threshold recovery, emergency quorum, replay-ledger, execution-ledger assurance, supply-chain capsule lifecycle with revocation/rollback, break-glass paths, verifier-only reproducible builds.
- Profit logic found: none (deliberately: external mutation not authorized).
- Protection mechanisms found: the deepest in the whole batch — custody, quorum, rotation, containment, revocation, transparency anchors.
- Validation evidence: 241 tests, verifier-only artifacts, evidence scorecards — but all self-generated, local/synthetic; "production authority remains NONE" is stamped on everything.
- Red flags: perpetual-pilot syndrome (every cycle blocks production); crushing documentation ceremony; the actual "product" (governed engineering) is buried; AI-iteration treadmill like ecos.
- Verdict as platform base: **6/10** — the best *source of protection/custody patterns* to port into a real platform; not a usable base itself.

## 8. workspace-v0.0.1 (2).zip
- Purpose: TFA engineering workspace (v0.0.1, output of the Evolution Studio loop). Its crown jewel is **"TFA — Sovereign Trust-as-a-Service Backend"**: a multi-tenant backend giving every autonomous action three guarantees — (1) it happened inside policy (single declarative fail-closed gate, policy-as-data), (2) it is recorded immutably (per-tenant hash-linked audit chain), (3) it is provable to third parties (**Ed25519-signed Action Passports**, verifiable by a zero-dependency script). On top: sovereign ledger (BigInt μ¢ double-entry, `guardMint`/`guardWithdraw` as the only money creation/destruction chokepoints), **escrow + marketplace for agent-to-agent work**, settlement rails, track-record ("Trust Price Discovery": authority earned via proven track record), transparency log, and a **Potential Engine** (strength→opportunity routing; collaboration matches auto-open policy-gated escrows).
- Stack: TypeScript; sovereign lib is zero-dependency (`node:crypto` only) with optional Drizzle/Postgres adapters (in-memory defaults for everything); pnpm workspace; React frontends (approval console, visual regression); SDK (passport-client, escrow-client); bundled GitHub Action; Claude Code hook example (`tfa-pre-tool-use.mjs`); contract-test generator; 52 test dirs incl. integration + contract suites; TEST_AUDIT.json.
- Size/structure: 870 files total; sovereign backend lib = 30 modules (ledger, ledger-orchestrator, escrow, marketplace, passport, policy, potential, rbac, risk, settlement-rails, track-record, transparency-log, agent-identity, mcp-server, indexer…). Quality: 8/10 — small, coherent, heavily documented, tested.
- Most valuable assets: **cost-arbitrage revenue primitive** — computes the spread between best and next-best vendor cost; that spread is the mathematically justified per-action fee ceiling for routing ("the market-implied value of knowing which vendor to pick"); **escrow state machine + threshold approvals + webhook relayer**; double-entry ledger with mint/withdraw chokepoints; passport issuance/verification; break-glass middleware; tenant-export/import; full-economy demo example.
- Profit logic found: **yes — the clearest in the whole batch**: routing-fee arbitrage, agent-to-agent marketplace, escrow-funded engagements, track-record-driven trust pricing. All expressed in exact BigInt μ¢ with fail-closed validation.
- Protection mechanisms found: fail-closed policy gate, structural tenant isolation (`TENANT_VIOLATION` class), hash-linked audit chain, Ed25519 passports, RBAC + risk engine, break-glass with audit, mint/withdraw chokepoints.
- Validation evidence: 52 test dirs (unit + contract + integration), contract-test generator, TEST_AUDIT.json, `<60 s` zero-install quickstart example.
- Red flags: v0.0.1, machine-evolved provenance (EVOLUTION_LOG records TFA directives); scaffolding noise; needs consolidation and a real frontend; passport/ledger security needs independent review before touching real money.
- Verdict as platform base: **9/10** — the only zip that already contains, in one coherent kernel, *profit logic (arbitrage fees, escrow marketplace) + protection (policy gate, audit chain, passports, ledger chokepoints) + intelligence (Potential Engine, track-record scoring)*.

## 9. zip-to-pdf-polyglot-9.1.0 (3).zip
- Purpose: **ZIP↔PDF polyglot builder v9.1.0** — produces a single file that is simultaneously a valid PDF (readable cover page + rendered source) and a valid ZIP (extractable); 10 strategies incl. AES-256-GCM, ChaCha20-Poly1305, RSA-2048; CLI, HTTP API server, MCP server for AI agents, "Polyglot Studio" web UI, security-audit folder.
- Stack: TypeScript, express/multer/cors, MCP; vitest-style test dir.
- Size/structure: 41 files; clean, focused, well-documented. Quality: 7/10 as a utility.
- Most valuable assets: binary polyglot construction strategies; document-embedded encrypted archives; MCP server exposure.
- Profit logic found: none.
- Protection mechanisms found: strong crypto packaging; polyglot doubles as a tamper-evident delivery/proof-of-archive artifact.
- Validation evidence: test dir + thorough README; niche but real.
- Red flags: niche tool; polyglot files commonly trigger antivirus false positives; no platform role.
- Verdict as platform base: **3.5/10** — a gadget; optionally repurpose as "release artifacts as signed self-verifying documents" feature.

---

## RANKING

Ranked as a base (or source) for **the chosen platform** with profit logic + protection + intelligence:

| # | Project | Score | One-line justification |
|---|---------|-------|------------------------|
| 1 | **workspace-v0.0.1 (TFA Sovereign Trust-as-a-Service)** | **9.0** | The only project that already fuses a BigInt double-entry ledger with mint/withdraw chokepoints, escrow+marketplace, a mathematically-justified arbitrage fee model, fail-closed policy gate, hash-linked audit chain and Ed25519 Action Passports — tested, zero-dep, portable. |
| 2 | **TITAI v18** | **8.5** | The most complete, installable, test-covered product shell (console, canvas, approvals, audit chain, encrypted backups, governed memory) — the ideal operator-facing surface, but has no money engine. |
| 3 | **qodo v24.30.49 (quota-gauge)** | **7.5** | The best autonomous delivery/intelligence engine: 5-gate validation, canary + auto-revert, checkpointed phases, kill switch, and a quota-guardian that turns AI spend into a scheduling decision (margin protection). |
| 4 | **unified-platform v33.56 (custody-authority-persistence)** | **6.0** | The deepest protection-pattern library (fenced leases, HSM threshold recovery, emergency quorum, supply-chain revocation) — port patterns, don't adopt the codebase; production authority is permanently "blocked" by its own charter. |
| 5 | **tfa-evolution-studio-validated** | **5.5** | The recursive evolution harness that produced #1; valuable as an automation pattern and evidence discipline, not as a platform. |
| 6 | **ecos_v568_canonical** | **5.0** | Richest *economy design* source (microcent ledger, payment rails, credits/royalties, solvency federation) buried under ~600 AI-regenerated duplicate modules — mine ideas, discard the treadmill. |
| 7 | **srs_sovereign_runtime_substrate_v8.2.0** | **4.0** | Elegant 7-primitive theory with advice-table self-improvement, but ~1.6k LOC of Python under a mountain of self-referential docs. |
| 8 | **zip-to-pdf-polyglot-9.1.0** | **3.5** | Clean niche utility; irrelevant as a platform base; optional "signed self-verifying release artifact" feature. |
| 9 | **V33_30 patch** | **3.0** | A patch to #4 containing a reusable human-UX-pilot methodology kit; nothing standalone. |

### FINAL RECOMMENDATION — TOP 2

**TOP 1 — workspace-v0.0.1 → TFA Sovereign Trust-as-a-Service backend (score 9.0).**
Why: it is the only artifact in the batch that already implements the three pillars the "chosen platform" needs, in one coherent kernel with tests:
- *Profit logic*: the cost-arbitrage primitive defines the per-action fee ceiling as the market spread (charge ≤ spread and the customer still pays less than anywhere else) — a defensible, explainable revenue model; escrow + marketplace capture agent-to-agent work; `guardMint`/`guardWithdraw` chokepoints mean every value movement is controlled and auditable; track-record module enables trust-priced tiers.
- *Protection*: fail-closed policy-as-data gate (unknown action = denied), per-tenant hash-linked audit chain, Ed25519-signed Action Passports verifiable with a public key alone, structural tenant isolation, break-glass middleware, RBAC/risk engine.
- *Intelligence*: the Potential Engine (strengths → opportunities → auto-opened escrows) plus track-record scoring is a native recommendation/intelligence loop.
What to keep as-is: lib/ledger (in-memory + Drizzle/pg adapters), lib/escrow (+ threshold approvals, webhook relayer), lib/marketplace + cost-arbitrage, lib/passport + verify script, lib/policy + rbac + risk, audit chain, SDK + GitHub Action, contract tests.
What to rebuild: a production frontend (the bundled approval console is a stub), a real deployment posture (Postgres + KMS-backed keys instead of in-memory), and consolidation of the machine-evolved scaffolding into a clean repo with CI.
Integration with the existing sovereign multi-chain crypto OS (sovereign ledger, DEX 10 pairs, ETH/SOL/TRON/BTC wallets, encrypted vault, deposit-detection grid, live Next.js console):
1. Wrap the OS's sovereign chain ledger as a TFA `PaymentProvider` (the Drizzle adapter interface is exactly the seam) — μ¢ ledger becomes the off-chain double-entry mirror of on-chain balances; mint/withdraw chokepoints map 1:1 to deposit/withdraw events.
2. Feed the deposit-detection grid into `EscrowService.fund()` — deposits auto-fund escrow agreements; payouts route through settlement-rails with on-chain settlement on ETH/SOL/TRON/BTC.
3. Anchor the per-tenant audit-chain heads and Action Passport hashes on the sovereign ledger (transparency-log → on-chain notarization) for external verifiability.
4. Keep Ed25519 passport signing keys inside the existing encrypted vault; custody/threshold patterns from unified-platform v33.56 (HSM threshold recovery, emergency quorum) can be ported into the vault layer.
5. Expose the marketplace/escrow over the live Next.js console; use the DEX's 10 pairs as the settlement/quote layer for routing fees.

**TOP 2 — TITAI v18 (score 8.5) as the operator surface + governance shell.**
Why: it is the most complete product shell of the batch — Next.js 15/React 19 console, live execution canvas, human approvals, governed memory, tamper-evident audit chain, AES-256-GCM encrypted backups, installer/repair/restore lifecycle, 82 tests + e2e, CI. It lacks money logic — which is exactly what TOP 1 provides — so the strongest platform is **TITAI as the face, TFA sovereign backend as the economic/protection kernel**, with qodo's pipeline (TOP 3) embedded as the autonomous delivery/intelligence engine (its quota-guardian directly protects operating margin), and ecos v568 mined for the credit/royalty/rail economy design where needed.
What to keep from TITAI: mission-control UI patterns, approvals flow, evidence ledger UX, backup/restore, installer.
What to rebuild: replace its SQLite-only durability with the TFA Postgres/ledger core; drop its canonical-process ceremony; unify identity (Auth.js session ↔ TFA tenants/passports).
