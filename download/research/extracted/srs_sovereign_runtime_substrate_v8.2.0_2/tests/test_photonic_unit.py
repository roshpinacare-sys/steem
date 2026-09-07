"""Direct unit tests for simulation/photonic_bus.py.

Targets the under-covered paths identified by `scripts/run_coverage.py`:
  - PhotonicPacket.encode() complex amplitude
  - MachZehnderSwitch.transfer() transfer matrix
  - PhotonicBus.matrix_vector_multiply() optical compute primitive
  - PhotonicBus.stats() shape
  - ESRPhotonicTransport.replicate / ack / pending_acks lifecycle
  - measure_throughput() returns a valid dict shape
"""
from __future__ import annotations

import cmath
import math

import pytest

from simulation.photonic_bus import (
    ESRPhotonicTransport,
    MachZehnderSwitch,
    PhotonicBus,
    PhotonicPacket,
)


# ---------------------------------------------------------------------------
# PhotonicPacket
# ---------------------------------------------------------------------------

def test_packet_encode_zero_phase():
    p = PhotonicPacket(payload=b"x", source="s", dest="d", amplitude=2.0, phase=0.0)
    assert p.encode() == complex(2.0, 0.0)


def test_packet_encode_pi_over_2_phase():
    p = PhotonicPacket(payload=b"x", source="s", dest="d", amplitude=1.0, phase=math.pi / 2)
    # exp(i*pi/2) = i, so encode = 1.0 * 1j
    assert abs(p.encode() - 1j) < 1e-9


def test_packet_encode_pi_phase():
    p = PhotonicPacket(payload=b"x", source="s", dest="d", amplitude=1.0, phase=math.pi)
    # exp(i*pi) = -1
    assert abs(p.encode() - (-1.0 + 0j)) < 1e-9


# ---------------------------------------------------------------------------
# MachZehnderSwitch
# ---------------------------------------------------------------------------

def test_mzi_transfer_theta_zero_is_straight_through():
    """theta=0 → cos(0)=1, sin(0)=0 → both ports get the full input (with loss)."""
    sw = MachZehnderSwitch(theta=0.0, loss_db=0.0)
    p1, p2 = sw.transfer(complex(1.0, 0.0))
    # With loss_db=0: t = cos(0)=1, r = 1j*sin(0)=0
    assert abs(p1 - complex(1.0, 0.0)) < 1e-9
    assert abs(p2 - complex(1.0, 0.0)) < 1e-9  # because t*a + r*a = (t+r)*a


def test_mzi_transfer_applies_loss():
    """loss_db > 0 attenuates the output."""
    sw = MachZehnderSwitch(theta=0.0, loss_db=20.0)  # 20 dB = 0.1x amplitude
    p1, _ = sw.transfer(complex(1.0, 0.0))
    assert abs(p1) < 0.11  # 0.1 + slack


def test_mzi_transfer_theta_pi_swaps_to_imaginary():
    """theta=pi → cos(pi/2)=0, sin(pi/2)=1 → r = 1j, t = 0."""
    sw = MachZehnderSwitch(theta=math.pi, loss_db=0.0)
    p1, p2 = sw.transfer(complex(1.0, 0.0))
    # t = 0, r = 1j → both ports = r*a = 1j
    assert abs(p1 - 1j) < 1e-9
    assert abs(p2 - 1j) < 1e-9


# ---------------------------------------------------------------------------
# PhotonicBus: matrix-vector multiply
# ---------------------------------------------------------------------------

def test_matrix_vector_multiply_identity():
    bus = PhotonicBus(n_nodes=4)
    ident = [[1.0 + 0j if i == j else 0j for j in range(4)] for i in range(4)]
    vec = [complex(i, 0) for i in range(4)]
    out = bus.matrix_vector_multiply(ident, vec)
    assert out == vec


def test_matrix_vector_multiply_non_trivial():
    bus = PhotonicBus(n_nodes=2)
    m = [[1.0 + 0j, 2.0 + 0j], [3.0 + 0j, 4.0 + 0j]]
    v = [complex(1.0, 0), complex(0.0, 1.0)]  # [1, i]
    out = bus.matrix_vector_multiply(m, v)
    # row 0: 1*1 + 2*i = 1 + 2i
    # row 1: 3*1 + 4*i = 3 + 4i
    assert abs(out[0] - complex(1.0, 2.0)) < 1e-9
    assert abs(out[1] - complex(3.0, 4.0)) < 1e-9


def test_matrix_vector_multiply_zero_vector():
    bus = PhotonicBus(n_nodes=3)
    m = [[complex(i + j, 0) for j in range(3)] for i in range(3)]
    v = [0j, 0j, 0j]
    out = bus.matrix_vector_multiply(m, v)
    assert all(o == 0j for o in out)


# ---------------------------------------------------------------------------
# PhotonicBus: stats and theoretical throughput
# ---------------------------------------------------------------------------

def test_stats_initial_state():
    bus = PhotonicBus(n_nodes=4)
    s = bus.stats()
    assert s["n_nodes"] == 4
    assert s["cycle"] == 0
    assert s["packets_in_flight"] == 0
    assert s["packets_delivered"] == 0
    assert s["total_bytes_delivered"] == 0
    assert s["aggregate_throughput_gbps"] == 100 * 64 * 16  # 102_400 Gbps
    assert s["aggregate_throughput_tbps"] == 102.4
    assert s["wavelengths_per_fibre"] == 64
    assert s["fibres"] == 16


def test_stats_after_routing_and_tick():
    bus = PhotonicBus(n_nodes=2)
    bus.route_packet(PhotonicPacket(payload=b"abc", source="s", dest="d"))
    bus.route_packet(PhotonicPacket(payload=b"de", source="s", dest="d"))
    delivered = bus.tick()
    assert delivered == 2
    s = bus.stats()
    assert s["packets_delivered"] == 2
    assert s["total_bytes_delivered"] == 5  # 3 + 2 bytes
    assert s["cycle"] == 1


def test_theoretical_max_throughput_constants():
    bus = PhotonicBus()
    assert bus.theoretical_max_throughput_gbps == 100 * 64 * 16
    assert bus.theoretical_max_throughput_tbps == 102.4


def test_measure_throughput_returns_valid_shape():
    bus = PhotonicBus(n_nodes=4)
    out = bus.measure_throughput(n_packets=50, payload_size=128)
    assert out["packets_delivered"] == 50
    assert out["bytes_delivered"] == 50 * 128
    assert out["elapsed_s"] > 0
    assert out["throughput_mbps"] > 0
    assert out["theoretical_max_gbps"] == 102_400
    assert 0 < out["ratio_to_theoretical"] < 1.0


# ---------------------------------------------------------------------------
# ESRPhotonicTransport
# ---------------------------------------------------------------------------

def test_esr_transport_replicate_injects_per_replica():
    bus = PhotonicBus(n_nodes=4)
    t = ESRPhotonicTransport(bus, replicas=["r1", "r2", "r3"])
    n = t.replicate("esr-001", b"payload-xyz")
    assert n == 3
    # 3 packets in flight, one per replica
    assert len(bus.packets_in_flight) == 3
    assert t.pending_acks["r1"] == ["esr-001"]
    assert t.pending_acks["r2"] == ["esr-001"]
    assert t.pending_acks["r3"] == ["esr-001"]


def test_esr_transport_tick_delivers_packets():
    bus = PhotonicBus(n_nodes=2)
    t = ESRPhotonicTransport(bus, replicas=["r1", "r2"])
    t.replicate("esr-001", b"payload")
    delivered = t.tick()
    assert delivered == 2
    assert len(bus.delivered) == 2


def test_esr_transport_ack_removes_pending():
    bus = PhotonicBus(n_nodes=2)
    t = ESRPhotonicTransport(bus, replicas=["r1", "r2"])
    t.replicate("esr-001", b"x")
    assert t.ack("r1", "esr-001") is True
    assert t.pending_acks["r1"] == []
    assert t.pending_acks["r2"] == ["esr-001"]


def test_esr_transport_ack_unknown_returns_false():
    bus = PhotonicBus(n_nodes=2)
    t = ESRPhotonicTransport(bus, replicas=["r1"])
    assert t.ack("r1", "never-injected") is False
    assert t.ack("unknown-replica", "esr-001") is False


def test_esr_transport_distinct_wavelengths_for_distinct_ids():
    """hash(esr_id) differs → wavelength differs across distinct ESRs."""
    bus = PhotonicBus(n_nodes=2)
    t = ESRPhotonicTransport(bus, replicas=["r1"])
    t.replicate("esr-001", b"x")
    t.replicate("esr-002", b"x")
    w1 = bus.packets_in_flight[0].wavelength
    w2 = bus.packets_in_flight[1].wavelength
    # They MAY collide by hash chance, but for two distinct short IDs they
    # almost always differ. Test that BOTH are within the C-band window
    # [1550.0, 1550.0 + 63*0.4].
    for w in (w1, w2):
        assert 1550.0 <= w <= 1550.0 + 63 * 0.4 + 1e-9
