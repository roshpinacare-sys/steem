# SKILL — decision-triage with laya (System-1 layer)

**Purpose**: fast, cheap, offline typed decisions (choice / score / noul) over any text state — 100+ languages including Hebrew — in one forward pass, ~220-450ms on 2 CPUs, zero LLM tokens, nothing generated so nothing hallucinated.

**What it IS**: the System-1 triage layer under our System-2 (z-ai LLM). It pre-filters, classifies, gates, and routes. It does not reason, write, or decide money.

**What it is NOT (yet)**: a vote-worthiness or quality judge in Hebrew. Zero-shot `noul` quality gates produced contradictory answers in our sandbox (see PROVENANCE evidence #6). Activation for money-adjacent gates requires fine-tuning (upstream RLCD path; fine-tuned checkpoint accuracy 0.362→0.766 on their typed-decisions bench) or calibration on OUR labeled history.

## Proven-reliable today (sandbox evidence)

| Use | Pattern | Evidence |
|---|---|---|
| Spam / ad gate | `noul` "האם זה ספאם?" (negative direction) | spam→0.999, diary→0.003 |
| Topic / intent classification | `choice` with concrete per-option criteria | tech post→tech 0.97, Hebrew billing→billing 1.0 |
| Urgency scoring | `score` with ordered levels | churn threat → urgency 1.18/2 |
| Churn-threat detection | `noul` "מאיים לבטל?" | 0.97 on explicit cancel threat |

## Blocked today (honest)

- Resident service under full fleet load: OOM SIGKILL at model load (~2GB peak vs ~1.6GB free). Service code shipped (`mini-services/decision-brain/`, port 3047) with lazy-load + 120s idle unload; it will stay healthy once RAM ≥ 8GB or the ONNX INT8 export (~322MB) route is executed.
- Hebrew vote/quality gates: do NOT wire before fine-tuning/calibration. Distrust until re-proven.

## Invocation (once activation unblocked)

- HTTP: `POST /decide` on port 3047 (browser: `/api/...?XTransformPort=3047` style gateway rules apply), body `{state, questions, model?}`.
- Direct: `/home/z/laya-eval/venv/bin/python` with `from laya import Router; Router(max_loaded=1)`.
- Cache: `HF_HUB_CACHE=/home/z/laya-eval/hf-cache` (644MB multilingual checkpoint, already downloaded).
- Offline: set `HF_HUB_OFFLINE=1` after first download — autonomy preserved.
