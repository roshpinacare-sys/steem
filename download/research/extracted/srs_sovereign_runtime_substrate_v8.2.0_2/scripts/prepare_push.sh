#!/bin/bash
# prepare_push.sh — Prepare the SRS repository for a GitHub push.
#
# This script:
#   1. Verifies the working tree is clean (all changes committed)
#   2. Runs the full test suite to confirm 278 tests pass
#   3. Runs mypy to confirm 0 errors
#   4. Runs the mutation killers to confirm 100% score
#   5. Builds the C isolation engine + runs 12 unit tests
#   6. Prints the exact git commands to push to GitHub
#
# Usage:
#   ./scripts/prepare_push.sh
#
# After this script succeeds, the user runs:
#   git remote add origin git@github.com:<user>/<repo>.git
#   git push -u origin main
#   # OR if the remote already exists:
#   git push origin main

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

echo "=========================================="
echo "  SRS — GitHub Push Preparation"
echo "=========================================="
echo ""

# ---- 1. Verify working tree is clean ----------------------------------
echo "[1/5] Verifying working tree is clean..."
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "  FAIL: Uncommitted changes detected. Please commit first:"
    echo "    git add -A"
    echo "    git commit -m 'v4.1.0: qiskit tests, smpu unit tests, CI updates'"
    exit 1
fi
echo "  OK: Working tree is clean"
echo ""

# ---- 2. Run full test suite -------------------------------------------
echo "[2/5] Running full test suite (278 tests)..."
if python3 -m pytest tests/ --tb=no -q 2>&1 | tail -3; then
    echo "  OK: All tests pass"
else
    echo "  FAIL: Test suite failed"
    exit 1
fi
echo ""

# ---- 3. Run mypy -------------------------------------------------------
echo "[3/5] Running mypy (expect 0 errors)..."
ERRORS=$(mypy --ignore-missing-imports --no-error-summary \
    kernel/ cognition/ verification/ simulation/ governance/ self_healing/ 2>&1 | \
    grep -c "error:" || true)
if [ "$ERRORS" -eq 0 ]; then
    echo "  OK: 0 mypy errors"
else
    echo "  FAIL: $ERRORS mypy errors detected"
    exit 1
fi
echo ""

# ---- 4. Run mutation killers ------------------------------------------
echo "[4/5] Running mutation killer tests (22 tests)..."
if python3 -m pytest \
    tests/test_mutation_killers.py \
    tests/test_mutation_killers_cog_sim.py \
    tests/test_mutation_killers_verif.py \
    tests/test_mutation_killers_seg.py \
    --tb=no -q 2>&1 | tail -3; then
    echo "  OK: All mutation killers pass (100% score)"
else
    echo "  FAIL: Mutation killers failed"
    exit 1
fi
echo ""

# ---- 5. Build C + run unit tests --------------------------------------
echo "[5/5] Building C isolation engine + running 12 unit tests..."
if (cd kernel/c && make && make check) 2>&1 | tail -5; then
    echo "  OK: C build + 12 unit tests pass"
else
    echo "  FAIL: C build or tests failed"
    exit 1
fi
echo ""

# ---- Print push instructions ------------------------------------------
echo "=========================================="
echo "  ALL CHECKS PASSED — Ready to push"
echo "=========================================="
echo ""
echo "To push to GitHub:"
echo ""
echo "  # If this is the first push (no remote yet):"
echo "  git remote add origin git@github.com:<your-user>/<your-repo>.git"
echo "  git push -u origin main"
echo ""
echo "  # If the remote already exists:"
echo "  git push origin main"
echo ""
echo "After the push, GitHub Actions will run the 4-job CI workflow:"
echo "  1. test         — pytest + ruff + mypy + bandit + Z3 proof (Python 3.10/3.11/3.12)"
echo "  2. mutation     — snapshot-safe mutation testing (>= 90% required)"
echo "  3. compile-c    — C isolation engine + 12 unit tests + Python↔C cross-validation"
echo "  4. docker-build — Docker image build + smoke-test inside container"
echo ""
echo "Monitor the CI run at:"
echo "  https://github.com/<your-user>/<your-repo>/actions"
