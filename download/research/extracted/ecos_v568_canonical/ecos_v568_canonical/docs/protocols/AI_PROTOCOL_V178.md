# AI Protocol — V178

  ## Version: 178.0.0 | Phase: P67

  **Sacred files (MUST NOT MODIFY):**
  - `lib/fiatLedger.js` MD5:`563e9b1f9e67091a5b6527c0a92568e5`
  - `lib/auditLog.js` MD5:`e5a5c2c27801d2d03991bc8e5a1df8cb`

  **New lib modules added in V178:**
  - `lib/workspaceHeartbeatService.js` — WS presence heartbeat tracker (ping/disconnect/getStatus/listActive/stats/shutdown, presenceCallback hook, zero deps)

  **Existing routes upgraded (no new files):**
  - Search route (`V172-T01 + V177-T02`) — adds `score` field + `sortBy=relevance|date` param

  **DB Phase:** 45 (unchanged — heartbeat and bulk events are in-memory only)

  **Endpoints added:** V178-T02…V178-T07 (6 endpoints + 1 search upgrade; total ≥ 220+)

  **Tests:** `tests/v178.test.js` — 60 tests ✓ PASS

  **Zero new npm deps (R6):** `workspaceHeartbeatService.js` uses only Node.js built-ins.

  ## Quick invariant check
  ```bash
  NODE_ENV=test node tests/v178.test.js
  NODE_ENV=test node tests/v177.test.js
  node scripts/check-sacred-files.js
  ```

  ## See also
  - `CLAUDE.md` — unified entry point (replaces hunting through AI_PROTOCOL files)
  - `CHANGELOG_V178.md` — full feature documentation
  - `NEXT_SESSION_PROMPT_V178.md` — next session start instructions
  