# V33.34 Recovery Drill Runbook

1. Freeze and export the predecessor epoch certificate, active lease and prior pin.
2. Mark no more than two witnesses unavailable; never lower quorum below three of five.
3. Rotate epoch once, activate all next witnesses, then repeat a second predecessor-linked rotation.
4. For active-lease replacement, obtain the outgoing coordinator relinquishment at cutover N.
5. Obtain replacement acceptance for N+1 through the original lease end and three distinct witness votes.
6. Inject a competing handoff and confirm conflict detection.
7. Build the portable publication request and publisher receipt.
8. Verify all artifacts from exported public keys only.
9. Do not claim external publication unless a separate retrieval observer actually fetched exact bytes from an independently governed endpoint.
