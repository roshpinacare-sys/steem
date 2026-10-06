# PROVENANCE — vendor/laya

- **Upstream**: https://github.com/NandhaKishorM/laya
- **Pinned HEAD**: `fa9a2a7070b1789912a49ae24603bbfb1a78b001` (tag `v0.3.24` = `0d581f678fff779d8975389231444c16a2dfd925`)
- **License**: Apache-2.0 (LICENSE verified in shallow clone)
- **PyPI**: `laya 0.3.24` — installed & executed in sandbox venv `/home/z/laya-eval/venv`
- **Checkpoints**: HuggingFace `convaiinnovations/laya-multilingual` (mmBERT-base 322M, fp16, 643.8MB safetensors) — downloaded 2026-…, cached at `/home/z/laya-eval/hf-cache`

## What was taken (distilled, not copied verbatim)

r159/r160/r162 pattern adapted: this vendor holds the **distilled doctrine + service wrapper we wrote**, not upstream source trees. Upstream source remains a shallow clone outside the repo (`/tmp`, ephemeral) and on PyPI; nothing from the repo's code files was copied into this repository except our own `mini-services/decision-brain/server.py`, which imports the PyPI package at runtime.

- `SKILL-decision-triage.md` — our distillation of what laya is, what it reliably does (evidence-backed), and what it does NOT do yet.
- Decision doctrine: `sovereign/knowledge/decision-doctrine.json` (rules LAY-1..LAY-7, measured on our own sandbox runs).

## Hard evidence collected in this sandbox (r162)

1. `pip install laya` on Python 3.12.14 + torch 2.14.1+cpu → `laya 0.3.24 OK`.
2. Checkpoint download 644MB in 12s; model load ~11-24s; warm prediction **212-450ms** for 1-3 typed questions on 2 CPUs (no GPU).
3. **Hebrew works**: billing triage `choice=billing p=1.0`, churn `noul=0.97` on translated README example.
4. **Spam-direction noul works**: obvious spam → `spam_p=0.999`; personal diary → `0.003`; real tech post → `0.058`.
5. **Offline autonomy proven**: `HF_HUB_OFFLINE=1` + `TRANSFORMERS_OFFLINE=1` → predictions continue (212-267ms). Network needed once, for the first checkpoint download.
6. **Zero-shot Hebrew `noul` quality gates are unreliable**: contradictory pairs (spam post got `is_spam=0.999` AND `is_quality=0.992`); tech post judged `vote_worthy_p=0.096`. Choice-based vote decisions also wrong on quality content (`reject=0.59`).
7. **Topic choice is reliable** on Hebrew: tech post → `tech=0.97`; diary → `other/personal`.
8. **Memory block (honest)**: resident model load peaks ~2GB RSS; with the full 9-service fleet running (~1.57GB free) the loader is killed by OOM (SIGKILL, twice, logged in `/tmp/decision-brain.log`). Engine runs fine when memory allows (tests 1-2 ran to completion).
