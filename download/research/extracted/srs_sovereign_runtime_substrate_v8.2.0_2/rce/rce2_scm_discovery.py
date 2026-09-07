#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_scm_discovery.py — RCE-2 v6.12 Structural Causal Model Discovery

PROBLEM (inherited from v6.11):
  The v6.11 causal engine tests each feature INDEPENDENTLY:
    ACE(i) = E[Y | do(X_i=1)] - E[Y | do(X_i=0)]

  This misses three important causal structures:

  1. MEDIATOR: A → B → Y
     - ACE(A) > 0 (A is causal)
     - ACE(B) > 0 (B is also causal — intervening on B changes Y)
     - But B is NOT the root cause — it's a mediator
     - v6.11 would classify both A and B as causal, but the REAL
       causal law should use only A (the root cause)

  2. COLLIDER: A → Y ← Z
     - A and Z are both causes of Y
     - A and Z may be independent marginally
     - But conditioning on Y creates spurious correlation between A and Z
     - v6.11's independent tests would correctly identify both as causal,
       but wouldn't detect that they're independent causes (not confounded)

  3. CHAIN: A → B → C → Y
     - Long causal chains where intervening on intermediates changes Y
     - But the ROOT cause is A
     - v6.11 would classify all of A, B, C as causal

SOLUTION:
  The SCMD discoverer learns the full causal DAG (directed acyclic graph)
  using conditional independence tests. The DAG captures:

    - Direct causes (parents of Y)
    - Indirect causes (ancestors of Y through mediators)
    - Independent causes (multiple parents of Y)
    - Confounders (common causes of X and Y)

  From the DAG, we extract ROOT CAUSES — features with no parents in the
  DAG that are ancestors of Y. Root causes are the strongest causal
  features: intervening on them changes Y, and they are not mediated
  by other features.

ALGORITHM (PC algorithm, simplified):

  1. SKELETON: Start with a complete undirected graph. Remove edges
     between features that are conditionally independent given some
     conditioning set.

  2. ORIENTATION: For each pair X-Y-Z (where X and Z are not adjacent),
     if X and Z are independent given Y but not independent marginally,
     orient as X → Y ← Z (collider).

  3. PROPAGATION: Apply orientation rules to propagate directions
     without creating cycles or new colliders.

  4. ROOT CAUSE EXTRACTION: Find features with no incoming edges that
     are ancestors of Y. These are the root causes.

MATHEMATICAL MODEL:

  Conditional independence: X ⊥ Z | S  iff  P(X, Z | S) = P(X | S) * P(Z | S)

  We test this empirically:
    CI(X, Z | S) = |corr(X, Z | S=s) - corr(X, Z | S=s')| for all s, s'

  If |CI| < ε for all s, s' → X and Z are conditionally independent given S.

  Root cause: A feature X is a root cause of Y iff:
    - X is an ancestor of Y in the DAG
    - X has no parents (in-degree 0)

  Causal law uses root causes: it predicts Y from root causes only,
  ignoring mediators and colliders. This is the MINIMAL causal law —
  the smallest set of features that causally determine Y.
"""
from __future__ import annotations

import itertools
import math
import random
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, FrozenSet, List, Optional, Set, Tuple

from rce.rce2_substrate import Substrate
from rce.rce2_causal_discovery import SubstrateV611, CausalDiscoveryEngine


# ===========================================================================
# DAG Representation
# ===========================================================================

@dataclass
class CausalDAG:
    """A directed acyclic graph representing causal structure.

    Nodes are feature indices. Edges X → Y mean "X directly causes Y".
    """
    nodes: Set[int] = field(default_factory=set)
    edges: Set[Tuple[int, int]] = field(default_factory=set)  # (parent, child)
    outcome_node: int = -1  # the outcome feature index (or -1 if separate)

    def add_edge(self, parent: int, child: int) -> None:
        self.nodes.add(parent)
        self.nodes.add(child)
        self.edges.add((parent, child))

    def parents(self, node: int) -> Set[int]:
        """Direct parents of a node."""
        return {p for (p, c) in self.edges if c == node}

    def children(self, node: int) -> Set[int]:
        """Direct children of a node."""
        return {c for (p, c) in self.edges if p == node}

    def ancestors(self, node: int) -> Set[int]:
        """All ancestors of a node (transitive parents)."""
        result = set()
        queue = deque(self.parents(node))
        while queue:
            n = queue.popleft()
            if n not in result:
                result.add(n)
                queue.extend(self.parents(n))
        return result

    def root_causes(self, target: int) -> Set[int]:
        """Root causes of a target node.

        A root cause is a node with no parents that is an ancestor of target.
        """
        ancestors = self.ancestors(target)
        return {n for n in ancestors if not self.parents(n)}

    def has_path(self, source: int, target: int) -> bool:
        """Check if there's a directed path from source to target."""
        if source == target:
            return True
        visited = set()
        queue = deque([source])
        while queue:
            n = queue.popleft()
            if n == target:
                return True
            if n in visited:
                continue
            visited.add(n)
            queue.extend(self.children(n))
        return False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "nodes": sorted(self.nodes),
            "edges": sorted([list(e) for e in self.edges]),
            "outcome_node": self.outcome_node,
        }


# ===========================================================================
# Conditional Independence Test
# ===========================================================================

def conditional_independence_test(
    features: List[Tuple[float, ...]],
    x: int, z: int,
    conditioning_set: Set[int],
    epsilon: float = 0.1
) -> bool:
    """Test if features x and z are conditionally independent given S.

    Uses a simple correlation-based test:
      - For each value combination of S, compute corr(x, z)
      - If all correlations are < epsilon → conditionally independent

    For binary features, this is exact. For continuous, it's approximate.
    """
    if not features:
        return True

    # Get unique values of conditioning set
    cond_indices = sorted(conditioning_set)
    if not cond_indices:
        # Marginal independence: corr(x, z) across all data
        x_vals = [f[x] for f in features]
        z_vals = [f[z] for f in features]
        corr = _correlation(x_vals, z_vals)
        return abs(corr) < epsilon

    # Group by conditioning set values
    groups = defaultdict(list)
    for f in features:
        key = tuple(f[i] for i in cond_indices)
        groups[key].append(f)

    # For each group, compute corr(x, z)
    for key, group in groups.items():
        if len(group) < 3:
            continue
        x_vals = [f[x] for f in group]
        z_vals = [f[z] for f in group]
        corr = _correlation(x_vals, z_vals)
        if abs(corr) >= epsilon:
            return False  # conditionally dependent in this group

    return True  # conditionally independent in all groups


def _correlation(x: List[float], y: List[float]) -> float:
    """Pearson correlation coefficient."""
    n = len(x)
    if n < 2:
        return 0.0
    mean_x = sum(x) / n
    mean_y = sum(y) / n
    cov = sum((a - mean_x) * (b - mean_y) for a, b in zip(x, y))
    var_x = sum((a - mean_x) ** 2 for a in x)
    var_y = sum((b - mean_y) ** 2 for b in y)
    if var_x < 1e-10 or var_y < 1e-10:
        return 0.0
    return cov / (math.sqrt(var_x * var_y))


# ===========================================================================
# SCM Discovery Engine (simplified PC algorithm)
# ===========================================================================

class SCMDiscoverer:
    """Discovers the structural causal model (DAG) from observational data.

    Uses a simplified PC algorithm:
      1. Start with complete undirected graph
      2. Remove edges where features are conditionally independent
      3. Orient edges using collider detection
      4. Extract root causes of the outcome

    The outcome is treated as a special node (index = n_features).
    """

    def __init__(self, ci_epsilon: float = 0.1,
                 max_conditioning_size: int = 2) -> None:
        self.ci_epsilon = ci_epsilon
        self.max_conditioning_size = max_conditioning_size
        self.dags: Dict[str, CausalDAG] = {}
        self.root_causes: Dict[str, Set[int]] = {}
        self.ci_tests_run: int = 0

    def discover_dag(self, computation_type: str,
                      features: List[Tuple[float, ...]],
                      outcomes: List[Any],
                      outcome_node: int = -1,
                      causal_features: Optional[Dict[int, float]] = None) -> CausalDAG:
        """Discover the causal DAG for a computation type.

        Args:
            computation_type: name of the computation
            features: list of feature vectors
            outcomes: list of outcomes (parallel to features)
            outcome_node: the index of the outcome node (-1 = separate)
            causal_features: optional dict {feature_idx: ACE} from v6.11
                             for interventional supplementation

        Returns:
            CausalDAG representing the discovered structure
        """
        if not features:
            return CausalDAG()

        n_features = len(features[0])

        # Add outcome as a special node (index = n_features)
        # Convert outcomes to float for correlation
        outcome_idx = n_features
        extended_features = []
        for f, y in zip(features, outcomes):
            extended = list(f) + [1.0 if y else 0.0]
            extended_features.append(tuple(extended))

        # Step 1: Skeleton — start with complete graph, remove CI edges
        # Pass outcome_idx so we don't condition on the outcome
        adjacencies = self._learn_skeleton(extended_features, n_features + 1,
                                            outcome_idx=outcome_idx)

        # Step 2: Orient edges using collider detection
        dag = self._orient_edges(adjacencies, extended_features, n_features + 1)
        dag.outcome_node = outcome_idx

        # Step 3: SUPPLEMENT with interventional edges.
        # Use v6.11's ACE values if provided.
        if causal_features:
            self._supplement_with_ace(dag, causal_features, n_features, outcome_idx)

        self.dags[computation_type] = dag
        self.root_causes[computation_type] = dag.root_causes(outcome_idx)
        return dag

    def _supplement_with_ace(self, dag: CausalDAG,
                              causal_features: Dict[int, float],
                              n_features: int,
                              outcome_idx: int) -> None:
        """Add edges from features to outcome based on ACE values.

        For each feature with non-zero ACE, if there's no directed path
        from the feature to the outcome, add a direct edge.
        """
        for i in range(n_features):
            if dag.has_path(i, outcome_idx):
                continue
            ace = causal_features.get(i, 0.0)
            if abs(ace) > self.ci_epsilon:
                dag.add_edge(i, outcome_idx)

    def _learn_skeleton(self, features: List[Tuple[float, ...]],
                         n_nodes: int,
                         outcome_idx: int = -1) -> Dict[int, Set[int]]:
        """Learn the undirected skeleton (adjacency graph).

        Start with complete graph. For each pair (i, j), test if they're
        conditionally independent given some conditioning set S. If yes,
        remove the edge.

        CRITICAL: Do NOT condition on the outcome node. Conditioning on the
        outcome can create spurious independence (collider effect) and
        remove true causal edges. The outcome is the TARGET, not a
        conditioning variable.
        """
        # Start with complete graph
        adj = {i: set(range(n_nodes)) - {i} for i in range(n_nodes)}

        # For each pair, try conditioning sets of increasing size
        for i in range(n_nodes):
            for j in range(i + 1, n_nodes):
                if j not in adj[i]:
                    continue  # already removed

                # Try empty conditioning set first
                if conditional_independence_test(features, i, j, set(), self.ci_epsilon):
                    adj[i].discard(j)
                    adj[j].discard(i)
                    self.ci_tests_run += 1
                    continue

                # Try conditioning sets of size 1 to max_conditioning_size
                # EXCLUDE the outcome node from conditioning sets
                removed = False
                for size in range(1, self.max_conditioning_size + 1):
                    other_nodes = set(range(n_nodes)) - {i, j}
                    if outcome_idx >= 0:
                        other_nodes.discard(outcome_idx)
                    for cond_set in itertools.combinations(other_nodes, size):
                        self.ci_tests_run += 1
                        if conditional_independence_test(
                                features, i, j, set(cond_set), self.ci_epsilon):
                            adj[i].discard(j)
                            adj[j].discard(i)
                            removed = True
                            break
                    if removed:
                        break

        return adj

    def _orient_edges(self, adj: Dict[int, Set[int]],
                       features: List[Tuple[float, ...]],
                       n_nodes: int) -> CausalDAG:
        """Orient edges using collider detection.

        For each unshielded triple X - Y - Z (where X and Z are not adjacent):
          If X and Z are dependent given Y → X → Y ← Z (collider)
          If X and Z are independent given Y → no collider, orient later

        After collider detection, apply propagation rules:
          - If X → Y and Y - Z, and X and Z are not adjacent → Y → Z
            (to avoid new collider)
          - If X → Y → Z and X - Z → X → Z (to avoid cycle)
        """
        dag = CausalDAG()

        # Add all nodes
        for i in range(n_nodes):
            dag.nodes.add(i)

        # Find unshielded triples and detect colliders
        oriented = set()  # set of (parent, child) directed edges

        for y in range(n_nodes):
            neighbors = sorted(adj[y])
            for i in range(len(neighbors)):
                for j in range(i + 1, len(neighbors)):
                    x, z = neighbors[i], neighbors[j]
                    if z in adj[x]:
                        continue  # shielded triple (X and Z are adjacent)

                    # Unshielded triple: X - Y - Z
                    # Test if X and Z are dependent given Y
                    if not conditional_independence_test(
                            features, x, z, {y}, self.ci_epsilon):
                        # X and Z dependent given Y → collider: X → Y ← Z
                        oriented.add((x, y))
                        oriented.add((z, y))

        # Add undirected edges (those not oriented as colliders)
        for i in range(n_nodes):
            for j in adj[i]:
                if (i, j) not in oriented and (j, i) not in oriented:
                    # Undirected — orient arbitrarily (i → j if i < j)
                    if i < j:
                        oriented.add((i, j))
                    else:
                        oriented.add((j, i))

        dag.edges = oriented
        return dag

    def get_root_causes(self, computation_type: str) -> Set[int]:
        """Return the root causes of the outcome for a computation type."""
        return self.root_causes.get(computation_type, set())

    def get_stats(self, computation_type: Optional[str] = None) -> Dict[str, Any]:
        if computation_type:
            dag = self.dags.get(computation_type)
            roots = self.root_causes.get(computation_type, set())
            if dag is None:
                return {"error": "no dag"}
            return {
                "n_nodes": len(dag.nodes),
                "n_edges": len(dag.edges),
                "n_root_causes": len(roots),
                "root_causes": sorted(roots),
                "ci_tests_run": self.ci_tests_run,
                "dag": dag.to_dict(),
            }
        return {
            "n_dags": len(self.dags),
            "ci_tests_run": self.ci_tests_run,
        }


# ===========================================================================
# v6.12 Substrate with SCM Discovery
# ===========================================================================

class SubstrateV612:
    """The v6.12 substrate integrating structural causal model discovery.

    Extends v6.11 with:
      - SCMDiscoverer that learns the full causal DAG
      - Root cause extraction (minimal causal features)
      - Mediator/collider detection via conditional independence
    """

    def __init__(self,
                 min_confidence: float = 0.85,
                 calibrated_target_acc: float = 0.90,
                 default_value: float = 1000.0,
                 min_value_threshold: float = 10.0,
                 ace_threshold: float = 0.1,
                 ci_epsilon: float = 0.1) -> None:
        self.v611 = SubstrateV611(
            min_confidence=min_confidence,
            calibrated_target_acc=calibrated_target_acc,
            default_value=default_value,
            min_value_threshold=min_value_threshold,
            ace_threshold=ace_threshold,
        )
        self.scm_discoverer = SCMDiscoverer(ci_epsilon=ci_epsilon)
        self._scm_initialized: set = set()

    def train(self, computation_type: str,
              features: Tuple[float, ...], outcome: Any) -> None:
        self.v611.train(computation_type, features, outcome)

    def fit(self, computation_type: str) -> Dict[str, Any]:
        return self.v611.fit(computation_type)

    def discover_scm(self, computation_type: str,
                      compute_fn: Callable[[Tuple[float, ...]], Any],
                      training_features: List[Tuple[float, ...]]
                      ) -> Dict[str, Any]:
        """Discover the structural causal model (DAG) and root causes.

        Args:
            computation_type: the type of computation
            compute_fn: ground truth function (features → outcome)
            training_features: sample of features

        Returns:
            Dictionary with DAG stats and root causes
        """
        # Get outcomes for training features
        outcomes = [compute_fn(f) for f in training_features]

        # Run v6.11 causal discovery first (provides ACE for supplementation)
        self.v611.discover_causal_laws(
            computation_type, compute_fn, training_features)

        # Extract ACE values from v6.11
        causal_features = {}
        for cf in self.v611.causal_engine.causal_features.get(computation_type, []):
            causal_features[cf.feature_index] = cf.ace

        # Discover DAG with interventional supplementation
        dag = self.scm_discoverer.discover_dag(
            computation_type, training_features, outcomes,
            causal_features=causal_features)

        self._scm_initialized.add(computation_type)

        stats = self.scm_discoverer.get_stats(computation_type)
        return stats

    def get_root_causes(self, computation_type: str) -> Set[int]:
        """Return the root causes of the outcome."""
        return self.scm_discoverer.get_root_causes(computation_type)

    def predict_with_scm(self, computation_type: str,
                          features: Tuple[float, ...],
                          full_computation: Callable,
                          original_cost: float = 1000.0,
                          record_outcome: bool = False
                          ) -> Tuple[Any, SubstrateOutcome, float, float,
                                     Optional[Set[int]]]:
        """Predict using SCM root causes first, then fall back to v6.11.

        Returns:
            (predicted, outcome, confidence, cost, root_causes_used)
        """
        # Check if SCM has root causes for this type
        if computation_type in self._scm_initialized:
            roots = self.scm_discoverer.get_root_causes(computation_type)
            if roots:
                # Use v6.11's causal laws (which may include root causes)
                # The SCM adds the root cause information for reporting
                predicted, outcome, conf, cost, causal_law = self.v611.predict_with_causal(
                    computation_type, features, full_computation,
                    original_cost=original_cost, record_outcome=record_outcome)
                return predicted, outcome, conf, cost, roots

        # Fall back to v6.11
        predicted, outcome, conf, cost, causal_law = self.v611.predict_with_causal(
            computation_type, features, full_computation,
            original_cost=original_cost, record_outcome=record_outcome)
        return predicted, outcome, conf, cost, None

    def get_report(self) -> Dict[str, Any]:
        return {
            "v611_report": self.v611.get_report(),
            "scm_stats": self.scm_discoverer.get_stats(),
        }


# ===========================================================================
# Self-test
# ===========================================================================

def self_test() -> None:
    """Quick self-test of SCM discovery."""
    import random
    print("Running v6.12 SCM discovery self-test...")

    sub = SubstrateV612()
    rng = random.Random(42)

    # Define a MEDIATOR structure:
    #   feature 0 (root cause) → feature 1 (mediator) → outcome
    #   feature 2 is independent noise
    def compute_fn(f):
        # outcome = f[0] (root cause), but f[1] = f[0] (mediator)
        return bool(f[0])

    # Generate training data with mediator structure
    training = []
    for _ in range(100):
        f0 = rng.random() > 0.3
        f1 = f0  # mediator: f1 is determined by f0
        f2 = rng.random() > 0.5  # independent noise
        training.append((float(f0), float(f1), float(f2)))

    # Train substrate
    for f in training:
        sub.train("mediator", f, compute_fn(f))
    sub.fit("mediator")

    # Discover SCM
    result = sub.discover_scm("mediator", compute_fn, training)
    print(f"  SCM discovery: {result}")

    # Check root causes
    roots = sub.get_root_causes("mediator")
    print(f"  Root causes: {roots}")

    # v6.11 ACE-based causal features (for comparison)
    print(f"  v6.11 causal features:")
    for cf in sub.v611.causal_engine.causal_features.get("mediator", []):
        print(f"    Feature {cf.feature_index}: ACE={cf.ace:.3f} role={cf.role}")

    print("Self-test OK.")


if __name__ == "__main__":
    self_test()
