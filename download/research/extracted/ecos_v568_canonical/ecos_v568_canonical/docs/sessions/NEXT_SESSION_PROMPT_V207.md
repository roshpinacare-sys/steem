# NEXT_SESSION_PROMPT_V207.md — Start of V208 (Phase P97)

## State at V207
- `ecos-api-server.js` parses clean; version 207.0.0; Phase P96 complete.
- New: `lib/systemCapabilities207.js`; `GET /system/capabilities` (V207-T01),
  `GET /workspaces/:id/events/digest/burst` (V207-T02), admin summary (V207-T03).
- Tests: `tests/v207.test.js` (18). Maintained chain green. Relaxed v205/v206 version self-checks to `major >= N`.

## ⚠️ Pre-flight (do FIRST, every session)
```
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v207.test.js    # all pass
NODE_ENV=test node tests/v206.test.js    # all pass
NODE_ENV=test node tests/v205.test.js    # all pass
md5sum lib/fiatLedger.js lib/auditLog.js # 563e9b1f... / e5a5c2c2...
```
- New lib? `require()` it at the TOP of the file (before the `// V186` marker). The V186+ blocks
  are guarded "no module loads after V186 marker" — a require in an appended block fails v186/187/188.
  Also: do NOT add a new `if (NODE_ENV==='test')` block — merge exports into the EXISTING final one
  (tests use `lastIndexOf`). Watch literal `require(` even inside comments (the regex counts it).
- `Identifier '...' already declared` → suffix new identifiers `...208` (BUG-L). `__manus_ec` → BUG-K.
- A prior suite failing only on `pkg.version === '20x.0.0'` → relax to `major >= 20x`.

## Invariants
- R1 sacred immutable · R4 no endpoint removal · R5 all prior suites pass · R6 zero new deps · R8 test exports.

## Strategic direction (from project owner)
The platform should stop accreting micro-endpoints and start consolidating into a higher-order,
chat-first, addictive, community product. Build on V207's capability map:
1. **V208-T01** Capability map → per-domain detail endpoint `GET /system/capabilities/:domainId`.
2. **V208-T02** A "guided actions" catalog: machine-readable list of chat-invokable actions (name, params,
   example) derived from the capability map — the substrate for a chat-first UX.
3. **V208-T03** Onboarding/health score endpoint that scores a workspace's usage breadth across domains
   (drives the addictive "you've unlocked N/12 domains" progression).
4. Admin summary V208.

## Packaging
`ecos_v207_canonical.zip`, root `ecos_v207_canonical/`. See CLAUDE.md.
