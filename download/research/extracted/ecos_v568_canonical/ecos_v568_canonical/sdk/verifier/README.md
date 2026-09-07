# @ecos/verifier

**ECOS portable proof verifier** — standalone, zero-dependency, offline
integrity verification for ECOS economic proofs.

## Install

```sh
npm install @ecos/verifier
```

## Usage

```js
const { verifyPortableProof } = require('@ecos/verifier');

// Fetch the proof from the ECOS server (or get it from a trusted third party)
const { proof } = await fetch('https://your-ecos/api/v1/proof/portable').then(r => r.json());

// Optionally fetch the snapshot (for chain + conservation checks)
// const { snapshot } = await ...

const result = verifyPortableProof(proof);
if (!result.valid) {
  throw new Error('Proof invalid: ' + result.mismatches.join(', '));
}
console.log('Integrity verified:', result.checks);
```

### ESM

```js
import { verifyPortableProof } from '@ecos/verifier';
```

### CLI (from repo root)

```sh
node verifier373.js proof.json snapshot.json
```

## What it verifies

1. **proofHash** — content-addressing: proof body was not tampered.
2. **Audit chain** — re-derives the SHA-256 chain head from the snapshot and confirms it matches the committed headHash.
3. **Conservation** — Σ balances === Σ externalIn − Σ externalOut.
4. **Split** — re-proves the 40/40/20 split conservation.

## What it does NOT require

- No ECOS server or API key.
- No network connection.
- No trust in the issuer beyond the published proof + snapshot.
- **Zero npm dependencies** — only Node.js 18+ built-ins.

## Versions

- V373 proof schema (`373.0.0`) — includes `missionId373`, `attachedAt373`, `persistedChainCommitment`.
- V372 proof schema (`372.0.0`) — portable proof without mission attachment.

Both schemas are accepted by `verifyPortableProof`.

## License

MIT
