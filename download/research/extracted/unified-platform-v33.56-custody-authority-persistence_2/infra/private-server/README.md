# v20 Private Server Bootstrap

This bundle is a target-environment runner, not evidence that PostgreSQL or rootless containers were exercised in the current workspace.

## Required operator actions

1. Install a rootless Podman or Docker runtime on a disposable private server.
2. Create `infra/private-server/secrets/` with mode `0700`.
3. Create three files with mode `0600`: `postgres_password.txt`, `keystore_passphrase.txt`, and `bootstrap_token.txt`.
4. Validate with `node scripts/validate-private-server-config.mjs`.
5. Start with `podman compose -f infra/private-server/compose.yaml up --build` or the equivalent rootless Docker command.
6. Execute the PostgreSQL fault suite with `node scripts/qualify-postgres-v20.mjs`.

No public deployment, production credentials, external repository mutation, or production promotion is authorized.
