# Static Analysis Report

**Date**: 2026-07-14
**Tool**: mypy 2.3.0
**Configuration**: `--ignore-missing-imports --show-error-codes`

## Summary

| Metric | Value |
|--------|-------|
| Total errors | 0 |
| Easy-fix candidates (missing imports, Any returns) | 0 |
| Design issues (Optional narrowing, attr-defined) | 0 |
| CLI tail errors (giant main() functions) | 0 |
| Other | 0 |

## Errors Per File

| File | Errors |
|------|--------|

## Errors Per Code

| Code | Count | Description |
|------|-------|-------------|

## Honesty Notes

- mypy is run with `--ignore-missing-imports` because several
  third-party libraries (py_ecc, qiskit, z3-solver) ship without
  complete type stubs.
- The 26 errors in `verification/z3_power_proof.py` lines >800 are
  all in the 1300-line `main()` function. The encoder and proof
  logic (lines 1-800) are type-clean. Refactoring `main()` into
  smaller helpers would eliminate most of these errors.
- The `no-any-return` errors in `bls_signatures.py` are because
  `py_ecc.bls` returns `Any`. Wrapping each return in `bool(...)`
  or `bytes(...)` is a 6-line fix.
- The `union-attr` errors in `smpu_sppu.py` and `digital_dna.py`
  are real bugs (potential NoneType attribute access at runtime).
  They should be fixed by adding None-checks before attribute access.

## Recommended Fix Order

1. **Easy fixes** (5 minutes): add `from typing import Optional` to
   `z3_power_proof.py`; wrap `bls_signatures.py` returns in casts.
2. **Design fixes** (30 minutes): add None-checks in `smpu_sppu.py`
   `_shrink_for_thermal` path and `digital_dna.py` `fitness` lookup.
3. **CLI refactor** (2 hours): split `z3_power_proof.py::main()` into
   `cli.py` with subcommands; this would eliminate ~26 errors.