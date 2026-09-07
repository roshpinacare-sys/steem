---
name: design
description: Design system + Tailwind token discipline. Trigger on requests about colors, typography, layout, hero sections, or "make it pretty".
type: design
---

# Design skill (V225)

Rules the agent MUST follow when generating UI:

1. **Tokens, not literals.** Never emit `className="text-white bg-black"` in components. Define semantic tokens (`--background`, `--foreground`, `--primary`, `--accent`, etc.) in `src/styles.css` and reference them via Tailwind utilities (`bg-background`, `text-foreground`).
2. **Pick a direction and execute with conviction.** Brutally minimal, maximalist, retro-futuristic, editorial, art deco — choose one and stick to it. No two projects should look the same.
3. **Typography pair > generic Inter.** Pair a distinctive display font with a refined body font. Avoid the default AI-aesthetic (Inter on white with purple gradient).
4. **One hero animation > scattered micro-interactions.** Framer Motion or CSS keyframes; one well-timed thing creates more delight than ten hovers.
5. **Dark mode is part of the design system**, not a toggle bolted on. Both `:root` and `.dark` must have full token coverage.

## Recommended palette presets

(Inline subset — see the host knowledge base for the full curated list.)

- **Midnight Indigo** — deep navy + electric indigo accents (tech).
- **Paper & Ink** — off-white + rich black (editorial / Swiss).
- **Terracotta & Sage** — earthy terracotta + sage green (natural).
- **Neon Mint** — dark base + bright mint accent (startup energy).
- **Noir & Gold** — black + luxurious gold (premium).
