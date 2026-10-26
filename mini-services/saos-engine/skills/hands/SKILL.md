---
name: hands
description: "Computer-use loop over rendered interfaces (CUA-inspired) — agent-browser drives, DOM anchors + screenshots perceive, an independent VLM judges what is DISPLAYED (fail-closed parsing), all allowlist-leashed and read-only. Use when the machine must verify its own cockpit renders or check its public posts as the public sees them. Triggers — browser, screenshot, self-inspect, presence, vlm, cockpit"
triggers: browser, screenshot, self-inspect, presence, vlm, rendered, bot-wall
laws: allowlist-leash, read-only-no-credentials, sense-class-kept-in-minimum-posture, fail-closed-judge, typed-bot-wall
verification: state/hands.json + PNGs on disk + 27 selftest vectors
when-not-to-use: never navigates outside HANDS_ALLOWLIST, never submits forms or logs in, never treats a Cloudflare wall as a crash or as visibility
---
# Hands rail

The machine's eyes: ACT (agent-browser) → PERCEIVE (DOM + PNG) → JUDGE
(glm-5v via the vision CLI, strict parse) → JOURNAL (state + events).
