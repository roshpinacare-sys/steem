#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
smoke_test.py — portable repo-wide smoke test.

Runs every module's self-test and verifies the Adm linker manifest.
No hardcoded paths — works from any checkout.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    print("=" * 78)
    print("SRS Repository — Smoke Test")
    print("=" * 78)

    modules = []
    for dir_name in ("kernel", "cognition", "verification", "simulation",
                     "governance", "self_healing"):
        dir_path = REPO_ROOT / dir_name
        if not dir_path.exists():
            continue
        for py_file in sorted(dir_path.glob("*.py")):
            if py_file.name == "__init__.py":
                continue
            modules.append(py_file)

    print(f"\nFound {len(modules)} Python modules to test:\n")

    passed = 0
    failed = 0
    env = os.environ.copy()
    env["PYTHONPATH"] = str(REPO_ROOT) + os.pathsep + env.get("PYTHONPATH", "")
    for mod in modules:
        rel = mod.relative_to(REPO_ROOT)
        try:
            result = subprocess.run(
                [sys.executable, str(mod)],
                capture_output=True, text=True, timeout=60,
                cwd=str(REPO_ROOT), env=env,
            )
            ok = result.returncode == 0 and (
                "PASSED" in result.stdout or
                "machine-readable report written" in result.stdout or
                "COMPLETE" in result.stdout
            )
        except Exception:
            ok = False
        status = "✓ PASS" if ok else "✗ FAIL"
        print(f"  {status:<10} {rel}")
        if ok:
            passed += 1
        else:
            failed += 1

    print(f"\n{'='*78}")
    print(f"Result: {passed}/{len(modules)} modules passed, {failed} failed")

    # Verify manifest
    manifest_path = REPO_ROOT / "adm_linker_manifest.json"
    if manifest_path.exists():
        with open(manifest_path) as f:
            manifest = json.load(f)
        n_files = len(manifest["files"])
        missing = [e["path"] for e in manifest["files"]
                    if not (REPO_ROOT / e["path"]).exists()]
        if missing:
            print(f"✗ Missing files: {missing}")
            failed += len(missing)
        else:
            print(f"✓ All {n_files} manifest files exist")

    print(f"\n{'='*78}")
    if failed == 0:
        print("🎉 ALL SMOKE TESTS PASSED")
    else:
        print(f"💀 {failed} SMOKE TESTS FAILED")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
