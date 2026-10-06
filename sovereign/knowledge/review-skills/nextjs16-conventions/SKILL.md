---
name: nextjs16-conventions
description: Next.js 16 App Router review rules — async params/searchParams/cookies/headers must be awaited, middleware renamed to proxy, RSC boundary violations, hydration mismatch causes, route handler and metadata conventions. Pattern-level knowledge distilled in our own wording.
user-invocable: true
---

# Next.js 16 Conventions (Review Rules)

Apply these rules when the diff touches Next.js app code.

## Async Request APIs (15+ / 16)

- `params`, `searchParams`, `cookies()`, `headers()`, `draftMode()` are **async** — they must be `await`ed. Sync access (`props.params.id` without await) is a finding (blocker-level: runtime break).
- `generateStaticParams` / `generateMetadata` signatures follow the same async rule.

## Middleware → Proxy Rename (v16)

- `middleware.ts` was renamed to `proxy.ts` in Next 16. A new `middleware.ts` file in a diff is a finding (major — deprecated convention).

## RSC Boundaries

- A `'use client'` component cannot be `async`. Async client components are findings (blocker).
- Props crossing the server→client boundary must be serializable: no functions, class instances, Dates-as-is without handling. Non-serializable props are findings (major).
- Server-only code (secret keys, SDKs marked server-only) must not be imported from client components.

## Hydration

- Browser-only APIs (`window`, `document`, `localStorage`) touched during server render cause hydration mismatch — findings (blocker when in render path).
- Nondeterministic rendering (`new Date().toLocaleString()` without stable locale/timezone, `Math.random()` in render) without a mounted gate is a finding (major).

## File Conventions

- `error.tsx`, `global-error.tsx`, `not-found.tsx`, `loading.tsx` are the designated boundary files; missing error boundary on a new route segment with async data is a finding (minor).
- Route handlers belong in `app/api/**/route.ts` exporting named methods (GET/POST/...).
- Metadata: static via `export const metadata`, dynamic via `generateMetadata`.

## Directives

- `'use client'` / `'use server'` must be the first statement of the file when present.
- `'use cache'` is the cache directive in 16 (with `cacheLife` / `cacheTag`); legacy `unstable_cache` usage in new code is a finding (minor).

## Process

- Cite `file:line`, state problem → why it matters → concrete fix. No style nitpicks.
