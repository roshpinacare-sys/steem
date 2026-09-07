#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_api_docs.py — Auto-generate API documentation (Markdown) from docstrings.

For each module under governance/, kernel/, cognition/, simulation/,
verification/, self_healing/, produces:
  - Module purpose (first docstring line)
  - Classes (signatures + docstrings)
  - Functions (signatures + docstrings)

Output: docs/API_REFERENCE.md (single concatenated Markdown file).
"""
from __future__ import annotations

import importlib
import inspect
import re
import sys
from pathlib import Path
from typing import List

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

MODULES_TO_DOC = [
    "governance.seg_controller",
    "governance.sqa_aggregator",
    "governance.bls_signatures",
    "kernel.omnivisor",
    "kernel.smpu_sppu",
    "kernel.ebpf_telemetry",
    "cognition.adm_intent_mapper",
    "cognition.agemem_controller",
    "cognition.agemem_adm_trainer",
    "simulation.adaqc_compiler",
    "simulation.qiskit_adapter",
    "simulation.photonic_bus",
    "verification.z3_power_proof",
    "verification.saarthi_sva_generator",
    "self_healing.digital_dna",
    "self_healing.antibody_maturation",
]


def format_signature(obj) -> str:
    try:
        sig = inspect.signature(obj)
        return str(sig)
    except (ValueError, TypeError):
        return "(...)"


def doc_first_line(obj) -> str:
    doc = inspect.getdoc(obj) or ""
    if not doc:
        return ""
    return doc.split("\n")[0].strip()


def doc_full(obj) -> str:
    return inspect.getdoc(obj) or ""


def render_module(name: str) -> List[str]:
    out = [f"## `{name}`", ""]
    try:
        mod = importlib.import_module(name)
    except Exception as e:
        out.append(f"_Import failed: {e}_")
        out.append("")
        return out

    # Module-level docstring
    if mod.__doc__:
        first = mod.__doc__.strip().split("\n")[0]
        out.append(f"**Purpose**: {first}")
        out.append("")

    # Get all public names defined in this module (not imported)
    members = []
    for attr_name in dir(mod):
        if attr_name.startswith("_"):
            continue
        obj = getattr(mod, attr_name)
        if inspect.isclass(obj) or inspect.isfunction(obj):
            # Only include if defined in THIS module
            try:
                if hasattr(obj, "__module__") and obj.__module__ == name:
                    members.append((attr_name, obj))
            except Exception:
                pass

    classes = [(n, o) for n, o in members if inspect.isclass(o)]
    functions = [(n, o) for n, o in members if inspect.isfunction(o)]

    if classes:
        out.append("### Classes")
        out.append("")
        for cname, cls in classes:
            sig = format_signature(cls)
            # Drop the leading "module.ClassName" prefix
            sig_clean = re.sub(r"^<class '[^']+'>$", f"class {cname}", sig) if sig.startswith("<") else sig
            out.append(f"#### `{cname}`")
            out.append("")
            d = doc_full(cls)
            if d:
                out.append("```")
                out.append(d)
                out.append("```")
                out.append("")
            # Methods
            public_methods = []
            for mname, mobj in inspect.getmembers(cls, predicate=inspect.isfunction):
                if mname.startswith("_"):
                    continue
                public_methods.append((mname, mobj))
            if public_methods:
                out.append(f"**Methods:**")
                out.append("")
                for mname, mobj in public_methods:
                    msig = format_signature(mobj)
                    mdoc = doc_first_line(mobj)
                    out.append(f"- `{mname}{msig}` — {mdoc}" if mdoc else f"- `{mname}{msig}`")
                out.append("")

    if functions:
        out.append("### Functions")
        out.append("")
        for fname, fn in functions:
            sig = format_signature(fn)
            d = doc_full(fn)
            out.append(f"#### `{fname}{sig}`")
            out.append("")
            if d:
                # Indent the docstring under a code fence
                out.append("```")
                out.append(d)
                out.append("```")
                out.append("")

    return out


def main() -> int:
    out = []
    out.append("# API Reference")
    out.append("")
    out.append("**Auto-generated** from module docstrings by `scripts/gen_api_docs.py`.")
    out.append("")
    out.append("**Date**: 2026-07-14")
    out.append("**Source**: 16 production modules across 6 layers")
    out.append("")
    out.append("## Table of Contents")
    out.append("")
    for m in MODULES_TO_DOC:
        out.append(f"- [`{m}`](#{m.replace('.', '').replace('_', '-')}")
    out.append("")

    for m in MODULES_TO_DOC:
        out.extend(render_module(m))
        out.append("---")
        out.append("")

    # Trim trailing separator
    while out and out[-1] in ("---", ""):
        out.pop()

    target = REPO / "docs" / "API_REFERENCE.md"
    target.write_text("\n".join(out))
    print(f"Wrote: {target}")
    print(f"Lines: {len(out)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
