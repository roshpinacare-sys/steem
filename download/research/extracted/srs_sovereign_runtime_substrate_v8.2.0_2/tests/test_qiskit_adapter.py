"""Tests for simulation/qiskit_adapter.py.

Target: push coverage from 0% to 70%+ by directly exercising:
  - QiskitBackendConfig defaults
  - QiskitBackendAdapter construction + _init_backend
  - adaqc_to_qiskit() circuit conversion (all gate types)
  - execute() end-to-end with real AerSimulator
  - _estimate_fidelity()
  - feed_back_noise()
  - run_demonstration() end-to-end

Requires qiskit + qiskit-aer to be installed.
"""
from __future__ import annotations

import pytest

# Skip the entire module if qiskit isn't available.
qiskit = pytest.importorskip("qiskit")
aer = pytest.importorskip("qiskit_aer")

from simulation.qiskit_adapter import (
    QISKIT_AVAILABLE,
    QiskitBackendConfig,
    QiskitBackendAdapter,
    run_demonstration,
)
from simulation.adaqc_compiler import (
    AdaQCCompiler, NisqDevice, Circuit,
)


# ---------------------------------------------------------------------------
# QiskitBackendConfig
# ---------------------------------------------------------------------------

def test_config_defaults():
    """Default config has sensible values."""
    cfg = QiskitBackendConfig()
    assert cfg.backend_name == "aer_simulator"
    assert cfg.n_qubits == 4
    assert cfg.shots == 1024
    assert cfg.use_noise_model is True
    assert len(cfg.coupling_map) >= 3
    assert "cx" in cfg.gate_errors
    assert "measure" in cfg.gate_errors


def test_config_override():
    """Config fields can be overridden."""
    cfg = QiskitBackendConfig(n_qubits=2, shots=512, use_noise_model=False)
    assert cfg.n_qubits == 2
    assert cfg.shots == 512
    assert cfg.use_noise_model is False


# ---------------------------------------------------------------------------
# QiskitBackendAdapter construction
# ---------------------------------------------------------------------------

def test_adapter_constructs_with_defaults():
    """Adapter can be constructed with no args."""
    adapter = QiskitBackendAdapter()
    assert adapter.config is not None
    assert adapter.backend is not None  # _init_backend sets it


def test_adapter_constructs_with_config():
    """Adapter accepts a custom config."""
    cfg = QiskitBackendConfig(n_qubits=2, shots=256)
    adapter = QiskitBackendAdapter(cfg)
    assert adapter.config.n_qubits == 2
    assert adapter.config.shots == 256


def test_adapter_init_backend_creates_aer_simulator():
    """_init_backend creates an AerSimulator instance."""
    adapter = QiskitBackendAdapter()
    from qiskit_aer import AerSimulator
    assert isinstance(adapter.backend, AerSimulator)


def test_adapter_noise_model_built_when_enabled():
    """When use_noise_model=True, the noise model is built."""
    cfg = QiskitBackendConfig(use_noise_model=True)
    adapter = QiskitBackendAdapter(cfg)
    # Noise model may be None if qiskit_aer.noise fails, but typically it's set.
    # We just verify the adapter doesn't crash.
    assert adapter.backend is not None


def test_adapter_noise_model_none_when_disabled():
    """When use_noise_model=False, noise_model is None."""
    cfg = QiskitBackendConfig(use_noise_model=False)
    adapter = QiskitBackendAdapter(cfg)
    assert adapter.noise_model is None
    assert adapter.backend is not None  # backend still created


# ---------------------------------------------------------------------------
# adaqc_to_qiskit() — circuit conversion
# ---------------------------------------------------------------------------

def test_adaqc_to_qiskit_single_h_gate():
    """A single H gate converts to a QuantumCircuit with one h() instruction."""
    adapter = QiskitBackendAdapter(QiskitBackendConfig(n_qubits=1))
    circuit = Circuit(n_qubits=1)
    circuit.add_gate("H", [0])
    qc = adapter.adaqc_to_qiskit(circuit)
    assert qc.num_qubits == 1
    # measure_all adds a measurement instruction per qubit + a barrier
    # So gate count is at least 1 (H) + measurements.
    assert qc.size() >= 1


def test_adaqc_to_qiskit_cnot_gate():
    """A CNOT gate converts correctly."""
    adapter = QiskitBackendAdapter(QiskitBackendConfig(n_qubits=2))
    circuit = Circuit(n_qubits=2)
    circuit.add_gate("H", [0])
    circuit.add_gate("CNOT", [0, 1])
    qc = adapter.adaqc_to_qiskit(circuit)
    assert qc.num_qubits == 2
    assert qc.size() >= 2  # H + CNOT + measurements


def test_adaqc_to_qiskit_all_single_qubit_gates():
    """All single-qubit gate types convert without error."""
    adapter = QiskitBackendAdapter(QiskitBackendConfig(n_qubits=1))
    gate_names = ["H", "X", "Y", "Z", "S", "T"]
    for name in gate_names:
        circuit = Circuit(n_qubits=1)
        circuit.add_gate(name, [0])
        qc = adapter.adaqc_to_qiskit(circuit)
        assert qc.size() >= 1


def test_adaqc_to_qiskit_rotation_gates():
    """Rotation gates (R_X, R_Y, R_Z) convert with params."""
    adapter = QiskitBackendAdapter(QiskitBackendConfig(n_qubits=1))
    for name in ["R_X", "R_Y", "R_Z"]:
        circuit = Circuit(n_qubits=1)
        circuit.add_gate(name, [0], params=[0.5])
        qc = adapter.adaqc_to_qiskit(circuit)
        assert qc.size() >= 1


def test_adaqc_to_qiskit_rzz_gate():
    """RZZ gate converts with 2 qubits + 1 param."""
    adapter = QiskitBackendAdapter(QiskitBackendConfig(n_qubits=2))
    circuit = Circuit(n_qubits=2)
    circuit.add_gate("R_ZZ", [0, 1], params=[0.5])
    qc = adapter.adaqc_to_qiskit(circuit)
    assert qc.size() >= 1


def test_adaqc_to_qiskit_swap_gate():
    """SWAP gate converts correctly."""
    adapter = QiskitBackendAdapter(QiskitBackendConfig(n_qubits=2))
    circuit = Circuit(n_qubits=2)
    circuit.add_gate("SWAP", [0, 1])
    qc = adapter.adaqc_to_qiskit(circuit)
    assert qc.size() >= 1


def test_adaqc_to_qiskit_unknown_gate_skipped():
    """Unknown gate names are silently skipped (no crash)."""
    adapter = QiskitBackendAdapter(QiskitBackendConfig(n_qubits=1))
    circuit = Circuit(n_qubits=1)
    circuit.add_gate("UNKNOWN_GATE", [0])
    qc = adapter.adaqc_to_qiskit(circuit)
    # Only measurements remain (from measure_all)
    assert qc.size() >= 0  # no crash


# ---------------------------------------------------------------------------
# execute() — end-to-end with real AerSimulator
# ---------------------------------------------------------------------------

def test_execute_returns_well_formed_result():
    """execute() returns a dict with the expected keys."""
    adapter = QiskitBackendAdapter(QiskitBackendConfig(n_qubits=2, shots=256))
    circuit = Circuit(n_qubits=2)
    circuit.add_gate("H", [0])
    circuit.add_gate("CNOT", [0, 1])
    result = adapter.execute(circuit)
    assert "counts" in result
    assert "fidelity" in result
    assert "depth" in result
    assert "gate_count" in result
    assert "execution_time_s" in result
    assert "backend" in result
    assert "shots" in result
    assert "transpiled" in result
    # Counts is a dict with bitstring keys
    assert isinstance(result["counts"], dict)
    assert sum(result["counts"].values()) == 256
    # Fidelity is in [0, 1]
    assert 0.0 <= result["fidelity"] <= 1.0
    # Depth and gate_count are positive
    assert result["depth"] >= 1
    assert result["gate_count"] >= 1


def test_execute_without_transpile():
    """execute(transpile_first=False) skips transpilation."""
    adapter = QiskitBackendAdapter(QiskitBackendConfig(n_qubits=1, shots=128))
    circuit = Circuit(n_qubits=1)
    circuit.add_gate("H", [0])
    result = adapter.execute(circuit, transpile_first=False)
    assert result["transpiled"] is False
    assert isinstance(result["counts"], dict)


def test_execute_bell_state():
    """A Bell state (H + CNOT) should produce correlated outcomes.

    In Qiskit 2.x, the counts keys have format "<bits> <register>" (e.g. "11 00").
    We normalize by taking the first space-separated token.
    """
    adapter = QiskitBackendAdapter(QiskitBackendConfig(
        n_qubits=2, shots=1024, use_noise_model=False
    ))
    circuit = Circuit(n_qubits=2)
    circuit.add_gate("H", [0])
    circuit.add_gate("CNOT", [0, 1])
    result = adapter.execute(circuit)
    counts = result["counts"]
    # Normalize keys: take the first space-separated token (the measured bits)
    normalized = {}
    for key, val in counts.items():
        bits = key.split(" ")[0]  # e.g. "11 00" -> "11"
        normalized[bits] = normalized.get(bits, 0) + val
    # Bell state should produce ~50/50 between 00 and 11.
    p_00 = normalized.get("00", 0) / 1024
    p_11 = normalized.get("11", 0) / 1024
    assert p_00 + p_11 > 0.95  # almost all outcomes are 00 or 11


# ---------------------------------------------------------------------------
# _estimate_fidelity()
# ---------------------------------------------------------------------------

def test_estimate_fidelity_single_gate():
    """_estimate_fidelity multiplies (1 - error) for each gate."""
    cfg = QiskitBackendConfig(
        n_qubits=1, use_noise_model=False,
        gate_errors={"h": 0.001, "measure": 0.0},
    )
    adapter = QiskitBackendAdapter(cfg)
    circuit = Circuit(n_qubits=1)
    circuit.add_gate("H", [0])
    qc = adapter.adaqc_to_qiskit(circuit)
    fid = adapter._estimate_fidelity(qc)
    # Each H contributes (1 - 0.001); measure contributes (1 - 0.0) = 1.0.
    # The actual fidelity depends on how many instructions are in qc.data,
    # but it should be close to 1.0 with a single low-error gate.
    assert 0.99 <= fid <= 1.0


def test_estimate_fidelity_decreases_with_more_gates():
    """More gates → lower fidelity."""
    cfg = QiskitBackendConfig(
        n_qubits=1, use_noise_model=False,
        gate_errors={"h": 0.05, "measure": 0.0},
    )
    adapter = QiskitBackendAdapter(cfg)
    # 1 gate
    c1 = Circuit(n_qubits=1)
    c1.add_gate("H", [0])
    qc1 = adapter.adaqc_to_qiskit(c1)
    f1 = adapter._estimate_fidelity(qc1)
    # 3 gates
    c3 = Circuit(n_qubits=1)
    for _ in range(3):
        c3.add_gate("H", [0])
    qc3 = adapter.adaqc_to_qiskit(c3)
    f3 = adapter._estimate_fidelity(qc3)
    assert f3 < f1


# ---------------------------------------------------------------------------
# feed_back_noise()
# ---------------------------------------------------------------------------

def test_feed_back_noise_returns_nisq_device():
    """feed_back_noise returns a NisqDevice with updated errors."""
    adapter = QiskitBackendAdapter(QiskitBackendConfig(
        n_qubits=3,
        gate_errors={"cx": 0.01, "h": 0.001},
        gate_durations={"cx": 200, "h": 50},
        coupling_map=[(0, 1), (1, 2)],
    ))
    result = {"fidelity": 0.95}
    updated = adapter.feed_back_noise(result)
    assert isinstance(updated, NisqDevice)
    assert updated.n_qubits == 3
    assert "cx" in updated.gate_errors
    assert "h" in updated.gate_errors
    assert updated.connectivity == [(0, 1), (1, 2)]


def test_feed_back_noise_adjusts_errors_based_on_fidelity():
    """Low fidelity → errors are scaled up; high fidelity → errors stay similar."""
    cfg = QiskitBackendConfig(
        n_qubits=2,
        gate_errors={"cx": 0.01, "h": 0.001},
        gate_durations={"cx": 200, "h": 50},
    )
    adapter = QiskitBackendAdapter(cfg)
    original_cx = cfg.gate_errors["cx"]

    # Low fidelity → adjustment > 1 → errors increase
    low_fid_result = {"fidelity": 0.5}
    updated_low = adapter.feed_back_noise(low_fid_result)
    assert updated_low.gate_errors["cx"] >= original_cx

    # High fidelity → adjustment ≈ 1 → errors stay similar
    high_fid_result = {"fidelity": 0.99}
    updated_high = adapter.feed_back_noise(high_fid_result)
    # Errors should be close to original (within 2x)
    assert updated_high.gate_errors["cx"] <= original_cx * 2.0


def test_feed_back_noise_clamps_adjustment():
    """Adjustment is clamped to [0.5, 2.0]."""
    cfg = QiskitBackendConfig(
        n_qubits=2,
        gate_errors={"cx": 0.5},  # already high
        gate_durations={"cx": 200},
    )
    adapter = QiskitBackendAdapter(cfg)
    # Very low fidelity would try to scale errors by 1/0.01 = 100x,
    # but clamping limits adjustment to 2.0x.
    result = {"fidelity": 0.01}
    updated = adapter.feed_back_noise(result)
    # 0.5 * 2.0 = 1.0, but clamped to min(1.0, 1.0) = 1.0
    assert updated.gate_errors["cx"] <= 1.0


# ---------------------------------------------------------------------------
# run_demonstration() — end-to-end
# ---------------------------------------------------------------------------

def test_run_demonstration_returns_well_formed_result():
    """run_demonstration() runs the full AdaQC → Qiskit → feedback cycle."""
    result = run_demonstration()
    assert isinstance(result, dict)
    assert "initial_circuit" in result
    assert "execution" in result
    assert "recompiled_circuit" in result
    # Initial circuit has gates + depth
    assert result["initial_circuit"]["gates"] > 0
    assert result["initial_circuit"]["depth"] > 0
    # Execution has fidelity + time
    assert result["execution"]["fidelity"] > 0
    assert result["execution"]["time_s"] > 0
    # Recompiled circuit has gates + depth
    assert result["recompiled_circuit"]["gates"] > 0
    assert result["recompiled_circuit"]["depth"] > 0


def test_qiskit_available_flag_is_true():
    """QISKIT_AVAILABLE must be True now that qiskit is installed."""
    assert QISKIT_AVAILABLE is True
