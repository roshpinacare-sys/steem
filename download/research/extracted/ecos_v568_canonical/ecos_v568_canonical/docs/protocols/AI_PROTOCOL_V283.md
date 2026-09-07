# ECOS AI Protocol — V283

**Version:** 283
**Date:** 2026-06-02
**Status:** Canonical

---

## 1. Overview

V283 extends the ECOS AI protocol with notification channel-template binding on top of V282:

1. **Channel registry** — `registerNotificationChannel283` / `deregisterNotificationChannel283`
   maintain a named map of webhook delivery channels.
2. **Template binding** — `setChannelTemplate283(channelName, templateName)` binds a V282 template
   to a channel; `unsetChannelTemplate283` removes the binding.
3. **Digest delivery** — `notifyDigest283(digest, opts)` delivers a digest to all channels,
   rendering the bound V282 template (if any) before delivery.
4. **Dry-run testing** — `testChannel283(channelName, sampleDigest)` renders without sending.

---

## 2. Provider DI Contract Protocol

### 2.1 V283 new contract

| Contract | Agent capability unlocked |
|---|---|
| `notificationChannel` | Channel registry with template binding, digest delivery with per-channel rendering, dry-run test |

### 2.2 Contract total

V283 defines **33 provider contracts** in `providerAdapters283.js`.

### 2.3 `notificationChannel` DI contract

```js
notificationChannel.registerNotificationChannel283(name, opts)
notificationChannel.deregisterNotificationChannel283(name)
notificationChannel.setChannelTemplate283(channelName, templateName)
notificationChannel.unsetChannelTemplate283(channelName)
notificationChannel.getChannel283(name)
notificationChannel.getChannels283()
notificationChannel.notifyDigest283(digest, opts)
notificationChannel.getStatus283()
// optional
notificationChannel.testChannel283(channelName, sampleDigest)
notificationChannel.checkNotificationChannelHealth283()
notificationChannel.getPerf283()
```

---

## 3. Integration Flows

### 3.1 Channel Registration Flow

```
Operator
  │─── POST /api/v283/alerts/channels ──────────────────►NotificationChannel283
  │   { name, url, templateName?, method?, headers? }     │
  │◄── 201 { ok, name, templateName, registeredAt, ... } ─│
```

### 3.2 Template Bind Flow

```
Operator
  │─── PUT /api/v283/alerts/channels/:name/template ─────►NotificationChannel283
  │   { templateName: 'myAlert' }                         │
  │◄── 200 { ok, channelName, templateName } ─────────────│
```

### 3.3 Digest Delivery Flow

```
Service
  │─── POST /api/v283/alerts/channels/notify ────────────►NotificationChannel283
  │   { digest: { totalAlerts: 5, period: 'daily' } }     │──►renderTemplate282 (per-channel)
  │◄── 200 { ok, delivered, skipped, errors } ────────────│
```

### 3.4 Dry-Run Test Flow

```
Operator
  │─── POST /api/v283/alerts/channels/:name/test ─────────►NotificationChannel283
  │   { sampleDigest: { totalAlerts: 3, period: 'weekly'} }│──►previewTemplate282
  │◄── 200 { ok, subject, body, contentType } ─────────────│
```

---

## 4. Versioning Rules

- All new identifiers in V283 end with the suffix `283`.
- No V282 identifier is removed, renamed, or made breaking.
- V283 modules are drop-in replacements for V282 modules.
- Backward-compat aliases (`*282`, `*281`, ...) are preserved unchanged.
- Future versions (V284+) MUST follow the same additive-only, suffix-versioned pattern.

---

## 5. Security Constraints

| Constraint | Enforcement |
|---|---|
| Sacred file guard | `injectionFirewall268` blocks writes to `SACRED_FILES_268` |
| No self-attestation | `reputationLedger268.attest268` throws on `attesterId === subjectId` |
| No self-tipping | `tipModule268.tip268` throws on `fromUserId === toUserId` |
| Replay protection | `x402268` nonce registry consumes each nonce once |
| BigInt-only credits | All μ¢ values use `BigInt`; no float arithmetic on credits |
| Template safety | `renderTemplate282` renders unknown vars as empty string; never throws on missing keys |
| Channel limit | `registerNotificationChannel283` enforces max 200 channels |
| Delivery simulation | `notifyDigest283` records delivery in-memory ring (500 entries); no live HTTP in sandbox |
