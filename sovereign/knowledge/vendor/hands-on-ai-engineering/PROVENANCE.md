# PROVENANCE — vendor/hands-on-ai-engineering

- **Upstream**: https://github.com/Sumanth077/Hands-On-AI-Engineering
- **Pinned HEAD**: `da0091d6452e18dae9fd3119a194019f35306d27`
- **License status (measured, not assumed)**: README badge claims MIT, but **no LICENSE file exists at repo root** → verbatim code vendoring is FORBIDDEN by our rules. Only pattern distillation (ideas/methods) is admissible.
- **Content**: ~70 runnable mini-projects in 6 categories (ai_agents ~40 · rag_apps 11 · multimodal 6 · OCR 4 · audio 3+ · fine_tuning 1). Community cookbook from the "AI Engineering" newsletter (beehiiv).
- **Quality flags (hard evidence, r165)**: unresolved merge-conflict markers committed inside project files (`.env.example` in OCR/image_to_structured_data, OCR/medical_prescription_digitizer, audio/music_explorer contain `<<<<<<< HEAD … >>>>>>> 1d1e9f1`) — aggregation repo, drift-prone, no CI gate.
- **Runnability in our sandbox**: NOT runnable as a system. Every project is key-gated on third-party APIs we do not hold (Mistral, Gemini, OpenAI, MiniMax, DeepSeek, Telnyx, Orq.ai, Firecrawl, …). None expose an income path.
- **Operator request (r165)**: "תראה זה יכול לעזור" — verdict: helps as a **pattern cookbook**, not as a tool. See SKILL-pattern-cookbook.md for the six patterns mapped to fleet services with activation routes.
