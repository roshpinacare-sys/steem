# V33.35 — Expired Coordinator Takeover and Monitor Gossip

V33.35 closes the recovery case in which the outgoing coordinator is lost and cannot sign a relinquishment.

## Implemented locally

- takeover is forbidden until the predecessor lease expiration plus a bounded safety delay;
- three-of-five witnesses independently attest lease expiry;
- the replacement coordinator signs acceptance and advances the term exactly once;
- sequence starts at predecessor `sequenceEnd + 1`;
- the takeover certificate fences the outgoing coordinator permanently for the successor range;
- replacement actions require the exact takeover digest as a fencing token;
- conflicting takeovers from one predecessor lease are detected;
- a publication server and three monitors execute in distinct Node processes;
- each monitor performs a real HTTP loopback fetch, signs the exact retrieved content digest and gossips its view;
- split-view, missing peers, forged receipts and insufficient quorum fail closed.

## Truth boundary

The execution proves separate local processes and real loopback network retrieval. It does not prove independent external hosts, external organizations, external human participation, production authority or production promotion.
