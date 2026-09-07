# @tfa/passport-client

Zero-dependency verifier for **TFA Action Passports** — a portable cryptographic proof that an
autonomous (AI agent) action was: authorized via a delegation chain ending in a human, checked
against policy, executed, and recorded in a double-entry ledger. **You do not need to trust the
issuer** — you verify the signature yourself with the issuer's public key.

## Why
When an AI agent acts on real value, every counterparty (regulator, insurer, partner, auditor) asks:
*"how do I know this agent was authorized to do that?"* A passport answers it offline, in one file.

## Install
Drop `index.mjs` + `verify-passport.mjs` into your project (Node 22+). No dependencies.

## Verify in code
```js
import { verifyPassport } from "@tfa/passport-client";
const res = verifyPassport(passport, { publicKey: issuerEd25519PemSpki, auditPublicKey: issuerEd25519PemSpki }, { strict: true });
if (!res.ok) throw new Error("passport invalid: " + res.errors.join("; "));
// res.ok === true → the action is provably accountable
```

## Verify on the command line
```
node verify-passport.mjs passport.json --public-key-file issuer.pem --audit-public-key-file issuer.pem
```

## What a verified passport proves
- **tenantId** — which tenant the action belonged to (isolation preserved).
- **audit** — the signed, hash-chained record (actionType, outcome, prev/hash).
- **delegationChain** — who authorized whom, down to a human root.
- **policyDecision** — allow/deny + reason.
- **ledgerEffect** — the μ¢ (BigInt) money movement, if any.

A single altered field invalidates the signature. HMAC and Ed25519 are both supported; Ed25519 needs
only the public key, so the issuer never shares a secret.
