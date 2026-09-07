# External HTTPS Monitor Qualification Runbook

1. Provision the publisher, three monitors, two clock sources and two topology auditors under separate administrators.
2. Pin the publisher certificate SHA-256 and require TLS 1.3.
3. Retrieve identical bytes from all monitors and persist each receipt atomically with file and directory fsync.
4. Collect at least two signed time attestations within the approved skew.
5. Exchange signed gossip among all active monitors.
6. Isolate one monitor for the minimum partition period, obtain two active-monitor partition statements and activate one independently administered replacement.
7. Repeat retrieval and gossip with the new monitor set.
8. Import signed public evidence and verify offline.
9. Do not change production authority or G3 status.
