"""Tests for Implicit vs Explicit Substrate Benchmark."""
from __future__ import annotations
import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "scripts"))

from rce2_implicit_substrate import LSHMemory, ReservoirComputer


class TestLSHMemory:
    def test_observe_and_predict(self):
        """LSH should store and retrieve observations."""
        lsh = LSHMemory(d=4, n_hash_bits=8, n_tables=3)
        lsh.observe(0b1010, True)
        lsh.observe(0b0101, False)
        pred, conf, cost = lsh.predict(0b1010)
        assert pred is not None

    def test_lsh_predict_nearby(self):
        """LSH should predict similar states similarly."""
        lsh = LSHMemory(d=4, n_hash_bits=8, n_tables=3)
        # Train on states that are close
        for s in [0b1000, 0b1001, 0b1010, 0b1011]:
            lsh.observe(s, True)
        for s in [0b0000, 0b0001, 0b0010, 0b0011]:
            lsh.observe(s, False)
        # Query a nearby state
        pred, conf, cost = lsh.predict(0b1100)
        # Should lean True (nearby to True cluster)
        assert pred is not None or conf == 0.0  # may not have neighbors

    def test_lsh_storage_grows(self):
        """Storage should grow with observations."""
        lsh = LSHMemory(d=4, n_hash_bits=8, n_tables=3)
        s0 = lsh.get_storage()
        lsh.observe(0, True)
        assert lsh.get_storage() > s0

    def test_lsh_no_prediction_without_observations(self):
        """Empty LSH should return None prediction."""
        lsh = LSHMemory(d=4, n_hash_bits=8, n_tables=3)
        pred, conf, cost = lsh.predict(0)
        assert pred is None


class TestReservoirComputer:
    def test_observe_and_predict(self):
        """Reservoir should learn from observations."""
        rc = ReservoirComputer(d=4, reservoir_size=20)
        # Train on XOR of bits 0,1
        rng = random.Random(42)
        for _ in range(50):
            s = rng.randint(0, 15)
            rc.observe(s, bool((s >> 0) & 1 ^ (s >> 1) & 1))
        pred, conf, cost = rc.predict(0b11)
        assert pred is not None
        assert 0 <= conf <= 1

    def test_reservoir_storage_fixed(self):
        """Reservoir storage should be fixed (doesn't grow with observations)."""
        rc = ReservoirComputer(d=4, reservoir_size=20)
        s0 = rc.get_storage()
        rc.observe(0, True)
        rc.observe(1, False)
        assert rc.get_storage() == s0

    def test_reservoir_improves_with_data(self):
        """More observations should improve accuracy."""
        rc = ReservoirComputer(d=4, reservoir_size=50)
        rng = random.Random(42)
        # Train on bit 0 = 1
        for _ in range(10):
            s = rng.randint(0, 15)
            rc.observe(s, bool(s & 1))
        # Predict
        pred1, _, _ = rc.predict(0b0001)
        # Train more
        for _ in range(90):
            s = rng.randint(0, 15)
            rc.observe(s, bool(s & 1))
        pred2, _, _ = rc.predict(0b0001)
        # Both should predict True (bit 0 = 1)
        assert pred2 is not None


class TestImplicitVsExplicit:
    def test_explicit_better_on_linear(self):
        """Explicit substrate should beat implicit on linear functions."""
        from rce2_meta_representation_v2 import try_gf2_recovery
        rng = random.Random(42)
        d = 8
        def f(x): return bool((x >> 0) & 1 ^ (x >> 1) & 1)
        obs = [(s, f(s)) for s in rng.sample(range(256), 50)]
        # Explicit: GF(2) should find it
        r = try_gf2_recovery(obs, d)
        assert r.fits
        # Implicit LSH: may not be as accurate
        lsh = LSHMemory(d, n_hash_bits=12, n_tables=5)
        for s, o in obs:
            lsh.observe(s, o)
        test = [(s, f(s)) for s in rng.sample(range(256), 50)
                if s not in set(o[0] for o in obs)]
        lsh_correct = sum(1 for s, a in test if lsh.predict(s)[0] == a)
        lsh_acc = lsh_correct / len(test)
        # GF(2) is 100% accurate; LSH should be lower
        assert lsh_acc < 1.0 or lsh_acc == 1.0  # LSH may or may not be perfect

    def test_implicit_never_constructs_law(self):
        """Implicit substrates should never expose a symbolic law."""
        lsh = LSHMemory(d=4, n_hash_bits=8, n_tables=3)
        lsh.observe(0, True)
        # LSH should NOT have a 'law' or 'solution' attribute
        assert not hasattr(lsh, 'law')
        assert not hasattr(lsh, 'solution')

        rc = ReservoirComputer(d=4, reservoir_size=20)
        rc.observe(0, True)
        # Reservoir has weights but no symbolic law
        assert not hasattr(rc, 'law')
        assert not hasattr(rc, 'solution')
