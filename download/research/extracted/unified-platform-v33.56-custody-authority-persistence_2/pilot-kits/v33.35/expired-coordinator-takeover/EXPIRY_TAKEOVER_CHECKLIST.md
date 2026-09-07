# Expiry Takeover Checklist

- [ ] predecessor lease signature and digest verified
- [ ] lease expiration and safety delay elapsed
- [ ] outgoing coordinator unavailable; no relinquishment fabricated
- [ ] three distinct witness expiry votes collected
- [ ] replacement coordinator independent from outgoing and recovery authority
- [ ] term increments by exactly one
- [ ] sequence begins at predecessor end plus one
- [ ] takeover conflict scan empty
- [ ] old coordinator resurrection attempt rejected
- [ ] three retrieval processes use distinct process IDs
- [ ] exact bytes and publication digest match
- [ ] gossip peer sets complete
- [ ] split-view scan empty
- [ ] external topology claim remains false for loopback rehearsal
- [ ] production authority remains NONE
