# TFA — Operations Runbook

> **Audience:** on-call engineers and DevOps.  
> **Scope:** startup, shutdown, backup/restore, key rotation, break-glass, common incidents.  
> **Version:** v434

---

## 1. Quick Reference

| Action | Command |
|--------|---------|
| Start server | `node src/http/sovereign-server.ts` |
| Health check | `curl http://localhost:7700/healthz` |
| Readiness check | `curl http://localhost:7700/readyz` |
| Run migrations | `node scripts/migrate.mjs` |
| Full audit | `node scripts/ecos-audit.mjs --full` |
| Ledger monitor | `node scripts/ledger-monitor.ts` |
| Dump stores (backup) | `node scripts/dump-pg-stores.mjs <output.json>` |
| Load stores (restore) | `node scripts/load-pg-stores.mjs <input.json>` |
| Verify passport | `node scripts/verify-passport.mjs <passport-json>` |
| Check environment | `node scripts/check-env.mjs` |
| Visual-regression check (frontend snapshots) | `node scripts/visual-regression-check.ts` (`--update` to regenerate goldens) |
| Install PQC provider | `node scripts/install-pqc-provider.mjs [--check]` |

---

## 2. Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `TFA_SECRET` | Yes (prod) | — | HMAC signing key (min 32 chars) |
| `DB_URL` | Yes (when `TFA_PERSIST=pg`) | — | PostgreSQL connection string |
| `TFA_PERSIST` | No | `memory` | Set to `pg` for durable persistence |
| `PORT` | No | `7700` | HTTP listening port |
| `TFA_REQUIRE_API_KEY` | No | `0` | Set `1` to require API keys on all requests |
| `TFA_ENV_CHECK_SKIP` | No | `0` | Set `1` to skip startup env validation (tests only) |

| `TFA_SIGNER_KIND` | No | `ed25519` | Signer algorithm: `ed25519` \| `hmac` |
| `TFA_SSO_JWT_SECRET` | No | — | Enables `Authorization: Bearer <jwt>` tenant resolution (enterprise SSO, v321). Unset = path inert, no behavior change. Minting recipes (Okta/Azure AD) in `docs/IDP_INTEGRATION.md` (v322). |

**Fail-closed boot:** If `TFA_PERSIST=pg` is set without `DB_URL`, the server refuses to start. Run `node scripts/check-env.mjs` before startup to validate configuration.

**Rate limiting:** The default tenant rate limit is 60 requests per minute. Per-route overrides are hardcoded in `src/http/sovereign-server.ts` (e.g., `/api/ledger/mint` at 30/min). There is no runtime env var for this — change the code and redeploy.

---

## 3. Starting the Server

### Development (in-memory)
```bash
TFA_SECRET=dev-secret-32-chars-minimum node src/http/sovereign-server.ts
```

### Production (PostgreSQL)
```bash
TFA_SECRET=$SECRET \
DB_URL=postgresql://user:pass@host:5432/tfa \
TFA_PERSIST=pg \
TFA_REQUIRE_API_KEY=1 \
PORT=7700 \
node src/http/sovereign-server.ts
```

### Container (Docker / Kubernetes)
```dockerfile
CMD ["node", "src/http/sovereign-server.ts"]
```
```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 7700
  initialDelaySeconds: 5
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /readyz
    port: 7700
  initialDelaySeconds: 5
  periodSeconds: 10
```

---

## 4. Health Probes

### GET /healthz — Liveness
Returns `200 {"status":"ok"}` when the process is alive.  
Returns `503 {"status":"draining"}` once graceful shutdown has begun.

**Use:** `livenessProbe` — restart the pod if this fails.

### GET /readyz — Readiness
Returns `200 {"status":"ok","checks":{...}}` when ready to serve traffic.  
Returns `503 {"status":"not ready","checks":{...}}` with failing checks named.

**Checks:**
- `draining` — not in shutdown state
- `db` — `SELECT 1` succeeds when pool is configured
- `solvency` — last ledger audit showed no insolvent tenants (optimistic if monitor hasn't run yet)
- `chain` — audit chain integrity verified on a sample tenant
- `pqc` — active signer algorithm; `sim: <algorithm>` when the zero-dep PQC simulation fallback is active (informational only — never fails readiness; ops should alert on the `sim:` prefix and install a real compiled provider)

**Use:** `readinessProbe` — remove from load-balancer rotation if this fails.

---

## 5. Graceful Shutdown

The server handles `SIGTERM` for graceful shutdown:
1. Sets `draining=true` — health probes return 503 immediately.
2. Calls `server.close()` — stops accepting new connections.
3. Calls `closeIdleConnections()` — closes idle keep-alive sockets (Node 18.14+).
4. Waits up to 10 seconds for in-flight requests to complete.
5. Calls `closeAllConnections()` — forcibly closes remaining sockets.
6. Closes the DB pool.
7. Stops the solvency monitor.
8. Exits with code 0.

**Send SIGTERM:**
```bash
kill -TERM <pid>
# or in kubernetes: kubectl delete pod <pod-name>
```

**Force kill (last resort — after SIGTERM timeout):**
```bash
kill -9 <pid>
```

---

## 6. Database Migrations

Run before first boot and before deploying a new version:
```bash
node scripts/migrate.mjs
```

The script is **idempotent** — safe to run multiple times. It creates all 33 tables with `IF NOT EXISTS` and reports what was created vs. already existed.

**Never run DDL manually** — always go through `migrate.mjs`.

---

## 7. Backup and Restore

### Backup (dump pg-stores)
```bash
node scripts/dump-pg-stores.mjs tfa-backup-$(date -u +%Y%m%dT%H%M%S).json
# Output: JSON with meta.version="tfa-backup-v1" and all table data
```

Backs up: audit chain, ledger accounts, escrow agreements, passports, track records, execution state, API keys, and transparency log.

### Restore
```bash
node scripts/load-pg-stores.mjs tfa-backup-20260101T000000.json
```

**Requirements for restore:**
- Target database must already have tables created (run `migrate.mjs` first).
- Dump format must be `tfa-backup-v1`.
- The load script is idempotent per-table but does not merge — it replaces rows.

**RTO (Recovery Time Objective):** < 15 minutes for full restore from backup.  
**RPO (Recovery Point Objective):** Last backup (recommend: hourly dumps in production).

---

## 8. Key Rotation

TFA uses a `KeyRing` to track signing-key history. Every key gets a stable `kid` (key id). Proofs carry the `kid` they were signed with, so old proofs remain verifiable after rotation.

### Rotation procedure (via API):
1. Generate new key material:
   - HMAC: `openssl rand -hex 32`
   - Ed25519: generate a new key pair (PEM format)
2. Call the rotation endpoint with an admin API key:
   ```bash
   curl -X POST http://localhost:7700/api/sovereignty/rotate-key \
     -H "x-tenant-id: <tenant>" \
     -H "x-api-key: <admin-key>" \
     -H "Content-Type: application/json" \
     -d '{"signerKind":"hmac","secret":"<new-secret>"}'
   ```
3. The server atomically replaces the active signer. Old keys enter `retiring` status and remain verifiable.
4. Verify old passports still resolve: `node scripts/verify-passport.mjs <old-passport.json>`.
5. After confirming, old keys can be `revoked` (this invalidates their proofs — use only if compromised).

### Rotation overlap window
- `active` — the current signing key.
- `retiring` — previous keys that still verify.
- `revoked` — compromised keys; their proofs are rejected immediately.

**Note:** Communicate key rotation to downstream verifiers with a 30-day notice. The verifier SDK (`sdk/passport-client`) resolves `kid` automatically via the KeyRing.

---

## 9. Break-Glass Emergency Access

In an emergency (lost admin key, blocked workflow, compromised dependency), a holder of the `admin:break-glass` scope may request a short-lived signed ticket.

### Issue a break-glass ticket
```bash
curl -X POST http://localhost:7700/api/sovereignty/break-glass \
  -H "x-tenant-id: <tenant>" \
  -H "x-api-key: <admin-key>" \
  -H "Content-Type: application/json" \
  -d '{"grantScope":"admin:ledger","operator":"oncall-alice","reason":"escrow refund blocked by approval policy","ttlMs":300000}'
```

The ticket is:
- **Signed** by the kernel signer (same key chain as audit).
- **TTL-bound** — default 5 minutes, max 1 hour.
- **Scope-bound** — carries the exact grant scope.
- **Tenant-bound** — cannot be replayed across tenants.
- **Single-use** — every ticket carries a fresh nonce; the server tracks consumed nonces in a `NonceRegistry`.

### Verify a ticket
The middleware `enforceBreakGlassTicket` validates structure, expiry, tenant binding, signature, and nonce replay. Rejected tickets return `403` with a reason.

### Audit trail
Every issued ticket writes a `break-glass.issued` audit record into the tenant chain. The ticket leaves a tamper-evident trail even if never consumed.

---

## 10. Common Incidents

### Server won't start: "env errors"
```
[check-env] ERROR DB_URL is required when TFA_PERSIST=pg but it is not set.
```
**Fix:** Set `DB_URL` to a valid PostgreSQL URL, or unset `TFA_PERSIST`.

### /readyz returns 503: solvency check failing
```json
{"status":"not ready","checks":{"solvency":"insolvent tenants: tenant-xyz"}}
```
**Fix:**
1. Check the tenant's ledger: `GET /api/ledger/solvency` with `x-tenant-id: tenant-xyz`.
2. Look for anomalies in the audit chain: `GET /api/audit/events`.
3. If this is a false positive (monitor ran before first transaction), it will self-resolve on next monitor run.

### Rate limit errors (429)
Clients exceeding the rate limit get `{"error":"rate limit exceeded"}`.  
**Fix:** Increase `TFA_RATE_LIMIT_RPM` or identify the tenant and throttle on their side.

### Escrow stuck in `held` state
**Symptoms:** Escrow shows `held` but neither release nor dispute was filed.  
**Fix:**
1. `GET /api/escrow/:id` to check state.
2. Check for pending approval: `GET /api/execution/:id`.
3. If approval is blocked: manually trigger `POST /api/settlement/release` with the escrow ID.

### Passport verification fails for third party
**Symptoms:** External verifier rejects passport.  
**Fix:**
1. `node scripts/verify-passport.mjs <passport.json>` — check for `valid: false`.
2. Most common cause: clock skew (passport `expiry` in the past). Re-issue the passport.
3. Check `TFA_SECRET` or Ed25519 public key matches what signed the passport. Use `GET /api/sovereignty/kid/:kid` to resolve historical keys.

### DB connection pool exhausted
**Symptoms:** 500 errors, logs show `connection pool exhausted`.  
**Fix:**
1. Check for long-running queries: `SELECT * FROM pg_stat_activity WHERE state = 'active'`.
2. Increase pool size via `DB_URL` connection parameters or restart with a larger pool.
3. Restart the server — `SIGTERM` closes the pool cleanly.

### MCP server tool errors
**Symptoms:** MCP consumer reports `method_not_found` or `invalid_params`.  
**Fix:**
1. Check the MCP capability token is valid and not expired.
2. Verify the nonce in the token has not been consumed (`NonceRegistry` rejects replay).
3. Re-issue a fresh capability token via `POST /api/mcp/capability`.

---

## 11. Monitoring and Alerts

### Solvency monitor
The server runs a periodic ledger audit (default: every 60 seconds).  
Check status: `GET /api/monitor/status`

**Alert triggers:**
- Any tenant with `isSolvent: false`
- Anomaly count > 0 in the last audit

### Transparency log anchoring
The system maintains a Merkle-anchored transparency log.  
Check anchor status: `GET /api/transparency/anchor`

**Alert triggers:**
- Anchor hash mismatch (tamper detection)
- Missing daily anchor

### Structured logs
All requests are logged as JSON to stdout:
```json
{"ts":"2026-01-01T00:00:00Z","level":"info","method":"POST","path":"/api/ledger/mint","status":201,"durationMs":12,"reqId":"abc123","tenantId":"tenant-xyz"}
```

Pipe to your log aggregator (Datadog, CloudWatch, Loki) and alert on:
- `level: "error"` — internal errors
- `status >= 500` — server errors (should be 0 in steady state)
- `durationMs > 5000` — slow requests

---

## 12. Security Checklist (pre-deploy)

- [ ] `TFA_SECRET` is at least 32 chars and stored in a secrets manager (not in env files)
- [ ] `TFA_REQUIRE_API_KEY=1` is set in production
- [ ] `TFA_PERSIST=pg` is set (in-memory trust is not trust)
- [ ] Database is not publicly accessible (VPC / private subnet)
- [ ] `/healthz` and `/readyz` are not exposed to the public internet (only to load balancer)
- [ ] HTTPS termination at the load balancer (TLS 1.2+ required)
- [ ] Backup schedule is configured and tested (restore drill done)
- [ ] Key rotation procedure documented and practiced
- [ ] Break-glass scope (`admin:break-glass`) is assigned to at least two on-call operators
- [ ] If `TFA_SSO_JWT_SECRET` is set: it is a distinct secret from `TFA_SECRET`, stored in a secrets manager, and only your IdP-integration layer (never end users) can mint tokens with it
- [ ] IdP-integration layer calls `mintTfaSsoToken` (`lib/auth/idp-exchange.ts`) only after its own OIDC/SAML verification has succeeded — see `docs/IDP_INTEGRATION.md`
