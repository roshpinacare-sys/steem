#!/bin/bash
# mutmut runner — only runs the tests that don't require hypothesis/qiskit
python3 -m pytest \
  tests/test_modules.py \
  tests/test_fuzz.py \
  tests/test_fault_injection.py \
  tests/test_concurrency.py \
  tests/test_cross_validation.py \
  tests/test_c_omnivisor.py \
  -x -q --tb=no -p no:cacheprovider
