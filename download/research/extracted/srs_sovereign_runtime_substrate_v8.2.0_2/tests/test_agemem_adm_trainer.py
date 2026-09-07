"""Tests for cognition/agemem_adm_trainer.py.

Target: push coverage from 36% to 70%+ by directly exercising:
  - AdmGRPOConfig defaults
  - AdmGRPOTrainer._infer_intent() (all prompt → intent mappings)
  - AdmGRPOTrainer._build_context()
  - AdmGRPOTrainer._step_reward() (SL bonus, fabrication penalty, admit bonus)
  - AdmGRPOTrainer.rollout_group()
  - AdmAgeMemController construction
  - self_test()
"""
from __future__ import annotations

import pytest
import numpy as np

from cognition.agemem_adm_trainer import (
    AdmGRPOConfig,
    AdmGRPOTrainer,
    AdmAgeMemController,
    SL_BONUS,
    EVIDENCE_FABRICATION_PENALTY,
    ADM_ADMIT_BONUS,
    self_test,
)
from cognition.agemem_controller import (
    AgeMemController, AgeMemPolicy, MemOp, MemTier, MemoryEnv,
    EvidenceChain, TOOL_TO_IDX,
)
from cognition.adm_intent_mapper import Intent, Context, Action, Reasoning, ProofKind


# ---------------------------------------------------------------------------
# AdmGRPOConfig
# ---------------------------------------------------------------------------

def test_adm_grpo_config_defaults():
    """Default config has the RFAE-spec reward shaping constants."""
    cfg = AdmGRPOConfig()
    assert cfg.sl_bonus == SL_BONUS
    assert cfg.evidence_fab_penalty == EVIDENCE_FABRICATION_PENALTY
    assert cfg.admit_bonus == ADM_ADMIT_BONUS
    assert cfg.max_resample >= 1
    # Inherited from GRPOConfig
    assert cfg.group_size >= 1
    assert cfg.traj_len >= 1


def test_adm_grpo_config_override():
    """Config fields can be overridden."""
    cfg = AdmGRPOConfig(sl_bonus=0.5, evidence_fab_penalty=-2.0, max_resample=5)
    assert cfg.sl_bonus == 0.5
    assert cfg.evidence_fab_penalty == -2.0
    assert cfg.max_resample == 5


# ---------------------------------------------------------------------------
# _infer_intent() — all prompt → intent mappings
# ---------------------------------------------------------------------------

def _make_trainer():
    """Helper: build an AdmGRPOTrainer with minimal deps."""
    cfg = AdmGRPOConfig(group_size=2, traj_len=2)
    ctrl = AdmAgeMemController(cfg=cfg)
    return ctrl.trainer


def test_infer_intent_diagnose():
    """'Diagnose' in prompt → Intent.DIAGNOSE."""
    trainer = _make_trainer()
    assert trainer._infer_intent("Diagnose the thermal surge") == Intent.DIAGNOSE


def test_infer_intent_resolve():
    """'Resolve' in prompt → Intent.DIAGNOSE ( Resolve maps to DIAGNOSE)."""
    trainer = _make_trainer()
    assert trainer._infer_intent("Resolve the contention") == Intent.DIAGNOSE


def test_infer_intent_promote():
    trainer = _make_trainer()
    assert trainer._infer_intent("Promote to SC") == Intent.PROMOTE


def test_infer_intent_quorum():
    trainer = _make_trainer()
    assert trainer._infer_intent("Quorum-validate the mutation") == Intent.QUORUM_VAL


def test_infer_intent_rebalance():
    trainer = _make_trainer()
    assert trainer._infer_intent("Rebalance the FPGA clock tree") == Intent.REBALANCE


def test_infer_intent_refactor():
    trainer = _make_trainer()
    assert trainer._infer_intent("Refactor the memory layer") == Intent.REFACTOR


def test_infer_intent_heal():
    trainer = _make_trainer()
    assert trainer._infer_intent("Heal the DNA strand") == Intent.REFACTOR


def test_infer_intent_retire():
    trainer = _make_trainer()
    assert trainer._infer_intent("Retire the old belief") == Intent.RETIRE


def test_infer_intent_delete():
    trainer = _make_trainer()
    assert trainer._infer_intent("Delete the tombstoned record") == Intent.RETIRE


def test_infer_intent_default():
    """Unknown prompt → Intent.DIAGNOSE (default)."""
    trainer = _make_trainer()
    assert trainer._infer_intent("unknown prompt") == Intent.DIAGNOSE


# ---------------------------------------------------------------------------
# _build_context()
# ---------------------------------------------------------------------------

def test_build_context_returns_well_formed_context():
    """_build_context returns a Context with the seed_rid in epistemic_ids."""
    trainer = _make_trainer()
    env = MemoryEnv()
    ctx = trainer._build_context(env, "seed-rid-001")
    assert isinstance(ctx, Context)
    assert "seed-rid-001" in ctx.epistemic_ids
    assert ctx.tombstoned == set()
    assert ctx.risk_class == "low"


# ---------------------------------------------------------------------------
# _step_reward() — SL bonus, fabrication penalty, admit bonus
# ---------------------------------------------------------------------------

def _make_chain(admissible: bool = True, parent_rid: str = "parent-001",
                epistemic_ids: set = None, tombstoned: set = None,
                logprob: float = -0.5, value: float = 0.5):
    """Build a minimal EvidenceChain for reward testing."""
    ctx = Context(
        island="APU", theta=0.5,
        epistemic_ids=epistemic_ids or {"parent-001"},
        tombstoned=tombstoned or set(),
        risk_class="low",
    )
    action = Action(op=MemOp.DELETE, tier=MemTier.STM, parent_rid=parent_rid)
    reasoning = Reasoning(
        logprob=logprob, value=value, advantage=0.0,
        proof_refs=(ProofKind.SQA_QUORUM,),
        esr_evidence=(),
    )
    return EvidenceChain(
        intent=Intent.RETIRE,
        context=ctx,
        action=action,
        reasoning=reasoning,
        admissible=admissible,
        attempts=[{"attempt": 0, "admitted": admissible}],
    )


def test_step_reward_sl_bonus_for_correct_delete():
    """A correct DELETE tombstoning gets +sl_bonus on top of base reward."""
    trainer = _make_trainer()
    env = MemoryEnv()
    env.reset("Diagnose the thermal surge")  # must reset before step()
    chain = _make_chain(admissible=True, parent_rid="parent-001",
                        epistemic_ids={"parent-001"})
    reward, _, _, _ = trainer._step_reward(
        env, MemOp.DELETE, MemTier.STM, chain, ["attempt 0: ADMITTED"],
        "parent-001",
    )
    # The reward should be positive (SL bonus + admit bonus > 0).
    assert reward > 0  # SL bonus + admit bonus dominate


def test_step_reward_fabrication_penalty_for_inadmissible():
    """An inadmissible chain gets the fabrication penalty."""
    trainer = _make_trainer()
    env = MemoryEnv()
    env.reset("Diagnose the thermal surge")
    chain = _make_chain(admissible=False)
    reward, _, _, _ = trainer._step_reward(
        env, MemOp.SUMMARY, MemTier.LTM, chain, [], "parent-001",
    )
    # The reward should include the negative fabrication penalty.
    # Base reward for SUMMARY is typically small; fabrication penalty is -1.0.
    assert reward < 0  # fabrication penalty dominates


def test_step_reward_admit_bonus_for_first_attempt():
    """The admit bonus is awarded when diags[0] contains 'attempt 0: ADMITTED'."""
    trainer = _make_trainer()
    env = MemoryEnv()
    env.reset("Diagnose the thermal surge")
    chain = _make_chain(admissible=True)
    reward_admit, _, _, _ = trainer._step_reward(
        env, MemOp.SUMMARY, MemTier.LTM, chain,
        ["attempt 0: ADMITTED"], "parent-001",
    )
    env2 = MemoryEnv()
    env2.reset("Diagnose the thermal surge")
    trainer2 = _make_trainer()
    trainer2.controller.env = env2  # not actually used by _step_reward
    reward_no_admit, _, _, _ = trainer2._step_reward(
        env2, MemOp.SUMMARY, MemTier.LTM, chain,
        ["attempt 0: REJECTED", "attempt 1: ADMITTED"], "parent-001",
    )
    # Both are admissible, but the first should get the admit bonus.
    assert reward_admit > reward_no_admit


# ---------------------------------------------------------------------------
# rollout_group()
# ---------------------------------------------------------------------------

def test_rollout_group_returns_trajectories():
    """rollout_group returns a list of Trajectory objects."""
    trainer = _make_trainer()
    env = MemoryEnv()
    trajs = trainer.rollout_group("Diagnose the thermal surge", env)
    assert isinstance(trajs, list)
    assert len(trajs) == trainer.cfg.group_size
    for t in trajs:
        assert len(t.steps) > 0  # at least one step


def test_rollout_group_different_prompts():
    """rollout_group works with different prompts (different intents)."""
    trainer = _make_trainer()
    env = MemoryEnv()
    for prompt in ["Diagnose thermal", "Rebalance FPGA", "Promote to SC"]:
        trajs = trainer.rollout_group(prompt, env)
        assert len(trajs) == trainer.cfg.group_size


# ---------------------------------------------------------------------------
# AdmAgeMemController
# ---------------------------------------------------------------------------

def test_adm_agemem_controller_constructs_with_defaults():
    """AdmAgeMemController can be constructed with no args."""
    ctrl = AdmAgeMemController()
    assert ctrl is not None
    assert isinstance(ctrl.trainer, AdmGRPOTrainer)
    assert isinstance(ctrl.policy, AgeMemPolicy)


def test_adm_agemem_controller_constructs_with_custom_cfg():
    """AdmAgeMemController accepts a custom config."""
    cfg = AdmGRPOConfig(group_size=4, traj_len=4)
    ctrl = AdmAgeMemController(cfg=cfg)
    assert ctrl.trainer.cfg.group_size == 4
    assert ctrl.trainer.cfg.traj_len == 4


def test_adm_agemem_controller_trainer_is_adm_grpo():
    """The controller's trainer is an AdmGRPOTrainer (not the base GRPOTrainer)."""
    ctrl = AdmAgeMemController()
    assert isinstance(ctrl.trainer, AdmGRPOTrainer)


# ---------------------------------------------------------------------------
# self_test()
# ---------------------------------------------------------------------------

def test_self_test_runs_without_error(capsys):
    """self_test() completes without raising and returns a metrics dict."""
    result = self_test(n_iters=2)
    assert isinstance(result, dict)
    # Should contain training metrics
    captured = capsys.readouterr()
    assert "Adm-gated GRPO" in captured.out or "ADM" in captured.out.upper() or "train" in captured.out.lower()


def test_self_test_returns_metrics_with_expected_keys():
    """self_test() returns a dict with training metric keys."""
    result = self_test(n_iters=2)
    # The exact keys depend on the trainer's return, but it should be non-empty.
    assert len(result) > 0
