"""Tests for simulation/, governance/, self_healing/ modules."""
import subprocess, sys
from pathlib import Path
REPO_ROOT = Path(__file__).resolve().parent.parent

def test_adaqc_compiler_self_test():
    result = subprocess.run([sys.executable, str(REPO_ROOT / "simulation" / "adaqc_compiler.py")],
        capture_output=True, text=True, timeout=30, cwd=str(REPO_ROOT))
    assert result.returncode == 0 and "PASSED" in result.stdout

def test_photonic_bus_self_test():
    result = subprocess.run([sys.executable, str(REPO_ROOT / "simulation" / "photonic_bus.py")],
        capture_output=True, text=True, timeout=30, cwd=str(REPO_ROOT))
    assert result.returncode == 0 and "PASSED" in result.stdout
    assert "Theoretical max" in result.stdout and "Measured throughput" in result.stdout

def test_adaqc_depth_reduction_mode():
    sys.path.insert(0, str(REPO_ROOT))
    from simulation.adaqc_compiler import AdaQCCompiler, NisqDevice
    device = NisqDevice(n_qubits=4, gate_errors={"R_Z": 0.001, "R_ZZ": 0.01, "SWAP": 0.02, "H": 0.002},
        gate_durations={"R_Z": 30, "R_ZZ": 200, "SWAP": 400, "H": 50}, connectivity=[(0, 1), (1, 2), (2, 3)])
    compiler = AdaQCCompiler(device)
    compiler.compile([("ZZ", 0.5 + 0j)], fidelity_budget=0.9, theta_fpga=0.70, theta_fpga_high=0.75)
    assert compiler.depth_reduction_mode is True
    compiler.compile([("ZZ", 0.5 + 0j)], fidelity_budget=0.9, theta_fpga=0.40, theta_fpga_high=0.75)
    assert compiler.depth_reduction_mode is False

def test_sqa_aggregator_self_test():
    result = subprocess.run([sys.executable, str(REPO_ROOT / "governance" / "sqa_aggregator.py")],
        capture_output=True, text=True, timeout=60, cwd=str(REPO_ROOT))
    assert result.returncode == 0 and "PASSED" in result.stdout

def test_bls_signatures_self_test():
    result = subprocess.run([sys.executable, str(REPO_ROOT / "governance" / "bls_signatures.py")],
        capture_output=True, text=True, timeout=60, cwd=str(REPO_ROOT))
    assert result.returncode == 0 and "PASSED" in result.stdout

def test_seg_controller_self_test():
    result = subprocess.run([sys.executable, str(REPO_ROOT / "governance" / "seg_controller.py")],
        capture_output=True, text=True, timeout=30, cwd=str(REPO_ROOT))
    assert result.returncode == 0 and "PASSED" in result.stdout

def test_seg_rejects_stale_epoch():
    sys.path.insert(0, str(REPO_ROOT))
    from governance.sqa_aggregator import SQAAggregator, Validator, ValidatorVerdict, Verdict, ValidatorType
    from governance.seg_controller import SEGController, Mutation
    sqa = SQAAggregator()
    seg = SEGController(sqa)
    seg.set_epoch(7)
    sqa.register_validator(Validator("z3", ValidatorType.FORMAL, 0))
    sqa.register_validator(Validator("emp", ValidatorType.EMPIRICAL, 0))
    sqa.register_validator(Validator("heu", ValidatorType.HEURISTIC, 0))
    verdicts = [
        ValidatorVerdict(Validator("z3", ValidatorType.FORMAL, 0), Verdict.ADMIT, 0.95, "ok"),
        ValidatorVerdict(Validator("emp", ValidatorType.EMPIRICAL, 0), Verdict.ADMIT, 0.88, "ok"),
        ValidatorVerdict(Validator("heu", ValidatorType.HEURISTIC, 0), Verdict.ADMIT, 0.81, "ok"),
    ]
    mut = Mutation(mutation_id="m1", description="test", risk_class="medium",
        evidence_chain={"admissible": True, "seq": 5, "sqa_certificate_ref": "quorum:self#bls_evidence_binding", "z3_witness_hash": "sha256:abc"},
        z3_witness_hash="sha256:abc", validators=verdicts)
    decision = seg.evaluate(mut)
    assert not decision.admissible and "seq mismatch" in decision.reason

def test_digital_dna_self_test():
    result = subprocess.run([sys.executable, str(REPO_ROOT / "self_healing" / "digital_dna.py")],
        capture_output=True, text=True, timeout=30, cwd=str(REPO_ROOT))
    assert result.returncode == 0 and "PASSED" in result.stdout

def test_antibody_maturation_self_test():
    result = subprocess.run([sys.executable, str(REPO_ROOT / "self_healing" / "antibody_maturation.py")],
        capture_output=True, text=True, timeout=30, cwd=str(REPO_ROOT))
    assert result.returncode == 0 and "PASSED" in result.stdout

def test_dna_encoder_deterministic():
    sys.path.insert(0, str(REPO_ROOT))
    from self_healing.digital_dna import DNAEncoder
    enc = DNAEncoder()
    artefact = {"top": "module_a", "ports": [{"name": "clk", "dir": "in"}]}
    dna1 = enc.encode_rtl(artefact, "esr-1", "snap-1")
    dna2 = enc.encode_rtl(artefact, "esr-2", "snap-2")
    assert dna1.strand == dna2.strand
    assert len(dna1.strand) == 64

def test_adm_linker_manifest_coverage():
    import json
    with open(REPO_ROOT / "adm_linker_manifest.json") as f:
        manifest = json.load(f)
    for entry in manifest["files"]:
        path = REPO_ROOT / entry["path"]
        assert path.exists(), f"manifest references missing file: {entry['path']}"
        assert len(entry["adm_rules"]) > 0, f"{entry['path']} has no Adm rules"
