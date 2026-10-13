# T-65 evidence — the proof-of-value ledger

probe.mjs — the read-only chain probe that measured the account's FULL
history value ops before the law was written (measured-first, zero guessing).

Measured live 2026-10-03 (node boylikegirl, ah_api):
- account history spans 65,137 ops (genesis era 2018-03-30 … now)
- 9,048 value ops scanned from idx 5,126 → head
- author: 114.094 SBD + 25.489 STEEM + 153,615.37 VESTS (229 ops)
- curation: 247,402.67 VESTS (7,373 ops)
- claims: 114.094 SBD + 25.489 STEEM + 400,615.18 VESTS (1,444 ops)
- consistency: claimed SBD == earned SBD, claimed STEEM == earned STEEM (exact)

Key shape discoveries (both law-locked in §65 vectors):
- ah_api rewards are SEPARATE NAI keys (sbd_payout/steem_payout/vesting_payout,
  reward, reward_sbd/steem/vests) — NOT a "rewards" array
- select_ops is IGNORED by some nodes → the defensive type filter is the gate
- virtual ops carry trx_id 000…0 → the BLOCK number is the evidence anchor
