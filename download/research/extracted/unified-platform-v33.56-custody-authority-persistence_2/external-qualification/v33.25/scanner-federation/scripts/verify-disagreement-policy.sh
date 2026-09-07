#!/usr/bin/env bash
set -euo pipefail
grep -q 'FAIL_CLOSED_QUARANTINE' external-qualification/v33.25/scanner-federation/federation-policy.json
