# SKILL — pattern cookbook (distilled from Hands-On-AI-Engineering, r165)

Distilled patterns only — no upstream code was copied (license ambiguity, see PROVENANCE). Each pattern names the upstream exemplar we learned it from, our service that should absorb it, and the activation condition.

## P1 — Digest-and-rank loop
- **Exemplar**: `daily-news-digest` (92 curated blogs → score last-24h items → surface top-3 → deliver) and `devable_research_agent` (collect → rank → structured digest).
- **Our surface**: `pulse` (already rotates Hebrew drafts) + `scout-market`.
- **Upgrade when activated**: replace naive rotation with score-then-select across candidates (freshness × significance × novelty), keep digest as evidence artifact.

## P2 — Self-reflective grade-then-retry gate
- **Exemplar**: `agentic_rag_system` (grade retrieved context → rewrite query if failing → generate only after the gate passes).
- **Our surface**: `content-factory` QA step before publish.
- **Activation**: publish gate = draft → self-grade against declared criteria → one bounded rewrite → publish or quarantine. Matches LOOP discipline (declare the evaluator first).

## P3 — Route-then-fallback
- **Exemplar**: `rag_agent_with_database_routing` (router picks among specialized stores; falls back to a web-search ReAct agent when retrieval confidence is low).
- **Our surface**: `decision-brain` (laya System-1 routing) → z-ai LLM fallback. Already doctrine (LAY-3/LAY-4); this adds the explicit confidence-threshold fallback contract.

## P4 — Persistent memory with critic self-grading
- **Exemplar**: `research_assistant_with_memory` (planner/researcher/writer/critic over shared memory, self-grades findings, persists across sessions) and `self_evolving_code_review_agent` (learns conventions from feedback without retraining).
- **Our surface**: `student` (examines probes) + `keeper` (patrol decisions) — persist graded lessons into worklog/doctrine instead of ephemeral logs.

## P5 — Fine-tune-on-own-domain
- **Exemplar**: `text_to_sql_inventory` (fine-tuned Qwen3.5-2B for a narrow NL→SQL task).
- **Our surface**: confirms the `finetune-route` already declared in decision-doctrine.json (laya fine-tune on our Hebrew vote history). Narrow-domain fine-tuning is the standard path, not exotic.

## P6 — Offline-first as a feature
- **Exemplar**: `receipt_expense_tracker` ("fully offline after first run"), `offline_medical_agent`.
- **Our surface**: matches our own law (LAY-6 offline-after-download). Reinforces: every heavy asset is downloaded once, declared in a manifest workspace (FLO-4), then autonomous forever.

## Verdict
Cookbook value: real. Income value: none (key-gated templates). Runnability: none as-is. Adopted as pattern source; revisit P1/P2 when pulse/content-factory next open a quality wave.
