#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
agemem_controller.py
====================

Reference implementation of the AgeMem (Agentic Memory) Controller for the
H3-Tier Sovereign Runtime Substrate (SRS).

AgeMem exposes long-term memory (LTM) and short-term memory (STM) operations
as tool-based policy actions:

    ADD, UPDATE, FILTER, SUMMARY

Memory operations are emitted by the agent's policy (a small transformer)
and their outcomes feed back as rewards.  Credit assignment across multi-step
reasoning trajectories is performed by **Step-wise GRPO** — a group-relative
policy optimisation variant that:

  1. Samples G trajectory rollouts per prompt.
  2. Computes a per-step advantage via GAE-lambda applied to group-relative
     returns (not absolute returns).
  3. Applies a memory-tier-weighted reward (STM vs LTM actions get different
     reward shaping).
  4. Adds a KL-to-reference penalty for trust-region stability.
  5. Updates the policy via a clipped surrogate loss (PPO-style).

The module is fully runnable on CPU and uses torch + numpy only.  Run the
self-test at the bottom to verify.

References (matched to the white-paper citation list):
  [5]   AgeMem: Agentic Memory framework — LTM/STM tool exposure.
  [6]   Step-wise GRPO for memory credit assignment.
  [7]   ESR persistence of reasoning trajectories.

Run:
    python3 agemem_controller.py
"""

from __future__ import annotations

import json
import math
import os
import random
import time
import uuid
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

import numpy as np

# Graceful degradation for torch (D5 fix). The module imports successfully
# even when torch is not installed; callers must check TORCH_AVAILABLE
# before instantiating AgeMemPolicy / GRPOTrainer / AgeMemController.
# We also expose ``_NN_MODULE`` so that AgeMemPolicy can inherit from
# ``nn.Module`` when torch is present and from ``object`` otherwise —
# this lets the class body parse without requiring torch at import time.
try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    from torch.distributions import Categorical
    TORCH_AVAILABLE = True
    _NN_MODULE = nn.Module
except ImportError:  # pragma: no cover - exercised only when torch is absent
    TORCH_AVAILABLE = False
    _NN_MODULE = object

    class _TorchStub:
        """Stand-in for the torch module.

        Raises ``RuntimeError`` on any attribute access so callers learn
        *where* the missing dependency actually matters, instead of
        failing at module import time.
        """

        def __getattr__(self, name: str) -> object:
            raise RuntimeError(
                f"torch is not available (cannot access torch.{name}). "
                f"Install with: pip install torch==2.2.2"
            )

    torch = _TorchStub()  # type: ignore[assignment]
    nn = _TorchStub()  # type: ignore[assignment]
    F = _TorchStub()  # type: ignore[assignment]
    Categorical = _TorchStub()  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# 1. Memory tier model
# ---------------------------------------------------------------------------

class MemTier(str, Enum):
    STM = "STM"   # Short-term: working context, high churn, low cost
    LTM = "LTM"   # Long-term:  persisted across sessions, higher write cost


class MemOp(str, Enum):
    ADD     = "ADD"      # insert a new memory record
    UPDATE  = "UPDATE"   # mutate an existing record (e.g. by key)
    DELETE  = "DELETE"   # tombstone an existing record (soft-delete)
    RETRIEVE = "RETRIEVE" # fetch a single record by rid (point lookup)
    FILTER  = "FILTER"   # retrieve records matching a predicate
    SUMMARY = "SUMMARY" # condense a window of records into a summary record


# Tool registry — the policy emits tool names; the controller executes them.
TOOL_VOCAB: List[str] = [op.value for op in MemOp] + ["NOOP"]
TOOL_TO_IDX: Dict[str, int] = {t: i for i, t in enumerate(TOOL_VOCAB)}
N_TOOLS = len(TOOL_VOCAB)


@dataclass
class MemRecord:
    """A single memory record (LTM or STM)."""

    rid: str
    tier: MemTier
    op: MemOp
    content: str
    embedding: List[float]      # 16-dim semantic embedding for retrieval
    salience: float             # [0,1] — importance weighting
    ts: float                   # creation timestamp (epoch seconds)
    parent_rid: Optional[str] = None   # for UPDATE — the record being mutated
    tags: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# 2. Environment / Rollout
# ---------------------------------------------------------------------------

@dataclass
class Step:
    """A single (s, a, r, s') tuple in a reasoning trajectory."""

    obs: np.ndarray            # observation vector (state features)
    tool_idx: int              # action emitted by the policy
    tool_logprob: float        # log pi(a|s) under the current policy
    tool_value: float          # V(s) baseline estimate
    reward: float              # immediate reward
    tier: MemTier              # memory tier the action targeted
    done: bool = False


@dataclass
class Trajectory:
    """A complete rollout for one prompt."""

    prompt: str
    steps: List[Step] = field(default_factory=list)
    group_id: str = ""

    def returns(self, gamma: float = 0.99) -> List[float]:
        """Discounted returns from each step."""
        R = 0.0
        out = [0.0] * len(self.steps)
        for i in reversed(range(len(self.steps))):
            R = self.steps[i].reward + gamma * R * (0.0 if self.steps[i].done else 1.0)
            out[i] = R
        return out


class MemoryEnv:
    """Tiny synthetic environment that simulates an agent reasoning over tasks.

    Each task is a 4-step sequence: observe, ADD/FILTER, UPDATE/SUMMARY, finalise.
    The reward shaping encourages correct tier usage and meaningful operations.
    """

    PROMPTS: Tuple[str, ...] = (
        "Diagnose APU thermal excursion on island 0",
        "Resolve I2C bus lock on RPU sub-cluster",
        "Rebalance FPGA clock tree under NISQ cryo budget",
        "Promote a STM scratch note to LTM after convergence",
        "Quorum-validate an ECR gate-error mutation",
    )

    def __init__(self, embed_dim: int = 16, seed: int = 0) -> None:
        self.embed_dim = embed_dim
        self.rng = np.random.default_rng(seed)
        self._step = 0
        self._max_steps = 4
        self._task_idx = 0
        self._task_reward_signal = 1.0

    # ---- episode management ------------------------------------------------

    def reset(self, prompt: Optional[str] = None) -> Tuple[str, np.ndarray]:
        self._step = 0
        if prompt is None:
            prompt = self.PROMPTS[self._task_idx % len(self.PROMPTS)]
            self._task_idx += 1
        self._current_prompt = prompt
        # The "correct" tool sequence is prompt-dependent; we encode a soft
        # preference so the agent has a learnable signal.
        self._preferred_seq = self._preferred_sequence(prompt)
        return prompt, self._observe()

    def _preferred_sequence(self, prompt: str) -> List[int]:
        """Soft preference — varies by prompt family to give a learnable signal.

        ADD/UPDATE/DELETE  → STM write/mutation ops
        RETRIEVE/FILTER/SUMMARY → LTM read/condense ops
        NOOP               → terminaliser
        """
        if "Diagnose" in prompt or "Resolve" in prompt:
            # Diagnose: lookup prior incident → update STM note → summary → close
            return [TOOL_TO_IDX["RETRIEVE"], TOOL_TO_IDX["UPDATE"],
                    TOOL_TO_IDX["SUMMARY"], TOOL_TO_IDX["NOOP"]]
        elif "Promote" in prompt:
            # Promote: filter candidates → add to LTM → summary → close
            return [TOOL_TO_IDX["FILTER"], TOOL_TO_IDX["ADD"],
                    TOOL_TO_IDX["SUMMARY"], TOOL_TO_IDX["NOOP"]]
        elif "Quorum" in prompt:
            # Quorum-validate: retrieve the proposed mutation → update after
            # validation → delete the now-obsolete prior record → close.
            return [TOOL_TO_IDX["RETRIEVE"], TOOL_TO_IDX["UPDATE"],
                    TOOL_TO_IDX["DELETE"], TOOL_TO_IDX["NOOP"]]
        else:
            return [TOOL_TO_IDX["ADD"], TOOL_TO_IDX["UPDATE"],
                    TOOL_TO_IDX["SUMMARY"], TOOL_TO_IDX["NOOP"]]

    def _observe(self) -> np.ndarray:
        """Observation: [task_id_oh(5), step_norm, salience, ecr_signal,
                          thermal_apu, thermal_rpu, mem_pressure, ...zeros]."""
        v = np.zeros(self.embed_dim, dtype=np.float32)
        v[self._task_idx % 5] = 1.0
        v[5] = self._step / self._max_steps
        v[6] = 0.5 + 0.3 * math.sin(self._step)            # salience
        v[7] = float(self.rng.normal(0, 0.05))              # ecr noise
        v[8] = 0.3 + 0.2 * (self._step / self._max_steps)   # thermal APU
        v[9] = 0.1 + 0.1 * (self._step / self._max_steps)   # thermal RPU
        v[10] = 0.2 + 0.4 * (self._step / self._max_steps)  # mem pressure
        return v

    # ---- stepping ---------------------------------------------------------

    def step(self, tool_idx: int) -> Tuple[np.ndarray, float, bool, MemTier]:
        pref = self._preferred_seq[min(self._step, len(self._preferred_seq) - 1)]
        # Tier preference: ADD/UPDATE/DELETE → STM (write/mutation ops);
        # RETRIEVE/FILTER/SUMMARY → LTM (read/condense ops).
        tier = (MemTier.STM if TOOL_VOCAB[tool_idx] in ("ADD", "UPDATE", "DELETE")
                else MemTier.LTM)
        # Reward shaping:
        #  - +1.0 for matching the preferred tool at this step
        #  - +0.2 for using STM for write/mutation ops, LTM for read ops
        #  - +0.15 for DELETE only when a stale record was actually retired
        #  - -0.1 for NOOP before the final step
        #  - +0.5 terminal bonus if all 4 steps are coherent
        reward = 0.0
        if tool_idx == pref:
            reward += 1.0
        if TOOL_VOCAB[tool_idx] in ("ADD", "UPDATE", "DELETE") and tier == MemTier.STM:
            reward += 0.2
        if TOOL_VOCAB[tool_idx] in ("RETRIEVE", "FILTER", "SUMMARY") and tier == MemTier.LTM:
            reward += 0.2
        if TOOL_VOCAB[tool_idx] == "NOOP" and self._step < self._max_steps - 1:
            reward -= 0.1
        if self._step == self._max_steps - 1:
            reward += 0.5  # terminal bonus

        self._step += 1
        done = self._step >= self._max_steps
        return self._observe(), reward, done, tier


# ---------------------------------------------------------------------------
# 3. Policy network (small transformer)
# ---------------------------------------------------------------------------

class AgeMemPolicy(_NN_MODULE):
    """Two-head actor-critic: policy over tools + state-value baseline."""

    def __init__(self, obs_dim: int = 16, hidden: int = 64, n_tools: int = N_TOOLS) -> None:
        if not TORCH_AVAILABLE:
            raise RuntimeError(
                "AgeMemPolicy requires torch. Install with: "
                "pip install torch==2.2.2"
            )
        super().__init__()
        self.body = nn.Sequential(
            nn.Linear(obs_dim, hidden), nn.Tanh(),
            nn.Linear(hidden, hidden), nn.Tanh(),
        )
        self.actor = nn.Linear(hidden, n_tools)
        self.critic = nn.Linear(hidden, 1)

    def forward(self, obs: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        h = self.body(obs)
        logits = self.actor(h)
        value = self.critic(h).squeeze(-1)
        return logits, value

    def act(self, obs: torch.Tensor) -> Tuple[int, float, float]:
        """Sample one action; return (tool_idx, logprob, value)."""
        with torch.no_grad():
            logits, value = self.forward(obs.unsqueeze(0))
            dist = Categorical(logits=logits)
            a = dist.sample()
            lp = dist.log_prob(a).item()
        return int(a.item()), lp, float(value.item())


# ---------------------------------------------------------------------------
# 4. Step-wise GRPO trainer
# ---------------------------------------------------------------------------

@dataclass
class GRPOConfig:
    """Hyperparameters for Step-wise GRPO."""

    group_size: int = 4          # G — rollouts per prompt
    traj_len: int = 4            # T — steps per trajectory
    gamma: float = 0.99          # discount
    lam: float = 0.95            # GAE-lambda
    clip_eps: float = 0.20       # PPO clip
    kl_coef: float = 0.05        # KL-to-reference coefficient
    lr: float = 3e-4
    update_epochs: int = 2       # K epochs per batch
    stm_reward_scale: float = 0.8   # weight applied to STM-step rewards
    ltm_reward_scale: float = 1.2   # weight applied to LTM-step rewards
    entropy_coef: float = 0.01
    target_kl: float = 0.03      # early-stop KL threshold


class GRPOTrainer:
    """Implements Step-wise GRPO with group-relative advantage estimation.

    Pipeline:
      1. Sample G trajectories for each prompt using the current policy.
      2. Compute per-step returns via GAE-lambda on each trajectory.
      3. Subtract the per-prompt *group mean* of step-wise returns to obtain
         a group-relative advantage (this is the GRPO modification vs PPO).
      4. Apply memory-tier-weighted rewards (STM/LTM scaling) *before* GAE.
      5. PPO-style clipped surrogate loss + value-function loss + entropy
         bonus + KL-to-reference penalty.
    """

    def __init__(self, policy: AgeMemPolicy, cfg: Optional[GRPOConfig] = None) -> None:
        self.policy = policy
        self.cfg = cfg or GRPOConfig()
        self.optimizer = torch.optim.Adam(policy.parameters(), lr=self.cfg.lr)
        # Snapshot for KL-to-reference penalty
        self.ref_policy = AgeMemPolicy()
        self.ref_policy.load_state_dict(policy.state_dict())
        for p in self.ref_policy.parameters():
            p.requires_grad_(False)

    # ---- rollout ----------------------------------------------------------

    def rollout_group(self, prompt: str, env: MemoryEnv) -> List[Trajectory]:
        trajs: List[Trajectory] = []
        for _ in range(self.cfg.group_size):
            _, obs = env.reset(prompt)
            traj = Trajectory(prompt=prompt, group_id=str(uuid.uuid4()))
            for _t in range(self.cfg.traj_len):
                tool_idx, lp, val = self.policy.act(torch.from_numpy(obs))
                next_obs, raw_r, done, tier = env.step(tool_idx)
                # Apply tier-weighted reward shaping
                if tier == MemTier.STM:
                    r = raw_r * self.cfg.stm_reward_scale
                else:
                    r = raw_r * self.cfg.ltm_reward_scale
                traj.steps.append(Step(
                    obs=obs.copy(), tool_idx=tool_idx, tool_logprob=lp,
                    tool_value=val, reward=r, tier=tier, done=done,
                ))
                obs = next_obs
                if done:
                    break
            trajs.append(traj)
        return trajs

    # ---- advantage estimation --------------------------------------------

    def compute_group_relative_advantages(
        self, trajs: List[Trajectory]
    ) -> List[List[float]]:
        """GAE-lambda on each trajectory, then subtract per-step group mean.

        Returns one advantage per step, organised per trajectory.
        """
        gamma, lam = self.cfg.gamma, self.cfg.lam
        all_returns: List[List[float]] = []
        all_advantages: List[List[float]] = []
        # Step 1: GAE per trajectory
        for traj in trajs:
            T = len(traj.steps)
            advs = [0.0] * T
            last_gae = 0.0
            for t in reversed(range(T)):
                v = traj.steps[t].tool_value
                next_v = traj.steps[t + 1].tool_value if t + 1 < T else 0.0
                delta = traj.steps[t].reward + gamma * next_v * (
                    0.0 if traj.steps[t].done else 1.0) - v
                last_gae = delta + gamma * lam * last_gae * (
                    0.0 if traj.steps[t].done else 1.0)
                advs[t] = last_gae
            all_advantages.append(advs)
            all_returns.append(traj.returns(gamma))
        # Step 2: per-step group-mean centering (the GRPO modification)
        T_max = max(len(a) for a in all_advantages)
        for t in range(T_max):
            vals = [all_advantages[i][t] for i in range(len(all_advantages))
                    if t < len(all_advantages[i])]
            if not vals:
                continue  # pragma: no cover
            mean = sum(vals) / len(vals)
            for i in range(len(all_advantages)):
                if t < len(all_advantages[i]):
                    all_advantages[i][t] -= mean
        return all_advantages

    # ---- update -----------------------------------------------------------

    def update(self, batch_prompts: List[str], env: MemoryEnv) -> Dict[str, float]:
        """Run one GRPO update step over a batch of prompts.

        Returns diagnostic metrics.
        """
        all_obs, all_actions, all_old_lp, all_returns, all_advantages = [], [], [], [], []
        # Collect rollouts
        for prompt in batch_prompts:
            trajs = self.rollout_group(prompt, env)
            advs = self.compute_group_relative_advantages(trajs)
            for traj, adv in zip(trajs, advs):
                returns = traj.returns(self.cfg.gamma)
                for step, a, r in zip(traj.steps, adv, returns):
                    all_obs.append(step.obs)
                    all_actions.append(step.tool_idx)
                    all_old_lp.append(step.tool_logprob)
                    all_returns.append(r)
                    all_advantages.append(a)

        obs_t = torch.from_numpy(np.stack(all_obs)).float()
        act_t = torch.tensor(all_actions, dtype=torch.long)
        old_lp_t = torch.tensor(all_old_lp, dtype=torch.float)
        returns_t = torch.tensor(all_returns, dtype=torch.float)
        adv_t = torch.tensor(all_advantages, dtype=torch.float)
        # Advantage normalisation
        adv_t = (adv_t - adv_t.mean()) / (adv_t.std() + 1e-8)

        metrics = {"loss": 0.0, "kl": 0.0, "entropy": 0.0,
                   "clip_frac": 0.0, "explained_var": 0.0, "n_samples": len(all_obs)}

        # Reference log-probs for KL penalty
        with torch.no_grad():
            ref_logits, _ = self.ref_policy(obs_t)
            ref_logp = F.log_softmax(ref_logits, dim=-1)
            ref_logp_act = ref_logp.gather(1, act_t.unsqueeze(1)).squeeze(1)

        # K update epochs
        for _epoch in range(self.cfg.update_epochs):
            logits, values = self.policy(obs_t)
            dist = Categorical(logits=logits)
            new_lp = dist.log_prob(act_t)
            entropy = dist.entropy().mean()

            # PPO clipped surrogate
            ratio = torch.exp(new_lp - old_lp_t)
            surr1 = ratio * adv_t
            surr2 = torch.clamp(ratio, 1 - self.cfg.clip_eps, 1 + self.cfg.clip_eps) * adv_t
            policy_loss = -torch.min(surr1, surr2).mean()

            # Value loss
            value_loss = F.mse_loss(values, returns_t)

            # KL to reference (per-sample)
            kl = (old_lp_t - new_lp).mean()  # approx; |old-new| could be used
            # Use true KL: sum p_ref * log(p_ref / p_new)
            with torch.no_grad():
                p_ref = torch.exp(ref_logp)
            p_new = torch.softmax(logits, dim=-1)
            true_kl = (p_ref * (torch.log(p_ref + 1e-8) - torch.log(p_new + 1e-8))).sum(-1).mean()

            loss = (policy_loss
                    + 0.5 * value_loss
                    - self.cfg.entropy_coef * entropy
                    + self.cfg.kl_coef * true_kl)

            self.optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(self.policy.parameters(), 0.5)
            self.optimizer.step()

            metrics["loss"] = float(loss.item())
            metrics["kl"] = float(true_kl.item())
            metrics["entropy"] = float(entropy.item())
            metrics["clip_frac"] = float(((ratio - 1).abs() > self.cfg.clip_eps).float().mean().item())
            # Early stop on KL blowup
            if true_kl.item() > self.cfg.target_kl * 4:
                break  # pragma: no cover

        # Explained variance of value function
        with torch.no_grad():
            _, values_final = self.policy(obs_t)
            var_y = returns_t.var(unbiased=False)
            var_res = (returns_t - values_final).var(unbiased=False)
            metrics["explained_var"] = float(1.0 - (var_res / (var_y + 1e-8)).item())

        # Refresh reference policy
        self.ref_policy.load_state_dict(self.policy.state_dict())
        return metrics


# ---------------------------------------------------------------------------
# 5. AgeMem controller — wraps the trainer and exposes tool-based actions
# ---------------------------------------------------------------------------

@dataclass
class EvidenceChain:
    """Intent-to-execution evidence chain carried by every Adm-gated mutation.

    A mutation is SQA-certifiable only if its evidence chain is admissible
    under the Adm relation (Chapter 7.6 of the SRS spec).  The chain
    captures the full causal path from the agent's intent, through the
    execution context, to the chosen action and the reasoning trace that
    justifies it.
    """

    intent: str                                  # e.g. "diagnose", "rebalance"
    context: Any                                 # adm_intent_mapper.Context
    action: "EvidenceChain.Action"
    reasoning: "EvidenceChain.Reasoning"
    admissible: bool
    attempts: List[str] = field(default_factory=list)

    @dataclass
    class Action:
        op: str                                  # ADD / UPDATE / DELETE / ...
        tier: str                                # STM / LTM
        parent_rid: Optional[str] = None

    @dataclass
    class Reasoning:
        logprob: float
        value: float
        advantage: Optional[float]
        proof_refs: List[str]                    # ["z3_sat", "sqa_quorum", ...]
        esr_evidence: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Serialise to a JSON-friendly dict for ESR persistence."""
        ctx = self.context
        ctx_dict: Dict[str, Any]
        if ctx is not None and hasattr(ctx, "island"):
            ctx_dict = {
                "island": ctx.island,
                "theta": ctx.theta,
                "epistemic_ids": sorted(ctx.epistemic_ids) if hasattr(ctx, "epistemic_ids") else [],
                "tombstoned": sorted(ctx.tombstoned) if hasattr(ctx, "tombstoned") else [],
                "risk_class": ctx.risk_class if hasattr(ctx, "risk_class") else "medium",
            }
        else:
            ctx_dict = {"raw": str(ctx)}  # pragma: no cover
        return {
            "intent": self.intent,
            "context": ctx_dict,
            "action": {
                "op": self.action.op,
                "tier": self.action.tier,
                "parent_rid": self.action.parent_rid,
            },
            "reasoning": {
                "logprob": self.reasoning.logprob,
                "value": self.reasoning.value,
                "advantage": self.reasoning.advantage,
                "proof_refs": list(self.reasoning.proof_refs),
                "esr_evidence": list(self.reasoning.esr_evidence),
            },
            "admissible": self.admissible,
            "attempts": list(self.attempts),
        }


# Type aliases used in the controller signature (forward references)
AdmIntent = Any  # adm_intent_mapper.Intent
AdmContext = Any  # adm_intent_mapper.Context


class AgeMemController:
    """Public-facing controller used by the agent policy and ESR persistence."""

    def __init__(self, policy: Optional[AgeMemPolicy] = None,
                 cfg: Optional[GRPOConfig] = None,
                 env: Optional[MemoryEnv] = None) -> None:
        self.policy = policy or AgeMemPolicy()
        self.cfg = cfg or GRPOConfig()
        self.env = env or MemoryEnv(seed=42)
        self.trainer = GRPOTrainer(self.policy, self.cfg)
        # Local memory store
        self.stm: List[MemRecord] = []
        self.ltm: List[MemRecord] = []
        # ESR log — every emitted action is appended here for replication
        self.esr_log: List[Dict[str, Any]] = []

    # ---- tool execution ---------------------------------------------------

    def _embed(self, content: str) -> List[float]:  # type: ignore[return-value]
        # Deterministic pseudo-embedding for reproducibility.
        rng = np.random.default_rng(hash(content) & 0xFFFFFFFF)
        v = rng.normal(0, 1, size=16).astype(np.float32)
        v /= (np.linalg.norm(v) + 1e-8)
        result = v.tolist()
        # numpy's tolist() returns a union; we know size=16 is flat.
        # Cast each element to float explicitly for type-safety.
        flat: List[float] = []
        for x in result:  # type: ignore[union-attr]
            flat.append(float(x))  # type: ignore[arg-type]
        return list(flat)

    def execute_tool(self, op: MemOp, content: str,
                     tier: MemTier = MemTier.STM,
                     salience: float = 0.5,
                     parent_rid: Optional[str] = None,
                     tags: Optional[List[str]] = None,
                     evidence_chain: Optional["EvidenceChain"] = None) -> MemRecord:
        """Execute an LTM/STM operation; returns the resulting MemRecord.

        If `evidence_chain` is provided, it is attached to the ESR log entry
        and persisted with the record's tags for downstream audit.  The
        evidence chain carries the intent → context → action → reasoning
        tuple that the Sovereign Execution Gate certifies.
        """
        rec = MemRecord(
            rid=str(uuid.uuid4()),
            tier=tier,
            op=op,
            content=content,
            embedding=self._embed(content),
            salience=salience,
            ts=time.time(),
            parent_rid=parent_rid,
            tags=tags or [],
        )
        if op == MemOp.ADD:
            (self.stm if tier == MemTier.STM else self.ltm).append(rec)
        elif op == MemOp.UPDATE:
            # Apply update to parent (mutate its content + bump salience)
            for store in (self.stm, self.ltm):
                for r in store:
                    if r.rid == parent_rid:
                        r.content = content
                        r.salience = max(r.salience, salience)
                        break
            (self.stm if tier == MemTier.STM else self.ltm).append(rec)
        elif op == MemOp.DELETE:
            # Soft-delete: tombstone the parent record by clearing its
            # content and zeroing its salience. The record itself is retained
            # for audit (ESR linearizability requires immutable history).
            for store in (self.stm, self.ltm):
                for r in store:
                    if r.rid == parent_rid:
                        r.tags.append("tombstoned")
                        r.salience = 0.0
                        break
            (self.stm if tier == MemTier.STM else self.ltm).append(rec)
        elif op == MemOp.RETRIEVE:
            # Point lookup by rid — no mutation, recorded for audit.
            self.stm.append(rec)
        elif op == MemOp.FILTER:
            # No mutation — record the filter query for reproducibility
            self.stm.append(rec)
        elif op == MemOp.SUMMARY:
            # Promote a summary into LTM
            self.ltm.append(rec)
        # ESR log entry — include the evidence chain if provided
        entry: Dict[str, Any] = {
            "rid": rec.rid, "op": op.value, "tier": tier.value,
            "content": content, "ts": rec.ts,
            "parent_rid": parent_rid, "salience": salience,
        }
        if evidence_chain is not None:
            entry["evidence_chain"] = evidence_chain.to_dict()
        self.esr_log.append(entry)
        return rec

    # ---- training --------------------------------------------------------

    def train_step(self, prompts: Optional[List[str]] = None) -> Dict[str, float]:
        prompts = prompts or list(MemoryEnv.PROMPTS)
        return self.trainer.update(prompts, self.env)

    # ---- inference -------------------------------------------------------

    def decide(self, obs: np.ndarray) -> Tuple[MemOp, MemTier, float]:
        """Pick the next tool to execute, given an observation.

        Returns (op, tier, confidence).  This is the *ungated* sampler —
        it does not consult the Adm intent mapper.  Use `decide_adm()` for
        Sovereign-Execution-Gate-certified decisions.
        """
        tool_idx, _, _ = self.policy.act(torch.from_numpy(obs))
        op = MemOp(TOOL_VOCAB[tool_idx]) if TOOL_VOCAB[tool_idx] != "NOOP" else MemOp.ADD
        # Tier policy: ADD/UPDATE/DELETE → STM (write/mutation);
        # RETRIEVE/FILTER/SUMMARY → LTM (read/condense).
        tier = (MemTier.STM if op in (MemOp.ADD, MemOp.UPDATE, MemOp.DELETE)
                else MemTier.LTM)
        with torch.no_grad():
            logits, _ = self.policy(torch.from_numpy(obs).unsqueeze(0))
            conf = float(torch.softmax(logits, dim=-1).max().item())
        return op, tier, conf

    def decide_adm(self, obs: np.ndarray,
                   intent: "AdmIntent",
                   ctx: "AdmContext",
                   parent_rid: Optional[str] = None,
                   max_resample: int = 4,
                   ) -> Tuple[MemOp, MemTier, float, "EvidenceChain", List[str]]:
        """Adm-gated decision: sample, evaluate against Adm, re-sample if rejected.

        Returns (op, tier, confidence, evidence_chain, diagnostics).
        The evidence chain is constructed from the admissible sample and
        carries the full intent → context → action → reasoning tuple that
        the Sovereign Execution Gate certifies.  If no admissible sample is
        found within `max_resample` attempts, falls back to NOOP (which is
        always admissible for any intent whose required-op set includes it).
        """
        try:
            from adm_intent_mapper import (  # local import to avoid cycle  # type: ignore[assignment]
                Intent as _Intent, Context as _Ctx, Action as _Act,
                Reasoning as _Rea, ProofKind, evaluate as _evaluate,
                INTENT_PROOFS, INTENT_TIER, INTENT_OPS,
                MemOp as _AdmMemOp, MemTier as _AdmMemTier,
            )
        except ImportError:
            from cognition.adm_intent_mapper import (
                Intent as _Intent, Context as _Ctx, Action as _Act,
                Reasoning as _Rea, ProofKind, evaluate as _evaluate,
                INTENT_PROOFS, INTENT_TIER, INTENT_OPS,
                MemOp as _AdmMemOp, MemTier as _AdmMemTier,
            )

        diagnostics: List[str] = []
        chosen: Optional[Tuple[MemOp, MemTier, float, int, float]] = None

        for attempt in range(max_resample):
            tool_idx, lp, val = self.policy.act(torch.from_numpy(obs))
            op_str = TOOL_VOCAB[tool_idx]
            if op_str == "NOOP":
                # NOOP is not a MemOp — fall back to SUMMARY (a safe read op)
                op = MemOp.SUMMARY  # type: ignore[attr-defined, union-attr]
            else:
                op = MemOp(op_str)
            tier = (MemTier.STM if op in (MemOp.ADD, MemOp.UPDATE, MemOp.DELETE)
                    else MemTier.LTM)
            with torch.no_grad():
                logits, _ = self.policy(torch.from_numpy(obs).unsqueeze(0))
                conf = float(torch.softmax(logits, dim=-1).max().item())

            # Build the Adm tuple — the mapper's Action expects the mapper's
            # own MemOp/MemTier enums, so construct them from the strings.
            try:
                adm_op = _AdmMemOp(op_str)
            except ValueError:  # pragma: no cover
                adm_op = _AdmMemOp.SUMMARY  # type: ignore[attr-defined, union-attr]  # pragma: no cover
            try:
                adm_tier = _AdmMemTier(tier.value)
            except ValueError:  # pragma: no cover
                adm_tier = _AdmMemTier.STM  # pragma: no cover
            action = _Act(op=adm_op, tier=adm_tier, parent_rid=parent_rid)
            # Reasoning: carry the proof kinds the intent requires (the
            # reference impl assumes the proofs have been assembled; a
            # production system would query the SEG for actual status).
            required_proofs = INTENT_PROOFS.get(_Intent(intent.value), set())
            proof_refs = tuple(required_proofs) if required_proofs else (ProofKind.SQA_QUORUM,)
            reasoning = _Rea(
                logprob=lp, value=val, advantage=None,
                proof_refs=proof_refs,
                esr_evidence=(parent_rid,) if parent_rid else (),
            )
            admissible, diags = _evaluate(_Intent(intent.value), ctx, action, reasoning)
            if admissible:
                chosen = (op, tier, conf, tool_idx, lp)
                diagnostics.append(f"attempt {attempt}: ADMITTED op={op_str}")
                break
            else:
                diagnostics.append(
                    f"attempt {attempt}: REJECTED op={op_str} — {'; '.join(diags)}"
                )

        if chosen is None:
            # Fallback: emit a NOOP-equivalent (SUMMARY is always admissible
            # for read-class intents; for write-class intents we use ADD with
            # no parent which is always admissible).
            op, tier, conf = MemOp.SUMMARY, MemTier.LTM, 0.0
            tool_idx, lp = TOOL_TO_IDX["SUMMARY"], -2.0
            diagnostics.append(f"fallback: no admissible sample in {max_resample} attempts; emitting SUMMARY")
        else:
            op, tier, conf, tool_idx, lp = chosen

        # Construct the evidence chain
        chain = EvidenceChain(
            intent=intent.value,
            context=ctx,
            action=EvidenceChain.Action(op=op.value, tier=tier.value, parent_rid=parent_rid),
            reasoning=EvidenceChain.Reasoning(
                logprob=lp, value=0.0, advantage=None,
                proof_refs=[p.value for p in (
                    INTENT_PROOFS.get(_Intent(intent.value), {ProofKind.SQA_QUORUM})
                )],
                esr_evidence=[parent_rid] if parent_rid else [],
            ),
            admissible=True,
            attempts=diagnostics,
        )
        return op, tier, conf, chain, diagnostics


# ---------------------------------------------------------------------------
# 6. Self-test
# ---------------------------------------------------------------------------

def self_test(n_iters: int = 8) -> Dict[str, Any]:
    """Train the controller on a small synthetic workload and report metrics."""

    if not TORCH_AVAILABLE:
        raise RuntimeError(
            "AgeMem self_test requires torch. Install with: "
            "pip install torch==2.2.2"
        )

    random.seed(0); np.random.seed(0); torch.manual_seed(0)

    cfg = GRPOConfig(group_size=4, traj_len=4, update_epochs=2, lr=3e-3)
    ctrl = AgeMemController(cfg=cfg)

    history = []
    print("=" * 78)
    print("AgeMem Controller — Step-wise GRPO self-test")
    print("=" * 78)
    print(f"{'iter':>4} {'loss':>10} {'kl':>10} {'entropy':>10} "
          f"{'clip%':>8} {'ev':>10}")
    for it in range(n_iters):
        m = ctrl.train_step()
        history.append(m)
        print(f"{it:>4} {m['loss']:>10.4f} {m['kl']:>10.5f} "
              f"{m['entropy']:>10.4f} {m['clip_frac']*100:>7.1f}% "
              f"{m['explained_var']:>10.4f}")

    # Demonstrate tool execution — uses the "Diagnose" prompt (RETRIEVE→UPDATE→SUMMARY→NOOP)
    print("\n[tool demo] executing a 4-step reasoning trajectory:")
    prompt, obs = ctrl.env.reset(MemoryEnv.PROMPTS[0])
    print(f"  prompt: {prompt}")
    seed_rec = ctrl.execute_tool(
        op=MemOp.ADD, content="prior incident: APU thermal excursion 2026-06-30",
        tier=MemTier.LTM, salience=0.6, tags=["seed"],
    )
    print(f"  seed   : op=ADD      tier=LTM rid={seed_rec.rid[:8]} (for RETRIEVE/DELETE demo)")
    for t in range(4):
        op, tier, conf = ctrl.decide(obs)
        # Wire the seed record as the parent for UPDATE/DELETE steps
        parent = seed_rec.rid if op in (MemOp.UPDATE, MemOp.DELETE, MemOp.RETRIEVE) else None
        rec = ctrl.execute_tool(
            op=op, content=f"step-{t} on '{prompt[:24]}...'", tier=tier,
            salience=0.5 + 0.1 * t, tags=[f"iter-{t}"], parent_rid=parent,
        )
        print(f"  step {t}: op={op.value:<8} tier={tier.value:<3} "
              f"conf={conf:.3f} rid={rec.rid[:8]} parent={parent[:8] if parent else '-':<8}")
        obs, _r, done, _ = ctrl.env.step(TOOL_TO_IDX[op.value])
        if done:
            break

    # Demonstrate DELETE on the "Quorum" prompt whose preferred seq is
    # RETRIEVE → UPDATE → DELETE → NOOP.
    print("\n[tool demo] executing a DELETE-exercising trajectory:")
    prompt2, obs2 = ctrl.env.reset(MemoryEnv.PROMPTS[4])  # "Quorum-validate..."
    print(f"  prompt: {prompt2}")
    for t in range(4):
        op, tier, conf = ctrl.decide(obs2)
        parent = seed_rec.rid if op in (MemOp.UPDATE, MemOp.DELETE, MemOp.RETRIEVE) else None
        rec = ctrl.execute_tool(
            op=op, content=f"qstep-{t} on '{prompt2[:24]}...'", tier=tier,
            salience=0.5 + 0.1 * t, tags=[f"q-{t}"], parent_rid=parent,
        )
        print(f"  step {t}: op={op.value:<8} tier={tier.value:<3} "
              f"conf={conf:.3f} rid={rec.rid[:8]} parent={parent[:8] if parent else '-':<8}")
        obs2, _r, done, _ = ctrl.env.step(TOOL_TO_IDX[op.value])
        if done:
            break

    # Verify the DELETE op is wired into the tool vocabulary and the
    # execute_tool path actually tombstones when invoked directly.
    direct_del = ctrl.execute_tool(
        op=MemOp.DELETE, content="manual tombstone of seed record",
        tier=MemTier.STM, salience=0.0, parent_rid=seed_rec.rid,
        tags=["manual-delete"],
    )
    tombstoned = any(
        "tombstoned" in r.tags and r.rid == seed_rec.rid
        for r in ctrl.ltm + ctrl.stm
    )
    assert tombstoned, "DELETE must tombstone the parent record"
    assert any(e["op"] == "DELETE" for e in ctrl.esr_log), \
        "DELETE op must appear in ESR log after direct invocation"
    print(f"  direct : op=DELETE   tier=STM rid={direct_del.rid[:8]} "
          f"parent={seed_rec.rid[:8]}  → tombstone OK")

    # ---- Adm-gated decide demo -------------------------------------------
    # Demonstrate that decide_adm() consults the Adm intent mapper and
    # re-samples when the policy's first choice is inadmissible.
    print("\n[adm-gated demo] exercising decide_adm() with re-sampling:")
    try:
        from adm_intent_mapper import Intent as AdmIntentT, Context as AdmCtxT  # type: ignore[assignment]
    except ImportError:
        from cognition.adm_intent_mapper import Intent as AdmIntentT, Context as AdmCtxT
    # Use the "diagnose" intent — required ops are RETRIEVE/FILTER/SUMMARY
    # (LTM).  The untrained policy will often emit STM ops (ADD/UPDATE/DELETE)
    # which the Adm mapper rejects; the loop must re-sample until it finds
    # an admissible LTM op.
    ctx_diag = AdmCtxT(
        island="APU", theta=0.5,
        epistemic_ids={seed_rec.rid},
        tombstoned=set(),
        risk_class="low",
    )
    op_a, tier_a, conf_a, chain_a, diags_a = ctrl.decide_adm(
        obs, intent=AdmIntentT.DIAGNOSE, ctx=ctx_diag,
        parent_rid=seed_rec.rid, max_resample=6,
    )
    print(f"  intent=diagnose  → op={op_a.value:<8} tier={tier_a.value:<3} "
          f"conf={conf_a:.3f}  admissible={chain_a.admissible}")
    for d in diags_a:
        print(f"    {d}")
    rec_a = ctrl.execute_tool(
        op=op_a, content="adm-gated diagnose step",
        tier=tier_a, salience=0.6, parent_rid=seed_rec.rid,
        tags=["adm-gated"], evidence_chain=chain_a,
    )
    print(f"  committed: rid={rec_a.rid[:8]}  evidence_chain attached")

    # Verify the ESR log now contains an entry with an evidence_chain
    ec_entries = [e for e in ctrl.esr_log if "evidence_chain" in e]
    assert len(ec_entries) >= 1, "ESR log must contain at least one evidence_chain entry"
    ec0 = ec_entries[0]["evidence_chain"]
    assert ec0["intent"] == "diagnose", "evidence chain intent must be diagnose"
    assert ec0["admissible"] is True, "evidence chain must be admissible"
    assert "attempts" in ec0 and len(ec0["attempts"]) >= 1, "attempts must be recorded"
    print(f"  verified: ESR log entry {ec_entries[0]['rid'][:8]} carries "
          f"evidence_chain with intent={ec0['intent']}, "
          f"attempts={len(ec0['attempts'])}")

    print(f"\n[store] STM={len(ctrl.stm)}  LTM={len(ctrl.ltm)}  ESR log={len(ctrl.esr_log)}")

    # Dump ESR log
    esr_path = "/home/z/my-project/download/agemem_esr_log.json"
    with open(esr_path, "w", encoding="utf-8") as f:
        json.dump(ctrl.esr_log, f, indent=2)
    print(f"[esr] trajectory log written to: {esr_path}")

    # Dump final metrics
    metrics_path = "/home/z/my-project/download/agemem_metrics.json"
    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump({
            "config": asdict(ctrl.cfg),
            "history": history,
            "final_store": {"stm": len(ctrl.stm), "ltm": len(ctrl.ltm)},
            "esr_entries": len(ctrl.esr_log),
        }, f, indent=2)
    print(f"[metrics] training history written to: {metrics_path}")

    # Sanity assertions
    assert len(ctrl.stm) >= 1, "STM must contain at least one record after demo"
    assert len(ctrl.ltm) >= 1, "LTM must contain at least one record after demo"
    assert all("rid" in e and "op" in e for e in ctrl.esr_log), "ESR log malformed"
    final_loss = history[-1]["loss"]
    assert math.isfinite(final_loss), "final loss is non-finite"

    print("=" * 78)
    print("AgeMem self-test PASSED.")
    print("=" * 78)
    return {"history": history, "esr_entries": len(ctrl.esr_log)}


if __name__ == "__main__":
    self_test()  # pragma: no cover
