"""Tests for the cognition/ module (AgeMem, Adm mapper, GRPO)."""
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_agemem_controller_self_test():
    """Run agemem_controller.py self-test."""
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "cognition" / "agemem_controller.py")],
        capture_output=True, text=True, timeout=60,
        cwd=str(REPO_ROOT),
    )
    assert result.returncode == 0
    assert "PASSED" in result.stdout


def test_agemem_adm_trainer_self_test():
    """Run agemem_adm_trainer.py self-test."""
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "cognition" / "agemem_adm_trainer.py")],
        capture_output=True, text=True, timeout=60,
        cwd=str(REPO_ROOT),
    )
    assert result.returncode == 0
    assert "PASSED" in result.stdout


def test_adm_intent_mapper_self_test():
    """Run adm_intent_mapper.py self-test."""
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "cognition" / "adm_intent_mapper.py")],
        capture_output=True, text=True, timeout=30,
        cwd=str(REPO_ROOT),
    )
    assert result.returncode == 0
    assert "PASSED" in result.stdout
    assert "ALL CASES PASSED" in result.stdout


def test_esr_schema_valid_json():
    """Verify esr_schema.json is valid JSON and has v2.0 fields."""
    import json
    with open(REPO_ROOT / "cognition" / "esr_schema.json") as f:
        schema = json.load(f)
    assert "v2.0" in schema["$id"]
    assert "evidence_chain" in schema["required"]
    assert "seq" in schema["required"]
    assert "bls_evidence_binding" in schema["properties"]["quorum"]["properties"]


def test_esr_sample_entry_conforms():
    """Verify the sample ESR entry has all v2.0 required fields."""
    import json
    with open(REPO_ROOT / "cognition" / "esr_sample_entry.json") as f:
        entry = json.load(f)
    assert entry["version"] == 2
    assert "seq" in entry
    assert "evidence_chain" in entry
    assert "bls_evidence_binding" in entry["quorum"]
    assert entry["quorum"]["bls_evidence_binding"]["c_sum"] >= entry["quorum"]["bls_evidence_binding"]["c_min"]


def test_adm_mapper_rejects_delete_without_parent():
    """Unit test: DELETE without parent_rid is rejected."""
    sys.path.insert(0, str(REPO_ROOT))
    from cognition.adm_intent_mapper import (
        Intent, Context, Action, Reasoning, ProofKind, evaluate, MemOp, MemTier,
    )

    ctx = Context(island="FPGA", theta=0.4,
                  epistemic_ids={"rid-001"}, tombstoned=set(),
                  risk_class="medium")
    action = Action(op=MemOp.DELETE, tier=MemTier.STM, parent_rid=None)
    reasoning = Reasoning(logprob=-1.0, value=0.5, advantage=None,
                          proof_refs=(ProofKind.SQA_QUORUM,))
    admissible, diags = evaluate(Intent.RETIRE, ctx, action, reasoning)
    assert not admissible
    assert any("parent" in d.lower() for d in diags)
