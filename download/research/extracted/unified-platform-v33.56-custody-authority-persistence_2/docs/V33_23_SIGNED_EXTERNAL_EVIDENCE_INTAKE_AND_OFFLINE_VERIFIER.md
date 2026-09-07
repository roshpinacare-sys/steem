# V33.23 Signed External Evidence Intake and Offline Verifier

V33.23 adds a loopback-only reference intake portal, immutable content-addressed quarantine objects, deterministic active-content/malware-signature/secret scanning, signed scan and intake receipts, a signed append-only quarantine ledger, portable Base64 offline packages, independently pinned trust policy and a network-free verifier.

## Truth boundary

The built-in scanner is a deterministic admission scanner, not an externally qualified anti-malware engine. ClamAV availability is probed but no external scanner is claimed as executed. Archives are never automatically extracted. Opaque binaries and executable/container formats are rejected. Production authority remains NONE.
