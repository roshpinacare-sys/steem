"""Fuzz 5b — Wider-range hypothesis property test.

Extends fuzz5 to cover the dangerous input combinations discovered
by fuzz1: n_features=-1 (ValueError from getrandbits), n_features=100
(OverflowError in hash_bit), kind=compute with n_hyps=0 (IndexError
in execution_stage), and kind=invalid_kind (silent fallback to [E]
planner with same downstream crash). 200 examples per strategy.
"""
from __future__ import annotations
import json
import sys
import hashlib
import shutil
import traceback
from pathlib import Path

sys.path.insert(0, '/home/z/my-project/download')
from srs import Runtime, Task
import hypothesis
from hypothesis import given, settings, strategies as st, HealthCheck

HOME = Path('/tmp/fuzz_prop_f5b')
if HOME.exists():
    shutil.rmtree(HOME)
HOME.mkdir(parents=True)
rt = Runtime(home=HOME)

failures = []
examples_tested = 0

@given(
    kind=st.sampled_from(["identify", "search", "verify", "compute",
                          "invalid_kind", ""]),
    n_hyps=st.integers(min_value=0, max_value=64),
    target=st.integers(min_value=-5, max_value=70),
    budget=st.integers(min_value=0, max_value=64),
    n_features=st.integers(min_value=-1, max_value=128),
)
@settings(max_examples=400, deadline=None,
          suppress_health_check=[HealthCheck.too_slow])
def test_wider_input_space(kind, n_hyps, target, budget, n_features):
    global examples_tested
    examples_tested += 1
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(n_hyps)]
    try:
        task = Task(
            kind=kind,
            payload={"hypotheses": hyps, "target_idx": target,
                     "n_features": n_features},
            budget=budget,
        )
        rt.execute(task)
    except (ValueError, TypeError):
        pass  # Expected — typed rejection
    except Exception as e:
        tb_lines = traceback.format_exc().splitlines()
        last_frame = next((l for l in reversed(tb_lines) if l.startswith('  File')), '?')
        failures.append({
            "kind": kind, "n_hyps": n_hyps, "target": target,
            "budget": budget, "n_features": n_features,
            "exception": type(e).__name__,
            "module": type(e).__module__,
            "message": str(e)[:240],
            "frame": last_frame[:140],
        })
        raise

hypothesis_failure = None
try:
    test_wider_input_space()
except AssertionError as e:
    hypothesis_failure = {
        "exception": "AssertionError",
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
with open('/home/z/my-project/download/fuzz_work/fuzz5b_results.json', 'w') as f:
    json.dump(out, f, indent=2, default=str)

print(f"Fuzz 5b: examples_tested={examples_tested}, "
      f"failures={len(failures)}, hypothesis_failure={hypothesis_failure}")
for f in failures[:10]:
    print(" FAIL:", f)
