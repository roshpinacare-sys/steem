# NEXT_SESSION_PROMPT_V283.md — Start of V284

## State at V283
- Version 283.0.0. Healthy canonical: sacred intact, all real self-running unit suites green.
- V283 shipped: `notificationChannel283.js` + `providerAdapters283.js` + API patch v283.
  Channel-template binding builds on V282 template engine:
  `registerNotificationChannel283(name, { url, templateName?, ... })` registers a webhook channel.
  `setChannelTemplate283(channelName, templateName)` / `unsetChannelTemplate283(channelName)` bind/unbind.
  `getChannels283()` / `getChannel283(name)` list and fetch channels.
  `notifyDigest283(digest, opts)` delivers with per-channel template rendering.
  `testChannel283(channelName, sampleDigest)` dry-run renders without sending.
  Provider contract 33: `notificationChannel`.

## ⚠️ Pre-flight (do FIRST)
```
node --check ecos-api-server.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
NODE_ENV=test node tests/v279.test.cjs
NODE_ENV=test node tests/v280.test.cjs
NODE_ENV=test node tests/v281.test.cjs
NODE_ENV=test node tests/v282.test.cjs
NODE_ENV=test node tests/v283.test.cjs
```

## Iron rules (unchanged)
- Sacred files immutable (verify md5 before+after). `lib/` mirrors `src/lib/`.
- Suffix new identifiers by version. R6: no new npm deps.
- Relax any hardcoded `version === 'N.0.0'` to `major >= N`.
- Old suites assert per-version docs exist — create the stub if needed.
- Ship ONE `ecos_vNNN_canonical.zip`, root `ecos_vNNN_canonical/`. Verify from re-extract.

## Suggested V284 direction
With channel-template binding live, the next natural move is
**channel filters** — allow channels to selectively receive only certain alert categories:

1. Add `setChannelFilter284(channelName, filterOpts)` — define which alerts to include/exclude.
2. Add `getChannelFilter284(channelName)` — retrieve current filter config.
3. Modify `notifyDigest283`-equivalent in V284 to apply filters before delivery.
4. Add `GET /api/v284/alerts/channels/:name/filter` — show filter.
5. Add `PUT /api/v284/alerts/channels/:name/filter` — set filter.
6. Add `DELETE /api/v284/alerts/channels/:name/filter` — remove filter.
7. Optional: `testChannelFilter284(channelName, sampleDigest)` — dry-run with filter applied.

Keep it chat-first, mobile-light, community-positive. No tradable personal token yet.

## Packaging
`ecos_v284_canonical.zip`, root `ecos_v284_canonical/`.
AI_PROTOCOL_V283.md
CHANGELOG_V283.md
NEXT_SESSION_PROMPT_V283.md
ecos-api-server-v283-patch.js
