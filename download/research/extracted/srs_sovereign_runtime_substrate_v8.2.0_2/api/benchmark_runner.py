#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
benchmark_runner.py — Runs SRS performance benchmarks + publishes results.

Executes the 11 core benchmarks without requiring pytest-benchmark,
measures latency/throughput, and writes a JSON report.

Usage:
  python3 api/benchmark_runner.py
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _wrap(*fns):
    """Call multiple functions, ignoring return values."""
    for fn in fns[:-1]:
        fn()
    return fns[-1]()

def _timed(fn, iterations: int = 100) -> Dict[str, Any]:
    """Run fn `iterations` times, return timing stats."""
    latencies: List[float] = []
    for _ in range(iterations):
        start = time.perf_counter()
        fn()
        latencies.append((time.perf_counter() - start) * 1_000_000)  # µs
    latencies.sort()
    n = len(latencies)
    return {
        "iterations": n,
        "min_us": latencies[0],
        "max_us": latencies[-1],
        "mean_us": sum(latencies) / n,
        "median_us": latencies[n // 2],
        "p95_us": latencies[int(n * 0.95)] if n > 20 else latencies[-1],
        "ops_per_sec": n / (sum(latencies) / 1_000_000) if sum(latencies) > 0 else 0,
    }


def run_benchmarks() -> Dict[str, Any]:
    """Run all SRS benchmarks and return a report."""
    results: Dict[str, Any] = {"timestamp": time.time(), "benchmarks": {}}

    # 1. SEG admission
    try:
        from governance.sqa_aggregator import (
            SQAAggregator, Validator, ValidatorVerdict, Verdict, ValidatorType,
        )
        from governance.seg_controller import SEGController, Mutation
        sqa = SQAAggregator()
        seg = SEGController(sqa)
        seg.set_epoch(1)
        for vid, vt in [("z3-01", ValidatorType.FORMAL), ("emp-02", ValidatorType.EMPIRICAL),
                        ("heu-03", ValidatorType.HEURISTIC)]:
            sqa.register_validator(Validator(vid, vt, 0))
        verdicts = [ValidatorVerdict(Validator(f"v{i}", ValidatorType.FORMAL, 0),
                     Verdict.ADMIT, 0.9, "ok", "") for i in range(3)]
        mut = Mutation("bench-mut", "bench", "medium",
                       {"admissible": True, "seq": 1,
                        "sqa_certificate_ref": "quorum:self#bls_evidence_binding",
                        "z3_witness_hash": "sha256:bench"}, "sha256:bench", verdicts)
        results["benchmarks"]["seg_admission"] = _timed(lambda: seg.evaluate(mut), 200)
    except Exception as e:
        results["benchmarks"]["seg_admission"] = {"error": str(e)}

    # 2. Z3 nominal solve
    try:
        from verification.z3_power_proof import SmtEncoder
        enc1 = SmtEncoder()
        results["benchmarks"]["z3_nominal_solve"] = _timed(
            lambda: (enc1.encode(), enc1.check_satisfiability()), 50)  # type: ignore[func-returns-value]
    except Exception as e:
        results["benchmarks"]["z3_nominal_solve"] = {"error": str(e)}

    # 3. Z3 safety proof
    try:
        from verification.z3_power_proof import SafetyProofEncoder
        enc2 = SafetyProofEncoder()
        results["benchmarks"]["z3_safety_proof"] = _timed(
            lambda: (enc2.encode(), enc2.prove_safety()), 20)  # type: ignore[func-returns-value]
    except Exception as e:
        results["benchmarks"]["z3_safety_proof"] = {"error": str(e)}

    # 4. AdaQC compile
    try:
        from simulation.adaqc_compiler import AdaQCCompiler, NisqDevice
        device = NisqDevice(n_qubits=4, gate_errors={"R_Z": 0.001, "R_ZZ": 0.01},
                            gate_durations={"R_Z": 0, "R_ZZ": 200},
                            connectivity=[(0,1),(1,2),(2,3)])
        compiler = AdaQCCompiler(device)
        ham = [("ZZ", 0.5+0j), ("XX", 0.3+0j)]
        results["benchmarks"]["adaqc_compile"] = _timed(
            lambda: compiler.compile(ham, 0.90, 0.40, 0.75), 200)
    except Exception as e:
        results["benchmarks"]["adaqc_compile"] = {"error": str(e)}

    # 5. DNA encoding
    try:
        from self_healing.digital_dna import DNAEncoder
        enc3 = DNAEncoder()
        data = {"step1": {"op": "ADD"}, "step2": {"op": "FILTER"}}
        results["benchmarks"]["dna_encoding"] = _timed(
            lambda: enc3.encode_esr_trajectory(data, "esr-1", "snap-1"), 200)
    except Exception as e:
        results["benchmarks"]["dna_encoding"] = {"error": str(e)}

    # 6. Photonic bus
    try:
        from simulation.photonic_bus import PhotonicBus, PhotonicPacket
        bus = PhotonicBus(n_nodes=4)
        pkt = PhotonicPacket(payload=b"x"*1024, source="s", dest="d")
        results["benchmarks"]["photonic_bus"] = _timed(
            lambda: (bus.route_packet(pkt), bus.tick()), 200)  # type: ignore[func-returns-value]
    except Exception as e:
        results["benchmarks"]["photonic_bus"] = {"error": str(e)}

    # 7. BLS sign (expensive — fewer iterations)
    try:
        from governance.bls_signatures import generate_keypair, sign, verify
        kp = generate_keypair("bench")
        msg = "benchmark-message"
        results["benchmarks"]["bls_sign"] = _timed(lambda: sign(kp.private_key, msg), 10)
        sig = sign(kp.private_key, msg)
        results["benchmarks"]["bls_verify"] = _timed(lambda: verify(kp.public_key, msg, sig), 5)
    except Exception as e:
        results["benchmarks"]["bls_sign"] = {"error": str(e)}

    # 8. Audit chain append
    try:
        from governance.audit import AuditChain
        chain = AuditChain()
        results["benchmarks"]["audit_append"] = _timed(
            lambda: chain.append("bench", "agent", "test", "res"), 500)
    except Exception as e:
        results["benchmarks"]["audit_append"] = {"error": str(e)}

    # 9. Policy evaluation
    try:
        from governance.policy import default_policy_set
        engine = default_policy_set()
        ctx = {"request_tenant": "acme", "resource_tenant": "acme",
               "action": "mutation:submit", "risk_class": "low"}
        results["benchmarks"]["policy_evaluate"] = _timed(
            lambda: engine.evaluate(ctx), 500)
    except Exception as e:
        results["benchmarks"]["policy_evaluate"] = {"error": str(e)}

    # Summary
    successful = sum(1 for v in results["benchmarks"].values() if "error" not in v)
    results["summary"] = {
        "total_benchmarks": len(results["benchmarks"]),
        "successful": successful,
        "failed": len(results["benchmarks"]) - successful,
    }
    return results


def main() -> int:
    print("=" * 78)
    print("SRS Benchmark Suite — Measured Performance")
    print("=" * 78)
    results = run_benchmarks()
    print(f"\n  Ran {results['summary']['successful']}/{results['summary']['total_benchmarks']} benchmarks\n")
    print(f"  {'Benchmark':<25} {'Mean':>10} {'Median':>10} {'P95':>10} {'Ops/sec':>12}")
    print(f"  {'─'*25} {'─'*10} {'─'*10} {'─'*10} {'─'*12}")
    for name, stats in results["benchmarks"].items():
        if "error" in stats:
            print(f"  {name:<25} {'ERROR':>10}")
        else:
            unit = "µs" if stats["mean_us"] < 1000 else "ms"
            mean = stats["mean_us"] / 1000 if unit == "ms" else stats["mean_us"]
            med = stats["median_us"] / 1000 if unit == "ms" else stats["median_us"]
            p95 = stats["p95_us"] / 1000 if unit == "ms" else stats["p95_us"]
            print(f"  {name:<25} {mean:>8.2f}{unit} {med:>8.2f}{unit} {p95:>8.2f}{unit} {stats['ops_per_sec']:>12,.0f}")

    out_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "docs", "BENCHMARK_RESULTS_LIVE.md")
    with open(out_path, "w") as f:
        f.write("# SRS Benchmark Results — Live Measurements\n\n")
        f.write(f"**Date**: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"**Python**: {sys.version.split()[0]}\n\n")
        f.write("| Benchmark | Mean | Median | P95 | Ops/sec |\n")
        f.write("|-----------|------|--------|-----|---------|\n")
        for name, stats in results["benchmarks"].items():
            if "error" not in stats:
                f.write(f"| {name} | {stats['mean_us']:.1f}µs | {stats['median_us']:.1f}µs | "
                        f"{stats['p95_us']:.1f}µs | {stats['ops_per_sec']:,.0f} |\n")
    print(f"\n  Results saved to: {out_path}")
    # Also save JSON
    json_path = out_path.replace(".md", ".json")
    with open(json_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"  JSON saved to: {json_path}")
    print("\n" + "=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
