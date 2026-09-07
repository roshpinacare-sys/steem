# V33.18 — Distributed Lease Authority Qualification

## Result

V33.18 introduces a provider-neutral signed lease-authority contract and proves it locally with two real controller processes communicating through a loopback HTTP authority.

## Proven locally

- exactly one winner in a concurrent lease race;
- monotonic fencing across twelve expiry takeovers;
- stale-controller rejection after every takeover;
- fail-closed behavior while the authority is unavailable;
- persistence across authority restarts;
- rejection of an older validly signed authority snapshot by a separately signed monotonic witness;
- durable signed outbox for grant, takeover, stale-fence and full-workflow fallback evidence;
- idempotent signed delivery acknowledgement;
- zero authority expansion and zero external effects.

## Not proven

The authority and witness are on one host. The persistence adapter is a signed shared-file reference, not PostgreSQL, etcd or Consul. The partition test stops a loopback server; it is not a real network split. No consensus protocol, second host, production service manager or external monotonic witness is qualified.

## Promotion boundary

`productionAuthority = NONE` and `productionPromotion = blocked`.
