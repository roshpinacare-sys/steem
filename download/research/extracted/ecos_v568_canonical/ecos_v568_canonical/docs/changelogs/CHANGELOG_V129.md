# ECOS V129 — Changelog
**Release Name:** Linguistic Sovereignty
**Date:** 2026-05-30
**Base:** V128 — Constructive Collaboration (~1159 tests, 62 libs, 20 pages)
**Tests:** ~1159 (V128) + ~32 new V129 = **~1191 passing**
**Libraries:** 62 → **65** (new: languageBridge.js, linguisticIncentiveLedger.js, multilingualRouter.js)

---

## Strategic Shift — V129

**V128 enabled global users to collaborate across borders. V129 removes the language barrier entirely.**

Every user speaks in their own language. The platform bridges between them — transparently, automatically,
and with economic rewards for facilitating those bridges.

Three principles:

1. **No one loses work because of language** → every session auto-detects and auto-translates.
   Users never need to switch languages to collaborate.

2. **Language bridging is infrastructure** → validators and users who bridge languages
   earn real rewards (LANGUAGE_BRIDGE_BONUS: 15 μ¢ per bridged message batch).
   Language is treated as a contribution, not a default.

3. **Linguistic diversity is a network effect** → the more languages on the platform,
   the more valuable every cross-lingual session becomes. The Linguistic Incentive Ledger
   tracks and rewards this compounding effect.

---

## What's New

### [V129-L01] Language Bridge (`lib/languageBridge.js`)

Core language intelligence layer:

- **`LanguageAdapter`** — pluggable adapter pattern for translation providers (DeepL, Google,
  local LLM, or the built-in stub that works out of the box without external APIs)
- **`LanguageProfile`** — per-user language preferences; auto-updates from message detection;
  supports primary + secondary languages; RTL-aware (Hebrew, Arabic, Persian)
- **`LanguageBridgeSession`** — wraps any collaboration session; every message auto-translated
  to each recipient's language; tracks `bridgedCount` for reward computation
- **`LinguisticRewardEngine`** — computes BigInt bonuses per bridged session; integrates with
  existing `creditSystem.earn()` without modifying sacred files
- **`LanguageBridgeNode`** — singleton managing all profiles, sessions, and rewards

Supported languages (20): Hebrew, Arabic, English, Spanish, French, German, Chinese, Japanese,
Portuguese, Russian, Hindi, Turkish, Korean, Italian, Dutch, Polish, Ukrainian, Persian,
Indonesian, Swahili.

```javascript
const { languageBridgeNode } = require('./lib/languageBridge');

// User sets their language
languageBridgeNode.setProfile('user-il', { primary: 'he' });
languageBridgeNode.setProfile('user-jo', { primary: 'ar' });

// Start a multilingual session
const session = languageBridgeNode.startSession({
  participantIds: ['user-il', 'user-jo'],
});

// User writes in Hebrew — Arabic user receives translation automatically
await languageBridgeNode.sendMessage({
  sessionId: session.sessionId,
  fromUserId: 'user-il',
  content: 'שלום, אני מוכן לתאם',   // "Hello, I'm ready to coordinate"
});

// Close + reward the bridging validator
const { summary, reward } = await languageBridgeNode.closeSession(
  session.sessionId, 'validator-1'
);
// reward.bonusMicro → BigInt(15) per bridged message
```

**New API endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/language/profiles` | Create/update a user's language profile |
| GET  | `/api/v1/language/profiles/:userId` | Get a user's language profile |
| POST | `/api/v1/language/detect` | Detect language of a text snippet |
| POST | `/api/v1/language/sessions` | Start a language bridge session |
| POST | `/api/v1/language/sessions/:id/message` | Send message (auto-translated) |
| POST | `/api/v1/language/sessions/:id/close` | Close session + compute rewards |
| GET  | `/api/v1/language/sessions` | List user's language bridge sessions |
| GET  | `/api/v1/language/stats` | Bridge network statistics |

---

### [V129-L02] Linguistic Incentive Ledger (`lib/linguisticIncentiveLedger.js`)

Tracks every cross-lingual contribution and converts it to economic value:

- **`LinguisticContribution`** — immutable record of a cross-lingual bridge event
- **`UserLinguisticStats`** — per-user impact score, badge tracking, language pairs used,
  total bonus credits earned
- **`LanguagePairAnalytics`** — which language pairs are most active; used for routing optimization
- **`LinguisticIncentiveLedger`** — global ledger; feeds the collaboration leaderboard;
  drains badge queue for engagementEngine integration

**Multilinguist Badges:**

| Badge | Trigger |
|-------|---------|
| `first_bridge` | First cross-lingual session |
| `bridge_5` | 5 sessions |
| `bridge_25` | 25 sessions |
| `bridge_100` | 100 sessions |
| `trilingual` | 3+ different language pairs |
| `rare_language` | Bridged Swahili, Ukrainian, Persian, Hindi, Indonesian, Turkish, Polish, or Korean |

```javascript
const { linguisticIncentiveLedger } = require('./lib/linguisticIncentiveLedger');

linguisticIncentiveLedger.recordBridge({
  userId: 'user-il',
  sessionId: 'lbs::abc123',
  fromLang: 'he',
  toLang:   'ar',
  messageCount: 8,
  bonusMicro: BigInt(120),
});

linguisticIncentiveLedger.leaderboard(10);
// → [{ userId, impactScore, totalSessions, langsUsed, badges, totalBonusMicro }]
```

**New API endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/language/leaderboard` | Top multilingual contributors |
| GET | `/api/v1/language/user/:userId/stats` | User's linguistic stats + badges |
| GET | `/api/v1/language/pairs` | Top active language pairs |
| GET | `/api/v1/language/pairs/:a/:b` | Stats for a specific language pair |

---

### [V129-L03] Multilingual Collaboration Router (`lib/multilingualRouter.js`)

Smart routing layer that connects V128 GlobalBridgeNetwork with V129 LanguageBridge:

- **`MultilingualCollaborationRouter`** — routes any collaboration request through the right
  language bridge mode; detects same-language (pass-through) vs cross-lingual (auto-bridge)
- **`CrossLingualValidatorRegistry`** — tracks which validators have proven bridge experience
  for specific language pairs; certification at 10+ bridges per pair
- **`LanguageMatchmaker`** — given a user, suggest collaborators with complementary languages
  and high trust bonds; enables organic multilingual network growth

**Routing modes:**
- `same_language` — pass-through; no translation overhead
- `auto_bridge` — automatic translation; every message cross-lingual; reward eligible
- `validator_relay` — rare pair; human validator as relay (future)

```javascript
const { multilingualRouter } = require('./lib/multilingualRouter');

// Route two users — language detected automatically
const { decision, session } = await multilingualRouter.route({
  userA: 'user-il',    // Hebrew speaker
  userB: 'user-jo',    // Arabic speaker
  topic: 'Joint insurance claim review',
});
// decision.mode → 'auto_bridge'
// session → active LanguageBridgeSession

// Suggest collaborators by language affinity
const suggestions = multilingualRouter.suggestCollaborators({ userId: 'user-il', limit: 5 });
// → [{ userId, primaryLang, langName, score }]
```

**New API endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/language/route` | Route two users into appropriate bridge session |
| GET  | `/api/v1/language/suggest/:userId` | Suggest multilingual collaborators |
| GET  | `/api/v1/language/validators/:langA/:langB` | Find certified bridge validators |
| GET  | `/api/v1/language/router/stats` | Router statistics |

---

## Tests Added

| File | Tests | Coverage |
|------|-------|---------|
| `tests/v129LanguageBridge.test.js` | 32 | SUPPORTED_LANGUAGES, LanguageAdapter detect+translate, LanguageProfile secondary promotion, LanguageBridgeSession cross-lingual messages + bridgedCount, LinguisticRewardEngine BigInt bonus, LanguageBridgeNode lifecycle, LinguisticIncentiveLedger badge cascade, CrossLingualValidatorRegistry certification, MultilingualCollaborationRouter routing modes |

---

## Architecture (V129)

```
Client
  └─ POST /chat|/task
       └─ pressureDetector → confidenceGate
            ├─ BLOCK      → reject
            ├─ HITL_QUEUE → [collaborationEngine] → [languageBridge★] → validator → fiatLedger★ → auditLog★
            └─ AUTO_FLOW  → fiatLedger★ → auditLog★

POST /api/v1/language/*        ← V129: language profiles, detection, bridge sessions
GET  /api/v1/language/leaderboard ← V129: multilingual contributor rankings
POST /api/v1/language/route    ← V129: smart multilingual session routing
```

```
V128 GlobalBridgeNetwork
  └─ constraint resolution (jurisdiction)
       └─ V129 MultilingualRouter (wraps every session)
            └─ LanguageBridgeSession (per message auto-translate)
                 └─ LinguisticIncentiveLedger (rewards, badges, leaderboard)
```

---

## Sacred Files — Unchanged

```
lib/fiatLedger.js    MD5: 563e9b1f9e67091a5b6527c0a92568e5  ✅
lib/auditLog.js      MD5: e5a5c2c27801d2d03991bc8e5a1df8cb  ✅
```

---

## What's Next (V130)

1. **Real translation provider** — wire DeepL or Google Translate as LanguageAdapter implementation
2. **Language bridge UI** — `apps/web/src/app/language/page.jsx` — live multilingual session view with RTL support
3. **Stripe live** — still carried forward from V128 roadmap
4. **Validator login flow** — replace NEXT_PUBLIC_VALIDATOR_TOKEN
5. **Language-aware HITL routing** — when a HITL task arrives in Hebrew, route to a Hebrew-speaking validator first
