"""Fuzz 1 — Random Task payloads.

Generates 1000 random (kind, n_hyps, target_idx, n_features, budget)
combinations and executes each. Validation should catch the bad ones;
anything that propagates an exception OTHER than ValueError/TypeError
is a robustness defect.
"""
from __future__ import annotations
import json
import os
import random
import hashlib
import sys
import traceback
from pathlib import Path

sys.path.insert(0, '/home/z/my-project/download')
from srs import Runtime, Task
from srs.types import MAX_HYPOTHESES

RT_HOME = Path('/tmp/fuzz_test_f1')
if RT_HOME.exists():
    import shutil; shutil.rmtree(RT_HOME)
RT_HOME.mkdir(parents=True)

rt = Runtime(home=RT_HOME)
crashes = []
attempts = 0
expected_rejections = 0

KIND_CHOICES = ["identify", "search", "verify", "compute", "invalid_kind", ""]
N_HYPS_CHOICES = [0, 1, 5, 64, 256, 1000]
TARGET_CHOICES = [-1, 0, "mid", "n-1", "n", "n+100"]
N_FEATURES_CHOICES = [0, 1, 8, 12, 32, 100, -1]
BUDGET_CHOICES = [0, 1, 16, 100, 10000, -1]

for i in range(1000):
    n_hyps = random.choice(N_HYPS_CHOICES)
    hyps = [hashlib.sha256(f"fuzz_{i}_{j}".encode()).digest() for j in range(n_hyps)]
    tc = random.choice(TARGET_CHOICES)
    if tc == "mid":      target = n_hyps // 2
    elif tc == "n-1":    target = max(0, n_hyps - 1)
    elif tc == "n":      target = n_hyps
    elif tc == "n+100":  target = n_hyps + 100
    else:                target = tc
    n_features = random.choice(N_FEATURES_CHOICES)
    budget = random.choice(BUDGET_CHOICES)
    kind = random.choice(KIND_CHOICES)
    attempts += 1
    try:
        task = Task(
            kind=kind,
            payload={
                "hypotheses": hyps,
                "target_idx": target,
                "n_features": n_features,
            },
            budget=budget,
        )
        rt.execute(task)
    except (ValueError, TypeError) as e:
        # Expected — validation should catch these.
        expected_rejections += 1
    except Exception as e:
        tb_lines = traceback.format_exc().splitlines()
        last_frame = next((l for l in reversed(tb_lines) if l.startswith('  File')), '?')
        crashes.append({
            "i": i,
            "kind": kind,
            "n_hyps": n_hyps,
            "target": target,
            "n_features": n_features,
            "budget": budget,
            "exception": type(e).__name__,
            "module": type(e).__module__,
            "message": str(e)[:240],
            "frame": last_frame[:120],
        })

# Save raw results so the markdown writer can read them.
out = {
    "attempts": attempts,
    "expected_rejections": expected_rejections,
    "crash_count": len(crashes),
    "crashes": crashes[:50],   # cap saved sample
}
with open('/home/z/my-project/download/fuzz_work/fuzz1_results.json', 'w') as f:
    json.dump(out, f, indent=2)

print(f"Fuzz 1: attempts={attempts}, expected_rejections={expected_rejections}, "
      f"crashes={len(crashes)}")
for c in crashes[:10]:
    print(" ", c)
