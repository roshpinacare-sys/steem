# Claude Handoff — V33.19

## Current classification

`LOCAL_SEPARATE_PROCESS_MTLS_AUTHORITY_REFERENCE`

## Canonical additions

- `src/app/separate-process-lease-authority-v33_19.ts`
- `src/cli/lease-authority-daemon-v33_19.ts`
- `tests/separate-process-lease-authority-v33_19.test.ts`
- `scripts/separate-process-lease-authority-proof-v33_19.mjs`
- `scripts/verify-separate-process-lease-authority-v33_19.mjs`

## Truth boundary

The authority is a real third process on the same host and uses TLS 1.3 mutual authentication. The certificate is not an authority grant: the signed application command, tenant/service/controller binding, credential status and V33.18 fencing all remain mandatory.

PostgreSQL, etcd, Consul and systemd are not qualified. Their probes are fail-closed. Temporary proof certificates are generated at runtime and are not enterprise PKI.

## Next valid action

Qualify one external backend and one real service manager on an independently governed host. Preserve dual authentication, monotonic fencing, witness rollback rejection, credential rotation/revocation and zero implicit production authority.
