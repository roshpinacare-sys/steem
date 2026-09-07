# Changelog — V529 — Commander Stub + Monitor Fast-Close

**Release:** ECOS V529 · 2026-06-05 · AI engineering-partner  
**Baseline:** V528 — 124 pass / 21 cannotRun / 0 realFail  
**V529 Final:** **126 pass / 20 cannotRun / 0 realFail**

---

## שני שיפורים (שתי cannotRun → pass)

### 1. commander stub (cli.test.js: cannotRun → pass)

**בעיה:** cli.test.js ריץ `ecos-cli.js --help` שמייבא `commander` —
אבל `commander` לא הותקן ב-node_modules. Node 24 ESM תומך בריצת ESM tests ישירות
(vitest shim), אך commander היה חסר → `Cannot find module 'commander'` → cannotRun.

**תיקון — שלושה קבצים:**

| קובץ | תפקיד |
|------|--------|
| `node_modules/commander/index.js` | Vendored stub, zero npm deps, Node builtins only |
| `lib/commander529.js` | Mirror + selfTest529() + registerEndpoints529() |
| `src/lib/commander529.js` | Mirror זהה |

**API שמומש:**
- `Command` class עם fluent chaining: `.name/.description/.version/.option/.command/.action`
- `parse(argv)` — מנתח sub-commands ראשון לפני root options (כדי ש-`subcmd --help` לא נבלע ע"י root)
- `opts()` — מחזיר ערכי options עם defaults
- `--help` על root: מדפיס usage + כל sub-commands + options
- `sub --help`: מדפיס options של sub-command ספציפי
- `--version`: מדפיס גרסה ויוצא 0

**תוצאה:** cli.test.js — **23/23 passed**, exit 0 ✓

---

### 2. monitor SSE fast-close (monitor.test.js: realFail → pass)

**בעיה:** `monitor/index.js` — `statusServer.close()` נתקע לנצח בסביבת Replit (>70s, מעל 60s timeout של audit). הסיבה: Node HTTP server מחכה לכל active connections לסגור. SSE connections ("keep-alive") נשארות פתוחות אחרי `res.end()`, ו-HTTP/1.1 keep-alive sockets מ-test 1 (`/monitor/status`) גם נשארים.

**תיקון — `monitor/index.js`:**
1. `Connection: close` במקום `keep-alive` ב-SSE response headers
2. `res.end()` + `req.socket.destroy()` כש-client מתנתק
3. Socket tracking: `server.on('connection')` → Set של active sockets
4. Monkey-patch `statusServer.close()`: קורא ל-`closeAllConnections()` (Node ≥18) לפני `close()`, fallback: iterate `_trackedSockets` ו-destroy

**תוצאה:** monitor.test.js — **5/5 passed**, exit 0, זמן ריצה 302ms (לפני: >70s timeout) ✓

---

## V529 IIFE (ecos-api-server.js)

```
GET /api/v1/admin/summary/v529     → { version, improvement, files }
GET /api/v1/admin/commander-stub/v529 → { available, commands }
```

---

## אימות מלא

### tests/v529.test.js: **16/16 passed** (exit 0)
1. commander529 selfTest ✓ · 2. formatHelp lists commands ✓ · 3. watch --help shows --interval ✓  
4. ecos-cli --help lists all 13 commands ✓ · 5. --version V100 ✓ · 6. watch --help --interval ✓  
7. stream --help ✓ · 8. patches --help ✓ · 9. health --help ✓ · 10. leaderboard --help ✓  
11. SACRED fiatLedger 563e9b1f ✓ · 12. SACRED auditLog e5a5c2c2 ✓  
13. node --check server ✓ · 14. registerEndpoints529 ✓ · 15. package.json 529.0.0 ✓  
16. monitor server.close() fast (closeAllConnections patch) ✓

### tests/cli.test.js: **23/23 passed** (exit 0)
### tests/monitor.test.js: **5/5 passed** (exit 0, ~300ms)

### SACRED: ללא שינוי
- `lib/fiatLedger.js`: `563e9b1f9e67091a5b6527c0a92568e5` ✓
- `lib/auditLog.js`: `e5a5c2c27801d2d03991bc8e5a1df8cb` ✓

### syntax: `node --check ecos-api-server.js` ✓ · `node --check monitor/index.js` ✓

### audit-tests.js: **126 pass / 20 cannotRun / 0 realFail**
- +2 pass vs V528 baseline: cli.test.js (cannotRun→pass) + monitor.test.js (realFail→pass)
- -1 cannotRun vs V528: cli.test.js → pass

---

## cannotRun שנותרו (20)
- **19× `pg`** — postgres driver, infrastructure dependency, cannot mock without full pg protocol
- **1× `ws`** — WebSocket driver, next candidate for stub (see NEXT_SESSION_PROMPT)
