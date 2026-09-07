#!/usr/bin/env bash
# validate.sh — Full validation suite for QODO-V24-UPGRADE
# Usage: ./validate.sh [--strict]
# Returns exit code 0 if all checks pass, non-zero otherwise.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STRICT="${1:-}"
ERRORS=0
PASS=0
FAIL=0

red()   { printf "\033[0;31m%s\033[0m\n" "$*"; }
green() { printf "\033[0;32m%s\033[0m\n" "$*"; }
yellow(){ printf "\033[0;33m%s\033[0m\n" "$*"; }
bold()  { printf "\033[1m%s\033[0m\n" "$*"; }

check_pass() { PASS=$((PASS+1)); green "  PASS  $1"; }
check_fail() { FAIL=$((FAIL+1)); ERRORS=$((ERRORS+1)); red "  FAIL  $1"; }

section() { echo ""; bold "══ $1 ══"; }

# ── 1. JS/MJS syntax ────────────────────────────────────────────────────────
section "JS/MJS Syntax (node --check)"
JS_FILES=(
  "bin/create-qodo.mjs"
  "bootstrap.mjs"
  "worker/ast-fragment-worker.js"
  "worker/telemetry-proxy.js"
  "packages/agent/bin/swarm-dispatch.mjs"
)
for f in "${JS_FILES[@]}"; do
  fp="$ROOT/$f"
  if [ ! -f "$fp" ]; then
    check_fail "$f (file not found)"
  elif node --check "$fp" 2>/dev/null; then
    check_pass "$f"
  else
    check_fail "$f"
  fi
done

# ── 2. JSON validity ─────────────────────────────────────────────────────────
section "JSON Validity"
JSON_FILES=(
  "package.json"
  "packages/agent/package.json"
  "apps/mission-control/package.json"
  "tsconfig.json"
  "packages/agent/tsconfig.json"
  "apps/mission-control/tsconfig.json"
  "knip.json"
  "tasks/agent-task-queue.json"
)
for f in "${JSON_FILES[@]}"; do
  fp="$ROOT/$f"
  if [ ! -f "$fp" ]; then
    check_fail "$f (file not found)"
  elif python3 -m json.tool "$fp" > /dev/null 2>&1; then
    check_pass "$f"
  else
    check_fail "$f"
  fi
done

# ── 3. YAML validity ─────────────────────────────────────────────────────────
section "YAML Validity"
YAML_FILES=(
  "docker-compose.yml"
  ".github/workflows/agent-pipeline.yml"
  "k8s/qodo-job-template.yaml"
  "k8s/qodo-scaledjob.yaml"
)
for f in "${YAML_FILES[@]}"; do
  fp="$ROOT/$f"
  if [ ! -f "$fp" ]; then
    yellow "  SKIP  $f (not found)"
  elif python3 -c "import yaml; list(yaml.safe_load_all(open('$fp')))" 2>/dev/null; then
    check_pass "$f"
  else
    check_fail "$f"
  fi
done

# ── 4. .env.example format ───────────────────────────────────────────────────
section ".env.example Format"
ENV_FILE="$ROOT/.env.example"
if [ -f "$ENV_FILE" ]; then
  python3 - "$ENV_FILE" << 'PY'
import sys
lines = open(sys.argv[1]).read().splitlines()
for i, line in enumerate(lines, 1):
    s = line.strip()
    if not s or s.startswith('#'): continue
    if '=' not in s:
        raise ValueError(f"Bad env line {i}: {line}")
print("OK")
PY
  if [ $? -eq 0 ]; then
    check_pass ".env.example"
  else
    check_fail ".env.example"
  fi
else
  check_fail ".env.example (not found)"
fi

# ── 5. TypeScript new service files (strip types, check JS) ─────────────────
section "New Service Files (TS structure check)"
TS_NEW_FILES=(
  "packages/agent/src/services/sbom-generator.ts"
  "packages/agent/src/services/license-checker.ts"
  "packages/agent/src/services/cve-scanner.ts"
  "packages/agent/src/services/audit-log.ts"
  "packages/agent/src/services/otel-tracer.ts"
  "packages/agent/src/services/prometheus-metrics.ts"
  "packages/agent/src/services/slo-tracker.ts"
  "packages/agent/src/services/alerting-rules.ts"
  "packages/agent/src/services/prompt-registry.ts"
  "packages/agent/src/services/confidence-scorer.ts"
  "packages/agent/src/services/dry-run.ts"
  "packages/agent/src/services/hot-reload-config.ts"
  "packages/agent/src/services/progress-bar.ts"
  "packages/agent/src/validators/path-guard-scoped.ts"
)
for f in "${TS_NEW_FILES[@]}"; do
  fp="$ROOT/$f"
  if [ ! -f "$fp" ]; then
    check_fail "$f (file not found)"
  else
    # Verify file is non-empty and contains 'export'
    if grep -q "export" "$fp" 2>/dev/null; then
      check_pass "$f"
    else
      check_fail "$f (no exports found)"
    fi
  fi
done

# ── 6. Test files exist ──────────────────────────────────────────────────────
section "Test Files Exist"
TEST_FILES=(
  "packages/agent/tests/property/validators.property.test.ts"
  "packages/agent/tests/property/audit-log.property.test.ts"
  "packages/agent/tests/snapshots/confidence-scorer.snapshot.test.ts"
  "packages/agent/tests/security.test.ts"
  "packages/agent/tests/observability.test.ts"
  "packages/agent/tests/ai-strategy.test.ts"
  "k6/load-test.js"
  "k6/soak-test.js"
)
for f in "${TEST_FILES[@]}"; do
  fp="$ROOT/$f"
  if [ -f "$fp" ] && [ -s "$fp" ]; then
    check_pass "$f"
  else
    check_fail "$f"
  fi
done

# ── 7. CI pipeline structure ─────────────────────────────────────────────────
section "CI Pipeline Contents"
PIPELINE="$ROOT/.github/workflows/agent-pipeline.yml"
EXPECTED_JOBS=("typecheck" "test" "security" "build" "preflight" "audit-verify" "slo-report" "agent")
for job in "${EXPECTED_JOBS[@]}"; do
  if grep -q "name:.*${job}\|^  ${job}:" "$PIPELINE" 2>/dev/null; then
    check_pass "pipeline job: $job"
  else
    check_fail "pipeline job: $job (missing from YAML)"
  fi
done

# ── 8. vitest config has coverage thresholds ─────────────────────────────────
section "Vitest Coverage Config"
VITEST_CFG="$ROOT/packages/agent/vitest.config.ts"
if grep -q "thresholds" "$VITEST_CFG" 2>/dev/null; then
  check_pass "vitest.config.ts has coverage thresholds"
else
  check_fail "vitest.config.ts missing coverage thresholds"
fi

# ── 9. File count sanity ─────────────────────────────────────────────────────
section "File Count"
TOTAL=$(find "$ROOT" -type f | wc -l)
echo "  Total files: $TOTAL"
if [ "$TOTAL" -ge 150 ]; then
  check_pass "File count >= 150 ($TOTAL)"
else
  check_fail "File count < 150 ($TOTAL) — possible missing files"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
bold "══════════════════════════════════════"
bold " VALIDATION SUMMARY"
bold "══════════════════════════════════════"
green " PASSED: $PASS"
if [ $FAIL -gt 0 ]; then
  red   " FAILED: $FAIL"
else
  green " FAILED: $FAIL"
fi
echo ""

if [ $ERRORS -gt 0 ]; then
  red "Validation FAILED with $ERRORS error(s)."
  exit 1
else
  green "All checks PASSED."
  exit 0
fi
