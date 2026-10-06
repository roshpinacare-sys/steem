---
name: fleet-conventions
description: Hard laws of the sovereign fleet — sticky footer, shadcn/ui first, no indigo/blue unless requested, relative API paths with XTransformPort, z-ai-web-dev-sdk backend-only, prisma schema rules, port 3000 only, mobile-first responsive, long-list scroll caps, reserved grid orderid band (money services must never touch grid orders).
user-invocable: true
---

# Fleet Conventions (Sovereign Laws)

Apply these rules when reviewing any diff in this repository. A violation of a rule marked **[BLOCKER]** means verdict=block for that finding.

## Layout & UI

- **[BLOCKER] Sticky footer**: every page with a footer must use a root wrapper `min-h-screen flex flex-col` and the footer must carry `mt-auto` — footer sticks to viewport bottom on short pages and is pushed down naturally on long ones. Never `fixed` overlays over content.
- shadcn/ui components from `src/components/ui` are preferred over hand-rolled equivalents. Rebuilding an existing shadcn primitive from scratch is a finding (severity major).
- **[BLOCKER] Colors**: no `indigo`/`blue` classes or hex unless the user explicitly requested them. Violations: `text-indigo-500`, `bg-blue-600`, `#3b82f6` etc.
- Cards: consistent padding (`p-4`/`p-6`) and spacing (`gap-4`/`gap-6`); misaligned mixes are findings (minor).
- Long lists: cap with `max-h-96 overflow-y-auto` + custom scrollbar styling; unbounded renders of long lists are findings (major).
- Responsive: mobile-first; interactive elements ≥44px touch targets; missing `sm:/md:/lg:` breaks on new full-screen layouts are findings (major).
- Accessibility: semantic `main/header/nav/section/article`, alt text on images, `sr-only` where needed, keyboard-reachable controls.

## API & Network

- **[BLOCKER] Relative API paths only** in frontend code. `fetch('http://localhost:PORT/...')`, absolute URLs, or ports written directly in the URL are violations. Cross-port calls must use the `?XTransformPort=` query form: `fetch('/api/test?XTransformPort=3030')`.
- **[BLOCKER] z-ai-web-dev-sdk is backend-only.** Any import of it in client code (`'use client'` files, components) is a blocker.
- WebSocket/socket.io connections must be `io("/?XTransformPort={port}")` with path `/` — never `io("http://localhost:{port}")`.
- API routes live under `src/app/api/*/route.ts` — use API routes, not server actions, for backend endpoints.

## Runtime & Build

- **[BLOCKER] Port 3000 only** for the Next.js dev server (the main app, src/). Any code binding or hardcoding another port for the main app is a violation. **Mini-services (`mini-services/*`) are the exception — they are separate processes and MUST define their own fixed port (3033+) hardcoded in their entry file; that is the required pattern, NOT a finding. Using a PORT env var there would be the violation.** A hardcoded port ≥3033 inside `mini-services/` is correct code — never a blocker.
- Never invoke `next build` in dev flows; lint via `bun run lint`.
- `'use client'` / `'use server'` directives must be first line of the file **when used, and they apply ONLY to files under `src/` (the Next.js tree)**. Files under `mini-services/**` are standalone Bun backend processes — they must NOT carry these directives, and **flagging their absence there is a false positive**: it must be discarded, not reported as a finding (blocker or otherwise).
- User-visible surface is the `/` route (`src/app/page.tsx`); introducing additional top-level user-facing routes is a finding (major) unless operator requested them.

## Data

- Prisma schema lives in `prisma/schema.prisma`; the SQLite db file lives in `db/`.
- **[BLOCKER]** Prisma schema field types cannot be bare lists (`String[]` etc. forbidden by our setup) — use a relational model or JSON string field.
- State management: Zustand for client state, TanStack Query for server state; ad-hoc global singletons are findings (minor).
- No test files — adding `*.test.ts`/`*.spec.ts` scaffolds is a finding (minor) in this repo.

## Trading & Money

- **[BLOCKER] חוק-טווח-הפקודות השמור למנוע-הגריד (r190)**: טווח-ה-orderid `[1_000_000_000, 1_500_000_000)` שמור בלעדיות למנוע-הגריד (`mini-services/market-maker`, חוזה-צי משותף עם money-mover); orderid-גריד = `1_000_000_000 + ((⌊ts/1000⌋×16 + level×2 + side) mod 500_000_000)`. orderid של money-mover הוא סכמת-יום (למשל `2026100491` ≈ 2.02G) — אין-חפיפה בין הסכמות. **כלל-הברזל: אף שירות-מסחר בצי לא מבטל, נוגע או מחשב-מצב על פקודה ש-orderid שלה בתוך הטווח השמור — לעולם.** חובה: סינון `isGridOrder(orderid)` (בדיקת-טווח אחת) לפני כל ביטול, סקר-אימות (poll שמחכה להיעלמות-orderid) וחישוב-דלק/מצב של השירות-עצמו; בתצוגה למפעיל — כל הפקודות עם שדה `origin: "grid" | "mover"`. סכמת-המעבר r189-v1 (`ts×16 mod 2^31−1` ≈ 700M–900M) מוגנת-גם-היא בתקופת-המעבר (פקודות-ישן עשויות-להיות-חיות עד פקיעתן). למה: r189-c נמדד חי — cancel-all של המוביל במחזור-reprice מחק 10 פקודות-גריד חיות מהשרשרת; תיאום-היתרות אינו מספיק, רק הטווח השמור הוא גבול-אמת. עוגן-המימוש: `src/app/api/money/route.ts` (GRID_ORDERID_BAND · GRID_ORDERID_LEGACY · isGridOrder).

## Process

- Do not nitpick style/formatting. Findings must cite `file:line`, the problem, why it matters, and a concrete fix.
- Missing loading/error states on new async UI paths is a finding (major): show spinners/skeletons, actionable errors, toasts for feedback.
