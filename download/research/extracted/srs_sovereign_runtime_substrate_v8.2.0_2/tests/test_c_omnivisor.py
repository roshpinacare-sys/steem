"""Tests for the C Omnivisor isolation engine (kernel/c/)."""
import subprocess, sys
from pathlib import Path
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
C_DIR = REPO_ROOT / "kernel" / "c"

def test_c_omnivisor_compiles():
    result = subprocess.run(["make", "clean", "all"], capture_output=True, text=True, cwd=str(C_DIR), timeout=30)
    assert result.returncode == 0, f"Compilation failed:\n{result.stderr}"

def test_c_omnivisor_unit_tests():
    result = subprocess.run(["make", "check"], capture_output=True, text=True, cwd=str(C_DIR), timeout=30)
    assert result.returncode == 0 and "All 12 unit tests passed" in result.stdout

def test_c_omnivisor_isolation_demo():
    result = subprocess.run(["make", "run"], capture_output=True, text=True, cwd=str(C_DIR), timeout=30)
    assert result.returncode == 0 and "ISOLATION HELD" in result.stdout
    assert "BLOCKED" in result.stdout and "THROTTLED" in result.stdout

def test_c_omnivisor_address_sanitizer():
    result = subprocess.run(
        ["gcc", "-Wall", "-Wextra", "-std=c11", "-g", "-fsanitize=address,undefined",
         "-o", "/tmp/omnivisor_asan", "main.c", "smpu.c", "qos.c", "sched.c", "-lm"],
        capture_output=True, text=True, cwd=str(C_DIR), timeout=30)
    if result.returncode != 0:
        pytest.skip("ASan compilation failed")
    result_run = subprocess.run(["/tmp/omnivisor_asan"], capture_output=True, text=True, timeout=30)
    assert result_run.returncode == 0 and "ISOLATION HELD" in result_run.stdout
