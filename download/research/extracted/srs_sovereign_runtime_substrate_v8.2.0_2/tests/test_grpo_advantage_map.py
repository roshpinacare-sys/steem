"""Tests for cognition/grpo_advantage_map.py.

Target: push coverage from 0% to 80%+ by directly exercising:
  - Module-level constants (FILTER_RED_HERRING_BONUS, THERMAL_RED_HERRING_TAGS)
  - ContentionGRPOConfig dataclass
  - ContentionGRPOTrainer._step_reward (DELETE bonus, FILTER bonus, fabrication penalty)
  - ContentionAgeMemController instantiation
  - StepRecord dataclass
  - generate_advantage_map(n_iters=1) — minimum-iteration run
  - render_advantage_map_png() — produces a non-empty PNG file
  - main() — produces the JSON + PNG artifacts
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# These imports pull torch + numpy + matplotlib — heavy but needed.
from cognition.grpo_advantage_map import (
    FILTER_RED_HERRING_BONUS,
    THERMAL_RED_HERRING_TAGS,
    ContentionGRPOConfig,
    ContentionGRPOTrainer,
    ContentionAgeMemController,
    StepRecord,
    generate_advantage_map,
    render_advantage_map_png,
    main,
)
from cognition.agemem_controller import MemOp, MemTier, MemoryEnv
from cognition.agemem_adm_trainer import (
    SL_BONUS, EVIDENCE_FABRICATION_PENALTY, ADM_ADMIT_BONUS,
)
from cognition.adm_intent_mapper import Intent, Context


# ---------------------------------------------------------------------------
# Module-level constants
# ---------------------------------------------------------------------------

def test_filter_red_herring_bonus_is_positive():
    """The FILTER red-herring bonus must be positive to incentivize removal."""
    assert FILTER_RED_HERRING_BONUS > 0
    assert FILTER_RED_HERRING_BONUS == 0.25  # RFAE spec value


def test_thermal_red_herring_tags_is_nonempty_set():
    """The red-herring tag set must contain known misattribution tags."""
    assert isinstance(THERMAL_RED_HERRING_TAGS, (set, frozenset))
    assert len(THERMAL_RED_HERRING_TAGS) >= 1
    # All entries are non-empty strings
    for tag in THERMAL_RED_HERRING_TAGS:
        assert isinstance(tag, str)
        assert len(tag) > 0


# ---------------------------------------------------------------------------
# ContentionGRPOConfig
# ---------------------------------------------------------------------------

def test_contention_grpo_config_defaults():
    """Default config inherits AdmGRPOConfig and adds filter_red_herring_bonus."""
    cfg = ContentionGRPOConfig()
    assert cfg.filter_red_herring_bonus == FILTER_RED_HERRING_BONUS
    # Inherited from AdmGRPOConfig
    assert cfg.sl_bonus == SL_BONUS
    assert cfg.evidence_fab_penalty == EVIDENCE_FABRICATION_PENALTY
    assert cfg.admit_bonus == ADM_ADMIT_BONUS


def test_contention_grpo_config_override():
    """filter_red_herring_bonus can be overridden."""
    cfg = ContentionGRPOConfig(filter_red_herring_bonus=0.5)
    assert cfg.filter_red_herring_bonus == 0.5


# ---------------------------------------------------------------------------
# StepRecord dataclass
# ---------------------------------------------------------------------------

def test_step_record_construction():
    """StepRecord can be constructed with all required fields."""
    sr = StepRecord(
        step_id=0, op="DELETE", tier="STM",
        reward=0.65, advantage=0.15,
        f_total_estimate=1.99, envelope_restored=True,
        intent="rebalance", admissible=True, attempts=1,
        tag="DELETE-tombstone",
    )
    assert sr.step_id == 0
    assert sr.op == "DELETE"
    assert sr.envelope_restored is True
    assert sr.tag == "DELETE-tombstone"


# ---------------------------------------------------------------------------
# ContentionAgeMemController instantiation
# ---------------------------------------------------------------------------

def test_contention_agemem_controller_constructs():
    """The controller can be instantiated with default args."""
    ctrl = ContentionAgeMemController()
    assert ctrl is not None
    assert isinstance(ctrl.trainer, ContentionGRPOTrainer)
    assert isinstance(ctrl.trainer.contention_cfg, ContentionGRPOConfig)


# ---------------------------------------------------------------------------
# generate_advantage_map — minimum-iteration run
# ---------------------------------------------------------------------------

def test_generate_advantage_map_minimal_run():
    """generate_advantage_map(n_iters=1) returns a well-formed dict."""
    data = generate_advantage_map(n_iters=1)
    assert isinstance(data, dict)
    # Top-level keys
    assert "steps" in data
    assert "f_total_trajectory" in data
    assert "correlation" in data
    assert "by_op" in data
    assert "summary" in data
    assert "reward_shaping" in data
    # Steps list is non-empty (3 prompts × 1 iter × (1 direct DELETE + traj_len))
    assert len(data["steps"]) > 0
    # F_total trajectory starts at 2.07 (violation) and has at least 2 entries
    traj = data["f_total_trajectory"]
    assert len(traj) >= 2
    assert traj[0] == 2.07
    # Correlation dict has the expected fields
    corr = data["correlation"]
    assert "p_restore_given_delete_filter" in corr
    assert "p_restore_given_other" in corr
    assert "lift" in corr
    assert "pearson_r" in corr
    assert "interpretation" in corr
    # by_op is a dict keyed by op name
    assert isinstance(data["by_op"], dict)
    for op_name, stats in data["by_op"].items():
        assert "count" in stats
        assert "mean_advantage" in stats
        assert "mean_reward" in stats
        assert "restoration_rate" in stats
        assert "admit_rate" in stats
    # Summary has the expected counts
    summ = data["summary"]
    assert "total_steps" in summ
    assert "delete_steps" in summ
    assert "filter_steps" in summ
    assert "envelope_restored_steps" in summ
    assert "admissible_steps" in summ
    assert "final_f_total" in summ
    assert "initial_f_total" in summ
    assert "envelope_restored_overall" in summ
    # Reward shaping constants
    rs = data["reward_shaping"]
    assert rs["sl_bonus_delete_tombstone"] == SL_BONUS
    assert rs["filter_red_herring_bonus"] == FILTER_RED_HERRING_BONUS
    assert rs["evidence_fab_penalty"] == EVIDENCE_FABRICATION_PENALTY


def test_generate_advantage_map_steps_are_step_records():
    """Each step in the steps list is a dict (asdict of StepRecord)."""
    data = generate_advantage_map(n_iters=1)
    for s in data["steps"]:
        assert isinstance(s, dict)
        assert "step_id" in s
        assert "op" in s
        assert "tier" in s
        assert "reward" in s
        assert "advantage" in s
        assert "f_total_estimate" in s
        assert "envelope_restored" in s
        assert "intent" in s
        assert "admissible" in s
        assert "attempts" in s
        assert "tag" in s


def test_generate_advantage_map_includes_delete_steps():
    """The advantage map must include at least one DELETE step (we inject
    a direct DELETE per prompt)."""
    data = generate_advantage_map(n_iters=1)
    delete_steps = [s for s in data["steps"] if s["op"] == "DELETE"]
    assert len(delete_steps) >= 1
    # All DELETE steps should be tagged as tombstones
    for s in delete_steps:
        assert s["tag"] == "DELETE-tombstone"


def test_generate_advantage_map_correlation_is_finite():
    """The Pearson correlation must be a finite float in [-1, 1]."""
    import math
    data = generate_advantage_map(n_iters=1)
    r = data["correlation"]["pearson_r"]
    assert isinstance(r, float)
    assert not math.isnan(r)
    assert -1.0 <= r <= 1.0


# ---------------------------------------------------------------------------
# render_advantage_map_png
# ---------------------------------------------------------------------------

def test_render_advantage_map_png_produces_file(tmp_path):
    """render_advantage_map_png writes a non-empty PNG file."""
    data = generate_advantage_map(n_iters=1)
    out_path = tmp_path / "test_advantage_map.png"
    render_advantage_map_png(data, str(out_path))
    assert out_path.exists()
    assert out_path.stat().st_size > 1000  # PNG header + data
    # Verify it's actually a PNG by checking the magic bytes
    with open(out_path, "rb") as f:
        magic = f.read(8)
    assert magic.startswith(b"\x89PNG\r\n\x1a\n")


# ---------------------------------------------------------------------------
# main() — exercises the JSON + PNG artifact generation
# ---------------------------------------------------------------------------

def test_main_writes_artifacts():
    """main() writes grpo_advantage_map.json + grpo_advantage_map.png
    to the repo root (resolved relative to __file__).
    """
    import os
    script_dir = os.path.dirname(os.path.abspath(
        __import__("cognition.grpo_advantage_map", fromlist=["__file__"]).__file__))
    repo_root = os.path.dirname(script_dir)
    json_path = os.path.join(repo_root, "grpo_advantage_map.json")
    png_path = os.path.join(repo_root, "grpo_advantage_map.png")

    # Clean any prior artifacts
    for p in (json_path, png_path):
        if os.path.exists(p):
            os.remove(p)

    rc = main()
    assert rc == 0
    assert os.path.exists(json_path), "JSON artifact not written"
    assert os.path.exists(png_path), "PNG artifact not written"
    # Verify JSON is well-formed
    data = json.loads(open(json_path).read())
    assert "steps" in data
    assert "correlation" in data
    assert "summary" in data
    # Verify PNG is non-empty
    assert os.path.getsize(png_path) > 1000
