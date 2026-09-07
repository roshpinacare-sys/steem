# CHANGELOG V530

## זוהה
- `ws.test.js` — cannotRun עקב חוסר חבילת `ws` (npm חסום, לא בnode_modules).
- `ws` כולל WebSocket protocol אמיתי (RFC 6455) — EventEmitter stub פשוט לא מספיק.

## מה נבנה
- **`node_modules/ws/index.js`** — vendored ws stub (אפס תלויות חיצוניות):
  - **Client** (`WebSocketClient`): EventEmitter wrapper מעל `globalThis.WebSocket` (Node 22 מובנה).
    מספק `on/off/once/send/close/terminate/readyState`.
  - **Server** (`WebSocketServer`): EventEmitter שרושם HTTP upgrade handler, מממש RFC 6455
    handshake (SHA-1 Sec-WebSocket-Accept), frame parser + encoder.
  - **ServerSocket**: EventEmitter wrapper מעל `net.Socket` עם framing מלא (masked/unmasked).
  - מייצא: `module.exports = WebSocketClient; module.exports.WebSocketServer = WebSocketServer`
- **IIFE V530** ב-`ecos-api-server.js`: `GET /api/v1/admin/summary/v530`

## אימות
- `node --check ecos-api-server.js` → OK
- SACRED md5: fiatLedger ✅ auditLog ✅
- `NODE_ENV=test node tests/v530.test.js` → **10/10 pass, 0 fail**
- `node scripts/audit-tests.js` → **128/147 pass** (↑126), **19 cannotRun** (↓20), **0 realFail**

## מה לא אומת
- 19 cannotRun — כולם pg-dependent (PostgreSQL). לא ניתנים לריצה ללא DB.
- ws.test.js JWT tests עברו (9 tests), אבל ה-ValidatorHub JWT path המלא עם תוקף/פקיעה לא נבדק עמוק.
