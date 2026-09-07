#!/usr/bin/env python3
"""Generate the Makefile with proper TAB characters."""
from pathlib import Path

content = """# SRS — Sovereign Runtime Substrate Makefile
#
# Usage:
#   make help           — show this help
#   make test           — run the pytest suite
#   make smoke          — run every module's self-test
#   make integration    — run the cross-module integration test
#   make lint           — run ruff + mypy
#   make security       — run bandit security scan
#   make prove-safety   — run the real Z3 safety proof (¬safety → UNSAT)
#   make mutation       — run snapshot-safe mutation testing (needs scripts/mutation_test.py)
#   make coverage       — measure test coverage (needs pytest-cov)
#   make static-analysis— run mypy and produce STATIC_ANALYSIS_REPORT.md
#   make compile-c      — build the C isolation engine + run unit tests
#   make compile-rust   — attempt to compile the Rust supervisory skeleton (research)
#   make compile-ebpf   — attempt to compile the eBPF programs (research)
#   make docker         — build the Docker image with all toolchains
#   make clean          — remove generated artifacts
#   make zip            — build the distributable zip

PYTHON ?= python3
PIP    ?= $(PYTHON) -m pip
VERSION ?= 6.3.0

.PHONY: help install test smoke integration lint security prove-safety clean zip \\
        mutation coverage static-analysis compile-c compile-rust compile-ebpf docker

help:
\t@echo "SRS — Sovereign Runtime Substrate"
\t@echo ""
\t@echo "Targets:"
\t@echo "  install          Install dependencies"
\t@echo "  test             Run the pytest suite with coverage"
\t@echo "  smoke            Run every module's self-test"
\t@echo "  integration      Run the cross-module integration test"
\t@echo "  lint             Run ruff + mypy"
\t@echo "  security         Run bandit security scan"
\t@echo "  prove-safety     Run the real Z3 safety proof (¬safety → UNSAT)"
\t@echo "  mutation         Run snapshot-safe mutation testing"
\t@echo "  coverage         Measure test coverage"
\t@echo "  static-analysis  Run mypy and produce report"
\t@echo "  compile-c        Build the C isolation engine + run unit tests"
\t@echo "  compile-rust     Attempt to compile Rust supervisory skeleton (research)"
\t@echo "  compile-ebpf     Attempt to compile eBPF programs (research)"
\t@echo "  docker           Build the Docker image with all toolchains"
\t@echo "  clean            Remove generated artifacts"
\t@echo "  zip              Build srs-sovereign-runtime-substrate-v$(VERSION).zip"

install:
\t$(PIP) install -r requirements.txt
\t$(PIP) install -r requirements-dev.txt
\t$(PIP) install py_ecc pytest-cov mypy

test:
\t$(PYTHON) -m pytest tests/ -v --tb=short --cov=. --cov-report=term-missing

smoke:
\t$(PYTHON) tests/smoke_test.py

integration:
\t$(PYTHON) tests/integration_test.py

lint:
\t$(PYTHON) -m ruff check kernel/ cognition/ verification/ simulation/ governance/ self_healing/ tests/
\t$(PYTHON) -m mypy kernel/ cognition/ verification/ simulation/ governance/ self_healing/ --ignore-missing-imports || true

security:
\t$(PYTHON) -m bandit -r kernel/ cognition/ verification/ simulation/ governance/ self_healing/ -ll || true

prove-safety:
\t$(PYTHON) verification/z3_power_proof.py --prove-safety

mutation:
\t$(PYTHON) /home/z/my-project/scripts/mutation_test.py

coverage:
\t$(PYTHON) /home/z/my-project/scripts/run_coverage.py

static-analysis:
\t$(PYTHON) /home/z/my-project/scripts/run_static_analysis.py

compile-c:
\tcd kernel/c && make && make check

compile-rust:
\t@echo "=== Attempting Rust supervisory skeleton build (research) ==="
\t@if command -v cargo > /dev/null; then \\
\t\tcd kernel/rust && cargo build --release 2>&1 || \\
\t\techo "Rust build failed — see docs/CAPABILITY_AUDIT.md (research prototype)"; \\
\telse \\
\t\techo "cargo not installed — run 'make docker' to build inside a container"; \\
\tfi

compile-ebpf:
\t@echo "=== Attempting eBPF programs build (research) ==="
\t@if command -v clang > /dev/null; then \\
\t\tclang -O2 -g -target bpf -D__TARGET_ARCH_x86 -c bpf/telemetry_ringbuf.c -o /tmp/telemetry_ringbuf.o 2>&1 || \\
\t\techo "eBPF build failed — see docs/CAPABILITY_AUDIT.md (research prototype)"; \\
\telse \\
\t\techo "clang not installed — run 'make docker' to build inside a container"; \\
\tfi

docker:
\tdocker build -t srs-sovereign-runtime-substrate:v$(VERSION) .

clean:
\tfind . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
\tfind . -type f -name "*.pyc" -delete
\trm -rf .pytest_cache .mypy_cache .ruff_cache
\trm -f cognition/agemem_metrics.json cognition/agemem_esr_log.json
\trm -f cognition/agemem_adm_metrics.json cognition/adm_intent_mapping.json
\trm -f cognition/grpo_advantage_map.json cognition/grpo_advantage_map.png
\trm -f verification/z3_power_proof_report.json
\trm -f cognition/integration_esr_entry.json
\trm -f kernel/c/*.o kernel/c/test_runner

zip: clean
\tzip -r srs-sovereign-runtime-substrate-v$(VERSION).zip \\
\t\t. -x "*/__pycache__/*" "*.pyc" ".pytest_cache/*" ".mypy_cache/*" ".ruff_cache/*" \\
\t\t   "srs-sovereign-runtime-substrate-*.zip" "*.zip" ".git/*"
\t@echo "Built: srs-sovereign-runtime-substrate-v$(VERSION).zip"
"""

Path("/home/z/my-project/download/Makefile").write_text(content)
print("Makefile written with TAB characters.")
