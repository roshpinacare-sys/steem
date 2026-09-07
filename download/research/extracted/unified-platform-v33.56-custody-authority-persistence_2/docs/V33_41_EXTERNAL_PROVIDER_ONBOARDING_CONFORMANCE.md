# V33.41 — External Provider Onboarding and Conformance

V33.41 adds a fail-closed onboarding and replacement layer above the V33.40 multi-provider HSM interoperability proof.

## Implemented locally

- Signed provider trust-root manifests bind exact root bytes, provider, policy, public documentation, validity window and registrar.
- Adapter manifests and remote attestations are reverified from their original signed envelopes before conformance evidence is accepted.
- Every adapter module is rebound to its exact bytes and SHA-256 digest.
- Conformance receipts bind provider, trust root, adapter, remote attestation, device, session nonce, token serial and test vector.
- PKCS#11/provider-native controls require generated-in-device keys, non-extractability, sensitivity, sign/verify success, blocked private-key export and clean session closure.
- Revocation snapshots are signed, monotonic, append-only and bound to the exact trust-root set.
- Provider replacement requires three separated custodians, revocation of the retired device, a newly qualified provider and preservation of the five-provider set.
- The retired provider is irreversibly fenced by the replacement certificate.
- A checkpoint anchor binds V33.40, trust roots, conformance receipts, revocation, replacement and exact checkpoint bytes.
- Three separated monitor providers must durably retain identical bytes.
- Cross-site recovery requires distinct sites and providers and forbids sequence reset or fork.

## Truth boundary

The included proof is `LOCAL_PROVIDER_ONBOARDING_CONFORMANCE_REHEARSAL_ONLY`. All roots, laboratories, providers, devices, monitors and sites are local fixtures. No external HSM session, public checkpoint retrieval, external administrator, external human participant, external mutation or production promotion is claimed.
