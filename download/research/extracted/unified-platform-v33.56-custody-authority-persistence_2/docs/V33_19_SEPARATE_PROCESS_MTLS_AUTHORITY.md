# V33.19 Separate-Process mTLS Lease Authority

## Classification

`LOCAL_SEPARATE_PROCESS_MTLS_AUTHORITY_REFERENCE`

V33.19 moves the lease authority out of the controller/test process and into a third Node process. Controllers connect over TLS 1.3 with mutually authenticated X.509 certificates. Every transport identity remains subordinate to the signed application command and the V33.18 authority/fencing model.

## Implemented

- separate authority daemon process;
- TLS 1.3 mutual authentication;
- signed persistent certificate-to-controller binding registry;
- tenant/service/controller binding at every request;
- credential generation, rotation and revocation;
- live revocation reload without daemon restart;
- local signed process supervisor with start, crash, restart and stop receipts;
- persisted authority, fence witness, decisions and outbox across daemon restart;
- fail-closed PostgreSQL, etcd, Consul and systemd qualification probes.

## Security invariants

1. A valid client certificate does not grant application authority.
2. The certificate fingerprint, controller, tenant and service must match one active signed credential.
3. The signed V33.18 command must independently verify.
4. Rotation revokes the prior generation atomically in the signed credential store.
5. Revocation is re-read on every request; no timestamp cache may extend a compromised credential.
6. Daemon restart cannot reduce the monotonic fence.
7. Supervisor evidence is hash-chained and signed.
8. No component receives production authority or executes an external effect.

## Proved locally

- active mTLS client command accepted;
- missing client certificate rejected by TLS;
- rogue server trust root rejected;
- certificate/command identity mismatch rejected;
- application-signature forgery rejected despite valid mTLS;
- old certificate rejected after rotation;
- compromised certificate rejected without daemon restart;
- daemon crash and restart preserve fencing and produce signed lifecycle receipts.

## Not proved

- enterprise PKI, OCSP or CRL distribution;
- systemd qualification;
- PostgreSQL, etcd or Consul lease backend;
- separate hosts or real network partition;
- HSM/KMS custody;
- external witness or independent red team;
- production promotion.
