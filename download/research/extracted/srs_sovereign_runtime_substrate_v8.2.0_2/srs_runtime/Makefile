# SRS Runtime 7.0 — Makefile
PYTHON ?= python3
VERSION ?= 7.0.0

.PHONY: help test smoke bench capabilities zip clean

help:
	@echo "SRS Runtime $(VERSION)"
	@echo ""
	@echo "Targets:"
	@echo "  test          Run pytest suite (20 tests)"
	@echo "  smoke         Run all module self-tests (11 modules)"
	@echo "  bench         Run benchmark suite"
	@echo "  capabilities  Print capability report"
	@echo "  zip           Build distributable zip"
	@echo "  clean         Remove generated artifacts"

test:
	$(PYTHON) -m pytest tests/ -v

smoke:
	$(PYTHON) srs/cli.py self-test

bench:
	$(PYTHON) srs/cli.py bench

capabilities:
	$(PYTHON) srs/cli.py capabilities

zip:
	cd .. && zip -r srs_runtime_$(VERSION).zip srs_runtime/ \
		-x "srs_runtime/__pycache__/*" \
		-x "srs_runtime/*/__pycache__/*" \
		-x "srs_runtime/.pytest_cache/*" \
		-x "srs_runtime/benchmark_results.json"
	@echo "Built: ../srs_runtime_$(VERSION).zip"

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	rm -rf .pytest_cache benchmark_results.json
