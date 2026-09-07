"""Tests for New Substrate Search (Program Synthesis)."""
from __future__ import annotations
import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "scripts"))

from rce2_new_substrate_search import (
    evaluate_program, program_size, program_storage,
    enumerate_programs, synthesize, verify_program,
    SynthesizedProgram,
)


class TestProgramEvaluation:
    def test_var(self):
        assert evaluate_program(("var", 0), 1, 4) == True
        assert evaluate_program(("var", 0), 0, 4) == False
        assert evaluate_program(("var", 1), 2, 4) == True

    def test_const(self):
        assert evaluate_program(("const", True), 0, 4) == True
        assert evaluate_program(("const", False), 0, 4) == False

    def test_not(self):
        assert evaluate_program(("not", ("var", 0)), 0, 4) == True
        assert evaluate_program(("not", ("var", 0)), 1, 4) == False

    def test_and(self):
        assert evaluate_program(("and", ("var", 0), ("var", 1)), 3, 4) == True
        assert evaluate_program(("and", ("var", 0), ("var", 1)), 1, 4) == False

    def test_or(self):
        assert evaluate_program(("or", ("var", 0), ("var", 1)), 1, 4) == True
        assert evaluate_program(("or", ("var", 0), ("var", 1)), 0, 4) == False

    def test_xor(self):
        assert evaluate_program(("xor", ("var", 0), ("var", 1)), 1, 4) == True
        assert evaluate_program(("xor", ("var", 0), ("var", 1)), 3, 4) == False

    def test_nested(self):
        prog = ("xor", ("and", ("var", 0), ("var", 1)), ("var", 2))
        # state 7 = 111: bit0=1, bit1=1, bit2=1 -> (1&1)^1 = 0 -> False
        assert evaluate_program(prog, 7, 4) == False
        # state 3 = 011: bit0=1, bit1=1, bit2=0 -> (1&1)^0 = 1 -> True
        assert evaluate_program(prog, 3, 4) == True


class TestProgramSize:
    def test_size_var(self):
        assert program_size(("var", 0)) == 1

    def test_size_not(self):
        assert program_size(("not", ("var", 0))) == 2

    def test_size_and(self):
        assert program_size(("and", ("var", 0), ("var", 1))) == 3

    def test_size_nested(self):
        prog = ("xor", ("and", ("var", 0), ("var", 1)), ("var", 2))
        assert program_size(prog) == 5


class TestEnumeration:
    def test_enumerate_size_1(self):
        progs = enumerate_programs(4, max_size=1)
        # 4 vars + 2 constants = 6
        assert len(progs) == 6

    def test_enumerate_size_2(self):
        progs = enumerate_programs(4, max_size=2)
        # Size 1: 6 programs
        # Size 2: NOT of each size-1 = 6 programs
        assert len(progs) >= 12

    def test_enumerate_includes_all_ops(self):
        progs = enumerate_programs(2, max_size=3)
        ops_found = set()
        for p in progs:
            if isinstance(p, tuple):
                ops_found.add(p[0])
        assert "var" in ops_found
        assert "const" in ops_found
        assert "not" in ops_found
        assert "and" in ops_found
        assert "or" in ops_found
        assert "xor" in ops_found


class TestSynthesis:
    def test_synthesize_xor(self):
        """Should synthesize an XOR program."""
        rng = random.Random(42)
        d = 4
        def f(x): return bool((x >> 0) & 1 ^ (x >> 1) & 1)
        obs = [(s, f(s)) for s in rng.sample(range(16), 10)]
        result = synthesize(obs, d, max_size=5, max_programs=10000)
        assert result is not None
        assert result.verified
        # Should be small (XOR of 2 vars = size 3)
        assert result.size <= 5

    def test_synthesize_and(self):
        """Should synthesize an AND program."""
        rng = random.Random(42)
        d = 4
        def f(x): return bool((x >> 0) & 1 and (x >> 1) & 1)
        obs = [(s, f(s)) for s in rng.sample(range(16), 10)]
        result = synthesize(obs, d, max_size=5, max_programs=10000)
        assert result is not None
        assert result.verified

    def test_synthesize_or(self):
        """Should synthesize an OR program."""
        rng = random.Random(42)
        d = 4
        def f(x): return bool((x >> 0) & 1 or (x >> 1) & 1)
        obs = [(s, f(s)) for s in rng.sample(range(16), 10)]
        result = synthesize(obs, d, max_size=5, max_programs=10000)
        assert result is not None

    def test_synthesize_not_found(self):
        """Complex functions may not be found within search budget."""
        rng = random.Random(42)
        d = 8
        # Random oracle — no short program
        table = {s: rng.random() > 0.5 for s in range(256)}
        def f(x): return table[x]
        obs = [(s, f(s)) for s in rng.sample(range(256), 20)]
        result = synthesize(obs, d, max_size=5, max_programs=1000)
        # May or may not find — random function might coincidentally match
        # a small program on 20 observations
        # Just verify it doesn't crash
        assert result is None or result.verified

    def test_synthesis_prefers_smallest(self):
        """Synthesis should return the smallest matching program."""
        rng = random.Random(42)
        d = 4
        def f(x): return bool((x >> 0) & 1)  # just bit 0
        obs = [(s, f(s)) for s in rng.sample(range(16), 10)]
        result = synthesize(obs, d, max_size=5, max_programs=10000)
        assert result is not None
        # Smallest: ("var", 0) = size 1
        assert result.size == 1


class TestVerification:
    def test_verify_correct_program(self):
        """A correct program should pass verification."""
        d = 4
        def f(x): return bool((x >> 0) & 1 ^ (x >> 1) & 1)
        prog = ("xor", ("var", 0), ("var", 1))
        verified, acc, cost = verify_program(prog, f, d, n_test=100)
        assert verified
        assert acc == 1.0

    def test_verify_wrong_program(self):
        """A wrong program should fail verification."""
        d = 4
        def f(x): return bool((x >> 0) & 1 and (x >> 1) & 1)  # AND
        prog = ("xor", ("var", 0), ("var", 1))  # XOR (different)
        verified, acc, cost = verify_program(prog, f, d, n_test=100)
        assert not verified
        assert acc < 1.0


class TestSubstrateComparison:
    def test_synthesis_handles_nonlinear(self):
        """Program synthesis should handle AND (nonlinear) that GF(2) cannot."""
        rng = random.Random(42)
        d = 4
        def f(x): return bool((x >> 0) & 1 and (x >> 1) & 1 and (x >> 2) & 1)
        obs = [(s, f(s)) for s in rng.sample(range(16), 12)]
        result = synthesize(obs, d, max_size=5, max_programs=10000)
        assert result is not None, "Synthesis should find AND program"
        assert result.verified

    def test_synthesis_cost_lower_for_simple(self):
        """For simple functions, synthesis should be cheap."""
        rng = random.Random(42)
        d = 4
        def f(x): return bool((x >> 0) & 1)
        obs = [(s, f(s)) for s in rng.sample(range(16), 10)]
        result = synthesize(obs, d, max_size=3, max_programs=100)
        assert result is not None
        # Should find immediately (first program checked)
        assert result.synthesis_cost < 100
