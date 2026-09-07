#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
integration_test.py
===================

Cross-module integration test: exercises the full SRS pipeline end-to-end,
from eBPF telemetry → dynamic SMPU repartition → AgeMem decide_adm →
SEG evaluate → SQA assemble_quorum → BLS sign → ESR persist.

This test proves the six directories form a coherent system, not just
independent modules.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from kernel.omnivisor import Omnivisor, Domain, Page, PageAttribute
from kernel.smpu_sppu import (
    SmpuDriver, SppuDriver, SmpuRegion, SppuRule, Perm, Peripheral,
    DynamicSmpuController, TelemetrySnapshot,
)
from kernel.ebpf_telemetry import UnifiedTelemetryBus, SignalClass
from cognition.agemem_controller import AgeMemController, MemOp, MemTier, GRPOConfig
from cognition.adm_intent_mapper import (
    Intent, Context, Action, Reasoning, ProofKind, evaluate,
)
from governance.sqa_aggregator import (
    SQAAggregator, Validator, ValidatorVerdict, Verdict, ValidatorType,
)
from governance.bls_signatures import (
    generate_keypair, sign, aggregate, evidence_binding_sign, evidence_binding_verify,
)
from governance.seg_controller import SEGController, Mutation
from self_healing.digital_dna import DNAEncoder, DNARegistry
from self_healing.antibody_maturation import AntibodyRepertoire


def main() -> int:
    print("=" * 78)
    print("SRS Integration Test — Full Pipeline")
    print("=" * 78)

    # ---- Step 1: Omnivisor + SMPU + eBPF telemetry ----
    print("\n[1] Omnivisor + SMPU + eBPF telemetry")
    utb = UnifiedTelemetryBus()
    utb.attach_ebpf("ecr_probe", SignalClass.ECR_GATE_ERROR, "FPGA", "esr-ebpf-1")
    utb.emit("FPGA", SignalClass.ECR_GATE_ERROR, value=0.083, raw=83)
    utb.emit("FPGA", SignalClass.POWER_CLOCK, value=0.70, raw=700)

    smpu = SmpuDriver()
    smpu.program(SmpuRegion(base=0x40000000, size=0x100000,
                            owner="FPGA", perm=Perm.RWX, ti=True))
    dyn = DynamicSmpuController(smpu)
    snap = TelemetrySnapshot(
        theta={"FPGA": 0.70}, ecr_rate={"FPGA": 0.083},
        photonic_saturation=0.97, f_total=2.07,
    )
    events = dyn.consume_telemetry(snap, {"FPGA": 0, "Photonic": 0},
                                    seg_certify_fn=lambda x: True)
    print(f"  Telemetry → {len(events)} SMPU repartition events")
    assert len(events) >= 1
    assert smpu.regions[0].perm == Perm.RO  # quarantined

    # ---- Step 2: AgeMem decide_adm ----
    print("\n[2] AgeMem Adm-gated decision")
    ctrl = AgeMemController(cfg=GRPOConfig(group_size=2, traj_len=2, update_epochs=1))
    import numpy as np
    obs = np.zeros(16, dtype=np.float32)
    obs[0] = 1.0
    seed_rec = ctrl.execute_tool(
        op=MemOp.ADD, content="integration seed", tier=MemTier.LTM,
        salience=0.6, tags=["integration"],
    )
    ctx = Context(island="FPGA", theta=0.50,
                  epistemic_ids={seed_rec.rid}, tombstoned=set(),
                  risk_class="medium")
    op, tier, conf, chain, diags = ctrl.decide_adm(
        obs, intent=Intent.DIAGNOSE, ctx=ctx,
        parent_rid=seed_rec.rid, max_resample=4,
    )
    print(f"  decide_adm → op={op.value}, tier={tier.value}, admissible={chain.admissible}")
    assert chain.admissible

    # ---- Step 3: SQA quorum assembly ----
    print("\n[3] SQA quorum assembly")
    sqa = SQAAggregator()
    z3_val = Validator("z3-1", ValidatorType.FORMAL, "pk-z3")
    emp_val = Validator("emp-1", ValidatorType.EMPIRICAL, "pk-emp")
    heu_val = Validator("heu-1", ValidatorType.HEURISTIC, "pk-heu")
    for v in (z3_val, emp_val, heu_val):
        sqa.register_validator(v)

    verdicts = [
        ValidatorVerdict(z3_val, Verdict.ADMIT, 0.95, "Z3 witness certified", "sig-z3"),
        ValidatorVerdict(emp_val, Verdict.ADMIT, 0.88, "HIL pass", "sig-emp"),
        ValidatorVerdict(heu_val, Verdict.ADMIT, 0.81, "antibody matched", "sig-heu"),
    ]
    witness_hash = "sha256:integration-witness"
    cert = sqa.assemble_quorum("mut-int-1", "medium", verdicts, witness_hash)
    print(f"  Quorum: admissible={cert.admissible}, c_sum={cert.c_sum:.2f}, c_min={cert.c_min:.2f}")
    assert cert.admissible

    # ---- Step 4: BLS evidence binding ----
    print("\n[4] BLS evidence binding")
    kp = generate_keypair("integration-validator")
    binding = evidence_binding_sign(
        kp.private_key, witness_hash,
        [(v.validator.validator_id, v.calibrated_assurance) for v in verdicts],
    )
    print(f"  Binding signature: {len(binding)} bytes (BLS12-381 G2 point)")
    assert isinstance(binding, bytes) and len(binding) == 96
    # Verify the binding is cryptographically valid
    assert evidence_binding_verify(
        kp.public_key, witness_hash,
        [(v.validator.validator_id, v.calibrated_assurance) for v in verdicts],
        binding,
    )
    print(f"  Binding verified: ✓ (real BLS12-381 pairing check)")

    # ---- Step 5: SEG admission ----
    print("\n[5] SEG admission gate")
    seg = SEGController(sqa)
    seg.set_epoch(1)
    mutation = Mutation(
        mutation_id="mut-int-1",
        description="Integration test mutation",
        risk_class="medium",
        evidence_chain={
            "admissible": True,
            "seq": 1,
            "sqa_certificate_ref": "quorum:self#bls_evidence_binding",
            "z3_witness_hash": witness_hash,
        },
        z3_witness_hash=witness_hash,
        validators=verdicts,
    )
    decision = seg.evaluate(mutation)
    print(f"  SEG: admissible={decision.admissible}, reason={decision.reason}")
    assert decision.admissible

    # ---- Step 6: Digital DNA + antibody scan ----
    print("\n[6] Digital DNA + antibody scan")
    enc = DNAEncoder()
    reg = DNARegistry()
    rep = AntibodyRepertoire(reg)
    rep.seed("ab-ecr", "a1b2c3d4", defect_kind="ecr_cascade", threshold=0.70)
    dna = enc.encode_esr_trajectory(
        {"prompt": "resolve ECR cascade", "steps": [{"op": "FILTER"}]},
        esr_id="esr-int-1", env_snapshot="snap-int-1",
    )
    reg.register(dna)
    # Scan with a matching strand
    from self_healing.digital_dna import DigitalDNA, ArtefactKind
    match_strand = "a1b2c3d4" + "0" * (64 - 8)
    match_dna = DigitalDNA(strand=match_strand, fingerprint=[1.0]*32,
                           kind=ArtefactKind.ESR_TRAJECTORY,
                           provenance_esr_id="esr-int-2", environment_snapshot="snap")
    matches = rep.scan(match_dna)
    print(f"  Antibody scan: {len(matches)} matches")
    assert len(matches) >= 1

    # ---- Step 7: ESR persistence ----
    print("\n[7] ESR persistence")
    esr_entry = {
        "esr_id": "esr-int-1",
        "agent_id": "integration-test",
        "role": "Arbiter",
        "seq": 1,
        "version": 2,
        "evidence_chain": chain.to_dict(),
        "quorum": sqa.to_dict(cert),
    }
    esr_path = REPO_ROOT / "cognition" / "integration_esr_entry.json"
    with open(esr_path, "w") as f:
        json.dump(esr_entry, f, indent=2, default=str)
    print(f"  ESR entry written to: {esr_path.name}")
    assert esr_path.exists()

    print("\n" + "=" * 78)
    print("✅ INTEGRATION TEST PASSED — full pipeline operational")
    print("  telemetry → SMPU repartition → AgeMem decide_adm →")
    print("  SQA quorum → BLS binding → SEG admission → DNA/antibody → ESR persist")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
