#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bench_srs.py — Real performance benchmarks using pytest-benchmark.

Addresses audit gap H2: "No benchmarks, no performance measurements,
but performance numbers are claimed."

Measures:
  - BLS sign/verify/aggregate latency (real BLS12-381)
  - SEG admission latency
  - Z3 solve time (nominal + contention-resolution)
  - AdaQC compile time
  - Photonic bus throughput
"""
from __future__ import annotations

import sys
import os
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))


# ---------------------------------------------------------------------------
# BLS benchmarks (real BLS12-381)
# ---------------------------------------------------------------------------

def test_bls_sign_benchmark(benchmark):
    """Benchmark: BLS12-381 sign latency."""
    from governance.bls_signatures import generate_keypair, sign
    kp = generate_keypair("bench-validator")
    msg = "benchmark-mutation-001"
    benchmark(sign, kp.private_key, msg)


def test_bls_verify_benchmark(benchmark):
    """Benchmark: BLS12-381 verify latency."""
    from governance.bls_signatures import generate_keypair, sign, verify
    kp = generate_keypair("bench-validator")
    msg = "benchmark-mutation-001"
    sig = sign(kp.private_key, msg)
    benchmark(verify, kp.public_key, msg, sig)


def test_bls_aggregate_benchmark(benchmark):
    """Benchmark: BLS aggregate (3 signatures) latency."""
    from governance.bls_signatures import generate_keypair, sign, aggregate
    sigs = []
    for i in range(3):
        kp = generate_keypair(f"bench-validator-{i}")
        sigs.append(sign(kp.private_key, "benchmark-msg"))
    benchmark(aggregate, sigs)


def test_bls_evidence_binding_benchmark(benchmark):
    """Benchmark: BLS evidence binding sign latency."""
    from governance.bls_signatures import generate_keypair, evidence_binding_sign
    kp = generate_keypair("bench-validator")
    witness = "sha256:bench-witness"
    assurances = [("v1", 0.95), ("v2", 0.88), ("v3", 0.81)]
    benchmark(evidence_binding_sign, kp.private_key, witness, assurances)


# ---------------------------------------------------------------------------
# SEG admission benchmark
# ---------------------------------------------------------------------------

def test_seg_admission_benchmark(benchmark):
    """Benchmark: SEG admission gate latency."""
    from governance.seg_controller import SEGController, Mutation
    from governance.sqa_aggregator import (
        SQAAggregator, Validator, ValidatorVerdict, Verdict, ValidatorType,
    )

    sqa = SQAAggregator()
    seg = SEGController(sqa)
    seg.set_epoch(1)

    for i, vt in enumerate([ValidatorType.FORMAL, ValidatorType.EMPIRICAL,
                            ValidatorType.HEURISTIC]):
        sqa.register_validator(Validator(f"v{i}", vt, f"pk{i}"))

    verdicts = [
        ValidatorVerdict(Validator("v0", ValidatorType.FORMAL, "pk0"),
                         Verdict.ADMIT, 0.95, "ok", "sig0"),
        ValidatorVerdict(Validator("v1", ValidatorType.EMPIRICAL, "pk1"),
                         Verdict.ADMIT, 0.88, "ok", "sig1"),
        ValidatorVerdict(Validator("v2", ValidatorType.HEURISTIC, "pk2"),
                         Verdict.ADMIT, 0.81, "ok", "sig2"),
    ]
    mut = Mutation(
        mutation_id="bench-mut",
        description="benchmark",
        risk_class="medium",
        evidence_chain={
            "admissible": True, "seq": 1,
            "sqa_certificate_ref": "quorum:self#bls_evidence_binding",
            "z3_witness_hash": "sha256:bench",
        },
        z3_witness_hash="sha256:bench",
        validators=verdicts,
    )

    def evaluate():
        return seg.evaluate(mut)

    benchmark(evaluate)


# ---------------------------------------------------------------------------
# Z3 solve benchmarks
# ---------------------------------------------------------------------------

def test_z3_nominal_solve_benchmark(benchmark):
    """Benchmark: Z3 nominal mode solve time."""
    from verification.z3_power_proof import SmtEncoder
    enc = SmtEncoder()
    enc.encode()
    benchmark(enc.check_satisfiability)


def test_z3_contention_solve_benchmark(benchmark):
    """Benchmark: Z3 contention-resolution mode solve time."""
    from verification.z3_power_proof import ContentionResolutionEncoder
    enc = ContentionResolutionEncoder(epsilon=0.05, target_margin=0.05)
    enc.encode()
    benchmark(enc.check_satisfiability)


def test_z3_safety_proof_benchmark(benchmark):
    """Benchmark: Z3 safety proof (¬safety → UNSAT check) time."""
    from verification.z3_power_proof import SafetyProofEncoder
    enc = SafetyProofEncoder()
    enc.encode()
    benchmark(enc.prove_safety)


# ---------------------------------------------------------------------------
# AdaQC compile benchmark
# ---------------------------------------------------------------------------

def test_adaqc_compile_benchmark(benchmark):
    """Benchmark: AdaQC circuit compilation time."""
    from simulation.adaqc_compiler import AdaQCCompiler, NisqDevice
    device = NisqDevice(
        n_qubits=4,
        gate_errors={"R_Z": 0.001, "R_ZZ": 0.01, "SWAP": 0.02, "H": 0.002},
        gate_durations={"R_Z": 30, "R_ZZ": 200, "SWAP": 400, "H": 50},
        connectivity=[(0, 1), (1, 2), (2, 3)],
    )
    compiler = AdaQCCompiler(device)
    hamiltonian = [("ZZ", 0.5 + 0j), ("XX", 0.3 + 0j)]

    def compile_circuit():
        return compiler.compile(hamiltonian, fidelity_budget=0.90,
                                theta_fpga=0.40, theta_fpga_high=0.75)

    benchmark(compile_circuit)


# ---------------------------------------------------------------------------
# Photonic bus throughput benchmark
# ---------------------------------------------------------------------------

def test_photonic_bus_throughput_benchmark(benchmark):
    """Benchmark: photonic bus packet delivery throughput."""
    from simulation.photonic_bus import PhotonicBus, PhotonicPacket

    bus = PhotonicBus(n_nodes=4)

    def deliver_packets():
        for i in range(100):
            bus.route_packet(PhotonicPacket(
                payload=b"x" * 1024,
                source="node-0",
                dest=f"node-{i % 4}",
            ))
        return bus.tick()

    benchmark(deliver_packets)


# ---------------------------------------------------------------------------
# Digital DNA encoding benchmark
# ---------------------------------------------------------------------------

def test_dna_encoding_benchmark(benchmark):
    """Benchmark: Digital DNA strand computation time."""
    from self_healing.digital_dna import DNAEncoder
    enc = DNAEncoder()
    artefact = {
        "top": "bench_module",
        "submodules": ["a", "b", "c"],
        "ports": [{"name": f"p{i}", "dir": "in"} for i in range(20)],
    }

    def encode():
        return enc.encode_rtl(artefact, "esr-bench", "snap-bench")

    benchmark(encode)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--benchmark-only", "--benchmark-columns=mean,std,ops"])
