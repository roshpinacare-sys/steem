"""Pytest fixtures shared across the SRS test suite."""
import os
import sys
from pathlib import Path

import pytest

# Add the download dir to sys.path so we can import kernel/, cognition/, etc.
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# Ensure subprocess tests inherit the Python path (so z3/torch are found)
os.environ["PYTHONPATH"] = str(REPO_ROOT) + os.pathsep + os.environ.get("PYTHONPATH", "")


@pytest.fixture
def repo_root():
    """The repository root directory."""
    return REPO_ROOT
