# V33.39 HSM/threshold custody and site recovery runbook

1. Assign all eleven V33.38 roles to keys generated inside independently administered HSM/KMS or hardware-backed devices.
2. Collect signed attestations proving provider, device, firmware, key origin, non-extractability and fail-closed behavior.
3. Provision five separated threshold custodians and require three distinct shares for every protected operation.
4. Execute a sealed role transfer without exporting private-key material.
5. Publish a checkpoint over public HTTPS, bound to the V33.38 verdict and current transparency head.
6. Retrieve and durably store the exact bytes from three independently administered monitors.
7. Revoke the replaced key and collect three durable propagation receipts proving resurrection is denied.
8. Simulate primary-site loss and restore at a separately administered recovery site.
9. Verify checkpoint sequence, threshold predecessor, backup inventory and restored bytes without reset or fork.
10. Run the offline verifier from public keys and exact evidence bytes.
11. Keep G3, external mutation and production promotion blocked until external and human evidence independently satisfies their separate gates.
