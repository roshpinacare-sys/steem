# V33.20 — External Durable Authority and Enterprise Identity Qualification

## Result

V33.20 provides a **single-host local reference** for an externally durable lease authority boundary:

- two independently supervised authority daemon processes;
- a shared SQLite WAL transactional authority database;
- a separate SQLite WAL monotonic witness database and signing key;
- TLS 1.3 mutual authentication;
- signed application commands in addition to transport identity;
- workload URI-SAN identity (`spiffe://enterprise.test/controller/<id>`) issued by a local reference PKI;
- live identity rotation and revocation;
- durable outbox and monotonic fencing;
- actual restart through `supervisord`.

## Truth boundary

This is **not** PostgreSQL, etcd, Consul, SPIFFE/SPIRE, systemd, multi-host consensus, KMS/HSM or production authority. SQLite and Node's `node:sqlite` API are used as a local transactional reference. The witness is a separate database and signer but remains on the same host.

Missing infrastructure is `UNAVAILABLE_FAIL_CLOSED`. Single-host or synthetic evidence cannot satisfy the external qualification challenge.

## External qualification challenge

Promotion requires at least:

1. two independent hosts;
2. PostgreSQL or another approved external transactional authority;
3. SPIFFE/SPIRE or an approved enterprise workload identity provider;
4. independent witness storage and signer;
5. real service management;
6. observed network partition evidence;
7. external verifier without execution keys;
8. zero unauthorized effects and monotonic fencing across recovery.

Production promotion remains blocked.
