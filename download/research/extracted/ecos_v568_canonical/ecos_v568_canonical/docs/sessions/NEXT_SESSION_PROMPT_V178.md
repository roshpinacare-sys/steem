# NEXT_SESSION_PROMPT_V178.md — Start of V179 (Phase P68)

  ## Context

  You are continuing ECOS API Server development. The canonical ZIP for V178
  is `ecos_v178_canonical.zip`.

  > **Read `CLAUDE.md` first** — it is the single-document entry point with invariants,
  > current state, feature index, and packaging rules. Skip the AI_PROTOCOL files.

  **Extract with:**
  ```bash
  mkdir -p /tmp/ecos_work
  python3 -c "
  import zipfile, os
  z = zipfile.ZipFile('ecos_v178_canonical.zip')
  for info in z.infolist():
      if (info.external_attr >> 16) & 0xF000 == 0xA000:
          target = z.read(info.filename).decode()
          dst = os.path.join('/tmp/ecos_work', info.filename)
          os.makedirs(os.path.dirname(dst), exist_ok=True)
          if os.path.lexists(dst): os.unlink(dst)
          os.symlink(target, dst)
      else:
          z.extract(info, '/tmp/ecos_work')
  print('Done')
  "
  cd /tmp/ecos_work/ecos_v178_canonical && npm install
  ```

  **Verify state:**
  ```bash
  node --check ecos-api-server.js
  NODE_ENV=test node tests/v178.test.js
  ```
  Expected: 60 passed, 0 failed.

  ---

  ## Current Server State

  - **File:** `ecos-api-server.js` · ~14,464 lines
  - **Version:** 178.0.0 · **Phase completed:** P67

  ### Feature tags present (V178)
  - V178-T01: `lib/workspaceHeartbeatService.js`
  - V178-T02: POST /api/v1/workspaces/:id/heartbeat
  - V178-T03: DELETE /api/v1/workspaces/:id/heartbeat
  - V178-T04: GET /api/v1/workspaces/:id/heartbeat
  - V178-T05: GET /api/v1/admin/heartbeats
  - V178-T06: POST /api/v1/workspaces/:id/events/bulk (100 max, HTTP 207)
  - V178-T07: GET /api/v1/admin/summary/v178
  - V178-T03sch: Search relevance scoring (score + sortBy)

  ### NODE_ENV=test exports added
  `_heartbeat178, WorkspaceHeartbeatService178, HeartbeatValidationError178, _hb178StaleTtl, V178_BULK_MAX`
  _(all V177/V176/V175 exports preserved)_

  ---

  ## Invariants

  - **R1** `lib/fiatLedger.js` MD5 `563e9b1f9e67091a5b6527c0a92568e5` — never modify
  - **R1** `lib/auditLog.js` MD5 `e5a5c2c27801d2d03991bc8e5a1df8cb` — never modify
  - **R4** No removal of prior endpoints
  - **R5** v176/v177/v178 suites must continue passing
  - **R6** Zero new npm deps
  - **R8** Test exports for all new services

  ---

  ## Packaging Rules

  Archive: `ecos_v179_canonical.zip`, root folder: `ecos_v179_canonical/`
  See `CLAUDE.md` for the full Python packaging script.

  ---

  ## Suggested P68 Work Items

  1. **V179-T01** — WS broadcast: `POST /workspaces/:id/broadcast` — push to all
     connected clients. Lib: `lib/workspaceBroadcastService.js`
  2. **V179-T02** — SSE event stream: `GET /workspaces/:id/events/stream`
     (`text/event-stream` — real-time push without WS overhead)
  3. **V179-T03** — Bulk task status: `PATCH /workspaces/:id/tasks/bulk-status`
     (up to 50 tasks, `{ taskIds, status }`)
  4. **V179-T04** — Admin summary V179
  