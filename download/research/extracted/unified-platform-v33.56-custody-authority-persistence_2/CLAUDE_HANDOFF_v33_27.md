# Claude Handoff — V33.27

Canonical base: V33.26.

Implemented:
- Signed 14-parameter program ledger (8 preserved, 3 strengthened, 3 external-evidence pending).
- Scanner operator enrollment pinned to engine, organization, host, key ID and fingerprint.
- Transparency witness enrollment, signed checkpoint observations and bidirectional gossip.
- Split-view detection and fail-closed quarantine.
- External qualification challenge requiring two scanner operators and two witnesses on distinct organizations and hosts.

Truth boundary:
- Local campaign is synthetic reference evidence.
- No live ClamAV/YARA receipt or external witness was imported.
- Production authority and external effects remain zero.
