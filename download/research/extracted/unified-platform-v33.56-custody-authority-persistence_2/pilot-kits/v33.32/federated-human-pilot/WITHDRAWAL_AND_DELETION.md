# Withdrawal and deletion procedure

1. Authenticate the withdrawal request using the participant's study alias and approved channel.
2. Sign a V33.31 withdrawal record.
3. Stop instrumentation and exclude the participant from qualification counts.
4. Locate all artifact records by participant, session and consent digest.
5. Delete raw observation artifacts and derived participant-linked rows within the approved SLA.
6. Produce a privacy-minimized deletion receipt that contains no raw participant data.
7. Recompute the evidence manifest; do not reuse the prior package or challenge.
