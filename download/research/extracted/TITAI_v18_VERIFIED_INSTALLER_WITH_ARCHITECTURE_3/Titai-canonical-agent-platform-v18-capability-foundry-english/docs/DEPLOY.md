# Deployment

## Supported profile

Titai v10 is designed for one long-lived Node 22 process with a persistent local
SQLite volume. The current application runner is still process-local; a restart
marks active or parked runs interrupted rather than resuming them. The durable
SQLite schema and adapter are migration infrastructure, not permission to deploy
a worker fleet yet.

Serverless and multi-writer deployment are **not supported production profiles**
in this release. A future adapter may add them only after durable runner cutover,
native contention tests, approval continuation, and documented rollback.

## Required environment

| Variable | Required | Purpose |
|---|---:|---|
| `AUTH_SECRET` | yes | Auth.js signing secret |
| `ENCRYPTION_KEY` | yes | Provider-secret encryption root |
| `DATABASE_PATH` | no | SQLite path, default `./data/titai.db` |
| `NEXT_TELEMETRY_DISABLED` | recommended | Disable anonymous framework telemetry |
| `ALLOW_PUBLIC_REGISTRATION` | no | Defaults to closed after first-user bootstrap |
| `REGISTRATION_INVITE_TOKEN` | no | Optional controlled registration token |
| `TRUST_PROXY_HEADERS` | no | Enable only behind a trusted proxy configuration |
| Provider keys | no | Simulation and local Ollama-compatible use require no commercial key |

## Build and verify

```bash
npm ci
npm run canonical:validate
npm run language:validate
npm run db:migrations:validate
npm run typecheck
npm test
npm run eval:baseline
npm run durable:prove
npm run roast:static
npm run roast:validate
npm run release:evidence
npm run release:audit
npm run build
```

Do not convert a blocked native or browser gate into a warning merely to deploy.

## Self-hosted Node

```bash
npm run db:migrate
npm start
```

Keep one application process against the SQLite file. Use a persistent volume and
a process supervisor. For SSE, disable reverse-proxy buffering:

```nginx
location /api/runs/ {
  proxy_pass http://127.0.0.1:3000;
  proxy_buffering off;
  proxy_cache off;
  proxy_set_header Connection '';
  proxy_http_version 1.1;
}
```

Set `TRUST_PROXY_HEADERS=true` only when the application is reachable exclusively
through a proxy that overwrites untrusted forwarding headers.

## Backup and restore

Create a backup while the database is available:

```bash
npm run backup:create
```

The command performs WAL checkpointing, creates a consistent SQLite snapshot,
validates it, and writes an encrypted atomic archive. Keep
`TITAI_BACKUP_PASSPHRASE` separate.

For restore, stop all application writers first:

```bash
npm run backup:restore
```

Restore refuses to overwrite by default. Set `TITAI_RESTORE_OVERWRITE=1` only
after confirming the target path. An existing database is displaced to a
pre-restore file before the verified snapshot is moved into place.

## Production checklist

- [ ] Fresh independent `AUTH_SECRET` and `ENCRYPTION_KEY`.
- [ ] Public registration closed or invite-controlled.
- [ ] One writer process and persistent local storage.
- [ ] Reverse-proxy buffering disabled for SSE.
- [ ] Forwarding headers trusted only behind a controlled proxy.
- [ ] Full native test suite passes.
- [ ] Production build and Playwright flows pass.
- [ ] `npm run verify-audit` passes.
- [ ] Encrypted backup restored into a clean target.
- [ ] RTO and RPO recorded by the operator.
- [ ] Open critical and high Roast findings reviewed.
