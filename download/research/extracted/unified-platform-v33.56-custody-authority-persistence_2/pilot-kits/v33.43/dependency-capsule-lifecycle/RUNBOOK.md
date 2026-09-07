# V33.43 Dependency Capsule Lifecycle Runbook

This kit exercises a local, fail-closed dependency capsule lifecycle without contacting an external package registry.

1. Independently verify the V33.42 base capsule and its offline-install verdict.
2. Create source-A provenance statements for every exact tarball.
3. Sign candidate sequence 2 over the unchanged package bytes.
4. Import a signed, monotonic vulnerability advisory targeting source-A provenance.
5. Collect three independent revocation votes and issue the revocation certificate.
6. Roll back to the verified V33.42 base manifest.
7. Create source-B provenance statements and candidate sequence 3.
8. Run `npm ci --offline` with a new empty cache using the replacement package and lock files.
9. Verify every signature, digest, sequence, rollback edge and installed package.

The runbook proves only local lifecycle mechanics. It does not assert external vulnerability intelligence, public registry provenance, production authority or external effects.
