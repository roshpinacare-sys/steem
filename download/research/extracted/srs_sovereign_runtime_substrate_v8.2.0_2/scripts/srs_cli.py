#!/usr/bin/env python3
"""SRS Runtime CLI.

Usage:
  srs self-test              Run all module self-tests
  srs capabilities           Print capability report
  srs execute <kind> <n>     Execute a synthetic task
  srs snapshot               Save state snapshot
  srs recover                Reload last snapshot
  srs bench                  Run the benchmark suite
  srs plan <kind>            Show plan for a task kind
"""
from __future__ import annotations
import argparse
import hashlib
import json
import sys
from pathlib import Path

# Ensure we can import srs package
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from srs import Runtime, Task
from srs.planner import plan


def cmd_self_test() -> int:
    """Run every module's self-test."""
    from srs.primitives import (execution, compression, adaptivity,
                                scheduling, verification, advice, quantum)
    from srs import planner, persistence, improvement, runtime

    modules = [
        ("srs.primitives.execution", execution),
        ("srs.primitives.compression", compression),
        ("srs.primitives.adaptivity", adaptivity),
        ("srs.primitives.scheduling", scheduling),
        ("srs.primitives.verification", verification),
        ("srs.primitives.advice", advice),
        ("srs.primitives.quantum", quantum),
        ("srs.planner", planner),
        ("srs.persistence", persistence),
        ("srs.improvement", improvement),
        ("srs.runtime", runtime),
    ]
    passed = 0
    failed = 0
    for name, mod in modules:
        try:
            mod.self_test()
            print(f"  PASS  {name}")
            passed += 1
        except Exception as e:
            print(f"  FAIL  {name}: {e}")
            failed += 1
    print(f"\n{passed}/{passed + failed} modules passed")
    return 0 if failed == 0 else 1


def cmd_capabilities() -> int:
    rt = Runtime()
    c = rt.capabilities()
    print(json.dumps(c, indent=2))
    return 0


def cmd_execute(kind: str, n: int, budget: int) -> int:
    rt = Runtime()
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(n)]
    task = Task(kind=kind,
                payload={"hypotheses": hyps, "target_idx": n // 2, "n_features": 12},
                budget=budget)
    r = rt.execute(task)
    print(json.dumps(r.to_dict(), indent=2, default=str))
    rt.store_state()
    return 0 if r.correct else 1


def cmd_snapshot() -> int:
    rt = Runtime()
    path = rt.store_state()
    print(f"Snapshot saved: {path}")
    return 0


def cmd_recover() -> int:
    rt = Runtime()
    if rt.recover():
        print("Recovered:")
        print(json.dumps(rt.capabilities(), indent=2))
        return 0
    print("No snapshot found")
    return 1


def cmd_plan(kind: str) -> int:
    axis, prims = plan(kind)
    print(f"Task kind: {kind}")
    print(f"Primary axis: {axis}")
    print(f"Primitives: {prims}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="srs")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("self-test", help="Run all self-tests")
    sub.add_parser("capabilities", help="Print capability report")
    sub.add_parser("snapshot", help="Save state snapshot")
    sub.add_parser("recover", help="Reload last snapshot")
    sub.add_parser("bench", help="Run benchmark suite")

    p_exec = sub.add_parser("execute", help="Execute a synthetic task")
    p_exec.add_argument("kind", choices=["identify", "identify_hard", "search",
                                          "verify", "compute"])
    p_exec.add_argument("n", type=int, help="Number of hypotheses")
    p_exec.add_argument("--budget", type=int, default=16)

    p_plan = sub.add_parser("plan", help="Show plan for a task kind")
    p_plan.add_argument("kind")

    args = parser.parse_args()

    if args.cmd == "self-test":
        return cmd_self_test()
    elif args.cmd == "capabilities":
        return cmd_capabilities()
    elif args.cmd == "execute":
        return cmd_execute(args.kind, args.n, args.budget)
    elif args.cmd == "snapshot":
        return cmd_snapshot()
    elif args.cmd == "recover":
        return cmd_recover()
    elif args.cmd == "plan":
        return cmd_plan(args.kind)
    elif args.cmd == "bench":
        # Import here to avoid circular import at module load
        from benchmarks.run_benchmarks import main as bench_main
        return bench_main()
    return 1


if __name__ == "__main__":
    sys.exit(main())
