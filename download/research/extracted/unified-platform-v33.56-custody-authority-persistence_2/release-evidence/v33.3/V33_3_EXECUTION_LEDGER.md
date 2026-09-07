# V33.3 Execution Ledger

## Implemented

- Device enrollment and revocation registry.
- Key-reuse and nonce-replay protection.
- Device-bound simulated push gateway.
- Gateway-signed delivery challenges.
- Device-signed acknowledgement and approval commands.
- Canonical decision binding and gateway-signed decision receipts.
- Persistent local approval inbox with atomic write, lease and tamper detection.
- Signed gateway snapshot restore with relationship validation.
- Effective-time revocation and historical verification.
- User-flow structural measurement with explicit `SIMULATED` evidence class.
- 21 direct adversarial V33.3 tests and 39 combined V33.1–V33.3 tests.

## Adversarial findings closed in this increment

- A push cannot be issued for a card absent from the canonical inbox.
- A public device key cannot be rebound to another user or device.
- Accepted exact retries remain idempotent after later expiry or revocation.
- Delayed messages first accepted after revocation are rejected.
- Historical pre-revocation evidence remains verifiable.
- Restored snapshots validate delivery, ACK, command, decision and receipt relationships.
- A device decision cannot enlarge the authority scopes bound to the approval card.

## Evidence results

- Direct V33.3 tests: 21/21 passed.
- Combined chat/push path: 39/39 passed.
- Authoritative repository regression: 1,206/1,206 passed across 188 test files.
- Runner exit code: 0.
- Timeout: false.
- Force exit: disabled.
- Repository truth map: passed with zero findings.
- Architecture: PASS, zero source cycles, zero untested source modules, 99/99 capability paths closed.
- Structural flow simulation: 76.67% fewer user steps; median one approval.
- Human-observed scenarios: 0.
- Accessibility validation: not executed.

## Explicitly not implemented

- APNs or FCM delivery.
- Production credentials.
- Hardware-backed device keys or attestation.
- External KMS/HSM.
- Human task study or accessibility validation.
- Production effects.

## Promotion

G0 and G1 remain passed. G3 remains in progress and is not passed. Production remains blocked.
