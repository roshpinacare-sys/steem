# PROVENANCE — vendor/mini-swe-agent

- **Upstream**: https://github.com/SWE-agent/mini-swe-agent (Princeton/Stanford SWE-bench team)
- **Pinned HEAD**: `04d809ceab9df28f9adaed044884180159172930`
- **Installed**: PyPI `mini-swe-agent 2.4.6` into `/home/z/laya-eval/venv`
- **License**: MIT — verified via PyPI metadata (© 2025 Kilian A. Lieret and Carlos E. Jimenez), full MIT text served by the PyPI JSON API.
- **What it is**: the deliberately minimal SWE agent (~100-line agent class): bash-only actions via subprocess.run, fully linear message history, no tool-calling interface required in text-based mode. >74% on SWE-bench verified. Used by Meta, NVIDIA, IBM et al.

## Sandbox proof (r166, hard evidence)

1. **llm-bridge** built first: `mini-services/llm-bridge/index.ts` (port 3048) — OpenAI-compatible `/v1/chat/completions` over z-ai-web-dev-sdk. Direct curl test: exact-reply contract passed ("BRIDGE-OK", 412ms). litellm direct test: 'BRIDGE-OK2'.
2. **mini-swe-agent 2.4.6 ran a real autonomous task** through the bridge:
   - Task: create `hello_sovereign.py` printing `FLEET-ALIVE-HEBREW: שלום מהצי` and run it.
   - Trajectory: 5 LLM turns, 5 bash actions (`ls` → heredoc create with Hebrew content → `cat` verify → `python3` run → submit), exit clean.
   - Final output captured: `FLEET-ALIVE-HEBREW: שלום מהצי`; file persisted at `/home/z/mini-proof/hello_sovereign.py`.
   - Zero third-party API keys involved.
3. **Two integration lessons (now doctrine MAG-3/MAG-4)**:
   - v2 default path expects native `tool_calls`; with plain-text models use `LitellmTextbasedModel` + `config/mini_textbased.yaml`.
   - Unknown-model cost tracking must be `MSWEA_COST_TRACKING=ignore_errors`; our bridge reports chars/4 token estimates, no invented prices.

## What was taken

Nothing vendored verbatim — the PyPI package is the dependency; this file records provenance + the measured proof. Doctrine: `sovereign/knowledge/agentloop-doctrine.json` (agentloop-doctrine-v1, status=proven-live).
