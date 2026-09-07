"""Fault injection at every pipeline stage."""
import sys, json
from pathlib import Path
import pytest
import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from kernel.ebpf_telemetry import UnifiedTelemetryBus, SignalClass
from kernel.smpu_sppu import SmpuDriver, SmpuRegion, Perm, DynamicSmpuController, TelemetrySnapshot
from kernel.omnivisor import Omnivisor, Domain, Page, PageAttribute
from cognition.agemem_controller import AgeMemController, MemOp, MemTier, GRPOConfig
from cognition.adm_intent_mapper import Intent, Context
from governance.sqa_aggregator import SQAAggregator, Validator, ValidatorVerdict, Verdict, ValidatorType
from governance.seg_controller import SEGController, Mutation
from self_healing.digital_dna import DNAEncoder, DNARegistry

def test_fault_telemetry_invalid_island():
    utb = UnifiedTelemetryBus()
    assert utb.emit("NONEXISTENT", SignalClass.POWER_CLOCK, value=0.5) is False

def test_fault_telemetry_invalid_values():
    utb = UnifiedTelemetryBus()
    utb.emit("APU", SignalClass.POWER_CLOCK, value=-999.0)
    utb.emit("APU", SignalClass.POWER_CLOCK, value=float('inf'))
    assert utb.snapshot() is not None

def test_fault_smpu_impossible_thermal():
    smpu = SmpuDriver()
    smpu.program(SmpuRegion(base=0x40000000, size=0x100000, owner="FPGA", perm=Perm.RWX, ti=True))
    dyn = DynamicSmpuController(smpu)
    snap = TelemetrySnapshot(theta={"FPGA": 999.0}, ecr_rate={"FPGA": 0.08}, photonic_saturation=0.5)
    events = dyn.consume_telemetry(snap, {"FPGA": 0}, seg_certify_fn=lambda x: True)
    assert len(events) > 0

def test_fault_smpu_negative_ecr():
    smpu = SmpuDriver()
    smpu.program(SmpuRegion(base=0x40000000, size=0x100000, owner="FPGA", perm=Perm.RWX, ti=True))
    dyn = DynamicSmpuController(smpu)
    snap = TelemetrySnapshot(theta={"FPGA": 0.5}, ecr_rate={"FPGA": -0.5}, photonic_saturation=0.5)
    events = dyn.consume_telemetry(snap, {"FPGA": 0}, seg_certify_fn=lambda x: True)
    assert isinstance(events, list)

def test_fault_agemem_policy_failure():
    ctrl = AgeMemController(cfg=GRPOConfig(group_size=2, traj_len=2, update_epochs=1))
    obs = np.zeros(16, dtype=np.float32)
    seed_rec = ctrl.execute_tool(op=MemOp.ADD, content="fault seed", tier=MemTier.LTM, salience=0.6)
    ctx = Context(island="FPGA", theta=0.5, epistemic_ids={seed_rec.rid}, tombstoned=set(), risk_class="medium")
    op, tier, conf, chain, diags = ctrl.decide_adm(obs, intent=Intent.DIAGNOSE, ctx=ctx, parent_rid=seed_rec.rid, max_resample=2)
    assert chain is not None

def test_fault_agemem_missing_parent():
    ctrl = AgeMemController(cfg=GRPOConfig(group_size=2, traj_len=2, update_epochs=1))
    obs = np.zeros(16, dtype=np.float32)
    ctx = Context(island="FPGA", theta=0.5, epistemic_ids={"nonexistent"}, tombstoned=set(), risk_class="medium")
    op, tier, conf, chain, diags = ctrl.decide_adm(obs, intent=Intent.DIAGNOSE, ctx=ctx, parent_rid="nonexistent", max_resample=2)
    assert chain is not None

def test_fault_sqa_byzantine_validator():
    sqa = SQAAggregator()
    v0, v1, v2 = Validator("v0", ValidatorType.FORMAL), Validator("v1", ValidatorType.EMPIRICAL), Validator("v2", ValidatorType.HEURISTIC)
    for v in (v0, v1, v2): sqa.register_validator(v)
    vs = [ValidatorVerdict(v0, Verdict.ADMIT, 0.95, "admit"), ValidatorVerdict(v0, Verdict.REJECT, 0.0, "reject"),
          ValidatorVerdict(v1, Verdict.ADMIT, 0.88, "ok"), ValidatorVerdict(v2, Verdict.ADMIT, 0.81, "ok")]
    cert = sqa.assemble_quorum("byz", "medium", vs, "sha256:abc")
    assert cert is not None

def test_fault_sqa_empty_verdicts():
    sqa = SQAAggregator()
    cert = sqa.assemble_quorum("empty", "medium", [], "sha256:abc")
    assert not cert.admissible

def test_fault_seg_epoch_rollback():
    sqa = SQAAggregator()
    seg = SEGController(sqa)
    seg.set_epoch(10)
    v0, v1, v2 = Validator("v0", ValidatorType.FORMAL), Validator("v1", ValidatorType.EMPIRICAL), Validator("v2", ValidatorType.HEURISTIC)
    for v in (v0, v1, v2): sqa.register_validator(v)
    vs = [ValidatorVerdict(v0, Verdict.ADMIT, 0.95, "ok"), ValidatorVerdict(v1, Verdict.ADMIT, 0.88, "ok"), ValidatorVerdict(v2, Verdict.ADMIT, 0.81, "ok")]
    mut = Mutation("old", "test", "medium", {"admissible": True, "seq": 5, "sqa_certificate_ref": "quorum:self#bls_evidence_binding", "z3_witness_hash": "sha256:abc"}, "sha256:abc", vs)
    d = seg.evaluate(mut)
    assert not d.admissible and "seq mismatch" in d.reason

def test_fault_dna_corrupted_artefact():
    enc = DNAEncoder()
    dna = enc.encode_rtl({"a": {"b": {"c": {"d": {"e": "deep"}}}}}, "e", "s")
    assert len(dna.fingerprint) == 32
    dna2 = enc.encode_rtl({}, "e2", "s2")
    assert dna2 is not None
    dna3 = enc.encode_rtl({"data": "X" * 100000}, "e3", "s3")
    assert dna3 is not None

def test_fault_dna_empty_fingerprint():
    from self_healing.digital_dna import DigitalDNA, ArtefactKind
    d1 = DigitalDNA(strand="abc", fingerprint=[], kind=ArtefactKind.RTL_DESIGN, provenance_esr_id="e1", environment_snapshot="s1")
    d2 = DigitalDNA(strand="def", fingerprint=[1.0, 0.5], kind=ArtefactKind.RTL_DESIGN, provenance_esr_id="e2", environment_snapshot="s2")
    assert d1.affinity(d2) == 0.0

def test_fault_full_pipeline_sequential():
    faults = 0
    try:
        utb = UnifiedTelemetryBus()
        utb.emit("BAD", SignalClass.POWER_CLOCK, 0.5)
        faults += 1
    except: pass
    try:
        smpu = SmpuDriver()
        smpu.program(SmpuRegion(base=0, size=1, owner="X", perm=Perm.RW))
        dyn = DynamicSmpuController(smpu)
        dyn.consume_telemetry(TelemetrySnapshot(theta={"X": -1.0}, ecr_rate={"X": -1.0}), {"X": 0}, seg_certify_fn=lambda x: True)
        faults += 1
    except: pass
    try:
        ctrl = AgeMemController(cfg=GRPOConfig(group_size=1, traj_len=1, update_epochs=1))
        ctx = Context(island="X", theta=0.0, epistemic_ids=set(), tombstoned=set(), risk_class="low")
        ctrl.decide_adm(np.zeros(16, dtype=np.float32), intent=Intent.DIAGNOSE, ctx=ctx, parent_rid=None, max_resample=1)
        faults += 1
    except: pass
    try:
        sqa = SQAAggregator()
        cert = sqa.assemble_quorum("f", "medium", [], "sha256:abc")
        assert not cert.admissible
        faults += 1
    except: pass
    try:
        sqa2 = SQAAggregator()
        seg = SEGController(sqa2)
        seg.set_epoch(0)
        d = seg.evaluate(Mutation("f", "t", "medium", {}, "", []))
        assert not d.admissible
        faults += 1
    except: pass
    try:
        enc = DNAEncoder()
        dna = enc.encode_rtl({}, "e", "s")
        assert len(dna.fingerprint) == 32
        faults += 1
    except: pass
    assert faults >= 4, f"System must survive >=4/6 faults, survived {faults}"
