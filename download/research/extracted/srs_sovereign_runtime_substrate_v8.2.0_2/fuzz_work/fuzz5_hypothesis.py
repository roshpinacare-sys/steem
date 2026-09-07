"""Fuzz 5 — Property-based testing with hypothesis.

Hypothesis explores the (n_hyps, target, budget, n_features) input
space and asserts that execute() either succeeds or raises a typed
ValueError/TypeError — never any other exception.

Uses @given with explicit settings(max_examples=...) and a deadline=None
to avoid flakiness on slow CI machines. Saves the shrinking report
for any failing case.
"""
from __future__ import annotations
import json
import os
import sys
import hashlib
import shutil
import traceback
from pathlib import Path

sys.path.insert(0, '/home/z/my-project/download')
from srs import Runtime, Task
import hypothesis
from hypothesis import given, settings, strategies as st, HealthCheck, errors as hyp_errors

HOME = Path('/tmp/fuzz_prop_f5')
if HOME.exists():
    shutil.rmtree(HOME)
HOME.mkdir(parents=True)
rt = Runtime(home=HOME)

failures = []
examples_tested = 0

@given(
    n_hyps=st.integers(min_value=0, max_value=100),
    target=st.integers(min_value=-10, max_value=110),
    budget=st.integers(min_value=0, max_value=100),
    n_features=st.integers(min_value=0, max_value=32),
)
@settings(max_examples=500, deadline=None,
          suppress_health_check=[HealthCheck.too_slow])
def test_execute_never_crashes(n_hyps, target, budget, n_features):
    global examples_tested
    examples_tested += 1
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(n_hyps)]
    try:
        task = Task(kind="identify",
                    payload={"hypotheses": hyps, "target_idx": target,
                             "n_features": n_features},
                    budget=budget)
        rt.execute(task)
    except (ValueError, TypeError):
        pass  # Expected — typed rejection
    except Exception as e:
        # Capture for the report.
        tb_lines = traceback.format_exc().splitlines()
        last_frame = next((l for l in reversed(tb_lines) if l.startswith('  File')), '?')
        failures.append({
            "n_hyps": n_hyps, "target": target,
            "budget": budget, "n_features": n_features,
            "exception": type(e).__name__,
            "module": type(e).__module__,
            "message": str(e)[:240],
            "frame": last_frame[:140],
        })
        # Re-raise so hypothesis counts it as a failure and shrinks.
        raise

# Run the test and capture any Hypothesis-discovered failure.
hypothesis_failure = None
try:
    test_execute_never_crashes()
except AssertionError as e:
    # hypothesis raises AssertionError on a failing example.
    hypothesis_failure = {
        "exception": "AssertionError",
        "message": str(e)[:600],
    }
except hyp_errors.Falsifying as e:
    hypothesis_failure = {
        "exception": "Falsifying",
        "message": str(e)[:600],
    }
except Exception as e:
    hypothesis_failure = {
        "exception": type(e).__name__,
        "message": str(e)[:600],
    }

out = {
    "examples_tested": examples_tested,
    "failure_count": len(failures),
    "hypothesis_failure": hypothesis_failure,
    "failures": failures[:20],
}
with open('/home/z/my-project/download/fuzz_work/fuzz5_results.json', 'w') as f:
    json.dump(out, f, indent=2, default=str)

print(f"Fuzz 5: examples_tested={examples_tested}, "
      f"failures={len(failures)}, hypothesis_failure={hypothesis_failure}")
for f in failures[:10]:
    print(" FAIL:", f)
