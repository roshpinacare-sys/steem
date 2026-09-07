# V33.40 — Multi-Provider HSM Interoperability and Remote Attestation

V33.40 adds a provider-neutral, fail-closed interoperability layer above the V33.39 custody proof.

## Implemented locally

- Signed adapter manifests bind provider, module bytes, ABI, interface standard and allowed EdDSA mechanism.
- Three distinct adapter/provider classes are required; software rehearsal adapters cannot qualify as live external hardware.
- Remote attestation binds exact attestation-document bytes, a unique challenge, role-key fingerprint, device, firmware and adapter manifest.
- A three-of-five threshold certificate requires three providers and separated custodians.
- A public checkpoint binds the V33.39 verdict, adapter set, attestation set and threshold certificate.
- Three separated monitors must retrieve identical checkpoint bytes and retain fsync receipts.
- Cross-site recovery requires distinct sites and providers, exact restored bytes and no sequence reset or fork.

## Truth boundary

The included execution is `LOCAL_MULTI_PROVIDER_INTEROP_REHEARSAL_ONLY`. Provider identities, modules, attestations, monitors and sites are locally generated fixtures. No external HSM, public-network retrieval, external administrator, human participant, external mutation or production promotion is claimed.
