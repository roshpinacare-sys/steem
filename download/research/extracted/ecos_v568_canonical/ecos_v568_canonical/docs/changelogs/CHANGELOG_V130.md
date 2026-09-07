# ECOS V130 — Changelog
**Release Name:** Linguistic Wiring
**Date:** 2026-05-30
**Base:** V129 — Linguistic Sovereignty (~1191 tests, 65 libs, 20 pages)
**Tests:** ~1191 (V129 baseline — no new tests added; wiring + UI only)
**Libraries:** 65 (unchanged — V129 libs wired, not added)
**Pages:** 20 → **21** (new: `apps/web/src/app/language/page.jsx`)

---

## Strategic Focus — V130

V129 built the language intelligence infrastructure.
V130 **wires it into the product** — visible, clickable, and earning.

Three deliverables:

1. **WIRE-01** — V129 language libs + V128 collaboration libs wired into `ecos-api-server.js`
2. **LANG-UI** — live multilingual session page with RTL support
3. **Version bump** — `130.0.0`, banner updated to "V130 — Linguistic Wiring"

---

## What's New

### [V130-WIRE-01] API Wiring — 16 new language endpoints + 8 bridge/collaboration endpoints

**V129 Language Bridge** (`lib/languageBridge.js`, `lib/linguisticIncentiveLedger.js`, `lib/multilingualRouter.js`)
were not yet wired into `ecos-api-server.js`. V130 completes that wiring.

Also wires **V128 Collaboration** (`lib/globalBridgeNetwork.js`, `lib/collaborationEngine.js`,
`lib/globalLimitResolver.js`) which were also unwired.

All 24 new endpoints follow the established pattern: no Sacred File modifications,
additive-only, in-memory state (same as V128/V129 pattern).

#### Language endpoints (16)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/language/profiles` | Set user language profile |
| GET  | `/api/v1/language/profiles/:userId` | Get user language profile |
| POST | `/api/v1/language/detect` | Auto-detect language of text |
| POST | `/api/v1/language/sessions` | Start bridge session |
| POST | `/api/v1/language/sessions/:id/message` | Send message (auto-translated) |
| POST | `/api/v1/language/sessions/:id/close` | Close session + compute rewards |
| GET  | `/api/v1/language/sessions` | Session stats |
| GET  | `/api/v1/language/stats` | Global bridge + router + ledger stats |
| GET  | `/api/v1/language/leaderboard` | Top multilingual contributors |
| GET  | `/api/v1/language/user/:userId/stats` | User linguistic stats + badges |
| GET  | `/api/v1/language/pairs` | Top active language pairs |
| GET  | `/api/v1/language/pairs/:a/:b` | Stats for specific language pair |
| POST | `/api/v1/language/route` | Route two users into appropriate bridge session |
| GET  | `/api/v1/language/suggest/:userId` | Suggest multilingual collaborators |
| GET  | `/api/v1/language/validators/:a/:b` | Certified bridge validators |
| GET  | `/api/v1/language/router/stats` | Router statistics |

#### Collaboration / Bridge / Limits endpoints (8)
| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/v1/bridge/stats` | Bridge network stats |
| POST | `/api/v1/bridge/sessions` | Start cross-jurisdiction bridge session |
| POST | `/api/v1/bridge/sessions/:id/contribute` | Add contribution to session |
| POST | `/api/v1/bridge/sessions/:id/close` | Close bridge session |
| GET  | `/api/v1/bridge/trust/:userA/:userB` | Trust bond between two users |
| POST | `/api/v1/collaboration/events` | Record collaboration event |
| GET  | `/api/v1/collaboration/sessions/:id/health` | Session health check |
| GET  | `/api/v1/limits` | Limit catalog |
| POST | `/api/v1/limits/resolve` | Resolve applicable limits for a user |

---

### [V130-LANG-UI] Language Bridge Page (`apps/web/src/app/language/page.jsx`)

Full multilingual session UI with three tabs:

**Session tab** — the main workflow:
1. Set language profiles for User A and User B (language picker with 20 languages + flags)
2. Start a bridge session → get a `sessionId`
3. Two chat input rows, one per user, each with RTL auto-applied for Hebrew / Arabic / Persian
4. Messages display in a chat bubble UI showing source language, flag, and "↻ translated" badge
5. Close session to finalize rewards

**Leaderboard tab** — live leaderboard from `GET /api/v1/language/leaderboard`:
- User ID, session count, impact score, bonus μ¢, badges

**Stats tab** — live stats from `GET /api/v1/language/stats`:
- Bridge network totals, router stats, supported language chips (purple + RTL label for RTL languages)

**RTL support:**
- `dir="rtl"` applied to input fields and message bubbles for Hebrew, Arabic, Persian
- LangSelect renders `FLAG + name` for all 20 supported languages

---

### Version bump
- `package.json`: `"version": "130.0.0"`
- API server banner: `ECOS API Server V130 — Linguistic Wiring`
- Navigation: `🌐 Language` link added to `apps/web/src/app/layout.jsx`

---

## Sacred Files — Unchanged

```
lib/fiatLedger.js    MD5: 563e9b1f9e67091a5b6527c0a92568e5  ✅
lib/auditLog.js      MD5: e5a5c2c27801d2d03991bc8e5a1df8cb  ✅
```

---

## What's Next (V131)

1. **TRANS-01** — Replace stub `LanguageAdapter` with real provider (DeepL preferred, Google fallback)
2. **STR-01** — Stripe live: `STRIPE_API_KEY=sk_live_...`, real card test
3. **STR-02** — Hosted public demo — single vertical (insurance OR legal)
4. **STR-03** — Validator login flow — replace `NEXT_PUBLIC_VALIDATOR_TOKEN`
5. **HITL-LANG** — Language-aware HITL routing: Hebrew tasks → Hebrew validators first
6. **DB-LANG** — Persist language profiles + bridge sessions to Postgres
   (`language_profiles`, `bridge_sessions`, `linguistic_contributions` tables)
7. **LIMIT-UI** — `apps/web/src/app/limits/page.jsx` (V128 carry)
