# SRS — Sovereign Runtime Substrate Makefile
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
VERSION ?= 7.0.0

.PHONY: help install test smoke integration lint security prove-safety clean zip \
        mutation coverage static-analysis compile-c compile-rust compile-ebpf docker \
        test-srs bench-srs smoke-srs

help:
	@echo "SRS — Sovereign Runtime Substrate"
	@echo ""
	@echo "Targets:"
	@echo "  install          Install dependencies"
	@echo "  test             Run the pytest suite with coverage"
	@echo "  smoke            Run every module's self-test"
	@echo "  integration      Run the cross-module integration test"
	@echo "  lint             Run ruff + mypy"
	@echo "  security         Run bandit security scan"
	@echo "  prove-safety     Run the real Z3 safety proof (¬safety → UNSAT)"
	@echo "  mutation         Run snapshot-safe mutation testing"
	@echo "  coverage         Measure test coverage"
	@echo "  static-analysis  Run mypy and produce report"
	@echo "  compile-c        Build the C isolation engine + run unit tests"
	@echo "  compile-rust     Attempt to compile Rust supervisory skeleton (research)"
	@echo "  compile-ebpf     Attempt to compile eBPF programs (research)"
	@echo "  docker           Build the Docker image with all toolchains"
	@echo "  clean            Remove generated artifacts"
	@echo "  zip              Build srs-sovereign-runtime-substrate-v$(VERSION).zip"

install:
	$(PIP) install -r requirements.txt
	$(PIP) install -r requirements-dev.txt
	$(PIP) install py_ecc pytest-cov mypy

test:
	$(PYTHON) -m pytest tests/ -v --tb=short --cov=. --cov-report=term-missing

smoke:
	$(PYTHON) tests/smoke_test.py

integration:
	$(PYTHON) tests/integration_test.py

lint:
	$(PYTHON) -m ruff check kernel/ cognition/ verification/ simulation/ governance/ self_healing/ tests/
	$(PYTHON) -m mypy kernel/ cognition/ verification/ simulation/ governance/ self_healing/ --ignore-missing-imports || true

security:
	$(PYTHON) -m bandit -r kernel/ cognition/ verification/ simulation/ governance/ self_healing/ -ll || true

prove-safety:
	$(PYTHON) verification/z3_power_proof.py --prove-safety

mutation:
	$(PYTHON) /home/z/my-project/scripts/mutation_test.py

coverage:
	$(PYTHON) /home/z/my-project/scripts/run_coverage.py

static-analysis:
	$(PYTHON) /home/z/my-project/scripts/run_static_analysis.py

compile-c:
	cd kernel/c && make && make check

compile-rust:
	@echo "=== Attempting Rust supervisory skeleton build (research) ==="
	@if command -v cargo > /dev/null; then \
	cd kernel/rust && cargo build --release 2>&1 || \
	echo "Rust build failed — see docs/CAPABILITY_AUDIT.md (research prototype)"; \
	else \
	echo "cargo not installed — run 'make docker' to build inside a container"; \
	fi

compile-ebpf:
	@echo "=== Attempting eBPF programs build (research) ==="
	@if command -v clang > /dev/null; then \
	clang -O2 -g -target bpf -D__TARGET_ARCH_x86 -c bpf/telemetry_ringbuf.c -o /tmp/telemetry_ringbuf.o 2>&1 || \
	echo "eBPF build failed — see docs/CAPABILITY_AUDIT.md (research prototype)"; \
	else \
	echo "clang not installed — run 'make docker' to build inside a container"; \
	fi

docker:
	docker build -t srs-sovereign-runtime-substrate:v$(VERSION) .

# --- v7.0 new targets: SRS unified runtime (stdlib-only) ---

test-srs:
	$(PYTHON) -m pytest tests/test_srs_runtime.py tests/test_integration_v7.py -v

smoke-srs:
	$(PYTHON) srs/cli.py self-test

bench-srs:
	$(PYTHON) benchmarks/srs/run_benchmarks.py

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete
	rm -rf .pytest_cache .mypy_cache .ruff_cache
	rm -f cognition/agemem_metrics.json cognition/agemem_esr_log.json
	rm -f cognition/agemem_adm_metrics.json cognition/adm_intent_mapping.json
	rm -f cognition/grpo_advantage_map.json cognition/grpo_advantage_map.png
	rm -f verification/z3_power_proof_report.json
	rm -f cognition/integration_esr_entry.json
	rm -f kernel/c/*.o kernel/c/test_runner

zip: clean
	zip -r srs-sovereign-runtime-substrate-v$(VERSION).zip \
	. -x "*/__pycache__/*" "*.pyc" ".pytest_cache/*" ".mypy_cache/*" ".ruff_cache/*" \
	"srs-sovereign-runtime-substrate-*.zip" "*.zip" ".git/*"
	@echo "Built: srs-sovereign-runtime-substrate-v$(VERSION).zip"
